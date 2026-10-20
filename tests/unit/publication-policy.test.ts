import { describe, expect, it } from "vitest";
import { assertPublicPath } from "../../scripts/publication-policy";

describe("publication boundary", () => {
  it.each([
    "AGENTS.md",
    "nested/HANDOFF.md",
    ".local/evidence/result.json",
    ".desloppify/state.json",
    "src/.env.local",
    "backup.dump",
    "private.pem",
    "database.sqlite3",
    "pgdata/base/123",
    "secrets/credentials",
  ])("refuses private material: %s", (path) => {
    expect(() => assertPublicPath(path)).toThrow("not publishable");
  });
  it.each([
    ".env.example",
    "src/server/auth/accounts.ts",
    "migrations/001_core.sql",
    "tests/e2e/fixtures.ts",
    "README.md",
  ])("allows public source: %s", (path) => {
    expect(() => assertPublicPath(path)).not.toThrow();
  });
});
