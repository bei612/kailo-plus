import {useCallback,useEffect,useMemo} from "react";
import {ChannelLoadingFallback} from "@client-kit/platform/react/messages/ChannelLoadingFallback";
import {ProjectsView,mergeSelectionDiscussDraft,type ProjectsHost,type ProjectWorkItemTarget,type ProjectChannelRenderer} from "@client-kit/platform/react/projects";
import {PulsePane} from "./PulsePane";
import {queryProjects,publishProject} from "../bff-client";
import {TransportError} from "@client-kit/platform/transport";
import {ChannelType,WorkspaceMembershipState,PlatformSessionAccessMode,type DiscoverableWorkspace} from "@client-kit/contracts";
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
  }}),[scopeKey,scope]);
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
      &&row.channel.channelType===ChannelType.Stream&&!row.channel.archived);
    if(!current)throw new Error(t("projects.home.channelMissing"));
    const descriptor=await client.workspaceChannel(current.id);check();
    if(descriptor.channelId!==current.channel.channelId||descriptor.channelType!==ChannelType.Stream||descriptor.archived!==false)
      throw new Error(t("projects.home.channelMissing"));
    const session=await client.session();check();
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

export function ProjectsPane({scopeKey,selectedProjectId,onSelectedProjectChange,onOpenChannel,lastMessageAtByChannelId,workItemTarget,onStartDm,renderChannel}:{scopeKey:string;selectedProjectId?:string|null;onSelectedProjectChange?:(id:string|null,target?:ProjectWorkItemTarget)=>void|Promise<void>;workItemTarget?:ProjectWorkItemTarget;onStartDm:(pubkey:string)=>void;renderChannel:ProjectChannelRenderer;
  onOpenChannel?:(workspace:DiscoverableWorkspace)=>void|Promise<void>;lastMessageAtByChannelId?:ReadonlyMap<string,string|null>}){
  const discuss=useProjectDiscussInChannel(scopeKey,onOpenChannel);
  const view=<ProjectsView host={useProjectsHost(scopeKey)} selectedProjectId={selectedProjectId} onSelectedProjectChange={onSelectedProjectChange} workItemTarget={workItemTarget}
    renderWorkItems={(children,viewerPubkey)=><PulsePane scopeKey={scopeKey} onStartDm={onStartDm} viewerPubkey={viewerPubkey}>{children}</PulsePane>}
    renderChannel={(workspace,auxiliary)=><ProjectHomeChannel key={`${scopeKey}:${workspace.id}`} scopeKey={scopeKey} workspace={workspace} renderChannel={renderChannel} auxiliary={auxiliary}/>}
    onOpenChannel={onOpenChannel} onDiscussInChannel={onOpenChannel?discuss:undefined} lastMessageAtByChannelId={lastMessageAtByChannelId}/>;
  return view;
}
