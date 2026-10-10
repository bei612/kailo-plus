// 平台：媒体改经 BFF 读取（DD-39、SS-WEB-RELAY）。
//
// 上游用 NIP-98 签名直接向 Relay 取图，Browser 现在没有 signer，也不认识 Relay。
// 这里按消息的 NIP-92 imeta 把正文里的媒体地址对应到 sha256，再从 BFF 取：
// 同源、凭网关 cookie，不需要 object URL。正文里没有 imeta 背书的媒体地址
// 一律当普通链接——不拿任意外部地址当图片加载（CSP 也不允许）。
import {
  dimensionsFromDim,
  MESSAGE_BODY_CLASS_NAME,
  MESSAGE_BODY_COMPONENTS,
  MessageBody,
  PlainCodeBlock,
  SyntaxHighlightedCode,
  extractLanguage,
  getReactNodeText,
} from "@client-kit/platform/react/message-body";
import {
  resolveShikiThemeName,
} from "@client-kit/platform/theme/theme-loader";
import { ImageOff } from "lucide-react";
import { FileCard } from "@client-kit/platform/react/messages";
import { resolveFileCard } from "@client-kit/platform/react/messages/resolveFileCard";
import { ImageBlock, ImageMosaic, ImageZoomOverlay, createLinkPreviewImageLightbox, type ImageActions } from "@client-kit/platform/react/image-lightbox";
import { Children, isValidElement } from "react";
import { classifyChildren, hasBlockMedia, isImageOnlyParagraph } from "@client-kit/platform/react/composer/shared/ui/markdownMedia";
import { toast } from "sonner";
import { MarkdownMentionChip } from "@client-kit/platform/react/messages/MarkdownMentionChip";
import { resolveMentionProps } from "@client-kit/platform/react/messages/resolveMentionNames";
import { type ComponentProps, type ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import { parseMessageLink, type ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkSpoilers from "@client-kit/platform/react/composer/shared/lib/remarkSpoilers";
import { SpoilerInline } from "@client-kit/platform/react/composer/shared/ui/markdown/SpoilerInline";
import remarkMentions from "@/features/chat/lib/remark-mentions";
import { mediaUrl } from "@/platform/bff-client";
import { t } from "@/shared/i18n";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { LinkPreviewAttachmentPresentation, parseLinkPreviewSnapshots, mergeMessageLinkPreviews, extractSupportedLinkPreviews, useLinkPreviewStyle } from "@client-kit/platform/react/link-preview";
import { AttachmentGroup } from "@client-kit/platform/react/composer/shared/ui/attachment";
import { customEmojiFromTags, remarkCustomEmoji, InlineEmojiPopover } from "@client-kit/platform/react/custom-emoji";
import {
  isAudioAttachment,
  isVoiceNoteAttachment,
  resolveAudioAttachment,
} from "@client-kit/platform/react/composer/features/messages/lib/audioAttachment";
import { BffAudioAttachment } from "./BffAudioAttachment";
import { BffVideoPlayer, useBffVideoReview } from "./BffVideoReview";
import { BffMessageLinkPill, BffAuthoredDeepLinkAnchor, BffChannelDeepLinkAnchor, BffMarkdownChannelDeepLink, BffMarkdownChannelReference, useBffChannelLinkRuntime } from "./BffMessageLinkHost";
import { remarkChannelLinks, remarkChannelDeepLinks, remarkMessageLinks } from "@client-kit/platform/react/messages/channel-link";
import { parseChannelLink } from "@client-kit/platform/react/composer/features/messages/lib/channelLink";
import { useVideoReviewCommentContent, type VideoReviewContext } from "@client-kit/platform/react/video-review";
import rehypeLeadingInlineContent from "@client-kit/platform/react/video-review/rehypeLeadingInlineContent";
import { isVideoMedia } from "@client-kit/platform/react/video-review/mediaEntry";
import rehypeSearchHighlight from "@client-kit/platform/react/search/rehypeSearchHighlight";

const IMAGE_MAX_WIDTH = 384;
const IMAGE_MAX_HEIGHT = 256;

type ImageDimensions = { width: number; height: number };

export type MessageMention = {
  pubkey: string;
  name: string;
  isAgent: boolean;
  renderProfile?: (children: ReactNode) => ReactNode;
};

/** 一份由 imeta 背书的媒体：只有它能被当成媒体渲染。 */
type ImetaMedia = {
  originalUrl: string;
  sha256: string;
  mime: string;
  dimensions: ImageDimensions | null;
  filename?: string;
  duration?: number;
  size?: number;
  posterRef?: string;
};

type MarkdownRenderContextValue = {
  mediaByUrl: ReadonlyMap<string, ImetaMedia>;
  mentionsByName: ReadonlyMap<string, MessageMention>;
  resolveMediaUrl: (sha256: string) => string;
  admittedSources: ReadonlySet<string>;
  reviewContext?: VideoReviewContext;
  leadingInlineContent?: ReactNode;
  conversationId?: string;
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
};

const MarkdownRenderContext = createContext<MarkdownRenderContextValue | null>(null);

function useMarkdownRenderContext(): MarkdownRenderContextValue {
  const context = useContext(MarkdownRenderContext);
  if (!context) throw new Error("Message markdown rendered without its context");
  return context;
}

/** url → imeta。没有 `x`（sha256）的条目不算：BFF 只按 hash 取媒体。 */
function imetaMedia(mediaTags: readonly (readonly string[])[] | undefined) {
  const media = new Map<string, ImetaMedia>();
  for (const tag of mediaTags ?? []) {
    if (tag[0] !== "imeta") continue;
    const field = (name: string) =>
      tag.find((part) => part.startsWith(`${name} `))?.slice(name.length + 1);
    const url = field("url");
    const sha256 = field("x");
    if (!url || !sha256 || !/^[0-9a-f]{64}$/i.test(sha256)) continue;
    const numericField = (name: string) => {
      const value = field(name);
      if (value == null || !value.trim()) return undefined;
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : undefined;
    };
    // Original NIP-71 image / legacy thumb, resolved only as an admitted local
    // content reference. Never load a sender-authored poster origin.
    let posterRef: string | undefined;
    const poster = field("image") || field("thumb");
    if (poster) {
      try {
        const parsed = new URL(poster);
        if (["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
          const original = /^\/media\/([a-f0-9]{64})\.(?:jpg|png|gif|webp)$/i.exec(parsed.pathname);
          if (field("image") && original) posterRef = original[1].toLowerCase();
          else if (!field("image") && parsed.pathname === `/media/${sha256.toLowerCase()}.thumb.jpg`) posterRef = `${sha256.toLowerCase()}.thumb.jpg`;
        }
      } catch { /* Invalid poster metadata never falls back to external media. */ }
    }
    media.set(url, {
      originalUrl: url,
      sha256: sha256.toLowerCase(),
      mime: field("m") ?? "",
      dimensions: dimensionsFromDim(field("dim")) ?? null,
      filename: field("filename"),
      duration: numericField("duration"),
      size: numericField("size"),
      posterRef,
    });
  }
  return media;
}

function useBffImageActions(admittedSources: ReadonlySet<string>, alt?: string): ImageActions {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const copyImageToClipboard = async (imageSrc: string | undefined) => {
    if (!imageSrc || !admittedSources.has(imageSrc)) return;
    try {
      // Gallery entries originate only from this authorized BFF render context.
      // Refetch under the current user before exposing bytes to the clipboard.
      const response = await fetch(imageSrc, { credentials: "same-origin", redirect: "error" });
      if (!response.ok) throw new Error("Image read rejected");
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("Image content type missing");
      if (!active.current) return;
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      if (active.current) toast.success(t("platform.profile.copied"));
    } catch {
      if (active.current) toast.error(t("buzz.copyFailed"));
    }
  };
  const downloadImage = (imageSrc: string | undefined) => {
    if (!imageSrc || !admittedSources.has(imageSrc)) return;
    // The browser's existing authenticated download, never Desktop IPC or an
    // imeta URL's remote origin. The BFF rechecks current media read permission.
    const anchor = document.createElement("a");
    anchor.href = imageSrc;
    anchor.download = alt || t("message.attachmentImage");
    anchor.click();
  };
  return { copyImageToClipboard, downloadImage };
}

function BffLinkPreviewOverlay(
  props: Omit<ComponentProps<typeof ImageZoomOverlay>, keyof ImageActions>,
) {
  const { admittedSources } = useMarkdownRenderContext();
  const actions = useBffImageActions(admittedSources, props.alt);
  return <ImageZoomOverlay {...props} {...actions} />;
}

const BffLinkPreviewImageLightbox = createLinkPreviewImageLightbox(BffLinkPreviewOverlay);

function BffMedia({
  media,
  alt,
  resolveMediaUrl,
  admittedSources,
}: {
  media: ImetaMedia;
  alt?: string;
  resolveMediaUrl: (sha256: string) => string;
  admittedSources: ReadonlySet<string>;
}) {
  const [failed, setFailed] = useState(false);
  const { reviewContext } = useMarkdownRenderContext();
  const src = resolveMediaUrl(media.sha256);
  const { copyImageToClipboard, downloadImage } = useBffImageActions(admittedSources, alt);
  const dimensions = media.dimensions;
  const scale = dimensions
    ? Math.min(1, IMAGE_MAX_WIDTH / dimensions.width, IMAGE_MAX_HEIGHT / dimensions.height)
    : 1;
  const frameStyle = dimensions
    ? {
        aspectRatio: `${dimensions.width} / ${dimensions.height}`,
        width: `min(100%, ${Math.max(1, Math.round(dimensions.width * scale))}px)`,
      }
    : { height: `${IMAGE_MAX_HEIGHT}px`, width: `min(100%, ${IMAGE_MAX_WIDTH}px)` };

  if (isVideoMedia(media.originalUrl, media.mime)) {
    return <BffVideoPlayer src={src} downloadUrl={admittedSources.has(src) ? src : undefined}
      poster={media.posterRef ? resolveMediaUrl(media.posterRef) : undefined}
      filename={media.filename} aspectRatio={dimensions ? dimensions.width / dimensions.height : undefined}
      durationSeconds={media.duration} reviewKey={`${reviewContext?.rootEventId ?? ""}:${src}`}
      reviewContext={reviewContext ? {...reviewContext, title: reviewContext.title ?? media.filename ?? alt ?? t("video.title")} : undefined} />;
  }

  if (!failed) {
    return <ImageBlock alt={alt || t("message.attachmentImage")}
      copyImageToClipboard={copyImageToClipboard}
      dim={dimensions ? `${dimensions.width}x${dimensions.height}` : undefined}
      downloadImage={downloadImage}
      onError={() => setFailed(true)}
      resolvedSrc={src} src={src} />;
  }

  return (
    <span
      className="relative inline-flex max-w-full items-center justify-center overflow-hidden rounded-md bg-foreground/5 align-top"
      data-protected-image-frame="true"
      style={frameStyle}
    >
      {failed ? (
        <span className="inline-flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <ImageOff className="h-4 w-4" /> {t("message.imageFailed")}
        </span>
      ) : null}
    </span>
  );
}

const MarkdownImage: NonNullable<Components["img"]> = ({ src, alt }) => {
  const { mediaByUrl, resolveMediaUrl, admittedSources } = useMarkdownRenderContext();
  const media = src ? mediaByUrl.get(src) : undefined;
  // 没有 imeta 背书的图片地址不加载：退回成一条普通链接
  if (!media) {
    return (
      <a href={src} target="_blank" rel="noreferrer noopener">
        {alt || src}
      </a>
    );
  }
  return <span data-block-media="" className="block min-w-0 max-w-full">
    <BffMedia key={resolveMediaUrl(media.sha256)} media={media} alt={alt} resolveMediaUrl={resolveMediaUrl}
      admittedSources={admittedSources} />
  </span>;
};

function MarkdownEmoji({ src, alt }: { src?: string; alt?: string }) {
  const { resolveMediaUrl } = useMarkdownRenderContext();
  // A signed NIP-30 URL can identify a content-addressed community blob; it
  // never grants browser access to its origin. The existing BFF media route
  // rechecks this conversation/workspace and signs only /media/<hash>.
  let hash: string | undefined;
  try {
    const url = new URL(src ?? "");
    if (url.protocol === "http:" || url.protocol === "https:") {
      hash = /^\/media\/([a-f0-9]{64})(?:\.[a-z0-9]+)?$/i.exec(url.pathname)?.[1];
    }
  } catch { /* Non-media emoji stays text; no external image fetch. */ }
  return hash ? <InlineEmojiPopover alt={alt} resolvedSrc={resolveMediaUrl(hash.toLowerCase())} /> : <span>{alt}</span>;
}

const MarkdownLink: NonNullable<Components["a"]> = ({ href, children }) => {
  const { mediaByUrl, resolveMediaUrl } = useMarkdownRenderContext();
  const messageLink = href ? parseMessageLink(href) : null;
  if (messageLink?.ok) {
    if (getReactNodeText(children) !== href) {
      return <BffAuthoredDeepLinkAnchor channelId={messageLink.value.channelId} href={href!} interactive messageLink={messageLink.value}>{children}</BffAuthoredDeepLinkAnchor>;
    }
    return <BffMessageLinkPill href={href} link={messageLink.value} />;
  }
  if (href && parseChannelLink(href).ok) {
    return <BffChannelDeepLinkAnchor href={href} interactive>{children}</BffChannelDeepLinkAnchor>;
  }
  const media = href ? mediaByUrl.get(href) : undefined;
  if (!media) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  }
  const entry = {
    m: media.mime,
    filename: media.filename,
    duration: media.duration,
    size: media.size,
  };
  const attachment = resolveAudioAttachment(entry, resolveMediaUrl(media.sha256), String(children));
  if (attachment) {
    return (
      <BffAudioAttachment
        {...attachment}
        mimeType={media.mime}
        downloadUrl={isVoiceNoteAttachment(entry) ? undefined : attachment.href}
      />
    );
  }
  const card = resolveFileCard(entry, href, getReactNodeText(children));
  if (card) {
    return <FileCard {...card} href={resolveMediaUrl(media.sha256)}
      onDownload={async (url, filename) => {
        // Only this authorized BFF context supplies the download URL. Never
        // navigate to the sender's imeta origin or expose Desktop IPC.
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
      }} />;
  }
  return <a href={resolveMediaUrl(media.sha256)} download={String(children) || "attachment"}>{children}</a>;
};

function MarkdownMessageLink({ children }: { children?: ReactNode }) {
  const href = String(children ?? "");
  const link = parseMessageLink(href);
  return link.ok ? <BffMessageLinkPill href={href} link={link.value} /> : <span data-message-link="">{href}</span>;
}

function MarkdownMention({ children }: { children?: React.ReactNode }) {
  const { mentionsByName } = useMarkdownRenderContext();
  const text = String(children ?? "");
  const label = text.replace(/^@/, "");
  const mention = mentionsByName.get(label.trim().toLocaleLowerCase());
  if (!mention) return <>{children}</>;
  const node = <MarkdownMentionChip label={label} pubkey={mention.pubkey} isAgent={mention.isAgent}
    interactive={Boolean(mention.renderProfile)} />;
  return mention.renderProfile ? mention.renderProfile(node) : node;
}

function ThemedCodeBlock({ code, language, ...props }: {
  code: string;
  language: string;
} & ComponentProps<"code">) {
  const { themeName } = useTheme();
  return (
    <SyntaxHighlightedCode
      {...props}
      code={code}
      language={language}
      shikiTheme={resolveShikiThemeName(themeName)}
    />
  );
}

function MarkdownCode({ children, className, node: _node, ...props }: ComponentProps<"code"> & { node?: unknown }) {
  const rawCode = String(children);
  const code = rawCode.replace(/\n$/, "");
  const isFencedCodeBlock =
    typeof className === "string" && className.includes("language-");
  if (isFencedCodeBlock || rawCode.endsWith("\n") || code.includes("\n")) {
    const language = extractLanguage(className);
    return language
      ? <ThemedCodeBlock {...props} code={code} language={language} />
      : <PlainCodeBlock {...props} code={code} />;
  }
  return <code {...props} className={className}>{children}</code>;
}

const MARKDOWN_COMPONENTS = {
  ...MESSAGE_BODY_COMPONENTS,
  p: function MarkdownParagraph({ children }) {
    // Original Buzz MarkdownParagraph: media wrappers and block spoilers must
    // not sit inside a paragraph. Multiple standalone images use its mosaic.
    const childArray = Children.toArray(children);
    const { mediaByUrl } = useMarkdownRenderContext();
    // Original MarkdownParagraph audio guard: the complete attachment card
    // contains block elements and cannot be nested in a Markdown paragraph.
    const hasAudio = childArray.some((child) => {
      if (!isValidElement<{ href?: string }>(child) || typeof child.props.href !== "string") {
        return false;
      }
      const media = child.props.href ? mediaByUrl.get(child.props.href) : undefined;
      return media ? isAudioAttachment({ m: media.mime, filename: media.filename }) : false;
    });
    const { imageChildren } = classifyChildren(childArray);
    if (isImageOnlyParagraph(childArray)) {
      return <ImageMosaic>{imageChildren}</ImageMosaic>;
    }
    if (hasBlockMedia(childArray) || hasAudio) return <div>{children}</div>;
    return <p>{children}</p>;
  },
  code: MarkdownCode,
  img: MarkdownImage,
  a: MarkdownLink,
  mention: MarkdownMention,
  span: function MarkdownSpan({children, node: _node, ...props}) {
    const { leadingInlineContent } = useMarkdownRenderContext();
    return "data-leading-inline-content" in props ? <>{leadingInlineContent}</> : <span {...props}>{children}</span>;
  },
} as Components;

function displayContent(content: string): string {
  if (!content.trim().startsWith("{")) return content;
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    const text = value.message ?? value.text ?? value.action;
    return typeof text === "string" ? text : content;
  } catch {
    return content;
  }
}

export function MessageContent({
  content,
  messageId,
  workspaceId,
  conversationId,
  onMediaUrl,
  mentions = [],
  mediaTags,
  onOpenMessageLink,
  searchQuery,
}: {
  content: string;
  messageId?: string;
  workspaceId?: string;
  conversationId?: string;
  onMediaUrl?: (sha256: string) => string;
  mentions?: readonly MessageMention[];
  mediaTags?: readonly (readonly string[])[];
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
  searchQuery?: string;
}) {
  const {reviewContext, videoReviewCommentRootId} = useBffVideoReview(messageId);
  const channelRuntime = useBffChannelLinkRuntime();
  const channelNames = channelRuntime.channels.filter(channel => channel.channelType !== "dm").map(channel => channel.name);
  const reviewComment = useVideoReviewCommentContent({content, videoReviewCommentRootId});
  const mentionsByPubkey = new Map(mentions.map(mention => [mention.pubkey.toLowerCase(), mention]));
  const { mentionNames, mentionPubkeysByName } = resolveMentionProps(
    mediaTags?.map(tag => [...tag]),
    Object.fromEntries(mentions.map(mention => [mention.pubkey.toLowerCase(), {
      displayName: mention.name, avatarUrl: null, nip05Handle: null, ownerPubkey: null,
    }])),
    content,
  );
  const mentionsByName = new Map(Object.entries(mentionPubkeysByName ?? {}).flatMap(([name, pubkey]) => {
    const mention = mentionsByPubkey.get(pubkey);
    return mention ? [[name, mention] as const] : [];
  }));
  const mediaByUrl = imetaMedia(mediaTags);
  const previewStyle = useLinkPreviewStyle();
  const resolveMediaUrl = onMediaUrl ?? ((sha256: string) => {
    if (!workspaceId && !conversationId) throw new Error("Message media scope missing");
    return mediaUrl(workspaceId ?? conversationId!, sha256, conversationId);
  });
  // Relay validates sender-authored snapshot URL/hash pairs at ingestion. Only
  // the hash reaches our existing BFF media route, which rechecks the current
  // actor/scope and reads this community's sidecar. Never fetch the tag's URL.
  const previews = mediaTags?.some((tag) => tag.length === 2 && tag[0] === "link-preview" && tag[1] === "none")
    ? [] : mergeMessageLinkPreviews(extractSupportedLinkPreviews(content),
      parseLinkPreviewSnapshots(mediaTags, content, workspaceId || conversationId || onMediaUrl ? resolveMediaUrl : null));
  const admittedSources = new Set([
    ...[...mediaByUrl.values()].map(entry => resolveMediaUrl(entry.sha256)),
    ...previews.flatMap(preview => preview.imageDataUrl ? [preview.imageDataUrl] : []),
  ]);
  const rehypePlugins: ComponentProps<typeof ReactMarkdown>["rehypePlugins"] = [];
  if (reviewComment.leadingInlineContent != null) rehypePlugins.push(rehypeLeadingInlineContent);
  if (searchQuery && searchQuery.trim().length >= 1) rehypePlugins.push([rehypeSearchHighlight, {query: searchQuery}]);

  return (
    <MarkdownRenderContext.Provider key={`${workspaceId ?? ""}:${conversationId ?? ""}`} value={{ mediaByUrl, mentionsByName, resolveMediaUrl, admittedSources, onOpenMessageLink, reviewContext, leadingInlineContent: reviewComment.leadingInlineContent }}>
      <MessageBody className={MESSAGE_BODY_CLASS_NAME}>
        <ReactMarkdown
          urlTransform={(url) => parseMessageLink(url).ok || parseChannelLink(url).ok ? url : defaultUrlTransform(url)}
          remarkPlugins={[remarkGfm, remarkBreaks, remarkChannelDeepLinks, remarkMessageLinks, [remarkChannelLinks, { channelNames }], remarkSpoilers, [remarkMentions, { mentionNames }], [remarkCustomEmoji, {customEmoji: customEmojiFromTags(mediaTags ?? [])}]]}
          rehypePlugins={rehypePlugins}
          components={{ ...MARKDOWN_COMPONENTS,
            "channel-deep-link": ({ children }: { children?: ReactNode }) => <BffMarkdownChannelDeepLink interactive>{children}</BffMarkdownChannelDeepLink>,
            "channel-link": ({ children }: { children?: ReactNode }) => <BffMarkdownChannelReference interactive>{children}</BffMarkdownChannelReference>,
            "message-link": MarkdownMessageLink,
            emoji: MarkdownEmoji, spoiler: ({ children, ...props }: { children?: import("react").ReactNode; "data-block-spoiler"?: string }) =>
            <SpoilerInline block={props["data-block-spoiler"] != null}>{children}</SpoilerInline> } as Components}
        >
          {displayContent(reviewComment.content)}
        </ReactMarkdown>
      </MessageBody>
      {previews.length ? <AttachmentGroup data-link-preview-list=""
        className={previewStyle === "compact" ? "max-w-full flex-row flex-wrap items-start overflow-visible pb-0" : "max-w-full flex-col items-start overflow-visible pb-0"}>
        {previews.map((preview, index) => <LinkPreviewAttachmentPresentation key={preview.href} preview={preview} style={previewStyle} showControls={index === 0}
          ImageLightbox={BffLinkPreviewImageLightbox} />)}
      </AttachmentGroup> : null}
    </MarkdownRenderContext.Provider>
  );
}
