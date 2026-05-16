# Autosaved Versions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add autosaved document versions with a usable list-and-restore UI in the editor sidebar and mobile editing panel.

**Architecture:** Store version snapshots in each document Durable Object beside the live Yjs state. Autosave snapshots are captured from live Yjs updates at most once every 60 seconds, listed through the agent HTTP API, and restored through a POST action that replaces stored state, records an audit snapshot, closes active collaboration sockets, and lets the current UI reload to avoid re-syncing stale client CRDT state.

**Tech Stack:** TypeScript, React, React Router, Cloudflare Agents SDK, Durable Object SQLite, Yjs, Vitest, Testing Library.

---

## File Structure

- Create `app/shared/document-versions.ts`
  - Defines version reason and API summary types.
  - Defines `VERSION_AUTOSAVE_INTERVAL_MS` and `MAX_DOCUMENT_VERSIONS`.
- Modify `agents/document.ts`
  - Create `doc_versions` SQLite table.
  - Capture throttled autosave snapshots on live Yjs updates.
  - Add `GET /versions` and `POST /versions/:id/restore`.
  - Record a restore audit snapshot before replacing state.
  - Close active WebSocket connections after restore.
- Modify `tests/integration/agents/document-agent.test.ts`
  - Extend SQL mock for `doc_versions`.
  - Add autosave, list, throttle, restore, and alarm cleanup tests.
- Create `app/components/VersionsPanel.tsx`
  - Fetches version summaries.
  - Displays timestamp, reason, and author.
  - Restores with confirmation and reload callback.
- Create `tests/unit/components/versions-panel.test.tsx`
  - Tests fetch/list, empty state, restore POST, and refresh behavior.
- Modify `app/routes/docs.$id.tsx`
  - Adds `VersionsPanel` to desktop sidebar.
- Modify `app/components/MobilePanel.tsx`
  - Adds `VersionsPanel` to the mobile editing tab.
- Modify `tests/unit/components/mobile-panel.test.tsx`
  - Updates button-count expectations and verifies versions render in the editing tab.

---

### Task 1: Shared Version Types

**Files:**
- Create: `app/shared/document-versions.ts`

- [ ] **Step 1: Add shared version types**

Create `app/shared/document-versions.ts`:

```ts
export type DocumentVersionReason = "autosave" | "manual" | "restore";

export interface DocumentVersionSummary {
  id: string;
  docId: string;
  createdAt: number;
  createdBy: string | null;
  reason: DocumentVersionReason;
}

export interface DocumentVersionsResponse {
  versions: DocumentVersionSummary[];
}

export interface RestoreVersionResponse {
  ok: true;
  restoredVersionId: string;
}

export const VERSION_AUTOSAVE_INTERVAL_MS = 60_000;
export const MAX_DOCUMENT_VERSIONS = 100;
```

- [ ] **Step 2: Commit shared version types after first passing dependent test**

This file is committed with Task 2 because it has no behavior by itself.

---

### Task 2: Durable Object Version Storage And Restore

**Files:**
- Modify: `agents/document.ts`
- Modify: `tests/integration/agents/document-agent.test.ts`
- Create: `app/shared/document-versions.ts`

- [ ] **Step 1: Write failing agent version tests**

Extend the `DocumentAgent` test SQL mock with a `mockVersionRows` array that handles:

- `CREATE TABLE IF NOT EXISTS doc_versions`
- `INSERT INTO doc_versions`
- `SELECT id, createdAt, createdBy, reason FROM doc_versions`
- `SELECT state FROM doc_versions WHERE id = ${versionId}`
- `DELETE FROM doc_versions`

Add tests:

```ts
it("returns an empty version list before edits", async () => {
  await agent.onRequest(new Request("https://do/", { method: "POST" }));

  const res = await agent.onRequest(new Request("https://do/versions"));
  expect(await res.json()).toEqual({ versions: [] });
});

it("creates one autosave version after a live edit", async () => {
  await agent.onRequest(new Request("https://do/", { method: "POST" }));
  const client = connectYjsClient();

  client.doc.getText("default").insert(0, "first draft");

  const res = await agent.onRequest(new Request("https://do/versions"));
  const body = (await res.json()) as DocumentVersionsResponse;
  expect(body.versions).toHaveLength(1);
  expect(body.versions[0]).toMatchObject({
    docId: "test-doc",
    createdBy: null,
    reason: "autosave",
  });
  cleanup(client);
});

it("throttles autosave versions within the interval", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  await agent.onRequest(new Request("https://do/", { method: "POST" }));
  const client = connectYjsClient();

  client.doc.getText("default").insert(0, "a");
  client.doc.getText("default").insert(1, "b");

  const res = await agent.onRequest(new Request("https://do/versions"));
  const body = (await res.json()) as DocumentVersionsResponse;
  expect(body.versions).toHaveLength(1);
  cleanup(client);
  vi.useRealTimers();
});

it("restores a saved version and records a restore audit snapshot", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  await agent.onRequest(new Request("https://do/", { method: "POST" }));
  const client = connectYjsClient();
  const text = client.doc.getText("default");
  text.insert(0, "first");
  const versionRes = await agent.onRequest(new Request("https://do/versions"));
  const version = ((await versionRes.json()) as DocumentVersionsResponse).versions[0];
  vi.setSystemTime(1_061_000);
  text.insert(5, " second");

  const restoreRes = await agent.onRequest(
    new Request(`https://do/versions/${version.id}/restore`, { method: "POST" }),
  );

  expect(restoreRes.status).toBe(200);
  const versionsRes = await agent.onRequest(new Request("https://do/versions"));
  const versions = ((await versionsRes.json()) as DocumentVersionsResponse).versions;
  expect(versions.some((v) => v.reason === "restore")).toBe(true);

  cleanup(client);
  mockConnectionMap.clear();
  const restoredAgent = new DocumentAgent({} as never, {} as never);
  const restoredClient = connectYjsClient(restoredAgent);
  expect(restoredClient.doc.getText("default").toString()).toBe("first");
  cleanup(restoredClient);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run agent tests to verify they fail**

Run:

```bash
npx vitest run tests/integration/agents/document-agent.test.ts
```

Expected: FAIL because `/versions` endpoints and autosave storage do not exist.

- [ ] **Step 3: Implement version storage and restore**

In `agents/document.ts`:

- Add imports from `app/shared/document-versions`.
- Add `private autosaveSuppressed = false;`
- Add `private lastAutosaveAt = 0;`
- Create `doc_versions` table alongside `doc_state`.
- Add `createVersionSnapshot(reason, now, createdBy)`.
- Add `maybeAutosaveSnapshot(now)`.
- Add `listVersionSummaries()`.
- Add `restoreVersion(versionId, request)`.
- In the update listener, call `maybeAutosaveSnapshot(Date.now())` after state persistence unless suppressed.
- In POST initialization, suppress autosave while initial metadata/content is written.
- In `onRequest`, route:
  - `GET /versions`
  - `POST /versions/:id/restore`

Restore behavior:

- Read the selected version state.
- Snapshot the current state with reason `restore`.
- Replace `doc_state.state` with the selected snapshot.
- Touch metadata.
- Destroy in-memory Yjs/awareness state.
- Close active connections with code `1012` and reason `Document restored`.
- Return `{ ok: true, restoredVersionId }`.

- [ ] **Step 4: Run agent tests to verify they pass**

Run:

```bash
npx vitest run tests/integration/agents/document-agent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add app/shared/document-versions.ts agents/document.ts tests/integration/agents/document-agent.test.ts
git commit -m "feat: store document versions"
```

---

### Task 3: Versions Panel UI

**Files:**
- Create: `app/components/VersionsPanel.tsx`
- Create: `tests/unit/components/versions-panel.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Create tests that:

- mock `fetch`
- render with `renderWithDocument`
- assert version summaries render
- assert empty state renders
- click Restore, confirm, assert POST `/agents/document-agent/:docId/versions/:versionId/restore`
- assert refresh button reloads the list

- [ ] **Step 2: Run UI tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/components/versions-panel.test.tsx
```

Expected: FAIL because `VersionsPanel` does not exist.

- [ ] **Step 3: Implement `VersionsPanel`**

Create `app/components/VersionsPanel.tsx`:

- Uses `docId` from `useDocument`.
- Fetches `/agents/document-agent/${docId}/versions`.
- Renders `Versions (n)`, a Refresh button, empty state, list items, and Restore buttons.
- Uses compact MIST sidebar styling with existing `border-border`, `text-muted`, `font-mono`, and no decorative cards.
- Accepts optional test props:

```ts
interface VersionsPanelProps {
  reloadPage?: () => void;
  confirmRestore?: (version: DocumentVersionSummary) => boolean;
}
```

After successful restore, call `reloadPage()`.

- [ ] **Step 4: Run UI tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/components/versions-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add app/components/VersionsPanel.tsx tests/unit/components/versions-panel.test.tsx
git commit -m "feat: add versions panel"
```

---

### Task 4: Wire Versions Panel Into Editor Shell

**Files:**
- Modify: `app/routes/docs.$id.tsx`
- Modify: `app/components/MobilePanel.tsx`
- Modify: `tests/unit/components/mobile-panel.test.tsx`

- [ ] **Step 1: Write failing shell tests**

Update `tests/unit/components/mobile-panel.test.tsx`:

- Mock global `fetch` to return `{ versions: [] }`.
- Assert editing tab includes `Versions (0)`.

- [ ] **Step 2: Run shell tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/components/mobile-panel.test.tsx
```

Expected: FAIL because `MobilePanel` does not render `VersionsPanel`.

- [ ] **Step 3: Add panel to desktop and mobile shells**

In `app/routes/docs.$id.tsx`, import `VersionsPanel` and render it after suggestion/clean-view controls and before comment UI.

In `app/components/MobilePanel.tsx`, import `VersionsPanel` and render it in the editing tab after `SuggestionActions`.

- [ ] **Step 4: Run shell tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/components/mobile-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add 'app/routes/docs.$id.tsx' app/components/MobilePanel.tsx tests/unit/components/mobile-panel.test.tsx
git commit -m "feat: show versions in editor shell"
```

---

### Task 5: Final Verification

**Files:**
- Modify as needed based on verification failures.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/integration/agents/document-agent.test.ts tests/unit/components/versions-panel.test.tsx tests/unit/components/mobile-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

Run:

```bash
npm run test
```

Expected: PASS.

---

## Self-Review Checklist

- Spec coverage: implements autosave snapshot capture, listing, restoring, and UI in one vertical slice.
- Placeholder scan: no placeholders remain in executable steps.
- Type consistency: `DocumentVersionSummary`, API response shapes, and version reasons match across shared types, agent, component, and tests.
