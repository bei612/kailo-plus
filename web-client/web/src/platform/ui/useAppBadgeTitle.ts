// Buzz 779af8886caae1317b4de962082429867ab61503 app/useAppShellLifecycleEffects.ts (L78-83) and
// features/notifications/lib/desktop.ts::setDesktopAppBadge: the app badge is the Home badge count,
// or a dot when only channels are unread, gated by the Home badge setting. A browser tab has no
// dock badge, so the Web host shows the same state in the document title.
import { useEffect } from "react";
import { t } from "@/shared/i18n";

export type AppBadgeState = { kind: "count"; count: number } | { kind: "dot" } | { kind: "none" };

export function appBadgeState(homeBadgeCount: number | null, unreadChannels: number): AppBadgeState {
  if (homeBadgeCount !== null && homeBadgeCount > 0) return { kind: "count", count: homeBadgeCount };
  return unreadChannels > 0 ? { kind: "dot" } : { kind: "none" };
}

export function appBadgeTitle(title: string, state: AppBadgeState): string {
  return state.kind === "count" ? `(${state.count}) ${title}` : state.kind === "dot" ? `• ${title}` : title;
}

export function useAppBadgeTitle(enabled: boolean, state: AppBadgeState) {
  const key = state.kind === "count" ? `count:${state.count}` : state.kind;
  useEffect(() => {
    let title: string;
    // The deployment display name is a required page fact; without it the title is left as is.
    try { title = t("app.title"); } catch { return; }
    document.title = enabled ? appBadgeTitle(title, state) : title;
    return () => { document.title = title; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
}
