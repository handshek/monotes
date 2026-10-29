import { createTheme } from "@uiw/codemirror-themes";
import { EditorView } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const cmAppearanceTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent" },
    // Notes are edited as Markdown source, so the editor sets them in Sodium's mono.
    "&.cm-editor": {
      color: "inherit",
      fontFamily: "var(--font-mono)",
      outline: "none",
      border: "none",
      backgroundColor: "transparent",
    },
    ".cm-content": { color: "inherit", fontFamily: "inherit" },
    ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6" },
    // The caret shows where typing goes, so the text area takes no focus ring; Sodium's would show
    // as a bright bar beside the line numbers, the only edge the scroller doesn't clip.
    ".cm-content:focus-visible": { outline: "none" },
    // Vim's block cursor covers a character cell and is placed on the placeholder's first child,
    // so while it shows, a one-character spacer takes the cell and the words stay readable.
    ".cm-placeholder-gap": { display: "none" },
    "&:has(.cm-fat-cursor) .cm-placeholder-gap": { display: "inline" },
    // Line numbers sit behind a rule; the current line's number reads in ink, not a wash.
    ".cm-gutters": {
      backgroundColor: "transparent",
      borderRight: "1px solid var(--line)",
      color: "var(--text-3)",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-1)" },
    // Vim's command line and messages: a ruled panel under Sodium's overlays.
    "&.cm-editor .cm-panels.cm-panels-bottom, &.cm-editor .cm-panels.cm-panels-top": {
      backgroundColor: "var(--panel)",
      color: "var(--text-1)",
      borderColor: "var(--line)",
      zIndex: "var(--z-raised)",
    },
    ".cm-vim-panel": { fontFamily: "var(--font-mono)", minHeight: "var(--row-sm)", alignItems: "center" },
    // codemirror-vim sets its messages to red inline.
    ".cm-vim-message": { color: "var(--fail-text) !important" },
    ".cm-content::after": {
      content: '""',
      display: "block",
      height: "25vh",
    },
  },
  { dark: false }
);

export const cmColorTheme = createTheme({
  theme: "light",
  settings: {
    background: "transparent",
    foreground: "var(--text-1)",
    caret: "var(--caret)",
    selection: "var(--selected)",
    selectionMatch: "color-mix(in oklab, var(--selected) 60%, transparent)",
    gutterBackground: "transparent",
    gutterForeground: "var(--text-3)",
    lineHighlight: "var(--hover)",
  },
  styles: [
    { tag: t.heading, textWrap: "balance" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.link, textDecoration: "underline", color: "var(--accent-text)" },
    { tag: t.quote, color: "var(--text-2)" },
    { tag: t.monospace, fontFamily: "var(--font-mono)" },
  ],
});

export const cmHighlightStyles = HighlightStyle.define([
  {
    tag: t.heading1,
    fontSize: "clamp(1.125rem, calc(0.9rem + 2.2cqi), 2.25rem)",
    lineHeight: "1.2",
  },
  {
    tag: t.heading2,
    fontSize: "clamp(1rem, calc(0.9rem + 1.6cqi), 1.5rem)",
    lineHeight: "1.3",
  },
  {
    tag: t.heading3,
    fontSize: "clamp(0.9375rem, calc(0.875rem + 1.0cqi), 1.25rem)",
    lineHeight: "1.4",
  },
  {
    tag: t.monospace,
    fontFamily: "var(--font-mono)",
    backgroundColor: "var(--well)",
    padding: "0 0.25rem",
  },
]);

export function editorThemeExtensions() {
  return [
    cmAppearanceTheme,
    cmColorTheme,
    EditorView.lineWrapping,
    syntaxHighlighting(cmHighlightStyles),
  ];
}

/** An empty note's placeholder, with the spacer Vim's block cursor sits on (see .cm-placeholder-gap). */
export function notePlaceholder(): HTMLElement {
  const element = document.createElement("span");
  const gap = document.createElement("span");
  gap.className = "cm-placeholder-gap";
  gap.textContent = "\u00a0";
  element.append(gap, "Start typing");
  return element;
}
