import type { DocumentMetadata } from "~/shared/document-metadata";

export const DOCUMENT_INDEX_AGENT_NAME = "default";

export type DocumentIndexEntry = DocumentMetadata;

export interface DocumentIndexListResponse {
  documents: DocumentIndexEntry[];
}
