// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/channels/lib/channelDescription.ts:
// the one channel-detail order and description text, now the shared client-kit helper the Web
// host uses (localized archived prefix and fallback). The native Channel carries `archivedAt`.
import { getLocale, type PlatformLocale } from "@client-kit/platform/i18n";
import {
  getChannelDescription as getSharedChannelDescription,
  getChannelDetail as getSharedChannelDetail,
} from "@client-kit/platform/react/channel-description";
import type { Channel } from "@/shared/api/types";

type ChannelDetailFields = Pick<Channel, "topic" | "description" | "purpose" | "archivedAt">;

/** The authored channel detail shown consistently across channel surfaces. */
export function getChannelDetail(channel: ChannelDetailFields): string | null {
  return getSharedChannelDetail(channel);
}

export function getChannelDescription(
  channel: ChannelDetailFields,
  locale: PlatformLocale = getLocale(),
): string {
  return getSharedChannelDescription(
    {
      topic: channel.topic,
      description: channel.description,
      purpose: channel.purpose,
      archived: Boolean(channel.archivedAt),
    },
    locale,
  );
}
