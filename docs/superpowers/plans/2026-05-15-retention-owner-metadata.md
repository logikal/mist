# Retention And Owner Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new MIST documents persistent by default, preserve optional TTL expiry, and capture owner metadata from gateway-forwarded Tailscale identity headers.

**Architecture:** Add shared metadata helpers in `app/shared/`, then teach `DocumentAgent` to store a serialized metadata record beside the live Yjs state. React Router creation paths forward normalized identity headers, and the document page only displays expiry copy for TTL documents.

**Tech Stack:** TypeScript, React Router 7, Cloudflare Agents SDK, Durable Objects SQLite storage, Yjs, Vitest.

---

## File Structure

- Create `app/shared/document-metadata.ts`
  - Defines `DocumentOwner`, `DocumentRetention`, and `DocumentMetadata`.
  - Normalizes trusted `x-mist-*` headers into owner metadata.
  - Normalizes creation retention input into `persistent` or `ttl`.
  - Exposes helpers for expiry checks and identity header forwarding.
- Create `tests/unit/shared/document-metadata.test.ts`
  - Unit tests for owner parsing, retention defaults, TTL normalization, expiry checks, and identity forwarding.
- Modify `agents/document.ts`
  - Store metadata as JSON encoded into the existing `doc_state` SQLite key/value table.
  - Default new docs to persistent.
  - Schedule alarms only for TTL docs.
  - Derive metadata for legacy docs that still only have `exists` and `createdAt`.
  - Ignore alarms for persistent or unexpired docs.
- Modify `tests/integration/agents/document-agent.test.ts`
  - Update expectations from `createdAt` only to metadata-aware responses.
  - Add persistent default, TTL alarm, owner capture, legacy metadata, and guarded alarm tests.
- Modify `app/routes/new.ts`
  - Forward normalized `x-mist-*` identity headers from the incoming `/new` request to the internal Durable Object create request.
- Modify `tests/unit/routes/new.test.ts`
  - Verify identity headers are forwarded for both content and blank document creation.
- Modify `app/routes/docs.$id.tsx`
  - Consume metadata from the agent response.
  - Show expiry text only for TTL documents.
  - Keep persistent documents free of auto-delete copy.
- Create `tests/unit/routes/docs-id.test.tsx`
  - Unit test loader metadata handling and the exported expiry formatter.

---

### Task 1: Shared Metadata Helpers

**Files:**
- Create: `app/shared/document-metadata.ts`
- Create: `tests/unit/shared/document-metadata.test.ts`

- [ ] **Step 1: Write failing tests for shared metadata helpers**

Create `tests/unit/shared/document-metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createDocumentMetadata,
  forwardMistIdentityHeaders,
  getOwnerFromHeaders,
  isExpired,
  normalizeRetention,
} from "~/shared/document-metadata";

describe("document metadata helpers", () => {
  it("returns null owner fields when identity headers are missing", () => {
    expect(getOwnerFromHeaders(new Headers())).toEqual({
      id: null,
      login: null,
      name: null,
    });
  });

  it("extracts owner identity from normalized gateway headers", () => {
    const headers = new Headers({
      "x-mist-user-id": "u-123",
      "x-mist-user-login": "sean@example.com",
      "x-mist-user-name": "Sean",
    });

    expect(getOwnerFromHeaders(headers)).toEqual({
      id: "u-123",
      login: "sean@example.com",
      name: "Sean",
    });
  });

  it("trims empty identity header values to null", () => {
    const headers = new Headers({
      "x-mist-user-id": " ",
      "x-mist-user-login": "\t",
      "x-mist-user-name": "  Sean  ",
    });

    expect(getOwnerFromHeaders(headers)).toEqual({
      id: null,
      login: null,
      name: "Sean",
    });
  });

  it("defaults missing retention input to persistent", () => {
    expect(normalizeRetention(undefined, 1_000)).toEqual({ mode: "persistent" });
  });

  it("accepts explicit persistent retention", () => {
    expect(normalizeRetention({ mode: "persistent" }, 1_000)).toEqual({
      mode: "persistent",
    });
  });

  it("normalizes ttl retention from expiresAt", () => {
    expect(normalizeRetention({ mode: "ttl", expiresAt: 5_000 }, 1_000)).toEqual({
      mode: "ttl",
      expiresAt: 5_000,
    });
  });

  it("normalizes ttl retention from ttlMs", () => {
    expect(normalizeRetention({ mode: "ttl", ttlMs: 4_000 }, 1_000)).toEqual({
      mode: "ttl",
      expiresAt: 5_000,
    });
  });

  it("accepts ttl retention that is already expired", () => {
    expect(normalizeRetention({ mode: "ttl", expiresAt: 500 }, 1_000)).toEqual({
      mode: "ttl",
      expiresAt: 500,
    });
  });

  it("falls back to persistent for invalid ttl input", () => {
    expect(normalizeRetention({ mode: "ttl", expiresAt: Number.NaN }, 1_000)).toEqual({
      mode: "persistent",
    });
    expect(normalizeRetention({ mode: "ttl", ttlMs: 0 }, 1_000)).toEqual({
      mode: "persistent",
    });
  });

  it("creates document metadata from id, owner, and retention", () => {
    const metadata = createDocumentMetadata({
      id: "abcd1234",
      now: 10_000,
      owner: { id: "u-1", login: "s@example.com", name: "Sean" },
      retention: { mode: "persistent" },
    });

    expect(metadata).toEqual({
      id: "abcd1234",
      createdAt: 10_000,
      updatedAt: 10_000,
      owner: { id: "u-1", login: "s@example.com", name: "Sean" },
      retention: { mode: "persistent" },
    });
  });

  it("only reports ttl documents as expired", () => {
    expect(isExpired({ mode: "persistent" }, 10_000)).toBe(false);
    expect(isExpired({ mode: "ttl", expiresAt: 9_999 }, 10_000)).toBe(true);
    expect(isExpired({ mode: "ttl", expiresAt: 10_001 }, 10_000)).toBe(false);
  });

  it("forwards only normalized mist identity headers", () => {
    const source = new Headers({
      "x-mist-user-id": "u-123",
      "x-mist-user-login": "sean@example.com",
      "x-mist-user-name": "Sean",
      "x-mist-admin": "spoof",
      "authorization": "secret",
    });
    const target = new Headers({ "content-type": "application/json" });

    forwardMistIdentityHeaders(target, source);

    expect(target.get("content-type")).toBe("application/json");
    expect(target.get("x-mist-user-id")).toBe("u-123");
    expect(target.get("x-mist-user-login")).toBe("sean@example.com");
    expect(target.get("x-mist-user-name")).toBe("Sean");
    expect(target.get("x-mist-admin")).toBeNull();
    expect(target.get("authorization")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/unit/shared/document-metadata.test.ts
```

Expected: FAIL because `~/shared/document-metadata` does not exist.

- [ ] **Step 3: Add shared metadata helpers**

Create `app/shared/document-metadata.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run tests/unit/shared/document-metadata.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit shared metadata helpers**

Run:

```bash
git add app/shared/document-metadata.ts tests/unit/shared/document-metadata.test.ts
git commit -m "feat: add document metadata helpers"
```

---

### Task 2: DocumentAgent Metadata And Retention

**Files:**
- Modify: `agents/document.ts`
- Modify: `tests/integration/agents/document-agent.test.ts`

- [ ] **Step 1: Write failing DocumentAgent metadata tests**

In `tests/integration/agents/document-agent.test.ts`, update the import:

```ts
import { DOCUMENT_TTL_MS, DOC_FORMAT_VERSION } from "~/shared/constants";
import type { DocumentMetadata } from "~/shared/document-metadata";
```

Update `GET /` tests to expect metadata:

```ts
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
```

Replace the existing alarm scheduling test with:

```ts
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
```

Replace alarm tests with:

```ts
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
    const body = (await res.json()) as { exists: boolean; metadata: DocumentMetadata | null };
    expect(body.exists).toBe(false);
    expect(body.metadata).toBeNull();
  });
});
```

Add this GET test for legacy data:

```ts
it("derives ttl metadata for legacy documents with exists and createdAt keys", async () => {
  const createdAt = Date.now() - 1_000;
  mockSqlStore.set("exists", new Uint8Array([1]).buffer);
  mockSqlStore.set(
    "createdAt",
    new Uint8Array(new Float64Array([createdAt]).buffer).buffer,
  );

  const res = await agent.onRequest(new Request("https://do/"));
  const body = (await res.json()) as { exists: boolean; metadata: DocumentMetadata };

  expect(body.exists).toBe(true);
  expect(body.metadata).toEqual({
    id: "test-doc",
    createdAt,
    updatedAt: createdAt,
    owner: { id: null, login: null, name: null },
    retention: { mode: "ttl", expiresAt: createdAt + DOCUMENT_TTL_MS },
  });
});
```

- [ ] **Step 2: Run DocumentAgent tests to verify they fail**

Run:

```bash
npx vitest run tests/integration/agents/document-agent.test.ts
```

Expected: FAIL because responses do not include metadata and persistent documents still schedule alarms.

- [ ] **Step 3: Implement metadata persistence in DocumentAgent**

Modify `agents/document.ts` with these changes:

```ts
import {
  createDocumentMetadata,
  getOwnerFromHeaders,
  isExpired,
  normalizeRetention,
  type DocumentMetadata,
} from "../app/shared/document-metadata";
```

Add helpers near `sqlBlob`:

```ts
const jsonEncoder = new TextEncoder();
const jsonDecoder = new TextDecoder();

function jsonBlob(value: unknown): string {
  return sqlBlob(jsonEncoder.encode(JSON.stringify(value)));
}

function parseJsonBlob<T>(value: ArrayBuffer): T {
  return JSON.parse(jsonDecoder.decode(new Uint8Array(value))) as T;
}

function timestampBlob(value: number): string {
  return sqlBlob(new Uint8Array(new Float64Array([value]).buffer));
}
```

Add private metadata helpers to `DocumentAgent`:

```ts
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
      id: this.name,
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
```

In the document update listener, persist state and touch metadata:

```ts
    this.doc.on("update", () => {
      const state = Y.encodeStateAsUpdate(this.doc!);
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('state', ${sqlBlob(state)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
      this.touchMetadata(Date.now());
    });
```

Replace the POST branch with logic that parses JSON once, creates metadata before mutating Yjs state, and schedules alarms only for TTL:

```ts
    if (request.method === "POST") {
      const { doc } = this.ensureInitialised();
      const contentType = request.headers.get("Content-Type") || "";
      let body: {
        content?: string;
        threads?: unknown[];
        onboarding?: boolean;
        retention?: unknown;
      } | null = null;
      let malformedJson = false;

      if (contentType.includes("application/json")) {
        try {
          body = await request.json() as {
            content?: string;
            threads?: unknown[];
            onboarding?: boolean;
            retention?: unknown;
          };
        } catch {
          malformedJson = true;
        }
      }

      const now = Date.now();
      const existingMetadata = this.readMetadata();
      const metadata =
        existingMetadata ??
        createDocumentMetadata({
          id: this.name,
          now,
          owner: getOwnerFromHeaders(request.headers),
          retention: normalizeRetention(body?.retention, now),
        });
      this.writeMetadata(metadata);

      if (metadata.retention.mode === "ttl") {
        await this.ctx.storage.setAlarm(metadata.retention.expiresAt);
      }

      const meta = doc.getMap<number>("meta");
      if (!meta.has("version")) {
        meta.set("version", DOC_FORMAT_VERSION);
      }

      if (body && !malformedJson) {
        try {
          if (body.content) {
            const { parseCriticMarkupToContent } = await import("../app/lib/critic-parser");
            const frag = doc.getXmlFragment("default");
            if (frag.length === 0) {
              const lines = body.content.split("\n");
              for (const line of lines) {
                const { cleanText, marks } = parseCriticMarkupToContent(line);
                const para = new Y.XmlElement("paragraph");
                const ytext = new Y.XmlText(cleanText);
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
```

Replace the GET response with metadata:

```ts
    if (request.method === "GET") {
      this.ensureInitialised();
      const metadata = this.readMetadata();

      return new Response(
        JSON.stringify({
          exists: metadata !== null,
          createdAt: metadata?.createdAt ?? null,
          metadata,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
```

Replace `alarm` with guarded deletion:

```ts
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
```

Remove old POST writes for `exists` and `createdAt`.

- [ ] **Step 4: Run DocumentAgent tests to verify they pass**

Run:

```bash
npx vitest run tests/integration/agents/document-agent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit DocumentAgent metadata behavior**

Run:

```bash
git add agents/document.ts tests/integration/agents/document-agent.test.ts
git commit -m "feat: persist document metadata"
```

---

### Task 3: Forward Identity Through `/new`

**Files:**
- Modify: `app/routes/new.ts`
- Modify: `tests/unit/routes/new.test.ts`

- [ ] **Step 1: Write failing `/new` identity forwarding tests**

Add to `tests/unit/routes/new.test.ts`:

```ts
it("forwards normalized mist identity headers to the document agent", async () => {
  const request = postRequest("# Test", {
    "x-mist-user-id": "u-123",
    "x-mist-user-login": "sean@example.com",
    "x-mist-user-name": "Sean",
    "x-mist-admin": "spoof",
  });

  await action({ request, context } as Parameters<typeof action>[0]);

  const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
  expect(agentRequest.headers.get("x-mist-user-id")).toBe("u-123");
  expect(agentRequest.headers.get("x-mist-user-login")).toBe("sean@example.com");
  expect(agentRequest.headers.get("x-mist-user-name")).toBe("Sean");
  expect(agentRequest.headers.get("x-mist-admin")).toBeNull();
});

it("forwards identity headers when creating a blank document", async () => {
  const request = postRequest("", {
    "x-mist-user-login": "sean@example.com",
  });

  await action({ request, context } as Parameters<typeof action>[0]);

  const agentRequest = mockAgentFetch.mock.calls[0][0] as Request;
  expect(agentRequest.headers.get("x-mist-user-login")).toBe("sean@example.com");
  expect(agentRequest.headers.get("Content-Type")).toBeNull();
});
```

- [ ] **Step 2: Run `/new` tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/routes/new.test.ts
```

Expected: FAIL because `/new` does not forward identity headers.

- [ ] **Step 3: Forward identity headers in `/new`**

Modify `app/routes/new.ts`:

```ts
import { forwardMistIdentityHeaders } from "~/shared/document-metadata";
```

Replace `const init: RequestInit = { method: "POST" };` and content header setup with:

```ts
    const headers = new Headers();
    forwardMistIdentityHeaders(headers, request.headers);
    const init: RequestInit = { method: "POST", headers };

    if (content.trim()) {
      const { body, threads } = deserializeThreads(content);
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify({ content: body, threads });
    }
```

- [ ] **Step 4: Run `/new` tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/routes/new.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit `/new` identity forwarding**

Run:

```bash
git add app/routes/new.ts tests/unit/routes/new.test.ts
git commit -m "feat: forward document owner identity"
```

---

### Task 4: Document Page Metadata UI

**Files:**
- Modify: `app/routes/docs.$id.tsx`
- Create: `tests/unit/routes/docs-id.test.tsx`

- [ ] **Step 1: Write failing document route tests**

Create `tests/unit/routes/docs-id.test.tsx`:

```ts
import { describe, expect, it, vi } from "vitest";

const { mockAgentFetch } = vi.hoisted(() => ({
  mockAgentFetch: vi.fn(),
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockAgentFetch }),
}));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockReturnValue({
    env: { DocumentAgent: {} },
  }),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    data: (body: unknown, init: ResponseInit) => {
      throw new Response(body as BodyInit | null, init);
    },
  };
});

import { formatExpirationTime, loader } from "~/routes/docs.$id";

const context = {} as Parameters<typeof loader>[0]["context"];

describe("docs.$id loader", () => {
  it("returns metadata for existing documents", async () => {
    const metadata = {
      id: "abcd1234",
      createdAt: 1_000,
      updatedAt: 2_000,
      owner: { id: "u-1", login: "sean@example.com", name: "Sean" },
      retention: { mode: "persistent" as const },
    };
    mockAgentFetch.mockResolvedValue(
      new Response(JSON.stringify({ exists: true, createdAt: 1_000, metadata })),
    );

    const result = await loader({
      params: { id: "abcd1234" },
      context,
      request: new Request("https://mist.example.com/docs/abcd1234"),
    } as Parameters<typeof loader>[0]);

    expect(result).toEqual({ id: "abcd1234", createdAt: 1_000, metadata });
  });
});

describe("formatExpirationTime", () => {
  it("formats future expiry in hours", () => {
    expect(formatExpirationTime(10 * 60 * 60 * 1000, 0)).toBe("10h");
  });

  it("formats future expiry in minutes", () => {
    expect(formatExpirationTime(5 * 60 * 1000, 0)).toBe("5m");
  });

  it("formats elapsed expiry as soon", () => {
    expect(formatExpirationTime(0, 1)).toBe("soon");
  });
});
```

- [ ] **Step 2: Run document route tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/routes/docs-id.test.tsx
```

Expected: FAIL because `formatExpirationTime` is not exported and loader does not return metadata.

- [ ] **Step 3: Update document route metadata UI**

Modify `app/routes/docs.$id.tsx`:

```ts
import type { DocumentMetadata } from "~/shared/document-metadata";
```

Update the loader response parsing:

```ts
  const { exists, createdAt, metadata } = (await res.json()) as {
    exists: boolean;
    createdAt: number | null;
    metadata: DocumentMetadata | null;
  };
```

Return metadata:

```ts
  return { id, createdAt, metadata };
```

Replace `formatRemainingTime` with:

```ts
export function formatExpirationTime(expiresAt: number, now = Date.now()): string {
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return "soon";
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  if (hours >= 1) return `${hours}h`;
  const minutes = Math.ceil(remainingMs / (60 * 1000));
  return `${minutes}m`;
}
```

Pass metadata through the component:

```tsx
  const { id, createdAt, metadata } = loaderData;
```

```tsx
      <DocumentLayout id={id} createdAt={createdAt} metadata={metadata} />
```

Update `DocumentLayout` props:

```tsx
function DocumentLayout({
  id,
  createdAt,
  metadata,
}: {
  id: string;
  createdAt: number | null;
  metadata: DocumentMetadata | null;
}) {
```

Replace the header expiry display with:

```tsx
          {metadata?.retention.mode === "ttl" && (
            <span className="ml-2 whitespace-nowrap text-muted">
              expires in {formatExpirationTime(metadata.retention.expiresAt)}
            </span>
          )}
```

Keep `createdAt` passed to `DocumentProvider` for existing context compatibility.

- [ ] **Step 4: Run document route tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/routes/docs-id.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit document page metadata UI**

Run:

```bash
git add 'app/routes/docs.$id.tsx' tests/unit/routes/docs-id.test.tsx
git commit -m "feat: show document expiration metadata"
```

---

### Task 5: Slice Verification

**Files:**
- Modify as needed based on verification failures.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/unit/shared/document-metadata.test.ts tests/integration/agents/document-agent.test.ts tests/unit/routes/new.test.ts tests/unit/routes/docs-id.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 5: Commit verification fixes if any**

If verification required code changes, run:

```bash
git add app/shared/document-metadata.ts agents/document.ts app/routes/new.ts 'app/routes/docs.$id.tsx' tests/unit/shared/document-metadata.test.ts tests/integration/agents/document-agent.test.ts tests/unit/routes/new.test.ts tests/unit/routes/docs-id.test.tsx
git commit -m "fix: address retention metadata verification"
```

If no changes were required, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage: this plan implements the retention and owner metadata vertical slice. Gateway proxy and autosaved versions remain separate implementation plans.
- Placeholder scan: no placeholders remain in the executable steps.
- Type consistency: `DocumentMetadata`, `DocumentRetention`, and owner field names match across helper tests, agent tests, route code, and UI code.
