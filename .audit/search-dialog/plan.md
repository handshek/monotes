# In-place note search
- [x] Read the Principles section of Poteto Mode.
- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [x] Phase C: Run the loop
- [x] Reproduce sidebar Search leaving the note with the real browser harness.
- [x] Share existing search behavior and add a shadcn Dialog over the note.
- [x] Verify unchanged URL and text on open/cancel, focus, result selection, empty results, offline local search, and mobile drawer closure.
- [x] Phase D: Keep the audit trail
- [x] Phase E: Verify and hand back

Done means the sidebar opens an accessible search dialog without navigating or remounting the current note. Escape and Close keep the note. Selecting a result closes the dialog and opens that note. Desktop and mobile browser checks, the existing regression suite, static checks, and a build pass. The required exact-worktree Opus review completes. Leave the dev server running and commit locally.

This is a small reversible feature with moderate rigor. Root owns code and tests. A native read-only agent independently compared Dialog with CommandDialog. Existing shadcn Dialog + Input + normal links avoids a new dependency and retains native modified-link clicks. A shared search hook owns ordered local notes, the existing debounce, case-insensitive filtering, and cloud merge. NoteSearchResult contains id, content, and updatedAt. Dialog state belongs to the persistent sidebar component; its portal sits outside the mobile Sheet. The home page retains its card layout.

The baseline is recorded in baseline.json. No user changes were present. The previous report remains a historical snapshot. Build the Lever reuses the proved browser harness. Laziness Protocol selects existing components and one shared query hook. Model the Domain uses the existing note result shape. Prove It Works checks the URL and current text, not just the presence of a search input.

Official reference: https://ui.shadcn.com/docs/components/radix/dialog
