"use client";

import Link from "next/link";
import { useState } from "react";
import type { BatchResult, UndoPreview, WorkspaceData } from "@/client/types";
import { Dialog } from "./dialog";
import { previewUndo, undoBatch } from "@/client/commands";

export function Activity({
  workspaceId,
  batches,
  canEdit,
  onSaved,
}: {
  workspaceId: string;
  batches: WorkspaceData["activity"];
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [preview, setPreview] = useState<UndoPreview | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState("");
  const visibleBatches = batches.filter((batch) =>
    `${batch.id} ${batch.actorName} ${batch.operation} ${JSON.stringify(batch.changes)}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  async function open(batchId: string) {
    setTarget(batchId);
    setPreview(null);
    setResult(null);
    setError("");
    setKey(crypto.randomUUID());
    try {
      setPreview(await previewUndo(workspaceId, batchId));
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not preview undo.",
      );
    }
  }
  async function undo() {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      setResult(await undoBatch(workspaceId, { batchId: target }, key));
      await onSaved();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Undo could not be confirmed. Retry this same operation.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <label className="activity-search">
        Search recent activity
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="activity-list">
        {visibleBatches.map((batch) => (
          <article key={batch.id}>
            <div>
              <span className="pill">{batch.operation}</span>
              <b>{batch.actorName}</b>
              <time>{new Date(batch.createdAt).toLocaleString()}</time>
            </div>
            <p>
              {batch.result.count} recorded{" "}
              {batch.result.count === 1 ? "change" : "changes"} · batch{" "}
              {batch.id.slice(0, 8)}
            </p>
            {batch.changeSetId && (
              <Link
                className="why-link"
                href={`/app/changes/${batch.changeSetId}`}
              >
                Inspect source proposal ↗
              </Link>
            )}
            <details>
              <summary>Inspect immutable history</summary>
              {batch.changes.map((change, index) => (
                <p key={index}>
                  <Link href={`/app/tasks/${change.taskId}`}>
                    {change.taskId.slice(0, 8)}
                  </Link>{" "}
                  · {change.field}: {change.before ?? "—"} →{" "}
                  {change.after ?? "—"}
                </p>
              ))}
            </details>
            {batch.result.outcomes?.map((outcome, index) => (
              <p key={index}>
                <span className="pill">{outcome.outcome}</span> {outcome.field}{" "}
                · {outcome.detail}
              </p>
            ))}
            {canEdit &&
              batch.operation !== "undo" &&
              batch.changes.length > 0 && (
                <button className="text-button" onClick={() => open(batch.id)}>
                  Preview safe undo ↗
                </button>
              )}
          </article>
        ))}
        {!visibleBatches.length && (
          <div className="empty-panel">
            <h2>A history starts here.</h2>
            <p>Applied changes and human edits will appear here.</p>
          </div>
        )}
      </div>
      {target && (
        <Dialog title="Unwind, with care." onClose={() => setTarget(null)} wide>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!preview && !error && <p role="status">Checking field history…</p>}
          {preview?.alreadyUndone && (
            <p className="notice">
              This batch has already been undone. These are its stored outcomes.
            </p>
          )}
          {(result?.outcomes ?? preview?.outcomes)?.map((outcome, index) => (
            <div className="undo-row" key={index}>
              <span className="pill">
                {outcome.outcome === "restored" &&
                !result &&
                !preview?.alreadyUndone
                  ? "Eligible"
                  : outcome.outcome}
              </span>
              <div>
                <b>{outcome.field}</b>
                <small>
                  Task {outcome.taskId.slice(0, 8)} · {outcome.detail}
                </small>
              </div>
            </div>
          ))}
          {result ? (
            <p className="success" role="status">
              {result.count} fields restored or tasks archived.{" "}
              {result.outcomes?.filter(
                (outcome) => outcome.outcome === "conflict",
              ).length ?? 0}{" "}
              conflicts preserved.{" "}
              {result.verification === "verified"
                ? "Persistence verified."
                : "Readback verification is pending."}
            </p>
          ) : (
            preview &&
            !preview.alreadyUndone && (
              <>
                <button className="primary" disabled={busy} onClick={undo}>
                  {busy
                    ? "Restoring eligible fields…"
                    : "Undo eligible changes"}
                </button>
              </>
            )
          )}
        </Dialog>
      )}
    </>
  );
}
