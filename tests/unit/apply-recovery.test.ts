import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  clearApplyAttempt,
  readApplyAttempt,
  saveApplyAttempt,
} from "@/components/review/apply-recovery";

afterEach(() => vi.unstubAllGlobals());

describe("browser apply recovery intent", () => {
  it("retains the exact operation and payload across refresh and isolates workspaces", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    const workspaceId = randomUUID();
    const attempt = {
      changeSetId: randomUUID(),
      operationKey: randomUUID(),
      expectedRevision: 3,
      selectedKeys: ["status", "date"],
    };
    saveApplyAttempt(workspaceId, attempt);
    expect(readApplyAttempt(workspaceId, attempt.changeSetId)).toEqual(attempt);
    expect(readApplyAttempt(randomUUID(), attempt.changeSetId)).toBeNull();
    clearApplyAttempt(workspaceId, attempt.changeSetId);
    expect(readApplyAttempt(workspaceId, attempt.changeSetId)).toBeNull();
  });
  it("rejects corrupt storage and refuses to send an intent it cannot preserve", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => '{"operationKey":"not-an-id"}',
      setItem: () => {
        throw Error("blocked");
      },
    });
    expect(readApplyAttempt(randomUUID(), randomUUID())).toBeNull();
    expect(() =>
      saveApplyAttempt(randomUUID(), {
        changeSetId: randomUUID(),
        operationKey: randomUUID(),
        expectedRevision: 1,
        selectedKeys: ["status"],
      }),
    ).toThrow("No apply request was sent");
  });
});

it("optional cleanup failure does not hide a confirmed server receipt", () => {
  vi.stubGlobal("sessionStorage", {
    removeItem: () => {
      throw Error("storage denied");
    },
  });
  expect(clearApplyAttempt(randomUUID(), randomUUID())).toBe(false);
});
