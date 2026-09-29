import * as React from "react";

import { invokeTauri } from "@/shared/api/tauri";
import type { SupportedLinkPreview } from "./linkPreview";

type LinkPreviewImageFetchState =
  | "none"
  | "image"
  | "transient_failure"
  | "rejected";

export type LinkPreviewMetadata = {
  title: string;
  siteName: string | null;
  description: string | null;
  imageDataUrl: string | null;
  imageDomain: string | null;
  imageFetchState?: LinkPreviewImageFetchState;
  imageRetryAfterMs?: number | null;
  faviconDataUrl?: string | null;
};

type MetadataCacheEntry = {
  expiresAt: number | null;
  metadata: LinkPreviewMetadata | null;
};

type MetadataLoadResult = MetadataCacheEntry & {
  key: string;
};

const DEFAULT_TRANSIENT_RETRY_MS = 30_000;
const NULL_METADATA_RETRY_MS = 5 * 60_000;
const MAX_CONCURRENT_METADATA_FETCHES = 2;
// Keep a just-removed request cacheable through a brief edit/re-entry gap, but
// never let unobserved native work linger indefinitely. New queued demand
// reclaims these loads immediately rather than waiting for this grace period.
const ORPHANED_METADATA_LOAD_GRACE_MS = 1_000;

/**
 * React may flush an interaction-triggered effect before the browser paints.
 * Start uncached preview I/O after a frame plus a task boundary so the pasted
 * text and loading card are visible before native IPC work begins.
 */
function scheduleAfterPaint(task: () => void): () => void {
  let frameId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timeoutId = setTimeout(task, 0);
  };

  if (typeof requestAnimationFrame === "function") {
    frameId = requestAnimationFrame(run);
  } else {
    run();
  }

  return () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    if (timeoutId !== null) clearTimeout(timeoutId);
  };
}

function metadataCacheKey(href: string): string {
  try {
    const url = new URL(href);
    url.hash = "";
    return url.href;
  } catch {
    return href.split("#", 1)[0] ?? href;
  }
}

function isNegativeMetadata(metadata: LinkPreviewMetadata | null): boolean {
  // A cached NEGATIVE is a result that should be retried when the URL freshly
  // re-enters the composer: a hard miss (null) or a transient image failure.
  // A healthy hit (`image`/`rejected`/no state) is a settled positive.
  return metadata === null || metadata.imageFetchState === "transient_failure";
}

function metadataExpiry(
  metadata: LinkPreviewMetadata | null,
  now: number,
): number | null {
  if (metadata === null) return now + NULL_METADATA_RETRY_MS;
  if (metadata.imageFetchState !== "transient_failure") return null;
  const retryAfterMs =
    typeof metadata.imageRetryAfterMs === "number" &&
    Number.isFinite(metadata.imageRetryAfterMs)
      ? Math.max(1_000, metadata.imageRetryAfterMs)
      : DEFAULT_TRANSIENT_RETRY_MS;
  return now + retryAfterMs;
}

type PendingMetadataLoad = {
  controller: AbortController;
  consumers: number;
  orphanTimer: ReturnType<typeof setTimeout> | null;
  promise: Promise<MetadataLoadResult>;
};

type MetadataCacheValue = MetadataCacheEntry | PendingMetadataLoad;

function isPendingMetadataLoad(
  value: MetadataCacheValue,
): value is PendingMetadataLoad {
  return "promise" in value;
}

function abortError(): DOMException {
  return new DOMException("Link preview fetch cancelled", "AbortError");
}

function createTaskScheduler(concurrency: number) {
  const pending: Array<{
    reject: (reason?: unknown) => void;
    run: () => void;
    signal: AbortSignal;
  }> = [];
  let active = 0;

  const drain = () => {
    while (active < concurrency) {
      const next = pending.shift();
      if (!next) return;
      if (next.signal.aborted) {
        next.reject(abortError());
        continue;
      }
      active += 1;
      next.run();
    }
  };

  return <T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const entry = {
        reject,
        signal,
        run: () => {
          signal.removeEventListener("abort", cancelPending);
          void task()
            .then(resolve, reject)
            .finally(() => {
              active -= 1;
              drain();
            });
        },
      };
      const cancelPending = () => {
        const index = pending.indexOf(entry);
        if (index < 0) return;
        pending.splice(index, 1);
        reject(abortError());
        drain();
      };
      signal.addEventListener("abort", cancelPending, { once: true });
      pending.push(entry);
      drain();
    });
}

function createMetadataLoader({
  concurrency = MAX_CONCURRENT_METADATA_FETCHES,
  fetcher,
  now = Date.now,
}: {
  concurrency?: number;
  fetcher: (
    href: string,
    signal: AbortSignal,
  ) => Promise<LinkPreviewMetadata | null>;
  now?: () => number;
}) {
  const cache = new Map<string, MetadataCacheValue>();
  const schedule = createTaskScheduler(Math.max(1, concurrency));
  let generation = 0;

  const peek = (href: string): MetadataLoadResult | undefined => {
    const key = metadataCacheKey(href);
    const cached = cache.get(key);
    if (!cached || isPendingMetadataLoad(cached)) return undefined;
    if (cached.expiresAt !== null && cached.expiresAt <= now()) {
      cache.delete(key);
      return undefined;
    }
    return { key, ...cached };
  };

  const abortPending = (key: string, pending: PendingMetadataLoad) => {
    if (pending.orphanTimer !== null) clearTimeout(pending.orphanTimer);
    pending.orphanTimer = null;
    if (cache.get(key) === pending) cache.delete(key);
    pending.controller.abort();
  };

  const release = (key: string, pending: PendingMetadataLoad) => {
    if (pending.consumers <= 0) return;
    pending.consumers -= 1;
    if (
      pending.consumers > 0 ||
      pending.orphanTimer !== null ||
      cache.get(key) !== pending
    ) {
      return;
    }
    pending.orphanTimer = setTimeout(
      () => abortPending(key, pending),
      ORPHANED_METADATA_LOAD_GRACE_MS,
    );
  };

  const createRelease = (key: string, pending: PendingMetadataLoad) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release(key, pending);
    };
  };

  const abortOrphanedLoads = (exceptKey: string) => {
    for (const [key, cached] of cache) {
      if (
        key !== exceptKey &&
        isPendingMetadataLoad(cached) &&
        cached.consumers === 0
      ) {
        abortPending(key, cached);
      }
    }
  };

  const load = (
    href: string,
  ): { cancel: () => void; promise: Promise<MetadataLoadResult> } => {
    const key = metadataCacheKey(href);
    const cached = cache.get(key);
    if (cached && isPendingMetadataLoad(cached)) {
      if (cached.orphanTimer !== null) clearTimeout(cached.orphanTimer);
      cached.orphanTimer = null;
      cached.consumers += 1;
      return {
        cancel: createRelease(key, cached),
        promise: cached.promise,
      };
    }
    if (cached) {
      if (cached.expiresAt === null || cached.expiresAt > now()) {
        return {
          cancel: () => undefined,
          promise: Promise.resolve({ key, ...cached }),
        };
      }
      cache.delete(key);
    }

    abortOrphanedLoads(key);
    const requestGeneration = generation;
    const controller = new AbortController();
    const pending: PendingMetadataLoad = {
      controller,
      consumers: 1,
      orphanTimer: null,
      promise: Promise.resolve({
        expiresAt: null,
        key,
        metadata: null,
      }),
    };
    pending.promise = schedule(
      () => fetcher(href, controller.signal),
      controller.signal,
    )
      .catch((error) => {
        if (controller.signal.aborted) throw error;
        return null;
      })
      .then((metadata) => {
        if (pending.orphanTimer !== null) clearTimeout(pending.orphanTimer);
        pending.orphanTimer = null;
        const entry = {
          expiresAt: metadataExpiry(metadata, now()),
          metadata,
        };
        if (
          requestGeneration === generation &&
          cache.get(key) === pending &&
          !controller.signal.aborted
        ) {
          cache.set(key, entry);
        }
        return { key, ...entry };
      });
    cache.set(key, pending);
    return {
      cancel: createRelease(key, pending),
      promise: pending.promise,
    };
  };

  return {
    deleteKey(key: string) {
      cache.delete(key);
    },
    /**
     * Drop a cached NEGATIVE result (a resolved null or a transient failure) so
     * the next load refetches. Used when a URL freshly enters the composer: a
     * user pasting a link that previously blanked should get a new attempt now,
     * not the stale miss. A healthy cached hit and an in-flight fetch are left
     * untouched, so passive scroll re-renders still ride the cache as before.
     * Returns whether a negative entry was actually dropped, so callers can
     * invalidate their own derived state (e.g. retained React metadata) in step.
     */
    invalidateNegative(href: string): boolean {
      const key = metadataCacheKey(href);
      const cached = cache.get(key);
      if (!cached || isPendingMetadataLoad(cached)) return false;
      if (!isNegativeMetadata(cached.metadata)) return false;
      cache.delete(key);
      return true;
    },
    load,
    peek,
    reset() {
      generation += 1;
      for (const [key, cached] of cache) {
        if (isPendingMetadataLoad(cached)) abortPending(key, cached);
      }
      cache.clear();
    },
  };
}

function fetchLinkPreviewMetadata(
  href: string,
  signal: AbortSignal,
): Promise<LinkPreviewMetadata | null> {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  const logResult = (
    result: LinkPreviewMetadata | null,
  ): LinkPreviewMetadata | null => {
    if (import.meta.env?.DEV) {
      console.info("[link-preview] metadata fetch completed", {
        href,
        elapsedMs: Math.round(performance.now() - startedAt),
        result: result === null ? "miss" : "hit",
        imageFetchState: result?.imageFetchState ?? "none",
        imageRetryAfterMs: result?.imageRetryAfterMs ?? null,
        hasImage: Boolean(result?.imageDataUrl && result.imageDomain),
        hasFavicon: Boolean(result?.faviconDataUrl),
      });
    }
    return result;
  };
  const logFailure = (error: unknown): never => {
    if (import.meta.env?.DEV) {
      console.warn("[link-preview] metadata fetch failed", {
        href,
        elapsedMs: Math.round(performance.now() - startedAt),
        error,
      });
    }
    throw error;
  };

  const request = invokeTauri<LinkPreviewMetadata | null>(
    "fetch_link_preview_metadata",
    {
      href,
      requestId,
    },
  );
  const onAbort = () => {
    void invokeTauri("cancel_link_preview_metadata", { requestId }).catch(
      () => undefined,
    );
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  return request.then(logResult, logFailure).finally(() => {
    signal.removeEventListener("abort", onAbort);
    void invokeTauri("release_link_preview_metadata", { requestId }).catch(
      () => undefined,
    );
  });
}

const metadataLoader = createMetadataLoader({
  fetcher: fetchLinkPreviewMetadata,
});

/** Share the same deduplicated metadata job between composer rendering and send preparation. */
export function loadLinkPreviewMetadata(href: string): {
  cancel: () => void;
  promise: Promise<LinkPreviewMetadata | null>;
} {
  const load = metadataLoader.load(href);
  return {
    cancel: load.cancel,
    promise: load.promise.then((result) => result.metadata),
  };
}
/** Clear ephemeral metadata when the active relay/community changes. */
export function resetLinkPreviewMetadataCache(): void {
  metadataLoader.reset();
}

export type LinkPreviewImageState = "pending" | "image" | "fallback" | "none";

export type ResolvedLinkPreview = SupportedLinkPreview & {
  description?: string | null;
  faviconDataUrl?: string | null;
  imageState: LinkPreviewImageState;
  /** Metadata extraction completed successfully; safe to snapshot after media uploads. */
  snapshotReady?: boolean;
};

type ResolvedMetadataByHref = Record<
  string,
  LinkPreviewMetadata | null | undefined
>;

export function resolveLinkPreview(
  preview: SupportedLinkPreview,
  metadata: LinkPreviewMetadata | null | undefined,
): ResolvedLinkPreview {
  if (metadata === undefined) {
    return { ...preview, imageState: "pending" };
  }
  if (metadata === null) {
    return { ...preview, imageState: "none" };
  }

  const hasImage = Boolean(metadata.imageDataUrl && metadata.imageDomain);
  const imageState: LinkPreviewImageState = hasImage
    ? "image"
    : metadata.imageFetchState === "image" ||
        metadata.imageFetchState === "transient_failure" ||
        metadata.imageFetchState === "rejected"
      ? "fallback"
      : "none";
  return {
    ...preview,
    snapshotReady: true,
    title: metadata.title,
    description: metadata.description,
    faviconDataUrl: metadata.faviconDataUrl,
    provider:
      preview.kind === "generic-link" && metadata.siteName
        ? metadata.siteName
        : preview.provider,
    imageDataUrl: hasImage ? metadata.imageDataUrl : null,
    imageDomain: hasImage ? metadata.imageDomain : null,
    imageState,
  };
}

export function useResolvedLinkPreviews(
  previews: SupportedLinkPreview[],
  {
    refetchNewNegatives = false,
    liveHrefs,
    liveHrefVersions,
  }: {
    /**
     * When a preview href is newly present since the last run, drop any cached
     * NEGATIVE (null/transient-fail) metadata for it so it refetches instead of
     * resolving to a stale miss. Used by the composer: a freshly pasted link
     * should get a new attempt. Off by default so passive renders (the message
     * list) keep riding the cache. Healthy cached hits are never invalidated.
     */
    refetchNewNegatives?: boolean;
    /**
     * The hrefs present in the caller's LIVE (undebounced) content. When given,
     * newness is judged against this set instead of the resolved `previews`, so
     * a URL that leaves and re-enters the live content is treated as re-entered
     * even when a debounce swallowed the intermediate empty state (the composer
     * debounces resolution, so `previews` may never observe the URL leaving).
     * Resolution timing still follows `previews`; only the invalidation decision
     * uses this. Omit to track newness against `previews` (the default).
     */
    liveHrefs?: readonly string[];
    /**
     * Per-href entry versions captured at the live editor-update boundary.
     * Unlike committed href-set equality, a bumped version preserves an
     * intermediate leave/re-entry even when React batches both updates into one
     * commit with the same final href set.
     */
    liveHrefVersions?: ReadonlyMap<string, number>;
  } = {},
): ResolvedLinkPreview[] {
  const [resolvedMetadata, setResolvedMetadata] =
    React.useState<ResolvedMetadataByHref>({});
  const [retryGeneration, setRetryGeneration] = React.useState(0);
  const seenHrefsRef = React.useRef<Set<string>>(new Set());
  const handledHrefVersionsRef = React.useRef<Map<string, number>>(new Map());
  // Drive newness tracking from a stable string key so an equivalent href list
  // does not restart the effect. The effect closes over the committed render's
  // hrefs; do not mirror them into a ref during render, because an abandoned
  // concurrent render could otherwise leak uncommitted presence into the live
  // effect from the previous commit.
  const currentHrefs = liveHrefs ?? previews.map((preview) => preview.href);
  const newnessKey = currentHrefs
    .map((href) => `${href}\0${liveHrefVersions?.get(href) ?? ""}`)
    .join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: newnessKey is the stable identity for currentHrefs; depending on the freshly allocated array would rerun this effect every render.
  React.useEffect(() => {
    let cancelled = false;
    let retryAt = Number.POSITIVE_INFINITY;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    if (refetchNewNegatives) {
      // Invalidate first, before the peek/load loop below reads the cache, so a
      // newly-present href loads fresh instead of resolving to its stale miss.
      // Newness is judged against the live href set when supplied (so a
      // debounce-swallowed leave/re-entry still counts), else against previews.
      const seen = seenHrefsRef.current;
      const handledVersions = handledHrefVersionsRef.current;
      const liveNow = currentHrefs;
      // Preserve handled hrefs only while they remain live. A live href is not
      // marked handled until its debounced preview exists and invalidation has
      // actually been attempted; otherwise blank -> paste would consume
      // newness during the 350ms debounce and later reuse the stale negative.
      const next = new Set<string>(
        [...seen].filter((href) => liveNow.includes(href)),
      );
      const nextVersions = new Map(
        [...handledVersions].filter(([href]) => liveNow.includes(href)),
      );
      const reenteredKeys: string[] = [];
      for (const preview of previews) {
        const version = liveHrefVersions?.get(preview.href);
        const alreadyHandled =
          version === undefined
            ? seen.has(preview.href)
            : handledVersions.get(preview.href) === version;
        if (alreadyHandled || !liveNow.includes(preview.href)) {
          continue;
        }
        // Drop any settled NEGATIVE from the SHARED loader cache so the load
        // below refetches instead of resolving to the stale miss. (A no-op when
        // the shared entry is healthy, in-flight, or absent.)
        metadataLoader.invalidateNegative(preview.href);
        reenteredKeys.push(metadataCacheKey(preview.href));
        next.add(preview.href);
        if (version !== undefined) nextVersions.set(preview.href, version);
      }
      seenHrefsRef.current = next;
      handledHrefVersionsRef.current = nextVersions;
      // Dropping the loader entry alone is not enough: this hook retains its own
      // resolved metadata, and the render that scheduled this effect already
      // read the stale negative from it. Clear this hook's OWN negative key for
      // every re-entered href — gating on whether the shared loader dropped a
      // settled entry misses the case where another hook left an in-flight
      // Promise in the shared cache (invalidateNegative leaves Promises alone
      // and the loop below merely coalesces onto it), which would otherwise
      // keep this hook's retained `transient_failure` as a `snapshotReady`
      // fallback the composer could turn into a sendable snapshot tag from stale
      // metadata until that fetch resolves. Clearing the local negative renders
      // the re-entered link as pending until the fresh load wins. Healthy local
      // hits are kept, so passive re-renders still show their card instantly.
      if (reenteredKeys.length > 0) {
        setResolvedMetadata((current) => {
          let changed = false;
          const nextMetadata = { ...current };
          for (const key of reenteredKeys) {
            const value = nextMetadata[key];
            if (value !== undefined && isNegativeMetadata(value)) {
              delete nextMetadata[key];
              changed = true;
            }
          }
          return changed ? nextMetadata : current;
        });
      }
    }

    const scheduleRetry = ({
      expiresAt,
      key,
    }: Pick<MetadataLoadResult, "expiresAt" | "key">) => {
      if (expiresAt === null || expiresAt >= retryAt) return;
      retryAt = expiresAt;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = setTimeout(
        () => {
          metadataLoader.deleteKey(key);
          setResolvedMetadata((current) => {
            if (!(key in current)) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
          setRetryGeneration(retryGeneration + 1);
        },
        Math.max(0, expiresAt - Date.now()),
      );
    };

    const cancelScheduledLoads: Array<() => void> = [];
    for (const preview of previews) {
      const cached = metadataLoader.peek(preview.href);
      if (cached !== undefined) {
        setResolvedMetadata((current) =>
          current[cached.key] === cached.metadata
            ? current
            : { ...current, [cached.key]: cached.metadata },
        );
        scheduleRetry(cached);
        continue;
      }

      cancelScheduledLoads.push(
        scheduleAfterPaint(() => {
          const load = metadataLoader.load(preview.href);
          cancelScheduledLoads.push(load.cancel);
          void load.promise
            .then((result) => {
              if (cancelled) return;
              setResolvedMetadata((current) =>
                current[result.key] === result.metadata
                  ? current
                  : { ...current, [result.key]: result.metadata },
              );
              scheduleRetry(result);
            })
            .catch(() => undefined);
        }),
      );
    }

    return () => {
      cancelled = true;
      for (const cancel of cancelScheduledLoads) cancel();
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [previews, refetchNewNegatives, retryGeneration, newnessKey]);

  return React.useMemo(
    () =>
      previews.flatMap((preview) => {
        const metadata = resolvedMetadata[metadataCacheKey(preview.href)];
        return metadata === null ? [] : [resolveLinkPreview(preview, metadata)];
      }),
    [previews, resolvedMetadata],
  );
}

export const __linkPreviewMetadataTest = {
  createMetadataLoader,
  createTaskScheduler,
  metadataCacheKey,
  metadataExpiry,
};
