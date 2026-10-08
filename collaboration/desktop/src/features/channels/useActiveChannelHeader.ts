// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/useActiveChannelHeader.ts::useActiveChannelHeader.
// Core Conversation admission partitions people; Relay keys remain device identities.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppShell } from "@/app/AppShellContext";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { isGenericDmChannelName } from "@/features/sidebar/lib/channelLabels";
import type { Channel } from "@/shared/api/types";
import { loadConversationPeople } from "@client-kit/platform/react/new-message";
import { formatDmParticipantDisplayName, resolveConversationHeaderParticipants } from "@client-kit/platform/react/conversations/dm-participant-display";

export function useActiveChannelHeader(activeChannel: Channel, currentPubkey?: string) {
  const native = useNativeSession();
  const { coreReads } = useAppShell();
  const session = useQuery({ queryKey: ["platform", "session", native.facts.communityHost, native.devicePubkey],
    queryFn: () => native.client.session() });
  const principalId = session.isSuccess && !session.isFetching ? session.data.tenantPrincipalId : "";
  const conversation = coreReads?.state && !coreReads.failed && !coreReads.unknown
    ? coreReads.conversations.find(item => item.channelId === activeChannel.id) : undefined;
  const enabled = activeChannel.channelType === "dm" && currentPubkey === native.devicePubkey && Boolean(principalId && conversation);
  const owner = React.useMemo(() => ({ active: true }), [native.client, native.devicePubkey, principalId, activeChannel.id]);
  const live = React.useRef(owner); live.current = owner;
  React.useEffect(() => { owner.active = true; return () => { owner.active = false; }; }, [owner]);
  const directory = useQuery({
    queryKey: ["platform", "dm-header-people", native.facts.communityHost, native.devicePubkey, principalId, activeChannel.id],
    enabled, retry: false,
    queryFn: () => loadConversationPeople(native.client, () => {
      if (!owner.active || live.current !== owner) throw new Error("DM header identity changed");
    }),
  });
  const people = enabled && directory.isSuccess && !directory.isFetching
    ? resolveConversationHeaderParticipants(conversation, principalId, directory.data) : null;
  // No canonical key is declared by the directory. Only an unambiguous single
  // key present in this actual Relay channel can power its profile consumer.
  const profileKeys = (people ?? []).flatMap(person => person.pubkeys.length === 1 &&
    activeChannel.participantPubkeys.includes(person.pubkeys[0]!) ? person.pubkeys : []);
  const query = useUsersBatchQuery(profileKeys, { enabled: profileKeys.length > 0 });
  const profiles = query.isSuccess && !query.isPlaceholderData && !query.isFetching ? query.data.profiles : undefined;
  const activeDmHeaderParticipants = (people ?? []).map(person => {
    const profilePubkey = person.pubkeys.length === 1 && profileKeys.includes(person.pubkeys[0]!) ? person.pubkeys[0] : undefined;
    const profile = profilePubkey ? profiles?.[profilePubkey] : undefined;
    return { id: person.principalId, displayName: person.displayName, avatarUrl: profile?.avatarUrl ?? null,
      ...(profilePubkey ? { profilePubkey } : {}) };
  });
  return {
    activeChannelTitle: people && isGenericDmChannelName(activeChannel.name)
      ? formatDmParticipantDisplayName(people) : activeChannel.name,
    activeDmHeaderParticipants,
  };
}
