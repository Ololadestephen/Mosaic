"use client";

import { useEffect, useRef } from "react";

export function SourcePassage({
  text,
  versionId,
  start,
  end,
  highlighted,
}: {
  text: string;
  versionId: string;
  start: number;
  end: number;
  highlighted: boolean;
}) {
  const passage = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!highlighted) return;
    passage.current?.focus({ preventScroll: true });
    passage.current?.scrollIntoView({ block: "center" });
  }, [highlighted, versionId, start, end]);
  return (
    <pre>
      {highlighted ? (
        <>
          {text.slice(0, start)}
          <mark ref={passage} tabIndex={-1} aria-label="Cited source passage">
            {text.slice(start, end)}
          </mark>
          {text.slice(end)}
        </>
      ) : (
        text
      )}
    </pre>
  );
}
