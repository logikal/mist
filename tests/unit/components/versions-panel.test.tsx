// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import VersionsPanel from "~/components/VersionsPanel";
import type { DocumentVersionSummary } from "~/shared/document-versions";

const version: DocumentVersionSummary = {
  id: "version-1",
  docId: "test-doc",
  createdAt: Date.UTC(2026, 4, 16, 18, 30),
  createdBy: "sean@example.com",
  reason: "autosave",
};

function jsonResponse(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("VersionsPanel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders fetched version summaries", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ versions: [version] }));

    const { findByText, getByText } = renderWithDocument(
      createElement(VersionsPanel),
    );

    expect(await findByText("Versions (1)")).toBeTruthy();
    expect(getByText("Autosave")).toBeTruthy();
    expect(getByText("sean@example.com")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/agents/document-agent/test-doc/versions",
    );
  });

  it("renders an empty state", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ versions: [] }));

    const { findByText } = renderWithDocument(createElement(VersionsPanel));

    expect(await findByText("Versions (0)")).toBeTruthy();
    expect(await findByText("No versions yet")).toBeTruthy();
  });

  it("posts a restore request and reloads the page", async () => {
    const reloadPage = vi.fn();
    const confirmRestore = vi.fn(() => true);
    fetchMock
      .mockReturnValueOnce(jsonResponse({ versions: [version] }))
      .mockReturnValueOnce(jsonResponse({ ok: true, restoredVersionId: version.id }));

    const { findByText, getByRole } = renderWithDocument(
      createElement(VersionsPanel, { reloadPage, confirmRestore }),
    );
    await findByText("Versions (1)");

    fireEvent.click(getByRole("button", { name: "Restore autosave version" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/agents/document-agent/test-doc/versions/version-1/restore",
        { method: "POST" },
      );
    });
    expect(confirmRestore).toHaveBeenCalledWith(version);
    expect(reloadPage).toHaveBeenCalledOnce();
  });

  it("refreshes the version list", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ versions: [] }))
      .mockReturnValueOnce(jsonResponse({ versions: [version] }));

    const { findByText, getByRole } = renderWithDocument(
      createElement(VersionsPanel),
    );
    await findByText("Versions (0)");

    fireEvent.click(getByRole("button", { name: "Refresh versions" }));

    expect(await findByText("Versions (1)")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("saves a manual version and refreshes the list", async () => {
    const manualVersion: DocumentVersionSummary = {
      ...version,
      id: "manual-version",
      reason: "manual",
    };
    fetchMock
      .mockReturnValueOnce(jsonResponse({ versions: [] }))
      .mockReturnValueOnce(jsonResponse({ ok: true, version: manualVersion }))
      .mockReturnValueOnce(jsonResponse({ versions: [manualVersion] }));

    const { findByText, getByRole } = renderWithDocument(
      createElement(VersionsPanel),
    );
    await findByText("Versions (0)");

    fireEvent.click(getByRole("button", { name: "Save version" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "/agents/document-agent/test-doc/versions",
        { method: "POST" },
      );
    });
    expect(await findByText("Versions (1)")).toBeTruthy();
    expect(await findByText("Manual")).toBeTruthy();
  });
});
