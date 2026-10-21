"use client";

import Link from "next/link";
import type { Proposal } from "@/client/types";
import { statusLabels } from "../tasks/task-board";
import { EditValue } from "./proposal-editor";

function valueLabel(
  field: string,
  value: string | null,
  members: Proposal["members"],
) {
  if (value === null) return "Not set";
  if (field === "status")
    return statusLabels[value as keyof typeof statusLabels] ?? value;
  if (field === "assigneeId")
    return (
      members.find((member) => member.id === value)?.name ?? "Unknown member"
    );
  return value;
}

export function ProposalGroups({
  draft,
  selected,
  canEdit,
  busy,
  attempted,
  workspaceId,
  onSelectedChange,
  onSaved,
}: {
  draft: Proposal;
  selected: string[];
  canEdit: boolean;
  busy: boolean;
  attempted: boolean;
  workspaceId: string;
  onSelectedChange: (selected: string[]) => void;
  onSaved: () => Promise<void>;
}) {
  const groups = new Map<string, Proposal["items"]>();
  const groupOrder: string[] = [];
  for (const item of draft.items) {
    const id = item.kind === "update" ? item.taskId : item.key;
    const existing = groups.get(id);
    if (existing) existing.push(item);
    else {
      groups.set(id, [item]);
      groupOrder.push(id);
    }
  }
  const itemIndex = new Map(
    draft.items.map((item, index) => [item.key, index]),
  );
  return (
    <>
      {groupOrder.map((groupId) => {
        const group = groups.get(groupId) ?? [];
        const first = group[0];
        const groupTitle =
          first?.kind === "update"
            ? (draft.tasks.find((task) => task.id === first.taskId)?.title ??
              "Task")
            : null;
        return (
          <section className="proposal-group" key={groupId}>
            {groupTitle && group.length > 1 && <h3>{groupTitle}</h3>}
            {group.map((item) => (
              <ProposalRow
                key={item.key}
                item={item}
                index={itemIndex.get(item.key) ?? 0}
                draft={draft}
                selected={selected}
                canEdit={canEdit}
                busy={busy}
                attempted={attempted}
                workspaceId={workspaceId}
                onSelectedChange={onSelectedChange}
                onSaved={onSaved}
              />
            ))}
          </section>
        );
      })}
    </>
  );
}

function ProposalRow({
  item,
  index,
  draft,
  selected,
  canEdit,
  busy,
  attempted,
  workspaceId,
  onSelectedChange,
  onSaved,
}: {
  item: Proposal["items"][number];
  index: number;
  draft: Proposal;
  selected: string[];
  canEdit: boolean;
  busy: boolean;
  attempted: boolean;
  workspaceId: string;
  onSelectedChange: (selected: string[]) => void;
  onSaved: () => Promise<void>;
}) {
  const task =
    item.kind === "update"
      ? draft.tasks.find((task) => task.id === item.taskId)
      : undefined;
  const title =
    item.kind === "create"
      ? item.title
      : item.kind === "decision"
        ? item.statement
        : (task?.title ?? "Unavailable task");
  const recorded =
    item.kind === "update"
      ? draft.receipt.find(
          (change) =>
            change.taskId === item.taskId && change.field === item.field,
        )
      : undefined;
  return (
    <article
      className="proposal-row"
      id={`proposal-item-${index}`}
      tabIndex={-1}
    >
      <div className="proposal-heading">
        <label className="select-proposal">
          <input
            type="checkbox"
            aria-label={`Select ${title}: ${item.key}`}
            checked={selected.includes(item.key)}
            disabled={!canEdit || busy || attempted || draft.state !== "draft"}
            onChange={(event) => {
              onSelectedChange(
                event.target.checked
                  ? [...selected, item.key]
                  : selected.filter((key) => key !== item.key),
              );
            }}
          />
          <span>
            <small>
              {item.kind === "create"
                ? "Create task"
                : item.kind === "decision"
                  ? "Record decision"
                  : `Update ${item.field}`}
            </small>
            <b>{title}</b>
          </span>
        </label>
        {item.editedBy && <span className="pill">Human-edited choice</span>}
      </div>
      {item.kind === "update" && (
        <div className="value-diff">
          <span>
            <small>{recorded ? "Before" : "Current value"}</small>
            {valueLabel(
              item.field,
              recorded ? recorded.before : (task?.[item.field] ?? null),
              draft.members,
            )}
          </span>
          <span aria-hidden="true">→</span>
          <span>
            <small>{recorded ? "After" : "Proposed value"}</small>
            <b>
              {valueLabel(
                item.field,
                recorded ? recorded.after : item.value,
                draft.members,
              )}
            </b>
          </span>
        </div>
      )}
      {item.kind === "create" && (
        <p className="create-fields">
          {statusLabels[item.fields.status]} ·{" "}
          {valueLabel("assigneeId", item.fields.assigneeId, draft.members)} ·{" "}
          {item.fields.dueDate ?? "No due date"}
        </p>
      )}
      {item.kind === "update" &&
        draft.state === "draft" &&
        task?.revision !== item.expectedRevision && (
          <p className="error">
            This task changed after analysis. It cannot be applied in this
            selection.
          </p>
        )}
      <p className="proposal-reason">{item.reason}</p>
      {item.impact && <p className="quiet">Effect: {item.impact}</p>}
      {item.citations.map((citation, citationIndex) => {
        const version = draft.versions.find(
          (version) => version.id === citation.sourceVersionId,
        );
        return (
          <blockquote key={citationIndex}>
            <p>{citation.quote}</p>
            <cite>
              <Link
                href={`/app/sources/${version?.sourceId}?version=${citation.sourceVersionId}&start=${citation.start}&end=${citation.end}`}
              >
                Exact source passage · v{version?.number} ↗
              </Link>
            </cite>
          </blockquote>
        );
      })}
      {canEdit && !attempted && draft.state === "draft" && (
        <EditValue
          item={item}
          draft={draft}
          workspaceId={workspaceId}
          onSaved={onSaved}
        />
      )}
    </article>
  );
}
