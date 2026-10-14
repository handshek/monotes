# External review reproduction: misleading save acknowledgement

The valid baseline run uses the unchanged application at `d3308196207778ebc13ab2b05efa4413837b0292`, rebuilt and restarted after an unrelated build interruption. `before-verified/report.json` contains four repeatable failures: twice in desktop Chromium and twice in mobile WebKit. The earlier `before/` run is preliminary and not the authoritative baseline.

## Deterministic browser sequence

1. Create and persist a note through the UI.
2. Abort tab A's first subsequent IndexedDB `put` transaction only. Its new text stays in the editor and recovery journal, and the existing save failure alert appears.
3. In tab B, delay cross-tab change broadcasts while retaining real IndexedDB access. Edit the same note through the UI and wait until B's newer content is durably stored.
4. With A still displaying its pending draft, press the normal save shortcut.
5. Record UI toast, current editor content, pending session draft, and actual IndexedDB record. Reload A and confirm the durable record.

The fault injection isolates a scheduling condition: another tab's commit is already durable when the saving tab has not yet observed its notification. It does not stub `saveNote`, `saveNow`, or the save shortcut. No production timing or frequency claim is made.

## Confirmed baseline outcome

In all four attempts, A displayed `Saved` despite IndexedDB retaining B's different, newer content. A's recovery draft was cleared. Reloading A displayed B's content. The local database's latest-revision rule worked correctly; the acknowledgement was misleading.

The accepted narrow correction preserves the existing latest-edit-wins behavior and reports `Updated from another tab` when the attempted pending content was displaced. It does not introduce multi-version conflict resolution.

## Replay

With the production server running at 3107:

```sh
MONOTES_BASE_URL=http://127.0.0.1:3107 MONOTES_EVIDENCE_DIR=.audit/overnight/save-ack/replay bun run test:e2e -- tests/save-ack.spec.ts --repeat-each=2
```

The test now asserts the explicit neutral outcome. Baseline data was captured before that expectation was changed from a generic failure message. Screenshots, traces, and the structured `save-ack-observed.json` attachments are in each report's test results directory. The JSON reporter embeds the observed attachment in base64.

## Verified correction

The expanded full production suite passed 64/64 executions after the acknowledgement correction. A strengthened focused run (`after-strengthened/report.json`) passed 8/8 and also waits for the editor to display the newer durable text before capturing evidence. Disabling screenshot animations avoids capturing the toast at zero opacity. The first capture had a transient editor frame; the passing explicit editor assertion confirms this was not a persistence defect. See the curated [neutral acknowledgement](../evidence/after-save-ack.png). The before JSON attachments are the evidence for the misleading Saved acknowledgement; screenshots do not replace those assertions.
