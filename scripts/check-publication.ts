import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { assertPublicPath } from "./publication-policy";

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" });
const paths = (output: string) => output.split("\0").filter(Boolean);
const tracked = paths(git("ls-files", "-z"));
const staged = paths(git("diff", "--cached", "--name-only", "-z"));
const candidates = paths(
  git("ls-files", "--cached", "--others", "--exclude-standard", "-z"),
);
const allowedRoots = new Set([
  "src",
  "tests",
  "scripts",
  "migrations",
  "public",
  ".github",
  "README.md",
  "docs",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "tsconfig.app.json",
  "vitest.config.ts",
  "playwright.config.ts",
  "playwright.hosted.config.ts",
  "eslint.config.mjs",
  "knip.json",
  "Dockerfile",
  "vercel.json",
  ".nvmrc",
  ".gitignore",
  ".dockerignore",
  ".vercelignore",
  ".prettierignore",
  ".env.example",
]);
for (const path of [...tracked, ...staged, ...candidates]) {
  assertPublicPath(path);
  if (!allowedRoots.has(path.split("/")[0]))
    throw new Error(`Unreviewed publication root: ${path}`);
  // A link can point outside the audited tree, including ignored local material.
  try {
    if (lstatSync(path).isSymbolicLink())
      throw new Error(`Symlink is not publishable: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
// Inspect the index too: a locally deleted file can still be staged for publication.
for (const row of paths(git("ls-files", "--stage", "-z"))) {
  if (row.startsWith("120000 ") || row.startsWith("160000 "))
    throw new Error(
      "The Git index contains an unaudited symlink or submodule.",
    );
}
const sentinels = [
  "AGENTS.md",
  "IDEA.md",
  "PLAN.md",
  "BUILD.md",
  "TEST_PLAN.md",
  "DECISIONS.md",
  "HANDOFF.md",
  ".local/probe",
  ".desloppify/probe",
  ".env.local",
  "database.dump",
  "private.key",
];
for (const path of sentinels) {
  git("check-ignore", "--no-index", "--quiet", path);
}
// Reject recognizable credential literals, without printing any matched value.
const patterns = [
  /AIza[\w-]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/,
];
let localEnvironment = "";
try {
  localEnvironment = readFileSync(".env.local", "utf8");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const secretNames = ["GEMINI_API_KEY", "OPENROUTER_API_KEY", "DATABASE_URL"];
const configuredSecrets = secretNames.flatMap((name) => {
  const local = localEnvironment
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
  return [process.env[name], local].filter((value): value is string =>
    Boolean(value && value.length >= 8),
  );
});
function inspectContent(path: string, content: string) {
  if (configuredSecrets.some((secret) => content.includes(secret)))
    throw new Error(`Configured secret found in ${path}; value withheld.`);
  if (patterns.some((pattern) => pattern.test(content)))
    throw new Error(`Credential-like content in ${path}; value withheld.`);
}
for (const path of candidates) {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
    throw error;
  }
  inspectContent(path, content);
}
for (const path of tracked)
  inspectContent(`Git index: ${path}`, git("show", `:${path}`));
console.log(
  `Publication audit passed: ${tracked.length} tracked, ${staged.length} staged, ${new Set(candidates).size} candidate files. No files staged or published.`,
);
