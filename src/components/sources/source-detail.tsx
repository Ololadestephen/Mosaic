"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PASSAGE_REVIEW_LABEL } from "@/domain/sources/passage-change";
import type { SourceDetail } from "@/client/types";
import { addRevision, analyzeSource, loadSource } from "@/client/commands";
import { Dialog } from "../dialog";
import { SourcePassage } from "./source-passage";
import { RevisionComparison } from "./revision-comparison";
export function SourceDetailView({
  workspaceId,
  sourceId,
  canEdit,
  aiEnabled,
  aiProvider,
  aiModel,
  onSaved,
}: {
  workspaceId: string;
  sourceId: string;
  canEdit: boolean;
  aiEnabled: boolean;
  aiProvider: "Gemini" | "OpenRouter";
  aiModel: string;
  onSaved: () => Promise<void>;
}) {
  const router = useRouter();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [selected, setSelected] = useState("");
  const [revising, setRevising] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const source = await loadSource(workspaceId, sourceId);
    setSource(source);
    return source;
  }
  useEffect(() => {
    let active = true;
    loadSource(workspaceId, sourceId)
      .then((source) => {
        if (active) {
          setSource(source);
          setSelected(
            new URLSearchParams(window.location.search).get("version") ??
              source.latestVersionId,
          );
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, sourceId, loadAttempt]);
  async function revise(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!source) return;
    setBusy(true);
    setError("");
    try {
      const result = await addRevision(workspaceId, sourceId, {
        text,
        predecessorId: source.latestVersionId,
      });
      await load();
      setSelected(result.versionId);
      setRevising(false);
      await onSaved();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save revision.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    if (!source) return;
    if (selected && selected !== source.latestVersionId) {
      setError(
        "Only the latest revision can be analyzed. Select the latest revision and try again.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const draft = await analyzeSource(workspaceId, {
        sourceVersionId: source.latestVersionId,
      });
      router.push(`/app/changes/${draft.id}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Analysis failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!source)
    return error ? (
      <div role="alert" className="error">
        {error}{" "}
        <button
          onClick={() => {
            setError("");
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          Retry source
        </button>
      </div>
    ) : (
      <p role="status">Loading source…</p>
    );
  const version =
    source.versions.find((version) => version.id === selected) ??
    source.versions[0];
  const isLatest = version.id === source.latestVersionId;
  const passageReviews = source.passageReviews.filter(
    (review) => review.laterVersionId === version.id,
  );
  const predecessor = source.versions.find(
    (entry) => entry.id === version.predecessorId,
  );
  const draft = source.changes.find(
    (change) => change.sourceVersionId === version.id,
  );
  const run = source.analysisRuns.find(
    (run) => run.sourceVersionId === version.id,
  );
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const start = Number(params.get("start"));
  const end = Number(params.get("end"));
  const highlight =
    params.get("version") === version.id &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end > start &&
    end <= version.text.length;
  return (
    <>
      <Link className="back-link" href="/app/sources">
        ← All sources
      </Link>
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {source.visibility === "private"
              ? "Only you · private derivatives"
              : "Workspace source"}
          </p>
          <h2 className="page-title">{source.title}</h2>
        </div>
        {canEdit && (
          <button
            onClick={() => {
              setText(source.versions[0].text);
              setRevising(true);
            }}
          >
            Add revision
          </button>
        )}
      </div>
      <div className="source-toolbar">
        <label>
          Revision
          <select
            aria-label="Source revision"
            value={version.id}
            onChange={(event) => setSelected(event.target.value)}
          >
            {source.versions.map((version) => (
              <option value={version.id} key={version.id}>
                Version {version.number}
                {version.predecessorId ? " · explicit revision" : " · original"}
              </option>
            ))}
          </select>
        </label>
        {draft ? (
          <Link className="button primary" href={`/app/changes/${draft.id}`}>
            {draft.state === "applied"
              ? "View applied changes"
              : "Review proposal"}{" "}
            ↗
          </Link>
        ) : (
          canEdit && (
            <button
              className="primary"
              onClick={analyze}
              disabled={!aiEnabled || busy || !isLatest}
            >
              {busy
                ? "Analyzing source…"
                : isLatest
                  ? "Analyze this revision ↗"
                  : "Select the latest revision to analyze"}
            </button>
          )
        )}
      </div>
      {!isLatest && (
        <p className="notice">
          This is a historical revision. You can read it and follow its
          citations, but only the latest revision can be analyzed.
        </p>
      )}
      {run && !draft && (
        <p className="notice" role="status">
          {analysisRunMessage(run)}
          {run.providerHttpStatus &&
            ` HTTP ${run.providerHttpStatus} · ${run.providerErrorCode ?? "PROVIDER_ERROR"}.`}
        </p>
      )}
      {aiEnabled && !draft ? (
        <p className="notice">
          Live {aiProvider} analysis · {aiModel}. Analyzing sends this saved
          source, its predecessor, visible tasks and member names to{" "}
          {aiProvider}. The model can only propose changes. The board stays
          unchanged until you apply a selection.
          {aiProvider === "Gemini" &&
            " Free-tier inputs and responses may be used for Google's product improvement and human review. Use synthetic data for this validation."}
        </p>
      ) : (
        !aiEnabled && (
          <p className="notice">
            Live {aiProvider} analysis is unavailable. Your source is saved.
            Fixture output is never substituted for a live proposal.
          </p>
        )
      )}
      {busy && (
        <p role="status">
          {revising
            ? "Saving the immutable revision…"
            : "Analyzing the saved source. Work stays unchanged until approval."}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <article className="source-paper">
        <p className="eyebrow">Immutable source · Version {version.number}</p>
        <SourcePassage
          text={version.text}
          versionId={version.id}
          start={start}
          end={end}
          highlighted={highlight}
        />
        <footer>
          Original wording preserved · Citations use this exact revision
        </footer>
      </article>
      {predecessor && (
        <RevisionComparison
          current={version}
          predecessor={predecessor}
          references={passageReviews.map((review) => ({
            versionId: review.citedVersionId,
            start: review.start,
            end: review.end,
            href: `/app/tasks/${review.taskId}`,
            label: `Review flag: ${review.taskTitle}`,
          }))}
        />
      )}
      {passageReviews.length > 0 && (
        <section className="passage-reviews" aria-label={PASSAGE_REVIEW_LABEL}>
          <h3>{PASSAGE_REVIEW_LABEL}</h3>
          <ul>
            {passageReviews.map((review) => (
              <li key={`${review.taskId}:${review.start}:${review.end}`}>
                <Link href={`/app/tasks/${review.taskId}`}>
                  {review.taskTitle}
                </Link>
                <p>
                  {review.change === "removed"
                    ? "The cited passage was removed."
                    : "The cited passage was edited."}{" "}
                  No task field was changed.
                </p>
                <blockquote>
                  <p>{review.quote}</p>
                </blockquote>
              </li>
            ))}
          </ul>
        </section>
      )}
      {revising && (
        <Dialog
          title="Add an explicit revision"
          onClose={() => setRevising(false)}
          wide
        >
          <p className="muted">
            This confirms the new text revises version{" "}
            {source.versions[0].number}. Existing work stays unchanged until you
            review and apply a proposal.
          </p>
          <form onSubmit={revise}>
            <label>
              Revised source
              <textarea
                rows={13}
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={20000}
                required
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save revision"}
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}

function analysisRunMessage(run: { status: string; errorCode: string | null }) {
  if (run.status === "running")
    return "An analysis was started. Refresh to check for its completed proposal before retrying.";
  if (run.status !== "failed")
    return "Analysis completed. Open its proposal from Changes.";
  if (run.errorCode === "QUOTA_EXHAUSTED")
    return "Provider quota is exhausted or rate-limited. Your source is saved; no work was changed and no automatic retry was made.";
  if (run.errorCode === "INVALID_OUTPUT")
    return "The provider returned invalid or incomplete proposals. Nothing was saved or applied.";
  return "The provider was unavailable or analysis did not complete. Your source is saved and no work was changed.";
}
