import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { prepareDatabase, workspace } from "./helpers";
import { closeDatabase, db } from "@/server/db/client";
import { createSource } from "@/server/sources";
import { analyzeSource } from "@/server/ai/analyze";
import { workspaceData } from "@/server/workspace-data";

// A separate disposable database lets lifetime-cap tests start at zero without
// deleting any existing test, diagnostic or user history.
const databaseName = `mosaic_release_${randomUUID().replaceAll("-", "")}_test`;
let admin: ReturnType<typeof postgres>;
beforeAll(async () => {
  const local = await readFile(".local/test.env", "utf8").catch(() => "");
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      local.trim().replace(/^TEST_DATABASE_URL=/, ""),
  );
  if (!url.pathname.endsWith("_test"))
    throw Error("Dedicated test database required");
  admin = postgres(url.href, { max: 1 });
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  url.pathname = "/" + databaseName;
  vi.stubEnv("TEST_DATABASE_URL", url.href);
  await prepareDatabase();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDatabase();
  if (admin) {
    await admin`DROP DATABASE ${admin(databaseName)}`;
    await admin.end();
  }
});
function enable(ids: string[], cap: number) {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("AI_ALLOWED_ACCOUNT_IDS", ids.join(","));
  vi.stubEnv("AI_ACCOUNT_TOTAL_CALL_LIMIT", "1");
  vi.stubEnv("GEMINI_HOSTED_ATTEMPT_LIMIT", String(cap));
  vi.stubEnv("GEMINI_API_KEY", "mock-key-never-sent");
  vi.stubEnv("GEMINI_FREE_TIER_CONFIRMED", "true");
  vi.stubEnv("GEMINI_VALIDATION_ID", randomUUID());
  vi.stubEnv("GEMINI_VALIDATION_CALL_LIMIT", "13");
}
const completion = () =>
  Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            {
              text: '{"items":[],"questions":["Who owns this?"],"preserved":[]}',
            },
          ],
        },
      },
    ],
  });
async function fixture() {
  const owner = await workspace();
  const source = await createSource(owner.actor, owner.workspaceId, {
    title: "Synthetic release test",
    text: "Who owns this?",
  });
  return { ...owner, input: { sourceVersionId: source.versionId } };
}
it("denies unlisted production accounts in UI and server without reserving a call", async () => {
  const owner = await fixture();
  enable([], 1);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await workspaceData(owner.actor, owner.workspaceId)).aiEnabled).toBe(
    false,
  );
  await expect(
    analyzeSource(owner.actor, owner.workspaceId, owner.input),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(fetch).not.toHaveBeenCalled();
  expect(await db()`SELECT id FROM analysis_runs`).toHaveLength(0);
});
it("serializes across accounts, counts failures, and retains lifetime limits after reconnect or campaign rotation", async () => {
  const a = await fixture(),
    b = await fixture();
  enable([a.actor.userId, b.actor.userId], 2);
  let finish!: (value: Response) => void;
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const first = analyzeSource(a.actor, a.workspaceId, a.input);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await expect(
    analyzeSource(b.actor, b.workspaceId, b.input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  finish(
    Response.json(
      { error: { status: "UNAVAILABLE", message: "Synthetic failure" } },
      { status: 503 },
    ),
  );
  await expect(first).rejects.toMatchObject({ code: "PROVIDER_FAILED" });
  await closeDatabase();
  vi.stubEnv("GEMINI_VALIDATION_ID", randomUUID());
  // Age only the disposable test run past the separate 15s frequency window.
  await db()`UPDATE analysis_runs SET started_at = now() - interval '20 seconds'`;
  await expect(
    analyzeSource(a.actor, a.workspaceId, a.input),
  ).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
  fetch.mockResolvedValue(completion());
  await analyzeSource(b.actor, b.workspaceId, b.input);
  const c = await fixture();
  vi.stubEnv("AI_ALLOWED_ACCOUNT_IDS", c.actor.userId);
  vi.stubEnv("GEMINI_VALIDATION_ID", randomUUID());
  await expect(
    analyzeSource(c.actor, c.workspaceId, c.input),
  ).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    (await db()`SELECT status FROM analysis_runs ORDER BY started_at`).map(
      (r) => r.status,
    ),
  ).toEqual(["failed", "completed"]);
});
it("fails closed with zero hosted allowance and the operator kill switch", async () => {
  const owner = await fixture();
  enable([owner.actor.userId], 0);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    analyzeSource(owner.actor, owner.workspaceId, owner.input),
  ).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
  vi.stubEnv("AI_ENABLED", "false");
  expect((await workspaceData(owner.actor, owner.workspaceId)).aiEnabled).toBe(
    false,
  );
  await expect(
    analyzeSource(owner.actor, owner.workspaceId, owner.input),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(fetch).not.toHaveBeenCalled();
});
