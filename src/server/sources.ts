import "server-only";
import type { Actor, SourceVersion } from "@/domain/contracts";
import { revisionInput, sourceInput } from "@/domain/contracts";
import { requireCondition } from "@/domain/errors";
import { normalizeSource } from "@/domain/sources/citations";
import { digest } from "./auth/accounts";
import { inWorkspace } from "./auth/authorization";
import { recordVisibleTo, sourceVisibleTo } from "./auth/visibility";
import type { Transaction } from "./db/client";
import { listPassageReviews } from "./passage-signals";

export type Source = {
  id: string;
  title: string;
  visibility: "workspace" | "private";
  ownerId: string;
  versionCount: number;
  latestVersionId: string;
};

async function readableSource(
  tx: Transaction,
  actor: Actor,
  workspaceId: string,
  sourceId: string,
): Promise<Source> {
  const [source] = await tx<
    Source[]
  >`SELECT s.id, s.title, s.visibility, s.owner_id AS "ownerId", (SELECT max(number) FROM source_versions v WHERE v.source_id = s.id) AS "versionCount", (SELECT id FROM source_versions v WHERE v.source_id = s.id ORDER BY number DESC LIMIT 1) AS "latestVersionId" FROM sources s WHERE s.workspace_id = ${workspaceId} AND s.id = ${sourceId} AND ${sourceVisibleTo(actor)}`;
  requireCondition(source, "NOT_FOUND", "Source not found.");
  return source;
}

export async function listSources(actor: Actor, workspaceId: string) {
  return inWorkspace(
    actor,
    workspaceId,
    "read",
    async (tx) =>
      tx<
        Source[]
      >`SELECT s.id, s.title, s.visibility, s.owner_id AS "ownerId", max(v.number)::int AS "versionCount", (array_agg(v.id ORDER BY v.number DESC))[1] AS "latestVersionId" FROM sources s JOIN source_versions v ON v.source_id = s.id AND v.workspace_id = s.workspace_id WHERE s.workspace_id = ${workspaceId} AND ${sourceVisibleTo(actor)} GROUP BY s.id ORDER BY s.created_at DESC`,
  );
}

export async function getSource(
  actor: Actor,
  workspaceId: string,
  sourceId: string,
) {
  return inWorkspace(actor, workspaceId, "read", async (tx) => {
    const source = await readableSource(tx, actor, workspaceId, sourceId);
    const versions = await tx<
      SourceVersion[]
    >`SELECT id, source_id AS "sourceId", text, number, predecessor_id AS "predecessorId" FROM source_versions WHERE workspace_id = ${workspaceId} AND source_id = ${sourceId} ORDER BY number DESC`;
    const changes = await tx<
      { id: string; sourceVersionId: string; state: string }[]
    >`SELECT id, source_version_id AS "sourceVersionId", state FROM change_sets WHERE workspace_id = ${workspaceId} AND source_version_id IN (SELECT id FROM source_versions WHERE source_id = ${sourceId}) AND ${recordVisibleTo(actor)}`;
    const analysisRuns = await tx<
      {
        sourceVersionId: string;
        status: string;
        startedAt: string;
        errorCode: string | null;
        provider: "gemini" | "openrouter";
        model: string;
        providerHttpStatus: number | null;
        providerErrorCode: string | null;
      }[]
    >`SELECT source_version_id AS "sourceVersionId", status, started_at::text AS "startedAt", error_code AS "errorCode", provider, model, provider_http_status AS "providerHttpStatus", provider_error_code AS "providerErrorCode" FROM analysis_runs WHERE workspace_id = ${workspaceId} AND source_version_id IN (SELECT id FROM source_versions WHERE source_id = ${sourceId}) AND ${recordVisibleTo(actor)} ORDER BY started_at DESC LIMIT 10`;
    const passageReviews = await listPassageReviews(tx, actor, workspaceId, {
      sourceId,
    });
    return { ...source, versions, changes, analysisRuns, passageReviews };
  });
}

export async function createSource(
  actor: Actor,
  workspaceId: string,
  raw: unknown,
) {
  const input = sourceInput.parse(raw);
  const text = normalizeSource(input.text);
  return inWorkspace(actor, workspaceId, "write", async (tx) => {
    const [source] = await tx<
      { id: string }[]
    >`INSERT INTO sources (workspace_id, owner_id, title, visibility) VALUES (${workspaceId}, ${actor.userId}, ${input.title}, ${input.visibility}) RETURNING id`;
    const [version] = await tx<
      { id: string }[]
    >`INSERT INTO source_versions (workspace_id, source_id, number, text, content_hash, created_by) VALUES (${workspaceId}, ${source.id}, 1, ${text}, ${digest(text)}, ${actor.userId}) RETURNING id`;
    return { sourceId: source.id, versionId: version.id };
  });
}

export async function addRevision(
  actor: Actor,
  workspaceId: string,
  sourceId: string,
  raw: unknown,
) {
  const input = revisionInput.parse(raw);
  const text = normalizeSource(input.text);
  return inWorkspace(actor, workspaceId, "write", async (tx) => {
    const source = await readableSource(tx, actor, workspaceId, sourceId);
    const hash = digest(text);
    const [existing] = await tx<
      { id: string }[]
    >`SELECT id FROM source_versions WHERE workspace_id = ${workspaceId} AND source_id = ${sourceId} AND predecessor_id = ${input.predecessorId} AND content_hash = ${hash}`;
    if (existing) return { versionId: existing.id, reused: true };
    requireCondition(
      source.latestVersionId === input.predecessorId,
      "CONFLICT",
      "This source has a newer revision. Review it before choosing a predecessor.",
    );
    const [version] = await tx<
      { id: string }[]
    >`INSERT INTO source_versions (workspace_id, source_id, predecessor_id, number, text, content_hash, created_by) VALUES (${workspaceId}, ${sourceId}, ${input.predecessorId}, ${source.versionCount + 1}, ${text}, ${hash}, ${actor.userId}) RETURNING id`;
    // Decision support changed; this does not authorize task mutations.
    await tx`UPDATE decisions SET needs_review = true, revision = revision + 1 WHERE workspace_id = ${workspaceId} AND source_version_id = ${input.predecessorId}`;
    return { versionId: version.id, reused: false };
  });
}
