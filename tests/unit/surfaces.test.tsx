import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PASSAGE_REVIEW_LABEL } from "@/domain/sources/passage-change";
import type { Task } from "@/domain/contracts";
import type { WorkspaceData } from "@/client/types";
import { AuthForm } from "@/components/auth-form";
import { Dialog } from "@/components/dialog";
import { TaskBoard } from "@/components/tasks/task-board";
import { ChangeList } from "@/components/review/change-review";
import { SourceLibrary } from "@/components/sources/source-library";
import { Activity } from "@/components/activity";
import { WorkspaceForm } from "@/components/workspace-setup";
import { EditValue } from "@/components/review/proposal-editor";
import Home from "@/app/page";
import RootLayout from "@/app/layout";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const task: Task = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  title: "Confirm the supplier",
  status: "todo",
  assigneeId: null,
  dueDate: null,
  revision: 1,
  restrictedTo: null,
  archived: false,
  lineage: {},
};

describe("rendered surfaces", () => {
  it("shows the passage review only on the cited task", () => {
    const flagged = renderToStaticMarkup(
      createElement(TaskBoard, {
        tasks: [task],
        members: [] as unknown as WorkspaceData["members"],
        query: "",
        reviewTaskIds: [task.id],
      }),
    );
    const clear = renderToStaticMarkup(
      createElement(TaskBoard, {
        tasks: [task],
        members: [] as unknown as WorkspaceData["members"],
        query: "missing",
        reviewTaskIds: [],
      }),
    );
    expect(flagged).toContain(PASSAGE_REVIEW_LABEL);
    expect(flagged).toContain("Confirm the supplier");
    expect(clear).not.toContain("Confirm the supplier");
  });

  it("does not advertise registration when the workspace is closed", () => {
    vi.stubEnv("ALLOW_REGISTRATION", "false");
    try {
      const home = renderToStaticMarkup(createElement(Home));
      expect(home).not.toContain("Create your workspace");
      expect(home).toContain("Sign in to your workspace");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("renders the entry, sign-in, and empty workspace states", () => {
    expect(renderToStaticMarkup(createElement(Home))).toContain(
      "Keep work in sync",
    );
    expect(
      renderToStaticMarkup(
        createElement(RootLayout, null, createElement("p", null, "Inside")),
      ),
    ).toContain("Inside");
    expect(
      renderToStaticMarkup(
        createElement(AuthForm, {
          initialRegister: false,
          registrationOpen: true,
        }),
      ),
    ).toContain("Welcome back.");
    expect(
      renderToStaticMarkup(
        createElement(AuthForm, {
          initialRegister: false,
          registrationOpen: false,
        }),
      ),
    ).not.toContain("New here? Create an account");
    expect(
      renderToStaticMarkup(
        <Dialog title="Details" onClose={() => undefined}>
          Body
        </Dialog>,
      ),
    ).toContain("Details");
    expect(
      renderToStaticMarkup(createElement(ChangeList, { drafts: [] })),
    ).toContain("No proposals yet");
    expect(
      renderToStaticMarkup(
        createElement(SourceLibrary, {
          sources: [] as unknown as WorkspaceData["sources"],
        }),
      ),
    ).toContain("No sources yet");
    expect(
      renderToStaticMarkup(
        createElement(Activity, {
          workspaceId: task.workspaceId,
          batches: [] as unknown as WorkspaceData["activity"],
          canEdit: false,
          onSaved: async () => undefined,
        }),
      ),
    ).toContain("Search recent activity");
    expect(
      renderToStaticMarkup(
        createElement(WorkspaceForm, { onCreated: async () => undefined }),
      ),
    ).toContain("Give the work a home.");
    expect(
      renderToStaticMarkup(
        createElement(EditValue, {
          item: {
            kind: "update",
            key: "status",
            field: "status",
            taskId: task.id,
            value: "done",
            expectedRevision: 1,
            reason: "The brief changed.",
            impact: "Status",
            citations: [
              {
                sourceVersionId: task.workspaceId,
                start: 0,
                end: 4,
                quote: "Done",
              },
            ],
          },
          proposalId: task.id,
          expectedRevision: 1,
          members: [],
          workspaceId: task.workspaceId,
          onSaved: async () => undefined,
        }),
      ),
    ).toContain("Edit proposed value");
  });
});
