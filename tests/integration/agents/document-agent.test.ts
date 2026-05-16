/**
 * DocumentAgent integration tests.
 *
 * Tests the actual DocumentAgent code with a mocked Agent base class.
 * The agents SDK uses cloudflare: protocol imports, so we mock the base
 * class and test lifecycle methods (onConnect, onMessage, onClose,
 * onRequest, alarm) directly.
 *
 * For Yjs sync tests, real Y.Doc clients exchange messages through the
 * actual agent code — testing the sync relay, SQL persistence, and
 * awareness propagation end-to-end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { DOCUMENT_TTL_MS, DOC_FORMAT_VERSION } from "~/shared/constants";
import type { DocumentMetadata } from "~/shared/document-metadata";
import {
  MAX_DOCUMENT_VERSIONS,
  VERSION_AUTOSAVE_INTERVAL_MS,
} from "~/shared/document-versions";
import { YjsProvider } from "~/lib/yjs-provider";

type TestDocumentVersionsResponse = {
  versions: Array<{
    id: string;
    docId: string;
    createdAt: number;
    createdBy: string | null;
    reason: "autosave" | "manual" | "restore";
  }>;
};

/* ------------------------------------------------------------------ */
/*  Mock Agent base class                                              */
/* ------------------------------------------------------------------ */

let mockSqlStore: Map<string, ArrayBuffer>;
let mockVersionRows: Array<{
  id: string;
  docId: string;
  createdAt: number;
  createdBy: string | null;
  reason: "autosave" | "manual" | "restore";
  state: ArrayBuffer;
}>;
let mockConnectionMap: Map<string, MockConnection>;
let mockSetAlarm: ReturnType<typeof vi.fn>;
let mockFailVersionInserts: boolean;

vi.mock("agents", () => ({
  Agent: class MockAgent {
    name = "test-doc";
    env = {};
    ctx = {
      storage: {
        get setAlarm() {
          return mockSetAlarm;
        },
      },
    };

    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("$").toLowerCase().trim();

      if (query.includes("create table")) return [];

      if (query.includes("delete from doc_versions")) {
        const limit = Number(values[0]);
        if (Number.isFinite(limit) && limit > 0) {
          mockVersionRows.splice(limit);
        } else {
          mockVersionRows = [];
        }
        return [];
      }

      if (query.includes("delete from doc_state")) {
        mockSqlStore.clear();
        return [];
      }

      if (query.includes("select") && query.includes("from doc_versions")) {
        if (query.includes("state") && query.includes("where id")) {
          const id = String(values[0]);
          const version = mockVersionRows.find((row) => row.id === id);
          return version ? [{ state: version.state }] : [];
        }

        return [...mockVersionRows]
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(({ id, docId, createdAt, createdBy, reason }) => ({
            id,
            docId,
            createdAt,
            createdBy,
            reason,
          }));
      }

      if (query.includes("insert into doc_versions")) {
        if (mockFailVersionInserts) {
          throw new Error("version storage unavailable");
        }
        const [id, docId, createdAt, createdBy, reason, state] = values;
        if (state instanceof Uint8Array) {
          mockVersionRows.push({
            id: String(id),
            docId: String(docId),
            createdAt: Number(createdAt),
            createdBy: createdBy === null ? null : String(createdBy),
            reason: reason as "autosave" | "manual" | "restore",
            state: state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength),
          });
        }
        return [];
      }

      if (query.includes("select") && query.includes("from doc_state")) {
        const match = query.match(/key\s*=\s*'(\w+)'/);
        if (match) {
          const buf = mockSqlStore.get(match[1]);
          if (buf) return [{ value: buf }];
        }
        return [];
      }

      if (query.includes("insert into doc_state")) {
        const match = query.match(/values\s*\(\s*'(\w+)'/i);
        if (match) {
          const val = values[0];
          if (val instanceof Uint8Array) {
            mockSqlStore.set(
              match[1],
              val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength),
            );
          }
        }
        return [];
      }

      return [];
    }

    getConnections() {
      return mockConnectionMap.values();
    }
  },
}));

/* ------------------------------------------------------------------ */
/*  Mock Connection (server-side WebSocket handle)                     */
/* ------------------------------------------------------------------ */

class MockConnection {
  id: string;
  closed = false;
  closeCode?: number;
  closeReason?: string;
  onSend?: (data: Uint8Array) => void;

  constructor(id: string) {
    this.id = id;
  }

  send(data: ArrayBuffer | Uint8Array) {
    const bytes =
      data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
    this.onSend?.(bytes);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }
}

/* ------------------------------------------------------------------ */
/*  Mock Socket (client-side WebSocket)                                */
/* ------------------------------------------------------------------ */

class MockSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockSocket.OPEN;
  binaryType = "blob";
  sent: Uint8Array[] = [];
  onSend?: (data: Uint8Array) => void;

  send(data: Uint8Array | ArrayBuffer) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    this.sent.push(bytes);
    this.onSend?.(bytes);
  }

  close() {
    this.readyState = MockSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  receiveMessage(data: Uint8Array) {
    const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.dispatchEvent(new MessageEvent("message", { data: copy }));
  }
}

Object.defineProperty(MockSocket.prototype, "OPEN", { value: 1 });
Object.defineProperty(MockSocket.prototype, "CONNECTING", { value: 0 });

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("DocumentAgent", () => {
  let DocumentAgent: typeof import("../../../agents/document").default;
  let agent: InstanceType<typeof DocumentAgent>;
  let nextConnId: number;

  beforeEach(async () => {
    vi.stubGlobal("WebSocket", MockSocket);
    mockSqlStore = new Map();
    mockVersionRows = [];
    mockConnectionMap = new Map();
    mockSetAlarm = vi.fn();
    mockFailVersionInserts = false;
    nextConnId = 1;

    const mod = await import("../../../agents/document");
    DocumentAgent = mod.default;
    agent = new DocumentAgent({} as never, {} as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* ---- Helpers ---- */

  /** Create a bare MockConnection registered in the connection map. */
  function createConnection(): MockConnection {
    const conn = new MockConnection(`conn-${nextConnId++}`);
    mockConnectionMap.set(conn.id, conn);
    return conn;
  }

  /**
   * Connect a full Yjs client through the agent.
   *
   * Wiring:
   *   agent sends → connection.send → socket.receiveMessage → YjsProvider
   *   YjsProvider sends → socket.send → agent.onMessage
   */
  function connectYjsClient(targetAgent = agent) {
    const connId = `conn-${nextConnId++}`;
    const socket = new MockSocket();
    const connection = new MockConnection(connId);

    // Wire agent → client
    connection.onSend = (data) => socket.receiveMessage(data);

    // Create provider (attaches message listener to socket)
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const provider = new YjsProvider(
      socket as unknown as WebSocket,
      doc,
      awareness,
    );

    // Wire client → agent
    socket.onSend = (data) => {
      const buf = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      );
      targetAgent.onMessage(connection as never, buf);
    };

    // Register connection so getConnections() includes it
    mockConnectionMap.set(connId, connection);

    // Trigger sync handshake
    targetAgent.onConnect(connection as never, {} as never);

    return { doc, awareness, socket, connection, provider, connId };
  }

  function cleanup(...clients: Array<{ provider: YjsProvider; doc: Y.Doc }>) {
    for (const c of clients) {
      c.provider.destroy();
      c.doc.destroy();
    }
  }

  /* ================================================================ */
  /*  HTTP GET                                                         */
  /* ================================================================ */

  describe("GET /", () => {
    it("returns exists: false for a fresh agent", async () => {
      const res = await agent.onRequest(new Request("https://do/"));
      const body = await res.json();
      expect(body).toEqual({ exists: false, createdAt: null, metadata: null });
    });

    it("returns persistent metadata after POST", async () => {
      const before = Date.now();
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const after = Date.now();

      const res = await agent.onRequest(new Request("https://do/"));
      const body = (await res.json()) as {
        exists: boolean;
        createdAt: number;
        metadata: DocumentMetadata;
      };
      expect(body.exists).toBe(true);
      expect(body.createdAt).toBeGreaterThanOrEqual(before);
      expect(body.createdAt).toBeLessThanOrEqual(after);
      expect(body.metadata).toMatchObject({
        id: "test-doc",
        owner: { id: null, login: null, name: null },
        retention: { mode: "persistent" },
      });
      expect(body.metadata.createdAt).toBe(body.createdAt);
      expect(body.metadata.updatedAt).toBeGreaterThanOrEqual(body.metadata.createdAt);
    });

    it("derives ttl metadata for legacy documents with exists and createdAt keys", async () => {
      const createdAt = Date.now() - 1_000;
      mockSqlStore.set("exists", new Uint8Array([1]).buffer);
      mockSqlStore.set(
        "createdat",
        new Uint8Array(new Float64Array([createdAt]).buffer).buffer,
      );

      const res = await agent.onRequest(new Request("https://do/"));
      const body = (await res.json()) as {
        exists: boolean;
        metadata: DocumentMetadata;
      };

      expect(body.exists).toBe(true);
      expect(body.metadata).toEqual({
        id: "test-doc",
        createdAt,
        updatedAt: createdAt,
        owner: { id: null, login: null, name: null },
        retention: { mode: "ttl", expiresAt: createdAt + DOCUMENT_TTL_MS },
      });
    });
  });

  /* ================================================================ */
  /*  HTTP POST                                                        */
  /* ================================================================ */

  describe("POST /", () => {
    it("returns { ok: true }", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", { method: "POST" }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("stamps DOC_FORMAT_VERSION in Yjs meta map", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      const client = connectYjsClient();
      expect(client.doc.getMap<number>("meta").get("version")).toBe(
        DOC_FORMAT_VERSION,
      );
      cleanup(client);
    });

    it("does not set an auto-delete alarm for persistent documents", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      expect(mockSetAlarm).not.toHaveBeenCalled();
    });

    it("sets an auto-delete alarm for ttl documents", async () => {
      const before = Date.now();
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retention: { mode: "ttl", ttlMs: DOCUMENT_TTL_MS } }),
        }),
      );
      const after = Date.now();

      expect(mockSetAlarm).toHaveBeenCalledOnce();
      const alarmTime = mockSetAlarm.mock.calls[0][0] as number;
      expect(alarmTime).toBeGreaterThanOrEqual(before + DOCUMENT_TTL_MS);
      expect(alarmTime).toBeLessThanOrEqual(after + DOCUMENT_TTL_MS);
    });

    it("captures owner metadata from forwarded identity headers", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: {
            "x-mist-user-id": "u-123",
            "x-mist-user-login": "sean@example.com",
            "x-mist-user-name": "Sean",
          },
        }),
      );

      const res = await agent.onRequest(new Request("https://do/"));
      const body = (await res.json()) as { metadata: DocumentMetadata };

      expect(body.metadata.owner).toEqual({
        id: "u-123",
        login: "sean@example.com",
        name: "Sean",
      });
    });

    it("imports plain text content", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello world" }),
        }),
      );

      const client = connectYjsClient();
      const frag = client.doc.getXmlFragment("default");
      expect(frag.length).toBe(1);
      const para = frag.get(0) as Y.XmlElement;
      expect((para.get(0) as Y.XmlText).toString()).toBe("hello world");
      cleanup(client);
    });

    it("imports content with CriticMarkup marks", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello {++world++}" }),
        }),
      );

      const client = connectYjsClient();
      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      // XmlText.toString() includes formatting as XML tags, so check delta
      expect(ytext.toDelta()).toEqual([
        { insert: "hello " },
        { insert: "world", attributes: { criticAddition: {} } },
      ]);
      cleanup(client);
    });

    it("imports multiline content as separate paragraphs", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "line one\nline two\nline three" }),
        }),
      );

      const client = connectYjsClient();
      expect(client.doc.getXmlFragment("default").length).toBe(3);
      cleanup(client);
    });

    it("imports threads into Y.Map", async () => {
      const thread = { id: "t-1", commentText: "good point", replies: [] };
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "text", threads: [thread] }),
        }),
      );

      const client = connectYjsClient();
      const stored = JSON.parse(
        client.doc.getMap<string>("threads").get("t-1")!,
      );
      expect(stored.commentText).toBe("good point");
      cleanup(client);
    });

    it("returns 400 for unsupported CriticMarkup (substitution)", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello {~~old~>new~~}" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain("Unsupported CriticMarkup");
    });

    it("still creates doc even with malformed JSON body", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Document should still exist
      const getRes = await agent.onRequest(new Request("https://do/"));
      const body = (await getRes.json()) as { exists: boolean };
      expect(body.exists).toBe(true);
    });
  });

  /* ================================================================ */
  /*  Versions                                                        */
  /* ================================================================ */

  describe("versions", () => {
    it("returns an empty version list before edits", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      const res = await agent.onRequest(new Request("https://do/versions"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ versions: [] });
    });

    it("creates one autosave version after a live edit", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const client = connectYjsClient();

      client.doc.getText("default").insert(0, "first draft");

      const res = await agent.onRequest(new Request("https://do/versions"));
      const body = (await res.json()) as TestDocumentVersionsResponse;
      expect(body.versions).toHaveLength(1);
      expect(body.versions[0]).toMatchObject({
        docId: "test-doc",
        createdBy: null,
        reason: "autosave",
      });
      cleanup(client);
    });

    it("throttles autosave versions within the interval", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        await agent.onRequest(new Request("https://do/", { method: "POST" }));
        const client = connectYjsClient();

        client.doc.getText("default").insert(0, "a");
        client.doc.getText("default").insert(1, "b");

        const res = await agent.onRequest(new Request("https://do/versions"));
        const body = (await res.json()) as TestDocumentVersionsResponse;
        expect(body.versions).toHaveLength(1);
        cleanup(client);
      } finally {
        vi.useRealTimers();
      }
    });

    it("restores a saved version and records a restore audit snapshot", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        await agent.onRequest(new Request("https://do/", { method: "POST" }));
        const client = connectYjsClient();
        const text = client.doc.getText("default");
        text.insert(0, "first");
        const versionRes = await agent.onRequest(new Request("https://do/versions"));
        const version = ((await versionRes.json()) as TestDocumentVersionsResponse)
          .versions[0];

        vi.setSystemTime(1_061_000);
        text.insert(5, " second");

        const restoreRes = await agent.onRequest(
          new Request(`https://do/versions/${version.id}/restore`, { method: "POST" }),
        );

        expect(restoreRes.status).toBe(200);
        expect(await restoreRes.json()).toEqual({
          ok: true,
          restoredVersionId: version.id,
        });
        expect(client.connection.closed).toBe(true);
        expect(client.connection.closeCode).toBe(1012);
        expect(client.connection.closeReason).toBe("Document restored");

        const versionsRes = await agent.onRequest(new Request("https://do/versions"));
        const versions = ((await versionsRes.json()) as TestDocumentVersionsResponse)
          .versions;
        expect(versions.some((v) => v.reason === "restore")).toBe(true);

        cleanup(client);
        mockConnectionMap.clear();
        const restoredAgent = new DocumentAgent({} as never, {} as never);
        const restoredClient = connectYjsClient(restoredAgent);
        expect(restoredClient.doc.getText("default").toString()).toBe("first");
        cleanup(restoredClient);
      } finally {
        vi.useRealTimers();
      }
    });

    it("continues live collaboration when autosave snapshot storage fails", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const a = connectYjsClient();
      const b = connectYjsClient();
      mockFailVersionInserts = true;

      a.doc.getText("default").insert(0, "still live");

      expect(b.doc.getText("default").toString()).toBe("still live");
      const res = await agent.onRequest(new Request("https://do/versions"));
      const body = (await res.json()) as TestDocumentVersionsResponse;
      expect(body.versions).toEqual([]);
      cleanup(a, b);
    });

    it("prunes autosave versions to the configured maximum", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      try {
        await agent.onRequest(new Request("https://do/", { method: "POST" }));
        const client = connectYjsClient();
        const text = client.doc.getText("default");

        for (let i = 0; i < MAX_DOCUMENT_VERSIONS + 1; i++) {
          vi.setSystemTime(1_000_000 + i * (VERSION_AUTOSAVE_INTERVAL_MS + 1));
          text.insert(text.length, `${i} `);
        }

        const res = await agent.onRequest(new Request("https://do/versions"));
        const body = (await res.json()) as TestDocumentVersionsResponse;
        expect(body.versions).toHaveLength(MAX_DOCUMENT_VERSIONS);
        cleanup(client);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  /* ================================================================ */
  /*  Unsupported HTTP methods                                         */
  /* ================================================================ */

  describe("unsupported methods", () => {
    it("returns 404 for PUT", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", { method: "PUT" }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ================================================================ */
  /*  Alarm (auto-delete)                                              */
  /* ================================================================ */

  describe("alarm", () => {
    it("does not clear persistent document data", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      expect(mockSqlStore.size).toBeGreaterThan(0);

      await agent.alarm();

      expect(mockSqlStore.size).toBeGreaterThan(0);
    });

    it("clears expired ttl document data", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retention: { mode: "ttl", expiresAt: Date.now() - 1 } }),
        }),
      );
      expect(mockSqlStore.size).toBeGreaterThan(0);

      await agent.alarm();

      expect(mockSqlStore.size).toBe(0);
    });

    it("clears expired ttl document versions", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retention: { mode: "ttl", expiresAt: Date.now() - 1 } }),
        }),
      );
      const client = connectYjsClient();
      client.doc.getText("default").insert(0, "temporary draft");
      cleanup(client);
      const versionsBefore = (await agent.onRequest(new Request("https://do/versions")));
      expect(((await versionsBefore.json()) as TestDocumentVersionsResponse).versions)
        .toHaveLength(1);

      await agent.alarm();

      const versionsAfter = await agent.onRequest(new Request("https://do/versions"));
      expect(((await versionsAfter.json()) as TestDocumentVersionsResponse).versions)
        .toEqual([]);
    });

    it("keeps unexpired ttl document data", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retention: { mode: "ttl", expiresAt: Date.now() + 60_000 } }),
        }),
      );
      expect(mockSqlStore.size).toBeGreaterThan(0);

      await agent.alarm();

      expect(mockSqlStore.size).toBeGreaterThan(0);
    });

    it("closes active connections when an expired ttl document is deleted", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retention: { mode: "ttl", expiresAt: Date.now() - 1 } }),
        }),
      );
      const conn1 = createConnection();
      const conn2 = createConnection();

      await agent.alarm();

      expect(conn1.closed).toBe(true);
      expect(conn1.closeCode).toBe(1000);
      expect(conn1.closeReason).toBe("Document expired");
      expect(conn2.closed).toBe(true);
    });

    it("resets expired ttl documents to fresh state", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retention: { mode: "ttl", expiresAt: Date.now() - 1 } }),
        }),
      );
      const client = connectYjsClient();
      cleanup(client);

      await agent.alarm();

      const res = await agent.onRequest(new Request("https://do/"));
      const body = (await res.json()) as {
        exists: boolean;
        metadata: DocumentMetadata | null;
      };
      expect(body.exists).toBe(false);
      expect(body.metadata).toBeNull();
    });
  });

  /* ================================================================ */
  /*  Yjs sync through the agent                                       */
  /* ================================================================ */

  describe("Yjs sync", () => {
    it("syncs content from client A to client B", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "hello from A");

      const b = connectYjsClient();
      expect(b.doc.getText("default").toString()).toBe("hello from A");
      cleanup(a, b);
    });

    it("syncs live edits bidirectionally", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.doc.getText("default").insert(0, "AAA");
      expect(b.doc.getText("default").toString()).toBe("AAA");

      b.doc.getText("default").insert(3, " BBB");
      expect(a.doc.getText("default").toString()).toBe("AAA BBB");
      cleanup(a, b);
    });

    it("persists state in SQL and restores on new agent instance", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "persisted data");
      cleanup(a);
      mockConnectionMap.clear();

      // Simulate DO restart: new agent instance, same SQL store
      const agent2 = new DocumentAgent({} as never, {} as never);
      const b = connectYjsClient(agent2);
      expect(b.doc.getText("default").toString()).toBe("persisted data");
      cleanup(b);
    });

    it("propagates awareness state between clients", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.awareness.setLocalStateField("user", {
        name: "Alice",
        color: "#E57373",
      });

      const stateA = b.awareness.getStates().get(a.doc.clientID);
      expect(stateA?.user).toEqual({ name: "Alice", color: "#E57373" });
      cleanup(a, b);
    });

    it("new client receives content after first client disconnects", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "before disconnect");
      a.provider.destroy();
      a.socket.close();
      mockConnectionMap.delete(a.connId);
      a.doc.destroy();

      const b = connectYjsClient();
      expect(b.doc.getText("default").toString()).toBe("before disconnect");
      cleanup(b);
    });

    it("handles rapid sequential edits", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      const text = a.doc.getText("default");
      for (let i = 0; i < 50; i++) {
        text.insert(text.length, `${i} `);
      }

      const expected = Array.from({ length: 50 }, (_, i) => `${i} `).join("");
      expect(b.doc.getText("default").toString()).toBe(expected);
      cleanup(a, b);
    });

    it("handles deletions synced between clients", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.doc.getText("default").insert(0, "hello world");
      expect(b.doc.getText("default").toString()).toBe("hello world");

      a.doc.getText("default").delete(6, 5);
      expect(b.doc.getText("default").toString()).toBe("hello ");
      cleanup(a, b);
    });
  });

  /* ================================================================ */
  /*  onMessage edge cases                                             */
  /* ================================================================ */

  describe("onMessage", () => {
    it("ignores string messages gracefully", async () => {
      const conn = createConnection();
      await agent.onConnect(conn as never, {} as never);
      // Should not throw
      await agent.onMessage(conn as never, "some string message");
    });
  });

  /* ================================================================ */
  /*  onClose                                                          */
  /* ================================================================ */

  describe("onClose", () => {
    it("does not throw when awareness is not initialised", async () => {
      const conn = createConnection();
      // Agent has never been initialised — awareness is null
      await agent.onClose(conn as never, 1000, "normal", true);
    });

    it("does not throw after agent is initialised", async () => {
      const conn = createConnection();
      await agent.onConnect(conn as never, {} as never);
      await agent.onClose(conn as never, 1000, "normal", true);
    });
  });
});
