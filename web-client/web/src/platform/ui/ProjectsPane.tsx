import {useCallback,useEffect,useMemo} from "react";
import {ChannelLoadingFallback} from "@client-kit/platform/react/messages/ChannelLoadingFallback";
import {ProjectsView,createProjectsGitHost,mergeSelectionDiscussDraft,type ProjectsHost,type ProjectWorkItemTarget,type ProjectChannelRenderer,
  type ProjectAgentChatHost,type ProjectAgentConversationEvent} from "@client-kit/platform/react/projects";
import {PulsePane} from "./PulsePane";
import {queryProjects,publishProject,queryProjectsGit,refProjectsGit,mergeProjectsGit,publishMessage,queryAgentMentionOutcomes} from "../bff-client";
import {TransportError} from "@client-kit/platform/transport";
import {WorkspaceChannelCreateChannelType,WorkspaceMembershipState,PlatformSessionAccessMode,type DiscoverableWorkspace} from "@client-kit/contracts";
import {loadChannelDirectory} from "@client-kit/platform/react/channel-browser/loadChannelDirectory";
import {initDraftStore,loadDraftEntry,saveDraftEntry} from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useBffClient,useCurrentPrincipalId,useUiT} from "@client-kit/platform/react/context";
import type {IdleAuxiliaryProps} from "@client-kit/platform/react/thread";

function ProjectHomeChannel({scopeKey,workspace,renderChannel,auxiliary}:{scopeKey:string;workspace:DiscoverableWorkspace;renderChannel:ProjectChannelRenderer;auxiliary?:IdleAuxiliaryProps}) {
  const client=useBffClient();const principalId=useCurrentPrincipalId();const t=useUiT();
  const cache=useQueryClient();
  const key=useMemo(()=>["platform","channel-descriptor",principalId,workspace.id,scopeKey],[principalId,workspace.id,scopeKey]);
  // Reuse ChannelPane's live-revocation invalidation key and the ordinary
  // channel descriptor read, not a project-announcement-derived descriptor.
  const descriptor=useQuery({queryKey:key,enabled:Boolean(principalId),
    queryFn:()=>client.workspaceChannel(workspace.id),retry:false,refetchOnMount:"always",refetchOnWindowFocus:"always"});
  useEffect(()=>()=>{void cache.cancelQueries({queryKey:key});cache.removeQueries({queryKey:key});},[cache,key]);
  if(!principalId)return <p role="alert">{t("platform.loadFailed")}</p>;
  if(descriptor.isPending||descriptor.isFetching)return <ChannelLoadingFallback/>;
  if(descriptor.isError||!descriptor.data||descriptor.data.channelId!==workspace.channel.channelId
    ||descriptor.data.channelType!==workspace.channel.channelType||typeof descriptor.data.archived!=="boolean"||typeof descriptor.data.name!=="string")
    return <p role="alert">{t("projects.home.channelMissing")}</p>;
  return <>{renderChannel({...workspace,channel:descriptor.data},auxiliary)}</>;
}

export function useProjectsHost(scopeKey:string){
  const scope=useMemo(()=>({active:true}),[scopeKey]);
  useEffect(()=>{scope.active=true;return()=>{scope.active=false;};},[scope]);
  const host=useMemo<ProjectsHost>(()=>({scopeKey,query:async request=>{
    if(!scope.active)throw new Error("Project scope changed");
    const page=await queryProjects(request);
    if(!scope.active)throw new Error("Project scope changed");
    return page;
  },publish:async(request,key)=>{
    if(!scope.active)throw new TransportError("Project scope changed");
    const receipt=await publishProject(request,key);
    if(!scope.active)throw new TransportError("Project scope changed");
    return receipt;
  },git:createProjectsGitHost(async request=>{
    if(!scope.active)throw new Error("Project scope changed");
    const response=await queryProjectsGit(request);
    if(!scope.active)throw new Error("Project scope changed");
    return response;
  },async(request,key)=>{
    // A write that may have been sent is UNKNOWN, never a plain failure.
    if(!scope.active)throw new Error("Project scope changed");
    const result=await refProjectsGit(request,key);
    if(!scope.active)throw new TransportError("Project scope changed");
    return result;
  },async(request,key)=>{
    // Same rule for the owner's merge: once it may have been sent, a scope change is UNKNOWN.
    if(!scope.active)throw new Error("Project scope changed");
    const result=await mergeProjectsGit(request,key);
    if(!scope.active)throw new TransportError("Project scope changed");
    return result;
  })}),[scopeKey,scope]);
  return host;
}

/** Use the ordinary Web Composer's principal/origin/workspace draft namespace. */
export function useProjectDiscussInChannel(scopeKey:string,onOpenChannel?: (workspace:DiscoverableWorkspace)=>void|Promise<void>){
  const client=useBffClient();const principalId=useCurrentPrincipalId();const t=useUiT();
  const scope=useMemo(()=>({active:true}),[scopeKey,client,principalId]);
  useEffect(()=>{scope.active=true;return()=>{scope.active=false;};},[scope]);
  return useCallback(async(workspace:DiscoverableWorkspace,content:string)=>{
    const check=()=>{if(!scope.active||!principalId||!onOpenChannel)throw new Error(t("platform.loadFailed"));};check();
    const rows=await loadChannelDirectory(client,()=>scope.active,workspace.channel.channelId);check();
    const current=rows.find(row=>row.id===workspace.id&&row.isMember&&row.membershipState===WorkspaceMembershipState.Active
      &&row.channel.channelType===WorkspaceChannelCreateChannelType.Stream&&!row.channel.archived);
    if(!current)throw new Error(t("projects.home.channelMissing"));
    const descriptor=await client.workspaceChannel(current.id);check();
    if(descriptor.channelId!==current.channel.channelId||descriptor.channelType!==WorkspaceChannelCreateChannelType.Stream||descriptor.archived!==false)
      throw new Error(t("projects.home.channelMissing"));
    const session=await client.session({fresh:true});check();
    if(session.accessMode!==PlatformSessionAccessMode.Full||session.tenantPrincipalId!==principalId
      ||`${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`!==scopeKey)throw new Error(t("platform.loadFailed"));
    initDraftStore(principalId!,window.location.origin);
    const existing=loadDraftEntry(current.id);
    if(existing?.sendIntent)throw new Error(t("platform.loadFailed"));
    const merged=mergeSelectionDiscussDraft(existing?.content,content);const now=new Date().toISOString();
    saveDraftEntry(current.id,{...existing,channelId:current.id,content:merged,createdAt:existing?.createdAt??now,updatedAt:now,
      selectionStart:merged.length,selectionEnd:merged.length,pendingImeta:existing?.pendingImeta??[],
      mentionRefs:existing?.mentionRefs??[],spoileredAttachmentUrls:existing?.spoileredAttachmentUrls??[],status:"active"});
    await onOpenChannel!({...current,channel:descriptor});
  },[client,principalId,scope,scopeKey,onOpenChannel,t]);
}

const HEX64=/^[0-9a-f]{64}$/;
const CONVERSATION_PAGE_LIMIT=50;

/** Admitted thread page events reduced to the shape the shared conversation consumes. */
function conversationEvents(value:unknown):ProjectAgentConversationEvent[]{
  if(!Array.isArray(value))throw new TransportError("Invalid conversation page");
  return value.flatMap(raw=>{
    if(!raw||typeof raw!=="object")return [];
    const event=raw as Record<string,unknown>;
    const tags=event.tags;
    if(typeof event.id!=="string"||!HEX64.test(event.id)||typeof event.pubkey!=="string"||!HEX64.test(event.pubkey)
      ||typeof event.created_at!=="number"||!Number.isSafeInteger(event.created_at)||typeof event.kind!=="number"||!Number.isSafeInteger(event.kind)
      ||typeof event.content!=="string"||!Array.isArray(tags)||!tags.every(tag=>Array.isArray(tag)&&tag.every(value=>typeof value==="string")))return [];
    return [{id:event.id,pubkey:event.pubkey,created_at:event.created_at,kind:event.kind,content:event.content,tags:tags as string[][]}];
  });
}

/**
 * DD-130 Web transport for the shared project Agent chat: the opener and its thread through the
 * admitted BFF Workspace message reads, and the viewer's message through the ordinary BFF publish
 * with the selected Installation as an explicit mention (agent.invoke admits it). No Agent DM,
 * start, enable or install path exists here.
 */
export function useWebProjectAgentChat(scopeKey:string):ProjectAgentChatHost|undefined{
  // No own-profile read here: the panel's own messages are those of the work-item host identity.
  const client=useBffClient();const principalId=useCurrentPrincipalId();
  const scope=useMemo(()=>({active:true}),[scopeKey,client,principalId]);
  useEffect(()=>{scope.active=true;return()=>{scope.active=false;};},[scope]);
  return useMemo<ProjectAgentChatHost|undefined>(()=>{
    // Tenant and principal of the session scope; the stored pointer outlives a session.
    const [tenantId,scopePrincipal]=scopeKey.split(":");
    if(!principalId||!tenantId||scopePrincipal!==principalId)return undefined;
    const check=()=>{if(!scope.active)throw new Error("Project Agent scope changed");};
    return {identityScope:`${tenantId}:${principalId}`,
      readConversation:async({workspaceId},openerEventId,signal)=>{
        const current=()=>{check();signal.throwIfAborted();};current();
        const root=await client.workspaceMessages(workspaceId,{anchorEventId:openerEventId});current();
        const events=conversationEvents(root.events).filter(event=>event.id===openerEventId);
        let cursor:{createdAt:number;eventId:string}|undefined;
        for(let page=0;page<CONVERSATION_PAGE_LIMIT;page++){
          const replies=await client.workspaceMessages(workspaceId,{parentEventId:openerEventId,
            ...(cursor?{before:cursor.createdAt,beforeId:cursor.eventId}:{})});current();
          events.push(...conversationEvents(replies.events));
          const next=replies.nextCursor;
          if(!next)return events;
          if(cursor&&(next.createdAt<cursor.createdAt||next.createdAt===cursor.createdAt&&next.eventId<=cursor.eventId))
            throw new TransportError("Conversation cursor did not advance");
          cursor=next;
        }
        throw new TransportError("Conversation exceeds the thread read bound");
      },
      send:async(request,key)=>{
        check();
        // An unknown outcome after the request may have been sent stays UNKNOWN (DD-81).
        const receipt=await publishMessage(request.workspaceId,request.content,[],key,[request.installationId],{
          ...(request.parentEventId?{parentEventId:request.parentEventId}:{}),
          ...(request.mentionPubkeys.length?{mentionPubkeys:request.mentionPubkeys}:{})});
        if(!scope.active)throw new TransportError("Project Agent scope changed");
        return receipt;
      },
      mentionOutcomes:async(workspaceId,eventIds)=>{check();const page=await queryAgentMentionOutcomes(workspaceId,eventIds);check();return page;},
    };
  },[client,principalId,scope,scopeKey]);
}

export function ProjectsPane({scopeKey,selectedProjectId,onSelectedProjectChange,onOpenChannel,lastMessageAtByChannelId,workItemTarget,onStartDm,renderChannel}:{scopeKey:string;selectedProjectId?:string|null;onSelectedProjectChange?:(id:string|null,target?:ProjectWorkItemTarget)=>void|Promise<void>;workItemTarget?:ProjectWorkItemTarget;onStartDm:(pubkey:string)=>void;renderChannel:ProjectChannelRenderer;
  onOpenChannel?:(workspace:DiscoverableWorkspace)=>void|Promise<void>;lastMessageAtByChannelId?:ReadonlyMap<string,string|null>}){
  const discuss=useProjectDiscussInChannel(scopeKey,onOpenChannel);
  const agentChat=useWebProjectAgentChat(scopeKey);
  const view=<ProjectsView host={useProjectsHost(scopeKey)} selectedProjectId={selectedProjectId} onSelectedProjectChange={onSelectedProjectChange} workItemTarget={workItemTarget}
    renderWorkItems={(children,viewerPubkey)=><PulsePane scopeKey={scopeKey} onStartDm={onStartDm} viewerPubkey={viewerPubkey}>{children}</PulsePane>}
    renderChannel={(workspace,auxiliary)=><ProjectHomeChannel key={`${scopeKey}:${workspace.id}`} scopeKey={scopeKey} workspace={workspace} renderChannel={renderChannel} auxiliary={auxiliary}/>}
    onOpenChannel={onOpenChannel} onDiscussInChannel={onOpenChannel?discuss:undefined} lastMessageAtByChannelId={lastMessageAtByChannelId}
    agentChat={agentChat}/>;
  return view;
}
