import { mkdir, writeFile } from "node:fs/promises";
import { fixtureIds } from "./seed-preview";
import { parseArgs } from "node:util";
import {
  APP_FIXTURE_CREATED_TASK_TITLE,
  APP_FIXTURE_DEADLINE_QUOTE,
  APP_FIXTURE_QUESTION,
  APP_FIXTURE_SOURCE_TEXT,
  APP_FIXTURE_SOURCE_TITLE,
  APP_FIXTURE_TASK_TITLE,
  appFixtureWorkspaceName,
} from "../../tests/fixtures/app-verification";

type PlanStep = { type: "action" | "assertion"; description: string };

const PROJECT_ID = "d9585a5d-bab0-438b-bda7-b6a9353aec2c";
import {
  APP_MANUAL_TASK as MANUAL_TASK,
  APP_MANUAL_SOURCE as MANUAL_SOURCE,
  APP_MANUAL_V1 as MANUAL_V1,
  APP_MANUAL_V2 as MANUAL_V2,
} from "../../tests/fixtures/app-manual-revision";

function sessionPlan(workspace: string, sha: string): PlanStep[] {
  return [
    {
      type: "action",
      description:
        "Navigate to `/api/health` on the deployed preview origin and read the JSON response.",
    },
    {
      type: "assertion",
      description: `Verify the JSON reports status \`ready\` and commit \`${sha}\`.`,
    },
    {
      type: "action",
      description:
        "Navigate to `/login` and sign in with the existing fixture owner credentials.",
    },
    {
      type: "assertion",
      description:
        "Verify the authenticated workspace opens with heading `A clear view of what’s next.`.",
    },
    {
      type: "action",
      description: `Open the \`Active workspace\` dropdown and select the exact option named \`${workspace}\`.`,
    },
    {
      type: "assertion",
      description: `Verify the board remains visible and the top bar shows \`${workspace}\`.`,
    },
    { type: "action", description: "Refresh the page." },
    {
      type: "assertion",
      description:
        "Verify the same workspace remains selected and the authenticated board is still visible.",
    },
    { type: "action", description: "Click `Sign out`." },
    {
      type: "assertion",
      description: "Verify the public home page is shown.",
    },
    { type: "action", description: "Navigate to `/app`." },
    {
      type: "assertion",
      description:
        "Verify the protected workspace redirects to the public sign-in page.",
    },
  ];
}

function taskSourcePlan(workspace: string): PlanStep[] {
  return [
    {
      type: "action",
      description: `Sign in with the fixture owner credentials and select workspace \`${workspace}\`.`,
    },
    { type: "action", description: "On Board, click `Add task`." },
    {
      type: "action",
      description: `In \`Add a task\`, fill Task title \`${MANUAL_TASK}\`, Status \`In progress\`, Due date \`2026-11-05\`, leave Visibility \`Workspace\`, and click \`Create task\`.`,
    },
    {
      type: "action",
      description: `Click the task link \`${MANUAL_TASK}\` to open its detail.`,
    },
    {
      type: "assertion",
      description:
        "Verify Status is `In progress`, Due date is `2026-11-05`, the manual-task note is present, and history says the task was created.",
    },
    { type: "action", description: "Refresh the page." },
    {
      type: "assertion",
      description:
        "Verify the task detail still shows Status `In progress` and Due date `2026-11-05`.",
    },
    {
      type: "action",
      description:
        "Close the dialog, open Sources, and click `Bring a source`.",
    },
    {
      type: "action",
      description: `Fill Source title \`${MANUAL_SOURCE}\`, Source text \`${MANUAL_V1}\`, leave Visibility \`Workspace\`, and click \`Save source\`.`,
    },
    {
      type: "assertion",
      description: `Verify the source heading \`${MANUAL_SOURCE}\`, \`Immutable source · Version 1\`, and the exact v1 text.`,
    },
    {
      type: "action",
      description: `Click \`Add revision\`, fill \`Revised source\` with \`${MANUAL_V2}\`, and click \`Save revision\`.`,
    },
    {
      type: "assertion",
      description:
        "Verify `Version 2 · explicit revision` is selected and the exact v2 text is shown.",
    },
    {
      type: "action",
      description:
        "Select `Version 1 · original` from the `Source revision` control.",
    },
    {
      type: "assertion",
      description:
        "Verify the exact v1 text is still shown unchanged and the historical revision notice is visible.",
    },
    {
      type: "action",
      description:
        "Select `Version 2 · explicit revision` and refresh the page.",
    },
    {
      type: "assertion",
      description:
        "Verify Version 2 remains selected and the exact v2 text persists.",
    },
  ];
}

function reviewPlan(workspace: string, changeSetId: string): PlanStep[] {
  return [
    {
      type: "action",
      description: `Sign in with the fixture owner credentials and select workspace \`${workspace}\`.`,
    },
    {
      type: "action",
      description: `Open \`Changes\` and click the proposal card containing \`Source proposal · ${changeSetId.slice(0, 8)}\`.`,
    },
    {
      type: "assertion",
      description: `Verify heading \`Consider the change.\`, label \`Deterministic test fixture · not live AI\`, question \`${APP_FIXTURE_QUESTION}\`, and preserved text \`Completed and unrelated work remains completed.\``,
    },
    {
      type: "action",
      description: "Open `Source used for this proposal`.",
    },
    {
      type: "assertion",
      description: `Verify the source includes \`${APP_FIXTURE_DEADLINE_QUOTE}\` and the URL \`https://www.testsprite.com/hackathon-s4\`.`,
    },
    {
      type: "action",
      description: "Click the first `Exact source passage` link.",
    },
    {
      type: "assertion",
      description: `Verify the highlighted passage contains \`${APP_FIXTURE_DEADLINE_QUOTE}\`.`,
    },
    { type: "action", description: "Go back to the proposal." },
    {
      type: "action",
      description: `Check only the checkboxes labeled \`Select ${APP_FIXTURE_TASK_TITLE}: date\` and \`Select ${APP_FIXTURE_CREATED_TASK_TITLE}: submission\`; leave \`Select ${APP_FIXTURE_TASK_TITLE}: status\` unchecked.`,
    },
    {
      type: "assertion",
      description:
        "Verify exactly two proposal items are selected and the status checkbox remains unchecked.",
    },
    {
      type: "action",
      description: "Click `Apply selected changes`.",
    },
    {
      type: "assertion",
      description: `Verify \`2 items committed.\` and \`Persistence verified.\`; the Applied changes receipt shows dueDate \`2026-10-20 → 2026-10-22\` and New task \`${APP_FIXTURE_CREATED_TASK_TITLE}\`.`,
    },
    { type: "action", description: "Refresh the page." },
    {
      type: "assertion",
      description:
        "Verify `Applied proposal` and the Applied changes receipt persist.",
    },
    {
      type: "action",
      description: `Open Board and click \`${APP_FIXTURE_TASK_TITLE}\`.`,
    },
    {
      type: "assertion",
      description:
        "Verify Status is `To do` (untouched), Due date is `2026-10-22`, and Revision is `2`.",
    },
    {
      type: "action",
      description: `Open the evidence link \`${APP_FIXTURE_SOURCE_TITLE} · v1\` and verify the highlighted passage.`,
    },
    {
      type: "action",
      description:
        "Go back, set Due date to `2026-10-24`, and click `Save changes`.",
    },
    {
      type: "assertion",
      description: "Verify Revision 3 and Due date `2026-10-24`.",
    },
    {
      type: "action",
      description:
        "Set Due date back to `2026-10-22` and click `Save changes`.",
    },
    {
      type: "assertion",
      description: "Verify Revision 4 and Due date `2026-10-22`.",
    },
    {
      type: "action",
      description:
        "Close the dialog, open Activity, find the applied proposal article with `Inspect source proposal`, and click `Preview safe undo`.",
    },
    {
      type: "assertion",
      description:
        "Verify the undo preview says `A later edit or archive protects this work.`",
    },
    {
      type: "action",
      description: "Click `Undo eligible changes`.",
    },
    {
      type: "assertion",
      description:
        "Verify `1 fields restored or tasks archived.`, `1 conflicts preserved.`, and `Persistence verified.`",
    },
    {
      type: "action",
      description: "Close the dialog and open Board.",
    },
    {
      type: "assertion",
      description: `Verify \`${APP_FIXTURE_CREATED_TASK_TITLE}\` is no longer visible, \`Completed and unrelated work\` remains, and \`${APP_FIXTURE_TASK_TITLE}\` remains To do.`,
    },
    {
      type: "action",
      description: `Open \`${APP_FIXTURE_TASK_TITLE}\`.`,
    },
    {
      type: "assertion",
      description:
        "Verify Due date remains `2026-10-22`, Status remains `To do`, and Revision remains 4.",
    },
  ];
}

function validate(value: string, pattern: RegExp, name: string) {
  if (!pattern.test(value)) throw new Error(`${name} is invalid.`);
  return value;
}

const { values } = parseArgs({
  options: {
    sha: { type: "string" },
    run: { type: "string" },
    "change-set": { type: "string" },
    out: { type: "string", default: ".local/evidence/app-verification/plans" },
    project: { type: "string", default: PROJECT_ID },
  },
  strict: true,
});
const sha = validate(
  values.sha?.trim().toLowerCase() ?? "",
  /^[0-9a-f]{40}$/,
  "SHA",
);
const run = validate(
  values.run?.trim() ?? "",
  /^[0-9A-Za-z._-]{1,100}$/,
  "FIXTURE_RUN",
);
const changeSetId = validate(
  values["change-set"]?.trim() ?? "",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "Change set ID",
);
const out = values.out;
if (!out) throw new Error("Output directory is required.");
const workspace = appFixtureWorkspaceName(sha, run);
const session = sessionPlan(workspace, sha);
const taskSource = taskSourcePlan(workspace);
const review = reviewPlan(workspace, changeSetId);
await mkdir(out, { recursive: true });
await writeFile(
  `${out}/expectations.json`,
  JSON.stringify(
    {
      sha,
      workspace,
      workspaceId: fixtureIds(run, sha, "mosaic-testsprite-app-fixture")
        .workspaceId,
      manualV1: MANUAL_V1,
      manualV2: MANUAL_V2,
      deadlineQuote: APP_FIXTURE_DEADLINE_QUOTE,
      createdTaskTitle: APP_FIXTURE_CREATED_TASK_TITLE,
    },
    null,
    2,
  ),
);
const names = {
  session: "UI: exact SHA, session persistence, and sign-out",
  taskSource: "UI: manual task and immutable source revision persist",
  review: "UI: review, selected apply, receipt, conflict-aware undo",
};
const descriptions = {
  session:
    "Portal-native browser check at the deployed commit: verify /api/health reports the exact injected SHA and ready status, sign in to the fresh App verification workspace, refresh, and confirm session persistence and protected-route denial after sign-out. No live AI.",
  taskSource:
    "Portal-native browser check: create a manual task and a two-version source in the fresh App verification workspace, verify exact contents and that version 1 remains immutable after version 2, and confirm persistence after refresh. No live AI.",
  review:
    "Portal-native browser check on the labelled deterministic fixture: review the attributed public-event proposal, select only due date and created task, apply, verify the receipt and untouched status, make a later due-date edit, then undo and confirm the later edit is preserved while eligible work is restored and the new task archived. No live AI.",
};
await writeFile(
  `${out}/plan-session.json`,
  JSON.stringify({ planSteps: session }, null, 2),
);
await writeFile(
  `${out}/plan-task-source.json`,
  JSON.stringify({ planSteps: taskSource }, null, 2),
);
await writeFile(
  `${out}/plan-review-create.json`,
  JSON.stringify(
    {
      projectId: values.project,
      type: "frontend",
      name: names.review,
      description: descriptions.review,
      priority: "p1",
      planSteps: review,
    },
    null,
    2,
  ),
);
await writeFile(
  `${out}/plan-review-put.json`,
  JSON.stringify({ planSteps: review }, null, 2),
);
await writeFile(
  `${out}/manifest.json`,
  JSON.stringify(
    {
      projectId: values.project,
      sha,
      run,
      workspace,
      changeSetId,
      sourceTitle: APP_FIXTURE_SOURCE_TITLE,
      sourceText: APP_FIXTURE_SOURCE_TEXT,
      names,
      descriptions,
      liveAi: false,
    },
    null,
    2,
  ),
);
process.stdout.write(
  JSON.stringify(
    {
      out,
      sha,
      run,
      workspace,
      changeSetId,
      files: {
        session: `${out}/plan-session.json`,
        taskSource: `${out}/plan-task-source.json`,
        reviewCreate: `${out}/plan-review-create.json`,
        reviewPut: `${out}/plan-review-put.json`,
        manifest: `${out}/manifest.json`,
      },
    },
    null,
    2,
  ) + "\n",
);
