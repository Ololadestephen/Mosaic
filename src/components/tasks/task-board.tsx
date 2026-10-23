"use client";

import { useState } from "react";
import Link from "next/link";
import { createTaskInput, type Task } from "@/domain/contracts";
import { PASSAGE_REVIEW_LABEL } from "@/domain/sources/passage-change";
import type { WorkspaceData } from "@/client/types";
import { createTask } from "@/client/commands";
import { Dialog } from "../dialog";

export const statusLabels = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};
function dateLabel(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${value}T12:00:00Z`))
    : "No date";
}
export type Members = WorkspaceData["members"];

export function TaskFields({
  task,
  members,
}: {
  task?: Task;
  members: Members;
}) {
  return (
    <>
      <label>
        Status
        <select name="status" defaultValue={task?.status ?? "todo"}>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Assignee
        <select name="assigneeId" defaultValue={task?.assigneeId ?? ""}>
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input name="dueDate" type="date" defaultValue={task?.dueDate ?? ""} />
        <small>Date only · displayed without timezone conversion</small>
      </label>
    </>
  );
}

export function TaskBoard({
  tasks,
  members,
  query,
  reviewTaskIds,
}: {
  tasks: Task[];
  members: Members;
  query: string;
  reviewTaskIds: string[];
}) {
  const filtered = tasks.filter((task) =>
    task.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="board">
      {(Object.keys(statusLabels) as Task["status"][]).map((status) => (
        <section className="board-column" key={status}>
          <h2>
            <span className={`status-dot ${status}`} aria-hidden="true" />
            {statusLabels[status]}
            <span className="count">
              {filtered.filter((task) => task.status === status).length}
            </span>
          </h2>
          <div className="task-stack">
            {filtered
              .filter((task) => task.status === status)
              .map((task) => (
                <article className="task-card" key={task.id}>
                  <p className="task-overline">
                    {task.restrictedTo ? "Private work" : "Workspace task"}
                    <span>↗</span>
                  </p>
                  <h3>
                    <Link href={`/app/tasks/${task.id}`}>{task.title}</Link>
                  </h3>
                  {reviewTaskIds.includes(task.id) && (
                    <p className="passage-review">{PASSAGE_REVIEW_LABEL}</p>
                  )}
                  <div className="task-meta">
                    <span className="avatar small">
                      {members
                        .find((member) => member.id === task.assigneeId)
                        ?.name.slice(0, 1) ?? "—"}
                    </span>
                    <span>
                      {members.find((member) => member.id === task.assigneeId)
                        ?.name ?? "Unassigned"}
                    </span>
                    <time dateTime={task.dueDate ?? undefined}>
                      {dateLabel(task.dueDate)}
                    </time>
                  </div>
                  <Link className="why-link" href={`/app/tasks/${task.id}`}>
                    Why this work? <span aria-hidden="true">↗</span>
                  </Link>
                </article>
              ))}
            <p className="column-empty">
              {filtered.some((task) => task.status === status)
                ? ""
                : "Room for what comes next."}
            </p>
          </div>
        </section>
      ))}
    </div>
  );
}

export function NewTask({
  workspaceId,
  members,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  members: Members;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const [committed, setCommitted] = useState(false);
  async function refreshSaved() {
    setBusy(true);
    setError("");
    try {
      await onSaved();
      onClose();
    } catch {
      setError(
        "Task created. The board could not refresh; retry loading it without creating another task.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await createTask(
        workspaceId,
        createTaskInput.parse({
          title: form.get("title"),
          status: form.get("status"),
          assigneeId: form.get("assigneeId") || null,
          dueDate: form.get("dueDate") || null,
          visibility: form.get("visibility"),
        }),
        key,
      );
      setCommitted(true);
      await refreshSaved();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not create task.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Add a task" onClose={onClose}>
      <p className="muted">
        A manual task, attributed to you. To create source-backed work, add a
        brief and review its proposals.
      </p>
      {committed ? (
        <div>
          <p role="status">Task created.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy} onClick={refreshSaved}>
            Refresh saved task
          </button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <label>
            Task title
            <input name="title" required maxLength={180} />
          </label>
          <TaskFields members={members} />
          <label>
            Visibility
            <select name="visibility">
              <option value="workspace">Workspace</option>
              <option value="private">Only me</option>
            </select>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Create task"}
          </button>
        </form>
      )}
    </Dialog>
  );
}
