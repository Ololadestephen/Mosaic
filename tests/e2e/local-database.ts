import { readFile } from "node:fs/promises";

export async function localTestDatabaseUrl(
  configured: string | undefined,
  readLocal = () => readFile(".local/test.env", "utf8"),
) {
  const raw =
    configured ?? (await readLocal()).trim().replace(/^TEST_DATABASE_URL=/, "");
  const url = new URL(raw);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  )
    throw new Error("Only the isolated local test database is allowed.");
  return raw;
}
