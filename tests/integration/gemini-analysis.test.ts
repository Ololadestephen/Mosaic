import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import { prepareDatabase, workspace } from "./helpers";
import { closeDatabase, db } from "@/server/db/client";
import { createSource } from "@/server/sources";
import { analyzeSource } from "@/server/ai/analyze";
import { getProposal } from "@/server/reconciliation";

beforeAll(prepareDatabase);
afterAll(closeDatabase);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function enableGemini(limit = 10) {
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "mock-key-never-sent");
  vi.stubEnv("GEMINI_FREE_TIER_CONFIRMED", "true");
  vi.stubEnv("GEMINI_VALIDATION_ID", randomUUID());
  vi.stubEnv("GEMINI_VALIDATION_CALL_LIMIT", String(limit));
  vi.stubEnv("AI_DAILY_CALL_LIMIT", "10");
  vi.stubEnv("AI_DAILY_BUDGET_USD", "0");
  vi.stubEnv("AI_INPUT_USD_PER_MILLION", "0");
  vi.stubEnv("AI_OUTPUT_USD_PER_MILLION", "0");
}
async function source() {
  const owner = await workspace();
  const saved = await createSource(owner.actor, owner.workspaceId, {
    title: "Synthetic Gemini test",
    text: "Which task should change?",
  });
  return { ...owner, ...saved };
}
function completion(
  output: unknown = {
    items: [],
    questions: ["Which task should change?"],
    preserved: [],
  },
  finishReason = "STOP",
) {
  return Response.json({
    candidates: [
      { finishReason, content: { parts: [{ text: JSON.stringify(output) }] } },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 15,
      totalTokenCount: 25,
    },
  });
}

describe("Gemini orchestration with real PostgreSQL and mocked HTTP", () => {
  it("persists safe usage and provenance, and reuses a completed proposal without a second call", async () => {
    enableGemini();
    const owner = await source();
    const fetch = vi.fn().mockResolvedValue(completion());
    vi.stubGlobal("fetch", fetch);
    const input = { sourceVersionId: owner.versionId };
    const proposal = await analyzeSource(owner.actor, owner.workspaceId, input);
    expect(await analyzeSource(owner.actor, owner.workspaceId, input)).toEqual(
      proposal,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const draft = await getProposal(
      owner.actor,
      owner.workspaceId,
      proposal.id,
    );
    expect(draft.analysis).toEqual({
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
    });
    expect(draft.items).toEqual([]);
    const [run] =
      await db()`SELECT status, provider, reserved_usd, token_usage, duration_ms FROM analysis_runs WHERE workspace_id = ${owner.workspaceId}`;
    expect(run.status).toBe("completed");
    expect(Number(run.reserved_usd)).toBe(0);
    expect(run.token_usage.totalTokenCount).toBe(25);
    expect(run.duration_ms).toBeGreaterThanOrEqual(0);
  });
  it("serializes the shared cap across separate accounts and workspaces", async () => {
    enableGemini(1);
    const a = await source();
    const b = await source();
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(completion()));
    vi.stubGlobal("fetch", fetch);
    const results = await Promise.allSettled(
      [a, b].map((owner) =>
        analyzeSource(owner.actor, owner.workspaceId, {
          sourceVersionId: owner.versionId,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.code).toBe(
      "QUOTA_EXHAUSTED",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects schema-valid output with forged evidence before saving a proposal", async () => {
    enableGemini();
    const owner = await source();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        completion({
          items: [
            {
              kind: "create",
              key: "forged",
              title: "Unsupported task",
              fields: { status: "todo", assigneeId: null, dueDate: null },
              reason: "Unsupported",
              impact: "Creation",
              citations: [
                {
                  sourceVersionId: owner.versionId,
                  start: 0,
                  end: 5,
                  quote: "Wrong",
                },
              ],
            },
          ],
          questions: [],
          preserved: [],
        }),
      ),
    );
    await expect(
      analyzeSource(owner.actor, owner.workspaceId, {
        sourceVersionId: owner.versionId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
    expect(
      await db()`SELECT id FROM change_sets WHERE workspace_id = ${owner.workspaceId}`,
    ).toHaveLength(0);
    expect(
      await db()`SELECT id FROM tasks WHERE workspace_id = ${owner.workspaceId}`,
    ).toHaveLength(0);
    const [run] =
      await db()`SELECT status, error_code, token_usage FROM analysis_runs WHERE workspace_id = ${owner.workspaceId}`;
    expect(run).toMatchObject({
      status: "failed",
      error_code: "INVALID_OUTPUT",
      token_usage: { totalTokenCount: 25 },
    });
  });
  it("retains failures against the cap and never saves blocked or truncated drafts", async () => {
    enableGemini();
    for (const failure of [
      Response.json({ promptFeedback: { blockReason: "SAFETY" } }),
      completion(undefined, "MAX_TOKENS"),
      new Response("", { status: 429 }),
    ]) {
      const owner = await source();
      const fetch = vi.fn().mockResolvedValue(failure);
      vi.stubGlobal("fetch", fetch);
      await expect(
        analyzeSource(owner.actor, owner.workspaceId, {
          sourceVersionId: owner.versionId,
        }),
      ).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        await db()`SELECT id FROM change_sets WHERE workspace_id = ${owner.workspaceId}`,
      ).toHaveLength(0);
      const [run] =
        await db()`SELECT status FROM analysis_runs WHERE workspace_id = ${owner.workspaceId}`;
      expect(run.status).toBe("failed");
    }
  });
  it("does not persist a proposal after caller cancellation", async () => {
    enableGemini();
    const owner = await source();
    const controller = new AbortController();
    let release: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetch);
    const run = analyzeSource(
      owner.actor,
      owner.workspaceId,
      { sourceVersionId: owner.versionId },
      controller.signal,
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort();
    release(completion());
    await expect(run).rejects.toThrow("cancelled");
    expect(
      await db()`SELECT id FROM change_sets WHERE workspace_id = ${owner.workspaceId}`,
    ).toHaveLength(0);
    const [saved] =
      await db()`SELECT status FROM analysis_runs WHERE workspace_id = ${owner.workspaceId}`;
    expect(saved.status).toBe("failed");
  });
  it("retains only safe HTTP failure metadata for inspection after refresh", async () => {
    enableGemini();
    const owner = await source();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              status: "INVALID_ARGUMENT",
              code: 400,
              message:
                "Invalid value: Which task should change? mock-key-never-sent",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.BadRequest",
                  fieldViolations: [
                    {
                      field: "contents[0].parts[0].text",
                      description: "Unexpected Which task should change?",
                    },
                  ],
                },
              ],
            },
          },
          { status: 400 },
        ),
      ),
    );
    await expect(
      analyzeSource(owner.actor, owner.workspaceId, {
        sourceVersionId: owner.versionId,
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_FAILED",
      httpStatus: 400,
      category: "INVALID_ARGUMENT",
    });
    const [run] =
      await db()`SELECT status, provider_http_status, provider_error_code, provider_error_details FROM analysis_runs WHERE workspace_id = ${owner.workspaceId}`;
    expect(run).toMatchObject({
      status: "failed",
      provider_http_status: 400,
      provider_error_code: "INVALID_ARGUMENT",
      provider_error_details: {
        httpStatus: 400,
        code: 400,
        status: "INVALID_ARGUMENT",
        fieldViolations: [{ field: "contents[0].parts[0].text" }],
      },
    });
    expect(run.provider_error_details.message).toContain("Invalid value");
    expect(JSON.stringify(run.provider_error_details)).not.toContain(
      "Which task should change?",
    );
    expect(JSON.stringify(run.provider_error_details)).not.toContain(
      "mock-key-never-sent",
    );
    expect(
      await db()`SELECT id FROM change_sets WHERE workspace_id = ${owner.workspaceId}`,
    ).toHaveLength(0);
  });
});
