// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { DocumentMetadata } from "~/shared/document-metadata";

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

import { DocumentTitle, formatExpirationTime, loader } from "~/routes/docs.$id";

const context = {} as Parameters<typeof loader>[0]["context"];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("docs.$id loader", () => {
  it("returns metadata for existing documents", async () => {
    const metadata = {
      id: "abcd1234",
      name: null,
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

describe("DocumentTitle", () => {
  const metadata: DocumentMetadata = {
    id: "abcd1234",
    name: null,
    createdAt: 1_000,
    updatedAt: 2_000,
    owner: { id: "u-1", login: "sean@example.com", name: "Sean" },
    retention: { mode: "persistent" },
  };

  it("shows a saved friendly name with the document id", () => {
    const { getByDisplayValue, getByText } = render(
      createElement(DocumentTitle, {
        id: "abcd1234",
        metadata: { ...metadata, name: "Customer incident" },
      }),
    );

    expect(getByDisplayValue("Customer incident")).toBeTruthy();
    expect(getByText("abcd1234")).toBeTruthy();
  });

  it("saves a public friendly name", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          metadata: { ...metadata, name: "Customer incident" },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getByLabelText, getByRole } = render(
      createElement(DocumentTitle, { id: "abcd1234", metadata }),
    );

    fireEvent.change(getByLabelText("Document name"), {
      target: { value: "Customer incident" },
    });
    fireEvent.click(getByRole("button", { name: "Save document name" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/agents/document-agent/abcd1234/metadata",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Customer incident" }),
        },
      );
    });
    expect((getByLabelText("Document name") as HTMLInputElement).value).toBe(
      "Customer incident",
    );
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
