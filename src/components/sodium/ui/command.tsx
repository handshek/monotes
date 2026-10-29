'use client';

import * as React from 'react';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/sodium/ui/dialog';
import {Kbd} from '@/components/sodium/ui/kbd';
import {Icon, Search} from '@/components/sodium/icon';
import {cn, mergeRefs} from '@/lib/sodium/utils';
import {menuItemClass, menuLabelClass, menuSeparatorClass, menuVarsClass} from '@/lib/sodium/overlay';

// Sodium's command list, the core of the command palette, with no extra dependency. A search row over a list of
// grouped commands. The search is a 40px row with a rule under it, not a field boxed inside the box; the rows are the
// dropdown menu's rows, mono capitals edge to edge with the active one lifted to white between two hairlines, as a
// highlighted menu row is (menu-row); a command is an action, never a choice, so no row takes the selection wash. CommandDialog puts it in
// a large Dialog a fifth of the way down the screen, with the key hints as a ruled row under the list.
//
// The input keeps focus while Up and Down move the active item, Home and End jump to the first and last when the
// field is empty (or with Ctrl), and Enter runs it. Groups with nothing left hide, and Empty and Loading take the
// list's place. Whitespace alone is no search. The input is a combobox that points at the active option, so a screen
// reader follows along, and a polite status says how many results there are.
//
// Results rank by how they match: a match at the start of the name first, then at the start of a word, then anywhere,
// then only in keywords. While searching the groups dissolve and every item sorts by its own rank, so the best match
// across the whole list is first and active: Enter runs what the person most likely meant. The letters that earned
// the match are underlined in text-1 while the rest of the label steps back to text-2. While results load, the
// search icon gives way to the pending mark, four square cells, in the same place.

type Filter = (value: string, search: string, keywords?: string[]) => number;

const words = (search: string) => search.toLowerCase().split(/\s+/).filter(Boolean);

const escapeRe = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 4 at the start of the name, 3 at the start of a word, 2 anywhere in it, 1 only in a keyword, 0 no match. */
function scoreWord(value: string, word: string, keywords: string[]) {
  const v = value.toLowerCase();
  const at = v.indexOf(word);
  if (at === 0) return 4;
  if (at > 0 && new RegExp(`(^|[\\s\\-_/.:])${escapeRe(word)}`).test(v)) return 3;
  if (at > 0) return 2;
  return keywords.some(k => k.toLowerCase().includes(word)) ? 1 : 0;
}

const defaultFilter: Filter = (value, search, keywords = []) => {
  let total = 0;
  for (const word of words(search)) {
    const score = scoreWord(value, word, keywords);
    if (!score) return 0;
    total += score;
  }
  return total;
};

/** The ranges of `text` that the search's words match, merged, for drawing the matched letters. */
function matchRanges(text: string, search: string): [number, number][] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const word of words(search)) {
    const start = new RegExp(`(^|[\\s\\-_/.:])${escapeRe(word)}`).exec(lower);
    const at = start ? start.index + start[1].length : lower.indexOf(word);
    if (at >= 0) ranges.push([at, at + word.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

type CommandContextValue = {
  search: string;
  /** The search trimmed: whitespace alone is no search. */
  query: string;
  setSearch: (search: string) => void;
  active: string | null;
  setActive: (id: string | null) => void;
  matches: (value: string, keywords?: string[]) => boolean;
  rank: (value: string, keywords?: string[]) => number;
  /** Items showing, unavailable ones included. */
  count: number;
  listId: string;
  /** The accessible name of the search field and the list. */
  label: string;
  loading: boolean;
  setLoading: (loading: string | null) => void;
};

const CommandContext = React.createContext<CommandContextValue | null>(null);

function useCommand() {
  const context = React.useContext(CommandContext);
  if (!context) throw new Error('Command parts must be inside <Command>.');
  return context;
}

const ITEM = '[data-slot="command-item"]';

type CommandProps = Omit<React.ComponentProps<'div'>, 'onKeyDown'> & {
  /** The accessible name of the search field and the results list. Not shown. */
  label?: string;
  /** Filter items by the search. Turn off when the results come from a server. */
  shouldFilter?: boolean;
  /** Scores an item: above 0 shows it. Defaults to every word of the search appearing in the value or keywords. */
  filter?: Filter;
  /** Wrap from the last item to the first and back. */
  loop?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
};

function Command({className, label = 'Commands', shouldFilter = true, filter = defaultFilter, loop = false, onKeyDown, children, ref, ...props}: CommandProps) {
  const [search, setSearch] = React.useState('');
  const [active, setActive] = React.useState<string | null>(null);
  const [count, setCount] = React.useState(0);
  const [unavailable, setUnavailable] = React.useState(0);
  const [loadingText, setLoading] = React.useState<string | null>(null);
  const loading = loadingText !== null;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();
  const query = search.trim();

  const matches = React.useCallback(
    (value: string, keywords?: string[]) => !shouldFilter || !query || filter(value, query, keywords) > 0,
    [shouldFilter, query, filter],
  );
  const rank = React.useCallback(
    (value: string, keywords?: string[]) => (!shouldFilter || !query ? 0 : filter(value, query, keywords)),
    [shouldFilter, query, filter],
  );

  // Every showing item in the order the person sees it: by rank, ties in written order.
  const ordered = () => {
    const root = rootRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(ITEM))
      .map((el, i) => ({el, i, r: Number(el.dataset.rank ?? 0)}))
      .sort((a, b) => b.r - a.r || a.i - b.i)
      .map(x => x.el);
  };
  const items = () => ordered().filter(el => el.getAttribute('aria-disabled') !== 'true');

  // After every render: order and count what is visible, number it for screen readers, and keep the active item on
  // something that exists. The first (best) item becomes active whenever the search changes.
  const lastQuery = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    const shown = ordered();
    shown.forEach((el, i) => { el.setAttribute('aria-posinset', String(i + 1)); el.setAttribute('aria-setsize', String(shown.length)); });
    const visible = shown.filter(el => el.getAttribute('aria-disabled') !== 'true');
    if (shown.length !== count) setCount(shown.length);
    if (shown.length - visible.length !== unavailable) setUnavailable(shown.length - visible.length);
    const queryChanged = lastQuery.current !== query;
    lastQuery.current = query;
    if (queryChanged || !visible.some(el => el.id === active)) {
      const first = visible[0]?.id ?? null;
      if (first !== active) setActive(first);
      rootRef.current?.querySelector('[data-slot="command-list"]')?.scrollTo({top: 0});
    }
  });

  const move = (to: (index: number, length: number) => number) => {
    const visible = items();
    if (!visible.length) return;
    const index = visible.findIndex(el => el.id === active);
    const next = visible[to(index, visible.length)];
    if (!next) return;
    setActive(next.id);
    next.scrollIntoView({block: 'nearest'});
  };

  // Home and End belong to the caret while there is text to move it through.
  const jumps = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const field = event.target instanceof HTMLInputElement ? event.target : null;
    return !field || !field.value || event.ctrlKey || event.metaKey;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const down = event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n');
    const up = event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p');
    if (down) { event.preventDefault(); move((i, n) => i < 0 ? 0 : i + 1 < n ? i + 1 : loop ? 0 : i); }
    else if (up) { event.preventDefault(); move((i, n) => i <= 0 ? (loop ? n - 1 : 0) : i - 1); }
    else if ((event.key === 'Home' || event.key === 'End') && jumps(event)) { event.preventDefault(); move((_, n) => event.key === 'Home' ? 0 : n - 1); }
    else if (event.key === 'Enter') {
      const el = active ? document.getElementById(active) : null;
      if (el && el.getAttribute('aria-disabled') !== 'true') { event.preventDefault(); el.click(); }
    }
  };

  const value = React.useMemo<CommandContextValue>(
    () => ({search, query, setSearch, active, setActive, matches, rank, count, listId, label, loading, setLoading}),
    [search, query, active, matches, rank, count, listId, label, loading],
  );
  const rootSetRef = React.useMemo(() => mergeRefs(rootRef, ref), [ref]);
  const results = count === 1 ? '1 result' : `${count} results`;
  const status = loading ? loadingText : !query ? '' : unavailable === 0 ? results : unavailable === count ? `${results}, unavailable` : `${results}, ${unavailable} unavailable`;

  return <CommandContext.Provider value={value}>
    <div
      ref={rootSetRef}
      data-slot="command"
      // Standalone it is a frame on the panel fill, as a list popup is, so a highlighted row lifts to white off it.
      // Inside CommandDialog the dialog is its surface. Rows are --row (40px), the search row's height, so a row's icon
      // sits (40 - 16) / 2 = 12px from its top and from the side, under the search glyph, and every row's text, group
      // label and key cap starts and ends on that same 12px, the region's --inset.
      className={cn(
        'frame flex size-full min-h-0 flex-col overflow-hidden bg-panel text-text-1 [--menu-item-h:var(--row)] [--menu-px:var(--inset)]',
        menuVarsClass,
        'in-data-[slot=command-dialog]:flex-1 in-data-[slot=command-dialog]:border-0 in-data-[slot=command-dialog]:bg-transparent',
        className,
      )}
      data-searching={query ? '' : undefined}
      {...props}
      onKeyDown={handleKeyDown}
    >
      {children}
      <p role="status" className="sr-only">{status}</p>
    </div>
  </CommandContext.Provider>;
}

type CommandDialogProps = Omit<React.ComponentProps<typeof Dialog>, 'children'> & {
  /** The hidden dialog title. null leaves it out, when the children render their own DialogTitle. */
  title?: React.ReactNode;
  /** The hidden dialog description. null leaves it out. */
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

/** The palette: a Command in a large dialog a fifth of the way down, with a hidden title for screen readers. */
function CommandDialog({title = 'Command palette', description = 'Search for a command to run', children, className, ...props}: CommandDialogProps) {
  return <Dialog {...props}>
    <DialogContent
      data-slot="command-dialog"
      size="lg"
      showCloseButton={false}
      className={cn('top-[20dvh] h-[min(calc(var(--row)*12),calc(80dvh-var(--space-8)))] translate-y-0', className)}
    >
      {title !== null && <DialogTitle className="sr-only">{title}</DialogTitle>}
      {description !== null && <DialogDescription className="sr-only">{description}</DialogDescription>}
      {children}
    </DialogContent>
  </Dialog>;
}

type CommandInputProps = Omit<React.ComponentProps<'input'>, 'value' | 'onChange'> & {
  value?: string;
  onValueChange?: (value: string) => void;
};

function CommandInput({className, value, onValueChange, placeholder = 'Search commands', ...props}: CommandInputProps) {
  const {search, setSearch, active, listId, label, loading} = useCommand();
  React.useEffect(() => { if (value !== undefined && value !== search) setSearch(value); }, [value, search, setSearch]);
  // The search is the surface's first row: 40px, a rule under it, its glyph on the rows' 12px inset (the icon's slot is
  // 2px wider than the glyph, so the row starts 1px short of the inset). The input owns
  // focus for the palette's whole life, so it draws no ring; the caret and the active row show where you are. The
  // icon's slot is the pending mark's width, so the text never moves when a load starts.
  return <div
    data-slot="command-input-wrapper"
    className="flex h-(--row) shrink-0 items-center gap-2 border-b border-line ps-[calc(var(--inset)-var(--space-0-5)/2)] pe-inset type-body-sm [&_svg]:size-(--icon) [&_svg]:shrink-0 [&_svg]:text-text-3"
  >
    <span data-slot="command-input-icon" aria-hidden className="flex w-4.5 shrink-0 justify-center text-text-3">
      {loading ? <span className="pending"/> : <Icon icon={Search}/>}
    </span>
    <input
      data-slot="command-input"
      data-control=""
      role="combobox"
      aria-expanded
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={active ?? undefined}
      aria-label={label}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      placeholder={placeholder}
      value={value ?? search}
      onChange={event => { setSearch(event.target.value); onValueChange?.(event.target.value); }}
      className={cn('h-full min-w-0 flex-1 bg-transparent text-text-1 text-ellipsis outline-none placeholder:text-text-3', className)}
      {...props}
    />
  </div>;
}

function CommandList({className, ref, ...props}: Omit<React.ComponentProps<'div'>, 'id'>) {
  const {listId, label, count, loading} = useCommand();
  return <div
    ref={ref}
    // The search field points at this id (aria-controls), so a caller cannot replace it.
    id={listId}
    data-slot="command-list"
    // The input owns focus and points at the active option, so the scroller is no tab stop.
    tabIndex={-1}
    role="listbox"
    aria-label={label}
    aria-busy={loading || undefined}
    data-empty={count === 0 || undefined}
    // A flex column, so each item's CSS order (its rank) places it while searching. No scrollbar gutter: a classic bar
    // took 10px, so the highlighted row, the rules and the key caps stopped short of the frame's edge. The list scrolls
    // by wheel, touch and the arrow keys, which keep the active option in view.
    className={cn('flex max-h-(--popup-max) min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden in-data-[slot=command-dialog]:max-h-none', className)}
    {...props}
  />;
}

/** Shown when nothing matches and nothing is loading: a sentence, then the query that found nothing. */
function CommandEmpty({className, children = 'No commands match.', ...props}: React.ComponentProps<'div'>) {
  const {count, loading, query} = useCommand();
  if (count > 0 || loading) return null;
  // The list is a listbox, so the message is presentation; the command's status says it to a screen reader.
  return <div data-slot="command-empty" role="presentation" className={cn('flex flex-col gap-1 px-(--menu-px) py-6 text-center type-body-sm text-text-2', className)} {...props}>
    <p className="text-text-1">{children}</p>
    {query && <p className="break-words">Nothing matches <span className="mono">{query}</span>. Try fewer words.</p>}
  </div>;
}

/**
 * Shown while results load. Mount it while fetching; it sets the list busy and puts the pending mark where the search
 * icon was. Its words are said by the command's status, so this copy is hidden from screen readers.
 */
function CommandLoading({className, children = 'Loading', ...props}: React.ComponentProps<'div'>) {
  const {setLoading} = useCommand();
  const said = typeof children === 'string' ? children : 'Loading';
  React.useLayoutEffect(() => { setLoading(said); return () => setLoading(null); }, [said, setLoading]);
  return <div data-slot="command-loading" aria-hidden className={cn('flex min-h-(--menu-item-h) items-center gap-2 px-(--menu-px) type-label text-text-2', className)} {...props}>
    {children}
  </div>;
}

function CommandGroup({className, heading, children, ...props}: React.ComponentProps<'div'> & {heading?: React.ReactNode}) {
  const headingId = React.useId();
  return <div
    data-slot="command-group"
    role="presentation"
    // A group with no visible items hides itself, heading and all.
    className={cn('[&:not(:has([data-slot=command-item]))]:hidden in-data-searching:[&:has([data-slot=command-item])]:contents', className)}
    {...props}
  >
    {heading && <div id={headingId} aria-hidden data-slot="command-group-heading" className={cn(menuLabelClass, 'in-data-searching:hidden')}>{heading}</div>}
    <div role="group" aria-labelledby={heading ? headingId : undefined} className="flex flex-col in-data-searching:contents">{children}</div>
  </div>;
}

/** A rule between groups, drawn only: a listbox holds options and groups. Hidden while searching unless alwaysRender. */
function CommandSeparator({className, alwaysRender, ...props}: React.ComponentProps<'div'> & {alwaysRender?: boolean}) {
  const {query} = useCommand();
  if (query && !alwaysRender) return null;
  return <div data-slot="command-separator" aria-hidden className={cn(menuSeparatorClass, className)} {...props}/>;
}

type CommandItemProps = Omit<React.ComponentProps<'div'>, 'onSelect'> & {
  /** What the filter matches and onSelect receives. Defaults to the text content when it is a string. */
  value?: string;
  /** Extra words that should find this item: "rerun" for Replay. */
  keywords?: string[];
  onSelect?: (value: string) => void;
  disabled?: boolean;
  /** Keep this item visible whatever the search. */
  forceMount?: boolean;
};

function CommandItem({className, value: valueProp, keywords, onSelect, disabled, forceMount, children, ...props}: CommandItemProps) {
  const {active, setActive, matches, rank} = useCommand();
  const id = React.useId();
  const value = valueProp ?? (typeof children === 'string' ? children : '');
  if (!forceMount && !matches(value, keywords)) return null;
  const selected = active === id;
  const score = rank(value, keywords);
  return <div
    id={id}
    data-slot="command-item"
    role="option"
    aria-selected={selected}
    aria-disabled={disabled || undefined}
    data-highlighted={selected || undefined}
    data-disabled={disabled || undefined}
    data-value={value}
    data-rank={score || undefined}
    // value-ok: the item's rank in this search, known only at render, places it in the flex column.
    style={score ? {order: -score} : undefined}
    onPointerMove={() => { if (!disabled && !selected) setActive(id); }}
    onClick={() => { if (!disabled) onSelect?.(value); }}
    // The menu's row, with the active item standing in for the highlighted one: the list keeps focus in the input.
    className={cn('group/command-item', menuItemClass, className)}
    {...props}
  >{typeof children === 'string' ? <CommandLabel>{children}</CommandLabel> : children}</div>;
}

/**
 * An item's label with the matched letters underlined in text-1. A string child of CommandItem gets one
 * automatically; wrap the text yourself when the item also holds an icon or a shortcut.
 */
function CommandLabel({children, className}: {children: string; className?: string}) {
  const {query} = useCommand();
  const ranges = query ? matchRanges(children, query) : [];
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([from, to], i) => {
    if (from > at) parts.push(children.slice(at, from));
    parts.push(<mark key={i} className="bg-transparent text-text-1 underline decoration-1 underline-offset-4 forced-colors:text-[inherit]">{children.slice(from, to)}</mark>);
    at = to;
  });
  if (at < children.length) parts.push(children.slice(at));
  return <span data-slot="command-label" className={cn('min-w-0 truncate in-data-searching:text-text-2', className)}>{parts}</span>;
}

/** The command's shortcut at the row's inline end, as Kbd writes it: <CommandShortcut keys="shift+r"/>. */
function CommandShortcut({className, keys}: {className?: string; keys: string}) {
  return <span data-slot="command-shortcut" className={cn('ms-auto flex shrink-0 items-center ps-4', className)}><Kbd keys={keys}/></span>;
}

/** The hint row under the list: how to move, run and close, as a ruled row of micro labels. It hides on a touch screen. */
function CommandFooter({className, children, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="command-footer" className={cn('flex min-h-(--row-sm) shrink-0 flex-wrap items-center gap-4 border-t border-line px-inset type-micro text-text-3 pointer-coarse:hidden', className)} {...props}>
    {children}
  </div>;
}

/** One hint in the footer: the keys, then what they do. */
function CommandHint({keys, children}: {keys: string; children: React.ReactNode}) {
  return <span data-slot="command-hint" className="inline-flex items-center gap-1.5">
    <Kbd keys={keys}/>
    {children}
  </span>;
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandLoading,
  CommandGroup,
  CommandItem,
  CommandLabel,
  CommandShortcut,
  CommandSeparator,
  CommandFooter,
  CommandHint,
  useCommand,
};
