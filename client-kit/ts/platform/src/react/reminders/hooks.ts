import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hashPayload } from "nostr-tools/nip98";
import type { ReminderPublishRequest } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { isOutcomeUnknown, TransportError } from "../../transport";
import { useReminderHost } from "./host";
import type { Reminder, ReminderTarget } from "./lib/reminderTypes";
export { countDue as countDueReminders } from "./lib/reminderFilters";

export const remindersQueryKey=(scope:string,pubkey:string)=>["reminders",scope,pubkey] as const;
export function useRemindersQuery(pubkey?:string) {
  const host=useReminderHost();
  return useQuery({enabled:!!pubkey&&pubkey===host.pubkey,
    queryKey:remindersQueryKey(host.scopeKey,pubkey??""),queryFn:host.query,retry:false,
    staleTime:30_000});
}
export function useReminderMutations(pubkey:string) {
  const host=useReminderHost();
  const queryClient=useQueryClient();
  const publish=async(request:ReminderPublishRequest)=>{
    if(pubkey!==host.pubkey)throw new Error("Reminder identity changed");
    // Recovery references only, like the existing project publication intent.
    // No plaintext note, preview, ciphertext, signed event or key is persisted.
    const slot=JSON.stringify(["reminder-publication",host.scopeKey,pubkey,
      request.eventId??[request.channelId,request.sourceEventId]]);
    const digest=hashPayload([request.operation,request.eventId??null,request.sourceEventId??null,
      request.channelId??null,request.notBefore??null,request.note??null]);
    const stored=localStorage.getItem(slot);
    const intent:{key:string;digest:string;eventId?:string}=stored===null?{key:newIdempotencyKey(),digest}:JSON.parse(stored);
    if(!intent||typeof intent.key!=="string"||!/^[0-9a-f-]{36}$/.test(intent.key)
      ||intent.eventId!==undefined&&!/^[0-9a-f]{64}$/.test(intent.eventId))throw new TransportError("Reminder publication intent unavailable");
    if(intent.digest!==digest)throw new TransportError("Reminder publication outcome unknown");
    localStorage.setItem(slot,JSON.stringify(intent));
    try {
      const result=await host.publish(request,intent.key,stored!==null,{eventId:intent.eventId,onPrepared:eventId=>{
        if(!/^[0-9a-f]{64}$/.test(eventId))throw new TransportError("Reminder publication event unavailable");
        intent.eventId=eventId;localStorage.setItem(slot,JSON.stringify(intent));
      }});
      if(!result?.eventId||!/^[0-9a-f]{64}$/.test(result.eventId)||intent.eventId&&intent.eventId!==result.eventId)
        throw new TransportError("Reminder publication outcome unknown");
      host.completePublication?.(intent.key,result.eventId);
      localStorage.removeItem(slot);return result;
    } catch(error) {
      if(stored!==null)throw new TransportError("Reminder publication outcome unknown");
      if(!isOutcomeUnknown(error))localStorage.removeItem(slot);
      throw error;
    }
  };
  const invalidate=()=>queryClient.invalidateQueries({queryKey:remindersQueryKey(host.scopeKey,pubkey)});
  const create=useMutation({mutationFn:({target,notBefore,note}:{target:ReminderTarget;notBefore:number;note?:string})=>
    publish({operation:"CREATE",channelId:target.channelId,sourceEventId:target.eventId,notBefore,...(note?{note}:{})} as ReminderPublishRequest),onSuccess:invalidate});
  const complete=useMutation({mutationFn:(reminder:Reminder)=>publish({operation:"COMPLETE",eventId:reminder.eventId} as ReminderPublishRequest),onSuccess:invalidate});
  const snooze=useMutation({mutationFn:({reminder,notBefore}:{reminder:Reminder;notBefore:number})=>
    publish({operation:"SNOOZE",eventId:reminder.eventId,notBefore} as ReminderPublishRequest),onSuccess:invalidate});
  const cancel=useMutation({mutationFn:(reminder:Reminder)=>publish({operation:"CANCEL",eventId:reminder.eventId} as ReminderPublishRequest),onSuccess:invalidate});
  return {create,complete,snooze,cancel};
}
