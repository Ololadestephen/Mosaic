// Deterministic provider fixture, never a live-AI claim or production import.
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { prepareDatabase } from "../integration/helpers";
import { signIn } from "../../src/server/auth/accounts";
import { createWorkspace } from "../../src/server/workspaces";
import { createTask } from "../../src/server/tasks";
import { createSource } from "../../src/server/sources";
import { closeDatabase } from "../../src/server/db/client";
await prepareDatabase();
const ownerEmail = `${randomUUID()}@mosaic.test`;
const password = "synthetic-analysis-handoff-passphrase";
const owner = await signIn(
  { name: "Mock analysis owner", email: ownerEmail, password },
  true,
);
const actor = { userId: owner.account.id };
const workspace = await createWorkspace(actor, {
  name: "Explicit mocked analysis browser lane",
});
const created = await createTask(
  actor,
  workspace.id,
  {
    title: "Synthetic untouched task",
    status: "todo",
    assigneeId: null,
    dueDate: null,
  },
  randomUUID(),
);
const text =
  "SYNTHETIC PROVIDER FIXTURE. Discuss the launch date before changing tasks.";
const source = await createSource(actor, workspace.id, {
  title: "Explicit mocked analysis source",
  text,
  visibility: "workspace",
});
await writeFile(
  ".local/evidence/browser-analysis-fixture.json",
  JSON.stringify({
    sourceVersionId: source.versionId,
    output: {
      items: [
        {
          kind: "decision",
          key: "review",
          statement: "Discuss the launch date",
          needsReview: true,
          reason: "Synthetic provider fixture",
          impact: "Review only",
          citations: [{ sourceVersionId: source.versionId, quote: text }],
        },
      ],
      questions: [],
      preserved: ["Existing work remains unchanged."],
    },
  }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    workspaceId: workspace.id,
    sourceId: source.sourceId,
    sourceVersionId: source.versionId,
    taskId: created.taskIds[0],
    ownerEmail,
    password,
  }),
);
await closeDatabase();
