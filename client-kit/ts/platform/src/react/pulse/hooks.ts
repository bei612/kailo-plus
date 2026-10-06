// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/pulse/hooks.ts:
// same original feeds/reaction folding; only the authenticated host is substituted.
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import type {PulseQueryRequest,PulsePublishRequest,WebMessageAttachment} from "@client-kit/contracts";
import {usePulseHost,usePulsePublisher,type PulseEvent} from "./host";
import {withoutProjectComments} from "./lib/projectComments";
import type {UserNote} from "./socialTypes";

export const pulseQueryKeys={reactions:(ids:string[])=>["pulse-reactions",[...ids].sort().join(",")] as const};
const note=(event:PulseEvent):UserNote=>({id:event.id,pubkey:event.pubkey,createdAt:event.created_at,content:event.content,tags:event.tags});
export function usePulseQuery(request:PulseQueryRequest,enabled=true){const host=usePulseHost();return useQuery({
  queryKey:["pulse",host.scopeKey,request],queryFn:()=>host.query(request),enabled,
  // Original focused polling policy, not a new work queue or content cache.
  refetchInterval:()=>typeof document!=="undefined"&&document.visibilityState==="visible"?30_000:false,
  staleTime:5*60_000,refetchOnWindowFocus:false,retry:false,
});}
function useNotes(request:PulseQueryRequest,enabled:boolean){const query=usePulseQuery(request,enabled);return {...query,
  data:query.data?withoutProjectComments({notes:query.data.map(note),nextCursor:null}):undefined};}
export function useGlobalNotesQuery(enabled:boolean){return useNotes({view:"NOTES" as PulseQueryRequest["view"]},enabled);}
export function useMyNotesQuery(pubkey?:string){return useNotes({view:"NOTES" as PulseQueryRequest["view"],authors:pubkey?[pubkey]:[]},Boolean(pubkey));}
export function useTimelineQuery(authors:string[],enabled:boolean){return useNotes({view:"NOTES" as PulseQueryRequest["view"],authors},enabled&&authors.length>0);}
export function useLikedNotesQuery(pubkey?:string,enabled=true){return useNotes({view:"LIKED" as PulseQueryRequest["view"]},enabled&&Boolean(pubkey));}
export function useNoteByIdQuery(id:string|null){const query=useNotes({view:"NOTES" as PulseQueryRequest["view"],eventIds:id?[id]:[]},Boolean(id));return {...query,data:query.data?.notes[0]??null};}
export type PulseReactionState={count:number;reactedByCurrentUser:boolean;ownEventIds:string[]};
export function usePulseReactionsQuery(ids:string[],pubkey?:string){const query=usePulseQuery({view:"REACTIONS" as PulseQueryRequest["view"],eventIds:ids},ids.length>0);
  let data:Map<string,PulseReactionState>|undefined;
  if(query.data){data=new Map();const events=query.data;const deletes=events.filter(e=>e.kind===5);
    for(const event of events.filter(e=>e.kind===7&&e.content==="+")){
      if(deletes.some(d=>d.pubkey===event.pubkey&&d.tags.some(t=>t[0]==="e"&&t[1]===event.id)))continue;
      const id=event.tags.filter(t=>t[0]==="e").at(-1)?.[1];if(!id||!ids.includes(id))continue;
      const row=data.get(id)??{count:0,reactedByCurrentUser:false,ownEventIds:[]};row.count++;
      if(event.pubkey===pubkey){row.reactedByCurrentUser=true;row.ownEventIds.push(event.id);}data.set(id,row);
    }}
  return {...query,data};
}
export function usePublishNoteMutation(_pubkey?:string){const publish=usePulsePublisher();const host=usePulseHost();const qc=useQueryClient();return useMutation({
  mutationFn:({content,replyTo,mentionPubkeys,mediaTags}:{content:string;replyTo?:string;mentionPubkeys?:string[];mediaTags?:WebMessageAttachment[]})=>
    publish({operation:"NOTE" as PulsePublishRequest["operation"],content,targetEventId:replyTo,mentions:mentionPubkeys,attachments:mediaTags}),
  onSuccess:()=>qc.invalidateQueries({queryKey:["pulse",host.scopeKey]}),
});}
