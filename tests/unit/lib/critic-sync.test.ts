/**
 * Multi-client CriticMarkup sync tests.
 *
 * Tests that document mode (Y.Map) and CriticMarkup suggestions
 * sync correctly between multiple clients via the mock server.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS } from "~/shared/constants";
import { YjsProvider } from "~/lib/yjs-provider";
import type { DocMode } from "~/shared/types";

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

/* ---------- Tests ---------- */

describe("CriticMarkup multi-client sync", () => {
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
    const docState = doc.getMap<string>("docState");
    server.addClient(socket);
    return { doc, awareness, socket, provider, docState };
  }

  function cleanup(...clients: ReturnType<typeof createClient>[]) {
    for (const c of clients) {
      c.provider.destroy();
      c.doc.destroy();
    }
  }

  describe("mode sync via Y.Map", () => {
    it("defaults to no mode set on fresh document", () => {
      const a = createClient();
      expect(a.docState.get("mode")).toBeUndefined();
      cleanup(a);
    });

    it("syncs mode from Client A to Client B", () => {
      const a = createClient();
      const b = createClient();

      a.docState.set("mode", "suggest" satisfies DocMode);

      expect(b.docState.get("mode")).toBe("suggest");
      cleanup(a, b);
    });

    it("mode survives disconnect/reconnect", () => {
      const a = createClient();
      a.docState.set("mode", "suggest" satisfies DocMode);

      // A disconnects
      a.provider.destroy();
      a.socket.close();
      server.removeClient(a.socket);
      a.doc.destroy();

      // B connects later — should get the mode from server
      const b = createClient();
      expect(b.docState.get("mode")).toBe("suggest");
      cleanup(b);
    });

    it("toggling mode back to edit syncs", () => {
      const a = createClient();
      const b = createClient();

      a.docState.set("mode", "suggest" satisfies DocMode);
      expect(b.docState.get("mode")).toBe("suggest");

      b.docState.set("mode", "edit" satisfies DocMode);
      expect(a.docState.get("mode")).toBe("edit");
      cleanup(a, b);
    });
  });

  describe("CriticMarkup text sync", () => {
    it("Client A types CriticMarkup → Client B sees it", () => {
      const a = createClient();
      const b = createClient();

      a.doc.getText("default").insert(0, "hello {++world++}");

      expect(b.doc.getText("default").toString()).toBe("hello {++world++}");
      cleanup(a, b);
    });

    it("concurrent suggestions from both clients merge", () => {
      const a = createClient();
      const b = createClient();

      a.doc.getText("default").insert(0, "{++A's suggestion++}");
      b.doc
        .getText("default")
        .insert(b.doc.getText("default").length, " {++B's suggestion++}");

      const textA = a.doc.getText("default").toString();
      const textB = b.doc.getText("default").toString();
      expect(textA).toBe(textB);
      expect(textA).toContain("{++A's suggestion++}");
      expect(textA).toContain("{++B's suggestion++}");
      cleanup(a, b);
    });

    it("suggestions survive disconnect/reconnect", () => {
      const a = createClient();
      a.doc.getText("default").insert(0, "text with {--deletion--}");

      a.provider.destroy();
      a.socket.close();
      server.removeClient(a.socket);
      a.doc.destroy();

      const b = createClient();
      expect(b.doc.getText("default").toString()).toBe(
        "text with {--deletion--}",
      );
      cleanup(b);
    });

    it("accept from one client resolves text for both", () => {
      const a = createClient();
      const b = createClient();

      const text = a.doc.getText("default");
      text.insert(0, "hello {++world++}");

      // Client A accepts: replace "{++world++}" with "world"
      // "{++world++}" is at positions 6..17
      text.delete(6, 11); // delete "{++world++}"
      text.insert(6, "world"); // insert "world"

      expect(a.doc.getText("default").toString()).toBe("hello world");
      expect(b.doc.getText("default").toString()).toBe("hello world");
      cleanup(a, b);
    });
  });
});
