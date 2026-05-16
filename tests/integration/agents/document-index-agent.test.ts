import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DocumentIndexEntry } from "~/shared/document-index";

let mockRows: Array<{
  id: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  ownerId: string | null;
  ownerLogin: string | null;
  ownerName: string | null;
  retention: string;
}>;

vi.mock("agents", () => ({
  Agent: class MockAgent {
    name = "document-index";
    env = {};
    ctx = {};

    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("$").toLowerCase().trim();

      if (query.includes("create table")) return [];

      if (query.includes("insert into document_index")) {
        const hasName = values.length === 8;
        const id = values[0];
        const name = hasName ? values[1] : null;
        const createdAt = hasName ? values[2] : values[1];
        const updatedAt = hasName ? values[3] : values[2];
        const ownerId = hasName ? values[4] : values[3];
        const ownerLogin = hasName ? values[5] : values[4];
        const ownerName = hasName ? values[6] : values[5];
        const retention = hasName ? values[7] : values[6];
        const row = {
          id: String(id),
          name: name === null ? null : String(name),
          createdAt: Number(createdAt),
          updatedAt: Number(updatedAt),
          ownerId: ownerId === null ? null : String(ownerId),
          ownerLogin: ownerLogin === null ? null : String(ownerLogin),
          ownerName: ownerName === null ? null : String(ownerName),
          retention: String(retention),
        };
        const existing = mockRows.findIndex((item) => item.id === row.id);
        if (existing >= 0) {
          mockRows[existing] = row;
        } else {
          mockRows.push(row);
        }
        return [];
      }

      if (query.includes("select") && query.includes("from document_index")) {
        return [...mockRows]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((row) => ({
            id: row.id,
            name: row.name,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            ownerId: row.ownerId,
            ownerLogin: row.ownerLogin,
            ownerName: row.ownerName,
            retention: row.retention,
          }));
      }

      if (query.includes("delete from document_index")) {
        const id = String(values[0]);
        mockRows = mockRows.filter((row) => row.id !== id);
        return [];
      }

      return [];
    }
  },
}));

describe("DocumentIndexAgent", () => {
  let DocumentIndexAgent: typeof import("../../../agents/document-index").default;
  let agent: InstanceType<typeof DocumentIndexAgent>;

  beforeEach(async () => {
    mockRows = [];
    const mod = await import("../../../agents/document-index");
    DocumentIndexAgent = mod.default;
    agent = new DocumentIndexAgent({} as never, {} as never);
  });

  function makeDocument(
    overrides: Partial<DocumentIndexEntry> = {},
  ): DocumentIndexEntry {
    return {
      id: "doc-1",
      name: null,
      createdAt: 1_000,
      updatedAt: 2_000,
      owner: {
        id: "u-1",
        login: "sean@example.com",
        name: "Sean",
      },
      retention: { mode: "persistent" },
      ...overrides,
    };
  }

  it("lists documents owned by the requesting identity", async () => {
    await agent.onRequest(
      new Request("https://index/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeDocument()),
      }),
    );

    const res = await agent.onRequest(
      new Request("https://index/documents", {
        headers: { "x-mist-user-login": "sean@example.com" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      documents: [makeDocument()],
    });
  });

  it("preserves public document names in owner lists", async () => {
    await agent.onRequest(
      new Request("https://index/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeDocument({ name: "Customer incident" })),
      }),
    );

    const res = await agent.onRequest(
      new Request("https://index/documents", {
        headers: { "x-mist-user-login": "sean@example.com" },
      }),
    );

    expect(await res.json()).toEqual({
      documents: [makeDocument({ name: "Customer incident" })],
    });
  });

  it("does not list documents for other identities", async () => {
    await agent.onRequest(
      new Request("https://index/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeDocument()),
      }),
    );

    const res = await agent.onRequest(
      new Request("https://index/documents", {
        headers: { "x-mist-user-login": "alex@example.com" },
      }),
    );

    expect(await res.json()).toEqual({ documents: [] });
  });

  it("does not match display names when the document has a stable owner id", async () => {
    await agent.onRequest(
      new Request("https://index/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeDocument()),
      }),
    );

    const res = await agent.onRequest(
      new Request("https://index/documents", {
        headers: { "x-mist-user-name": "Sean" },
      }),
    );

    expect(await res.json()).toEqual({ documents: [] });
  });

  it("removes deleted documents from the index", async () => {
    await agent.onRequest(
      new Request("https://index/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeDocument()),
      }),
    );

    const deleteRes = await agent.onRequest(
      new Request("https://index/documents/doc-1", { method: "DELETE" }),
    );
    const listRes = await agent.onRequest(
      new Request("https://index/documents", {
        headers: { "x-mist-user-login": "sean@example.com" },
      }),
    );

    expect(deleteRes.status).toBe(200);
    expect(await listRes.json()).toEqual({ documents: [] });
  });
});
