import { describe, it, expect } from "vitest";
import { DELIMITERS, DELIMITER_LENGTH } from "~/lib/critic-constants";

describe("DELIMITERS", () => {
  it("has all five CriticMarkup types", () => {
    expect(Object.keys(DELIMITERS)).toEqual([
      "addition",
      "deletion",
      "substitution",
      "comment",
      "highlight",
    ]);
  });

  it("all open delimiters match DELIMITER_LENGTH", () => {
    for (const [, delim] of Object.entries(DELIMITERS)) {
      expect(delim.open.length).toBe(DELIMITER_LENGTH);
    }
  });

  it("all close delimiters match DELIMITER_LENGTH", () => {
    for (const [, delim] of Object.entries(DELIMITERS)) {
      expect(delim.close.length).toBe(DELIMITER_LENGTH);
    }
  });

  it("substitution has a separator", () => {
    expect(DELIMITERS.substitution.separator).toBe("~>");
  });
});
