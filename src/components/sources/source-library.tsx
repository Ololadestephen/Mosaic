"use client";

import Link from "next/link";
import { useState } from "react";
import type { WorkspaceData } from "@/client/types";
import { sampleBrief, sampleTitle } from "@/domain/sources/sample";
import { createSource } from "../commands";
import { Dialog } from "../dialog";

export function SourceLibrary({
  sources,
}: {
  sources: WorkspaceData["sources"];
}) {
  return (
    <div className="source-list">
      {sources.map((source) => (
        <Link
          className="source-card"
          href={`/app/sources/${source.id}`}
          key={source.id}
        >
          <span className="document-icon" aria-hidden="true">
            ▤
          </span>
          <div>
            <p className="eyebrow">
              {source.visibility === "private"
                ? "Only you"
                : "Workspace source"}{" "}
              · Text brief
            </p>
            <h2>{source.title}</h2>
            <p className="muted">
              {source.versionCount}{" "}
              {source.versionCount === 1 ? "revision" : "revisions"} · Original
              passages preserved
            </p>
          </div>
          <span aria-hidden="true">↗</span>
        </Link>
      ))}
      {!sources.length && (
        <div className="empty-panel">
          <span className="document-icon" aria-hidden="true">
            ▤
          </span>
          <h2>Start with the source.</h2>
          <p>
            Bring a brief, a decision, or a change in direction.
            <br />
            Keep the original words close to the work.
          </p>
        </div>
      )}
    </div>
  );
}

export function NewSource({
  workspaceId,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  onClose: () => void;
  onSaved: (sourceId: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await createSource(workspaceId, {
        title,
        text,
        visibility: data.get("visibility"),
      });
      await onSaved(result.sourceId);
      onClose();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save source.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Bring a source" onClose={onClose} wide>
      <p className="muted">
        Save the original words. Analysis will propose changes for your review.
      </p>
      <form onSubmit={submit}>
        <label>
          Source title
          <input
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={180}
          />
        </label>
        <label>
          Source text
          <textarea
            name="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            required
            maxLength={20000}
            rows={11}
          />
          <small>{text.length.toLocaleString()} / 20,000 characters</small>
        </label>
        <div className="inline-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setTitle(sampleTitle);
              setText(sampleBrief);
            }}
          >
            Use fictional launch sample ↗
          </button>
          <label>
            Visibility
            <select name="visibility">
              <option value="workspace">Workspace</option>
              <option value="private">Only me</option>
            </select>
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Saving source…" : "Save source"}
        </button>
      </form>
    </Dialog>
  );
}
