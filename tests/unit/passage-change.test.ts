import { describe, expect, it } from "vitest";
import { supportingPassageChange } from "@/domain/sources/passage-change";
import { overlapCountsAsEdit } from "@/domain/sources/passage-status";

const brief = "Alpha launch.\nConfirm the supplier by Friday.\nBeta notes.";
const quote = "Confirm the supplier by Friday.";
const start = brief.indexOf(quote);
const end = start + quote.length;

describe("supporting passage comparison", () => {
  it("keeps a passage intact when an earlier paragraph is inserted", () => {
    expect(
      supportingPassageChange(brief, `A new preface.\n${brief}`, start, end),
    ).toBe("unchanged");
  });

  it("keeps a passage intact when a later paragraph changes", () => {
    expect(
      supportingPassageChange(
        brief,
        brief.replace("Beta notes.", "Beta notes changed."),
        start,
        end,
      ),
    ).toBe("unchanged");
  });

  it("flags an edit inside the cited span and a deletion of that span", () => {
    expect(
      supportingPassageChange(
        brief,
        brief.replace("Friday", "Monday"),
        start,
        end,
      ),
    ).toBe("edited");
    expect(
      supportingPassageChange(brief, "Alpha launch.\nBeta notes.", start, end),
    ).toBe("removed");
  });

  it("keeps the cited copy when an earlier duplicate line is removed", () => {
    const text = "Ship Friday.\nShip Friday.";
    const second = text.lastIndexOf("Ship Friday.");
    expect(
      supportingPassageChange(text, "Ship Friday.", second, text.length),
    ).toBe("unchanged");
    expect(
      supportingPassageChange(text, "Ship Monday.\nShip Friday.", 0, 12),
    ).toBe("edited");
  });

  it("keeps a quote that sits between two edits on the same line", () => {
    const line = "AAA QUOTE BBB";
    const quoteStart = line.indexOf("QUOTE");
    expect(
      supportingPassageChange(
        line,
        "XXX QUOTE YYY",
        quoteStart,
        quoteStart + 5,
      ),
    ).toBe("unchanged");
  });

  it("uses UTF-16 offsets, including an emoji that survives a prefix edit", () => {
    const text = "Launch 🚀 Friday";
    const emoji = text.indexOf("🚀");
    expect(
      supportingPassageChange(
        text,
        "Please Launch 🚀 Friday",
        emoji,
        emoji + 2,
      ),
    ).toBe("unchanged");
    expect(
      supportingPassageChange(text, "Launch 🛰 Friday", emoji, emoji + 2),
    ).toBe("removed");
    expect(
      supportingPassageChange(text, "Launch Friday", emoji, emoji + 2),
    ).toBe("removed");
    expect(supportingPassageChange("Ship Friday", "Ship Fri\nday", 5, 11)).toBe(
      "edited",
    );
  });

  it("treats a three-unit surviving run as an edit and a shorter overlap as removal", () => {
    expect(overlapCountsAsEdit(3, 20)).toBe(true);
    expect(overlapCountsAsEdit(5, 11)).toBe(true);
    expect(overlapCountsAsEdit(2, 2)).toBe(true);
    expect(overlapCountsAsEdit(1, 20)).toBe(false);
    expect(overlapCountsAsEdit(2, 20)).toBe(false);
  });

  it("rejects a span outside the predecessor", () => {
    expect(() => supportingPassageChange("Alpha", "Alpha", 0, 8)).toThrow(
      RangeError,
    );
  });
});
