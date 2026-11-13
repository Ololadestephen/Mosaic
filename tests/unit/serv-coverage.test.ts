import { afterEach, describe, expect, it, vi } from "vitest";
import { changedPassages } from "@/domain/sources/coverage-passages";
import { nameTasks } from "@/domain/sources/coverage-result";
import { classifyCoverage } from "@/server/ai/serv-coverage";

afterEach(() => vi.unstubAllGlobals());

const input = {
  passages: changedPassages("Keep this.\n", "Keep this.\nReview the update.\n")
    .passages,
  proposals: [{ key: "proposal-1", text: "Review the update" }],
  tasks: [],
};
const config = { apiKey: "unit-test", model: "test-model" };
const classification = {
  passageId: input.passages[0].id,
  status: "covered",
  reason: "The proposal covers the new instruction.",
  proposalKeys: ["proposal-1"],
  taskIds: [],
};

function mockCompletion(classifications: unknown[], finishReason = "stop") {
  const fetch = vi.fn(async () =>
    Response.json({
      choices: [
        {
          finish_reason: finishReason,
          message: { content: JSON.stringify({ classifications }) },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("changed passages", () => {
  it("preserves offsets and revision sides for replacements and additions", () => {
    const previous = "📋 Plan\nOld action\nKeep\n";
    const selected = "📋 Plan\nNew action\nKeep\nNew deadline\n";
    const result = changedPassages(previous, selected);
    expect(result.passages.map(({ side, text }) => [side, text])).toEqual([
      ["previous", "Old action\n"],
      ["selected", "New action\n"],
      ["selected", "New deadline\n"],
    ]);
    for (const passage of result.passages) {
      const revision = passage.side === "previous" ? previous : selected;
      expect(revision.slice(passage.start, passage.end)).toBe(passage.text);
    }
    expect(changedPassages(selected, selected).passages).toEqual([]);
  });
});

describe("coverage reasons", () => {
  it("replaces task IDs with titles and hides any other ID", () => {
    const task = {
      id: "0b6d7c2e-5f1a-4a3b-9c8d-1e2f3a4b5c6d",
      title: "Review the impersonating domain list",
    };
    expect(
      nameTasks(
        `Task ${task.id.toUpperCase()} only reviews the list; 11111111-2222-4333-8444-555555555555 is unrelated.`,
        [task],
      ),
    ).toBe(
      "Task “Review the impersonating domain list” only reviews the list; an item is unrelated.",
    );
    expect(nameTasks("No IDs here.", [task])).toBe("No IDs here.");
  });
});

describe("SERV coverage", () => {
  it("accepts a classification linked to a supplied proposal", async () => {
    const fetch = mockCompletion([classification]);
    await expect(classifyCoverage(input, config)).resolves.toMatchObject({
      classifications: [classification],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "missing passage", items: [] },
    { name: "duplicate passage", items: [classification, classification] },
    {
      name: "unknown passage",
      items: [{ ...classification, passageId: "unknown" }],
    },
    {
      name: "unknown reference",
      items: [{ ...classification, taskIds: ["unknown"] }],
    },
    {
      name: "unknown proposal key",
      items: [{ ...classification, proposalKeys: ["proposal-2"] }],
    },
    {
      name: "repeated reference",
      items: [
        { ...classification, proposalKeys: ["proposal-1", "proposal-1"] },
      ],
    },
    {
      name: "covered passage without a reference",
      items: [{ ...classification, proposalKeys: [] }],
    },
    {
      name: "uncovered passage with a reference",
      items: [{ ...classification, status: "uncovered" }],
    },
    {
      name: "no-task-change passage with a reference",
      items: [{ ...classification, status: "no_task_change" }],
    },
    {
      name: "blank reason",
      items: [{ ...classification, reason: "  " }],
    },
    {
      name: "unknown status",
      items: [{ ...classification, status: "partly_covered" }],
    },
  ])("rejects a $name", async ({ items }) => {
    mockCompletion(items);
    await expect(classifyCoverage(input, config)).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });
  });

  it("limits the requested schema to this review's IDs and states the same-work rule", async () => {
    const fetch = mockCompletion([classification]);
    await classifyCoverage(
      { ...input, tasks: [{ id: "task-1", text: "Review the domain list" }] },
      config,
    );
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    const item =
      body.response_format.json_schema.schema.properties.classifications.items
        .properties;
    expect(item.passageId.enum).toEqual([input.passages[0].id]);
    expect(item.proposalKeys.items.enum).toEqual(["proposal-1"]);
    expect(item.taskIds.items.enum).toEqual(["task-1"]);
    expect(body.messages[0].content).toContain(
      "A related task does not cover a passage unless it does the same work.",
    );
  });

  it("rejects a truncated completion even when its JSON parses", async () => {
    mockCompletion([classification], "length");
    await expect(classifyCoverage(input, config)).rejects.toMatchObject({
      code: "INVALID_OUTPUT",
    });
  });

  it("does not retry a provider error or expose the upstream body", async () => {
    const fetch = vi.fn(
      async () => new Response("private details", { status: 429 }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(classifyCoverage(input, config)).rejects.toMatchObject({
      code: "PROVIDER_FAILED",
      message: "SERV coverage failed (HTTP 429).",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
