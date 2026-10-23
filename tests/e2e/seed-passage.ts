// Deterministic passage-review data only. No application route or production import.
import { randomUUID } from "node:crypto";
import { prepareDatabase } from "../integration/helpers";
import { signIn } from "../../src/server/auth/accounts";
import { createWorkspace } from "../../src/server/workspaces";
import { addRevision, createSource } from "../../src/server/sources";
import { createTask } from "../../src/server/tasks";
import { inWorkspace } from "../../src/server/auth/authorization";
import { analysisContext, saveProposal } from "../../src/server/reconciliation";
import { applyProposal } from "../../src/server/execution";
import { closeDatabase } from "../../src/server/db/client";

await prepareDatabase();
const password = "disposable-passage-review-passphrase";
const email = `${randomUUID()}@mosaic.test`;
const owner = await signIn({ name: "Passage owner", email, password }, true);
const actor = { userId: owner.account.id };
const workspace = await createWorkspace(actor, {
  name: "Passage review check",
});
const text =
  "FICTIONAL TEST BRIEF. Confirm the supplier by Friday. Beta notes stay.";
const quote = "Confirm the supplier by Friday.";
const start = text.indexOf(quote);
const source = await createSource(actor, workspace.id, {
  title: "Labelled passage brief",
  text,
});
const unrelated = await createTask(
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
const proposal = await inWorkspace(actor, workspace.id, "write", async (tx) =>
  saveProposal(
    tx,
    actor,
    workspace.id,
    await analysisContext(tx, actor, workspace.id, source.versionId),
    {
      items: [
        {
          key: "supplier",
          kind: "create",
          title: "Confirm the supplier",
          fields: { status: "todo", assigneeId: null, dueDate: null },
          citations: [
            {
              sourceVersionId: source.versionId,
              start,
              end: start + quote.length,
              quote,
            },
          ],
          reason: "The fictional brief names Friday.",
          impact: "Creates the supplier task.",
        },
      ],
      questions: [],
      preserved: ["Unrelated work stays completed."],
    },
  ),
);
const applied = await applyProposal(
  actor,
  workspace.id,
  { changeSetId: proposal.id, expectedRevision: 1, selectedKeys: ["supplier"] },
  randomUUID(),
);
const revised = await addRevision(actor, workspace.id, source.sourceId, {
  text: text.replace("Friday", "Monday"),
  predecessorId: source.versionId,
});
const revisedQuote = "Confirm the supplier by Monday.";
const revisedText = text.replace("Friday", "Monday");
const revisedStart = revisedText.indexOf(revisedQuote);
const revisedProposal = await inWorkspace(
  actor,
  workspace.id,
  "write",
  async (tx) =>
    saveProposal(
      tx,
      actor,
      workspace.id,
      await analysisContext(tx, actor, workspace.id, revised.versionId),
      {
        items: [
          {
            kind: "decision",
            key: "supplier-context",
            statement: "Supplier confirmation now uses Monday.",
            needsReview: true,
            reason:
              "The labelled fictional revision changes the supplier sentence.",
            impact: "Context only; task fields stay unchanged.",
            citations: [
              {
                sourceVersionId: revised.versionId,
                start: revisedStart,
                end: revisedStart + revisedQuote.length,
                quote: revisedQuote,
              },
            ],
          },
        ],
        questions: [],
        preserved: ["Existing task fields remain unchanged."],
      },
    ),
);
await closeDatabase();
process.stdout.write(
  JSON.stringify({
    email,
    password,
    sourceId: source.sourceId,
    changeSetId: revisedProposal.id,
    taskId: applied.taskIds[0],
    unrelatedTaskId: unrelated.taskIds[0],
  }),
);
