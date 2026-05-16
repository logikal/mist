import { Agent } from "agents";
import type { Connection, ConnectionContext, WSMessage } from "agents";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS, DOCUMENT_TTL_MS, DOC_FORMAT_VERSION } from "../app/shared/constants";
import {
  createDocumentMetadata,
  getOwnerFromHeaders,
  isExpired,
  normalizeRetention,
  type DocumentMetadata,
} from "../app/shared/document-metadata";
import {
  MAX_DOCUMENT_VERSIONS,
  VERSION_AUTOSAVE_INTERVAL_MS,
  type DocumentVersionReason,
  type DocumentVersionSummary,
  type DocumentVersionsResponse,
  type RestoreVersionResponse,
} from "../app/shared/document-versions";

/**
 * Durable Objects SQLite accepts Uint8Array for BLOB columns via the
 * template literal API, but the type signature expects string. This
 * helper makes the cast explicit and grep-able.
 */
function sqlBlob(data: Uint8Array): string {
  return data as unknown as string;
}

const jsonEncoder = new TextEncoder();
const jsonDecoder = new TextDecoder();

function jsonBlob(value: unknown): string {
  return sqlBlob(jsonEncoder.encode(JSON.stringify(value)));
}

function parseJsonBlob<T>(value: ArrayBuffer): T {
  return JSON.parse(jsonDecoder.decode(new Uint8Array(value))) as T;
}

class DocumentAgent extends Agent {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  private autosaveSuppressed = false;
  private lastAutosaveAt = 0;

  private get documentId(): string {
    return (this as { name?: string }).name ?? "unknown";
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

  private ensureInitialised(): { doc: Y.Doc; awareness: awarenessProtocol.Awareness } {
    if (this.doc && this.awareness) {
      return { doc: this.doc, awareness: this.awareness };
    }

    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    // Create table if needed
    this.sql`
      CREATE TABLE IF NOT EXISTS doc_state (
        key TEXT PRIMARY KEY,
        value BLOB
      )
    `;

    this.sql`
      CREATE TABLE IF NOT EXISTS doc_versions (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        created_by TEXT,
        reason TEXT NOT NULL,
        state BLOB NOT NULL
      )
    `;

    // Load persisted state
    const rows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = 'state'
    `;

    if (rows.length > 0 && rows[0].value) {
      const state = new Uint8Array(rows[0].value);
      Y.applyUpdate(this.doc, state);
    }

    // Persist on every update
    this.doc.on("update", () => {
      const state = Y.encodeStateAsUpdate(this.doc!);
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('state', ${sqlBlob(state)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
      const now = Date.now();
      this.touchMetadata(now);
      try {
        this.maybeAutosaveSnapshot(now);
      } catch {
        // Version snapshots are best-effort; live collaboration wins.
      }
    });

    return { doc: this.doc, awareness: this.awareness };
  }

  private createVersionSnapshot(
    reason: DocumentVersionReason,
    now: number,
    createdBy: string | null,
  ): DocumentVersionSummary {
    const { doc } = this.ensureInitialised();
    const id = crypto.randomUUID();
    const state = Y.encodeStateAsUpdate(doc);

    this.sql`
      INSERT INTO doc_versions (id, doc_id, created_at, created_by, reason, state)
      VALUES (${id}, ${this.documentId}, ${now}, ${createdBy}, ${reason}, ${sqlBlob(state)})
    `;
    this.pruneVersionSnapshots();

    return {
      id,
      docId: this.documentId,
      createdAt: now,
      createdBy,
      reason,
    };
  }

  private maybeAutosaveSnapshot(now: number): void {
    if (this.autosaveSuppressed) return;
    if (now - this.lastAutosaveAt < VERSION_AUTOSAVE_INTERVAL_MS) return;

    this.createVersionSnapshot("autosave", now, null);
    this.lastAutosaveAt = now;
  }

  private pruneVersionSnapshots(): void {
    this.sql`
      DELETE FROM doc_versions
      WHERE id NOT IN (
        SELECT id FROM doc_versions
        ORDER BY created_at DESC
        LIMIT ${MAX_DOCUMENT_VERSIONS}
      )
    `;
  }

  private listVersionSummaries(): DocumentVersionSummary[] {
    this.ensureInitialised();
    const rows = this.sql<{
      id: string;
      docId: string;
      createdAt: number;
      createdBy: string | null;
      reason: DocumentVersionReason;
    }>`
      SELECT
        id,
        doc_id AS docId,
        created_at AS createdAt,
        created_by AS createdBy,
        reason
      FROM doc_versions
      ORDER BY created_at DESC
    `;

    return rows.map((row) => ({
      id: row.id,
      docId: row.docId,
      createdAt: Number(row.createdAt),
      createdBy: row.createdBy,
      reason: row.reason,
    }));
  }

  private getCreatedByFromHeaders(headers: Headers): string | null {
    const owner = getOwnerFromHeaders(headers);
    return owner.id ?? owner.login ?? owner.name;
  }

  private restoreVersion(versionId: string, request: Request): Response {
    this.ensureInitialised();
    const rows = this.sql<{ state: ArrayBuffer }>`
      SELECT state FROM doc_versions WHERE id = ${versionId}
    `;

    if (rows.length === 0 || !rows[0].state) {
      return new Response("Version not found", { status: 404 });
    }

    const now = Date.now();
    this.createVersionSnapshot("restore", now, this.getCreatedByFromHeaders(request.headers));
    const selectedState = new Uint8Array(rows[0].state);
    this.sql`
      INSERT INTO doc_state (key, value) VALUES ('state', ${sqlBlob(selectedState)})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `;
    this.touchMetadata(now);

    for (const conn of this.getConnections()) {
      conn.close(1012, "Document restored");
    }

    this.awareness?.destroy();
    this.doc?.destroy();
    this.doc = null;
    this.awareness = null;
    this.lastAutosaveAt = 0;

    const body: RestoreVersionResponse = { ok: true, restoredVersionId: versionId };
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private readMetadata(): DocumentMetadata | null {
    const rows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = 'metadata'
    `;
    if (rows.length > 0 && rows[0].value) {
      return parseJsonBlob<DocumentMetadata>(rows[0].value);
    }

    const existsRows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = 'exists'
    `;
    if (existsRows.length === 0) {
      return null;
    }

    const createdAtRows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = 'createdAt'
    `;
    const createdAt =
      createdAtRows.length > 0
        ? new Float64Array(createdAtRows[0].value)[0]
        : Date.now();

    return {
      id: this.documentId,
      createdAt,
      updatedAt: createdAt,
      owner: { id: null, login: null, name: null },
      retention: { mode: "ttl", expiresAt: createdAt + DOCUMENT_TTL_MS },
    };
  }

  private writeMetadata(metadata: DocumentMetadata): void {
    this.sql`
      INSERT INTO doc_state (key, value) VALUES ('metadata', ${jsonBlob(metadata)})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `;
  }

  private touchMetadata(now: number): void {
    const metadata = this.readMetadata();
    if (!metadata) return;
    this.writeMetadata({ ...metadata, updatedAt: now });
  }

  async onConnect(connection: Connection, _ctx: ConnectionContext) {
    const { doc, awareness } = this.ensureInitialised();

    // Send SyncStep1 to the new client
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    connection.send(encoding.toUint8Array(syncEncoder));

    // Send SyncStep2 (full state) to the new client
    const stateEncoder = encoding.createEncoder();
    encoding.writeVarUint(stateEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep2(stateEncoder, doc);
    connection.send(encoding.toUint8Array(stateEncoder));

    // Send current awareness states to the new client
    const awarenessStates = awareness.getStates();
    if (awarenessStates.size > 0) {
      const clients = Array.from(awarenessStates.keys());
      const update = awarenessProtocol.encodeAwarenessUpdate(awareness, clients);
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(awarenessEncoder, update);
      connection.send(encoding.toUint8Array(awarenessEncoder));
    }
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message === "string") {
      // JSON control messages — reserved for future use
      return;
    }

    const { doc, awareness } = this.ensureInitialised();

    const data =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(
            (message as Uint8Array).buffer,
            (message as Uint8Array).byteOffset,
            (message as Uint8Array).byteLength,
          );
    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, null);

        // If there's a response (e.g. SyncStep2 reply), send it back
        if (encoding.length(encoder) > 1) {
          connection.send(encoding.toUint8Array(encoder));
        }

        // Broadcast the raw message to all other clients
        this.broadcastBinary(message, connection.id);
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(awareness, update, connection);

        // Broadcast awareness to all other clients
        this.broadcastBinary(message, connection.id);
        break;
      }
    }
  }

  async onClose(
    connection: Connection,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    if (this.awareness) {
      // Remove this client's awareness state
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        // Agents SDK uses string IDs; awareness protocol expects numbers.
      // The protocol converts via toString() internally, so this is safe.
      [connection.id as unknown as number],
        null,
      );
    }
  }

  override readonly alarm = async (): Promise<void> => {
    const metadata = this.readMetadata();
    if (!metadata || !isExpired(metadata.retention, Date.now())) {
      return;
    }

    this.ensureInitialised();
    this.sql`DELETE FROM doc_versions`;
    this.sql`DELETE FROM doc_state`;
    for (const conn of this.getConnections()) {
      conn.close(1000, "Document expired");
    }
    this.doc?.destroy();
    this.doc = null;
    this.awareness = null;
  };

  async onRequest(request: Request) {
    const pathname = this.getRequestPathname(request);
    const restoreMatch = pathname.match(/^\/versions\/([^/]+)\/restore$/);

    if (request.method === "GET" && pathname === "/versions") {
      const body: DocumentVersionsResponse = {
        versions: this.listVersionSummaries(),
      };
      return new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && restoreMatch) {
      return this.restoreVersion(decodeURIComponent(restoreMatch[1]), request);
    }

    if (request.method === "POST") {
      const { doc } = this.ensureInitialised();
      const contentType = request.headers.get("Content-Type") || "";
      let body: {
        content?: string;
        threads?: unknown[];
        onboarding?: boolean;
        retention?: unknown;
      } | null = null;

      if (contentType.includes("application/json")) {
        try {
          body = await request.json() as {
            content?: string;
            threads?: unknown[];
            onboarding?: boolean;
            retention?: unknown;
          };
        } catch {
          body = null;
        }
      }

      const now = Date.now();
      const existingMetadata = this.readMetadata();
      const metadata =
        existingMetadata ??
        createDocumentMetadata({
          id: this.documentId,
          now,
          owner: getOwnerFromHeaders(request.headers),
          retention: normalizeRetention(body?.retention, now),
        });
      this.writeMetadata(metadata);

      if (metadata.retention.mode === "ttl") {
        await this.ctx.storage.setAlarm(metadata.retention.expiresAt);
      }

      this.autosaveSuppressed = true;
      try {
        // Stamp doc format version in Yjs metadata
        const meta = doc.getMap<number>("meta");
        if (!meta.has("version")) {
          meta.set("version", DOC_FORMAT_VERSION);
        }

        if (body) {
          try {
            if (body.content) {
              // Parse CriticMarkup and apply as marks on XmlText
              const { parseCriticMarkupToContent } = await import("../app/lib/critic-parser");
              const frag = doc.getXmlFragment("default");
              if (frag.length === 0) {
                const lines = body.content.split("\n");
                for (const line of lines) {
                  const { cleanText, marks } = parseCriticMarkupToContent(line);
                  const para = new Y.XmlElement("paragraph");
                  const ytext = new Y.XmlText(cleanText);
                  // Apply marks via Yjs formatting attributes
                  for (const mark of marks) {
                    const attrs: Record<string, Record<string, unknown>> = {};
                    attrs[mark.type] = mark.attrs ?? {};
                    ytext.format(mark.from, mark.to - mark.from, attrs);
                  }
                  para.insert(0, [ytext]);
                  frag.insert(frag.length, [para]);
                }
              }
            }
            if (body.threads && Array.isArray(body.threads)) {
              const threadsMap = doc.getMap<string>("threads");
              for (const thread of body.threads) {
                const t = thread as { id?: string };
                if (t.id) {
                  threadsMap.set(t.id, JSON.stringify(thread));
                }
              }
            }
            if (body.onboarding) {
              const docState = doc.getMap<string>("docState");
              docState.set("onboarding", "true");
            }
          } catch (err) {
            // If it's an unsupported CriticMarkup error, return it
            if (err instanceof Error && err.message.includes("Unsupported CriticMarkup")) {
              return new Response(JSON.stringify({ ok: false, error: err.message }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              });
            }
          }
        }
      } finally {
        this.autosaveSuppressed = false;
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET") {
      this.ensureInitialised();
      const metadata = this.readMetadata();

      return new Response(JSON.stringify({
        exists: metadata !== null,
        createdAt: metadata?.createdAt ?? null,
        metadata,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private broadcastBinary(message: WSMessage, excludeId: string) {
    // Make a clean copy to avoid ArrayBufferView offset issues
    const bytes =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(
            (message as Uint8Array).buffer,
            (message as Uint8Array).byteOffset,
            (message as Uint8Array).byteLength,
          );
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    for (const conn of this.getConnections()) {
      if (conn.id !== excludeId) {
        conn.send(buf);
      }
    }
  }
}

export default DocumentAgent;
