import "server-only";
import type { Actor } from "@/domain/contracts";
import { env, openAppAccountId } from "../env";

export function analysisAccessAllowed(actor: Actor, config = env()) {
  const restricted =
    process.env.VERCEL_ENV === "production" ||
    config.AI_ALLOWED_ACCOUNT_IDS.length > 0;
  if (actor.userId === openAppAccountId()) return false;
  return !restricted || config.AI_ALLOWED_ACCOUNT_IDS.includes(actor.userId);
}
