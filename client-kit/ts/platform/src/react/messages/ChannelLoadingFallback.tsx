// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/shared/ui/ViewLoadingFallback.tsx, original channel presentation.
import { Skeleton } from "../sidebar/skeleton";
import { cn } from "../profile/buzz/shared/lib/cn";
import { channelChrome } from "./chromeLayout";
import { TopChromeInsetHeader } from "./TopChromeInsetHeader";

export function LoadingHeaderSkeleton() {
  return (
    <TopChromeInsetHeader data-tauri-drag-region flush>
      <header className="min-w-0 cursor-default select-none px-5 py-2">
        <div className="flex h-9 min-w-0 items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1 overflow-hidden">
              <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
              <Skeleton className="h-4 w-28 max-w-[50vw]" />
            </div>
          </div>
          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            <Skeleton className="h-8 w-16 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
      </header>
    </TopChromeInsetHeader>
  );
}

function MessageRowsSkeleton() {
  return (
    <>
      {["first", "second", "third", "fourth"].map((row, index) => (
        <article
          className="relative mx-1 flex items-start gap-2.5 rounded-2xl px-2 py-2"
          key={row}
        >
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="-mt-1 min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0">
              <Skeleton className="h-[15px] w-28" />
              <Skeleton className="h-3 w-10" />
            </div>
            <div className="mt-1 space-y-1.5 pb-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton
                className={index % 2 === 0 ? "h-4 w-4/5" : "h-4 w-2/3"}
              />
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-8 rounded-full" />
              <Skeleton className="h-4 w-8 rounded-full" />
              <Skeleton className="h-4 w-8 rounded-full" />
            </div>
          </div>
        </article>
      ))}
    </>
  );
}

export function ChannelLoadingBody({ hasHeader = false }: { hasHeader?: boolean }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-2 pb-32 pt-1">
        <div
          className={cn(
            "flex w-full flex-col gap-4",
            // The real channel header overlays content, so reserve its
            // measured height — unless an in-flow header skeleton is above.
            hasHeader ? "pt-3" : channelChrome.contentPadding,
          )}
        >
          <MessageRowsSkeleton />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="pointer-events-auto">
          <div className="relative z-10 shrink-0 bg-transparent px-5 pb-2 pt-0">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-5 bg-background"
            />
            <div className="relative isolate rounded-2xl border border-border/50 bg-background/80 px-3 pb-2 pt-3 shadow-none backdrop-blur-md supports-[backdrop-filter]:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-[backdrop-filter]:bg-background/55 sm:px-4">
              <Skeleton className="h-5 w-56 max-w-full" />
              <div className="mt-4 flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="ml-auto h-8 w-8 rounded-full" />
              </div>
            </div>
          </div>
          <div className="h-7 bg-background px-5 pb-1 pt-0">
            <div className="flex h-full w-full items-center gap-2" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChannelLoadingFallback({ includeHeader = false }: { includeHeader?: boolean }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {includeHeader ? <LoadingHeaderSkeleton /> : null}
      <ChannelLoadingBody hasHeader={includeHeader} />
    </div>
  );
}
