"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { SourceVersion } from "@/domain/contracts";
import { revisionRows } from "@/domain/sources/passage-change";
import { Arrow } from "../icons";

type Reference = {
  versionId: string;
  start: number;
  end: number;
  href: string;
  label: string;
};

export function RevisionComparison({
  predecessor,
  current,
  references = [],
}: {
  predecessor: SourceVersion;
  current: SourceVersion;
  references?: Reference[];
}) {
  const rows = useMemo(
    () => revisionRows(predecessor.text, current.text),
    [predecessor.text, current.text],
  );
  return (
    <section
      className="revision-comparison"
      aria-label="Compare source revisions"
    >
      <h3>What changed in the source</h3>
      {rows.coarse && (
        <p className="quiet">
          Large revision: highlighted regions may include unchanged lines.
        </p>
      )}
      <div className="revision-columns">
        {(
          [
            [predecessor, rows.before, "Explicit predecessor"],
            [current, rows.after, "Selected revision"],
          ] as const
        ).map(([version, lines, label]) => (
          <section key={version.id}>
            <h4>
              {label} · version {version.number}
            </h4>
            <div
              className="revision-text"
              tabIndex={0}
              role="region"
              aria-label={`${label} text`}
            >
              {lines.map((line) => (
                <div
                  key={line.start}
                  className={
                    line.changed ? "revision-line changed" : "revision-line"
                  }
                >
                  {line.changed && (
                    <span className="sr-only">
                      {rows.coarse ? "Comparison region: " : "Changed line: "}
                    </span>
                  )}
                  <span className="revision-words">{line.text || "\n"}</span>
                  {line.changed && line.text.length > 0 && (
                    <div className="revision-links">
                      <Link
                        href={`/app/sources/${version.sourceId}?version=${version.id}&start=${line.start}&end=${line.start + line.text.length}`}
                      >
                        Open passage · v{version.number} <Arrow />
                      </Link>
                      {references
                        .filter(
                          (reference) =>
                            reference.versionId === version.id &&
                            reference.start < line.start + line.text.length &&
                            reference.end > line.start,
                        )
                        .map((reference) =>
                          reference.href.startsWith("#") ? (
                            <a
                              key={`${reference.href}:${reference.start}`}
                              href={reference.href}
                            >
                              {reference.label} <Arrow />
                            </a>
                          ) : (
                            <Link
                              key={`${reference.href}:${reference.start}`}
                              href={reference.href}
                            >
                              {reference.label} <Arrow />
                            </Link>
                          ),
                        )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
