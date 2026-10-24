"use client";
import { useState } from "react";
import type { WorkspaceData } from "@/client/types";
import { workspaceInput, memberInput } from "@/domain/contracts";
import { createWorkspace, saveMember } from "@/client/commands";

export function WorkspaceForm({
  onCreated,
}: {
  onCreated: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="onboarding">
      <h1>Give the work a home.</h1>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setBusy(true);
          try {
            const result = await createWorkspace(
              workspaceInput.parse({
                name: data.get("name"),
              }),
            );
            await onCreated(result.id);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Could not create workspace.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Workspace name
          <input name="name" maxLength={100} required />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create workspace ↗"}
        </button>
      </form>
    </section>
  );
}

export function Members({
  data,
  workspaceId,
  role,
  refresh,
}: {
  data: WorkspaceData;
  workspaceId: string;
  role: string;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="settings-panel">
      <div className="member-list">
        {data.members.map((member) => (
          <div className="member-row" key={member.id}>
            <span className="avatar">{member.name.slice(0, 1)}</span>
            <div>
              <b>{member.name}</b>
              <small>{member.email}</small>
            </div>
            <span className="pill">{member.role}</span>
          </div>
        ))}
      </div>
      {role === "owner" && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = new FormData(form);
            setBusy(true);
            setError("");
            try {
              await saveMember(
                workspaceId,
                memberInput.parse({
                  email: values.get("email"),
                  role: values.get("role"),
                }),
              );
              await refresh();
              form.reset();
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not update membership.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>Add or update a collaborator</h3>
          <label>
            Registered email
            <input name="email" type="email" required />
          </label>
          <label>
            Role
            <select name="role">
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy}>
            {busy ? "Saving…" : "Save membership"}
          </button>
        </form>
      )}
      <div className="detail-section">
        <h3>Model processing</h3>
        <p className="muted">
          {data.aiEnabled
            ? `Live ${data.aiProvider} analysis is configured. Only the selected source and authorized workspace context are sent to ${data.aiProvider}.`
            : `Live ${data.aiProvider} analysis is unavailable. Sources and tasks remain saved. No fixture fallback is used.`}
        </p>
      </div>
    </div>
  );
}
