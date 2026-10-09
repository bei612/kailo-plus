import {
  mentionMatchCandidates,
  type MentionPubkeyCandidate,
} from "./extractMentionPubkeys";
import { mentionOccurrences } from "@/shared/lib/mentionOccurrences";
import type { DraftMentionRef } from "@/features/messages/lib/useDrafts";
import { normalizePubkey } from "@/shared/lib/pubkey";

export function snapshotDraftMentionRefs(
  content: string,
  mentions: ReadonlyMap<string, string>,
  memberCandidates: readonly MentionPubkeyCandidate[] = [],
  fallbackRefs: readonly DraftMentionRef[] = [],
  competingDisplayNames: readonly string[] = [],
): DraftMentionRef[] {
  // Fallback references may contain ambiguous historical ties. Keep them as
  // candidates, not a name-to-key Map: collapsing ties would invent a binding.
  // Non-binding competitors also take part when snapshotting resolved refs.
  const currentNames = new Set(
    [...mentions.keys()].map((name) => name.trim().toLowerCase()),
  );
  const fallback = fallbackRefs.filter(
    (ref) => !currentNames.has(ref.displayName.trim().toLowerCase()),
  );
  const refs = [
    ...fallback,
    ...[...mentions].map(([displayName, pubkey]) => ({ displayName, pubkey })),
  ];
  const presentNames = new Set(
    mentionOccurrences(content, [
      ...fallback,
      ...mentionMatchCandidates({
        selectedMentions: mentions,
        memberCandidates,
        selectedDisplayNames: fallback.map((ref) => ref.displayName),
        competingDisplayNames,
      }),
    ]).flatMap((match) =>
      match.candidates.map((candidate) => candidate.displayName),
    ),
  );
  return refs
    .filter(({ displayName }) => presentNames.has(displayName))
    .map((ref) => ({ ...ref, pubkey: normalizePubkey(ref.pubkey) }));
}

function normalizeDraftMentionRefs(
  refs: readonly DraftMentionRef[],
): DraftMentionRef[] {
  const normalized: DraftMentionRef[] = [];
  for (const ref of refs) {
    const displayName = ref.displayName.trim();
    const pubkey = normalizePubkey(ref.pubkey);
    if (displayName && pubkey) {
      normalized.push({ displayName, pubkey, ...(ref.isAgent === true ? {isAgent: true} : {}) });
    }
  }
  return normalized;
}

export function replaceWithDraftMentionRefs(
  refs: readonly DraftMentionRef[],
  mentions: Map<string, string>,
): string[] {
  mentions.clear();
  const normalized = normalizeDraftMentionRefs(refs);
  for (const ref of normalized) mentions.set(ref.displayName, ref.pubkey);
  return normalized.map((ref) => ref.displayName);
}
