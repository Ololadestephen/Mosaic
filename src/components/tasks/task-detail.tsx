"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { editTaskInput, type Task } from "@/domain/contracts";
import { PASSAGE_REVIEW_LABEL } from "@/domain/sources/passage-change";
import type { TaskDetail } from "@/client/types";
import { editTask, loadTask } from "@/client/commands";
import { Dialog } from "../dialog";
import { TaskFields, type Members } from "./task-board";
import { Arrow } from "../icons";

export function TaskDetailPanel({
  workspaceId,
  taskId,
  members,
  canEdit,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  taskId: string;
  members: Members;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    loadTask(workspaceId, taskId)
      .then((task) => {
        if (active) setTask(task);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, taskId, loadAttempt]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task) return;
    const form = new FormData(event.currentTarget);
    const changes = Object.fromEntries(
      (["status", "assigneeId", "dueDate"] as const)
        .map((field) => [field, form.get(field) || null])
        .filter(([field, value]) => task[field as keyof Task] !== value),
    );
    if (!Object.keys(changes).length) return;
    setBusy(true);
    setError("");
    try {
      await editTask(
        workspaceId,
        taskId,
        editTaskInput.parse({ ...changes, expectedRevision: task.revision }),
        crypto.randomUUID(),
      );
      setTask(await loadTask(workspaceId, taskId));
      await onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save task.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={task?.title ?? "Task detail"} onClose={onClose} wide>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {task ? (
        <>
          <p className="eyebrow">
            Revision {task.revision}
            {task.restrictedTo && " · Private"}
          </p>
          <form onSubmit={submit} key={task.revision}>
            <fieldset
              disabled={!canEdit || busy || task.archived}
              className="field-grid"
            >
              <TaskFields task={task} members={members} />
            </fieldset>
            {canEdit && !task.archived && (
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            )}
          </form>
          <section className="detail-section">
            <h3>Source</h3>
            {task.evidence.length ? (
              task.evidence.map((evidence, index) => (
                <blockquote key={index}>
                  <p>{evidence.quote}</p>
                  {evidence.passageChange && (
                    <p className="passage-review">
                      {PASSAGE_REVIEW_LABEL}
                      {evidence.laterVersionNumber
                        ? ` · version ${evidence.laterVersionNumber}`
                        : ""}
                      .{" "}
                      {evidence.passageChange === "removed"
                        ? "The cited passage was removed."
                        : "The cited passage was edited."}{" "}
                      The task itself is unchanged.
                    </p>
                  )}
                  <cite>
                    <Link
                      href={`/app/sources/${evidence.sourceId}?version=${evidence.sourceVersionId}&start=${evidence.start}&end=${evidence.end}`}
                    >
                      {evidence.sourceTitle} · v{evidence.version} <Arrow />
                    </Link>
                  </cite>
                </blockquote>
              ))
            ) : (
              <p className="muted">Added manually. No source evidence.</p>
            )}
          </section>
          <section className="detail-section">
            <h3>History</h3>
            {task.history.map((event, index) => (
              <div className="history-row" key={index}>
                <b>{event.actorName}</b>
                <span>
                  {event.operation === "create"
                    ? "created this task"
                    : `${event.operation}: ${event.field} · ${event.before ?? "—"} → ${event.after ?? "—"}`}
                </span>
                <small>{new Date(event.createdAt).toLocaleString()}</small>
              </div>
            ))}
          </section>
        </>
      ) : error ? (
        <button
          onClick={() => {
            setError("");
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          Retry task
        </button>
      ) : (
        <p role="status">Loading task…</p>
      )}
    </Dialog>
  );
}
