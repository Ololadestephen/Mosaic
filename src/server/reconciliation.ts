import "server-only";
import { randomUUID } from "node:crypto";
import {
  type Actor,
  type FieldChange,
  type SourceVersion,
  type Task,
  editDraftInput,
} from "@/domain/contracts";
import { requireCondition } from "@/domain/errors";
import {
  validateAnalysis,
  validateField,
} from "@/domain/reconciliation/validate";
import { assertVisible, inWorkspace } from "./auth/authorization";
import { sourceVisibleTo } from "./auth/visibility";
import { draftRecord } from "./db/records";
import type { Transaction } from "./db/client";
import { json } from "./journal";
import { memberIds } from "./tasks";

export type AnalysisContext = {
  source: SourceVersion;
  versions: SourceVersion[];
  tasks: Task[];
  memberIds: string[];
  members: { id: string; name: string }[];
  restrictedTo: string | null;
};

export async function analysisContext(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
  versionId: string,
): Promise<AnalysisContext> {
  const [source] = await tx<
    (SourceVersion & { visibility: string; ownerId: string })[]
  >`SELECT v.id, v.source_id AS "sourceId", v.text, v.number, v.predecessor_id AS "predecessorId", s.visibility, s.owner_id AS "ownerId" FROM source_versions v JOIN sources s ON s.workspace_id = v.workspace_id AND s.id = v.source_id WHERE v.workspace_id = ${workspaceId} AND v.id = ${versionId} AND ${sourceVisibleTo(actor)}`;
  requireCondition(source, "NOT_FOUND", "Source revision not found.");
  const restrictedTo = source.visibility === "private" ? source.ownerId : null;
  // Contexts of different visibility never mix. A private source cannot rewrite a shared task.
  const tasks = await tx<
    Task[]
  >`SELECT id, workspace_id AS "workspaceId", title, status, assignee_id AS "assigneeId", due_date::text AS "dueDate", revision, lineage, archived, restricted_to AS "restrictedTo" FROM tasks WHERE workspace_id = ${workspaceId} AND archived = false AND restricted_to IS NOT DISTINCT FROM ${restrictedTo}::uuid ORDER BY id LIMIT 151`;
  requireCondition(
    tasks.length <= 150,
    "INVALID_INPUT",
    "This source context exceeds the initial 150-task analysis limit.",
  );
  const members = await tx<
    { id: string; name: string }[]
  >`SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ${workspaceId} ORDER BY u.id`;
  const versions = await tx<
    SourceVersion[]
  >`SELECT id, source_id AS "sourceId", text, number, predecessor_id AS "predecessorId" FROM source_versions WHERE workspace_id = ${workspaceId} AND source_id = ${source.sourceId} AND (id = ${versionId} OR id = ${source.predecessorId})`;
  return {
    source,
    versions,
    tasks,
    members,
    memberIds: members.map((member) => member.id),
    restrictedTo,
  };
}

export async function saveProposal(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
  context: AnalysisContext,
  raw: unknown,
) {
  const output = validateAnalysis(raw, {
    ...context,
    currentVersionId: context.source.id,
  });
  // Check the snapshot again at persistence. Later edits are also checked at application.
  for (const item of output.items) {
    if (item.kind !== "update") continue;
    const [current] = await tx<
      { revision: number }[]
    >`SELECT revision FROM tasks WHERE workspace_id = ${workspaceId} AND id = ${item.taskId}`;
    requireCondition(
      current?.revision === item.expectedRevision,
      "CONFLICT",
      "A task changed during analysis. Review the latest work and try again.",
    );
  }
  const id = randomUUID();
  await tx`INSERT INTO change_sets (id, workspace_id, source_version_id, created_by, restricted_to, items, questions, preserved) VALUES (${id}, ${workspaceId}, ${context.source.id}, ${actor.userId}, ${context.restrictedTo}, ${tx.json(json(output.items))}, ${tx.json(json(output.questions))}, ${tx.json(json(output.preserved))})`;
  return { id };
}

export async function getProposal(
  actor: Actor,
  workspaceId: string,
  changeSetId: string,
) {
  return inWorkspace(actor, workspaceId, "read", async (tx) => {
    const draft = await draftRecord(tx, workspaceId, changeSetId);
    requireCondition(draft, "NOT_FOUND", "Change set not found.");
    assertVisible(draft.restrictedTo, actor);
    const context = await analysisContext(
      tx,
      actor,
      workspaceId,
      draft.sourceVersionId,
    );
    const [applied] = await tx<
      { changes: FieldChange[] }[]
    >`SELECT changes FROM execution_batches WHERE workspace_id = ${workspaceId} AND change_set_id = ${changeSetId} AND operation = 'apply' ORDER BY created_at DESC LIMIT 1`;
    const analyses = await tx<
      { provider: "gemini" | "openrouter"; model: string }[]
    >`SELECT provider, model FROM analysis_runs WHERE workspace_id = ${workspaceId} AND source_version_id = ${draft.sourceVersionId} AND status = 'completed' ORDER BY started_at DESC LIMIT 1`;
    return {
      ...draft,
      tasks: context.tasks,
      versions: context.versions,
      members: context.members,
      receipt: applied?.changes ?? [],
      analysis: analyses.at(0) ?? null,
    };
  });
}

export async function editProposal(
  actor: Actor,
  workspaceId: string,
  changeSetId: string,
  raw: unknown,
) {
  const input = editDraftInput.parse(raw);
  return inWorkspace(actor, workspaceId, "write", async (tx) => {
    const draft = await draftRecord(tx, workspaceId, changeSetId);
    requireCondition(draft, "NOT_FOUND", "Change set not found.");
    assertVisible(draft.restrictedTo, actor);
    requireCondition(
      draft.state === "draft" && draft.revision === input.expectedRevision,
      "CONFLICT",
      "The proposal changed. Refresh before editing.",
    );
    const item = draft.items.find((item) => item.key === input.key);
    requireCondition(
      item?.kind === "update",
      "INVALID_INPUT",
      "Only proposed field updates can be edited.",
    );
    validateField(item.field, input.value, await memberIds(tx, workspaceId));
    item.value = input.value;
    item.editedBy = actor.userId;
    await tx`UPDATE change_sets SET items = ${tx.json(json(draft.items))}, revision = revision + 1 WHERE workspace_id = ${workspaceId} AND id = ${changeSetId}`;
    return { revision: draft.revision + 1 };
  });
}
