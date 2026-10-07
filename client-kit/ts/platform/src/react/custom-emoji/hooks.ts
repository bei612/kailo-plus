import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { verifyEvent } from "nostr-tools/pure";
import type { WebCustomEmojiMutation, WebCustomEmojiView } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { isOutcomeUnknown, TransportError } from "../../transport";
import { customEmojiFromEvent, unionCustomEmoji, KIND_EMOJI_SET, CUSTOM_EMOJI_SET_D_TAG } from "./emoji";
import type { RelayEvent } from "../forum/channelWindowResponse";

export type CustomEmojiHost = {
  scope: string;
  read: () => Promise<WebCustomEmojiView>;
  publish: (request: WebCustomEmojiMutation) => Promise<{ eventId: string }>;
  pickAndUploadMedia: () => Promise<Array<{ url: string; filename?: string | null; type: string }>>;
  rewriteRelayUrl: (url: string) => string;
};

export function eventsFromView(view: WebCustomEmojiView): RelayEvent[] {
  if (!/^[0-9a-f]{64}$/.test(view.pubkey)) throw new TransportError("Emoji identity unavailable");
  return view.events.map((value) => {
    const event = value as unknown as RelayEvent;
    if (event.kind !== KIND_EMOJI_SET || !Array.isArray(event.tags)
      || !event.tags.some((tag) => tag[0] === "d" && tag[1] === CUSTOM_EMOJI_SET_D_TAG)
      || !verifyEvent(value as Parameters<typeof verifyEvent>[0])) {
      throw new TransportError("Invalid signed emoji set");
    }
    return event;
  });
}

export function useEmojiSettings(host: CustomEmojiHost) {
  const queryClient = useQueryClient();
  const queryKey = ["custom-emoji", host.scope];
  const live = useRef(host.scope);
  live.current = host.scope;
  useEffect(() => {
    live.current = host.scope;
    return () => { live.current = ""; };
  }, [host.scope]);
  const query = useQuery({ queryKey, queryFn: async () => {
    const view = await host.read();
    return { view, events: eventsFromView(view) };
  }, refetchOnWindowFocus: false });
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  // React state does not lock two calls made before the next render.
  const operation = useRef({ busy: false, unknown: false });
  const intent = useRef<WebCustomEmojiMutation | null>(null);
  const mutate = async (shortcode: string, url?: string) => {
    if (!query.data || query.isError || operation.current.busy || live.current !== host.scope) throw new TransportError("Emoji identity unavailable");
    const request = intent.current ?? { idempotencyKey: newIdempotencyKey(), expectedPubkey: query.data.view.pubkey, shortcode, ...(url ? { imageUrl: url } : {}) };
    if (request.shortcode !== shortcode || request.imageUrl !== url) throw new TransportError("Emoji publication result unknown");
    intent.current = request;
    operation.current.busy = true;
    const wasUnknown = operation.current.unknown;
    setBusy(true);
    let acknowledged = false;
    try {
      const result = await host.publish(request);
      acknowledged = true;
      if (!result.eventId || live.current !== host.scope) throw new TransportError("Emoji publication result unknown");
      const actual = await host.read();
      const events = eventsFromView(actual);
      if (actual.pubkey !== request.expectedPubkey || !events.some((event) => event.pubkey === request.expectedPubkey && event.id === result.eventId)
        || live.current !== host.scope) throw new TransportError("Emoji publication result unknown");
      queryClient.setQueryData(queryKey, { view: actual, events });
      void queryClient.invalidateQueries({ queryKey: ["custom-emoji"] });
      intent.current = null;
      operation.current.unknown = false;
      setUnknown(false);
      return shortcode;
    } catch (error) {
      if (live.current === host.scope) {
        if (acknowledged || wasUnknown || isOutcomeUnknown(error)) {
          operation.current.unknown = true;
          setUnknown(true);
        } else { intent.current = null; setUnknown(false); }
      }
      if (acknowledged || wasUnknown) throw new TransportError("Emoji publication result unknown");
      throw error;
    } finally {
      operation.current.busy = false;
      if (live.current === host.scope) setBusy(false);
    }
  };
  const own = useMemo(() => customEmojiFromEvent(query.data?.events.find((event) => event.pubkey === query.data?.view.pubkey) ?? null), [query.data]);
  const community = useMemo(() => unionCustomEmoji(query.data?.events ?? []), [query.data]);
  return { query, own, community, busy, unknown, pendingIntent: intent.current,
    setEmoji: { isPending: busy, mutateAsync: ({ shortcode, url }: { shortcode: string; url: string }) => mutate(shortcode, url) },
    removeEmoji: { isPending: busy, mutateAsync: (shortcode: string) => mutate(shortcode) },
  };
}
