"use client";

import Link from "next/link";
import { GlowCard } from "../glow-card";
import type { Proposal } from "@/client/types";
import { RevisionComparison } from "../sources/revision-comparison";
import { ProposalGroups } from "./proposal-review";
import { useChangeReview } from "./use-change-review";
import { Arrow } from "../icons";

export function ChangeList({
  drafts,
}: {
  drafts: { id: string; state: string; revision: number }[];
}) {
  return (
    <div className="source-list">
      {drafts.map((draft) => (
        <GlowCard className="source-card-shell" key={draft.id}>
          <Link className="source-card" href={`/app/changes/${draft.id}`}>
            <div>
              <p className="eyebrow">
                {draft.state === "applied" ? "Applied" : "Needs your review"}
              </p>
              <h2>Source proposal · {draft.id.slice(0, 8)}</h2>
            </div>
            <Arrow />
          </Link>
        </GlowCard>
      ))}
      {!drafts.length && (
        <div className="empty-panel">
          <h2>No proposals yet</h2>
          <Link href="/app/sources" className="button">
            Open sources <Arrow />
          </Link>
        </div>
      )}
    </div>
  );
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
  const review = useChangeReview(workspaceId, changeSetId, onApplied);
  const { draft, error } = review;
  if (!draft)
    return error ? (
      <div role="alert" className="error">
        {error} <button onClick={review.retryLoad}>Retry proposal</button>
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
  return (
    <div className="review">
      <Link className="back-link" href="/app/changes">
        ← All proposals
      </Link>
      <div className="section-heading">
        <h2 className="page-title">Consider the change.</h2>
        <span className="pill">
          {draft.state === "applied"
            ? "Applied proposal"
            : `${draft.items.length} proposed items`}
        </span>
      </div>
      <p className="eyebrow">
        {draft.analysis
          ? `Live ${draft.analysis.provider === "gemini" ? "Gemini" : "OpenRouter"} analysis · ${draft.analysis.model}`
          : "Deterministic test fixture · not live AI"}
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
        <AppliedReceipt draft={draft} cited={cited} />
      )}
      {review.result && (
        <div className="success" role="status">
          <b>
            {review.result.count} {review.result.count === 1 ? "item" : "items"}{" "}
            committed.
          </b>{" "}
          {review.result.verification === "verified"
            ? "Persistence verified."
            : "Commit recorded; readback verification is pending."}{" "}
          <Link href="/app/activity">
            Inspect history <Arrow />
          </Link>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          {review.result && (
            <button disabled={review.busy} onClick={review.retryRefresh}>
              Refresh saved result
            </button>
          )}
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
        </section>
      )}
      <ProposalGroups
        draft={draft}
        selected={review.selected}
        canEdit={canEdit}
        busy={review.busy}
        attempted={review.attempted}
        workspaceId={workspaceId}
        onSelectedChange={review.setSelected}
        onSaved={review.reload}
      />
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
        <ReviewActions
          selectedCount={review.selected.length}
          busy={review.busy}
          rejected={review.rejected}
          attempted={review.attempted}
          operationKey={review.attempt?.operationKey}
          onApply={review.apply}
          onRecover={review.recover}
          onReset={review.discardApplyAttemptAndReload}
        />
      )}
    </div>
  );
}

function AppliedReceipt({
  draft,
  cited,
}: {
  draft: Proposal;
  cited: Proposal["versions"][number] | undefined;
}) {
  return (
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
                    Evidence <Arrow />
                  </Link>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ReviewActions({
  selectedCount,
  busy,
  rejected,
  attempted,
  operationKey,
  onApply,
  onRecover,
  onReset,
}: {
  selectedCount: number;
  busy: boolean;
  rejected: boolean;
  attempted: boolean;
  operationKey: string | undefined;
  onApply: () => Promise<void>;
  onRecover: () => Promise<void>;
  onReset: () => Promise<void>;
}) {
  return (
    <footer className="review-actions">
      <span>{selectedCount} selected · no board changes yet</span>
      <div>
        {rejected && (
          <button disabled={busy} onClick={onReset}>
            Review a new selection
          </button>
        )}
        {attempted && (
          <button onClick={onRecover} disabled={busy}>
            Check original operation
          </button>
        )}
        <button
          className="primary"
          onClick={onApply}
          disabled={!selectedCount || busy}
        >
          {busy
            ? "Applying and verifying…"
            : attempted
              ? "Retry original selection"
              : "Apply selected changes"}
        </button>
      </div>
      {attempted && <small>Operation {operationKey}</small>}
    </footer>
  );
}
