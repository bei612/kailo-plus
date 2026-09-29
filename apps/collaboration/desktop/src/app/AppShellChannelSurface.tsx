import type * as React from "react";
import * as BuzzTheme from "@/app/BuzzThemeSurfaces";
import { MainInsetProvider } from "@/shared/layout/MainInsetContext";
import { chromeCssVarDefaults } from "@/shared/layout/chromeLayout";
import { cn } from "@/shared/lib/cn";
import { SidebarInset, useSidebar } from "@/shared/ui/sidebar";

type AppShellChannelSurfaceProps = {
  children: React.ReactNode;
  mainInsetRef: React.RefObject<HTMLElement | null>;
};

export function AppShellChannelSurface({
  children,
  mainInsetRef,
}: AppShellChannelSurfaceProps) {
  const { isMobile, openMobile, state: sidebarState } = useSidebar();
  const hasCollapsedSidebarGutter = isMobile
    ? !openMobile
    : sidebarState === "collapsed";

  return (
    <MainInsetProvider mainInsetRef={mainInsetRef}>
      <SidebarInset
        ref={mainInsetRef}
        className={cn(
          "isolate z-0 min-h-0 min-w-0 overflow-hidden bg-sidebar",
          hasCollapsedSidebarGutter && "pl-2",
        )}
        data-buzz-glass-inset
        data-buzz-shadow-viewport
        style={chromeCssVarDefaults as React.CSSProperties}
      >
        {hasCollapsedSidebarGutter ? (
          <div
            className="absolute inset-y-0 left-0 w-2 bg-sidebar"
            data-collapsed-content-gutter
          />
        ) : null}
        <BuzzTheme.ContentSurface>{children}</BuzzTheme.ContentSurface>
      </SidebarInset>
    </MainInsetProvider>
  );
}
