import { Check, Copy } from "lucide-react";
import * as React from "react";

import { cn } from "../profile/buzz/shared/lib/cn";
import { usePulseHost } from "../pulse/host";
import { useT } from "../context";
import { toast } from "sonner";

/** Icon button that copies arbitrary text with a brief check feedback. */
export function CopyTextButton({
  ariaLabel,
  className,
  text,
}: {
  ariaLabel: string;
  className?: string;
  text: string;
}) {
  const {copy}=usePulseHost();
  const t=useT();
  const [copied, setCopied] = React.useState(false);
  const handleCopy = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      void copy(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2_000);
      }).catch(() => toast.error(t("platform.profile.copyFailed")));
    },
    [text,copy,t],
  );

  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={handleCopy}
      onKeyDown={(event) => event.stopPropagation()}
      type="button"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

/** Icon button that copies a full commit hash with a brief check feedback. */
export function CopyCommitHashButton({
  className,
  hash,
}: {
  className?: string;
  hash: string;
}) {
  const t=useT();
  return (
    <CopyTextButton
      ariaLabel={t("projects.commit.copy")}
      className={className}
      text={hash}
    />
  );
}
