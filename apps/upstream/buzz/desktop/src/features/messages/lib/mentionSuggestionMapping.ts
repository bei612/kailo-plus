import type { MentionSuggestion } from "@/features/messages/ui/MentionAutocomplete";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { normalizePubkey } from "@/shared/lib/pubkey";
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
    avatarUrl:
      candidate.avatarUrl ??
      profiles?.[normalizePubkey(candidate.pubkey)]?.avatarUrl ??
      null,
    role: candidate.role === "admin" ? "admin" : null,
  };
}
