import "server-only";
import type { Actor } from "@/domain/contracts";
import { env } from "../env";

export function coverageAvailable(actor: Actor, config = env()) {
  return (
    process.env.VERCEL_ENV !== "preview" &&
    config.SERV_API_KEY.trim().length > 0 &&
    config.SERV_COVERAGE_ATTEMPT_LIMIT > 0 &&
    config.AI_ALLOWED_ACCOUNT_IDS.includes(actor.userId)
  );
}
