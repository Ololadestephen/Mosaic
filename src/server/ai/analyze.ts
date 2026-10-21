import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { id, type Actor } from "@/domain/contracts";
import { DomainError, requireCondition } from "@/domain/errors";
import { inWorkspace } from "../auth/authorization";
import { analysisContext, saveProposal } from "../reconciliation";
import { env } from "../env";
import { callProvider, prepareAnalysis } from "./provider";
import { promptVersion } from "./prompt";
import { GeminiHttpError, type ProviderResult } from "./gemini";
import { resolveGeminiOutput } from "./gemini-citations";

export async function analyzeSource(
  actor: Actor,
  workspaceId: string,
  raw: unknown,
  signal?: AbortSignal,
) {
  const input = z.object({ sourceVersionId: id }).strict().parse(raw);
  const prepared = await inWorkspace(
    actor,
    workspaceId,
    "write",
    async (tx) => {
      const context = await analysisContext(
        tx,
        actor,
        workspaceId,
        input.sourceVersionId,
      );
      const [existing] = await tx<
        { id: string }[]
      >`SELECT id FROM change_sets WHERE workspace_id = ${workspaceId} AND source_version_id = ${input.sourceVersionId}`;
      if (existing) return { existing };
      const config = env();
      const request = prepareAnalysis(context);
      // Global provider budget reservation and per-account frequency checks are serialized.
      await tx`SELECT pg_advisory_xact_lock(682051007)`;
      await tx`UPDATE analysis_runs SET status = 'failed', error_code = 'INTERRUPTED', completed_at = now() WHERE status = 'running' AND started_at < now() - interval '2 minutes'`;
      const [running] =
        await tx`SELECT id FROM analysis_runs WHERE workspace_id = ${workspaceId} AND source_version_id = ${input.sourceVersionId} AND status = 'running'`;
      requireCondition(
        !running,
        "CONFLICT",
        "This revision is already being analyzed. Check back before trying again.",
      );
      const [usage] = await tx<
        { calls: number; total: string }[]
      >`SELECT count(*) FILTER (WHERE actor_id = ${actor.userId})::int AS calls, coalesce(sum(reserved_usd), 0)::text AS total FROM analysis_runs WHERE provider = ${request.provider} AND started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
      requireCondition(
        usage.calls < config.AI_DAILY_CALL_LIMIT,
        "RATE_LIMITED",
        "Your daily analysis call limit has been reached.",
      );
      requireCondition(
        Number(usage.total) + request.reservedUsd <= config.AI_DAILY_BUDGET_USD,
        "RATE_LIMITED",
        "The approved daily analysis budget cannot cover this request.",
      );
      const [recent] =
        await tx`SELECT id FROM analysis_runs WHERE actor_id = ${actor.userId} AND started_at > now() - interval '15 seconds'`;
      requireCondition(
        !recent,
        "RATE_LIMITED",
        "Wait a moment before starting another analysis.",
      );
      const validationId =
        request.provider === "gemini" ? config.GEMINI_VALIDATION_ID : null;
      if (request.provider === "gemini") {
        const [usage] = await tx<
          { calls: number }[]
        >`SELECT count(*)::int AS calls FROM analysis_runs WHERE provider = 'gemini' AND validation_id = ${validationId}`;
        requireCondition(
          usage.calls < config.GEMINI_VALIDATION_CALL_LIMIT,
          "QUOTA_EXHAUSTED",
          "The shared Gemini validation request cap has been reached. No generation request was sent.",
        );
      }
      const runId = randomUUID();
      await tx`INSERT INTO analysis_runs (id, workspace_id, source_version_id, actor_id, restricted_to, status, provider, validation_id, model, prompt_version, reserved_usd) VALUES (${runId}, ${workspaceId}, ${input.sourceVersionId}, ${actor.userId}, ${context.restrictedTo}, 'running', ${request.provider}, ${validationId}, ${request.model}, ${promptVersion}, ${request.reservedUsd})`;
      return { context, request, runId };
    },
  );
  if (prepared.existing) return prepared.existing;
  const { context, request, runId } = prepared;
  let response: ProviderResult | undefined;
  const started = Date.now();
  try {
    // Network calls happen outside every database write transaction.
    const generation = await callProvider(
      request,
      signal,
      async (rawResponse) => {
        // Keep exact raw HTTP body separate from the resolved proposal, including invalid output.
        // Persist only after rechecking the original workspace/private-source permission.
        await inWorkspace(actor, workspaceId, "write", async (tx) => {
          const rows =
            await tx`UPDATE analysis_runs SET raw_provider_response=${rawResponse} WHERE id=${runId} AND workspace_id=${workspaceId} AND status='running' RETURNING id`;
          requireCondition(
            rows.length === 1,
            "CONFLICT",
            "The analysis run was interrupted. No proposal was saved.",
          );
        });
      },
    );
    response = generation;
    requireCondition(
      !signal?.aborted,
      "PROVIDER_FAILED",
      "Analysis was cancelled. No proposal was saved.",
    );
    return await inWorkspace(actor, workspaceId, "write", async (tx) => {
      const [run] = await tx<
        { status: string }[]
      >`SELECT status FROM analysis_runs WHERE workspace_id = ${workspaceId} AND id = ${runId}`;
      requireCondition(
        run?.status === "running",
        "CONFLICT",
        "The analysis run was interrupted. No work was changed.",
      );
      const result = await saveProposal(
        tx,
        actor,
        workspaceId,
        context,
        request.provider === "gemini"
          ? resolveGeminiOutput(generation.output, context.source)
          : generation.output,
      );
      await tx`UPDATE analysis_runs SET status = 'completed', token_usage = ${generation.usage ? tx.json(generation.usage) : null}, duration_ms = ${generation.durationMs}, completed_at = now() WHERE workspace_id = ${workspaceId} AND id = ${runId}`;
      return result;
    });
  } catch (error) {
    // A permission change may block draft creation, but must not strand the run state.
    const { db } = await import("../db/client");
    const failure =
      error instanceof DomainError && error.code !== "INVALID_INPUT"
        ? error
        : new DomainError(
            "INVALID_OUTPUT",
            "The model returned unsupported proposals or invalid citations. No work was changed.",
          );
    const sql = db();
    await sql`UPDATE analysis_runs SET status = 'failed', error_code = ${failure.code}, provider_http_status = ${failure instanceof GeminiHttpError ? failure.httpStatus : null}, provider_error_code = ${failure instanceof GeminiHttpError ? failure.category : null}, provider_error_details = ${failure instanceof GeminiHttpError ? sql.json(failure.diagnostic) : null}, token_usage = ${response?.usage ? sql.json(response.usage) : null}, duration_ms = ${Date.now() - started}, completed_at = now() WHERE id = ${runId} AND workspace_id = ${workspaceId} AND status = 'running'`;
    throw failure;
  }
}
