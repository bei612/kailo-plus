// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectSelectionDiscussAction.tsx.
import { ChevronDown, Hash, MessageSquare, Search } from "lucide-react";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChannelType, WorkspaceMembershipState, type DiscoverableWorkspace } from "@client-kit/contracts";
import { toast } from "sonner";
import { useBffClient, useT } from "../context";
import { ChannelBrowser } from "../channel-browser";
import { loadChannelDirectory } from "../channel-browser/loadChannelDirectory";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { projectSelectionChannelCandidates, type ProjectSelectionItem } from "./lib/projectSelection";

const ACTION_CLASS =
  "-mx-2 h-7 w-[calc(100%+1rem)] justify-start gap-3 rounded-md px-2 text-left text-sm font-normal hover:bg-muted/70 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

export function ProjectSelectionDiscussAction({ items, scopeKey, onSelectChannel, testIdPrefix = "projects-selection" }: {
  items: ProjectSelectionItem[];
  scopeKey: string;
  onSelectChannel: (workspace: DiscoverableWorkspace) => Promise<void>;
  testIdPrefix?: string;
}) {
  const t = useT();
  const client = useBffClient();
  const [expanded, setExpanded] = React.useState(false);
  const [browserOpen, setBrowserOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const running = React.useRef(false);
  const lifetime = React.useMemo(() => ({ active: true }), [scopeKey, client]);
  React.useEffect(() => { lifetime.active = true; return () => { lifetime.active = false; }; }, [lifetime]);
  const query = useQuery({ queryKey: ["project-discuss-channels", scopeKey], enabled: expanded,
    queryFn: ({ signal }) => loadChannelDirectory(client, () => lifetime.active && !signal.aborted),
    retry: false, refetchOnMount: "always", refetchOnWindowFocus: "always" });
  const channels = query.isSuccess && !query.isFetching ? query.data : [];
  const channelsById = new Map(channels.filter(channel => channel.isMember
    && channel.membershipState === WorkspaceMembershipState.Active && !channel.channel.archived
    && channel.channel.channelType === ChannelType.Stream).map(channel => [channel.channel.channelId, channel]));
  const candidates = projectSelectionChannelCandidates(items);
  const select = async (workspace: DiscoverableWorkspace) => {
    if (running.current || !lifetime.active) return;
    running.current = true; setBusy(true);
    try { await onSelectChannel(workspace); }
    catch { if (lifetime.active) { toast.error(t("platform.loadFailed")); await query.refetch(); } }
    finally { running.current = false; if (lifetime.active) setBusy(false); }
  };
  React.useEffect(() => { if (expanded && query.isError) toast.error(t("platform.loadFailed")); }, [expanded, query.isError, t]);
  return <>
    <Button aria-expanded={expanded} className={ACTION_CLASS} data-testid={`${testIdPrefix}-discuss`}
      onClick={() => setExpanded(current => !current)} size="sm" type="button" variant="ghost">
      <MessageSquare className="h-3.5 w-3.5" />{t("projects.discuss.channel")}
      <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", !expanded && "-rotate-90")} />
    </Button>
    {expanded ? <div className="ml-5 space-y-0.5 border-border/50 border-l pl-2" data-testid={`${testIdPrefix}-channel-choices`}>
      {candidates.map(({ channelId, count }) => {
        const channel = channelsById.get(channelId);
        if (!channel) return null;
        const name = channel.channel.name.trim() || channelId.slice(0, 8);
        return <Button className="h-7 w-full justify-start gap-2 px-2 text-left text-xs font-normal"
          data-testid={`${testIdPrefix}-related-channel`} key={channelId} disabled={busy}
          onClick={() => { void select(channel); }} size="sm" type="button" variant="ghost">
          <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">#{name}</span>
          {count > 1 ? <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span> : null}
        </Button>;
      })}
      <Button className="h-7 w-full justify-start gap-2 px-2 text-left text-xs font-normal"
        data-testid={`${testIdPrefix}-search-channels`} onClick={() => setBrowserOpen(true)} disabled={busy}
        size="sm" type="button" variant="ghost">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />{t("projects.discuss.search")}
      </Button>
    </div> : null}
    <ChannelBrowser open={browserOpen} onOpenChange={setBrowserOpen} channelType={ChannelType.Stream} onSelect={select}/>
  </>;
}
