import * as React from "react";
import {
  useCanGoBack,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";

import type { SearchHighlightNavigation } from "@/app/navigation/searchHighlightNavigation";
import { openSearchHitWithNavigation } from "@/app/navigation/searchHitNavigation";
import type { SearchHit } from "@/shared/api/types";
import type { PlatformSection } from "@/features/platform/platformSections";

type NavigationBehavior = {
  force?: boolean;
  replace?: boolean;
  resetScroll?: boolean;
};

export function useAppNavigation() {
  const router = useRouter();
  const navigate = useNavigate();
  const location = useLocation();
  const canGoBack = useCanGoBack();

  const commitNavigation = React.useCallback(
    async (
      next: {
        to: string;
        params?: Record<string, string>;
        search?: Record<string, string | undefined>;
        state?:
          | Record<string, unknown>
          | ((
              previousState: Record<string, unknown>,
            ) => Record<string, unknown>);
      },
      behavior: NavigationBehavior = {},
    ) => {
      const nextLocation = router.buildLocation(next as never);
      const hasStateUpdate = next.state !== undefined;

      if (
        location.href === nextLocation.href &&
        !behavior.force &&
        !hasStateUpdate
      ) {
        return false;
      }

      await navigate({
        ...next,
        replace: behavior.replace,
        resetScroll: behavior.resetScroll,
      } as never);
      return true;
    },
    [location.href, navigate, router],
  );

  const goHome = React.useCallback(
    (behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/",
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goProfile = React.useCallback(
    (pubkey: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          // 资料面板挂在首页上：一期没有 Pulse（.design/01 §5 未登记）
          to: "/",
          search: { profile: pubkey },
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goChannel = React.useCallback(
    (
      channelId: string,
      options?: {
        /**
         * When set, the main composer auto-submits the draft with this key
         * once on mount. Clears itself (via `?autoSend` search param) after
         * firing. Used by the Drafts panel "Send message" confirm flow.
         */
        autoSend?: string;
        /** Navigate even when the destination matches the current href.
         * Used by desktop-notification activation so a click is never
         * silently swallowed (block/buzz#3509). */
        force?: boolean;
        messageId?: string;
        /** Preserve an active search highlight; ordinary navigation clears it. */
        preserveSearchHighlight?: boolean;
        searchHighlight?: SearchHighlightNavigation;
        replace?: boolean;
        /** Open this thread panel directly without waiting for a timeline row. */
        thread?: string;
        threadRootId?: string | null;
      },
    ) => {
      return commitNavigation(
        {
          to: "/channels/$channelId",
          params: {
            channelId,
          },
          search: {
            ...(options?.messageId
              ? {
                  messageId: options.messageId,
                  threadRootId: options.threadRootId ?? undefined,
                }
              : {}),
            ...(options?.thread ? { thread: options.thread } : {}),
            ...(options?.autoSend ? { autoSend: options.autoSend } : {}),
          },
          state: options?.preserveSearchHighlight
            ? undefined
            : (previousState: Record<string, unknown>) => ({
                ...previousState,
                searchHighlight: options?.searchHighlight ?? null,
              }),
        },
        {
          force: options?.force,
          replace: options?.replace,
          resetScroll: options?.messageId ? true : undefined,
        },
      );
    },
    [commitNavigation],
  );

  const goSettings = React.useCallback(
    (section?: string, behavior?: NavigationBehavior) =>
      commitNavigation(
        {
          to: "/settings",
          search: section ? { section } : {},
        },
        behavior,
      ),
    [commitNavigation],
  );

  const goPlatform = React.useCallback(
    (section: PlatformSection, behavior?: NavigationBehavior) =>
      commitNavigation(
        { to: "/platform/$section", params: { section } },
        behavior,
      ),
    [commitNavigation],
  );

  const closeSettings = React.useCallback(() => {
    if (canGoBack) {
      router.history.back();
      return;
    }

    void goHome({ replace: true });
  }, [canGoBack, goHome, router.history]);

  const openSearchHit = React.useCallback(
    async (
      hit: SearchHit,
      behavior?: {
        /** Navigate even when the destination matches the current href.
         * Used by desktop-notification activation so a click is never
         * silently swallowed (block/buzz#3509). */
        force?: boolean;
        /** Search text to highlight after opening this result. */
        query?: string;
        /** Stop notification-driven routing when its owning lifecycle ends. */
        signal?: AbortSignal;
      },
    ) =>
      openSearchHitWithNavigation(hit, {
        force: behavior?.force,
        goChannel,
        query: behavior?.query,
        signal: behavior?.signal,
      }),
    [goChannel],
  );

  return {
    closeSettings,
    goChannel,
    goHome,
    goPlatform,
    goProfile,
    goSettings,
    openSearchHit,
  };
}
