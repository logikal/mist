import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createGatewayServer } from "../../../gateway/server";
import type { GatewayConfig } from "../../../gateway/config";

const servers: http.Server[] = [];

async function listen(server: http.Server): Promise<URL> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not listen on a TCP port");
  }
  return new URL(`http://127.0.0.1:${address.port}`);
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

describe("tailnet gateway proxy", () => {
  it("answers health checks locally", async () => {
    const upstream = await listen(http.createServer());
    const gateway = http.createServer();
    const config: GatewayConfig = {
      upstreamOrigin: upstream,
      host: "127.0.0.1",
      port: 0,
    };
    const server = createGatewayServer(config);
    const gatewayUrl = await listen(server);

    const res = await fetch(new URL("/healthz", gatewayUrl));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok\n");
    await closeServer(gateway);
  });

  it("proxies HTTP requests with identity and service token headers", async () => {
    let observed: {
      method?: string;
      url?: string;
      body?: string;
      headers?: http.IncomingHttpHeaders;
    } = {};
    const upstream = await listen(
      http.createServer(async (req, res) => {
        observed = {
          method: req.method,
          url: req.url,
          body: await readRequestBody(req),
          headers: req.headers,
        };
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ proxied: true }));
      }),
    );
    const server = createGatewayServer({
      upstreamOrigin: upstream,
      host: "127.0.0.1",
      port: 0,
      cfAccessClientId: "client-id",
      cfAccessClientSecret: "client-secret",
    });
    const gatewayUrl = await listen(server);

    const res = await fetch(new URL("/new?via=gateway", gatewayUrl), {
      method: "POST",
      headers: {
        "content-type": "text/markdown",
        "tailscale-user-login": "sean@example.com",
        "tailscale-user-name": "Sean",
        "x-mist-user-login": "spoof@example.com",
      },
      body: "# hello",
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ proxied: true });
    expect(observed).toMatchObject({
      method: "POST",
      url: "/new?via=gateway",
      body: "# hello",
    });
    expect(observed.headers?.["content-type"]).toContain("text/markdown");
    expect(observed.headers?.["x-mist-user-id"]).toBe("sean@example.com");
    expect(observed.headers?.["x-mist-user-login"]).toBe("sean@example.com");
    expect(observed.headers?.["x-mist-user-name"]).toBe("Sean");
    expect(observed.headers?.["cf-access-client-id"]).toBe("client-id");
    expect(observed.headers?.["cf-access-client-secret"]).toBe("client-secret");
    expect(observed.headers?.["tailscale-user-login"]).toBeUndefined();
  });

  it("proxies WebSocket upgrades with identity and service token headers", async () => {
    let observedHeaders: http.IncomingHttpHeaders | undefined;
    const upstreamServer = http.createServer();
    upstreamServer.on("upgrade", (req, socket) => {
      observedHeaders = req.headers;
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "\r\n",
      );
      socket.end("upgraded");
    });
    const upstream = await listen(upstreamServer);
    const gateway = await listen(
      createGatewayServer({
        upstreamOrigin: upstream,
        host: "127.0.0.1",
        port: 0,
        cfAccessClientId: "client-id",
        cfAccessClientSecret: "client-secret",
      }),
    );

    const socket = net.connect(Number(gateway.port), gateway.hostname);
    await once(socket, "connect");
    socket.write(
      "GET /agents/document-agent/abcd1234 HTTP/1.1\r\n" +
        `Host: ${gateway.host}\r\n` +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Tailscale-User-Login: sean@example.com\r\n" +
        "Tailscale-User-Name: Sean\r\n" +
        "\r\n",
    );

    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    await once(socket, "end");

    const response = Buffer.concat(chunks).toString("utf8");
    expect(response).toContain("101 Switching Protocols");
    expect(response).toContain("upgraded");
    expect(observedHeaders?.["x-mist-user-id"]).toBe("sean@example.com");
    expect(observedHeaders?.["x-mist-user-login"]).toBe("sean@example.com");
    expect(observedHeaders?.["x-mist-user-name"]).toBe("Sean");
    expect(observedHeaders?.["cf-access-client-id"]).toBe("client-id");
    expect(observedHeaders?.["cf-access-client-secret"]).toBe("client-secret");
    expect(observedHeaders?.["tailscale-user-login"]).toBeUndefined();
  });
});
