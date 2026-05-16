export const MIST_IDENTITY_HEADERS = [
  "x-mist-user-id",
  "x-mist-user-login",
  "x-mist-user-name",
] as const;

export interface DocumentOwner {
  id: string | null;
  login: string | null;
  name: string | null;
}

export type DocumentRetention =
  | { mode: "persistent" }
  | { mode: "ttl"; expiresAt: number };

export interface DocumentMetadata {
  id: string;
  createdAt: number;
  updatedAt: number;
  owner: DocumentOwner;
  retention: DocumentRetention;
}

export interface CreateDocumentMetadataInput {
  id: string;
  now: number;
  owner: DocumentOwner;
  retention: DocumentRetention;
}

function cleanHeaderValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function getOwnerFromHeaders(headers: Headers): DocumentOwner {
  return {
    id: cleanHeaderValue(headers.get("x-mist-user-id")),
    login: cleanHeaderValue(headers.get("x-mist-user-login")),
    name: cleanHeaderValue(headers.get("x-mist-user-name")),
  };
}

export function forwardMistIdentityHeaders(target: Headers, source: Headers): void {
  for (const header of MIST_IDENTITY_HEADERS) {
    const value = cleanHeaderValue(source.get(header));
    if (value) {
      target.set(header, value);
    }
  }
}

export function hasOwnerIdentity(owner: DocumentOwner): boolean {
  return Boolean(owner.id || owner.login || owner.name);
}

export function ownerMatchesIdentity(
  documentOwner: DocumentOwner,
  requestOwner: DocumentOwner,
): boolean {
  const requestStableKeys = new Set(
    [requestOwner.id, requestOwner.login].filter(Boolean),
  );
  const documentStableKeys = [documentOwner.id, documentOwner.login].filter(
    Boolean,
  );

  if (requestStableKeys.size > 0 || documentStableKeys.length > 0) {
    return documentStableKeys.some((value) => requestStableKeys.has(value));
  }

  return Boolean(
    documentOwner.name &&
      requestOwner.name &&
      documentOwner.name === requestOwner.name,
  );
}

export function normalizeRetention(input: unknown, now: number): DocumentRetention {
  if (!input || typeof input !== "object") {
    return { mode: "persistent" };
  }

  const retention = input as { mode?: unknown; expiresAt?: unknown; ttlMs?: unknown };

  if (retention.mode === "persistent") {
    return { mode: "persistent" };
  }

  if (retention.mode === "ttl") {
    if (
      typeof retention.expiresAt === "number" &&
      Number.isFinite(retention.expiresAt) &&
      retention.expiresAt > 0
    ) {
      return { mode: "ttl", expiresAt: retention.expiresAt };
    }

    if (
      typeof retention.ttlMs === "number" &&
      Number.isFinite(retention.ttlMs) &&
      retention.ttlMs > 0
    ) {
      return { mode: "ttl", expiresAt: now + retention.ttlMs };
    }
  }

  return { mode: "persistent" };
}

export function createDocumentMetadata({
  id,
  now,
  owner,
  retention,
}: CreateDocumentMetadataInput): DocumentMetadata {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    owner,
    retention,
  };
}

export function isExpired(retention: DocumentRetention, now: number): boolean {
  return retention.mode === "ttl" && retention.expiresAt <= now;
}
