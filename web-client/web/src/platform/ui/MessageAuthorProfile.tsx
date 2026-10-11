import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ProfileSummaryView, UserProfilePopoverSurface, UserProfilePopoverBody, type ProfilePopoverBodyProps } from "@client-kit/platform/react/pulse";
import { AuxiliaryPanel, AuxiliaryPanelBody, AuxiliaryPanelHeader, AuxiliaryPanelHeaderGroup, AuxiliaryPanelHeaderTitleBlock, RightAuxiliaryPane, useThreadPanelWidth, type AuxiliaryPanelLayout } from "@client-kit/platform/react/thread";
import { useEscapeKey } from "@client-kit/platform/react/thread/useEscapeKey";
import { useUiT } from "@client-kit/platform/react/context";
import { TransportError } from "@client-kit/platform/transport";
import { truncatePubkey } from "@client-kit/platform/format";
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
function messageAuthorQuery(target: MessageAuthor) {
  return {
    queryKey: ["platform", "message-author", target.principalId, target.conversationId ? "conversation" : "workspace", target.conversationId ?? target.workspaceId, target.pubkey, target.eventId],
    queryFn: async () => {
      const profile = await (target.conversationId
        ? bff.conversationMessageAuthorProfile(target.conversationId, target.eventId)
        : bff.messageAuthorProfile(target.workspaceId, target.eventId));
      if (profile.pubkey !== target.pubkey) throw new TransportError("Message author did not match the admitted event.");
      return profile;
    },
    retry: false as const,
    staleTime: 0,
  };
}

function useMessageAuthor(target: MessageAuthor) {
  return useQuery(messageAuthorQuery(target));
}

// Resolve before constructing TimelineMessage, as in Buzz formatMessageAuthor:
// rows, reply targets, accessibility and video comments share the same author.
// The event remains the read proof; even another event by this author cannot
// supply a profile for a failed/disabled query. Avatars share these exact keys.
export function useMessageAuthorLabels(scope: Omit<MessageAuthor, "eventId" | "pubkey">,
  events: readonly {id: string; pubkey: string; kind: number}[], available: boolean) {
  const t = useUiT();
  // System rows resolve their actors through the admitted member surface;
  // their Relay signer is not a message author (Buzz collectMessageAuthorPubkeys).
  const targets = [...new Map(events.filter(event => event.kind !== KIND_SYSTEM_MESSAGE)
    .map(event => [event.id, {...scope, eventId: event.id, pubkey: event.pubkey}])).values()];
  const queries = useQueries({
    queries: targets.map(target => ({...messageAuthorQuery(target), enabled: available})),
  });
  const profiles = new Map(targets.flatMap((target, index) => {
    const query = queries[index];
    return available && query.isSuccess && !query.isFetching ? [[target.eventId, query.data] as const] : [];
  }));
  return (event: {id: string; pubkey: string}, fallbackName?: string | null) => {
    const profile = profiles.get(event.id);
    return resolveUserLabel({pubkey: event.pubkey, fallbackName,
      profiles: profile ? {[normalizePubkey(profile.pubkey)]: {...profile, ownerPubkey: null}} : undefined,
      preferResolvedSelfLabel: true, t});
  };
}

export function MessageAuthorAvatar({ target, ...props }: {
  target: MessageAuthor;
} & Omit<UserAvatarProps, "avatarUrl" | "resolveMediaUrl">) {
  const query = useMessageAuthor(target);
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

export function MessageAuthorProfile({target,onClose,onStartDm,onWidthChange,isSinglePanelView=false,layout="standalone",transparentChrome=false}: {
  target:MessageAuthor;onClose:()=>void;onStartDm?: (pubkey:string)=>void|Promise<void>;
  onWidthChange?: (width: number) => void; isSinglePanelView?: boolean;
  layout?:AuxiliaryPanelLayout;transparentChrome?:boolean;
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
  useLayoutEffect(() => { onWidthChange?.(width.widthPx); }, [onWidthChange, width.widthPx]);
  useEscapeKey(onClose,true);
  const data=query.isSuccess&&!query.isFetching?query.data:undefined;
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
  const panel = <AuxiliaryPanel className="relative" layout={layout} transparentChrome={transparentChrome} onClose={onClose} widthPx={width.widthPx} onResizeStart={width.onResizeStart} isSinglePanelView={isSinglePanelView} splitPaneClamp={false}
    onResetWidth={width.onResetWidth} canResetWidth={width.canReset} testId="user-profile-panel"
    resizeHandleAriaLabel={t("platform.profile.resize")} resizeHandleTestId="user-profile-resize-handle"
    header={<AuxiliaryPanelHeader data-testid="user-profile-panel-header" inset={layout === "split" ? "default" : "wide"} resizeBorder={!isSinglePanelView && layout !== "split"}>
      <AuxiliaryPanelHeaderGroup><AuxiliaryPanelHeaderTitleBlock title={t("platform.settings.profile")}/></AuxiliaryPanelHeaderGroup>
    </AuxiliaryPanelHeader>}>
    <AuxiliaryPanelBody className="overflow-y-auto px-4 pb-6" data-testid="user-profile-scroll-body">
      {data?<ProfileSummaryView displayName={data.displayName??truncatePubkey(data.pubkey)}
        profile={data} pubkey={data.pubkey} copy={writeTextToClipboard} mediaUrl={(url)=>data.avatarMediaPaths[url]??url}
        messagePending={opening} onMessage={onStartDm?()=>{void openMessage();}:undefined}/>
        :query.isError?<div role="alert">{t("platform.loadFailed")}<Button variant="ghost" onClick={()=>void query.refetch()}>{t("platform.retry")}</Button></div>
        :<p role="status">{t("platform.loading")}</p>}
      {problem?<p role="alert">{problem}</p>:null}
    </AuxiliaryPanelBody>
  </AuxiliaryPanel>;
  return layout === "split" ? <RightAuxiliaryPane canResetWidth={width.canReset} constrainToAvailableSpace={false}
    onResetWidth={width.onResetWidth} onResizeStart={width.onResizeStart} widthPx={width.widthPx} testId="home-user-profile-panel">{panel}</RightAuxiliaryPane> : panel;
}
