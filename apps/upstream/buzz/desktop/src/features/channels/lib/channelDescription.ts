import type { Channel } from "@/shared/api/types";

/** The authored channel detail shown consistently across channel surfaces. */
export function getChannelDetail(channel: Channel): string | null {
  return (
    [channel.topic, channel.description, channel.purpose]
      .find((value) => value && value.trim().length > 0)
      ?.trim() ?? null
  );
}

export function getChannelDescription(channel: Channel): string {
  // Show only the first non-empty field to avoid duplication when
  // topic, description, and purpose contain overlapping text.
  const detail = getChannelDetail(channel);

  // Keep the detail text's own line breaks intact (native `title` tooltips
  // render newlines) and separate it from the archived prefix with a newline
  // so paragraphs stay readable.
  const parts = [channel.archivedAt ? "Archived." : null, detail].filter(
    Boolean,
  );

  return parts.length > 0 ? parts.join("\n") : "Channel details and activity.";
}
