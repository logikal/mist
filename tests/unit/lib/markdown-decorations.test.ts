import { describe, it, expect } from "vitest";
import {
  MARKDOWN_PATTERNS,
  findDecorations,
  type MarkdownPattern,
} from "~/lib/markdown-decorations";

function getPattern(name: string): MarkdownPattern {
  const p = MARKDOWN_PATTERNS.find((p) => p.name === name);
  if (!p) throw new Error(`Pattern ${name} not found`);
  return p;
}

function matchPositions(text: string, pattern: MarkdownPattern) {
  return findDecorations(text, 0, pattern).map((d) => ({
    from: d.from,
    to: d.to,
    // Decoration.inline stores the attrs object directly in spec
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    class: (d as any).type.attrs?.class,
  }));
}

describe("MARKDOWN_PATTERNS", () => {
  it("exports all expected pattern names", () => {
    const names = MARKDOWN_PATTERNS.map((p) => p.name);
    expect(names).toContain("bold");
    expect(names).toContain("italic");
    expect(names).toContain("code");
    expect(names).toContain("strikethrough");
    expect(names).toContain("heading");
    expect(names).toContain("link");
    expect(names).toContain("blockquote");
    expect(names).toContain("list");
    expect(names).toContain("hr");
  });
});

describe("findDecorations", () => {
  describe("bold", () => {
    const pattern = getPattern("bold");

    it("decorates **bold** text", () => {
      const decos = matchPositions("hello **world** end", pattern);
      expect(decos).toEqual([
        { from: 6, to: 8, class: "md-delimiter" },
        { from: 8, to: 13, class: "md-bold" },
        { from: 13, to: 15, class: "md-delimiter" },
      ]);
    });

    it("handles multiple bold spans", () => {
      const decos = matchPositions("**a** and **b**", pattern);
      expect(decos).toHaveLength(6);
    });

    it("returns nothing for unmatched text", () => {
      const decos = matchPositions("no bold here", pattern);
      expect(decos).toHaveLength(0);
    });
  });

  describe("italic", () => {
    const pattern = getPattern("italic");

    it("decorates *italic* text", () => {
      const decos = matchPositions("hello *world* end", pattern);
      expect(decos).toEqual([
        { from: 6, to: 7, class: "md-delimiter" },
        { from: 7, to: 12, class: "md-italic" },
        { from: 12, to: 13, class: "md-delimiter" },
      ]);
    });
  });

  describe("code", () => {
    const pattern = getPattern("code");

    it("decorates `code` text", () => {
      const decos = matchPositions("use `npm install` here", pattern);
      expect(decos).toEqual([
        { from: 4, to: 5, class: "md-delimiter" },
        { from: 5, to: 16, class: "md-code" },
        { from: 16, to: 17, class: "md-delimiter" },
      ]);
    });
  });

  describe("strikethrough", () => {
    const pattern = getPattern("strikethrough");

    it("decorates ~~strikethrough~~ text", () => {
      const decos = matchPositions("~~removed~~ text", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-delimiter" },
        { from: 2, to: 9, class: "md-strikethrough" },
        { from: 9, to: 11, class: "md-delimiter" },
      ]);
    });
  });

  describe("heading", () => {
    const pattern = getPattern("heading");

    it("decorates # heading with delimiter and content", () => {
      const decos = matchPositions("# Hello", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-heading-delimiter" },
        { from: 2, to: 7, class: "md-heading md-heading-1" },
      ]);
    });

    it("decorates ## level 2 heading", () => {
      const decos = matchPositions("## Hello", pattern);
      expect(decos).toEqual([
        { from: 0, to: 3, class: "md-heading-delimiter" },
        { from: 3, to: 8, class: "md-heading md-heading-2" },
      ]);
    });

    it("decorates ### level 3 heading", () => {
      const decos = matchPositions("### Sub", pattern);
      expect(decos).toEqual([
        { from: 0, to: 4, class: "md-heading-delimiter" },
        { from: 4, to: 7, class: "md-heading md-heading-3" },
      ]);
    });

    it("decorates ###### level 6 heading", () => {
      const decos = matchPositions("###### Deep", pattern);
      expect(decos).toEqual([
        { from: 0, to: 7, class: "md-heading-delimiter" },
        { from: 7, to: 11, class: "md-heading md-heading-6" },
      ]);
    });
  });

  describe("link", () => {
    const pattern = getPattern("link");

    it("decorates [text](url) with 5 parts", () => {
      const decos = matchPositions("[click here](https://example.com)", pattern);
      expect(decos).toEqual([
        { from: 0, to: 1, class: "md-delimiter" },        // [
        { from: 1, to: 11, class: "md-link-text" },        // click here
        { from: 11, to: 13, class: "md-delimiter" },       // ](
        { from: 13, to: 32, class: "md-link-url" },        // https://example.com
        { from: 32, to: 33, class: "md-delimiter" },       // )
      ]);
    });

    it("handles link in middle of text", () => {
      const decos = matchPositions("see [docs](http://x.co) here", pattern);
      expect(decos).toHaveLength(5);
      expect(decos[0]).toEqual({ from: 4, to: 5, class: "md-delimiter" });
      expect(decos[1]).toEqual({ from: 5, to: 9, class: "md-link-text" });
    });

    it("handles multiple links", () => {
      const decos = matchPositions("[a](b) [c](d)", pattern);
      expect(decos).toHaveLength(10);
    });
  });

  describe("blockquote", () => {
    const pattern = getPattern("blockquote");

    it("decorates > prefix", () => {
      const decos = matchPositions("> quote text", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-delimiter" },
      ]);
    });

    it("does not match > without space", () => {
      const decos = matchPositions(">nospace", pattern);
      expect(decos).toHaveLength(0);
    });
  });

  describe("list", () => {
    const pattern = getPattern("list");

    it("decorates - bullet", () => {
      const decos = matchPositions("- item", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-delimiter" },
      ]);
    });

    it("decorates * bullet", () => {
      const decos = matchPositions("* item", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-delimiter" },
      ]);
    });

    it("decorates + bullet", () => {
      const decos = matchPositions("+ item", pattern);
      expect(decos).toEqual([
        { from: 0, to: 2, class: "md-delimiter" },
      ]);
    });

    it("decorates 1. numbered list", () => {
      const decos = matchPositions("1. first", pattern);
      expect(decos).toEqual([
        { from: 0, to: 3, class: "md-delimiter" },
      ]);
    });

    it("decorates indented bullet", () => {
      const decos = matchPositions("  - nested", pattern);
      expect(decos).toEqual([
        { from: 0, to: 4, class: "md-delimiter" },
      ]);
    });
  });

  describe("hr", () => {
    const pattern = getPattern("hr");

    it("decorates ---", () => {
      const decos = matchPositions("---", pattern);
      expect(decos).toEqual([
        { from: 0, to: 3, class: "md-hr" },
      ]);
    });

    it("decorates ***", () => {
      const decos = matchPositions("***", pattern);
      expect(decos).toEqual([
        { from: 0, to: 3, class: "md-hr" },
      ]);
    });

    it("decorates ___", () => {
      const decos = matchPositions("___", pattern);
      expect(decos).toEqual([
        { from: 0, to: 3, class: "md-hr" },
      ]);
    });

    it("decorates longer rules", () => {
      const decos = matchPositions("-----", pattern);
      expect(decos).toEqual([
        { from: 0, to: 5, class: "md-hr" },
      ]);
    });

    it("does not match fewer than 3 characters", () => {
      const decos = matchPositions("--", pattern);
      expect(decos).toHaveLength(0);
    });
  });

  describe("basePos offset", () => {
    it("offsets all decoration positions by basePos", () => {
      const pattern = getPattern("bold");
      const decos = findDecorations("**hi**", 10, pattern).map((d) => ({
        from: d.from,
        to: d.to,
      }));
      expect(decos).toEqual([
        { from: 10, to: 12 },
        { from: 12, to: 14 },
        { from: 14, to: 16 },
      ]);
    });
  });
});
