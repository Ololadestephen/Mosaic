import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { PlanStep } from "./testsprite-app-contract";

export const APP_TEST_IDS = {
  session: "e6bb3299-471c-4afe-b939-6138b393cc59",
  taskSource: "bb8729d9-edcb-4705-afaa-b34e506b686f",
  review: "4faaa0ab-6d97-443a-bb71-9df7ba857577",
} as const;
export function verifyNativeMetadata(
  raw: unknown,
  testId: string,
  name: string,
  description: string,
  steps: PlanStep[],
) {
  const saved = z
    .object({
      id: z.uuid(),
      name: z.string(),
      description: z.string(),
      planStepCount: z.number().int(),
      planSteps: z.array(
        z.object({
          type: z.enum(["action", "assertion"]),
          description: z.string(),
        }),
      ),
    })
    .parse(raw);
  if (
    saved.id !== testId ||
    saved.name !== name ||
    saved.description !== description ||
    saved.planStepCount !== steps.length ||
    JSON.stringify(saved.planSteps) !== JSON.stringify(steps)
  )
    throw new Error(
      "Saved native pass criteria do not match the authored contract.",
    );
  return {
    testId,
    descriptionHash: createHash("sha256").update(description).digest("hex"),
  };
}
const runSchema = z.object({
  runId: z.uuid(),
  testId: z.uuid(),
  status: z.literal("passed"),
  source: z.literal("github_action"),
  startedAt: z.iso.datetime(),
  codeVersion: z.string().min(1),
  targetUrl: z.url(),
  executionUrl: z.url(),
});
export function verifyPlanReceipt(
  raw: unknown,
  steps: unknown[],
  testId: string,
) {
  const receipt = z
    .object({
      testId: z.uuid(),
      planStepsHash: z.string(),
      stepCount: z.number().int(),
      updatedAt: z.string(),
    })
    .parse(raw);
  const expected =
    "sha256:" +
    createHash("sha256").update(JSON.stringify(steps)).digest("hex");
  if (
    receipt.testId !== testId ||
    receipt.stepCount !== steps.length ||
    receipt.planStepsHash !== expected
  )
    throw new Error(
      "Saved plan receipt does not match the exact submitted steps.",
    );
  return { testId, hash: expected, stepCount: steps.length };
}
const origin =
  "https://mosaic-git-codex-hosted-previe-7f5fea-ololade-stephens-projects.vercel.app";

export function verifyNativeRun(
  raw: unknown,
  exported: unknown,
  testId: string,
  sha: string,
  preparedAt: string,
  executionUrl: string,
) {
  const run = runSchema.parse(raw);
  const code = z
    .object({
      testId: z.uuid(),
      codeVersion: z.string(),
      code: z.string().min(1),
    })
    .parse(exported);
  const target = new URL(run.targetUrl);
  if (
    run.executionUrl !== `${executionUrl}/test/${run.runId}` ||
    run.testId !== testId ||
    code.testId !== testId ||
    code.codeVersion !== run.codeVersion ||
    target.origin !== origin ||
    target.searchParams.get("expected_sha") !== sha ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    !Number.isFinite(Date.parse(preparedAt)) ||
    Date.parse(run.startedAt) < Date.parse(preparedAt)
  )
    throw new Error(
      "Native App run does not match the fresh prepared test, code version and commit.",
    );
  return {
    testId,
    runId: run.runId,
    codeVersion: run.codeVersion,
    status: run.status,
    source: run.source,
  };
}

async function main() {
  const directory = process.env.APP_EVIDENCE_DIR;
  const sha = process.env.SHA;
  const preparedAt = process.env.PREPARED_AT;
  if (!directory || !sha || !preparedAt)
    throw new Error("App evidence context is required.");
  const cli = process.env.TESTSPRITE_CLI ?? "testsprite";
  const readCli = (args: string[]) =>
    JSON.parse(
      execFileSync(cli, ["--output", "json", ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  const native = JSON.parse(
    await readFile(`${directory}/native-status.json`, "utf8"),
  );
  const execution = new URL(native.executionUrl);
  if (
    execution.origin !== "https://www.testsprite.com" ||
    execution.search ||
    execution.hash ||
    !execution.pathname.includes(
      "/projects/d9585a5d-bab0-438b-bda7-b6a9353aec2c/execution/",
    ) ||
    native.sha !== sha
  )
    throw new Error("Invalid native execution identity.");
  const runs = [];
  for (const [kind, id] of Object.entries(APP_TEST_IDS)) {
    const latest = readCli(["test", "result", id]);
    if (!latest.runIdIfAvailable)
      throw new Error("No completed native run is available.");
    const raw = readCli([
      "test",
      "wait",
      latest.runIdIfAvailable,
      "--timeout",
      "5",
    ]);
    const exported = readCli(["test", "code", "get", id]);
    runs.push(
      verifyNativeRun(
        raw.run ?? raw,
        exported,
        id,
        sha,
        preparedAt,
        execution.href,
      ),
    );
    await writeFile(
      `${directory}/${kind}-code.json`,
      JSON.stringify(exported),
      { mode: 0o600 },
    );
  }
  if (new Set(runs.map((run) => run.runId)).size !== 3)
    throw new Error("App run IDs are not distinct.");
  const expectations = JSON.parse(
    await readFile(`${directory}/expectations.json`, "utf8"),
  );
  if (expectations.sha !== sha)
    throw new Error("App assertion expectations do not match the commit.");
  const audit = spawnSync(
    "python3",
    [
      "scripts/testsprite/audit-testsprite-app.py",
      `${directory}/expectations.json`,
      directory,
    ],
    { encoding: "utf8" },
  );
  const checks = JSON.parse(audit.stdout || "{}");
  await writeFile(
    `${directory}/export-audit.json`,
    JSON.stringify(checks, null, 2),
  );
  if (audit.status !== 0 || checks.passed !== true)
    throw new Error(
      "Native export assertions are incomplete; inspect the sanitized audit.",
    );
  await writeFile(
    `${directory}/summary.json`,
    JSON.stringify(
      {
        sha,
        preparedAt,
        executionUrl: execution.href,
        runs,
        exportAudit: checks,
        liveAi: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "Three fresh native App runs and necessary export assertions verified. Database verification is separate.",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      "App evidence verification failed; raw provider content withheld.",
    );
    process.exitCode = 1;
  });
}
