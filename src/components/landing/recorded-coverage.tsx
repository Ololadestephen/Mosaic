const alert =
  "https://www.cisa.gov/news-events/alerts/2024/07/19/widespread-it-outage-due-crowdstrike-update";

type Status = "uncovered" | "covered" | "no_task_change";

// A real SERV result, recorded once through Mosaic's coverage adapter and copied here verbatim.
// Nothing on this page calls SERV. Passages are CISA's text; reasons are SERV's words.
const recorded: {
  passage: string;
  status: Status;
  tasks: string[];
  reason: string;
}[] = [
  {
    passage: "Update 12:30 p.m., EDT, July 26, 2024:",
    status: "no_task_change",
    tasks: [],
    reason: "This is just an update timestamp, not a request for work.",
  },
  {
    passage:
      "CrowdStrike’s Counter Adversary Operations blog lists various reports of malicious cyber activity leveraging last week’s outage.",
    status: "no_task_change",
    tasks: [],
    reason:
      "This is background reporting about CrowdStrike's blog and not an actionable task.",
  },
  {
    passage:
      "CISA encourages users and administrators to remain vigilant and maintain robust cybersecurity measures, including:",
    status: "no_task_change",
    tasks: [],
    reason:
      "This is an introductory sentence for guidance and does not request a specific action.",
  },
  {
    passage: "Only follow guidance from legitimate sources.",
    status: "covered",
    tasks: ["Only follow instructions from legitimate sources"],
    reason:
      'This is covered by "Only follow instructions from legitimate sources" because it asks people to follow guidance only from legitimate sources.',
  },
  {
    passage: "Block malicious domains.",
    status: "uncovered",
    tasks: [],
    reason:
      "This requests blocking malicious domains, and none of the listed tasks covers taking that blocking action.",
  },
  {
    passage:
      "Follow CrowdStrike’s recommendations to protect against the outage-related phishing activity listed in their Counter Adversary Operations reports.",
    status: "uncovered",
    tasks: [],
    reason:
      "This asks users to follow CrowdStrike's outage-related recommendations, but no listed task covers that specific follow-up action.",
  },
  {
    passage:
      "CrowdStrike also continues to provide updated information through its remediation and guidance hub.",
    status: "no_task_change",
    tasks: [],
    reason:
      "This is a status note about updated information in a guidance hub, not a work request.",
  },
];

const derivedTasks = [
  "Resolve affected Windows hosts using CrowdStrike's guidance and customer portal",
  "Remind employees to avoid clicking on phishing emails or suspicious links",
  "Only follow instructions from legitimate sources",
  "Review CrowdStrike's environment-specific guidance (Azure, AWS)",
  "Review the indicators of compromise for the malicious ZIP archive in CrowdStrike's blog",
  "Evaluate Microsoft's USB recovery tool for affected systems",
  "Apply CrowdStrike's accelerated remediation update",
  "Review CrowdStrike's list of domains impersonating the CrowdStrike brand",
];

const labels: Record<Status, string> = {
  uncovered: "Uncovered",
  covered: "Covered",
  no_task_change: "No task change",
};

export function RecordedCoverage() {
  const uncovered = recorded.filter(({ status }) => status === "uncovered");
  const ordered = [
    ...uncovered,
    ...recorded.filter(({ status }) => status !== "uncovered"),
  ];
  return (
    <section
      id="demo-coverage"
      className="landing-walkthrough"
      aria-labelledby="coverage-title"
    >
      <div>
        <h2 id="coverage-title">Check coverage with SERV</h2>
        <p>
          When CISA updated its alert on July 26, 2024, did a plan built from
          the July 24 version already handle every change? Mosaic finds the
          changed passages itself, then asks SERV Reasoning to classify each one
          as covered by a task, needing no task change, or uncovered.
        </p>
        <p>
          The server rejects any answer that skips, repeats or invents a
          passage. It can’t prove each classification is right, so a reviewer
          still decides what to do.
        </p>
        <a href={alert}>Read CISA’s alert and its updates</a>
      </div>
      <div className="walkthrough-card">
        <p className="walkthrough-label">
          Recorded result, not a live call · Nov 13, 2026 · gpt-5.4-mini through
          SERV · CISA alert text from July 24 and July 26, 2024 updates
        </p>
        <p role="status">
          <strong>
            {recorded.length} changes classified · {uncovered.length} uncovered
          </strong>
        </p>
        <ol className="coverage-list">
          {ordered.map((entry) => (
            <li key={entry.passage} data-status={entry.status}>
              <strong>{labels[entry.status]}</strong>
              <blockquote>“{entry.passage}”</blockquote>
              <p>{entry.reason}</p>
              {entry.tasks.length > 0 && (
                <p className="walkthrough-label">
                  Existing task · {entry.tasks.join(", ")}
                </p>
              )}
            </li>
          ))}
        </ol>
        <details>
          <summary>The 8 tasks it checked against</summary>
          <p>
            We derived these from the July 24 version of the alert. They are not
            a real team’s plan.
          </p>
          <ul>
            {derivedTasks.map((task) => (
              <li key={task}>{task}</li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
