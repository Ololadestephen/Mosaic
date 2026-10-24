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
        <h1>
          {section === ""
            ? "A clear view of what’s next."
            : (workspacePages.find(([path]) => path === section)?.[1] ??
              "Workspace")}
        </h1>
        {canEdit && ["", "sources"].includes(section) && (
          <button className="primary" onClick={() => setModal("source")}>
            <span aria-hidden="true">＋</span> Bring a source
          </button>
        )}
      </div>
      {section === "" && (
        <>
          <div className="board-toolbar">
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
              <h2>No tasks yet</h2>
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
