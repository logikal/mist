import { Agent } from "agents";
import {
  getOwnerFromHeaders,
  hasOwnerIdentity,
  ownerMatchesIdentity,
  type DocumentMetadata,
  type DocumentRetention,
} from "../app/shared/document-metadata";
import type {
  DocumentIndexEntry,
  DocumentIndexListResponse,
} from "../app/shared/document-index";

class DocumentIndexAgent extends Agent {
  private ensureInitialised(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS document_index (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        owner_id TEXT,
        owner_login TEXT,
        owner_name TEXT,
        retention TEXT NOT NULL
      )
    `;
  }

  private getRequestPathname(request: Request): string {
    const url = new URL(request.url);
    const namespace = request.headers.get("x-partykit-namespace");
    const room = request.headers.get("x-partykit-room");

    if (!namespace || !room) {
      return url.pathname;
    }

    const routedPrefix = `/agents/${namespace}/${room}`;
    if (url.pathname === routedPrefix) {
      return "/";
    }
    if (url.pathname.startsWith(`${routedPrefix}/`)) {
      return url.pathname.slice(routedPrefix.length);
    }

    return url.pathname;
  }

  private readAllDocuments(): DocumentIndexEntry[] {
    this.ensureInitialised();
    const rows = this.sql<{
      id: string;
      createdAt: number;
      updatedAt: number;
      ownerId: string | null;
      ownerLogin: string | null;
      ownerName: string | null;
      retention: string;
    }>`
      SELECT
        id,
        created_at AS createdAt,
        updated_at AS updatedAt,
        owner_id AS ownerId,
        owner_login AS ownerLogin,
        owner_name AS ownerName,
        retention
      FROM document_index
      ORDER BY updated_at DESC
    `;

    return rows.map((row) => ({
      id: row.id,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      owner: {
        id: row.ownerId,
        login: row.ownerLogin,
        name: row.ownerName,
      },
      retention: JSON.parse(row.retention) as DocumentRetention,
    }));
  }

  private listDocumentsFor(request: Request): Response {
    const owner = getOwnerFromHeaders(request.headers);
    const documents = hasOwnerIdentity(owner)
      ? this.readAllDocuments().filter((document) =>
          ownerMatchesIdentity(document.owner, owner),
        )
      : [];
    const body: DocumentIndexListResponse = { documents };

    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async upsertDocument(request: Request): Promise<Response> {
    this.ensureInitialised();
    const metadata = (await request.json()) as DocumentMetadata;
    if (!metadata.id || !metadata.owner || !metadata.retention) {
      return new Response("Invalid document metadata", { status: 400 });
    }

    this.sql`
      INSERT INTO document_index (
        id,
        created_at,
        updated_at,
        owner_id,
        owner_login,
        owner_name,
        retention
      )
      VALUES (
        ${metadata.id},
        ${metadata.createdAt},
        ${metadata.updatedAt},
        ${metadata.owner.id},
        ${metadata.owner.login},
        ${metadata.owner.name},
        ${JSON.stringify(metadata.retention)}
      )
      ON CONFLICT(id) DO UPDATE SET
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        owner_id = excluded.owner_id,
        owner_login = excluded.owner_login,
        owner_name = excluded.owner_name,
        retention = excluded.retention
    `;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private deleteDocument(documentId: string): Response {
    this.ensureInitialised();
    this.sql`DELETE FROM document_index WHERE id = ${documentId}`;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async onRequest(request: Request) {
    const pathname = this.getRequestPathname(request);
    const documentMatch = pathname.match(/^\/documents\/([^/]+)$/);

    if (request.method === "GET" && pathname === "/documents") {
      return this.listDocumentsFor(request);
    }

    if (request.method === "POST" && pathname === "/documents") {
      return this.upsertDocument(request);
    }

    if (request.method === "DELETE" && documentMatch) {
      return this.deleteDocument(decodeURIComponent(documentMatch[1]));
    }

    return new Response("Not found", { status: 404 });
  }
}

export default DocumentIndexAgent;
