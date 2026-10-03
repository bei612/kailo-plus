import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { NativeBootstrap } from "@client-kit/platform/react/NativeBootstrap";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";

import { router } from "@/app/router";
import { ThemeGrainientBackground } from "@/app/ThemeGrainientBackground";
import { CommunityThemeController } from "@/shared/theme/CommunityThemeController";
import { useReloadShortcut } from "@/app/useReloadShortcut";
import { useCloseWindowShortcut } from "@/app/useCloseWindowShortcut";
import {
  ActiveCommunityProvider,
  useActiveCommunity,
} from "@/features/platform/activeCommunity";
import {
  connectCommunity,
  disconnectCommunity,
} from "@/features/platform/connectCommunity";
import { DeviceIdentityGate } from "@/features/platform/DeviceIdentityGate";
import { createBuzzQueryClient } from "@/shared/api/queryClient";
import { hydrateChannelHeads } from "@/features/messages/lib/channelHeadCache";
import { cn } from "@/shared/lib/cn";
import { FlappingBee } from "@/shared/ui/buzz-logo/FlappingBee";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";

const LOADING_TEXT = "Starting…";

// Minimum time the cold-boot splash stays on screen. A real boot resolves the
// community in well under 100ms, and the native window setup plus first paint
// can take longer than that — without a hold, the bee is unmounted before it is
// ever visible. The hold runs as an overlay above the already-mounted app, so
// time-to-interactive is unchanged; only the reveal waits.
const BOOT_SPLASH_MIN_VISIBLE_MS = 1_200;
const BOOT_SPLASH_FADE_MS = 200;
const INITIAL_RENDER_READY_EVENT = "initial-render-ready";

type BootSplashPhase = "holding" | "fading" | "done";

function useInitialRenderReady() {
  useLayoutEffect(() => {
    if (!isTauri()) {
      return;
    }

    void emit(INITIAL_RENDER_READY_EVENT);
  }, []);
}

// E2E runs skip the hold (it would slow every spec's boot and block pointer
// actionability); a spec can opt back in via __BUZZ_E2E__.bootSplashHoldMs.
function bootSplashHoldMs(): number {
  const e2e = (
    window as Window & {
      __BUZZ_E2E__?: { bootSplashHoldMs?: number };
    }
  ).__BUZZ_E2E__;
  if (e2e) {
    return e2e.bootSplashHoldMs ?? 0;
  }
  return BOOT_SPLASH_MIN_VISIBLE_MS;
}

function useBootSplashHold(): BootSplashPhase {
  const [phase, setPhase] = useState<BootSplashPhase>(() =>
    bootSplashHoldMs() > 0 ? "holding" : "done",
  );

  useEffect(() => {
    const holdMs = bootSplashHoldMs();
    if (holdMs <= 0) {
      return;
    }
    const fadeTimer = window.setTimeout(() => setPhase("fading"), holdMs);
    const doneTimer = window.setTimeout(
      () => setPhase("done"),
      holdMs + BOOT_SPLASH_FADE_MS,
    );
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  return phase;
}

// Cold boot gate: the theme-adaptive grainient background with a single
// centered Buzz bee flying over it.
function AppLoadingGate() {
  return (
    <div
      className="buzz-setup-loading-shell flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-10"
      data-testid="app-loading-gate"
      role="status"
    >
      <StartupWindowDragRegion />
      <ThemeGrainientBackground />
      <span className="sr-only">{LOADING_TEXT}</span>
      <FlappingBee className="relative z-10 h-auto w-28" />
    </div>
  );
}

function CommunityQueryProvider({
  children,
  pubkey,
  relayUrl,
}: {
  children: ReactNode;
  pubkey: string;
  relayUrl: string;
}) {
  // Seeding persisted channel heads is part of constructing the client, not a
  // gate in front of the app: the splash, router, and relay preconnect mount
  // immediately, and only the channel query waits on the cache load (see
  // channelHeadHydration). It must start here rather than in an effect —
  // React Query fires a child's queryFn when it subscribes, before any parent
  // effect runs. The provider is keyed on the session, so one client maps to
  // one {pubkey, relayUrl} scope.
  const [queryClient] = useState(() => {
    const client = createBuzzQueryClient();
    void hydrateChannelHeads(client, { pubkey, relayUrl });
    return client;
  });

  useEffect(() => {
    const e2eWindow = window as Window & {
      __BUZZ_E2E__?: unknown;
      __BUZZ_E2E_QUERY_CLIENT__?: typeof queryClient;
    };
    if (!e2eWindow.__BUZZ_E2E__) {
      return;
    }

    e2eWindow.__BUZZ_E2E_QUERY_CLIENT__ = queryClient;
    return () => {
      if (e2eWindow.__BUZZ_E2E_QUERY_CLIENT__ === queryClient) {
        delete e2eWindow.__BUZZ_E2E_QUERY_CLIENT__;
      }
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/**
 * The collaboration app for the one community this sign-in connected to. It
 * mounts only after the platform bootstrap applied that community to the Rust
 * side, so nothing here ever talks to a relay the session did not resolve.
 */
function CommunityApp({ devicePubkey }: { devicePubkey: string }) {
  const community = useActiveCommunity();
  const bootSplashPhase = useBootSplashHold();
  // 注销后不留以设备身份认证的 Relay 连接（见 disconnectCommunity）
  useEffect(() => disconnectCommunity, []);

  return (
    <CommunityQueryProvider pubkey={devicePubkey} relayUrl={community.relayUrl}>
      <CommunityThemeController />
      <RouterProvider router={router} />
      {bootSplashPhase !== "done" ? (
        <div
          aria-hidden="true"
          className={cn(
            "fixed inset-0 z-50 transition-opacity",
            bootSplashPhase === "fading" ? "opacity-0" : "opacity-100",
          )}
          data-testid="boot-splash-overlay"
          style={{ transitionDuration: `${BOOT_SPLASH_FADE_MS}ms` }}
        >
          <AppLoadingGate />
        </div>
      ) : null}
    </CommunityQueryProvider>
  );
}

export function App() {
  useReloadShortcut();
  useCloseWindowShortcut();
  useInitialRenderReady();
  const [queryClient] = useState(createBuzzQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <DeviceIdentityGate loading={<AppLoadingGate />}>
        <NativeBootstrap connect={connectCommunity} invoke={invoke}>
          {(session) => (
            <ActiveCommunityProvider
              key={`${session.facts.relayUrl}-${session.devicePubkey}`}
              session={session}
            >
              <CommunityApp devicePubkey={session.devicePubkey} />
            </ActiveCommunityProvider>
          )}
        </NativeBootstrap>
      </DeviceIdentityGate>
    </QueryClientProvider>
  );
}
