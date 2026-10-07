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
} from "@client-kit/platform/react/message-body";
import {
  resolveShikiThemeName,
} from "@client-kit/platform/theme/theme-loader";
import { Download, ImageOff } from "lucide-react";
import { MarkdownMentionChip } from "@client-kit/platform/react/messages/MarkdownMentionChip";
import { resolveMentionProps } from "@client-kit/platform/react/messages/resolveMentionNames";
import { type ComponentProps, type ReactNode, createContext, useContext, useState } from "react";
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
import { LinkPreviewAttachmentPresentation, parseLinkPreviewTextSnapshots, useLinkPreviewStyle } from "@client-kit/platform/react/link-preview";
import { AttachmentGroup } from "@client-kit/platform/react/composer/shared/ui/attachment";
import { customEmojiFromTags, remarkCustomEmoji, InlineEmojiPopover } from "@client-kit/platform/react/custom-emoji";

const IMAGE_MAX_WIDTH = 384;
const IMAGE_MAX_HEIGHT = 256;
const DEFAULT_IMAGE_DIMENSIONS = { width: IMAGE_MAX_WIDTH, height: IMAGE_MAX_HEIGHT };

type ImageDimensions = { width: number; height: number };

export type MessageMention = {
  pubkey: string;
  name: string;
  isAgent: boolean;
  renderProfile?: (children: ReactNode) => ReactNode;
};

/** 一份由 imeta 背书的媒体：只有它能被当成媒体渲染。 */
type ImetaMedia = { sha256: string; mime: string; dimensions: ImageDimensions | null };

type MarkdownRenderContextValue = {
  mediaByUrl: ReadonlyMap<string, ImetaMedia>;
  mentionsByName: ReadonlyMap<string, MessageMention>;
  resolveMediaUrl: (sha256: string) => string;
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
    media.set(url, {
      sha256: sha256.toLowerCase(),
      mime: field("m") ?? "",
      dimensions: dimensionsFromDim(field("dim")) ?? null,
    });
  }
  return media;
}

function BffMedia({
  media,
  alt,
  resolveMediaUrl,
}: {
  media: ImetaMedia;
  alt?: string;
  resolveMediaUrl: (sha256: string) => string;
}) {
  const [failed, setFailed] = useState(false);
  const src = resolveMediaUrl(media.sha256);
  const dimensions = media.dimensions;
  const intrinsic = dimensions ?? DEFAULT_IMAGE_DIMENSIONS;
  const scale = dimensions
    ? Math.min(1, IMAGE_MAX_WIDTH / dimensions.width, IMAGE_MAX_HEIGHT / dimensions.height)
    : 1;
  const frameStyle = dimensions
    ? {
        aspectRatio: `${dimensions.width} / ${dimensions.height}`,
        width: `min(100%, ${Math.max(1, Math.round(dimensions.width * scale))}px)`,
      }
    : { height: `${IMAGE_MAX_HEIGHT}px`, width: `min(100%, ${IMAGE_MAX_WIDTH}px)` };

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
      ) : media.mime.startsWith("video/") ? (
        // biome-ignore lint/a11y/useMediaCaption: 用户上传的视频没有字幕轨可供提供
        <video
          className="block h-full w-full object-contain"
          controls
          preload="metadata"
          src={src}
          onError={() => setFailed(true)}
        />
      ) : (
        <img
          alt={alt || t("message.attachmentImage")}
          className="block h-full w-full object-contain"
          decoding="async"
          height={intrinsic.height}
          loading="lazy"
          src={src}
          width={intrinsic.width}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

const MarkdownImage: NonNullable<Components["img"]> = ({ src, alt }) => {
  const { mediaByUrl, resolveMediaUrl } = useMarkdownRenderContext();
  const media = src ? mediaByUrl.get(src) : undefined;
  // 没有 imeta 背书的图片地址不加载：退回成一条普通链接
  if (!media) {
    return (
      <a href={src} target="_blank" rel="noreferrer noopener">
        {alt || src}
      </a>
    );
  }
  return <BffMedia media={media} alt={alt} resolveMediaUrl={resolveMediaUrl} />;
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
  const { mediaByUrl, resolveMediaUrl, onOpenMessageLink } = useMarkdownRenderContext();
  const messageLink = href ? parseMessageLink(href) : null;
  if (messageLink?.ok && onOpenMessageLink) {
    return <a href={href} onClick={(event) => { event.preventDefault(); onOpenMessageLink(messageLink.value); }}>{children}</a>;
  }
  const media = href ? mediaByUrl.get(href) : undefined;
  if (!media) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  }
  // 附件经 BFF 下载：同源，凭网关 cookie
  return (
    <a href={resolveMediaUrl(media.sha256)} download={String(children) || "attachment"}>
      <Download className="mr-1 inline h-3.5 w-3.5" />
      {children}
    </a>
  );
};

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
  code: MarkdownCode,
  img: MarkdownImage,
  a: MarkdownLink,
  mention: MarkdownMention,
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
  workspaceId,
  conversationId,
  onMediaUrl,
  mentions = [],
  mediaTags,
  onOpenMessageLink,
}: {
  content: string;
  workspaceId?: string;
  conversationId?: string;
  onMediaUrl?: (sha256: string) => string;
  mentions?: readonly MessageMention[];
  mediaTags?: readonly (readonly string[])[];
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
}) {
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
  const previews = mediaTags?.some((tag) => tag.length === 2 && tag[0] === "link-preview" && tag[1] === "none")
    ? [] : parseLinkPreviewTextSnapshots(mediaTags, content);
  const resolveMediaUrl = onMediaUrl ?? ((sha256: string) => {
    if (!workspaceId && !conversationId) throw new Error("Message media scope missing");
    return mediaUrl(workspaceId ?? conversationId!, sha256, conversationId);
  });

  return (
    <MarkdownRenderContext.Provider value={{ mediaByUrl, mentionsByName, resolveMediaUrl, onOpenMessageLink }}>
      <MessageBody className={MESSAGE_BODY_CLASS_NAME}>
        <ReactMarkdown
          urlTransform={(url) => parseMessageLink(url).ok ? url : defaultUrlTransform(url)}
          remarkPlugins={[remarkGfm, remarkBreaks, remarkSpoilers, [remarkMentions, { mentionNames }], [remarkCustomEmoji, {customEmoji: customEmojiFromTags(mediaTags ?? [])}]]}
          components={{ ...MARKDOWN_COMPONENTS, emoji: MarkdownEmoji, spoiler: ({ children, ...props }: { children?: import("react").ReactNode; "data-block-spoiler"?: string }) =>
            <SpoilerInline block={props["data-block-spoiler"] != null}>{children}</SpoilerInline> } as Components}
        >
          {displayContent(content)}
        </ReactMarkdown>
      </MessageBody>
      {previews.length ? <AttachmentGroup data-link-preview-list=""
        className={previewStyle === "compact" ? "max-w-full flex-row flex-wrap items-start overflow-visible pb-0" : "max-w-full flex-col items-start overflow-visible pb-0"}>
        {previews.map((preview, index) => <LinkPreviewAttachmentPresentation key={preview.href} preview={preview} style={previewStyle} showControls={index === 0} />)}
      </AttachmentGroup> : null}
    </MarkdownRenderContext.Provider>
  );
}
