import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const sha = "b".repeat(40);
const origin = "https://preview.example.test";
const scripts: Record<string, string> = {
  "test-one": "async def run_test():\n    pass\n",
  "test-two": "async def run_test():\n    assert True\n",
};
const digest = (code: string) =>
  createHash("sha256").update(code).digest("hex");
let directory: string;
let pins: string;

function writeCode(
  phase: string,
  id: string,
  code: string,
  version = `v-${id}`,
) {
  writeFileSync(
    join(directory, `code-${phase}-${id}.json`),
    JSON.stringify({ testId: id, code, codeVersion: version }),
  );
}

function writeRun(id: string, overrides: Record<string, unknown> = {}) {
  writeFileSync(
    join(directory, `testsprite-run-${id}.json`),
    JSON.stringify({
      runId: `run-${id}`,
      testId: id,
      status: "passed",
      codeVersion: null,
      replay: { path: "replay" },
      ...overrides,
    }),
  );
}

function pinsCheck(mode: "before" | "after") {
  return spawnSync(
    "python3",
    [
      "-I",
      "scripts/testsprite/strict-pins.py",
      mode,
      pins,
      directory,
      sha,
      origin,
    ],
    { encoding: "utf8" },
  );
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "mosaic-strict-pins-"));
  pins = join(directory, "pins.json");
  writeFileSync(
    pins,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(scripts).map(([id, code]) => [
          id,
          { codeVersion: `v-${id}`, sha256: digest(code) },
        ]),
      ),
    ),
  );
  for (const [id, code] of Object.entries(scripts)) {
    writeCode("before", id, code);
    writeCode("after", id, code);
    writeRun(id);
  }
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("strict TestSprite script pins", () => {
  it("accepts the reviewed scripts before a run", () => {
    expect(pinsCheck("before").status).toBe(0);
  });

  it("rejects an edited script before spending a run", () => {
    writeCode("before", "test-two", scripts["test-two"]!.replace("True", "1"));
    const result = pinsCheck("before");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("test-two");
  });

  it("rejects a changed server version even with identical code", () => {
    writeCode("before", "test-one", scripts["test-one"]!, "v-healed");
    expect(pinsCheck("before").status).toBe(1);
  });

  it("records complete evidence for passing replays of unchanged scripts", () => {
    expect(pinsCheck("after").status).toBe(0);
    const summary = JSON.parse(
      readFileSync(join(directory, "testsprite-summary.json"), "utf8"),
    );
    expect(summary).toMatchObject({
      commit: sha,
      targetOrigin: origin,
      passed: true,
    });
    expect(summary.runs).toHaveLength(2);
    expect(summary.runs[0]).toMatchObject({
      runId: "run-test-one",
      replayPath: "replay",
      reviewedSha256: digest(scripts["test-one"]!),
    });
  });

  it.each([
    [
      "a script changed during the run",
      () => writeCode("after", "test-one", "healed"),
    ],
    ["a failed case", () => writeRun("test-one", { status: "failed" })],
    [
      "an agent run instead of a replay",
      () => writeRun("test-one", { replay: { path: "agent" } }),
    ],
    ["a missing replay record", () => writeRun("test-one", { replay: null })],
    [
      "a result for another test",
      () => writeRun("test-one", { testId: "test-two" }),
    ],
    ["a missing run identity", () => writeRun("test-one", { runId: "" })],
    [
      "a missing result",
      () => rmSync(join(directory, "testsprite-run-test-one.json")),
    ],
    [
      "an unreadable saved script",
      () => rmSync(join(directory, "code-after-test-one.json")),
    ],
  ])("fails closed on %s", (_label, corrupt) => {
    corrupt();
    const result = pinsCheck("after");
    expect(result.status).toBe(1);
    const summary = JSON.parse(
      readFileSync(join(directory, "testsprite-summary.json"), "utf8"),
    );
    expect(summary.passed).toBe(false);
  });

  it("redacts preview bypass values from recorded errors", () => {
    writeRun("test-one", {
      status: "failed",
      error: "x-vercel-protection-bypass=secret-value&x=1",
    });
    pinsCheck("after");
    const text = readFileSync(
      join(directory, "testsprite-summary.json"),
      "utf8",
    );
    expect(text).not.toContain("secret-value");
  });

  it("pins exactly the four cases the workflow runs", () => {
    const workflow = readFileSync(
      ".github/workflows/testsprite-pr.yml",
      "utf8",
    );
    const ids = [
      ...workflow.matchAll(
        /TESTSPRITE_(?:AUTH|MANUAL|GUARD|FIXTURE)_ID: (\S+)/g,
      ),
    ].map((match) => match[1]);
    const reviewed = JSON.parse(
      readFileSync("scripts/testsprite/strict-pins.json", "utf8"),
    );
    expect(Object.keys(reviewed).sort()).toEqual([...ids].sort());
  });
});
