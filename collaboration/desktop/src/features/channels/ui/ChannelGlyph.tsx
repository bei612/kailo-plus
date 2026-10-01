import { Hash, Lock } from "lucide-react";

import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";

/** Stream glyph for a channel: a lock for private channels, else a hash. */
export function ChannelGlyph({
  channel,
  className,
}: {
  channel: Pick<Channel, "visibility">;
  className?: string;
}) {
  const iconClass = cn("size-4 shrink-0", className);

  if (channel.visibility === "private") {
    return <Lock className={iconClass} />;
  }
  return <Hash className={iconClass} />;
}
