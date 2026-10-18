// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/issueMutations.ts::publishProjectIssue.
// The original kind-1621 payload travels through the existing publication host.
// hooks.ts::createProjectPullRequestComment review variants (DD-118(5)): a line anchor and/or the
// "request-changes" decision name the review head (`c`) the reviewer looked at; Core refuses a moved
// head and signs the original inline/changes-requested labels.
import {hashPayload} from "nostr-tools/nip98";
import {ProjectIssueCategory,ProjectPublicationOperation,ProjectPullRequestCommentDecision,ProjectPullRequestCommentSide,type ProjectsPublishRequest,type WebMessageAttachment} from "@client-kit/contracts";
import {newIdempotencyKey} from "../../governance";
import {BffError,isOutcomeUnknown,TransportError,writeFailure} from "../../transport";
import {loadProjectDirectory,type ProjectsHost} from "./projectEnumeration";
import {loadProjectWorkItems} from "./projectWorkItems";
import {buildGitIssueTags,type ProjectIssue} from "./projectIssues.mjs";
import {PR_CHANGES_REQUESTED_LABEL,PR_INLINE_COMMENT_LABEL,type ProjectPullRequest,type ProjectPullRequestCommentAnchor} from "./projectPullRequests.mjs";
import {buildImetaTags} from "../composer/features/messages/lib/imetaMediaMarkdown";
import type {Repository} from "./projectModels";
import type {CreateProjectWorkItemDialogInput} from "./CreateProjectWorkItemDialog";

type Intent={key:string;digest:string;targetEventId:string;eventId?:string;acceptedEventId?:string;commit?:string};
/** Original hooks.ts ProjectPullRequestCommentDecision plus the inline anchor of a review comment. */
export type ProjectPullRequestCommentReview={anchor?:ProjectPullRequestCommentAnchor;decision?:"request-changes"};
const REVIEW_COMMIT=/^[0-9a-f]{40}([0-9a-f]{24})?$/;
const eventId=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{64}$/.test(value);
function recovery<T>(action:()=>T):T {
  try{return action();}catch{throw new TransportError("Project publication outcome unknown");}
}

// Fixed hooks.ts::createProjectIssueComment / createProjectPullRequestComment: original e/a/p, then
// the inline anchor tags, then the change-request label (with `c` unless anchored), then imeta.
export function buildProjectCommentTags(repository:Pick<Repository,"owner"|"repoAddress">,issue:Pick<ProjectIssue,"id"|"author"|"recipients">,mentions:readonly string[],attachments:readonly WebMessageAttachment[],
  review?:ProjectPullRequestCommentReview&{commit:string}) {
  const recipients=new Set([repository.owner.toLowerCase(),issue.author.toLowerCase(),...issue.recipients.map(key=>key.toLowerCase()),...mentions.map(key=>key.toLowerCase())]);
  const anchor=review?.anchor;
  return [["e",issue.id,"","root"],["a",repository.repoAddress],...[...recipients].map(key=>["p",key]),
    ...(review&&anchor?[["t",PR_INLINE_COMMENT_LABEL],["c",review.commit],["file",anchor.path],["side",anchor.side],["line",String(anchor.line)]]:[]),
    ...(review?.decision?[["t",PR_CHANGES_REQUESTED_LABEL],...(anchor?[]:[["c",review.commit]])]:[]),
    ...buildImetaTags(attachments)];
}

async function publishProjectComment(host:ProjectsHost,projectId:string,repository:Repository,target:ProjectIssue|ProjectPullRequest,type:"issue"|"pull-request",
  content:string,mentions:string[],attachments:WebMessageAttachment[],signal:AbortSignal,onReadUnavailable?:()=>void,review?:ProjectPullRequestCommentReview) {
  if(!host.publish)throw new Error("Project publication unavailable");
  signal.throwIfAborted();
  const body=content.trim();
  if(!body)throw new Error("Comment cannot be empty");
  if(review&&type!=="pull-request")throw new Error("Review comments need a review");
  // A line comment keeps one retained intent per anchor; conversation comments share the review's.
  const anchor=review?.anchor;
  const slot=JSON.stringify([type==="issue"?"project-issue-comment-publication":"project-pull-request-comment-publication",host.scopeKey,projectId,repository.repoAddress,target.id,
    ...(anchor?[anchor.path,anchor.side,anchor.line]:[])]);
  const stored=recovery(()=>localStorage.getItem(slot));
  const previous:Intent|null=stored===null?null:recovery(()=>JSON.parse(stored));
  // The reviewed head is the one the reviewer looked at; a retained intent keeps its own.
  const commit=review?previous?.commit??(target as ProjectPullRequest).commit??"":undefined;
  if(commit!==undefined&&!REVIEW_COMMIT.test(commit))throw new Error("A review commit is required for review comments.");
  const digest=hashPayload([repository.repoAddress,target.id,body,mentions,attachments,...(review?[commit,anchor??null,review.decision??null]:[])]);
  if(stored!==null&&(!previous||typeof previous.key!=="string"||!/^[0-9a-f-]{36}$/.test(previous.key)||previous.digest!==digest
    ||previous.targetEventId!==target.id||previous.eventId!==undefined&&!eventId(previous.eventId)
    ||previous.acceptedEventId!==undefined&&!eventId(previous.acceptedEventId)
    ||previous.eventId&&previous.acceptedEventId&&previous.eventId!==previous.acceptedEventId))
    throw new TransportError("Project publication outcome unknown");
  const intent:Intent=previous??{key:newIdempotencyKey(),digest,targetEventId:target.id,...(commit?{commit}:{})};
  // Persist unconfirmed references before any publication. Never persist body.
  recovery(()=>localStorage.setItem(slot,JSON.stringify(intent)));
  const read=async()=>{try{return await loadProjectWorkItems(host,signal,projectId);}catch(error){onReadUnavailable?.();throw error;}};
  try {
    const before=await read();
    const matches=(item:(typeof before.items)[number])=>item.type===type&&(item.type==="issue"?item.issue.id:item.pullRequest.id)===target.id&&item.repository.repoAddress===repository.repoAddress;
    const current=before.items.find(matches);
    if(!current){onReadUnavailable?.();throw new Error("Project work item unavailable");}
    const tags=buildProjectCommentTags(current.repository,current.type==="issue"?current.issue:current.pullRequest,mentions,attachments,
      review&&commit?{...review,commit}:undefined);
    const reviewFields:Pick<ProjectsPublishRequest,"commit"|"reviewDecision"|"anchorPath"|"anchorSide"|"anchorLine">=review&&commit?{commit,
      ...(review.decision?{reviewDecision:ProjectPullRequestCommentDecision.RequestChanges}:{}),
      ...(anchor?{anchorPath:anchor.path,anchorSide:anchor.side==="old"?ProjectPullRequestCommentSide.Old:ProjectPullRequestCommentSide.New,anchorLine:anchor.line}:{})}:{};
    if(!intent.acceptedEventId){
      const receipt=await host.publish({operation:type==="issue"?ProjectPublicationOperation.CreateIssueComment:ProjectPublicationOperation.CreatePullRequestComment,targetEventId:intent.targetEventId,body,mentions,attachments,...reviewFields},
        intent.key,stored!==null,{eventId:intent.eventId,onPrepared:id=>{
          signal.throwIfAborted();
          if(!eventId(id))throw new TransportError("Project publication event unavailable");
          intent.eventId=id;recovery(()=>localStorage.setItem(slot,JSON.stringify(intent)));
        }});
      if(!eventId(receipt?.eventId)||intent.eventId&&intent.eventId!==receipt.eventId)throw new TransportError("Project publication outcome unknown");
      intent.acceptedEventId=receipt.eventId;recovery(()=>localStorage.setItem(slot,JSON.stringify(intent)));
    }
    signal.throwIfAborted();
    const snapshot=await read();
    const published=snapshot.events.find(event=>event.id===intent.acceptedEventId);
    const updated=snapshot.items.find(matches);
    if(snapshot.viewerPubkey!==before.viewerPubkey||!published||published.kind!==1||published.pubkey!==before.viewerPubkey
      ||published.content!==body||JSON.stringify(published.tags)!==JSON.stringify(tags)||!updated
      ||!(updated.type==="issue"?updated.issue:updated.pullRequest).comments.some(comment=>comment.id===published.id))throw new TransportError("Project publication outcome unknown");
    return {item:updated,snapshot,complete:()=>{
      signal.throwIfAborted();host.completePublication?.(intent.key,published.id);recovery(()=>localStorage.removeItem(slot));
    }};
  }catch(error){
    // A review comment the BFF refused definitively (moved head, no authority) was not published under this key.
    const definite=Boolean(review)&&!intent.acceptedEventId&&error instanceof BffError&&!isOutcomeUnknown(error);
    if(definite||stored===null&&!intent.acceptedEventId&&writeFailure(error).kind!=="unknown")recovery(()=>localStorage.removeItem(slot));
    if(!definite&&(stored!==null||intent.acceptedEventId))throw new TransportError("Project publication outcome unknown");
    throw error;
  }
}

export async function publishProjectIssueComment(host:ProjectsHost,projectId:string,repository:Repository,issue:ProjectIssue,
  content:string,mentions:string[],attachments:WebMessageAttachment[],signal:AbortSignal,onReadUnavailable?:()=>void) {
  const result=await publishProjectComment(host,projectId,repository,issue,"issue",content,mentions,attachments,signal,onReadUnavailable);
  if(result.item.type!=="issue")throw new TransportError("Project publication outcome unknown");
  return {...result,issue:result.item.issue};
}

export async function publishProjectPullRequestComment(host:ProjectsHost,projectId:string,repository:Repository,pullRequest:ProjectPullRequest,
  content:string,mentions:string[],attachments:WebMessageAttachment[],signal:AbortSignal,onReadUnavailable?:()=>void,review?:ProjectPullRequestCommentReview) {
  const result=await publishProjectComment(host,projectId,repository,pullRequest,"pull-request",content,mentions,attachments,signal,onReadUnavailable,review);
  if(result.item.type!=="pull-request")throw new TransportError("Project publication outcome unknown");
  return {...result,pullRequest:result.item.pullRequest};
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
