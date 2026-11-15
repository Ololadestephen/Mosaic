import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "@/domain/contracts";
import { DomainError, requireCondition } from "@/domain/errors";
import { changedPassages } from "@/domain/sources/coverage-passages";
import { nameTasks } from "@/domain/sources/coverage-result";
import { assertVisible, inWorkspace } from "../auth/authorization";
import { db, type Transaction } from "../db/client";
import { draftRecord } from "../db/records";
import { reportError } from "../diagnostics";
import { env } from "../env";
import { analysisContext } from "../reconciliation";
import { coverageAvailable } from "./coverage-access";
import { isOpenAppAccount } from "../auth/open-app";
import { classifyCoverage } from "./serv-coverage";

// Coverage runs on a draft proposal (tasks and proposed items) or on a revision alone (tasks only).
export type CoverageTarget = { changeSetId: string } | { versionId: string };

async function targetDraft(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
  target: CoverageTarget,
) {
  if (!("changeSetId" in target))
    return { draft: null, versionId: target.versionId };
  const draft = await draftRecord(tx, workspaceId, target.changeSetId);
  requireCondition(draft, "NOT_FOUND", "Change set not found.");
  assertVisible(draft.restrictedTo, actor);
  requireCondition(
    draft.state === "draft",
    "CONFLICT",
    "This proposal is no longer a draft.",
  );
  return { draft, versionId: draft.sourceVersionId };
}

async function coverageSnapshot(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
  target: CoverageTarget,
) {
  const { draft, versionId } = await targetDraft(
    tx,
    actor,
    workspaceId,
    target,
  );
  const context = await analysisContext(tx, actor, workspaceId, versionId);
  const previous = context.versions.find(
    ({ id }) => id === context.source.predecessorId,
  );
  requireCondition(
    previous,
    "INVALID_INPUT",
    "Coverage requires two source revisions.",
  );
  const diff = changedPassages(previous.text, context.source.text);
  requireCondition(
    !diff.coarse && diff.passages.length <= 60,
    "INVALID_INPUT",
    "This revision comparison is too large for coverage checking.",
  );
  requireCondition(
    diff.passages.length,
    "INVALID_INPUT",
    "There are no changed passages to classify.",
  );
  const tasks = context.tasks.map(
    ({ id, title, status, assigneeId, dueDate, revision, archived }) => ({
      id,
      title,
      status,
      assigneeId,
      dueDate,
      revision,
      archived,
    }),
  );
  const items = draft?.items ?? [];
  const proposals = items.filter(
    (item) =>
      item.kind !== "update" ||
      tasks.some(
        (task) =>
          task.id === item.taskId && task.revision === item.expectedRevision,
      ),
  );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        previous.id,
        context.source.id,
        draft?.revision ?? null,
        items,
        tasks,
      ]),
    )
    .digest("hex");

  return {
    previous,
    selected: context.source,
    tasks,
    proposals,
    passages: diff.passages,
    fingerprint,
  };
}

export async function currentCoverageFingerprint(
  actor: Actor,
  workspaceId: string,
  target: CoverageTarget,
) {
  requireCondition(
    coverageAvailable(actor),
    "FORBIDDEN",
    "SERV coverage is unavailable for this account.",
  );
  return inWorkspace(actor, workspaceId, "write", async (tx) => {
    const { fingerprint } = await coverageSnapshot(
      tx,
      actor,
      workspaceId,
      target,
    );
    return { fingerprint };
  });
}

export async function checkCoverage(
  actor: Actor,
  workspaceId: string,
  target: CoverageTarget,
  signal?: AbortSignal,
) {
  const config = env();
  requireCondition(
    coverageAvailable(actor, config),
    "FORBIDDEN",
    "SERV coverage is unavailable for this account.",
  );
  const attemptId = randomUUID();
  const snapshot = await inWorkspace(
    actor,
    workspaceId,
    "write",
    async (tx) => {
      const snapshot = await coverageSnapshot(tx, actor, workspaceId, target);
      await tx`SELECT pg_advisory_xact_lock(682051007)`;
      const [usage] = await tx<
        { total: number; daily: number; running: number; account: number }[]
      >`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS daily,
        count(*) FILTER (WHERE finished_at IS NULL AND started_at > now() - interval '2 minutes')::int AS running,
        (count(*) FILTER (WHERE actor_id = ${actor.userId}) +
          (SELECT count(*) FROM analysis_runs WHERE actor_id = ${actor.userId}))::int AS account
      FROM serv_coverage_attempts`;
      requireCondition(
        usage.running === 0,
        "RATE_LIMITED",
        "A coverage check is already running.",
      );
      requireCondition(
        usage.total < config.SERV_COVERAGE_ATTEMPT_LIMIT &&
          usage.daily < config.AI_DAILY_CALL_LIMIT &&
          // Visitors share the open-app account; the total and daily caps bound it instead.
          (isOpenAppAccount(actor.userId) ||
            usage.account < config.AI_ACCOUNT_TOTAL_CALL_LIMIT),
        "QUOTA_EXHAUSTED",
        "The coverage analysis allowance is exhausted.",
      );
      await tx`INSERT INTO serv_coverage_attempts (id, actor_id) VALUES (${attemptId}, ${actor.userId})`;
      return snapshot;
    },
  );

  try {
    const input = {
      passages: snapshot.passages,
      tasks: snapshot.tasks.map((task) => ({
        id: task.id,
        text: JSON.stringify(task),
      })),
      proposals: snapshot.proposals.map((item) => ({
        key: item.key,
        text: JSON.stringify(item),
      })),
    };
    const result = await classifyCoverage(
      input,
      { apiKey: config.SERV_API_KEY, model: "gpt-5.4-mini" },
      signal,
    );
    return await inWorkspace(actor, workspaceId, "write", async (tx) => {
      const current = await coverageSnapshot(tx, actor, workspaceId, target);
      requireCondition(
        current.fingerprint === snapshot.fingerprint,
        "CONFLICT",
        "This review changed during the coverage check. Refresh it before checking again.",
      );
      return {
        fingerprint: snapshot.fingerprint,
        entries: result.classifications.map((entry) => {
          const passage = snapshot.passages.find(
            ({ id }) => id === entry.passageId,
          );
          requireCondition(
            passage,
            "INVALID_OUTPUT",
            "SERV returned an unknown changed passage.",
          );
          const version =
            passage.side === "selected" ? snapshot.selected : snapshot.previous;
          return {
            ...entry,
            reason: nameTasks(entry.reason, snapshot.tasks),
            passage,
            versionId: version.id,
            versionNumber: version.number,
            sourceId: version.sourceId,
            taskTitles: snapshot.tasks
              .filter(({ id }) => entry.taskIds.includes(id))
              .map(({ title }) => title),
          };
        }),
      };
    });
  } catch (error) {
    const code = error instanceof DomainError ? error.code : "UNAVAILABLE";
    reportError(`serv-coverage-${code}`, error);
    throw error;
  } finally {
    try {
      await db()`UPDATE serv_coverage_attempts SET finished_at = now() WHERE id = ${attemptId}`;
    } catch (error) {
      reportError("serv-coverage-attempt", error);
    }
  }
}
