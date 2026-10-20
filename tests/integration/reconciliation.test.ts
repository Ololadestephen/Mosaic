import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prepareDatabase, workspace, account } from "./helpers";
import { closeDatabase, db } from "@/server/db/client";
import { inWorkspace } from "@/server/auth/authorization";
import {
  analysisContext,
  editProposal,
  getProposal,
  saveProposal,
} from "@/server/reconciliation";
import { createSource, addRevision } from "@/server/sources";
import { createTask, editTask, getTask, listTasks } from "@/server/tasks";
import {
  applyProposal,
  lookupOperation,
  verifyBatch,
} from "@/server/execution";
import { compensate } from "@/server/compensation";
import { analyzeSource } from "@/server/ai/analyze";
import { setMember } from "@/server/workspaces";
import type { Actor, ProposalItem } from "@/domain/contracts";

beforeAll(prepareDatabase);
afterAll(closeDatabase);
const text =
  "Launch on 22 October 2026. Confirm the supplier by 20 October 2026.";

async function scenario(privateSource = false) {
  const owner = await workspace();
  const source = await createSource(owner.actor, owner.workspaceId, {
    title: "Deterministic test brief",
    text,
    visibility: privateSource ? "private" : "workspace",
  });
  const citation = {
    sourceVersionId: source.versionId,
    start: 0,
    end: text.length,
    quote: text,
  };
  return { ...owner, source, citation };
}

async function fixtureProposal(
  actor: Actor,
  workspaceId: string,
  sourceVersionId: string,
  items: ProposalItem[],
) {
  // This deterministic provider fixture is only used in tests. No HTTP route can inject it.
  return inWorkspace(actor, workspaceId, "write", async (tx) =>
    saveProposal(
      tx,
      actor,
      workspaceId,
      await analysisContext(tx, actor, workspaceId, sourceVersionId),
      {
        items,
        questions: ["Who owns the launch?"],
        preserved: ["Completed work stays completed."],
      },
    ),
  );
}

describe("review, apply, verify and compensation on PostgreSQL", () => {
  it("rolls back earlier writes and all journal rows when a later database write fails", async () => {
    const owner = await scenario();
    const draft = await fixtureProposal(
      owner.actor,
      owner.workspaceId,
      owner.source.versionId,
      ["First task", "Forced database failure"].map((title, index) => ({
        key: `item${index}`,
        kind: "create" as const,
        title,
        fields: { status: "todo" as const, assigneeId: null, dueDate: null },
        citations: [owner.citation],
        reason: "Fixture",
        impact: "Create",
      })),
    );
    // A real DB constraint fails after the first selected insert; no production failpoint exists.
    await db().unsafe(
      "ALTER TABLE tasks ADD CONSTRAINT test_late_failure CHECK (title <> 'Forced database failure') NOT VALID",
    );
    try {
      await expect(
        applyProposal(owner.actor, owner.workspaceId, {
          changeSetId: draft.id,
          expectedRevision: 1,
          selectedKeys: ["item0", "item1"],
          operationKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(await listTasks(owner.actor, owner.workspaceId)).toHaveLength(0);
      expect(
        (
          await db()`SELECT id FROM execution_batches WHERE workspace_id = ${owner.workspaceId}`
        ).length,
      ).toBe(0);
      expect(
        (await getProposal(owner.actor, owner.workspaceId, draft.id)).state,
      ).toBe("draft");
    } finally {
      await db().unsafe("ALTER TABLE tasks DROP CONSTRAINT test_late_failure");
    }
  });
  it("keeps review separate from writes, applies once concurrently, and recovers a lost response", async () => {
    const owner = await scenario();
    const draft = await fixtureProposal(
      owner.actor,
      owner.workspaceId,
      owner.source.versionId,
      [
        {
          key: "launch",
          kind: "create",
          title: "Launch Field Notes",
          fields: { status: "todo", assigneeId: null, dueDate: "2026-10-22" },
          citations: [owner.citation],
          reason: "The source sets a launch date.",
          impact: "Creates launch work.",
        },
      ],
    );
    expect(await listTasks(owner.actor, owner.workspaceId)).toHaveLength(0);
    const command = {
      changeSetId: draft.id,
      expectedRevision: 1,
      selectedKeys: ["launch"],
      operationKey: randomUUID(),
    };
    const [a, b] = await Promise.all([
      applyProposal(owner.actor, owner.workspaceId, command),
      applyProposal(owner.actor, owner.workspaceId, command),
    ]);
    expect(a.batchId).toBe(b.batchId);
    expect(await listTasks(owner.actor, owner.workspaceId)).toHaveLength(1);
    expect(
      (await verifyBatch(owner.actor, owner.workspaceId, a.batchId))
        .verification,
    ).toBe("verified");
    expect(
      (
        await lookupOperation(
          owner.actor,
          owner.workspaceId,
          "apply",
          command.operationKey,
        )
      ).batchId,
    ).toBe(a.batchId);
    const task = await getTask(owner.actor, owner.workspaceId, a.taskIds[0]);
    expect(task.evidence[0].quote).toBe(text);
    await expect(
      applyProposal(owner.actor, owner.workspaceId, {
        ...command,
        selectedKeys: ["other"],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await analyzeSource(owner.actor, owner.workspaceId, {
          sourceVersionId: owner.source.versionId,
        })
      ).id,
    ).toBe(draft.id);
  });
  it("rejects a stale selected item without partially applying another selected task", async () => {
    const owner = await scenario();
    const created = await createTask(
      owner.actor,
      owner.workspaceId,
      {
        title: "Existing task",
        status: "todo",
        assigneeId: null,
        dueDate: null,
      },
      randomUUID(),
    );
    const taskId = created.taskIds[0];
    const draft = await fixtureProposal(
      owner.actor,
      owner.workspaceId,
      owner.source.versionId,
      [
        {
          key: "new",
          kind: "create",
          title: "Must not partially exist",
          fields: { status: "todo", assigneeId: null, dueDate: null },
          citations: [owner.citation],
          reason: "Evidence",
          impact: "Create",
        },
        {
          key: "update",
          kind: "update",
          taskId,
          expectedRevision: 1,
          field: "dueDate",
          value: "2026-10-22",
          citations: [owner.citation],
          reason: "Evidence",
          impact: "Reschedule",
        },
      ],
    );
    await editTask(
      owner.actor,
      owner.workspaceId,
      taskId,
      { expectedRevision: 1, status: "in_progress" },
      randomUUID(),
    );
    await expect(
      applyProposal(owner.actor, owner.workspaceId, {
        changeSetId: draft.id,
        expectedRevision: 1,
        selectedKeys: ["new", "update"],
        operationKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await listTasks(owner.actor, owner.workspaceId)).toHaveLength(1);
    expect(
      (await getProposal(owner.actor, owner.workspaceId, draft.id)).state,
    ).toBe("draft");
    expect(
      (
        await db()`SELECT id FROM execution_batches WHERE change_set_id = ${draft.id}`
      ).length,
    ).toBe(0);
  });
  it("attributes human draft edits and rejects an outdated review revision", async () => {
    const owner = await scenario();
    const created = await createTask(
      owner.actor,
      owner.workspaceId,
      { title: "Schedule", status: "todo", assigneeId: null, dueDate: null },
      randomUUID(),
    );
    const draft = await fixtureProposal(
      owner.actor,
      owner.workspaceId,
      owner.source.versionId,
      [
        {
          key: "date",
          kind: "update",
          taskId: created.taskIds[0],
          expectedRevision: 1,
          field: "dueDate",
          value: "2026-10-22",
          citations: [owner.citation],
          reason: "Source date",
          impact: "Reschedule",
        },
      ],
    );
    await editProposal(owner.actor, owner.workspaceId, draft.id, {
      expectedRevision: 1,
      key: "date",
      value: "2026-10-23",
    });
    expect(
      (await getProposal(owner.actor, owner.workspaceId, draft.id)).items[0]
        .editedBy,
    ).toBe(owner.actor.userId);
    expect(
      (await listTasks(owner.actor, owner.workspaceId))[0].dueDate,
    ).toBeNull();
    await expect(
      applyProposal(owner.actor, owner.workspaceId, {
        changeSetId: draft.id,
        expectedRevision: 1,
        selectedKeys: ["date"],
        operationKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("restores eligible fields while protecting a later same-field away-and-back edit", async () => {
    const owner = await scenario();
    const teammate = await account("Editor");
    await setMember(owner.actor, owner.workspaceId, {
      email: teammate.account.email,
      role: "editor",
    });
    const created = await createTask(
      owner.actor,
      owner.workspaceId,
      {
        title: "Existing launch",
        status: "todo",
        assigneeId: null,
        dueDate: "2026-10-20",
      },
      randomUUID(),
    );
    const taskId = created.taskIds[0];
    const draft = await fixtureProposal(
      owner.actor,
      owner.workspaceId,
      owner.source.versionId,
      [
        {
          key: "date",
          kind: "update",
          taskId,
          expectedRevision: 1,
          field: "dueDate",
          value: "2026-10-22",
          citations: [owner.citation],
          reason: "New date",
          impact: "Reschedule",
        },
        {
          key: "status",
          kind: "update",
          taskId,
          expectedRevision: 1,
          field: "status",
          value: "in_progress",
          citations: [owner.citation],
          reason: "Begin",
          impact: "Start",
        },
      ],
    );
    const applied = await applyProposal(owner.actor, owner.workspaceId, {
      changeSetId: draft.id,
      expectedRevision: 1,
      selectedKeys: ["date", "status"],
      operationKey: randomUUID(),
    });
    const recorded = await getProposal(
      owner.actor,
      owner.workspaceId,
      draft.id,
    );
    expect(recorded.state).toBe("applied");
    expect(recorded.receipt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId,
          field: "dueDate",
          before: "2026-10-20",
          after: "2026-10-22",
        }),
        expect.objectContaining({
          taskId,
          field: "status",
          before: "todo",
          after: "in_progress",
        }),
      ]),
    );
    let task = await getTask(teammate.actor, owner.workspaceId, taskId);
    await editTask(
      teammate.actor,
      owner.workspaceId,
      taskId,
      { expectedRevision: task.revision, dueDate: "2026-10-24" },
      randomUUID(),
    );
    task = await getTask(teammate.actor, owner.workspaceId, taskId);
    await editTask(
      teammate.actor,
      owner.workspaceId,
      taskId,
      { expectedRevision: task.revision, dueDate: "2026-10-22" },
      randomUUID(),
    );
    const command = { batchId: applied.batchId, operationKey: randomUUID() };
    const undone = await compensate(owner.actor, owner.workspaceId, command);
    expect(
      undone.outcomes.find((outcome) => outcome.field === "dueDate")?.outcome,
    ).toBe("conflict");
    expect(
      undone.outcomes.find((outcome) => outcome.field === "status")?.outcome,
    ).toBe("restored");
    task = await getTask(owner.actor, owner.workspaceId, taskId);
    expect(task.dueDate).toBe("2026-10-22");
    expect(task.status).toBe("todo");
    expect(
      (await compensate(owner.actor, owner.workspaceId, command)).batchId,
    ).toBe(undone.batchId);
    expect(
      (
        await compensate(teammate.actor, owner.workspaceId, {
          batchId: applied.batchId,
          operationKey: randomUUID(),
        })
      ).batchId,
    ).toBe(undone.batchId);
    expect(
      (await getTask(owner.actor, owner.workspaceId, taskId)).history,
    ).toHaveLength(6);
  });
  it("archives only untouched creations and preserves later human changes", async () => {
    const owner = await scenario();
    const a = await createTask(
      owner.actor,
      owner.workspaceId,
      { title: "Untouched", status: "todo", assigneeId: null, dueDate: null },
      randomUUID(),
    );
    const b = await createTask(
      owner.actor,
      owner.workspaceId,
      { title: "Edited", status: "todo", assigneeId: null, dueDate: null },
      randomUUID(),
    );
    await editTask(
      owner.actor,
      owner.workspaceId,
      b.taskIds[0],
      { expectedRevision: 1, status: "done" },
      randomUUID(),
    );
    expect(
      (
        await compensate(owner.actor, owner.workspaceId, {
          batchId: a.batchId,
          operationKey: randomUUID(),
        })
      ).outcomes[0].outcome,
    ).toBe("restored");
    expect(
      (await getTask(owner.actor, owner.workspaceId, a.taskIds[0])).archived,
    ).toBe(true);
    expect(
      (
        await compensate(owner.actor, owner.workspaceId, {
          batchId: b.batchId,
          operationKey: randomUUID(),
        })
      ).outcomes[0].outcome,
    ).toBe("conflict");
    expect((await listTasks(owner.actor, owner.workspaceId))[0].title).toBe(
      "Edited",
    );
  });
  it("keeps private proposals, task evidence and history invisible to other members", async () => {
    const owner = await scenario(true);
    const viewer = await account("Viewer");
    await setMember(owner.actor, owner.workspaceId, {
      email: viewer.account.email,
      role: "viewer",
    });
    const draft = await fixtureProposal(
      owner.actor,
      owner.workspaceId,
      owner.source.versionId,
      [
        {
          key: "private",
          kind: "create",
          title: "Private supplier task",
          fields: { status: "todo", dueDate: null, assigneeId: null },
          citations: [owner.citation],
          reason: "Private evidence",
          impact: "Private",
        },
      ],
    );
    const applied = await applyProposal(owner.actor, owner.workspaceId, {
      changeSetId: draft.id,
      expectedRevision: 1,
      selectedKeys: ["private"],
      operationKey: randomUUID(),
    });
    await expect(
      getProposal(viewer.actor, owner.workspaceId, draft.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      getTask(viewer.actor, owner.workspaceId, applied.taskIds[0]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      verifyBatch(viewer.actor, owner.workspaceId, applied.batchId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rejects a superseded source and a newly demoted editor at apply time", async () => {
    const owner = await scenario();
    const editor = await account("Editor");
    await setMember(owner.actor, owner.workspaceId, {
      email: editor.account.email,
      role: "editor",
    });
    const draft = await fixtureProposal(
      editor.actor,
      owner.workspaceId,
      owner.source.versionId,
      [
        {
          key: "new",
          kind: "create",
          title: "Stale work",
          fields: { status: "todo", dueDate: null, assigneeId: null },
          citations: [owner.citation],
          reason: "Evidence",
          impact: "Create",
        },
      ],
    );
    await setMember(owner.actor, owner.workspaceId, {
      email: editor.account.email,
      role: "viewer",
    });
    const command = {
      changeSetId: draft.id,
      expectedRevision: 1,
      selectedKeys: ["new"],
      operationKey: randomUUID(),
    };
    await expect(
      applyProposal(editor.actor, owner.workspaceId, command),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await addRevision(owner.actor, owner.workspaceId, owner.source.sourceId, {
      predecessorId: owner.source.versionId,
      text: "Launch is paused.",
    });
    await expect(
      applyProposal(owner.actor, owner.workspaceId, command),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("reports disabled live analysis honestly without a fixture or provider call", async () => {
    const owner = await scenario();
    await expect(
      analyzeSource(owner.actor, owner.workspaceId, {
        sourceVersionId: owner.source.versionId,
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await listTasks(owner.actor, owner.workspaceId)).toHaveLength(0);
    expect(
      (
        await db()`SELECT id FROM analysis_runs WHERE workspace_id = ${owner.workspaceId}`
      ).length,
    ).toBe(0);
  });
});
