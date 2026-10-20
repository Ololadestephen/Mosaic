import "server-only";
import { randomUUID } from "node:crypto";
import {
  createTaskInput,
  editTaskInput,
  type Actor,
  type Field,
  type FieldChange,
  type Task,
  type TaskFields,
} from "@/domain/contracts";
import { requireCondition } from "@/domain/errors";
import { validateField } from "@/domain/reconciliation/validate";
import { assertVisible, inWorkspace } from "./auth/authorization";
import {
  batchVisibleTo,
  recordVisibleTo,
  sourceVisibleTo,
} from "./auth/visibility";
import type { Transaction } from "./db/client";
import { taskRecord } from "./db/records";
import {
  existingOperation,
  json,
  recordBatch,
  requestHash,
  type BatchResult,
} from "./journal";
import { listPassageReviews } from "./passage-signals";

const columns: Record<Field, "status" | "assignee_id" | "due_date"> = {
  status: "status",
  assigneeId: "assignee_id",
  dueDate: "due_date",
};

export async function memberIds(
  tx: Transaction,
  workspaceId: string,
): Promise<Set<string>> {
  const members = await tx<
    { user_id: string }[]
  >`SELECT user_id FROM memberships WHERE workspace_id = ${workspaceId}`;
  return new Set(members.map((member) => member.user_id));
}

export async function insertTask(
  tx: Transaction,
  input: {
    workspaceId: string;
    title: string;
    fields: TaskFields;
    restrictedTo: string | null;
    mutationId: string;
    taskId?: string;
  },
): Promise<FieldChange> {
  const taskId = input.taskId ?? randomUUID();
  await tx`INSERT INTO tasks (id, workspace_id, title, status, assignee_id, due_date, restricted_to, lineage) VALUES (${taskId}, ${input.workspaceId}, ${input.title}, ${input.fields.status}, ${input.fields.assigneeId}, ${input.fields.dueDate}, ${input.restrictedTo}, ${tx.json({ created: input.mutationId, status: input.mutationId, assigneeId: input.mutationId, dueDate: input.mutationId })})`;
  return {
    taskId,
    field: "created",
    before: null,
    after: input.title,
    mutationId: input.mutationId,
  };
}

export async function mutateField(
  tx: Transaction,
  task: Task,
  field: Field,
  value: string | null,
  mutationId: string,
): Promise<FieldChange> {
  const change = {
    taskId: task.id,
    field,
    before: task[field],
    after: value,
    mutationId,
  };
  const lineage = { ...task.lineage, [field]: mutationId };
  await tx`UPDATE tasks SET ${tx(columns[field])} = ${value}, lineage = ${tx.json(json(lineage))}, revision = revision + 1, updated_at = now() WHERE workspace_id = ${task.workspaceId} AND id = ${task.id}`;
  task.lineage = lineage;
  return change;
}

export async function listTasks(actor: Actor, workspaceId: string) {
  return inWorkspace(
    actor,
    workspaceId,
    "read",
    async (tx) =>
      tx<
        Task[]
      >`SELECT id, workspace_id AS "workspaceId", title, status, assignee_id AS "assigneeId", due_date::text AS "dueDate", restricted_to AS "restrictedTo", revision, lineage, archived FROM tasks WHERE workspace_id = ${workspaceId} AND archived = false AND ${recordVisibleTo(actor)} ORDER BY created_at`,
  );
}

export async function getTask(
  actor: Actor,
  workspaceId: string,
  taskId: string,
) {
  return inWorkspace(actor, workspaceId, "read", async (tx) => {
    const task = await taskRecord(tx, workspaceId, taskId);
    requireCondition(task, "NOT_FOUND", "Task not found.");
    assertVisible(task.restrictedTo, actor);
    const evidence = await tx<
      {
        sourceId: string;
        sourceTitle: string;
        version: number;
        sourceVersionId: string;
        start: number;
        end: number;
        quote: string;
      }[]
    >`SELECT s.id AS "sourceId", s.title AS "sourceTitle", v.number AS version, v.id AS "sourceVersionId", e.start_offset AS start, e.end_offset AS end, e.quote FROM task_evidence e JOIN source_versions v ON v.id = e.source_version_id AND v.workspace_id = e.workspace_id JOIN sources s ON s.id = v.source_id AND s.workspace_id = v.workspace_id WHERE e.workspace_id = ${workspaceId} AND e.task_id = ${taskId} AND ${sourceVisibleTo(actor)} ORDER BY e.created_at`;
    const history = await tx<
      {
        field: string;
        before: string | null;
        after: string | null;
        actorName: string;
        operation: string;
        createdAt: string;
      }[]
    >`SELECT e.field, e.before_value AS before, e.after_value AS after, u.name AS "actorName", b.operation, e.created_at::text AS "createdAt" FROM change_events e JOIN execution_batches b ON b.id = e.batch_id AND b.workspace_id = e.workspace_id JOIN users u ON u.id = b.actor_id WHERE e.workspace_id = ${workspaceId} AND e.task_id = ${taskId} AND ${batchVisibleTo(actor)} ORDER BY e.created_at DESC`;
    const reviews = await listPassageReviews(tx, actor, workspaceId, {
      taskId,
    });
    return {
      ...task,
      evidence: evidence.map((item) => {
        const review = reviews.find(
          (review) =>
            review.citedVersionId === item.sourceVersionId &&
            review.start === Number(item.start) &&
            review.end === Number(item.end),
        );
        return {
          ...item,
          passageChange: review?.change ?? null,
          laterVersionNumber: review?.laterNumber ?? null,
        };
      }),
      history,
    };
  });
}

export async function createTask(
  actor: Actor,
  workspaceId: string,
  raw: unknown,
  operationKey: string,
): Promise<BatchResult> {
  const input = createTaskInput.parse(raw);
  const hash = requestHash(input);
  return inWorkspace(actor, workspaceId, "write", async (tx) => {
    const prior = await existingOperation(
      tx,
      actor,
      workspaceId,
      "create",
      operationKey,
      hash,
    );
    if (prior) return prior.result;
    const members = await memberIds(tx, workspaceId);
    for (const [field, value] of Object.entries({
      status: input.status,
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
    }))
      validateField(field, value, members);
    const batchId = randomUUID();
    const restrictedTo = input.visibility === "private" ? actor.userId : null;
    const change = await insertTask(tx, {
      workspaceId,
      title: input.title,
      fields: input,
      restrictedTo,
      mutationId: batchId,
    });
    const result: BatchResult = {
      batchId,
      taskIds: [change.taskId],
      count: 1,
      verification: "pending",
    };
    await recordBatch(tx, {
      id: batchId,
      actor,
      workspaceId,
      operation: "create",
      operationKey,
      hash,
      restrictedTo,
      changes: [change],
      result,
    });
    return result;
  });
}

export async function editTask(
  actor: Actor,
  workspaceId: string,
  taskId: string,
  raw: unknown,
  operationKey: string,
): Promise<BatchResult> {
  const input = editTaskInput.parse(raw);
  const hash = requestHash({ taskId, ...input });
  return inWorkspace(actor, workspaceId, "write", async (tx) => {
    const prior = await existingOperation(
      tx,
      actor,
      workspaceId,
      "edit",
      operationKey,
      hash,
    );
    if (prior) return prior.result;
    const task = await taskRecord(tx, workspaceId, taskId);
    requireCondition(task && !task.archived, "NOT_FOUND", "Task not found.");
    assertVisible(task.restrictedTo, actor);
    requireCondition(
      task.revision === input.expectedRevision,
      "CONFLICT",
      "A teammate changed this task. Refresh before editing it.",
    );
    const members = await memberIds(tx, workspaceId);
    const batchId = randomUUID();
    const changes: FieldChange[] = [];
    for (const field of ["status", "assigneeId", "dueDate"] as const) {
      const value = input[field];
      if (value === undefined) continue;
      validateField(field, value, members);
      // An explicit same-value write still advances lineage and protects human intent.
      changes.push(await mutateField(tx, task, field, value, batchId));
    }
    const result: BatchResult = {
      batchId,
      taskIds: [taskId],
      count: changes.length,
      verification: "pending",
    };
    await recordBatch(tx, {
      id: batchId,
      actor,
      workspaceId,
      operation: "edit",
      operationKey,
      hash,
      restrictedTo: task.restrictedTo,
      changes,
      result,
    });
    return result;
  });
}
