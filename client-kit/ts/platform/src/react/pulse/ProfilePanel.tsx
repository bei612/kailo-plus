import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { useUiT } from "../context";
import { AuxiliaryPanel, AuxiliaryPanelBody, AuxiliaryPanelHeader, AuxiliaryPanelHeaderGroup, AuxiliaryPanelHeaderTitleBlock } from "../messages/thread/auxiliary";
import { useThreadPanelWidth } from "../messages/thread/useThreadPanelWidth";
import { useEscapeKey } from "../messages/thread/useEscapeKey";
import { Button } from "../profile/buzz/shared/ui/button";
import { truncateNpub, usePulseHost, useUserProfileQuery } from "./host";
import { ProfileSummaryView } from "./ProfileSummaryView";

/** Original public profile body in the existing resizable auxiliary panel. */
export function ProfilePanel({pubkey,onClose}:{pubkey:string;onClose:()=>void}) {
  const t=useUiT(); const host=usePulseHost(); const profile=useUserProfileQuery(pubkey);
  const width=useThreadPanelWidth();
  const [opening,setOpening]=useState(false); const [problem,setProblem]=useState<string|null>(null);
  useEscapeKey(onClose,true);
  return <AuxiliaryPanel onClose={onClose} widthPx={width.widthPx} onResizeStart={width.onResizeStart}
    onResetWidth={width.onResetWidth} canResetWidth={width.canReset} testId="user-profile-panel"
    resizeHandleAriaLabel={t("platform.profile.resize")} resizeHandleTestId="user-profile-resize-handle"
    header={<AuxiliaryPanelHeader data-testid="user-profile-panel-header" inset="wide" resizeBorder>
      <AuxiliaryPanelHeaderGroup><AuxiliaryPanelHeaderTitleBlock title={t("platform.settings.profile")}/></AuxiliaryPanelHeaderGroup>
    </AuxiliaryPanelHeader>}>
    <AuxiliaryPanelBody className="overflow-y-auto px-4 pb-6" data-testid="user-profile-scroll-body">
      {profile.isPending?<p role="status">{t("platform.loading")}</p>:profile.isError?
        <div role="alert">{t("platform.loadFailed")}<Button variant="ghost" onClick={()=>void profile.refetch()}>{t("platform.retry")}</Button></div>:
        <ProfileSummaryView displayName={profile.data?.displayName??truncateNpub(pubkey)} profile={profile.data} pubkey={pubkey} copy={host.copy} mediaUrl={host.mediaUrl}/>}
      {pubkey!==host.pubkey?<div className="mt-6 flex items-center justify-center gap-2">
        <Button disabled={opening} onClick={async()=>{setOpening(true);setProblem(null);try{await host.startDm(pubkey);onClose();}catch(error){setProblem(error instanceof Error?error.message:t("platform.loadFailed"));}finally{setOpening(false);}}}>
          <MessageCircle className="h-4 w-4"/>{t("pulse.startDm")}
        </Button>
      </div>:null}
      {problem?<p role="alert">{problem}</p>:null}
    </AuxiliaryPanelBody>
  </AuxiliaryPanel>;
}
