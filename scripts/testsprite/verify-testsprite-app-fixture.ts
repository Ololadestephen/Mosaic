import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { fixtureIds, previewDatabaseUrl } from "./seed-preview";
import {
  APP_FIXTURE_TASK_TITLE,
  APP_FIXTURE_RELATED_TASK_TITLE,
  APP_FIXTURE_CREATED_TASK_TITLE,
  APP_FIXTURE_SOURCE_TEXT,
  APP_FIXTURE_SOURCE_TITLE,
} from "../../tests/fixtures/app-verification";
import {
  APP_MANUAL_TASK,
  APP_MANUAL_SOURCE,
  APP_MANUAL_V1,
  APP_MANUAL_V2,
} from "../../tests/fixtures/app-manual-revision";

type Task = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  revision: number;
  archived: boolean;
  lineage: Record<string, string>;
};
type Change = {
  taskId: string;
  field: string;
  before: string | null;
  after: string | null;
};
type Batch = {
  id: string;
  operation: string;
  targetId: string | null;
  changes: Change[];
  result: {
    verification: string;
    batchId: string;
    count: number;
    outcomes?: { outcome: string }[];
  };
};
export type AppFixtureState = {
  tasks: Task[];
  batches: Batch[];
  events: {
    batchId: string;
    taskId: string;
    field: string;
    before: string | null;
    after: string | null;
  }[];
  versions: { title: string; number: number; text: string }[];
  analysisRuns: number;
};
function requireProof(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`App fixture proof failed: ${label}`);
}
export function verifyAppFixture(
  state: AppFixtureState,
  requireManual = true,
  baseline?: AppFixtureState,
) {
  if (baseline) {
    const ids = new Set(baseline.batches.map((b) => b.id));
    for (const original of baseline.batches)
      requireProof(
        JSON.stringify(state.batches.find((b) => b.id === original.id)) ===
          JSON.stringify(original),
        "pre-existing receipts unchanged",
      );
    for (const original of baseline.events)
      requireProof(
        state.events.some(
          (e) => JSON.stringify(e) === JSON.stringify(original),
        ),
        "pre-existing task events retained",
      );
    state = {
      ...state,
      batches: state.batches.filter((b) => !ids.has(b.id)),
      events: state.events.filter((e) => !ids.has(e.batchId)),
    };
  }
  requireProof(
    state.tasks.length === (requireManual ? 4 : 3),
    "exact fixture task count",
  );
  const parent = state.tasks.find((t) => t.title === APP_FIXTURE_TASK_TITLE);
  const related = state.tasks.find(
    (t) => t.title === APP_FIXTURE_RELATED_TASK_TITLE,
  );
  const created = state.tasks.find(
    (t) => t.title === APP_FIXTURE_CREATED_TASK_TITLE,
  );
  requireProof(parent && related && created, "fixture tasks");
  requireProof(
    parent.status === "todo" &&
      parent.dueDate === "2026-10-22" &&
      parent.revision === 4 &&
      !parent.archived,
    "protected later edit and unselected status",
  );
  requireProof(
    related.status === "done" &&
      related.revision === 1 &&
      !related.archived &&
      related.dueDate === null,
    "unrelated work unchanged",
  );
  requireProof(
    created.archived && created.revision === 2,
    "created task safely archived",
  );
  const apply = state.batches.filter((b) => b.operation === "apply");
  const undo = state.batches.filter((b) => b.operation === "undo");
  const edits = state.batches.filter((b) => b.operation === "edit");
  requireProof(
    apply.length === 1 && undo.length === 1 && edits.length === 2,
    "one apply, two deliberate edits, one undo",
  );
  requireProof(
    apply[0].result.batchId === apply[0].id &&
      apply[0].result.count === 2 &&
      undo[0].result.batchId === undo[0].id &&
      undo[0].result.count === 1,
    "durable receipt identities and committed counts",
  );
  const lastEdit = edits.find((b) =>
    b.changes.some(
      (c) =>
        c.taskId === parent.id &&
        c.field === "dueDate" &&
        c.before === "2026-10-24" &&
        c.after === "2026-10-22",
    ),
  );
  requireProof(
    lastEdit &&
      parent.lineage.dueDate === lastEdit.id &&
      created.lineage.created === undo[0].id,
    "persisted field lineage protects the later edit",
  );
  for (const batch of [...apply, ...edits, ...undo])
    for (const change of batch.changes)
      requireProof(
        state.events.some(
          (e) =>
            e.batchId === batch.id &&
            e.taskId === change.taskId &&
            e.field === change.field &&
            e.before === change.before &&
            e.after === change.after,
        ),
        "every stored receipt has matching durable events",
      );
  const changes = apply[0].changes;
  requireProof(
    changes.length === 2 &&
      changes.some(
        (c) =>
          c.taskId === parent.id &&
          c.field === "dueDate" &&
          c.before === "2026-10-20" &&
          c.after === "2026-10-22",
      ) &&
      changes.some(
        (c) =>
          c.taskId === created.id &&
          c.field === "created" &&
          c.before === null &&
          c.after === APP_FIXTURE_CREATED_TASK_TITLE,
      ),
    "selected before/after receipt",
  );
  requireProof(
    undo[0].targetId === apply[0].id &&
      undo[0].changes.length === 1 &&
      undo[0].changes[0].taskId === created.id &&
      undo[0].changes[0].field === "created" &&
      undo[0].changes[0].after === null,
    "undo targets original apply and only archives eligible work",
  );
  const outcomes = undo[0].result.outcomes ?? [];
  requireProof(
    outcomes.length === 2 &&
      outcomes.filter((o) => o.outcome === "restored").length === 1 &&
      outcomes.filter((o) => o.outcome === "conflict").length === 1,
    "stored partial undo outcomes",
  );
  const events = state.events.filter((e) => e.taskId === parent.id);
  requireProof(
    events.length === 3 &&
      events.every((e) => e.field === "dueDate") &&
      events.some(
        (e) => e.before === "2026-10-20" && e.after === "2026-10-22",
      ) &&
      events.some(
        (e) => e.before === "2026-10-22" && e.after === "2026-10-24",
      ) &&
      events.some((e) => e.before === "2026-10-24" && e.after === "2026-10-22"),
    "exact parent writes, including ABA edit",
  );
  requireProof(
    !state.events.some((e) => e.taskId === related.id),
    "no unrelated writes",
  );
  requireProof(
    state.batches.length === (requireManual ? 5 : 4),
    "no extra execution batches",
  );
  requireProof(
    state.events.filter((e) => e.taskId === created.id).length === 2,
    "only create and archive events for the selected new task",
  );
  requireProof(
    state.versions.length === (requireManual ? 3 : 1),
    "exact source revision count",
  );
  const source = state.versions.filter(
    (v) => v.title === APP_FIXTURE_SOURCE_TITLE,
  );
  requireProof(
    source.length === 1 &&
      source[0].number === 1 &&
      source[0].text === APP_FIXTURE_SOURCE_TEXT,
    "original attributed source unchanged",
  );
  requireProof(state.analysisRuns === 0, "no model runs");
  if (requireManual) {
    const manual = state.tasks.find((t) => t.title === APP_MANUAL_TASK);
    requireProof(
      manual?.status === "in_progress" &&
        manual.dueDate === "2026-11-05" &&
        manual.revision === 1 &&
        !manual.archived,
      "manual task persistence",
    );
    const versions = state.versions.filter(
      (v) => v.title === APP_MANUAL_SOURCE,
    );
    requireProof(
      versions.length === 2 &&
        versions.some((v) => v.number === 1 && v.text === APP_MANUAL_V1) &&
        versions.some((v) => v.number === 2 && v.text === APP_MANUAL_V2),
      "both exact immutable source revisions",
    );
  }
  return {
    verified: true,
    selectedApply: 2,
    safeRestores: 1,
    preservedConflicts: 1,
    unselectedStatusUntouched: true,
    liveAi: false,
  };
}
export async function readAppFixture(
  sql: ReturnType<typeof postgres>,
  workspaceId: string,
): Promise<AppFixtureState> {
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId))
    throw new Error("Invalid fixture workspace.");
  return sql.begin("read only", async (tx) => {
    const tasks = await tx<
      Task[]
    >`SELECT id,title,status,due_date::text AS "dueDate",revision,archived,lineage FROM tasks WHERE workspace_id=${workspaceId} ORDER BY id`;
    const batches = await tx<
      Batch[]
    >`SELECT id,operation,target_batch_id AS "targetId",changes,result FROM execution_batches WHERE workspace_id=${workspaceId} ORDER BY id`;
    const events = await tx<
      AppFixtureState["events"]
    >`SELECT batch_id AS "batchId",task_id AS "taskId",field,before_value AS "before",after_value AS "after" FROM change_events WHERE workspace_id=${workspaceId} ORDER BY id`;
    const versions = await tx<
      AppFixtureState["versions"]
    >`SELECT s.title,v.number,v.text FROM source_versions v JOIN sources s ON s.id=v.source_id AND s.workspace_id=v.workspace_id WHERE v.workspace_id=${workspaceId} ORDER BY v.id`;
    const [usage] = await tx<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM analysis_runs WHERE workspace_id=${workspaceId}`;
    return { tasks, batches, events, versions, analysisRuns: usage.count };
  }) as Promise<AppFixtureState>;
}
async function main() {
  const {
    SHA: sha,
    FIXTURE_RUN: run,
    APP_EVIDENCE_DIR: directory,
  } = process.env;
  if (
    !directory ||
    !sha ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    !run ||
    !/^[0-9A-Za-z._-]{1,100}$/.test(run)
  )
    throw new Error("Invalid fixture proof context.");
  const sql = postgres(previewDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    const state = await readAppFixture(
      sql,
      fixtureIds(run, sha, "mosaic-testsprite-app-fixture").workspaceId,
    );
    const summary = verifyAppFixture(state);
    await writeFile(
      `${directory}/database.json`,
      JSON.stringify({ sha, ...summary }, null, 2),
    );
    console.log("Read-only preview fixture proof passed.");
  } finally {
    await sql.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error("App fixture database proof failed; contents withheld.");
    process.exitCode = 1;
  });
}
