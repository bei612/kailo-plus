// Original ProjectEntityFacepile, Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectEntityListRow.tsx. The public-key
// roster is replaced by current Principal membership, not device identities.
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";
import { WorkspaceMembershipState, type WorkspaceMemberView } from "@client-kit/contracts";
import { twMerge as cn } from "tailwind-merge";
import { useBffClient, useUiT } from "../context";
import { UserAvatar } from "../messages/UserAvatar";
import { MemberHover } from "../members";
import { UserProfilePopoverSurface } from "../pulse/UserProfilePopover";
import { TransportError } from "../../transport";

export type ProjectMemberRenderer=(member:WorkspaceMemberView,trigger:{className:string;label:string})=>ReactNode;

function ProjectMemberAvatar({workspaceId,member,scopeKey}:{workspaceId:string;member:WorkspaceMemberView;scopeKey:string}) {
  const client=useBffClient();
  const pubkey=member.pubkeys[0]!;
  const profile=useQuery({queryKey:["projects-member-avatar",scopeKey,workspaceId,member.principalId,pubkey],queryFn:async()=>{
    const current=await client.memberProfile(workspaceId,member.principalId,pubkey);
    if(current.pubkey!==pubkey)throw new TransportError("Project member identity changed");
    return current;
  },retry:false,refetchOnWindowFocus:"always"});
  const data=profile.isSuccess&&!profile.isFetching?profile.data:undefined;
  return <UserAvatar avatarUrl={data?.avatarUrl??null} displayName={data?.displayName??member.displayName}
    resolveMediaUrl={url=>data?.avatarMediaPaths[url]} shape="circle" size="xs"/>;
}

export function ProjectChannelMembers({workspaceId,scopeKey,onOpenProfile,renderMember}:{workspaceId:string;scopeKey:string;
  onOpenProfile:(target:{workspaceId:string;principalId:string;pubkey:string})=>void;renderMember?:ProjectMemberRenderer}) {
  const client=useBffClient();const t=useUiT();
  const roster=useQuery({queryKey:["projects-channel-members",scopeKey,workspaceId],queryFn:async()=>{
    const members=await client.members(workspaceId);
    const principals=new Set<string>();const pubkeys=new Set<string>();
    if(!Array.isArray(members))throw new TransportError("Invalid project channel roster");
    for(const member of members){
      if(!member||!member.principalId||principals.has(member.principalId)||typeof member.displayName!=="string"
        ||!Object.values(WorkspaceMembershipState).includes(member.state)||!Array.isArray(member.pubkeys)||new Set(member.pubkeys).size!==member.pubkeys.length
        ||member.pubkeys.some(key=>typeof key!=="string"||!/^[0-9a-f]{64}$/.test(key)||pubkeys.has(key)))
        throw new TransportError("Invalid project channel roster");
      principals.add(member.principalId);for(const key of member.pubkeys)pubkeys.add(key);
    }
    return members.filter(member=>member.state===WorkspaceMembershipState.Active&&member.pubkeys.length>0);
  },retry:false,refetchOnWindowFocus:"always"});
  const members=roster.isSuccess&&!roster.isFetching?roster.data:undefined;
  const shown=members?.slice(0,4);
  const overflow=members?members.length-(shown?.length??0):0;
  return <>
    {shown?<span className="flex shrink-0 items-center">{shown.map((member,index)=>{
      const pubkey=member.pubkeys[0]!;const label=member.displayName;
      const target={workspaceId,principalId:member.principalId,pubkey};
      const triggerClassName=cn("isolate relative inline-flex before:pointer-events-none before:absolute before:-inset-0.5 before:bg-background before:content-['']",
        "before:rounded-full","rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:before:opacity-0",index>0&&"-ml-1.5");
      if(renderMember)return <Fragment key={member.principalId}>{renderMember(member,{className:triggerClassName,label})}</Fragment>;
      return <UserProfilePopoverSurface key={member.principalId} pubkey={pubkey}
        triggerClassName={triggerClassName}
        triggerElement="span" triggerAriaLabel={t("members.openProfile",{name:label})} onOpenProfile={()=>onOpenProfile(target)}
        renderBody={props=><MemberHover {...props} target={target}/>}>
        <span className="relative z-10" title={label}><ProjectMemberAvatar workspaceId={workspaceId} member={member} scopeKey={scopeKey}/></span>
      </UserProfilePopoverSurface>;
    })}{overflow>0?<span className="-ml-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-3xs text-muted-foreground/65 ring-2 ring-background">+{overflow}</span>:null}</span>:null}
    {roster.isError?<span role="alert" className="sr-only">{t("platform.loadFailed")}</span>:null}
  </>;
}
