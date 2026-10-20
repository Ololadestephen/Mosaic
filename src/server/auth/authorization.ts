import "server-only";
import type { Actor, Role } from "@/domain/contracts";
import { DomainError, requireCondition } from "@/domain/errors";
import { db, type Transaction } from "../db/client";

async function authorize(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
  access: "read" | "write" | "owner" = "read",
): Promise<Role> {
  const [membership] = await tx<
    { role: Role }[]
  >`SELECT role FROM memberships WHERE workspace_id = ${workspaceId} AND user_id = ${actor.userId}`;
  requireCondition(membership, "NOT_FOUND", "Workspace not found.");
  if (access !== "read")
    requireCondition(
      membership.role !== "viewer",
      "FORBIDDEN",
      "Viewer access cannot change this workspace.",
    );
  if (access === "owner")
    requireCondition(
      membership.role === "owner",
      "FORBIDDEN",
      "Only the workspace owner can manage members.",
    );
  return membership.role;
}

export async function inWorkspace<T>(
  actor: Actor,
  workspaceId: string,
  access: "read" | "write" | "owner",
  operation: (tx: Transaction) => Promise<T>,
): Promise<T> {
  try {
    return (await db().begin(async (tx) => {
      if (access !== "read") {
        const [workspace] =
          await tx`SELECT w.id FROM workspaces w JOIN memberships m ON m.workspace_id = w.id WHERE w.id = ${workspaceId} AND m.user_id = ${actor.userId} FOR UPDATE OF w`;
        requireCondition(workspace, "NOT_FOUND", "Workspace not found.");
      }
      await authorize(tx, actor, workspaceId, access);
      return operation(tx);
    })) as T;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (isDatabaseError(error)) {
      console.error({ type: "DatabaseError", code: error.code });
      throw new DomainError(
        "UNAVAILABLE",
        "The change was not saved. Try the same operation again.",
      );
    }
    throw error;
  }
}

function isDatabaseError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "severity" in error &&
    "code" in error &&
    typeof error.code === "string"
  );
}

export function assertVisible(restrictedTo: string | null, actor: Actor): void {
  requireCondition(
    restrictedTo === null || restrictedTo === actor.userId,
    "NOT_FOUND",
    "Record not found.",
  );
}
