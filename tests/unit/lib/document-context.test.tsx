// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { createElement } from "react";
import { useDocument, _DocumentContext } from "~/lib/DocumentContext";
import { createMockDocumentContext, renderWithDocument } from "../../helpers/document-context";

describe("useDocument", () => {
  it("throws when used outside DocumentProvider", () => {
    expect(() => {
      renderHook(() => useDocument());
    }).toThrow("useDocument must be used within a DocumentProvider");
  });

  it("returns context value when inside provider", () => {
    const mockValue = createMockDocumentContext({ docId: "abc" });

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(_DocumentContext.Provider, { value: mockValue }, children);

    const { result } = renderHook(() => useDocument(), { wrapper });
    expect(result.current.docId).toBe("abc");
  });
});

describe("renderWithDocument", () => {
  it("renders a component that reads context", () => {
    function DocIdDisplay() {
      const { docId } = useDocument();
      return createElement("div", { "data-testid": "doc-id" }, docId);
    }

    const { getByTestId } = renderWithDocument(createElement(DocIdDisplay), {
      context: { docId: "test-123" },
    });

    expect(getByTestId("doc-id").textContent).toBe("test-123");
  });
});
