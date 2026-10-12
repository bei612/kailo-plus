import type {ProjectsPublishRequest} from "@client-kit/contracts";
import {verifyEvent} from "nostr-tools/pure";
import {TransportError} from "@client-kit/platform/transport";
import {relayClient} from "@/shared/api/relayClient";
import {signRelayEvent} from "@/shared/api/tauri";
import {classifyRelayPublishFailure,RelayPublishNotSentError} from "@/shared/api/relayPublishOutcome";
import type {BffClient} from "@client-kit/platform/client";
import {buildProjectBootstrapTemplates,buildGitIssueTags} from "@client-kit/platform/react/projects";

// Original projectCreation/projectDeletion; CLIENT signs and Relay decides ownership.
export function createProjectsPublisher(scopeKey:string,relayUrl:string,viewer:string,active:()=>boolean,client:Pick<BffClient,"workspaces">){
  const check=()=>{if(!active())throw new TransportError("Project identity changed");};
  return async(request:ProjectsPublishRequest,key:string,observeOnly=false,observation?:{eventId?:string;onPrepared:(eventId:string)=>void})=>{
    let enteredPublication=false;
    try {
      check();
      if(request.operation==="CREATE_ISSUE"){
        if(!request.targetEventId||request.workspaceId!==undefined||request.name!==undefined||request.description!==undefined
          ||request.visibility!==undefined||typeof request.title!=="string"||typeof request.body!=="string"
          ||!["issue","change-request","improvement"].includes(request.category??""))throw new Error("Invalid task creation");
        const [repo]=await relayClient.fetchEvents({ids:[request.targetEventId],kinds:[30617],limit:1});check();
        if(!repo||repo.id!==request.targetEventId||repo.kind!==30617||!verifyEvent(repo))throw new Error("Repository head unavailable");
        const slug=repo.tags.find(tag=>tag[0]==="d")?.[1];
        if(!slug)throw new Error("Repository coordinate unavailable");
        const tags=buildGitIssueTags({repoAddress:`30617:${repo.pubkey}:${slug}`,repoOwner:repo.pubkey,title:request.title,labels:[request.category!]});
        const content=request.body.trim();
        enteredPublication=true;
        const event=await relayClient.publishProjectIntent(`${scopeKey}:${key}`,relayUrl,async()=>{
          try {
            const [head]=await relayClient.fetchEvents({kinds:[30617],authors:[repo.pubkey],"#d":[slug],limit:1});check();
            if(!head||head.id!==repo.id||!verifyEvent(head))throw new Error("Repository head changed");
            const signed=await signRelayEvent({kind:1621,content,tags});check();
            if(signed.pubkey!==viewer||!verifyEvent(signed))throw new Error("Task signing identity changed");
            return signed;
          }catch(error){throw new RelayPublishNotSentError(error instanceof Error?error.message:String(error));}
        },observeOnly,observation);
        check();
        if(event.kind!==1621||event.pubkey!==viewer||!verifyEvent(event)||event.content!==content||JSON.stringify(event.tags)!==JSON.stringify(tags))
          throw new TransportError("Task publication receipt mismatch");
        return {eventId:event.id};
      }
      const creating=request.operation!=="DELETE";
      if(creating){
        if((request.operation!=="CREATE_PROJECT"&&request.operation!=="CREATE_REPOSITORY")||!request.workspaceId||!request.name||request.targetEventId
          ||request.title!==undefined||request.body!==undefined||request.category!==undefined
          ||request.operation==="CREATE_PROJECT"&&!['listed','unlisted'].includes(request.visibility??'')
          ||request.operation==="CREATE_REPOSITORY"&&request.visibility!==undefined)throw new Error("Invalid project creation");
      }else if(!request.targetEventId||request.workspaceId||request.name!==undefined||request.description!==undefined||request.visibility!==undefined
        ||request.title!==undefined||request.body!==undefined||request.category!==undefined)throw new Error("Invalid project deletion");
      const admitHome=async()=>{
        const workspace=(await client.workspaces()).find(row=>row.id===request.workspaceId&&row.isMember===true);check();
        if(!workspace)throw new Error("Project home channel unavailable");
        return workspace;
      };
      const workspace=creating?await admitHome():null;
      // DD-80: WorkspaceView.id is the original Channel id, including recovery.
      const templates=workspace?buildProjectBootstrapTemplates({name:request.name!,description:request.description,ownerPubkey:viewer,
        projectChannelId:workspace.id,projectVisibility:request.visibility??"listed"}):null;
      const template=templates?(request.operation==="CREATE_PROJECT"?templates.project:templates.repository):null;
      enteredPublication=true;
      const event=await relayClient.publishProjectIntent(`${scopeKey}:${key}`,relayUrl,async()=>{
        try {
        if(template&&templates){
          const heads=await relayClient.fetchEvents({kinds:[template.kind],authors:[viewer],"#d":[templates.dtag],limit:1});check();
          if(heads.length)throw new Error("Project coordinate already exists");
          await admitHome();
          const signed=await signRelayEvent(template);check();
          if(signed.pubkey!==viewer)throw new TransportError("Project signing identity changed");
          return signed;
        }
        const target=(await relayClient.fetchEvents({ids:[request.targetEventId!],kinds:[30621,30617],limit:1}))[0];check();
        if(!target||target.id!==request.targetEventId||![30621,30617].includes(target.kind))throw new Error("Project head unavailable");
        const slug=target.tags.find(tag=>tag[0]==="d")?.[1];
        if(!slug)throw new Error("Project coordinate unavailable");
        const [head]=await relayClient.fetchEvents({kinds:[target.kind],authors:[target.pubkey],"#d":[slug],limit:1});check();
        if(head?.id!==target.id)throw new Error("Project changed; refresh its current head");
        const signed=await signRelayEvent({kind:5,content:`Delete project ${target.tags.find(tag=>tag[0]==="name")?.[1]??slug}`,
          createdAt:Math.max(Math.floor(Date.now()/1_000),target.created_at+1),tags:[["a",`${target.kind}:${target.pubkey}:${slug}`]]});
        check();if(signed.pubkey!==viewer)throw new TransportError("Project signing identity changed");return signed;
        }catch(error){throw new RelayPublishNotSentError(error instanceof Error?error.message:String(error));}
      },observeOnly,observation);
      const expectedKind=request.operation==="DELETE"?5:request.operation==="CREATE_PROJECT"?30621:30617;
      check();if(event.kind!==expectedKind||event.pubkey!==viewer
        ||template&&(event.content!==template.content||JSON.stringify(event.tags)!==JSON.stringify(template.tags)))throw new TransportError("Project publication receipt identity mismatch");
      if(creating)await admitHome();
      return {eventId:event.id};
    }catch(error){
      if(!enteredPublication&&!observeOnly)throw new RelayPublishNotSentError(error instanceof Error?error.message:String(error));
      const failure=classifyRelayPublishFailure(error);
      if(observeOnly||failure?.kind==="outcomeUnknown"||!failure)throw new TransportError("Project publication outcome unknown");
      throw error;
    }
  };
}
