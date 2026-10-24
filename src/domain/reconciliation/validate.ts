import {
  analysisOutput,
  dateOnly,
  status,
  type AnalysisOutput,
  type SourceVersion,
  type Task,
} from "../contracts";
import { requireCondition } from "../errors";
import { validateCitation } from "../sources/citations";

export function validateField(
  field: string,
  value: string | null,
  memberIds: Set<string>,
): void {
  if (field === "status") status.parse(value);
  else if (field === "dueDate" && value !== null) dateOnly.parse(value);
  else if (field === "assigneeId" && value !== null)
    requireCondition(
      memberIds.has(value),
      "INVALID_INPUT",
      "Assignee is not a workspace member.",
    );
  else
    requireCondition(
      ["dueDate", "assigneeId"].includes(field),
      "INVALID_INPUT",
      "Unsupported task field.",
    );
}

export function validateAnalysis(
  raw: unknown,
  context: {
    tasks: Task[];
    memberIds: string[];
    versions: SourceVersion[];
    currentVersionId: string;
  },
): AnalysisOutput {
  const parsed = analysisOutput.parse(raw);
  const keys = new Set<string>();
  const updates = new Set<string>();
  const tasks = new Map(context.tasks.map((task) => [task.id, task]));
  const members = new Set(context.memberIds);
  const versions = new Map(
    context.versions.map((version) => [version.id, version]),
  );
  for (const item of parsed.items) {
    requireCondition(
      !item.editedBy,
      "INVALID_INPUT",
      "Model output cannot attribute an authenticated human edit.",
    );
    requireCondition(
      !keys.has(item.key),
      "INVALID_INPUT",
      "Proposal item keys must be unique.",
    );
    keys.add(item.key);
    requireCondition(
      item.citations.some(
        (citation) => citation.sourceVersionId === context.currentVersionId,
      ),
      "INVALID_INPUT",
      "Every proposal needs evidence from the selected revision.",
    );
    item.citations.forEach((citation) => validateCitation(citation, versions));
    if (item.kind === "create") {
      for (const [field, value] of Object.entries(item.fields))
        validateField(field, value, members);
    } else if (item.kind === "update") {
      const task = tasks.get(item.taskId);
      requireCondition(
        task && !task.archived,
        "INVALID_INPUT",
        "Proposal refers to a task outside the supplied context.",
      );
      requireCondition(
        task.status !== "done",
        "INVALID_INPUT",
        "Completed work must be preserved; ask a question instead.",
      );
      requireCondition(
        task.revision === item.expectedRevision,
        "CONFLICT",
        "The task changed during analysis.",
      );
      const target = `${item.taskId}:${item.field}`;
      requireCondition(
        !updates.has(target),
        "INVALID_INPUT",
        "A field cannot be changed twice in a proposal.",
      );
      updates.add(target);
      validateField(item.field, item.value, members);
    }
  }
  return { ...parsed, preserved: withoutChangedWork(parsed, tasks) };
}

// "What stays as it is" must not name work the same proposal changes or creates.
function withoutChangedWork(output: AnalysisOutput, tasks: Map<string, Task>) {
  const changed = new Set<string>();
  for (const item of output.items) {
    if (item.kind === "update") {
      const task = tasks.get(item.taskId);
      changed.add(item.taskId.toLowerCase());
      if (task) changed.add(task.title.toLowerCase());
    } else if (item.kind === "create") changed.add(item.title.toLowerCase());
  }
  return output.preserved.filter((entry) => {
    const text = entry.toLowerCase();
    return ![...changed].some((name) => text.includes(name));
  });
}
