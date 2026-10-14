# Claude Opus review: in-place note search dialog

**Verdict: no correctness, regression or security defects.** I found two low-severity maintainability and test-coverage items; neither blocks. The review is complete and was read-only.

**What I reviewed:**
- Working directory `/Users/abhi/.codex/worktrees/monotes-overnight/monotes`, branch `codex/monotes-overnight`, HEAD `4e3e434b3b351ba6dae6f57289092fab9c5d92bf`.
- The uncommitted implementation: 4 modified files plus `notes-search-dialog.tsx`, `useNoteSearch.ts` and `search-dialog.spec.ts`. I read the diff ignoring whitespace (the sidebar diff is mostly re-indentation) and the surrounding code.
- The six SHA-256 hashes in `verified-provenance.json` match the files on disk.

## Findings

### 1. Low (maintainability): the old `?search=true` code on the home page can't be reached from the app any more

- **Where:** `src/app/(notes)/notes-search-list.tsx:20-28` and `:83`.
- **Evidence:** the sidebar no longer pushes `/?search=true` or focuses `#notes-search`. A search of `src` and `tests` finds no remaining producer of `search=true` or user of `getElementById("notes-search")`.
- **What's left:** the `useSearchParams` / `useSidebar().openMobile` focus effect and `id="notes-search"` now run only when someone opens an old `/?search=true` URL. In that case the effect also refocuses the home input whenever the mobile drawer closes.
- **Fix:** remove the effect, the ref, the `id` and the two hooks, or add a comment saying they are kept on purpose for old URLs.

### 2. Low (test gap): modified clicks on search results aren't tested

- **Where:** `src/components/notes/notes-search-dialog.tsx:85`; no test in `tests/search-dialog.spec.ts`.
- **What line 85 does:** for Ctrl, Cmd, Shift or Alt clicks it returns early. The dialog stays open and the browser handles the link natively (e.g. opens a new tab).
- **Why it matters:** the brief lists "native modified links remain usable" as expected behaviour, but no test exercises it. If the guard were removed or moved after `onOpenChange(false)`, a Ctrl/Cmd-click would close the dialog and every test would still pass.
- **Fix:** a desktop-only case that Ctrl/Cmd-clicks a result, then asserts the dialog is still visible and the URL is unchanged.

## Areas checked and found sound

- **Dialog and mobile Sheet lifetime:**
  - The dialog is rendered outside `<Sidebar>` (`notes-sidebar.tsx`, fragment with `NotesSearchDialog` after `</Sidebar>`), so the mobile Sheet unmounting doesn't take the dialog with it.
  - The mobile Sheet has no Radix trigger, so its close can't steal focus from the search input.
  - Radix's stacked layers restore the body's `pointer-events` once the last modal closes. The tests rely on this implicitly by reopening the sidebar after Escape and Close.
- **Focus:**
  - The input is the first focusable element, so it gets focus when the dialog opens.
  - On cancel, focus returns to the Search button on desktop. On mobile that button is gone with the Sheet, so focus falls back to the navbar's Toggle sidebar button. Both outcomes are asserted.
  - `selectedNote` is reset each time the dialog opens. Selecting a result focuses the editor, and a newly mounted editor also focuses itself through `onCreateEditor`.
- **Selecting a result:**
  - `selectNote` closes the dialog, then calls the existing `handleNoteClick`. That handler calls `preventDefault` synchronously before its first `await`, so the Next.js `Link` doesn't navigate a second time.
  - Selecting the current note uses the normal `Link` path. The editor is keyed by note id, so it doesn't remount and edits stay intact. This is asserted.
  - Selecting a different note runs the existing save and sync before navigating, and the current note's stored content is asserted afterwards.
- **Shared search hook (`useNoteSearch.ts`):**
  - It keeps the old logic: trimmed 300ms debounce, case-insensitive substring match on local notes, and cloud-only results appended after local matches.
  - The cloud query is skipped for an empty query. `convex/notes.ts:101-110` returns `[]` when signed out, so cloud search can't break the page for users who aren't logged in.
  - Side effect: the home page's `isLoading` used to be always false (because of `|| []`). Now the skeleton actually shows while notes load, which is an improvement.
  - The dialog's local-notes subscription only exists while the dialog is open.
- **Rendering cost:** with an empty query, `HighlightedText` renders at most 500 characters per note (`highlighted-text.tsx:18-20`), so the unfiltered list stays bounded per item.
- **Evidence matches the claims:**
  - `before/report.json`: the URL-unchanged check failed on both engines.
  - `focused/report.json`: 6/6 passed.
  - `verified/report.json`: 96/96 passed (46 desktop + 50 mobile runs), no failures, skips or flaky cases.
  - Typecheck is clean; lint shows only the 2 warnings in files this change didn't touch.

## Notes (not defects)

- **Inherited waiting on result clicks:** clicking a different note waits for the existing save-and-sync before navigating, as you intended. For a cloud-synced note with a stalled Convex connection, the dialog closes but navigation can wait until the sync finishes or gives up. That behaviour already applied to sidebar note links; it now also applies to search results.
- **DOM coupling:** focus restoration finds its targets by DOM selector (`.cm-content[contenteditable="true"]` and `nav button[aria-label="Toggle sidebar"]`, `notes-search-dialog.tsx:98-100`). It's covered by the focus assertions, so a markup change would fail a test rather than break silently.

## What I couldn't verify

- I didn't run any tests, builds or servers, and didn't touch the user's dev server. Results come from the saved artifacts.
- Cloud search merging is still unverified without a signed-in session.

## Plan-mode gate

This session is still in plan mode, which would normally end with an approval request. As you asked, I'm reporting the gate instead: I'm not requesting write access, and there is no write plan.
