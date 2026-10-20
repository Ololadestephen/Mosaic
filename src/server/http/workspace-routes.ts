import "server-only";
import { id, type Actor } from "@/domain/contracts";
import { DomainError, requireCondition } from "@/domain/errors";
import { createWorkspace, listWorkspaces, setMember } from "../workspaces";
import { createSource, getSource, addRevision } from "../sources";
import { createTask, editTask, getTask } from "../tasks";
import { workspaceData } from "../workspace-data";
import { analyzeSource } from "../ai/analyze";
import { editProposal, getProposal } from "../reconciliation";
import {
  applyProposal,
  lookupOperation,
  verifiedWrite,
  verifyBatch,
} from "../execution";
import { compensate, previewCompensation } from "../compensation";
import { readBody } from "./body";

const skip = Symbol("unmatched");

type Command = (
  request: Request,
  path: string[],
  actor: Actor,
  workspaceId: string,
) => Promise<unknown>;

function unmatched(): typeof skip {
  return skip;
}

function notFound(): never {
  throw new DomainError("NOT_FOUND", "Route not found.");
}

const commands: Command[] = [
  async (request, path, actor) => {
    if (path.length !== 1) return unmatched();
    if (request.method === "GET") return listWorkspaces(actor);
    if (request.method === "POST")
      return createWorkspace(actor, await readBody(request));
    notFound();
  },
  async (request, path, actor, workspaceId) => {
    if (path[2] || request.method !== "GET") return unmatched();
    return workspaceData(actor, workspaceId);
  },
  async (request, path, actor, workspaceId) => {
    if (path[2] !== "members" || request.method !== "POST") return unmatched();
    return setMember(actor, workspaceId, await readBody(request));
  },
  async (request, path, actor, workspaceId) => {
    if (path[2] !== "analyze" || request.method !== "POST") return unmatched();
    return analyzeSource(
      actor,
      workspaceId,
      await readBody(request),
      request.signal,
    );
  },
  async (request, path, actor, workspaceId) => {
    if (path[2] !== "changes" || request.method !== "GET") return unmatched();
    return getProposal(actor, workspaceId, id.parse(path[3]));
  },
  async (request, path, actor, workspaceId) => {
    if (path[2] !== "changes" || request.method !== "PATCH") return unmatched();
    return editProposal(
      actor,
      workspaceId,
      id.parse(path[3]),
      await readBody(request),
    );
  },
  async (request, path, actor, workspaceId) => {
    if (path[2] !== "apply" || request.method !== "POST") return unmatched();
    const body = await readBody(request);
    return verifiedWrite(actor, workspaceId, () =>
      applyProposal(actor, workspaceId, body),
    );
  },
  async (request, path, actor, workspaceId) => {
    if (path[2] !== "undo" || request.method !== "POST") return unmatched();
    const body = await readBody(request);
    return verifiedWrite(actor, workspaceId, () =>
      compensate(actor, workspaceId, body),
    );
  },
  async (request, path, actor, workspaceId) => {
    if (path[2] !== "batches" || request.method !== "GET") return unmatched();
    return path[4] === "preview"
      ? previewCompensation(actor, workspaceId, id.parse(path[3]))
      : verifyBatch(actor, workspaceId, id.parse(path[3]));
  },
  async (request, path, actor, workspaceId) => {
    if (path[2] !== "operations" || request.method !== "GET")
      return unmatched();
    return lookupOperation(actor, workspaceId, path[3], id.parse(path[4]));
  },
  async (request, path, actor, workspaceId) => {
    if (path[2] !== "sources") return unmatched();
    if (path.length === 3 && request.method === "POST")
      return createSource(actor, workspaceId, await readBody(request));
    if (request.method === "GET")
      return getSource(actor, workspaceId, id.parse(path[3]));
    if (path[4] === "revisions" && request.method === "POST")
      return addRevision(
        actor,
        workspaceId,
        id.parse(path[3]),
        await readBody(request),
      );
    notFound();
  },
  async (request, path, actor, workspaceId) => {
    if (path[2] !== "tasks") return unmatched();
    if (request.method === "GET")
      return getTask(actor, workspaceId, id.parse(path[3]));
    const operationKey = id.parse(request.headers.get("x-operation-key"));
    const body = await readBody(request);
    if (path.length === 3 && request.method === "POST")
      return verifiedWrite(actor, workspaceId, () =>
        createTask(actor, workspaceId, body, operationKey),
      );
    if (request.method === "PATCH")
      return verifiedWrite(actor, workspaceId, () =>
        editTask(actor, workspaceId, id.parse(path[3]), body, operationKey),
      );
    notFound();
  },
];

export async function workspaceRoute(
  request: Request,
  path: string[],
  actor: Actor,
): Promise<unknown> {
  requireCondition(path[0] === "workspaces", "NOT_FOUND", "Route not found.");
  const workspaceId = path.length === 1 ? "" : id.parse(path[1]);
  for (const command of commands) {
    const result = await command(request, path, actor, workspaceId);
    if (result !== skip) return result;
  }
  notFound();
}
