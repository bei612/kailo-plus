// DD-125(11), V-SCN-170. Original Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/ComposerEmojiPicker.tsx (`klipyCapabilityQuery`,
// `handleGifSelect`): the picker appears only when the active Relay advertises its KLIPY proxy.
// Kailo also requires the deployment's registered GIF origins (BFF GIF capability view, the same
// set the Web uses); a missing advertisement, an empty set or a failed read hides the option.
// Search and share are native: this device's CLIENT key signs NIP-98 for the Relay's own
// endpoints, never through the BFF and never with a provider key.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { WebGIFItem, WebGIFSearchView } from "@client-kit/contracts";
import { useBffClient } from "@client-kit/platform/react/context";
import { BffError } from "@client-kit/platform/transport";
import type { MessageComposerToolbar } from "@client-kit/platform/react/composer/features/messages/ui/MessageComposerToolbar";
import { useActiveCommunity } from "@/features/platform/activeCommunity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { invokeTauri } from "@/shared/api/tauri";
import type { ImetaMedia } from "@/features/messages/lib/imetaMediaMarkdown";
import {
  GIF_MEMBERSHIP_REQUIRED,
  gifAttachment,
  klipyCustomerId,
  normalizeRelayGifs,
  type RelayGifDescriptor,
} from "./api";

export type DesktopGifOption = NonNullable<React.ComponentProps<typeof MessageComposerToolbar>["gifs"]>;

/** Original capability cache window. */
const GIF_CAPABILITY_STALE_MS = 5 * 60_000;

/**
 * The composer's verified GIF option, or `undefined` (emoji-only picker). A chosen, already
 * origin-checked GIF is appended to the composer's pending media as the original hash-less entry
 * (body line, no imeta); the original best-effort share report never affects the message.
 */
export function useDesktopGifOption(
  setPendingImeta: (update: (current: ImetaMedia[]) => ImetaMedia[]) => void,
): DesktopGifOption | undefined {
  const bff = useBffClient();
  const community = useActiveCommunity();
  const identity = useIdentityQuery();
  const relayUrl = community.relayUrl;
  const pubkey = !identity.isError ? identity.data?.pubkey : undefined;
  const descriptor = useQuery({
    enabled: relayUrl.length > 0,
    queryKey: ["relay-capability", relayUrl, "klipy"],
    queryFn: () => invokeTauri<RelayGifDescriptor | null>("get_relay_gif_descriptor", { expectedRelayUrl: relayUrl }),
    retry: 1,
    staleTime: GIF_CAPABILITY_STALE_MS,
  });
  const capability = useQuery({
    enabled: relayUrl.length > 0,
    queryKey: ["platform", "gif-capability", relayUrl],
    queryFn: () => bff.gifCapability(),
    retry: 1,
    staleTime: GIF_CAPABILITY_STALE_MS,
  });
  const setPendingImetaRef = React.useRef(setPendingImeta);
  setPendingImetaRef.current = setPendingImeta;
  const advertised = descriptor.isSuccess && descriptor.data !== null;
  const origins = capability.isSuccess && Array.isArray(capability.data.imageOrigins)
    ? capability.data.imageOrigins : undefined;
  return React.useMemo(() => {
    if (!pubkey || !advertised || !origins || origins.length === 0) return undefined;
    const scope = { expectedRelayUrl: relayUrl, expectedSignerPubkey: pubkey };
    return {
      search: async (query: string): Promise<WebGIFSearchView> => {
        try {
          const page = await invokeTauri<unknown>("search_relay_gifs", {
            ...scope,
            query,
            locale: navigator.language || "en-US",
            customerId: klipyCustomerId(relayUrl),
          });
          return { gifs: normalizeRelayGifs(page, origins) };
        } catch (error) {
          // The shared picker's "join this community" copy keys on a 403 BffError.
          if (error instanceof Error && error.message === GIF_MEMBERSHIP_REQUIRED) {
            throw new BffError(403, GIF_MEMBERSHIP_REQUIRED);
          }
          throw error;
        }
      },
      onSelect: (gif: WebGIFItem) => {
        setPendingImetaRef.current((current) => [...current, gifAttachment(gif)]);
        void invokeTauri<void>("share_relay_gif", {
          ...scope,
          slug: gif.slug,
          customerId: klipyCustomerId(relayUrl),
        }).catch(() => {
          // Original: sharing the GIF stays successful when the Recents report fails.
        });
      },
    };
  }, [advertised, origins, pubkey, relayUrl]);
}
