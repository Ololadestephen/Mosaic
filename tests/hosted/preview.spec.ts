import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  // Never send credentials or mutate data until the deployed revision matches.
  const health = await request.get("/api/health", { maxRedirects: 0 });
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    status: "ready",
    commit: process.env.MOSAIC_EXPECTED_COMMIT,
  });
});

test("AI-independent preview: exact PR revision and unauthenticated isolation", async ({
  request,
}) => {
  expect(
    (await request.get("/api/workspaces", { maxRedirects: 0 })).status(),
  ).toBe(401);
});

test("AI-independent preview: foreign-origin writes are denied", async ({
  request,
}) => {
  const response = await request.post("/api/workspaces", {
    maxRedirects: 0,
    headers: { Origin: "https://untrusted.example" },
    data: { name: "Synthetic forbidden workspace" },
  });
  expect(response.status()).toBe(403);
});

test("AI-independent preview: public registration is closed", async ({
  request,
  baseURL,
}) => {
  const response = await request.post("/api/auth/register", {
    maxRedirects: 0,
    headers: { Origin: baseURL! },
    data: {
      name: "Synthetic registration probe",
      email: "closed-registration-probe@mosaic.test",
      password: "synthetic-unused-passphrase",
    },
  });
  expect(response.status()).toBe(403);
});
