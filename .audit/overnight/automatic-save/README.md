# Automatic stale-save acknowledgement

A follow-up code inspection found another path through the same persistence acknowledgement problem. An automatic `persist()` can read a newer durable row, settle the pending draft, and clear it before the live-query observation effect runs. The observation-only notice then has no pending draft left to report.

The application was unchanged at `5b93094db76d80b6b36c2ecd4bcb509af6753d0b` during this reproduction. The exact checkout and pre-existing working-tree changes are recorded in `baseline.json` and `starting-status.txt`.

Run:

```sh
MONOTES_BASE_URL=http://127.0.0.1:3107 \
MONOTES_EVIDENCE_DIR=.audit/overnight/automatic-save/before \
bun run test:e2e tests/automatic-save.spec.ts --repeat-each=2
```

This is a deterministic branch test, not a production-frequency measurement. The isolated second tab receives a 60-second `Date.now` offset and suppresses only its outgoing Dexie `x-storagemutated-1` broadcast. It commits through the real editor into real IndexedDB. Tab A therefore still displays the original text, then creates a real UI draft with an older logical revision. A passive session-storage wrapper records that actual draft without changing its value or interrupting its automatic save.

Before result: **4 intended failures, 0 skipped, 0 flaky**, desktop Chromium and mobile WebKit each repeated twice. In every run, the test verifies the local draft's content and older revision, the exact newer text in both editor and durable storage, and removal of the pending draft. Only the neutral “Updated from another tab” expectation fails. No “Saved” or failure notice appears. The soft assertion permits capture and a further successful reload check.

Evidence:

- `before/report.json`: full repeated-run results.
- `before-observations.json`: extracted observed values and the injected conditions for all four runs.
- `before-stale-editor-before-automatic-save.png`: stale tab A before the automatic draft.
- `before-automatic-stale-save-result.png`: newer durable text displayed after silent settlement.

The narrow correction is to emit the same typed replacement event inside the active-note `persist()` settlement block when returned content differs from the captured pending draft. Compare against the pending draft, which may be newer than the particular save attempt. Existing stable-id toasts deduplicate the automatic event and a concurrent manual save notice. Existing manual-save and observed-save cases provide ordinary-save, ordinary-remote-update, and same-content controls.

After-change verification is performed by the root agent with the unchanged test file.

## Verified correction

The final production suite at `4be3e38f8b8be9ed6f1367806ebd51b5957d8281` passed **84/84 executions**, including this unchanged test in both engines twice. The neutral notice appears with the winning durable text; ordinary remote changes, identical text, and ordinary successful saves retain their expected feedback. See [final report](../complete/report.json), [build provenance](../complete-provenance.json), and [after-automatic-save.png](after-automatic-save.png).
