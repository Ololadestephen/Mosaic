// Deterministic test data only: one account, one workspace and a private access link.
import { randomUUID } from "node:crypto";
import { prepareDatabase } from "../integration/helpers";
import { issueAccessLink, signIn } from "../../src/server/auth/accounts";
import { createWorkspace } from "../../src/server/workspaces";
import { closeDatabase } from "../../src/server/db/client";

await prepareDatabase();
const { account } = await signIn(
  {
    name: "Link reviewer",
    email: `${randomUUID()}@mosaic.test`,
    password: "disposable-link-test-passphrase",
  },
  true,
);
const workspace = await createWorkspace(
  { userId: account.id },
  { name: "Access link workspace" },
);
const token = await issueAccessLink(
  account.id,
  new Date(Date.now() + 24 * 60 * 60 * 1000),
);
console.log(JSON.stringify({ token, workspaceId: workspace.id }));
await closeDatabase();
