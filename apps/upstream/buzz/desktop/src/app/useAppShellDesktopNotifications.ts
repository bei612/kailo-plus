import * as React from "react";

import {
  activateDesktopNotificationTarget,
  createDesktopNotificationActivationQueue,
  shouldBounceForChannelNotification,
} from "@/app/AppShell.helpers";
import { hasMentionForEvent } from "@/features/notifications/lib/shouldNotify";
import type { NotificationSettings } from "@/features/notifications/hooks";
import {
  listenForDesktopNotificationActions,
  requestDockBounce,
  revealDesktopAppWindow,
  sendDesktopNotification,
} from "@/features/notifications/lib/desktop";
import { formatMessageNotification } from "@/features/notifications/lib/notificationFormat";
import { buildEventNotificationTarget } from "@/features/notifications/lib/target";
import {
  playNotificationSound,
  resolveSlotSound,
} from "@/features/notifications/lib/sound";
import { useNotificationSenderName } from "@/features/notifications/useNotificationSenderName";
import type { Channel, RelayEvent } from "@/shared/api/types";

export function useAppShellDesktopNotifications({
  channels,
  goChannel,
  goHome,
  notificationSettings,
  openSearchHit,
  pubkey,
}: {
  channels: Channel[];
  goChannel: (
    channelId: string,
    options?: { force?: boolean },
  ) => Promise<unknown>;
  goHome: () => Promise<unknown>;
  notificationSettings: NotificationSettings;
  openSearchHit: (
    hit: import("@/shared/api/types").SearchHit,
    behavior?: { force?: boolean },
  ) => Promise<unknown>;
  pubkey?: string;
}) {
  const resolveSenderName = useNotificationSenderName();

  const handleChannelNotification = React.useEffectEvent(
    (_channelId: string, event: RelayEvent) => {
      if (!shouldBounceForChannelNotification(event.tags)) return;
      if (!notificationSettings.desktopEnabled) return;
      void requestDockBounce();
    },
  );

  const handleThreadReplyDesktopNotification = React.useEffectEvent(
    (channelId: string, event: RelayEvent) => {
      if (
        !notificationSettings.desktopEnabled ||
        !notificationSettings.slotAlertsEnabled.thread_reply
      ) {
        return;
      }

      // Replies that @-mention the user are owned by the home-feed mention
      // path — skip them here so they don't notify (and sound) twice.
      const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";
      if (hasMentionForEvent(event, normalizedPubkey)) {
        return;
      }

      const resolvedChannel = channels.find((c) => c.id === channelId);
      const channelName = resolvedChannel?.name?.trim() ?? null;
      const { title, body } = formatMessageNotification({
        source: "thread_reply",
        senderName: resolveSenderName(event.pubkey),
        channelName,
        content: event.content,
      });

      void sendDesktopNotification({
        title,
        body,
        target: buildEventNotificationTarget(event, {
          id: channelId,
          name: channelName,
        }),
      }).then((didSend) => {
        if (!didSend) return;
        playNotificationSound(
          resolveSlotSound(notificationSettings, "thread_reply"),
        );
        void requestDockBounce();
      });
    },
  );

  const handleDesktopNotificationAction = React.useEffectEvent(
    async (
      target: import("@/features/notifications/lib/desktop").DesktopNotificationTarget,
      signal: AbortSignal,
    ) => {
      await activateDesktopNotificationTarget(
        target,
        {
          goChannel,
          goHome,
          openSearchHit,
          revealWindow: revealDesktopAppWindow,
        },
        signal,
      );
    },
  );

  React.useEffect(() => {
    let isCancelled = false;
    let cleanup = () => {};
    const activationQueue = createDesktopNotificationActivationQueue(
      (target, signal) => handleDesktopNotificationAction(target, signal),
      (error) => {
        console.error("Failed to activate desktop notification", error);
      },
    );

    void listenForDesktopNotificationActions((target) => {
      if (isCancelled) {
        return;
      }

      activationQueue.enqueue(target);
    }).then((dispose) => {
      if (isCancelled) {
        dispose();
        return;
      }

      cleanup = dispose;
    });

    return () => {
      isCancelled = true;
      activationQueue.cancel();
      cleanup();
    };
  }, []);

  return {
    handleChannelNotification,
    handleThreadReplyDesktopNotification,
  };
}
