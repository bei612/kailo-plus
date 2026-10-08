// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx
// RelayMemberRow / HoverMemberIdentity. Platform membership remains Principal-based.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Search, Shield } from "lucide-react";
import { WorkspaceMembershipState, type WorkspaceMemberView, type RoleMemberView } from "@client-kit/contracts";
import { useBffClient, useLocale, useT } from "./context";
import { enumLabel, workspaceMembershipStateMessages } from "../i18n";
import { truncatePubkey } from "../format";
import { BffError, TransportError } from "../transport";
import { useLoad } from "./use-load";
import { ReadFailure } from "./ui";
import { SettingsOptionGroup } from "./settings-option-group";
import { SettingsSectionHeader } from "./settings-surface";
import { ProfileAvatar } from "./profile/buzz/features/profile/ui/ProfileAvatar";
import { AvatarHostProvider } from "./profile/avatar-host";
import { UserProfilePopoverSurface, UserProfilePopoverBody, type ProfilePopoverBodyProps } from "./pulse/UserProfilePopover";
import { ProfileSummaryView } from "./pulse/ProfileSummaryView";
import { AuxiliaryPanel, AuxiliaryPanelBody, AuxiliaryPanelHeader, AuxiliaryPanelHeaderGroup, AuxiliaryPanelHeaderTitleBlock } from "./messages/thread/auxiliary";
import { useThreadPanelWidth } from "./messages/thread/useThreadPanelWidth";
import { useEscapeKey } from "./messages/thread/useEscapeKey";
import { VirtualizedList } from "./forum/VirtualizedList";
import { MemberActionFeedback, useMemberAction, validRoleMemberPage } from "./roles";
import { TenantInvitations } from "./invitations";
import { Button } from "./profile/buzz/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./sidebar/dropdown-menu";

type MemberTarget = {workspaceId: string; principalId: string; pubkey: string};
export type MemberIdentityRenderer = (pubkey: string, children: ReactNode, label: string) => ReactNode;

function useMemberProfile(target: MemberTarget) {
  const client = useBffClient();
  return useQuery({queryKey:["workspace-member-profile",target.workspaceId,target.principalId,target.pubkey],
    queryFn:async()=>{
      const profile=await client.memberProfile(target.workspaceId,target.principalId,target.pubkey);
      if(profile.pubkey!==target.pubkey)throw new TransportError("Member identity changed");
      return profile;
    },retry:false,staleTime:0});
}

function MemberAvatar({target,label}:{target:MemberTarget;label:string}) {
  const client=useBffClient();const locale=useLocale();
  // The original row consumes its authorized profile before opening a popover.
  // useLoad drops responses after this transport scope or exact member key leaves.
  const [result]=useLoad(JSON.stringify(target),async()=>{
    const profile=await client.memberProfile(target.workspaceId,target.principalId,target.pubkey);
    if(profile.pubkey!==target.pubkey)throw new TransportError("Member identity changed");
    return profile;
  });
  const profile=result.status==="ok"?result.data:undefined;
  return <AvatarHostProvider value={{locale,rewriteMediaUrl:url=>profile?.avatarMediaPaths[url]??url}}>
    <ProfileAvatar avatarUrl={profile?.avatarUrl??null} className="h-9 w-9 text-xs shadow-none" label={label} shape="circle"/>
  </AvatarHostProvider>;
}

export function MemberHover({target,...props}:ProfilePopoverBodyProps&{target:MemberTarget}) {
  const t=useT(); const query=useMemberProfile(target);
  const profile=query.isSuccess&&!query.isFetching?query.data:undefined;
  return <UserProfilePopoverBody {...props} profile={profile} mediaUrl={(url)=>profile?.avatarMediaPaths[url]??url}
    status={!profile?<p role={query.isError?"alert":"status"}>{t(query.isError?"platform.loadFailed":"platform.loading")}</p>:undefined}/>;
}

export function MemberProfilePanel({target,onClose,onStartDm}:{target:MemberTarget;onClose:()=>void;onStartDm?:(pubkey:string)=>void|Promise<void>}) {
  const t=useT();const query=useMemberProfile(target);const width=useThreadPanelWidth();
  const owner=useMemo(()=>({active:true,busy:false}),[target.workspaceId,target.principalId,target.pubkey]);
  const currentOwner=useRef(owner);currentOwner.current=owner;
  const [opening,setOpening]=useState(false);const [problem,setProblem]=useState<string|null>(null);
  useEffect(()=>{owner.active=true;setOpening(false);setProblem(null);return()=>{owner.active=false;};},[owner]);
  useEscapeKey(onClose,true);
  const profile=query.isSuccess&&!query.isFetching?query.data:undefined;
  async function openMessage() {
    if(!profile||!onStartDm||owner.busy||!owner.active||currentOwner.current!==owner)return;
    owner.busy=true;setOpening(true);setProblem(null);
    try {
      await onStartDm(profile.pubkey);
      if(owner.active&&currentOwner.current===owner)onClose();
    }catch(error){
      if(owner.active&&currentOwner.current===owner)
        setProblem(error instanceof Error?error.message:t("platform.loadFailed"));
    }finally{
      owner.busy=false;
      if(owner.active&&currentOwner.current===owner)setOpening(false);
    }
  }
  return <AuxiliaryPanel onClose={onClose} widthPx={width.widthPx} onResizeStart={width.onResizeStart}
    onResetWidth={width.onResetWidth} canResetWidth={width.canReset} testId="member-profile-panel"
    resizeHandleAriaLabel={t("platform.profile.resize")}
    header={<AuxiliaryPanelHeader inset="wide" resizeBorder><AuxiliaryPanelHeaderGroup>
      <AuxiliaryPanelHeaderTitleBlock title={t("platform.settings.profile")}/>
    </AuxiliaryPanelHeaderGroup></AuxiliaryPanelHeader>}>
    <AuxiliaryPanelBody className="overflow-y-auto px-4 pb-6">
      {profile?<ProfileSummaryView profile={profile} displayName={profile.displayName??truncatePubkey(profile.pubkey)}
        pubkey={profile.pubkey} copy={(value)=>navigator.clipboard.writeText(value)} mediaUrl={(url)=>profile.avatarMediaPaths[url]??url}
        messagePending={opening} onMessage={onStartDm?()=>{void openMessage();}:undefined}/>
        :query.isError?<ReadFailure error={query.error} onRetry={()=>void query.refetch()}/>:<p role="status">{t("platform.loading")}</p>}
      {problem?<p role="alert">{problem}</p>:null}
    </AuxiliaryPanelBody>
  </AuxiliaryPanel>;
}

/** The original row keeps its name/key hover and avatar/profile affordance.
 * No role, presence or created date is inferred from missing directory facts. */
export function MembersPane({workspaceId,renderIdentity,onStartDm,currentPrincipalId}: {workspaceId:string;renderIdentity?:MemberIdentityRenderer;onStartDm?:(pubkey:string)=>void|Promise<void>;currentPrincipalId?:string}) {
  const client=useBffClient();const t=useT();const locale=useLocale();
  const [state,reload]=useLoad(`members:${workspaceId}`,()=>client.members(workspaceId));
  const [roles,reloadRoles]=useLoad(`member-actions:${workspaceId}`,async()=>{
    const members=new Map<string,RoleMemberView>();const cursors=new Set<string>();let cursor:string|undefined;
    do {
      const page=await client.roleMembers(workspaceId,cursor);
      if(!validRoleMemberPage(page))throw new TransportError("Invalid member action projection");
      for(const member of page.members){
        if(members.has(member.principalId))throw new TransportError("Repeated member action identity");
        members.set(member.principalId,member);
      }
      cursor=page.nextCursor;
      if(cursor){if(cursors.has(cursor))throw new TransportError("Repeated member action cursor");cursors.add(cursor);}
    }while(cursor);
    return members;
  });
  const action=useMemberAction(()=>{reload();reloadRoles();});
  const [search,setSearch]=useState("");const [selected,setSelected]=useState<MemberTarget|null>(null);
  useEffect(()=>{const refresh=()=>{reload();reloadRoles();};window.addEventListener("focus",refresh);return()=>window.removeEventListener("focus",refresh);},[reload,reloadRoles]);
  const rows=state.status==="ok"?state.data:[];
  const filter=search.trim().toLowerCase();
  const filtered=rows.filter(member=>member.displayName.toLowerCase().includes(filter)||member.pubkeys.some(key=>key.includes(filter)));
  const active=selected?.workspaceId===workspaceId&&rows.some(member=>member.principalId===selected.principalId&&member.state===WorkspaceMembershipState.Active&&member.pubkeys.includes(selected.pubkey))?selected:null;
  function identity(member:WorkspaceMemberView,pubkey:string,children:ReactNode) {
    if(member.state!==WorkspaceMembershipState.Active)return children;
    const label=t("members.openProfile",{name:member.displayName});
    if(renderIdentity)return renderIdentity(pubkey,children,label);
    const target={workspaceId,principalId:member.principalId,pubkey};
    return <UserProfilePopoverSurface pubkey={pubkey} triggerElement="span" triggerAriaLabel={label}
      onOpenProfile={()=>setSelected(target)} renderBody={(props)=><MemberHover {...props} target={target}/>}>{children}</UserProfilePopoverSurface>;
  }
  function management(member:WorkspaceMemberView) {
    const role=roles.status==="ok"?roles.data.get(member.principalId):undefined;
    if(!role)return null;
    const options=[
      [role.canGrantTenantAdmin,"tenant.admin.grant","actions.tenant.admin.grant"],
      [role.canRevokeTenantAdmin,"tenant.admin.revoke","actions.tenant.admin.revoke"],
      [role.canGrantWorkspaceAdmin,"workspace.admin.grant","actions.workspace.admin.grant"],
      [role.canRevokeWorkspaceAdmin,"workspace.admin.revoke","actions.workspace.admin.revoke"],
      [role.canRemoveFromWorkspace,"workspace.member.revoke","actions.workspace.member.revoke"],
      [role.canRemoveFromTenant,"tenant.member.revoke","actions.tenant.member.revoke"],
    ] as const;
    const allowed=options.filter(([enabled])=>enabled===true);
    if(!allowed.length)return null;
    const firstRemove=allowed.findIndex(([,key])=>key.endsWith("member.revoke"));
    return <DropdownMenu modal={false}><DropdownMenuTrigger asChild>
      <Button aria-label={t("members.actions",{name:member.displayName})} disabled={action.busy||action.confirming!==null||action.submittedFor===member.principalId} size="icon" variant="ghost">
        <MoreHorizontal className="h-4 w-4"/>
      </Button></DropdownMenuTrigger><DropdownMenuContent align="end">
      {allowed.map(([,key,label],index)=><Fragment key={key}>
        {index===firstRemove&&index>0?<DropdownMenuSeparator/>:null}
        <DropdownMenuItem className={key.endsWith("member.revoke")?"text-destructive focus:text-destructive":undefined}
          onSelect={()=>action.choose(key,member,t(label),workspaceId)}>{t(label)}</DropdownMenuItem>
      </Fragment>)}
    </DropdownMenuContent></DropdownMenu>;
  }
  return <AvatarHostProvider value={{locale,rewriteMediaUrl:(url)=>url}}><div className="flex min-h-0 min-w-0 flex-1" data-testid="workspace-members">
    <section className="min-w-0 flex-1">
      <SettingsSectionHeader title={t("platform.tab.members")} description={t("members.description")} action={<TenantInvitations dialog/>}/>
      <MemberActionFeedback action={action}/>
      {roles.status==="error"&&!(roles.error instanceof BffError&&roles.error.status===403)?<ReadFailure error={roles.error} onRetry={reloadRoles}/>:null}
      <SettingsOptionGroup title={<>{t("platform.tab.members")}{state.status==="ok"?<span className="ml-1.5 font-normal">{rows.length}</span>:null}</>}>
        <div className="space-y-3 p-4 sm:p-5">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
            <input autoCapitalize="none" autoCorrect="off" spellCheck={false} type="text" value={search} onChange={e=>setSearch(e.target.value)}
              aria-label={t("members.search")} placeholder={t("members.search")} className="w-full rounded-lg border border-border/70 bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"/>
          </div>
          {state.status==="error"?<ReadFailure error={state.error} onRetry={reload}/>:state.status==="pending"?<p role="status">{t("platform.loading")}</p>:
            filtered.length===0?<p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">{t(rows.length?"members.noMatch":"platform.members.none")}</p>:
            <VirtualizedList className="max-h-[28rem] divide-y divide-border/60" estimateSize={60}
              items={filtered} getItemKey={member=>member.principalId} renderItem={member=><div className="group/member flex min-h-14 items-center gap-3 px-1 py-2.5" data-testid={`member-${member.principalId}`}>
              {member.state===WorkspaceMembershipState.Active&&member.pubkeys[0]?identity(member,member.pubkeys[0],
                <MemberAvatar target={{workspaceId,principalId:member.principalId,pubkey:member.pubkeys[0]}} label={member.displayName}/>):
                <ProfileAvatar avatarUrl={null} className="h-9 w-9 text-xs shadow-none" label={member.displayName} shape="circle"/>}
              <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                <span className="inline-grid min-w-0 max-w-full grid-cols-1">
                  <span className="col-start-1 row-start-1 max-w-40 truncate opacity-100 blur-0 transition-[max-width,opacity,filter] duration-[250ms] ease-in-out group-hover/member:max-w-0 group-hover/member:opacity-0 group-hover/member:blur-[2px] group-focus-within/member:max-w-0 group-focus-within/member:opacity-0 motion-reduce:transition-none">{member.displayName}</span>
                  <span className="col-start-1 row-start-1 max-w-0 truncate font-mono text-2xs opacity-0 blur-0 transition-[max-width,opacity,filter] duration-[250ms] ease-in-out group-hover/member:max-w-40 group-hover/member:opacity-100 group-focus-within/member:max-w-40 group-focus-within/member:opacity-100 motion-reduce:transition-none">{member.pubkeys[0]?truncatePubkey(member.pubkeys[0]):member.displayName}</span>
                </span>
                {roles.status==="ok"&&roles.data.get(member.principalId)?.workspaceAdmin?<Shield className="h-4 w-4 text-blue-500" aria-label={t("roles.workspace")}/>:null}
              </div><div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground/70" data-settings-subcopy>
                <span>{enumLabel(locale,workspaceMembershipStateMessages,member.state)}</span>
                {member.pubkeys.map(pubkey=><span key={pubkey} title={pubkey}>{identity(member,pubkey,<code>{truncatePubkey(pubkey)}</code>)}</span>)}
              </div></div>{management(member)}
            </div>}/>}
        </div>
      </SettingsOptionGroup>
    </section>
    {active?<MemberProfilePanel key={`${active.principalId}:${active.pubkey}`} target={active} onClose={()=>setSelected(null)} onStartDm={active.principalId===currentPrincipalId?undefined:onStartDm}/>:null}
  </div></AvatarHostProvider>;
}
