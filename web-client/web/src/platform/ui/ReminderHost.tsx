import { useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ReminderHostProvider, RemindMeLaterProvider, type ReminderHost } from "@client-kit/platform/react/reminders";
import { loadChannelDirectory } from "@client-kit/platform/react/channel-browser/loadChannelDirectory";
import { loadInboxConversations, loadConversationPeople } from "@client-kit/platform/react/new-message";
import { resolveConversationHeaderParticipants, formatDmParticipantDisplayName } from "@client-kit/platform/react/conversations/dm-participant-display";
import { getThreadReference } from "@client-kit/platform/react/messages/threading";
import { truncatePubkey } from "@client-kit/platform/format";
import { TransportError } from "@client-kit/platform/transport";
import { bff, queryReminders, publishReminder, reminderSource } from "../bff-client";

export function BffReminderHost({scopeKey,principalId,onOpen,children}:{scopeKey:string;principalId:string;
  onOpen:(channelId:string,target:{eventId:string;threadRootId:string|null})=>Promise<void>;children:ReactNode}) {
  const profile=useQuery({queryKey:["platform",scopeKey,"own-profile"],queryFn:()=>bff.profile(),retry:false});
  const lifetime=useMemo(()=>({active:true}),[scopeKey,profile.data?.pubkey]);
  useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false;};},[lifetime]);
  const host=useMemo<ReminderHost>(()=>{
    const check=()=>{if(!lifetime.active||!profile.data?.pubkey)throw new TransportError("Reminder identity unavailable");};
    return {scopeKey,pubkey:profile.data?.pubkey??"",
      query:async()=>{check();const page=await queryReminders();check();if(page.pubkey!==profile.data!.pubkey||!Array.isArray(page.reminders))throw new TransportError("Reminder identity changed");return page.reminders;},
      publish:async(request,key)=>{check();const receipt=await publishReminder(request,key);check();return receipt;},
      source:async(target)=>{
        check();const {event}=await reminderSource({channelId:target.channelId,eventId:target.eventId});check();
        const workspace=(await loadChannelDirectory(bff,()=>lifetime.active,target.channelId))[0];check();
        const conversation=workspace?undefined:(await loadInboxConversations(bff,()=>lifetime.active)).find(c=>c.channelId===target.channelId&&c.state==="ACTIVE"&&c.participantPrincipalIds.includes(principalId));check();
        if(!workspace?.isMember&&!conversation)throw new TransportError("Reminder source unavailable");
        const author=await (conversation?bff.conversationMessageAuthorProfile(conversation.id,event.id):bff.messageAuthorProfile(workspace!.id,event.id));check();
        if(author.pubkey!==event.pubkey)throw new TransportError("Reminder author mismatch");
        const participants=conversation?resolveConversationHeaderParticipants(conversation,principalId,await loadConversationPeople(bff,check)):null;check();
        if(conversation&&!participants)throw new TransportError("Reminder conversation participants unavailable");
        return {authorLabel:author.displayName||truncatePubkey(author.pubkey),avatarUrl:author.avatarUrl?author.avatarMediaPaths[author.avatarUrl]??null:null,
          channel:{channelType:conversation?"dm":workspace!.channel.channelType},channelLabel:conversation?formatDmParticipantDisplayName(participants!):workspace!.channel.name};
      },
      navigate:async(target)=>{check();const {event}=await reminderSource({channelId:target.channelId,eventId:target.eventId});check();
        await onOpen(target.channelId,{eventId:event.id,threadRootId:getThreadReference(event.tags).rootId});check();},
    };
  },[scopeKey,principalId,profile.data,lifetime,onOpen]);
  return <ReminderHostProvider host={host}><RemindMeLaterProvider pubkey={host.pubkey}>{children}</RemindMeLaterProvider></ReminderHostProvider>;
}
