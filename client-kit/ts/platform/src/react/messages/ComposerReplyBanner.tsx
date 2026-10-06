// Reply branch of Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/ComposerReplyEditBanner.tsx::ComposerReplyEditBanner.
import { CornerUpLeft, X } from "lucide-react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";

export function ComposerReplyBanner({ replyTarget, onCancelReply }: {
  replyTarget?: { author: string; body: string; id: string } | null;
  onCancelReply?: () => void;
}) {
  const t = useUiT();
  if (!replyTarget) return null;
  return <div className="relative z-0 -mb-4 flex transform-gpu gap-2 rounded-t-2xl border border-b-0 border-border/60 bg-muted/55 px-4 pb-6 pt-2.5 text-sm leading-5 text-muted-foreground backdrop-blur-sm transition-colors items-start" data-testid="reply-target">
    <CornerUpLeft aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
    <div className="min-w-0 flex-1">
      <p className="truncate font-medium text-foreground">{t("buzz.replyingTo", { author: replyTarget.author })}</p>
      {replyTarget.body ? <p className="truncate text-muted-foreground/80">{replyTarget.body}</p> : null}
    </div>
    {onCancelReply ? <Button aria-label={t("buzz.cancelReply")} className="-mr-1 h-7 w-7 shrink-0 px-0 text-muted-foreground hover:text-foreground" onClick={onCancelReply} size="icon" type="button" variant="ghost"><X className="h-4 w-4" /></Button> : null}
  </div>;
}
