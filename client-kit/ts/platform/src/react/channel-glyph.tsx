// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/channels/ui/ChannelGlyph.tsx::ChannelGlyph.
import { Hash, Lock } from "lucide-react";

import type { WorkspaceVisibility } from "@client-kit/contracts";
import { cn } from "./profile/buzz/shared/lib/cn";

/** Stream glyph for a channel: a lock for private channels, else a hash. */
export function ChannelGlyph({
  channel,
  className,
}: {
  channel: { visibility?: `${WorkspaceVisibility}` };
  className?: string;
}) {
  if (channel.visibility === undefined) return null;
  const iconClass = cn("size-4 shrink-0", className);

  if (channel.visibility === "private") {
    return <Lock className={iconClass} />;
  }
  return <Hash className={iconClass} />;
}
