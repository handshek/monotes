Read-only focused code review. User rejected our prior note-search dialog: "the note does not have a border, the input is being clipped. No shortcut. Why can't you just use cmd-K?" Their intent is a standard shadcn/cmdk in-place search palette preserving minimal design and note persistence.

Exact checkout /Users/abhi/.codex/worktrees/monotes-overnight/monotes, branch codex/monotes-overnight, baseline HEAD c6a4174eb9c8125bea876bb6624a34d8c9e24f84. Initially clean; changes are currently uncommitted. Confirm your working directory and HEAD before review. Do not create or switch worktrees.

Scope:
- src/components/ui/command.tsx (new shadcn-style primitives wrapping actual cmdk@1.1.1)
- src/components/notes/notes-search-dialog.tsx
- src/components/notes/notes-sidebar.tsx
- package.json and bun.lock
- tests/command-search.spec.ts (new), tests/search-dialog.spec.ts, tests/regressions.spec.ts
- .gitignore and .audit/command-search/ evidence

Behavior: fixed search header; only results scroll; bordered result note cards. Cmd/Ctrl+K opens/toggles search globally in notes UI, intercepting capture before CodeMirror Ctrl+K can delete text, consuming repeats without retoggling. Arrow keys and Enter use cmdk. Escape restores actual opener. Search remains on the current note URL. Shared existing useNoteSearch retains substring/local/cloud behavior with cmdk shouldFilter=false. Explicit openNote(id) preserves save/sync-before-navigation. Native modified-click result links still open new tabs without closing search.

Evidence verified: baseline 4 expected browser failures for no shortcut, clipped input ring, 0px result borders. Final fresh production build and full suite repeated twice: 108/108 passed, no retries/skips/flakes. Lint passes with two pre-existing warnings; typecheck passes. Exact source hashes/build ID and results in .audit/command-search/source-provenance.json. Before/after images in evidence/. Root manually reproduced and rechecked actual desktop and mobile UI through browser. Tests cover both Meta+K and Control+K at line start, toggle, Escape focus/text, home invocation, arrow/Enter, native modified-click new tab, touch, offline filtering, short-viewport scrolling/header stability, note create/edit/reload and concurrency. Cloud authenticated sync remains unverified, unchanged scope.

Inspect the diff, new files and relevant surrounding code. Report only actionable correctness, regression, security or maintainability issues with severity, exact file/line and evidence; distinguish real defects from test preferences and pre-existing behavior. Conclude concisely when complete.

READ ONLY. Do not modify files, commit, push, deploy, run tests/builds/servers, or dispatch reviewers. Do not recursively invoke AGENTS review policy. Keep approval-required runtime and plan interaction, the Supervised permission ceiling. Do not request write approval or disturb the user's dev server on port 3000.
