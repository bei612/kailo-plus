import {useCallback,useEffect,useMemo,useState} from "react";
import type {ProjectPreferenceRequest} from "@client-kit/contracts";
import {checkedUserState,type CollaborationUserState} from "../../inbox";
import {isOutcomeUnknown,TransportError} from "../../transport";
import {useBffClient,useUiT} from "../context";

/** Original Added/remove semantics. Core CAS is the only preference authority. */
export function useProjectSidebarMembership(scopeKey:string){
  const client=useBffClient();const t=useUiT();
  const scope=useMemo(()=>({active:true,reading:0,busy:false,intent:null as ProjectPreferenceRequest|null,current:null as CollaborationUserState|null}),[client,scopeKey]);
  const [view,setView]=useState<{scope:typeof scope;state:CollaborationUserState|null;failed:boolean;pending:boolean}|null>(null);
  const present=(failed=false)=>{if(scope.active)setView({scope,state:scope.current,failed,pending:scope.busy||scope.intent!==null});};
  const read=useCallback(async()=>{
    const generation=++scope.reading;scope.current=null;
    if(scope.active)setView({scope,state:null,failed:false,pending:true});
    try{
      const next=checkedUserState(await client.collaborationUserState());
      if(next.projectPreferences===undefined)throw new TransportError("Project preferences unavailable");
      if(!scope.active||generation!==scope.reading)return;
      if(scope.intent&&next.version>scope.intent.version)scope.intent=null;
      scope.current=next;
      setView({scope,state:next,failed:false,pending:scope.busy||scope.intent!==null});
      return next;
    }catch{
      if(scope.active&&generation===scope.reading)setView({scope,state:null,failed:true,pending:scope.intent!==null});
    }
  },[client,scope]);
  useEffect(()=>{
    scope.active=true;void read();
    const focus=()=>{if(!scope.busy)void read();};
    window.addEventListener("focus",focus);
    return()=>{scope.active=false;scope.reading++;scope.current=null;window.removeEventListener("focus",focus);};
  },[scope,read]);
  const write=async(rechecking:boolean)=>{
    const request=scope.intent;
    if(!request||scope.busy||!scope.active)throw new TransportError("Project preference scope unavailable");
    scope.busy=true;let failed=false;present();
    try{
      const result=await client.setProjectPreference(request);
      if(!scope.active)throw new TransportError("Project preference scope changed");
      if(result.version!==request.version+1)throw new TransportError("Invalid user-state CAS response");
      scope.intent=null;
      if(!await read())throw new TransportError("Project preference confirmation unavailable");
    }catch(error){
      failed=true;
      if(scope.active){
        if(!rechecking&&!isOutcomeUnknown(error))scope.intent=null;
        scope.current=null;present(true);
      }
      throw error;
    }finally{scope.busy=false;present(failed);}
  };
  const change=async(projectAddress:string,selected:boolean)=>{
    if(!scope.active||scope.busy||scope.intent||!scope.current?.projectPreferences)throw new TransportError("Project preference unavailable");
    if((scope.current.projectPreferences[projectAddress]?.selected??false)===selected)return;
    scope.intent={projectAddress,selected,version:scope.current.version};
    await write(false);
  };
  const visible=view?.scope===scope?view:null;
  return {
    projectAddresses:Object.entries(visible?.state?.projectPreferences??{}).filter(([,entry])=>entry.selected).map(([address])=>address),
    pending:!visible?.state||visible.pending,
    problem:scope.intent?t("platform.profile.unknown"):visible?.failed?t("platform.loadFailed"):undefined,
    addProject:(address:string)=>change(address,true),
    removeProject:(address:string)=>change(address,false),
    // Explicit retry reuses the exact old CAS version. Focus remains read-only.
    refresh:async()=>{
      if(scope.busy)return;
      const current=await read();
      if(current&&scope.intent&&current.version===scope.intent.version)await write(true);
    },
  };
}
