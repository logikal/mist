import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS } from "~/shared/constants";
import { YjsProvider } from "~/lib/yjs-provider";

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  binaryType = "blob";
  sent: Uint8Array[] = [];

  send(data: Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  // Simulate receiving a binary message
  receiveMessage(data: Uint8Array) {
    const event = new MessageEvent("message", {
      data: data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ),
    });
    this.dispatchEvent(event);
  }
}

// Make MockWebSocket satisfy the readyState constant checks
Object.defineProperty(MockWebSocket.prototype, "OPEN", { value: 1 });
Object.defineProperty(MockWebSocket.prototype, "CONNECTING", { value: 0 });

describe("YjsProvider", () => {
  let doc: Y.Doc;
  let awareness: awarenessProtocol.Awareness;
  let ws: MockWebSocket;
  let provider: YjsProvider;

  beforeEach(() => {
    // Override global WebSocket constants for provider checks
    vi.stubGlobal("WebSocket", MockWebSocket);

    doc = new Y.Doc();
    awareness = new awarenessProtocol.Awareness(doc);
    ws = new MockWebSocket();
  });

  afterEach(() => {
    provider?.destroy();
    doc.destroy();
    vi.unstubAllGlobals();
  });

  it("sets binaryType to arraybuffer on construction", () => {
    provider = new YjsProvider(ws as unknown as WebSocket, doc, awareness);
    expect(ws.binaryType).toBe("arraybuffer");
  });

  it("sends SyncStep1 on construction when socket is open", () => {
    provider = new YjsProvider(ws as unknown as WebSocket, doc, awareness);
    // Should have sent at least one message (SyncStep1) and possibly awareness
    expect(ws.sent.length).toBeGreaterThanOrEqual(1);

    // First message should be a sync message
    const decoder = decoding.createDecoder(ws.sent[0]);
    const msgType = decoding.readVarUint(decoder);
    expect(msgType).toBe(MSG_SYNC);
  });

  it("sends SyncStep1 on open event when socket is connecting", () => {
    ws.readyState = MockWebSocket.CONNECTING;
    provider = new YjsProvider(ws as unknown as WebSocket, doc, awareness);
    expect(ws.sent.length).toBe(0);

    ws.readyState = MockWebSocket.OPEN;
    ws.dispatchEvent(new Event("open"));
    expect(ws.sent.length).toBeGreaterThanOrEqual(1);
  });

  it("sends doc updates over the socket", () => {
    provider = new YjsProvider(ws as unknown as WebSocket, doc, awareness);
    const initialSent = ws.sent.length;

    // Make a change to the doc
    const text = doc.getText("content");
    text.insert(0, "hello");

    expect(ws.sent.length).toBeGreaterThan(initialSent);
  });

  it("does not send when socket is closed", () => {
    provider = new YjsProvider(ws as unknown as WebSocket, doc, awareness);
    const initialSent = ws.sent.length;

    ws.readyState = MockWebSocket.CLOSED;
    const text = doc.getText("content");
    text.insert(0, "hello");

    expect(ws.sent.length).toBe(initialSent);
  });

  it("applies incoming sync messages to the doc", () => {
    provider = new YjsProvider(ws as unknown as WebSocket, doc, awareness);

    // Create a remote doc with content
    const remoteDoc = new Y.Doc();
    const remoteText = remoteDoc.getText("content");
    remoteText.insert(0, "remote text");

    // Encode SyncStep1 from remote
    const step1Encoder = encoding.createEncoder();
    encoding.writeVarUint(step1Encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(step1Encoder, remoteDoc);
    ws.receiveMessage(encoding.toUint8Array(step1Encoder));

    // Encode SyncStep2 from remote (full state)
    const step2Encoder = encoding.createEncoder();
    encoding.writeVarUint(step2Encoder, MSG_SYNC);
    syncProtocol.writeSyncStep2(step2Encoder, remoteDoc);
    ws.receiveMessage(encoding.toUint8Array(step2Encoder));

    expect(doc.getText("content").toString()).toBe("remote text");
    remoteDoc.destroy();
  });

  it("applies incoming awareness updates", () => {
    provider = new YjsProvider(ws as unknown as WebSocket, doc, awareness);

    const remoteDoc = new Y.Doc();
    const remoteAwareness = new awarenessProtocol.Awareness(remoteDoc);
    remoteAwareness.setLocalState({ name: "Remote User" });

    const update = awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [
      remoteDoc.clientID,
    ]);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    ws.receiveMessage(encoding.toUint8Array(encoder));

    const states = awareness.getStates();
    expect(states.get(remoteDoc.clientID)).toEqual({ name: "Remote User" });

    remoteAwareness.destroy();
    remoteDoc.destroy();
  });

  it("sets synced flag after receiving SyncStep2", () => {
    provider = new YjsProvider(ws as unknown as WebSocket, doc, awareness);
    expect(provider.isSynced).toBe(false);

    // Send SyncStep2 (empty doc state)
    const remoteDoc = new Y.Doc();
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep2(encoder, remoteDoc);
    ws.receiveMessage(encoding.toUint8Array(encoder));

    expect(provider.isSynced).toBe(true);
    remoteDoc.destroy();
  });

  it("resets synced on close", () => {
    provider = new YjsProvider(ws as unknown as WebSocket, doc, awareness);

    // Manually set synced
    const remoteDoc = new Y.Doc();
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep2(encoder, remoteDoc);
    ws.receiveMessage(encoding.toUint8Array(encoder));
    expect(provider.isSynced).toBe(true);

    ws.close();
    expect(provider.isSynced).toBe(false);
    remoteDoc.destroy();
  });

  it("sends local awareness changes to the server", () => {
    provider = new YjsProvider(ws as unknown as WebSocket, doc, awareness);
    const initialSent = ws.sent.length;

    // Setting local awareness state should trigger a send
    awareness.setLocalStateField("user", { name: "Test User", color: "#ff0000" });

    expect(ws.sent.length).toBeGreaterThan(initialSent);

    // Last message should be an awareness message
    const last = ws.sent[ws.sent.length - 1];
    const decoder = decoding.createDecoder(last);
    const msgType = decoding.readVarUint(decoder);
    expect(msgType).toBe(MSG_AWARENESS);
  });

  it("cleans up listeners on destroy", () => {
    provider = new YjsProvider(ws as unknown as WebSocket, doc, awareness);
    provider.destroy();

    const initialSent = ws.sent.length;
    const text = doc.getText("content");
    text.insert(0, "after destroy");

    // Should not have sent anything after destroy
    expect(ws.sent.length).toBe(initialSent);
  });
});
