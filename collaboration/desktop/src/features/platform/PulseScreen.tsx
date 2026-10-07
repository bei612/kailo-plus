import { useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PulseHostProvider, PulseView, usePeopleDirectory, PeopleDirectoryStatus, type PulseHost } from "@client-kit/platform/react/pulse";
import { useT } from "@client-kit/platform/react/context";
import { useNativeSession } from "./activeCommunity";
import { createPulseTransport } from "./pulseTransport";
import { MessageComposer } from "@/features/messages/ui/MessageComposer";
import { Markdown } from "@/shared/ui/markdown";
import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";

export function PulseScreen() {
  const session=useNativeSession();const navigate=useNavigate();const t=useT();
  const directory=usePeopleDirectory(session.facts.communityHost+":"+session.devicePubkey);
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
      renderComposer:(props)=><div><MessageComposer surface="forum" compact={props.compact} autocompleteBelow={props.autocompleteBelow}
        containerClassName={props.className} composerHeader={props.header}
        channelName={t("platform.tab.pulse")} disabled={props.disabled} isSending={props.isSending}
        profiles={props.profiles} placeholder={props.placeholder} onCancelReply={props.onCancel}
        toolbarExtraActions={props.onCancel ? <Button type="button" variant="ghost" disabled={props.isSending} onClick={props.onCancel}>{t("platform.cancel")}</Button> : undefined}
        mentionPeople={directory.query.isSuccess?directory.people:[]}
        onSend={async(content,mentions,mediaTags)=>{
          const attachments=[...parseImetaTags(mediaTags??[]).values()].map(media=>({
            url:media.url,sha256:media.x,type:media.m,size:media.size,dim:media.dim,
            filename:media.filename,displayLabel:media.alt,blurhash:media.blurhash,thumb:media.thumb,duration:media.duration,image:media.image,
          }));
          await props.onSubmit(content,mentions,attachments);
        }}/><PeopleDirectoryStatus directory={directory}/></div>,
    };
  },[session,scope,limit,navigate,t,directory.people,directory.query.isSuccess,directory.query.hasNextPage,directory.query.isFetchingNextPage,directory.query.isError]);
  if(!host)return <p role="alert">{t("platform.loadFailed")}</p>;
  return <PulseHostProvider host={host}><PulseView currentPubkey={session.devicePubkey}/></PulseHostProvider>;
}
