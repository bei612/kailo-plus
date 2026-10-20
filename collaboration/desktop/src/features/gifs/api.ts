// DD-125(11), SF-BUZ-56(4), V-SCN-170. Original Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/gifs/api.ts and relay.ts: the Relay's KLIPY page is normalized to GIF-only
// results, and a chosen GIF becomes hash-less pending media whose URL is appended to the body as
// `![image](url)` with no imeta. Kailo adds the deployment registration: Desktop keeps only results
// whose original and preview come from a registered https origin (the same set the Web reads from
// the BFF GIF capability view); an unregistered poster is dropped (platform-core gifs.rs normalize).
import type { WebGifItem } from "@client-kit/contracts";
import type { ImetaMedia } from "@/features/messages/lib/imetaMediaMarkdown";

/** The Relay-relative KLIPY endpoints the Relay advertised (native `get_relay_gif_descriptor`). */
export type RelayGifDescriptor = { searchPath: string; sharePath: string };

/** Native error text for the Relay member gate (403 `relay_membership_required`). */
export const GIF_MEMBERSHIP_REQUIRED = "relay_membership_required";

const KLIPY_CUSTOMER_ID_STORAGE_KEY_PREFIX = "buzz:klipy-customer-id:v1:";

type Asset = { url: string; width: number; height: number; size: number };

const ORIGINAL = [["md", "gif"], ["hd", "gif"], ["sm", "gif"], ["xs", "gif"]] as const;
const PREVIEW = [["sm", "webp"], ["sm", "gif"], ["xs", "webp"], ["xs", "gif"], ["md", "webp"]] as const;
const POSTER = [["sm", "jpg"], ["xs", "jpg"], ["md", "jpg"], ["hd", "jpg"]] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Original `isCompleteAsset`: a non-empty URL with numeric width, height and size. */
function completeAsset(value: unknown): Asset | undefined {
  const asset = record(value);
  if (!asset) return undefined;
  const { url, width, height, size } = asset;
  return typeof url === "string" && url.length > 0 && typeof width === "number" &&
    typeof height === "number" && typeof size === "number"
    ? { url, width, height, size } : undefined;
}

function firstAsset(file: Record<string, unknown>, order: ReadonlyArray<readonly [string, string]>): Asset | undefined {
  for (const [size, format] of order) {
    const asset = completeAsset(record(file[size])?.[format]);
    if (asset) return asset;
  }
  return undefined;
}

/** An https URL without credentials whose origin the deployment registered. */
export function isRegisteredGifOrigin(raw: string, origins: readonly string[]): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && origins.includes(url.origin);
  } catch {
    return false;
  }
}

/**
 * Original `normalizeKlipyGifs` over the Relay's `{result, data: {data: [...]}}` page, limited to
 * registered origins: an item whose original or preview is outside the set is dropped.
 */
export function normalizeRelayGifs(page: unknown, origins: readonly string[]): WebGifItem[] {
  const items = record(record(page)?.data)?.data;
  if (!Array.isArray(items) || origins.length === 0) return [];
  const gifs: WebGifItem[] = [];
  for (const raw of items) {
    const item = record(raw);
    const file = record(item?.file);
    const slug = item?.slug;
    if (!item || item.type !== "gif" || !file || typeof slug !== "string" || slug.length === 0) continue;
    const original = firstAsset(file, ORIGINAL);
    if (!original) continue;
    const preview = firstAsset(file, PREVIEW) ?? original;
    if (!isRegisteredGifOrigin(original.url, origins) || !isRegisteredGifOrigin(preview.url, origins)) continue;
    const poster = firstAsset(file, POSTER);
    const title = typeof item.title === "string" ? item.title.trim() : "";
    gifs.push({
      slug,
      title: title || "GIF",
      url: original.url,
      width: original.width,
      height: original.height,
      size: original.size,
      previewUrl: preview.url,
      previewWidth: preview.width,
      previewHeight: preview.height,
      ...(poster && isRegisteredGifOrigin(poster.url, origins) ? { posterUrl: poster.url } : {}),
    });
  }
  return gifs;
}

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

type CustomerIdStorage = Pick<Storage, "getItem" | "setItem">;

function deviceStorage(): CustomerIdStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Original `customerId`: a random UUID kept per Relay on this device. */
export function klipyCustomerId(relayUrl: string, storage: CustomerIdStorage | undefined = deviceStorage()): string {
  if (!storage) return globalThis.crypto.randomUUID();
  try {
    const storageKey = `${KLIPY_CUSTOMER_ID_STORAGE_KEY_PREFIX}${relayUrl}`;
    const existing = storage.getItem(storageKey);
    if (existing) return existing;
    const created = globalThis.crypto.randomUUID();
    storage.setItem(storageKey, created);
    return created;
  } catch {
    // Storage can be unavailable in hardened webviews. Prefer an ephemeral ID over a
    // process-wide fallback that would correlate unrelated relays.
    return globalThis.crypto.randomUUID();
  }
}
