import { z } from "zod";
import { applyInput } from "@/domain/contracts";

export type ApplyAttempt = z.infer<typeof applyInput>;

function storageKey(workspaceId: string, changeSetId: string) {
  return `mosaic-apply-attempt:${workspaceId}:${changeSetId}`;
}

export function readApplyAttempt(workspaceId: string, changeSetId: string) {
  try {
    const attempt = applyInput.parse(
      JSON.parse(
        sessionStorage.getItem(storageKey(workspaceId, changeSetId)) ?? "null",
      ),
    );
    return attempt.changeSetId === changeSetId ? attempt : null;
  } catch {
    return null;
  }
}

export function saveApplyAttempt(workspaceId: string, attempt: ApplyAttempt) {
  try {
    sessionStorage.setItem(
      storageKey(workspaceId, attempt.changeSetId),
      JSON.stringify(applyInput.parse(attempt)),
    );
  } catch {
    throw new Error(
      "Browser recovery storage is unavailable. No apply request was sent. Allow session storage and try again.",
    );
  }
}

export function clearApplyAttempt(workspaceId: string, changeSetId: string) {
  try {
    sessionStorage.removeItem(storageKey(workspaceId, changeSetId));
    return true;
  } catch {
    // Cleanup is optional after the server has confirmed the immutable receipt.
    return false;
  }
}
