I reviewed the diff in `/Users/abhi/.codex/worktrees/monotes-overnight/monotes` at HEAD `c6a4174eb9c8125bea876bb6624a34d8c9e24f84`; the changes are still uncommitted. I didn't modify anything or run tests or builds. One medium bug needs fixing and three smaller issues are optional.

## Findings

1. **Medium (real bug): Tab then Enter opens the wrong note.** `src/components/notes/notes-search-dialog.tsx:48-57`
   - Each result card is a link with an `href`, so Tab moves focus onto it.
   - When Enter is pressed, cmdk's own Enter handler cancels the link's normal activation and opens whichever item cmdk has highlighted. Tabbing doesn't move that highlight (only arrow keys and mouse hover do).
   - **Result:** Tab to the third card and press Enter, and the first (or last-hovered) note opens instead. The `focus-visible:ring` styling on the card suggests Tab focus was meant to work, so this isn't intended.
   - The tests don't catch it. They used to Tab and press Enter, but now they only press Enter in the input.
   - **Fix:** add `tabIndex={-1}` to the `Link` and drop the focus-visible ring, so keyboard movement stays inside cmdk the way stock shadcn items do. Cmd/Ctrl-click and touch are unaffected.

2. **Low (real): the shortcut opens search on top of the delete-confirmation dialog.** `src/components/notes/notes-sidebar.tsx:98-120`
   - The shortcut listener on `document` fires even while the delete-confirmation dialog (`noteToDelete`) is open. Cmd/Ctrl+K then opens a second modal over it, and focus handling gets tangled.
   - **Fix:** ignore the shortcut while `noteToDelete` is set, or while any other dialog is open.

3. **Low (accessibility): status messages sit inside the results list.** `src/components/notes/notes-search-dialog.tsx:37-49`
   - The loading and "no matches" `<p role="status">` messages are rendered inside cmdk's `role="listbox"`, which should only contain options or groups.
   - **Fix:** use cmdk's `Command.Empty` / `Command.Loading` (shadcn `CommandEmpty`), or render the messages outside `CommandList`.

4. **Nit: the Search button label lost its truncation.** `src/components/notes/notes-sidebar.tsx:186-189`
   - The new `<kbd>` is now the button's last child, so the button's `[&>span:last-child]:truncate` style no longer applies to the "Search" label.
   - The hint shows "⌘ K / Ctrl K" on every platform. That's cosmetic.

## Checked and fine
- **Note IDs aren't altered:** cmdk 1.1.1 only trims item values; it doesn't lowercase them.
- **Clicks:** `CommandItem asChild` merges handlers through Radix Slot. The link's `onClick` cancels Next.js navigation first, then cmdk's select calls `openNote`.
- **Modified clicks:** stopping propagation in the capture phase skips both Next's and cmdk's handlers, so the browser still opens a new tab. Middle-click uses a different event and isn't affected.
- **Shortcut priority:** the document-level capture listener runs before both CodeMirror and cmdk's built-in Ctrl+K "move up" binding, so neither one sees the key. Held-down repeats are swallowed without toggling again.
- **Note persistence:** `openNote` still syncs before `router.push`. Clicking the current note now returns early, which is harmless.
- **Search behavior:** `useNoteSearch` is unchanged (substring match, local plus cloud-only results).
- **Focus return:** when the opener is no longer on the page, focus falls back to the "Toggle sidebar" button.

Only finding 1 needs a fix before handoff; 2–4 are optional polish. Nothing else in the diff is a problem.
