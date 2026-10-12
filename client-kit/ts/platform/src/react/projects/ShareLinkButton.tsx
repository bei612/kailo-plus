// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ShareLinkButton.tsx::ShareLinkButton.
import { Check, Link2 } from "lucide-react";
import * as React from "react";

import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { usePulseHost } from "../pulse/host";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";

/** Original entity share control; no button without a shareable coordinate. */
export function ShareLinkButton({
  className,
  label,
  link,
  testId,
}: {
  className?: string;
  label?: string;
  link: string | null;
  testId?: string;
}) {
  const t = useUiT();
  const { copy } = usePulseHost();
  const copyLabel = label ?? t("buzz.copyLink");
  const [copied, setCopied] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    },
    [],
  );

  const handleCopy = React.useCallback(() => {
    if (!link) return;
    void copy(link).then(() => {
      setCopied(true);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2_000);
    }, () => {
      // The original button has no failure presentation or success feedback.
    });
  }, [copy, link]);

  if (!link) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={copyLabel}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          data-testid={testId}
          onClick={handleCopy}
          type="button"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Link2 className="h-3.5 w-3.5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? t("video.linkCopied") : copyLabel}</TooltipContent>
    </Tooltip>
  );
}
