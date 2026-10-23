import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, type Page } from "@playwright/test";

export async function seedWorkspace() {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "tests/e2e/seed.ts"],
    { cwd: process.cwd() },
  );
  return JSON.parse(stdout) as {
    workspaceId: string;
    changeSetId: string;
    taskId: string;
    sourceId: string;
    ownerEmail: string;
    editorEmail: string;
    password: string;
  };
}

export async function seedAppVerification() {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "tests/e2e/seed-app-verification.ts",
    ],
    { cwd: process.cwd() },
  );
  return JSON.parse(stdout) as {
    workspaceName: string;
    workspaceId: string;
    changeSetId: string;
    taskId: string;
    sourceId: string;
    ownerEmail: string;
    password: string;
  };
}

export async function signInFixture(
  page: Page,
  seed: { ownerEmail: string; password: string },
) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(seed.ownerEmail);
  await page.getByLabel("Password").fill(seed.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function selectWorkspace(page: Page, name: string) {
  await page
    .getByRole("heading", { name: "A clear view of what’s next." })
    .waitFor();
  const picker = page.getByLabel("Active workspace");
  const selected = await picker.locator("option:checked").textContent();
  if (selected?.trim() === name) return;
  const target = await picker.evaluate((select, label) => {
    const option = [...(select as HTMLSelectElement).options].find(
      (option) => option.text.trim() === label,
    );
    return option?.value ?? "";
  }, name);
  if (!target) throw new Error(`Workspace option is missing: ${name}`);
  const loaded = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().endsWith(`/api/workspaces/${target}`) &&
      response.ok(),
  );
  await picker.selectOption({ label: name });
  await loaded;
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
}

export async function inspectAppVerification(
  workspaceId: string,
  phase: "before" | "review" | "after",
) {
  await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "tests/e2e/inspect-app-verification.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_WORKSPACE_ID: workspaceId,
        APP_PROOF_PHASE: phase,
      },
    },
  );
}
