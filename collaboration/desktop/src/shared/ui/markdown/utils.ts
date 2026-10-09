import * as React from "react";
import { dimensionsFromDim } from "@client-kit/platform/react/message-body";
import { defaultUrlTransform } from "react-markdown";

import { isChannelLink } from "@/features/messages/lib/channelLink";
import { isMessageLink } from "@/features/messages/lib/messageLink";

export { dimensionsFromDim };

export function useStableArray<T>(arr: T[]): T[] {
  const ref = React.useRef(arr);
  if (
    arr.length !== ref.current.length ||
    arr.some((item, i) => item !== ref.current[i])
  ) {
    ref.current = arr;
  }
  return ref.current;
}

export function aspectRatioFromDim(dim?: string): number | undefined {
  if (!dim) return undefined;
  const match = dim.match(/^(\d+)x(\d+)$/i);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return undefined;
  }
  return width / height;
}

export { getDecodedImageDimensions, imageReserveStyle, isInsideHiddenSpoiler, rememberDecodedImageDimensions, useFrozenImageReserve } from "@client-kit/platform/react/image-lightbox";

/**
 * `urlTransform` for `<ReactMarkdown>` that preserves `buzz://message` and
 * `buzz://channel` deep links. The default transform strips unknown schemes
 * (returns `""`) before the `a` component override can see them, which would
 * break copy → paste → click end-to-end. Everything else delegates to
 * `defaultUrlTransform`.
 */
export function buzzDeepLinkUrlTransform(value: string, key: string): string {
  if (key !== "href") return defaultUrlTransform(value);
  if (isMessageLink(value) || isChannelLink(value)) return value;
  return defaultUrlTransform(value);
}

export { getReactNodeText } from "@client-kit/platform/react/message-body";
