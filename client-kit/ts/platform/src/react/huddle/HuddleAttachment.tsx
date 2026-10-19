// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/huddle/components/HuddleAttachment.tsx::HuddleAttachment
// desktop/src/features/messages/ui/MessageRow.tsx (KIND_HUDDLE_STARTED renders the card)
// DD-125(3): the original timeline card of a 48100 row. The session's state comes from the
// parent's HuddleBuzzBinding (only in-progress bindings are listed) and its verified
// lifecycle; an unconfirmed start older than the original one-hour window shows as ended.
// Join goes through the host with that binding. Without a Huddle host the card still renders
// its fixed state, never a join action.
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Headphones, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { HuddleState } from "@client-kit/contracts";
import { useT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import {
  Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle,
} from "../composer/shared/ui/attachment";
import { isHuddleStartStale, parseEphemeralChannelId, reconstructHuddleLifecycle } from "../../huddle";
import { useFormatHuddleError, useOptionalHuddle } from "./HuddleContext";
import { useHuddlePlural } from "./plural";
import { useHasHuddleHost, useHuddleParent } from "./host";
import { huddleParentQueryKey, useHuddleLifecycle, useParentHuddles } from "./queries";

type HuddleCardMessage = { id: string; body: string; createdAt: number; pubkey?: string };

export function HuddleAttachment({ className, message }: { className?: string; message: HuddleCardMessage }) {
  const t = useT();
  const plural = useHuddlePlural();
  const parent = useHuddleParent();
  const hosted = useHasHuddleHost();
  const huddle = useOptionalHuddle();
  const formatHuddleError = useFormatHuddleError();
  const queryClient = useQueryClient();
  const ephemeralChannelId = React.useMemo(() => parseEphemeralChannelId(message.body), [message.body]);
  const huddles = useParentHuddles(hosted ? parent : null);
  const binding = (Array.isArray(huddles.data) ? huddles.data : []).find((item) => item.channelId === ephemeralChannelId) ?? null;
  const lifecycle = useHuddleLifecycle(binding?.huddleId ?? null);
  const [isJoining, setIsJoining] = React.useState(false);

  const state = React.useMemo(() => {
    if (!ephemeralChannelId) return { ended: true, participants: new Set<string>() };
    const events = Array.isArray(lifecycle.data?.events) ? lifecycle.data.events : [];
    const reconstructed = reconstructHuddleLifecycle(events, message.pubkey, ephemeralChannelId);
    // A binding that is no longer in progress (ENDED or ERROR) is not listed: the card is ended.
    return huddles.isSuccess && !binding ? { ...reconstructed, ended: true } : reconstructed;
  }, [binding, ephemeralChannelId, huddles.isSuccess, lifecycle.data?.events, message.pubkey]);

  const participantCount = Math.max(1, state.participants.size);
  const isCurrentHuddle = Boolean(ephemeralChannelId) && huddle?.activeEphemeralChannelId === ephemeralChannelId;
  const isStaleUnconfirmedHuddle = !isCurrentHuddle && isHuddleStartStale(message.createdAt);
  const canJoin = Boolean(huddle && parent && ephemeralChannelId && binding?.state === HuddleState.Active
    && !state.ended && !isCurrentHuddle && !isStaleUnconfirmedHuddle);
  const displayEnded = state.ended || isStaleUnconfirmedHuddle;

  async function handleJoin() {
    if (!huddle || !parent || !ephemeralChannelId || !binding || isJoining || huddle.isStarting) return;
    setIsJoining(true);
    try {
      await huddle.joinHuddle(parent, ephemeralChannelId, binding.huddleId);
      void queryClient.invalidateQueries({ queryKey: huddleParentQueryKey(parent) });
    } catch (error) {
      toast.error(formatHuddleError(error, "join"));
    } finally {
      setIsJoining(false);
    }
  }

  if (!ephemeralChannelId) {
    return (
      <Attachment className={cn("w-96 max-w-full shadow-none", className)} data-testid="huddle-attachment" state="error">
        <AttachmentMedia><Headphones /></AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{t("huddle.card.unavailable")}</AttachmentTitle>
          <AttachmentDescription>{t("huddle.card.missingDetails")}</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
    );
  }

  return (
    <Attachment className={cn("w-96 max-w-full shadow-none", className)} data-testid="huddle-attachment"
      data-huddle-state={displayEnded ? "ended" : "active"}>
      <AttachmentMedia className={cn(!displayEnded && "bg-primary/10 text-primary ring-1 ring-primary/20 dark:bg-primary/15")}>
        <Headphones />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>
          {t("huddle.label")}
          <span aria-hidden="true"> · </span>
          {displayEnded ? t("huddle.card.ended") : t("huddle.card.inProgress")}
        </AttachmentTitle>
        <AttachmentDescription>{plural("huddle.participants", participantCount)}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        {canJoin ? (
          <AttachmentAction disabled={isJoining || Boolean(huddle?.isStarting)} onClick={() => void handleJoin()}
            size="sm" type="button" variant="secondary">
            <Headphones className="h-4 w-4" />
            {isJoining || huddle?.isStarting ? t("huddle.card.joining") : t("huddle.card.join")}
          </AttachmentAction>
        ) : huddle?.canViewHuddleChannel && (isCurrentHuddle || displayEnded) ? (
          <AttachmentAction aria-label={t("huddle.card.view")} size="sm" type="button" variant="ghost"
            onClick={() => {
              if (isCurrentHuddle) huddle.showHuddleInMainApp(ephemeralChannelId);
              else huddle.viewHuddleChannel(ephemeralChannelId);
            }}>
            <MessageSquareText className="h-4 w-4" />
            {t("huddle.card.viewShort")}
          </AttachmentAction>
        ) : null}
      </AttachmentActions>
    </Attachment>
  );
}
