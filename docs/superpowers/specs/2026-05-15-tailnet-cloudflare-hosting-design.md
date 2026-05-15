# Tailnet Cloudflare Hosting Design

## Goal

Host MIST for company use at a tailnet URL while keeping the existing Cloudflare Worker, Durable Object, and Yjs collaboration architecture. Tailscale is the user-facing trust boundary and identity source. Cloudflare remains the private collaboration and document storage backend.

## Current State

MIST currently runs as a Cloudflare Worker with one `DocumentAgent` Durable Object per public document. The Durable Object holds a Yjs document in memory, persists encoded Yjs state to its SQLite storage, relays WebSocket collaboration messages, and deletes document state through a 99-hour alarm. Documents are public by URL and have no ownership metadata.

The current expiration behavior is app policy, not a Cloudflare storage limitation. The 99-hour auto-delete is implemented by writing `createdAt`, setting a Durable Object alarm, and deleting `doc_state` when the alarm fires.

## Architecture

MIST keeps Cloudflare as the backend runtime and storage layer. Users access MIST through a tailnet service:

```text
Tailnet browser
  -> https://mist.<tailnet>.ts.net
  -> Tailscale Serve
  -> local mist-gateway
  -> Cloudflare Access-protected MIST Worker
  -> DocumentAgent Durable Object
```

The local gateway is intentionally small. It proxies HTTP requests and WebSocket upgrades to the Cloudflare Worker, reads trusted Tailscale identity headers, forwards normalized identity headers to MIST, and attaches a Cloudflare Access service token so the Worker is reachable only through the gateway. It does not store documents, understand Yjs, or implement application behavior.

Cloudflare Access protects the Worker route. Direct public browser traffic to the Worker is rejected. Normal users come through Tailscale. Break-glass admin access is out of scope for the implementation plan and can be configured separately in Cloudflare Access.

## Security Boundary

Tailscale authenticates users and provides identity. The gateway authenticates to Cloudflare with a service token. Cloudflare Access blocks direct public access to the Worker. The Worker treats forwarded identity as trustworthy only when the request has passed the gateway service-token path.

The gateway must strip incoming `x-mist-*` identity headers before adding its own normalized headers. It should forward only a narrow allowlist of identity values derived from Tailscale, such as:

- `x-mist-user-id`
- `x-mist-user-login`
- `x-mist-user-name`

The browser must use the tailnet gateway URL for all app, API, and WebSocket traffic. The Cloudflare service token must never be exposed to client code.

## Document Metadata And Retention

Documents get explicit metadata instead of relying on loose storage keys:

```ts
type DocumentRetention =
  | { mode: "persistent" }
  | { mode: "ttl"; expiresAt: number };

type DocumentMetadata = {
  id: string;
  createdAt: number;
  updatedAt: number;
  owner: {
    id: string | null;
    login: string | null;
    name: string | null;
  };
  retention: DocumentRetention;
};
```

New company documents default to persistent retention. Expiration remains available as an explicit policy, using `retention: { mode: "ttl", expiresAt }`. The existing 99-hour behavior becomes a selectable policy instead of the baseline.

Ownership is metadata at this stage, not access control. Documents remain public by URL. A document created without identity, such as during local development, stores a null owner.

The Durable Object keeps the live Yjs state blob and stores metadata as a single serialized record. During the first metadata slice, reads support legacy documents by deriving metadata from existing `exists` and `createdAt` keys when the serialized metadata record is missing. A Durable Object alarm is scheduled only for TTL documents. On alarm, the object deletes the document only when the metadata still has TTL retention and `expiresAt <= Date.now()`.

The document page should show expiration text only for TTL documents. Persistent documents should not say that they auto-delete.

## Gateway And Deployment

The gateway runs locally, likely in Docker beside a Tailscale sidecar. Tailscale Serve exposes the tailnet HTTPS URL and routes traffic to the gateway container.

The gateway responsibilities are:

- proxy normal HTTP traffic to the Cloudflare Worker
- proxy WebSocket collaboration traffic to the Cloudflare Worker
- inject Cloudflare Access service-token headers
- strip spoofable incoming identity headers
- forward normalized Tailscale identity headers
- preserve request methods, bodies, response headers, status codes, and WebSocket behavior

Local development should continue to work without Tailscale identity. Missing identity creates anonymous-owner documents unless a deployment sets `MIST_REQUIRE_IDENTITY=true`.

## Autosaved Versions

Versioning is a vertical slice, not a backend-only layer. When versioning is implemented, it includes storage, HTTP behavior, and UI in the same shippable change.

Versions are snapshots of the live Yjs document:

```ts
type DocumentVersion = {
  id: string;
  docId: string;
  createdAt: number;
  createdBy: string | null;
  reason: "autosave" | "manual" | "restore";
  state: Uint8Array;
};
```

The live Yjs state remains the source of truth for collaboration. Versions do not include awareness or cursor state. Autosave snapshots are captured after meaningful edits and throttled to at most one snapshot per active document every 60 seconds.

Versions are stored in a `doc_versions` table in the same `DocumentAgent` SQLite database. Because each Durable Object represents one document, listing and restoring versions remains local to the object.

The first usable versioning slice includes:

- snapshot capture and pruning
- version list endpoint
- restore endpoint or action
- a small Versions UI panel or sidebar section
- restore confirmation
- author identity and timestamp display where available

Restore should create an auditable `reason: "restore"` version around the replacement operation. After restore, connected clients should receive the restored document state.

Snapshot failures must not block live collaboration.

## Implementation Slices

1. **Retention and ownership metadata**
   - Add metadata storage to `DocumentAgent`.
   - Default new documents to persistent retention.
   - Preserve optional TTL expiration.
   - Update route loader data and UI copy.
   - Capture owner metadata from forwarded identity headers when available.

2. **Tailnet gateway**
   - Add a small proxy service for HTTP and WebSocket traffic.
   - Inject Cloudflare Access service-token headers.
   - Normalize Tailscale identity headers.
   - Strip spoofable inbound identity headers.
   - Add Docker/Portainer-oriented deployment docs.

3. **Autosaved versions with UI**
   - Add version snapshot storage.
   - Add list and restore actions.
   - Add UI for viewing and restoring versions.
   - Add pruning and failure handling.

## Testing

Retention tests should cover persistent documents, TTL documents, alarm behavior, metadata returned by the agent, and display copy for persistent versus expiring documents.

Gateway tests should cover header stripping, identity normalization, service-token injection, HTTP proxying, and WebSocket upgrade proxying.

Version tests should cover autosave throttling, version pruning, listing, restore behavior, restore audit snapshots, and live-client synchronization after restore.

## Non-Goals

This design does not make documents private by owner. It does not add a user dashboard, per-user library, billing, or a full local replacement for Cloudflare Durable Objects. Those can be built later on top of the owner metadata and gateway identity path.
