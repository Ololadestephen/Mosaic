import postgres from "postgres";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function migrate(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(682051006)`;
      await tx`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
      const applied = await tx<
        { name: string; hash: string }[]
      >`SELECT name, hash FROM schema_migrations`;
      const files = (await readdir(new URL("../migrations/", import.meta.url)))
        .filter((name) => name.endsWith(".sql"))
        .sort((left, right) => left.localeCompare(right));
      for (const name of files) {
        const text = await readFile(
          new URL(`../migrations/${name}`, import.meta.url),
          "utf8",
        );
        const hash = createHash("sha256").update(text).digest("hex");
        const existing = applied.find((row) => row.name === name);
        if (existing && existing.hash !== hash)
          throw new Error(
            `Applied migration ${name} has changed. Restore it and add a new migration.`,
          );
        if (existing) continue;
        await tx.unsafe(text);
        await tx`INSERT INTO schema_migrations (name, hash) VALUES (${name}, ${hash})`;
      }
    });
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("scripts/migrate.ts")) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  await migrate(process.env.DATABASE_URL);
  console.log("Migrations applied.");
}
