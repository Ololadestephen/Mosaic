import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { execFileSync, spawnSync } from "node:child_process";
import { localTestDatabaseUrl } from "../e2e/local-database";
import { describe, expect, it, vi } from "vitest";
import {
  verifyNativeRun,
  verifyPlanReceipt,
  APP_TEST_IDS,
} from "../../scripts/testsprite/testsprite-app-evidence";
import { nativeAppStatus } from "../../scripts/testsprite/wait-testsprite-app";
const sha = "a".repeat(40);
const prepared = "2026-10-21T15:00:00Z";
const execution =
  "https://www.testsprite.com/dashboard-v3/o/org/projects/d9585a5d-bab0-438b-bda7-b6a9353aec2c/execution/one";
const run = {
  runId: "39f8cca3-ec85-4876-ad8e-ffac9e6134fb",
  testId: APP_TEST_IDS.session,
  status: "passed",
  source: "github_action",
  startedAt: "2026-10-21T15:01:00Z",
  codeVersion: "v3.0",
  targetUrl: `https://mosaic-git-codex-hosted-previe-7f5fea-ololade-stephens-projects.vercel.app/?expected_sha=${sha}`,
  executionUrl: `${execution}/test/39f8cca3-ec85-4876-ad8e-ffac9e6134fb`,
};
const code = {
  testId: run.testId,
  codeVersion: run.codeVersion,
  code: "synthetic export",
};
const status = {
  context: "TestSprite V3",
  state: "success",
  description: "All 3 tests passed",
  created_at: run.startedAt,
  target_url: execution,
};

describe("native App evidence identity", () => {
  it("rejects plan updates that do not acknowledge the exact step array", () => {
    const steps = [
      { type: "assertion", description: "Explicit refresh assertion" },
    ];
    const receipt = {
      testId: run.testId,
      stepCount: 1,
      updatedAt: prepared,
      planStepsHash:
        "sha256:" +
        createHash("sha256").update(JSON.stringify(steps)).digest("hex"),
    };
    expect(verifyPlanReceipt(receipt, steps, run.testId).stepCount).toBe(1);
    expect(() =>
      verifyPlanReceipt({ ...receipt, stepCount: 2 }, steps, run.testId),
    ).toThrow();
    expect(() =>
      verifyPlanReceipt(
        { ...receipt, planStepsHash: "wrong" },
        steps,
        run.testId,
      ),
    ).toThrow();
  });
  it("generates exact plans and expectations into a new output directory without remote access", () => {
    const root = mkdtempSync(join(tmpdir(), "mosaic-offline-plan-"));
    try {
      const out = join(root, "new", "plans");
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/testsprite/testsprite-app-plans.ts",
          "--sha",
          sha,
          "--run",
          "offline-unit",
          "--change-set",
          "11111111-1111-4111-8111-111111111111",
          "--out",
          out,
        ],
        { stdio: "pipe" },
      );
      const expected = JSON.parse(
        readFileSync(join(out, "expectations.json"), "utf8"),
      );
      expect(expected.sha).toBe(sha);
      expect(expected.workspaceId).toMatch(/^[a-f0-9-]{36}$/);
      expect(expected.manualV2).toContain("SYNTHETIC TEST ONLY");
      expect(
        JSON.parse(readFileSync(join(out, "plan-review-put.json"), "utf8"))
          .planSteps,
      ).toHaveLength(29);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("accepts a fresh matching native run and code version", () => {
    expect(
      verifyNativeRun(run, code, run.testId, sha, prepared, execution).source,
    ).toBe("github_action");
  });
  it.each([
    { source: "cli" },
    { startedAt: "2026-10-21T14:00:00Z" },
    { status: "blocked" },
    { targetUrl: "https://example.com" },
    { targetUrl: run.targetUrl.replace(sha, "b".repeat(40)) },
    { executionUrl: `${execution}-different/test/${run.runId}` },
  ])("rejects stale, redirected or unrelated runs: %j", (changes) => {
    expect(() =>
      verifyNativeRun(
        { ...run, ...changes },
        code,
        run.testId,
        sha,
        prepared,
        execution,
      ),
    ).toThrow();
  });
  it("rejects code from another version and an invalid preparation time", () => {
    expect(() =>
      verifyNativeRun(
        run,
        { ...code, codeVersion: "v2.0" },
        run.testId,
        sha,
        prepared,
        execution,
      ),
    ).toThrow();
    expect(() =>
      verifyNativeRun(run, code, run.testId, sha, "invalid", execution),
    ).toThrow();
  });
  it("ignores historical passes and rejects an old two-test success", () => {
    expect(
      nativeAppStatus(
        [{ ...status, created_at: "2026-10-21T14:00:00Z" }],
        prepared,
      ),
    ).toBe("pending");
    expect(() =>
      nativeAppStatus(
        [{ ...status, description: "All 2 tests passed" }],
        prepared,
      ),
    ).toThrow();
    expect(nativeAppStatus([status], prepared)).toBe("passed");
    expect(() =>
      nativeAppStatus([{ ...status, state: "failure" }], prepared),
    ).toThrow();
  });
});

const workflow = readFileSync(
  ".github/workflows/testsprite-app-ui.yml",
  "utf8",
);
const guard = workflow
  .split("script: |\n")[1]
  .split("\n      - uses: actions/checkout")[0]
  .split("\n")
  .map((line) => line.replace(/^ {12}/, ""))
  .join("\n");
const trusted = {
  state: "open",
  base: { ref: "main", repo: { full_name: "Ololadestephen/Mosaic" } },
  head: {
    sha,
    ref: "codex/hosted-preview-security-tests",
    repo: { full_name: "Ololadestephen/Mosaic" },
  },
};
async function authorize(
  pr: unknown,
  event = "workflow_dispatch",
  input = "1",
  eventSha = sha,
  ref = "refs/heads/main",
) {
  const outputs: Record<string, string> = {};
  await runInNewContext(`(async () => {${guard}\n})()`, {
    context: {
      repo: { owner: "Ololadestephen", repo: "Mosaic" },
      eventName: event,
      ref,
      payload: {
        inputs: { pr: input },
        pull_request: { number: 1, head: { sha: eventSha } },
      },
    },
    github: { rest: { pulls: { get: async () => ({ data: pr }) } } },
    core: {
      setOutput: (key: string, value: string) => {
        outputs[key] = value;
      },
    },
  });
  return outputs;
}
describe("actual workflow trust guard", () => {
  it("accepts trusted dispatch and PR events using the live head", async () => {
    expect(await authorize(trusted)).toEqual({ sha });
    expect(await authorize(trusted, "pull_request")).toEqual({ sha });
    expect(workflow).toContain("vars.MOSAIC_NATIVE_APP_APPROVED == 'true'");
    expect(workflow).not.toMatch(/test run|pull_request_target/);
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain(
      "FIXTURE_OWNER_EMAIL: ${{ vars.MOSAIC_NATIVE_APP_OWNER_EMAIL }}",
    );
    expect(workflow).not.toContain("secrets.TESTSPRITE_FIXTURE_OWNER_EMAIL");
    expect(workflow).toContain('if [ "$PREPARATION_RESULT" != success ]');
  });
  it("rejects forks, arbitrary dispatch refs/numbers and stale events", async () => {
    await expect(
      authorize({
        ...trusted,
        head: { ...trusted.head, repo: { full_name: "fork/Mosaic" } },
      }),
    ).rejects.toThrow();
    await expect(
      authorize(trusted, "workflow_dispatch", "2"),
    ).rejects.toThrow();
    await expect(
      authorize(trusted, "workflow_dispatch", "1", sha, "refs/heads/untrusted"),
    ).rejects.toThrow();
    await expect(
      authorize(trusted, "pull_request", "1", "b".repeat(40)),
    ).rejects.toThrow();
    await expect(authorize({ ...trusted, state: "closed" })).rejects.toThrow();
  });
});

describe("generated Python export audit", () => {
  const expectations = {
    sha,
    workspace: "fresh workspace",
    manualV1: "SYNTHETIC old",
    manualV2: "SYNTHETIC new",
    deadlineQuote: "exact deadline quote",
    createdTaskTitle: "created synthetic task",
  };
  const valid = `async def run_test():\n await page.goto('/api/health')\n await expect(page.locator('body')).to_contain_text('${sha}')\n await page.reload()\n await expect(page.locator('workspace')).to_have_text('fresh workspace')\n await expect(page).to_have_url('/login')\n`;
  function audit(source: string, kind = "session") {
    const result = execFileSync(
      "python3",
      [
        "-c",
        "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('audit','scripts/testsprite/audit-testsprite-app.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); d=json.load(sys.stdin); print(json.dumps(m.inspect_code(d['code'],d['kind'],d['expected'])))",
      ],
      {
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
        input: JSON.stringify({ code: source, kind, expected: expectations }),
        encoding: "utf8",
      },
    );
    return JSON.parse(result) as Record<string, boolean>;
  }
  it("requires executable refresh and assertion nodes, not test names or comments", () => {
    expect(Object.values(audit(valid)).every(Boolean)).toBe(true);
    const missing = audit(
      valid.replace(" await page.reload()", " # await page.reload()"),
    );
    expect(missing.explicit_refresh).toBe(false);
    expect(
      Object.values(audit("# refresh and exact SHA\npass")).some(Boolean),
    ).toBe(false);
    expect(audit(valid.replace(sha, "wrong")).exact_sha).toBe(false);
    expect(
      audit(
        valid.replace(
          `await expect(page.locator('body'))`,
          `expect(page.locator('body'))`,
        ),
      ).exact_sha,
    ).toBe(false);
  });
  it.each([
    [
      "taskSource",
      `async def run_test():
 await expect(page.locator('source')).to_have_text('SYNTHETIC old')
 await page.reload()
 await expect(page.locator('date')).to_have_value('2026-11-05')
 await expect(page.locator('notice')).to_contain_text('historical revision')
 await page.reload()
 await expect(page.locator('source')).to_have_text('SYNTHETIC new')
`,
    ],
    [
      "review",
      `async def run_test():
 await expect(page.locator('mark')).to_have_text('exact deadline quote')
 await expect(page.locator('label')).to_contain_text('not live AI')
 await page.reload()
 await expect(page.get_by_role('region', name='Applied changes')).to_be_visible()
 await expect(page.locator('status')).to_have_value('todo')
 await expect(page.locator('revision')).to_have_text('Revision 4')
 await expect(page.locator('undo')).to_contain_text('1 fields restored or tasks archived.')
 await expect(page.locator('undo')).to_contain_text('1 conflicts preserved.')
 await expect(page.get_by_role('link', name='created synthetic task')).to_have_count(0)
`,
    ],
  ])("requires all %s export assertions", (kind, source) => {
    expect(Object.values(audit(source, kind)).every(Boolean)).toBe(true);
    expect(
      Object.values(
        audit(
          source.replaceAll(" await page.reload()", " # refresh omitted"),
          kind,
        ),
      ).every(Boolean),
    ).toBe(false);
  });
});

describe("local proof database boundary", () => {
  const url = "postgresql://synthetic:disposable@localhost:5432/mosaic_test";
  it("uses CI's explicit test URL without requiring a Mac-only environment file", async () => {
    const readLocal = vi.fn(async () => {
      throw new Error("Missing local file");
    });
    expect(await localTestDatabaseUrl(url, readLocal)).toBe(url);
    expect(readLocal).not.toHaveBeenCalled();
  });
  it("reads the private local fallback only when no test URL was supplied", async () => {
    expect(
      await localTestDatabaseUrl(
        undefined,
        async () => `TEST_DATABASE_URL=${url}\n`,
      ),
    ).toBe(url);
  });
  it.each([
    url.replace("localhost", "example.com"),
    url.replace("mosaic_test", "mosaic"),
    url.replace("postgresql:", "https:"),
  ])("rejects a nonlocal or non-test target", async (candidate) => {
    await expect(localTestDatabaseUrl(candidate)).rejects.toThrow();
  });
});

describe("evidence CLI privacy boundary", () => {
  it("fails closed on malformed evidence without echoing its private contents", () => {
    const directory = mkdtempSync(join(tmpdir(), "mosaic-invalid-evidence-"));
    const marker = "synthetic-private-evidence-never-log";
    try {
      writeFileSync(join(directory, "native-status.json"), `{broken ${marker}`);
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/testsprite/testsprite-app-evidence.ts"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            APP_EVIDENCE_DIR: directory,
            SHA: sha,
            PREPARED_AT: prepared,
          },
        },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("raw provider content withheld");
      expect(result.stdout + result.stderr).not.toContain(marker);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

const readinessScript = workflow
  .split("script: |\n")[2]
  .split("\n\n  verify:")[0]
  .split("\n")
  .map((line) => line.replace(/^ {12}/, ""))
  .join("\n");
async function publishReadiness(
  pr: unknown = trusted,
  expectedSha = sha,
  event = "pull_request",
  eventSha = sha,
  ref = "refs/heads/main",
  input = "1",
) {
  const create = vi.fn();
  await runInNewContext(`(async () => {${readinessScript}\n})()`, {
    process: { env: { EXPECTED_SHA: expectedSha } },
    context: {
      repo: { owner: "Ololadestephen", repo: "Mosaic" },
      runId: 123,
      eventName: event,
      ref,
      payload: {
        inputs: { pr: input },
        pull_request: { number: 1, head: { sha: eventSha } },
      },
    },
    github: {
      rest: {
        pulls: { get: async () => ({ data: pr }) },
        repos: { createCommitStatus: create },
      },
    },
  });
  return create;
}
describe("actual success-only fixture readiness signal", () => {
  it("writes only the dedicated readiness status for the rechecked trusted SHA", async () => {
    const create = await publishReadiness();
    expect(create).toHaveBeenCalledExactlyOnceWith({
      owner: "Ololadestephen",
      repo: "Mosaic",
      sha,
      state: "success",
      context: "Mosaic native fixture ready",
      description: "Trusted PR 1 fixture and exact native plans prepared",
      target_url: "https://github.com/Ololadestephen/Mosaic/actions/runs/123",
    });
    expect(workflow).toContain("if: needs.prepare.result == 'success'");
    expect(workflow).toContain("statuses: write");
    expect(workflow.split("  readiness:")[0]).not.toContain("statuses: write");
    expect(workflow).toContain("vars.MOSAIC_NATIVE_APP_EVENT_ARMED == 'true'");
  });
  it("rejects stale preparations, fork heads, closed PRs and unrelated events before writing", async () => {
    await expect(publishReadiness(trusted, "b".repeat(40))).rejects.toThrow();
    await expect(
      publishReadiness({
        ...trusted,
        head: { ...trusted.head, repo: { full_name: "fork/Mosaic" } },
      }),
    ).rejects.toThrow();
    await expect(
      publishReadiness({ ...trusted, state: "closed" }),
    ).rejects.toThrow();
    await expect(
      publishReadiness(trusted, sha, "pull_request", "b".repeat(40)),
    ).rejects.toThrow();
    await expect(publishReadiness(trusted, sha, "push")).rejects.toThrow();
    await expect(
      publishReadiness(
        trusted,
        sha,
        "workflow_dispatch",
        sha,
        "refs/heads/untrusted",
      ),
    ).rejects.toThrow();
    await expect(
      publishReadiness(
        trusted,
        sha,
        "workflow_dispatch",
        sha,
        "refs/heads/main",
        "2",
      ),
    ).rejects.toThrow();
    expect(
      await publishReadiness(trusted, sha, "workflow_dispatch"),
    ).toHaveBeenCalledTimes(1);
  });
});
