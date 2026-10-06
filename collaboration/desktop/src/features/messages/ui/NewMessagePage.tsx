import type { ConversationView } from "@client-kit/contracts";
import { useEffect, useMemo, useState } from "react";
import { NewMessageScreen } from "@client-kit/platform/react/new-message";
import { useQueryClient } from "@tanstack/react-query";
import { channelsQueryKey } from "@/features/channels/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { getChannels } from "@/shared/api/tauri";
import { useSendMessageMutation } from "../hooks";
import { MessageComposer } from "./MessageComposer";

export function NewMessagePage({ currentPrincipalId, onConversationOpened, initialRecipientPubkey }: {
  currentPrincipalId: string;
  initialRecipientPubkey?: string;
  onConversationOpened: (conversation: ConversationView) => void | Promise<void>;
}) {
  const identity = useIdentityQuery();
  const cache = useQueryClient();
  const send = useSendMessageMutation(null, identity.data);
  const scope = useMemo(() => ({ active: true }), [currentPrincipalId]);
  const [navigationProblem, setNavigationProblem] = useState<{ scope: typeof scope; conversation: ConversationView } | null>(null);
  useEffect(() => { scope.active = true; return () => { scope.active = false; }; }, [scope]);
  const openConfirmed = async (conversation: ConversationView) => {
    if (!scope.active) return;
    try {
      await onConversationOpened(conversation);
      if (scope.active) setNavigationProblem(null);
    } catch {
      if (scope.active) setNavigationProblem({ scope, conversation });
    }
  };
  return <><NewMessageScreen key={currentPrincipalId} currentPrincipalId={currentPrincipalId} initialRecipientPubkey={initialRecipientPubkey} renderComposer={(host) =>
    <MessageComposer channelName="new message" containerClassName="px-5"
      disabled={host.disabled || send.isPending || !identity.data} isSending={host.isSending || send.isPending}
      placeholder={host.placeholder} showBackgroundUploadProgress
      onSend={async (content, mentionPubkeys, mediaTags) => {
        const conversation = await host.prepareConversation();
        if (!scope.active) throw new Error("Conversation view is no longer active.");
        const snapshot = await getChannels(null);
        if (!scope.active) throw new Error("Conversation view is no longer active.");
        const channel = snapshot.channels?.find((item) => item.id === conversation.channelId && item.channelType === "dm");
        if (!channel) throw new Error("The direct message is still synchronizing. Your draft is retained.");
        cache.setQueryData(channelsQueryKey, snapshot.channels);
        await send.mutateAsync({ targetChannel: channel, content, mentionPubkeys, mediaTags, transport: "http" });
        // Native publish succeeded. A navigation error must never become a
        // publish retry and a late receipt must not navigate a new identity.
        await openConfirmed(conversation);
      }} />
  } />{navigationProblem?.scope === scope ? <p role="status">Message sent. The conversation could not be opened.
    <button type="button" onClick={() => void openConfirmed(navigationProblem.conversation)}>Open conversation</button>
  </p> : null}</>;
}
