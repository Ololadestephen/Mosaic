const privateNames = new Set([
  "agents.md",
  "idea.md",
  "plan.md",
  "build.md",
  "test_plan.md",
  "decisions.md",
  "handoff.md",
  ".local",
  ".desloppify",
  ".git",
  "__pycache__",
  "pgdata",
  "backups",
  "credentials",
  ".aws",
  ".vercel",
]);

export function assertPublicPath(path: string) {
  const parts = path.replaceAll("\\", "/").toLowerCase().split("/");
  if (
    parts.some(
      (part) =>
        privateNames.has(part) ||
        (part.startsWith(".env") && part !== ".env.example") ||
        /\.(log|dump|backup|bak|sqlite|sqlite3|db|pem|key|p12|pfx|pyc)$/.test(
          part,
        ) ||
        /^(pg_version|pg_hba\.conf|pg_ident\.conf|postgresql\.conf)$/.test(
          part,
        ),
    )
  )
    throw new Error(`Private path is not publishable: ${path}`);
}
