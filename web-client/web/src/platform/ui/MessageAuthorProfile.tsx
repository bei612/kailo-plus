import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, type ReactNode } from "react";
import { ProfileSummaryView, UserProfilePopoverSurface, UserProfilePopoverBody, type ProfilePopoverBodyProps } from "@client-kit/platform/react/pulse";
import { AuxiliaryPanel, AuxiliaryPanelBody, AuxiliaryPanelHeader, AuxiliaryPanelHeaderGroup, AuxiliaryPanelHeaderTitleBlock, useThreadPanelWidth } from "@client-kit/platform/react/thread";
import { useEscapeKey } from "@client-kit/platform/react/thread/useEscapeKey";
import { useUiT } from "@client-kit/platform/react/context";
import { TransportError } from "@client-kit/platform/transport";
import { truncatePubkey } from "@client-kit/platform/format";
import { UserAvatar, type UserAvatarProps } from "@client-kit/platform/react/messages";
import { bff } from "../bff-client";
import { Button } from "@/shared/ui/button";

export type MessageAuthor = {
  principalId: string;
  workspaceId: string;
  conversationId?: string;
  eventId: string;
  pubkey: string;
};

// The original avatars and open/hover surfaces share this admitted-event read.
// No Community directory lookup: the current message is the authorization proof.
function useMessageAuthor(target: MessageAuthor) {
  return useQuery({
    queryKey: ["platform", "message-author", target.principalId, target.conversationId ? "conversation" : "workspace", target.conversationId ?? target.workspaceId, target.pubkey, target.eventId],
    queryFn: async () => {
      const profile = await (target.conversationId
        ? bff.conversationMessageAuthorProfile(target.conversationId, target.eventId)
        : bff.messageAuthorProfile(target.workspaceId, target.eventId));
      if (profile.pubkey !== target.pubkey) throw new TransportError("Message author did not match the admitted event.");
      return profile;
    },
    retry: false,
    staleTime: 0,
  });
}

const copy = (value: string) => navigator.clipboard.writeText(value);

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

export function MessageAuthorProfile({target,onClose,onStartDm,onWidthChange,isSinglePanelView=false}: {
  target:MessageAuthor;onClose:()=>void;onStartDm?: (pubkey:string)=>void;
  onWidthChange?: (width: number) => void; isSinglePanelView?: boolean;
}) {
  const t=useUiT();
  const query=useMessageAuthor(target);
  const width=useThreadPanelWidth();
  useLayoutEffect(() => { onWidthChange?.(width.widthPx); }, [onWidthChange, width.widthPx]);
  useEscapeKey(onClose,true);
  const data=query.isSuccess&&!query.isFetching?query.data:undefined;
  return <AuxiliaryPanel onClose={onClose} widthPx={width.widthPx} onResizeStart={width.onResizeStart} isSinglePanelView={isSinglePanelView}
    onResetWidth={width.onResetWidth} canResetWidth={width.canReset} testId="user-profile-panel"
    resizeHandleAriaLabel={t("platform.profile.resize")} resizeHandleTestId="user-profile-resize-handle"
    header={<AuxiliaryPanelHeader data-testid="user-profile-panel-header" inset="wide" resizeBorder>
      <AuxiliaryPanelHeaderGroup><AuxiliaryPanelHeaderTitleBlock title={t("platform.settings.profile")}/></AuxiliaryPanelHeaderGroup>
    </AuxiliaryPanelHeader>}>
    <AuxiliaryPanelBody className="overflow-y-auto px-4 pb-6" data-testid="user-profile-scroll-body">
      {data?<ProfileSummaryView displayName={data.displayName??truncatePubkey(data.pubkey)}
        profile={data} pubkey={data.pubkey} copy={copy} mediaUrl={(url)=>data.avatarMediaPaths[url]??url}
        onMessage={onStartDm?()=>onStartDm(data.pubkey):undefined}/>
        :query.isError?<div role="alert">{t("platform.loadFailed")}<Button variant="ghost" onClick={()=>void query.refetch()}>{t("platform.retry")}</Button></div>
        :<p role="status">{t("platform.loading")}</p>}
    </AuxiliaryPanelBody>
  </AuxiliaryPanel>;
}
