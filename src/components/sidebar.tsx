'use client';

import * as React from 'react';
import {useIsMobile} from '@/hooks/use-mobile';
import {cn} from '@/lib/sodium/utils';
import {Sheet, SheetContent, SheetDescription, SheetTitle} from '@/components/sodium/ui/sheet';

// The app's sidebar, on Sodium: a ruled column of the layout on desktop (the panel fill, split from the page by one
// rule) and a modal Sheet from the start edge on a phone. It keeps the API the shadcn sidebar had: SidebarProvider holds
// the open state (persisted in the sidebar_state cookie, toggled by Cmd/Ctrl+B) and useSidebar reads it.

const SIDEBAR_COOKIE_NAME = 'sidebar_state';
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

type SidebarContextProps = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.');
  return context;
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);

  // Internal state, unless the caller controls it with open and onOpenChange.
  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === 'function' ? value(open) : value;
      if (setOpenProp) setOpenProp(openState);
      else _setOpen(openState);
      // Keeps the sidebar's state between visits.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
    },
    [setOpenProp, open],
  );

  const toggleSidebar = React.useCallback(() => {
    if (isMobile) setOpenMobile(value => !value);
    else setOpen(value => !value);
  }, [isMobile, setOpen]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  const state = open ? 'expanded' : 'collapsed';

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar}),
    [state, open, setOpen, isMobile, openMobile, toggleSidebar],
  );

  return <SidebarContext.Provider value={contextValue}>
    <div data-slot="sidebar-wrapper" className={cn('flex min-h-dvh w-full', className)} {...props}>
      {children}
    </div>
  </SidebarContext.Provider>;
}

/**
 * The sidebar column. Desktop: a 256px ruled panel fixed to the start edge, with a gap in the flow beside it that
 * closes when it collapses. Phone: a modal Sheet named "Sidebar".
 */
function Sidebar({className, children, ...props}: React.ComponentProps<'div'>) {
  const {isMobile, state, openMobile, setOpenMobile} = useSidebar();

  if (isMobile) {
    return <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent
        data-sidebar="sidebar"
        data-slot="sidebar"
        data-mobile="true"
        side="start"
        showCloseButton={false}
        className={className}
      >
        <SheetTitle className="sr-only">Sidebar</SheetTitle>
        <SheetDescription className="sr-only">Displays the mobile sidebar.</SheetDescription>
        <div className="flex h-full w-full min-h-0 flex-col">{children}</div>
      </SheetContent>
    </Sheet>;
  }

  const collapsed = state === 'collapsed';
  return <div className="group peer hidden text-text-1 md:block" data-state={state} data-slot="sidebar">
    {/* Holds the sidebar's width in the flow, so the page sits beside it. */}
    <div
      data-slot="sidebar-gap"
      className={cn('w-64 transition-[width] duration-(--dur-overlay) ease-out motion-reduce:transition-none', collapsed && 'w-0')}
    />
    <div
      data-slot="sidebar-container"
      data-sidebar="sidebar"
      inert={collapsed || undefined}
      className={cn(
        'fixed inset-y-0 start-0 z-(--z-raised) flex h-dvh w-64 flex-col border-e border-line bg-panel',
        'transition-transform duration-(--dur-overlay) ease-out motion-reduce:transition-none',
        collapsed && '-translate-x-full rtl:translate-x-full',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  </div>;
}

/** The page beside the sidebar. */
function SidebarInset({className, ...props}: React.ComponentProps<'main'>) {
  return <main data-slot="sidebar-inset" className={cn('relative flex min-w-0 w-full flex-1 flex-col bg-page', className)} {...props}/>;
}

/** The sidebar's head row: panel-head, the app's name and its controls. */
function SidebarHeader({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('panel-head shrink-0', className)} {...props}/>;
}

/** The scrolling middle of the sidebar. */
function SidebarContent({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', className)} {...props}/>;
}

/** The sidebar's foot, under one rule. */
function SidebarFooter({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('shrink-0 border-t border-line p-inset', className)} {...props}/>;
}

export {
  Sidebar,
  SidebarProvider,
  SidebarInset,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  useSidebar,
  type SidebarContextProps,
};
