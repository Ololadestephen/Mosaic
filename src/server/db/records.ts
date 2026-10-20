import type { Task, ChangeSet } from "@/domain/contracts";
import type { Transaction } from "./client";

export async function taskRecord(
  tx: Transaction,
  workspaceId: string,
  taskId: string,
): Promise<Task | undefined> {
  const [task] = await tx<
    Task[]
  >`SELECT id, workspace_id AS "workspaceId", title, status, assignee_id AS "assigneeId", due_date::text AS "dueDate", revision, restricted_to AS "restrictedTo", archived, lineage FROM tasks WHERE workspace_id = ${workspaceId} AND id = ${taskId}`;
  return task;
}

export async function draftRecord(
  tx: Transaction,
  workspaceId: string,
  changeSetId: string,
): Promise<ChangeSet | undefined> {
  const [draft] = await tx<
    ChangeSet[]
  >`SELECT id, workspace_id AS "workspaceId", source_version_id AS "sourceVersionId", restricted_to AS "restrictedTo", revision, state, items, questions, preserved FROM change_sets WHERE workspace_id = ${workspaceId} AND id = ${changeSetId}`;
  return draft;
}
