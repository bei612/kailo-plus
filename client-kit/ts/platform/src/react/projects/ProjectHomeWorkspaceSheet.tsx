// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectHomeWorkspaceSheet.tsx.
// Tasks covers this project's repositories; Reviews uses the selected repository. Commits and
// Files (DD-118) exist only when the host offers Git reads; People and writes stay un-restored.
import * as React from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useUiT} from "../context";
import {useUsersBatchQuery} from "../pulse/host";
import type {ProjectsHost} from "./projectEnumeration";
import type {Project} from "./projectModels";
import {loadProjectWorkItems,type ProjectInboxWorkItem} from "./projectWorkItems";
import {ProjectIssuesPanel} from "./ProjectIssuesPanel";
import {PullRequestsPanel} from "./ProjectPullRequestsPanel";
import {ProjectPanelState} from "./ProjectPanelState";
import {BuzzLoadingState} from "./BuzzLoadingState";
import {CreateProjectIssueDialog} from "./CreateProjectIssueDialog";
import {ProjectHomeCommitsSheet,ProjectHomeFilesSheet} from "./ProjectHomeGitSheet";

export type ProjectHomeWorkspaceSheetTab="issues"|"prs"|"commits"|"files";
export type ProjectHomeWorkspaceDetail={backLabel:string;onBack:()=>void;navigation:{repositoryId:string;issueId?:string;pullRequestId?:string;commitHash?:string;filePath?:string}};
export type ProjectHomeWorkspaceCreateAction={label:string;disabled:boolean;onClick:()=>void};
export type ProjectWorkItemsRenderer=(children:React.ReactNode,viewerPubkey:string)=>React.ReactNode;

function WorkspaceBody({items,repository,tab,onDetailChange,selectedIssueId,setSelectedIssueId,selectedPullRequestId,setSelectedPullRequestId,host,projectId}:{items:ProjectInboxWorkItem[];repository:Project["repositories"][number];tab:"issues"|"prs";onDetailChange:(detail:ProjectHomeWorkspaceDetail|null)=>void;selectedIssueId:string|null;setSelectedIssueId:(id:string|null)=>void;selectedPullRequestId:string|null;setSelectedPullRequestId:(id:string|null)=>void;host:ProjectsHost;projectId:string}) {
  const t=useUiT();
  const issues=items.filter(item=>item.type==="issue");
  const prs=items.filter((item):item is Extract<ProjectInboxWorkItem,{type:"pull-request"}>=>item.type==="pull-request"&&item.repository.id===repository.id);
  const current=tab==="issues"?issues:prs;
  const selected=current.find(item=>item.type==="issue"?item.issue.id===selectedIssueId:item.pullRequest.id===selectedPullRequestId);
  const authorKeys=[...new Set(current.flatMap(item=>{const value=item.type==="issue"?item.issue:item.pullRequest;return [value.author,...value.comments.map(comment=>comment.author),...(item.type==="issue"?item.issue.assignees:[...item.pullRequest.reviewers,...item.pullRequest.updates.map(update=>update.author)])];}))];
  const profilesQuery=useUsersBatchQuery(authorKeys);
  const profiles=profilesQuery.isSuccess&&!profilesQuery.isFetching?profilesQuery.data.profiles:undefined;
  React.useEffect(()=>{
    onDetailChange(selected?{backLabel:t(tab==="issues"?"projects.sheet.backTasks":"projects.sheet.backReviews"),navigation:{repositoryId:selected.repository.id,...(selected.type==="issue"?{issueId:selected.issue.id}:{pullRequestId:selected.pullRequest.id})},onBack:()=>{setSelectedIssueId(null);setSelectedPullRequestId(null);}}:null);
    return ()=>onDetailChange(null);
  },[selected,tab,t,onDetailChange]);
  // Selected references do not authorize a detail absent from the fresh read.
  const missing=tab==="issues"?selectedIssueId&&!selected:selectedPullRequestId&&!selected;
  const body=missing?<ProjectPanelState error title={t("platform.loadFailed")}/>:
    tab==="issues"?<ProjectIssuesPanel host={host} projectId={projectId} issueItems={issues.map(item=>({issue:item.issue,project:item.repository}))} selectedIssueId={selectedIssueId} onSelectedIssueIdChange={setSelectedIssueId} profiles={profiles}/>:
    <PullRequestsPanel host={host} projectId={projectId} project={repository} pullRequests={prs.map(item=>item.pullRequest)} selectedPullRequest={selected?.type==="pull-request"?selected.pullRequest:null} onSelectedPullRequestIdChange={setSelectedPullRequestId} profiles={profiles}/>;
  return body;
}

export function ProjectHomeWorkspaceSheet({host,project,repositoryId,tab,renderWorkItems,onDetailChange,onCreateActionChange,onOpenCommit,onSelectRepository}:{
  host:ProjectsHost;project:Project;repositoryId:string;tab:ProjectHomeWorkspaceSheetTab;renderWorkItems:ProjectWorkItemsRenderer;
  onDetailChange:(detail:ProjectHomeWorkspaceDetail|null)=>void;
  onCreateActionChange?:(action:ProjectHomeWorkspaceCreateAction|null)=>void;
  onOpenCommit?:(commitHash:string)=>void;onSelectRepository?:(repositoryId:string)=>void;
}) {
  const t=useUiT();const cache=useQueryClient();
  const [selectedIssueId,setSelectedIssueId]=React.useState<string|null>(null);
  const [selectedPullRequestId,setSelectedPullRequestId]=React.useState<string|null>(null);
  const [createIssueOpen,setCreateIssueOpen]=React.useState(false);
  const key=React.useMemo(()=>["project-home-work-items",host.scopeKey,project.id],[host.scopeKey,project.id]);
  // The original Files sheet reads only the repository; it does not wait for work items.
  const query=useQuery({queryKey:key,enabled:tab!=="files",queryFn:({signal})=>loadProjectWorkItems(host,signal,project.id),retry:false,refetchOnMount:"always",refetchOnWindowFocus:"always"});
  React.useEffect(()=>()=>{void cache.cancelQueries({queryKey:key});cache.removeQueries({queryKey:key});},[cache,key]);
  const snapshot=query.isSuccess&&!query.isFetching?query.data:undefined;
  const repository=snapshot?.projects[0]?.repositories.find(item=>item.id===repositoryId);
  React.useEffect(()=>{
    onCreateActionChange?.(tab==="issues"&&!selectedIssueId&&snapshot&&repository&&host.publish
      ?{label:t("projects.issue.create"),disabled:false,onClick:()=>setCreateIssueOpen(true)}:null);
    return()=>onCreateActionChange?.(null);
  },[onCreateActionChange,tab,selectedIssueId,snapshot,repository,host.publish,t]);
  const sheetRepository=project.repositories.find(item=>item.id===repositoryId);
  if(tab==="files")return <div className="-mx-4 [&_[data-project-detail-panel]]:rounded-none [&_[data-project-detail-panel]]:border-0" data-tab={tab} data-testid="project-home-workspace-sheet">
    {host.git&&sheetRepository?<ProjectHomeFilesSheet host={host} project={project} repository={sheetRepository} onDetailChange={onDetailChange}
      onOpenCommit={onOpenCommit} onSelectRepository={id=>onSelectRepository?.(id)}/>:<ProjectPanelState error title={t("platform.loadFailed")}/>}
  </div>;
  const body=query.isPending||query.isFetching?<BuzzLoadingState label={t(tab==="issues"?"projects.sheet.loadingTasks":tab==="prs"?"projects.sheet.loadingReviews":"projects.git.loadingCommits")}/>:
    !snapshot||!repository?<ProjectPanelState error title={t("platform.loadFailed")}/>:
    tab==="commits"?(host.git?renderWorkItems(<ProjectHomeCommitsSheet key={`${host.scopeKey}:${project.id}:${repository.id}:${tab}`} host={host}
      project={snapshot.projects[0]??project} repository={repository} onDetailChange={onDetailChange}
      pullRequests={snapshot.items.flatMap(item=>item.type==="pull-request"&&item.repository.id===repository.id?[item.pullRequest]:[])}/>,snapshot.viewerPubkey)
      :<ProjectPanelState error title={t("platform.loadFailed")}/>):
    renderWorkItems(<WorkspaceBody key={`${host.scopeKey}:${project.id}:${repository.id}:${tab}`} items={snapshot.items}
    host={host} projectId={project.id} repository={repository} tab={tab} onDetailChange={onDetailChange}
    selectedIssueId={selectedIssueId} setSelectedIssueId={setSelectedIssueId}
    selectedPullRequestId={selectedPullRequestId} setSelectedPullRequestId={setSelectedPullRequestId}/>,snapshot.viewerPubkey);
  const listPanel=tab==="issues"?!selectedIssueId:tab==="prs"&&!selectedPullRequestId;
  return <div className="-mx-4 [&_[data-project-detail-panel]]:rounded-none [&_[data-project-detail-panel]]:border-0" data-tab={tab} data-testid="project-home-workspace-sheet">
    {listPanel?<div className="overflow-hidden rounded-xl border border-border/60 bg-transparent" data-project-detail-panel>{body}</div>:body}
    {snapshot&&repository&&host.publish?<CreateProjectIssueDialog host={host} initialProjectId={project.id}
      onCreated={(_project,_repository,id)=>{setSelectedIssueId(id);setSelectedPullRequestId(null);}}
      onOpenChange={setCreateIssueOpen} open={createIssueOpen} projects={snapshot.projects}/>:null}
  </div>;
}
