import {useEffect,useMemo} from "react";
import {ProjectsView,type ProjectsHost} from "@client-kit/platform/react/projects";
import {useUiT} from "@client-kit/platform/react/context";
import {relayClient} from "@/shared/api/relayClient";
import {useNativeSession} from "./activeCommunity";
import {createProjectsPublisher} from "./projectsTransport";

/** Native CLIENT still queries the original Relay, never the Web SERVER signer. */
export function useProjectsHost(){
  const session=useNativeSession();
  const scope=useMemo(()=>({active:true}),[session]);
  useEffect(()=>{scope.active=true;return()=>{scope.active=false;};},[scope]);
  const limit=session.facts.relayQueryLimit;
  const host=useMemo<ProjectsHost|null>(()=>{
    if(!limit||!Number.isSafeInteger(limit)||limit<1)return null;
    const check=()=>{if(!scope.active)throw new Error("Project identity changed");};
    const scopeKey=`${session.facts.communityHost}:${session.devicePubkey}`;
    return {scopeKey,publish:createProjectsPublisher(scopeKey,session.facts.relayUrl,session.devicePubkey,()=>scope.active,session.client),
      completePublication:(key,eventId)=>{check();relayClient.completeProjectIntent(`${scopeKey}:${key}`,session.facts.relayUrl,eventId);},query:async request=>{
      check();const kind=request.view==="PROJECTS"?30621:request.view==="REPOSITORIES"?30617:request.view==="DELETIONS"?5:null;
      if(kind===null||kind===5&&!request.coordinates?.length)throw new Error("Invalid project query");
      const events=await relayClient.fetchEvents({kinds:[kind],limit,since:request.since,until:request.until,
        ...(request.coordinates?{"#a":request.coordinates}:{})});
      check();return {events,limit,pubkey:session.devicePubkey};
    }};
  },[session,scope,limit]);
  return host;
}
export function ProjectsScreen({selectedProjectId,onSelectedProjectChange}:{selectedProjectId?:string|null;onSelectedProjectChange?:(id:string|null)=>void}={}){
  const host=useProjectsHost();const t=useUiT();
  return host?<ProjectsView host={host} selectedProjectId={selectedProjectId} onSelectedProjectChange={onSelectedProjectChange}/>:<p role="alert">{t("platform.loadFailed")}</p>;
}
