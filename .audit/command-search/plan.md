# Repair search interaction

- [x] Reproduce on the running app. Cmd+K does nothing; the input focus ring is clipped and result notes have no border.
- [x] Trace the cause. Input sits at the edge of an overflowing parent; results omit border styling; no shortcut exists.
- [x] Replace the custom list with shadcn Command/cmdk. Keep existing note search and save-before-navigation.
- [x] Verify Cmd/Ctrl+K, arrow keys, Enter, Escape, native modified clicks, input geometry, borders, desktop and mobile screenshots.
- [x] Run relevant checks and read-only T3 Opus review; commit locally. No push, merge, or deployment.

Data remains NoteSearchResult { id, content, updatedAt }. Root owns regression tests and verification; the implementation delegate owns command/search/sidebar components. Shared query behavior is unchanged. The existing proven browser harness is reused before changing application code. Experience First replaces the improvised dialog list with the standard command interaction. Fix Root Causes moves the input outside the scrolling results instead of masking the clipped ring. The previous reviewer checked function but our visual and interaction coverage missed the user's expectations; encode those checks now.
