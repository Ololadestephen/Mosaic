import { randomUUID } from "node:crypto";
import { prepareDatabase } from "../integration/helpers";
import { signIn } from "../../src/server/auth/accounts";
import { createWorkspace } from "../../src/server/workspaces";
import { createSource } from "../../src/server/sources";
import { createTask } from "../../src/server/tasks";
import { inWorkspace } from "../../src/server/auth/authorization";
import { analysisContext, saveProposal } from "../../src/server/reconciliation";
import { closeDatabase } from "../../src/server/db/client";
import {
  APP_FIXTURE_RELATED_TASK_TITLE,
  APP_FIXTURE_SOURCE_TEXT,
  APP_FIXTURE_SOURCE_TITLE,
  APP_FIXTURE_TASK_TITLE,
  appFixtureProposal,
  appFixtureWorkspaceName,
} from "../fixtures/app-verification";

await prepareDatabase();
const password = "disposable-app-verification-passphrase";
const ownerEmail = `${randomUUID()}@mosaic.test`;
const run = `local-${randomUUID().slice(0, 8)}`;
const workspaceName = appFixtureWorkspaceName(
  process.env.APP_FIXTURE_SHA ?? "local",
  run,
);
const owner = await signIn(
  { name: "App fixture owner", email: ownerEmail, password },
  true,
);
const actor = { userId: owner.account.id };
const workspace = await createWorkspace(actor, { name: workspaceName });
const created = await createTask(
  actor,
  workspace.id,
  {
    title: APP_FIXTURE_TASK_TITLE,
    status: "todo",
    assigneeId: null,
    dueDate: "2026-10-20",
  },
  randomUUID(),
);
await createTask(
  actor,
  workspace.id,
  {
    title: APP_FIXTURE_RELATED_TASK_TITLE,
    status: "done",
    assigneeId: null,
    dueDate: null,
  },
  randomUUID(),
);
const source = await createSource(actor, workspace.id, {
  title: APP_FIXTURE_SOURCE_TITLE,
  text: APP_FIXTURE_SOURCE_TEXT,
});
const proposal = await inWorkspace(actor, workspace.id, "write", async (tx) =>
  saveProposal(
    tx,
    actor,
    workspace.id,
    await analysisContext(tx, actor, workspace.id, source.versionId),
    appFixtureProposal(created.taskIds[0], source.versionId),
  ),
);
await closeDatabase();
process.stdout.write(
  JSON.stringify({
    workspaceName,
    workspaceId: workspace.id,
    changeSetId: proposal.id,
    taskId: created.taskIds[0],
    sourceId: source.sourceId,
    ownerEmail,
    password,
  }),
);
