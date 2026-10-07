import { useId, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BffClient } from "../../client";
import { eventsFromView, type CustomEmojiHost } from "./hooks";
import { unionCustomEmoji } from "./emoji";

export type CustomEmojiReadHost = Pick<CustomEmojiHost, "scope" | "read"> & {
  rewriteRelayUrl: (url: string) => string | undefined;
};

/** A view of the original signed sets, using the same cache as settings. */
export function useCustomEmojiPalette(host: CustomEmojiReadHost | undefined) {
  const query = useQuery({
    queryKey: ["custom-emoji", host?.scope], enabled: host !== undefined,
    queryFn: async () => {
      if (!host) throw new Error("Emoji identity unavailable");
      const view = await host.read();
      return { view, events: eventsFromView(view) };
    },
    refetchOnWindowFocus: false,
  });
  return useMemo(() => {
    if (!host || query.isError || !query.data) return [];
    return unionCustomEmoji(query.data.events).flatMap((emoji) => {
      const url = host.rewriteRelayUrl(emoji.url);
      return url ? [{ ...emoji, url }] : [];
    });
  }, [host, query.data, query.isError]);
}

/** PlatformProvider remounts this read cache when its authenticated client changes. */
export function useBffCustomEmojiPalette(client: BffClient) {
  const instance = useId();
  const host = useMemo(() => {
    let paths: Record<string, string> = {};
    return { scope: `custom-emoji-web:${instance}`,
      read: async () => {
        const view = await client.customEmoji();
        paths = view.mediaPaths;
        return view;
      },
      rewriteRelayUrl: (url: string) => paths[url],
    };
  }, [client, instance]);
  return useCustomEmojiPalette(host);
}
