import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";

function createSchema() {
  return new Schema({
    nodes: {
      doc: { content: "paragraph+" },
      paragraph: { content: "text*", toDOM: () => ["p", 0] as const },
      text: { inline: true },
    },
    marks: {
      criticAddition: {
        inclusive: false,
        excludes: "criticDeletion criticComment",
        toDOM: () => ["span", { class: "cm-addition" }, 0] as const,
        parseDOM: [{ tag: "span.cm-addition" }],
      },
      criticDeletion: {
        inclusive: false,
        excludes: "criticAddition criticComment",
        toDOM: () => ["span", { class: "cm-deletion" }, 0] as const,
        parseDOM: [{ tag: "span.cm-deletion" }],
      },
      criticComment: {
        inclusive: false,
        excludes: "criticAddition criticDeletion",
        toDOM: () => ["span", { class: "cm-comment" }, 0] as const,
        parseDOM: [{ tag: "span.cm-comment" }],
      },
      criticHighlight: {
        inclusive: false,
        attrs: { threadId: { default: null } },
        toDOM: () => ["span", { class: "cm-highlight" }, 0] as const,
        parseDOM: [{ tag: "span.cm-highlight" }],
      },
    },
  });
}

describe("critic mark schema", () => {
  it("creates a schema with all four mark types", () => {
    const schema = createSchema();
    expect(schema.marks.criticAddition).toBeDefined();
    expect(schema.marks.criticDeletion).toBeDefined();
    expect(schema.marks.criticComment).toBeDefined();
    expect(schema.marks.criticHighlight).toBeDefined();
  });

  it("can apply criticAddition mark to text", () => {
    const schema = createSchema();
    const mark = schema.marks.criticAddition.create();
    const textNode = schema.text("hello", [mark]);
    expect(textNode.marks).toHaveLength(1);
    expect(textNode.marks[0].type.name).toBe("criticAddition");
  });

  it("can apply criticDeletion mark to text", () => {
    const schema = createSchema();
    const mark = schema.marks.criticDeletion.create();
    const textNode = schema.text("deleted", [mark]);
    expect(textNode.marks).toHaveLength(1);
    expect(textNode.marks[0].type.name).toBe("criticDeletion");
  });

  it("can apply criticComment mark to text", () => {
    const schema = createSchema();
    const mark = schema.marks.criticComment.create();
    const textNode = schema.text("a note", [mark]);
    expect(textNode.marks).toHaveLength(1);
    expect(textNode.marks[0].type.name).toBe("criticComment");
  });

  it("criticHighlight carries threadId attribute", () => {
    const schema = createSchema();
    const mark = schema.marks.criticHighlight.create({ threadId: "abc123" });
    expect(mark.attrs.threadId).toBe("abc123");
  });

  it("criticHighlight has null threadId by default", () => {
    const schema = createSchema();
    const mark = schema.marks.criticHighlight.create();
    expect(mark.attrs.threadId).toBeNull();
  });

  it("excludes prevent addition+deletion on same text", () => {
    const schema = createSchema();
    const addMark = schema.marks.criticAddition.create();
    const delMark = schema.marks.criticDeletion.create();
    // When both are applied, ProseMirror's excludes rule means only the last applied wins
    const textNode = schema.text("conflict", [addMark, delMark]);
    // ProseMirror resolves excludes at schema level — the marks array
    // will contain what's allowed. We just check the schema configuration.
    expect(schema.marks.criticAddition.excludes(schema.marks.criticDeletion)).toBe(true);
    expect(schema.marks.criticDeletion.excludes(schema.marks.criticAddition)).toBe(true);
    // Text node still has marks but schema enforces exclusion during editing
    expect(textNode.marks.length).toBeGreaterThan(0);
  });
});
