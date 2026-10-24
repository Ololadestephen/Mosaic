import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const sha = "d".repeat(40);
const notBefore = "2026-10-24T08:00:00Z";
let root: string;
let state: string;

// A stand-in CLI: stored code lives in <state>/<id>.py; run results come from <state>/run-<id>.json.
const fakeCli = `
import json, os, sys
state = os.environ["FAKE_STATE"]
args = [a for a in sys.argv[1:] if a not in ("--output", "json")]
def stored(i):
    path = os.path.join(state, i + ".py")
    return open(path).read() if os.path.exists(path) else ""
if args[:3] == ["test", "code", "get"]:
    i = args[3]
    version = open(os.path.join(state, i + ".version")).read() if os.path.exists(os.path.join(state, i + ".version")) else "v1"
    print(json.dumps({"testId": i, "code": stored(i), "codeVersion": version}))
elif args[:3] == ["test", "code", "put"]:
    i = args[3]
    if os.path.exists(os.path.join(state, "refuse-put")):
        sys.exit(6)
    prefix = open(os.path.join(state, "preamble")).read() if os.path.exists(os.path.join(state, "preamble")) else ""
    open(os.path.join(state, i + ".py"), "w").write(prefix + open(args[args.index("--code-file") + 1]).read().rstrip("\\n"))
    open(os.path.join(state, i + ".version"), "w").write("v2")
    print(json.dumps({"ok": True}))
elif args[:2] == ["test", "run"]:
    i = args[2]
    run = json.load(open(os.path.join(state, "run-" + i + ".json")))
    heal = os.path.join(state, "heal-" + i)
    if os.path.exists(heal):
        open(os.path.join(state, i + ".py"), "w").write("healed")
    print(json.dumps(run))
    sys.exit(0 if run.get("status") == "passed" else 1)
`;

function writeRun(id: string, overrides: Record<string, unknown> = {}) {
  writeFileSync(
    join(state, `run-${id}.json`),
    JSON.stringify({
      runId: `run-${id}`,
      testId: id,
      status: "passed",
      startedAt: "2026-10-24T08:01:00Z",
      ...overrides,
    }),
  );
}

function suite(
  tests: Record<string, string> = { "a.py": "t-a", "b.py": "t-b" },
) {
  return spawnSync(
    "python3",
    ["-I", "scripts/testsprite/api-suite.py", sha, notBefore, root],
    {
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH,
        FAKE_STATE: state,
        TESTSPRITE_CLI: `python3 ${join(root, "fake_cli.py")}`,
        TESTSPRITE_API_DIR: join(root, "api"),
        TESTSPRITE_API_TESTS: JSON.stringify(tests),
      },
    },
  );
}

const publicPreamble = [
  "# Auto-injected credentials — redacted for security; set TESTSPRITE_AUTH_CREDENTIAL to run this locally",
  '__AUTH_CREDENTIAL__ = __import__("os").environ.get("TESTSPRITE_AUTH_CREDENTIAL", "")',
  '__AUTH_TYPE__ = "public"',
  "__EXTRA_HEADERS__ = {}",
  "__AUTH_HEADERS__ = {}",
  "",
].join("\n");

const summary = () =>
  JSON.parse(readFileSync(join(root, "testsprite-api-summary.json"), "utf8"));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mosaic-api-suite-"));
  state = join(root, "state");
  mkdirSync(state);
  mkdirSync(join(root, "api"));
  writeFileSync(join(root, "fake_cli.py"), fakeCli);
  writeFileSync(join(root, "api", "a.py"), "assert True\n");
  writeFileSync(join(root, "api", "b.py"), "assert 1 == 1\n");
  writeRun("t-a");
  writeRun("t-b");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("TestSprite API suite runner", () => {
  it("uploads the reviewed files and records fresh passing runs", () => {
    const result = suite();
    expect(result.status).toBe(0);
    expect(readFileSync(join(state, "t-a.py"), "utf8")).toBe("assert True");
    expect(summary()).toMatchObject({
      commit: sha,
      target: "production",
      passed: true,
    });
    expect(summary().runs.map((run: { runId: string }) => run.runId)).toEqual([
      "run-t-a",
      "run-t-b",
    ]);
  });

  it.each([
    ["a failed test", () => writeRun("t-a", { status: "failed" })],
    ["a result for another test", () => writeRun("t-a", { testId: "t-b" })],
    [
      "a result from before this attempt",
      () => writeRun("t-a", { startedAt: "2026-10-24T07:59:00Z" }),
    ],
    [
      "a result without a start time",
      () => writeRun("t-a", { startedAt: null }),
    ],
    [
      "code changed during the run",
      () => writeFileSync(join(state, "heal-t-a"), ""),
    ],
  ])("fails closed on %s", (_label, corrupt) => {
    corrupt();
    expect(suite().status).toBe(1);
    expect(summary().passed).toBe(false);
  });

  it("accepts TestSprite's public preamble and dropped final newline", () => {
    writeFileSync(join(state, "preamble"), publicPreamble);
    expect(suite().status).toBe(0);
    expect(
      readFileSync(join(state, "t-a.py"), "utf8").startsWith(publicPreamble),
    ).toBe(true);
  });

  it("rejects stored code that carries credentials or extra headers", () => {
    writeFileSync(
      join(state, "preamble"),
      publicPreamble.replace(
        "__EXTRA_HEADERS__ = {}",
        '__EXTRA_HEADERS__ = {"x": "y"}',
      ),
    );
    const result = suite();
    expect(result.status).toBe(1);
    expect(summary().problems[0]).toContain("does not match the reviewed file");
  });

  it("refuses a test list that does not match the reviewed files", () => {
    const result = suite({ "a.py": "t-a" });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("passed");
  });

  it("fails without uploading when the stored code cannot be replaced", () => {
    writeFileSync(join(state, "refuse-put"), "");
    expect(suite().status).toBe(1);
  });

  it("covers exactly the reviewed API test files in the workflow", () => {
    const workflow = readFileSync(
      ".github/workflows/testsprite-api.yml",
      "utf8",
    );
    expect(workflow).toContain("python3 scripts/testsprite/api-suite.py");
    expect(workflow).toContain("https://trymosaic.vercel.app");
    for (const file of [
      "health_and_headers.py",
      "origin_guard.py",
      "session_boundaries.py",
      "sign_in_contract.py",
    ])
      expect(readFileSync(`tests/testsprite-api/${file}`, "utf8")).toContain(
        'BASE_URL = "https://trymosaic.vercel.app"',
      );
  });
});
