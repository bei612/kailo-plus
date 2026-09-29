import type { MentionPubkeyCandidate } from "./extractMentionPubkeys";
import * as React from "react";

import type { DraftMentionRef } from "./useDrafts";

import { trimMapToSize } from "@/shared/lib/trimMapToSize";
import {
  replaceWithDraftMentionRefs,
  snapshotDraftMentionRefs,
} from "./draftMentionRefs";

export function useDraftMentionRouting(params: {
  memberCandidates?: readonly MentionPubkeyCandidate[];
  mentionMapRef: React.MutableRefObject<Map<string, string>>;
  cancelAutocomplete: () => void;
  setSelectedNames: (names: string[]) => void;
}): {
  getDraftMentionRefs: (
    content: string,
    fallbackRefs?: readonly DraftMentionRef[],
    competingDisplayNames?: readonly string[],
  ) => DraftMentionRef[];
  restoreDraftMentionRefs: (refs: readonly DraftMentionRef[]) => void;
} {
  const getDraftMentionRefs = React.useCallback(
    (
      content: string,
      fallbackRefs: readonly DraftMentionRef[] = [],
      competingDisplayNames: readonly string[] = [],
    ) =>
      snapshotDraftMentionRefs(
        content,
        params.mentionMapRef.current,
        params.memberCandidates,
        fallbackRefs,
        competingDisplayNames,
      ),
    [params.mentionMapRef, params.memberCandidates],
  );
  const restoreDraftMentionRefs = React.useCallback(
    (refs: readonly DraftMentionRef[]) => {
      params.cancelAutocomplete();
      const names = replaceWithDraftMentionRefs(
        refs,
        params.mentionMapRef.current,
      );
      trimMapToSize(params.mentionMapRef.current, 200);
      params.setSelectedNames(names);
    },
    [params],
  );
  return { getDraftMentionRefs, restoreDraftMentionRefs };
}
