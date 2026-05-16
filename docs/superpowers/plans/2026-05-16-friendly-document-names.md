# Friendly Document Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public friendly name for each MIST document so anyone with the link can understand what the document is for.

**Architecture:** Store the public name on `DocumentMetadata` as `name: string | null`. The `DocumentAgent` remains the source of truth and exposes a small metadata update endpoint that updates the document index. The document header edits the name inline, and the home owned-document list displays the name with the immutable document id as secondary context.

**Tech Stack:** React Router 7, Cloudflare Agents/Durable Objects SQLite, React Testing Library, Vitest.

---

### Task 1: Metadata And Index Contract

**Files:**
- Modify: `app/shared/document-metadata.ts`
- Modify: `agents/document-index.ts`
- Test: `tests/integration/agents/document-index-agent.test.ts`

- [ ] **Step 1: Write the failing test**

Add an index-agent test that posts a document with `name: "Customer incident"` and expects the list response to include the same name.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/agents/document-index-agent.test.ts -t name`
Expected: FAIL because `DocumentMetadata` and the index rows do not preserve `name`.

- [ ] **Step 3: Write minimal implementation**

Add `name: string | null` to `DocumentMetadata` and `CreateDocumentMetadataInput`. Create metadata with `name: null`. Add a nullable `name` column to `document_index`, migrate existing tables with `ALTER TABLE`, select/insert/update it, and map it into index entries.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/agents/document-index-agent.test.ts -t name`
Expected: PASS.

### Task 2: Rename Endpoint

**Files:**
- Modify: `agents/document.ts`
- Test: `tests/integration/agents/document-agent.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that `PATCH /metadata` trims and stores `{ name }`, clears whitespace names to `null`, rejects non-owner renames for owned documents, and allows public Agents-routed metadata patches.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/agents/document-agent.test.ts -t "metadata|name|rename"`
Expected: FAIL because the endpoint does not exist.

- [ ] **Step 3: Write minimal implementation**

Add name normalization, a `PATCH /metadata` branch, owner matching like delete, metadata write/update-index behavior, and a JSON response `{ ok: true, metadata }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/agents/document-agent.test.ts -t "metadata|name|rename"`
Expected: PASS.

### Task 3: UI Vertical Slice

**Files:**
- Modify: `app/routes/docs.$id.tsx`
- Modify: `app/routes/home.tsx`
- Test: `tests/unit/routes/docs-id.test.tsx`
- Test: `tests/unit/routes/home.test.tsx`

- [ ] **Step 1: Write failing tests**

Add tests that the document page renders an editable friendly name field, sends `PATCH /agents/document-agent/:id/metadata`, displays the saved title, and the home list renders document names before ids.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/routes/docs-id.test.tsx tests/unit/routes/home.test.tsx -t "name|friendly|title"`
Expected: FAIL because the UI still only shows ids.

- [ ] **Step 3: Write minimal implementation**

Replace the header id-only display with a compact title input plus id subtitle. Keep the existing minimal visual language: plain borderless header input, no modal, no decorative status. Show errors inline only when save fails. Update home list text and accessible labels to prefer `document.name ?? document.id`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/routes/docs-id.test.tsx tests/unit/routes/home.test.tsx -t "name|friendly|title"`
Expected: PASS.

### Task 4: Verification And Atom Deploy

**Files:**
- No new source files.

- [ ] **Step 1: Run affected tests**

Run: `npx vitest run tests/integration/agents/document-agent.test.ts tests/integration/agents/document-index-agent.test.ts tests/unit/routes/docs-id.test.tsx tests/unit/routes/home.test.tsx`
Expected: PASS.

- [ ] **Step 2: Run full verification**

Run: `npm run typecheck && npm run lint && npm run test && npm run build && npm run gateway:build`
Expected: all commands exit 0.

- [ ] **Step 3: Deploy to atom**

Archive `HEAD` to `/home/logikal/mist/app`, rebuild/restart compose, and smoke test `https://atom.tail6a522.ts.net/`.

- [ ] **Step 4: Commit**

Commit all feature changes with message `feat: add friendly document names`.
