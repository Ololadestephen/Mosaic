// Operator tool for the sign-in-free app. Builds one shared workspace from two source revisions and a task list,
// through the same server functions the app uses, and makes the visitor account its only editor.
// Usage (DATABASE_URL set), via node --conditions=react-server --import tsx scripts/open-app.ts:
//   seed <workspace-name> <source-title> <before.txt> <after.txt> <tasks.json>
// tasks.json is an array of { "title": string }. Prints the visitor account ID for OPEN_APP_ACCOUNT_ID and
// AI_ALLOWED_ACCOUNT_IDS. Running it again builds a fresh workspace and moves the visitor there (a reset); the
// previous workspace stays with the owner account. Neither account has a usable password.
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "../src/domain/zod";
import { hashPassword } from "../src/server/auth/password";
import { closeDatabase, db } from "../src/server/db/client";
import { addRevision, createSource } from "../src/server/sources";
import { createTask } from "../src/server/tasks";
import { createWorkspace, setMember } from "../src/server/workspaces";

const owner = { email: "open-app-owner@mosaic.invalid", name: "Mosaic demo" };
const visitor = { email: "open-app-visitor@mosaic.invalid", name: "Visitor" };

async function account({ email, name }: { email: string; name: string }) {
  const hash = await hashPassword(randomBytes(32).toString("base64url"));
  const [user] = await db()<{ id: string }[]>`
    INSERT INTO users (id, email, name, password_hash) VALUES (${randomUUID()}, ${email}, ${name}, ${hash})
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`;
  return { userId: user.id };
}

async function seed(
  name: string,
  title: string,
  before: string,
  after: string,
  tasksFile: string,
) {
  const tasks = z
    .array(z.object({ title: z.string() }))
    .min(1)
    .parse(JSON.parse(await readFile(tasksFile, "utf8")));
  const actor = await account(owner);
  const guest = await account(visitor);
  const workspace = await createWorkspace(actor, { name });
  const source = await createSource(actor, workspace.id, {
    title,
    text: await readFile(before, "utf8"),
  });
  await addRevision(actor, workspace.id, source.sourceId, {
    predecessorId: source.versionId,
    text: await readFile(after, "utf8"),
  });
  for (const task of tasks)
    await createTask(
      actor,
      workspace.id,
      { title: task.title, status: "todo", assigneeId: null, dueDate: null },
      randomUUID(),
    );
  await db()`DELETE FROM memberships WHERE user_id = ${guest.userId}`;
  await setMember(actor, workspace.id, {
    email: visitor.email,
    role: "editor",
  });
  console.log(`Visitor account ID: ${guest.userId}`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command !== "seed" || args.length !== 5)
    throw new Error(
      "Usage: open-app.ts seed <workspace-name> <source-title> <before.txt> <after.txt> <tasks.json>",
    );
  const [name, title, before, after, tasks] = args;
  await seed(name, title, before, after, tasks);
} finally {
  await closeDatabase();
}
