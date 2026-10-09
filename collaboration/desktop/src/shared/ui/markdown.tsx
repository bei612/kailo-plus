import * as React from "react";
import {
  ImageBlock as SharedImageBlock,
  ImageZoomOverlay as SharedImageZoomOverlay,
  type ImageActions,
} from "@client-kit/platform/react/image-lightbox";
import { customEmojiFromTags, InlineEmojiPopover } from "@client-kit/platform/react/custom-emoji";
import {
  MESSAGE_BODY_CLASS_NAME,
  MESSAGE_BODY_COMPONENTS,
  MessageBody,
  PlainCodeBlock,
  getCodeBlockLanguage,
} from "@client-kit/platform/react/message-body";
import type { Components } from "react-markdown";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { parseChannelLink } from "@/features/messages/lib/channelLink";
import { isAudioAttachment } from "@/features/messages/lib/audioAttachment";
import {
  parseMessageLink,
  resolveMessageLinkRenderTarget,
  type ParsedMessageLink,
} from "@/features/messages/lib/messageLink";
import { renderAudioMessageAttachment } from "@/features/messages/ui/AudioMessageAttachment";
import { useChannelNavigation } from "@/shared/context/ChannelNavigationContext";
import { cn } from "@/shared/lib/cn";
import { parseSupportedLinkPreview } from "@/shared/lib/linkPreview";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";
import { createMarkdownMention } from "./markdown/MarkdownMention";
import { LinkPreviewList } from "@/shared/ui/link-preview-list";
import { INLINE_CODE_CHIP_CLASS } from "@/shared/ui/mentionChip";

import {
  classifyChildren,
  hasBlockMedia,
  isImageOnlyParagraph,
  markdownPropsAreEqual,
} from "./markdownUtils";
import { ImageMosaic } from "./markdown/ImageMosaic";
import { copyImageToClipboard, downloadImage } from "./markdown/imageActions";
import {
  extractLanguage,
  MarkdownCodeBlock,
  SyntaxHighlightedCode,
} from "./markdown/CodeBlock";
import { ExternalLinkAnchor } from "./markdown/ExternalLinkAnchor";
import { FileCard } from "./markdown/FileCard";
import {
  AuthoredDeepLinkAnchor,
  ChannelDeepLinkAnchor,
  MarkdownChannelDeepLink,
  MarkdownChannelReference,
} from "./markdown/ChannelDeepLink";
import { createLinkPreviewImageLightbox } from "./markdown/LinkPreviewImageLightbox";
import { MarkdownInput } from "./markdown/MarkdownInput";
import { isRelayDownloadable, isVideoMedia } from "./markdown/mediaEntry";
import { MarkdownTable } from "./markdown/MarkdownTable";
import { MessageLinkPill } from "./markdown/MessageLinkPill";
import { renderCachedMarkdown } from "./markdown/nodeCache";
import { useMessageLinkPreviews } from "./markdown/useMessageLinkPreviews";
import {
  MarkdownRuntimeContext,
  useMarkdownRuntime,
} from "./markdown/runtimeContext";
import { resolveFileCard } from "./markdownFileCard";
import type { MarkdownProps, MarkdownRuntime } from "./markdown/types";
import { SpoilerInline } from "./markdown/SpoilerInline";
import { getReactNodeText, useStableArray } from "./markdown/utils";
import {
  MarkdownVideoPlayer,
  VideoReviewMarkdownContext,
} from "./markdown/MarkdownVideoPlayer";

function ImageZoomOverlay(
  props: Omit<React.ComponentProps<typeof SharedImageZoomOverlay>, keyof ImageActions>,
) {
  return <SharedImageZoomOverlay {...props}
    copyImageToClipboard={copyImageToClipboard} downloadImage={downloadImage} />;
}

export const LinkPreviewImageLightbox =
  createLinkPreviewImageLightbox(ImageZoomOverlay);

/**
 * Inline image embed with click-to-zoom lightbox and right-click download.
 *
 * IMPORTANT: the trigger is a plain button that we control ourselves — not
 * Radix's `<Trigger asChild>` cloning onto a wrapper. An earlier version used
 * that pattern and caused a 1-2px layout reflow in the surrounding message
 * body on hover. Keeping the trigger stable and managing the lightbox via
 * React state avoids that repaint.
 */
function ImageBlock(
  props: Omit<React.ComponentProps<typeof SharedImageBlock>, keyof ImageActions>,
) {
  return <SharedImageBlock {...props}
    copyImageToClipboard={copyImageToClipboard} downloadImage={downloadImage} />;
}

export function createMarkdownComponents(
  interactive = true,
  mediaInset = false,
  blockCode = false,
): Components {
  function MarkdownAnchor({
    children,
    href,
    ...props
  }: React.ComponentPropsWithoutRef<"a">) {
    const {
      channels,
      imetaByUrl,
      onOpenChannel,
      onOpenMessageLink,
      relayOrigin,
      resolveChannelReferences,
    } = useMarkdownRuntime();
    if (!interactive) {
      return <span className="font-medium text-current">{children}</span>;
    }
    if (hasBlockMedia(React.Children.toArray(children))) {
      return <>{children}</>;
    }

    const label = getReactNodeText(children);

    const audioAttachment = renderAudioMessageAttachment(
      href ? imetaByUrl?.get(href) : undefined,
      href,
      label,
      href && isRelayDownloadable(href, relayOrigin ?? undefined)
        ? href
        : undefined,
    );
    if (audioAttachment) return audioAttachment;

    // Render non-media imeta links as download cards; media uses `img`.
    const card = resolveFileCard(
      href ? imetaByUrl?.get(href) : undefined,
      href,
      label,
    );
    if (card) {
      return (
        <FileCard href={card.href} filename={card.filename} size={card.size} />
      );
    }

    // Keep Buzz channel/message navigation in-app.
    if (href) {
      if (parseChannelLink(href).ok) {
        return (
          <ChannelDeepLinkAnchor
            {...props}
            href={href}
            interactive={interactive}
          >
            {children}
          </ChannelDeepLinkAnchor>
        );
      }
      const messageLinkTarget = resolveMessageLinkRenderTarget({
        href,
        label,
      });
      if (messageLinkTarget.kind !== "none") {
        if (messageLinkTarget.kind === "pill") {
          return (
            <MessageLinkPill
              channels={channels}
              interactive={interactive}
              link={messageLinkTarget.link}
              onOpenChannel={onOpenChannel}
              onOpenMessageLink={onOpenMessageLink}
              resolveChannelReference={resolveChannelReferences}
            />
          );
        }

        return (
          <AuthoredDeepLinkAnchor
            channelId={messageLinkTarget.link.channelId}
            href={href}
            interactive={interactive}
            messageLink={messageLinkTarget.link}
          >
            {children}
          </AuthoredDeepLinkAnchor>
        );
      }
      // Malformed message deep links fall through to external handling.
    }

    const supportedLinkPreview = href ? parseSupportedLinkPreview(href) : null;
    const isLinearLink = supportedLinkPreview?.kind === "linear-issue";

    return (
      <ExternalLinkAnchor
        anchorProps={props}
        href={href}
        isLinearLink={isLinearLink}
        label={label}
      >
        {children}
      </ExternalLinkAnchor>
    );
  }

  return {
    ...MESSAGE_BODY_COMPONENTS,
    spoiler: ({
      children,
      ...props
    }: {
      "data-block-spoiler"?: string;
      children?: React.ReactNode;
    }) => (
      <SpoilerInline
        block={props["data-block-spoiler"] != null}
        interactive={interactive}
      >
        {children}
      </SpoilerInline>
    ),
    span: function MarkdownSpan({ children, node: _node, ...props }) {
      const { leadingInlineContent } = useMarkdownRuntime();
      if ("data-leading-inline-content" in props) {
        return <>{leadingInlineContent}</>;
      }
      return <span {...props}>{children}</span>;
    },
    a: MarkdownAnchor,
    code: ({ children, className, ...props }: React.ComponentProps<"code">) => {
      const rawCode = String(children);
      const code = rawCode.replace(/\n$/, "");
      const isFencedCodeBlock =
        typeof className === "string" && className.includes("language-");

      if (isFencedCodeBlock || rawCode.endsWith("\n") || code.includes("\n")) {
        const language = extractLanguage(className);

        if (language) {
          return (
            <SyntaxHighlightedCode code={code} language={language} {...props} />
          );
        }

        return <PlainCodeBlock {...props} code={code} />;
      }

      return (
        <code {...props} className={cn(INLINE_CODE_CHIP_CLASS, className)}>
          {children}
        </code>
      );
    },
    img: function MarkdownImage({ alt, src }) {
      const { imetaByUrl } = useMarkdownRuntime();
      const entry = src ? imetaByUrl?.get(src) : undefined;
      const isVideo = src ? isVideoMedia(src, entry?.m) : false;
      if (!interactive) {
        const fallbackLabel = isVideo ? "Video attachment" : "Image attachment";
        return <span>{alt?.trim() || fallbackLabel}</span>;
      }

      const resolvedSrc = src ? rewriteRelayUrl(src) : src;
      if (isVideo && src && resolvedSrc) {
        return (
          <span
            className={cn(
              mediaInset && "mx-1.5 block max-w-[calc(100%-0.75rem)]",
            )}
            data-block-media=""
          >
            <MarkdownVideoPlayer
              key={src ?? resolvedSrc}
              alt={alt}
              entry={entry}
              resolvedSrc={resolvedSrc}
              src={src}
            />
          </span>
        );
      }
      return (
        <span data-block-media="" className="block min-w-0 max-w-full">
          <ImageBlock
            alt={alt}
            dim={entry?.dim}
            resolvedSrc={resolvedSrc}
            src={src}
            thumbSrc={entry?.thumb ? rewriteRelayUrl(entry.thumb) : undefined}
          />
        </span>
      );
    },
    input: MarkdownInput,
    p: function MarkdownParagraph({ children }) {
      const { imetaByUrl } = useMarkdownRuntime();
      // Detect media-only paragraphs (images + <br> from remarkBreaks).
      // Multi-image: render as a compact, count-aware mosaic. Two images split
      // a row, three form a hero-and-stack triptych, and larger odd counts let
      // the final image span both columns.
      // Single media: render as a plain <div> to avoid invalid <p><div> nesting
      // (the img component returns block-level wrappers for lightbox/video).
      const childArray = React.Children.toArray(children);
      const { imageChildren } = classifyChildren(childArray);
      const hasAudioAttachment = childArray.some(
        (child) =>
          React.isValidElement<{ href?: string }>(child) &&
          typeof child.props.href === "string" &&
          isAudioAttachment(imetaByUrl?.get(child.props.href)),
      );

      if (isImageOnlyParagraph(childArray)) {
        return <ImageMosaic>{imageChildren}</ImageMosaic>;
      }

      if (hasBlockMedia(childArray) || hasAudioAttachment) {
        return <div>{children}</div>;
      }

      return <p>{children}</p>;
    },
    pre: ({ children }) => {
      if (!interactive && !blockCode) return <span>{children}</span>;
      return (
        <MarkdownCodeBlock language={getCodeBlockLanguage(children)}>
          {children}
        </MarkdownCodeBlock>
      );
    },
    table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
    mention: createMarkdownMention(interactive),
    emoji: ({ src, alt }: { src?: string; alt?: string }) => {
      const resolvedSrc = src ? rewriteRelayUrl(src) : undefined;
      if (!resolvedSrc || !interactive) return <span>{alt}</span>;
      return <InlineEmojiPopover alt={alt} resolvedSrc={resolvedSrc} />;
    },
    "channel-deep-link": ({ children }: { children?: React.ReactNode }) => (
      <MarkdownChannelDeepLink interactive={interactive}>
        {children}
      </MarkdownChannelDeepLink>
    ),
    "channel-link": ({ children }: { children?: React.ReactNode }) => (
      <MarkdownChannelReference interactive={interactive}>
        {children}
      </MarkdownChannelReference>
    ),
    "message-link": function MarkdownMessageLink({
      children,
    }: {
      children?: React.ReactNode;
    }) {
      const runtime = useMarkdownRuntime();
      const { channels, onOpenChannel, onOpenMessageLink } = runtime;
      const href = String(children ?? "");
      const parsed = parseMessageLink(href);
      if (!parsed.ok) {
        // Malformed link: render the raw URL rather than a misleading pill.
        return <span data-message-link="">{href}</span>;
      }
      return (
        <MessageLinkPill
          channels={channels}
          interactive={interactive}
          link={parsed.value}
          onOpenChannel={onOpenChannel}
          onOpenMessageLink={onOpenMessageLink}
          resolveChannelReference={runtime.resolveChannelReferences}
        />
      );
    },
  } as Components;
}

/**
 * The component map only varies by the four boolean render flags, so at most
 * sixteen instances ever exist. Module-stable maps mean cached markdown
 * element trees (see ./markdown/nodeCache.ts) never embed per-mount closures.
 */
const MARKDOWN_COMPONENT_SCHEMA_VERSION = "8";
const markdownComponentsByVariant = new Map<string, MarkdownComponentSet>();

type MarkdownComponentSet = { components: Components; variant: string };

/**
 * Returns the component map together with the `variant` token that fully
 * identifies it. The token doubles as the variant segment of the parse-cache
 * key (see nodeCache.ts), so the map partitioning and the key partitioning
 * come from one place and cannot drift apart: a new render flag added here
 * automatically partitions the cache too.
 */
function getMarkdownComponents(
  interactive: boolean,
  leadingInlineContent: boolean,
  mediaInset: boolean,
  blockCode: boolean,
): MarkdownComponentSet {
  const variant = `${MARKDOWN_COMPONENT_SCHEMA_VERSION}:${interactive ? "i" : ""}${leadingInlineContent ? "l" : ""}${mediaInset ? "m" : ""}${blockCode ? "c" : ""}`;
  let entry = markdownComponentsByVariant.get(variant);
  if (!entry) {
    entry = {
      components: createMarkdownComponents(interactive, mediaInset, blockCode),
      variant,
    };
    markdownComponentsByVariant.set(variant, entry);
  }
  return entry;
}

function MarkdownInner({
  channelNames,
  className,
  content,
  hardLineBreaks = true,
  imetaByUrl,
  interactive = true,
  blockCode = false,
  leadingInlineContent,
  mediaInset = false,
  messageId,
  linkPreviewsSuppressed = false,
  linkPreviewTags,
  mentionNames,
  mentionPubkeysByName,
  searchQuery,
  videoReviewContext,
}: MarkdownProps) {
  const { channels: rawChannels } = useChannelNavigation();
  const channels = useStableArray(rawChannels);
  const { goChannel } = useAppNavigation();
  const onOpenChannel = React.useCallback(
    (channelId: string) => {
      void goChannel(channelId);
    },
    [goChannel],
  );
  const onOpenMessageLink = React.useCallback(
    (link: ParsedMessageLink) => {
      // Always route through `goChannel` with `messageId` set: the navigation
      // boundary guards every message-targeting caller before URL mutation.
      // `useAnchoredScroll` + `getEventById` backfill, and works for
      void goChannel(link.channelId, {
        messageId: link.messageId,
        threadRootId: link.threadRootId,
      });
    },
    [goChannel],
  );
  const relayOrigin = useRelayOrigin();
  const resolvedLinkPreviews = useMessageLinkPreviews({
    content,
    interactive,
    linkPreviewTags,
    linkPreviewsSuppressed,
    relayOrigin,
  });
  const runtime = React.useMemo<MarkdownRuntime>(
    () => ({
      channels,
      imetaByUrl,
      leadingInlineContent,
      mentionPubkeysByName,
      onOpenChannel,
      onOpenMessageLink,
      relayOrigin,
      resolveChannelReferences: true,
    }),
    [
      channels,
      imetaByUrl,
      leadingInlineContent,
      mentionPubkeysByName,
      onOpenChannel,
      onOpenMessageLink,
      relayOrigin,
    ],
  );

  let processedContent = content;

  if (/^(?:\s{2}\n)+/.test(processedContent)) {
    processedContent = `\u200B${processedContent}`;
  }

  if (/(?:\s{2}\n)+$/.test(processedContent)) {
    processedContent = `${processedContent}\u200B`;
  }

  const hasLeadingInlineContent = leadingInlineContent != null;
  const componentSet = getMarkdownComponents(
    interactive,
    hasLeadingInlineContent,
    mediaInset,
    blockCode,
  );
  const markdownNode = renderCachedMarkdown({
    channelNames,
    customEmoji: customEmojiFromTags(linkPreviewTags ?? []),
    components: componentSet.components,
    content: processedContent,
    hardLineBreaks,
    leadingInlineContent: hasLeadingInlineContent,
    mentionNames,
    searchQuery,
    variant: componentSet.variant,
  });

  return (
    <MessageBody className={cn(MESSAGE_BODY_CLASS_NAME, className)}>
      <MarkdownRuntimeContext.Provider value={runtime}>
        <VideoReviewMarkdownContext.Provider value={videoReviewContext}>
          {markdownNode}
          <LinkPreviewList
            ImageLightbox={LinkPreviewImageLightbox}
            key={messageId}
            previews={resolvedLinkPreviews}
          />
        </VideoReviewMarkdownContext.Provider>
      </MarkdownRuntimeContext.Provider>
    </MessageBody>
  );
}

export const Markdown = React.memo(
  MarkdownInner,
  (prev, next) =>
    markdownPropsAreEqual(prev, next) &&
    prev.leadingInlineContent === next.leadingInlineContent,
);
Markdown.displayName = "Markdown";
export { SyntaxHighlightedCode } from "./markdown/CodeBlock";
