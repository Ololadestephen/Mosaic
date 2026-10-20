import postgres from "postgres";

const tables = [
  "users",
  "workspaces",
  "memberships",
  "sources",
  "source_versions",
  "tasks",
  "task_evidence",
  "change_sets",
  "analysis_runs",
  "execution_batches",
  "change_events",
  "decisions",
] as const;
type BackupTable = (typeof tables)[number];
export type Backup = {
  format: "mosaic-logical-v1";
  createdAt: string;
  migrations: { name: string; hash: string }[];
  tables: Record<BackupTable, Record<string, unknown>[]>;
};

export async function logicalBackup(url: string): Promise<Backup> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return (await sql.begin(
      "isolation level repeatable read read only",
      async (tx) => {
        const migrations = await tx<
          { name: string; hash: string }[]
        >`SELECT name, hash FROM schema_migrations ORDER BY name`;
        const data = {} as Backup["tables"];
        for (const table of tables) {
          const rows = await tx<
            { data: Record<string, unknown> }[]
          >`SELECT to_jsonb(t) AS data FROM ${tx(table)} t`;
          data[table] = rows.map((row) => row.data);
        }
        // Session tokens and rate-limit buckets are deliberately not restored.
        return {
          format: "mosaic-logical-v1" as const,
          createdAt: new Date().toISOString(),
          migrations: Array.from(migrations),
          tables: data,
        };
      },
    )) as Backup;
  } finally {
    await sql.end();
  }
}

export async function restoreTestBackup(url: string, backup: Backup) {
  if (!new URL(url).pathname.endsWith("_restore_test"))
    throw new Error("Restore requires a new database ending in _restore_test.");
  if (backup.format !== "mosaic-logical-v1")
    throw new Error("Unsupported backup format.");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      const current = await tx<
        { name: string; hash: string }[]
      >`SELECT name, hash FROM schema_migrations ORDER BY name`;
      if (JSON.stringify(current) !== JSON.stringify(backup.migrations))
        throw new Error("Restore migrations do not match this backup.");
      for (const table of tables) {
        const [row] = await tx<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM ${tx(table)}`;
        if (row.count)
          throw new Error(
            "Restore target must be empty. No existing data was replaced.",
          );
      }
      for (const table of tables) {
        const rows = [...backup.tables[table]];
        if (table === "source_versions")
          rows.sort((a, b) => Number(a.number) - Number(b.number));
        if (table === "execution_batches")
          rows.sort(
            (a, b) =>
              Number(a.target_batch_id !== null) -
              Number(b.target_batch_id !== null),
          );
        // Individual insertion respects immutable-source predecessor and undo-batch references.
        for (const row of rows)
          await tx`INSERT INTO ${tx(table)} SELECT * FROM jsonb_populate_record(NULL::${tx(table)}, ${tx.json(row as postgres.JSONValue)})`;
      }
    });
  } finally {
    await sql.end();
  }
}
