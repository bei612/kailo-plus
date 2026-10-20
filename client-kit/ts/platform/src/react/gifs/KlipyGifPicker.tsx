// Shared original Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/gifs/ui/KlipyGifPicker.tsx. DD-125(5): the host's `search` is the BFF
// forward of the Relay's own /gifs/search as the member; the browser never talks to the
// provider or holds its key, and items arrive already limited to registered origins.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Search } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { WebGifItem, WebGifSearchView } from "@client-kit/contracts";

import { useUiT } from "../context";
import { BffError } from "../../transport";
import { Input } from "../composer/shared/ui/input";
import { Skeleton } from "../sidebar/skeleton";

/** Original search debounce. */
export const GIF_SEARCH_DEBOUNCE_MS = 500;

export type GifSearch = (query: string) => Promise<WebGifSearchView>;

const LOADING_SKELETONS = [
  "tall-a", "short-a", "short-b", "tall-b", "short-c",
  "short-d", "tall-c", "short-e", "short-f", "tall-d",
] as const;

export const KlipyGifPicker = React.memo(function KlipyGifPicker({ onSelect, search }: {
  onSelect: (gif: WebGifItem) => void;
  search: GifSearch;
}) {
  const t = useUiT();
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const prefersReducedMotion = useReducedMotion() ?? false;

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), GIF_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [query]);

  // An empty query is the provider's trending page (the Relay chooses); one page only.
  const gifsQuery = useQuery({
    queryFn: () => search(debouncedQuery),
    queryKey: ["platform", "gif-search", debouncedQuery],
    retry: false,
    staleTime: 5 * 60 * 1_000,
  });
  const failure = gifsQuery.error instanceof BffError && gifsQuery.error.status === 403
    ? t("gif.joinCommunity") : t("gif.searchFailed");

  return (
    <div className="flex h-[435px] w-[352px] flex-col bg-muted text-foreground" data-testid="klipy-gif-picker">
      <div className="p-2.5">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("gif.search")}
            autoFocus
            className="h-9 bg-background/75 pl-8 pr-8 hover:bg-background/85 focus-visible:bg-background focus-visible:ring-ring/40"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("gif.search")}
            type="search"
            value={query}
          />
          {gifsQuery.isFetching ? (
            <LoaderCircle aria-hidden className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {gifsQuery.isPending ? (
          <div className="grid grid-cols-2 gap-1.5">
            <span className="sr-only">{t("gif.loading")}</span>
            {LOADING_SKELETONS.map((id) => <Skeleton className={id.startsWith("tall") ? "h-28" : "h-20"} key={id} />)}
          </div>
        ) : gifsQuery.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm text-muted-foreground" role="alert">{failure}</p>
            <button className="text-sm font-medium text-primary hover:underline" onClick={() => void gifsQuery.refetch()} type="button">
              {t("gif.retry")}
            </button>
          </div>
        ) : gifsQuery.data.gifs.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
            {t("gif.empty")}
          </div>
        ) : (
          <div className="columns-2 gap-1.5" data-testid="klipy-gif-grid">
            {gifsQuery.data.gifs.map((gif) => (
              <button
                aria-label={t("gif.choose", { title: gif.title })}
                className="mb-1.5 block w-full break-inside-avoid overflow-hidden rounded-lg bg-muted outline-hidden ring-offset-background transition-[filter,transform] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]"
                key={gif.slug}
                onClick={() => onSelect(gif)}
                title={gif.title}
                type="button"
              >
                {!prefersReducedMotion ? (
                  <img alt={gif.title} className="block h-auto w-full" height={gif.previewHeight} loading="lazy"
                    src={gif.previewUrl} width={gif.previewWidth} />
                ) : gif.posterUrl ? (
                  <img alt={gif.title} className="block h-auto w-full" loading="lazy" src={gif.posterUrl} />
                ) : (
                  <span className="flex aspect-video w-full items-center justify-center bg-muted px-2 text-center text-xs text-muted-foreground"
                    data-testid="klipy-gif-static-placeholder">
                    {gif.title}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-border/60 px-3 py-2 text-center text-2xs text-muted-foreground">
        {t("gif.poweredBy")}
      </div>
    </div>
  );
});
