import {lazy,Suspense,useEffect,useMemo} from "react";
import {ProjectsView,type ProjectsHost,type ProjectWorkItemTarget} from "@client-kit/platform/react/projects";
import {PulseScreen} from "./PulseScreen";
import {useUiT} from "@client-kit/platform/react/context";
import {relayClient} from "@/shared/api/relayClient";
import {useNativeSession} from "./activeCommunity";
import {createProjectsPublisher} from "./projectsTransport";
import {useChannelsQuery} from "@/features/channels/hooks";
import {useAppNavigation} from "@/app/navigation/useAppNavigation";
import type {WorkspaceMemberView,DiscoverableWorkspace} from "@client-kit/contracts";
import {UserAvatar} from "@client-kit/platform/react/messages";
import {useUserProfileQuery} from "@/features/profile/hooks";
import {UserProfilePopover} from "@/features/profile/ui/UserProfilePopover";
import {rewriteRelayUrl} from "@/shared/lib/mediaUrl";
import {ViewLoadingFallback} from "@/shared/ui/ViewLoadingFallback";
import {useIdentityQuery} from "@/shared/api/hooks";
import {useProfileQuery} from "@/features/profile/hooks";
import {useHistorySearchState} from "@/shared/hooks/useHistorySearchState";

const EMPTY_TARGET_MESSAGE_EVENTS: import("@/shared/api/types").RelayEvent[] = [];
const ChannelScreen=lazy(async()=>({default:(await import("@/features/channels/ui/ChannelScreen")).ChannelScreen}));

function ProjectHomeChannel({workspace}:{workspace:DiscoverableWorkspace}) {
  const session=useNativeSession();const t=useUiT();
  const channels=useChannelsQuery();const identity=useIdentityQuery();const profile=useProfileQuery();
  const {values}=useHistorySearchState(["autoSend","messageId"] as const);
  const currentIdentity=identity.data?.pubkey===session.devicePubkey?identity.data:undefined;
  const channel=channels.isSuccess&&!channels.isFetching?channels.data?.find(item=>
    item.id===workspace.channel.channelId&&item.channelType===workspace.channel.channelType&&item.isMember
      &&Boolean(item.archivedAt)===workspace.channel.archived):undefined;
  if(channels.isPending||channels.isFetching||identity.isPending)return <p role="status">{t("platform.loading")}</p>;
  if(!channel||!currentIdentity)return <p role="alert">{t("projects.home.channelMissing")}</p>;
  return <Suspense fallback={<ViewLoadingFallback kind="channel"/>}><ChannelScreen activeChannel={channel} currentIdentity={currentIdentity}
    currentProfile={profile.data} autoSendDraftKey={values.autoSend} targetMessageEvents={EMPTY_TARGET_MESSAGE_EVENTS} targetMessageId={values.messageId}/></Suspense>;
}

function ProjectMemberIdentity({member,trigger}:{member:WorkspaceMemberView;trigger:{className:string;label:string}}){
  const session=useNativeSession();const t=useUiT();const pubkey=member.pubkeys[0]!;
  const profile=useUserProfileQuery(pubkey,`${session.facts.communityHost}:${session.devicePubkey}`);
  const data=profile.isSuccess&&!profile.isFetching&&profile.data.pubkey===pubkey?profile.data:undefined;
  return <UserProfilePopover pubkey={pubkey} triggerClassName={trigger.className} triggerElement="span"
    triggerAriaLabel={t("members.openProfile",{name:trigger.label})}>
    <span className="relative z-10" title={trigger.label}><UserAvatar avatarUrl={data?.avatarUrl??null}
      displayName={data?.displayName??trigger.label} resolveMediaUrl={rewriteRelayUrl} shape="circle" size="xs"/></span>
  </UserProfilePopover>;
}

/** Native CLIENT still queries the original Relay, never the Web SERVER signer. */
export function useProjectsHost(){
  const session=useNativeSession();
  const scope=useMemo(()=>({active:true}),[session]);
  useEffect(()=>{scope.active=true;return()=>{scope.active=false;};},[scope]);
  const limit=session.facts.relayQueryLimit;
  const host=useMemo<ProjectsHost|null>(()=>{
    if(!limit||!Number.isSafeInteger(limit)||limit<1)return null;
    const check=()=>{if(!scope.active)throw new Error("Project identity changed");};
    const scopeKey=`${session.facts.communityHost}:${session.devicePubkey}`;
    return {scopeKey,publish:createProjectsPublisher(scopeKey,session.facts.relayUrl,session.devicePubkey,()=>scope.active,session.client),
      completePublication:(key,eventId)=>{check();relayClient.completeProjectIntent(`${scopeKey}:${key}`,session.facts.relayUrl,eventId);},query:async request=>{
      check();const kinds=request.view==="PROJECTS"?[30621]:request.view==="REPOSITORIES"?[30617]:request.view==="DELETIONS"?[5]
        :request.view==="WORK_ITEMS"?[1618,1621]:request.view==="WORK_ITEM_ACTIVITY"?[1,1619,1630,1631,1632,1633]:null;
      const coordinateScoped=request.view!=="PROJECTS"&&request.view!=="REPOSITORIES";
      if(kinds===null||coordinateScoped&&(!request.coordinates?.length||request.coordinates.length>limit||
        new Set(request.coordinates).size!==request.coordinates.length||request.coordinates.some(value=>
          !(request.view==="DELETIONS"?/^(30617|30621):[0-9a-f]{64}:.+$/:/^30617:[0-9a-f]{64}:.+$/).test(value)))
        ||!coordinateScoped&&request.coordinates!==undefined)throw new Error("Invalid project query");
      const events=await relayClient.fetchEvents({kinds,limit,since:request.since,until:request.until,
        ...(request.coordinates?{"#a":request.coordinates}:{})});
      check();if(events.length>limit||events.some(event=>!kinds.includes(event.kind)||
        request.coordinates&&!event.tags.some(tag=>tag[0]==="a"&&request.coordinates!.includes(tag[1]??""))))throw new Error("Invalid project response");
      return {events,limit,pubkey:session.devicePubkey};
    }};
  },[session,scope,limit]);
  return host;
}
export function ProjectsScreen({selectedProjectId,onSelectedProjectChange,workItemTarget}:{selectedProjectId?:string|null;onSelectedProjectChange?:(id:string|null,target?:ProjectWorkItemTarget)=>void|Promise<void>;workItemTarget?:ProjectWorkItemTarget}={}){
  const host=useProjectsHost();const t=useUiT();
  const channels=useChannelsQuery();const {goChannel}=useAppNavigation();
  const lastMessageAtByChannelId=useMemo(()=>new Map((channels.isSuccess&&!channels.isFetching&&channels.data?channels.data:[])
    .map(channel=>[channel.id,channel.lastMessageAt])),[channels.data,channels.isSuccess,channels.isFetching]);
  const view=host?<ProjectsView host={host} selectedProjectId={selectedProjectId} onSelectedProjectChange={onSelectedProjectChange} workItemTarget={workItemTarget}
    renderChannel={workspace=><ProjectHomeChannel key={`${host.scopeKey}:${workspace.id}`} workspace={workspace}/>}
    renderWorkItems={children=><PulseScreen>{children}</PulseScreen>}
    lastMessageAtByChannelId={lastMessageAtByChannelId} onOpenChannel={async workspace=>{if(!await goChannel(workspace.channel.channelId))throw new Error("Project channel navigation failed");}}
    renderMember={(member,trigger)=><ProjectMemberIdentity member={member} trigger={trigger}/>}/>:<p role="alert">{t("platform.loadFailed")}</p>;
  return view;
}
