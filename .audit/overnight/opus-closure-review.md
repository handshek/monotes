# Claude Opus closure review: `codex/monotes-overnight` at `4be3e38`

**Verdict: the notification finding from my follow-up is closed. Nothing here blocks the work.** There is one new low-severity gap: a third code path where the same silent replacement can happen. I found it by reading the code; it isn't reproduced in a browser.

**What I reviewed:**
- Working directory `/Users/abhi/.codex/worktrees/monotes-overnight/monotes`, HEAD `4be3e38f8b8be9ed6f1367806ebd51b5957d8281`.
- The two commits since `8a44e4c` (`5b93094`, `4be3e38`). They change only `src/hooks/useLocalNote.ts`, `src/components/notes/notes-editor.tsx` and the two new test files.
- `src/` has no uncommitted changes. The five SHA-256 hashes in `complete-provenance.json` match the files on disk.

## Is the earlier finding closed? Yes

- **When another tab's edit arrives** (`useLocalNote.ts:99-104`): if a newer stored revision replaces a pending draft with different text, the hook now reports it.
- **When this tab's own save finds a newer row** (`useLocalNote.ts:57-60`): the hook compares against the current pending draft at the moment it settles, not just the draft that save attempt wrote. That's the correct reference.
- **What stays quiet:**
  - Same text: the content check means no notice.
  - A remote edit when this tab has nothing pending.
  - A deleted note (`!saved` / `!stored`). The editor shows "Note not found" instead.
  - This tab's own typing: a pending draft only settles against a revision at least as new as itself, and only another tab can produce a newer one with different text.
- **No double reporting:** only one path can settle a given pending draft, because whichever runs first clears it. A manual save that hits the same replacement uses the same stable toast id (`notes-editor.tsx:51-53`), so you get one toast.
- **Nothing fires after unmount:** the `activeSlugRef` guard at `:56` runs before any state update.
- **Evidence matches the claims:**
  - `observed-save/before`: 4 intended failures and 8 passing controls.
  - `automatic-save/before`: 4 intended failures, all on the notice check only.
  - `complete/report.json`: 84/84 passed, no failures, flaky cases or retries.
  - Typecheck is clean; lint shows only the 2 warnings in files this branch didn't touch; harness lint is clean.
  - The provenance file records the source commit, a clean source status, the build ID and the explicit server command.

## New finding

### Low: on reload, the same replacement is still silent

- **Where:** `src/hooks/useLocalNote.ts:82-84`.
- **Mechanism:** when a note loads, recovery reads the session draft. If the stored revision is newer, it deletes the draft and returns with no notice.
- **Trigger:**
  1. In tab A, a save fails. The alert says "Keep this tab open and try saving again."
  2. Meanwhile, tab B edits the same note.
  3. The user reloads tab A, or navigates away and back within it.
- **Result:** A loads B's text, and A's draft disappears without any notice. Had A stayed open, lines 99-104 would have shown "Updated from another tab". So the same replacement is reported or not depending on whether the user reloaded.
- **Test coverage:** `tests/persistence.spec.ts:68-90` exercises exactly this path. It asserts the newer text wins and the draft is cleared, but checks nothing about a notice either way.
- **Severity:** low, and not a regression from the original code. It needs a failed save, or a reload landing in the milliseconds before the write commits, plus a concurrent edit in another tab.
- **Possible fix:** in that branch, when `stored && stored.content !== recovered.content`, call `setReplacedRevision(recovered.localRevision)`. Whether you want a notice on load is a product call.

## Notes (not defects)

- **What the notice covers:** it reports only a pending draft in the tab that observes the replacement. The automatic-save test needs its 60-second clock offset because in the natural order the stale tab wins instead. It then overwrites the other tab's committed edit, and that tab just sees an ordinary remote update with no notice. That is the documented latest-edit-wins policy. The notice is not conflict detection, and the READMEs say so.
- **Quiet-control timing:** the controls that check nothing appears (`tests/observed-save.spec.ts:56-60` and `:92-93`) wait two animation frames, then check that the toast isn't visible. A toast that appeared later would slip past them. The no-notice logic is a plain string comparison, so this is a theoretical weakness only.
- **Test coupling:** `tests/automatic-save.spec.ts:24` and `tests/save-ack.spec.ts:36` depend on Dexie's internal channel name `x-storagemutated-1`. If Dexie renames it, the tests fail visibly rather than passing falsely.
- **Still uncommitted:** `tests/README.md`, `scripts/benchmark-notes.ts` and the `.audit/` evidence aren't in HEAD yet. Your final audit commit is meant to add them.

## What I couldn't verify

- I ran no tests, builds, servers or browsers. Pass counts and timings come from the saved artifacts.
- Cloud sync is still unverified, and full offline reload is still unsupported.

## Plan-mode gate

This session is still in plan mode, which would normally end with an approval request. As you asked, I'm reporting the gate instead: I'm not requesting write access, and there is no write plan.
