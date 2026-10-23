import { describe, expect, it } from "vitest";
import { fixtureIds } from "../../scripts/testsprite/seed-preview";

const SHA = "c277e5558b9cccd29c4ea771aebdb32238577e40";

describe("TestSprite fixture identity", () => {
  it("derives Python-compatible UUIDs from the exact commit and run", () => {
    expect(fixtureIds("20261021-1", SHA)).toEqual({
      workspaceId: "0564e786-8b59-4c8f-8d4a-5ab03e9679c9",
      sourceId: "90020991-29e8-43d2-8929-3d7209995372",
      versionId: "9a524822-9da7-4dcf-81b2-260539cc2107",
      taskId: "88547d7d-1582-4c4d-8998-010070f3735b",
      relatedTaskId: "4a401b0d-af3f-4311-8dd8-ce5aa01905f9",
      changeSetId: "2435ce17-e4b7-4b82-8c4b-3113b373c7dd",
    });
  });

  it("is stable for a retry but isolated between runs", () => {
    const first = fixtureIds("20261021-1", SHA);
    expect(fixtureIds("20261021-1", SHA)).toEqual(first);
    expect(fixtureIds("20261021-2", SHA)).not.toEqual(first);
    expect(new Set(Object.values(first)).size).toBe(6);
    for (const id of Object.values(first))
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
      );
  });
});
