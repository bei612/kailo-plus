import * as React from "react";
import type { ChannelPaneProps } from "@/features/channels/ui/ChannelPane.types";
import { buildMainTimelineEntries } from "@/features/messages/lib/threadPanel";

type ChannelPaneMessagesOptions = Pick<
  ChannelPaneProps,
  "messages" | "profiles" | "threadSummaries"
>;

export function useChannelPaneMessages({
  messages,
  profiles,
  threadSummaries,
}: ChannelPaneMessagesOptions) {
  const mainTimelineEntries = React.useMemo(
    () =>
      buildMainTimelineEntries(messages, new Set(), threadSummaries, profiles),
    [messages, profiles, threadSummaries],
  );

  return { mainTimelineEntries };
}
