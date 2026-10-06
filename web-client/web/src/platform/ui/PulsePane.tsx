import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PulseHostProvider, PulseView, usePeopleDirectory, PeopleDirectoryStatus, type PulseHost } from "@client-kit/platform/react/pulse";
import { useT } from "@client-kit/platform/react/context";
import { bff, publishPulse, queryPulse, uploadPulseMedia, pulseMediaUrl } from "../bff-client";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { Composer } from "./ChannelPane";

/** The original Pulse surface; only transport/signing/media belong to Web. */
export function PulsePane({scopeKey,onStartDm}:{scopeKey:string;onStartDm:(pubkey:string)=>void}) {
  const t=useT();
  const directory=usePeopleDirectory(scopeKey);
  const profile=useQuery({queryKey:["platform",scopeKey,"own-profile"],queryFn:()=>bff.profile(),retry:false});
  const scope=useMemo(()=>({active:true,media:new Map<string,string>()}),[scopeKey,profile.data?.pubkey]);
  useEffect(()=>{scope.active=true;return()=>{scope.active=false;};},[scope]);
  const host=useMemo<PulseHost>(()=>{
    const check=()=>{if(!scope.active)throw new Error(t("platform.loadFailed"));};
    return {
      scopeKey,pubkey:profile.data?.pubkey??"",
      query:async(request)=>{check();const page=await queryPulse(request);check();
        for(const [url,path] of Object.entries(page.mediaPaths))scope.media.set(url,path);
        return page.events;},
      publish:async(request,key)=>{check();const receipt=await publishPulse(request,key);check();return receipt;},
      copy:(text)=>navigator.clipboard.writeText(text),
      startDm:async(pubkey)=>{check();onStartDm(pubkey);},
      mediaUrl:(url)=>scope.media.get(url)??url,
      renderContent:(content,tags)=><MessageContent content={content} mediaTags={tags} onMediaUrl={pulseMediaUrl}/>,
      renderComposer:(props)=><div className={props.className}>{props.header}<Composer surface="forum"
        disabled={props.disabled||props.isSending} placeholder={props.placeholder} onCancel={props.onCancel}
        mentionPeople={directory.query.isSuccess?directory.people:[]}
        draftIdentity={scopeKey} onUpload={uploadPulseMedia} onMediaUrl={pulseMediaUrl}
        onPublish={async(content,attachments,_key,_agents,mentions)=>{check();return props.onSubmit(content,mentions??[],[...attachments]);}}/><PeopleDirectoryStatus directory={directory}/></div>,
    };
  },[scopeKey,scope,profile.data?.pubkey,onStartDm,t,directory.people,directory.query.isSuccess,directory.query.hasNextPage,directory.query.isFetchingNextPage,directory.query.isError]);
  if(!profile.data||profile.isError)return <p role={profile.isError?"alert":"status"}>{t(profile.isError?"platform.loadFailed":"platform.loading")}</p>;
  return <PulseHostProvider host={host}><PulseView currentPubkey={profile.data.pubkey}/></PulseHostProvider>;
}
