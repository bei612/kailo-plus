import * as React from "react";
import { useChannelMembersQuery } from "@/features/channels/hooks";
import { useVerifyMentionIdentities } from "./useVerifyMentionIdentities";
import { buildMentionCandidates } from "./buildMentionCandidates";
import type { MentionSuggestion } from "../ui/MentionAutocomplete";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { useComposerMentions } from "@client-kit/platform/react/composer/features/messages/lib/useComposerMentions";
export function useMentions(channelId: string | null, profiles?: UserProfileLookup,
  people?: readonly MentionSuggestion[], agents?: readonly MentionSuggestion[], ownerPubkey?: string,
  outsidePeople?: readonly MentionSuggestion[], teams?: readonly MentionSuggestion[]) {
  const membersQuery = useChannelMembersQuery(channelId);
  const members = membersQuery.data;
  const mentionCandidates = React.useMemo(
    () => {
      const admittedAgents = new Map((agents ?? []).map(agent => [agent.pubkey, agent]));
      const humans = people?.map(person=>({...person,avatarUrl:person.avatarUrl??null,role:null,secondaryLabel:null,isMember:true,isAgent:false})) ?? buildMentionCandidates({ members, profiles });
      // Original buildMentionCandidates: search results outside the roster are `isMember: false`,
      // so a typed label never binds them; only an explicit selection does.
      const known = new Set([...humans.map(person=>person.pubkey), ...admittedAgents.keys()]);
      const outside = (outsidePeople ?? []).filter(person=>!known.has(person.pubkey))
        .map(person=>({...person,avatarUrl:person.avatarUrl??profiles?.[person.pubkey]?.avatarUrl??null,role:null,secondaryLabel:null,isMember:false,isAgent:false}));
      return [...humans.filter(person=>!admittedAgents.has(person.pubkey)), ...[...admittedAgents.values()].map(agent=>({...agent,avatarUrl:agent.avatarUrl??null,role:null,secondaryLabel:null,isMember:true,isAgent:true})), ...outside];
    },
    [members, profiles, people, agents, outsidePeople],
  );
  const verifyMentionIdentities = useVerifyMentionIdentities({ mentionCandidates, profiles });
  return useComposerMentions({ candidates: mentionCandidates, profiles, teams,
    scope: `${channelId}:${ownerPubkey}`, verifyMentionIdentities });
}
export type UseMentionsResult = ReturnType<typeof useMentions>;
