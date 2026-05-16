# Tailnet Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small local gateway that Tailscale Serve can expose on the tailnet while proxying HTTP and WebSocket traffic to the Cloudflare-protected MIST Worker with service-token authentication and normalized owner identity headers.

**Architecture:** The gateway is a Node HTTP server built from TypeScript and runtime-only Node built-ins. It listens on localhost, maps Tailscale Serve identity headers to `x-mist-*`, strips spoofable inbound identity headers, injects Cloudflare Access service-token headers, proxies normal HTTP with `fetch`, and proxies WebSocket upgrades with Node `http`/`https` request upgrade piping.

**Tech Stack:** TypeScript, Node `http`/`https`, Node Fetch, Vitest, Docker multi-stage build.

---

## File Structure

- Create `gateway/config.ts`
  - Reads and validates environment configuration.
  - Exports `GatewayConfig` used by the server and tests.
- Create `gateway/headers.ts`
  - Normalizes Tailscale identity headers to MIST owner headers.
  - Strips spoofable `x-mist-*`, `tailscale-*`, and Cloudflare Access headers from inbound requests.
  - Builds upstream headers for HTTP and WebSocket proxying.
- Create `gateway/proxy.ts`
  - Builds upstream URLs.
  - Proxies HTTP requests and WebSocket upgrade requests.
- Create `gateway/server.ts`
  - Creates and starts the Node server.
  - Exposes `/healthz`.
- Create `tests/unit/gateway/headers.test.ts`
  - Tests identity normalization, RFC2047 Q decoding, spoof stripping, and Cloudflare service-token injection.
- Create `tests/unit/gateway/proxy.test.ts`
  - Tests HTTP proxy behavior and WebSocket upgrade behavior against local upstream servers.
- Create `tsconfig.gateway.json`
  - Compiles gateway TypeScript to `dist/`.
- Modify `package.json`
  - Add `gateway:build` and `gateway:start` scripts.
- Create `gateway/Dockerfile`
  - Multi-stage build using `node:24-slim`.
- Create `gateway/README.md`
  - Documents environment variables, local run commands, Cloudflare Access policy, and Tailscale Serve/Portainer deployment shape.

---

### Task 1: Gateway Header Utilities

**Files:**
- Create: `gateway/headers.ts`
- Create: `tests/unit/gateway/headers.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/gateway/headers.test.ts` with tests for:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run tests/unit/gateway/headers.test.ts
```

Expected: FAIL because `gateway/headers.ts` does not exist.

- [ ] **Step 3: Implement header utilities**

Create `gateway/headers.ts` with exports:

```ts
export interface AccessTokenConfig {
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}

export function decodeTailscaleHeaderValue(value: string): string;
export function normalizeTailscaleIdentityHeaders(source: Headers): Headers;
export function buildUpstreamHeaders(source: Headers, config: AccessTokenConfig): Headers;
```

Implementation requirements:

- Decode `=?utf-8?q?...?=` values by converting `_` to spaces and `=XX` hex bytes to UTF-8.
- Set `x-mist-user-id` and `x-mist-user-login` from `Tailscale-User-Login`.
- Set `x-mist-user-name` from `Tailscale-User-Name`.
- Strip inbound `x-mist-*`, `tailscale-*`, `cf-access-client-id`, and `cf-access-client-secret`.
- Add service token headers from config only when both values are present.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run tests/unit/gateway/headers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add gateway/headers.ts tests/unit/gateway/headers.test.ts
git commit -m "feat: add gateway header normalization"
```

---

### Task 2: Gateway HTTP And WebSocket Proxy

**Files:**
- Create: `gateway/config.ts`
- Create: `gateway/proxy.ts`
- Create: `gateway/server.ts`
- Create: `tests/unit/gateway/proxy.test.ts`

- [ ] **Step 1: Write failing proxy tests**

Create `tests/unit/gateway/proxy.test.ts` with local upstream server tests that verify:

- `/healthz` returns `ok`.
- HTTP proxy preserves method, path, body, and injects identity/service-token headers.
- WebSocket upgrade proxy forwards the upgrade request with injected identity/service-token headers and relays the upstream `101 Switching Protocols` response.

- [ ] **Step 2: Run proxy tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/gateway/proxy.test.ts
```

Expected: FAIL because the proxy modules do not exist.

- [ ] **Step 3: Implement config and proxy modules**

Create `gateway/config.ts` with:

```ts
export interface GatewayConfig {
  upstreamOrigin: URL;
  host: string;
  port: number;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}

export function loadGatewayConfig(env?: NodeJS.ProcessEnv): GatewayConfig;
```

Environment variables:

- `MIST_UPSTREAM_ORIGIN` is required and must be `http:` or `https:`.
- `MIST_GATEWAY_HOST` defaults to `127.0.0.1`.
- `MIST_GATEWAY_PORT` defaults to `8788`.
- `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` are optional as a pair.

Create `gateway/proxy.ts` with:

```ts
export function buildUpstreamUrl(path: string, upstreamOrigin: URL): URL;
export function proxyHttpRequest(req: IncomingMessage, res: ServerResponse, config: GatewayConfig): Promise<void>;
export function proxyWebSocketUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, config: GatewayConfig): void;
```

Create `gateway/server.ts` with:

```ts
export function createGatewayServer(config: GatewayConfig): http.Server;
```

`createGatewayServer` must answer `/healthz` locally and proxy all other HTTP and upgrade traffic.

- [ ] **Step 4: Run proxy tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/gateway/proxy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add gateway/config.ts gateway/proxy.ts gateway/server.ts tests/unit/gateway/proxy.test.ts
git commit -m "feat: add tailnet gateway proxy"
```

---

### Task 3: Build And Deployment Assets

**Files:**
- Create: `tsconfig.gateway.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `gateway/Dockerfile`
- Create: `gateway/README.md`

- [ ] **Step 1: Add build and deployment files**

Add `tsconfig.gateway.json` compiling `gateway/**/*.ts` and `app/shared/document-metadata.ts` to `dist/`.

Add scripts:

```json
"gateway:build": "tsc -p tsconfig.gateway.json",
"gateway:start": "node dist/gateway/server.js"
```

Create a multi-stage `gateway/Dockerfile` using `node:24-slim`. It must build from repo root and run `npm run gateway:start`.

Create `gateway/README.md` documenting:

- required `MIST_UPSTREAM_ORIGIN`
- optional `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`
- default local bind `127.0.0.1:8788`
- Tailscale Serve command: `tailscale serve --https=443 --bg http://127.0.0.1:8788`
- Portainer sidecar pattern with the gateway sharing the Tailscale container network namespace
- Cloudflare Access policy requiring a Service Auth policy for the service token

- [ ] **Step 2: Run gateway build**

Run:

```bash
npm run gateway:build
```

Expected: PASS and emit `dist/`.

- [ ] **Step 3: Commit build and docs**

Run:

```bash
git add tsconfig.gateway.json package.json package-lock.json gateway/Dockerfile gateway/README.md
git commit -m "docs: add gateway deployment assets"
```

---

### Task 4: Final Verification

**Files:**
- Modify as needed based on verification failures.

- [ ] **Step 1: Run focused gateway tests**

Run:

```bash
npx vitest run tests/unit/gateway/headers.test.ts tests/unit/gateway/proxy.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run gateway build**

Run:

```bash
npm run gateway:build
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run:

```bash
npm run test
```

Expected: PASS.

---

## Self-Review Checklist

- Spec coverage: implements the tailnet gateway slice only. Autosaved versions remain a later vertical slice.
- Placeholder scan: no placeholders remain in executable steps.
- Type consistency: `GatewayConfig`, service-token env names, and header names match across implementation, tests, and docs.
