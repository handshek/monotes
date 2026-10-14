# Claude Opus review: `codex/monotes-overnight`

I found no demonstrated correctness, data-loss or security defect in the three fixes. There is one medium-severity performance risk, which is a hypothesis I couldn't measure. There are also two low-severity findings. The review was read-only: I edited nothing, didn't write the plan file, and dispatched no other reviewers.

**What I reviewed:** `/Users/abhi/.codex/worktrees/monotes-overnight/monotes` at HEAD `d3308196207778ebc13ab2b05efa4413837b0292`, which was clean when I started. I reviewed the full diff from `b6f6051`. Commit `d330819` touches only `.audit/`, so the code is identical to the implementation commit `f2b13ba`.

## Findings

### 1. Medium (hypothesis, not measured): every keystroke now triggers a full-library read and sidebar re-render, in every open tab

- **Where:** `src/hooks/useLocalNote.ts:114-115`, which feeds `src/components/notes/notes-sidebar.tsx:62-66` and `:187-191`.
- **What changed:**
  - **Before:** saves used a trailing 500ms debounce (`useDebounced(saveNow, 500)`; `src/hooks/useDebounced.ts:14-17` resets the timer on every call). During continuous typing, IndexedDB wasn't written until the user paused.
  - **Now:** each keystroke does a session-draft write, a read-and-write IndexedDB transaction, and two or three full-content `JSON.parse` calls through `clearPendingDraft` (lines 48, 52, 96).
  - **Effect:** each commit re-runs the sidebar query `getDB().notes.orderBy("updatedAt").reverse().toArray()`, which loads every note's full content. The sidebar then re-renders and runs `/[^\s\n]+/g` over each note's entire content just to show 20 preview words. Dexie also pushes the update to every other open tab, so their sidebars repeat the work.
- **Trigger:** a library of a few hundred notes of several KB each, plus continuous typing. The cost grows with total library size and is paid per keystroke rather than per pause. The test suite only uses tiny, freshly created data, so it can't show this.
- **How to confirm:** seed about 200 notes of about 20KB each, type continuously, and compare input latency against baseline in a Performance trace.
- **Possible fix:** bound the sidebar preview work (slice the content before the regex), coalesce IndexedDB writes, or both. Coalescing means keeping one write in flight with latest-wins, or a short debounce with a maximum wait that flushes on `pagehide`/`visibilitychange`. The synchronous session draft already covers the same-tab reload window, so keep writing it on every keystroke.

### 2. Low (confirmed in code, needs a cross-tab race): Save can say "Saved" when this tab's text was discarded

- **Where:** `src/lib/local-notes.ts:12-14`, `src/hooks/useLocalNote.ts:50` and `:118-127`, `src/components/notes/notes-editor.tsx:50-56`.
- **Mechanism:** when the stored revision is equal or newer, `saveNote` returns the existing row. `persist` counts that as settled, the `saveNow` loop exits normally, and `handleSave` shows "Saved". The same path runs for Ctrl-S and Vim `:w`.
- **Trigger:** the same note is open in two tabs. Tab B commits an edit with a later clock while tab A has an uncommitted draft, and tab A then presses Ctrl-S.
- **Result:** tab A shows "Saved", and its editor switches to tab B's content. Discarding the older draft is the intended latest-edit-wins design. The success message is what's wrong.
- **Possible fix:** have `persist` report whether the draft was actually applied, and show a neutral message such as "Updated from another tab" when it wasn't.

### 3. Low (maintainability, evidence accuracy): the new lint scope pulls in generated files

- **Where:** `package.json:9`, `eslint.config.mjs:12-14`, `.audit/overnight/final-lint.log`.
- **Problem:** the new script lints `convex`, including `convex/_generated`, and the ESLint config has no ignore for it. That accounts for 4 of the 6 warnings ("Unused eslint-disable directive" in the generated files).
- **Why the claim is off:** the baseline script was `next lint`, which Next 16 no longer ships, and it didn't cover `convex/` by default. So those 4 warnings come from the new lint scope; they didn't predate this work. Only `convex/auth.config.ts:1` and `src/components/settings/appearance-settings.tsx:110` look like warnings that were already there.
- **Fix:** add `{ ignores: ["convex/_generated/**"] }` to the ESLint config and correct the "six app lint warnings predate this work" wording in the morning review.

## Not defects, but worth knowing before merging

- **Empty notes now pile up.** "New note" writes the empty note immediately (`src/lib/local-notes.ts:30`). Abandoned new notes stay forever and show as their raw ID in the sidebar (`src/components/notes/notes-sidebar.tsx:191`) or as "Untitled note" on home. The brief accepted this, but before this change untouched new notes were never stored.
- **The audit commit is in branch history.** `d330819` adds 43 tracked files under `.audit/` (screenshots and multi-thousand-line JSON reports). Drop or squash it before any merge to `master` unless you want them kept.

## Checked and found sound

- **Revision handling:** revisions (`compareNoteRevisions`, `createDraft`) can't go backwards and are tied to the note's current revision. Writes are transactional and update-only, so a deleted note can't come back.
- **Hook ordering:** the recovery effect runs before the pending-clear effect. Settlement on unmount and the `saveNow` loop terminate correctly. A failed write leaves its session draft behind, but the revision check discards it after reload.
- **Cloud sync code:** `sync-engine.ts` only updates `cloudStatus` with partial `update()` calls, which works with `{...existing, ...draft}` writes. `convex/notes.ts` never compares `updatedAt`. `src/lib/auto-sync.ts` is entirely commented out.
- **Search params:** `useSearchParams` without a Suspense boundary is fine because every route builds as dynamic (`ƒ`).
- **Mobile drawer and Search:** the drawer closes on note selection and creation. Modifier-key clicks still open normally. Search reuses the home screen and focuses its input.
- **Tests:** they assert stored IndexedDB content, not just the screen. The reload-timing test and the 750ms wait in the cross-tab test depend on the machine's speed, but they're acceptable.

## What I couldn't verify

- I ran no tests, build, dev server or browser, so I'm relying on the committed logs and reports for the 56/56 pass.
- Finding 1 is unmeasured.
- I didn't re-check the withdrawn concern about `/new` creating two notes in development, because that needs a running dev server.
- Cloud sync is still untested, since there was no signed-in session.

## Plan-mode gate

This session is in plan mode, which normally ends with an approval request through ExitPlanMode. As you asked, I'm reporting the gate instead of calling it. I'm not requesting write access, and there is no write plan.
