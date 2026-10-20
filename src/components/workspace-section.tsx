"use client";

import type { WorkspaceData } from "@/client/types";
import { Activity } from "./activity";
import { ChangeList, ChangeReview } from "./review/change-review";
import { SourceLibrary } from "./sources/source-library";
import { SourceDetailView } from "./sources/source-detail";
import { TaskBoard } from "./tasks/task-board";
import { Members } from "./workspace-setup";

export const workspacePages = [
  ["", "Board", "▦"],
  ["sources", "Sources", "▤"],
  ["changes", "Changes", "↔"],
  ["activity", "Activity", "◷"],
  ["settings", "Members", "⊙"],
] as const;

export function WorkspaceSection({
  section,
  view,
  workspace,
  workspaceId,
  role,
  canEdit,
  query,
  setQuery,
  setModal,
  refresh,
}: {
  section: string;
  view: string[];
  workspace: WorkspaceData;
  workspaceId: string;
  role: string;
  canEdit: boolean;
  query: string;
  setQuery: (value: string) => void;
  setModal: (modal: "source" | "task" | null) => void;
  refresh: () => Promise<void>;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {section === "" ? "The work ahead" : "Keep the context close"}
          </p>
          <h1>
            {section === ""
              ? "A clear view of what’s next."
              : (workspacePages.find(([path]) => path === section)?.[1] ??
                "Workspace")}
          </h1>
          <p className="muted">
            {section === ""
              ? "A place for considered progress. Every change has a reason."
              : section === "sources"
                ? "Original words. Explicit revisions. Nothing quietly overwritten."
                : section === "changes"
                  ? "Consider the proposal before changing the work."
                  : section === "activity"
                    ? "What changed, who changed it, and what can safely be restored."
                    : "A shared workspace, with clear boundaries."}
          </p>
        </div>
        {canEdit && ["", "sources"].includes(section) && (
          <button className="primary" onClick={() => setModal("source")}>
            <span aria-hidden="true">＋</span> Bring a source
          </button>
        )}
      </div>
      {section === "" && (
        <>
          <div className="board-toolbar">
            <div className="view-label">
              ▦ <b>Board</b>
              <span>{workspace.tasks.length} tasks</span>
            </div>
            <label className="search">
              <span className="sr-only">Find a task</span>
              <input
                type="search"
                placeholder="Find a task…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {canEdit && (
              <button className="text-button" onClick={() => setModal("task")}>
                ＋ Add task
              </button>
            )}
          </div>
          {!workspace.tasks.length && (
            <div className="board-welcome">
              <span className="document-icon" aria-hidden="true">
                ↗
              </span>
              <div>
                <h2>Good work begins with a little context.</h2>
                <p>
                  Bring a brief to propose source-backed work, or add a task
                  yourself.
                </p>
              </div>
            </div>
          )}
          <TaskBoard
            tasks={workspace.tasks}
            members={workspace.members}
            query={query}
            reviewTaskIds={workspace.passageReviewTaskIds}
          />
          {workspace.decisions.length > 0 && (
            <section className="decisions">
              <h2>Decisions to keep in view</h2>
              {workspace.decisions.map((decision) => (
                <article key={decision.id}>
                  <span className="pill">
                    {decision.needsReview
                      ? "Needs review"
                      : "Source-backed decision"}
                  </span>
                  <p>{decision.statement}</p>
                </article>
              ))}
            </section>
          )}
          <p className="board-footnote">
            ↗ Open any task to see its source and history. Completed work stays
            preserved.
          </p>
        </>
      )}
      {section === "sources" &&
        (view[1] ? (
          <SourceDetailView
            key={`${workspaceId}:${view[1]}`}
            workspaceId={workspaceId}
            sourceId={view[1]}
            canEdit={canEdit}
            aiEnabled={workspace.aiEnabled}
            aiProvider={workspace.aiProvider}
            aiModel={workspace.aiModel}
            onSaved={refresh}
          />
        ) : (
          <SourceLibrary sources={workspace.sources} />
        ))}
      {section === "changes" &&
        (view[1] ? (
          <ChangeReview
            key={`${workspaceId}:${view[1]}`}
            workspaceId={workspaceId}
            changeSetId={view[1]}
            canEdit={canEdit}
            onApplied={refresh}
          />
        ) : (
          <ChangeList drafts={workspace.drafts} />
        ))}
      {section === "activity" && (
        <Activity
          workspaceId={workspaceId}
          batches={workspace.activity}
          canEdit={canEdit}
          onSaved={refresh}
        />
      )}
      {section === "settings" && (
        <Members
          data={workspace}
          workspaceId={workspaceId}
          role={role}
          refresh={refresh}
        />
      )}
    </>
  );
}
