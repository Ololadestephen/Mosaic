import { z } from "zod";

export const id = z.uuid();
const role = z.enum(["owner", "editor", "viewer"]);
export const status = z.enum(["todo", "in_progress", "done"]);
const visibility = z.enum(["workspace", "private"]);
const field = z.enum(["status", "assigneeId", "dueDate"]);
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !value.startsWith("0000") &&
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Use a valid calendar date (YYYY-MM-DD).");
export const credentials = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase().trim()),
    password: z.string().min(12).max(128),
    name: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
export const workspaceInput = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict();
export const memberInput = z
  .object({
    email: z.email().transform((s) => s.toLowerCase().trim()),
    role: z.enum(["editor", "viewer"]),
  })
  .strict();
const taskFields = z
  .object({ status, assigneeId: id.nullable(), dueDate: dateOnly.nullable() })
  .strict();
export const createTaskInput = taskFields
  .extend({
    title: z.string().trim().min(1).max(180),
    visibility: visibility.default("workspace"),
  })
  .strict();
export const editTaskInput = taskFields
  .partial()
  .extend({ expectedRevision: z.number().int().positive() })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 1,
    "Choose at least one field.",
  );
export const sourceInput = z
  .object({
    title: z.string().trim().min(1).max(180),
    text: z.string().min(1).max(20000),
    visibility: visibility.default("workspace"),
  })
  .strict();
export const revisionInput = z
  .object({ text: z.string().min(1).max(20000), predecessorId: id })
  .strict();
// Offsets are zero-based UTF-16 code units, [start, end), in normalized LF text.
const citation = z
  .object({
    sourceVersionId: id,
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z.string().min(1).max(3000),
  })
  .strict();
const itemBase = {
  key: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  reason: z.string().min(1).max(2000),
  impact: z.string().max(1000),
  citations: z.array(citation).min(1).max(8),
  editedBy: z.string().optional(),
};
export const proposalItem = z.discriminatedUnion("kind", [
  z
    .object({
      ...itemBase,
      kind: z.literal("create"),
      title: z.string().trim().min(1).max(180),
      fields: taskFields,
    })
    .strict(),
  z
    .object({
      ...itemBase,
      kind: z.literal("update"),
      taskId: id,
      expectedRevision: z.number().int().positive(),
      field,
      value: z.string().max(100).nullable(),
    })
    .strict(),
  z
    .object({
      ...itemBase,
      kind: z.literal("decision"),
      statement: z.string().min(1).max(1000),
      needsReview: z.boolean(),
    })
    .strict(),
]);
export const analysisOutput = z
  .object({
    items: z.array(proposalItem).max(40),
    questions: z.array(z.string().min(1).max(1000)).max(20),
    preserved: z.array(z.string().min(1).max(1000)).max(30),
  })
  .strict();
export const applyInput = z
  .object({
    changeSetId: id,
    expectedRevision: z.number().int().positive(),
    selectedKeys: z.array(z.string().max(80)).min(1).max(40),
    operationKey: id,
  })
  .strict()
  .refine(
    (v) => new Set(v.selectedKeys).size === v.selectedKeys.length,
    "Duplicate selection.",
  );
export const editDraftInput = z
  .object({
    expectedRevision: z.number().int().positive(),
    key: z.string().max(80),
    value: z.string().max(100).nullable(),
  })
  .strict();
export const undoInput = z.object({ batchId: id, operationKey: id }).strict();
export type Role = z.infer<typeof role>;
export type TaskFields = z.infer<typeof taskFields>;
export type Field = z.infer<typeof field>;
export type Citation = z.infer<typeof citation>;
export type ProposalItem = z.infer<typeof proposalItem> & { editedBy?: string };
export type AnalysisOutput = z.infer<typeof analysisOutput>;
export type Actor = { userId: string };
export type Task = TaskFields & {
  id: string;
  workspaceId: string;
  title: string;
  revision: number;
  restrictedTo: string | null;
  archived: boolean;
  lineage: Partial<Record<Field | "created", string>>;
};
export type SourceVersion = {
  id: string;
  sourceId: string;
  text: string;
  number: number;
  predecessorId: string | null;
};
export type ChangeSet = {
  id: string;
  workspaceId: string;
  sourceVersionId: string;
  restrictedTo: string | null;
  revision: number;
  state: "draft" | "applied";
  items: ProposalItem[];
  questions: string[];
  preserved: string[];
};
export type FieldChange = {
  taskId: string;
  field: Field | "created";
  before: string | null;
  after: string | null;
  mutationId: string;
};
export type UndoOutcome = {
  taskId: string;
  field: Field | "created";
  outcome: "restored" | "conflict";
  detail: string;
};
