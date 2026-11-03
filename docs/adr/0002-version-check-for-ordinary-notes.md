# Ordinary notes use a version check, not collaboration

Synced ordinary notes follow their owner across devices through a server revision number and whole-note uploads, not through the collaboration path that connected notes use. Collaboration would merge edits properly, but every Synced note would then carry server history, checkpoints and per-tab queues for a benefit only connected notes need, and it would reverse the live agent editing plan's decision not to migrate unrelated notes. Ordinary notes only need to avoid losing text silently, and Kept text already gives the losing side of a conflict somewhere safe to go.

## Considered Options

- **Move every Synced note onto collaboration.** Gives real merging, at the cost above.
- **Treat the cloud as a one-way backup.** Needs no new behaviour, but ships a known silent overwrite and breaks the promise of sync across devices.

## Consequences

- Concurrent edits to an ordinary note conflict rather than merge. The editor keeps the person's typing, and the cloud text goes to Kept text on that device.
- Connecting a note for agents remains the way to get merging.
