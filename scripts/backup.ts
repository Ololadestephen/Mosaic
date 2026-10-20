import { mkdir, writeFile } from "node:fs/promises";
import { logicalBackup } from "../src/server/db/backup";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const backup = await logicalBackup(process.env.DATABASE_URL);
await mkdir(".local/backups", { recursive: true, mode: 0o700 });
const path = `.local/backups/mosaic-${new Date().toISOString().replaceAll(":", "-")}.json`;
await writeFile(path, JSON.stringify(backup), { mode: 0o600, flag: "wx" });
console.log(
  `Consistent local backup saved to ${path}. It contains private account and workspace data; keep it on this Mac.`,
);
