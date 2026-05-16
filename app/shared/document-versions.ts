export type DocumentVersionReason = "autosave" | "manual" | "restore";

export interface DocumentVersionSummary {
  id: string;
  docId: string;
  createdAt: number;
  createdBy: string | null;
  label: string | null;
  reason: DocumentVersionReason;
}

export interface DocumentVersionsResponse {
  versions: DocumentVersionSummary[];
}

export interface SaveVersionResponse {
  ok: true;
  version: DocumentVersionSummary;
}

export interface RestoreVersionResponse {
  ok: true;
  restoredVersionId: string;
}

export const VERSION_AUTOSAVE_INTERVAL_MS = 60_000;
export const MAX_DOCUMENT_VERSIONS = 100;
