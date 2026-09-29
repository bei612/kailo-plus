import * as React from "react";

import {
  getChannelIntroDescription,
  getChannelIntroKind,
} from "@/features/channels/ui/ChannelPane.helpers";
import type { Channel } from "@/shared/api/types";

/**
 * Builds the empty-channel intro block (heading and description) for the
 * channel timeline.
 */
export function useChannelIntro(activeChannel: Channel | null) {
  return React.useMemo(() => {
    if (!activeChannel) {
      return null;
    }

    return {
      channelKindLabel: getChannelIntroKind(activeChannel),
      channelName: activeChannel.name,
      description: getChannelIntroDescription(activeChannel),
    };
  }, [activeChannel]);
}
