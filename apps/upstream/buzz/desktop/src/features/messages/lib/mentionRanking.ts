import { normalizePubkey, truncateNpub } from "@/shared/lib/pubkey";

export type MentionCandidateForRanking = {
  displayName: string | null;
  pubkey: string;
  secondaryLabel?: string | null;
};

export type RankedMentionCandidate<T extends MentionCandidateForRanking> = {
  candidate: T;
  label: string;
  order: number;
  score: number;
};

function scoreMentionCandidateLabel(
  label: string,
  lowerQuery: string,
): number | null {
  const lower = label.toLowerCase();
  if (lower === lowerQuery) return 0;
  if (lower.startsWith(lowerQuery)) return 1;

  const words = lower.split(/[\s\-_]+/).filter(Boolean);
  if (words.some((word) => word === lowerQuery)) return 2;
  if (words.some((word) => word.startsWith(lowerQuery))) return 3;

  return null;
}

export function rankMentionCandidates<T extends MentionCandidateForRanking>(
  candidates: readonly T[],
  query: string,
): RankedMentionCandidate<T>[] {
  const lowerQuery = query.toLowerCase();

  return candidates
    .map((candidate, order) => {
      const pubkeyLower = normalizePubkey(candidate.pubkey);
      const label = candidate.displayName ?? truncateNpub(candidate.pubkey);

      const labelScores = [candidate.displayName, candidate.secondaryLabel]
        .map((value) =>
          value ? scoreMentionCandidateLabel(value, lowerQuery) : null,
        )
        .filter((score): score is number => score !== null);
      const labelScore =
        labelScores.length > 0 ? Math.min(...labelScores) : null;

      const pubkeyScore = pubkeyLower.startsWith(lowerQuery)
        ? 4
        : pubkeyLower.includes(lowerQuery)
          ? 5
          : null;
      const score = labelScore !== null ? labelScore : pubkeyScore;

      return { candidate, label, order, score };
    })
    .filter((item): item is RankedMentionCandidate<T> => item.score !== null)
    .sort((a, b) => a.score - b.score || a.order - b.order);
}
