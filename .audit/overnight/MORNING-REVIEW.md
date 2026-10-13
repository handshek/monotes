# Monotes morning checkpoint

Three demonstrated problems are fixed and locally committed on `codex/monotes-overnight`. The repeatable production browser suite passes. The required T3 Claude Opus review is blocked, so the full goal is not complete. No merge, push, or deployment was performed.

The checkout is `/Users/abhi/.codex/worktrees/monotes-overnight/monotes`. It started clean at `b6f605126121cf118f2707988c3178e11bf5599b`, matching the original clean checkout at `/Users/abhi/dev/monotes`. The original checkout remains unchanged.

| User-visible problem | Demonstrated before | Verified after |
| --- | --- | --- |
| Final note edits disappear on immediate reload, including new notes and cross-tab reverts. | Selected persistence cases fail on the unchanged baseline. Reload restores the previous text. | Immediate writes and recoverable per-tab drafts retain exact text. Empty notes survive reload. Stale drafts cannot overwrite newer notes or resurrect deleted notes. Failed storage operations show an error. |
| Sidebar Search does nothing. | Clicking Search leaves the editor open. | Search opens the existing home screen, focuses its field, and finds edited content. Repeating Search on the same route also focuses the field. |
| Mobile navigation leaves the drawer over the editor. | Selecting or creating a note leaves the drawer open. | Both actions close it. Same-note selection also closes it. The new note has a distinct ID and the old note remains intact. |

[Before-and-after screenshots](evidence/README.md) illustrate all three groups. The app retains its existing typography, layout, editor, search screen, and themes. Small error messages appear only when storage fails. No redesign was introduced.

Maintainers inherit one committed Playwright harness, typed `NoteDraft` and `LocalRevision` values, and IndexedDB as committed storage. Per-tab session storage only protects pending edits during same-tab reloads. Transactional updates reject stale revisions and deleted rows. Dexie observation replaces the old broadcast hook. This does not promise recovery after a tab is closed or a browser process is killed before IndexedDB commits.

The unchanged app passed eight repeated core executions before source implementation began. The selected baseline suite then recorded four core passes and ten expected regression failures. The final suite passed **56/56 executions**, consisting of 13 desktop Chromium cases and 15 mobile WebKit cases, each repeated twice. It used isolated contexts, one worker, no retries, no skips, and no flaky results. Exact content, actual IndexedDB records, focus, route, and drawer visibility are asserted. Browser input-to-pagehide timestamps establish that the reload regression exercises the former 500ms loss window; they are not a performance benchmark.

| Check | Result | Evidence |
| --- | --- | --- |
| Baseline harness before app edits | 8 passed | [baseline core](baseline-core-verified/report.json) |
| Selected baseline defects | 4 passed, 10 expected failures | [baseline regressions](baseline-verified/report.json) |
| Strengthened baseline safeguards | 11 expected failures | [strengthened baseline](baseline-strengthened-verified/report.json) |
| Final repeated production flows | 56 passed | [JSON report](final/report.json), [test log](final-tests.log) |
| Production build | Passed | [build log](final-build.log) |
| TypeScript | Passed | [typecheck log](final-typecheck.log) |
| App lint | Passed with 6 existing warnings | [lint log](final-lint.log) |
| Harness lint | Passed | [harness lint](harness-lint.log) |
| Patch whitespace | Passed | `git diff --check` |

The strengthened baseline cases include new draft-safety assertions. Their failures are coverage evidence, not eleven separate product defects. Earlier exploratory reports under `baseline`, `baseline-core`, and `baseline-strengthened` preserve test-assumption failures. Desktop Vim insert mode and two weak assertions were corrected before accepting results. [The decision log](decisions.tsv) and [native review record](native-review.md) explain those changes. Success screenshots were also moved after assertions to avoid transition frames, then the whole repeated suite passed again.

Offline editing after the page has loaded is verified. Reconnection and reload retain those edits. Full offline page reload fails before and after in both engines, as [the diagnostic](final-offline-shell/report.json) records. Mobile WebKit can retain the previous document after failed navigation, which is not a successful offline reload. Adding offline app-shell support was outside these three bounded fixes.

Cloud sync is unverified. Local environment configuration was available, but the browser session was unauthenticated and the app required sign-in. No cloud writes were attempted. An authenticated account is needed to verify upload, second-session download, edits, reconnect behavior, and conflict handling.

Native reviews completed. No final actionable defect was confirmed. A suspected development duplicate-creation issue did not reproduce and was withdrawn. Forced IndexedDB creation failures did expose missing feedback; the added handlers and tests resolve it. Native review does not replace Claude Opus.

T3’s live catalog offered `claudeAgent` / `claude-opus-5-5`. Monotes is absent from its project registry. Project registration was denied under the Supervised connection ceiling, and launch against the exact worktree was rejected because it was not a worktree of the selected registered project. No review thread started, and Claude authentication was not exercised. [The exact errors](external-review.json) and [ready-to-send review brief](review-request.md) are saved.

To unblock the required review, register `/Users/abhi/dev/monotes` as a project in T3 Code while keeping the MCP connection Supervised, then resume this goal. The reviewer must use this existing worktree with `approval-required` runtime and `plan` interaction mode. Confirm its resolved directory, wait for completion, read findings, independently evaluate them, and fix confirmed issues before declaring the goal complete. No product decision is pending.

Local commits are `2b35946` for the proven harness and `f2b13ba` for the implementation. A following audit-only commit contains this checkpoint. [The changed-file list](implementation-files.txt) covers application and harness changes from the original baseline through `f2b13ba4ee8d74ad00048bdfda035531121c9d5b`. Review the code with `git diff b6f605126121cf118f2707988c3178e11bf5599b f2b13ba4ee8d74ad00048bdfda035531121c9d5b -- src tests scripts playwright.config.ts package.json bun.lock .gitignore`.

To repeat verification, use this checkout’s existing ignored `.env.local`, or provide the required `NEXT_PUBLIC_CONVEX_URL` configuration. [The harness README](../../tests/README.md) describes prerequisites and scope. Run `bun run test:e2e -- --repeat-each=2`; it builds production and starts its own server on port 3107. Then run `bun run lint` and `bun run typecheck`. Committed logs have normalized line endings and trailing whitespace. Generated default reports are ignored. Local evidence directories retain HTML reports and traces for inspection.

Poteto decisions were grounded in Build the Lever, which made the harness a committed artifact; Prove It Works and Test Behavior, Not Implementation, which required real browser behavior and literal text assertions; and Model the Domain, which made draft revisions explicit types. Cursor-only routing and unavailable control-ui/deslop integrations were represented by native agents, browser checks, and direct diff cleanup. Those unavailable tools are not claimed as executed.
