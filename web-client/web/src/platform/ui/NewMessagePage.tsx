import type { ConversationView } from "@client-kit/contracts";
import { useEffect, useMemo, useState } from "react";
import { NewMessageScreen } from "@client-kit/platform/react/new-message";
import { useUiT } from "@client-kit/platform/react/context";
import { mediaUrl, publishConversationMessage, uploadConversationMedia } from "../bff-client";
import { Composer, mentionPeopleFromMembers } from "./ChannelPane";

export function NewMessagePage({ currentPrincipalId, onConversationOpened, initialRecipientPubkey }: {
  currentPrincipalId: string;
  initialRecipientPubkey?: string;
  onConversationOpened: (conversation: ConversationView) => void | Promise<void>;
}) {
  const t = useUiT();
  const scope = useMemo(() => ({ active: true, media: new Map<string, string>() }), [currentPrincipalId]);
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
    <Composer disabled={host.disabled} placeholder={host.placeholder}
      mentionPeople={mentionPeopleFromMembers(host.recipients)}
      onMediaUrl={(sha256) => {
        const url = scope.media.get(sha256);
        if (!url) throw new Error(t("dm.attachmentUnavailable"));
        return url;
      }}
      onUpload={async (file) => {
        const conversation = await host.prepareConversation();
        if (!scope.active) throw new Error(t("dm.viewInactive"));
        const descriptor = await uploadConversationMedia(conversation.id, file);
        if (!scope.active) throw new Error(t("dm.viewInactive"));
        scope.media.set(descriptor.sha256, mediaUrl(conversation.id, descriptor.sha256, conversation.id));
        return descriptor;
      }}
      onPublish={async (content, attachments, key, _mentionInstallationIds, mentionPubkeys = []) => {
        const conversation = await host.prepareConversation();
        if (!scope.active) throw new Error(t("dm.viewInactive"));
        const receipt = await publishConversationMessage(conversation.id, content, attachments, key, undefined, undefined, mentionPubkeys);
        // The publish receipt is final even if navigation fails. Do not reject
        // it into the composer's retry path or carry it across identity changes.
        await openConfirmed(conversation);
        return receipt;
      }} />
  } />{navigationProblem?.scope === scope ? <p role="status">{t("dm.sentNavigationFailed")}
    <button type="button" onClick={() => void openConfirmed(navigationProblem.conversation)}>{t("dm.openConversation")}</button>
  </p> : null}</>;
}
