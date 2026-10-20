import type { Actor } from "@/domain/contracts";
import { db } from "../db/client";

export function sourceVisibleTo(actor: Actor) {
  return db()`(s.visibility = 'workspace' OR s.owner_id = ${actor.userId})`;
}

export function taskVisibleTo(actor: Actor) {
  return db()`(t.restricted_to IS NULL OR t.restricted_to = ${actor.userId})`;
}

export function recordVisibleTo(actor: Actor) {
  return db()`(restricted_to IS NULL OR restricted_to = ${actor.userId})`;
}

export function batchVisibleTo(actor: Actor) {
  return db()`(b.restricted_to IS NULL OR b.restricted_to = ${actor.userId})`;
}
