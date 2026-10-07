import type {ProjectsPublishRequest} from "@client-kit/contracts";
import {TransportError} from "@client-kit/platform/transport";
import {relayClient} from "@/shared/api/relayClient";
import {signRelayEvent} from "@/shared/api/tauri";
import {classifyRelayPublishFailure} from "@/shared/api/relayPublishOutcome";

// Original projectDeletion.ts; CLIENT signs and Relay decides exact ownership.
export function createProjectsPublisher(scopeKey:string,relayUrl:string,viewer:string,active:()=>boolean){
  const check=()=>{if(!active())throw new TransportError("Project identity changed");};
  return async(request:ProjectsPublishRequest,key:string,observeOnly=false,observation?:{eventId?:string;onPrepared:(eventId:string)=>void})=>{
    check();
    try {
      const event=await relayClient.publishProjectIntent(`${scopeKey}:${key}`,relayUrl,async()=>{
        if(request.operation!=="DELETE")throw new Error("Invalid project deletion");
        const target=(await relayClient.fetchEvents({ids:[request.targetEventId],kinds:[30621,30617],limit:1}))[0];check();
        if(!target||target.id!==request.targetEventId||![30621,30617].includes(target.kind))throw new Error("Project head unavailable");
        const slug=target.tags.find(tag=>tag[0]==="d")?.[1];
        if(!slug)throw new Error("Project coordinate unavailable");
        const [head]=await relayClient.fetchEvents({kinds:[target.kind],authors:[target.pubkey],"#d":[slug],limit:1});check();
        if(head?.id!==target.id)throw new Error("Project changed; refresh its current head");
        const signed=await signRelayEvent({kind:5,content:`Delete project ${target.tags.find(tag=>tag[0]==="name")?.[1]??slug}`,
          createdAt:Math.max(Math.floor(Date.now()/1_000),target.created_at+1),tags:[["a",`${target.kind}:${target.pubkey}:${slug}`]]});
        check();if(signed.pubkey!==viewer)throw new TransportError("Project signing identity changed");return signed;
      },observeOnly,observation);
      check();if(event.kind!==5||event.pubkey!==viewer)throw new TransportError("Project deletion receipt identity mismatch");return {eventId:event.id};
    }catch(error){if(classifyRelayPublishFailure(error)?.kind==="outcomeUnknown")throw new TransportError("Project publication outcome unknown");throw error;}
  };
}
