// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { fireEvent } from "@testing-library/react";
import { renderWithDocument } from "../../helpers/document-context";
import ModeToggle from "~/components/ModeToggle";

describe("ModeToggle", () => {
  it("shows 'Edit mode' when mode is edit", () => {
    const { getByText } = renderWithDocument(createElement(ModeToggle), {
      context: { mode: "edit" },
    });
    expect(getByText("Edit mode")).toBeTruthy();
  });

  it("shows 'Suggest changes' when mode is suggest", () => {
    const { getByText } = renderWithDocument(createElement(ModeToggle), {
      context: { mode: "suggest" },
    });
    expect(getByText("Suggest changes")).toBeTruthy();
  });

  it("toggle calls toggleMode", () => {
    const { contextValue, getByLabelText } = renderWithDocument(
      createElement(ModeToggle),
    );
    fireEvent.click(getByLabelText("Toggle suggest mode"));
    expect(contextValue.toggleMode).toHaveBeenCalledOnce();
  });
});
