import { afterEach, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/server/db/client", () => ({ db: () => query }));
import { GET } from "@/app/api/health/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
it("reports the build revision only when migrations are ready", async () => {
  vi.stubEnv("MOSAIC_BUILD_COMMIT", "a".repeat(40));
  query.mockResolvedValue([{ count: 6 }]);
  const ready = await GET();
  expect(ready.status).toBe(200);
  expect(await ready.json()).toEqual({
    status: "ready",
    version: "0.1.0",
    commit: "a".repeat(40),
  });
  expect(ready.headers.get("cache-control")).toBe("no-store");
  query.mockResolvedValue([{ count: 5 }]);
  const unavailable = await GET();
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ status: "unavailable" });
});
