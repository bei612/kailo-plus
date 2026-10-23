// Original Buzz Pulse note actions (desktop/src/features/pulse/lib/useNoteActions.ts::toggleUpvote).
// The original applies the target like state at once and disables the button while the reaction is
// in flight; Kailo shows that same pending presentation (target heart/count, disabled) only while
// the publish is in flight, never as a settled success: a confirmed receipt is re-read from the
// reaction read model, a definite failure reverts with the error, and an UNKNOWN outcome reverts to
// the re-read state with a neutral notice (no optimistic success when the receipt is unknown).
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
  // In-flight target like state per note: the original pending presentation, not a settled state.
  const [targets,setTargets]=React.useState<ReadonlyMap<string,boolean>>(()=>new Map());
  const settled=(id:string)=>reactions.get(id)?.reactedByCurrentUser??false;
  const settledCount=(id:string)=>reactions.get(id)?.count??0;
  const isUpvoted=(id:string)=>targets.get(id)??settled(id);
  const reactionCount=(id:string)=>{const target=targets.get(id);
    if(target===undefined||target===settled(id))return settledCount(id);
    return Math.max(0,settledCount(id)+(target?1:-1));};
  const setTarget=(id:string,target:boolean|undefined)=>setTargets(current=>{const next=new Map(current);
    if(target===undefined)next.delete(id);else next.set(id,target);return next;});
  return {isReplySending:replyMutation.isPending,isUpvotePending:(id:string)=>pending.has(id),
    reactionCount,isUpvoted,
    reply:async(note:UserNote,content:string,mentions:string[],mediaTags?:WebMessageAttachment[])=>{
      try{await replyMutation.mutateAsync({content,replyTo:note.id,mentionPubkeys:[...new Set([note.pubkey,...mentions])],mediaTags});}
      catch(error){const message=error instanceof Error?error.message:t("pulse.publishFailed");if(isOutcomeUnknown(error))toast(message);else toast.error(message);throw error;}},
    share:async(note:UserNote)=>{try{await host.copy(buildNoteShareUri(note));toast.success(t("buzz.copiedLink"));}catch{toast.error(t("buzz.copyFailed"));}},
    startDm:async(key:string)=>{try{await host.startDm(key);}catch(e){toast.error(String(e));}},
    toggleUpvote:async(note:UserNote,remove:boolean)=>{if(pending.has(note.id))return;setPending(p=>toggleNoteIdInSet(p,note.id,true));
      setTarget(note.id,!remove);
      try{const ids=remove?reactions.get(note.id)?.ownEventIds??[]:[note.id];
        for(const id of ids)await publish({operation:(remove?"UNLIKE":"LIKE") as PulsePublishRequest["operation"],content:remove?"":"+",targetEventId:id});
      }catch(error){if(isOutcomeUnknown(error))toast(String(error));else toast.error(String(error));}
      finally{
        // Every outcome settles from the reaction read model; the pending target is withdrawn only
        // after that re-read, so the heart never flips back and forth on a confirmed receipt.
        try{await qc.invalidateQueries({queryKey:["pulse",host.scopeKey]});}
        finally{setTarget(note.id,undefined);setPending(p=>toggleNoteIdInSet(p,note.id,false));}
      }}
  };
}
