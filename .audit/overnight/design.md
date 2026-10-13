# Selected implementation design

## Persistence

Keep NoteContent as the stored note record. Add an optional localRevision with clock and actor to compare edits without changing the IndexedDB schema. Existing records use updatedAt as their revision clock.

Persist an empty note before navigating to it. Saving and replaying drafts update existing notes only, so pending work cannot recreate a deleted note.

Record each edit synchronously in sessionStorage under its note ID. Start a read/write IndexedDB transaction immediately. Compare the pending and stored revisions in that transaction and keep the newer record. Clear only the exact pending revision that has committed or lost to newer text.

Use Dexie observation for committed changes across tabs. Keep the latest optimistic edit until an equal or newer committed note arrives. A missing stored note means deletion. Remove the old raw-content broadcast path and the 500 ms local save debounce. Keep cloud debounce unchanged.

Manual save waits for local persistence before requesting cloud sync or showing success. Autosave failures keep text available and show that it is unsaved.

The alternative was direct IndexedDB writes alone. That removes the 500 ms loss window but leaves recovery unproven when a write is interrupted by reload. Shared localStorage drafts were rejected because tabs can race while clearing the same key. Session recovery covers same-tab reload. It is not a claim of recovery after abrupt browser termination.

## Search

Reuse the existing home search input. The sidebar Search action navigates to it and focuses it. A new search modal would duplicate an existing interface and expand the design without fixing another need.

## Mobile navigation

Dismiss the drawer in the sidebar navigation actions. A pathname-only effect misses clicks on the active note. Preserve modified-link clicks so users can still open notes in another tab.

## Scope limits

Do not expand into cloud synchronization changes without authenticated end-to-end verification. Offline data persistence and offline application boot are separate checks. This pass keeps the existing app shell and records its lack of reliable offline reload support.
