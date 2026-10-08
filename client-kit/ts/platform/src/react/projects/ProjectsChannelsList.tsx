// Original Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectsChannelsList.tsx. Keep the original
// project/repository grouping, search, activity ordering and row presentation.
// Directory, Principal roster and navigation are governed host adapters.
import { FolderKanban, Hash, LockKeyhole } from "lucide-react";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { WorkspaceMembershipState, type DiscoverableWorkspace } from "@client-kit/contracts";
import { useBffClient, useUiT } from "../context";
import { loadChannelDirectory } from "../channel-browser/loadChannelDirectory";
import { TransportError } from "../../transport";
import { MemberProfilePanel } from "../members";
import type { Project } from "./projectModels";
import { collapseProjectRelatedChannelRows, collectProjectRelatedChannelRows, projectRelatedChannelDisplayRowKey } from "./lib/projectRelatedChannels";
import { matchesProjectsSearch } from "./lib/projectsSearch";
import { listRowDescription } from "./lib/projectsViewHelpers";
import { ProjectEntityListRow } from "./ProjectEntityListRow";
import { ProjectSelectableGroup } from "./ProjectSelectableGroup";
import { ProjectPanelState } from "./ProjectPanelState";
import { ProjectChannelMembers, type ProjectMemberRenderer } from "./ProjectChannelMembers";

function lastMessageAtSeconds(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1_000) : null;
}

export function ProjectsChannelsList({projects,scopeKey,searchQuery="",lastMessageAtByChannelId,onOpenChannel,renderMember}:{
  projects:Project[];scopeKey:string;searchQuery?:string;
  lastMessageAtByChannelId?:ReadonlyMap<string,string|null>;
  onOpenChannel:(workspace:DiscoverableWorkspace)=>void|Promise<void>;
  renderMember?:ProjectMemberRenderer;
}) {
  const client=useBffClient();const t=useUiT();
  const lifetime=React.useMemo(()=>({active:true}),[scopeKey,client]);
  React.useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false;};},[lifetime]);
  const [selectedProfile,setSelectedProfile]=React.useState<{workspaceId:string;principalId:string;pubkey:string}|null>(null);
  const [navigationFailed,setNavigationFailed]=React.useState(false);
  const [opening,setOpening]=React.useState(false);
  const running=React.useRef(false);
  const channelsQuery=useQuery({queryKey:["projects-channels",scopeKey],queryFn:({signal})=>loadChannelDirectory(client,()=>lifetime.active&&!signal.aborted),
    enabled:projects.length>0,retry:false,refetchOnWindowFocus:"always"});
  // Do not retain a last-known directory while fresh authorization is pending
  // or failed. A signed project link is not membership evidence.
  const channelsById=React.useMemo(()=>new Map(
    (channelsQuery.isSuccess&&!channelsQuery.isFetching?channelsQuery.data:[])
      .filter(channel=>channel.isMember&&channel.membershipState===WorkspaceMembershipState.Active)
      .map(channel=>[channel.channel.channelId,channel])),[channelsQuery.data,channelsQuery.isSuccess,channelsQuery.isFetching]);
  const rows=React.useMemo(()=>collapseProjectRelatedChannelRows(collectProjectRelatedChannelRows(projects))
    .filter(row=>{
      const channel=channelsById.get(row.channelId);
      return matchesProjectsSearch(searchQuery,[channel?.channel.name,channel?.channel.description,row.projectName,...row.repositoryNames]);
    }).sort((left,right)=>{
      const leftChannel=channelsById.get(left.channelId),rightChannel=channelsById.get(right.channelId);
      const leftName=leftChannel?.channel.name??t("projects.channels.unavailable"),rightName=rightChannel?.channel.name??t("projects.channels.unavailable");
      const leftActivity=leftChannel?lastMessageAtSeconds(lastMessageAtByChannelId?.get(left.channelId))??0:0;
      const rightActivity=rightChannel?lastMessageAtSeconds(lastMessageAtByChannelId?.get(right.channelId))??0:0;
      return rightActivity-leftActivity||leftName.localeCompare(rightName)||left.projectName.localeCompare(right.projectName)
        ||left.repositoryNames.join(",").localeCompare(right.repositoryNames.join(","))||left.channelId.localeCompare(right.channelId);
    }),[channelsById,projects,searchQuery,lastMessageAtByChannelId,t]);
  const groups=React.useMemo(()=>{
    const grouped=new Map<string,{projectId:string;projectName:string;rows:typeof rows}>();
    for(const row of rows){const existing=grouped.get(row.projectId);if(existing)existing.rows.push(row);
      else grouped.set(row.projectId,{projectId:row.projectId,projectName:row.projectName,rows:[row]});}
    return [...grouped.values()];
  },[rows]);
  const open=async(channel:DiscoverableWorkspace)=>{
    if(running.current||!lifetime.active)return;
    running.current=true;setOpening(true);setNavigationFailed(false);
    try{
      const current=(await loadChannelDirectory(client,()=>lifetime.active)).find(item=>item.id===channel.id&&item.channel.channelId===channel.channel.channelId);
      if(!current?.isMember||current.membershipState!==WorkspaceMembershipState.Active)throw new TransportError("Project channel membership changed");
      if(lifetime.active)await onOpenChannel(current);
    }catch{if(lifetime.active){setNavigationFailed(true);void channelsQuery.refetch();}}
    finally{running.current=false;if(lifetime.active)setOpening(false);}
  };
  if(projects.length>0&&(channelsQuery.isPending||channelsQuery.isFetching))return <ProjectPanelState panel={false} title={t("projects.channels.loading")}/>;
  if(channelsQuery.isError)return <ProjectPanelState panel={false} error title={t("platform.loadFailed")}/>;
  if(rows.length===0)return <ProjectPanelState panel={false} title={t(searchQuery.trim()?"projects.channels.noMatch":"projects.channels.empty")}
    description={t(searchQuery.trim()?"projects.channels.searchHint":"projects.channels.emptyHint")}/>;
  const activeProfile=selectedProfile&&[...channelsById.values()].some(channel=>channel.id===selectedProfile.workspaceId)?selectedProfile:null;
  return <div className="flex min-h-0 min-w-0 flex-1">
    <div className="min-w-0 flex-1 space-y-2" data-testid="projects-channels-list" aria-busy={opening}>
      {navigationFailed?<p role="alert">{t("platform.loadFailed")}</p>:null}
      {groups.map(group=><ProjectSelectableGroup count={group.rows.length} groupKey={group.projectId} headerClassName="mx-0 gap-3 px-4"
        headerTestId="projects-channel-project-group-header" icon={<FolderKanban className="h-4 w-4"/>} key={group.projectId}
        label={group.projectName} labelTestId="project-channel-project" testId="projects-channel-project-group">
        <ul className="space-y-0.5">{group.rows.map(row=>{
          const channel=channelsById.get(row.channelId);const name=channel?.channel.name??t("projects.channels.unavailable");
          const repositoryLabel=row.repositoryNames.length===0?t("projects.channels.projectChannel"):row.repositoryNames.length===1?row.repositoryNames[0]:t("projects.repositoryCount",{count:row.repositoryNames.length});
          return <li key={projectRelatedChannelDisplayRowKey(row)}><ProjectEntityListRow
            affiliation={<span data-testid="project-channel-repository">{repositoryLabel}</span>} affiliationTitle={`${group.projectName} · ${repositoryLabel}`}
            count={channel?.memberCount} countTestId="project-channel-message-count" countTitle={channel?t(channel.memberCount===1?"channel.browser.members.one":"channel.browser.members.other",{count:channel.memberCount}):undefined}
            dateSeconds={channel?lastMessageAtSeconds(lastMessageAtByChannelId?.get(row.channelId)):null} dateTestId="project-channel-row-date"
            description={channel?listRowDescription(channel.channel.description,name):t("projects.channels.detailsUnavailable")}
            icon={channel?<Hash className="h-3.5 w-3.5 text-muted-foreground/70"/>:<LockKeyhole className="h-3.5 w-3.5 text-muted-foreground/55"/>}
            onClick={channel&&!opening?()=>{void open(channel);}:undefined}
            peopleSlot={channel?<ProjectChannelMembers workspaceId={channel.id} scopeKey={scopeKey} onOpenProfile={setSelectedProfile} renderMember={renderMember}/>:undefined}
            peopleTestId="project-channel-participants" testId="project-channel-row" title={channel?`#${name}`:name}
            titleAttr={channel?t("projects.channels.open",{name}):undefined}/></li>;
        })}</ul>
      </ProjectSelectableGroup>)}
    </div>
    {activeProfile?<MemberProfilePanel target={activeProfile} onClose={()=>setSelectedProfile(null)}/>:null}
  </div>;
}
