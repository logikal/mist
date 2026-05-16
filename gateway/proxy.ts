import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import type { Duplex } from "node:stream";
import type { GatewayConfig } from "./config.js";
import { buildUpstreamHeaders, hasTailscaleIdentity } from "./headers.js";

type FetchInit = RequestInit & { duplex?: "half" };

function incomingHeadersToHeaders(source: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function writeNodeResponseHeaders(
  res: http.ServerResponse,
  headers: Headers,
): void {
  for (const [name, value] of headers) {
    res.setHeader(name, value);
  }
}

function writeSocketResponseHead(
  socket: Duplex,
  statusCode: number,
  statusMessage: string,
  headers: http.IncomingHttpHeaders,
): void {
  socket.write(`HTTP/1.1 ${statusCode} ${statusMessage}\r\n`);
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        socket.write(`${name}: ${item}\r\n`);
      }
    } else if (value !== undefined) {
      socket.write(`${name}: ${value}\r\n`);
    }
  }
  socket.write("\r\n");
}

export function buildUpstreamUrl(path: string, upstreamOrigin: URL): URL {
  return new URL(path, upstreamOrigin);
}

export async function proxyHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: GatewayConfig,
): Promise<void> {
  try {
    const incomingHeaders = incomingHeadersToHeaders(req.headers);
    if (config.requireIdentity && !hasTailscaleIdentity(incomingHeaders)) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("tailscale identity required\n");
      return;
    }

    const target = buildUpstreamUrl(req.url ?? "/", config.upstreamOrigin);
    const method = req.method ?? "GET";
    const headers = buildUpstreamHeaders(incomingHeaders, config);
    const init: FetchInit = {
      method,
      headers,
      redirect: "manual",
    };

    if (method !== "GET" && method !== "HEAD") {
      init.body = req as unknown as BodyInit;
      init.duplex = "half";
    }

    const upstreamRes = await fetch(target, init);
    res.statusCode = upstreamRes.status;
    res.statusMessage = upstreamRes.statusText;
    writeNodeResponseHeaders(res, upstreamRes.headers);

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    Readable.fromWeb(upstreamRes.body as unknown as import("node:stream/web").ReadableStream).pipe(res);
  } catch (error) {
    console.error("mist gateway HTTP proxy error", error);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain" });
    }
    res.end("bad gateway\n");
  }
}

export function proxyWebSocketUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  config: GatewayConfig,
): void {
  const incomingHeaders = incomingHeadersToHeaders(req.headers);
  if (config.requireIdentity && !hasTailscaleIdentity(incomingHeaders)) {
    socket.end(
      "HTTP/1.1 401 Unauthorized\r\n" +
        "content-type: text/plain\r\n" +
        "\r\n" +
        "tailscale identity required\n",
    );
    return;
  }

  const target = buildUpstreamUrl(req.url ?? "/", config.upstreamOrigin);
  const headers = buildUpstreamHeaders(incomingHeaders, config);
  headers.set("connection", "Upgrade");
  headers.set("upgrade", req.headers.upgrade ?? "websocket");
  headers.set("host", target.host);

  const client = target.protocol === "https:" ? https : http;
  const upstreamReq = client.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    method: req.method,
    path: `${target.pathname}${target.search}`,
    headers: Object.fromEntries(headers),
  });

  upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    writeSocketResponseHead(
      socket,
      upstreamRes.statusCode ?? 101,
      upstreamRes.statusMessage ?? "Switching Protocols",
      upstreamRes.headers,
    );
    if (upstreamHead.length > 0) {
      socket.write(upstreamHead);
    }
    if (head.length > 0) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });

  upstreamReq.on("response", (upstreamRes) => {
    writeSocketResponseHead(
      socket,
      upstreamRes.statusCode ?? 502,
      upstreamRes.statusMessage ?? "Bad Gateway",
      upstreamRes.headers,
    );
    upstreamRes.pipe(socket);
  });

  upstreamReq.on("error", (error) => {
    console.error("mist gateway WebSocket proxy error", error);
    socket.end("HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain\r\n\r\nbad gateway\n");
  });

  upstreamReq.end();
}
