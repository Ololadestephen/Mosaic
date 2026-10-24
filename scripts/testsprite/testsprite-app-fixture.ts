import {
  APP_FIXTURE_CREATED_TASK_TITLE,
  APP_FIXTURE_RELATED_TASK_TITLE,
  APP_FIXTURE_SOURCE_TEXT,
  APP_FIXTURE_SOURCE_TITLE,
  APP_FIXTURE_TASK_TITLE,
  appFixtureProposal,
  appFixtureWorkspaceName,
} from "../../tests/fixtures/app-verification";
import {
  fixtureEnvironment,
  fixtureIds,
  seedPreviewFixture,
} from "./seed-preview";

async function main() {
  const { run, sha, ownerEmail } = fixtureEnvironment();
  const ids = fixtureIds(run, sha, "mosaic-testsprite-app-fixture");
  const workspaceName = appFixtureWorkspaceName(sha, run);
  const result = await seedPreviewFixture({
    ids,
    ownerEmail,
    workspaceName,
    taskTitle: APP_FIXTURE_TASK_TITLE,
    relatedTaskTitle: APP_FIXTURE_RELATED_TASK_TITLE,
    sourceTitle: APP_FIXTURE_SOURCE_TITLE,
    sourceText: APP_FIXTURE_SOURCE_TEXT,
    proposal: appFixtureProposal(ids.taskId, ids.versionId),
  });
  process.stdout.write(
    JSON.stringify(
      {
        ...result,
        fixtureRun: run,
        sha,
        workspaceName,
        workspaceId: ids.workspaceId,
        sourceId: ids.sourceId,
        taskId: ids.taskId,
        changeSetId: ids.changeSetId,
        createdTaskTitle: APP_FIXTURE_CREATED_TASK_TITLE,
        database: "mosaic_pr1_test",
        liveAi: false,
      },
      null,
      2,
    ) + "\n",
  );
}

if (process.argv[1]?.endsWith("testsprite-app-fixture.ts")) {
  try {
    await main();
  } catch (error) {
    console.error(
      JSON.stringify({
        stage: "testsprite-app-fixture-seed",
        type: error instanceof Error ? error.name : "UnknownError",
        code: (error as { code?: string }).code ?? "FIXTURE_SEED_FAILED",
      }),
    );
    process.exitCode = 1;
  }
}
