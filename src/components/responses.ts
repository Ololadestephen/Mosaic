import { z } from "zod";
import { proposalItem } from "@/domain/contracts";

const idValue = z.string().min(1);
const taskFields = {
  id: idValue,
  title: z.string(),
  status: z.enum(["todo", "in_progress", "done"]),
  assigneeId: idValue.nullable(),
  dueDate: z.string().nullable(),
  revision: z.number().int().positive(),
  restrictedTo: idValue.nullable(),
  archived: z.boolean(),
};
const fieldChange = z.object({
  taskId: idValue,
  field: z.enum(["status", "assigneeId", "dueDate", "created"]),
  before: z.string().nullable(),
  after: z.string().nullable(),
  mutationId: idValue,
});
const undoOutcome = z.object({
  taskId: idValue,
  field: z.enum(["status", "assigneeId", "dueDate", "created"]),
  outcome: z.enum(["restored", "conflict"]),
  detail: z.string(),
});
const batchResult = z.object({
  batchId: idValue,
  taskIds: z.array(idValue),
  count: z.number().int().nonnegative(),
  verification: z.enum(["verified", "pending"]),
  outcomes: z.array(undoOutcome).optional(),
});

export const workspaceList = z.array(
  z.object({
    id: idValue,
    name: z.string(),
    role: z.enum(["owner", "editor", "viewer"]),
  }),
);
export const workspacePayload = z.object({
  tasks: z.array(
    z.object({
      ...taskFields,
      workspaceId: idValue,
      lineage: z.record(z.string(), z.string()),
    }),
  ),
  sources: z.array(
    z.object({
      id: idValue,
      title: z.string(),
      visibility: z.enum(["workspace", "private"]),
      ownerId: idValue,
      versionCount: z.number().int().positive(),
      latestVersionId: idValue,
    }),
  ),
  members: z.array(
    z.object({
      id: idValue,
      name: z.string(),
      email: z.string(),
      role: z.enum(["owner", "editor", "viewer"]),
    }),
  ),
  workspaces: workspaceList,
  drafts: z.array(
    z.object({
      id: idValue,
      sourceVersionId: idValue,
      state: z.enum(["draft", "applied"]),
      revision: z.number().int().positive(),
    }),
  ),
  activity: z.array(
    z.object({
      id: idValue,
      operation: z.string(),
      actorName: z.string(),
      createdAt: z.string(),
      result: z.record(z.string(), z.unknown()),
      changes: z.array(fieldChange),
      targetBatchId: idValue.nullable(),
      changeSetId: idValue.nullable(),
    }),
  ),
  decisions: z.array(
    z.object({
      id: idValue,
      statement: z.string(),
      needsReview: z.boolean(),
      sourceVersionId: idValue,
    }),
  ),
  passageReviewTaskIds: z.array(idValue),
  aiEnabled: z.boolean(),
  aiProvider: z.enum(["Gemini", "OpenRouter"]),
  aiModel: z.string(),
});
export const taskDetail = z.object({
  ...taskFields,
  workspaceId: idValue,
  lineage: z.record(z.string(), z.string()),
  evidence: z.array(
    z.object({
      sourceId: idValue,
      sourceTitle: z.string(),
      version: z.number().int().positive(),
      sourceVersionId: idValue,
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      quote: z.string(),
      passageChange: z.enum(["edited", "removed"]).nullable(),
      laterVersionNumber: z.number().int().positive().nullable(),
    }),
  ),
  history: z.array(
    z.object({
      field: z.string(),
      before: z.string().nullable(),
      after: z.string().nullable(),
      actorName: z.string(),
      operation: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export const sourceDetail = z.object({
  id: idValue,
  title: z.string(),
  visibility: z.enum(["workspace", "private"]),
  ownerId: idValue,
  versionCount: z.number().int().positive(),
  latestVersionId: idValue,
  versions: z.array(
    z.object({
      id: idValue,
      sourceId: idValue,
      text: z.string(),
      number: z.number().int().positive(),
      predecessorId: idValue.nullable(),
    }),
  ),
  changes: z.array(
    z.object({
      id: idValue,
      sourceVersionId: idValue,
      state: z.string(),
    }),
  ),
  analysisRuns: z.array(
    z.object({
      sourceVersionId: idValue,
      status: z.string(),
      startedAt: z.string(),
      errorCode: z.string().nullable(),
      provider: z.enum(["gemini", "openrouter"]),
      model: z.string(),
      providerHttpStatus: z.number().int().nullable(),
      providerErrorCode: z.string().nullable(),
    }),
  ),
  passageReviews: z.array(
    z.object({
      taskId: idValue,
      taskTitle: z.string(),
      sourceId: idValue,
      citedVersionId: idValue,
      laterVersionId: idValue,
      laterNumber: z.number().int().positive(),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
      quote: z.string(),
      change: z.enum(["edited", "removed"]),
    }),
  ),
});
export const proposalDetail = z.object({
  id: idValue,
  workspaceId: idValue,
  sourceVersionId: idValue,
  restrictedTo: idValue.nullable(),
  revision: z.number().int().positive(),
  state: z.enum(["draft", "applied"]),
  items: z.array(proposalItem),
  questions: z.array(z.string()),
  preserved: z.array(z.string()),
  tasks: z.array(
    z.object(taskFields).extend({
      workspaceId: idValue,
      lineage: z.record(z.string(), z.string()),
    }),
  ),
  versions: z.array(
    z.object({
      id: idValue,
      sourceId: idValue,
      text: z.string(),
      number: z.number().int().positive(),
      predecessorId: idValue.nullable(),
    }),
  ),
  members: z.array(z.object({ id: idValue, name: z.string() })),
  receipt: z.array(fieldChange),
  analysis: z
    .object({ provider: z.enum(["gemini", "openrouter"]), model: z.string() })
    .nullable(),
});
export const undoPreview = z.object({
  alreadyUndone: z.boolean(),
  outcomes: z.array(undoOutcome),
});
export { batchResult };
