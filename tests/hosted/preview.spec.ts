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
  expect(await response.json()).toMatchObject({
    code: "FORBIDDEN",
    error: "This request must come from the Mosaic application.",
    requestId: expect.any(String),
  });
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
  // Distinguish closed registration from a misconfigured preview origin.
  expect(await response.json()).toMatchObject({
    code: "FORBIDDEN",
    error: "Registration is currently closed.",
    requestId: expect.any(String),
  });
  const login = await request.post("/api/auth/login", {
    maxRedirects: 0,
    headers: { Origin: baseURL! },
    data: {
      email: "closed-registration-probe@mosaic.test",
      password: "synthetic-unused-passphrase",
    },
  });
  expect(login.status()).toBe(401);
  expect(login.headers()["set-cookie"]).toBeUndefined();
});

test("AI-independent preview: sign-in retains browser security headers", async ({
  request,
}) => {
  const response = await request.get("/login", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(headers["content-security-policy"]).toContain("form-action 'self'");
  expect(headers["x-powered-by"]).toBeUndefined();
});
