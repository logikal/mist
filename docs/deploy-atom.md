# Atom Deployment Runbook

This runbook describes the current atom-hosted MIST deployment. It keeps the
application inside the tailnet while using local Cloudflare dev storage for now.
The next deployment slice will replace the local worker with a real/private
Cloudflare Worker service.

## Shape

- Tailnet URL: `https://mist.tail6a522.ts.net/`
- Tailscale sidecar: `ts-mist` owns the tailnet node named `mist` and serves
  HTTPS 443 to `http://127.0.0.1:8788` inside the sidecar network namespace.
- Portainer stack name: `mist`
- Portainer endpoint id: `2`
- Source checkout on atom: `/zpool1/docker_configs/mist/app`
- Local Cloudflare dev storage: `/zpool1/docker_configs/mist/worker-state`
- Tailscale sidecar state: `/zpool1/docker_configs/mist/tailscale`
- Tailscale sidecar config: `/zpool1/docker_configs/mist/tailscale-config`
- Backups: `/zpool1/docker_configs/mist/backups`

The stack follows the same sidecar pattern as the n8n Portainer stack:

- `tailscale-mist`: Tailscale container with hostname `mist`, persistent state,
  and a generated `TS_SERVE_CONFIG`.
- `mist-worker`: React Router dev server plus Cloudflare local Durable Object
  storage. It shares the sidecar network namespace and listens on
  `127.0.0.1:8787`.
- `mist-gateway`: Node tailnet gateway with `MIST_REQUIRE_IDENTITY=true`. It
  shares the sidecar network namespace, listens on `127.0.0.1:8788`, and proxies
  to `mist-worker` over `http://127.0.0.1:8787`.

## Fresh Deploy

Run verification locally first:

```sh
npm run typecheck
npm run lint
npm run test
npm run build
npm run gateway:build
```

Prepare atom directories:

```sh
ssh logikal@atom '
  sudo mkdir -p /zpool1/docker_configs/mist/app \
    /zpool1/docker_configs/mist/worker-state \
    /zpool1/docker_configs/mist/tailscale \
    /zpool1/docker_configs/mist/tailscale-config \
    /zpool1/docker_configs/mist/backups
  sudo chown -R logikal:logikal /zpool1/docker_configs/mist
'
```

Copy this repo snapshot to atom:

```sh
git archive --format=tar HEAD | ssh logikal@atom '
  set -euo pipefail
  rm -rf /zpool1/docker_configs/mist/app
  mkdir -p /zpool1/docker_configs/mist/app
  tar -xf - -C /zpool1/docker_configs/mist/app
'
```

Build the runtime image on atom:

```sh
ssh logikal@atom '
  docker build \
    -t mist:atom-dev \
    -f /zpool1/docker_configs/mist/app/deploy/atom/Dockerfile \
    /zpool1/docker_configs/mist/app
'
```

Install/update the Portainer stack with `deploy/atom/docker-compose.yml`. The
Portainer stack intentionally does not build the image itself; the image is
prebuilt from the zpool checkout so Portainer only owns runtime orchestration.

## Migrating From The Temporary Compose Stack

The temporary deployment used `/home/logikal/mist/docker-compose.yml` and the
Docker named volume `mist_worker-state`. Stop it before copying state:

```sh
ssh logikal@atom 'cd /home/logikal/mist && docker compose stop'
```

Copy the named volume into the host-visible bind mount:

```sh
ssh logikal@atom '
  set -euo pipefail
  mkdir -p /zpool1/docker_configs/mist/worker-state
  docker run --rm \
    -v mist_worker-state:/from:ro \
    -v /zpool1/docker_configs/mist/worker-state:/to \
    alpine sh -c "cd /from && cp -a . /to/"
'
```

Keep the old named volume around until the bind-mounted deployment has passed
smoke tests.

## Portainer API

Portainer is available on atom at `https://localhost:9443/api`. The API token is
stored on atom at `~/.config/portainer/api_token`.

List stacks:

```sh
ssh logikal@atom '
  TOKEN=$(cat ~/.config/portainer/api_token)
  curl -sk -H "X-API-Key: $TOKEN" https://localhost:9443/api/stacks
'
```

Create the stack if `mist` does not exist:

```sh
ssh logikal@atom '
  TOKEN=$(cat ~/.config/portainer/api_token)
  STACK=$(python3 - <<PY
import json
print(json.dumps({
  "name": "mist",
  "stackFileContent": open("/zpool1/docker_configs/mist/app/deploy/atom/docker-compose.yml").read(),
  "env": []
}))
PY
)
  curl -sk -X POST \
    -H "X-API-Key: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$STACK" \
    "https://localhost:9443/api/stacks/create/standalone/string?endpointId=2"
'
```

Update an existing stack:

```sh
ssh logikal@atom '
  TOKEN=$(cat ~/.config/portainer/api_token)
  STACK_ID=$(curl -sk -H "X-API-Key: $TOKEN" https://localhost:9443/api/stacks |
    python3 -c "import json,sys; print(next(s[\"Id\"] for s in json.load(sys.stdin) if s[\"Name\"] == \"mist\"))")
  BODY=$(python3 - <<PY
import json
print(json.dumps({
  "stackFileContent": open("/zpool1/docker_configs/mist/app/deploy/atom/docker-compose.yml").read(),
  "env": [],
  "prune": False,
  "pullImage": False
}))
PY
)
  curl -sk -X PUT \
    -H "X-API-Key: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$BODY" \
    "https://localhost:9443/api/stacks/$STACK_ID?endpointId=2"
'
```

## Tailscale Sidecar

`tailscale-mist` writes the same sidecar-style `TS_SERVE_CONFIG` used by the n8n
stack and serves the gateway from inside the shared network namespace. Unlike
the n8n webhook use case, MIST keeps this endpoint tailnet-only by omitting the
`AllowFunnel` serve setting. The expected tailnet name is
`mist.tail6a522.ts.net`.

On first boot with an empty `/zpool1/docker_configs/mist/tailscale` directory,
the Tailscale container must be authenticated. Either add a temporary
`TS_AUTHKEY` to the Portainer stack environment, or read the login URL from the
`ts-mist` logs and approve it in Tailscale. After state exists on disk, remove
the one-time auth material from the stack.

The atom host-level Tailscale Serve config is not part of this deployment. If a
previous host-level deployment pointed `atom.tail6a522.ts.net` at MIST, reset it
after `mist.tail6a522.ts.net` is working:

```sh
ssh logikal@atom 'tailscale serve reset'
```

Check the sidecar state:

```sh
ssh logikal@atom 'docker exec ts-mist tailscale status'
```

If HTTPS initially returns a TLS internal error, check the sidecar logs for
certificate issuance errors:

```sh
ssh logikal@atom 'docker logs --tail 120 ts-mist | grep -Ei "cert|SetDNS|TLS"'
ssh logikal@atom 'docker exec ts-mist tailscale cert mist.tail6a522.ts.net'
```

During the first `mist` sidecar migration, Tailscale briefly returned
`SetDNS ... 500 Internal Server Error` while creating the ACME TXT record. A
later retry succeeded and Serve began returning HTTPS normally.

## Smoke Tests

Health:

```sh
curl -sS https://mist.tail6a522.ts.net/healthz
```

Expected: `ok`.

Identity gate:

```sh
ssh logikal@atom 'curl -i -sS http://192.168.1.12:8788/ | head'
```

Expected: `401 Unauthorized` with `tailscale identity required`.

Existing document:

```sh
curl -sS https://mist.tail6a522.ts.net/agents/document-agent/oxn8nrqt/
```

Expected: JSON metadata with `"name":"Customer incident"`.

Browser:

Open `https://mist.tail6a522.ts.net/docs/oxn8nrqt` and confirm the editor
connects, the document name is visible, and version history is intact.

## Rollback

If the Portainer stack fails, stop it in Portainer and restart the temporary
compose stack:

```sh
ssh logikal@atom 'cd /home/logikal/mist && docker compose up -d'
ssh logikal@atom 'tailscale serve --https=443 --bg http://127.0.0.1:8788'
```
