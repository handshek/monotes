# Ordinary note sync and owners

Proposed on 31 October 2026 after an architecture review and a design session with the person who owns this repo. This is a plan, not an implementation. No application files were changed and no tests were run for this planning task.

Checkout inspected: `/Users/abhi/dev/monotes`, branch `master`, HEAD `62f31c7`. Behaviour described under "Why" comes from reading the code; none of it was reproduced by running the app.

Terms follow `CONTEXT.md`. The two decisions most likely to be questioned later are recorded in `docs/adr/0001-separate-owner-spaces.md` and `docs/adr/0002-version-check-for-ordinary-notes.md`.

## The promise

A Synced note follows its owner across devices, and no text is lost silently. Ordinary notes stay on their own path; they do not move onto collaboration.

## Why

Two modules each hold half of the fact "this note's text is safely stored", and that fact is never stored.

- **Dropped upload.** The pending upload exists only as a 3-second timer in `useDebouncedCloudSync`. Unmounting cancels it (`src/lib/sync-engine.ts:158`). On reopening, the upload baseline is read from Dexie, which already holds the unsent text (`:126`), so the cloud copy stays stale until the next edit. Only the sidebar's `openNote` flushes. Back, reload and New Note don't.
- **No reconnect.** An upload skipped offline never retries. `src/lib/auto-sync.ts` did this once and is commented out.
- **Stale device overwrite.** A device with a local row never pulls newer text (`src/components/notes/note-view.tsx:29`), and `syncNote` overwrites with no version check (`convex/notes.ts:39`). The welcome dialog promises sync across devices.
- **Blocked navigation.** `withRetry` backs off 15, 30 and 60 seconds, and `openNote` awaits it, so a failing upload can hold navigation for 105 seconds.
- **Scattered settle rule.** The same decision is written at `src/hooks/useLocalNote.ts:51`, `:82` and `:102`. 7 of the file's 13 commits are fixes.
- **Untruthful status.** `cloudStatus` stays `synced` while an upload is pending or has failed.
- **Account leak.** A Synced note edited after switching accounts quietly copies into the new account.
- **Resurrection.** `syncNote` clears `deletedAt`, so an edit on another device brings a deleted note back.
- **No tests.** No test imports `sync-engine` or `cloud-notes`. Four Playwright specs read the `monotes-draft:` format directly.

## Decisions

| Area | Decision |
| --- | --- |
| Sync promise | A version check on the ordinary path. A device that hasn't seen the latest cloud text can't overwrite it. |
| Module shape | A plain object per open note, with no React state, mirroring `CollabSession`. A thin hook binds it to the editor. |
| Upload owner | One app-level queue uploads any Synced note with text the cloud lacks, on change, app start and reconnect. Navigation never waits on it. |
| Version | A server revision number in a new optional field. Absent means 0, so rows need no backfill. |
| Pull timing | On open and while open, through the existing metadata subscription, only when the device has no unuploaded edits. |
| Conflict | Your typing stays in the editor. The cloud text goes to Kept text on this device, then your text uploads. |
| First contact | Matching text is adopted silently. If the text differs, the newer `updatedAt` wins and the other text goes to Kept text. |
| Old tabs | `syncNote` keeps working and bumps the revision. A later release removes it. |
| Deleted on another device | The note becomes Local only here, with a notice. It is neither destroyed nor resurrected. |
| Owner scope | Separate spaces: each owner sees only their own notes in the sidebar, search and direct links. |
| New notes | Owned by the current owner at creation, including Local only notes. |
| Current owner | Changes only on a confirmed sign-in or an explicit sign-out. An offline, lapsed or loading session keeps the last owner. |
| First sign-in | Offer to bring Local user notes into the account. They stay Local only, so signing in uploads nothing. Declined notes stay put, and the sidebar keeps the offer reachable. |
| Upgrade | On the first confirmed sign-in, an account claims notes it holds a cloud copy of. Everything else goes to the Local user. |
| Direct link | Another owner's note shows the same screen as a missing note, plus a sign-in link when signed out. |
| Status | Synced only when the cloud holds this text. Otherwise Syncing, Waiting to upload or Sign in to sync. Routine retries raise no toasts. |
| Rollout | Four stacked PRs, in the order below. |
| Tests | An in-memory cloud adapter and `fake-indexeddb`, with one contract suite that also runs against the real Convex functions. |

Out of scope: legacy note deletion (unchanged, as decided in the live agent editing plan, including the ignored `signed_out` result), the sending path for connected notes, and the Kept text module (review candidate 2), which follows this work as a small change.

## PR 1: note module and upload queue

Fixes the dropped upload and removes the navigation wait.

- Add a plain-object module for one open ordinary note. It owns the draft, the row write and the single settle decision that `useLocalNote` writes three times. It accepts its storage and cloud dependencies rather than creating them.
- Add an app-level upload queue behind a cloud adapter with Convex and in-memory implementations. The queue debounces by 3 seconds, retries with capped backoff, and reacts to app start and the `online` event. A per-note lock stops two tabs uploading the same note.
- Dexie version 5 stores a durable pending-upload marker, written in the same transaction as the row. **The queue only handles notes with a marker**, so it never sweeps old rows before owners exist. Notes left stale before this ships stay stale until their next edit.
- Pause the queue from `useConvexAuth` rather than by matching error text.
- `useLocalNote` becomes a thin binding, keeping the fields `NotesEditor` uses: `note`, `saveError`, `replacedRevision`, `loadError`, `setMarkdown` and `saveNow`.
- Delete `useDebouncedCloudSync`. `SyncModal` uses the new path, and a failed first upload leaves the note Local only.
- `openNote` no longer waits on ordinary notes. `NoteSyncContext` stays for the connected note flush only.
- Delete `src/lib/auto-sync.ts` and the unused hooks and exports in `sync-engine.ts`, `cloud-notes.ts` and `local-notes.ts`, after confirming each has no caller.

Start with a failing test that reproduces the dropped upload. If it doesn't fail, stop and re-examine the trace before building.

## PR 2: owners

- Dexie version 6 adds an indexed `owner` to notes, plus the current owner in device storage shared by tabs. The current owner must be readable before auth settles, and nothing renders a note list until it is known.
- `currentUser` confirms a sign-in. `handleSignOut` is the only thing that moves the device to the Local user. A session Convex reports as unauthenticated without a sign-out changes nothing.
- Filter the sidebar (`notes-sidebar.tsx:78`), search (`useNoteSearch.ts:20`), and opening a note (`note-view.tsx:25`) by the current owner. Stamp the owner at every creation site: `createNewNote`, `hydrateCloudNote` and `markConnected`. Check the agent access surfaces, which read local rows for titles.
- Add a Convex query returning the signed-in account's note ids, without text, to drive the upgrade claim. Rows with no owner count as the Local user's until claimed.
- Add the first sign-in offer. Follow Sodium, and Commit Mono per `AGENTS.md`.
- The upload queue handles only the current owner's notes. Kept text follows its note, so it needs no owner of its own.
- A slug already on this device under another owner opens as not found. Slugs are random, so a real collision isn't expected.

## PR 3: revision, pull and conflicts

- Add an optional `revision` to `notes`. Add a mutation taking the note, text and base revision, returning a typed result: ok, conflict with the cloud text, deleted, connected or signed out. `syncNote` and `updateNote` bump the revision. A signed-in explicit Sync to cloud may reuse a tombstone; background uploads never do.
- `openInfo` adds the revision and `updatedAt`, still without text.
- The device stores the last cloud revision it saw, and the module and queue apply this table:

| Device | Cloud | Result |
| --- | --- | --- |
| Unuploaded edits | Unchanged | Upload |
| No edits | Newer | Pull into the editor |
| Unuploaded edits | Newer | Cloud text to Kept text, adopt that revision, upload |
| No recorded revision | Same text | Adopt the revision |
| No recorded revision | Different text | Newer `updatedAt` wins, other text to Kept text |
| No recorded revision | No cloud row | Upload |
| Any | Deleted | Becomes Local only, with a notice |
| Any | Connected | Existing `NoteView` switch |

- Add a Kept text reason for the cloud version, and render `RecoveryNotice` in `NotesEditor`, using the existing `addRecovery`. This adds a 12th write site, which candidate 2 later absorbs.
- Update the README's "Storage and sync" section. The welcome dialog's promise becomes true and needs no change.

## PR 4: truthful status

- The queue exposes each note's upload state, and `NotesMetadataBar` shows Synced, Syncing, Waiting to upload or Sign in to sync, using Sodium's `Status`.
- Remove the `syncing` and `ai-enabled` values from `cloudStatus` if nothing writes them by then.

## Testing

- **Module and queue:** Vitest with jsdom and `fake-indexeddb`, which `session.test.ts` already uses, and the in-memory adapter. Cover the dropped upload, reload with a pending upload, reconnect, retry, two tabs, and every row of the PR 3 table.
- **Owners:** sign-out hiding, an offline session keeping the owner, claim on upgrade, and the first sign-in offer.
- **Contract suite:** one set of adapter behaviours run against the in-memory adapter and against the real Convex functions through `convex-test`. This prevents the drift `FakeServer` has today.
- **Playwright:** existing specs stay as end-to-end checks. Moving them off the `monotes-draft:` format is optional follow-up.
- **Cross-device:** the README says authenticated sync across devices is not covered. Add a two-device flow to `tests/collab-e2e` if its harness supports it. Otherwise verify by hand and say so in the PR.

Before finishing any PR with UI changes, run `bun run lint:sodium`, `bun run lint` and `bun run typecheck`.

## Open risks

- **Convex auth offline.** How `useConvexAuth` reports an offline or lapsed session wasn't verified. The current owner rule is designed not to depend on it, but PR 2 must test it.
- **Pull into the editor.** `NotesEditor` uses a controlled `value`. A pulled note must not disturb the cursor or Vim mode. Test this in PR 3 before relying on pull while open.
- **Error messages in production.** Convex production may redact `Error` messages, which would break the `Not authenticated` check in `withRetry`. This wasn't verified. PR 1 stops relying on it, and PR 3's typed results replace it.
- **Forward-only storage.** Dexie versions 5 and 6 can't be rolled back on devices that have upgraded, so the claim logic in PR 2 needs extra care.
- **Old-tab gap.** Until `syncNote` is removed, an old tab can still overwrite newer cloud text. Other devices see the bumped revision, so their own edits are protected.
- **Sign-out looks different.** Notes disappearing on sign-out is a visible change for existing people. It needs clear wording in PR 2.
