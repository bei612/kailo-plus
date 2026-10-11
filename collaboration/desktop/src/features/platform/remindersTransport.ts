import { verifyEvent } from "nostr-tools/pure";
import type { ReminderPublishRequest } from "@client-kit/contracts";
import type { ReminderView as Reminder, ReminderContent } from "@client-kit/contracts";
import { parseNotBefore, parseReminderContent } from "@client-kit/platform/react/reminders";
import { TransportError } from "@client-kit/platform/transport";
import { relayClient } from "@/shared/api/relayClient";
import { nip44EncryptToSelf, nip44DecryptFromSelf, signRelayEvent, getEventById } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_EVENT_REMINDER } from "@/shared/constants/kinds";
import { RelayPublishNotSentError, classifyRelayPublishFailure } from "@/shared/api/relayPublishOutcome";

export function createReminderTransport(scopeKey:string,relayUrl:string,pubkey:string,limit:number|undefined,active:()=>boolean) {
  const check=()=>{if(!active())throw new TransportError("Reminder identity changed");};
  const decode=async(event:RelayEvent):Promise<Reminder|null>=>{
    if(event.kind!==KIND_EVENT_REMINDER||event.pubkey!==pubkey||!verifyEvent(event))throw new Error("Invalid reminder event");
    const id=event.tags.find(t=>t[0]==="d")?.[1];if(!id)return null;
    let plaintext:string;
    try {plaintext=await nip44DecryptFromSelf(event.content,pubkey);}catch {check();return null;}
    check();const content=parseReminderContent(plaintext);if(!content)return null;
    const raw=event.tags.find(t=>t[0]==="not_before")?.[1];
    return {id,content,eventId:event.id,createdAt:event.created_at,...(raw?{notBefore:parseNotBefore(raw)}:{})};
  };
  const query=async()=>{
    check();if(limit===undefined||!Number.isSafeInteger(limit)||limit<1)throw new Error("Reminder query limit unavailable");
    const events=await relayClient.fetchEvents({kinds:[KIND_EVENT_REMINDER],authors:[pubkey],limit});check();
    if(events.length>=limit)throw new Error("Reminder query limit reached");
    const results=await Promise.all(events.map(decode));check();return results.filter((r):r is Reminder=>r!==null);
  };
  const readSource=async(channelId:string,eventId:string)=>{
    check();const event=await getEventById(eventId);check();
    if(!verifyEvent(event)||event.id!==eventId||![9,40002,45001,45003].includes(event.kind)
      ||event.tags.filter(t=>t[0]==="h").length!==1||!event.tags.some(t=>t[0]==="h"&&t[1]===channelId))throw new Error("Reminder source unavailable");
    return event;
  };
  const publish=async(request:ReminderPublishRequest,key:string,observeOnly:boolean,observation:{eventId?:string;onPrepared:(id:string)=>void})=>{
    check();
    try {
      const event=await relayClient.publishReplaceableIntent("reminder",`${scopeKey}:${key}`,relayUrl,[KIND_EVENT_REMINDER],async()=>{
        try {
          check();let content:ReminderContent;let id:string;let createdAt=Math.floor(Date.now()/1_000);
          if(request.operation==="CREATE"){
            if(!request.channelId||!request.sourceEventId)throw new Error("Reminder source required");
            const source=await readSource(request.channelId,request.sourceEventId);
            id=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("");
            content={status:"pending" as ReminderContent["status"],note:request.note,target:{eventId:source.id,channelId:request.channelId,preview:source.content.slice(0,100),authorPubkey:source.pubkey}};
          }else{
            if(!request.eventId)throw new Error("Reminder head required");
            const [original]=await relayClient.fetchEvents({ids:[request.eventId],authors:[pubkey],kinds:[KIND_EVENT_REMINDER],limit:1});check();
            if(!original||original.id!==request.eventId)throw new Error("Reminder head unavailable");
            const previous=await decode(original);if(!previous)throw new Error("Reminder content unavailable");
            const [head]=await relayClient.fetchEvents({kinds:[KIND_EVENT_REMINDER],authors:[pubkey],"#d":[previous.id],limit:1});check();
            if(head?.id!==original.id)throw new Error("Reminder head changed");
            id=previous.id;content=previous.content;createdAt=Math.max(createdAt,previous.createdAt+1);
          }
          if(!["CREATE","COMPLETE","SNOOZE","CANCEL"].includes(request.operation))throw new Error("Invalid reminder operation");
          content={...content,status:(request.operation==="COMPLETE"?"done":request.operation==="CANCEL"?"cancelled":"pending") as ReminderContent["status"]};
          const tags=[["d",id]];
          if(content.status==="pending"){
            if(request.notBefore===undefined||!Number.isSafeInteger(request.notBefore)||request.notBefore<0)throw new Error("Invalid reminder time");
            tags.push(["not_before",String(request.notBefore)]);
          }else{
            const days=30+Math.floor(crypto.getRandomValues(new Uint32Array(1))[0]!/2**32*60);
            tags.push(["expiration",String(Math.floor(Date.now()/1_000)+days*86_400)]);
          }
          const encrypted=await nip44EncryptToSelf(JSON.stringify(content),pubkey);check();
          const signed=await signRelayEvent({kind:KIND_EVENT_REMINDER,content:encrypted,tags,createdAt});check();
          if(signed.pubkey!==pubkey)throw new Error("Reminder signing identity changed");
          return signed;
        }catch(error){throw new RelayPublishNotSentError(error instanceof Error?error.message:String(error));}
      },observeOnly,observation,pubkey);
      check();return {eventId:event.id};
    }catch(error){
      const outcome=classifyRelayPublishFailure(error);
      if(observeOnly||!outcome||outcome.kind==="outcomeUnknown")throw new TransportError("Reminder publication outcome unknown");
      throw error;
    }
  };
  return {query,publish,readSource,completePublication:(key:string,eventId:string)=>{
    check();relayClient.completeReplaceableIntent("reminder",`${scopeKey}:${key}`,relayUrl,eventId);
  }};
}
