import {useEffect,useMemo} from "react";
import {ProjectsView,type ProjectsHost} from "@client-kit/platform/react/projects";
import {queryProjects,publishProject} from "../bff-client";
import {TransportError} from "@client-kit/platform/transport";
import type {DiscoverableWorkspace} from "@client-kit/contracts";

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

export function ProjectsPane({scopeKey,selectedProjectId,onSelectedProjectChange,onOpenChannel,lastMessageAtByChannelId}:{scopeKey:string;selectedProjectId?:string|null;onSelectedProjectChange?:(id:string|null)=>void;
  onOpenChannel?:(workspace:DiscoverableWorkspace)=>void|Promise<void>;lastMessageAtByChannelId?:ReadonlyMap<string,string|null>}){
  return <ProjectsView host={useProjectsHost(scopeKey)} selectedProjectId={selectedProjectId} onSelectedProjectChange={onSelectedProjectChange}
    onOpenChannel={onOpenChannel} lastMessageAtByChannelId={lastMessageAtByChannelId}/>;
}
