import * as React from "react";
import { useChannelMembersQuery } from "@/features/channels/hooks";
import type { MentionSuggestion } from "@/features/messages/ui/MentionAutocomplete";
import type { AutocompleteEdit } from "./useRichTextEditor";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { detectPrefixQuery } from "@/shared/lib/detectPrefixQuery";
import { trimMapToSize } from "@/shared/lib/trimMapToSize";
import { flushMentionDebounce, isPlainSpace } from "./flushMentionDebounce";
import type { MentionIdentity } from "./mentionClipboard";
import {
  useMentionPasteBinding,
  type RegisterMentionPubkey,
} from "./mentionPasteBinding";
import { useVerifyMentionIdentities } from "./useVerifyMentionIdentities";
import {
  extractMentionPubkeys,
  selectedMentionLabel,
} from "./extractMentionPubkeys";
import { useDraftMentionRouting } from "./useDraftMentionRouting";
import { useMentionSelection } from "@client-kit/platform/react/use-mention-selection";
import { rankMentionCandidates } from "./mentionRanking";
import { mapMentionCandidateToSuggestion } from "./mentionSuggestionMapping";
import { appendUniqueName, mentionCandidateLabel } from "./mentionCandidates";
import { buildMentionCandidates } from "./buildMentionCandidates";

const MENTION_DEBOUNCE_MS = 120,
  MENTION_SUGGESTION_LIMIT = 50;

export function useMentions(
  channelId: string | null,
  profiles?: UserProfileLookup,
  people?: readonly MentionSuggestion[],
) {
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null);
  const [mentionStartIndex, setMentionStartIndex] = React.useState(0);
  const [selectedMentionNames, setSelectedMentionNames] = React.useState<
    string[]
  >([]);
  const mentionMapRef = React.useRef<Map<string, string>>(new Map());
  const membersQuery = useChannelMembersQuery(channelId);
  const members = membersQuery.data;
  const mentionCandidates = React.useMemo(
    () => people?.map(person=>({...person,avatarUrl:person.avatarUrl??null,role:null,secondaryLabel:null,isMember:true})) ?? buildMentionCandidates({ members, profiles }),
    [members, profiles, people],
  );
  const searchableNames = React.useMemo(
    () => [
      ...new Set(
        mentionCandidates.map((candidate) => mentionCandidateLabel(candidate)),
      ),
    ],
    [mentionCandidates],
  );
  const highlightNames = React.useMemo<string[]>(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const name of selectedMentionNames) {
      const trimmed = name.trim();
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        names.push(trimmed);
        seen.add(trimmed.toLowerCase());
      }
    }
    return names;
  }, [selectedMentionNames]);
  const searchableNamesLower = React.useMemo<string[]>(
    () => searchableNames.map((n) => n.toLowerCase()),
    [searchableNames],
  );
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const latestValueRef = React.useRef<string>("");
  const latestCursorRef = React.useRef<number>(0);
  const flushedMentionStartIndexRef = React.useRef<number | null>(null);
  const searchableNamesLowerRef = React.useRef<string[]>(searchableNamesLower);
  searchableNamesLowerRef.current = searchableNamesLower;
  React.useEffect(
    () => () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    },
    [],
  );
  const suggestions = React.useMemo<MentionSuggestion[]>(() => {
    if (mentionQuery === null) {
      return [];
    }
    return rankMentionCandidates(mentionCandidates, mentionQuery)
      .slice(0, MENTION_SUGGESTION_LIMIT)
      .map(({ candidate, label }) =>
        mapMentionCandidateToSuggestion({ candidate, label, profiles }),
      );
  }, [mentionCandidates, mentionQuery, profiles]);
  const { mentionSelectedIndex, setMentionSelectedIndex: setSelected } =
    useMentionSelection(suggestions);
  const isMentionOpen = mentionQuery !== null && suggestions.length > 0;
  // Untrusted clipboard records only become bindable identities once trusted
  // Buzz state confirms the pair — see `mentionIdentityTrust`.
  const verifyMentionIdentities = useVerifyMentionIdentities({
    mentionCandidates,
    profiles,
  });
  // The map write a settled paste uses: it records a decision the user made
  // earlier, so it must not outrank intent expressed since.
  const writeMentionPubkey = React.useCallback<RegisterMentionPubkey>(
    (displayName, pubkey) => {
      const trimmedName = displayName.trim();
      if (!trimmedName) {
        return;
      }
      mentionMapRef.current.set(trimmedName, pubkey);
      trimMapToSize(mentionMapRef.current, 200);
      setSelectedMentionNames((current) =>
        appendUniqueName(current, trimmedName),
      );
    },
    [],
  );
  const pasteBinding = useMentionPasteBinding({
    registerVerifiedMentionPubkey: writeMentionPubkey,
    verifyMentionIdentities,
  });
  const insertMention = React.useCallback(
    (suggestion: MentionSuggestion, selectionEnd: number): AutocompleteEdit => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const displayName = selectedMentionLabel(
        suggestion.displayName,
        suggestion.pubkey,
        mentionMapRef.current,
      );
      // A picked name is the user's newest word on that label, so it retires
      // any pasted identity still being verified for it.
      pasteBinding.claimMentionIntent(suggestion.displayName);
      pasteBinding.claimMentionIntent(displayName);
      mentionMapRef.current.set(displayName, suggestion.pubkey);
      trimMapToSize(mentionMapRef.current, 200);
      setSelectedMentionNames((current) =>
        appendUniqueName(current, displayName),
      );
      setMentionQuery(null);
      setSelected(0);
      const startIndex =
        flushedMentionStartIndexRef.current ?? mentionStartIndex;
      flushedMentionStartIndexRef.current = null;
      return {
        replaceFromOffset: startIndex,
        replaceToOffset: selectionEnd,
        insertText: `@${displayName} `,
      };
    },
    [mentionStartIndex, pasteBinding.claimMentionIntent, setSelected],
  );
  // Registration is explicit user intent; paste settlement keeps its separate
  // non-bumping write. Reserve the exact label before claiming either name so
  // a pending paste cannot take the original name after a qualified selection.
  const registerMentionPubkey = React.useCallback(
    (displayName: string, pubkey: string) => {
      const label = selectedMentionLabel(
        displayName.trim(),
        pubkey,
        mentionMapRef.current,
      );
      if (!label) return;
      pasteBinding.claimMentionIntent(displayName);
      pasteBinding.claimMentionIntent(label);
      writeMentionPubkey(label, pubkey);
      return label;
    },
    [pasteBinding.claimMentionIntent, writeMentionPubkey],
  );
  const getMentionIdentities = React.useCallback((): MentionIdentity[] => {
    const identities: MentionIdentity[] = [];
    const claimed = new Set<string>();
    const add = (label: string, pubkey: string) => {
      const trimmed = label.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || !pubkey || claimed.has(key)) return;
      claimed.add(key);
      identities.push({ label: trimmed, pubkey });
    };
    // Explicitly picked mentions first: they are authoritative when a manually
    // typed member name collides with one the user selected from the picker.
    for (const [label, pubkey] of mentionMapRef.current) {
      add(label, pubkey);
    }
    for (const candidate of mentionCandidates) {
      if (candidate.displayName) add(candidate.displayName, candidate.pubkey);
    }
    return identities;
  }, [mentionCandidates]);
  const insertResolvedMention = React.useCallback(
    ({
      displayName,
      pubkey,
      replaceFromOffset,
      replaceToOffset,
    }: {
      displayName: string;
      pubkey: string;
      replaceFromOffset: number;
      replaceToOffset: number;
    }): AutocompleteEdit => {
      const label = registerMentionPubkey(displayName, pubkey);
      return {
        replaceFromOffset,
        replaceToOffset,
        insertText: `@${label ?? displayName.trim()} `,
      };
    },
    [registerMentionPubkey],
  );
  const autocompleteGenerationRef = React.useRef(0);
  const updateMentionQuery = React.useCallback(
    (value: string, cursorPosition: number) => {
      const generation = ++autocompleteGenerationRef.current;
      latestValueRef.current = value;
      latestCursorRef.current = cursorPosition;
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (generation !== autocompleteGenerationRef.current) return;
        const mention = detectPrefixQuery(
          "@",
          latestValueRef.current,
          latestCursorRef.current,
          searchableNamesLowerRef.current,
        );
        if (mention) {
          setMentionQuery(mention.query);
          setMentionStartIndex(mention.startIndex);
          setSelected(0);
        } else {
          setMentionQuery(null);
        }
      }, MENTION_DEBOUNCE_MS);
    },
    [setSelected],
  );
  const openMentionPicker = React.useCallback(
    (cursorPosition: number) => {
      autocompleteGenerationRef.current += 1;
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      flushedMentionStartIndexRef.current = null;
      setMentionQuery("");
      setMentionStartIndex(cursorPosition);
      setSelected(0);
    },
    [setSelected],
  );
  const extractMentionPubkeysForCurrentMentions = React.useCallback(
    (text: string, competingDisplayNames: readonly string[] = []): string[] =>
      // Selections are intent, not cached authorization. Never discard a
      // selected key because a refresh removed it from the picker.
      extractMentionPubkeys({
        text,
        competingDisplayNames,
        selectedMentions: mentionMapRef.current,
        memberCandidates: mentionCandidates,
      }),
    [mentionCandidates],
  );
  const cancelMentionAutocomplete = React.useCallback(() => {
    autocompleteGenerationRef.current += 1;
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    flushedMentionStartIndexRef.current = null;
    setMentionQuery(null);
    setSelected(0);
  }, [setSelected]);
  const clearMentions = React.useCallback(() => {
    cancelMentionAutocomplete();
    mentionMapRef.current.clear();
    setSelectedMentionNames([]);
    // Belt to the occurrence fence's braces: a paste still verifying when the
    // composer is cleared holds a claim nothing can match afterwards.
    pasteBinding.clearMentionIntents();
  }, [cancelMentionAutocomplete, pasteBinding.clearMentionIntents]);
  const { getDraftMentionRefs, restoreDraftMentionRefs } =
    useDraftMentionRouting({
      memberCandidates: mentionCandidates,
      mentionMapRef,
      cancelAutocomplete: cancelMentionAutocomplete,
      setSelectedNames: setSelectedMentionNames,
    });
  const handleMentionKeyDown = React.useCallback(
    (
      event: React.KeyboardEvent,
      // `isCodeContext` is only consulted for Space: inside code the typed
      // text must stay literal, so Space is left to the editor.
      opts?: { isCodeContext?: () => boolean },
    ): { handled: boolean; suggestion?: MentionSuggestion } => {
      const exactMentionSpace =
        isPlainSpace(event.nativeEvent) && !opts?.isCodeContext?.();
      if (!isMentionOpen && !exactMentionSpace) return { handled: false };
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((current) =>
          current < suggestions.length - 1 ? current + 1 : 0,
        );
        return { handled: true };
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((current) =>
          current > 0 ? current - 1 : suggestions.length - 1,
        );
        return { handled: true };
      }
      if (
        exactMentionSpace ||
        (event.key === "Tab" && !event.shiftKey) ||
        (event.key === "Enter" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey)
      ) {
        if (debounceTimerRef.current !== null || exactMentionSpace) {
          const flushed = flushMentionDebounce({
            debounceTimerRef,
            latestValueRef,
            latestCursorRef,
            searchableNamesLowerRef,
            candidates: mentionCandidates,
            profiles,
            requireExact: exactMentionSpace,
          });
          if (exactMentionSpace && flushed?.type !== "match")
            return { handled: false };
          event.preventDefault();
          if (flushed?.type === "match") {
            flushedMentionStartIndexRef.current = flushed.startIndex;
            setMentionQuery(null); // reset so dropdown closes
            return { handled: true, suggestion: flushed.suggestion };
          }
          if (flushed?.type === "no-match") {
            setMentionQuery(null);
            return { handled: true };
          }
        }
        event.preventDefault();
        return { handled: true, suggestion: suggestions[mentionSelectedIndex] };
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelMentionAutocomplete(); // full cancel incl. pending debounce
        return { handled: true };
      }
      return { handled: false };
    },
    [
      cancelMentionAutocomplete,
      isMentionOpen,
      mentionCandidates,
      mentionSelectedIndex,
      profiles,
      setSelected,
      suggestions,
    ],
  );
  return {
    bindPastedMentionIdentities: pasteBinding.bindPastedMentionIdentities,
    cancelMentionAutocomplete,
    clearMentions,
    extractMentionPubkeys: extractMentionPubkeysForCurrentMentions,
    getDraftMentionRefs,
    getMentionIdentities,
    handleMentionKeyDown,
    insertMention,
    insertResolvedMention,
    isMentionOpen,
    knownNames: highlightNames,
    mentionSelectedIndex,
    mentionStartIndex,
    openMentionPicker,
    registerMentionPubkey,
    restoreDraftMentionRefs,
    settlePendingMentionBindings: pasteBinding.settlePendingMentionBindings,
    suggestions,
    updateMentionQuery,
  };
}
export type UseMentionsResult = ReturnType<typeof useMentions>;
