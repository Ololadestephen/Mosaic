import type { AnalysisOutput } from "@/domain/contracts";

export const APP_FIXTURE_SOURCE_TITLE =
  "Public event rules - submission deadline";
export const APP_FIXTURE_TASK_TITLE =
  "Submit Mosaic to TestSprite Hackathon S4";
export const APP_FIXTURE_RELATED_TASK_TITLE = "Completed and unrelated work";
export const APP_FIXTURE_CREATED_TASK_TITLE =
  "Prepare PR link + live URL + account email";
export const APP_FIXTURE_DEADLINE_QUOTE = "Oct 22 · Day 7 · 11:59 PM PT";
const APP_FIXTURE_SUBMISSION_QUOTE =
  "PR link + live URL + account email, posted in Discord by the deadline.";
export const APP_FIXTURE_SOURCE_TEXT = [
  "Public event rules - TestSprite Hackathon Season 4 (accessed 2026-10-21).",
  "Source: https://www.testsprite.com/hackathon-s4",
  "",
  `"${APP_FIXTURE_DEADLINE_QUOTE}" — Project submissions close.`,
  `"${APP_FIXTURE_SUBMISSION_QUOTE}"`,
  '"All times Pacific · final schedule confirmed in Discord."',
  "",
  "Quoted for a deterministic product demo; not live AI.",
].join("\n");
export const APP_FIXTURE_QUESTION = "Who will post the submission in Discord?";
const APP_FIXTURE_PRESERVED = "Completed and unrelated work remains completed.";

export function appFixtureWorkspaceName(sha: string, run: string): string {
  const safeRun = run.replace(/[^0-9A-Za-z._-]/g, "-").slice(0, 48);
  return `App verification fixture ${sha.slice(0, 8)} ${safeRun}`;
}

export function appFixtureProposal(
  taskId: string,
  sourceVersionId: string,
): AnalysisOutput {
  const citation = (quote: string) => {
    const start = APP_FIXTURE_SOURCE_TEXT.indexOf(quote);
    if (start < 0) throw new Error(`Fixture quote is missing: ${quote}`);
    return {
      sourceVersionId,
      start,
      end: start + quote.length,
      quote,
    };
  };
  const deadline = citation(APP_FIXTURE_DEADLINE_QUOTE);
  const submission = citation(APP_FIXTURE_SUBMISSION_QUOTE);
  return {
    items: [
      {
        key: "date",
        kind: "update",
        taskId,
        expectedRevision: 1,
        field: "dueDate",
        value: "2026-10-22",
        reason: "The public event rules close submissions on 22 October 2026.",
        impact:
          "Updates the task's synthetic planning date to the published close date.",
        citations: [deadline],
      },
      {
        key: "status",
        kind: "update",
        taskId,
        expectedRevision: 1,
        field: "status",
        value: "in_progress",
        reason:
          "Synthetic status suggestion for human review; the deadline quote does not establish task progress.",
        impact: "Starts the submission work.",
        citations: [deadline],
      },
      {
        key: "submission",
        kind: "create",
        title: APP_FIXTURE_CREATED_TASK_TITLE,
        fields: { status: "todo", dueDate: null, assigneeId: null },
        reason:
          "The public rules require a PR link, live URL, and account email.",
        impact: "Creates a cited submission task.",
        citations: [submission],
      },
    ],
    questions: [APP_FIXTURE_QUESTION],
    preserved: [APP_FIXTURE_PRESERVED],
  };
}
