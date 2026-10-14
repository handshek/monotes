# Monotes morning review

Three demonstrated problem groups are fixed on `codex/monotes-overnight`: local edit durability, sidebar Search, and mobile drawer dismissal. The final production browser suite passes **88/88 executions**. The required T3 Claude Opus review and follow-ups completed. Confirmed findings were addressed, and the final verdict is no findings. Comparative preview profiling is complete. No merge, push, or deployment was performed.

The review checkout is `/Users/abhi/.codex/worktrees/monotes-overnight/monotes`. It started clean at `b6f605126121cf118f2707988c3178e11bf5599b`, matching the original clean checkout at `/Users/abhi/dev/monotes`. The original checkout remains unchanged.

| Problem | Demonstrated before | Verified after |
| --- | --- | --- |
| Final edits disappear on immediate reload, including new notes and cross-tab reverts. | Selected cases lose the newest text on the unchanged baseline. | Immediate writes and per-tab pending drafts retain exact text. Empty notes persist. Stale drafts cannot overwrite newer notes or resurrect deleted rows. Storage failures are visible. |
| Sidebar Search does nothing. | Clicking Search leaves the editor open. | It opens the existing home search and focuses its field, including repeated selection on the same route. |
| Mobile drawer obscures the selected editor. | Selecting or creating a note leaves the drawer open. | Selection, same-note selection, and creation close it. New notes have distinct IDs; existing notes remain intact. |

[Before-and-after evidence](evidence/README.md) covers these three groups. Typography, layout, editor, search screen, and themes retain the minimal design. Review corrections stay within this scope: honest save acknowledgements, bounded sidebar previews, and generated-file lint exclusion.

The unchanged app passed eight repeated core executions before source implementation began. Selected baseline regressions then recorded four core passes and ten expected failures. Strengthened baseline safeguards recorded eleven expected failures; these are coverage cases, not eleven separate product bugs. Earlier exploratory reports preserve corrected harness assumptions and are not the authoritative baseline. [The decision log](decisions.tsv) explains the sequence.

| Check | Result | Evidence |
| --- | --- | --- |
| Harness proved before app edits | 8 passed | [baseline core](baseline-core-verified/report.json) |
| Selected baseline defects | 4 passed, 10 expected failures | [baseline regressions](baseline-verified/report.json) |
| Final repeated production flows | 88 passed | [JSON report](verified/report.json), [test log](verified-tests.log), [build provenance](verified-provenance.json) |
| Production build | Passed | [build log](verified-build.log) |
| TypeScript | Passed | [typecheck log](verified-typecheck.log) |
| App lint | Passed, 2 warnings in unchanged source | [lint log](verified-lint.log) |
| Benchmark harness lint | Passed | [harness lint](verified-harness-lint.log) |

The final suite contains 21 desktop Chromium cases and 23 mobile WebKit cases, each repeated twice, with isolated contexts, one worker, no retries, no skips, and no flaky results. Assertions check literal content, real IndexedDB records, focus, routes, and drawer visibility. Browser input-to-pagehide timestamps prove the reload case exercises the former 500ms loss window. Those timestamps are not a performance benchmark. Historical runs of 56, 64, 68, 80, and 84 checks remain available for provenance.

Claude Opus (`claudeAgent` / `claude-opus-5-5`) completed a read-only review in this exact worktree after T3 project registration became available. The Supervised ceiling, `approval-required` runtime, and `plan` interaction were retained. Authentication was exercised; no reviewer writes or approvals were granted. [The final verdict](opus-final-review.md), [initial review](opus-review.md) and [connection/run record](external-review.json) preserve both the earlier access errors and successful review.

The first review's save-status finding reproduced four times: one tab could show Saved after a newer tab displaced its pending draft. The corrected hook returns the actual outcome, and the editor reports Updated from another tab. The latest-edit-wins policy is unchanged. [Before/after race evidence](save-ack/README.md) includes ordinary successful saves, stored content, winning editor text, and reload. The follow-up found the related observation-first path. It reproduced four times, with eight passing quiet-update controls. Independent review then reproduced four automatic-settlement cases. Both paths now emit the same typed revision event and deduplicated neutral toast; ordinary remote updates and matching text stay quiet. [Observed-update evidence](observed-save/README.md) and [automatic-save evidence](automatic-save/README.md) document the injections, before failures, and final passes. The same rule now applies when returning to a note with an older pending draft. Four recovery-notice failures reproduced before correction, with eight same-content/deletion controls passing. [Recovery evidence](recovery-notice/README.md) shows the correction. The first review also caught inaccurate warning provenance: four of the former six warnings came from generated files newly included by lint scope. Generated files are now ignored, and this report corrects the prior claim.

The performance investigation confirmed extra library reads and full-content preview scans after immediate persistence, although a user-visible typing slowdown was not demonstrated on the tested desktop. The preview now extracts only the first twenty words. [The investigation](perf-review/README.md) and [bounded-preview comparison](perf-review/bounded-preview/README.md) separate repeated timing from instrumented profiling. The diagnostic recorded 24,000 full-content preview matches per tab before correction and zero afterward, replaced by bounded splits. All repeated typing/storage assertions passed; no end-to-end typing speedup is claimed. Full-library reads remain. These synthetic desktop measurements do not establish performance on physical mobile devices, older hardware, larger libraries, or real user data.

IndexedDB remains committed storage. Typed `NoteDraft` and `LocalRevision` values make pending edits and revision order explicit. Session storage protects pending edits during same-tab reload; it does not promise recovery after a tab is closed or a browser process is killed before IndexedDB commits. Empty notes now persist intentionally when created.

Offline edits after the page loads, reconnection, and subsequent reload are verified. **Full offline boot/reload remains unsupported** before and after, as [the diagnostic](final-offline-shell/report.json) records. A retained document after failed WebKit navigation is not a successful offline reload. Offline app-shell support was outside the three selected fixes.

**Cloud sync remains unverified:** environment configuration was available, but the browser required sign-in. No cloud writes were attempted. An authenticated account is needed to test upload, download into a second session, edits, reconnect, and cloud conflict behavior. No product decision is pending.

Native investigations and reviews covered persistence, usability, harness quality, save acknowledgement, performance, and completion. [The native review record](native-review.md) distinguishes them from Opus. [The completion audit](completion-audit.md) maps the requirements to verified evidence. A suspected development duplicate-creation issue failed to reproduce and was withdrawn; no speculative guard was added.

Local commits: `2b35946` establishes the harness; `f2b13ba` fixes the three problem groups; `d330819` preserves the original checkpoint; `54378f3` corrects save acknowledgement and lint scope; `8a44e4c` bounds previews and strengthens verification; `5b93094` and `4be3e38` complete replacement notices for observed and automatic settlement; `2ba234c` adds consistent recovery feedback and commits the benchmark harness. The final documentation commit preserves this report, completed external review, and profiling. Review the [changed-file list](implementation-files.txt) or run `git diff b6f605126121cf118f2707988c3178e11bf5599b HEAD -- src tests scripts playwright.config.ts package.json bun.lock eslint.config.mjs .gitignore`.

To repeat the suite, use this checkout's ignored `.env.local`, then run `bun run test:e2e -- --repeat-each=2`, `bun run lint`, and `bun run typecheck`. The suite builds production and starts port 3107. [The harness README](../../tests/README.md) describes prerequisites and scope. Benchmark reproduction is documented separately. Curated evidence and JSON are committed; local HTML reports, videos, and traces are ignored.

Poteto principles applied: Build the Lever produced a reusable harness; Prove It Works and Test Behavior, Not Implementation required real browser actions and exact stored text; Model the Domain produced explicit revision types; Explain the Number required separate profiling and bounded performance claims. Cursor-only routing and unavailable control-ui/deslop integrations were represented by native agents, browser checks, and direct diff cleanup, without claiming unavailable tools ran.
