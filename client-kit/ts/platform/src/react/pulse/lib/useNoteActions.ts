// Original Buzz Pulse note actions; no optimistic success when the receipt is unknown.
import * as React from "react";
import {useQueryClient} from "@tanstack/react-query";
import type {PulsePublishRequest,WebMessageAttachment} from "@client-kit/contracts";
import {toast} from "sonner";
import {isOutcomeUnknown} from "../../../transport";
import {useUiT} from "../../context";
import {usePulseHost,usePulsePublisher} from "../host";
import {usePublishNoteMutation,type PulseReactionState,pulseQueryKeys} from "../hooks";
import {buildNoteShareUri,toggleNoteIdInSet} from "./noteActions";
import type {UserNote} from "../socialTypes";
export function usePulseNoteActions({currentPubkey,reactions}:{currentPubkey?:string;reactionQueryKey:ReturnType<typeof pulseQueryKeys.reactions>;reactions:Map<string,PulseReactionState>}){
  const host=usePulseHost();const publish=usePulsePublisher();const qc=useQueryClient();const replyMutation=usePublishNoteMutation(currentPubkey);const t=useUiT();
  const [pending,setPending]=React.useState<ReadonlySet<string>>(()=>new Set());
  return {isReplySending:replyMutation.isPending,isUpvotePending:(id:string)=>pending.has(id),
    reactionCount:(id:string)=>reactions.get(id)?.count??0,isUpvoted:(id:string)=>reactions.get(id)?.reactedByCurrentUser??false,
    reply:async(note:UserNote,content:string,mentions:string[],mediaTags?:WebMessageAttachment[])=>{
      try{await replyMutation.mutateAsync({content,replyTo:note.id,mentionPubkeys:[...new Set([note.pubkey,...mentions])],mediaTags});}
      catch(error){const message=error instanceof Error?error.message:t("pulse.publishFailed");if(isOutcomeUnknown(error))toast(message);else toast.error(message);throw error;}},
    share:async(note:UserNote)=>{try{await host.copy(buildNoteShareUri(note));toast.success(t("buzz.copiedLink"));}catch{toast.error(t("buzz.copyFailed"));}},
    startDm:async(key:string)=>{try{await host.startDm(key);}catch(e){toast.error(String(e));}},
    toggleUpvote:async(note:UserNote,remove:boolean)=>{if(pending.has(note.id))return;setPending(p=>toggleNoteIdInSet(p,note.id,true));
      try{const ids=remove?reactions.get(note.id)?.ownEventIds??[]:[note.id];
        for(const id of ids)await publish({operation:(remove?"UNLIKE":"LIKE") as PulsePublishRequest["operation"],content:remove?"":"+",targetEventId:id});
        await qc.invalidateQueries({queryKey:["pulse",host.scopeKey]});
      }catch(error){if(isOutcomeUnknown(error))toast(String(error));else toast.error(String(error));}finally{setPending(p=>toggleNoteIdInSet(p,note.id,false));}}
  };
}
