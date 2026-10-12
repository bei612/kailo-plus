import { useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { PulseHostProvider, PulseView, usePeopleDirectory, PeopleDirectoryStatus, type PulseHost } from "@client-kit/platform/react/pulse";
import { useT } from "@client-kit/platform/react/context";
import { bff, publishPulse, queryPulse, uploadPulseMedia, pulseMediaUrl } from "../bff-client";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { Composer } from "./ChannelPane";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { usePulseHost } from "@client-kit/platform/react/pulse";
import { ProjectOriginReferenceContent, type ProjectOriginReferenceProps } from "@client-kit/platform/react/projects";
import { loadChannelDirectory } from "@client-kit/platform/react/channel-browser/loadChannelDirectory";
import { useBffChannelLinkRuntime } from "@/features/chat/ui/BffMessageLinkHost";
import { toast } from "sonner";
import {resolveUserLabel} from "@client-kit/platform/react/messages/system/identity";

function BffProjectOriginReference(props:ProjectOriginReferenceProps) {
  const {scopeKey}=usePulseHost();const t=useT();
  const runtime=useBffChannelLinkRuntime();
  const lifetime=useMemo(()=>({active:true}),[scopeKey]);
  useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false;};},[lifetime]);
  const query=useQuery({queryKey:["project-origin",scopeKey,props.channelId],enabled:Boolean(props.channelId),retry:false,
    refetchOnWindowFocus:"always",queryFn:({signal})=>loadChannelDirectory(bff,()=>lifetime.active&&!signal.aborted,props.channelId!)});
  const found=query.isSuccess&&!query.isFetching?query.data[0]:undefined;
  const channel=found?{id:found.channel.channelId,name:found.channel.name,visibility:found.visibility,isMember:found.isMember}:undefined;
  const open=(channelId:string)=>{void (async()=>{
    const fresh=await query.refetch();
    const current=fresh.data?.find(item=>item.channel.channelId===channelId);
    if(!lifetime.active||fresh.isError||!current||!(current.isMember||current.visibility==="open"))throw new Error("Origin channel unavailable");
    runtime.onOpenChannel(channelId);
  })().catch(()=>{if(lifetime.active)toast.error(t("platform.linkChannelUnavailable"));});};
  return <ProjectOriginReferenceContent {...props} channel={channel} ready={query.isSuccess&&!query.isFetching} onOpenChannel={open}/>;
}

/** The original Pulse surface; only transport/signing/media belong to Web. */
export function PulsePane({scopeKey,onStartDm,children,viewerPubkey}:{scopeKey:string;onStartDm:(pubkey:string)=>void|Promise<void>;children?:ReactNode;viewerPubkey?:string}) {
  const t=useT();
  const profile=useQuery({queryKey:["platform",scopeKey,"own-profile"],queryFn:()=>bff.profile(),retry:false,enabled:viewerPubkey===undefined});
  const pubkey=viewerPubkey??profile.data?.pubkey;
  const scope=useMemo(()=>({active:true,media:new Map<string,string>()}),[scopeKey,pubkey]);
  useEffect(()=>{scope.active=true;return()=>{scope.active=false;};},[scope]);
  const host=useMemo<PulseHost>(()=>{
    const check=()=>{if(!scope.active)throw new Error(t("platform.loadFailed"));};
    return {
      scopeKey,pubkey:pubkey??"",
      query:async(request)=>{check();const page=await queryPulse(request);check();
        for(const [url,path] of Object.entries(page.mediaPaths))scope.media.set(url,path);
        return page.events;},
      publish:async(request,key)=>{check();const receipt=await publishPulse(request,key);check();return receipt;},
      copy:writeTextToClipboard,
      OriginReference:BffProjectOriginReference,
      startDm:async(pubkey)=>{check();await onStartDm(pubkey);check();},
      mediaUrl:(url)=>scope.media.get(url)??url,
      renderContent:(content,tags,className)=><MessageContent content={content} className={className} mediaTags={tags} onMediaUrl={pulseMediaUrl}/>,
      renderComposer:(props)=><BffPulseComposer props={props} scopeKey={scopeKey} check={check}/>,
    };
  },[scopeKey,scope,pubkey,onStartDm,t]);
  if(!pubkey||viewerPubkey===undefined&&profile.isError)return <p role={profile.isError?"alert":"status"}>{t(profile.isError?"platform.loadFailed":"platform.loading")}</p>;
  return <PulseHostProvider host={host}>{children??<PulseView currentPubkey={pubkey}/>}</PulseHostProvider>;
}

function BffPulseComposer({props,scopeKey,check}:{props:Parameters<PulseHost["renderComposer"]>[0];scopeKey:string;check:()=>void}) {
  const directory=usePeopleDirectory(scopeKey,props.members===undefined);
  const people=props.members?.map(member=>({pubkey:member.pubkey,displayName:resolveUserLabel({pubkey:member.pubkey,profiles:props.profiles,fallbackName:member.displayName}),avatarUrl:props.profiles?.[member.pubkey]?.avatarUrl??null,role:member.role}))??(directory.query.isSuccess?directory.people:[]);
  return <div><Composer surface="forum" compact={props.compact} autocompleteBelow={props.autocompleteBelow}
    containerClassName={props.className} composerHeader={props.header}
    disabled={props.disabled||props.isSending} placeholder={props.placeholder} onCancel={props.onCancel}
    mentionPeople={people}
    draftIdentity={scopeKey} onUpload={uploadPulseMedia} onMediaUrl={pulseMediaUrl}
    onPublish={async(content,attachments,_key,_agents,mentions)=>{check();return props.onSubmit(content,mentions??[],[...attachments],false);}}/>{props.members===undefined?<PeopleDirectoryStatus directory={directory}/>:null}</div>;
}
