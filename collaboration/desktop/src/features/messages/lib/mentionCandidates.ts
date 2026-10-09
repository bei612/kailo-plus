import type { ChannelRole } from "@/shared/api/types";
import { truncateNpub } from "@/shared/lib/pubkey";

export function appendUniqueName(current: string[], name: string): string[] {
  return current.some(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  )
    ? current
    : [...current, name];
}

/** A channel member the mention picker can offer. */
export type MentionCandidate = {
  pubkey: string;
  displayName: string | null;
  avatarUrl?: string | null;
  isMember: boolean;
  isAgent?: boolean;
  role?: ChannelRole | null;
  secondaryLabel?: string | null;
};

export function mentionCandidateLabel(candidate: MentionCandidate) {
  return candidate.displayName ?? truncateNpub(candidate.pubkey);
}
