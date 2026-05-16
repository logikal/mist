import { getMarkRange, type Editor as TiptapEditor } from "@tiptap/core";
import type { ThreadData } from "~/shared/types";

export interface DocumentComment {
  commentText: string;
  highlightText?: string;
  position: number;
  endPosition: number;
}

/**
 * Scan the editor document for CriticMarkup comment and highlight marks.
 * Returns comment positions derived from marks rather than regex parsing.
 */
export function scanDocumentComments(editor: TiptapEditor): DocumentComment[] {
  const comments: DocumentComment[] = [];

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    const commentMark = node.marks.find(
      (m) => m.type.name === "criticComment",
    );
    if (commentMark) {
      // Check if there's a preceding highlight mark (for paired comments)
      // Look at the node just before this one
      let highlightText: string | undefined;
      if (pos > 0) {
        const nodeBefore = editor.state.doc.nodeAt(pos - 1);
        if (nodeBefore?.isText) {
          const hlMark = nodeBefore.marks.find(
            (m) => m.type.name === "criticHighlight",
          );
          if (hlMark) {
            highlightText = nodeBefore.text ?? undefined;
          }
        }
      }

      comments.push({
        commentText: node.text,
        highlightText,
        position: pos,
        endPosition: pos + node.nodeSize,
      });
    }
  });

  return comments;
}

export type MatchedThread = ThreadData & { position?: number; endPosition?: number };

export function matchThreadsToComments(
  threads: ThreadData[],
  comments: DocumentComment[],
): MatchedThread[] {
  const sorted = [...threads].sort((a, b) => a.createdAt - b.createdAt);
  const usedCommentIndices = new Set<number>();
  const result: MatchedThread[] = [];

  for (const thread of sorted) {
    let matchedIdx = -1;
    for (let i = 0; i < comments.length; i++) {
      if (usedCommentIndices.has(i)) continue;
      if (comments[i].commentText === thread.commentText) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx >= 0) {
      usedCommentIndices.add(matchedIdx);
      result.push({
        ...thread,
        position: comments[matchedIdx].position,
        endPosition: comments[matchedIdx].endPosition,
      });
    } else {
      result.push({ ...thread, position: undefined, endPosition: undefined });
    }
  }

  return result;
}

/**
 * Find the comment text at the current cursor position.
 * Handles both direct (cursor in criticComment) and indirect
 * (cursor in criticHighlight with adjacent comment) cases.
 */
export function findCommentTextAtCursor(editor: TiptapEditor): string | null {
  const { from } = editor.state.selection;
  const $from = editor.state.doc.resolve(from);
  const commentType = editor.schema.marks.criticComment;
  const highlightType = editor.schema.marks.criticHighlight;

  // Direct: cursor inside a criticComment mark
  if (commentType) {
    const range = getMarkRange($from, commentType);
    if (range) {
      return editor.state.doc.textBetween(range.from, range.to);
    }
  }

  // Indirect: cursor inside a criticHighlight mark → find the adjacent comment
  if (highlightType && commentType) {
    const hlRange = getMarkRange($from, highlightType);
    if (hlRange) {
      const $afterHl = editor.state.doc.resolve(hlRange.to);
      const commentRange = getMarkRange($afterHl, commentType);
      if (commentRange) {
        return editor.state.doc.textBetween(commentRange.from, commentRange.to);
      }
    }
  }

  return null;
}

export function findOrphanedThreads(
  threads: ThreadData[],
  comments: DocumentComment[],
): ThreadData[] {
  const matched = matchThreadsToComments(threads, comments);
  return matched
    .filter((t) => t.position === undefined)
    .map(({ position: _, ...rest }) => rest);
}

export function shouldClearThreadSidecarState({
  comments,
  documentText,
  hasSeenComments,
  threadCount,
}: {
  comments: DocumentComment[];
  documentText: string;
  hasSeenComments: boolean;
  threadCount: number;
}): boolean {
  return (
    hasSeenComments &&
    threadCount > 0 &&
    comments.length === 0 &&
    documentText.trim().length === 0
  );
}
