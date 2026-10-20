import { expect, test } from "@playwright/test";
import { seedWorkspace, signInFixture } from "./fixtures";

test("labelled fixture: review → atomic apply → second-account edit → conflict-aware undo", async ({
  page,
  browser,
}) => {
  const seed = await seedWorkspace();
  await signInFixture(page, seed);
  await expect(
    page.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Prepare the fictional launch",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto(`/app/changes/${seed.changeSetId}`);
  await expect(
    page.getByRole("heading", { name: "Consider the change." }),
  ).toBeVisible();
  await expect(
    page.getByText("Deterministic test fixture · not live AI"),
  ).toBeVisible();
  await expect(
    page.getByText("Who owns the photos?", { exact: true }),
  ).toBeVisible();
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check();
  await page.getByText("Source used for this proposal").click();
  await expect(page.locator(".source-on-review pre")).toContainText(
    "FICTIONAL TEST BRIEF",
  );
  await page
    .getByRole("link", { name: /Exact source passage/ })
    .first()
    .click();
  await expect(page.locator("mark")).toContainText("FICTIONAL TEST BRIEF");
  await expect(page.getByLabel("Cited source passage")).toBeFocused();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Consider the change." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Consider the change." }),
  ).toBeVisible();
  for (const checkbox of await page.getByRole("checkbox").all())
    await expect(checkbox).toBeChecked();
  const unchanged = await page.request.get(
    `/api/workspaces/${seed.workspaceId}`,
  );
  expect((await unchanged.json()).tasks).toHaveLength(2);
  await page.screenshot({
    path: ".local/evidence/review-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const firstSelection = page.getByRole("checkbox").first();
  await firstSelection.press("Space");
  await expect(firstSelection).not.toBeChecked();
  await firstSelection.press("Space");
  await expect(firstSelection).toBeChecked();
  await page.screenshot({
    path: ".local/evidence/review-mobile.png",
    fullPage: true,
  });
  const attempts: unknown[] = [];
  await page.route("**/apply", async (route) => {
    attempts.push(route.request().postDataJSON());
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Apply selected changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Check original operation" }),
  ).toBeVisible();
  const untouched = await page.request.get(
    `/api/workspaces/${seed.workspaceId}`,
  );
  expect((await untouched.json()).tasks).toHaveLength(2);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Check original operation" }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox").first()).toBeDisabled();
  await page.unroute("**/apply");
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/apply"))
      attempts.push(request.postDataJSON());
  });
  await page
    .getByRole("button", { name: "Retry original selection", exact: true })
    .click();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(page.getByRole("status")).toContainText("3 items committed.");
  await expect(page.getByRole("status")).toContainText("Persistence verified.");
  await expect(
    page.getByRole("region", { name: "Applied changes" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await expect(
    page.getByText("Applied proposal", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Applied changes" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/evidence/review-receipt.png",
    fullPage: true,
  });
  await page.goto(`/app/tasks/${seed.taskId}`);
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("in_progress");
  await expect(page.getByLabel("Due date")).toHaveValue("2026-10-22");
  await page
    .getByRole("link", { name: "Labelled deterministic test brief · v1" })
    .click();
  await expect(page.locator("mark")).toContainText("FICTIONAL TEST BRIEF");

  const context = await browser.newContext();
  const teammate = await context.newPage();
  await teammate.goto(new URL("/login", page.url()).href);
  await teammate.getByLabel("Email", { exact: true }).fill(seed.editorEmail);
  await teammate.getByLabel("Password").fill(seed.password);
  await teammate.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    teammate.getByRole("heading", { name: "A clear view of what’s next." }),
  ).toBeVisible();
  await teammate.goto(new URL(`/app/tasks/${seed.taskId}`, page.url()).href);
  await teammate.getByLabel("Due date").fill("2026-10-24");
  await teammate
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    teammate.getByText("Revision 4", { exact: false }),
  ).toBeVisible();
  await teammate.getByLabel("Due date").fill("2026-10-22");
  await teammate
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    teammate.getByText("Revision 5", { exact: false }),
  ).toBeVisible();
  await page.goto("/app/activity");
  const applied = page.locator("article").filter({
    has: page.getByRole("link", { name: "Inspect source proposal" }),
  });
  await applied.getByRole("button", { name: "Preview safe undo" }).click();
  await expect(
    page.getByText("A later edit or archive protects this work.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo eligible changes" }).click();
  await expect(page.getByRole("status")).toContainText(
    "2 fields restored or tasks archived. 1 conflicts preserved.",
  );
  await page.screenshot({
    path: ".local/evidence/undo-conflict.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto(`/app/tasks/${seed.taskId}`);
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("todo");
  await expect(page.getByLabel("Due date")).toHaveValue("2026-10-22");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("link", {
      name: "Prepare fictional product photos",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", {
      name: "Completed and unrelated work",
      exact: true,
    }),
  ).toBeVisible();
  await context.close();
});
