// NOTE: Regex patterns must match delimiter constants in critic-constants.ts.
import { parse } from "critic-markup";

export interface CriticRange {
  type: "addition" | "deletion" | "substitution" | "comment" | "highlight";
  start: number;
  end: number;
  content: Record<string, string>;
}

// critic-markup package doesn't parse highlights, so we do it ourselves
const HIGHLIGHT_RE = /\{==(.+?)==\}/g;

export function parseCriticRanges(text: string): CriticRange[] {
  const ranges: CriticRange[] = [];
  // Track positions covered by the package to avoid regex duplicates
  const coveredPositions = new Set<number>();

  // Use the critic-markup package for addition, deletion, substitution, comment
  const parsed = parse(text) as {
    type: string;
    start: number;
    end: number;
    content: Record<string, string>;
  }[];

  for (const item of parsed) {
    // The package treats {==hl==}{>>cm<<} as a single "highlight" type
    // with both content.highlight and content.comment — split into two ranges
    if (
      item.type === "highlight" &&
      item.content.highlight != null &&
      item.content.comment != null
    ) {
      const hlText = item.content.highlight;
      // {== + highlight + ==} = 3 + len + 3
      const hlEnd = item.start + 3 + hlText.length + 3;
      ranges.push({
        type: "highlight",
        start: item.start,
        end: hlEnd,
        content: { highlight: hlText },
      });
      ranges.push({
        type: "comment",
        start: hlEnd,
        end: item.end,
        content: { comment: item.content.comment },
      });
      coveredPositions.add(item.start);
    } else {
      ranges.push({
        type: item.type as CriticRange["type"],
        start: item.start,
        end: item.end,
        content: item.content,
      });
    }
  }

  // Parse standalone highlights manually (package doesn't handle them)
  HIGHLIGHT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HIGHLIGHT_RE.exec(text)) !== null) {
    if (!coveredPositions.has(match.index)) {
      ranges.push({
        type: "highlight",
        start: match.index,
        end: match.index + match[0].length,
        content: { highlight: match[1] },
      });
    }
  }

  // Sort by start position
  ranges.sort((a, b) => a.start - b.start);

  return ranges;
}

export function acceptRange(text: string, range: CriticRange): string {
  const before = text.slice(0, range.start);
  const after = text.slice(range.end);

  switch (range.type) {
    case "addition":
      return before + range.content.addition + after;
    case "deletion":
      return before + after;
    case "substitution":
      return before + range.content.addition + after;
    case "comment":
      return before + after;
    case "highlight":
      return before + range.content.highlight + after;
  }
}

export function rejectRange(text: string, range: CriticRange): string {
  const before = text.slice(0, range.start);
  const after = text.slice(range.end);

  switch (range.type) {
    case "addition":
      return before + after;
    case "deletion":
      return before + range.content.deletion + after;
    case "substitution":
      return before + range.content.deletion + after;
    case "comment":
      return before + after;
    case "highlight":
      return before + range.content.highlight + after;
  }
}

export function resolvedContent(
  range: CriticRange,
  accept: boolean,
): string {
  if (accept) {
    switch (range.type) {
      case "addition":
        return range.content.addition;
      case "deletion":
        return "";
      case "substitution":
        return range.content.addition;
      case "comment":
        return "";
      case "highlight":
        return range.content.highlight;
    }
  } else {
    switch (range.type) {
      case "addition":
        return "";
      case "deletion":
        return range.content.deletion;
      case "substitution":
        return range.content.deletion;
      case "comment":
        return "";
      case "highlight":
        return range.content.highlight;
    }
  }
}

export function acceptAll(text: string): string {
  const ranges = parseCriticRanges(text);
  // Process end-to-start to preserve positions
  let result = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    result = acceptRange(result, ranges[i]);
  }
  return result;
}

export function rejectAll(text: string): string {
  const ranges = parseCriticRanges(text);
  // Process end-to-start to preserve positions
  let result = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    result = rejectRange(result, ranges[i]);
  }
  return result;
}
