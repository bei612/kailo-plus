// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx
// RelayMemberRow / HoverMemberIdentity. Platform membership remains Principal-based.
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { WorkspaceMembershipState, type WorkspaceMemberView } from "@client-kit/contracts";
import { useBffClient, useLocale, useT } from "./context";
import { enumLabel, workspaceMembershipStateMessages } from "../i18n";
import { truncatePubkey } from "../format";
import { TransportError } from "../transport";
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

function MemberHover({target,...props}:ProfilePopoverBodyProps&{target:MemberTarget}) {
  const t=useT(); const query=useMemberProfile(target);
  const profile=query.isSuccess&&!query.isFetching?query.data:undefined;
  return <UserProfilePopoverBody {...props} profile={profile} mediaUrl={(url)=>profile?.avatarMediaPaths[url]??url}
    status={!profile?<p role={query.isError?"alert":"status"}>{t(query.isError?"platform.loadFailed":"platform.loading")}</p>:undefined}/>;
}

function MemberProfilePanel({target,onClose}:{target:MemberTarget;onClose:()=>void}) {
  const t=useT();const query=useMemberProfile(target);const width=useThreadPanelWidth();
  useEscapeKey(onClose,true);
  const profile=query.isSuccess&&!query.isFetching?query.data:undefined;
  return <AuxiliaryPanel onClose={onClose} widthPx={width.widthPx} onResizeStart={width.onResizeStart}
    onResetWidth={width.onResetWidth} canResetWidth={width.canReset} testId="member-profile-panel"
    resizeHandleAriaLabel={t("platform.profile.resize")}
    header={<AuxiliaryPanelHeader inset="wide" resizeBorder><AuxiliaryPanelHeaderGroup>
      <AuxiliaryPanelHeaderTitleBlock title={t("platform.settings.profile")}/>
    </AuxiliaryPanelHeaderGroup></AuxiliaryPanelHeader>}>
    <AuxiliaryPanelBody className="overflow-y-auto px-4 pb-6">
      {profile?<ProfileSummaryView profile={profile} displayName={profile.displayName??truncatePubkey(profile.pubkey)}
        pubkey={profile.pubkey} copy={(value)=>navigator.clipboard.writeText(value)} mediaUrl={(url)=>profile.avatarMediaPaths[url]??url}/>
        :query.isError?<ReadFailure error={query.error} onRetry={()=>void query.refetch()}/>:<p role="status">{t("platform.loading")}</p>}
    </AuxiliaryPanelBody>
  </AuxiliaryPanel>;
}

/** The original row keeps its name/key hover and avatar/profile affordance.
 * No role, presence or created date is inferred from missing directory facts. */
export function MembersPane({workspaceId,renderIdentity}: {workspaceId:string;renderIdentity?:MemberIdentityRenderer}) {
  const client=useBffClient();const t=useT();const locale=useLocale();
  const [state,reload]=useLoad(`members:${workspaceId}`,()=>client.members(workspaceId));
  const [search,setSearch]=useState("");const [selected,setSelected]=useState<MemberTarget|null>(null);
  useEffect(()=>{window.addEventListener("focus",reload);return()=>window.removeEventListener("focus",reload);},[reload]);
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
  return <AvatarHostProvider value={{locale,rewriteMediaUrl:(url)=>url}}><div className="flex min-h-0 min-w-0 flex-1" data-testid="workspace-members">
    <section className="min-w-0 flex-1">
      <SettingsSectionHeader title={t("platform.tab.members")} description={t("members.description")}/>
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
              {member.pubkeys[0]?identity(member,member.pubkeys[0],<ProfileAvatar avatarUrl={null} className="h-9 w-9 text-xs shadow-none" label={member.displayName} shape="circle"/>):<ProfileAvatar avatarUrl={null} className="h-9 w-9 text-xs shadow-none" label={member.displayName} shape="circle"/>}
              <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                <span className="inline-grid min-w-0 max-w-full grid-cols-1">
                  <span className="col-start-1 row-start-1 max-w-40 truncate opacity-100 blur-0 transition-[max-width,opacity,filter] duration-[250ms] ease-in-out group-hover/member:max-w-0 group-hover/member:opacity-0 group-hover/member:blur-[2px] group-focus-within/member:max-w-0 group-focus-within/member:opacity-0 motion-reduce:transition-none">{member.displayName}</span>
                  <span className="col-start-1 row-start-1 max-w-0 truncate font-mono text-2xs opacity-0 blur-0 transition-[max-width,opacity,filter] duration-[250ms] ease-in-out group-hover/member:max-w-40 group-hover/member:opacity-100 group-focus-within/member:max-w-40 group-focus-within/member:opacity-100 motion-reduce:transition-none">{member.pubkeys[0]?truncatePubkey(member.pubkeys[0]):member.displayName}</span>
                </span>
              </div><div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground/70" data-settings-subcopy>
                <span>{enumLabel(locale,workspaceMembershipStateMessages,member.state)}</span>
                {member.pubkeys.map(pubkey=><span key={pubkey} title={pubkey}>{identity(member,pubkey,<code>{truncatePubkey(pubkey)}</code>)}</span>)}
              </div></div>
            </div>}/>}
        </div>
      </SettingsOptionGroup>
    </section>
    {active?<MemberProfilePanel key={`${active.principalId}:${active.pubkey}`} target={active} onClose={()=>setSelected(null)}/>:null}
  </div></AvatarHostProvider>;
}
