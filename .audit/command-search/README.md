# Cmd+K search repair

The old custom dialog lacked a search shortcut and arrow navigation, clipped the input's focus ring, and showed borderless note results. It is replaced by a shadcn-style Command using actual cmdk, with a fixed search header, bordered result cards, selected-state styling and keyboard hints.

Cmd+K and Ctrl+K open or close search without leaving the note. Arrow keys select results; Enter opens the selected note. Escape returns focus to the original control. A capture-phase listener prevents CodeMirror's Ctrl+K delete-to-line-end binding from touching note content, including repeated key events. Results still use existing save/sync-before-navigation, and modified clicks remain native new-tab links. The existing editor surface and query semantics are unchanged.

## Evidence and verification

Baseline checkout was clean at `c6a4174eb9c8125bea876bb6624a34d8c9e24f84`. Root reproduced all three problems in the actual running app before application changes. New browser checks failed on both browsers for the missing shortcut, clipped ring, and 0px result borders.

- Before: **4 failed**, expected against the original implementation.
- Before Opus review: **108 passed** (54 cases, repeated twice).
- Final after review fixes: **116 passed** (58 cases, repeated twice), with no retries, skips or flakes. The authoritative result is final/report.json.
- Fresh production build, TypeScript and ESLint pass. Lint has the same two pre-existing warnings.
- [Before and after images](evidence/README.md) include desktop and mobile.
- Final source hashes and build ID are recorded in final-provenance.json. The source remained unchanged from the Opus follow-up through final verification.
- Opus review completed, all four findings were addressed, and its follow-up reported no actionable issues. Both verdicts and requests are saved alongside this file.

The first exploratory focused run had 9 passes and 3 failures. Two assertions still used the old region/link roles; one measured bounding boxes during the opening CSS animation. The final assertions use command-palette combobox/listbox/option semantics and wait for the actual animation to finish before comparing geometry.

Opus caught one medium keyboard defect and three smaller items. Result links now stay outside the Tab order, the shortcut respects settings/deletion modals, status messages sit outside the listbox, and the Search label truncates explicitly. The keyboard and stacked-modal reproductions failed in three browser cases before fixes (mobile already skipped ordinary links with Tab). All 14 focused cases passed afterwards. The completed Opus follow-up found no actionable issues; its verdict is in opus-review-final.md.

Repeat the final checks:

```sh
bun run lint
MONOTES_EVIDENCE_DIR=.audit/command-search/recheck bun run test:e2e -- --repeat-each=2
bun run typecheck
```

The production test server owns port 3107. The user's dev server remains on port 3000. Cloud sync with an authenticated account remains unverified; existing local/offline coverage passes. No merging, pushing or deployment is performed.
