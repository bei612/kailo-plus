import type { PulsePublishRequest } from "@client-kit/contracts";
import { newIdempotencyKey } from "@client-kit/platform/governance";
import { buildMessageReactions, type TimelineMessage } from "@client-kit/platform/react/messages";
import { useCustomEmojiPalette } from "@client-kit/platform/react/custom-emoji";
import { useUiT } from "@client-kit/platform/react/context";
import { BffError, isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { bff, publishMessageReaction, type BuzzEvent } from "@/platform/bff-client";

type FrozenReaction = { commands: { request: PulsePublishRequest; key: string }[]; completed: number; remove: boolean };
const eventId = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A frozen transport intent, not a reaction projection. Like Composer's
 * sendIntent, write before dispatch and keep the same key across remount/reload.
 * Only admitted Relay events and confirmed publication receipts establish fact. */
function readIntent(key: string): FrozenReaction | null {
  const encoded = localStorage.getItem(key);
  if (encoded === null) return null;
  let value: FrozenReaction;
  try { value = JSON.parse(encoded) as FrozenReaction; }
  catch { throw new TransportError("Reaction intent could not be recovered."); }
  if (!value || !Array.isArray(value.commands) || !value.commands.length ||
      typeof value.remove !== "boolean" || !Number.isInteger(value.completed) || value.completed < 0 || value.completed > value.commands.length ||
      value.commands.some(command => !uuid.test(command.key) || !eventId.test(command.request.targetEventId ?? "") ||
        command.request.operation !== (value.remove ? "UNLIKE" : "LIKE") || typeof command.request.content !== "string")) {
    throw new TransportError("Reaction intent could not be recovered.");
  }
  return value;
}

export function useMessageReactions({principalId, workspaceId, conversationId, events, available, refresh}: {
  principalId: string; workspaceId: string; conversationId?: string; events: BuzzEvent[];
  available: boolean; refresh?: () => unknown;
}) {
  const t = useUiT();
  const ownProfile = useQuery({queryKey:["platform","edit-author",principalId],queryFn:()=>bff.profile()});
  const pubkey = ownProfile.isSuccess && !ownProfile.isFetching ? ownProfile.data.pubkey : undefined;
  const scope = JSON.stringify([principalId,workspaceId,conversationId ?? null,pubkey]);
  const emojiHost = useMemo(()=>{
    let paths: Record<string,string> = {};
    return {scope:`message-reactions:${scope}`,read:async()=>{const view=await bff.customEmoji();paths=view.mediaPaths;return view;},
      rewriteRelayUrl:(url:string)=>paths[url] ?? (Object.values(paths).includes(url) ? url : undefined)};
  },[scope]);
  const customEmoji = useCustomEmojiPalette(emojiHost);
  const current = useRef({scope,available,events,refresh});
  current.current = {scope,available,events,refresh};
  const mounted = useRef(true);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  const pending = useRef(new Set<string>());
  const reactions = useMemo(()=>buildMessageReactions(events,pubkey),[events,pubkey]);
  const toggle = useCallback(async(message: TimelineMessage, emoji: string, remove: boolean) => {
    const admitted = () => mounted.current && current.current.scope === scope && current.current.available && pubkey;
    if (!admitted() || !eventId.test(message.id) || !emoji.trim() || !current.current.events.some(event=>event.id===message.id && [9,40002,40099,45001,45003].includes(event.kind))) throw new BffError(403,t("platform.loadFailed"));
    const storageKey = `kailo:message-reaction:${scope}:${message.id}:${encodeURIComponent(emoji)}`;
    if (pending.current.has(storageKey)) throw new TransportError("Reaction is awaiting its original receipt.");
    pending.current.add(storageKey);
    let prior: FrozenReaction | null = null;
    let intent: FrozenReaction | null = null;
    try {
      prior = readIntent(storageKey);
      if (prior) intent = prior;
      else {
        const deleted = new Set(current.current.events.filter(event=>event.kind===5||event.kind===9005).flatMap(event=>event.tags.filter(tag=>tag[0]==="e").map(tag=>tag[1])));
        const ids = remove ? [...new Set(current.current.events.filter(event=>event.kind===7 && event.pubkey===pubkey &&
          !deleted.has(event.id) && (event.content.trim() || "+")===emoji &&
          [...event.tags].reverse().find(tag=>tag[0]==="e" && eventId.test(tag[1] ?? ""))?.[1]===message.id).map(event=>event.id))] : [message.id];
        if (!ids.length) throw new BffError(409,t("platform.loadFailed"));
        intent = {remove,completed:0,commands:ids.map(id=>({key:newIdempotencyKey(),request:{operation:(remove?"UNLIKE":"LIKE") as PulsePublishRequest["operation"],targetEventId:id,content:remove?"":emoji}}))};
        localStorage.setItem(storageKey,JSON.stringify(intent));
      }
      for (; intent.completed < intent.commands.length;) {
        if (!admitted()) throw new TransportError("Reaction scope changed before confirmation.");
        const command = intent.commands[intent.completed]!;
        const receipt = await publishMessageReaction(workspaceId,conversationId,command.request,command.key);
        if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Reaction has no confirmed receipt.");
        intent.completed += 1;
        localStorage.setItem(storageKey,JSON.stringify(intent));
      }
      localStorage.removeItem(storageKey);
      if (admitted()) current.current.refresh?.();
    } catch (error) {
      // A later refusal cannot prove that a pre-reload UNKNOWN never published.
      // Definite rejection of a fresh request can be retried as a new intent.
      if (!prior && !isOutcomeUnknown(error) && intent?.completed === 0) localStorage.removeItem(storageKey);
      if (prior && !isOutcomeUnknown(error)) throw new TransportError("Reaction is awaiting its original receipt.");
      if (!(error instanceof BffError) && !isOutcomeUnknown(error)) throw new TransportError(t("platform.audit.unknownResult"));
      throw error;
    } finally { pending.current.delete(storageKey); }
    // A post-reload click only reconciles the frozen intent. It cannot also
    // reverse that reaction; the next explicit selection is a new command.
    if (prior && prior.remove !== remove) throw new BffError(409,t("platform.refresh"));
  },[scope,pubkey,workspaceId,conversationId,t]);
  return {reactions,customEmoji,reactionScope:scope,resolveMediaUrl:emojiHost.rewriteRelayUrl,onToggleReaction:available && pubkey ? toggle : undefined};
}
