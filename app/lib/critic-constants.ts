export const DELIMITERS = {
  addition: { open: "{++", close: "++}" },
  deletion: { open: "{--", close: "--}" },
  substitution: { open: "{~~", close: "~~}", separator: "~>" },
  comment: { open: "{>>", close: "<<}" },
  highlight: { open: "{==", close: "==}" },
} as const;

export const DELIMITER_LENGTH = 3;
