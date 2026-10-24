import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { assertPublicPath } from "./publication-policy";
const { stdout } = await promisify(execFile)(
  "npm",
  [
    "pack",
    "--dry-run",
    "--json",
    "--ignore-scripts",
    "--cache",
    ".local/npm-cache",
  ],
  { maxBuffer: 10 * 1024 * 1024 },
);
let pack: { files: { path: string }[] }[];
try {
  pack = JSON.parse(stdout);
  if (
    !Array.isArray(pack) ||
    !Array.isArray(pack[0]?.files) ||
    !pack[0].files.length
  )
    throw new Error("No file inventory");
} catch {
  throw new Error(
    "npm returned unreadable package metadata. No package has been approved.",
  );
}
for (const file of pack[0].files) {
  assertPublicPath(file.path);
  if (file.path.startsWith("scripts/testsprite/"))
    throw new Error(
      `CI-only fixture tool in runtime source package: ${file.path}`,
    );
}
async function inspect(directory: string, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    assertPublicPath(relative);
    if (entry.isSymbolicLink())
      throw new Error(`Unaudited symlink in deployment output: ${relative}`);
    if (entry.isDirectory())
      await inspect(join(directory, entry.name), relative);
  }
}
if (!existsSync(".next/standalone"))
  throw new Error(
    "Build the app before inspecting its standalone deployment output.",
  );
await inspect(".next/standalone");
console.log(
  `Source package (${pack[0].files.length} files) and standalone build exclude internal plans, notes, evidence, scan state and runtime environment files.`,
);
