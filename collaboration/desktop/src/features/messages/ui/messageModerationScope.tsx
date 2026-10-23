// DD-125(2) Desktop host for the shared message moderation menu (Report + moderator items):
// the admitted scope of the open channel (its Workspace, or the ACTIVE governed conversation)
// and the viewer's signing key, as the Web host passes `moderation` (ChannelPane L573-575).
import * as React from "react";
import type { MessageModerationContext } from "@client-kit/platform/react/messages";

const Context = React.createContext<MessageModerationContext | undefined>(undefined);
export const MessageModerationScopeProvider = Context.Provider;
export function useMessageModerationScope(): MessageModerationContext | undefined {
  return React.useContext(Context);
}
