import "server-only";
import type { Actor } from "@/domain/contracts";
import { sourceVisibleTo, taskVisibleTo } from "./auth/visibility";
import {
  supportingPassageChange,
  type PassageChange,
} from "@/domain/sources/passage-change";
import type { Transaction } from "./db/client";

export type PassageReview = {
  taskId: string;
  taskTitle: string;
  sourceId: string;
  citedVersionId: string;
  laterVersionId: string;
  laterNumber: number;
  start: number;
  end: number;
  quote: string;
  change: Exclude<PassageChange, "unchanged">;
};

type VersionRow = {
  id: string;
  sourceId: string;
  predecessorId: string | null;
  number: number;
  text: string;
};

export async function listPassageReviews(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
  filter: { sourceId?: string; taskId?: string } = {},
): Promise<PassageReview[]> {
  const sourceId = filter.sourceId ?? null;
  const taskId = filter.taskId ?? null;
  const evidence = await tx<
    {
      taskId: string;
      taskTitle: string;
      sourceId: string;
      citedVersionId: string;
      start: number;
      end: number;
      quote: string;
    }[]
  >`SELECT e.task_id AS "taskId", t.title AS "taskTitle", s.id AS "sourceId", v.id AS "citedVersionId", e.start_offset AS start, e.end_offset AS "end", e.quote FROM task_evidence e JOIN tasks t ON t.workspace_id = e.workspace_id AND t.id = e.task_id JOIN source_versions v ON v.workspace_id = e.workspace_id AND v.id = e.source_version_id JOIN sources s ON s.workspace_id = v.workspace_id AND s.id = v.source_id WHERE e.workspace_id = ${workspaceId} AND t.archived = false AND ${taskVisibleTo(actor)} AND ${sourceVisibleTo(actor)} AND (${sourceId}::uuid IS NULL OR s.id = ${sourceId}::uuid) AND (${taskId}::uuid IS NULL OR t.id = ${taskId}::uuid)`;
  if (!evidence.length) return [];
  const versions = await tx<
    VersionRow[]
  >`SELECT v.id, v.source_id AS "sourceId", v.predecessor_id AS "predecessorId", v.number::int AS number, v.text FROM source_versions v JOIN sources s ON s.workspace_id = v.workspace_id AND s.id = v.source_id WHERE v.workspace_id = ${workspaceId} AND ${sourceVisibleTo(actor)} AND (${sourceId}::uuid IS NULL OR v.source_id = ${sourceId}::uuid)`;
  const bySource = new Map<string, VersionRow[]>();
  for (const version of versions) {
    const group = bySource.get(version.sourceId) ?? [];
    group.push(version);
    bySource.set(version.sourceId, group);
  }
  const reviews: PassageReview[] = [];
  for (const item of evidence) {
    const start = Number(item.start);
    const end = Number(item.end);
    const history = bySource.get(item.sourceId) ?? [];
    const cited = history.find((version) => version.id === item.citedVersionId);
    const later = cited ? laterRevision(history, cited.id) : undefined;
    if (!cited || !later || !Number.isInteger(start) || !Number.isInteger(end))
      continue;
    if (cited.text.slice(start, end) !== item.quote) continue;
    const change = supportingPassageChange(cited.text, later.text, start, end);
    if (change === "unchanged") continue;
    reviews.push({
      taskId: item.taskId,
      taskTitle: item.taskTitle,
      sourceId: item.sourceId,
      citedVersionId: cited.id,
      laterVersionId: later.id,
      laterNumber: later.number,
      start,
      end,
      quote: item.quote,
      change,
    });
  }
  return reviews.sort(
    (left, right) =>
      left.taskTitle.localeCompare(right.taskTitle) || left.start - right.start,
  );
}

function laterRevision(
  versions: VersionRow[],
  citedVersionId: string,
): VersionRow | undefined {
  if (!versions.length) return undefined;
  const byId = new Map(versions.map((version) => [version.id, version]));
  const latest = versions.reduce((best, version) =>
    version.number > best.number ? version : best,
  );
  const seen = new Set<string>();
  let cursor: VersionRow | undefined = latest;
  while (cursor && !seen.has(cursor.id)) {
    if (cursor.id === citedVersionId)
      return latest.id === citedVersionId ? undefined : latest;
    seen.add(cursor.id);
    cursor = cursor.predecessorId ? byId.get(cursor.predecessorId) : undefined;
  }
  return undefined;
}
