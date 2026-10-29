'use client';

import {mergeProps} from '@base-ui/react/merge-props';
import {useRender} from '@base-ui/react/use-render';
import {cva, type VariantProps} from 'class-variance-authority';
import {createContext, useContext, useMemo, useRef, type ComponentProps, type ReactNode, type RefObject} from 'react';
import {Icon, ChevronDown} from '@/components/sodium/icon';
import {cn, mergeRefs} from '@/lib/sodium/utils';
import {Button, type ButtonProps} from '@/components/sodium/ui/button';
import {DropdownMenu, DropdownMenuContent, DropdownMenuTrigger} from '@/components/sodium/ui/dropdown-menu';

// Sodium's button group: related buttons joined into one ruled control. Members overlap by a pixel, so two edges make
// one 1px seam, never a 2px one, and the group reads as a row of cells split by rules. The hovered, held or focused
// member rises over its neighbours so its whole edge shows. Nothing scales, so the seams never open.
//
// Use it for actions of one kind side by side: previous and next, zoom out and in. It is a group of actions, so the
// lint counts it as one group: its members are secondary or ghost, and the one slab sits beside it, never in it.
//
// ButtonGroupText is a value inside the row (a page count, a zoom level) on the same height, on the secondary's body
// with its edge so it joins the seams, its label in text-2. It is never pressed, so it is unlit and has no hover.
// Members are Buttons, so a secondary member carries the light from below and the halo; the hovered one rises, so its
// halo shows whole. ButtonGroupSeparator is a 1px rule between halves of a group of
// ghost members.
//
// Split button: ButtonGroupMenu as the last member is a square caret cell that opens a DropdownMenu of close
// alternatives ("Run on changed partitions", "Run from a commit"). The menu anchors to the whole group, not the caret,
// so it lines up under both cells and is at least as wide as the group. It is a member like any other, edged or quiet,
// never the slab: the group is one control, and the page's one primary stands beside it. Pass the main action's
// pending to the menu, so the alternatives lock while it runs.

const buttonGroupVariants = cva(
  [
    'flex w-fit items-stretch',
    '[&>*]:hover:z-(--z-raised) [&>*]:active:z-(--z-raised) [&>*]:focus-visible:z-(--z-raised)',
    // A member's ring is drawn on its own edge, so it never covers the label of the cell beside it.
    '[&>*]:focus-visible:focus-ring-inset',
    'has-[>[data-slot=button-group]]:gap-2',
  ],
  {
    variants: {
      orientation: {
        horizontal: '[&>:not([data-slot=button-group],[data-slot=button-group-separator])+:not([data-slot=button-group],[data-slot=button-group-separator])]:-ms-px',
        vertical: 'flex-col [&>:not([data-slot=button-group],[data-slot=button-group-separator])+:not([data-slot=button-group],[data-slot=button-group-separator])]:-mt-px',
      },
    },
    defaultVariants: {orientation: 'horizontal'},
  },
);

type ButtonGroupProps = ComponentProps<'div'> & VariantProps<typeof buttonGroupVariants>;

// The group's element, for a split button's menu to anchor to.
const GroupAnchor = createContext<RefObject<HTMLDivElement | null> | null>(null);

/** A row or column of joined buttons. Name it with aria-label when its members do not say what they act on. */
function ButtonGroup({className, orientation = 'horizontal', ref, ...props}: ButtonGroupProps) {
  const own = useRef<HTMLDivElement | null>(null);
  const setRef = useMemo(() => mergeRefs<HTMLDivElement>(own, ref), [ref]);
  return <GroupAnchor.Provider value={own}>
    <div
      ref={setRef}
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({orientation}), className)}
      {...props}
    />
  </GroupAnchor.Provider>;
}

type ButtonGroupMenuProps = {
  /** The caret's name: what the alternatives are. "More run options". */
  label: string;
  /** DropdownMenuItems, groups and separators. */
  children: ReactNode;
  /** Match the main action: secondary (the default) or ghost. A group never holds the slab. */
  variant?: 'secondary' | 'ghost';
  /** Match the main action's size. */
  size?: 'sm' | 'default' | 'lg';
  /** The main action is running: the caret locks with it. */
  pending?: boolean;
  disabled?: boolean;
  /** Where the menu lines up under the group. */
  align?: 'start' | 'end';
};

const caretSize: Record<NonNullable<ButtonGroupMenuProps['size']>, ButtonProps['size']> = {sm: 'icon-sm', default: 'icon', lg: 'icon-lg'};

/** Split mode: a caret member that opens a menu of alternatives, anchored to the whole group. The caret turns at once. */
function ButtonGroupMenu({label, children, variant = 'secondary', size = 'default', pending, disabled, align = 'end'}: ButtonGroupMenuProps) {
  const anchor = useContext(GroupAnchor);
  return <DropdownMenu>
    <DropdownMenuTrigger
      render={<Button variant={variant} size={caretSize[size]}/>}
      disabled={disabled || pending}
      aria-label={label}
      data-slot="button-group-menu-trigger"
    >
      <Icon icon={ChevronDown} className="in-data-popup-open:rotate-180"/>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      data-slot="button-group-menu"
      anchor={anchor ?? undefined}
      align={align}
      size={size === 'sm' ? 'sm' : 'default'}
      className="min-w-(--anchor-width) max-w-[min(var(--popover),var(--available-width))]"
    >{children}</DropdownMenuContent>
  </DropdownMenu>;
}

/** A label or value inside the group, such as "2 of 14", joined to the members around it. */
function ButtonGroupText({className, render, ...props}: useRender.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        ...({'data-slot': 'button-group-text'} as ComponentProps<'div'>),
        className: cn('relative flex items-center gap-1.5 border border-line bg-secondary-bg px-3 type-label whitespace-nowrap text-text-2 [&_svg]:pointer-events-none [&_svg]:size-(--icon)', className),
      },
      props,
    ),
  });
}

/** A 1px rule between two halves of a group of ghost buttons. */
function ButtonGroupSeparator({className, orientation = 'vertical', ...props}: ComponentProps<'div'> & {orientation?: 'horizontal' | 'vertical'}) {
  return <div
    role="separator"
    aria-orientation={orientation}
    data-slot="button-group-separator"
    data-orientation={orientation}
    className={cn('relative shrink-0 self-stretch bg-line forced-colors:bg-[CanvasText]', orientation === 'vertical' ? 'mx-1 my-1.5 w-px' : 'mx-1.5 my-1 h-px', className)}
    {...props}
  />;
}

export {ButtonGroup, ButtonGroupMenu, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants, type ButtonGroupMenuProps, type ButtonGroupProps};
