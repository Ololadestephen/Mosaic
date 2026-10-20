import "server-only";
import type { Actor, Role } from "@/domain/contracts";
import { memberInput, workspaceInput } from "@/domain/contracts";
import { requireCondition } from "@/domain/errors";
import { db } from "./db/client";
import { inWorkspace } from "./auth/authorization";

export async function listWorkspaces(actor: Actor) {
  return db()<
    { id: string; name: string; role: Role }[]
  >`SELECT w.id, w.name, m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id WHERE m.user_id = ${actor.userId} ORDER BY w.created_at`;
}

export async function createWorkspace(actor: Actor, raw: unknown) {
  const input = workspaceInput.parse(raw);
  return db().begin(async (tx) => {
    const [workspace] = await tx<
      { id: string; name: string }[]
    >`INSERT INTO workspaces (name, created_by) VALUES (${input.name}, ${actor.userId}) RETURNING id, name`;
    await tx`INSERT INTO memberships (workspace_id, user_id, role) VALUES (${workspace.id}, ${actor.userId}, 'owner')`;
    return workspace;
  });
}

export async function listMembers(actor: Actor, workspaceId: string) {
  return inWorkspace(
    actor,
    workspaceId,
    "read",
    async (tx) =>
      tx<
        { id: string; name: string; email: string; role: Role }[]
      >`SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ${workspaceId} ORDER BY u.name`,
  );
}

export async function setMember(
  actor: Actor,
  workspaceId: string,
  raw: unknown,
) {
  const input = memberInput.parse(raw);
  return inWorkspace(actor, workspaceId, "owner", async (tx) => {
    const [user] = await tx<
      { id: string }[]
    >`SELECT id FROM users WHERE email = ${input.email}`;
    requireCondition(
      user,
      "INVALID_INPUT",
      "That person must create their own account first. Mosaic does not send invitations.",
    );
    const [current] = await tx<
      { role: Role }[]
    >`SELECT role FROM memberships WHERE workspace_id = ${workspaceId} AND user_id = ${user.id}`;
    requireCondition(
      current?.role !== "owner",
      "FORBIDDEN",
      "Owner access cannot be changed here.",
    );
    await tx`INSERT INTO memberships (workspace_id, user_id, role) VALUES (${workspaceId}, ${user.id}, ${input.role}) ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`;
    return { id: user.id, role: input.role };
  });
}
