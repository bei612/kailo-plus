// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/lib/channelDescription.ts::{getChannelDetail,getChannelDescription}.
// Kailo has no read-only preview before joining (DD-80, DD-46), so only the archived prefix applies,
// as in Kailo Desktop's copy of the same helper.
import { translate, type PlatformLocale } from "../i18n";

export type ChannelDescriptionSource = {
  topic?: string | null;
  description?: string | null;
  purpose?: string | null;
  archived?: boolean;
};

/** The authored channel detail shown consistently across channel surfaces. */
export function getChannelDetail(channel: ChannelDescriptionSource): string | null {
  return [channel.topic, channel.description, channel.purpose]
    .find((value) => value && value.trim().length > 0)?.trim() ?? null;
}

export function getChannelDescription(channel: ChannelDescriptionSource, locale: PlatformLocale): string {
  // Show only the first non-empty field to avoid duplication when topic, description and purpose overlap;
  // the detail keeps its own line breaks and is separated from the archived prefix by a newline.
  const detail = getChannelDetail(channel);
  const parts = [channel.archived ? translate(locale, "channel.description.archived") : null, detail].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : translate(locale, "channel.description.fallback");
}
