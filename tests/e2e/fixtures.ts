import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";

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

export async function signInFixture(
  page: Page,
  seed: Awaited<ReturnType<typeof seedWorkspace>>,
) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(seed.ownerEmail);
  await page.getByLabel("Password").fill(seed.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
