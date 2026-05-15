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
