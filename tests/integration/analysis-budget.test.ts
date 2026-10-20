import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prepareDatabase, workspace } from "./helpers";
import { closeDatabase, db } from "@/server/db/client";
import { createSource } from "@/server/sources";
import { analyzeSource } from "@/server/ai/analyze";

beforeAll(prepareDatabase);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(closeDatabase);

function enableTestProvider() {
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("AI_PROVIDER", "openrouter");
  vi.stubEnv("OPENROUTER_API_KEY", "placeholder-for-mocked-fetch-only");
  vi.stubEnv("OPENROUTER_MODEL", "test-model");
  vi.stubEnv("AI_DAILY_BUDGET_USD", "100");
  vi.stubEnv("AI_DAILY_CALL_LIMIT", "1");
  vi.stubEnv("AI_INPUT_USD_PER_MILLION", "0.01");
  vi.stubEnv("AI_OUTPUT_USD_PER_MILLION", "0.01");
}

describe("real database reservations with mocked provider HTTP", () => {
  it("serializes duplicate analysis, persists the draft, and reuses it without paying twice", async () => {
    enableTestProvider();
    const owner = await workspace();
    const source = await createSource(owner.actor, owner.workspaceId, {
      title: "Budget test",
      text: "Do not change completed work.",
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async () => {
      await gate;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                items: [],
                questions: ["What work is needed?"],
                preserved: ["Completed work is preserved."],
              }),
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetch);
    const original = analyzeSource(owner.actor, owner.workspaceId, {
      sourceVersionId: source.versionId,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await expect(
      analyzeSource(owner.actor, owner.workspaceId, {
        sourceVersionId: source.versionId,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    release();
    const draft = await original;
    expect(
      (
        await analyzeSource(owner.actor, owner.workspaceId, {
          sourceVersionId: source.versionId,
        })
      ).id,
    ).toBe(draft.id);
    expect(fetch).toHaveBeenCalledTimes(1);
    const second = await createSource(owner.actor, owner.workspaceId, {
      title: "Second",
      text: "New source",
    });
    await expect(
      analyzeSource(owner.actor, owner.workspaceId, {
        sourceVersionId: second.versionId,
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const [run] = await db()<
      { status: string; reserved_usd: string }[]
    >`SELECT status, reserved_usd FROM analysis_runs WHERE workspace_id = ${owner.workspaceId}`;
    expect(run.status).toBe("completed");
    expect(Number(run.reserved_usd)).toBeGreaterThan(0);
  });
  it("records provider failures and rejects an uncovered request before any HTTP call", async () => {
    enableTestProvider();
    const owner = await workspace();
    const source = await createSource(owner.actor, owner.workspaceId, {
      title: "Failure",
      text: "A bounded request",
    });
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      analyzeSource(owner.actor, owner.workspaceId, {
        sourceVersionId: source.versionId,
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
    const [run] = await db()<
      { status: string; error_code: string }[]
    >`SELECT status, error_code FROM analysis_runs WHERE workspace_id = ${owner.workspaceId}`;
    expect(run.status).toBe("failed");
    expect(run.error_code).toBe("PROVIDER_FAILED");
    vi.stubEnv("AI_DAILY_BUDGET_USD", "0.000001");
    const other = await workspace();
    const otherSource = await createSource(other.actor, other.workspaceId, {
      title: "No budget",
      text: "Source",
    });
    await expect(
      analyzeSource(other.actor, other.workspaceId, {
        sourceVersionId: otherSource.versionId,
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await db()`SELECT id FROM analysis_runs WHERE workspace_id = ${other.workspaceId}`
      ).length,
    ).toBe(0);
  });
});
