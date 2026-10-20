"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BatchResult, getProposal } from "@/client/types";
import { applyProposal, loadProposal, lookupApply } from "../commands";
import { statusLabels } from "../tasks/task-board";
import { EditValue } from "./proposal-editor";
import { RevisionComparison } from "../sources/revision-comparison";
import { ApiError } from "../api";
import {
  readApplyAttempt,
  saveApplyAttempt,
  clearApplyAttempt,
  type ApplyAttempt,
} from "./apply-recovery";

type Proposal = Awaited<ReturnType<typeof getProposal>>;

function selectionKey(workspaceId: string, changeSetId: string) {
  return `mosaic-review-selection:${workspaceId}:${changeSetId}`;
}

function readSelection(workspaceId: string, changeSetId: string) {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(selectionKey(workspaceId, changeSetId)) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}
export function ChangeList({
  drafts,
}: {
  drafts: { id: string; state: string; revision: number }[];
}) {
  return (
    <div className="source-list">
      {drafts.map((draft) => (
        <Link
          className="source-card"
          key={draft.id}
          href={`/app/changes/${draft.id}`}
        >
          <div>
            <p className="eyebrow">
              {draft.state === "applied" ? "Applied" : "Needs your review"}
            </p>
            <h2>Source proposal · {draft.id.slice(0, 8)}</h2>
            <p className="muted">Draft revision {draft.revision}</p>
          </div>
          <span>↗</span>
        </Link>
      ))}
      {!drafts.length && (
        <div className="empty-panel">
          <h2>A considered next step.</h2>
          <p>
            Add a source and run live analysis to create a proposal.
            <br />
            Nothing changes on the board during review.
          </p>
          <Link href="/app/sources" className="button">
            Open sources ↗
          </Link>
        </div>
      )}
    </div>
  );
}
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

export function ChangeReview({
  workspaceId,
  changeSetId,
  canEdit,
  onApplied,
}: {
  workspaceId: string;
  changeSetId: string;
  canEdit: boolean;
  onApplied: () => Promise<void>;
}) {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [draft, setDraft] = useState<Proposal | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [attempt, setAttempt] = useState<ApplyAttempt | null>(null);
  const [rejected, setRejected] = useState(false);
  const attempted = attempt !== null;
  async function reload() {
    const loaded = await loadProposal(workspaceId, changeSetId);
    setDraft(loaded);
    if (loaded.state === "applied") {
      clearApplyAttempt(workspaceId, changeSetId);
      setAttempt(null);
    }
  }
  useEffect(() => {
    let active = true;
    loadProposal(workspaceId, changeSetId)
      .then((draft) => {
        if (!active) return;
        setDraft(draft);
        if (draft.state !== "draft") {
          sessionStorage.removeItem(selectionKey(workspaceId, changeSetId));
          clearApplyAttempt(workspaceId, changeSetId);
          setAttempt(null);
          return;
        }
        const original = readApplyAttempt(workspaceId, changeSetId);
        if (original) {
          setAttempt(original);
          setSelected(original.selectedKeys);
          return;
        }
        const keys = new Set(draft.items.map((item) => item.key));
        setSelected(
          readSelection(workspaceId, changeSetId).filter((key) =>
            keys.has(key),
          ),
        );
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, changeSetId, loadAttempt]);
  useEffect(() => {
    if (!draft || draft.state !== "draft") return;
    sessionStorage.setItem(
      selectionKey(workspaceId, changeSetId),
      JSON.stringify(selected),
    );
  }, [draft, selected, workspaceId, changeSetId]);
  async function apply() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const original = attempt ?? {
        changeSetId,
        expectedRevision: draft.revision,
        selectedKeys: selected,
        operationKey: crypto.randomUUID(),
      };
      saveApplyAttempt(workspaceId, original);
      setAttempt(original);
      const result = await applyProposal(workspaceId, original);
      setResult(result);
      await reload();
      await onApplied();
    } catch (error) {
      setRejected(
        error instanceof ApiError &&
          ["CONFLICT", "INVALID_INPUT"].includes(error.code),
      );
      setError(
        error instanceof Error
          ? error.message
          : "Apply could not be confirmed. Keep this operation key for recovery.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    if (!attempt) return;
    setBusy(true);
    setError("");
    try {
      const result = await lookupApply(workspaceId, attempt.operationKey);
      setResult(result);
      await reload();
      await onApplied();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No result found. Retry the same operation.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!draft)
    return error ? (
      <div role="alert" className="error">
        {error}{" "}
        <button
          onClick={() => {
            setError("");
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          Retry proposal
        </button>
      </div>
    ) : (
      <p role="status">Opening proposal…</p>
    );
  const cited =
    draft.versions.find((version) => version.id === draft.sourceVersionId) ??
    draft.versions[0];
  const predecessor = draft.versions.find(
    (version) => version.id === cited?.predecessorId,
  );
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
  return (
    <div className="review">
      <Link className="back-link" href="/app/changes">
        ← All proposals
      </Link>
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            Take Two ·{" "}
            {draft.state === "applied" ? "Applied proposal" : "Human review"} ·
            Revision {draft.revision}
          </p>
          <h2 className="page-title">Consider the change.</h2>
        </div>
        <span className="pill">{draft.items.length} proposed items</span>
      </div>
      <p className="eyebrow">
        {draft.analysis
          ? `Live ${draft.analysis.provider === "gemini" ? "Gemini" : "OpenRouter"} analysis · ${draft.analysis.model}`
          : "Deterministic test fixture · not live AI"}
      </p>
      <p className="notice">
        Select the changes you authorize. Reviewing and editing this proposal
        leave the board unchanged. Applying closes this proposal; unselected
        items are left unapplied.
      </p>
      {cited && (
        <details className="source-on-review">
          <summary>
            Source used for this proposal · version {cited.number}
          </summary>
          <pre>{cited.text}</pre>
        </details>
      )}
      {cited && predecessor && (
        <RevisionComparison
          current={cited}
          predecessor={predecessor}
          references={draft.items.flatMap((item, index) =>
            item.citations.map((citation) => ({
              versionId: citation.sourceVersionId,
              start: citation.start,
              end: citation.end,
              href: `#proposal-item-${index}`,
              label: `Related proposal: ${item.kind === "create" ? item.title : item.kind === "decision" ? item.statement : item.field}`,
            })),
          )}
        />
      )}
      {draft.state === "applied" && draft.receipt.length > 0 && (
        <section className="receipt" aria-label="Applied changes">
          <h3>What was saved</h3>
          <ul>
            {draft.receipt.map((change) => {
              const item = draft.items.find(
                (entry) =>
                  entry.kind === "update" &&
                  entry.taskId === change.taskId &&
                  entry.field === change.field,
              );
              const citation = item?.citations[0];
              const version = citation
                ? draft.versions.find(
                    (entry) => entry.id === citation.sourceVersionId,
                  )
                : cited;
              return (
                <li key={`${change.taskId}:${change.field}`}>
                  {change.field === "created" ? (
                    <>
                      <b>New task</b>: {change.after ?? "Untitled"}
                    </>
                  ) : (
                    <>
                      <b>{change.field}</b>: {change.before ?? "Not set"} →{" "}
                      {change.after ?? "Not set"}
                    </>
                  )}
                  {citation && version && (
                    <>
                      {" "}
                      <Link
                        href={`/app/sources/${version.sourceId}?version=${citation.sourceVersionId}&start=${citation.start}&end=${citation.end}`}
                      >
                        Evidence ↗
                      </Link>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {result && (
        <div className="success" role="status">
          <b>
            {result.count} {result.count === 1 ? "item" : "items"} committed.
          </b>{" "}
          {result.verification === "verified"
            ? "Persistence verified."
            : "Commit recorded; readback verification is pending."}{" "}
          <Link href="/app/activity">Inspect history ↗</Link>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {draft.questions.length > 0 && (
        <section className="question-panel">
          <h3>Needs your decision</h3>
          <ul>
            {draft.questions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ul>
          <p className="quiet">
            These questions do not execute changes. Resolve ambiguity in a
            source revision or with a confirmed human choice.
          </p>
        </section>
      )}
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
            {group.map((item) => {
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
                        change.taskId === item.taskId &&
                        change.field === item.field,
                    )
                  : undefined;
              return (
                <article
                  className="proposal-row"
                  id={`proposal-item-${draft.items.findIndex((entry) => entry.key === item.key)}`}
                  tabIndex={-1}
                  key={item.key}
                >
                  <div className="proposal-heading">
                    <label className="select-proposal">
                      <input
                        type="checkbox"
                        aria-label={`Select ${title}: ${item.key}`}
                        checked={selected.includes(item.key)}
                        disabled={
                          !canEdit ||
                          busy ||
                          attempted ||
                          draft.state !== "draft"
                        }
                        onChange={(event) => {
                          setSelected(
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
                    {item.editedBy && (
                      <span className="pill">Human-edited choice</span>
                    )}
                  </div>
                  {item.kind === "update" && (
                    <div className="value-diff">
                      <span>
                        <small>{recorded ? "Before" : "Current value"}</small>
                        {valueLabel(
                          item.field,
                          recorded
                            ? recorded.before
                            : (task?.[item.field] ?? null),
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
                      {valueLabel(
                        "assigneeId",
                        item.fields.assigneeId,
                        draft.members,
                      )}{" "}
                      · {item.fields.dueDate ?? "No due date"}
                    </p>
                  )}
                  {item.kind === "update" &&
                    draft.state === "draft" &&
                    task?.revision !== item.expectedRevision && (
                      <p className="error">
                        This task changed after analysis. It cannot be applied
                        in this selection.
                      </p>
                    )}
                  <p className="proposal-reason">{item.reason}</p>
                  {item.impact && (
                    <p className="quiet">Effect: {item.impact}</p>
                  )}
                  {item.citations.map((citation, index) => {
                    const version = draft.versions.find(
                      (version) => version.id === citation.sourceVersionId,
                    );
                    return (
                      <blockquote key={index}>
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
                      onSaved={reload}
                    />
                  )}
                </article>
              );
            })}
          </section>
        );
      })}
      {!draft.items.length && (
        <div className="empty-panel">
          <h2>No changes proposed.</h2>
          <p>
            The questions and preserved work below are the outcome of this
            analysis.
          </p>
        </div>
      )}
      {draft.preserved.length > 0 && (
        <section className="preserved-panel">
          <h3>What stays as it is</h3>
          <ul>
            {draft.preserved.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </section>
      )}
      {canEdit && draft.state === "draft" && (
        <footer className="review-actions">
          <span>{selected.length} selected · no board changes yet</span>
          <div>
            {rejected && (
              <button
                disabled={busy}
                onClick={async () => {
                  clearApplyAttempt(workspaceId, changeSetId);
                  setAttempt(null);
                  setRejected(false);
                  setSelected([]);
                  setError("");
                  await reload();
                }}
              >
                Review a new selection
              </button>
            )}
            {attempted && (
              <button onClick={recover} disabled={busy}>
                Check original operation
              </button>
            )}
            <button
              className="primary"
              onClick={apply}
              disabled={!selected.length || busy}
            >
              {busy
                ? "Applying and verifying…"
                : attempted
                  ? "Retry original selection"
                  : "Apply selected changes"}
            </button>
          </div>
          {attempted && (
            <small>
              Operation {attempt?.operationKey}. Selection is held for safe
              recovery. The same key, revision and selection survive refresh. A
              confirmed rejected request can be reviewed as a new selection.
            </small>
          )}
        </footer>
      )}
    </div>
  );
}
