import { getChannelDetail } from "@/features/channels/lib/channelDescription";
import { isEphemeralChannel } from "@/features/channels/lib/ephemeralChannel";
import type { Channel } from "@/shared/api/types";

export function getChannelIntroKind(channel: Channel): string {
  const isPrivate = channel.visibility === "private";
  const isEphemeral = isEphemeralChannel(channel);

  if (isPrivate && isEphemeral) {
    return "private ephemeral channel";
  }
  if (isPrivate) {
    return "private channel";
  }
  if (isEphemeral) {
    return "ephemeral channel";
  }
  return "regular channel";
}

export function getChannelIntroDescription(channel: Channel): string | null {
  return getChannelDetail(channel);
}
