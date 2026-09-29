import type * as React from "react";

import type { ParsedMessageLink } from "@/features/messages/lib/messageLink";
import type { Channel } from "@/shared/api/types";
import type { VideoReviewContext } from "../VideoPlayer";

export type ImetaEntry = {
  dim?: string;
  image?: string;
  thumb?: string;
  m?: string;
  size?: number;
  filename?: string;
  duration?: number;
  /** SHA-256 hex of the attachment bytes (from imeta `x` field). */
  x?: string;
};

export type ImetaLookup = Map<string, ImetaEntry>;

export type MessageLinkPillProps = {
  /** Member channels available synchronously from the caller's runtime. */
  channels?: Channel[];
  /** Resolve a missing channel id with a bounded detail query. */
  resolveChannelReference?: boolean;
  /** Original permalink text, preserved for the context menu's Copy action. */
  href?: string;
  interactive: boolean;
  link: ParsedMessageLink;
  onOpenChannel: (channelId: string) => void;
  onOpenMessageLink: (link: ParsedMessageLink) => void;
  threadExcerpt?: string | null;
  variant?: "default" | "sent-from-thread";
};

export type MarkdownRuntime = {
  channels: Channel[];
  imetaByUrl?: ImetaLookup;
  /** Inline content supplied to the first prose-capable Markdown block. */
  leadingInlineContent?: React.ReactNode;
  mentionPubkeysByName?: Record<string, string>;
  onOpenChannel: (channelId: string) => void;
  onOpenMessageLink: (link: ParsedMessageLink) => void;
  /**
   * The resolved relay origin (e.g. `https://relay.example.com`),
   * or `null` when not yet resolved. Used by the anchor component to
   * validate that clone-URL rewrites point to the active relay only.
   */
  relayOrigin: string | null;
  resolveChannelReferences?: boolean;
};

export type MarkdownProps = {
  channelNames?: string[];
  className?: string;
  content: string;
  /**
   * When true (default), single newlines become `<br>` — chat Enter behavior.
   * Git commit bodies are hard-wrapped at ~72 columns; pass false so those
   * wraps reflow with the panel instead of staying a narrow column.
   */
  hardLineBreaks?: boolean;
  imetaByUrl?: ImetaLookup;
  interactive?: boolean;
  /**
   * Render fenced code as scrollable code blocks even when `interactive` is
   * false. Non-interactive surfaces default to inlining code (compact
   * previews); document surfaces like repository READMEs pass true so long
   * lines scroll inside the block instead of stretching the layout.
   */
  blockCode?: boolean;
  mentionNames?: string[];
  mentionPubkeysByName?: Record<string, string>;
  mediaInset?: boolean;
  /** Event/message identity used only for local preview-image visibility. */
  messageId?: string;
  linkPreviewsSuppressed?: boolean;
  linkPreviewTags?: readonly (readonly string[])[];
  /** Inline content prepended inside the first rendered prose paragraph. */
  leadingInlineContent?: React.ReactNode;
  searchQuery?: string;
  videoReviewContext?: VideoReviewContext;
};
