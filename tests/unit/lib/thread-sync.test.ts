/**
 * Multi-client thread sync tests.
 *
 * Tests that thread data (Y.Map) syncs correctly between
 * multiple clients via the mock server.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS } from "~/shared/constants";
import { YjsProvider } from "~/lib/yjs-provider";
import type { ThreadData } from "~/shared/types";

/* ---------- Mock Socket ---------- */

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
    const copy = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    );
    this.dispatchEvent(new MessageEvent("message", { data: copy }));
  }
}

Object.defineProperty(MockSocket.prototype, "OPEN", { value: 1 });
Object.defineProperty(MockSocket.prototype, "CONNECTING", { value: 0 });

/* ---------- Mock Server ---------- */

class MockServer {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  private clients: MockSocket[] = [];

  constructor() {
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
  }

  addClient(socket: MockSocket) {
    this.clients.push(socket);

    socket.onSend = (data: Uint8Array) => {
      this.handleClientMessage(socket, data);
    };

    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, MSG_SYNC);
    syncProtocol.writeSyncStep1(step1, this.doc);
    socket.receiveMessage(encoding.toUint8Array(step1));

    const step2 = encoding.createEncoder();
    encoding.writeVarUint(step2, MSG_SYNC);
    syncProtocol.writeSyncStep2(step2, this.doc);
    socket.receiveMessage(encoding.toUint8Array(step2));

    const states = this.awareness.getStates();
    if (states.size > 0) {
      const clients = Array.from(states.keys());
      const update = awarenessProtocol.encodeAwarenessUpdate(
        this.awareness,
        clients,
      );
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, update);
      socket.receiveMessage(encoding.toUint8Array(enc));
    }
  }

  private handleClientMessage(sender: MockSocket, data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, enc, this.doc, null);

        if (encoding.length(enc) > 1) {
          sender.receiveMessage(encoding.toUint8Array(enc));
        }

        for (const client of this.clients) {
          if (client !== sender && client.readyState === MockSocket.OPEN) {
            client.receiveMessage(data);
          }
        }
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          update,
          sender,
        );

        for (const client of this.clients) {
          if (client !== sender && client.readyState === MockSocket.OPEN) {
            client.receiveMessage(data);
          }
        }
        break;
      }
    }
  }

  removeClient(socket: MockSocket) {
    socket.onSend = undefined;
    this.clients = this.clients.filter((s) => s !== socket);
  }

  destroy() {
    for (const client of this.clients) {
      client.onSend = undefined;
    }
    this.clients = [];
    this.awareness.destroy();
    this.doc.destroy();
  }
}

/* ---------- Helpers ---------- */

function makeThread(overrides: Partial<ThreadData> = {}): ThreadData {
  return {
    id: "t1",
    commentText: "A comment",
    author: { name: "Jane", color: "#E57373", colorLight: "#FFCDD2" },
    createdAt: Date.now(),
    resolved: false,
    replies: [],
    ...overrides,
  };
}

function getThreadsMap(doc: Y.Doc): Y.Map<string> {
  return doc.getMap<string>("threads");
}

function setThread(doc: Y.Doc, thread: ThreadData) {
  getThreadsMap(doc).set(thread.id, JSON.stringify(thread));
}

function getThread(doc: Y.Doc, id: string): ThreadData | undefined {
  const raw = getThreadsMap(doc).get(id);
  return raw ? JSON.parse(raw) : undefined;
}

function getAllThreads(doc: Y.Doc): ThreadData[] {
  const map = getThreadsMap(doc);
  const threads: ThreadData[] = [];
  map.forEach((val) => {
    threads.push(JSON.parse(val));
  });
  return threads;
}

/* ---------- Tests ---------- */

describe("Thread multi-client sync", () => {
  let server: MockServer;

  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockSocket);
    server = new MockServer();
  });

  afterEach(() => {
    server.destroy();
    vi.unstubAllGlobals();
  });

  function createClient() {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const socket = new MockSocket();
    const provider = new YjsProvider(
      socket as unknown as WebSocket,
      doc,
      awareness,
    );
    server.addClient(socket);
    return { doc, awareness, socket, provider };
  }

  function cleanup(...clients: ReturnType<typeof createClient>[]) {
    for (const c of clients) {
      c.provider.destroy();
      c.doc.destroy();
    }
  }

  it("Client A creates thread → Client B sees it", () => {
    const a = createClient();
    const b = createClient();

    const thread = makeThread({ id: "t1", commentText: "Fix this" });
    setThread(a.doc, thread);

    const bThread = getThread(b.doc, "t1");
    expect(bThread).toBeDefined();
    expect(bThread!.commentText).toBe("Fix this");
    cleanup(a, b);
  });

  it("Client A adds reply → Client B sees updated thread", () => {
    const a = createClient();
    const b = createClient();

    const thread = makeThread({ id: "t1" });
    setThread(a.doc, thread);

    // Client A adds a reply
    const updated = { ...thread, replies: [
      { id: "r1", author: thread.author, text: "Agreed", createdAt: Date.now() },
    ]};
    setThread(a.doc, updated);

    const bThread = getThread(b.doc, "t1");
    expect(bThread!.replies).toHaveLength(1);
    expect(bThread!.replies[0].text).toBe("Agreed");
    cleanup(a, b);
  });

  it("Client A resolves thread → Client B sees resolved state", () => {
    const a = createClient();
    const b = createClient();

    const thread = makeThread({ id: "t1", resolved: false });
    setThread(a.doc, thread);

    setThread(a.doc, { ...thread, resolved: true });

    const bThread = getThread(b.doc, "t1");
    expect(bThread!.resolved).toBe(true);
    cleanup(a, b);
  });

  it("threads survive disconnect/reconnect", () => {
    const a = createClient();
    const thread = makeThread({ id: "t1", commentText: "Persisted" });
    setThread(a.doc, thread);

    // A disconnects
    a.provider.destroy();
    a.socket.close();
    server.removeClient(a.socket);
    a.doc.destroy();

    // B connects later
    const b = createClient();
    const bThread = getThread(b.doc, "t1");
    expect(bThread).toBeDefined();
    expect(bThread!.commentText).toBe("Persisted");
    cleanup(b);
  });

  it("concurrent thread creation from both clients", () => {
    const a = createClient();
    const b = createClient();

    setThread(a.doc, makeThread({ id: "t1", commentText: "From A" }));
    setThread(b.doc, makeThread({ id: "t2", commentText: "From B" }));

    const aThreads = getAllThreads(a.doc);
    const bThreads = getAllThreads(b.doc);
    expect(aThreads).toHaveLength(2);
    expect(bThreads).toHaveLength(2);
    cleanup(a, b);
  });

  it("Client A deletes thread → removed from Client B", () => {
    const a = createClient();
    const b = createClient();

    setThread(a.doc, makeThread({ id: "t1" }));
    expect(getThread(b.doc, "t1")).toBeDefined();

    getThreadsMap(a.doc).delete("t1");
    expect(getThread(b.doc, "t1")).toBeUndefined();
    cleanup(a, b);
  });
});
