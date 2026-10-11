import { useMemo, useEffect, type ReactNode } from "react";
import { ReminderHostProvider, RemindMeLaterProvider, type ReminderHost } from "@client-kit/platform/react/reminders";
import { getThreadReference } from "@/features/messages/lib/threading";
import { getChannelDetails } from "@/shared/api/tauriChannels";
import { getUsersBatch } from "@/shared/api/tauriProfiles";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useNativeSession } from "./activeCommunity";
import { createReminderTransport } from "./remindersTransport";
import { resolveChannelDisplayLabel } from "@/features/sidebar/lib/channelLabels";
import { resolveUserLabel } from "@/features/profile/lib/identity";

export function NativeReminderHost({children}:{children:ReactNode}) {
  const session=useNativeSession();const {goChannel}=useAppNavigation();
  const lifetime=useMemo(()=>({active:true}),[session]);
  useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false;};},[lifetime]);
  const host=useMemo<ReminderHost>(()=>{
    const check=()=>{if(!lifetime.active)throw new Error("Reminder identity changed");};
    const scopeKey=`${session.facts.communityHost}:${session.devicePubkey}`;
    const limit=session.facts.relayQueryLimit;
    const available=limit!==undefined&&Number.isSafeInteger(limit)&&limit>0;
    const transport=createReminderTransport(scopeKey,session.facts.relayUrl,session.devicePubkey,limit,()=>lifetime.active&&available);
    return {scopeKey,pubkey:available?session.devicePubkey:"",...transport,
      source:async(target)=>{
        const event=await transport.readSource(target.channelId,target.eventId);
        const channel=await getChannelDetails(target.channelId);check();
        const {profiles}=await getUsersBatch([event.pubkey]);check();
        const profile=profiles[event.pubkey];
        return {authorLabel:resolveUserLabel({pubkey:event.pubkey,currentPubkey:session.devicePubkey,profiles}),avatarUrl:profile?.avatarUrl?rewriteRelayUrl(profile.avatarUrl):null,
          channel,channelLabel:resolveChannelDisplayLabel(channel,session.devicePubkey,profiles),
          ...(profile?.isAgent===true?{isAgent:true}:{})};
      },
      navigate:async(target)=>{const event=await transport.readSource(target.channelId,target.eventId);check();
        await goChannel(target.channelId,{messageId:event.id,threadRootId:getThreadReference(event.tags).rootId});check();},
    };
  },[session,lifetime,goChannel]);
  return <ReminderHostProvider host={host}><RemindMeLaterProvider pubkey={host.pubkey}>{children}</RemindMeLaterProvider></ReminderHostProvider>;
}
