import {useNavigate,useSearch,useRouterState} from "@tanstack/react-router";
import {SidebarProjectsSection,useProjectSidebarMembership,type SidebarProjectChannel} from "@client-kit/platform/react/projects";
import {useUiT} from "@client-kit/platform/react/context";
import {useProjectsHost} from "@/features/platform/ProjectsScreen";
import {useNativeSession} from "@/features/platform/activeCommunity";

export function SidebarProjects({channels,selectedChannelId,onSelectChannel}:{channels:readonly SidebarProjectChannel[];selectedChannelId:string|null;onSelectChannel:(id:string)=>void}){
  const session=useNativeSession();const host=useProjectsHost();const t=useUiT();
  const membership=useProjectSidebarMembership(`${session.facts.communityHost}:${session.devicePubkey}`);
  const search=useSearch({strict:false});const navigate=useNavigate();
  const inProjects=useRouterState({select:state=>state.location.pathname==="/platform/projects"});
  if(!host)return <p role="alert">{t("platform.loadFailed")}</p>;
  return <SidebarProjectsSection host={host} membership={membership} channels={channels} selectedProjectId={inProjects?search.projectId??null:null}
    selectedChannelId={selectedChannelId} onSelectChannel={onSelectChannel}
    onSelectProject={id=>{void navigate({to:"/platform/$section",params:{section:"projects"},search:{projectId:id??undefined}});}}/>;
}
