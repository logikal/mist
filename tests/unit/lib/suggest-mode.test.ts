import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { Schema } from "@tiptap/pm/model";
import { suggestModePlugin } from "~/lib/suggest-mode";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] as const },
    text: { inline: true },
  },
  marks: {
    criticAddition: {
      inclusive: false,
      excludes: "criticDeletion criticComment",
      toDOM: () => ["span", { class: "cm-addition" }, 0] as const,
    },
    criticDeletion: {
      inclusive: false,
      excludes: "criticAddition criticComment",
      toDOM: () => ["span", { class: "cm-deletion" }, 0] as const,
    },
    criticComment: {
      inclusive: false,
      toDOM: () => ["span", { class: "cm-comment" }, 0] as const,
    },
    criticHighlight: {
      inclusive: false,
      attrs: { threadId: { default: null } },
      toDOM: () => ["span", { class: "cm-highlight" }, 0] as const,
    },
  },
});

function createState(text: string, cursorPos?: number) {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
  const state = EditorState.create({
    doc,
    plugins: [suggestModePlugin({ get: () => "suggest" })],
  });
  if (cursorPos !== undefined) {
    return state.apply(
      state.tr.setSelection(
        TextSelection.near(state.doc.resolve(cursorPos)),
      ),
    );
  }
  return state;
}

function createStateWithMarks(
  nodes: { text: string; mark?: string }[],
  cursorPos?: number,
) {
  const children = nodes.map(({ text, mark }) => {
    if (mark) {
      return schema.text(text, [schema.marks[mark].create()]);
    }
    return schema.text(text);
  });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, children.length > 0 ? children : undefined),
  ]);
  const state = EditorState.create({
    doc,
    plugins: [suggestModePlugin({ get: () => "suggest" })],
  });
  if (cursorPos !== undefined) {
    return state.apply(
      state.tr.setSelection(
        TextSelection.near(state.doc.resolve(cursorPos)),
      ),
    );
  }
  return state;
}

function createEditModeState(text: string) {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
  return EditorState.create({
    doc,
    plugins: [suggestModePlugin({ get: () => "edit" })],
  });
}

/** Check if text at a given position has a specific mark */
function hasMarkAtPos(state: EditorState, pos: number, markName: string): boolean {
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  return node.marks.some((m) => m.type.name === markName);
}

describe("suggestModePlugin", () => {
  describe("handleTextInput in edit mode", () => {
    it("allows normal text insertion", () => {
      const state = createEditModeState("hello");
      const plugin = state.plugins[0];
      const result = plugin.props.handleTextInput?.(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { state, dispatch: () => {} } as any,
        1,
        1,
        "x",
      );
      expect(result).toBe(false);
    });
  });

  describe("handleTextInput in suggest mode", () => {
    it("inserts text with criticAddition mark", () => {
      const state = createState("hello");
      const plugin = state.plugins[0];
      let dispatched: EditorState | null = null;

      const result = plugin.props.handleTextInput?.(
        {
          state,
          dispatch: (tr) => { dispatched = state.apply(tr); },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        6, 6, "x",
      );
      expect(result).toBe(true);
      expect(dispatched).not.toBeNull();
      expect(dispatched!.doc.textContent).toBe("hellox");
      // PM doc: <p>"hello"(1-6, no mark) "x"(6-7, addition mark)</p>
      expect(hasMarkAtPos(dispatched!, 6, "criticAddition")).toBe(true);
    });

    it("extends existing addition when cursor is inside", () => {
      // "a" + marked "bc" + "d" — cursor inside the addition
      const state = createStateWithMarks([
        { text: "a" },
        { text: "bc", mark: "criticAddition" },
        { text: "d" },
      ]);
      const plugin = state.plugins[0];
      let dispatched: EditorState | null = null;

      // pos 3 is inside "bc" (which starts at 2 in PM: a=1, b=2, c=3)
      const result = plugin.props.handleTextInput?.(
        {
          state,
          dispatch: (tr) => { dispatched = state.apply(tr); },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        3, 3, "x",
      );
      // Plugin handles explicitly (inclusive is false, so PM won't extend)
      expect(result).toBe(true);
      expect(dispatched).not.toBeNull();
      expect(dispatched!.doc.textContent).toBe("abxcd");
      // The inserted 'x' should have the criticAddition mark
      expect(hasMarkAtPos(dispatched!, 3, "criticAddition")).toBe(true);
    });

    it("selecting and replacing inside addition keeps addition mark", () => {
      // "a" + marked "hello" + "b" — select "ell" inside the addition
      const state = createStateWithMarks([
        { text: "a" },
        { text: "hello", mark: "criticAddition" },
        { text: "b" },
      ]);
      const plugin = state.plugins[0];
      let dispatched: EditorState | null = null;

      // "hello" starts at PM 2, so "ell" is PM 3..6
      const result = plugin.props.handleTextInput?.(
        {
          state,
          dispatch: (tr) => { dispatched = state.apply(tr); },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        3, 6, "x",
      );
      // Plugin handles explicitly to preserve addition mark
      expect(result).toBe(true);
      expect(dispatched).not.toBeNull();
      expect(dispatched!.doc.textContent).toBe("ahxob");
      // Replacement 'x' should still have the criticAddition mark
      expect(hasMarkAtPos(dispatched!, 3, "criticAddition")).toBe(true);
    });

    it("marks selection as deletion and inserts new text as addition", () => {
      // "hello world" — select "world" (PM 7..12) and type "x"
      const state = createState("hello world");
      const plugin = state.plugins[0];
      let dispatched: EditorState | null = null;

      const result = plugin.props.handleTextInput?.(
        {
          state,
          dispatch: (tr) => { dispatched = state.apply(tr); },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        7, 12, "x",
      );
      expect(result).toBe(true);
      expect(dispatched).not.toBeNull();
      // Text content unchanged for deletion part + new insertion
      expect(dispatched!.doc.textContent).toBe("hello worldx");
      // PM doc: "hello "(1-7) + "world"(7-12, deletion) + "x"(12-13, addition)
      expect(hasMarkAtPos(dispatched!, 7, "criticDeletion")).toBe(true);
      expect(hasMarkAtPos(dispatched!, 12, "criticAddition")).toBe(true);
    });
  });

  describe("handleKeyDown (backspace) in suggest mode", () => {
    it("selecting and deleting inside addition does normal delete", () => {
      const state = createStateWithMarks([
        { text: "a" },
        { text: "hello", mark: "criticAddition" },
        { text: "b" },
      ]);
      const plugin = state.plugins[0];

      // Select "ell" inside addition (PM 3..6)
      const withSelection = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 3, 6)),
      );

      const result = plugin.props.handleKeyDown?.(
        {
          state: withSelection,
          dispatch: () => {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { key: "Backspace" } as KeyboardEvent,
      );
      expect(result).toBe(false);
    });

    it("selecting and deleting inside deletion is a no-op", () => {
      const state = createStateWithMarks([
        { text: "a" },
        { text: "hello", mark: "criticDeletion" },
        { text: "b" },
      ]);
      const plugin = state.plugins[0];

      const withSelection = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 3, 6)),
      );

      const result = plugin.props.handleKeyDown?.(
        {
          state: withSelection,
          dispatch: () => {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { key: "Backspace" } as KeyboardEvent,
      );
      expect(result).toBe(true);
    });

    it("selecting and deleting plain text applies deletion mark", () => {
      const state = createState("hello world");
      const plugin = state.plugins[0];
      let dispatched: EditorState | null = null;

      const withSelection = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 7, 12)),
      );

      const result = plugin.props.handleKeyDown?.(
        {
          state: withSelection,
          dispatch: (tr) => { dispatched = withSelection.apply(tr); },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { key: "Backspace" } as KeyboardEvent,
      );
      expect(result).toBe(true);
      expect(dispatched).not.toBeNull();
      // Text stays, but "world" has deletion mark
      expect(dispatched!.doc.textContent).toBe("hello world");
      // PM doc: "hello "(1-7) + "world"(7-12, deletion)
      expect(hasMarkAtPos(dispatched!, 7, "criticDeletion")).toBe(true);
      // Cursor should be before the deletion
      expect(dispatched!.selection.from).toBe(7);
    });

    it("single char backspace applies deletion mark", () => {
      const state = createState("hello", 6);
      const plugin = state.plugins[0];
      let dispatched: EditorState | null = null;

      plugin.props.handleKeyDown?.(
        {
          state,
          dispatch: (tr) => { dispatched = state.apply(tr); },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { key: "Backspace" } as KeyboardEvent,
      );
      expect(dispatched).not.toBeNull();
      // Text unchanged but 'o' has deletion mark
      expect(dispatched!.doc.textContent).toBe("hello");
      // PM doc: "hell"(1-5) + "o"(5-6, deletion)
      expect(hasMarkAtPos(dispatched!, 5, "criticDeletion")).toBe(true);
      // Cursor should be before the deleted char
      expect(dispatched!.selection.from).toBe(5);
    });

    it("consecutive backspaces build up deletion marks", () => {
      // After first backspace: "hello" with 'o' marked as deletion, cursor at 5
      const state = createStateWithMarks([
        { text: "hell" },
        { text: "o", mark: "criticDeletion" },
      ], 5);
      const plugin = state.plugins[0];
      let dispatched: EditorState | null = null;

      plugin.props.handleKeyDown?.(
        {
          state,
          dispatch: (tr) => { dispatched = state.apply(tr); },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { key: "Backspace" } as KeyboardEvent,
      );
      expect(dispatched).not.toBeNull();
      // 'l' should now also have deletion mark
      expect(dispatched!.doc.textContent).toBe("hello");
      // PM doc: "hel"(1-4) + "l"(4-5, deletion) + "o"(5-6, deletion)
      expect(hasMarkAtPos(dispatched!, 4, "criticDeletion")).toBe(true);
      expect(dispatched!.selection.from).toBe(4);
    });

    it("backspace inside addition allows normal delete", () => {
      const state = createStateWithMarks([
        { text: "hello" },
        { text: "x", mark: "criticAddition" },
      ], 7); // cursor after 'x'
      const plugin = state.plugins[0];

      const result = plugin.props.handleKeyDown?.(
        {
          state,
          dispatch: () => {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { key: "Backspace" } as KeyboardEvent,
      );
      expect(result).toBe(false);
    });

    it("backspace inside deletion is a no-op", () => {
      const state = createStateWithMarks([
        { text: "hel" },
        { text: "lo", mark: "criticDeletion" },
      ], 5); // cursor inside deletion (after 'l' of 'lo')
      const plugin = state.plugins[0];

      const result = plugin.props.handleKeyDown?.(
        {
          state,
          dispatch: () => {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { key: "Backspace" } as KeyboardEvent,
      );
      expect(result).toBe(true);
    });

    it("backspace at start of paragraph is not intercepted", () => {
      const state = createState("hello", 1);
      const plugin = state.plugins[0];

      const result = plugin.props.handleKeyDown?.(
        {
          state,
          dispatch: () => {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        { key: "Backspace" } as KeyboardEvent,
      );
      expect(result).toBe(false);
    });
  });
});
