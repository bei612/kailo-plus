import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { HomeScreen } from "@/features/home/ui/HomeScreen";
import { useIdentityQuery } from "@/shared/api/hooks";

type HomeRouteSearch = {
  item?: string;
  profile?: string;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function validateHomeSearch(search: Record<string, unknown>): HomeRouteSearch {
  return {
    item: nonEmptyString(search.item),
    profile: nonEmptyString(search.profile),
  };
}

export const Route = createFileRoute("/")({
  validateSearch: validateHomeSearch,
  component: HomeRouteComponent,
});

function HomeRouteComponent() {
  const { goChannel } = useAppNavigation();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const channels = channelsQuery.data;
  const availableChannelIds = React.useMemo(
    () => new Set((channels ?? []).map((channel) => channel.id)),
    [channels],
  );

  return (
    <HomeScreen
      availableChannelIds={availableChannelIds}
      currentPubkey={identityQuery.data?.pubkey}
      onOpenContext={(channelId, messageId, threadRootId) => {
        return goChannel(channelId, { messageId, threadRootId });
      }}
    />
  );
}
