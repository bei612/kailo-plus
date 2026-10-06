import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { PulseQueryRequest, PulsePublishRequest, WebMessageAttachment } from "@client-kit/contracts";
import { npubEncode } from "nostr-tools/nip19";
import { newIdempotencyKey } from "../../governance";
import { isOutcomeUnknown } from "../../transport";
import { usePulseQuery } from "./hooks";
export { UserProfilePopover } from "./UserProfilePopover";
export { AnimatedCount } from "./AnimatedCount";

// Original Buzz social/profile display projections, not a second registry.
export type UserProfileSummary = {displayName: string|null; name?:string|null; avatarUrl:string|null;
  nip05Handle:string|null; ownerPubkey:string|null; isAgent?:boolean; about?:string|null};
export type ChannelMember = {pubkey:string; role:string; isAgent:boolean; joinedAt:string; displayName:string|null};
export type RelayAgent = {pubkey:string; status:"online"|"away"|"offline"|"unknown"};
export type PulseEvent = {id:string; pubkey:string; created_at:number; kind:number; content:string; tags:string[][]};
export type PulseComposerProps = {header?:React.ReactNode; className?:string; placeholder?:string;
  disabled?:boolean; isSending?:boolean; compact?:boolean; autocompleteBelow?:boolean; members?:ChannelMember[];
  profiles?:Record<string,UserProfileSummary>; onCancel?:()=>void;
  onSubmit:(content:string, mentions:string[], attachments?:WebMessageAttachment[])=>Promise<unknown> | undefined};
export type PulseHost = {
  scopeKey:string; pubkey:string;
  query:(request:PulseQueryRequest)=>Promise<PulseEvent[]>;
  publish:(request:PulsePublishRequest,idempotencyKey:string)=>Promise<unknown>;
  renderComposer:(props:PulseComposerProps)=>React.ReactNode;
  renderContent:(content:string,tags?:string[][])=>React.ReactNode;
  mediaUrl:(url:string)=>string;
  copy:(text:string)=>Promise<void>;
  startDm:(pubkey:string)=>Promise<void>;
  openProfile?:(pubkey:string)=>void;
};
const Context=React.createContext<PulseHost|null>(null);
export function PulseHostProvider({host,children}:{host:PulseHost;children:React.ReactNode}) {
  return <Context.Provider key={host.scopeKey} value={host}>{children}</Context.Provider>;
}
export function usePulseHost() { const host=React.useContext(Context); if(!host)throw new Error("Pulse host unavailable");return host; }
export function truncateNpub(key:string) { const value=npubEncode(key);return `${value.slice(0,12)}…${value.slice(-6)}`; }
export function ForumComposer(props:PulseComposerProps){return usePulseHost().renderComposer(props);}
export function Markdown({content,tags}:{content:string;tags?:string[][]}){return usePulseHost().renderContent(content,tags);}
export function Skeleton({className}:{className:string}){return <div aria-hidden className={`t-skel-bar rounded-md bg-primary/10 is-pulsing ${className}`}/>;}

export function useContactListQuery(pubkey?:string) {
  const query=usePulseQuery({view:"CONTACTS" as PulseQueryRequest["view"]},Boolean(pubkey));
  return {...query,data:query.data?{contacts:query.data.flatMap(e=>e.tags.filter(t=>t[0]==="p"&&t[1]&&/^[0-9a-f]{64}$/.test(t[1])).map(t=>({pubkey:t[1]!})))}:undefined};
}
export function useRelayAgentsQuery() {
  const query=usePulseQuery({view:"AGENTS" as PulseQueryRequest["view"]});
  return {...query,data:query.data?.map(e=>({pubkey:e.pubkey,status:"unknown" as const}))};
}
export function useUsersBatchQuery(keys:string[],options?:{enabled:boolean}) {
  const host=usePulseHost();
  return useQuery({queryKey:["pulse",host.scopeKey,"profiles",[...keys].sort().join(",")],enabled:keys.length>0 && options?.enabled!==false,
    queryFn:async()=>{
      const events=await host.query({view:"PROFILES" as PulseQueryRequest["view"],authors:keys});
      const profiles:Record<string,UserProfileSummary>={};
      for(const event of events){const value:unknown=JSON.parse(event.content);if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid profile");
        const v=value as Record<string,unknown>;const text=(key:string)=>typeof v[key]==="string"?v[key]:null;
        const avatar=text("picture");profiles[event.pubkey]={displayName:text("display_name")??text("name"),name:text("name"),about:text("about"),
          avatarUrl:avatar?host.mediaUrl(avatar):null,nip05Handle:text("nip05"),ownerPubkey:null};}
      return {profiles};
    },retry:false});
}
export function useUserProfileQuery(key?:string){const query=useUsersBatchQuery(key?[key]:[]);return {...query,data:key?query.data?.profiles[key]:undefined};}

/** The original publication-intent semantics: unresolved writes retain their key. */
export function usePulsePublisher(){
  const host=usePulseHost();const pending=React.useRef(new Map<string,string>());
  return React.useCallback(async(request:PulsePublishRequest)=>{
    const signature=JSON.stringify(request);const key=pending.current.get(signature)??newIdempotencyKey();pending.current.set(signature,key);
    try{const result=await host.publish(request,key);pending.current.delete(signature);return result;}
    catch(error){if(!isOutcomeUnknown(error))pending.current.delete(signature);throw error;}
  },[host]);
}
