import { z } from "zod";
import type {
  BatchResult,
  getProposal,
  getSource,
  getTask,
  previewCompensation,
  WorkspaceData,
} from "@/client/types";
import { api } from "./api";
import {
  batchResult,
  proposalDetail,
  sourceDetail,
  taskDetail,
  undoPreview,
  workspaceList,
  workspacePayload,
} from "./responses";

const idRecord = z.object({ id: z.string() }).catchall(z.unknown());

export function listWorkspaces() {
  return api("workspaces", workspaceList);
}

export function createWorkspace(body: unknown) {
  return api("workspaces", idRecord, "POST", body);
}

export function loadWorkspace(workspaceId: string) {
  // JSON arrays are not postgres row lists; the schema checks the fields first.
  return api(
    `workspaces/${workspaceId}`,
    workspacePayload,
  ) as Promise<WorkspaceData>;
}

export function saveMember(workspaceId: string, body: unknown) {
  return api(
    `workspaces/${workspaceId}/members`,
    z.object({ id: z.string(), role: z.string() }),
    "POST",
    body,
  );
}

export function loadSource(workspaceId: string, sourceId: string) {
  return api(
    `workspaces/${workspaceId}/sources/${sourceId}`,
    sourceDetail,
  ) as Promise<Awaited<ReturnType<typeof getSource>>>;
}

export function createSource(workspaceId: string, body: unknown) {
  return api(
    `workspaces/${workspaceId}/sources`,
    z.object({ sourceId: z.string() }),
    "POST",
    body,
  );
}

export function addRevision(
  workspaceId: string,
  sourceId: string,
  body: unknown,
) {
  return api(
    `workspaces/${workspaceId}/sources/${sourceId}/revisions`,
    z.object({ versionId: z.string() }),
    "POST",
    body,
  );
}

export function analyzeSource(workspaceId: string, body: unknown) {
  return api(`workspaces/${workspaceId}/analyze`, idRecord, "POST", body);
}

export function loadTask(workspaceId: string, taskId: string) {
  return api(
    `workspaces/${workspaceId}/tasks/${taskId}`,
    taskDetail,
  ) as Promise<Awaited<ReturnType<typeof getTask>>>;
}

export function createTask(
  workspaceId: string,
  body: unknown,
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
  body: unknown,
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
  ) as Promise<Awaited<ReturnType<typeof getProposal>>>;
}

export function editProposal(
  workspaceId: string,
  changeSetId: string,
  body: unknown,
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
  body: unknown,
): Promise<BatchResult> {
  return api(`workspaces/${workspaceId}/apply`, batchResult, "POST", body);
}

export function lookupApply(
  workspaceId: string,
  operationKey: string,
): Promise<BatchResult> {
  return api(
    `workspaces/${workspaceId}/operations/apply/${operationKey}`,
    batchResult,
  );
}

export function previewUndo(workspaceId: string, batchId: string) {
  return api(
    `workspaces/${workspaceId}/batches/${batchId}/preview`,
    undoPreview,
  ) as Promise<Awaited<ReturnType<typeof previewCompensation>>>;
}

export function undoBatch(workspaceId: string, body: unknown) {
  return api(`workspaces/${workspaceId}/undo`, batchResult, "POST", body);
}

export function signIn(register: boolean, body: unknown) {
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
