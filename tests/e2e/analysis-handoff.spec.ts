import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { signInFixture } from "./fixtures";
test("explicit mocked provider: Analyze → persisted strict proposal → review, with no task writes", async ({
  page,
}) => {
  test.skip(
    process.env.MOSAIC_E2E_MOCK_ANALYSIS !== "1",
    "Separate local mocked-provider lane; never live Gemini evidence.",
  );
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--conditions=react-server",
    "--import",
    "tsx",
    "tests/e2e/seed-analysis.ts",
  ]);
  const seed = JSON.parse(stdout);
  await signInFixture(page, seed);
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  const before = await (
    await page.request.get(`/api/workspaces/${seed.workspaceId}`)
  ).json();
  expect(before.drafts).toHaveLength(0);
  await page.goto(`/app/sources/${seed.sourceId}`);
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/analyze") && r.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Analyze this revision ↗", exact: true })
    .click();
  expect((await request).postDataJSON()).toEqual({
    sourceVersionId: seed.sourceVersionId,
  });
  await expect(
    page.getByRole("heading", { name: "Consider the change." }),
  ).toBeVisible();
  await expect(page.locator("blockquote")).toContainText(
    "SYNTHETIC PROVIDER FIXTURE.",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Consider the change." }),
  ).toBeVisible();
  const after = await (
    await page.request.get(`/api/workspaces/${seed.workspaceId}`)
  ).json();
  expect(after.tasks).toEqual(before.tasks);
  expect(after.activity).toEqual(before.activity);
  expect(after.drafts).toHaveLength(1);
  expect(after.drafts[0].state).toBe("draft");
  expect(page.url()).toContain(`/app/changes/${after.drafts[0].id}`);
  const attempts = (
    await readFile(".local/evidence/browser-analysis-attempts.jsonl", "utf8")
  )
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x))
    .filter((x) => x.sourceVersionId === seed.sourceVersionId);
  expect(attempts).toEqual([
    { sourceVersionId: seed.sourceVersionId, mocked: true },
  ]);
});
