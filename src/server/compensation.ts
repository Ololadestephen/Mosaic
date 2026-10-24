import "server-only";
import { randomUUID } from "node:crypto";
import {
  undoInput,
  undoCommand,
  type Actor,
  type FieldChange,
  type UndoOutcome,
} from "@/domain/contracts";
import { requireCondition } from "@/domain/errors";
import { assertVisible, inWorkspace } from "./auth/authorization";
import type { Transaction } from "./db/client";
import { taskRecord } from "./db/records";
import {
  existingOperation,
  recordBatch,
  requestHash,
  type BatchResult,
  type StoredBatch,
} from "./journal";
import { mutateField } from "./tasks";

async function targetBatch(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
  batchId: string,
) {
  const [batch] = await tx<
    StoredBatch[]
  >`SELECT id, restricted_to AS "restrictedTo", request_hash AS "requestHash", operation, changes, result FROM execution_batches WHERE workspace_id = ${workspaceId} AND id = ${batchId}`;
  requireCondition(batch, "NOT_FOUND", "Batch not found.");
  assertVisible(batch.restrictedTo, actor);
  requireCondition(
    ["apply", "edit", "create"].includes(batch.operation),
    "INVALID_INPUT",
    "Undo of an undo is not supported.",
  );
  requireCondition(
    batch.changes.length > 0,
    "INVALID_INPUT",
    "This batch has no reversible task fields. Decisions remain in history.",
  );
  return batch;
}

async function eligibility(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
  changes: FieldChange[],
): Promise<UndoOutcome[]> {
  const outcomes: UndoOutcome[] = [];
  for (const change of changes) {
    const task = await taskRecord(tx, workspaceId, change.taskId);
    requireCondition(task, "NOT_FOUND", "Task not found.");
    assertVisible(task.restrictedTo, actor);
    const eligible =
      change.field === "created"
        ? !task.archived &&
          task.revision === 1 &&
          task.lineage.created === change.mutationId
        : !task.archived && task.lineage[change.field] === change.mutationId;
    outcomes.push({
      taskId: task.id,
      field: change.field,
      outcome: eligible ? "restored" : "conflict",
      detail: eligible
        ? change.field === "created"
          ? "Task will be archived; evidence and history stay available."
          : "Original field lineage is intact."
        : "A later edit or archive protects this work. It will be preserved.",
    });
  }
  return outcomes;
}

export async function previewCompensation(
  actor: Actor,
  workspaceId: string,
  batchId: string,
) {
  return inWorkspace(actor, workspaceId, "read", async (tx) => {
    const batch = await targetBatch(tx, actor, workspaceId, batchId);
    const [previous] = await tx<
      { result: StoredBatch["result"] }[]
    >`SELECT result FROM execution_batches WHERE workspace_id = ${workspaceId} AND target_batch_id = ${batchId} AND operation = 'undo'`;
    if (previous)
      return { alreadyUndone: true, outcomes: previous.result.outcomes ?? [] };
    return {
      alreadyUndone: false,
      outcomes: await eligibility(tx, actor, workspaceId, batch.changes),
    };
  });
}

export async function compensate(
  actor: Actor,
  workspaceId: string,
  raw: unknown,
  operationKey: string,
): Promise<BatchResult & { outcomes: UndoOutcome[] }> {
  const command = undoCommand.parse(raw);
  const input = undoInput.parse({ ...command, operationKey });
  const hash = requestHash(input);
  return inWorkspace(actor, workspaceId, "write", async (tx) => {
    const prior = await existingOperation(
      tx,
      actor,
      workspaceId,
      "undo",
      input.operationKey,
      hash,
    );
    if (prior)
      return { ...prior.result, outcomes: prior.result.outcomes ?? [] };
    const batch = await targetBatch(tx, actor, workspaceId, input.batchId);
    const [previous] = await tx<
      { result: BatchResult & { outcomes: UndoOutcome[] } }[]
    >`SELECT result FROM execution_batches WHERE workspace_id = ${workspaceId} AND target_batch_id = ${input.batchId} AND operation = 'undo'`;
    if (previous) return previous.result;
    const ids = [...new Set(batch.changes.map((change) => change.taskId))].sort(
      (left, right) => (left < right ? -1 : left > right ? 1 : 0),
    );
    await tx`SELECT id FROM tasks WHERE workspace_id = ${workspaceId} AND id IN ${tx(ids)} ORDER BY id FOR UPDATE`;
    const outcomes = await eligibility(tx, actor, workspaceId, batch.changes);
    const batchId = randomUUID();
    const changes: FieldChange[] = [];
    for (let index = 0; index < batch.changes.length; index++) {
      if (outcomes[index].outcome !== "restored") continue;
      const change = batch.changes[index];
      const task = await taskRecord(tx, workspaceId, change.taskId);
      requireCondition(task, "NOT_FOUND", "Task not found.");
      if (change.field === "created") {
        await tx`UPDATE tasks SET archived = true, revision = revision + 1, updated_at = now(), lineage = lineage || ${tx.json({ created: batchId })} WHERE workspace_id = ${workspaceId} AND id = ${task.id}`;
        changes.push({
          taskId: task.id,
          field: "created",
          before: task.title,
          after: null,
          mutationId: batchId,
        });
      } else
        changes.push(
          await mutateField(tx, task, change.field, change.before, batchId),
        );
    }
    const result = {
      batchId,
      taskIds: [...new Set(changes.map((change) => change.taskId))],
      count: changes.length,
      verification: "pending" as const,
      outcomes,
    };
    await recordBatch(tx, {
      id: batchId,
      actor,
      workspaceId,
      operation: "undo",
      operationKey: input.operationKey,
      hash,
      restrictedTo: batch.restrictedTo,
      targetBatchId: input.batchId,
      changes,
      result,
    });
    return result;
  });
}
