"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import { LineNav } from "./bits/LineNav";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Account, WorkspaceData } from "@/client/types";
import { listWorkspaces, loadWorkspace, signOut } from "@/client/commands";
import { NewTask } from "./tasks/task-board";
import { TaskDetailPanel } from "./tasks/task-detail";
import { NewSource } from "./sources/source-library";
import { WorkspaceSection, workspacePages } from "./workspace-section";
import { WorkspaceForm } from "./workspace-setup";

type Space = WorkspaceData["workspaces"][number];

export function WorkspaceApp({
  account,
  view,
}: {
  account: Account;
  view: string[];
}) {
  const router = useRouter();
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const activeWorkspace = useRef("");
  const [snapshot, setSnapshot] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [listAttempt, setListAttempt] = useState(0);
  const [modal, setModal] = useState<"source" | "task" | null>(null);
  const [query, setQuery] = useState("");
  const section = view[0] === "tasks" ? "" : (view[0] ?? "");
  const space = spaces?.find((space) => space.id === workspaceId);
  const canEdit = space?.role !== "viewer";
  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    const result = await loadWorkspace(workspaceId);
    if (activeWorkspace.current !== workspaceId) return;
    setSnapshot(result);
    setSpaces(result.workspaces);
  }, [workspaceId]);
  useEffect(() => {
    let active = true;
    listWorkspaces()
      .then((spaces) => {
        if (!active) return;
        setSpaces(spaces);
        const saved = localStorage.getItem("mosaic-workspace");
        const nextId =
          spaces.find((space) => space.id === saved)?.id ?? spaces[0]?.id ?? "";
        activeWorkspace.current = nextId;
        setWorkspaceId(nextId);
        if (!spaces.length) setLoading(false);
      })
      .catch((error) => {
        if (active) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [account.id, listAttempt]);
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    loadWorkspace(workspaceId)
      .then((loaded) => {
        if (active) {
          setSnapshot(loaded);
          setSpaces(loaded.workspaces);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (active) {
          setError(error.message);
          setLoading(false);
        }
      });
    localStorage.setItem("mosaic-workspace", workspaceId);
    return () => {
      active = false;
    };
  }, [workspaceId]);
  async function created(id: string) {
    const spaces = await listWorkspaces();
    setSpaces(spaces);
    activeWorkspace.current = id;
    setSnapshot(null);
    setLoading(true);
    setWorkspaceId(id);
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/app">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          Mosaic
        </Link>
        <div className="workspace-picker">
          <select
            aria-label="Active workspace"
            value={workspaceId}
            onChange={(event) => {
              // Re-selecting the open workspace changes no state, so nothing would load and the page would stay on
              // "Opening your workspace…". Automation can fire change for the same option.
              if (event.target.value === workspaceId) return;
              setLoading(true);
              setError("");
              activeWorkspace.current = event.target.value;
              setSnapshot(null);
              setQuery("");
              setWorkspaceId(event.target.value);
              router.push("/app");
            }}
          >
            {spaces?.length ? (
              spaces.map((space) => (
                <option value={space.id} key={space.id}>
                  {space.name}
                </option>
              ))
            ) : (
              <option value="">Create a workspace</option>
            )}
          </select>
        </div>
        <LineNav
          label="Workspace navigation"
          items={workspacePages.map(([path, label]) => ({
            href: `/app${path ? `/${path}` : ""}`,
            label,
            active: section === path,
            badge:
              path === "changes"
                ? snapshot?.drafts.filter((draft) => draft.state === "draft")
                    .length
                : undefined,
          }))}
        />
        <footer className="account">
          <span className="avatar">{account.name.slice(0, 1)}</span>
          <div>
            <b>{account.name}</b>
            <small>{space?.role ?? "Your account"}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={async () => {
              await signOut();
              router.replace("/");
            }}
          >
            <LogOut size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </footer>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <span>{space?.name ?? "Welcome to Mosaic"}</span>
          <span aria-hidden="true">/</span>
          <b>
            {workspacePages.find(([path]) => path === section)?.[1] ?? "Task"}
          </b>
        </header>
        <main className="workspace-main">
          {error && (
            <div className="error" role="alert">
              {error}{" "}
              <button
                onClick={async () => {
                  setError("");
                  setLoading(true);
                  if (!spaces) {
                    setListAttempt((attempt) => attempt + 1);
                    return;
                  }
                  try {
                    await refresh();
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Could not reload workspace.",
                    );
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <p role="status" className="loading">
              Opening your workspace…
            </p>
          ) : spaces?.length === 0 ? (
            <WorkspaceForm onCreated={created} />
          ) : (
            snapshot && (
              <WorkspaceSection
                section={section}
                view={view}
                workspace={snapshot}
                workspaceId={workspaceId}
                role={space?.role ?? "viewer"}
                canEdit={canEdit}
                query={query}
                setQuery={setQuery}
                setModal={setModal}
                refresh={refresh}
              />
            )
          )}
        </main>
      </div>
      {snapshot && modal === "source" && (
        <NewSource
          workspaceId={workspaceId}
          onClose={() => setModal(null)}
          onSaved={async (id) => {
            await refresh();
            router.push(`/app/sources/${id}`);
          }}
        />
      )}
      {snapshot && modal === "task" && (
        <NewTask
          workspaceId={workspaceId}
          members={snapshot.members}
          onClose={() => setModal(null)}
          onSaved={refresh}
        />
      )}
      {snapshot && view[0] === "tasks" && view[1] && (
        <TaskDetailPanel
          key={`${workspaceId}:${view[1]}`}
          workspaceId={workspaceId}
          taskId={view[1]}
          members={snapshot.members}
          canEdit={canEdit}
          onClose={() => router.push("/app")}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
