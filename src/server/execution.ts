import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  applyCommand,
  applyInput,
  type Actor,
  type FieldChange,
} from "@/domain/contracts";
import { requireCondition } from "@/domain/errors";
import { validateAnalysis } from "@/domain/reconciliation/validate";
import { assertVisible, inWorkspace } from "./auth/authorization";
import { draftRecord, taskRecord } from "./db/records";
import {
  existingOperation,
  recordBatch,
  requestHash,
  type BatchResult,
  type StoredBatch,
} from "./journal";
import { proposalContext } from "./reconciliation";
import { insertTask, mutateField } from "./tasks";

function creationId(changeSetId: string, itemKey: string): string {
  const hex = createHash("sha256")
    .update(`${changeSetId}:${itemKey}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function applyProposal(
  actor: Actor,
  workspaceId: string,
  raw: unknown,
  operationKey: string,
): Promise<BatchResult> {
  const command = applyCommand.parse(raw);
  const input = applyInput.parse({ ...command, operationKey });
  const hash = requestHash({
    ...input,
    selectedKeys: [...input.selectedKeys].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  });
  return inWorkspace(actor, workspaceId, "write", async (tx) => {
    const prior = await existingOperation(
      tx,
      actor,
      workspaceId,
      "apply",
      input.operationKey,
      hash,
    );
    if (prior) return prior.result;
    const draft = await draftRecord(tx, workspaceId, input.changeSetId);
    requireCondition(draft, "NOT_FOUND", "Change set not found.");
    assertVisible(draft.restrictedTo, actor);
    requireCondition(
      draft.state === "draft" && draft.revision === input.expectedRevision,
      "CONFLICT",
      "This proposal has changed or was already applied. Inspect its history.",
    );
    const selected = input.selectedKeys.map((key) => {
      const item = draft.items.find((item) => item.key === key);
      requireCondition(
        item,
        "INVALID_INPUT",
        "Selected item is not part of this proposal.",
      );
      return item;
    });
    const targetIds = [
      ...new Set(
        selected.flatMap((item) =>
          item.kind === "update" ? [item.taskId] : [],
        ),
      ),
    ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    const context = await proposalContext(
      tx,
      actor,
      workspaceId,
      draft.sourceVersionId,
      targetIds,
    );
    const [latest] = await tx<
      { id: string }[]
    >`SELECT id FROM source_versions WHERE workspace_id = ${workspaceId} AND source_id = ${context.source.sourceId} ORDER BY number DESC LIMIT 1`;
    requireCondition(
      latest.id === draft.sourceVersionId,
      "CONFLICT",
      "This source was explicitly revised again. Analyze the latest revision before applying work.",
    );
    // The workspace lock serializes every supported mutation and membership change.
    if (targetIds.length)
      await tx`SELECT id FROM tasks WHERE workspace_id = ${workspaceId} AND id IN ${tx(targetIds)} ORDER BY id FOR UPDATE`;
    validateAnalysis(
      {
        items: selected.map((item) => {
          const value = { ...item };
          delete value.editedBy;
          return value;
        }),
        questions: draft.questions,
        preserved: draft.preserved,
      },
      { ...context, currentVersionId: context.source.id },
    );
    const batchId = randomUUID();
    const changes: FieldChange[] = [];
    const tasks = new Map(context.tasks.map((task) => [task.id, task]));
    for (const item of selected) {
      let taskId: string | undefined;
      if (item.kind === "create") {
        taskId = creationId(draft.id, item.key);
        changes.push(
          await insertTask(tx, {
            workspaceId,
            taskId,
            title: item.title,
            fields: item.fields,
            restrictedTo: draft.restrictedTo,
            mutationId: batchId,
          }),
        );
      } else if (item.kind === "update") {
        const task = tasks.get(item.taskId);
        requireCondition(
          task && task.restrictedTo === draft.restrictedTo,
          "INVALID_INPUT",
          "Task and source visibility differ.",
        );
        taskId = task.id;
        changes.push(
          await mutateField(tx, task, item.field, item.value, batchId),
        );
      } else {
        await tx`INSERT INTO decisions (workspace_id, source_version_id, restricted_to, statement, citations, needs_review) VALUES (${workspaceId}, ${draft.sourceVersionId}, ${draft.restrictedTo}, ${item.statement}, ${tx.json(JSON.parse(JSON.stringify(item.citations)))}, ${item.needsReview})`;
      }
      if (taskId)
        for (const citation of item.citations)
          await tx`INSERT INTO task_evidence (workspace_id, task_id, source_version_id, start_offset, end_offset, quote) SELECT ${workspaceId}, ${taskId}, ${citation.sourceVersionId}, ${citation.start}, ${citation.end}, ${citation.quote} WHERE NOT EXISTS (SELECT 1 FROM task_evidence WHERE workspace_id = ${workspaceId} AND task_id = ${taskId} AND source_version_id = ${citation.sourceVersionId} AND start_offset = ${citation.start} AND end_offset = ${citation.end})`;
    }
    const result: BatchResult = {
      batchId,
      taskIds: [...new Set(changes.map((change) => change.taskId))],
      count: selected.length,
      verification: "pending",
    };
    await recordBatch(tx, {
      id: batchId,
      actor,
      workspaceId,
      operation: "apply",
      operationKey: input.operationKey,
      hash,
      restrictedTo: draft.restrictedTo,
      changeSetId: draft.id,
      changes,
      result,
    });
    await tx`UPDATE change_sets SET state = 'applied', revision = revision + 1 WHERE workspace_id = ${workspaceId} AND id = ${draft.id}`;
    return result;
  });
}

export async function verifyBatch(
  actor: Actor,
  workspaceId: string,
  batchId: string,
) {
  return inWorkspace(actor, workspaceId, "read", async (tx) => {
    const [batch] = await tx<
      StoredBatch[]
    >`SELECT id, restricted_to AS "restrictedTo", request_hash AS "requestHash", operation, changes, result FROM execution_batches WHERE workspace_id = ${workspaceId} AND id = ${batchId}`;
    requireCondition(
      batch,
      "NOT_FOUND",
      "Operation not found. Retain the original operation key when retrying.",
    );
    assertVisible(batch.restrictedTo, actor);
    let laterEdits = false;
    for (const change of batch.changes) {
      const task = await taskRecord(tx, workspaceId, change.taskId);
      requireCondition(
        task,
        "UNAVAILABLE",
        "Committed task could not be read back. Inspect this operation again.",
      );
      assertVisible(task.restrictedTo, actor);
      const [event] =
        await tx`SELECT id FROM change_events WHERE workspace_id = ${workspaceId} AND batch_id = ${batchId} AND task_id = ${task.id} AND mutation_id = ${change.mutationId} AND field = ${change.field}`;
      requireCondition(
        event,
        "UNAVAILABLE",
        "Committed history could not be verified. Inspect this operation again.",
      );
      if (change.field === "created") {
        if (task.lineage.created === change.mutationId)
          requireCondition(
            change.after === null
              ? task.archived
              : task.title === change.after && !task.archived,
            "UNAVAILABLE",
            "The committed task creation or archive could not be verified.",
          );
        else laterEdits = true;
      } else {
        if (task.lineage[change.field] === change.mutationId)
          requireCondition(
            task[change.field] === change.after,
            "UNAVAILABLE",
            "Persisted task value did not match the committed write.",
          );
        else laterEdits = true;
      }
    }
    return { ...batch.result, verification: "verified" as const, laterEdits };
  });
}

export async function lookupOperation(
  actor: Actor,
  workspaceId: string,
  operation: string,
  key: string,
) {
  const batchId = await inWorkspace(actor, workspaceId, "read", async (tx) => {
    const [batch] = await tx<
      { id: string; restricted_to: string | null }[]
    >`SELECT id, restricted_to FROM execution_batches WHERE workspace_id = ${workspaceId} AND actor_id = ${actor.userId} AND operation = ${operation} AND operation_key = ${key}`;
    requireCondition(
      batch,
      "NOT_FOUND",
      "No committed result is visible yet. Retry the original request with the same key.",
    );
    assertVisible(batch.restricted_to, actor);
    return batch.id;
  });
  return verifyBatch(actor, workspaceId, batchId);
}

export async function writeAndAttemptVerification(
  actor: Actor,
  workspaceId: string,
  write: () => Promise<BatchResult>,
) {
  const result = await write();
  try {
    return await verifyBatch(actor, workspaceId, result.batchId);
  } catch {
    return { ...result, verification: "pending" as const };
  }
}
