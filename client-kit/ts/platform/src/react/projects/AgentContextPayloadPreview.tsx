// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/AgentContextPayloadPreview.tsx.
// Pre-send disclosure of the exact payload appended to an outgoing Agent message (DD-130(4)).
// The payload embeds relay/git-controlled metadata an attacker can shape, and the Agent may act
// on it before any retrospective disclosure is seen; callers pass the same string they append
// at send time. Kailo also names the shared channel the message is posted to.
import { Info } from "lucide-react";
import * as React from "react";

import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";

export function AgentContextPayloadPreview({
  channelName,
  iconOnly = false,
  payload,
  triggerLabel,
}: {
  channelName: string;
  iconOnly?: boolean;
  payload: string;
  triggerLabel: string;
}) {
  const t = useUiT();
  const [open, setOpen] = React.useState(false);
  const trimmed = payload.trim();
  if (!trimmed) return null;
  return (
    <div className="relative shrink-0">
      <Button
        aria-label={iconOnly ? triggerLabel : undefined}
        aria-expanded={open}
        className={cn(
          "h-7 rounded-full text-muted-foreground",
          iconOnly
            ? "w-7 p-0 text-muted-foreground/75 hover:text-muted-foreground focus-visible:text-muted-foreground"
            : "gap-1 px-2 text-xs",
        )}
        data-testid="agent-context-preview-trigger"
        onClick={() => setOpen((value) => !value)}
        size="sm"
        title={t("projects.agentChat.previewTitle")}
        type="button"
        variant="ghost"
      >
        <Info className={iconOnly ? "h-3 w-3" : "h-3.5 w-3.5"} />
        {iconOnly ? null : triggerLabel}
      </Button>
      {open ? (
        <div
          className="absolute bottom-full right-0 z-50 mb-1 w-80 rounded-lg border border-border bg-popover p-3 shadow-md"
          data-testid="agent-context-preview"
        >
          <p className="mb-2 text-xs text-muted-foreground">
            {t("projects.agentChat.previewNotice", { channel: channelName })}
          </p>
          <pre
            className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground"
            data-testid="agent-context-preview-payload"
          >
            {trimmed}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
