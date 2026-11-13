import { requireCondition } from "@/domain/errors";
import { z } from "@/domain/zod";

export const coverageOutput = z.strictObject({
  classifications: z.array(
    z.strictObject({
      passageId: z.string(),
      status: z.enum(["covered", "uncovered", "no_task_change"]),
      reason: z.string(),
      proposalKeys: z.array(z.string()),
      taskIds: z.array(z.string()),
    }),
  ),
});

export function validateCoverage(
  output: unknown,
  expected: {
    passageIds: readonly string[];
    proposalKeys: readonly string[];
    taskIds: readonly string[];
  },
) {
  const parsed = coverageOutput.safeParse(output);
  requireCondition(
    parsed.success,
    "INVALID_OUTPUT",
    "Invalid SERV classification.",
  );
  const remaining = new Set(expected.passageIds);
  const proposalKeys = new Set(expected.proposalKeys);
  const taskIds = new Set(expected.taskIds);
  for (const item of parsed.data.classifications) {
    requireCondition(
      remaining.delete(item.passageId),
      "INVALID_OUTPUT",
      "SERV repeated or invented a changed passage.",
    );
    const hasReferences = item.proposalKeys.length + item.taskIds.length > 0;
    requireCondition(
      item.reason.trim().length > 0 &&
        item.reason.length <= 500 &&
        (item.status === "covered") === hasReferences &&
        new Set(item.proposalKeys).size === item.proposalKeys.length &&
        new Set(item.taskIds).size === item.taskIds.length &&
        item.proposalKeys.every((key) => proposalKeys.has(key)) &&
        item.taskIds.every((id) => taskIds.has(id)),
      "INVALID_OUTPUT",
      "SERV returned an invalid reason or coverage reference.",
    );
  }
  requireCondition(
    remaining.size === 0,
    "INVALID_OUTPUT",
    "SERV omitted a changed passage.",
  );
  return parsed.data;
}

const uuidPattern =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

// People never see internal IDs: known task IDs become quoted titles, any other ID a neutral phrase.
export function nameTasks(
  reason: string,
  tasks: readonly { id: string; title: string }[],
) {
  const titles = new Map(
    tasks.map(({ id, title }) => [id.toLowerCase(), title]),
  );
  return reason.replace(uuidPattern, (match) => {
    const title = titles.get(match.toLowerCase());
    return title ? `“${title}”` : "an item";
  });
}

export const coverageFingerprint = z.object({ fingerprint: z.string() });
export const coverageReview = coverageFingerprint.extend({
  entries: z.array(
    coverageOutput.shape.classifications.element.extend({
      passage: z.object({
        id: z.string(),
        side: z.enum(["previous", "selected"]),
        text: z.string(),
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
      }),
      versionId: z.uuid(),
      versionNumber: z.number().int().positive(),
      sourceId: z.uuid(),
      taskTitles: z.array(z.string()),
    }),
  ),
});
