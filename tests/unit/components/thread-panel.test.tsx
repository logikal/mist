// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { render, fireEvent } from "@testing-library/react";
import ThreadPanel from "~/components/ThreadPanel";

const makeThread = (overrides = {}) => ({
  id: "t1",
  commentText: "Test comment",
  highlightText: undefined as string | undefined,
  author: { name: "Alice", color: "#E57373", colorLight: "#FFCDD2" },
  createdAt: Date.now(),
  resolved: false,
  replies: [] as Array<{
    id: string;
    author: { name: string; color: string; colorLight: string };
    text: string;
    createdAt: number;
  }>,
  position: 0,
  ...overrides,
});

describe("ThreadPanel", () => {
  const defaultProps = () => ({
    thread: makeThread(),
    active: false,
    onSelect: vi.fn(),
    onReply: vi.fn(),
    onResolve: vi.fn(),
    onDelete: vi.fn(),
  });

  it("renders author name and comment text without color dot", () => {
    const props = defaultProps();
    const { getByText, container } = render(createElement(ThreadPanel, props));

    expect(getByText("Alice")).toBeTruthy();
    expect(getByText("Test comment")).toBeTruthy();

    // No color dot span
    const dots = container.querySelectorAll(".rounded-full");
    expect(dots).toHaveLength(0);
  });

  it("applies bg-border/50 when active", () => {
    const props = { ...defaultProps(), active: true };
    const { container } = render(createElement(ThreadPanel, props));

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("bg-canary/15");
  });

  it("has no active background when inactive", () => {
    const props = defaultProps();
    const { container } = render(createElement(ThreadPanel, props));

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).not.toContain("bg-border/50");
    expect(wrapper.className).not.toContain("border-coral");
  });

  it("toggle: clicking active thread deselects (passes null)", () => {
    const props = { ...defaultProps(), active: true };
    const { container } = render(createElement(ThreadPanel, props));

    fireEvent.click(container.firstElementChild!);
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it("toggle: clicking inactive thread selects it", () => {
    const props = defaultProps();
    const { container } = render(createElement(ThreadPanel, props));

    fireEvent.click(container.firstElementChild!);
    expect(props.onSelect).toHaveBeenCalledWith("t1");
  });

  it("renders highlight context with text-base", () => {
    const props = {
      ...defaultProps(),
      thread: makeThread({ highlightText: "Some highlighted text" }),
    };
    const { getByText } = render(createElement(ThreadPanel, props));

    const highlight = getByText("Some highlighted text");
    expect(highlight.className).toContain("text-base");
  });

  it("renders replies with vertical border line and no color dots", () => {
    const props = {
      ...defaultProps(),
      thread: makeThread({
        replies: [
          {
            id: "r1",
            author: { name: "Bob", color: "#42A5F5", colorLight: "#BBDEFB" },
            text: "A reply",
            createdAt: Date.now(),
          },
        ],
      }),
    };
    const { getByText, container } = render(createElement(ThreadPanel, props));

    expect(getByText("Bob")).toBeTruthy();
    expect(getByText("A reply")).toBeTruthy();

    // Replies container has border-l
    const repliesContainer = container.querySelector(".border-l.border-border.pl-3");
    expect(repliesContainer).toBeTruthy();

    // No color dots
    const dots = container.querySelectorAll(".rounded-full");
    expect(dots).toHaveLength(0);
  });

  it("renders action button bar with bordered styling", () => {
    const props = defaultProps();
    const { getByText } = render(createElement(ThreadPanel, props));

    const replyBtn = getByText("Reply");
    const resolveBtn = getByText("Resolve");
    const deleteBtn = getByText("Delete");

    // Check button styling classes
    expect(replyBtn.className).toContain("uppercase");
    expect(replyBtn.className).toContain("tracking-wider");
    expect(resolveBtn.className).toContain("text-green-600");
    expect(deleteBtn.className).toContain("text-red-500");

    // Parent bar has border
    const bar = replyBtn.parentElement!;
    expect(bar.className).toContain("border");
    expect(bar.className).toContain("border-border");
  });

  it("resolve button shows Reopen for resolved thread", () => {
    const props = {
      ...defaultProps(),
      thread: makeThread({ resolved: true }),
    };
    const { getByText } = render(createElement(ThreadPanel, props));
    expect(getByText("Reopen")).toBeTruthy();
  });

  it("action buttons call correct handlers", () => {
    const props = defaultProps();
    const { getByText } = render(createElement(ThreadPanel, props));

    fireEvent.click(getByText("Resolve"));
    expect(props.onResolve).toHaveBeenCalledWith("t1");

    fireEvent.click(getByText("Delete"));
    expect(props.onDelete).toHaveBeenCalledWith("t1");
  });

  it("reply input appears on Reply click and submits on Enter", () => {
    const props = defaultProps();
    const { getByText, getByPlaceholderText } = render(
      createElement(ThreadPanel, props),
    );

    fireEvent.click(getByText("Reply"));
    const input = getByPlaceholderText("Reply...");
    expect(input).toBeTruthy();

    fireEvent.change(input, { target: { value: "My reply" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onReply).toHaveBeenCalledWith("t1", "My reply");
  });

  it("action button clicks do not trigger thread selection", () => {
    const props = defaultProps();
    const { getByText } = render(createElement(ThreadPanel, props));

    fireEvent.click(getByText("Resolve"));
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});
