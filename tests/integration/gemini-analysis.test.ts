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
import { createTask } from "@/server/tasks";

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
  it("preserves ten historical attempts when extending to eleven and rejects all further attempts", async () => {
    enableGemini(10);
    const owner = await source();
    const historicalIds = Array.from({ length: 10 }, () => randomUUID());
    for (const runId of historicalIds) {
      await db()`INSERT INTO analysis_runs (id,workspace_id,source_version_id,actor_id,status,provider,validation_id,model,prompt_version,reserved_usd,started_at,completed_at)
        VALUES (${runId},${owner.workspaceId},${owner.versionId},${owner.actor.userId},'failed','gemini',${process.env.GEMINI_VALIDATION_ID!},'gemini-3.5-flash-lite','historical-mocked-attempt',0,now()-interval '1 day',now()-interval '1 day')`;
    }
    const fetch = vi.fn().mockResolvedValue(completion());
    vi.stubGlobal("fetch", fetch);
    await expect(
      analyzeSource(owner.actor, owner.workspaceId, {
        sourceVersionId: owner.versionId,
      }),
    ).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("GEMINI_VALIDATION_CALL_LIMIT", "11");
    await analyzeSource(owner.actor, owner.workspaceId, {
      sourceVersionId: owner.versionId,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      await db()`SELECT id FROM analysis_runs WHERE provider='gemini' AND validation_id=${process.env.GEMINI_VALIDATION_ID!}`,
    ).toHaveLength(11);
    const history =
      await db()`SELECT id,status,prompt_version FROM analysis_runs WHERE id IN ${db()(historicalIds)} ORDER BY id`;
    expect(history).toEqual(
      [...historicalIds].sort().map((id) => ({
        id,
        status: "failed",
        prompt_version: "historical-mocked-attempt",
      })),
    );
    // A new account cannot bypass the exhausted cumulative cap of eleven.
    const other = await source();
    await expect(
      analyzeSource(other.actor, other.workspaceId, {
        sourceVersionId: other.versionId,
      }),
    ).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      await db()`SELECT id FROM analysis_runs WHERE provider='gemini' AND validation_id=${process.env.GEMINI_VALIDATION_ID!}`,
    ).toHaveLength(11);
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
  it("rejects token-limited output at the configured budget without a proposal or task writes, even for complete JSON", async () => {
    enableGemini();
    vi.stubEnv("GEMINI_MAX_OUTPUT_TOKENS", "4096");
    const owner = await source();
    const created = await createTask(
      owner.actor,
      owner.workspaceId,
      {
        title: "Synthetic task",
        status: "todo",
        assigneeId: null,
        dueDate: null,
      },
      randomUUID(),
    );
    const taskId = created.taskIds[0];
    const beforeTasks =
      await db()`SELECT * FROM tasks WHERE workspace_id=${owner.workspaceId}`;
    const beforeBatches =
      await db()`SELECT id FROM execution_batches WHERE workspace_id=${owner.workspaceId}`;
    const fetch = vi.fn().mockResolvedValue(
      completion(
        {
          items: [
            {
              kind: "update",
              key: "date",
              taskId,
              expectedRevision: 1,
              field: "dueDate",
              value: "2026-10-22",
              reason: "Synthetic",
              impact: "Schedule",
              citations: [
                {
                  sourceVersionId: owner.versionId,
                  quote: "Which task should change?",
                },
              ],
            },
          ],
          questions: [],
          preserved: [],
        },
        "MAX_TOKENS",
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      analyzeSource(owner.actor, owner.workspaceId, {
        sourceVersionId: owner.versionId,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
      message: expect.stringContaining("MAX_TOKENS"),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).generationConfig).toEqual({
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "MINIMAL" },
    });
    expect(
      await db()`SELECT * FROM tasks WHERE workspace_id=${owner.workspaceId}`,
    ).toEqual(beforeTasks);
    expect(
      await db()`SELECT id FROM execution_batches WHERE workspace_id=${owner.workspaceId}`,
    ).toEqual(beforeBatches);
    expect(
      await db()`SELECT id FROM change_sets WHERE workspace_id=${owner.workspaceId}`,
    ).toHaveLength(0);
    const runs =
      await db()`SELECT status,error_code FROM analysis_runs WHERE workspace_id=${owner.workspaceId}`;
    expect(runs).toEqual([{ status: "failed", error_code: "INVALID_OUTPUT" }]);
  });
  it("rejects malformed JSON, missing fields and mixed kinds before saving or writing work", async () => {
    enableGemini();
    for (const raw of [
      "{broken",
      '{"items":[{"citations":[{"start":0,..."quote":"Synthetic"}]}],"questions":[],"preserved":[]}',
      JSON.stringify({ items: [], preserved: [] }),
      JSON.stringify({
        items: [
          {
            kind: "decision",
            key: "d",
            statement: "s",
            needsReview: true,
            taskId: randomUUID(),
            reason: "r",
            impact: "",
            citations: [
              { sourceVersionId: randomUUID(), start: 0, end: 1, quote: "A" },
            ],
          },
        ],
        questions: [],
        preserved: [],
      }),
    ]) {
      const owner = await source();
      const fetch = vi.fn().mockResolvedValue(
        Response.json({
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text: raw }] } },
          ],
        }),
      );
      vi.stubGlobal("fetch", fetch);
      await expect(
        analyzeSource(owner.actor, owner.workspaceId, {
          sourceVersionId: owner.versionId,
        }),
      ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        await db()`SELECT id FROM change_sets WHERE workspace_id=${owner.workspaceId}`,
      ).toHaveLength(0);
      expect(
        await db()`SELECT id FROM tasks WHERE workspace_id=${owner.workspaceId}`,
      ).toHaveLength(0);
      const [run] =
        await db()`SELECT status,error_code FROM analysis_runs WHERE workspace_id=${owner.workspaceId}`;
      expect(run).toMatchObject({
        status: "failed",
        error_code: "INVALID_OUTPUT",
      });
    }
  });
  it("validates a cited update but rejects a stale task revision without a second generation", async () => {
    for (const stale of [false, true]) {
      enableGemini();
      const owner = await source();
      const created = await createTask(
        owner.actor,
        owner.workspaceId,
        {
          title: "Synthetic task",
          status: "todo",
          assigneeId: null,
          dueDate: null,
        },
        randomUUID(),
      );
      const taskId = created.taskIds[0];
      const fetch = vi.fn().mockResolvedValue(
        completion({
          items: [
            {
              kind: "update",
              key: "date",
              taskId,
              expectedRevision: stale ? 2 : 1,
              field: "dueDate",
              value: "2026-10-22",
              reason: "Synthetic review",
              impact: "Schedule",
              citations: [
                {
                  sourceVersionId: owner.versionId,
                  quote: "Which task should change?",
                },
              ],
            },
          ],
          questions: [],
          preserved: [],
        }),
      );
      vi.stubGlobal("fetch", fetch);
      const analysis = analyzeSource(owner.actor, owner.workspaceId, {
        sourceVersionId: owner.versionId,
      });
      if (stale)
        await expect(analysis).rejects.toMatchObject({ code: "CONFLICT" });
      else expect((await analysis).id).toBeTruthy();
      expect(fetch).toHaveBeenCalledTimes(1);
      const drafts =
        await db()`SELECT id FROM change_sets WHERE workspace_id=${owner.workspaceId}`;
      expect(drafts).toHaveLength(stale ? 0 : 1);
      const [task] =
        await db()`SELECT revision,due_date FROM tasks WHERE id=${taskId}`;
      expect(task).toMatchObject({ revision: 1, due_date: null });
    }
  });
  it("keeps raw Gemini transport separate from resolved citations and existing task receipts", async () => {
    enableGemini();
    const owner = await source();
    await createTask(
      owner.actor,
      owner.workspaceId,
      {
        title: "Existing manual task",
        status: "todo",
        assigneeId: null,
        dueDate: null,
      },
      randomUUID(),
    );
    const beforeTasks =
      await db()`SELECT * FROM tasks WHERE workspace_id=${owner.workspaceId}`;
    const beforeBatches =
      await db()`SELECT * FROM execution_batches WHERE workspace_id=${owner.workspaceId}`;
    expect(beforeBatches).toHaveLength(1);
    expect(beforeBatches[0].operation).toBe("create");
    const transport = {
      items: [
        {
          kind: "decision",
          key: "d",
          reason: "Synthetic",
          impact: "",
          statement: "Human interpretation required",
          needsReview: true,
          citations: [
            {
              sourceVersionId: owner.versionId,
              quote: "Which task should change?",
            },
          ],
        },
      ],
      questions: [],
      preserved: [],
    };
    const raw = JSON.stringify({
      providerAuditMarker: "raw-only-synthetic-marker",
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(transport) }] },
        },
      ],
    });
    const fetch = vi.fn().mockResolvedValue(new Response(raw));
    vi.stubGlobal("fetch", fetch);
    const result = await analyzeSource(owner.actor, owner.workspaceId, {
      sourceVersionId: owner.versionId,
    });
    const draft = await getProposal(owner.actor, owner.workspaceId, result.id);
    expect(draft.items[0].citations[0]).toEqual({
      sourceVersionId: owner.versionId,
      start: 0,
      end: 25,
      quote: "Which task should change?",
    });
    const [run] =
      await db()`SELECT raw_provider_response FROM analysis_runs WHERE workspace_id=${owner.workspaceId}`;
    expect(run.raw_provider_response).toBe(raw);
    expect(
      JSON.parse(
        JSON.parse(run.raw_provider_response).candidates[0].content.parts[0]
          .text,
      ),
    ).toEqual(transport);
    expect(JSON.stringify(draft)).not.toContain("raw-only-synthetic-marker");
    expect(JSON.stringify(draft)).not.toContain("raw_provider_response");
    expect(
      await db()`SELECT * FROM tasks WHERE workspace_id=${owner.workspaceId}`,
    ).toEqual(beforeTasks);
    expect(
      await db()`SELECT * FROM execution_batches WHERE workspace_id=${owner.workspaceId}`,
    ).toEqual(beforeBatches);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retains rejected raw responses without saving proposals or changing pre-existing task receipts", async () => {
    for (const failure of [
      "absent",
      "ambiguous",
      "wrong-revision",
      "legacy-offsets",
      "malformed",
    ] as const) {
      enableGemini();
      const owner = await workspace();
      const saved = await createSource(owner.actor, owner.workspaceId, {
        title: "Synthetic exact quotes",
        text: "Repeat\nRepeat",
      });
      await createTask(
        owner.actor,
        owner.workspaceId,
        {
          title: "Existing manual task",
          status: "todo",
          assigneeId: null,
          dueDate: null,
        },
        randomUUID(),
      );
      const beforeTasks =
        await db()`SELECT * FROM tasks WHERE workspace_id=${owner.workspaceId}`;
      const beforeBatches =
        await db()`SELECT * FROM execution_batches WHERE workspace_id=${owner.workspaceId}`;
      expect(beforeBatches).toHaveLength(1);
      const citation = {
        sourceVersionId:
          failure === "wrong-revision" ? randomUUID() : saved.versionId,
        quote: failure === "absent" ? "Missing" : "Repeat",
        ...(failure === "legacy-offsets" ? { start: 0, end: 6 } : {}),
      };
      const text =
        failure === "malformed"
          ? "{broken"
          : JSON.stringify({
              items: [
                {
                  kind: "decision",
                  key: "d",
                  reason: "Synthetic",
                  impact: "",
                  statement: "Review",
                  needsReview: true,
                  citations: [citation],
                },
              ],
              questions: [],
              preserved: [],
            });
      const raw = JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
      });
      const fetch = vi.fn().mockResolvedValue(new Response(raw));
      vi.stubGlobal("fetch", fetch);
      await expect(
        analyzeSource(owner.actor, owner.workspaceId, {
          sourceVersionId: saved.versionId,
        }),
      ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
      const [run] =
        await db()`SELECT status,raw_provider_response FROM analysis_runs WHERE workspace_id=${owner.workspaceId}`;
      expect(run).toEqual({ status: "failed", raw_provider_response: raw });
      expect(
        await db()`SELECT id FROM change_sets WHERE workspace_id=${owner.workspaceId}`,
      ).toHaveLength(0);
      expect(
        await db()`SELECT * FROM tasks WHERE workspace_id=${owner.workspaceId}`,
      ).toEqual(beforeTasks);
      expect(
        await db()`SELECT * FROM execution_batches WHERE workspace_id=${owner.workspaceId}`,
      ).toEqual(beforeBatches);
      expect(fetch).toHaveBeenCalledTimes(1);
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
