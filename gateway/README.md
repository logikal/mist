# MIST Tailnet Gateway

The gateway is a small Node service that sits behind Tailscale Serve and proxies requests to the Cloudflare-hosted MIST Worker. It keeps Tailscale as the user-facing identity boundary while Cloudflare Durable Objects remain the document storage and collaboration backend.

## Environment

Required:

```sh
MIST_UPSTREAM_ORIGIN=https://mist.example.com
```

Optional:

```sh
MIST_GATEWAY_HOST=127.0.0.1
MIST_GATEWAY_PORT=8788
MIST_PUBLIC_ORIGIN=https://mist.example.ts.net
MIST_REQUIRE_IDENTITY=false
CF_ACCESS_CLIENT_ID=<cloudflare-access-service-token-client-id>
CF_ACCESS_CLIENT_SECRET=<cloudflare-access-service-token-client-secret>
```

`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` must be set together. The gateway strips inbound spoofable `x-mist-*`, `tailscale-*`, and Cloudflare Access service-token headers before adding its own trusted headers.

`MIST_PUBLIC_ORIGIN` should be the tailnet URL users see in their browser. When omitted, the gateway infers it from forwarded request headers.

Set `MIST_REQUIRE_IDENTITY=true` in tailnet deployments that should reject traffic unless Tailscale has supplied `Tailscale-User-Login`. Health checks still work without identity. Leave it unset or `false` for local development and anonymous-owner documents.

## Local Run

```sh
npm run gateway:build
MIST_UPSTREAM_ORIGIN=https://mist.example.com npm run gateway:start
```

Health check:

```sh
curl http://127.0.0.1:8788/healthz
```

## Tailscale Serve

Run the gateway bound to localhost, then publish it inside the tailnet:

```sh
tailscale serve --https=443 --bg http://127.0.0.1:8788
```

Normal browser, API, and WebSocket traffic should use the tailnet URL. The browser should not call the Cloudflare Worker directly.

## Cloudflare Access

Protect the Worker route with Cloudflare Access and allow the gateway through a Service Auth policy using the configured service token. The token values stay server-side in the gateway environment.

## Portainer Shape

For an atom-style Portainer stack, run a Tailscale sidecar and the gateway in the sidecar network namespace:

```yaml
services:
  tailscale-mist:
    image: tailscale/tailscale:stable
    hostname: mist
    environment:
      TS_AUTHKEY: ${TS_AUTHKEY}
      TS_STATE_DIR: /var/lib/tailscale
    volumes:
      - /zpool1/docker_configs/mist-gateway/tailscale:/var/lib/tailscale
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    devices:
      - /dev/net/tun:/dev/net/tun

  mist-gateway:
    build:
      context: .
      dockerfile: gateway/Dockerfile
    network_mode: service:tailscale-mist
    environment:
      MIST_UPSTREAM_ORIGIN: https://mist.example.com
      MIST_PUBLIC_ORIGIN: https://mist.example.ts.net
      MIST_REQUIRE_IDENTITY: "true"
      MIST_GATEWAY_HOST: 127.0.0.1
      MIST_GATEWAY_PORT: 8788
      CF_ACCESS_CLIENT_ID: ${CF_ACCESS_CLIENT_ID}
      CF_ACCESS_CLIENT_SECRET: ${CF_ACCESS_CLIENT_SECRET}
```

After both containers are healthy, run this once in the Tailscale container:

```sh
tailscale serve --https=443 --bg http://127.0.0.1:8788
```
