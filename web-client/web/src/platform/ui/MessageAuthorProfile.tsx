import { useQueries, useQuery } from "@tanstack/react-query";
import type { WebProfileView } from "@client-kit/contracts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ProfileSummaryView, UserProfileAgentPanel, UserProfilePanelFrame, UserProfilePopoverSurface, UserProfilePopoverBody, useProfileAgentLookup, type ProfilePopoverBodyProps, type UserProfileAgentScope } from "@client-kit/platform/react/pulse";
import { useProfileWave } from "@client-kit/platform/react/pulse/profile-direct-message";
import { AuxiliaryPanelBody, AuxiliaryPanelHeaderGroup, AuxiliaryPanelHeaderTitleBlock, RightAuxiliaryPane, useIsThreadPanelOverlay, useThreadPanelWidth, type AuxiliaryPanelLayout } from "@client-kit/platform/react/thread";
import { useEscapeKey } from "@client-kit/platform/react/thread/useEscapeKey";
import { useUiT } from "@client-kit/platform/react/context";
import { TransportError } from "@client-kit/platform/transport";
import { unknownMemberLabel } from "@client-kit/platform/react/messages/system/identity";
import { UserAvatar, type UserAvatarProps } from "@client-kit/platform/react/messages";
import { resolveUserLabel } from "@client-kit/platform/react/messages/system/identity";
import { normalizePubkey } from "@client-kit/platform/react/conversations/pubkey";
import { KIND_SYSTEM_MESSAGE } from "@client-kit/platform/react/thread/kinds";
import { bff } from "../bff-client";
import { Button } from "@/shared/ui/button";
import { writeTextToClipboard } from "@/shared/lib/clipboard";

export type MessageAuthor = {
  principalId: string;
  workspaceId: string;
  conversationId?: string;
  eventId: string;
  pubkey: string;
};

// The original avatars and open/hover surfaces share this admitted-event read.
// No Community directory lookup: the current message is the authorization proof.
function messageAuthorsQuery(scope: Omit<MessageAuthor, "eventId" | "pubkey">, targets: readonly {eventId:string;pubkey:string}[]) {
  const ordered = [...targets].sort((a,b)=>a.eventId.localeCompare(b.eventId));
  return {
    queryKey: ["platform", "message-author", scope.principalId, scope.conversationId ? "conversation" : "workspace", scope.conversationId ?? scope.workspaceId, ordered],
    queryFn: async () => {
      const request={eventIds:ordered.map(target=>target.eventId)};
      const view = await (scope.conversationId
        ? bff.conversationMessageAuthorProfiles(scope.conversationId, request)
        : bff.messageAuthorProfiles(scope.workspaceId, request));
      if (!view?.profiles || Object.keys(view.profiles).length !== ordered.length
        || ordered.some(target=>view.profiles[target.eventId]?.pubkey !== target.pubkey)) {
        throw new TransportError("Message authors did not match the admitted events.");
      }
      return view.profiles;
    },
    retry: false as const,
    staleTime: 0,
  };
}

function useMessageAuthor(target: MessageAuthor) {
  return useQuery({...messageAuthorsQuery(target,[target]),select:profiles=>profiles[target.eventId]});
}

function authorScopeKey(scope: Omit<MessageAuthor,"eventId"|"pubkey">) {
  return JSON.stringify([scope.principalId,scope.conversationId?"conversation":"workspace",scope.conversationId??scope.workspaceId]);
}

// Inbox spans scopes. Each batch keeps its own fresh admission and cannot lend
// another workspace/conversation's successful profile to an unavailable group.
export function useMessageAuthorProfiles(targets:readonly MessageAuthor[],available:boolean) {
  const groups=new Map<string,{scope:MessageAuthor;targets:Map<string,MessageAuthor>}>();
  for(const target of targets) {
    const key=authorScopeKey(target);
    let group=groups.get(key);
    if(!group){group={scope:target,targets:new Map()};groups.set(key,group);}
    group.targets.set(target.eventId,target);
  }
  const entries=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b));
  const queries=useQueries({queries:entries.map(([,group])=>({...messageAuthorsQuery(group.scope,[...group.targets.values()]),enabled:available}))});
  const profiles=new Map(entries.map(([key],index)=>{
    const query=queries[index];
    return [key,available&&query?.isSuccess&&!query.isFetching?query.data:{}] as const;
  }));
  return (target:Omit<MessageAuthor,"pubkey">)=>profiles.get(authorScopeKey(target))?.[target.eventId];
}

// Resolve before constructing TimelineMessage, as in Buzz formatMessageAuthor:
// rows, reply targets, accessibility and video comments share the same author.
// The event remains the read proof; even another event by this author cannot
// supply a profile for a failed/disabled query. Avatars consume this exact result.
export function useMessageAuthorLabels(scope: Omit<MessageAuthor, "eventId" | "pubkey">,
  events: readonly {id: string; pubkey: string; kind: number}[], available: boolean) {
  const t = useUiT();
  // System rows resolve their actors through the admitted member surface;
  // their Relay signer is not a message author (Buzz collectMessageAuthorPubkeys).
  const targets = [...new Map(events.filter(event => event.kind !== KIND_SYSTEM_MESSAGE)
    .map(event => [event.id, {...scope, eventId: event.id, pubkey: event.pubkey}])).values()];
  const profileFor = useMessageAuthorProfiles(targets,available);
  const label = (event: {id: string; pubkey: string}, fallbackName?: string | null) => {
    const profile = profileFor({...scope,eventId:event.id});
    return resolveUserLabel({pubkey: event.pubkey, fallbackName,
      profiles: profile ? {[normalizePubkey(profile.pubkey)]: {...profile,
        displayName: profile.displayName ?? null, avatarUrl: profile.avatarUrl ?? null,
        about: profile.about ?? null, nip05Handle: profile.nip05Handle ?? null, ownerPubkey: null}} : undefined,
      preferResolvedSelfLabel: true, t});
  };
  // Avatars consume exactly the same admitted batch result, not another query
  // for every row. A failed/in-flight read exposes neither labels nor avatars.
  return Object.assign(label,{profile:(eventId:string)=>profileFor({...scope,eventId})});
}

export function MessageAuthorAvatar({ target, profile, ...props }: {
  target: MessageAuthor;
  profile?: {value:WebProfileView|undefined};
} & Omit<UserAvatarProps, "avatarUrl" | "resolveMediaUrl">) {
  if (profile) return <UserAvatar {...props} avatarUrl={profile.value?.pubkey===target.pubkey?profile.value.avatarUrl??null:null}
    resolveMediaUrl={(url)=>profile.value?.avatarMediaPaths[url]??url}/>;
  return <QueriedMessageAuthorAvatar target={target} {...props}/>;
}

function QueriedMessageAuthorAvatar({target,...props}: {target:MessageAuthor}&Omit<UserAvatarProps,"avatarUrl"|"resolveMediaUrl">) {
  const query=useMessageAuthor(target);
  const data = query.isSuccess && !query.isFetching ? query.data : undefined;
  return <UserAvatar {...props} avatarUrl={data?.avatarUrl ?? null}
    resolveMediaUrl={(url) => data?.avatarMediaPaths[url] ?? url} />;
}

export function MessageAuthorIdentity({ target, children, onOpen, triggerElement, triggerClassName }: {
  target: MessageAuthor; children: ReactNode; onOpen: () => void;
  triggerElement?: "div" | "span"; triggerClassName?: string;
}) {
  const t=useUiT();
  return <UserProfilePopoverSurface pubkey={target.pubkey} triggerAriaLabel={t("platform.settings.profile")}
    triggerElement={triggerElement} triggerClassName={triggerClassName}
    onOpenProfile={onOpen} renderBody={(props) => <MessageAuthorHover {...props} target={target} />}>
    {children}
  </UserProfilePopoverSurface>;
}

function MessageAuthorHover({target,...props}: ProfilePopoverBodyProps & {target:MessageAuthor}) {
  const t=useUiT();
  const query=useMessageAuthor(target);
  const data=query.isSuccess&&!query.isFetching?query.data:undefined;
  return <UserProfilePopoverBody {...props}
    profile={data}
    mediaUrl={(url)=>data?.avatarMediaPaths[url]??url}
    status={!data?<p role={query.isError?"alert":"status"}>{t(query.isError?"platform.loadFailed":"platform.loading")}</p>:undefined}/>;
}

export function MessageAuthorProfile({target,onClose,onStartDm,onWidthChange,isSinglePanelView=false,layout="standalone",transparentChrome=false,agentScope}: {
  target:MessageAuthor;onClose:()=>void;onStartDm?: (pubkey:string)=>void|Promise<void>;
  onWidthChange?: (width: number) => void; isSinglePanelView?: boolean;
  layout?:AuxiliaryPanelLayout;transparentChrome?:boolean;
  /**
   * DD-125(6), 17 §8: the admitted Workspace of this message. An author that is one of its Agents
   * opens the shared Agent panel (tabs, sections, focused views, activity); otherwise public only.
   */
  agentScope?:UserProfileAgentScope;
}) {
  const t=useUiT();
  const query=useMessageAuthor(target);
  const owner=useMemo(()=>({active:true,busy:false}),
    [target.principalId,target.workspaceId,target.conversationId,target.eventId,target.pubkey]);
  const currentOwner=useRef(owner);currentOwner.current=owner;
  const [opening,setOpening]=useState(false);
  const [problem,setProblem]=useState<string|null>(null);
  useEffect(()=>{owner.active=true;setOpening(false);setProblem(null);return()=>{owner.active=false;};},[owner]);
  const width=useThreadPanelWidth();
  const isOverlay=useIsThreadPanelOverlay();
  useLayoutEffect(() => { onWidthChange?.(width.widthPx); }, [onWidthChange, width.widthPx]);
  useEscapeKey(onClose,true);
  const data=query.isSuccess&&!query.isFetching?query.data:undefined;
  const agent=useProfileAgentLookup(agentScope,target.pubkey);
  // DD-125(3) original Wave tile beside Message (the host's people directory excludes Agents).
  const wave=useProfileWave(onStartDm?data?.pubkey:undefined,onClose);
  async function openMessage() {
    if(!data||!onStartDm||owner.busy||!owner.active||currentOwner.current!==owner)return;
    owner.busy=true;setOpening(true);setProblem(null);
    try {
      await onStartDm(data.pubkey);
      if(owner.active&&currentOwner.current===owner)onClose();
    } catch(error) {
      if(owner.active&&currentOwner.current===owner)
        setProblem(error instanceof Error?error.message:t("platform.loadFailed"));
    } finally {
      owner.busy=false;
      if(owner.active&&currentOwner.current===owner)setOpening(false);
    }
  }
  const panel = agent.status==="agent"&&agentScope ? <UserProfileAgentPanel key={target.pubkey} isSplitLayout={layout === "split"} isOverlay={isOverlay}
    transparentChrome={transparentChrome} onClose={onClose} widthPx={width.widthPx} onResizeStart={width.onResizeStart}
    isSinglePanelView={isSinglePanelView} splitPaneClamp={false} onResetWidth={width.onResetWidth} canResetWidth={width.canReset}
    displayName={data?.displayName??(agent.installation.agentDisplayName?.trim()||unknownMemberLabel())}
    installation={agent.installation} rows={agent.rows} reload={agent.reload} scope={agentScope}
    profile={data} pubkey={target.pubkey} mediaUrl={(url)=>data?.avatarMediaPaths[url]??url}/>
  : <UserProfilePanelFrame isSplitLayout={layout === "split"} isOverlay={isOverlay} transparentChrome={transparentChrome} onClose={onClose} widthPx={width.widthPx} onResizeStart={width.onResizeStart} isSinglePanelView={isSinglePanelView} splitPaneClamp={false}
    onResetWidth={width.onResetWidth} canResetWidth={width.canReset}
    addAgentToChannelDialog={null} editAgentDialog={null} personaDialogs={null} headerActions={null}
    stickyChromeActive={false} stickyChromeEnabled={false} stickyChromeHeight={0}
    headerLeftContent={<AuxiliaryPanelHeaderGroup><AuxiliaryPanelHeaderTitleBlock title={t("platform.settings.profile")}/></AuxiliaryPanelHeaderGroup>}
    profileBody={
    <AuxiliaryPanelBody className="overflow-y-auto px-4 pb-6" data-testid="user-profile-scroll-body">
      {data&&agent.status!=="pending"?<ProfileSummaryView displayName={data.displayName??unknownMemberLabel()}
        profile={data} pubkey={data.pubkey} copy={writeTextToClipboard} mediaUrl={(url)=>data.avatarMediaPaths[url]??url}
        messagePending={opening} onMessage={onStartDm?()=>{void openMessage();}:undefined}
        onWave={wave.onWave} wavePending={wave.pending}/>
        :query.isError&&agent.status!=="pending"?<div role="alert">{t("platform.loadFailed")}<Button variant="ghost" onClick={()=>void query.refetch()}>{t("platform.retry")}</Button></div>
        :<p role="status">{t("platform.loading")}</p>}
      {problem?<p role="alert">{problem}</p>:null}
    </AuxiliaryPanelBody>
  }/>;
  return layout === "split" ? <RightAuxiliaryPane canResetWidth={width.canReset} constrainToAvailableSpace={false}
    onResetWidth={width.onResetWidth} onResizeStart={width.onResizeStart} widthPx={width.widthPx} testId="home-user-profile-panel">{panel}</RightAuxiliaryPane> : panel;
}
