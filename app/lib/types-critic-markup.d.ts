declare module "critic-markup" {
  interface ParsedRange {
    type: string;
    inputText: string;
    matchedText: string;
    start: number;
    end: number;
    length: number;
    content: Record<string, string>;
  }

  export function parse(text: string): ParsedRange[];
  export function render(text: string): string;
}
