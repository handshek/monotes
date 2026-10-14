# Monotes overnight pass

## Checklist

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [x] Phase C: Run the loop
- [x] Establish and prove browser harness on unchanged application code.
- [x] Reproduce and capture at most three selected defects.
- [x] Fix each demonstrated defect and verify it with before-and-after checks.
- [x] Phase D: Keep the audit trail
- [x] Phase E: Verify and hand back. All 88 browser checks pass. The exact-worktree Opus review and follow-ups are complete with no remaining actionable findings.
- [x] Save local commits, evidence, and a resumable morning checkpoint.
- [x] Complete the exact-worktree T3 review and address confirmed findings.

## Contract

The original checkout is /Users/abhi/dev/monotes. HEAD was b6f605126121cf118f2707988c3178e11bf5599b and git status was empty before work. The fresh worktree is /Users/abhi/.codex/worktrees/monotes-overnight/monotes. It started clean at the same HEAD. The branch is codex/monotes-overnight.

Done requires repeatable browser proof of create, edit, reload, search, and offline persistence on desktop and mobile. Every accepted fix needs a failing before case and a passing after case. Relevant static checks and a production build must pass. Cloud synchronization requires an authenticated session; unavailable access is a documented verification gap. Required T3 Claude Opus review must complete and confirmed findings must be resolved. Keep local commits only. Do not merge, push, or deploy.

## Workflow and throughput checkpoint

The primary agent owns the integration worktree, app changes, decisions, and commits. Two read-only native agents independently inspect persistence and usability. A third agent owns only browser test/config files. App implementation waits for the harness gate. Verification comes before improvements because lost text is the highest risk and browser storage behavior is the riskiest unknown.

Use high rigor for persistence. Assert literal note contents after real navigation/reload, and preserve browser traces and screenshots. Use moderate rigor for small navigation fixes. Inspect desktop and mobile images for design preservation. This is one bounded pass with up to three fixes, not a redesign.

The initial data shape is NoteContent with id, content, updatedAt, and cloudStatus. IndexedDB owns stored notes. The editor hook owns transient text and currently delays writes. Navigation state lives in SidebarProvider. Preserve these boundaries unless evidence requires a narrower new boundary.

Design exploration compares immediate IndexedDB writes with a synchronous recoverable draft record for reload safety. Sidebar exploration compares reuse of the existing home search with a new modal; prefer reuse if browser evidence proves it meets the need. Mobile closure compares route effects with action-owned dismissal, including same-note clicks.

PStack uses Cursor-only subagent types and model slugs that native Codex does not support. The installed portability guide explicitly permits native equivalents. Use native read-only investigations and T3 Claude Opus for the required cross-provider review. The external control-ui/deslop skills are not installed; use browser verification and direct diff cleanup without claiming those integrations ran.

## Checkpoint

The final production suite passed 88/88 executions with no retries, skips, or flaky results. Production build, typecheck, app lint, and benchmark-harness lint passed. Two warnings remain in unchanged authored source; the earlier six-warning provenance claim was corrected. The exact-worktree Opus review and follow-ups completed. Confirmed findings were independently reproduced and addressed. The final completed verdict reports no findings. See MORNING-REVIEW.md for evidence and access gaps. No product decision is outstanding.
