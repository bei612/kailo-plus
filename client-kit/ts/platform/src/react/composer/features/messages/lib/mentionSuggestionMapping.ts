import type { MentionSuggestion } from "../ui/MentionAutocomplete";
type UserProfileLookup = Record<string, { avatarUrl?: string | null }>;
import { normalizePubkey } from "../../../../conversations/pubkey";
import type { MentionCandidate } from "./mentionCandidates";

export function mapMentionCandidateToSuggestion(opts: {
  candidate: MentionCandidate;
  label: string;
  profiles?: UserProfileLookup;
}): MentionSuggestion {
  const { candidate, label, profiles } = opts;
  return {
    pubkey: candidate.pubkey,
    displayName: label,
    isAgent: candidate.isAgent === true,
    avatarUrl:
      candidate.avatarUrl ??
      profiles?.[normalizePubkey(candidate.pubkey)]?.avatarUrl ??
      null,
    role: candidate.role === "admin" ? "admin" : null,
    // Original mapping: a person outside the channel is marked "not in channel".
    ...(candidate.isMember === false && candidate.isAgent !== true ? { notInChannel: true } : {}),
  };
}
