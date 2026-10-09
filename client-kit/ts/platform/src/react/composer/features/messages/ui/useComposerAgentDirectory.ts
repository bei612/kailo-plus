import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { BffClient } from "../../../../../client";
import { loadComposerAgentDirectory } from "../lib/composerAgentDirectory";

export function useComposerAgentDirectory(
  client: BffClient,
  scope: {
    workspaceId?: string;
    channelId?: string;
    principalId?: string;
    ownerPubkey?: string;
  },
  enabled: boolean,
) {
  const owner = React.useMemo(
    () => ({ active: true }),
    [
      client,
      scope.workspaceId,
      scope.channelId,
      scope.principalId,
      scope.ownerPubkey,
      enabled,
    ],
  );
  const currentOwner = React.useRef(owner);
  currentOwner.current = owner;
  React.useEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
    };
  }, [owner]);
  const current = React.useCallback(
    () => owner.active && currentOwner.current === owner && enabled,
    [owner, enabled],
  );
  const read = React.useCallback(() => {
    if (!scope.workspaceId || !current())
      throw new Error("Agent composer scope unavailable");
    return loadComposerAgentDirectory(
      client,
      { ...scope, workspaceId: scope.workspaceId },
      current,
    );
  }, [
    client,
    scope.workspaceId,
    scope.channelId,
    scope.principalId,
    scope.ownerPubkey,
    current,
  ]);
  const query = useQuery({
    queryKey: [
      "platform",
      "composer-agent-directory",
      scope.principalId ?? scope.ownerPubkey,
      scope.workspaceId,
      scope.channelId,
    ],
    enabled: enabled && Boolean(scope.workspaceId),
    retry: false,
    refetchOnMount: "always",
    queryFn: read,
  });
  // No prior identity/scope/failed-refetch result can enable Agent selection.
  const data =
    enabled && query.isSuccess && !query.isFetching && current()
      ? query.data
      : undefined;
  return { ...query, data, verify: read };
}
