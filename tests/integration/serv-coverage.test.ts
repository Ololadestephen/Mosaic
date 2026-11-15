import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  checkCoverage,
  currentCoverageFingerprint,
} from "@/server/ai/coverage";
import { inWorkspace } from "@/server/auth/authorization";
import { closeDatabase, db } from "@/server/db/client";
import { analysisContext, saveProposal } from "@/server/reconciliation";
import { addRevision, createSource } from "@/server/sources";
import { createTask } from "@/server/tasks";
import { setMember } from "@/server/workspaces";
import { account, prepareDatabase, workspace } from "./helpers";

beforeAll(prepareDatabase);
afterAll(closeDatabase);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const updatedText =
  "Keep the previous task.\nReview the new requirement.\nClosing note.";

async function draft() {
  const owner = await workspace();
  const { actor, workspaceId } = owner;
  const source = await createSource(actor, workspaceId, {
    title: "Coverage test",
    text: "Keep the previous task.\nClosing note.",
    visibility: "workspace",
  });
  const { versionId } = await addRevision(actor, workspaceId, source.sourceId, {
    predecessorId: source.versionId,
    text: updatedText,
  });
  const { id } = await inWorkspace(actor, workspaceId, "write", async (tx) =>
    saveProposal(
      tx,
      actor,
      workspaceId,
      await analysisContext(tx, actor, workspaceId, versionId),
      {
        items: [],
        questions: ["Who reviews the requirement?"],
        preserved: [],
      },
    ),
  );
  vi.stubEnv("SERV_API_KEY", "test-placeholder");
  vi.stubEnv("SERV_COVERAGE_ATTEMPT_LIMIT", "100");
  vi.stubEnv("AI_DAILY_CALL_LIMIT", "100");
  vi.stubEnv("AI_ALLOWED_ACCOUNT_IDS", actor.userId);
  vi.stubEnv("AI_ACCOUNT_TOTAL_CALL_LIMIT", "1");
  return { ...owner, id };
}

function provider(
  beforeResponding: () => Promise<unknown> = async () => undefined,
) {
  const fetch = vi.fn(async () => {
    await beforeResponding();
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              classifications: [
                {
                  passageId: "selected:24",
                  status: "uncovered",
                  reason: "Assign someone to review the requirement.",
                  taskIds: [],
                  proposalKeys: [],
                },
              ],
            }),
          },
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("returns an advisory result, spends the allowance once and refuses viewers and outsiders", async () => {
  const { actor, workspaceId, id } = await draft();
  const viewer = await account("Coverage viewer");
  const outsider = await account("Coverage outsider");
  await setMember(actor, workspaceId, {
    email: viewer.account.email,
    role: "viewer",
  });
  vi.stubEnv(
    "AI_ALLOWED_ACCOUNT_IDS",
    [actor.userId, viewer.actor.userId, outsider.actor.userId].join(","),
  );
  const fetch = provider();
  await expect(
    checkCoverage(viewer.actor, workspaceId, { changeSetId: id }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    checkCoverage(outsider.actor, workspaceId, { changeSetId: id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(fetch).not.toHaveBeenCalled();
  const result = await checkCoverage(actor, workspaceId, { changeSetId: id });
  expect(result.entries).toMatchObject([
    { status: "uncovered", passage: { text: "Review the new requirement.\n" } },
  ]);
  expect(
    await currentCoverageFingerprint(actor, workspaceId, { changeSetId: id }),
  ).toEqual({
    fingerprint: result.fingerprint,
  });
  expect(
    await db()`SELECT revision, state FROM change_sets WHERE id = ${id}`,
  ).toEqual([{ revision: 1, state: "draft" }]);
  expect(
    await db()`SELECT id FROM execution_batches WHERE workspace_id = ${workspaceId}`,
  ).toHaveLength(0);
  await expect(
    checkCoverage(actor, workspaceId, { changeSetId: id }),
  ).rejects.toMatchObject({
    code: "QUOTA_EXHAUSTED",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("rejects a result if the task set changes in flight and still counts the attempt", async () => {
  const { actor, workspaceId, id } = await draft();
  const fetch = provider(() =>
    createTask(
      actor,
      workspaceId,
      {
        title: "Review the new requirement",
        status: "todo",
        assigneeId: null,
        dueDate: null,
      },
      randomUUID(),
    ),
  );
  await expect(
    checkCoverage(actor, workspaceId, { changeSetId: id }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    checkCoverage(actor, workspaceId, { changeSetId: id }),
  ).rejects.toMatchObject({
    code: "QUOTA_EXHAUSTED",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("checks a revision against tasks alone, and caps the shared open-app account by the total, not per account", async () => {
  const owner = await workspace();
  const { actor, workspaceId } = owner;
  const source = await createSource(actor, workspaceId, {
    title: "Revision coverage",
    text: "Keep the previous task.\nClosing note.",
    visibility: "workspace",
  });
  const { versionId } = await addRevision(actor, workspaceId, source.sourceId, {
    predecessorId: source.versionId,
    text: updatedText,
  });
  const visitor = await account("Visitor");
  await setMember(actor, workspaceId, {
    email: visitor.account.email,
    role: "editor",
  });
  const [{ used }] = await db()<
    { used: number }[]
  >`SELECT count(*)::int AS used FROM serv_coverage_attempts`;
  vi.stubEnv("SERV_API_KEY", "test-placeholder");
  vi.stubEnv("SERV_COVERAGE_ATTEMPT_LIMIT", String(used + 2));
  vi.stubEnv("AI_DAILY_CALL_LIMIT", "100");
  vi.stubEnv("AI_ACCOUNT_TOTAL_CALL_LIMIT", "1");
  vi.stubEnv(
    "AI_ALLOWED_ACCOUNT_IDS",
    [actor.userId, visitor.actor.userId].join(","),
  );
  vi.stubEnv("OPEN_APP_ACCOUNT_ID", visitor.actor.userId);
  const fetch = provider();
  const target = { versionId };
  const first = await checkCoverage(visitor.actor, workspaceId, target);
  expect(first.entries).toMatchObject([
    { status: "uncovered", proposalKeys: [], versionId },
  ]);
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  const sent = JSON.parse(String(init.body)).messages[1].content;
  expect(JSON.parse(sent)).toMatchObject({ proposals: [] });
  expect(
    await currentCoverageFingerprint(visitor.actor, workspaceId, target),
  ).toEqual({ fingerprint: first.fingerprint });
  await checkCoverage(visitor.actor, workspaceId, target);
  await expect(
    checkCoverage(visitor.actor, workspaceId, target),
  ).rejects.toMatchObject({ code: "QUOTA_EXHAUSTED" });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    await db()`SELECT id FROM change_sets WHERE workspace_id = ${workspaceId}`,
  ).toHaveLength(0);
});
