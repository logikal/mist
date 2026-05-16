# Atom Portainer Dev Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the working atom MIST deployment into a Portainer-managed stack with host-visible durable local Cloudflare dev storage.

**Architecture:** Keep the current two-service shape: `mist-worker` runs `npm run dev` with Cloudflare local Durable Object state under `/app/.wrangler`, and `mist-gateway` proxies Tailscale-authenticated traffic to the worker. Portainer owns the compose stack; atom host-level Tailscale Serve continues to publish `https://atom.tail6a522.ts.net/` to `http://127.0.0.1:8788`. The real Cloudflare Worker/Access cutover remains a separate future slice.

**Tech Stack:** Docker Compose, Portainer API on atom endpoint 2, Tailscale Serve, React Router dev server, Cloudflare local dev storage.

---

### Task 1: Repo Deployment Artifacts

**Files:**
- Create: `deploy/atom/docker-compose.yml`
- Create: `deploy/atom/Dockerfile`
- Create: `docs/deploy-atom.md`

- [ ] **Step 1: Add the atom compose file**

Create `deploy/atom/docker-compose.yml` with `mist-worker` and `mist-gateway`. The worker uses prebuilt image `mist:atom-dev`; `.wrangler` is bind-mounted from `/zpool1/docker_configs/mist/worker-state`; gateway binds `127.0.0.1:8788` and requires identity.

- [ ] **Step 2: Add the atom Dockerfile**

Create `deploy/atom/Dockerfile` for building `mist:atom-dev` from the zpool checkout before Portainer updates the stack.

- [ ] **Step 3: Add the runbook**

Create `docs/deploy-atom.md` with paths, deploy commands, image build command, Portainer API create/update commands, Tailscale Serve command, smoke tests, and rollback notes.

- [ ] **Step 4: Validate the compose syntax**

Run: `docker compose -f deploy/atom/docker-compose.yml config`
Expected: Compose renders without schema errors.

### Task 2: Atom Storage Migration

**Files:**
- No source files.

- [ ] **Step 1: Prepare host directories**

On atom, create `/zpool1/docker_configs/mist/app`, `/zpool1/docker_configs/mist/worker-state`, and `/zpool1/docker_configs/mist/backups`.

- [ ] **Step 2: Stop the temporary home-directory compose stack**

Run on atom: `cd /home/logikal/mist && docker compose stop`
Expected: `mist-mist-worker-1` and `mist-mist-gateway-1` stop cleanly.

- [ ] **Step 3: Copy existing local Cloudflare dev state**

Copy the current `mist_worker-state` Docker named volume into `/zpool1/docker_configs/mist/worker-state` before starting the Portainer stack.

- [ ] **Step 4: Copy the current repo snapshot**

Archive local `HEAD` into `/zpool1/docker_configs/mist/app` on atom.

### Task 3: Portainer Stack

**Files:**
- No source files.

- [ ] **Step 1: Check whether a `mist` Portainer stack already exists**

Use `GET /api/stacks` with the atom Portainer API token and endpoint id 2.

- [ ] **Step 2: Create or update the stack**

If the stack exists, update it with `PUT /api/stacks/{id}?endpointId=2`. Otherwise create it with `POST /api/stacks/create/standalone/string?endpointId=2`.

- [ ] **Step 3: Verify Portainer owns the running containers**

Run on atom: `docker ps --filter label=com.docker.compose.project=mist`
Expected: `mist-mist-worker-1` and `mist-mist-gateway-1` are running from the Portainer stack.

### Task 4: Tailscale And Smoke Tests

**Files:**
- No source files.

- [ ] **Step 1: Ensure Tailscale Serve points at the gateway**

Run on atom: `tailscale serve --https=443 --bg http://127.0.0.1:8788`
Expected: `tailscale serve status` shows `/ proxy http://127.0.0.1:8788`.

- [ ] **Step 2: Run health and auth checks**

Run locally:

```sh
curl -sS https://atom.tail6a522.ts.net/healthz
ssh logikal@atom 'curl -i -sS http://127.0.0.1:8788/ | head'
```

Expected: tailnet health returns `ok`; direct gateway root returns `401`.

- [ ] **Step 3: Verify existing document state survived**

Open `https://atom.tail6a522.ts.net/docs/oxn8nrqt` and confirm the document loads with the friendly name and saved version history.

- [ ] **Step 4: Commit**

Commit repo deployment artifacts with message `chore: document atom portainer deployment`.
