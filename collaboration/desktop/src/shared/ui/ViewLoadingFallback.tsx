import { Card } from "@/shared/ui/card";
import { BuzzLoadingState } from "@/shared/ui/BuzzLoadingState";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/cn";
import { channelChrome } from "@/shared/layout/chromeLayout";
import { ChannelLoadingBody, LoadingHeaderSkeleton } from "@client-kit/platform/react/messages/ChannelLoadingFallback";

type ViewLoadingFallbackKind =
  | "agents"
  | "channel"
  | "forum"
  | "projects"
  | "pulse"
  | "workflows";

type ViewLoadingFallbackProps = {
  includeHeader?: boolean;
  kind: ViewLoadingFallbackKind;
};



const agentLoadingGroups = [
  {
    badgeWidth: "w-14",
    instanceWidth: "w-20",
    key: "persona-one",
    rows: ["one-a", "one-b"],
    titleWidth: "w-32",
  },
  {
    badgeWidth: "w-16",
    instanceWidth: "w-24",
    key: "persona-two",
    rows: ["two-a"],
    titleWidth: "w-28",
  },
  {
    badgeWidth: "w-12",
    instanceWidth: "w-20",
    key: "custom-agents",
    rows: ["custom-a"],
    titleWidth: "w-36",
  },
] as const;

function AgentRowSkeleton({ variant = 0 }: { variant?: number }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.8fr)_minmax(120px,0.8fr)_minmax(0,1.1fr)] lg:gap-4">
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded-sm" />
              <Skeleton className="mt-1 h-2 w-2 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Skeleton
                    className={cn("h-4", variant % 2 === 0 ? "w-36" : "w-28")}
                  />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-24" />
                </div>
                {variant === 0 ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-1 lg:pt-0.5">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton
              className={cn("h-3", variant % 2 === 0 ? "w-24" : "w-28")}
            />
          </div>

          <div className="space-y-1 lg:pt-0.5">
            <Skeleton className="h-3 w-28" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Skeleton className="h-3 w-20" />
              {variant === 0 ? <Skeleton className="h-3 w-24" /> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-start gap-2 lg:pt-0.5">
        <Skeleton className="h-7 w-24 rounded-md" />
        <Skeleton className="h-7 w-7 rounded-md" />
      </div>
    </div>
  );
}

function AgentGroupSkeleton({
  badgeWidth,
  instanceWidth,
  rows,
  titleWidth,
}: {
  badgeWidth: string;
  instanceWidth: string;
  rows: readonly string[];
  titleWidth: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card/40">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
          <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="flex min-w-0 items-center gap-2">
            <Skeleton className={cn("h-4", titleWidth)} />
            <Skeleton className={cn("h-5 rounded-full", badgeWidth)} />
          </div>
          <Skeleton className={cn("ml-1 h-3 shrink-0", instanceWidth)} />
        </div>
        <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
      </div>

      <div className="divide-y divide-border/50 border-t border-border/50">
        {rows.map((row, index) => (
          <AgentRowSkeleton key={row} variant={index} />
        ))}
      </div>
    </div>
  );
}

function AgentsLibrarySkeleton() {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      </div>

      <div className="space-y-3">
        {agentLoadingGroups.map((group) => (
          <AgentGroupSkeleton
            badgeWidth={group.badgeWidth}
            instanceWidth={group.instanceWidth}
            key={group.key}
            rows={group.rows}
            titleWidth={group.titleWidth}
          />
        ))}
      </div>
    </section>
  );
}

function AgentTeamsSkeleton() {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="hidden h-8 w-40 rounded-md sm:block" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {["team-one", "team-two", "team-three"].map((key, index) => (
          <Card className="p-3" key={key}>
            <div className="flex items-start justify-between gap-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
                  <Skeleton
                    className={cn("h-4", index === 0 ? "w-28" : "w-36")}
                  />
                  {index === 1 ? (
                    <Skeleton className="h-4 w-8 rounded-full" />
                  ) : null}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex -space-x-1.5">
                    <Skeleton className="h-6 w-6 rounded-full border-2 border-card" />
                    <Skeleton className="h-6 w-6 rounded-full border-2 border-card" />
                    <Skeleton className="h-6 w-6 rounded-full border-2 border-card" />
                  </div>
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-6 w-6 rounded-md" />
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function AgentsLoadingBody() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-4 pt-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-6">
          <AgentsLibrarySkeleton />
          <AgentTeamsSkeleton />
        </div>
      </div>
    </div>
  );
}

function CardListLoadingBody() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-4 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      <div className="space-y-2">
        {["first", "second", "third", "fourth"].map((card) => (
          <Card className="p-4" key={card}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full max-w-2xl" />
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </div>
              <div className="hidden shrink-0 gap-2 sm:flex">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}


function ForumLoadingBody({ hasHeader = false }: { hasHeader?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        !hasHeader && channelChrome.contentPadding,
      )}
    >
      <div className="border-b border-border/60 p-4">
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {["first", "second", "third"].map((card) => (
            <Card className="p-4" key={card}>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-14" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ViewLoadingFallback({
  includeHeader = false,
  kind,
}: ViewLoadingFallbackProps) {
  const shouldShowChannelHeader =
    includeHeader && (kind === "channel" || kind === "forum");

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {shouldShowChannelHeader ? <LoadingHeaderSkeleton /> : null}
      {kind === "agents" ? <AgentsLoadingBody /> : null}
      {kind === "workflows" ? <CardListLoadingBody /> : null}
      {kind === "projects" ? (
        <BuzzLoadingState fill label="Loading projects" />
      ) : null}
      {kind === "channel" ? (
        <ChannelLoadingBody hasHeader={shouldShowChannelHeader} />
      ) : null}
      {kind === "forum" ? (
        <ForumLoadingBody hasHeader={shouldShowChannelHeader} />
      ) : null}
      {kind === "pulse" ? (
        <ChannelLoadingBody hasHeader={shouldShowChannelHeader} />
      ) : null}
    </div>
  );
}
