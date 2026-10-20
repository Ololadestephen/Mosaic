import "server-only";
import type { Actor, ChangeSet } from "@/domain/contracts";
import { inWorkspace } from "./auth/authorization";
import { recordVisibleTo } from "./auth/visibility";
import { listActivity } from "./journal";
import { listPassageReviews } from "./passage-signals";
import { listTasks } from "./tasks";
import { listSources } from "./sources";
import { listMembers, listWorkspaces } from "./workspaces";
import { analysisProvider } from "./ai/provider";

export async function workspaceData(actor: Actor, workspaceId: string) {
  const [tasks, sources, members, workspaces, extra] = await Promise.all([
    listTasks(actor, workspaceId),
    listSources(actor, workspaceId),
    listMembers(actor, workspaceId),
    listWorkspaces(actor),
    inWorkspace(actor, workspaceId, "read", async (tx) => {
      const drafts = await tx<
        Pick<ChangeSet, "id" | "sourceVersionId" | "state" | "revision">[]
      >`SELECT id, source_version_id AS "sourceVersionId", state, revision FROM change_sets WHERE workspace_id = ${workspaceId} AND ${recordVisibleTo(actor)} ORDER BY created_at DESC`;
      const activity = await listActivity(tx, actor, workspaceId);
      const decisions = await tx<
        {
          id: string;
          statement: string;
          needsReview: boolean;
          sourceVersionId: string;
        }[]
      >`SELECT id, statement, needs_review AS "needsReview", source_version_id AS "sourceVersionId" FROM decisions WHERE workspace_id = ${workspaceId} AND ${recordVisibleTo(actor)} ORDER BY created_at DESC`;
      const passageReviewTaskIds = [
        ...new Set(
          (await listPassageReviews(tx, actor, workspaceId)).map(
            (review) => review.taskId,
          ),
        ),
      ];
      return { drafts, activity, decisions, passageReviewTaskIds };
    }),
  ]);
  const provider = analysisProvider();
  return {
    tasks,
    sources,
    members,
    workspaces,
    ...extra,
    aiEnabled: provider.enabled,
    aiProvider: provider.name,
    aiModel: provider.model,
  };
}

export type WorkspaceData = Awaited<ReturnType<typeof workspaceData>>;
