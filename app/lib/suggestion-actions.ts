import type { Editor as TiptapEditor } from "@tiptap/core";

export function hasSuggestionMarkup(editor: TiptapEditor): boolean {
  const { doc } = editor.state;
  const additionType = editor.schema.marks.criticAddition;
  const deletionType = editor.schema.marks.criticDeletion;
  if (!additionType || !deletionType) return false;

  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.isText) {
      if (
        node.marks.some(
          (m) =>
            m.type.name === "criticAddition" ||
            m.type.name === "criticDeletion",
        )
      ) {
        found = true;
      }
    }
  });
  return found;
}

export function isCursorInSuggestion(editor: TiptapEditor): boolean {
  const { from } = editor.state.selection;
  // Check nodes before and at cursor for suggestion marks
  for (const pos of [from - 1, from]) {
    if (pos < 0) continue;
    const node = editor.state.doc.nodeAt(pos);
    if (!node?.isText) continue;
    if (
      node.marks.some(
        (m) =>
          m.type.name === "criticAddition" || m.type.name === "criticDeletion",
      )
    ) {
      return true;
    }
  }
  return false;
}

interface MarkRange {
  from: number;
  to: number;
  markName: string;
}

function collectSuggestionRanges(editor: TiptapEditor): MarkRange[] {
  const ranges: MarkRange[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (
        mark.type.name === "criticAddition" ||
        mark.type.name === "criticDeletion"
      ) {
        ranges.push({
          from: pos,
          to: pos + node.nodeSize,
          markName: mark.type.name,
        });
      }
    }
  });
  return ranges;
}

/**
 * Find the contiguous mark range at the cursor position.
 * Looks at the marks on the resolved position and walks forward/backward
 * to find the full extent of the mark.
 */
function findMarkRangeAtCursor(editor: TiptapEditor): MarkRange | null {
  const { from } = editor.state.selection;

  // Check nodes before and at cursor for a suggestion mark
  let sugMarkName: string | null = null;
  for (const pos of [from - 1, from]) {
    if (pos < 0) continue;
    const node = editor.state.doc.nodeAt(pos);
    if (!node?.isText) continue;
    const mark = node.marks.find(
      (m) =>
        m.type.name === "criticAddition" || m.type.name === "criticDeletion",
    );
    if (mark) {
      sugMarkName = mark.type.name;
      break;
    }
  }
  if (!sugMarkName) return null;

  // Find the range: walk through all collected ranges that match this mark
  // and are contiguous with the cursor position
  const allRanges = collectSuggestionRanges(editor).filter(
    (r) => r.markName === sugMarkName,
  );

  // Find the range containing the cursor
  for (const range of allRanges) {
    if (from >= range.from && from <= range.to) {
      // Expand to include contiguous ranges of the same mark
      let mergedFrom = range.from;
      let mergedTo = range.to;
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of allRanges) {
          if (r.from <= mergedTo && r.to >= mergedFrom) {
            if (r.from < mergedFrom) {
              mergedFrom = r.from;
              changed = true;
            }
            if (r.to > mergedTo) {
              mergedTo = r.to;
              changed = true;
            }
          }
        }
      }
      return { from: mergedFrom, to: mergedTo, markName: sugMarkName };
    }
  }
  return null;
}

export function processRangeAtCursor(editor: TiptapEditor, accept: boolean) {
  const range = findMarkRangeAtCursor(editor);
  if (!range) return;

  const markType = editor.schema.marks[range.markName];
  if (!markType) return;

  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      if (range.markName === "criticAddition") {
        if (accept) {
          // Accept addition: remove mark, keep text
          tr.removeMark(range.from, range.to, markType);
        } else {
          // Reject addition: delete the text
          tr.delete(range.from, range.to);
        }
      } else if (range.markName === "criticDeletion") {
        if (accept) {
          // Accept deletion: delete the text
          tr.delete(range.from, range.to);
        } else {
          // Reject deletion: remove mark, keep text
          tr.removeMark(range.from, range.to, markType);
        }
      }
      return true;
    })
    .run();
}

export function processAllRanges(editor: TiptapEditor, accept: boolean) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const ranges = collectSuggestionRanges(editor);
      if (ranges.length === 0) return false;

      // Process end-to-start to preserve positions
      ranges.sort((a, b) => b.from - a.from);

      for (const range of ranges) {
        const markType = editor.schema.marks[range.markName];
        if (!markType) continue;

        if (range.markName === "criticAddition") {
          if (accept) {
            tr.removeMark(range.from, range.to, markType);
          } else {
            tr.delete(range.from, range.to);
          }
        } else if (range.markName === "criticDeletion") {
          if (accept) {
            tr.delete(range.from, range.to);
          } else {
            tr.removeMark(range.from, range.to, markType);
          }
        }
      }
      return true;
    })
    .run();
}
