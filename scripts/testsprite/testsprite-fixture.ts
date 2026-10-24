// Deterministic synthetic fixture for the required TestSprite workflow.
import {
  fixtureEnvironment,
  fixtureIds,
  seedPreviewFixture,
} from "./seed-preview";
async function main() {
  const { run, sha, ownerEmail } = fixtureEnvironment();
  const ids = fixtureIds(run, sha);
  const text =
    "FICTIONAL TEST BRIEF. Launch on 22 October 2026. Prepare the product photos by 19 October 2026. Begin launch preparation now.";
  const citation = {
    sourceVersionId: ids.versionId,
    start: 0,
    end: text.length,
    quote: text,
  };
  const items = [
    {
      key: "date",
      kind: "update",
      taskId: ids.taskId,
      expectedRevision: 1,
      field: "dueDate",
      value: "2026-10-22",
      reason: "The fictional source sets a launch date.",
      impact: "Moves launch preparation.",
      citations: [citation],
    },
    {
      key: "status",
      kind: "update",
      taskId: ids.taskId,
      expectedRevision: 1,
      field: "status",
      value: "in_progress",
      reason: "The fictional source asks to begin.",
      impact: "Starts preparation.",
      citations: [citation],
    },
    {
      key: "photos",
      kind: "create",
      title: "Prepare fictional product photos",
      fields: { status: "todo", dueDate: "2026-10-19", assigneeId: null },
      reason: "Photos are required by the fictional brief.",
      impact: "Creates a cited task.",
      citations: [citation],
    },
  ];
  const questions = ["Who owns the photos?"];
  const preserved = ["Completed and unrelated work remains completed."];

  const result = await seedPreviewFixture({
    ids,
    ownerEmail,
    workspaceName: `Synthetic TestSprite fixture ${sha.slice(0, 8)} ${run}`,
    taskTitle: "Prepare the fictional launch",
    relatedTaskTitle: "Completed and unrelated work",
    sourceTitle: "Labelled deterministic test brief",
    sourceText: text,
    proposal: { items, questions, preserved },
  });
  process.stdout.write(
    JSON.stringify(
      {
        ...result,
        fixtureRun: run,
        sha,
        workspaceId: ids.workspaceId,
        sourceId: ids.sourceId,
        taskId: ids.taskId,
        changeSetId: ids.changeSetId,
        database: "mosaic_pr1_test",
        liveAi: false,
      },
      null,
      2,
    ) + "\n",
  );
}

if (process.argv[1]?.endsWith("testsprite-fixture.ts")) {
  try {
    await main();
  } catch (error) {
    console.error(
      JSON.stringify({
        stage: "testsprite-fixture-seed",
        type: error instanceof Error ? error.name : "UnknownError",
        code: (error as { code?: string }).code ?? "FIXTURE_SEED_FAILED",
      }),
    );
    process.exitCode = 1;
  }
}
