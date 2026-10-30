// Buzz 779af8886caae1317b4de962082429867ab61503 WorkflowsView loading surface.
// DD-170 §16.4(1): the skeleton keeps the card grid's shape and is announced as loading.
import { useT } from "./context";
import { Skeleton } from "./sidebar/skeleton";

export function WorkflowsListSkeleton() {
  const t = useT();
  return (
    <div role="status" aria-label={t("platform.loading")} aria-busy="true" data-testid="workflows-list-skeleton" className="grid grid-cols-1 gap-3 [@container(min-width:42rem)]:grid-cols-2 [@container(min-width:63rem)]:grid-cols-3">
      {["first", "second", "third", "fourth"].map((card) => (
        <div
          className="flex min-h-60 flex-col rounded-2xl bg-muted/50 p-5 shadow-xs"
          key={card}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-9 rounded-xl" />
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-9 w-9 rounded-xl" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="mt-5 h-3 w-28" />
          <Skeleton className="mt-2 h-6 w-full" />
          <Skeleton className="mt-2 h-6 w-4/5" />
          <Skeleton className="mt-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}
