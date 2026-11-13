"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { checkCoverage, loadCoverageFingerprint } from "@/client/commands";
import type { Proposal } from "@/client/types";

type Result = Awaited<ReturnType<typeof checkCoverage>>;

export function CoverageReview({
  draft,
  workspaceId,
}: {
  draft: Proposal;
  workspaceId: string;
}) {
  const [result, setResult] = useState<Result>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const changeSetId = draft.id;

  useEffect(() => {
    if (!result) return;
    let active = true;
    async function verify() {
      try {
        const current = await loadCoverageFingerprint(workspaceId, changeSetId);
        if (current.fingerprint === result?.fingerprint) return;
      } catch {
        // Hide a result if its freshness cannot be established.
      }
      if (active) {
        setResult(undefined);
        setError(
          "Coverage is no longer current. Check again after reviewing the latest changes.",
        );
      }
    }
    const timer = window.setInterval(() => {
      void verify();
    }, 10_000);
    window.addEventListener("focus", verify);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", verify);
    };
  }, [result, workspaceId, changeSetId]);

  async function run() {
    setPending(true);
    setError("");
    setResult(undefined);
    try {
      setResult(await checkCoverage(workspaceId, changeSetId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The coverage check failed.",
      );
    } finally {
      setPending(false);
    }
  }

  const uncovered =
    result?.entries.filter(({ status }) => status === "uncovered") ?? [];
  const ordered = result && [
    ...uncovered,
    ...result.entries.filter(({ status }) => status !== "uncovered"),
  ];
  return (
    <section className="question-panel" aria-label="Revision coverage">
      <h3>Revision coverage</h3>
      <p>
        Check whether changed passages are addressed by existing tasks or
        proposals. This sends the revision changes and review context to
        OpenServ.
      </p>
      <button disabled={pending} onClick={run}>
        {pending ? "Checking coverage…" : "Check coverage"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <p role="status">
            <b>
              {result.entries.length} classified · {uncovered.length} uncovered
            </b>
          </p>
          <p>
            SERV’s classifications are suggestions. Review the source before
            acting. This result is visible only in this review session.
          </p>
          <ol>
            {ordered?.map((entry) => (
              <li key={entry.passage.id}>
                <b>
                  {entry.status === "uncovered"
                    ? "Uncovered"
                    : entry.status === "no_task_change"
                      ? "No task change"
                      : "Covered"}
                </b>
                <p>{entry.reason}</p>
                <Link
                  href={`/app/sources/${entry.sourceId}?version=${entry.versionId}&start=${entry.passage.start}&end=${entry.passage.end}`}
                >
                  Source passage · v{entry.versionNumber}
                </Link>
                {entry.taskTitles.length > 0 && (
                  <p>Existing tasks · {entry.taskTitles.join(", ")}</p>
                )}
                {entry.proposalKeys.map((key) => (
                  <p key={key}>
                    <a
                      href={`#proposal-item-${draft.items.findIndex((item) => item.key === key)}`}
                    >
                      Proposed item{" "}
                      {draft.items.findIndex((item) => item.key === key) + 1}
                    </a>
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
