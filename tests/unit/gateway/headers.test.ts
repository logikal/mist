import { describe, expect, it } from "vitest";
import {
  buildUpstreamHeaders,
  decodeTailscaleHeaderValue,
  normalizeTailscaleIdentityHeaders,
} from "../../../gateway/headers";

describe("gateway header utilities", () => {
  it("maps Tailscale identity headers to normalized MIST owner headers", () => {
    const headers = new Headers({
      "Tailscale-User-Login": "sean@example.com",
      "Tailscale-User-Name": "Sean",
      "x-mist-user-login": "spoof@example.com",
    });

    expect(Object.fromEntries(normalizeTailscaleIdentityHeaders(headers))).toEqual({
      "x-mist-user-id": "sean@example.com",
      "x-mist-user-login": "sean@example.com",
      "x-mist-user-name": "Sean",
    });
  });

  it("decodes simple RFC2047 Q-encoded Tailscale values", () => {
    expect(decodeTailscaleHeaderValue("=?utf-8?q?Ferris_B=C3=BCller?=")).toBe(
      "Ferris Büller",
    );
  });

  it("strips spoofable identity and Cloudflare Access headers before proxying", () => {
    const headers = buildUpstreamHeaders(
      new Headers({
        "Content-Type": "text/plain",
        "Tailscale-User-Login": "sean@example.com",
        "x-mist-user-login": "spoof@example.com",
        "CF-Access-Client-Id": "spoof-id",
        "CF-Access-Client-Secret": "spoof-secret",
      }),
      {
        cfAccessClientId: "real-id",
        cfAccessClientSecret: "real-secret",
      },
    );

    expect(headers.get("content-type")).toBe("text/plain");
    expect(headers.get("x-mist-user-id")).toBe("sean@example.com");
    expect(headers.get("x-mist-user-login")).toBe("sean@example.com");
    expect(headers.get("cf-access-client-id")).toBe("real-id");
    expect(headers.get("cf-access-client-secret")).toBe("real-secret");
    expect(headers.get("tailscale-user-login")).toBeNull();
  });

  it("does not inject partial Cloudflare Access service token credentials", () => {
    const headers = buildUpstreamHeaders(
      new Headers({
        "Tailscale-User-Login": "sean@example.com",
      }),
      {
        cfAccessClientId: "real-id",
      },
    );

    expect(headers.get("cf-access-client-id")).toBeNull();
    expect(headers.get("cf-access-client-secret")).toBeNull();
  });

  it("forwards the trusted public gateway origin", () => {
    const headers = buildUpstreamHeaders(
      new Headers({
        Host: "mist.tailnet.ts.net",
        "x-forwarded-proto": "https",
        "x-mist-public-origin": "https://spoof.example.com",
      }),
      {},
    );

    expect(headers.get("x-mist-public-origin")).toBe("https://mist.tailnet.ts.net");
  });

  it("prefers an explicit public origin from gateway config", () => {
    const headers = buildUpstreamHeaders(
      new Headers({
        Host: "127.0.0.1:8788",
      }),
      {
        publicOrigin: new URL("https://mist.tailnet.ts.net"),
      },
    );

    expect(headers.get("x-mist-public-origin")).toBe("https://mist.tailnet.ts.net");
  });
});
