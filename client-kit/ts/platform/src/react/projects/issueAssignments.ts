// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/issueAssignments.ts::writeProjectIssueAssignment.
// The original HUMAN assignment event travels through the governed host.
import { hashPayload } from "nostr-tools/nip98";
import { ProjectPublicationOperation } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import { TransportError, writeFailure } from "../../transport";
import { translateCurrent as t } from "../../i18n";
import type { ProjectsHost } from "./projectEnumeration";
import { loadProjectWorkItems } from "./projectWorkItems";
import type { Repository } from "./projectModels";
import { ISSUE_ASSIGNMENT_LABEL, ISSUE_UNASSIGNMENT_LABEL, type ProjectIssue } from "./projectIssues.mjs";
import type { BffClient } from "../../client";
import type { ConversationParticipant } from "@client-kit/contracts";

export async function loadProjectAssignmentHumans(client:Pick<BffClient,"conversationParticipants">,signal:AbortSignal) {
  const people=new Map<string,ConversationParticipant>();
  const cursors=new Set<string>();
  let cursor:string|undefined;
  do{
    signal.throwIfAborted();
    const page=await client.conversationParticipants(cursor);
    signal.throwIfAborted();
    for(const person of page.items)for(const pubkey of person.pubkeys){
      if(!/^[0-9a-f]{64}$/.test(pubkey)||people.has(pubkey)&&people.get(pubkey)!.principalId!==person.principalId)
        throw new Error(t("projects.assignment.failed"));
      people.set(pubkey,person);
    }
    cursor=page.nextCursor;
    if(cursor){if(cursors.has(cursor))throw new Error(t("projects.assignment.failed"));cursors.add(cursor);}
  }while(cursor);
  return people;
}

export type IssueAssignmentOperation = "assign" | "unassign";
export function buildProjectIssueAssignment(operation: IssueAssignmentOperation, issueId: string,
  repoAddress: string, assignee: string, label: string, priorEventId?: string) {
  const normalizedLabel = label.trim();
  if (!normalizedLabel || Array.from(normalizedLabel).length > 128) throw new Error(t("projects.assignment.failed"));
  return {
    content: operation === "assign" ? `Assigned this task to ${normalizedLabel}` : `Unassigned ${normalizedLabel} from this task`,
    tags: [["e", issueId, "", "root"], ["a", repoAddress], ["p", assignee.toLowerCase()],
      ["t", operation === "assign" ? ISSUE_ASSIGNMENT_LABEL : ISSUE_UNASSIGNMENT_LABEL],
      ...(priorEventId ? [["prior", priorEventId]] : [])],
  };
}

type Intent = { key: string; digest: string; targetEventId: string; viewer: string; operation: IssueAssignmentOperation;
  assigneeLabel: string; assigneePubkey?:string; priorEventId?: string; eventId?: string; acceptedEventId?: string };
const eventId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const unknown = () => new TransportError(t("projects.assignment.unknown"));
function recover<T>(action: () => T): T { try { return action(); } catch { throw unknown(); } }
const intentSlot = (host:ProjectsHost,projectId:string,repository:Repository,issue:ProjectIssue) =>
  JSON.stringify(["project-issue-self-assignment",host.scopeKey,projectId,repository.repoAddress,issue.id]);
function intentDigest(operation:IssueAssignmentOperation,repository:Repository,issue:ProjectIssue,viewer:string,label:string,assignee:string){
  // Preserve the already-published self intent format during this extension.
  return hashPayload([operation,repository.repoAddress,issue.id,viewer,label,...(assignee===viewer?[]:[assignee])]);
}
export function readProjectIssueAssignmentIntent(host:ProjectsHost,projectId:string,repository:Repository,issue:ProjectIssue,viewer:string):Intent|null {
  const stored=recover(()=>localStorage.getItem(intentSlot(host,projectId,repository,issue)));
  if(stored===null)return null;
  const intent:Intent=recover(()=>JSON.parse(stored));
  if(!intent||typeof intent.key!=="string"||!/^[0-9a-f-]{36}$/.test(intent.key)
    ||intent.targetEventId!==issue.id||intent.viewer!==viewer||!["assign","unassign"].includes(intent.operation)
    ||typeof intent.assigneeLabel!=="string"||!intent.assigneeLabel.trim()||intent.assigneeLabel!==intent.assigneeLabel.trim()
    ||Array.from(intent.assigneeLabel).length>128
    ||intent.assigneePubkey!==undefined&&!eventId(intent.assigneePubkey)
    ||intent.assigneePubkey!==undefined&&intent.assigneePubkey!==viewer&&intent.priorEventId!==undefined
    ||intent.digest!==intentDigest(intent.operation,repository,issue,viewer,intent.assigneeLabel,intent.assigneePubkey??viewer)
    ||intent.priorEventId!==undefined&&!eventId(intent.priorEventId)
    ||intent.eventId!==undefined&&!eventId(intent.eventId)
    ||intent.acceptedEventId!==undefined&&!eventId(intent.acceptedEventId)
    ||intent.eventId&&intent.acceptedEventId&&intent.eventId!==intent.acceptedEventId)throw unknown();
  return intent;
}

export async function publishProjectIssueAssignment(host: ProjectsHost, projectId: string, repository: Repository,
  issue: ProjectIssue, viewer: string, operation: IssueAssignmentOperation, label: string,
  signal: AbortSignal, onReadUnavailable: () => void,assigneePubkey=viewer,client?:Pick<BffClient,"conversationParticipants">) {
  signal.throwIfAborted();
  if (!host.publish || !eventId(viewer)||!eventId(assigneePubkey)) throw new Error(t("projects.assignment.failed"));
  const self=assigneePubkey===viewer;
  const assigneeLabel = label.trim();
  const slot = intentSlot(host,projectId,repository,issue);
  const digest = intentDigest(operation,repository,issue,viewer,assigneeLabel,assigneePubkey);
  const previous = readProjectIssueAssignmentIntent(host,projectId,repository,issue,viewer);
  if(previous&&previous.digest!==digest)throw unknown();
  const read = async () => {
    try { return await loadProjectWorkItems(host, signal, projectId); }
    catch (error) { onReadUnavailable(); throw error; }
  };
  const humans = async () => {
    if(!client)throw new Error(t("projects.assignment.failed"));
    try{return await loadProjectAssignmentHumans(client,signal);}
    catch(error){onReadUnavailable();throw error;}
  };
  let intent = previous;
  try {
    const before = await read();
    const current = before.items.find(item => item.type === "issue" && item.issue.id === issue.id && item.repository.repoAddress === repository.repoAddress);
    if (before.viewerPubkey !== viewer || !current || current.type !== "issue") {
      onReadUnavailable(); throw new Error(t("projects.assignment.failed"));
    }
    if(!self){
      if((current.issue.author!==viewer&&current.repository.owner!==viewer)
        ||!(await humans()).has(assigneePubkey))throw new Error(t("projects.assignment.failed"));
    }
    intent ??= { key: newIdempotencyKey(), digest, targetEventId: issue.id, viewer, operation, assigneeLabel,
      ...(self?{priorEventId:current.issue.assigneeOperationHeads[viewer]}:{assigneePubkey}) };
    const template = buildProjectIssueAssignment(operation, issue.id, repository.repoAddress, assigneePubkey, assigneeLabel, intent.priorEventId);
    // Keep the original operation/target/label reachable after a lost response.
    // This is not Task content or an assignment authority; fresh reads decide.
    recover(() => localStorage.setItem(slot, JSON.stringify(intent)));
    if (!intent.acceptedEventId) {
      const pending = intent;
      const receipt = await host.publish({
        operation: self?(operation === "assign" ? ProjectPublicationOperation.SelfAssignIssue : ProjectPublicationOperation.SelfUnassignIssue)
          :(operation === "assign" ? ProjectPublicationOperation.AssignIssue : ProjectPublicationOperation.UnassignIssue),
        targetEventId: issue.id, assigneeLabel, ...(pending.priorEventId ? { priorEventId: pending.priorEventId } : {}),
        ...(self?{}:{assigneePubkey}),
      }, pending.key, previous !== null, { eventId: pending.eventId, onPrepared: id => {
        signal.throwIfAborted();
        if (!eventId(id)) throw unknown();
        pending.eventId = id; recover(() => localStorage.setItem(slot, JSON.stringify(pending)));
      } });
      if (!eventId(receipt?.eventId) || pending.eventId && pending.eventId !== receipt.eventId) throw unknown();
      pending.acceptedEventId = receipt.eventId; recover(() => localStorage.setItem(slot, JSON.stringify(pending)));
    }
    signal.throwIfAborted();
    const snapshot = await read();
    if(!self&&!(await humans()).has(assigneePubkey))throw unknown();
    const published = snapshot.events.find(event => event.id === intent?.acceptedEventId);
    const updated = snapshot.items.find(item => item.type === "issue" && item.issue.id === issue.id && item.repository.repoAddress === repository.repoAddress);
    if (snapshot.viewerPubkey !== viewer || !published || published.kind !== 1 || published.pubkey !== viewer
      || published.content !== template.content || JSON.stringify(published.tags) !== JSON.stringify(template.tags)
      || !updated || updated.type !== "issue" || !updated.issue.comments.some(comment => comment.id === published.id)) throw unknown();
    const confirmed = intent;
    return { issue: updated.issue, snapshot, complete: () => {
      signal.throwIfAborted(); host.completePublication?.(confirmed.key, published.id);
      recover(() => localStorage.removeItem(slot));
    } };
  } catch (error) {
    if (previous === null && !intent?.acceptedEventId && writeFailure(error).kind !== "unknown") recover(() => localStorage.removeItem(slot));
    if (previous !== null || intent?.acceptedEventId) throw unknown();
    throw error;
  }
}
