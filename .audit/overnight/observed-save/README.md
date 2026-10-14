# Observed remote-save acknowledgement

Opus's follow-up identified a second route through the save-acknowledgement problem: a normal Dexie broadcast can settle a failed pending draft before the user manually saves. The editor updates to the newer stored content and clears the failure alert, but gives no notice that the local draft was replaced.

The application was unchanged at `8a44e4c82c410c9f5ce92b294bdb522d58a1fadd` during this reproduction. The exact checkout and pre-existing working-tree changes are recorded in `baseline.json` and `starting-status.txt`.

Run:

```sh
MONOTES_BASE_URL=http://127.0.0.1:3107 \
MONOTES_EVIDENCE_DIR=.audit/overnight/observed-save/before \
bun run test:e2e tests/observed-save.spec.ts --repeat-each=2
```

The suite uses real UI and real IndexedDB in isolated browser contexts. It aborts exactly one tab A note-write transaction to establish an unsaved draft and a visible failure alert. Tab B then writes through the ordinary editor with normal Dexie broadcasts; no hook or synchronization implementation is mocked.

Before result: **4 intended failures, 8 passes, 0 skipped, 0 flaky** across desktop Chromium and mobile WebKit, each repeated twice. Each failure occurs only at the expectation for the neutral “Updated from another tab” notice. Before that assertion, the test proves that the editor displays the exact newer content, IndexedDB stores that same content, the failure alert disappears, and the pending session draft is cleared. A soft assertion allows the test to also verify reload preservation after recording the missing notice.

The controls prove that ordinary remote edits with no pending local draft remain quiet, and that a newer remote revision saving the exact same pending text remains quiet. Each control passes in both engines and repetitions.

Evidence:

- `before/report.json`: complete repeated-run results and attached observations.
- `before-observations.json`: extracted data for all pending-draft cases.
- `before-failed-local-draft-before-remote-update.png`: the unsaved local draft and failure alert.
- `before-observed-remote-save-result.png`: the newer remote content after the alert and draft disappear, without a replacement notice.

Suggested correction: emit a typed event from the hook only when observing a newer stored row displaces a pending draft with different content. The editor can show its existing neutral notice. Ordinary remote updates, same-content saves, and deletion should stay quiet. A stable per-note toast id can deduplicate overlapping observation and manual-save notices. This preserves the existing latest-edit-wins policy and minimal design; it does not add conflict recovery or version history.

After-change verification is performed by the root agent with the unchanged test file.

## Verified correction

The final production suite at `4be3e38f8b8be9ed6f1367806ebd51b5957d8281` passed **84/84 executions**, including this unchanged test in both engines twice. The neutral notice appears with the winning durable text; ordinary remote changes, identical text, and ordinary successful saves retain their expected feedback. See [final report](../complete/report.json), [build provenance](../complete-provenance.json), and [after-observed-remote-save.png](after-observed-remote-save.png).
