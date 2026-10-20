import { expect, test } from "@playwright/test";
import { seedWorkspace, signInFixture } from "./fixtures";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

test("first-use source and task workflow persists at desktop and 360px", async ({
  page,
}) => {
  await page.goto("/login?mode=register");
  await page.getByLabel("Your name").fill("Browser reviewer");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${randomUUID()}@mosaic.test`);
  await page
    .getByLabel("Password", { exact: false })
    .fill("disposable-browser-test-passphrase");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Give the work a home." }),
  ).toBeVisible();
  await page.getByLabel("Workspace name").fill("Fictional browser launch");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bring a source" }).click();
  await page
    .getByRole("button", { name: "Use fictional launch sample" })
    .click();
  await page.getByRole("button", { name: "Save source", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Field Notes — fictional launch brief" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Analyze this revision" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Live Gemini analysis is unavailable."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add revision" }).click();
  const revised = page.getByLabel("Revised source");
  await revised.fill(
    (await revised.inputValue()).replace("22 October 2026", "24 October 2026"),
  );
  await page
    .getByRole("button", { name: "Save revision", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Source revision", exact: true }),
  ).toContainText("Version 2");
  await page.reload();
  await expect(page.getByText("Immutable source · Version 2")).toBeVisible();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByLabel("Task title").fill("Confirm the fictional supplier");
  await page.getByLabel("Due date").fill("2026-10-20");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await page
    .getByRole("link", { name: "Confirm the fictional supplier", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Why does this task exist?" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("in_progress");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Revision 2", { exact: false })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("in_progress");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await mkdir(".local/evidence", { recursive: true });
  await page.screenshot({
    path: ".local/evidence/board-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(
    page.getByRole("button", { name: "Bring a source" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/evidence/board-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Preview safe undo" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Unwind, with care." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo eligible changes" }).click();
  await expect(page.getByRole("status")).toContainText("1 fields restored");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await page
    .getByRole("link", { name: "Confirm the fictional supplier", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("todo");
});

test("direct APIs reject unauthenticated requests and foreign origins", async ({
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("The browser test origin is required.");
  expect((await request.get("/api/workspaces")).status()).toBe(401);
  expect(
    (
      await request.post("/api/auth/register", {
        data: {
          email: `${randomUUID()}@mosaic.test`,
          name: "Attack",
          password: "disposable-test-passphrase",
        },
        headers: { Origin: "https://untrusted.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/auth/register", {
        data: { email: "bad" },
        headers: { Origin: new URL(baseURL).origin },
      })
    ).status(),
  ).toBe(400);
});

test("initial workspace load failure can be retried without refreshing or writing work", async ({
  page,
}) => {
  const seed = await seedWorkspace();
  let recovering = false;
  await page.route("**/api/workspaces", async (route) => {
    if (!recovering && route.request().method() === "GET") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Temporary workspace-list failure",
          code: "UNAVAILABLE",
        }),
      });
    } else await route.continue();
  });
  await signInFixture(page, seed);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Temporary workspace-list failure" }),
  ).toBeVisible();
  recovering = true;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: "Prepare the fictional launch",
      exact: true,
    }),
  ).toBeVisible();
});

test("source, proposal and task loading failures have a working retry", async ({
  page,
}) => {
  const seed = await seedWorkspace();
  await signInFixture(page, seed);
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  for (const [kind, id, label, ready] of [
    ["sources", seed.sourceId, "Retry source", "Immutable source · Version 1"],
    ["changes", seed.changeSetId, "Retry proposal", "Consider the change."],
    ["tasks", seed.taskId, "Retry task", "Why does this task exist?"],
  ]) {
    let recovering = false;
    const pattern = `**/api/workspaces/${seed.workspaceId}/${kind}/${id}`;
    await page.route(pattern, async (route) => {
      if (!recovering)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Temporary detail-load failure",
            code: "UNAVAILABLE",
          }),
        });
      else await route.continue();
    });
    await page.goto(`/app/${kind}/${id}`);
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
    recovering = true;
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByText(ready, { exact: true })).toBeVisible();
    await page.unroute(pattern);
  }
});

test("a failed workspace switch never renders the previous workspace's work", async ({
  page,
}) => {
  const seed = await seedWorkspace();
  await signInFixture(page, seed);
  await expect(
    page.getByRole("link", {
      name: "Prepare the fictional launch",
      exact: true,
    }),
  ).toBeVisible();
  const response = await page.request.post("/api/workspaces", {
    headers: { origin: new URL(page.url()).origin },
    data: { name: "Other isolated workspace" },
  });
  expect(response.ok()).toBe(true);
  const other = await response.json();
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Active workspace" }),
  ).toContainText("Other isolated workspace");
  let recovering = false;
  await page.route(`**/api/workspaces/${other.id}`, async (route) => {
    if (!recovering)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Temporary switched-workspace failure",
          code: "UNAVAILABLE",
        }),
      });
    else await route.continue();
  });
  await page
    .getByRole("combobox", { name: "Active workspace" })
    .selectOption(other.id);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Temporary switched-workspace failure" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Prepare the fictional launch",
      exact: true,
    }),
  ).toHaveCount(0);
  recovering = true;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByText("Good work begins with a little context.", { exact: true }),
  ).toBeVisible();
});
