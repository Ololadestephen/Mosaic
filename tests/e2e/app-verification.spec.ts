import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  APP_FIXTURE_CREATED_TASK_TITLE,
  APP_FIXTURE_DEADLINE_QUOTE,
  APP_FIXTURE_QUESTION,
  APP_FIXTURE_RELATED_TASK_TITLE,
  APP_FIXTURE_SOURCE_TEXT,
  APP_FIXTURE_SOURCE_TITLE,
  APP_FIXTURE_TASK_TITLE,
} from "../fixtures/app-verification";
import {
  seedAppVerification,
  inspectAppVerification,
  selectWorkspace,
  signInFixture,
} from "./fixtures";

const evidence = ".local/evidence/app-verification";
import {
  APP_MANUAL_TASK as manualTask,
  APP_MANUAL_SOURCE as manualSource,
  APP_MANUAL_V1 as manualV1,
  APP_MANUAL_V2 as manualV2,
} from "../fixtures/app-manual-revision";

test.beforeEach(async ({ page }) => {
  await page.route(/\/analyze(?:[/?]|$)/, (route) =>
    route.abort("blockedbyclient"),
  );
});
test.beforeAll(async () => {
  await mkdir(evidence, { recursive: true });
});

test("App check: exact session, workspace, refresh, and sign-out", async ({
  page,
}) => {
  const seed = await seedAppVerification();
  await page.goto("/api/health");
  await expect(page.locator("body")).toContainText('"status":"ready"');
  const health = JSON.parse(await page.locator("body").innerText());
  expect(health.commit).toBe(process.env.MOSAIC_E2E_EXPECTED_COMMIT ?? "local");
  await signInFixture(page, seed);
  await selectWorkspace(page, seed.workspaceName);
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await expect(page.getByLabel("Active workspace")).toHaveValue(
    seed.workspaceId,
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: /Information changes/ }),
  ).toBeVisible();
  await page.goto("/app");
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});

test("App check: manual task and immutable source revision persist", async ({
  page,
}) => {
  const seed = await seedAppVerification();
  await signInFixture(page, seed);
  await selectWorkspace(page, seed.workspaceName);

  await page.getByRole("button", { name: "Add task" }).click();
  const taskDialog = page.getByRole("dialog", { name: "Add a task" });
  await taskDialog.getByLabel("Task title").fill(manualTask);
  await taskDialog
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption({
      label: "In progress",
    });
  await taskDialog.getByLabel("Due date").fill("2026-11-05");
  await taskDialog.getByRole("button", { name: "Create task" }).click();
  await expect(
    page.getByRole("link", { name: manualTask, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: manualTask, exact: true }).click();
  const createdTask = page.getByRole("dialog", { name: manualTask });
  await expect(
    createdTask.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("in_progress");
  await expect(createdTask.getByLabel("Due date")).toHaveValue("2026-11-05");
  await expect(
    createdTask.getByText(
      "Created manually by a workspace member. No source evidence has been attached.",
    ),
  ).toBeVisible();
  await expect(createdTask.getByText("created this task")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: manualTask }).getByLabel("Due date"),
  ).toHaveValue("2026-11-05");
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await page.getByRole("button", { name: "Bring a source" }).click();
  const sourceDialog = page.getByRole("dialog", { name: "Bring a source" });
  await sourceDialog.getByLabel("Source title").fill(manualSource);
  await sourceDialog.getByLabel("Source text").fill(manualV1);
  await sourceDialog.getByRole("button", { name: "Save source" }).click();
  await expect(
    page.getByRole("heading", { name: manualSource, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".source-paper pre")).toContainText(manualV1);
  await expect(page.getByText("Immutable source · Version 1")).toBeVisible();

  await page.getByRole("button", { name: "Add revision" }).click();
  const revisionDialog = page.getByRole("dialog", {
    name: "Add an explicit revision",
  });
  await revisionDialog.getByLabel("Revised source").fill(manualV2);
  await revisionDialog.getByRole("button", { name: "Save revision" }).click();
  await expect(page.locator(".source-paper pre")).toContainText(manualV2);
  await page.getByLabel("Source revision", { exact: true }).selectOption({
    label: "Version 1 · original",
  });
  await expect(page.locator(".source-paper pre")).toContainText(manualV1);
  await expect(
    page.getByText(
      "This is a historical revision. You can read it and follow its citations, but only the latest revision can be analyzed.",
    ),
  ).toBeVisible();
  await page.getByLabel("Source revision", { exact: true }).selectOption({
    label: "Version 2 · explicit revision",
  });
  await expect(page.locator(".source-paper pre")).toContainText(manualV2);
  await page.reload();
  await expect(page.locator(".source-paper pre")).toContainText(manualV2);
  await expect(
    page
      .getByLabel("Source revision", { exact: true })
      .locator("option:checked"),
  ).toContainText("Version 2");
});

test("App check: review, selected apply, receipt, and conflict-aware undo", async ({
  page,
}) => {
  const seed = await seedAppVerification();
  await signInFixture(page, seed);
  await selectWorkspace(page, seed.workspaceName);
  await inspectAppVerification(seed.workspaceId, "before");
  await page.getByRole("link", { name: /^Changes/ }).click();
  await page
    .getByRole("link", {
      name: new RegExp(`Source proposal · ${seed.changeSetId.slice(0, 8)}`),
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Consider the change." }),
  ).toBeVisible();
  await expect(
    page.getByText("Deterministic test fixture · not live AI"),
  ).toBeVisible();
  await expect(
    page.getByText(APP_FIXTURE_QUESTION, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Completed and unrelated work remains completed."),
  ).toBeVisible();
  await page.getByText("Source used for this proposal").click();
  await expect(page.locator(".source-on-review pre")).toContainText(
    APP_FIXTURE_DEADLINE_QUOTE,
  );
  await expect(page.locator(".source-on-review pre")).toContainText(
    "https://www.testsprite.com/hackathon-s4",
  );
  await page
    .getByRole("link", { name: /Exact source passage/ })
    .first()
    .click();
  await expect(page.locator("mark")).toContainText(APP_FIXTURE_DEADLINE_QUOTE);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Consider the change." }),
  ).toBeVisible();

  const dateChoice = page.getByRole("checkbox", {
    name: `Select ${APP_FIXTURE_TASK_TITLE}: date`,
  });
  const statusChoice = page.getByRole("checkbox", {
    name: `Select ${APP_FIXTURE_TASK_TITLE}: status`,
  });
  const createdChoice = page.getByRole("checkbox", {
    name: `Select ${APP_FIXTURE_CREATED_TASK_TITLE}: submission`,
  });
  await dateChoice.check();
  await createdChoice.check();
  await expect(statusChoice).not.toBeChecked();
  await page.screenshot({
    path: `${evidence}/review-selection.png`,
    fullPage: true,
  });
  await inspectAppVerification(seed.workspaceId, "review");
  await page
    .getByRole("button", { name: "Apply selected changes", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("2 items committed.");
  await expect(page.getByRole("status")).toContainText("Persistence verified.");
  const receipt = page.getByRole("region", { name: "Applied changes" });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("2026-10-20 → 2026-10-22");
  await expect(receipt).toContainText(APP_FIXTURE_CREATED_TASK_TITLE);
  await page.screenshot({ path: `${evidence}/receipt.png`, fullPage: true });
  await page.reload();
  await expect(
    page.getByText("Applied proposal", { exact: false }),
  ).toBeVisible();
  await expect(receipt).toBeVisible();

  await page.getByRole("link", { name: "Board", exact: true }).click();
  await page
    .getByRole("link", { name: APP_FIXTURE_TASK_TITLE, exact: true })
    .click();
  const taskDialog = page.getByRole("dialog", { name: APP_FIXTURE_TASK_TITLE });
  await expect(
    taskDialog.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("todo");
  await expect(taskDialog.getByLabel("Due date")).toHaveValue("2026-10-22");
  await expect(
    taskDialog.getByText("Revision 2", { exact: false }),
  ).toBeVisible();
  await taskDialog
    .getByRole("link", { name: `${APP_FIXTURE_SOURCE_TITLE} · v1` })
    .click();
  await expect(page.locator("mark")).toContainText(APP_FIXTURE_DEADLINE_QUOTE);
  await page.goBack();
  const reopenedTask = page.getByRole("dialog", {
    name: APP_FIXTURE_TASK_TITLE,
  });
  await reopenedTask.getByLabel("Due date").fill("2026-10-24");
  await reopenedTask.getByRole("button", { name: "Save changes" }).click();
  await expect(
    reopenedTask.getByText("Revision 3", { exact: false }),
  ).toBeVisible();
  await reopenedTask.getByLabel("Due date").fill("2026-10-22");
  await reopenedTask.getByRole("button", { name: "Save changes" }).click();
  await expect(
    reopenedTask.getByText("Revision 4", { exact: false }),
  ).toBeVisible();
  await expect(reopenedTask.getByLabel("Due date")).toHaveValue("2026-10-22");
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.getByRole("link", { name: "Activity", exact: true }).click();
  const applied = page.locator("article").filter({
    has: page.getByRole("link", { name: "Inspect source proposal" }),
  });
  await applied.getByRole("button", { name: "Preview safe undo" }).click();
  const undoDialog = page.getByRole("dialog", { name: "Unwind, with care." });
  await expect(
    undoDialog.getByText("A later edit or archive protects this work.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidence}/undo-preview.png`,
    fullPage: true,
  });
  await undoDialog
    .getByRole("button", { name: "Undo eligible changes" })
    .click();
  await expect(undoDialog.getByRole("status")).toContainText(
    "1 fields restored or tasks archived.",
  );
  await expect(undoDialog.getByRole("status")).toContainText(
    "1 conflicts preserved.",
  );
  await expect(undoDialog.getByRole("status")).toContainText(
    "Persistence verified.",
  );
  await page.screenshot({
    path: `${evidence}/undo-result.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();

  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: APP_FIXTURE_CREATED_TASK_TITLE,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", {
      name: APP_FIXTURE_RELATED_TASK_TITLE,
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: APP_FIXTURE_TASK_TITLE, exact: true })
    .click();
  const finalTask = page.getByRole("dialog", { name: APP_FIXTURE_TASK_TITLE });
  await expect(
    finalTask.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("todo");
  await expect(finalTask.getByLabel("Due date")).toHaveValue("2026-10-22");
  await expect(
    finalTask.getByText("Revision 4", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: `${evidence}/final-task.png`, fullPage: true });
  await inspectAppVerification(seed.workspaceId, "after");
  expect(APP_FIXTURE_SOURCE_TEXT).toContain(APP_FIXTURE_DEADLINE_QUOTE);
});
