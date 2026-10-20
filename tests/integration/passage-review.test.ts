import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { account, prepareDatabase, workspace } from "./helpers";
import { closeDatabase, db } from "@/server/db/client";
import { inWorkspace } from "@/server/auth/authorization";
import { digest } from "@/server/auth/accounts";
import { analysisContext, saveProposal } from "@/server/reconciliation";
import { addRevision, createSource, getSource } from "@/server/sources";
import { applyProposal } from "@/server/execution";
import { editTask, getTask, listTasks } from "@/server/tasks";
import { workspaceData } from "@/server/workspace-data";
import { setMember } from "@/server/workspaces";
import type { Actor, ProposalItem } from "@/domain/contracts";

beforeAll(prepareDatabase);
afterAll(closeDatabase);

const original = "Alpha launch. Confirm the supplier by Friday. Beta notes.";
const quote = "Confirm the supplier by Friday.";

async function citedTask(text = original) {
  const owner = await workspace();
  const source = await createSource(owner.actor, owner.workspaceId, {
    title: "Passage review brief",
    text,
    visibility: "workspace",
  });
  const start = text.indexOf(quote);
  const applied = await propose(
    owner.actor,
    owner.workspaceId,
    source.versionId,
    [
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
        reason: "The brief names the supplier date.",
        impact: "Creates the supplier task.",
      },
    ],
  );
  return {
    ...owner,
    sourceId: source.sourceId,
    versionId: source.versionId,
    taskId: applied.taskIds[0],
    start,
  };
}

async function propose(
  actor: Actor,
  workspaceId: string,
  sourceVersionId: string,
  items: ProposalItem[],
) {
  const draft = await inWorkspace(actor, workspaceId, "write", async (tx) =>
    saveProposal(
      tx,
      actor,
      workspaceId,
      await analysisContext(tx, actor, workspaceId, sourceVersionId),
      { items, questions: [], preserved: ["Unrelated work stays."] },
    ),
  );
  return applyProposal(actor, workspaceId, {
    changeSetId: draft.id,
    expectedRevision: 1,
    selectedKeys: items.map((item) => item.key),
    operationKey: randomUUID(),
  });
}

describe("supporting passage review signal", () => {
  it("flags an explicit later edit or removal without writing the task", async () => {
    const owner = await citedTask();
    const before = await getTask(owner.actor, owner.workspaceId, owner.taskId);
    expect(before.revision).toBe(1);
    expect(before.evidence[0]?.passageChange).toBeNull();

    await addRevision(owner.actor, owner.workspaceId, owner.sourceId, {
      text: `Preface. ${original}`,
      predecessorId: owner.versionId,
    });
    expect(
      (await getTask(owner.actor, owner.workspaceId, owner.taskId)).evidence[0]
        ?.passageChange,
    ).toBeNull();

    const edited = await addRevision(
      owner.actor,
      owner.workspaceId,
      owner.sourceId,
      {
        text: original.replace("Friday", "Monday"),
        predecessorId: (
          await getSource(owner.actor, owner.workspaceId, owner.sourceId)
        ).latestVersionId,
      },
    );
    const flagged = await getTask(owner.actor, owner.workspaceId, owner.taskId);
    expect(flagged.revision).toBe(1);
    expect(flagged.status).toBe("todo");
    expect(flagged.evidence[0]?.passageChange).toBe("edited");
    expect(flagged.evidence[0]?.laterVersionNumber).toBe(3);
    const board = await workspaceData(owner.actor, owner.workspaceId);
    expect(board.passageReviewTaskIds).toEqual([owner.taskId]);
    const source = await getSource(
      owner.actor,
      owner.workspaceId,
      owner.sourceId,
    );
    expect(source.passageReviews).toMatchObject([
      {
        taskId: owner.taskId,
        laterVersionId: edited.versionId,
        change: "edited",
      },
    ]);

    await editTask(
      owner.actor,
      owner.workspaceId,
      owner.taskId,
      { status: "in_progress", expectedRevision: 1 },
      randomUUID(),
    );
    const afterEdit = await getTask(
      owner.actor,
      owner.workspaceId,
      owner.taskId,
    );
    expect(afterEdit.revision).toBe(2);
    expect(afterEdit.evidence[0]?.passageChange).toBe("edited");

    await addRevision(owner.actor, owner.workspaceId, owner.sourceId, {
      text: "Alpha launch. Beta notes.",
      predecessorId: edited.versionId,
    });
    expect(
      (await getTask(owner.actor, owner.workspaceId, owner.taskId)).evidence[0]
        ?.passageChange,
    ).toBe("removed");
    expect((await listTasks(owner.actor, owner.workspaceId))[0]?.revision).toBe(
      2,
    );
  });

  it("hides private evidence and ignores a latest version that does not descend from the citation", async () => {
    const owner = await workspace();
    const source = await createSource(owner.actor, owner.workspaceId, {
      title: "Private brief",
      text: original,
      visibility: "private",
    });
    const revised = await addRevision(
      owner.actor,
      owner.workspaceId,
      source.sourceId,
      {
        text: `${original} Extra note.`,
        predecessorId: source.versionId,
      },
    );
    const start = `${original} Extra note.`.indexOf(quote);
    const applied = await propose(
      owner.actor,
      owner.workspaceId,
      revised.versionId,
      [
        {
          key: "private",
          kind: "create",
          title: "Private supplier task",
          fields: { status: "todo", assigneeId: null, dueDate: null },
          citations: [
            {
              sourceVersionId: revised.versionId,
              start,
              end: start + quote.length,
              quote,
            },
          ],
          reason: "Private evidence",
          impact: "Private",
        },
      ],
    );
    const viewer = await account("Viewer");
    await setMember(owner.actor, owner.workspaceId, {
      email: viewer.account.email,
      role: "viewer",
    });
    const detached = "This side revision does not continue the cited version.";
    await db()`INSERT INTO source_versions (workspace_id, source_id, predecessor_id, number, text, content_hash, created_by) VALUES (${owner.workspaceId}, ${source.sourceId}, ${source.versionId}, 3, ${detached}, ${digest(detached)}, ${owner.actor.userId})`;
    expect(
      (await getTask(owner.actor, owner.workspaceId, applied.taskIds[0]))
        .evidence[0]?.passageChange,
    ).toBeNull();
    expect(
      (await workspaceData(viewer.actor, owner.workspaceId))
        .passageReviewTaskIds,
    ).toEqual([]);
    await expect(
      getSource(viewer.actor, owner.workspaceId, source.sourceId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
