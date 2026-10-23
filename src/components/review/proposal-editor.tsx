"use client";
import { useState } from "react";
import type { ProposalItem } from "@/domain/contracts";
import type { Proposal } from "@/client/types";
import { statusLabels } from "../tasks/task-board";
import { editProposal } from "@/client/commands";

export function EditValue({
  item,
  proposalId,
  expectedRevision,
  members,
  workspaceId,
  onSaved,
}: {
  item: ProposalItem;
  proposalId: string;
  expectedRevision: number;
  members: Proposal["members"];
  workspaceId: string;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    item.kind === "update" ? (item.value ?? "") : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);
  async function refreshSaved() {
    setBusy(true);
    try {
      await onSaved();
      setRefreshPending(false);
      setError("");
    } catch {
      setRefreshPending(true);
      setError(
        "Proposed value saved. Refresh the proposal before editing again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (item.kind !== "update") return null;
  if (refreshPending)
    return (
      <div>
        <p role="alert" className="error">
          {error}
        </p>
        <button disabled={busy} onClick={refreshSaved}>
          Refresh saved proposal
        </button>
      </div>
    );
  if (!editing)
    return (
      <button className="text-button" onClick={() => setEditing(true)}>
        Edit proposed value
      </button>
    );
  return (
    <form
      className="edit-proposal"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await editProposal(workspaceId, proposalId, {
            expectedRevision: expectedRevision,
            key: item.key,
            value: value || null,
          });
          setEditing(false);
          setRefreshPending(true);
          await refreshSaved();
        } catch (error) {
          setError(
            error instanceof Error ? error.message : "Could not edit proposal.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Your proposed {item.field}
        {item.field === "status" ? (
          <select
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            {Object.entries(statusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        ) : item.field === "assigneeId" ? (
          <select
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="date"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </label>
      <small>
        Your choice will be attributed to you. The original citation remains as
        context.
      </small>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="inline-actions">
        <button type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button disabled={busy}>
          {busy ? "Saving…" : "Save proposed value"}
        </button>
      </div>
    </form>
  );
}
