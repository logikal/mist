import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { serializeWithCriticMarkup } from "~/lib/critic-serializer";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] as const },
    text: { inline: true },
  },
  marks: {
    criticAddition: {
      toDOM: () => ["span", { class: "cm-addition" }, 0] as const,
    },
    criticDeletion: {
      toDOM: () => ["span", { class: "cm-deletion" }, 0] as const,
    },
    criticComment: {
      toDOM: () => ["span", { class: "cm-comment" }, 0] as const,
    },
    criticHighlight: {
      attrs: { threadId: { default: null } },
      toDOM: () => ["span", { class: "cm-highlight" }, 0] as const,
    },
  },
});

function makeDoc(...paragraphs: { text: string; mark?: string }[][]) {
  const pNodes = paragraphs.map((nodes) => {
    const children = nodes.map(({ text, mark }) => {
      if (mark) {
        return schema.text(text, [schema.marks[mark].create()]);
      }
      return schema.text(text);
    });
    return schema.node("paragraph", null, children.length > 0 ? children : undefined);
  });
  return schema.node("doc", null, pNodes);
}

describe("serializeWithCriticMarkup", () => {
  it("serializes plain text", () => {
    const doc = makeDoc([{ text: "hello world" }]);
    expect(serializeWithCriticMarkup(doc)).toBe("hello world");
  });

  it("serializes addition mark", () => {
    const doc = makeDoc([
      { text: "hello " },
      { text: "world", mark: "criticAddition" },
    ]);
    expect(serializeWithCriticMarkup(doc)).toBe("hello {++world++}");
  });

  it("serializes deletion mark", () => {
    const doc = makeDoc([
      { text: "hello " },
      { text: "world", mark: "criticDeletion" },
    ]);
    expect(serializeWithCriticMarkup(doc)).toBe("hello {--world--}");
  });

  it("serializes comment mark", () => {
    const doc = makeDoc([
      { text: "text" },
      { text: "a note", mark: "criticComment" },
    ]);
    expect(serializeWithCriticMarkup(doc)).toBe("text{>>a note<<}");
  });

  it("serializes highlight mark", () => {
    const doc = makeDoc([
      { text: "see " },
      { text: "this", mark: "criticHighlight" },
      { text: " part" },
    ]);
    expect(serializeWithCriticMarkup(doc)).toBe("see {==this==} part");
  });

  it("serializes multiple paragraphs", () => {
    const doc = makeDoc(
      [{ text: "first" }],
      [{ text: "second" }],
    );
    expect(serializeWithCriticMarkup(doc)).toBe("first\nsecond");
  });

  it("serializes adjacent addition and deletion", () => {
    const doc = makeDoc([
      { text: "old", mark: "criticDeletion" },
      { text: "new", mark: "criticAddition" },
    ]);
    expect(serializeWithCriticMarkup(doc)).toBe("{--old--}{++new++}");
  });

  it("serializes mixed marks with plain text", () => {
    const doc = makeDoc([
      { text: "hello " },
      { text: "added", mark: "criticAddition" },
      { text: " middle " },
      { text: "removed", mark: "criticDeletion" },
      { text: " end" },
    ]);
    expect(serializeWithCriticMarkup(doc)).toBe(
      "hello {++added++} middle {--removed--} end",
    );
  });

  it("serializes empty paragraph", () => {
    const doc = makeDoc([], [{ text: "text" }]);
    expect(serializeWithCriticMarkup(doc)).toBe("\ntext");
  });
});
