import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { Actor, FieldChange } from "@/domain/contracts";
import { requireCondition } from "@/domain/errors";
import type { Transaction } from "./db/client";
import { assertVisible } from "./auth/authorization";
import { batchVisibleTo } from "./auth/visibility";

export const json = (value: unknown): postgres.JSONValue =>
  JSON.parse(JSON.stringify(value));

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, canonical(value)]),
    );
  return value;
}

export const requestHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export type BatchResult = {
  batchId: string;
  taskIds: string[];
  count: number;
  verification: "verified" | "pending";
};
export type StoredBatch = {
  id: string;
  requestHash: string;
  restrictedTo: string | null;
  changes: FieldChange[];
  operation: string;
  result: BatchResult & {
    outcomes?: import("@/domain/contracts").UndoOutcome[];
  };
};

export async function existingOperation(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
  operation: string,
  operationKey: string,
  hash: string,
): Promise<StoredBatch | undefined> {
  const [batch] = await tx<
    StoredBatch[]
  >`SELECT id, request_hash AS "requestHash", restricted_to AS "restrictedTo", changes, operation, result FROM execution_batches WHERE workspace_id = ${workspaceId} AND actor_id = ${actor.userId} AND operation = ${operation} AND operation_key = ${operationKey}`;
  if (batch) {
    assertVisible(batch.restrictedTo, actor);
    requireCondition(
      batch.requestHash === hash,
      "CONFLICT",
      "This operation key was already used for a different request.",
    );
  }
  return batch;
}

export async function recordBatch(
  tx: Transaction,
  input: {
    id: string;
    actor: Actor;
    workspaceId: string;
    operation: "create" | "edit" | "apply" | "undo";
    operationKey: string;
    hash: string;
    restrictedTo: string | null;
    changes: FieldChange[];
    result: BatchResult;
    targetBatchId?: string;
    changeSetId?: string;
  },
) {
  await tx`INSERT INTO execution_batches (id, workspace_id, actor_id, operation, operation_key, request_hash, restricted_to, target_batch_id, change_set_id, changes, result) VALUES (${input.id}, ${input.workspaceId}, ${input.actor.userId}, ${input.operation}, ${input.operationKey}, ${input.hash}, ${input.restrictedTo}, ${input.targetBatchId ?? null}, ${input.changeSetId ?? null}, ${tx.json(json(input.changes))}, ${tx.json(json(input.result))})`;
  for (const change of input.changes)
    await tx`INSERT INTO change_events (id, workspace_id, batch_id, task_id, field, before_value, after_value, mutation_id) VALUES (${randomUUID()}, ${input.workspaceId}, ${input.id}, ${change.taskId}, ${change.field}, ${change.before}, ${change.after}, ${change.mutationId})`;
}

export async function listActivity(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
) {
  return tx<
    {
      id: string;
      operation: string;
      actorName: string;
      createdAt: string;
      result: StoredBatch["result"];
      changes: FieldChange[];
      targetBatchId: string | null;
      changeSetId: string | null;
    }[]
  >`SELECT b.id, b.operation, u.name AS "actorName", b.created_at::text AS "createdAt", b.result, b.changes, b.target_batch_id AS "targetBatchId", b.change_set_id AS "changeSetId" FROM execution_batches b JOIN users u ON u.id = b.actor_id WHERE b.workspace_id = ${workspaceId} AND ${batchVisibleTo(actor)} ORDER BY b.created_at DESC LIMIT 200`;
}
