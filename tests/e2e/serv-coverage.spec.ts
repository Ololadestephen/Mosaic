import { expect, test } from "@playwright/test";
import { seedWorkspace, signInFixture } from "./fixtures";

test("labelled coverage response fixture: review uncovered source, then apply one selection", async ({
  page,
}) => {
  const seed = await seedWorkspace("coverage");
  const reviewPath = `/api/workspaces/${seed.workspaceId}/changes/${seed.changeSetId}`;
  await page.route(`**${reviewPath}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), coverageAvailable: true },
    });
  });
  await page.route(`**${reviewPath}/coverage`, (route) => {
    const fingerprint = "fixture";
    return route.fulfill({
      json:
        route.request().method() === "GET"
          ? { fingerprint }
          : {
              fingerprint,
              entries: [
                {
                  passageId: "selected:0",
                  status: "uncovered",
                  reason: "Confirm a backup owner.",
                  proposalKeys: [],
                  taskIds: [],
                  taskTitles: [],
                  versionId: seed.versionId,
                  sourceId: seed.sourceId,
                  versionNumber: 2,
                  passage: {
                    id: "selected:0",
                    side: "selected",
                    start: 0,
                    end: 20,
                    text: "FICTIONAL TEST BRIEF",
                  },
                },
              ],
            },
    });
  });
  await signInFixture(page, seed);
  await expect(page).toHaveURL(/\/app$/);
  await page.goto(`/app/changes/${seed.changeSetId}`);
  await page.getByRole("button", { name: "Check coverage" }).click();
  await expect(page.getByText("1 classified · 1 uncovered")).toBeVisible();
  const sourceLink = page.getByRole("link", {
    name: "Source passage · v2",
    exact: true,
  });
  await expect(sourceLink).toHaveAttribute(
    "href",
    `/app/sources/${seed.sourceId}?version=${seed.versionId}&start=0&end=20`,
  );
  const checkboxes = page.getByRole("checkbox");
  for (const checkbox of await checkboxes.all())
    await expect(checkbox).not.toBeChecked();
  await checkboxes.first().check();
  await page
    .getByRole("button", { name: "Apply selected changes", exact: true })
    .click();
  await expect(page.getByText("1 item committed.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What was saved" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check coverage" }),
  ).toHaveCount(0);
});
