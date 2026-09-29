import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type ChannelDeepLinkPayload = { channelId: string };

/**
 * Payload emitted by the Rust deep-link handler for `buzz://message?…`.
 * Field names match the JSON shape produced in `desktop/src-tauri/src/lib.rs`.
 */
export type MessageDeepLinkPayload = {
  channelId: string;
  messageId: string;
  threadRootId: string | null;
};

type PendingNavigationDeepLink = {
  id: string;
  kind: "channel" | "message";
  channelId: string;
  messageId: string | null;
  threadRootId: string | null;
};

let navigationDrainTail: Promise<void> = Promise.resolve();
let navigationDrainGeneration = 0;
let navigationDrainEnabled = true;

export async function resetNavigationDeepLinkDrain(): Promise<void> {
  const generation = ++navigationDrainGeneration;
  // Fail closed while the outgoing session's native queue is being cleared.
  // A rejected clear leaves that queue's identity unknown, so no later listener
  // may route it against a different community.
  navigationDrainEnabled = false;
  await invoke("clear_pending_navigation_deep_links");
  if (generation === navigationDrainGeneration) {
    navigationDrainEnabled = true;
  }
}

function serializeNavigationDrain(task: () => Promise<void>): Promise<void> {
  const drain = navigationDrainTail.then(task, task);
  // Keep the shared tail fulfilled so one route failure cannot poison future
  // listener mounts. The caller still receives `drain` and reports the error.
  navigationDrainTail = drain.catch(() => {});
  return drain;
}

async function drainPendingNavigationDeepLinks(
  onOpenChannel: (
    payload: ChannelDeepLinkPayload,
  ) => boolean | Promise<boolean>,
  onOpenMessage: (
    payload: MessageDeepLinkPayload,
  ) => boolean | Promise<boolean>,
) {
  const generation = navigationDrainGeneration;
  if (!navigationDrainEnabled) return;
  while (navigationDrainEnabled && generation === navigationDrainGeneration) {
    const pending = await invoke<PendingNavigationDeepLink | null>(
      "take_pending_navigation_deep_link",
    );
    if (
      !pending ||
      !navigationDrainEnabled ||
      generation !== navigationDrainGeneration
    ) {
      return;
    }
    const accepted = await (pending.kind === "channel"
      ? onOpenChannel({ channelId: pending.channelId })
      : pending.messageId
        ? onOpenMessage({
            channelId: pending.channelId,
            messageId: pending.messageId,
            threadRootId: pending.threadRootId,
          })
        : false);
    if (!accepted || generation !== navigationDrainGeneration) return;
    const acknowledged = await invoke<boolean>(
      "acknowledge_pending_navigation_deep_link",
      { id: pending.id },
    );
    if (!acknowledged) return;
  }
}

/**
 * Register listeners for queued channel/message navigation emitted by Rust.
 * A consumer must explicitly accept each item before it is acknowledged, so
 * effect teardown leaves an in-flight queue head available for the next mount.
 */
export async function listenForNavigationDeepLinks(
  onOpenChannel: (
    payload: ChannelDeepLinkPayload,
  ) => boolean | Promise<boolean>,
  onOpenMessage: (
    payload: MessageDeepLinkPayload,
  ) => boolean | Promise<boolean>,
): Promise<UnlistenFn> {
  let drainRunning = false;
  let drainRequested = false;
  const drain = () => {
    drainRequested = true;
    if (drainRunning) return;
    drainRunning = true;
    void (async () => {
      try {
        while (drainRequested) {
          drainRequested = false;
          await serializeNavigationDrain(() =>
            drainPendingNavigationDeepLinks(onOpenChannel, onOpenMessage),
          );
        }
      } catch (error: unknown) {
        console.warn("Failed to drain pending navigation deep links", error);
      } finally {
        drainRunning = false;
        if (drainRequested) drain();
      }
    })();
  };

  const unlistens = await Promise.all([
    listen<ChannelDeepLinkPayload>("deep-link-channel", drain),
    listen<MessageDeepLinkPayload>("deep-link-message", drain),
  ]);
  drain();
  return () => {
    for (const unlisten of unlistens) unlisten();
  };
}
