import { describe, expect, it } from "vitest";
import {
  APP_FIXTURE_CREATED_TASK_TITLE,
  APP_FIXTURE_QUESTION,
  APP_FIXTURE_SOURCE_TEXT,
  APP_FIXTURE_TASK_TITLE,
  appFixtureProposal,
  appFixtureWorkspaceName,
} from "../fixtures/app-verification";
import { fixtureIds } from "../../scripts/testsprite/seed-preview";

const SHA = "24d8e80efd54221b46ec782856f5b2ba611ca823";

describe("App verification fixture", () => {
  it("creates a unique, bounded workspace name for each run", () => {
    const name = appFixtureWorkspaceName(SHA, "github-123-1");
    expect(name).toBe("App verification fixture 24d8e80e github-123-1");
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).not.toBe(appFixtureWorkspaceName(SHA, "github-123-2"));
    expect(appFixtureWorkspaceName(SHA, "a/b c")).not.toContain("/");
  });

  it("keeps citations inside the attributed public source", () => {
    const proposal = appFixtureProposal("task-id", "version-id");
    expect(proposal.items).toHaveLength(3);
    expect(new Set(proposal.items.map((item) => item.key))).toEqual(
      new Set(["date", "status", "submission"]),
    );
    for (const item of proposal.items)
      for (const citation of item.citations) {
        expect(citation.sourceVersionId).toBe("version-id");
        expect(
          APP_FIXTURE_SOURCE_TEXT.slice(citation.start, citation.end),
        ).toBe(citation.quote);
      }
    expect(proposal.items.find((item) => item.kind === "create")?.title).toBe(
      APP_FIXTURE_CREATED_TASK_TITLE,
    );
    expect(proposal.questions).toEqual([APP_FIXTURE_QUESTION]);
    expect(APP_FIXTURE_TASK_TITLE).toContain("TestSprite");
  });

  it("isolates App fixture IDs from the strict workflow fixture", () => {
    const app = fixtureIds(
      "github-123-1",
      SHA,
      "mosaic-testsprite-app-fixture",
    );
    const strict = fixtureIds("github-123-1", SHA);
    expect(app).not.toEqual(strict);
    expect(app).toEqual(
      fixtureIds("github-123-1", SHA, "mosaic-testsprite-app-fixture"),
    );
    expect(new Set(Object.values(app)).size).toBe(6);
  });
});

import {
  verifyAppFixture,
  type AppFixtureState,
} from "../../scripts/testsprite/verify-testsprite-app-fixture";
import {
  APP_FIXTURE_RELATED_TASK_TITLE,
  APP_FIXTURE_SOURCE_TITLE,
} from "../fixtures/app-verification";

function completedFixture(): AppFixtureState {
  const changes = [
    {
      taskId: "parent",
      field: "dueDate",
      before: "2026-10-20",
      after: "2026-10-22",
    },
    {
      taskId: "created",
      field: "created",
      before: null,
      after: APP_FIXTURE_CREATED_TASK_TITLE,
    },
  ];
  const batches: AppFixtureState["batches"] = [
    {
      id: "apply",
      operation: "apply",
      targetId: null,
      changes,
      result: { batchId: "apply", count: 2, verification: "pending" },
    },
    {
      id: "edit-one",
      operation: "edit",
      targetId: null,
      changes: [
        {
          taskId: "parent",
          field: "dueDate",
          before: "2026-10-22",
          after: "2026-10-24",
        },
      ],
      result: { batchId: "edit-one", count: 1, verification: "pending" },
    },
    {
      id: "edit-two",
      operation: "edit",
      targetId: null,
      changes: [
        {
          taskId: "parent",
          field: "dueDate",
          before: "2026-10-24",
          after: "2026-10-22",
        },
      ],
      result: { batchId: "edit-two", count: 1, verification: "pending" },
    },
    {
      id: "undo",
      operation: "undo",
      targetId: "apply",
      changes: [
        {
          taskId: "created",
          field: "created",
          before: APP_FIXTURE_CREATED_TASK_TITLE,
          after: null,
        },
      ],
      result: {
        batchId: "undo",
        count: 1,
        verification: "pending",
        outcomes: [{ outcome: "restored" }, { outcome: "conflict" }],
      },
    },
  ];
  return {
    tasks: [
      {
        id: "parent",
        title: APP_FIXTURE_TASK_TITLE,
        status: "todo",
        dueDate: "2026-10-22",
        revision: 4,
        archived: false,
        lineage: { dueDate: "edit-two" },
      },
      {
        id: "related",
        title: APP_FIXTURE_RELATED_TASK_TITLE,
        status: "done",
        dueDate: null,
        revision: 1,
        archived: false,
        lineage: {},
      },
      {
        id: "created",
        title: APP_FIXTURE_CREATED_TASK_TITLE,
        status: "todo",
        dueDate: null,
        revision: 2,
        archived: true,
        lineage: { created: "undo" },
      },
    ],
    batches,
    events: batches.flatMap((b) =>
      b.changes.map((c) => ({ ...c, batchId: b.id })),
    ),
    versions: [
      {
        title: APP_FIXTURE_SOURCE_TITLE,
        number: 1,
        text: APP_FIXTURE_SOURCE_TEXT,
      },
    ],
    analysisRuns: 0,
  };
}
describe("independent durable fixture proof", () => {
  it("reads immutable receipts and proves current lineage without inventing a persisted verification flag", () => {
    expect(verifyAppFixture(completedFixture(), false).verified).toBe(true);
  });
  it.each([
    "status",
    "lineage",
    "receipt",
    "event",
    "target",
    "source",
    "model",
    "unrelated",
    "extra",
  ])("rejects a broken %s invariant", (failure) => {
    const state = completedFixture();
    if (failure === "status") state.tasks[0].status = "in_progress";
    if (failure === "lineage") state.tasks[0].lineage.dueDate = "apply";
    if (failure === "receipt")
      state.batches[0].changes[0].before = "2026-10-19";
    if (failure === "event") state.events.pop();
    if (failure === "target") state.batches[3].targetId = "different";
    if (failure === "source") state.versions[0].text += " changed";
    if (failure === "model") state.analysisRuns = 1;
    if (failure === "unrelated") state.tasks[1].revision = 2;
    if (failure === "extra")
      state.batches.push({ ...state.batches[0], id: "extra" });
    expect(() => verifyAppFixture(state, false)).toThrow();
  });
  it("requires the manual task and both original source revisions for the combined native suite", () => {
    expect(() => verifyAppFixture(completedFixture())).toThrow();
  });
  it("retains and checks pre-existing task-creation receipts separately", () => {
    const state = completedFixture();
    const baseline: AppFixtureState = {
      ...structuredClone(state),
      batches: [
        {
          id: "seed-receipt",
          operation: "create",
          targetId: null,
          changes: [],
          result: {
            batchId: "seed-receipt",
            count: 1,
            verification: "pending",
          },
        },
      ],
      events: [],
    };
    state.batches.push(structuredClone(baseline.batches[0]));
    expect(verifyAppFixture(state, false, baseline).verified).toBe(true);
    state.batches.at(-1)!.result.count = 2;
    expect(() => verifyAppFixture(state, false, baseline)).toThrow(
      /pre-existing receipts/,
    );
  });
});
