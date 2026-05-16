import { describe, expect, it } from "vitest";
import { getPublicOrigin } from "~/shared/public-origin";

describe("public origin helpers", () => {
  it("uses the trusted gateway public origin header", () => {
    const request = new Request("https://mist-worker.example.com/new", {
      headers: {
        "x-mist-public-origin": "https://mist.tailnet.ts.net",
      },
    });

    expect(getPublicOrigin(request)).toBe("https://mist.tailnet.ts.net");
  });

  it("falls back to the request URL origin when the header is missing", () => {
    const request = new Request("https://mist-worker.example.com/new");

    expect(getPublicOrigin(request)).toBe("https://mist-worker.example.com");
  });

  it("ignores invalid public origin header values", () => {
    const request = new Request("https://mist-worker.example.com/new", {
      headers: {
        "x-mist-public-origin": "not a url",
      },
    });

    expect(getPublicOrigin(request)).toBe("https://mist-worker.example.com");
  });
});
