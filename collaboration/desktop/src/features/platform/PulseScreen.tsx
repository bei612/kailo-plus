import { useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PulseHostProvider, PulseView, type PulseHost } from "@client-kit/platform/react/pulse";
import { useT } from "@client-kit/platform/react/context";
import { useNativeSession } from "./activeCommunity";
import { createPulseTransport } from "./pulseTransport";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { Markdown } from "@/shared/ui/markdown";
import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { writeTextToClipboard } from "@/shared/lib/clipboard";

export function PulseScreen() {
  const session=useNativeSession();const navigate=useNavigate();const t=useT();
  const scope=useMemo(()=>({active:true}),[session]);
  useEffect(()=>{scope.active=true;return()=>{scope.active=false;};},[scope]);
  const limit=session.facts.relayQueryLimit;
  const host=useMemo<PulseHost|null>(()=>{
    if(!limit||!Number.isSafeInteger(limit)||limit<1)return null;
    const transport=createPulseTransport(session.devicePubkey,limit,()=>scope.active);
    return {scopeKey:`${session.facts.communityHost}:${session.devicePubkey}`,pubkey:session.devicePubkey,...transport,
      mediaUrl:rewriteRelayUrl,copy:writeTextToClipboard,
      startDm:async(pubkey)=>{if(!scope.active)throw new Error("Relay identity changed");await navigate({to:"/messages/new",search:{pubkey}});},
      renderContent:(content,tags)=><Markdown content={content} imetaByUrl={parseImetaTags(tags??[])} linkPreviewTags={tags}/>,
      renderComposer:(props)=><div className={props.className}>{props.header}<MessageComposer surface="forum"
        channelName={t("platform.tab.pulse")} disabled={props.disabled} isSending={props.isSending}
        profiles={props.profiles} placeholder={props.placeholder} onCancelReply={props.onCancel}
        onSend={async(content,mentions,mediaTags)=>{
          const attachments=[...parseImetaTags(mediaTags??[]).values()].map(media=>({
            url:media.url,sha256:media.x,type:media.m,size:media.size,dim:media.dim,
            filename:media.filename,displayLabel:media.alt,blurhash:media.blurhash,thumb:media.thumb,duration:media.duration,image:media.image,
          }));
          await props.onSubmit(content,mentions,attachments);
        }}/></div>,
    };
  },[session,scope,limit,navigate,t]);
  if(!host)return <p role="alert">{t("platform.loadFailed")}</p>;
  return <PulseHostProvider host={host}><PulseView currentPubkey={session.devicePubkey}/></PulseHostProvider>;
}
