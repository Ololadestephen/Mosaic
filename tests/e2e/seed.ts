// Deterministic test data only. This file has no application route or production import.
import { randomUUID } from "node:crypto";
import { prepareDatabase } from "../integration/helpers";
import { signIn } from "../../src/server/auth/accounts";
import { createWorkspace, setMember } from "../../src/server/workspaces";
import { createSource } from "../../src/server/sources";
import { createTask } from "../../src/server/tasks";
import { inWorkspace } from "../../src/server/auth/authorization";
import { analysisContext, saveProposal } from "../../src/server/reconciliation";
import { closeDatabase } from "../../src/server/db/client";

await prepareDatabase();
const password = "disposable-lifecycle-test-passphrase";
const ownerEmail = `${randomUUID()}@mosaic.test`;
const editorEmail = `${randomUUID()}@mosaic.test`;
const owner = await signIn(
  { name: "Fixture owner", email: ownerEmail, password },
  true,
);
await signIn({ name: "Fixture teammate", email: editorEmail, password }, true);
const actor = { userId: owner.account.id };
const workspace = await createWorkspace(actor, {
  name: "Labelled deterministic lifecycle test",
});
await setMember(actor, workspace.id, { email: editorEmail, role: "editor" });
const created = await createTask(
  actor,
  workspace.id,
  {
    title: "Prepare the fictional launch",
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
    title: "Completed and unrelated work",
    status: "done",
    assigneeId: null,
    dueDate: null,
  },
  randomUUID(),
);
const text =
  "FICTIONAL TEST BRIEF. Launch on 22 October 2026. Prepare the product photos by 19 October 2026. Begin launch preparation now.";
const source = await createSource(actor, workspace.id, {
  title: "Labelled deterministic test brief",
  text,
});
const citation = {
  sourceVersionId: source.versionId,
  start: 0,
  end: text.length,
  quote: text,
};
const proposal = await inWorkspace(actor, workspace.id, "write", async (tx) =>
  saveProposal(
    tx,
    actor,
    workspace.id,
    await analysisContext(tx, actor, workspace.id, source.versionId),
    {
      items: [
        {
          key: "date",
          kind: "update",
          taskId: created.taskIds[0],
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
          taskId: created.taskIds[0],
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
      ],
      questions: ["Who owns the photos?"],
      preserved: ["Completed and unrelated work remains completed."],
    },
  ),
);
await closeDatabase();
process.stdout.write(
  JSON.stringify({
    workspaceId: workspace.id,
    changeSetId: proposal.id,
    taskId: created.taskIds[0],
    sourceId: source.sourceId,
    ownerEmail,
    editorEmail,
    password,
  }),
);
