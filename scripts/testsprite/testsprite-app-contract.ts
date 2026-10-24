export type PlanStep = {
  type: "action" | "assertion";
  description: string;
};

/** The native runner judges the goal as well as the separately saved plan. */
export function nativePassCriteria(steps: PlanStep[]): string {
  const checks = steps.flatMap((step, index) =>
    step.type === "assertion" || /\brefresh\b/i.test(step.description)
      ? [`${index + 1}. ${step.description}`]
      : [],
  );
  if (!steps.some((step) => step.type === "assertion"))
    throw new Error("Native tests require explicit assertions.");
  const description = [
    "Pass only if EVERY authored action and assertion executes in order. Perform actual browser reloads at refresh steps; navigation alone is insufficient. Do not skip intermediate checks or replace them with final-state checks. No live AI.",
    ...checks,
  ].join("\n");
  // The installed, pinned CLI accepts at most 2,000 description characters.
  if (description.length > 2000)
    throw new Error(
      "Native pass criteria exceed the supported metadata limit.",
    );
  return description;
}
