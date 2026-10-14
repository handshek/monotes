# Native investigation and implementation review

The independent diagnosis found the overflow container clipping the Input focus ring, missing borders on search result links, and no global search shortcut. It identified CodeMirror Ctrl+K delete-to-line-end as a key conflict and recommended capture-phase interception, actual-opener focus restoration, and shouldFilter=false to preserve the existing search query semantics.

A separate implementation agent changed only ui/command.tsx, notes-search-dialog.tsx, and notes-sidebar.tsx. Root inspected the actual diff and cmdk event composition, checked the live browser UI, and owns the regression tests. No new explanatory comments or suppression directives were introduced. The global shortcut consumes repeat events without toggling again so they cannot fall through to the editor.

The first exploratory run passed 9/12. Two old tests still used region/link roles rather than the new listbox/option roles; one geometry test measured while the opening animation was running. Selectors were corrected, and geometry now waits for the actual CSS animation to complete. No application change was needed for those test failures.
