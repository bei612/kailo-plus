import type { UserProfileSummary } from "../../pulse/host";
import { normalizePubkey, truncateNpub } from "../../conversations/pubkey";
import type { Translate } from "../../context";
import { translateCurrent } from "../../../i18n";

export type UserProfileLookup = Record<string, UserProfileSummary>;

function getResolvedProfile(
  pubkey: string,
  profiles: UserProfileLookup | undefined,
) {
  if (!profiles) {
    return null;
  }

  return profiles[normalizePubkey(pubkey)] ?? null;
}

export function resolveUserLabel(input: {
  pubkey: string;
  currentPubkey?: string;
  fallbackName?: string | null;
  profiles?: UserProfileLookup;
  preferResolvedSelfLabel?: boolean;
  t?: Translate;
}) {
  const {
    currentPubkey,
    fallbackName,
    preferResolvedSelfLabel = false,
    profiles,
    pubkey,
    t = translateCurrent,
  } = input;

  if (
    typeof currentPubkey === "string" &&
    normalizePubkey(currentPubkey) === normalizePubkey(pubkey)
  ) {
    if (!preferResolvedSelfLabel) {
      return t("messages.system.you");
    }
  }

  const profile = getResolvedProfile(pubkey, profiles);
  const displayName = profile?.displayName?.trim();
  if (displayName) {
    return displayName;
  }

  const nip05Handle = profile?.nip05Handle?.trim();
  if (nip05Handle) {
    return nip05Handle;
  }

  const safeFallback = fallbackName?.trim();
  if (safeFallback) {
    return safeFallback;
  }

  return truncateNpub(pubkey);
}

/**
 * Label for an agent's owner: "you" when the current user owns it, otherwise
 * the owner's display name, NIP-05 handle, or truncated pubkey.
 */
export function formatOwnerLabel(
  ownerPubkey: string | null | undefined,
  currentPubkey: string | null | undefined,
  ownerProfiles?: UserProfileLookup,
  t: Translate = translateCurrent,
) {
  if (!ownerPubkey) {
    return null;
  }

  const normalizedOwnerPubkey = normalizePubkey(ownerPubkey);
  if (
    currentPubkey &&
    normalizedOwnerPubkey === normalizePubkey(currentPubkey)
  ) {
    return t("messages.system.inlineYou");
  }

  const owner = ownerProfiles?.[normalizedOwnerPubkey];
  return (
    owner?.displayName?.trim() ||
    owner?.nip05Handle?.trim() ||
    truncateNpub(ownerPubkey)
  );
}
