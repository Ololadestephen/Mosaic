// Operator tool for private one-click access links. Only a link's hash is stored; a new link is written to a new
// owner-only file so it never reaches terminal or CI logs. Sessions started from a link end no later than the link.
// Usage (DATABASE_URL and APP_ORIGIN set):
//   node --conditions=react-server --import tsx scripts/access-link.ts issue <email> <expires-YYYY-MM-DD> <out-file>
//   node --conditions=react-server --import tsx scripts/access-link.ts revoke <email>
import { writeFile } from "node:fs/promises";
import { issueAccessLink, revokeAccess } from "../src/server/auth/accounts";
import { closeDatabase, db } from "../src/server/db/client";

const [command, email, expires, out] = process.argv.slice(2);
const usage =
  "Usage: access-link.ts issue <email> <expires-YYYY-MM-DD> <out-file> | revoke <email>";
if (
  !email ||
  !(
    (command === "issue" && out && /^\d{4}-\d{2}-\d{2}$/.test(expires ?? "")) ||
    command === "revoke"
  )
)
  throw new Error(usage);
try {
  const [user] = await db()<
    { id: string }[]
  >`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
  if (!user) throw new Error("No account uses that email.");
  if (command === "revoke") {
    const removed = await revokeAccess(user.id);
    console.log(`Access revoked: removed ${removed} link and session records.`);
  } else {
    const origin = new URL(process.env.APP_ORIGIN ?? "").origin;
    const token = await issueAccessLink(
      user.id,
      new Date(`${expires}T23:59:59Z`),
    );
    await writeFile(out, `${origin}/access#${token}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    console.log(`Access link written to ${out}; it expires ${expires}.`);
  }
} finally {
  await closeDatabase();
}
