// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/IssueAssigneesRow.tsx::IssueAssigneesRow.
// Restore the original HUMAN picker; managed-agent signing remains absent.
import { Search, X } from "lucide-react";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useBffClient,useUiT } from "../context";
import { normalizePubkey, truncateNpub } from "../conversations/pubkey";
import type { UserProfileLookup } from "../messages/system/identity";
import { UserAvatar } from "../messages/UserAvatar";
import { Button } from "../profile/buzz/shared/ui/button";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "../sidebar/tooltip";
import type { ProjectIssue } from "./projectIssues.mjs";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogTrigger } from "../composer/shared/ui/dialog";
import { Input } from "../composer/shared/ui/input";
import { loadProjectAssignmentHumans } from "./issueAssignments";
import { useUsersBatchQuery } from "../pulse/host";

export function IssueAssigneesRow({ issue, profiles, viewerPubkey, scopeKey, canAssignOthers, pending, recoveryOperation, recoveryAssignee, onAssign, onUnassign }: {
  issue: ProjectIssue;
  profiles?: UserProfileLookup;
  viewerPubkey: string | null;
  scopeKey:string;
  canAssignOthers:boolean;
  pending: boolean;
  recoveryOperation?: "assign" | "unassign";
  recoveryAssignee?:string;
  onAssign: (pubkey:string,label:string) => Promise<boolean>;
  onUnassign: (pubkey:string,label:string) => Promise<boolean>;
}) {
  const t = useUiT();
  const client=useBffClient();
  const [pickerOpen,setPickerOpen]=React.useState(false);
  const [assigneeQuery,setAssigneeQuery]=React.useState("");
  const deferredAssigneeQuery=React.useDeferredValue(assigneeQuery.trim());
  const viewer = viewerPubkey ? normalizePubkey(viewerPubkey) : null;
  const humanQuery=useQuery({queryKey:["projects",scopeKey,"assignment-humans"],
    queryFn:({signal})=>loadProjectAssignmentHumans(client,signal),retry:false,
    enabled:canAssignOthers&&(pickerOpen||issue.assignees.some(pubkey=>pubkey!==viewer)||Boolean(recoveryAssignee&&recoveryAssignee!==viewer))});
  const humans=humanQuery.isError||humanQuery.isFetching?undefined:humanQuery.data;
  // Preserve only the pending operation's pre-confirmation control until its original
  // event is proven. Other assignees still come directly from the fresh reducer.
  const pendingAssignee=recoveryAssignee??viewer;
  const displayedAssignees = pendingAssignee && recoveryOperation ? [
    ...issue.assignees.filter(pubkey=>normalizePubkey(pubkey)!==pendingAssignee),
    ...(recoveryOperation==="unassign"?[pendingAssignee]:[]),
  ] : issue.assignees;
  const candidates=[...(humans?.entries()??[])].filter(([pubkey,person])=>!displayedAssignees.includes(pubkey)&&
    (!recoveryOperation||pubkey===pendingAssignee)&&
    [person.displayName,pubkey].some(value=>value.toLocaleLowerCase().includes(deferredAssigneeQuery.toLocaleLowerCase())))
    .slice(0,50); // Fixed original IssueAssigneesRow useUserSearchQuery limit.
  const candidateProfiles=useUsersBatchQuery(candidates.map(([pubkey])=>pubkey),{enabled:canAssignOthers&&pickerOpen}).data?.profiles;
  const allowedPending=(operation:"assign"|"unassign",pubkey:string)=>!recoveryOperation||recoveryOperation===operation&&pendingAssignee===pubkey;
  React.useEffect(()=>{if(!pickerOpen)setAssigneeQuery("");},[pickerOpen]);
  React.useEffect(()=>{if(!canAssignOthers)setPickerOpen(false);},[canAssignOthers]);
  async function assign(pubkey:string,label:string){if(await onAssign(pubkey,label)){setPickerOpen(false);setAssigneeQuery("");}}
  const canSelfAssign = viewer !== null && !displayedAssignees.some(pubkey => normalizePubkey(pubkey) === viewer);
  if (displayedAssignees.length === 0 && !canSelfAssign&&!canAssignOthers) return null;
  return <div className="min-w-0 text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
    {displayedAssignees.map(pubkey => {
      const profile = profiles?.[normalizePubkey(pubkey)];
      const label = profile?.displayName?.trim() || profile?.nip05Handle?.trim() || truncateNpub(pubkey);
      const canUnassign = viewer !== null && (normalizePubkey(pubkey) === viewer||canAssignOthers&&humans?.has(normalizePubkey(pubkey)));
      const avatar = <UserAvatar accent={profile?.isAgent === true} avatarUrl={profile?.avatarUrl ?? null}
        displayName={label} shape={profile?.isAgent ? "squircle" : "circle"} size="xs"/>;
      return <Tooltip key={pubkey}>
        <TooltipTrigger asChild>
          {canUnassign ? <button
            aria-label={t("projects.assignment.unassignPerson", { name: label })}
            className={cn("group relative inline-flex rounded-full focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring")}
            data-testid={`project-issue-unassign-${normalizePubkey(pubkey)}`} disabled={pending||!allowedPending("unassign",normalizePubkey(pubkey))}
            onClick={()=>void onUnassign(normalizePubkey(pubkey),label)} type="button">
            {avatar}
            <span className={cn("absolute inset-0 flex items-center justify-center bg-background/80 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
              profile?.isAgent ? "rounded-squircle" : "rounded-full")}><X className="h-3 w-3 text-foreground"/></span>
          </button> : <span className="inline-flex">{avatar}</span>}
        </TooltipTrigger>
        <TooltipContent>{t(canUnassign ? "projects.assignment.unassignPerson" : "projects.task.assigned", { name: label })}</TooltipContent>
      </Tooltip>;
    })}
    {canSelfAssign ? <Button
      className="h-5 px-0 text-xs text-primary hover:bg-transparent hover:text-primary hover:underline"
      data-testid="project-issue-self-assign" disabled={pending||!allowedPending("assign",viewer!)}
      onClick={()=>void assign(viewer!,profiles?.[viewer!]?.displayName?.trim()||profiles?.[viewer!]?.nip05Handle?.trim()||truncateNpub(viewer!))}
      size="xs" type="button" variant="ghost">{t("projects.assignment.self")}</Button> : null}
    {canAssignOthers?<Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
      <DialogTrigger asChild><Button className="h-5 px-1 text-xs text-muted-foreground hover:text-foreground"
        data-testid="project-issue-assign" disabled={pending||Boolean(recoveryOperation&&(recoveryOperation!=="assign"||pendingAssignee===viewer))}
        size="xs" type="button" variant="ghost">{t("projects.assignment.choose")}</Button></DialogTrigger>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-6 py-5 pr-14">
          <DialogTitle>{t("projects.assignment.title")}</DialogTitle>
          <DialogDescription>{t("projects.assignment.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b border-border/60 px-6 py-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground"/>
          <Input autoFocus className="h-8 border-0 px-0 text-sm shadow-none focus-visible:ring-0" data-testid="project-assignee-search"
            onChange={event=>setAssigneeQuery(event.target.value)} placeholder={t("projects.assignment.search")} value={assigneeQuery}/>
        </div>
        <div className="max-h-72 min-h-28 overflow-y-auto p-2">
          {humanQuery.isFetching||humanQuery.isPending?<p className="px-3 py-4 text-sm text-muted-foreground">{t("projects.assignment.searching")}</p>
            :humanQuery.isError?<p role="alert" className="px-3 py-4 text-sm text-muted-foreground">{t("platform.loadFailed")}</p>
            :candidates.length?candidates.map(([pubkey,person])=>{
              const profile=candidateProfiles?.[pubkey];
              const label=profile?.displayName?.trim()||profile?.nip05Handle?.trim()||person.displayName.trim()||truncateNpub(pubkey);
              return <button className="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                data-testid={`project-assignee-result-${pubkey}`} disabled={pending||!allowedPending("assign",pubkey)} key={pubkey}
                onClick={()=>void assign(pubkey,label)} type="button">
                <UserAvatar avatarUrl={profile?.avatarUrl??null} displayName={label} shape="circle" size="xs"/>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{truncateNpub(pubkey)}</span></span>
              </button>;
            }):<p className="px-3 py-4 text-sm text-muted-foreground">{t("projects.assignment.noMatches")}</p>}
        </div>
      </DialogContent>
    </Dialog>:null}
  </div>;
}
