import { decode, npubEncode } from "nostr-tools/nip19";

/**
 * Encode a hex public key as npub, returning null instead of throwing on malformed
 * input. For display surfaces that must degrade gracefully.
 */
export function safeNpub(pubkey: string): string | null {
  try {
    return npubEncode(pubkey);
  } catch {
    return null;
  }
}

const HEX_PUBKEY_REGEX = /^[0-9a-f]{64}$/;

/**
 * Parse user-entered public key input — either a 64-character hex pubkey or
 * a bech32 `npub1…` string — into a lowercase hex pubkey. Returns null for
 * anything else (does NOT throw — intended for live form validation).
 *
 * The input is trimmed first; surrounding whitespace from copy-paste is
 * tolerated. It is also case-normalized before matching and decoding —
 * preexisting behavior — so a hex key in any casing resolves, and a
 * mixed-case npub (invalid Bech32 as written) is accepted via its
 * lowercased form. The identity payload itself stays strict: it must
 * decode to exactly a 64-char hex identity key, because `npubEncode` also
 * encodes degenerate short payloads (even `""`), which are never valid
 * identities.
 */
export function parsePubkeyInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (HEX_PUBKEY_REGEX.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = decode(trimmed);
      if (decoded.type === "npub" && HEX_PUBKEY_REGEX.test(decoded.data)) {
        return decoded.data;
      }
    } catch {
      return null;
    }
  }
  return null;
}
