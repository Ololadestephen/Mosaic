"use client";
import { useState } from "react";
import type { WorkspaceData } from "@/client/types";
import { createWorkspace, saveMember } from "./commands";

export function WorkspaceForm({
  onCreated,
}: {
  onCreated: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="onboarding">
      <p className="eyebrow">Your first workspace</p>
      <h1>Give the work a home.</h1>
      <p>
        One shared place for your sources, tasks, and decisions.
        <br />
        You choose who can see and change them.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setBusy(true);
          try {
            const result = await createWorkspace({
              name: data.get("name"),
            });
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
          <input
            name="name"
            placeholder="e.g. Field Notes launch"
            maxLength={100}
            required
          />
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
      <h2>The people behind the work</h2>
      <p className="muted">
        Owners and editors can change work. Viewers can read shared work.
        Private sources and their derivatives stay with their owner.
      </p>
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
              await saveMember(workspaceId, {
                email: values.get("email"),
                role: values.get("role"),
              });
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
          <p className="muted">
            They create their own account first. Adding them here sends no
            message.
          </p>
          <label>
            Registered email
            <input name="email" type="email" required />
          </label>
          <label>
            Role
            <select name="role">
              <option value="editor">Editor · can change work</option>
              <option value="viewer">Viewer · read access</option>
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
        <p className="muted">
          Source text and history remain in PostgreSQL. Self-service deletion
          and hosted account recovery are not available in this local slice.
        </p>
      </div>
    </div>
  );
}
