// Original Buzz 779af8886caae1317b4de962082429867ab61503 GIF draft media.
import type { WebGifItem } from "@client-kit/contracts";
import type { ImetaMedia } from "../composer/features/messages/lib/imetaMediaMarkdown";

/** Original `klipyGifFilename`. */
export function klipyGifFilename(slug: string): string {
  const safeSlug = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safeSlug || "klipy-gif"}.gif`;
}

/**
 * Original `klipyGifAttachment`: externally hosted media. The empty hash keeps it out of imeta
 * (`buildImetaTags` drops hash-less entries); `buildOutgoingMessage` appends `![image](url)`.
 */
export function gifAttachment(gif: WebGifItem): ImetaMedia {
  return {
    dim: `${gif.width}x${gif.height}`,
    displayLabel: gif.title,
    filename: klipyGifFilename(gif.slug),
    sha256: "",
    size: gif.size,
    type: "image/gif",
    uploaded: 0,
    url: gif.url,
  };
}

/** Only the original hash-less GIF marker is content media. A hash-backed GIF
 * stays a confirmed file, even when it happens to have the same URL. */
export function splitDraftGifMedia(media: readonly ImetaMedia[]): { gifs: WebGifItem[]; attachments: ImetaMedia[] } {
  const gifs: WebGifItem[] = [];
  const attachments: ImetaMedia[] = [];
  for (const item of media) {
    if (item.sha256 !== "" || item.type !== "image/gif") { attachments.push(item); continue; }
    const [width = 0, height = 0] = (item.dim ?? "").split("x").map(value => Number(value) || 0);
    gifs.push({slug: (item.filename ?? "").replace(/\.gif$/i, ""), title: item.displayLabel ?? item.filename ?? "GIF",
      url: item.url, size: item.size, width, height,
      // The original persisted draft contains the original image, not the
      // provider search response. Restoring never re-reports a share or reads a provider.
      previewUrl: item.url, previewWidth: width, previewHeight: height});
  }
  return {gifs, attachments};
}
