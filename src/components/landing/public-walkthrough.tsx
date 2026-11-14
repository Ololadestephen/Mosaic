"use client";

import { useState } from "react";

export function PublicWalkthrough() {
  const [selected, setSelected] = useState(false);
  const [applied, setApplied] = useState(false);

  return (
    <section
      id="walkthrough"
      className="landing-walkthrough"
      aria-labelledby="walkthrough-title"
    >
      <div>
        <h2 id="walkthrough-title">Try a review</h2>
        <p>
          In July 2024, CISA updated its CrowdStrike outage alert with new
          recommendations. Try reviewing one of those changes.
        </p>
        <a href="https://www.cisa.gov/news-events/alerts/2024/07/19/widespread-it-outage-due-to-crowdstrike-update">
          Read the CISA alert
        </a>
      </div>
      <div className="walkthrough-card">
        <p className="walkthrough-label">CISA update · July 26, 2024</p>
        <blockquote>“Block malicious domains.”</blockquote>
        <label className="walkthrough-choice">
          <input
            type="checkbox"
            checked={selected}
            disabled={applied}
            onChange={(event) => setSelected(event.target.checked)}
          />
          <span>
            <strong>Block malicious domains</strong>
            <small>Proposed new task</small>
          </span>
        </label>
        {applied ? (
          <>
            <p role="status">Demo receipt · Task created with status To do.</p>
            <button
              type="button"
              onClick={() => {
                setApplied(false);
                setSelected(false);
              }}
            >
              Undo demo change
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={!selected}
            onClick={() => setApplied(true)}
          >
            Apply selected change
          </button>
        )}
        <small className="walkthrough-label">
          Public walkthrough · changes stay on this page
        </small>
      </div>
    </section>
  );
}
