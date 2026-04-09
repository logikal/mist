import { describe, it, expect } from "vitest";
import {
  parseCriticRanges,
  acceptRange,
  rejectRange,
  acceptAll,
  rejectAll,
  resolvedContent,
  type CriticRange,
} from "~/lib/critic-markup";

describe("parseCriticRanges", () => {
  it("parses addition", () => {
    const ranges = parseCriticRanges("hello {++world++}");
    expect(ranges).toEqual([
      { type: "addition", start: 6, end: 17, content: { addition: "world" } },
    ]);
  });

  it("parses deletion", () => {
    const ranges = parseCriticRanges("{--removed--} text");
    expect(ranges).toEqual([
      {
        type: "deletion",
        start: 0,
        end: 13,
        content: { deletion: "removed" },
      },
    ]);
  });

  it("parses substitution", () => {
    const ranges = parseCriticRanges("{~~old~>new~~}");
    expect(ranges).toEqual([
      {
        type: "substitution",
        start: 0,
        end: 14,
        content: { deletion: "old", addition: "new" },
      },
    ]);
  });

  it("parses comment", () => {
    const ranges = parseCriticRanges("{>>note<<}");
    expect(ranges).toEqual([
      { type: "comment", start: 0, end: 10, content: { comment: "note" } },
    ]);
  });

  it("parses highlight", () => {
    const ranges = parseCriticRanges("{==important==}");
    expect(ranges).toEqual([
      {
        type: "highlight",
        start: 0,
        end: 15,
        content: { highlight: "important" },
      },
    ]);
  });

  it("parses multiple ranges", () => {
    const text = "hello {++added++} and {--removed--}";
    const ranges = parseCriticRanges(text);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].type).toBe("addition");
    expect(ranges[1].type).toBe("deletion");
  });

  it("returns correct positions", () => {
    const text = "ab{++cd++}ef";
    const ranges = parseCriticRanges(text);
    expect(ranges[0].start).toBe(2);
    expect(ranges[0].end).toBe(10);
  });

  it("splits paired highlight + comment into two ranges", () => {
    const ranges = parseCriticRanges("{==goodgood==}{>>comment<<}");
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({
      type: "highlight",
      start: 0,
      end: 14,
      content: { highlight: "goodgood" },
    });
    expect(ranges[1]).toEqual({
      type: "comment",
      start: 14,
      end: 27,
      content: { comment: "comment" },
    });
  });

  it("does not duplicate highlight when paired with comment", () => {
    const ranges = parseCriticRanges("text {==hl==}{>>cm<<} end");
    const highlights = ranges.filter((r) => r.type === "highlight");
    expect(highlights).toHaveLength(1);
  });
});

describe("acceptRange", () => {
  it("accepts addition: keeps content", () => {
    const text = "hello {++world++}";
    const range: CriticRange = {
      type: "addition",
      start: 6,
      end: 17,
      content: { addition: "world" },
    };
    expect(acceptRange(text, range)).toBe("hello world");
  });

  it("accepts deletion: removes content", () => {
    const text = "hello {--world--} end";
    const range: CriticRange = {
      type: "deletion",
      start: 6,
      end: 17,
      content: { deletion: "world" },
    };
    expect(acceptRange(text, range)).toBe("hello  end");
  });

  it("accepts substitution: keeps new text", () => {
    const text = "say {~~hello~>goodbye~~} now";
    const range: CriticRange = {
      type: "substitution",
      start: 4,
      end: 24,
      content: { deletion: "hello", addition: "goodbye" },
    };
    expect(acceptRange(text, range)).toBe("say goodbye now");
  });

  it("accepts comment: removes it", () => {
    const text = "text{>>note<<} more";
    const range: CriticRange = {
      type: "comment",
      start: 4,
      end: 14,
      content: { comment: "note" },
    };
    expect(acceptRange(text, range)).toBe("text more");
  });

  it("accepts highlight: keeps content", () => {
    const text = "see {==this==} part";
    const range: CriticRange = {
      type: "highlight",
      start: 4,
      end: 14,
      content: { highlight: "this" },
    };
    expect(acceptRange(text, range)).toBe("see this part");
  });
});

describe("rejectRange", () => {
  it("rejects addition: removes content", () => {
    const text = "hello {++world++}";
    const range: CriticRange = {
      type: "addition",
      start: 6,
      end: 17,
      content: { addition: "world" },
    };
    expect(rejectRange(text, range)).toBe("hello ");
  });

  it("rejects deletion: keeps content", () => {
    const text = "hello {--world--} end";
    const range: CriticRange = {
      type: "deletion",
      start: 6,
      end: 17,
      content: { deletion: "world" },
    };
    expect(rejectRange(text, range)).toBe("hello world end");
  });

  it("rejects substitution: keeps old text", () => {
    const text = "say {~~hello~>goodbye~~} now";
    const range: CriticRange = {
      type: "substitution",
      start: 4,
      end: 24,
      content: { deletion: "hello", addition: "goodbye" },
    };
    expect(rejectRange(text, range)).toBe("say hello now");
  });

  it("rejects comment: removes it", () => {
    const text = "text{>>note<<} more";
    const range: CriticRange = {
      type: "comment",
      start: 4,
      end: 14,
      content: { comment: "note" },
    };
    expect(rejectRange(text, range)).toBe("text more");
  });

  it("rejects highlight: keeps content", () => {
    const text = "see {==this==} part";
    const range: CriticRange = {
      type: "highlight",
      start: 4,
      end: 14,
      content: { highlight: "this" },
    };
    expect(rejectRange(text, range)).toBe("see this part");
  });
});

describe("resolvedContent", () => {
  it("accept addition returns content", () => {
    const range: CriticRange = {
      type: "addition",
      start: 0,
      end: 11,
      content: { addition: "world" },
    };
    expect(resolvedContent(range, true)).toBe("world");
  });

  it("accept deletion returns empty", () => {
    const range: CriticRange = {
      type: "deletion",
      start: 0,
      end: 13,
      content: { deletion: "removed" },
    };
    expect(resolvedContent(range, true)).toBe("");
  });

  it("accept substitution returns new text", () => {
    const range: CriticRange = {
      type: "substitution",
      start: 0,
      end: 14,
      content: { deletion: "old", addition: "new" },
    };
    expect(resolvedContent(range, true)).toBe("new");
  });

  it("reject addition returns empty", () => {
    const range: CriticRange = {
      type: "addition",
      start: 0,
      end: 11,
      content: { addition: "world" },
    };
    expect(resolvedContent(range, false)).toBe("");
  });

  it("reject deletion returns content", () => {
    const range: CriticRange = {
      type: "deletion",
      start: 0,
      end: 13,
      content: { deletion: "removed" },
    };
    expect(resolvedContent(range, false)).toBe("removed");
  });

  it("reject substitution returns old text", () => {
    const range: CriticRange = {
      type: "substitution",
      start: 0,
      end: 14,
      content: { deletion: "old", addition: "new" },
    };
    expect(resolvedContent(range, false)).toBe("old");
  });
});

describe("acceptAll", () => {
  it("accepts all ranges in a mixed document", () => {
    const text = "hello {++new++} and {--old--} with {~~bad~>good~~}";
    expect(acceptAll(text)).toBe("hello new and  with good");
  });

  it("handles document with no CriticMarkup", () => {
    expect(acceptAll("plain text")).toBe("plain text");
  });

  it("handles adjacent suggestions", () => {
    const text = "{++a++}{--b--}";
    expect(acceptAll(text)).toBe("a");
  });

  it("accepts paired highlight + comment (strips both)", () => {
    const text = "text {==goodgood==}{>>comment<<} end";
    expect(acceptAll(text)).toBe("text goodgood end");
  });
});

describe("rejectAll", () => {
  it("rejects all ranges in a mixed document", () => {
    const text = "hello {++new++} and {--old--} with {~~bad~>good~~}";
    expect(rejectAll(text)).toBe("hello  and old with bad");
  });

  it("handles document with no CriticMarkup", () => {
    expect(rejectAll("plain text")).toBe("plain text");
  });

  it("handles adjacent suggestions", () => {
    const text = "{++a++}{--b--}";
    expect(rejectAll(text)).toBe("b");
  });

  it("rejects paired highlight + comment (strips both)", () => {
    const text = "text {==goodgood==}{>>comment<<} end";
    expect(rejectAll(text)).toBe("text goodgood end");
  });
});
