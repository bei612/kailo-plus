// Original Buzz message projection, not a platform identity or reaction authority.
export type TimelineReaction = {
  emoji: string;
  emojiUrl?: string;
  count: number;
  reactedByCurrentUser?: boolean;
  users: Array<{ pubkey: string; displayName: string; avatarUrl: string | null }>;
};

export type TimelineMessage = {
  id: string;
  /** Stable local key used to avoid remounting optimistic rows on send ack. */
  renderKey?: string;
  createdAt: number;
  pubkey?: string;
  /**
   * Raw signer pubkey (`event.pubkey`), normalized to lowercase hex.
   * Distinct from `pubkey`, which may be a delegated author on an event signed
   * by the active relay. Use this field for checks that require the process or
   * user that cryptographically signed the event.
   */
  signerPubkey?: string;
  author: string;
  avatarUrl?: string | null;
  role?: string;
  isAgent?: boolean;
  ownerPubkey?: string | null;
  /** DD-147(1): the owner's Principal, present with `ownerPubkey` so the name opens the member card. */
  ownerPrincipalId?: string | null;
  ownerLabel?: string | null;
  /**
   * DD-147(2): the owner-only respondTo badge. Only `allowlist` exists in Kailo (`anyone` is not
   * offered, DD-125(6)); absent means the default owner-only.
   */
  respondTo?: "allowlist";
  reactions?: TimelineReaction[];
  time: string;
  body: string;
  parentId?: string | null;
  rootId?: string | null;
  depth: number;
  accent?: boolean;
  pending?: boolean;
  /** A same-author edit (kind 40003) has been overlaid on this message. */
  edited?: boolean;
  highlighted?: boolean;
  kind?: number;
  tags?: string[][];
};
