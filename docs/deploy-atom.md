# Atom Deployment Runbook

This runbook describes the current atom-hosted MIST deployment. It keeps the
application inside the tailnet while using local Cloudflare dev storage for now.
The next deployment slice will replace the local worker with a real/private
Cloudflare Worker service.

## Shape

- Tailnet URL: `https://atom.tail6a522.ts.net/`
- Tailscale Serve: atom host proxies HTTPS 443 to `http://127.0.0.1:8788`
- Portainer stack name: `mist`
- Portainer endpoint id: `2`
- Source checkout on atom: `/zpool1/docker_configs/mist/app`
- Local Cloudflare dev storage: `/zpool1/docker_configs/mist/worker-state`
- Backups: `/zpool1/docker_configs/mist/backups`

The stack runs two services:

- `mist-worker`: React Router dev server plus Cloudflare local Durable Object
  storage. It listens on `127.0.0.1:8787` on atom.
- `mist-gateway`: Node tailnet gateway with `MIST_REQUIRE_IDENTITY=true`. It
  listens on `127.0.0.1:8788` on atom and proxies to `mist-worker`.

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

## Tailscale Serve

Serve should point at the gateway:

```sh
ssh logikal@atom 'tailscale serve --https=443 --bg http://127.0.0.1:8788'
ssh logikal@atom 'tailscale serve status'
```

Expected status:

```text
https://atom.tail6a522.ts.net (tailnet only)
|-- / proxy http://127.0.0.1:8788
```

## Smoke Tests

Health:

```sh
curl -sS https://atom.tail6a522.ts.net/healthz
```

Expected: `ok`.

Identity gate:

```sh
ssh logikal@atom 'curl -i -sS http://127.0.0.1:8788/ | head'
```

Expected: `401 Unauthorized` with `tailscale identity required`.

Existing document:

```sh
curl -sS https://atom.tail6a522.ts.net/agents/document-agent/oxn8nrqt/
```

Expected: JSON metadata with `"name":"Customer incident"`.

Browser:

Open `https://atom.tail6a522.ts.net/docs/oxn8nrqt` and confirm the editor
connects, the document name is visible, and version history is intact.

## Rollback

If the Portainer stack fails, stop it in Portainer and restart the temporary
compose stack:

```sh
ssh logikal@atom 'cd /home/logikal/mist && docker compose up -d'
ssh logikal@atom 'tailscale serve --https=443 --bg http://127.0.0.1:8788'
```
