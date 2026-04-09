import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type PatternType = "inline" | "prefix" | "heading" | "link";

export interface MarkdownPattern {
  name: string;
  regex: RegExp;
  type: PatternType;
  contentClass: string;
  delimiterClass: string;
}

export const MARKDOWN_PATTERNS: MarkdownPattern[] = [
  {
    name: "bold",
    regex: /\*\*(.+?)\*\*/g,
    type: "inline",
    contentClass: "md-bold",
    delimiterClass: "md-delimiter",
  },
  {
    name: "italic",
    regex: /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
    type: "inline",
    contentClass: "md-italic",
    delimiterClass: "md-delimiter",
  },
  {
    name: "italic-underscore",
    regex: /(?<!\w)_(?!_)(.+?)(?<!_)_(?!\w)/g,
    type: "inline",
    contentClass: "md-italic",
    delimiterClass: "md-delimiter",
  },
  {
    name: "code",
    regex: /`([^`]+)`/g,
    type: "inline",
    contentClass: "md-code",
    delimiterClass: "md-delimiter",
  },
  {
    name: "strikethrough",
    regex: /~~(.+?)~~/g,
    type: "inline",
    contentClass: "md-strikethrough",
    delimiterClass: "md-delimiter",
  },
  {
    name: "heading",
    regex: /^(#{1,6}\s)(.+)$/gm,
    type: "heading",
    contentClass: "md-heading",
    delimiterClass: "md-heading-delimiter",
  },
  {
    name: "link",
    regex: /\[([^\]]+)\]\(([^)]+)\)/g,
    type: "link",
    contentClass: "md-link-text",
    delimiterClass: "md-delimiter",
  },
  {
    name: "blockquote",
    regex: /^(>\s)/gm,
    type: "prefix",
    contentClass: "",
    delimiterClass: "md-delimiter",
  },
  {
    name: "list",
    regex: /^(\s*(?:[-*+]|\d+\.)\s)/gm,
    type: "prefix",
    contentClass: "",
    delimiterClass: "md-delimiter",
  },
  {
    name: "hr",
    regex: /^([-*_]{3,})\s*$/gm,
    type: "prefix",
    contentClass: "",
    delimiterClass: "md-hr",
  },
];

export function findDecorations(
  text: string,
  basePos: number,
  pattern: MarkdownPattern,
): Decoration[] {
  const decorations: Decoration[] = [];
  pattern.regex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.regex.exec(text)) !== null) {
    const fullStart = basePos + match.index;
    const fullEnd = fullStart + match[0].length;

    if (pattern.type === "prefix") {
      decorations.push(
        Decoration.inline(fullStart, fullEnd, {
          class: pattern.delimiterClass,
        }),
      );
    } else if (pattern.type === "heading") {
      // match[1] = "## ", match[2] = heading text
      const delimEnd = fullStart + match[1].length;
      const level = match[1].trim().length; // number of # characters
      decorations.push(
        Decoration.inline(fullStart, delimEnd, {
          class: pattern.delimiterClass,
        }),
      );
      decorations.push(
        Decoration.inline(delimEnd, fullEnd, {
          class: `${pattern.contentClass} md-heading-${level}`,
        }),
      );
    } else if (pattern.type === "link") {
      // Full match: [text](url)
      // match[1] = link text, match[2] = url
      const textContent = match[1];
      const urlContent = match[2];
      // [ delimiter
      const bracketStart = fullStart;
      const bracketEnd = bracketStart + 1;
      // link text
      const textStart = bracketEnd;
      const textEnd = textStart + textContent.length;
      // ]( delimiter
      const midStart = textEnd;
      const midEnd = midStart + 2;
      // url
      const urlStart = midEnd;
      const urlEnd = urlStart + urlContent.length;
      // ) delimiter
      const closeStart = urlEnd;
      const closeEnd = closeStart + 1;

      decorations.push(
        Decoration.inline(bracketStart, bracketEnd, {
          class: pattern.delimiterClass,
        }),
      );
      decorations.push(
        Decoration.inline(textStart, textEnd, {
          class: pattern.contentClass,
        }),
      );
      decorations.push(
        Decoration.inline(midStart, midEnd, {
          class: pattern.delimiterClass,
        }),
      );
      decorations.push(
        Decoration.inline(urlStart, urlEnd, {
          class: "md-link-url",
          nodeName: "a",
          href: urlContent,
          target: "_blank",
          rel: "noopener noreferrer",
        }),
      );
      decorations.push(
        Decoration.inline(closeStart, closeEnd, {
          class: pattern.delimiterClass,
        }),
      );
    } else {
      // inline: [delimiter][content][delimiter]
      const contentStart = fullStart + match[0].indexOf(match[1]);
      const contentEnd = contentStart + match[1].length;

      decorations.push(
        Decoration.inline(fullStart, contentStart, {
          class: pattern.delimiterClass,
        }),
      );
      decorations.push(
        Decoration.inline(contentStart, contentEnd, {
          class: pattern.contentClass,
        }),
      );
      decorations.push(
        Decoration.inline(contentEnd, fullEnd, {
          class: pattern.delimiterClass,
        }),
      );
    }
  }

  return decorations;
}

export const cleanViewKey = new PluginKey<boolean>("cleanView");

const markdownPluginKey = new PluginKey("markdownDecorations");

export function markdownDecorations(): Plugin[] {
  const cleanViewPlugin = new Plugin<boolean>({
    key: cleanViewKey,
    state: {
      init() {
        return false;
      },
      apply(tr, value) {
        const meta = tr.getMeta(cleanViewKey);
        if (meta !== undefined) return meta as boolean;
        return value;
      },
    },
  });

  const decorationPlugin = new Plugin({
    key: markdownPluginKey,
    props: {
      handleClick(_view, _pos, event) {
        const target = event.target as HTMLElement;
        const anchor = target.closest("a.md-link-url");
        if (anchor) {
          const href = anchor.getAttribute("href");
          if (href) {
            window.open(href, "_blank", "noopener,noreferrer");
            event.preventDefault();
            return true;
          }
        }
        return false;
      },
      decorations(state) {
        const decorations: Decoration[] = [];

        state.doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return;
          for (const pattern of MARKDOWN_PATTERNS) {
            decorations.push(...findDecorations(node.text, pos, pattern));
          }
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });

  return [cleanViewPlugin, decorationPlugin];
}
