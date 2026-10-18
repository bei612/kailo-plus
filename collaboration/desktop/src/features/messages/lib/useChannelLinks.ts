// Original Buzz `#channel` autocomplete, shared with Web through client-kit. Desktop supplies the
// channel list from its ChannelNavigationContext, as the original hook read it.
import { useChannelNavigation } from "@/shared/context/ChannelNavigationContext";
import { useChannelLinks as useSharedChannelLinks } from "@client-kit/platform/react/composer/features/messages/lib/useChannelLinks";

export {
  selectChannelSuggestions,
  type ChannelSuggestion,
} from "@client-kit/platform/react/composer/features/messages/lib/useChannelLinks";

export function useChannelLinks() {
  const { channels } = useChannelNavigation();
  return useSharedChannelLinks(channels);
}

export type UseChannelLinksResult = ReturnType<typeof useChannelLinks>;
