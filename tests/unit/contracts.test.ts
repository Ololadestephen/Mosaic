import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  analysisOutput,
  applyInput,
  dateOnly,
  editTaskInput,
} from "@/domain/contracts";
import { DomainError, requireCondition } from "@/domain/errors";
import { normalizeSource, validateCitation } from "@/domain/sources/citations";
import { validateAnalysis } from "@/domain/reconciliation/validate";
import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("domain boundaries", () => {
  it("accepts calendar dates without timezone conversion and rejects impossible dates", () => {
    expect(dateOnly.parse("2028-02-29")).toBe("2028-02-29");
    for (const value of [
      "2026-02-29",
      "2026-13-01",
      "0000-01-01",
      "2026-01-01T00:00:00Z",
    ])
      expect(dateOnly.safeParse(value).success).toBe(false);
  });
  it("rejects unsupported fields and duplicate selections", () => {
    expect(
      editTaskInput.safeParse({ expectedRevision: 1, title: "Overwrite" })
        .success,
    ).toBe(false);
    expect(
      applyInput.safeParse({
        changeSetId: randomUUID(),
        expectedRevision: 1,
        selectedKeys: ["a", "a"],
        operationKey: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      analysisOutput.safeParse({
        items: [],
        questions: [],
        preserved: [],
        execute: "anything",
      }).success,
    ).toBe(false);
  });
  it("uses stable, sanitized operation errors", () => {
    expect(() => requireCondition(false, "FORBIDDEN", "Viewer access")).toThrow(
      DomainError,
    );
    expect(new DomainError("CONFLICT", "Changed").status).toBe(409);
  });
  it("validates exact LF-normalized UTF-16 passages including emoji", () => {
    const text = normalizeSource("Launch 🚀\r\nShip Friday\rGo");
    const id = randomUUID();
    const versions = new Map([
      [
        id,
        { id, sourceId: randomUUID(), text, number: 1, predecessorId: null },
      ],
    ]);
    expect(text).toBe("Launch 🚀\nShip Friday\nGo");
    expect(() =>
      validateCitation(
        { sourceVersionId: id, start: 7, end: 9, quote: "🚀" },
        versions,
      ),
    ).not.toThrow();
    expect(() =>
      validateCitation(
        { sourceVersionId: id, start: 7, end: 8, quote: text.slice(7, 8) },
        versions,
      ),
    ).toThrow("Unicode");
    expect(() =>
      validateCitation(
        { sourceVersionId: id, start: 0, end: 6, quote: "Wrong!" },
        versions,
      ),
    ).toThrow("offsets");
  });
  it("rejects unknown model task IDs and preserves completed tasks", () => {
    const versionId = randomUUID();
    const taskId = randomUUID();
    const current = {
      id: versionId,
      sourceId: randomUUID(),
      text: "Ship Friday",
      number: 1,
      predecessorId: null,
    };
    const task = {
      id: taskId,
      workspaceId: randomUUID(),
      title: "Ship",
      status: "done" as const,
      assigneeId: null,
      dueDate: null,
      revision: 1,
      archived: false,
      lineage: {},
      restrictedTo: null,
    };
    const output = {
      items: [
        {
          kind: "update",
          key: "ship",
          taskId,
          expectedRevision: 1,
          field: "status",
          value: "todo",
          reason: "Changed",
          impact: "",
          citations: [
            {
              sourceVersionId: versionId,
              start: 0,
              end: 11,
              quote: "Ship Friday",
            },
          ],
        },
      ],
      questions: [],
      preserved: [],
    };
    expect(() =>
      validateAnalysis(output, {
        tasks: [task],
        memberIds: [],
        versions: [current],
        currentVersionId: versionId,
      }),
    ).toThrow("Completed");
    expect(() =>
      validateAnalysis(output, {
        tasks: [],
        memberIds: [],
        versions: [current],
        currentVersionId: versionId,
      }),
    ).toThrow("outside");
  });
  it("salts real password hashes and verifies credentials", async () => {
    const hash = await hashPassword("a long test password");
    expect(await verifyPassword("a long test password", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
    expect(hash).not.toBe(await hashPassword("a long test password"));
  });
});
