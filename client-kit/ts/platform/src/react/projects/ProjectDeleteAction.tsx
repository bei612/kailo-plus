// Original Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/sidebar/ui/SidebarProjectsSection.tsx confirmation and
// desktop/src/features/projects/projectDeletion.ts::deleteProject.
// The original modal/confirm behavior is retained; UNKNOWN keeps one intent.
import {useRef,useState,type ReactNode} from "react";
import * as Alert from "@radix-ui/react-alert-dialog";
import type {ProjectsPublishRequest} from "@client-kit/contracts";
import {newIdempotencyKey} from "../../governance";
import {TransportError,writeFailure} from "../../transport";
import {useUiT} from "../context";
import {Button} from "../profile/buzz/shared/ui/button";
import {MODAL_BACKDROP_BLUR_CLASS} from "../composer/shared/ui/modalBackdrop";
import {MODAL_CONTENT_MOTION_CLASS,MODAL_OVERLAY_MOTION_CLASS} from "../composer/shared/ui/modalMotion";
import {loadProjects,type ProjectsHost} from "./projectEnumeration";
import type {Project} from "./projectModels";

type Intent={key:string;targetEventId:string;eventId?:string;acceptedEventId?:string};

export function ProjectDeleteAction({project,headId,viewerPubkey,host,onDeleted,renderTrigger}:{
  project:Project;headId:string;viewerPubkey:string;host:ProjectsHost;onDeleted:()=>void;
  renderTrigger:(state:{onOpen:()=>void;pending:boolean})=>ReactNode;
}){
  const t=useUiT();const [open,setOpen]=useState(false);const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null);const inFlight=useRef(false);
  const storageKey=JSON.stringify(["project-delete-intent",host.scopeKey,project.projectAddress]);
  const read=():Intent|null=>{
    const text=sessionStorage.getItem(storageKey);if(text===null)return null;
    const value:unknown=JSON.parse(text);
    if(!value||typeof value!=="object"||!("key" in value)||!("targetEventId" in value)
      ||typeof value.key!=="string"||typeof value.targetEventId!=="string"
      ||!/^[0-9a-f-]{36}$/.test(value.key)||!/^[0-9a-f]{64}$/.test(value.targetEventId))throw new TransportError("Project deletion intent unavailable");
    const acceptedEventId="acceptedEventId" in value?value.acceptedEventId:undefined;
    if(acceptedEventId!==undefined&&(typeof acceptedEventId!=="string"||!/^[0-9a-f]{64}$/.test(acceptedEventId)))throw new TransportError("Project deletion receipt unavailable");
    const eventId="eventId" in value?value.eventId:undefined;
    if(eventId!==undefined&&(typeof eventId!=="string"||!/^[0-9a-f]{64}$/.test(eventId)))throw new TransportError("Project deletion event unavailable");
    if(eventId&&acceptedEventId&&eventId!==acceptedEventId)throw new TransportError("Project deletion receipt mismatch");
    return {key:value.key,targetEventId:value.targetEventId,eventId,acceptedEventId};
  };
  // This UI eligibility is not authority. Relay still proves its immutable
  // author/agent-owner relationship. Other device keys are not this owner.
  if(!host.publish||project.owner!==viewerPubkey)return null;
  const submit=async()=>{
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setMessage(null);
    let intent:Intent|null=null;let previouslyUnknown=false;let accepted=false;
    try{
      intent=read();previouslyUnknown=intent!==null;
      intent??={key:newIdempotencyKey(),targetEventId:headId};
      // Store only the original intent/event reference, never a signed event or
      // key. Scope is captured from the actual host; it grants no authorization.
      sessionStorage.setItem(storageKey,JSON.stringify(intent));
      const request:ProjectsPublishRequest={operation:"DELETE" as ProjectsPublishRequest["operation"],targetEventId:intent.targetEventId};
      if(!intent.acceptedEventId){
        const receipt=await host.publish!(request,intent.key,previouslyUnknown,{
          eventId:intent.eventId,
          onPrepared:eventId=>{
            if(!/^[0-9a-f]{64}$/.test(eventId)||!intent)throw new TransportError("Project deletion event unavailable");
            intent={...intent,eventId};
            // Before Native sends: persist only its original signed event ID.
            // A restarted session can observe it, never recreate its signature.
            sessionStorage.setItem(storageKey,JSON.stringify(intent));
          },
        });
        if(!receipt?.eventId||!/^[0-9a-f]{64}$/.test(receipt.eventId))throw new TransportError("Project publication outcome unknown");
        accepted=true;
        intent={...intent,acceptedEventId:receipt.eventId};
        // The ACK reference survives directory failure/remount. Retrying this
        // intent only observes current scope; it must never publish again.
        sessionStorage.setItem(storageKey,JSON.stringify(intent));
      }
      accepted=true;
      const projects=await loadProjects(host,new AbortController().signal);
      host.completePublication?.(intent.key,intent.acceptedEventId!);
      if(projects.some(current=>current.projectAddress===project.projectAddress)){
        sessionStorage.removeItem(storageKey);setMessage(t("projects.deleteUpdated"));return;
      }
      sessionStorage.removeItem(storageKey);setOpen(false);onDeleted();
    }catch(error){
      const unknown=previouslyUnknown||accepted||writeFailure(error).kind==="unknown";
      if(!unknown&&intent)sessionStorage.removeItem(storageKey);
      setMessage(t(unknown?"projects.deleteUnknown":"projects.deleteFailed"));
    }finally{inFlight.current=false;setBusy(false);}
  };
  return <Alert.Root open={open} onOpenChange={next=>{if(!busy)setOpen(next);}}>
    {renderTrigger({onOpen:()=>{if(!busy)setOpen(true);},pending:busy})}
    <Alert.Portal><Alert.Overlay className={`fixed inset-0 z-50 bg-black/60 ${MODAL_OVERLAY_MOTION_CLASS} ${MODAL_BACKDROP_BLUR_CLASS}`}/>
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
        <Alert.Content className={`pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl ${MODAL_CONTENT_MOTION_CLASS}`} data-testid={`project-delete-confirm-${project.dtag}`}>
          <div className="flex flex-col space-y-2 text-left"><Alert.Title className="text-xl font-semibold tracking-tight">{t("projects.deleteTitle")}</Alert.Title><Alert.Description className="text-sm text-muted-foreground">{t("projects.deleteDescription",{name:project.name})}</Alert.Description></div>
          {message?<p role="status" className="text-sm text-muted-foreground">{message}</p>:null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Alert.Cancel asChild><Button disabled={busy} type="button" variant="outline">{t("platform.cancel")}</Button></Alert.Cancel>
            <Alert.Action asChild><Button disabled={busy} type="button" variant="destructive" onClick={event=>{event.preventDefault();void submit();}}>{t(busy?"projects.deleting":"projects.delete")}</Button></Alert.Action>
          </div>
        </Alert.Content>
      </div>
    </Alert.Portal>
  </Alert.Root>;
}
