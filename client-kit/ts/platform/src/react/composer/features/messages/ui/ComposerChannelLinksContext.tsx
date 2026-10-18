// Host seam for the original `#channel` composer autocomplete (Buzz 779af8886caae1317b4de962082429867ab61503
// reads ChannelNavigationContext). Web provides its admitted channel directory; only names are
// suggested, and every published message is still admitted by Core.
import * as React from "react";
import type { ChannelLinkSource } from "../lib/useChannelLinks";

const NO_CHANNELS: readonly ChannelLinkSource[] = [];
const ComposerChannelLinksContext = React.createContext<readonly ChannelLinkSource[]>(NO_CHANNELS);

export function ComposerChannelLinksProvider({ channels, children }: {
  channels: readonly ChannelLinkSource[] | undefined;
  children: React.ReactNode;
}) {
  return <ComposerChannelLinksContext.Provider value={channels ?? NO_CHANNELS}>{children}</ComposerChannelLinksContext.Provider>;
}

export function useComposerChannelLinkSources(): readonly ChannelLinkSource[] {
  return React.useContext(ComposerChannelLinksContext);
}
