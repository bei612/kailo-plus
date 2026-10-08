// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/channels/ui/ChannelGlyph.tsx::ChannelGlyph.
import { FileText, Hash, Lock } from "lucide-react";

import type { Channel } from "./search/types";
import { cn } from "./profile/buzz/shared/lib/cn";

/** Original stream/forum glyph; private channels retain the lock. */
export function ChannelGlyph({
  channel,
  className,
}: {
  channel: Partial<Pick<Channel, "channelType" | "visibility">>;
  className?: string;
}) {
  if (channel.visibility === undefined) return null;
  const iconClass = cn("size-4 shrink-0", className);

  if (channel.visibility === "private") {
    return <Lock className={iconClass} />;
  }
  if (channel.channelType === "forum") {
    return <FileText className={iconClass} />;
  }
  return <Hash className={iconClass} />;
}
