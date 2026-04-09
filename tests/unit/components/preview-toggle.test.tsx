// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import PreviewToggle from "~/components/PreviewToggle";

describe("PreviewToggle", () => {
  it("shows active state when preview showing", () => {
    const { getByText } = renderWithDocument(createElement(PreviewToggle), {
      context: { showPreview: true },
    });
    const button = getByText("Preview");
    expect(button.className).toContain("bg-ink");
  });

  it("shows inactive state when preview not showing", () => {
    const { getByText } = renderWithDocument(createElement(PreviewToggle), {
      context: { showPreview: false },
    });
    const button = getByText("Preview");
    expect(button.className).toContain("text-muted");
  });

  it("click calls togglePreview", () => {
    const { contextValue, getByText } = renderWithDocument(
      createElement(PreviewToggle),
    );
    fireEvent.click(getByText("Preview"));
    expect(contextValue.togglePreview).toHaveBeenCalledOnce();
  });

  it("shows spinner when not synced and not active", () => {
    const { container } = renderWithDocument(createElement(PreviewToggle), {
      context: {
        showPreview: false,
        yjs: {
          doc: {} as never,
          awareness: {} as never,
          socket: null as never,
          synced: false,
          user: { name: "Test", color: "#000", colorLight: "#ccc" },
          mode: "edit" as const,
          setMode: () => {},
          docState: {} as never,
        },
      },
    });
    expect(container.querySelector("svg.animate-spin")).toBeTruthy();
  });
});
