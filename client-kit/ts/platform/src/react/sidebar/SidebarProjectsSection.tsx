// REQ-24/DD-40. Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/sidebar/ui/SidebarProjectsSection.tsx. Original section,
// row, expansion, filter/sort and browse layout; data/navigation are host seams.
import * as React from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {ArrowUpDown,ChevronDown,ChevronRight,EllipsisVertical,Folder,Folders,Hash,ListMinus,Lock,Plus,Trash2} from "lucide-react";
import {useBffClient,useUiT} from "../context";
import {CreateActionKey} from "@client-kit/contracts";
import {useCreateProject} from "../projects/useCreateProject";
import {cn} from "../profile/buzz/shared/lib/cn";
import {loadProjectDirectory,type ProjectsHost} from "../projects/projectEnumeration";
import {ProjectBrowserDialog} from "../projects/ProjectBrowserDialog";
import {ProjectChannelIcon} from "../projects/ProjectChannelIcon";
import {ProjectDeleteAction} from "../projects/ProjectDeleteAction";
import {listProjectChildChannels} from "../projects/lib/projectRelatedChannels";
import {SidebarGroup,SidebarGroupContent,SidebarGroupLabel,SidebarMenu,SidebarMenuAction,SidebarMenuButton,SidebarMenuItem} from "./sidebar";
import {SidebarMenuLabel} from "./sidebar-menu-label";
import {SECTION_ICON_BUTTON_CLASS,SECTION_ACTION_VISIBILITY_CLASS} from "./sidebarSectionStyles";
import {ContextMenuIconSlot,deferMenuAction} from "./sidebarMenuHelpers";
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuSeparator,DropdownMenuSub,DropdownMenuSubContent,DropdownMenuSubTrigger,DropdownMenuTrigger} from "./dropdown-menu";
import {ContextMenu,ContextMenuContent,ContextMenuItem,ContextMenuSeparator,ContextMenuTrigger} from "./context-menu";
import {listSidebarProjects,readSidebarProjectExpansion,readSidebarProjectsFilter,readSidebarProjectsSort,writeSidebarProjectExpansion,writeSidebarProjectsFilter,writeSidebarProjectsSort,type SidebarProjectsFilter,type SidebarProjectsSort} from "./listSidebarProjects";

export type SidebarProjectMembership = {
  projectAddresses:readonly string[]; pending:boolean; problem?:string;
  addProject:(address:string)=>Promise<void>; removeProject:(address:string)=>Promise<void>; refresh:()=>Promise<unknown>;
};
export type SidebarProjectChannel = {id:string;name:string;visibility?:string};
export type SidebarProjectsSectionProps = {
  host:ProjectsHost; membership:SidebarProjectMembership;
  channels:readonly SidebarProjectChannel[]; selectedProjectId?:string|null; selectedChannelId?:string|null;
  onSelectProject:(id:string|null)=>void|Promise<void>; onSelectChannel:(id:string)=>void;
};
const SECTION_LABEL_BUTTON_CLASS="group/section-label flex w-fit max-w-[calc(100%-3rem)] cursor-pointer appearance-none items-center gap-1 text-left transition-colors hover:text-sidebar-foreground focus-visible:text-sidebar-foreground";
const SECTION_LABEL_CHEVRON_CLASS="relative size-2.5 shrink-0 text-current opacity-0 transition-[color,opacity] group-hover/sidebar-section:opacity-100 group-hover/section-label:opacity-100 group-focus-within/sidebar-section:opacity-100 group-focus-visible/section-label:opacity-100 group-data-[section-actions-open=true]/sidebar-section:opacity-100";
const SECTION_LABEL_CHEVRON_ICON_CLASS="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2";

export function SidebarProjectsSection(props:SidebarProjectsSectionProps){
  return <SidebarProjectsContent key={props.host.scopeKey} {...props}/>;
}
function SidebarProjectsContent({host,membership,channels,selectedProjectId,selectedChannelId,onSelectProject,onSelectChannel}:SidebarProjectsSectionProps){
  const t=useUiT();const cache=useQueryClient();
  const [collapsed,setCollapsed]=React.useState(false);
  const [actionsOpen,setActionsOpen]=React.useState(false);
  const [browserOpen,setBrowserOpen]=React.useState(false);
  const [navigationFailed,setNavigationFailed]=React.useState<"created"|"open"|null>(null);
  const client=useBffClient();
  const creation=useCreateProject(host);
  const createCapability=useQuery({queryKey:["project-create-capability",host.scopeKey],queryFn:()=>client.roleWorkspaces(),enabled:browserOpen,retry:false});
  const lifetime=React.useMemo(()=>({active:true}),[host]);
  React.useEffect(()=>{lifetime.active=true;return()=>{lifetime.active=false;};},[lifetime]);
  const selectProject=async(id:string|null,created=false)=>{
    if(!lifetime.active)return;
    try { await onSelectProject(id); if(lifetime.active)setNavigationFailed(null); }
    catch { if(lifetime.active)setNavigationFailed(created?"created":"open"); }
  };
  // Only local layout preferences use localStorage. Added membership is always
  // the existing platform user-state projection, never NIP-78 or local storage.
  const [filter,setFilter]=React.useState(()=>readSidebarProjectsFilter(host.scopeKey));
  const [sort,setSort]=React.useState(()=>readSidebarProjectsSort(host.scopeKey));
  const [expansion,setExpansion]=React.useState(()=>readSidebarProjectExpansion(host.scopeKey));
  const query=useQuery({queryKey:["sidebar-projects",host.scopeKey],queryFn:({signal})=>loadProjectDirectory(host,signal),retry:false,refetchOnWindowFocus:"always"});
  React.useEffect(()=>()=>{void cache.cancelQueries({queryKey:["sidebar-projects",host.scopeKey]});cache.removeQueries({queryKey:["sidebar-projects",host.scopeKey]});},[cache,host.scopeKey]);
  const allProjects=query.isSuccess&&!query.isFetching?query.data.projects:[];
  const addresses=new Set(membership.projectAddresses);
  const projects=listSidebarProjects({projects:allProjects,currentPubkey:query.data?.viewerPubkey,filter,sort,addedProjectAddresses:addresses});
  const channelsById=new Map(channels.map(channel=>[channel.id,channel]));
  const actionsTriggerRef=React.useRef<HTMLButtonElement>(null);
  const filterChange=(next:SidebarProjectsFilter)=>{setFilter(next);writeSidebarProjectsFilter(next,host.scopeKey);};
  const sortChange=(next:SidebarProjectsSort)=>{setSort(next);writeSidebarProjectsSort(next,host.scopeKey);};
  return <SidebarGroup className="group/sidebar-section select-none" data-section-actions-open={actionsOpen||undefined} data-testid="sidebar-projects-section">
    <div className="relative"><SidebarGroupLabel asChild><button aria-controls="sidebar-projects" aria-expanded={!collapsed}
      className={SECTION_LABEL_BUTTON_CLASS} data-testid="sidebar-projects-section-label" onClick={()=>setCollapsed(value=>!value)} type="button">
      <span data-sidebar-section-title>{t("platform.tab.projects")}</span><span aria-hidden="true" className={SECTION_LABEL_CHEVRON_CLASS}>
        <ChevronDown className={cn(SECTION_LABEL_CHEVRON_ICON_CLASS,collapsed?"-rotate-90":"rotate-0")}/></span></button></SidebarGroupLabel>
      <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5">
        <button aria-label={t("sidebar.projects.add")} className={cn(SECTION_ICON_BUTTON_CLASS,SECTION_ACTION_VISIBILITY_CLASS)} data-testid="sidebar-projects-create"
          disabled={membership.pending||query.isFetching||!query.isSuccess} onClick={event=>{event.stopPropagation();setBrowserOpen(true);}} onPointerDown={event=>event.stopPropagation()} title={t("sidebar.projects.add")} type="button"><Plus className="h-4 w-4"/></button>
        <DropdownMenu onOpenChange={setActionsOpen}><DropdownMenuTrigger asChild><button aria-label={t("sidebar.projects.moreActions")}
          className={cn(SECTION_ICON_BUTTON_CLASS,SECTION_ACTION_VISIBILITY_CLASS)} data-testid="sidebar-projects-settings" onClick={event=>event.stopPropagation()}
          onPointerDown={event=>event.stopPropagation()} ref={actionsTriggerRef} type="button"><EllipsisVertical className="h-4 w-4"/></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={event=>{event.preventDefault();actionsTriggerRef.current?.blur();}}>
            <DropdownMenuSub><DropdownMenuSubTrigger><Folders className="h-4 w-4"/><span>{t("sidebar.projects.show")}</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent><DropdownMenuRadioGroup value={filter} onValueChange={value=>{if(value==="added"||value==="owned")filterChange(value);}}>
                <DropdownMenuRadioItem value="added">{t("sidebar.projects.added")}</DropdownMenuRadioItem><DropdownMenuRadioItem value="owned">{t("sidebar.projects.owned")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup></DropdownMenuSubContent></DropdownMenuSub>
            <DropdownMenuSub><DropdownMenuSubTrigger><ArrowUpDown className="h-4 w-4"/><span>{t("sidebar.projects.sort")}</span></DropdownMenuSubTrigger>
              <DropdownMenuSubContent><DropdownMenuRadioGroup value={sort} onValueChange={value=>{if(value==="name"||value==="created")sortChange(value);}}>
                <DropdownMenuRadioItem value="name">{t("sidebar.projects.alphabetical")}</DropdownMenuRadioItem><DropdownMenuRadioItem value="created">{t("sidebar.projects.newest")}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup></DropdownMenuSubContent></DropdownMenuSub><DropdownMenuSeparator/>
            <DropdownMenuItem onSelect={()=>deferMenuAction(()=>{void selectProject(null);})}><Folder className="h-4 w-4"/><span>{t("sidebar.projects.browseAll")}</span></DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
      </div>
    </div>
    {!collapsed?<SidebarGroupContent id="sidebar-projects">
      {navigationFailed?<p role="alert" className="px-2 py-1 text-xs text-sidebar-foreground/50">{t(navigationFailed==="created"?"projects.create.navigationFailed":"platform.loadFailed")}</p>:null}
      {query.isError||membership.problem?<p role="alert" className="px-2 py-1 text-xs text-sidebar-foreground/50">{membership.problem||t("platform.loadFailed")}
        <button type="button" onClick={()=>{void query.refetch();void membership.refresh().catch(()=>undefined);}}>{t("platform.retry")}</button></p>:null}
      {projects.length>0?<SidebarMenu data-testid="sidebar-projects">{projects.map(project=>{
        const active=project.id===selectedProjectId;
        const childChannels=listProjectChildChannels(project).flatMap(binding=>{const channel=channelsById.get(binding.channelId);return channel?[channel]:[];});
        const expanded=childChannels.length>0&&(expansion[project.projectAddress]??false);
        const row=({onOpen:onDelete,pending=false}:{onOpen?:()=>void;pending?:boolean})=><><ContextMenu><ContextMenuTrigger asChild><SidebarMenuItem>
          <SidebarMenuButton className={cn("data-[active=true]:!bg-transparent data-[active=true]:font-normal data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-none data-[active=true]:hover:!bg-transparent data-[active=true]:hover:text-sidebar-foreground data-[active=true]:active:!bg-transparent",childChannels.length>0&&"pr-8")}
            data-testid={`sidebar-project-${project.dtag}`} isActive={active} onClick={()=>{void selectProject(project.id);}} tooltip={project.name} type="button">
            <ProjectChannelIcon className={cn(!active&&"opacity-80")}/><SidebarMenuLabel className={cn(!active&&"opacity-80")}>{project.name}</SidebarMenuLabel>
          </SidebarMenuButton>
          {childChannels.length>0?<SidebarMenuAction aria-expanded={expanded} aria-label={t(expanded?"sidebar.projects.hideChannels":"sidebar.projects.showChannels",{name:project.name})}
            data-testid={`sidebar-project-expand-${project.dtag}`} onClick={event=>{event.stopPropagation();setExpansion(previous=>{const next={...previous,[project.projectAddress]:!expanded};writeSidebarProjectExpansion(next,host.scopeKey);return next;});}} type="button">
            <ChevronRight className={cn("transition-transform duration-150",expanded&&"rotate-90")}/></SidebarMenuAction>:null}
          {onDelete&&childChannels.length===0?<SidebarMenuAction aria-label={t("sidebar.projects.deleteNamed",{name:project.name})} data-testid={`sidebar-project-delete-${project.dtag}`}
            disabled={pending} onClick={event=>{event.stopPropagation();onDelete();}} showOnHover type="button"><Trash2/></SidebarMenuAction>:null}
        </SidebarMenuItem></ContextMenuTrigger><ContextMenuContent><ContextMenuItem disabled={membership.pending||!addresses.has(project.projectAddress)}
          onSelect={()=>deferMenuAction(()=>{if(lifetime.active)void membership.removeProject(project.projectAddress).catch(()=>undefined);})}><ContextMenuIconSlot><ListMinus className="h-4 w-4"/></ContextMenuIconSlot><span>{t("sidebar.projects.remove")}</span></ContextMenuItem>
          {onDelete?<><ContextMenuSeparator/><ContextMenuItem className="text-destructive focus:text-destructive" data-testid={`sidebar-project-delete-menu-${project.dtag}`}
            disabled={pending} onSelect={()=>deferMenuAction(()=>{if(lifetime.active)onDelete();})}><ContextMenuIconSlot><Trash2 className="h-4 w-4"/></ContextMenuIconSlot><span>{t("projects.delete")}</span></ContextMenuItem></>:null}
        </ContextMenuContent></ContextMenu>
        {expanded?childChannels.map(channel=>{const Icon=channel.visibility==="private"?Lock:Hash;return <SidebarMenuItem key={`${project.id}:${channel.id}`}><SidebarMenuButton
          className="h-7 pl-7 text-sidebar-foreground/70 data-[active=true]:!bg-transparent data-[active=true]:font-semibold data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-none data-[active=true]:hover:!bg-transparent data-[active=true]:hover:text-sidebar-foreground data-[active=true]:active:!bg-transparent"
          data-testid={`sidebar-project-channel-${project.dtag}-${channel.name}`} isActive={channel.id===selectedChannelId} onClick={()=>onSelectChannel(channel.id)} tooltip={`#${channel.name}`} type="button">
          <Icon className="h-3.5 w-3.5"/><SidebarMenuLabel>{`#${channel.name}`}</SidebarMenuLabel></SidebarMenuButton></SidebarMenuItem>;}):null}
        </>;
        const headId=[...query.data!.projectEvents,...query.data!.repositoryEvents].find(event=>`${event.kind}:${event.pubkey}:${event.tags.find(tag=>tag[0]==="d")?.[1]}`===project.projectAddress)?.id;
        return host.publish&&project.owner===query.data?.viewerPubkey&&headId?<ProjectDeleteAction key={project.id} project={project} headId={headId}
          viewerPubkey={query.data.viewerPubkey} host={host} onDeleted={()=>{
            if(!lifetime.active)return;
            if(selectedProjectId===project.id)void selectProject(null);
            void cache.invalidateQueries({queryKey:["projects",host.scopeKey]});void query.refetch();
          }} renderTrigger={row}/>:<React.Fragment key={project.id}>{row({})}</React.Fragment>;
      })}</SidebarMenu>:query.isPending||query.isFetching||membership.pending||query.isError||membership.problem?null:<p className="px-2 py-1 text-xs text-sidebar-foreground/50">{t("projects.empty")}</p>}
    </SidebarGroupContent>:null}
    <ProjectBrowserDialog open={browserOpen} onOpenChange={setBrowserOpen} projects={allProjects.filter(project=>!project.legacy)}
      creation={host.publish&&(createCapability.data?.createActionKey===CreateActionKey.WorkspaceCreate||creation.intent)?{
        busy:creation.busy,frozen:creation.intent?.input,create:async input=>{
          const project=await creation.create(input);
          if(!lifetime.active)return;
          void cache.invalidateQueries({queryKey:["projects",host.scopeKey]});void query.refetch();
          // Creation is already confirmed. A subsequent navigation failure must
          // not report creation failure and let the form publish a new project.
          await selectProject(project.id,true);
        },
      }:undefined}
      selectedProjectAddresses={addresses} pending={membership.pending||query.isFetching} onSelectProject={project=>{
        void membership.addProject(project.projectAddress).then(()=>selectProject(project.id)).catch(()=>undefined);
      }}/>
  </SidebarGroup>;
}
