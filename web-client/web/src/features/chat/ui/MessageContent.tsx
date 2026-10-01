// 平台：媒体改经 BFF 读取（DD-39、SS-WEB-RELAY）。
//
// 上游用 NIP-98 签名直接向 Relay 取图，Browser 现在没有 signer，也不认识 Relay。
// 这里按消息的 NIP-92 imeta 把正文里的媒体地址对应到 sha256，再从 BFF 取：
// 同源、凭网关 cookie，不需要 object URL。正文里没有 imeta 背书的媒体地址
// 一律当普通链接——不拿任意外部地址当图片加载（CSP 也不允许）。
import { Bot, Download, ImageOff } from "lucide-react";
import { createContext, useContext, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMentions from "@/features/chat/lib/remark-mentions";
import { mediaUrl } from "@/platform/bff-client";
import { t } from "@/shared/i18n";

const IMAGE_MAX_WIDTH = 384;
const IMAGE_MAX_HEIGHT = 256;
const DEFAULT_IMAGE_DIMENSIONS = { width: IMAGE_MAX_WIDTH, height: IMAGE_MAX_HEIGHT };

type ImageDimensions = { width: number; height: number };

export type MessageMention = {
  pubkey: string;
  name: string;
  isAgent: boolean;
};

/** 一份由 imeta 背书的媒体：只有它能被当成媒体渲染。 */
type ImetaMedia = { sha256: string; mime: string; dimensions: ImageDimensions | null };

type MarkdownRenderContextValue = {
  mediaByUrl: ReadonlyMap<string, ImetaMedia>;
  mentionsByName: ReadonlyMap<string, MessageMention>;
  workspaceId: string;
};

const MarkdownRenderContext = createContext<MarkdownRenderContextValue | null>(null);

function useMarkdownRenderContext(): MarkdownRenderContextValue {
  const context = useContext(MarkdownRenderContext);
  if (!context) throw new Error("Message markdown rendered without its context");
  return context;
}

function dimensionsFromDim(value: string | undefined): ImageDimensions | null {
  const match = value?.match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
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
      dimensions: dimensionsFromDim(field("dim")),
    });
  }
  return media;
}

function BffMedia({
  media,
  alt,
  workspaceId,
}: {
  media: ImetaMedia;
  alt?: string;
  workspaceId: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = mediaUrl(workspaceId, media.sha256);
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
  const { mediaByUrl, workspaceId } = useMarkdownRenderContext();
  const media = src ? mediaByUrl.get(src) : undefined;
  // 没有 imeta 背书的图片地址不加载：退回成一条普通链接
  if (!media) {
    return (
      <a href={src} target="_blank" rel="noreferrer noopener">
        {alt || src}
      </a>
    );
  }
  return <BffMedia media={media} alt={alt} workspaceId={workspaceId} />;
};

const MarkdownLink: NonNullable<Components["a"]> = ({ href, children }) => {
  const { mediaByUrl, workspaceId } = useMarkdownRenderContext();
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
    <a href={mediaUrl(workspaceId, media.sha256)} download={String(children) || "attachment"}>
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
  return (
    <span
      className="buzz-message-mention"
      data-mention=""
      data-mention-agent={mention.isAgent || undefined}
      data-mention-pubkey={mention.pubkey}
    >
      {mention.isAgent ? (
        <Bot aria-hidden="true" className="buzz-message-mention-icon" />
      ) : (
        <span className="buzz-message-mention-prefix">@</span>
      )}
      {label}
    </span>
  );
}

const MARKDOWN_COMPONENTS = {
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
  mentions = [],
  mediaTags,
}: {
  content: string;
  workspaceId: string;
  mentions?: readonly MessageMention[];
  mediaTags?: readonly (readonly string[])[];
}) {
  const mentionsByName = new Map(
    mentions.map((mention) => [mention.name.trim().toLocaleLowerCase(), mention]),
  );
  const mentionNames = [...mentionsByName.values()].map((mention) => mention.name);
  const mediaByUrl = imetaMedia(mediaTags);

  return (
    <MarkdownRenderContext.Provider value={{ mediaByUrl, mentionsByName, workspaceId }}>
      <div className="buzz-message-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks, [remarkMentions, { mentionNames }]]}
          components={MARKDOWN_COMPONENTS}
        >
          {displayContent(content)}
        </ReactMarkdown>
      </div>
    </MarkdownRenderContext.Provider>
  );
}
