// Host-only reads for the fixed Buzz search state and presentation shared with Desktop.
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BffClient } from "@client-kit/platform/client";
import { PulseQueryRequestView, type ConversationView } from "@client-kit/contracts";
import { useBffClient } from "@client-kit/platform/react/context";
import { createSearchResultsReader, type SearchDataHooks } from "@client-kit/platform/react/search/useSearchResults";
import { rankUserCandidatesBySearch } from "@client-kit/platform/react/search/userCandidateSearch";
import type { SearchChannel, UserSearchResult } from "@client-kit/platform/react/search/types";
import { loadChannelDirectory } from "@client-kit/platform/react/channel-browser/loadChannelDirectory";
import { formatDmParticipantDisplayName } from "@client-kit/platform/react/conversations/dm-participant-display";
import { translateCurrent } from "@client-kit/platform/i18n";
import type { UserProfileLookup } from "@client-kit/platform/react/messages/system/identity";
import { TransportError } from "@client-kit/platform/transport";
import { loadConversationPeople } from "@client-kit/platform/react/new-message";
import { queryPulse, searchMessages } from "../bff-client";

export async function loadWebSearchDirectory(client:BffClient, conversations:readonly ConversationView[], principalId:string, check:()=>void) {
  const workspaces=await loadChannelDirectory(client,()=>{check();return true;});
  const people=await loadConversationPeople(client,check);
  const labels:Record<string,string>={};
  const channels:SearchChannel[]=workspaces.map(row=>({id:row.channel.channelId,name:row.channel.name,
    description:row.channel.description??"",channelType:row.channel.channelType,archived:row.channel.archived,
    visibility:row.visibility,isMember:row.isMember,lastMessageAt:null}));
  const participants=new Map(people.map(person=>[person.principalId,person]));
  for(const conversation of conversations) {
    if(conversation.state!=="ACTIVE")continue;
    if(!conversation.channelId || !conversation.participantPrincipalIds.includes(principalId))throw new TransportError("Unadmitted search conversation");
    const others=conversation.participantPrincipalIds.filter(id=>id!==principalId).map(id=>participants.get(id));
    if(others.length===0 || others.some(person=>!person))throw new TransportError("Missing search conversation participant");
    labels[conversation.channelId]=formatDmParticipantDisplayName(others.map(person=>({displayName:person!.displayName})));
    // ConversationView proves admission and native ID, not a full Relay 39000
    // metadata record. Do not fabricate participant keys or archive timestamps.
    channels.push({id:conversation.channelId,name:translateCurrent("search.directMessage"),channelType:"dm",visibility:"private",
      description:"",isMember:true,lastMessageAt:null});
  }
  if(new Set(channels.map(channel=>channel.id)).size!==channels.length)throw new TransportError("Ambiguous search channel binding");
  check();
  return {channels,labels,workspaces,people};
}

export function useWebSearchDirectory(scopeKey:string, conversations:readonly ConversationView[],principalId:string,enabled:boolean) {
  const client=useBffClient();
  const owner=useMemo(()=>({active:true}),[scopeKey,client]);
  useEffect(()=>{owner.active=true;return()=>{owner.active=false;};},[owner]);
  return useQuery({queryKey:["platform",scopeKey,"search-directory",conversations],enabled,retry:false,
    queryFn:()=>loadWebSearchDirectory(client,conversations,principalId,()=>{if(!owner.active)throw new TransportError("Search scope changed");})});
}

async function profiles(pubkeys:string[],check:()=>void):Promise<UserProfileLookup> {
  check();
  const page=await queryPulse({view:PulseQueryRequestView.Profiles,authors:pubkeys});
  check();
  const result:UserProfileLookup={};
  const requested=new Set(pubkeys);
  const seen=new Map<string,number>();
  for(const event of page.events) {
    if(event.kind!==0 || !requested.has(event.pubkey) || !Number.isSafeInteger(event.created_at)) throw new TransportError("Invalid search profile source");
    if((seen.get(event.pubkey)??-1)>=event.created_at)continue;
    const value:unknown=JSON.parse(event.content);
    if(!value||typeof value!=="object"||Array.isArray(value))throw new TransportError("Invalid search profile");
    const content=value as Record<string,unknown>;
    const text=(key:string)=>typeof content[key]==="string"?content[key]:null;
    const picture=text("picture");
    result[event.pubkey]={displayName:text("display_name")??text("name"),name:text("name"),about:text("about"),
      avatarUrl:picture?(page.mediaPaths[picture]??picture):null,nip05Handle:text("nip05"),ownerPubkey:null};
    seen.set(event.pubkey,event.created_at);
  }
  return result;
}

export function useWebSearchReader(scopeKey:string, directoryError?:unknown) {
  const client=useBffClient();
  const owner=useMemo(()=>({active:true}),[scopeKey,client]);
  useEffect(()=>{owner.active=true;return()=>{owner.active=false;};},[owner]);
  return useMemo(()=>{
    const check=()=>{if(!owner.active)throw new TransportError("Search scope changed");};
    const hooks:SearchDataHooks={
      useUserSearchQuery:(query,options)=>useQuery({
        queryKey:["platform",scopeKey,"search-people",query,options?.limit,options?.allowEmpty],
        enabled:options?.enabled!==false&&(options?.allowEmpty===true||query.trim().length>0),retry:false,
        queryFn:async()=>{
          const people=await loadConversationPeople(client,check);
          const directory=people.flatMap(person=>person.pubkeys.map(pubkey=>({pubkey,displayName:person.displayName,
            avatarUrl:null,nip05Handle:null,ownerPubkey:null,isAgent:false} satisfies UserSearchResult)));
          const ranked=rankUserCandidatesBySearch({candidates:directory,getLabel:user=>user.displayName??user.pubkey,
            query,limit:options?.limit??directory.length,allowEmptyQuery:options?.allowEmpty});
          if(ranked.length===0)return ranked;
          const metadata=await profiles(ranked.map(user=>user.pubkey),check);
          return ranked.map(user=>({...user,displayName:metadata[user.pubkey]?.displayName??user.displayName,
            avatarUrl:metadata[user.pubkey]?.avatarUrl??null,nip05Handle:metadata[user.pubkey]?.nip05Handle??null}));
        },
      }),
      useUsersBatchQuery:(keys,options)=>useQuery({
        queryKey:["platform",scopeKey,"search-profiles",[...keys].sort()],enabled:options?.enabled!==false&&keys.length>0,retry:false,
        queryFn:async()=>({profiles:await profiles([...new Set(keys)],check)}),
      }),
      useSearchMessagesQuery:(query,options)=>useQuery({
        queryKey:["platform",scopeKey,"search-messages",query,options?.limit,options?.channelId,options?.authors,options?.since,options?.until],
        enabled:options?.enabled!==false,retry:false,
        queryFn:async()=>{check();const page=await searchMessages({q:query,limit:options?.limit,channelId:options?.channelId,
          authors:options?.authors,since:options?.since??undefined,until:options?.until??undefined});check();return page;},
      }),
    };
    const read=createSearchResultsReader(hooks);
    return function useResults(options:Parameters<typeof read>[0]) {
      const result=read(options);
      return {...result,searchQuery:{...result.searchQuery,error:directoryError??result.searchQuery.error}};
    };
  },[client,scopeKey,owner,directoryError]);
}
