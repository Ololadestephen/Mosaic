import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { account, prepareDatabase } from "./helpers";
import { db, closeDatabase } from "@/server/db/client";
import { fixtureIds, seedFixture } from "../../scripts/testsprite/seed-preview";
import {
  appFixtureProposal,
  APP_FIXTURE_SOURCE_TEXT,
} from "../fixtures/app-verification";

beforeAll(prepareDatabase);
afterAll(closeDatabase);

describe("operator fixture transaction on isolated PostgreSQL", () => {
  async function input() {
    const owner = await account();
    const ids = fixtureIds(randomUUID(), "a".repeat(40));
    return {
      ids,
      ownerEmail: owner.account.email,
      workspaceName: "Synthetic seed transaction",
      taskTitle: "Original",
      relatedTaskTitle: "Related",
      sourceTitle: "Synthetic source",
      sourceText: APP_FIXTURE_SOURCE_TEXT,
      proposal: appFixtureProposal(ids.taskId, ids.versionId),
    };
  }

  it("persists a complete fixture and never resets an existing run", async () => {
    const seed = await input();
    expect(await db().begin((tx) => seedFixture(tx, seed))).toEqual({
      seeded: true,
    });
    const [version] =
      await db()`SELECT content_hash FROM source_versions WHERE id=${seed.ids.versionId}`;
    expect(version.content_hash).toBe(
      createHash("sha256").update(seed.sourceText).digest("hex"),
    );
    expect(
      await db()`SELECT id FROM tasks WHERE workspace_id=${seed.ids.workspaceId}`,
    ).toHaveLength(2);
    expect(
      await db()`SELECT id FROM change_sets WHERE id=${seed.ids.changeSetId}`,
    ).toHaveLength(1);
    await db()`UPDATE tasks SET title='Preserved later work',revision=revision+1 WHERE id=${seed.ids.taskId}`;
    expect(await db().begin((tx) => seedFixture(tx, seed))).toEqual({
      seeded: false,
    });
    const [task] =
      await db()`SELECT title,revision FROM tasks WHERE id=${seed.ids.taskId}`;
    expect(task).toMatchObject({ title: "Preserved later work", revision: 2 });
  });

  it("rejects an absent owner or invalid proposal without partial fixture rows", async () => {
    const seed = await input();
    await expect(
      db().begin((tx) =>
        seedFixture(tx, { ...seed, ownerEmail: `${randomUUID()}@mosaic.test` }),
      ),
    ).rejects.toThrow("owner account");
    await expect(
      db().begin((tx) =>
        seedFixture(tx, { ...seed, proposal: { items: [{}] } }),
      ),
    ).rejects.toThrow();
    expect(
      await db()`SELECT id FROM workspaces WHERE id=${seed.ids.workspaceId}`,
    ).toHaveLength(0);
    expect(
      await db()`SELECT id FROM tasks WHERE workspace_id=${seed.ids.workspaceId}`,
    ).toHaveLength(0);
  });
});
