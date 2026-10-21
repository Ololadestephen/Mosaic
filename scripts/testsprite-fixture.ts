// Deterministic synthetic fixture for the required TestSprite workflow.
// This operator script writes only to the isolated PR preview database.
import { createHash } from "node:crypto";
import postgres from "postgres";

const PREVIEW_HOST =
  "ep-aged-pine-b89lqmhc-pooler.c-14.us-east-1.aws.neon.tech";
const PREVIEW_DATABASE = "/mosaic_pr1_test";
const PREVIEW_USER = "mosaic_pr1_runtime";

export function fixtureIds(run: string, sha: string) {
  const make = (name: string) => {
    const hex = createHash("sha256")
      .update(`mosaic-testsprite-fixture:${sha}:${run}:${name}`)
      .digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  return {
    workspaceId: make("workspace"),
    sourceId: make("source"),
    versionId: make("version"),
    taskId: make("task"),
    relatedTaskId: make("related-task"),
    changeSetId: make("change-set"),
  };
}

function previewDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is invalid.");
  }
  if (
    url.hostname !== PREVIEW_HOST ||
    url.pathname !== PREVIEW_DATABASE ||
    url.username !== PREVIEW_USER ||
    !url.password
  )
    throw new Error("Refusing to seed a non-preview database.");
  return url.href;
}

async function main() {
  const run = process.env.FIXTURE_RUN?.trim();
  const sha = process.env.SHA?.trim().toLowerCase();
  const ownerEmail = process.env.FIXTURE_OWNER_EMAIL?.trim().toLowerCase();
  if (!run || !/^[0-9A-Za-z._-]{1,100}$/.test(run))
    throw new Error("FIXTURE_RUN is required.");
  if (!sha || !/^[0-9a-f]{40}$/.test(sha))
    throw new Error("SHA must be a 40-character commit hash.");
  if (!ownerEmail || !/^[^@\s]+@[^@\s]+$/.test(ownerEmail))
    throw new Error("FIXTURE_OWNER_EMAIL is required.");

  const ids = fixtureIds(run, sha);
  const sql = postgres(previewDatabaseUrl(), {
    max: 1,
    onnotice: () => {},
    connect_timeout: 15,
  });
  try {
    const result = await sql.begin(async (tx) => {
      const [owner] = await tx<{ id: string }[]>`
        SELECT id FROM users WHERE email = ${ownerEmail}`;
      if (!owner)
        throw new Error("The fixture owner account does not exist in preview.");
      const [existing] = await tx`
        SELECT id FROM workspaces WHERE id = ${ids.workspaceId}`;
      if (existing) return { seeded: false };

      const text =
        "FICTIONAL TEST BRIEF. Launch on 22 October 2026. Prepare the product photos by 19 October 2026. Begin launch preparation now.";
      const contentHash = createHash("sha256").update(text).digest("hex");
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

      await tx`INSERT INTO workspaces (id, name, created_by) VALUES (${ids.workspaceId}, ${`Synthetic TestSprite fixture ${sha.slice(0, 8)} ${run}`}, ${owner.id})`;
      await tx`INSERT INTO memberships (workspace_id, user_id, role) VALUES (${ids.workspaceId}, ${owner.id}, 'owner')`;
      await tx`INSERT INTO tasks (id, workspace_id, title, status, due_date) VALUES (${ids.taskId}, ${ids.workspaceId}, 'Prepare the fictional launch', 'todo', '2026-10-20')`;
      await tx`INSERT INTO tasks (id, workspace_id, title, status, due_date) VALUES (${ids.relatedTaskId}, ${ids.workspaceId}, 'Completed and unrelated work', 'done', NULL)`;
      await tx`INSERT INTO sources (id, workspace_id, owner_id, title, visibility) VALUES (${ids.sourceId}, ${ids.workspaceId}, ${owner.id}, 'Labelled deterministic test brief', 'workspace')`;
      await tx`INSERT INTO source_versions (id, workspace_id, source_id, number, text, content_hash, created_by) VALUES (${ids.versionId}, ${ids.workspaceId}, ${ids.sourceId}, 1, ${text}, ${contentHash}, ${owner.id})`;
      await tx`INSERT INTO change_sets (id, workspace_id, source_version_id, created_by, items, questions, preserved) VALUES (${ids.changeSetId}, ${ids.workspaceId}, ${ids.versionId}, ${owner.id}, ${tx.json(items)}, ${tx.json(questions)}, ${tx.json(preserved)})`;
      return { seeded: true };
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
  } finally {
    await sql.end();
  }
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
