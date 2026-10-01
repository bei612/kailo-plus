import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { ChannelMember } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import type { MentionCandidate } from "./mentionCandidates";

/**
 * Turn the channel roster into the deduplicated candidate list the mention
 * autocomplete ranks. Names prefer the roster entry, then the member's
 * profile display name, then their NIP-05 handle.
 */
export function buildMentionCandidates({
  members,
  profiles,
}: {
  members: readonly ChannelMember[] | undefined;
  profiles: UserProfileLookup | undefined;
}): MentionCandidate[] {
  const candidatesByPubkey = new Map<string, MentionCandidate>();
  for (const member of members ?? []) {
    const pubkey = normalizePubkey(member.pubkey);
    if (candidatesByPubkey.has(pubkey)) continue;
    const profile = profiles?.[pubkey] ?? null;
    candidatesByPubkey.set(pubkey, {
      pubkey,
      displayName:
        member.displayName?.trim() ||
        profile?.displayName?.trim() ||
        profile?.nip05Handle?.trim() ||
        null,
      avatarUrl: profile?.avatarUrl ?? null,
      isMember: true,
      role: member.role,
      secondaryLabel:
        profile?.displayName?.trim() && profile?.nip05Handle?.trim()
          ? profile.nip05Handle
          : null,
    });
  }
  return [...candidatesByPubkey.values()];
}
