// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { ExternalChange } from "@uiw/react-codemirror";
import { keepCursorOnCloudText } from "../../src/lib/cloud-text-extension";

let view: EditorView;

function open(doc: string, cursor: number) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [vim(), keepCursorOnCloudText] }),
  });
}

/* The same transaction the editor's value prop sends when the note changes. */
function pull(text: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: [ExternalChange.of(true)],
  });
}

afterEach(() => view.destroy());

describe("pulling cloud text into the editor", () => {
  it("keeps the cursor when text arrives after it", () => {
    open("first\nsecond", 3);
    pull("first\nsecond\nthird");
    expect(view.state.doc.toString()).toBe("first\nsecond\nthird");
    expect(view.state.selection.main.head).toBe(3);
  });

  it("moves the cursor with its text when text arrives before it", () => {
    open("second line", 7);
    pull("first line\nsecond line");
    expect(view.state.doc.line(2).text).toBe("second line");
    expect(view.state.selection.main.head).toBe(18);
  });

  it("keeps a selection outside the change", () => {
    open("alpha beta gamma", 0);
    view.dispatch({ selection: EditorSelection.range(0, 5) });
    pull("alpha beta delta");
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 5 });
  });

  it("stays in Vim insert mode", () => {
    open("alpha", 5);
    const cm = getCM(view)!;
    Vim.handleKey(cm, "i", "test");
    expect(cm.state.vim?.insertMode).toBe(true);
    pull("alpha\nbeta");
    expect(getCM(view)!.state.vim?.insertMode).toBe(true);
  });

  it("stays an external change, so it isn't saved back as typing", () => {
    open("alpha", 0);
    const tr = view.state.update({
      changes: { from: 0, to: 5, insert: "alpine" },
      annotations: [ExternalChange.of(true)],
    });
    expect(tr.annotation(ExternalChange)).toBe(true);
    expect(tr.newDoc.toString()).toBe("alpine");
  });

  it("leaves typing alone", () => {
    open("alpha", 5);
    view.dispatch({ changes: { from: 5, insert: "!" }, selection: { anchor: 6 } });
    expect(view.state.doc.toString()).toBe("alpha!");
    expect(view.state.selection.main.head).toBe(6);
  });
});
