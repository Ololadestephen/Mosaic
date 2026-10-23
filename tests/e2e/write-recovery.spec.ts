import { expect, test } from "@playwright/test";
import { seedWorkspace, signInFixture } from "./fixtures";

test("labelled fixture: a committed apply with a lost response is recovered without another write", async ({
  page,
}) => {
  const seed = await seedWorkspace();
  await signInFixture(page, seed);
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await page.goto(`/app/changes/${seed.changeSetId}`);
  await page.getByRole("checkbox").first().check();
  let posts = 0;
  let committedBatch = "";
  await page.route("**/apply", async (route) => {
    posts++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const result = await response.json();
    committedBatch = result.batchId;
    expect(result.count).toBe(1);
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Apply selected changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check original operation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check original operation" }).click();
  await expect(page.getByRole("status")).toContainText("1 item committed.");
  await expect(
    page.getByRole("region", { name: "Applied changes" }),
  ).toBeVisible();
  expect(posts).toBe(1);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter((key) =>
        key.startsWith("mosaic-apply-attempt:"),
      ),
    ),
  ).toEqual([]);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Applied changes" }),
  ).toBeVisible();
  const response = await page.request.get(
    `/api/workspaces/${seed.workspaceId}`,
  );
  const state = await response.json();
  expect(state.tasks).toHaveLength(2);
  const task = state.tasks.find(
    (task: { id: string }) => task.id === seed.taskId,
  );
  expect(task).toMatchObject({
    dueDate: "2026-10-22",
    status: "todo",
    revision: 2,
  });
  const applies = state.activity.filter(
    (batch: { operation: string }) => batch.operation === "apply",
  );
  expect(applies).toHaveLength(1);
  expect(applies[0]).toMatchObject({
    id: committedBatch,
    changes: [
      {
        taskId: seed.taskId,
        field: "dueDate",
        before: "2026-10-20",
        after: "2026-10-22",
      },
    ],
  });
  expect(
    state.activity.filter(
      (batch: { operation: string }) => batch.operation === "create",
    ),
  ).toHaveLength(2);
});

test("labelled fixture: failed apply refresh preserves committed state and only retries reads", async ({
  page,
}) => {
  const seed = await seedWorkspace();
  await signInFixture(page, seed);
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await page.goto(`/app/changes/${seed.changeSetId}`);
  await page.getByRole("checkbox").first().check();
  let posts = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/apply") && request.method() === "POST")
      posts++;
  });
  await page.route(`**/changes/${seed.changeSetId}`, async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "CONFLICT",
          error: "Synthetic refresh-only failure",
        }),
      });
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Apply selected changes", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("1 item committed.");
  await expect(page.locator("p.error[role=alert]")).toContainText(
    "Changes committed.",
  );
  await expect(
    page.getByRole("button", { name: "Review a new selection" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Apply selected changes", exact: true }),
  ).toHaveCount(0);
  await page.unroute(`**/changes/${seed.changeSetId}`);
  await page.getByRole("button", { name: "Refresh saved result" }).click();
  await expect(
    page.getByRole("region", { name: "Applied changes" }),
  ).toBeVisible();
  await expect(page.locator("p.error[role=alert]")).toHaveCount(0);
  expect(posts).toBe(1);
});

test("manual task creation survives a failed board refresh without resubmission", async ({
  page,
}) => {
  const seed = await seedWorkspace();
  await signInFixture(page, seed);
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Add task/ }).click();
  await page
    .getByLabel("Task title")
    .fill("Synthetic committed task refresh check");
  let posts = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/tasks") && request.method() === "POST")
      posts++;
  });
  await page.route(`**/api/workspaces/${seed.workspaceId}`, (route) =>
    route.abort("failed"),
  );
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Task created.");
  await expect(
    page.getByRole("button", { name: "Create task", exact: true }),
  ).toHaveCount(0);
  await page.unroute(`**/api/workspaces/${seed.workspaceId}`);
  await page.getByRole("button", { name: "Refresh saved task" }).click();
  await expect(
    page.getByRole("link", {
      name: "Synthetic committed task refresh check",
      exact: true,
    }),
  ).toBeVisible();
  expect(posts).toBe(1);
});

test("proposal edit refresh failure leaves edit mode and retries only the read", async ({
  page,
}) => {
  const seed = await seedWorkspace();
  await signInFixture(page, seed);
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await page.goto(`/app/changes/${seed.changeSetId}`);
  await page
    .getByRole("button", { name: "Edit proposed value" })
    .first()
    .click();
  await page.getByLabel("Your proposed dueDate").fill("2026-10-23");
  let edits = 0;
  await page.route(`**/changes/${seed.changeSetId}`, async (route) => {
    if (route.request().method() === "GET") await route.abort("failed");
    else {
      edits++;
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Save proposed value" }).click();
  await expect(page.locator("p.error[role=alert]")).toContainText(
    "Proposed value saved.",
  );
  await expect(
    page.getByRole("button", { name: "Save proposed value" }),
  ).toHaveCount(0);
  await page.unroute(`**/changes/${seed.changeSetId}`);
  await page.getByRole("button", { name: "Refresh saved proposal" }).click();
  await expect(page.getByText("Human-edited choice")).toBeVisible();
  expect(edits).toBe(1);
  const workspace = await (
    await page.request.get(`/api/workspaces/${seed.workspaceId}`)
  ).json();
  expect(
    workspace.tasks.find((task: { id: string }) => task.id === seed.taskId),
  ).toMatchObject({ dueDate: "2026-10-20", revision: 1 });
  expect(
    workspace.activity.filter(
      (batch: { operation: string }) => batch.operation === "apply",
    ),
  ).toHaveLength(0);
});

test("optional selection and cleanup storage failures do not hide a committed receipt", async ({
  page,
}) => {
  const seed = await seedWorkspace();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("mosaic-review-selection:"))
        throw new Error("Synthetic optional selection failure");
      return set.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith("mosaic-apply-attempt:"))
        throw new Error("Synthetic optional cleanup failure");
      return remove.call(this, key);
    };
  });
  await signInFixture(page, seed);
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await page.goto(`/app/changes/${seed.changeSetId}`);
  await page.getByRole("checkbox").first().check();
  await page
    .getByRole("button", { name: "Apply selected changes", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("1 item committed.");
  await expect(
    page.getByRole("region", { name: "Applied changes" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Applied changes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry original selection", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
