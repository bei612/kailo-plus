// Shared actual wrapper from fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/ui/ChannelPane.tsx::wrapIdlePanel/idleAuxiliarySurface.
import type * as React from "react";
import {IdleAuxiliaryPanel,type IdleAuxiliaryHeaderControls} from "./IdleAuxiliaryPanel";
import {FocusThreadDrawer} from "./FocusThreadDrawer";
import {RightAuxiliaryPane} from "./RightAuxiliaryPane";

export type IdleAuxiliaryProps={
  idleAuxiliaryPanel?:React.ReactNode;
  idleAuxiliaryHeaderActions?:IdleAuxiliaryHeaderControls;
  idleAuxiliaryOverridesThread?:boolean;
  idleAuxiliaryTitle?:string;
  onCloseIdleAuxiliaryPanel?:()=>void;
};

export function IdleAuxiliarySurface({idleAuxiliaryPanel,idleAuxiliaryHeaderActions,idleAuxiliaryTitle="",onCloseIdleAuxiliaryPanel,
  channelName,isFocusDrawer,isSinglePanelView,useSplitAuxiliaryPane,canResetWidth,onResetWidth,onResizeStart,widthPx,restoreFocusTarget}:IdleAuxiliaryProps&{
  channelName?:string;isFocusDrawer:boolean;isSinglePanelView:boolean;useSplitAuxiliaryPane:boolean;
  canResetWidth:boolean;onResetWidth:()=>void;onResizeStart:React.PointerEventHandler<HTMLButtonElement>;widthPx:number;
  restoreFocusTarget?:()=>HTMLElement|null;
}) {
  if(!idleAuxiliaryPanel||!onCloseIdleAuxiliaryPanel)return null;
  const panel=<IdleAuxiliaryPanel canResetWidth={canResetWidth} headerControls={idleAuxiliaryHeaderActions}
    isFocusDrawer={isFocusDrawer} isSinglePanelView={isSinglePanelView} onClose={onCloseIdleAuxiliaryPanel}
    onResetWidth={onResetWidth} onResizeStart={onResizeStart} title={idleAuxiliaryTitle} useSplitAuxiliaryPane={useSplitAuxiliaryPane} widthPx={widthPx}>
    {idleAuxiliaryPanel}
  </IdleAuxiliaryPanel>;
  return isFocusDrawer?<FocusThreadDrawer channelName={channelName} label={idleAuxiliaryTitle} onClose={onCloseIdleAuxiliaryPanel} restoreFocusTarget={restoreFocusTarget}>{panel}</FocusThreadDrawer>
    :useSplitAuxiliaryPane?<RightAuxiliaryPane canResetWidth={canResetWidth} onResetWidth={onResetWidth} onResizeStart={onResizeStart} testId="idle-auxiliary-panel" widthPx={widthPx}>{panel}</RightAuxiliaryPane>:panel;
}

// Same priority predicates as the fixed ChannelPane.helpers.ts, with only the
// currently supported channel/profile/thread consumers supplied by each host.
export function shouldPrioritizeIdleAuxiliary(overrideThread:boolean,hasIdleAuxiliary:boolean){return overrideThread&&hasIdleAuxiliary;}
export function shouldUseFocusIdleDrawer({channelManagementOpen,hasAgentSession,hasIdleAuxiliaryPanel,hasIdlePanelCloseHandler,hasProfilePanel,hasThreadSurface,overrideThread=false,useSplitAuxiliaryPane}:{
  channelManagementOpen:boolean;hasAgentSession:boolean;hasIdleAuxiliaryPanel:boolean;hasIdlePanelCloseHandler:boolean;hasProfilePanel:boolean;hasThreadSurface:boolean;overrideThread?:boolean;useSplitAuxiliaryPane:boolean;
}){return (useSplitAuxiliaryPane||overrideThread)&&!channelManagementOpen&&!hasAgentSession&&!hasProfilePanel&&(!hasThreadSurface||overrideThread)&&hasIdleAuxiliaryPanel&&hasIdlePanelCloseHandler;}
