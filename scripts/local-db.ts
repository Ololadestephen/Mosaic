import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { migrate } from "./migrate";
import { z } from "zod";

if (process.env.NODE_ENV === "production")
  throw new Error("The project-local database is for development only.");
await mkdir(".local", { recursive: true });
const configPath = resolve(".local/database.json");
async function localConfiguration(): Promise<{
  password: string;
  port: number;
}> {
  if (!existsSync(configPath))
    return { password: randomBytes(24).toString("hex"), port: 55432 };
  try {
    return z
      .object({
        password: z.string().regex(/^[a-f0-9]{48}$/),
        port: z.number().int().min(1024).max(65535),
      })
      .strict()
      .parse(JSON.parse(await readFile(configPath, "utf8")));
  } catch {
    throw new Error(
      "The saved local database configuration is unreadable. Preserve .local/database.json and repair it before restarting; no credentials were replaced.",
    );
  }
}
const local = await localConfiguration();
await writeFile(configPath, JSON.stringify(local), { mode: 0o600 });
const pg = new EmbeddedPostgres({
  databaseDir: resolve(".local/postgres"),
  user: "mosaic",
  password: local.password,
  port: local.port,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1", "-k", resolve(".local")],
  onLog: () => {},
  onError: () => {},
});
if (!existsSync(".local/postgres/PG_VERSION")) await pg.initialise();
await pg.start();
const base = `postgresql://mosaic:${local.password}@127.0.0.1:${local.port}`;
const admin = postgres(`${base}/postgres`, { max: 1 });
for (const name of ["mosaic", "mosaic_test"]) {
  const existing =
    await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (!existing.length) await admin.unsafe(`CREATE DATABASE ${name}`);
}
await admin.end();
const databaseUrl = `${base}/mosaic`;
if (!existsSync(".env.local"))
  await writeFile(
    ".env.local",
    `DATABASE_URL=${databaseUrl}\nAPP_ORIGIN=http://localhost:3000\nAI_ENABLED=false\n`,
    { mode: 0o600 },
  );
await writeFile(".local/test.env", `TEST_DATABASE_URL=${base}/mosaic_test\n`, {
  mode: 0o600,
});
await migrate(databaseUrl);
console.log(
  `Local PostgreSQL is ready on 127.0.0.1:${local.port}. Environment saved locally. Keep this process running.`,
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});
