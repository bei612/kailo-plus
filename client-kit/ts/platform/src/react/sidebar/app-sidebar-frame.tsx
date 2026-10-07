// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/ui/AppSidebar.tsx.
// Shared original layout; hosts retain directory, search, unread and signing authority.
import { useEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from "react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarRail } from "./sidebar";

export function AppSidebarPinnedHeaderFrame({ children }: { children: ReactNode }) {
  return <div className="mx-[3px] shrink-0 px-2 pb-2 pt-3" data-testid="sidebar-pinned-header">{children}</div>;
}

export function AppSidebarFrame({ children, pinnedHeader, above, below, footer, dialogs, scrollRef, ...props }:
  Omit<ComponentProps<typeof Sidebar>, "children"> & {
    children: ReactNode; pinnedHeader?: ReactNode; above?: ReactNode; below?: ReactNode;
    footer: ReactNode; dialogs?: ReactNode; scrollRef?: RefObject<HTMLDivElement | null>;
  }) {
  const localScrollRef = useRef<HTMLDivElement>(null);
  const contentRef = scrollRef ?? localScrollRef;
  useEffect(() => {
    const scrollElement = contentRef.current;
    if (!scrollElement) return;

    // Original AppSidebar wheel handling, shared by both actual hosts.
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      const maxScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
      if (maxScrollTop <= 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const atTop = scrollElement.scrollTop <= 0;
      const atBottom = scrollElement.scrollTop >= maxScrollTop - 1;
      const scrollingPastTop = event.deltaY < 0 && atTop;
      const scrollingPastBottom = event.deltaY > 0 && atBottom;
      if (scrollingPastTop || scrollingPastBottom) {
        event.preventDefault();
        event.stopPropagation();
        scrollElement.scrollTop = scrollingPastTop ? 0 : maxScrollTop;
      }
    };
    scrollElement.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => scrollElement.removeEventListener("wheel", handleWheel, { capture: true });
  }, [contentRef]);
  return <Sidebar className="!z-[100] !border-r-0" collapsible="offcanvas" data-testid="app-sidebar" variant="sidebar" {...props}>
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" data-sidebar-background data-testid="app-sidebar-scroll-anchor">
      {pinnedHeader}
      <div className="relative flex min-h-0 flex-1 flex-col" data-sidebar-background data-testid="sidebar-channel-content">
        {above}
        <SidebarContent className="buzz-sidebar-scrollbar overscroll-none [overflow-anchor:none]" data-sidebar-background ref={contentRef}>
          <div className="flex w-full flex-col gap-2 px-[3px]" data-sidebar-background data-testid="sidebar-scroll-content">{children}</div>
        </SidebarContent>
      </div>
      <div className="relative z-30 shrink-0" data-buzz-glass-footer-wrap>{below}<SidebarFooter>{footer}</SidebarFooter></div>
    </div>
    {dialogs}
    <SidebarRail />
  </Sidebar>;
}
