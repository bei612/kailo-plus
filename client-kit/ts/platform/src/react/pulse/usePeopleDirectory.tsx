import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useBffClient, useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import type { MentionSuggestion } from "./PeopleMentionAutocomplete";

/** Existing participant projection, not a second Community identity registry. */
export function usePeopleDirectory(scopeKey:string) {
  const client=useBffClient();
  const query=useInfiniteQuery({
    queryKey:["platform",scopeKey,"pulse-people"],
    queryFn:({pageParam})=>client.conversationParticipants(pageParam),
    initialPageParam:undefined as string|undefined,
    getNextPageParam:page=>page.nextCursor??undefined,
    retry:false,
  });
  const people=useMemo<MentionSuggestion[]>(()=>{
    const byKey=new Map<string,MentionSuggestion>();
    for(const person of query.data?.pages.flatMap(page=>page.items)??[])
      for(const pubkey of person.pubkeys)byKey.set(pubkey,{pubkey,displayName:person.displayName});
    return [...byKey.values()];
  },[query.data]);
  return {query,people};
}
export function PeopleDirectoryStatus({directory}:{directory:ReturnType<typeof usePeopleDirectory>}) {
  const t=useUiT();const {query}=directory;
  return <>{query.isError?<div role="alert">{t("platform.loadFailed")}<Button variant="ghost" onClick={()=>void query.refetch()}>{t("platform.retry")}</Button></div>:null}
    {query.hasNextPage?<Button variant="ghost" disabled={query.isFetchingNextPage} onClick={()=>void query.fetchNextPage()}>{t("platform.audit.scope.loadMore")}</Button>:null}</>;
}
