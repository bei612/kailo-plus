import type { PulseQueryRequest, PulsePublishRequest } from "@client-kit/contracts";
import type { PulseEvent } from "@client-kit/platform/react/pulse";
import { TransportError } from "@client-kit/platform/transport";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { classifyRelayPublishFailure } from "@/shared/api/relayPublishOutcome";
import type { RelaySubscriptionFilter } from "@/shared/api/relayClientShared";

/** Original Buzz social.rs filters and event builders, with this CLIENT signer. */
export function createPulseTransport(viewer:string,limit:number,active:()=>boolean) {
  const check=()=>{if(!active())throw new Error("Relay identity changed");};
  const fetch=async(filter:RelaySubscriptionFilter)=>{check();const rows=await relayClient.fetchEvents(filter);check();return rows;};
  const note=(event:PulseEvent)=>event.kind===1&&!event.tags.some(t=>t[0]==="a"&&t[1]?.startsWith("30617:"));
  const readNote=async(id:string)=>{
    const found=(await fetch({kinds:[1],ids:[id],limit:1})).find(e=>e.id===id&&note(e));
    if(!found)throw new Error("Pulse note unavailable");return found;
  };
  const query=async(request:PulseQueryRequest):Promise<PulseEvent[]>=>{
    const kinds=request.view==="NOTES"?[1]:request.view==="CONTACTS"?[3]:request.view==="REACTIONS"?[7]:
      request.view==="PROFILES"?[0]:request.view==="LIKED"?[7,5]:[10100];
    const filter:RelaySubscriptionFilter={kinds,limit};
    if(request.authors)filter.authors=request.authors;
    if(request.eventIds){if(request.view==="REACTIONS")filter["#e"]=request.eventIds;else filter.ids=request.eventIds;}
    if(request.view==="CONTACTS"||request.view==="LIKED")filter.authors=[viewer];
    if(request.view==="CONTACTS")filter.limit=1;
    if(request.before!==undefined)filter.until=request.before;
    let events:PulseEvent[]=await fetch(filter);
    if(request.view==="REACTIONS"&&events.length)events=events.concat(await fetch({kinds:[5],"#e":events.map(e=>e.id),limit}));
    if(request.view==="LIKED"){
      const deleted=new Set(events.filter(e=>e.kind===5&&e.pubkey===viewer).flatMap(e=>e.tags.filter(t=>t[0]==="e").map(t=>t[1])));
      const ids=events.filter(e=>e.kind===7&&e.pubkey===viewer&&e.content==="+"&&!deleted.has(e.id))
        .flatMap(e=>e.tags.filter(t=>t[0]==="e").map(t=>t[1]));
      events=ids.length?await fetch({kinds:[1],ids,limit}):[];
    }
    return request.view==="NOTES"||request.view==="LIKED"?events.filter(note):events;
  };
  // A retry after a lost ACK republishes the same signed event, never a new id.
  const pending=new Map<string,Awaited<ReturnType<typeof signRelayEvent>>>();
  const publish=async(request:PulsePublishRequest,key:string)=>{
    check();let event=pending.get(key);
    if(!event){
      const tags:string[][]=[];const kind=request.operation==="NOTE"?1:request.operation==="LIKE"?7:5;
      if(request.targetEventId){
        if(kind===5){
          const reaction=(await fetch({kinds:[7],ids:[request.targetEventId],authors:[viewer],limit:1}))
            .find(e=>e.id===request.targetEventId&&e.pubkey===viewer);
          const parent=reaction?.tags.filter(t=>t[0]==="e").at(-1)?.[1];
          if(!parent)throw new Error("Pulse reaction unavailable");
          await readNote(parent);tags.push(["e",request.targetEventId],["k","7"]);
        }else{
          const parent=await readNote(request.targetEventId);
          if(kind===1)tags.push(["e",parent.id,"","reply"]);
          else tags.push(["e",parent.id],["p",parent.pubkey],["k","1"]);
        }
      }
      if(kind===1){
        tags.push(...(request.mentions??[]).map(pubkey=>["p",pubkey]));
        for(const media of request.attachments??[]){
          const values=["imeta",`url ${media.url}`,`m ${media.type}`,`x ${media.sha256}`,`size ${media.size}`];
          for(const name of ["dim","blurhash","thumb","duration","image","filename"] as const){
            const value=media[name];if(value!==undefined)values.push(`${name} ${value}`);
          }
          tags.push(values);
        }
      }
      event=await signRelayEvent({kind,content:request.content,tags});check();
      if(event.pubkey!==viewer)throw new Error("Relay signing identity changed");
      pending.set(key,event);
    }
    try{await relayClient.publishEvent(event,"Pulse publication outcome unknown","Pulse publication rejected");}
    catch(error){if(classifyRelayPublishFailure(error)?.kind==="outcomeUnknown")throw new TransportError("Pulse publication outcome unknown");pending.delete(key);throw error;}
    pending.delete(key);check();return {eventId:event.id};
  };
  return {query,publish};
}
