import "server-only";
import { requireCondition } from "@/domain/errors";
import { db } from "../db/client";
import { openAppAccountId } from "../env";
import { type Account, rateLimit, startSession } from "./accounts";

const day = 24 * 60 * 60 * 1000;

export const isOpenAppAccount = (userId: string) =>
  userId === openAppAccountId();

// Starts a session for the shared visitor account. Refuses unless that account is an editor of exactly one
// workspace, so a misconfigured ID can never open an owner's account or someone's private workspaces.
export async function enterOpenApp(client: string) {
  const userId = openAppAccountId();
  requireCondition(userId, "NOT_FOUND", "The open app is unavailable.");
  await rateLimit(`open-app:${client}`);
  return db().begin(async (tx) => {
    const memberships = await tx<{ workspaceId: string; role: string }[]>`
      SELECT workspace_id AS "workspaceId", role FROM memberships WHERE user_id = ${userId}`;
    requireCondition(
      memberships.length === 1 && memberships[0].role === "editor",
      "UNAVAILABLE",
      "The open app is not ready yet.",
    );
    const [account] = await tx<
      Account[]
    >`SELECT id, email, name FROM users WHERE id = ${userId}`;
    requireCondition(account, "UNAVAILABLE", "The open app is not ready yet.");
    const session = await startSession(account, new Date(Date.now() + day), tx);
    return { ...session, workspaceId: memberships[0].workspaceId };
  });
}
