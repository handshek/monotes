# Each owner has a separate space on a device

Every note on a device belongs to an owner, either a signed-in account or the Local user, and each owner sees only their own notes in the sidebar, search and direct links. Signing out hides a person's notes without deleting them. We chose this over using owners only to route uploads, because a shared computer should not show one person's notes to another, and because uploading into whichever account is signed in quietly copied private notes between accounts.

## Considered Options

- **Owners route uploads only.** Much smaller, but everyone on the device can still read every note.
- **Pause uploads for notes from another account.** Stops the copying, but leaves the notes visible and adds a state that owners make unnecessary.

## Consequences

- The current owner changes only on a confirmed sign-in or an explicit sign-out. An offline, lapsed or loading session keeps the last owner, so notes don't vanish when auth can't be confirmed.
- A note made while signed in belongs to that account even if it stays Local only. Owner says whose a note is; Local only and Synced say where it lives.
- First sign-in offers to bring Local user notes into the account, because otherwise it looks like data loss. Signing in still uploads nothing.
