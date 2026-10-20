// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/NonMemberMentionDialog.tsx, on the shared original
// alert-dialog surface (desktop/src/shared/ui/alert-dialog.tsx) and localized through the
// platform catalog. DD-125(8) names Cancel as an explicit choice, so it is a visible button
// as well as Escape.
import * as React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button } from "../profile/buzz/shared/ui/button";
import { cn } from "../profile/buzz/shared/lib/cn";
import { MODAL_BACKDROP_BLUR_CLASS } from "../composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "../composer/shared/ui/modalMotion";
import { useUiLocale, useUiT } from "../context";
import { nonMemberNameSeparator } from "./useNonMemberInvite";

export type NonMemberMentionDialogProps = {
  /** False when the viewer may not add every one of these people to the Workspace. */
  canInvite: boolean;
  error: string | null;
  isInvitePending: boolean;
  names: string[];
  onDismiss: () => void;
  /** Omit when publication requires the intended recipients to be invited. */
  onDoNothing?: () => void;
  onInvite: () => void;
  open: boolean;
  /** Restore the initiating editor when it still owns the visible draft. */
  onRestoreFocus?: () => void;
};

export function NonMemberMentionDialog({
  canInvite,
  error,
  isInvitePending,
  names,
  onDismiss,
  onDoNothing,
  onInvite,
  open,
  onRestoreFocus,
}: NonMemberMentionDialogProps) {
  const t = useUiT();
  const locale = useUiLocale();
  const safeActionRef = React.useRef<HTMLButtonElement>(null);
  const restoreFocusRef = React.useRef(onRestoreFocus);
  const list = names.join(nonMemberNameSeparator(locale));
  const notInChannel = t(names.length === 1 ? "buzz.nonMemberMention.notInChannelOne" : "buzz.nonMemberMention.notInChannelMany", { names: list });
  const guidance = onDoNothing
    ? canInvite
      ? t("buzz.nonMemberMention.inviteOrSend")
      : `${t("buzz.nonMemberMention.addDenied")} ${t("buzz.nonMemberMention.canStillSend")}`
    : canInvite
      ? t("buzz.nonMemberMention.inviteOrCancel")
      : t("buzz.nonMemberMention.addDenied");
  return (
    <AlertDialog.Root onOpenChange={(nextOpen) => { if (!nextOpen) onDismiss(); }} open={open}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <AlertDialog.Content
            data-testid="non-member-mention-dialog"
            className={cn("pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl", MODAL_CONTENT_MOTION_CLASS)}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              restoreFocusRef.current = onRestoreFocus;
              safeActionRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              if (!restoreFocusRef.current) return;
              event.preventDefault();
              // The pending state is released by the async cancellation continuation.
              requestAnimationFrame(() => restoreFocusRef.current?.());
            }}
          >
            <div className="flex flex-col space-y-2 text-left">
              <AlertDialog.Title className="text-xl font-semibold tracking-tight">{t("buzz.nonMemberMention.title")}</AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-muted-foreground">{`${notInChannel} ${guidance}`}</AlertDialog.Description>
            </div>
            {error ? (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {onDoNothing ? (
                <Button onClick={onDismiss} size="sm" type="button" variant="ghost">{t("platform.cancel")}</Button>
              ) : null}
              <Button
                ref={safeActionRef}
                disabled={Boolean(onDoNothing) && isInvitePending}
                onClick={onDoNothing ?? onDismiss}
                size="sm"
                type="button"
                variant="outline"
              >
                {onDoNothing
                  ? canInvite ? t("buzz.nonMemberMention.doNothing") : t("buzz.nonMemberMention.sendAnyway")
                  : t("platform.cancel")}
              </Button>
              {canInvite ? (
                <Button disabled={isInvitePending} onClick={onInvite} size="sm" type="button">
                  {isInvitePending ? t("buzz.nonMemberMention.inviting") : t("buzz.nonMemberMention.invite")}
                </Button>
              ) : null}
            </div>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
