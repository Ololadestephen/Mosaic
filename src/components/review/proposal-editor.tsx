"use client";
import { useState } from "react";
import type { ProposalItem } from "@/domain/contracts";
import type { getProposal } from "@/client/types";
import { statusLabels } from "../tasks/task-board";
import { editProposal } from "../commands";
type Proposal = Awaited<ReturnType<typeof getProposal>>;

export function EditValue({
  item,
  draft,
  workspaceId,
  onSaved,
}: {
  item: ProposalItem;
  draft: Proposal;
  workspaceId: string;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    item.kind === "update" ? (item.value ?? "") : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (item.kind !== "update") return null;
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
          await editProposal(workspaceId, draft.id, {
            expectedRevision: draft.revision,
            key: item.key,
            value: value || null,
          });
          await onSaved();
          setEditing(false);
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
            {draft.members.map((member) => (
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
