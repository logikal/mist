import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadGatewayConfig, type GatewayConfig } from "./config.js";
import { proxyHttpRequest, proxyWebSocketUpgrade } from "./proxy.js";

export function createGatewayServer(config: GatewayConfig): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
      return;
    }

    void proxyHttpRequest(req, res, config);
  });

  server.on("upgrade", (req, socket, head) => {
    proxyWebSocketUpgrade(req, socket, head, config);
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadGatewayConfig();
  const server = createGatewayServer(config);
  server.listen(config.port, config.host, () => {
    console.log(
      `mist gateway listening on http://${config.host}:${config.port} -> ${config.upstreamOrigin.origin}`,
    );
  });
}
