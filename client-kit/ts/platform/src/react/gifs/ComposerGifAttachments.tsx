// Shared original Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/gifs/api.ts::klipyGifAttachment and
// desktop/src/features/messages/lib/imetaMediaMarkdown.ts::buildOutgoingMessage: a chosen GIF
// is a pending, hash-less attachment chip; on send its original URL is appended to the body
// as `![image](url)` with no imeta (the Relay only vouches for local media).
import { X } from "lucide-react";
import type { WebGIFItem } from "@client-kit/contracts";

import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { Attachment, AttachmentGroup, AttachmentMedia } from "../composer/shared/ui/attachment";

/** The original outgoing body lines for the chosen GIFs, after the authored text. */
export function withGifLines(content: string, gifs: readonly Pick<WebGIFItem, "url">[]): string {
  return [content, ...gifs.map((gif) => `![image](${gif.url})`)].filter((part) => part.length > 0).join("\n");
}

export function ComposerGifAttachments({ gifs, onRemove }: {
  gifs: readonly WebGIFItem[];
  onRemove: (gif: WebGIFItem) => void;
}) {
  const t = useUiT();
  if (gifs.length === 0) return null;
  return (
    <AttachmentGroup className="mb-2 flex-row flex-wrap items-start" data-composer-gifs="">
      {gifs.map((gif, index) => (
        <div className="group/gif relative" data-testid="composer-gif-attachment" key={`${index}:${gif.slug}`}>
          <Attachment className="h-20 w-auto overflow-hidden p-0 shadow-none">
            <AttachmentMedia className="h-20 w-auto rounded-2xl border-0 bg-muted" variant="image">
              <img alt={gif.title} className="h-full w-auto object-cover" src={gif.previewUrl} />
            </AttachmentMedia>
          </Attachment>
          <Button
            aria-label={t("gif.remove", { title: gif.title })}
            className="absolute -right-1 -top-1 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-foreground p-0 text-background shadow-none hover:bg-foreground [&_svg]:size-2.5"
            onClick={() => onRemove(gif)}
            size="icon-xs"
            title={t("gif.remove", { title: gif.title })}
            type="button"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ))}
    </AttachmentGroup>
  );
}
