import type { ConversationView } from "@client-kit/contracts";
import { useEffect, useMemo, useState } from "react";
import { NewMessageScreen } from "@client-kit/platform/react/new-message";
import { publishConversationMessage, uploadConversationMedia } from "../bff-client";
import { Composer } from "./ChannelPane";

export function NewMessagePage({ currentPrincipalId, onConversationOpened }: {
  currentPrincipalId: string;
  onConversationOpened: (conversation: ConversationView) => void | Promise<void>;
}) {
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
  return <><NewMessageScreen key={currentPrincipalId} currentPrincipalId={currentPrincipalId} renderComposer={(host) =>
    <Composer disabled={host.disabled} placeholder={host.placeholder}
      onUpload={async (file) => {
        const conversation = await host.prepareConversation();
        if (!scope.active) throw new Error("Conversation view is no longer active.");
        return uploadConversationMedia(conversation.id, file);
      }}
      onPublish={async (content, attachments, key) => {
        const conversation = await host.prepareConversation();
        if (!scope.active) throw new Error("Conversation view is no longer active.");
        const receipt = await publishConversationMessage(conversation.id, content, attachments, key);
        // The publish receipt is final even if navigation fails. Do not reject
        // it into the composer's retry path or carry it across identity changes.
        await openConfirmed(conversation);
        return receipt;
      }} />
  } />{navigationProblem?.scope === scope ? <p role="status">Message sent. The conversation could not be opened.
    <button type="button" onClick={() => void openConfirmed(navigationProblem.conversation)}>Open conversation</button>
  </p> : null}</>;
}
