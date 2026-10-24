"use client";

import Link from "next/link";
import { GlowCard } from "../glow-card";
import { useState } from "react";
import type { WorkspaceData } from "@/client/types";
import { sampleBrief, sampleTitle } from "@/domain/sources/sample";
import { sourceInput } from "@/domain/contracts";
import { createSource } from "@/client/commands";
import { Dialog } from "../dialog";
import { Arrow, DocumentIcon } from "../icons";

export function SourceLibrary({
  sources,
}: {
  sources: WorkspaceData["sources"];
}) {
  return (
    <div className="source-list">
      {sources.map((source) => (
        <GlowCard className="source-card-shell" key={source.id}>
          <Link className="source-card" href={`/app/sources/${source.id}`}>
            <DocumentIcon />
            <div>
              <h2>{source.title}</h2>
              <p className="muted">
                {source.versionCount}{" "}
                {source.versionCount === 1 ? "revision" : "revisions"}
                {source.visibility === "private" && " · Private"}
              </p>
            </div>
            <Arrow />
          </Link>
        </GlowCard>
      ))}
      {!sources.length && (
        <div className="empty-panel">
          <DocumentIcon />
          <h2>No sources yet</h2>
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
  const [key] = useState(() => crypto.randomUUID());
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const result = await createSource(
        workspaceId,
        sourceInput.parse({
          title,
          text,
          visibility: data.get("visibility"),
        }),
        key,
      );
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
            Use fictional launch sample <Arrow />
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
