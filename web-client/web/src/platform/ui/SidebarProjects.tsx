import {SidebarProjectsSection,useProjectSidebarMembership,type SidebarProjectChannel} from "@client-kit/platform/react/projects";
import {useProjectsHost} from "./ProjectsPane";

export function SidebarProjects({scopeKey,channels,selectedProjectId,selectedChannelId,onSelectProject,onSelectChannel}:{
  scopeKey:string;channels:readonly SidebarProjectChannel[];selectedProjectId:string|null;selectedChannelId:string|null;
  onSelectProject:(id:string|null)=>void|Promise<void>;onSelectChannel:(id:string)=>void;
}) {
  const host=useProjectsHost(scopeKey);
  const membership=useProjectSidebarMembership(scopeKey);
  return <SidebarProjectsSection host={host} membership={membership} channels={channels} selectedProjectId={selectedProjectId}
    selectedChannelId={selectedChannelId} onSelectProject={onSelectProject} onSelectChannel={onSelectChannel}/>;
}
