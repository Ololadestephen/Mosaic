import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { account, prepareDatabase, workspace } from "./helpers";
import { closeDatabase, db } from "@/server/db/client";
import {
  digest,
  signIn,
  resolveSession,
  signOut,
} from "@/server/auth/accounts";
import { listWorkspaces, setMember } from "@/server/workspaces";
import {
  addRevision,
  createSource,
  getSource,
  listSources,
} from "@/server/sources";
import { createTask, editTask, listTasks } from "@/server/tasks";

beforeAll(prepareDatabase);
afterAll(closeDatabase);

describe("real PostgreSQL workspace", () => {
  it("enforces private-source inheritance at the database boundary", async () => {
    const owner = await workspace();
    const source = await createSource(owner.actor, owner.workspaceId, {
      title: "Private evidence",
      text: "Secret",
      visibility: "private",
    });
    const shared = await createTask(
      owner.actor,
      owner.workspaceId,
      { title: "Shared task", status: "todo", assigneeId: null, dueDate: null },
      randomUUID(),
    );
    await expect(
      db()`INSERT INTO task_evidence (workspace_id, task_id, source_version_id, start_offset, end_offset, quote) VALUES (${owner.workspaceId}, ${shared.taskIds[0]}, ${source.versionId}, 0, 6, 'Secret')`,
    ).rejects.toMatchObject({ code: "23000" });
    await expect(
      db()`UPDATE sources SET visibility = 'workspace' WHERE id = ${source.sourceId}`,
    ).rejects.toMatchObject({ code: "23000" });
    await expect(
      db()`INSERT INTO change_sets (workspace_id, source_version_id, created_by, restricted_to, items, questions, preserved) VALUES (${owner.workspaceId}, ${source.versionId}, ${owner.actor.userId}, NULL, '[]', '[]', '[]')`,
    ).rejects.toMatchObject({ code: "23000" });
  });
  it("creates authenticated workspaces and rejects guessed cross-workspace requests", async () => {
    const owner = await workspace();
    const outsider = await account("Outsider");
    expect((await listWorkspaces(owner.actor))[0].id).toBe(owner.workspaceId);
    expect(await listWorkspaces(outsider.actor)).toHaveLength(0);
    await expect(
      listTasks(outsider.actor, owner.workspaceId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await resolveSession(owner.token))?.id).toBe(owner.actor.userId);
    await signOut(owner.token);
    expect(await resolveSession(owner.token)).toBeNull();
  });
  it("enforces viewer/editor permissions and hides private sources and tasks", async () => {
    const owner = await workspace();
    const viewer = await account("Viewer");
    await setMember(owner.actor, owner.workspaceId, {
      email: viewer.account.email,
      role: "viewer",
    });
    await createSource(owner.actor, owner.workspaceId, {
      title: "Private brief",
      text: "Private supplier",
      visibility: "private",
    });
    await createTask(
      owner.actor,
      owner.workspaceId,
      {
        title: "Private work",
        status: "todo",
        assigneeId: null,
        dueDate: null,
        visibility: "private",
      },
      randomUUID(),
    );
    expect(await listSources(viewer.actor, owner.workspaceId)).toHaveLength(0);
    expect(await listTasks(viewer.actor, owner.workspaceId)).toHaveLength(0);
    await expect(
      createSource(viewer.actor, owner.workspaceId, {
        title: "Forbidden",
        text: "Text",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await setMember(owner.actor, owner.workspaceId, {
      email: viewer.account.email,
      role: "editor",
    });
    const source = await createSource(viewer.actor, owner.workspaceId, {
      title: "Shared brief",
      text: "Launch",
    });
    expect(
      (await getSource(viewer.actor, owner.workspaceId, source.sourceId))
        .versions[0].text,
    ).toBe("Launch");
    expect(await listSources(viewer.actor, owner.workspaceId)).toHaveLength(1);
  });
  it("reuses a source creation for the same operation key and rejects a changed request", async () => {
    const owner = await workspace();
    const operationKey = randomUUID();
    const body = { title: "Launch brief", text: "First brief" };
    const first = await createSource(
      owner.actor,
      owner.workspaceId,
      body,
      operationKey,
    );
    const retried = await createSource(
      owner.actor,
      owner.workspaceId,
      body,
      operationKey,
    );
    expect(retried).toEqual(first);
    expect(await listSources(owner.actor, owner.workspaceId)).toHaveLength(1);
    await expect(
      createSource(
        owner.actor,
        owner.workspaceId,
        { ...body, title: "Different brief" },
        operationKey,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("deduplicates simultaneous revision requests while allowing a legitimate content reversion", async () => {
    const owner = await workspace();
    const source = await createSource(owner.actor, owner.workspaceId, {
      title: "Launch",
      text: "First\r\nbrief",
    });
    const [a, b] = await Promise.all(
      [1, 2].map(() =>
        addRevision(owner.actor, owner.workspaceId, source.sourceId, {
          predecessorId: source.versionId,
          text: "Second brief",
        }),
      ),
    );
    expect(a.versionId).toBe(b.versionId);
    const third = await addRevision(
      owner.actor,
      owner.workspaceId,
      source.sourceId,
      { predecessorId: a.versionId, text: "First\nbrief" },
    );
    expect(third.versionId).not.toBe(source.versionId);
    expect(
      (
        await getSource(owner.actor, owner.workspaceId, source.sourceId)
      ).versions.map((v) => v.number),
    ).toEqual([3, 2, 1]);
    await expect(
      addRevision(owner.actor, owner.workspaceId, source.sourceId, {
        predecessorId: source.versionId,
        text: "Another branch",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      db()`UPDATE source_versions SET text = 'tampered' WHERE id = ${third.versionId}`,
    ).rejects.toThrow("immutable");
  });
  it("persists stable task IDs and makes a real concurrent edit lose with a conflict", async () => {
    const owner = await workspace();
    const result = await createTask(
      owner.actor,
      owner.workspaceId,
      {
        title: "Launch",
        status: "todo",
        assigneeId: null,
        dueDate: "2026-10-22",
      },
      randomUUID(),
    );
    const taskId = result.taskIds[0];
    const attempts = await Promise.allSettled(
      ["in_progress", "done"].map((status) =>
        editTask(
          owner.actor,
          owner.workspaceId,
          taskId,
          { status, expectedRevision: 1 },
          randomUUID(),
        ),
      ),
    );
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
    const [task] = await listTasks(owner.actor, owner.workspaceId);
    expect(task.id).toBe(taskId);
    expect(task.revision).toBe(2);
    expect(task.dueDate).toBe("2026-10-22");
  });
  it("rejects an assignee from another workspace at both service and database boundaries", async () => {
    const owner = await workspace();
    const outsider = await account();
    await expect(
      createTask(
        owner.actor,
        owner.workspaceId,
        {
          title: "Invalid",
          status: "todo",
          assigneeId: outsider.actor.userId,
          dueDate: null,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      db()`INSERT INTO tasks (workspace_id, title, assignee_id) VALUES (${owner.workspaceId}, 'Invalid', ${outsider.actor.userId})`,
    ).rejects.toMatchObject({ code: "23503" });
  });
});

describe("real PostgreSQL authentication time boundaries", () => {
  it("rejects an expired session without deleting unrelated sessions", async () => {
    const owner = await account();
    const other = await account();
    await db()`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = ${digest(owner.token)}`;
    expect(await resolveSession(owner.token)).toBeNull();
    expect((await resolveSession(other.token))?.id).toBe(other.actor.userId);
  });
  it("permits attempt fifteen, rejects sixteen without a session and resets an elapsed window", async () => {
    const owner = await account();
    const key = digest(`signin:${owner.account.email}`);
    await db()`UPDATE rate_limits SET attempts = 14 WHERE key = ${key}`;
    const input = {
      email: owner.account.email,
      password: "local-test-password-only",
    };
    await expect(signIn(input, false)).resolves.toHaveProperty("token");
    const [before] =
      await db()`SELECT count(*)::int AS count FROM sessions WHERE user_id = ${owner.actor.userId}`;
    await expect(signIn(input, false)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    const [after] =
      await db()`SELECT count(*)::int AS count FROM sessions WHERE user_id = ${owner.actor.userId}`;
    expect(after.count).toBe(before.count);
    await db()`UPDATE rate_limits SET window_start = now() - interval '16 minutes' WHERE key = ${key}`;
    await expect(signIn(input, false)).resolves.toHaveProperty("token");
    const [limit] =
      await db()`SELECT attempts FROM rate_limits WHERE key = ${key}`;
    expect(limit.attempts).toBe(1);
  });
});
