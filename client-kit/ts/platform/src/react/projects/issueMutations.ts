// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/issueMutations.ts::publishProjectIssue.
// The original kind-1621 payload travels through the existing publication host.
import {hashPayload} from "nostr-tools/nip98";
import {ProjectIssueCategory,ProjectPublicationOperation,type ProjectsPublishRequest} from "@client-kit/contracts";
import {newIdempotencyKey} from "../../governance";
import {TransportError,writeFailure} from "../../transport";
import {loadProjectDirectory,type ProjectsHost} from "./projectEnumeration";
import {loadProjectWorkItems} from "./projectWorkItems";
import {buildGitIssueTags} from "./projectIssues.mjs";
import type {Repository} from "./projectModels";
import type {CreateProjectWorkItemDialogInput} from "./CreateProjectWorkItemDialog";

type Intent={key:string;digest:string;targetEventId:string;eventId?:string;acceptedEventId?:string};
const eventId=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{64}$/.test(value);
function recovery<T>(action:()=>T):T {
  try{return action();}catch{throw new TransportError("Project publication outcome unknown");}
}

export async function publishProjectIssue(host:ProjectsHost,projectId:string,repository:Repository,input:CreateProjectWorkItemDialogInput,signal:AbortSignal) {
  if(!host.publish)throw new Error("Project publication unavailable");
  signal.throwIfAborted();
  const title=input.title.trim(),body=input.body.trim(),category=input.category??"issue";
  const categories={issue:ProjectIssueCategory.Issue,"change-request":ProjectIssueCategory.ChangeRequest,improvement:ProjectIssueCategory.Improvement};
  const slot=JSON.stringify(["project-issue-publication",host.scopeKey,projectId,repository.repoAddress]);
  const digest=hashPayload([repository.repoAddress,title,body,category]);
  const stored=recovery(()=>localStorage.getItem(slot));
  const previous:Intent|null=stored===null?null:recovery(()=>JSON.parse(stored));
  if(stored!==null&&(!previous||typeof previous.key!=="string"||!/^[0-9a-f-]{36}$/.test(previous.key)||previous.digest!==digest
    ||!eventId(previous.targetEventId)||previous.eventId!==undefined&&!eventId(previous.eventId)
    ||previous.acceptedEventId!==undefined&&!eventId(previous.acceptedEventId)
    ||previous.eventId&&previous.acceptedEventId&&previous.eventId!==previous.acceptedEventId))
    throw new TransportError("Project publication outcome unknown");
  // Re-read the project/repository relationship; a selected option is no grant.
  const directory=await loadProjectDirectory(host,signal).catch(error=>{if(stored!==null)throw new TransportError("Project publication outcome unknown");throw error;});
  const current=directory.projects.find(project=>project.id===projectId)?.repositories.find(repo=>repo.repoAddress===repository.repoAddress);
  if(!current)throw new TransportError("Project repository changed");
  const heads=directory.repositoryEvents.filter(event=>event.kind===30617&&event.pubkey===current.owner&&event.tags.some(tag=>tag[0]==="d"&&tag[1]===current.dtag));
  if(heads.length!==1||!eventId(heads[0]?.id))throw new TransportError("Project repository head unavailable");
  const intent:Intent=previous??{key:newIdempotencyKey(),digest,targetEventId:heads[0].id};
  const tags=buildGitIssueTags({repoAddress:current.repoAddress,repoOwner:current.owner,title,labels:[category]});
  signal.throwIfAborted();
  // Only recovery references and a request digest; no task body or signed event.
  recovery(()=>localStorage.setItem(slot,JSON.stringify(intent)));
  try {
    if(!intent.acceptedEventId){
      const request:ProjectsPublishRequest={operation:ProjectPublicationOperation.CreateIssue,targetEventId:intent.targetEventId,title,body,category:categories[category]};
      const receipt=await host.publish(request,intent.key,stored!==null,{eventId:intent.eventId,onPrepared:id=>{
        signal.throwIfAborted();
        if(!eventId(id))throw new TransportError("Project publication event unavailable");
        intent.eventId=id;recovery(()=>localStorage.setItem(slot,JSON.stringify(intent)));
      }});
      if(!eventId(receipt?.eventId)||intent.eventId&&intent.eventId!==receipt.eventId)throw new TransportError("Project publication outcome unknown");
      intent.acceptedEventId=receipt.eventId;recovery(()=>localStorage.setItem(slot,JSON.stringify(intent)));
    }
    signal.throwIfAborted();
    const snapshot=await loadProjectWorkItems(host,signal,projectId);
    const published=snapshot.events.find(event=>event.id===intent.acceptedEventId);
    if(snapshot.viewerPubkey!==directory.viewerPubkey||!published||published.kind!==1621||published.pubkey!==directory.viewerPubkey
      ||published.content!==body||JSON.stringify(published.tags)!==JSON.stringify(tags)
      ||!snapshot.items.some(item=>item.type==="issue"&&item.issue.id===published.id&&item.repository.repoAddress===current.repoAddress))
      throw new TransportError("Project publication outcome unknown");
    return {eventId:published.id,snapshot,complete:()=>{
      signal.throwIfAborted();host.completePublication?.(intent.key,published.id);recovery(()=>localStorage.removeItem(slot));
    }};
  } catch(error) {
    if(stored===null&&!intent.acceptedEventId&&writeFailure(error).kind!=="unknown")recovery(()=>localStorage.removeItem(slot));
    if(stored!==null||intent.acceptedEventId)throw new TransportError("Project publication outcome unknown");
    throw error;
  }
}
