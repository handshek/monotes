# Recovery replacement notice

The third Opus review identified the final place that drops a superseded pending draft: initial recovery after reload or returning to the note. The latest stored revision already won correctly, but the displaced draft was cleared without explaining the replacement.

The unchanged app at `4be3e38f8b8be9ed6f1367806ebd51b5957d8281` produced **4 intended failures and 8 passing controls**, both engines repeated twice. `before/report.json` and `before-tests.log` show that the failures occur only at the missing neutral notice. The existing behavior test uses a real failed IndexedDB write, leaves the original tab for `about:blank`, commits a newer note through another tab, then returns. Exact winning content and cleared pending storage pass before the notice expectation fails. Same-content recovery and deleted-note recovery remain quiet and pass.

The narrow correction at `2ba234c` emits the existing typed replacement event when a recovered draft is discarded in favor of different stored content. It does not change revision selection, storage, recovery, or deletion behavior. The same-content and absent-note guards preserve quiet outcomes. Choosing consistent feedback on reload follows the same rule as live observation and automatic settlement, without adding UI or a conflict-resolution product decision.

Repeat the focused checks against a running production server:

```sh
MONOTES_BASE_URL=http://127.0.0.1:3107 \
MONOTES_EVIDENCE_DIR=.audit/overnight/recovery-notice/replay \
bun run test:e2e tests/persistence.spec.ts --grep 'an older session draft' --repeat-each=2
```

The final complete run and build identity are recorded in `../verified/report.json` and `../verified-provenance.json`. The final run passed 88/88 executions: all cases in both engines twice, with no failures, skips, retries or flaky cases. The before cases now show the neutral notice, while same-content and deletion controls remain quiet.
