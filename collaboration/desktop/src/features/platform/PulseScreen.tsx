import { useEffect, useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDirectMessageOpen } from "@client-kit/platform/react/new-message";
import { PulseHostProvider, PulseView, usePeopleDirectory, PeopleDirectoryStatus, type PulseHost } from "@client-kit/platform/react/pulse";
import {resolveUserLabel} from "@client-kit/platform/react/messages/system/identity";
import { useT } from "@client-kit/platform/react/context";
import { useNativeSession } from "./activeCommunity";
import { createPulseTransport } from "./pulseTransport";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { Markdown } from "@/shared/ui/markdown";
import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import { channelsQueryKey } from "@/features/channels/hooks";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { channelReferenceQueryKey, useChannelReferences } from "@/features/channels/channelReference";
import { ProjectOriginReferenceContent, type ProjectOriginReferenceProps } from "@client-kit/platform/react/projects";

function NativeProjectOriginReference(props:ProjectOriginReferenceProps) {
  const references=useChannelReferences(props.channelId?[props.channelId]:[]);
  const cache=useQueryClient();const {goChannel}=useAppNavigation();
  const channel=props.channelId?references.channelsById.get(props.channelId):undefined;
  const lookup=props.channelId?cache.getQueryState(channelReferenceQueryKey(props.channelId)):undefined;
  const ready=references.isReady&&(channel!==undefined||lookup?.status==="success");
  return <ProjectOriginReferenceContent {...props} channel={channel} ready={ready} onOpenChannel={id=>{void goChannel(id);}}/>;
}

export function PulseScreen({children}:{children?:ReactNode}={}) {
  const session=useNativeSession();const navigate=useNavigate();const t=useT();
  const cache=useQueryClient();
  const platformSession=useQuery({queryKey:["platform","session"],queryFn:()=>session.client.session()});
  const directMessage=useDirectMessageOpen(platformSession.data?.tenantPrincipalId??"");
  const scope=useMemo(()=>({active:true}),[session]);
  useEffect(()=>{scope.active=true;return()=>{scope.active=false;};},[scope]);
  const limit=session.facts.relayQueryLimit;
  const host=useMemo<PulseHost|null>(()=>{
    if(!limit||!Number.isSafeInteger(limit)||limit<1)return null;
    const transport=createPulseTransport(session.devicePubkey,limit,()=>scope.active);
    return {scopeKey:`${session.facts.communityHost}:${session.devicePubkey}`,pubkey:session.devicePubkey,...transport,
      mediaUrl:rewriteRelayUrl,copy:writeTextToClipboard,
      OriginReference:NativeProjectOriginReference,
      startDm:async(pubkey)=>{
        const check=()=>{if(!scope.active)throw new Error(t("dm.viewInactive"));};
        check();
        const conversation=await directMessage.open(pubkey);
        check();await cache.invalidateQueries({queryKey:channelsQueryKey});check();
        await navigate({to:"/channels/$channelId",params:{channelId:conversation.channelId}});
      },
      renderContent:(content,tags,className)=><Markdown content={content} className={className} imetaByUrl={parseImetaTags(tags??[])} linkPreviewTags={tags}/>,
      renderComposer:(props)=><NativePulseComposer props={props}/>,

    };
  },[session,scope,limit,navigate,t,cache,directMessage.open]);
  if(!host)return <p role="alert">{t("platform.loadFailed")}</p>;
  return <PulseHostProvider host={host}>{children??<PulseView currentPubkey={session.devicePubkey}/>}</PulseHostProvider>;
}

function NativePulseComposer({props}:{props:Parameters<PulseHost["renderComposer"]>[0]}) {
  const session=useNativeSession();const t=useT();
  const directory=usePeopleDirectory(session.facts.communityHost+":"+session.devicePubkey,props.members===undefined);
  const people=props.members?.map(member=>({pubkey:member.pubkey,displayName:resolveUserLabel({pubkey:member.pubkey,profiles:props.profiles,fallbackName:member.displayName}),avatarUrl:props.profiles?.[member.pubkey]?.avatarUrl??null,role:member.role}))??(directory.query.isSuccess?directory.people:[]);
  return <div><MessageComposer surface="forum" compact={props.compact} autocompleteBelow={props.autocompleteBelow}
        containerClassName={props.className} composerHeader={props.header}
        channelName={t("platform.tab.pulse")} disabled={props.disabled} isSending={props.isSending}
        profiles={props.profiles} placeholder={props.placeholder} onCancelReply={props.onCancel}
        toolbarExtraActions={props.onCancel ? <Button type="button" variant="ghost" disabled={props.isSending} onClick={props.onCancel}>{t("platform.cancel")}</Button> : undefined}
        mentionPeople={people}
        onSend={async(content,mentions,mediaTags)=>{
          const attachments=[...parseImetaTags(mediaTags??[]).values()].map(media=>({
            url:media.url,sha256:media.x,type:media.m,size:media.size,dim:media.dim,
            filename:media.filename,displayLabel:media.alt,blurhash:media.blurhash,thumb:media.thumb,duration:media.duration,image:media.image,
          }));
          await props.onSubmit(content,mentions,attachments,true);
        }}/>{props.members===undefined?<PeopleDirectoryStatus directory={directory}/>:null}</div>;
}
