// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/community-members/ui/InviteLinkSection.tsx.
// Only the confirmed DD-83 first-response link reaches this presentation.
// Minting stays in the existing governed action; TTL and one use are server facts.
import { Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";
import { useClipboardWrite, useT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { Input } from "../composer/shared/ui/input";
import { Spinner } from "../profile/buzz/shared/ui/spinner";

type CopyStatus = "idle" | "copying" | "copied";

export function InviteLinkSection({ inviteUrl }: { inviteUrl: string }) {
  const t = useT();
  const copyText = useClipboardWrite();
  const [copyStatus, setCopyStatus] = React.useState<CopyStatus>("idle");
  const requestId = React.useRef(0);
  const shouldReduceMotion = useReducedMotion();
  const copyButtonWidth =
    copyStatus === "copying"
      ? "6.25rem"
      : copyStatus === "copied"
        ? "5.25rem"
        : "4.5rem";
  const copyButtonTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.12, ease: [0.77, 0, 0.175, 1] as const };

  React.useEffect(() => {
    requestId.current += 1;
    setCopyStatus("idle");
    return () => {
      requestId.current += 1;
    };
  }, [inviteUrl]);

  React.useEffect(() => {
    if (copyStatus !== "copied") return;
    // Fixed original interaction, not an invitation expiry or retry deadline.
    const resetTimer = window.setTimeout(() => setCopyStatus("idle"), 2000);
    return () => window.clearTimeout(resetTimer);
  }, [copyStatus]);

  async function handleCopy() {
    if (!inviteUrl || copyStatus === "copying") return;
    const currentRequest = requestId.current;
    setCopyStatus("copying");
    try {
      await copyText(inviteUrl);
      if (requestId.current !== currentRequest) return;
      setCopyStatus("copied");
      toast.success(t("invitations.linkCopied"));
    } catch {
      if (requestId.current !== currentRequest) return;
      setCopyStatus("idle");
      toast.error(t("invitations.copyFailed"));
    }
  }

  return (
    <section data-testid="community-invite-link-section">
      <div className="relative">
        <Input
          aria-label={t("invitations.communityLink")}
          className="h-11 pr-28 text-transparent caret-transparent selection:bg-transparent"
          data-testid="invite-link-url"
          readOnly
          value={inviteUrl}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3 right-28 flex items-center truncate text-sm text-muted-foreground"
          data-testid="invite-link-preview"
        >
          {inviteUrl}
        </span>
        <motion.div
          className="absolute right-1 top-1"
          animate={{ width: copyButtonWidth }}
          initial={false}
          transition={copyButtonTransition}
        >
          <Button
            className="h-9 w-full px-3"
            data-copy-status={copyStatus}
            data-testid="copy-invite-link"
            disabled={!inviteUrl || copyStatus === "copying"}
            onClick={() => void handleCopy()}
            size="sm"
            type="button"
          >
            {copyStatus === "copying" ? (
              <Spinner aria-hidden="true" className="h-4 w-4 border-2" />
            ) : copyStatus === "copied" ? (
              <Check aria-hidden="true" className="h-4 w-4" />
            ) : null}
            {t(
              copyStatus === "copied"
                ? "invitations.copied"
                : "invitations.copy",
            )}
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
