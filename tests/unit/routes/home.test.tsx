// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { DocumentIndexEntry } from "~/shared/document-index";

const { mockIndexFetch, mockNavigate } = vi.hoisted(() => ({
  mockIndexFetch: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("agents", () => ({
  getAgentByName: vi.fn().mockResolvedValue({ fetch: mockIndexFetch }),
}));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockReturnValue({
    env: { DocumentIndexAgent: {} },
  }),
}));

vi.mock("~/components/ThemeSelector", () => ({
  default: () => createElement("button", { "aria-label": "Theme" }, "Theme"),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>(
    "react-router",
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import Home, { loader } from "~/routes/home";

const context = {} as Parameters<typeof loader>[0]["context"];

const documentSummary: DocumentIndexEntry = {
  id: "doc-1",
  createdAt: Date.UTC(2026, 4, 15, 12, 0),
  updatedAt: Date.UTC(2026, 4, 16, 12, 30),
  owner: {
    id: "u-1",
    login: "sean@example.com",
    name: "Sean",
  },
  retention: { mode: "persistent" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("home loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIndexFetch.mockResolvedValue(
      new Response(JSON.stringify({ documents: [documentSummary] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("loads documents for the forwarded identity", async () => {
    const result = await loader({
      request: new Request("https://mist.example.com/", {
        headers: { "x-mist-user-login": "sean@example.com" },
      }),
      context,
    } as Parameters<typeof loader>[0]);

    expect(result.documents).toEqual([documentSummary]);
    const indexRequest = mockIndexFetch.mock.calls[0][0] as Request;
    expect(indexRequest.headers.get("x-mist-user-login")).toBe("sean@example.com");
  });

  it("does not query the index without identity", async () => {
    const result = await loader({
      request: new Request("https://mist.example.com/"),
      context,
    } as Parameters<typeof loader>[0]);

    expect(result.documents).toEqual([]);
    expect(mockIndexFetch).not.toHaveBeenCalled();
  });
});

describe("Home", () => {
  it("renders owned documents as links", () => {
    const { getByText, getByRole } = render(
      createElement(Home, {
        loaderData: {
          origin: "https://mist.example.com",
          owner: documentSummary.owner,
          documents: [documentSummary],
        },
        params: {},
        matches: [],
      } as never),
    );

    expect(getByText("Your documents")).toBeTruthy();
    expect(getByText("doc-1")).toBeTruthy();
    expect(getByRole("link", { name: "doc-1" }).getAttribute("href")).toBe(
      "/docs/doc-1",
    );
  });

  it("creates new documents from a persistent-storage starter template", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);

    const { getByRole } = render(
      createElement(Home, {
        loaderData: {
          origin: "https://mist.example.com",
          owner: { id: null, login: null, name: null },
          documents: [],
        },
        params: {},
        matches: [],
      } as never),
    );

    fireEvent.click(getByRole("button", { name: "New document" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as { content: string };
    expect(requestBody.content).not.toMatch(/auto-delete|ephemeral|99 hours/i);
  });

  it("removes an owned document from the list after deletion", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    const { getByRole, queryByText } = render(
      createElement(Home, {
        loaderData: {
          origin: "https://mist.example.com",
          owner: documentSummary.owner,
          documents: [documentSummary],
        },
        params: {},
        matches: [],
      } as never),
    );

    fireEvent.click(getByRole("button", { name: "Delete doc-1" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/agents/document-agent/doc-1",
      { method: "DELETE" },
    );
    await waitFor(() => expect(queryByText("doc-1")).toBeNull());
  });
});
