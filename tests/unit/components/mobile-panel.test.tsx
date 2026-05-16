// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import MobilePanel from "~/components/MobilePanel";

describe("MobilePanel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ versions: [] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the panel tabs", async () => {
    const { getByText, findByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );
    expect(getByText("Editing")).toBeTruthy();
    expect(getByText("Comments")).toBeTruthy();
    expect(getByText("Preview")).toBeTruthy();
    await findByText("Versions (0)");
  });

  it("clicking a tab shows corresponding content, clicking again collapses", async () => {
    const { getByText, queryByText, findByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
      { context: { mode: "suggest" } },
    );

    // Editing tab starts active, should show ModeToggle content
    expect(queryByText("Suggest changes")).toBeTruthy();
    await findByText("Versions (0)");

    // Click Comments tab
    fireEvent.click(getByText("Comments"));
    expect(queryByText("Comments (0)")).toBeTruthy();

    // Click Comments tab again to collapse
    fireEvent.click(getByText("Comments"));
    expect(queryByText("Comments (0)")).toBeFalsy();
  });

  it("editing tab renders ModeToggle and SuggestionActions", async () => {
    const { getByText, getByLabelText, findByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );

    // Editing tab is active by default
    // ModeToggle shows "Edit mode" when mode is "edit"
    expect(getByText("Edit mode")).toBeTruthy();
    expect(getByLabelText("Toggle suggest mode")).toBeTruthy();
    await findByText("Versions (0)");
  });

  it("editing tab renders document versions", async () => {
    const { findByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
    );

    expect(await findByText("Versions (0)")).toBeTruthy();
  });

  it("comments tab renders CommentInput and ThreadList", async () => {
    const { getByText, queryByText, findByText } = renderWithDocument(
      createElement(MobilePanel, { className: "lg:hidden" }),
      { context: { commentActive: true } },
    );

    await findByText("Versions (0)");
    fireEvent.click(getByText("Comments"));
    expect(queryByText("Comment")).toBeTruthy();
    expect(queryByText("No comments yet")).toBeTruthy();
  });
});
