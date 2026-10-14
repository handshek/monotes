# Search inside the current note

Sidebar Search now opens the existing shadcn Dialog over the current editor. Opening or dismissing it keeps the same route and text. Search supports local case-insensitive matching, highlighted previews, empty results, and a fresh query each time. Results open through the existing save/sync-before-navigation handler. Desktop keyboard and mobile touch are verified. No dependency was added.

## Verification

Baseline: `4e3e434b3b351ba6dae6f57289092fab9c5d92bf`, clean worktree at `/Users/abhi/.codex/worktrees/monotes-overnight/monotes`. The existing browser harness was already established and proved by the overnight pass before this feature. The new unchanged-route assertion failed twice against this baseline, showing the home-page detour, before implementation.

| Check | Result | Evidence |
| --- | --- | --- |
| Baseline reproduction | 2 expected failures, desktop and mobile | before/report.json |
| Focused feature verification | 6 passed | focused/report.json |
| Fresh production build and full browser suite, repeated twice | 96 passed; 0 failed, skipped, or flaky | verified/report.json; verified-tests.log |
| TypeScript | Passed | typecheck.log |
| ESLint | Passed with 2 pre-existing warnings | lint.log |
| Native read-only reviews | No actionable findings | native-review.md |
| Exact-checkout Claude Opus review | Completed; no correctness, regression, or security defects | opus-review.md; external-review.json |
| Review-requested new-tab check and focused regressions, repeated twice | 12 passed against another fresh production build | review-followup/report.json; review-followup-provenance.json |

Repeat the authoritative checks from this worktree:

```sh
bun run lint
MONOTES_EVIDENCE_DIR=.audit/search-dialog/recheck bun run test:e2e -- --repeat-each=2
bun run typecheck
```

Playwright builds production and owns its server on port 3107. The development server for manual testing is separate at http://127.0.0.1:3000. The SHA256 manifest in verified-provenance.json was checked unchanged after the full passing run and records its production build ID. After Opus review, only tests/search-dialog.spec.ts changed to add new-tab coverage; application source remains identical. The follow-up manifest records the current source/test hashes and the passing focused run.

The new checks exercise unchanged URL, preserved editor text, cancel/reopen, automatic input focus, cancellation focus restoration, selecting the same note, selecting another note with desktop Tab/Enter or mobile tap, offline local filtering, whitespace and no-result queries, and mobile drawer closure. Existing tests still cover create/edit/reload, persistence and concurrency.

## Before and after

[Curated screenshots](evidence/README.md) show the homepage detour before and the dialog over the current note after. The passing captures wait for highlighted search text, rather than just a visible input.

The initial development run and interrupted production attempt are retained as exploratory evidence. One mobile test assumed Tab focused ordinary links; the final test uses native touch on mobile while preserving desktop keyboard verification. Only verified/report.json is the final full-suite result.

## Scope and limitations

Home search and the dialog share a single hook preserving the existing query and cloud merge behavior. Authenticated cloud search/sync remains unverified because no authenticated test access is available. Offline filtering is verified after the app is loaded; this change does not establish a cold offline boot. The minimal app layout is preserved.

Opus raised two nonblocking low items. Existing `/?search=true` support is deliberately retained for bookmarked/direct links; Sidebar Search uses the dialog. The suggested modified-click coverage was added and passed twice, proving the new tab loads the target and the original note/dialog stay in place. No product code changed after Opus reviewed it, so a second external review was not needed for this test-only addition. A transient Claude API error recovered automatically before the completed verdict.

The prior overnight report is a historical snapshot. This follow-up implements the user's later request for in-place search. Changes are committed locally for review, without merging or deploying.
