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

  private get documentId(): string {
    return (this as { name?: string }).name ?? "unknown";
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
      this.touchMetadata(Date.now());
    });

    return { doc: this.doc, awareness: this.awareness };
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

    this.sql`DELETE FROM doc_state`;
    for (const conn of this.getConnections()) {
      conn.close(1000, "Document expired");
    }
    this.doc?.destroy();
    this.doc = null;
    this.awareness = null;
  };

  async onRequest(request: Request) {
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
