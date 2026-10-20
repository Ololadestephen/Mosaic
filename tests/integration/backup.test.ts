import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { prepareDatabase, workspace } from "./helpers";
import { createSource } from "@/server/sources";
import { createTask } from "@/server/tasks";
import { closeDatabase } from "@/server/db/client";
import { logicalBackup, restoreTestBackup } from "@/server/db/backup";
import { migrate } from "../../scripts/migrate";

beforeAll(prepareDatabase);
afterAll(closeDatabase);

it("restores a consistent snapshot into a fresh PostgreSQL database and refuses nonempty targets", async () => {
  const owner = await workspace();
  const source = await createSource(owner.actor, owner.workspaceId, {
    title: "Backup fixture",
    text: "Immutable evidence",
  });
  const created = await createTask(
    owner.actor,
    owner.workspaceId,
    {
      title: "Restorable work",
      status: "todo",
      assigneeId: null,
      dueDate: "2026-10-22",
    },
    randomUUID(),
  );
  const backup = await logicalBackup(process.env.DATABASE_URL!);
  const name = `mosaic_${randomUUID().replaceAll("-", "")}_restore_test`;
  const target = new URL(process.env.DATABASE_URL!);
  target.pathname = `/${name}`;
  const admin = postgres(process.env.DATABASE_URL!, { max: 1 });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  try {
    await migrate(target.toString());
    await restoreTestBackup(target.toString(), backup);
    const restored = postgres(target.toString(), { max: 1 });
    try {
      const [task] = await restored<
        { title: string; due_date: string }[]
      >`SELECT title, due_date::text FROM tasks WHERE id = ${created.taskIds[0]}`;
      const [version] = await restored<
        { text: string }[]
      >`SELECT text FROM source_versions WHERE id = ${source.versionId}`;
      expect(task.title).toBe("Restorable work");
      expect(task.due_date).toBe("2026-10-22");
      expect(version.text).toBe("Immutable evidence");
      expect((await restored`SELECT * FROM sessions`).length).toBe(0);
      await expect(
        restoreTestBackup(target.toString(), backup),
      ).rejects.toThrow("empty");
    } finally {
      await restored.end();
    }
  } finally {
    await admin.unsafe(`DROP DATABASE ${name}`);
    await admin.end();
  }
});
