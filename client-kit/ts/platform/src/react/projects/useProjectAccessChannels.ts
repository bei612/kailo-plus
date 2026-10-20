// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectRepositoryManagement.tsx
// accessChannels (useChannelsQuery: member, not archived, not a DM). Kailo reads the same set from
// the governed channel directory with ACTIVE membership; a stale or failed read offers no channel.
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WorkspaceMembershipState } from "@client-kit/contracts";
import { useBffClient } from "../context";
import { loadChannelDirectory } from "../channel-browser/loadChannelDirectory";
import type { ProjectAccessChannel } from "./AddProjectRepositoryDialog";

export function useProjectAccessChannels(scopeKey: string, enabled: boolean): ProjectAccessChannel[] {
  const client = useBffClient();
  const cache = useQueryClient();
  const lifetime = React.useMemo(() => ({ active: true }), [client, scopeKey]);
  React.useEffect(() => {
    lifetime.active = true;
    return () => { lifetime.active = false; };
  }, [lifetime]);
  const key = React.useMemo(() => ["project-access-channels", scopeKey], [scopeKey]);
  const query = useQuery({ queryKey: key, enabled,
    queryFn: ({ signal }) => loadChannelDirectory(client, () => lifetime.active && !signal.aborted),
    retry: false, refetchOnWindowFocus: "always" });
  React.useEffect(() => () => {
    void cache.cancelQueries({ queryKey: key });
    cache.removeQueries({ queryKey: key });
  }, [cache, key]);
  return React.useMemo(() => query.isSuccess && !query.isFetching ? query.data
    .filter(row => row.isMember && row.membershipState === WorkspaceMembershipState.Active && !row.channel.archived)
    .map(row => ({ workspaceId: row.id, channelId: row.channel.channelId, name: row.channel.name })) : [],
  [query.data, query.isFetching, query.isSuccess]);
}
