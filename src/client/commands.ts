import { z } from "zod";
import type { BatchResult } from "@/domain/api";
import {
  batchResult,
  proposalDetail,
  sourceDetail,
  taskDetail,
  undoPreview,
  workspaceList,
  workspacePayload,
} from "@/domain/api";
import { api } from "./api";
import type {
  credentials,
  workspaceInput,
  memberInput,
  createTaskInput,
  editTaskInput,
  sourceInput,
  revisionInput,
  editDraftInput,
  applyCommand,
  undoCommand,
} from "@/domain/contracts";

const idRecord = z.object({ id: z.string() }).catchall(z.unknown());

export function listWorkspaces() {
  return api("workspaces", workspaceList);
}

export function createWorkspace(body: z.input<typeof workspaceInput>) {
  return api("workspaces", idRecord, "POST", body);
}

export function loadWorkspace(workspaceId: string) {
  return api(`workspaces/${workspaceId}`, workspacePayload);
}

export function saveMember(
  workspaceId: string,
  body: z.input<typeof memberInput>,
) {
  return api(
    `workspaces/${workspaceId}/members`,
    z.object({ id: z.string(), role: z.string() }),
    "POST",
    body,
  );
}

export function loadSource(workspaceId: string, sourceId: string) {
  return api(`workspaces/${workspaceId}/sources/${sourceId}`, sourceDetail);
}

export function createSource(
  workspaceId: string,
  body: z.input<typeof sourceInput>,
  operationKey: string,
) {
  return api(
    `workspaces/${workspaceId}/sources`,
    z.object({ sourceId: z.string(), versionId: z.string() }),
    "POST",
    body,
    operationKey,
  );
}

export function addRevision(
  workspaceId: string,
  sourceId: string,
  body: z.input<typeof revisionInput>,
) {
  return api(
    `workspaces/${workspaceId}/sources/${sourceId}/revisions`,
    z.object({ versionId: z.string() }),
    "POST",
    body,
  );
}

export function analyzeSource(
  workspaceId: string,
  body: { sourceVersionId: string },
) {
  return api(`workspaces/${workspaceId}/analyze`, idRecord, "POST", body);
}

export function loadTask(workspaceId: string, taskId: string) {
  return api(`workspaces/${workspaceId}/tasks/${taskId}`, taskDetail);
}

export function createTask(
  workspaceId: string,
  body: z.input<typeof createTaskInput>,
  operationKey: string,
) {
  return api(
    `workspaces/${workspaceId}/tasks`,
    batchResult,
    "POST",
    body,
    operationKey,
  );
}

export function editTask(
  workspaceId: string,
  taskId: string,
  body: z.input<typeof editTaskInput>,
  operationKey: string,
) {
  return api(
    `workspaces/${workspaceId}/tasks/${taskId}`,
    batchResult,
    "PATCH",
    body,
    operationKey,
  );
}

export function loadProposal(workspaceId: string, changeSetId: string) {
  return api(
    `workspaces/${workspaceId}/changes/${changeSetId}`,
    proposalDetail,
  );
}

export function editProposal(
  workspaceId: string,
  changeSetId: string,
  body: z.input<typeof editDraftInput>,
) {
  return api(
    `workspaces/${workspaceId}/changes/${changeSetId}`,
    z.object({ revision: z.number() }),
    "PATCH",
    body,
  );
}

export function applyProposal(
  workspaceId: string,
  body: z.input<typeof applyCommand>,
  operationKey: string,
): Promise<BatchResult> {
  return api(
    `workspaces/${workspaceId}/apply`,
    batchResult,
    "POST",
    body,
    operationKey,
  );
}

export function lookupOperation(
  workspaceId: string,
  operation: string,
  operationKey: string,
): Promise<BatchResult> {
  return api(
    `workspaces/${workspaceId}/operations/${operation}/${operationKey}`,
    batchResult,
  );
}

export function previewUndo(workspaceId: string, batchId: string) {
  return api(
    `workspaces/${workspaceId}/batches/${batchId}/preview`,
    undoPreview,
  );
}

export function undoBatch(
  workspaceId: string,
  body: z.input<typeof undoCommand>,
  operationKey: string,
) {
  return api(
    `workspaces/${workspaceId}/undo`,
    batchResult,
    "POST",
    body,
    operationKey,
  );
}

export function signIn(register: boolean, body: z.input<typeof credentials>) {
  return api(
    `auth/${register ? "register" : "login"}`,
    z.object({ id: z.string() }).catchall(z.unknown()),
    "POST",
    body,
  );
}

export function signOut() {
  return api("auth/logout", z.object({ ok: z.literal(true) }), "POST");
}
