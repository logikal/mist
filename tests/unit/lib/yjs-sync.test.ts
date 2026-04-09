/**
 * Multi-client Yjs sync tests.
 *
 * These tests simulate two clients connected through a mock server that
 * mimics the DocumentAgent's sync relay logic. Instead of importing the
 * agent (which needs cloudflare: protocol), we implement the minimal
 * relay logic inline.
 *
 * Architecture:
 *   - Each client has a MockSocket. The YjsProvider talks to it normally.
 *   - The MockServer hooks into each socket's `send()` via a callback.
 *   - When a client sends, the server processes the message (applying
 *     sync protocol to its own Y.Doc) and relays to other clients via
 *     `socket.receiveMessage()`.
 *   - This avoids feedback loops because the server only intercepts
 *     outgoing sends, never incoming message events.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS } from "~/shared/constants";
import { YjsProvider } from "~/lib/yjs-provider";

/* ---------- Mock Socket ---------- */

class MockSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockSocket.OPEN;
  binaryType = "blob";
  sent: Uint8Array[] = [];

  /** Server hooks into this to intercept outgoing messages */
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

  /** Simulate receiving a message from the server */
  receiveMessage(data: Uint8Array) {
    const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.dispatchEvent(new MessageEvent("message", { data: copy }));
  }
}

Object.defineProperty(MockSocket.prototype, "OPEN", { value: 1 });
Object.defineProperty(MockSocket.prototype, "CONNECTING", { value: 0 });

/* ---------- Mock Server (minimal DocumentAgent) ---------- */

class MockServer {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  private clients: MockSocket[] = [];

  constructor() {
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
  }

  /**
   * Connect a client socket.
   * Sends SyncStep1+SyncStep2 and hooks into the socket's send callback.
   */
  addClient(socket: MockSocket) {
    this.clients.push(socket);

    // Hook into sends from this client
    socket.onSend = (data: Uint8Array) => {
      this.handleClientMessage(socket, data);
    };

    // Send SyncStep1
    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, MSG_SYNC);
    syncProtocol.writeSyncStep1(step1, this.doc);
    socket.receiveMessage(encoding.toUint8Array(step1));

    // Send SyncStep2 (full state)
    const step2 = encoding.createEncoder();
    encoding.writeVarUint(step2, MSG_SYNC);
    syncProtocol.writeSyncStep2(step2, this.doc);
    socket.receiveMessage(encoding.toUint8Array(step2));

    // Send current awareness states
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const clients = Array.from(states.keys());
      const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients);
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

        // Reply to sender if there's a response (e.g. SyncStep2 reply)
        if (encoding.length(enc) > 1) {
          sender.receiveMessage(encoding.toUint8Array(enc));
        }

        // Relay raw message to other clients
        for (const client of this.clients) {
          if (client !== sender && client.readyState === MockSocket.OPEN) {
            client.receiveMessage(data);
          }
        }
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, sender);

        // Relay to other clients
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

/* ---------- Tests ---------- */

describe("Multi-client Yjs sync", () => {
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
    const provider = new YjsProvider(socket as unknown as WebSocket, doc, awareness);
    server.addClient(socket);
    return { doc, awareness, socket, provider };
  }

  it("syncs initial content from client A to client B", () => {
    const a = createClient();

    // A writes some content
    a.doc.getText("default").insert(0, "hello from A");

    // B connects after A already has content
    const b = createClient();

    expect(b.doc.getText("default").toString()).toBe("hello from A");

    a.provider.destroy();
    b.provider.destroy();
    a.doc.destroy();
    b.doc.destroy();
  });

  it("syncs live edits between two simultaneous clients", () => {
    const a = createClient();
    const b = createClient();

    // A types
    a.doc.getText("default").insert(0, "AAA");

    expect(b.doc.getText("default").toString()).toBe("AAA");

    // B appends
    b.doc.getText("default").insert(3, " BBB");

    expect(a.doc.getText("default").toString()).toBe("AAA BBB");
    expect(b.doc.getText("default").toString()).toBe("AAA BBB");

    a.provider.destroy();
    b.provider.destroy();
    a.doc.destroy();
    b.doc.destroy();
  });

  it("handles concurrent edits (CRDT merge)", () => {
    const a = createClient();
    const b = createClient();

    // Disconnect relay so edits happen concurrently
    const origA = a.socket.onSend;
    const origB = b.socket.onSend;
    a.socket.onSend = undefined;
    b.socket.onSend = undefined;

    a.doc.getText("default").insert(0, "A-text");
    b.doc.getText("default").insert(0, "B-text");

    // Reconnect and sync manually via state exchange
    a.socket.onSend = origA;
    b.socket.onSend = origB;

    const aState = Y.encodeStateAsUpdate(a.doc);
    const bState = Y.encodeStateAsUpdate(b.doc);
    Y.applyUpdate(a.doc, bState);
    Y.applyUpdate(b.doc, aState);

    // Both should converge
    const mergedA = a.doc.getText("default").toString();
    const mergedB = b.doc.getText("default").toString();
    expect(mergedA).toBe(mergedB);
    expect(mergedA).toContain("A-text");
    expect(mergedA).toContain("B-text");

    a.provider.destroy();
    b.provider.destroy();
    a.doc.destroy();
    b.doc.destroy();
  });

  it("propagates awareness state between clients", () => {
    const a = createClient();
    const b = createClient();

    // A sets user info
    a.awareness.setLocalStateField("user", {
      name: "Alice",
      color: "#E57373",
    });

    // B should see A's awareness
    const stateA = b.awareness.getStates().get(a.doc.clientID);
    expect(stateA).toBeDefined();
    expect(stateA?.user).toEqual({ name: "Alice", color: "#E57373" });

    // B sets user info
    b.awareness.setLocalStateField("user", {
      name: "Bob",
      color: "#64B5F6",
    });

    // A should see B's awareness
    const stateB = a.awareness.getStates().get(b.doc.clientID);
    expect(stateB).toBeDefined();
    expect(stateB?.user).toEqual({ name: "Bob", color: "#64B5F6" });

    a.provider.destroy();
    b.provider.destroy();
    a.doc.destroy();
    b.doc.destroy();
  });

  it("persists content on the server doc", () => {
    const a = createClient();

    a.doc.getText("default").insert(0, "persisted content");

    // Server doc should have the content
    expect(server.doc.getText("default").toString()).toBe("persisted content");

    a.provider.destroy();
    a.doc.destroy();
  });

  it("new client receives server state after first client disconnects", () => {
    // Client A writes and disconnects
    const a = createClient();

    a.doc.getText("default").insert(0, "before disconnect");

    a.provider.destroy();
    a.socket.close();
    server.removeClient(a.socket);
    a.doc.destroy();

    // Client B connects later — should get the content from server
    const b = createClient();

    expect(b.doc.getText("default").toString()).toBe("before disconnect");

    b.provider.destroy();
    b.doc.destroy();
  });

  it("handles deletion sync between clients", () => {
    const a = createClient();
    const b = createClient();

    a.doc.getText("default").insert(0, "hello world");

    expect(b.doc.getText("default").toString()).toBe("hello world");

    // Delete "world" from A
    a.doc.getText("default").delete(6, 5);

    expect(b.doc.getText("default").toString()).toBe("hello ");
    expect(a.doc.getText("default").toString()).toBe("hello ");

    a.provider.destroy();
    b.provider.destroy();
    a.doc.destroy();
    b.doc.destroy();
  });

  it("marks provider as synced after initial handshake", () => {
    const a = createClient();

    expect(a.provider.isSynced).toBe(true);

    a.provider.destroy();
    a.doc.destroy();
  });

  it("cleans up awareness when client disconnects", () => {
    const a = createClient();
    const b = createClient();

    a.awareness.setLocalStateField("user", { name: "Alice" });

    // B sees A
    expect(b.awareness.getStates().get(a.doc.clientID)).toBeDefined();

    // A disconnects — provider.destroy removes awareness state
    a.provider.destroy();

    // A's awareness state should be removed from the map
    expect(a.awareness.getStates().has(a.doc.clientID)).toBe(false);

    a.doc.destroy();
    b.provider.destroy();
    b.doc.destroy();
  });

  it("handles rapid sequential edits", () => {
    const a = createClient();
    const b = createClient();

    // Rapid fire edits
    const text = a.doc.getText("default");
    for (let i = 0; i < 50; i++) {
      text.insert(text.length, `${i} `);
    }

    // B should have all the content
    const expected = Array.from({ length: 50 }, (_, i) => `${i} `).join("");
    expect(b.doc.getText("default").toString()).toBe(expected);

    a.provider.destroy();
    b.provider.destroy();
    a.doc.destroy();
    b.doc.destroy();
  });
});
