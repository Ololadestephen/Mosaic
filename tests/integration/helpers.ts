import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { migrate } from "../../scripts/migrate";
import { signIn } from "@/server/auth/accounts";
import { closeDatabase } from "@/server/db/client";
import { createWorkspace } from "@/server/workspaces";

export async function prepareDatabase() {
  await closeDatabase();
  const local = await readFile(".local/test.env", "utf8").catch(() => "");
  const url =
    process.env.TEST_DATABASE_URL ??
    local.trim().replace(/^TEST_DATABASE_URL=/, "");
  if (!url || !new URL(url).pathname.endsWith("_test"))
    throw new Error(
      "Use a dedicated database whose name ends in _test. Start npm run local:db first.",
    );
  process.env.DATABASE_URL = url;
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.AI_ENABLED = "false";
  await migrate(url);
}

export async function account(name = "Owner") {
  const email = `${randomUUID()}@mosaic.test`;
  const { account, token } = await signIn(
    { email, name, password: "local-test-password-only" },
    true,
  );
  return { actor: { userId: account.id }, account, token };
}

export async function workspace() {
  const owner = await account();
  const space = await createWorkspace(owner.actor, { name: "Test workspace" });
  return { ...owner, workspaceId: space.id };
}
