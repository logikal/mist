import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { DELIMITERS } from "./critic-constants";

/**
 * Serialize a ProseMirror document to text with CriticMarkup delimiters
 * reconstructed from marks.
 */
export function serializeWithCriticMarkup(doc: ProseMirrorNode): string {
  const paragraphs: string[] = [];

  doc.forEach((block) => {
    if (!block.isTextblock) {
      paragraphs.push("");
      return;
    }
    let text = "";
    block.forEach((node) => {
      if (!node.isText || !node.text) return;
      const content = node.text;
      const addition = node.marks.find((m) => m.type.name === "criticAddition");
      const deletion = node.marks.find((m) => m.type.name === "criticDeletion");
      const comment = node.marks.find((m) => m.type.name === "criticComment");
      const highlight = node.marks.find((m) => m.type.name === "criticHighlight");

      if (addition) {
        text += `${DELIMITERS.addition.open}${content}${DELIMITERS.addition.close}`;
      } else if (deletion) {
        text += `${DELIMITERS.deletion.open}${content}${DELIMITERS.deletion.close}`;
      } else if (comment) {
        text += `${DELIMITERS.comment.open}${content}${DELIMITERS.comment.close}`;
      } else if (highlight) {
        text += `${DELIMITERS.highlight.open}${content}${DELIMITERS.highlight.close}`;
      } else {
        text += content;
      }
    });
    paragraphs.push(text);
  });

  return paragraphs.join("\n");
}
