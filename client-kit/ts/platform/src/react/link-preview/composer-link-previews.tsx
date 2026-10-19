// Shared original Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/useComposerLinkPreviews.tsx (ComposerLinkPreviewCard,
// selectSubmitTags, LINK_PREVIEW_DEBOUNCE_MS), desktop/src/shared/lib/useResolvedLinkPreviews.ts
// (cache windows, two concurrent metadata loads) and
// desktop/src/features/messages/lib/linkPreviewPreparationStore.ts (10 s post-submit budget,
// "Preparing link preview" + Skip).
//
// DD-125(5): on Web the fetch host is the BFF. The host's `prepare` answers the caller's own
// short-term snapshot (or null for "no preview"); a publication names only snapshot IDs or the
// suppression flag, never raw `link-preview` tags (V-SCN-139).
import * as React from "react";
import { ImageOff, X } from "lucide-react";
import type { WebLinkPreviewSnapshotView } from "@client-kit/contracts";

import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { Skeleton } from "../sidebar/skeleton";
import { Progress } from "../composer/shared/ui/progress";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "../composer/shared/ui/attachment";
import { extractSupportedLinkPreviews } from "./linkPreview";
import { isValidLinkPreviewSnapshotCanonicalUrl } from "./linkPreviewSnapshot";

/** Original idle time after the last keystroke before resolution runs. */
export const LINK_PREVIEW_DEBOUNCE_MS = 350;
/** Original `MAX_CONCURRENT_METADATA_FETCHES`. */
export const MAX_CONCURRENT_LINK_PREVIEW_PREPARATIONS = 2;
/** Original `NULL_METADATA_RETRY_MS`: a site with no preview is asked again after 5 min. */
export const NO_PREVIEW_RETRY_MS = 5 * 60_000;
/** Original `DEFAULT_TRANSIENT_RETRY_MS`. */
export const TRANSIENT_PREVIEW_RETRY_MS = 30_000;
/** Original `POST_SUBMIT_PREVIEW_BUDGET_MS`. */
export const POST_SUBMIT_PREVIEW_BUDGET_MS = 10_000;
/** A snapshot this close to expiry is fetched again rather than sent (Core refuses it). */
const SNAPSHOT_EXPIRY_MARGIN_MS = 30_000;

/** The BFF fetch host: a snapshot, or null when the site has no preview (404/422). Throwing
 * is transient (limits, network) and is retried later. */
export type PrepareLinkPreview = (url: string) => Promise<WebLinkPreviewSnapshotView | null>;

/** What one publication names: the caller's snapshot IDs, or the original suppression. */
export type LinkPreviewPublishIntent =
  | { linkPreviewSnapshotIds: string[]; suppressLinkPreviews?: undefined }
  | { suppressLinkPreviews: true; linkPreviewSnapshotIds?: undefined };

type Entry =
  | { status: "loading"; promise: Promise<void> }
  | { status: "ready"; snapshot: WebLinkPreviewSnapshotView }
  | { status: "none" | "failed"; retryAt: number };

/** Original composer candidates: external https links only (fragment stripped, at most 8). */
export function composerLinkPreviewHrefs(content: string): string[] {
  return extractSupportedLinkPreviews(content)
    .map((preview) => preview.href)
    .filter(isValidLinkPreviewSnapshotCanonicalUrl);
}

/**
 * Original `selectSubmitTags`, keyed on the LIVE hrefs so a removed URL's snapshot can never
 * leak onto a body that no longer contains it. Suppression only applies while there are
 * candidates; a live href without a ready snapshot sends as a bare link.
 */
export function selectLinkPreviewIntent(
  liveHrefs: readonly string[],
  snapshotIds: Readonly<Record<string, string>>,
  suppressed: boolean,
): LinkPreviewPublishIntent | undefined {
  if (liveHrefs.length === 0) return undefined;
  if (suppressed) return { suppressLinkPreviews: true };
  const ids = liveHrefs.flatMap((href) => {
    const id = snapshotIds[href];
    return id ? [id] : [];
  });
  return ids.length ? { linkPreviewSnapshotIds: ids } : undefined;
}

function usable(entry: Entry | undefined, now: number): entry is Extract<Entry, { status: "ready" }> {
  return entry?.status === "ready" &&
    Date.parse(entry.snapshot.expiresAt) - SNAPSHOT_EXPIRY_MARGIN_MS > now;
}

export type ComposerLinkPreviewCardModel = {
  href: string;
  snapshot: WebLinkPreviewSnapshotView | null;
};

export type ComposerLinkPreviews = {
  cards: ComposerLinkPreviewCardModel[];
  suppressed: boolean;
  suppress: () => void;
  /** True while a submit waits for unfinished previews (original background preparation). */
  preparing: boolean;
  /** Original Skip: send now without link previews. */
  skip: () => void;
  /** The publication intent for the live content, waiting at most the original 10 s. */
  prepareSubmit: () => Promise<LinkPreviewPublishIntent | undefined>;
};

export function useComposerLinkPreviews({ content, enabled, prepare }: {
  content: string;
  enabled: boolean;
  prepare?: PrepareLinkPreview;
}): ComposerLinkPreviews {
  const active = enabled && prepare !== undefined;
  const [debounced, setDebounced] = React.useState(content);
  const [suppressed, setSuppressed] = React.useState(false);
  const [preparing, setPreparing] = React.useState(false);
  const [, setVersion] = React.useState(0);
  const entries = React.useRef(new Map<string, Entry>());
  const queue = React.useRef<Array<() => void>>([]);
  const running = React.useRef(0);
  const mounted = React.useRef(true);
  const liveContent = React.useRef(content);
  liveContent.current = content;
  const prepareRef = React.useRef(prepare);
  prepareRef.current = prepare;
  const skipRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; skipRef.current?.(); };
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(content), LINK_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [content]);

  const liveHrefs = React.useMemo(() => active ? composerLinkPreviewHrefs(content) : [], [active, content]);
  // Original: suppression resets once the live draft has no candidates.
  React.useEffect(() => { if (liveHrefs.length === 0) setSuppressed(false); }, [liveHrefs.length]);

  const pump = React.useCallback(() => {
    while (running.current < MAX_CONCURRENT_LINK_PREVIEW_PREPARATIONS && queue.current.length) {
      running.current += 1;
      queue.current.shift()!();
    }
  }, []);

  /** One preparation per href; ready/negative entries are reused until they lapse. */
  const ensure = React.useCallback((href: string): Entry | undefined => {
    const host = prepareRef.current;
    if (!host) return undefined;
    const now = Date.now();
    const existing = entries.current.get(href);
    if (existing?.status === "loading" || usable(existing, now)) return existing;
    if ((existing?.status === "none" || existing?.status === "failed") && existing.retryAt > now) return existing;
    let settle!: () => void;
    const promise = new Promise<void>((resolve) => { settle = resolve; });
    const entry: Entry = { status: "loading", promise };
    entries.current.set(href, entry);
    queue.current.push(() => {
      // A host that throws synchronously is a transient failure, never a render error.
      void Promise.resolve().then(() => host(href)).then(
        (snapshot) => {
          entries.current.set(href, snapshot
            ? { status: "ready", snapshot }
            : { status: "none", retryAt: Date.now() + NO_PREVIEW_RETRY_MS });
        },
        () => { entries.current.set(href, { status: "failed", retryAt: Date.now() + TRANSIENT_PREVIEW_RETRY_MS }); },
      ).finally(() => {
        running.current -= 1;
        settle();
        if (mounted.current) setVersion((value) => value + 1);
        pump();
      });
    });
    pump();
    return entry;
  }, [pump]);

  const debouncedHrefs = React.useMemo(() => active ? composerLinkPreviewHrefs(debounced) : [], [active, debounced]);
  React.useEffect(() => {
    // Entries live in a ref: a newly started preparation must re-render so its card shows the
    // original "processing" state at once, not only after the preparation settles.
    let started = false;
    for (const href of debouncedHrefs) {
      const before = entries.current.get(href);
      if (ensure(href) !== before) started = true;
    }
    if (started && mounted.current) setVersion((value) => value + 1);
  }, [debouncedHrefs, ensure]);

  const now = Date.now();
  const cards = suppressed ? [] : debouncedHrefs.flatMap((href): ComposerLinkPreviewCardModel[] => {
    const entry = entries.current.get(href);
    if (entry?.status === "loading") return [{ href, snapshot: null }];
    return usable(entry, now) ? [{ href, snapshot: entry.snapshot }] : [];
  });

  const prepareSubmit = React.useCallback(async () => {
    if (!active) return undefined;
    const live = composerLinkPreviewHrefs(liveContent.current);
    if (live.length === 0) return undefined;
    if (suppressed) return selectLinkPreviewIntent(live, {}, true);
    const pending = live.flatMap((href) => {
      const entry = ensure(href);
      return entry?.status === "loading" ? [entry.promise] : [];
    });
    if (pending.length) {
      setPreparing(true);
      const skipped = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), POST_SUBMIT_PREVIEW_BUDGET_MS);
        skipRef.current = () => { clearTimeout(timer); resolve(true); };
        void Promise.all(pending).then(() => { clearTimeout(timer); resolve(false); });
      });
      skipRef.current = null;
      if (mounted.current) setPreparing(false);
      if (skipped) return undefined;
    }
    const at = Date.now();
    const ids: Record<string, string> = {};
    for (const href of live) {
      const entry = entries.current.get(href);
      if (usable(entry, at)) ids[href] = entry.snapshot.snapshotId;
    }
    return selectLinkPreviewIntent(live, ids, false);
  }, [active, suppressed, ensure]);

  return {
    cards,
    suppressed,
    suppress: React.useCallback(() => setSuppressed(true), []),
    preparing,
    skip: React.useCallback(() => { skipRef.current?.(); }, []),
    prepareSubmit,
  };
}

function previewHostname(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/** A Relay media URL of a snapshot is read only through the host's admitted media route. */
export function snapshotMediaHash(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return /^\/media\/([0-9a-f]{64})\.(?:jpg|png|gif|webp)$/.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Original ComposerLinkPreviewCard. */
function ComposerLinkPreviewCard({ card, onSuppress, resolveMedia }: {
  card: ComposerLinkPreviewCardModel;
  onSuppress: () => void;
  resolveMedia: (sha256: string) => string;
}) {
  const t = useUiT();
  const snapshot = card.snapshot;
  const done = snapshot !== null;
  const imageHash = snapshotMediaHash(snapshot?.imageUrl);
  const faviconHash = snapshotMediaHash(snapshot?.faviconUrl);
  const imageSrc = imageHash ? resolveMedia(imageHash) : null;
  const [failedImageSrc, setFailedImageSrc] = React.useState<string | null>(null);
  const showImage = Boolean(imageSrc && failedImageSrc !== imageSrc);
  const hostname = previewHostname(card.href);
  const title = snapshot?.title || hostname;
  return (
    <div
      className="group/link-preview relative w-80 max-w-full"
      data-image-state={showImage ? "image" : done ? "none" : "pending"}
      data-link-preview="generic-link"
      data-link-preview-composer-card=""
      data-snapshot-tag-ready={done ? "true" : "false"}
    >
      <Attachment className="h-[55px] w-full gap-0 overflow-hidden p-0 pr-2 shadow-none" state={done ? "done" : "processing"}>
        <AttachmentMedia
          className="relative h-[55px] w-[55px] rounded-none rounded-l-2xl border-0 bg-muted"
          data-link-preview-thumbnail=""
          variant="image"
        >
          {showImage ? (
            <img alt="" className="h-full w-full object-cover" onError={() => setFailedImageSrc(imageSrc)}
              src={imageSrc ?? undefined} />
          ) : !done ? (
            <div className="h-full w-full animate-pulse bg-muted" data-testid="link-preview-thumbnail-placeholder" />
          ) : faviconHash ? (
            <img alt="" className="size-7 rounded-md object-contain opacity-70" src={resolveMedia(faviconHash)} />
          ) : (
            <ImageOff aria-hidden="true" className="size-4 opacity-60" />
          )}
          {!done ? (
            <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1.5">
              <Progress aria-label={t("linkPreview.composerLoading")} className="h-1 bg-foreground/15"
                data-testid="link-preview-progress" value={null} />
            </div>
          ) : null}
        </AttachmentMedia>
        <AttachmentContent className="pl-2">
          {done ? (
            <>
              <AttachmentTitle className="line-clamp-1" data-link-preview-hostname="">{title}</AttachmentTitle>
              <AttachmentDescription>{snapshot.siteName || hostname}</AttachmentDescription>
            </>
          ) : (
            <div aria-label={t("linkPreview.composerLoadingDetails")} className="space-y-2"
              data-testid="link-preview-text-placeholder" role="status">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          )}
        </AttachmentContent>
        <AttachmentTrigger asChild>
          <a aria-label={t("linkPreview.composerOpen", { title })} href={card.href} rel="noreferrer" target="_blank">
            <span className="sr-only">{t("linkPreview.composerOpen", { title })}</span>
          </a>
        </AttachmentTrigger>
      </Attachment>
      <Button
        aria-label={t("linkPreview.sendWithout")}
        className="absolute -right-1 -top-1 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-foreground p-0 text-background opacity-0 shadow-none transition-opacity hover:bg-foreground group-hover/link-preview:opacity-100 group-focus-within/link-preview:opacity-100 focus-visible:opacity-100 [&_svg]:size-2.5"
        data-testid="composer-hide-link-previews"
        onClick={onSuppress}
        size="icon-xs"
        title={t("linkPreview.sendWithout")}
        type="button"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Original composer card list, above the attachments row. */
export function ComposerLinkPreviewCards({ previews, resolveMedia }: {
  previews: Pick<ComposerLinkPreviews, "cards" | "suppress">;
  resolveMedia: (sha256: string) => string;
}) {
  if (previews.cards.length === 0) return null;
  return (
    <div className="mb-2" data-composer-link-previews=""
      data-has-pending-snapshots={previews.cards.some((card) => card.snapshot === null) ? "true" : "false"}
      data-ready-snapshot-count={previews.cards.filter((card) => card.snapshot !== null).length}>
      <AttachmentGroup className="flex-row flex-wrap items-start">
        {previews.cards.map((card) => (
          <ComposerLinkPreviewCard card={card} key={card.href} onSuppress={previews.suppress} resolveMedia={resolveMedia} />
        ))}
      </AttachmentGroup>
    </div>
  );
}

/** Original ComposerUploadProgressOverlay phase "preparing" with its Skip action. */
export function ComposerLinkPreviewPreparing({ previews }: {
  previews: Pick<ComposerLinkPreviews, "preparing" | "skip">;
}) {
  const t = useUiT();
  if (!previews.preparing) return null;
  return (
    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground" data-testid="link-preview-preparing" role="status">
      <Progress aria-hidden="true" className="h-1 w-16" value={null} />
      <span>{t("linkPreview.preparing")}</span>
      <Button onClick={previews.skip} size="xs" type="button" variant="ghost">{t("linkPreview.skip")}</Button>
    </div>
  );
}
