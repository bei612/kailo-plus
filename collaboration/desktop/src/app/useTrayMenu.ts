// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/app/useTrayMenu.ts,
// app/useAppShellTrayMenu.tsx and shared/api/trayMenu.ts. DD-125(5): the macOS tray menu shows
// the session's admitted Agent work and only navigates or opens the New Channel dialog.
// Differences: activity comes from the shared working signal (audited turns, Agent typing
// fallback) and the labels are localized with the deployment's display name (DD-111).
import * as React from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { translate, type PlatformLocale } from "@client-kit/platform/i18n";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import {
  getAgentWorkingState,
  getWorkingAgentInfo,
  useWorkingChannels,
} from "@client-kit/platform/react/agent-activity";
import { formatElapsed } from "@client-kit/platform/react/agent-transcript";
import { invokeTauri } from "@/shared/api/tauri";
import { isMacPlatform } from "@/shared/lib/platform";
import {
  buildTrayActivities,
  nextRecentActivities,
  trayMenuLabels,
  type TrayAgentActivity,
} from "./trayMenuModel";

type TrayAction =
  | { kind: "newChannel" }
  | { kind: "openChannel"; channelId: string; communityGeneration: number };

type TrayChannel = { id: string; name: string };

// The fixed labels follow the device locale from launch and gain the deployment's display name
// once a session knows it; one module-level owner keeps the two sources from racing.
const labelState: { locale: PlatformLocale | null; displayName: string | null } = { locale: null, displayName: null };

function pushTrayLabels() {
  if (!labelState.locale) return;
  void invokeTauri("update_tray_menu_labels", {
    labels: trayMenuLabels(labelState.locale, labelState.displayName, translate),
  }).catch((error) => {
    console.error("Failed to localize the tray menu", error);
  });
}

function trayAvailable(): boolean {
  return isTauri() && isMacPlatform();
}

/** Mounted once at the app root: the tray's fixed labels follow the device locale. */
export function TrayMenuLabels(): null {
  const locale = useDeviceLocale();
  React.useEffect(() => {
    if (!trayAvailable()) return;
    labelState.locale = locale;
    pushTrayLabels();
  }, [locale]);
  return null;
}

/**
 * Keeps the native tray menu synchronized with the session's working Agents and forwards its
 * navigation actions into the app. Unmounting it (sign-out, server switch) is the original
 * community switch: activity and queued channel navigation are cleared.
 */
export function useTrayMenu({
  channels,
  displayName,
  goChannel,
  openCreateChannel,
}: {
  channels: readonly TrayChannel[];
  displayName: string | null;
  goChannel: (channelId: string) => void;
  openCreateChannel: () => void;
}): void {
  const enabled = trayAvailable();
  const locale = useDeviceLocale();
  const working = useWorkingChannels();
  const [now, setNow] = React.useState(() => Date.now());
  const previousActivitiesRef = React.useRef(new Map<string, TrayAgentActivity>());
  const [recentActivities, setRecentActivities] = React.useState<TrayAgentActivity[]>([]);

  React.useEffect(() => {
    if (!enabled || working.length === 0) return;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [enabled, working.length]);

  const activities = React.useMemo(() => {
    const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
    return buildTrayActivities(working, channelNames, {
      agentName: (channelId, pubkey) => getWorkingAgentInfo(channelId, pubkey)?.name,
      agentAnchor: (channelId, pubkey) => getAgentWorkingState(pubkey, channelId).channels
        .find((entry) => entry.channelId === channelId && entry.source === "turn")?.anchorAt,
    }, now, (key, variables) => translate(locale, key, variables), formatElapsed);
  }, [channels, locale, now, working]);

  React.useEffect(() => {
    setRecentActivities((current) =>
      nextRecentActivities(previousActivitiesRef.current, activities, current, Date.now()));
    previousActivitiesRef.current = new Map(activities.map((activity) => [activity.activityId, activity]));
  }, [activities]);

  React.useEffect(() => {
    if (!enabled) return;
    void invokeTauri("update_tray_agent_activity", { activities, recentActivities }).catch((error) => {
      console.error("Failed to update the macOS tray menu", error);
    });
  }, [activities, enabled, recentActivities]);

  React.useEffect(() => {
    if (!enabled) return;
    labelState.displayName = displayName;
    pushTrayLabels();
    return () => {
      labelState.displayName = null;
      pushTrayLabels();
    };
  }, [displayName, enabled]);

  // The original community switch: nothing from this session survives in the tray.
  React.useEffect(() => {
    if (!enabled) return;
    return () => {
      void invokeTauri("clear_tray_agent_activity").catch((error) => {
        console.error("Failed to clear the macOS tray menu", error);
      });
    };
  }, [enabled]);

  const openCreateChannelRef = React.useRef(openCreateChannel);
  openCreateChannelRef.current = openCreateChannel;
  const goChannelRef = React.useRef(goChannel);
  goChannelRef.current = goChannel;
  const channelIdsRef = React.useRef(new Set<string>());
  channelIdsRef.current = new Set(channels.map((channel) => channel.id));

  React.useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const handlePendingActions = async () => {
      if (disposed) return;
      const actions = await invokeTauri<TrayAction[]>("take_tray_actions");
      if (disposed) {
        if (actions.length > 0) {
          await invokeTauri("requeue_tray_actions", { actions });
        }
        return;
      }
      for (const action of actions) {
        if (action.kind === "newChannel") {
          openCreateChannelRef.current();
        } else if (channelIdsRef.current.has(action.channelId)) {
          // Only a channel this session can still see; a stale row navigates nowhere.
          goChannelRef.current(action.channelId);
        }
      }
    };

    void (async () => {
      const nextUnlisten = await listen("tray-action-available", () => {
        void handlePendingActions();
      });
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
      await handlePendingActions();
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled]);
}
