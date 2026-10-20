import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

test("a later revision flags the cited task and does not change it", async ({
  page,
}) => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "tests/e2e/seed-passage.ts",
    ],
    { cwd: process.cwd() },
  );
  const seed = JSON.parse(stdout) as {
    email: string;
    password: string;
    sourceId: string;
    taskId: string;
    changeSetId: string;
  };
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(seed.email);
  await page.getByLabel("Password").fill(seed.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  const flagged = page
    .getByRole("article")
    .filter({ has: page.getByRole("link", { name: "Confirm the supplier" }) });
  const unrelated = page.getByRole("article").filter({
    has: page.getByRole("link", { name: "Completed and unrelated work" }),
  });
  await expect(flagged).toContainText("Supporting passage changed — review");
  await expect(unrelated).not.toContainText("Supporting passage changed");
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("link", { name: "Confirm the supplier" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Supporting passage changed — review",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "The task itself is unchanged.",
  );
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue(
    "todo",
  );
  await page.goto(`/app/sources/${seed.sourceId}`);
  await expect(
    page.getByRole("region", { name: "Supporting passage changed — review" }),
  ).toContainText("The cited passage was edited.");
  await expect(
    page.getByRole("region", { name: "Supporting passage changed — review" }),
  ).toContainText("No task field was changed.");
  const comparison = page.getByRole("region", {
    name: "Compare source revisions",
  });
  await expect(
    comparison.getByRole("region", { name: "Explicit predecessor text" }),
  ).toContainText("Friday");
  await expect(
    comparison.getByRole("region", { name: "Selected revision text" }),
  ).toContainText("Monday");
  await expect(
    comparison.getByRole("link", {
      name: "Review flag: Confirm the supplier ↗",
    }),
  ).toBeVisible();
  await page.goto(`/app/changes/${seed.changeSetId}`);
  await expect(
    page.getByRole("region", { name: "Compare source revisions" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/evidence/m5-revision-comparison-mobile.png",
    fullPage: true,
  });
  const related = page.getByRole("link", {
    name: "Related proposal: Supplier confirmation now uses Monday. ↗",
  });
  await related.focus();
  await related.press("Enter");
  await expect(page.locator("#proposal-item-0")).toBeFocused();
  await page.goto(`/app/tasks/${seed.taskId}`);
  await expect(page.getByRole("dialog")).toContainText(
    "The cited passage was edited.",
  );
});
