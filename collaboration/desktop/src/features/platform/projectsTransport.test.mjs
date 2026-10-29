import assert from "node:assert/strict";
import {after,beforeEach,test} from "node:test";
import {JSDOM} from "jsdom";
import {finalizeEvent,getPublicKey} from "nostr-tools/pure";

const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost"});
for(const name of ["window","document","localStorage","HTMLElement","Element","Node","MutationObserver"])
  globalThis[name]=dom.window[name];
Object.defineProperty(globalThis,"navigator",{configurable:true,value:dom.window.navigator});
window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
const key=new Uint8Array(32).fill(7),ownerKey=new Uint8Array(32).fill(8),viewer=getPublicKey(key);
const repo=finalizeEvent({kind:30617,created_at:1,content:"",tags:[["d","repo"]]},ownerKey);
const task=finalizeEvent({kind:1621,created_at:2,content:"Original task",tags:[["a",`30617:${repo.pubkey}:repo`],["p",viewer]]},ownerKey);
const relay="wss://projects.test";
let signed=0,published=0,reads=0,admissions=0,prepared,delivered,active=true,loseAck=false,repositoryEvent=repo,headEvent=repo,signingKey=key;
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
  if(command!=="sign_event")throw new Error(command);
  signed++;return JSON.stringify(finalizeEvent({kind:args.kind,content:args.content,tags:args.tags,created_at:args.createdAt??2},signingKey));
}};
const {relayClient}=await import("@/shared/api/relayClient");
const {createProjectsPublisher,createProjectsQuery}=await import("./projectsTransport.ts");
const {RelayPublishUnknownError}=await import("@/shared/api/relayPublishOutcome");
beforeEach(()=>{
  signed=0;published=0;reads=0;admissions=0;prepared=undefined;delivered=undefined;active=true;loseAck=false;repositoryEvent=repo;headEvent=repo;signingKey=key;
  relayClient.unconfirmedEvents.clear();
  relayClient.ensureConnected=async()=>{relayClient.relayUrl=relay;};
  relayClient.fetchEvents=async filter=>{reads++;return filter.kinds.length===1&&filter.kinds[0]===30617
    ?(filter.ids?[repositoryEvent]:[headEvent]):delivered?[delivered]:[];};
  relayClient.publishEvent=async event=>{assert.equal(prepared,event.id);published++;delivered=event;if(loseAck)throw new RelayPublishUnknownError(event.id,"lost ACK");};
});
after(()=>dom.window.close());
const request=()=>({operation:"CREATE_ISSUE",targetEventId:repo.id,title:"Original task",body:"Original body",category:"issue"});
const people=async()=>({items:[{principalId:"human",displayName:"Original Human",pubkeys:[viewer]}],maxParticipants:50});
const publisher=(identity=viewer,directory=people)=>createProjectsPublisher("tenant:viewer",relay,identity,()=>active,{conversationParticipants:directory,workspaces:async()=>{admissions++;assert.fail("Issue must not borrow a workspace scope");}},2);
const observation=()=>({eventId:prepared,onPrepared:id=>{prepared=id;}});

test("Native existing project operations reject all issue-only fields before reads, admission or publication",async()=>{
  for(const operation of ["CREATE_PROJECT","CREATE_REPOSITORY","DELETE"]){
    const original=operation==="DELETE"?{operation,targetEventId:repo.id}:{operation,workspaceId:"workspace",name:"Project",...(operation==="CREATE_PROJECT"?{visibility:"listed"}:{})};
    for(const field of ["title","body","category","mentions","attachments","assigneeLabel","assigneePubkey","priorEventId"]){
      await assert.rejects(publisher()({...original,[field]:field==="category"?"issue":"content"},`${operation}:${field}`,false,observation()));
      assert.equal(reads,0);assert.equal(admissions,0);assert.equal(signed,0);assert.equal(published,0);
    }
  }
});

const commentRequest=()=>({operation:"CREATE_ISSUE_COMMENT",targetEventId:task.id,body:"Original comment",mentions:[viewer],attachments:[]});
const assignmentRequest=(operation="SELF_ASSIGN_ISSUE",priorEventId)=>({operation,targetEventId:task.id,assigneeLabel:"Original Human",...(priorEventId?{priorEventId}:{})});
function assignmentReads(history=[]){
  relayClient.fetchEvents=async filter=>{
    reads++;
    if(filter.ids&&filter.kinds[0]===1621)return [task];
    if(filter.kinds[0]===30617)return [headEvent];
    if(filter.ids)return delivered?[delivered]:[];
    assert.equal(filter.authors,undefined);assert.equal(filter["#a"],undefined);assert.equal(filter["#e"],undefined);
    return [...history].sort((left,right)=>right.created_at-left.created_at||right.id.localeCompare(left.id))
      .filter(event=>(filter.since===undefined||event.created_at>=filter.since)&&(filter.until===undefined||event.created_at<=filter.until)).slice(0,filter.limit);
  };
}
test("Native self assignment uses the original kind1 self p/t tags, complete owner history and exact causal prior",async()=>{
  const address=`30617:${repo.pubkey}:repo`,now=Math.floor(Date.now()/1_000);
  const prior=finalizeEvent({kind:1,created_at:now+10,content:"Owner unassigned",tags:[["e",task.id,"","root"],["a",address],["p",viewer],["t","unassignment"]]},ownerKey);
  const comment=finalizeEvent({kind:1,created_at:now+11,content:"Own activity",tags:[["E",task.id],["a",address]]},key);
  const other=finalizeEvent({kind:1,created_at:now+13,content:"Other task",tags:[["e","f".repeat(64)],["a",address]]},ownerKey);
  assignmentReads([prior,comment,other]);
  const result=await publisher()(assignmentRequest("SELF_ASSIGN_ISSUE",prior.id),"assign",false,observation());
  assert.equal(result.eventId,delivered.id);assert.equal(delivered.created_at,comment.created_at+1);assert.equal(delivered.kind,1);
  assert.equal(delivered.content,"Assigned this task to Original Human");
  assert.deepEqual(delivered.tags,[["e",task.id,"","root"],["a",address],["p",viewer],["t","assignment"],["prior",prior.id]]);
  assert.equal(admissions,0);assert.equal(published,1);assert.equal(signed,1);
  const assigned=delivered;assignmentReads([prior,comment,other,assigned]);
  await publisher()(assignmentRequest("SELF_UNASSIGN_ISSUE",assigned.id),"unassign",false,observation());
  assert.equal(delivered.content,"Unassigned Original Human from this task");
  assert.deepEqual(delivered.tags,[["e",task.id,"","root"],["a",address],["p",viewer],["t","unassignment"],["prior",assigned.id]]);
});
test("Native self assignment UNKNOWN restart observes the original event and never refreshes prior or resigns",async()=>{
  assignmentReads();loseAck=true;
  await assert.rejects(publisher()(assignmentRequest(),"assign-unknown",false,observation()),/unknown/i);
  const first=delivered;relayClient.unconfirmedEvents.clear();loseAck=false;assignmentReads([first]);
  assert.equal((await publisher()(assignmentRequest(),"assign-unknown",true,observation())).eventId,first.id);
  await assert.rejects(publisher()(assignmentRequest("SELF_UNASSIGN_ISSUE"),"assign-unknown",true,observation()),/unknown|mismatch/i);
  assert.equal(signed,1);assert.equal(published,1);
});
test("Native self assignment refuses stale prior, invalid signed target, mixed fields and identity loss before publication",async()=>{
  assignmentReads();await assert.rejects(publisher()(assignmentRequest("SELF_ASSIGN_ISSUE","f".repeat(64)),"stale-prior",false,observation()));
  for(const field of ["workspaceId","name","description","visibility","title","body","category","mentions","attachments"])
    await assert.rejects(publisher()({...assignmentRequest(),[field]:"mixed"},`mixed-${field}`,false,observation()));
  assignmentReads();const original=relayClient.fetchEvents;
  relayClient.fetchEvents=async filter=>filter.kinds[0]===1621?[{...JSON.parse(JSON.stringify(task)),content:"forged"}]:original(filter);
  await assert.rejects(publisher()(assignmentRequest(),"forged-assign",false,observation()));
  assignmentReads();const read=relayClient.fetchEvents;
  relayClient.fetchEvents=async filter=>{const rows=await read(filter);if(filter.kinds[0]===1)active=false;return rows;};
  await assert.rejects(publisher()(assignmentRequest(),"revoked-assign",false,observation()));
  assert.equal(signed,0);assert.equal(published,0);
});
test("Native author assigns and removes another HUMAN with original target p tags and no self prior",async()=>{
  signingKey=ownerKey;assignmentReads();
  const send=publisher(repo.pubkey);
  const request={...assignmentRequest("ASSIGN_ISSUE"),assigneePubkey:viewer};
  await send(request,"other-assign",false,observation());
  assert.equal(delivered.pubkey,repo.pubkey);assert.equal(delivered.kind,1);
  assert.deepEqual(delivered.tags,[["e",task.id,"","root"],["a",`30617:${repo.pubkey}:repo`],["p",viewer],["t","assignment"]]);
  assignmentReads([delivered]);
  await send({...request,operation:"UNASSIGN_ISSUE"},"other-unassign",false,observation());
  assert.equal(delivered.tags.at(-1)[1],"unassignment");assert.equal(delivered.tags.some(tag=>tag[0]==="prior"),false);
  assert.equal(signed,2);assert.equal(published,2);assert.equal(admissions,0);
});
test("Native other HUMAN rejects ordinary signers, unknown targets, prior and directory revocation before signing",async()=>{
  assignmentReads();
  const request={...assignmentRequest("ASSIGN_ISSUE"),assigneePubkey:"f".repeat(64)};
  await assert.rejects(publisher(viewer,async()=>({items:[{principalId:"owner",displayName:"Owner",pubkeys:[repo.pubkey]}],maxParticipants:50}))(
    {...request,assigneePubkey:repo.pubkey},"not-owner",false,observation()));
  signingKey=ownerKey;
  await assert.rejects(publisher(repo.pubkey)(request,"not-human",false,observation()));
  await assert.rejects(publisher(repo.pubkey)({...request,assigneePubkey:viewer,priorEventId:"f".repeat(64)},"other-prior",false,observation()));
  let calls=0;
  const directory=async()=>{if(++calls>1)throw new Error("revoked");return people();};
  await assert.rejects(publisher(repo.pubkey,directory)({...request,assigneePubkey:viewer},"revoked-human",false,observation()));
  assert.equal(signed,0);assert.equal(published,0);
});
test("Native other assignment lost ACK observes same event without resigning or changing target",async()=>{
  signingKey=ownerKey;assignmentReads();loseAck=true;
  const request={...assignmentRequest("ASSIGN_ISSUE"),assigneePubkey:viewer};
  await assert.rejects(publisher(repo.pubkey)(request,"other-unknown",false,observation()),/unknown/i);
  const first=delivered;relayClient.unconfirmedEvents.clear();loseAck=false;assignmentReads([first]);
  assert.equal((await publisher(repo.pubkey)(request,"other-unknown",true,observation())).eventId,first.id);
  await assert.rejects(publisher(repo.pubkey)({...request,operation:"UNASSIGN_ISSUE"},"other-unknown",true,observation()),/unknown|mismatch/i);
  assert.equal(signed,1);assert.equal(published,1);
});
const review=finalizeEvent({kind:1618,created_at:2,content:"Original PR",tags:[["a",`30617:${repo.pubkey}:repo`],["p",viewer]]},ownerKey);
const reviewCommentRequest=()=>({...commentRequest(),operation:"CREATE_PULL_REQUEST_COMMENT",targetEventId:review.id});
function reviewCommentReads(root=review){
  relayClient.fetchEvents=async filter=>{
    reads++;
    if(filter.ids&&filter.kinds[0]===1618)return [root];
    if(filter.kinds[0]===30617)return [headEvent];
    if(filter.ids)return delivered?[delivered]:[];
    assert.fail("Ordinary PR comments must not borrow Task timestamp history");
  };
}
test("Native original PR comment signs kind1 with a distinct verified kind1618 root and no Task timestamp override",async()=>{
  reviewCommentReads();
  const media={url:"/media/"+"a".repeat(64),sha256:"a".repeat(64),type:"image/png",size:12,filename:"image.png"};
  const request={...reviewCommentRequest(),body:"Original review ![image](/media/file)",attachments:[media]};
  const result=await publisher()(request,"review-comment",false,observation());
  assert.equal(result.eventId,delivered.id);assert.equal(delivered.kind,1);assert.equal(delivered.created_at,2);
  assert.equal(delivered.content,request.body);assert.equal(delivered.pubkey,viewer);
  assert.deepEqual(delivered.tags,[["e",review.id,"","root"],["a",`30617:${repo.pubkey}:repo`],["p",repo.pubkey],["p",viewer],
    ["imeta",`url ${media.url}`,"m image/png",`x ${media.sha256}`,"size 12","filename image.png"]]);
  assert.equal(admissions,0);assert.equal(signed,1);assert.equal(published,1);
});
test("Native PR comment restart observes the same event without republishing and rejects changed content",async()=>{
  reviewCommentReads();loseAck=true;const publish=publisher();
  await assert.rejects(publish(reviewCommentRequest(),"pr-unknown",false,observation()),/unknown/i);
  relayClient.unconfirmedEvents.clear();loseAck=false;
  assert.equal((await publish(reviewCommentRequest(),"pr-unknown",true,observation())).eventId,delivered.id);
  await assert.rejects(publish({...reviewCommentRequest(),body:"changed"},"pr-unknown",true,observation()),/unknown|mismatch/i);
  assert.equal(signed,1);assert.equal(published,1);
});
test("Native PR comment refuses Task substitution, forged PR and late identity loss before signing",async()=>{
  reviewCommentReads(task);await assert.rejects(publisher()(reviewCommentRequest(),"pr-task",false,observation()));
  reviewCommentReads({...JSON.parse(JSON.stringify(review)),content:"forged"});
  await assert.rejects(publisher()(reviewCommentRequest(),"pr-forged",false,observation()));
  reviewCommentReads();const read=relayClient.fetchEvents;
  relayClient.fetchEvents=async filter=>{const rows=await read(filter);if(filter.kinds[0]===30617)active=false;return rows;};
  await assert.rejects(publisher()(reviewCommentRequest(),"pr-revoked",false,observation()));
  assert.equal(signed,0);assert.equal(published,0);
});
function commentReads(latest){
  relayClient.fetchEvents=async filter=>{
    reads++;
    if(filter.ids&&filter.kinds[0]===1621)return [task];
    if(filter.kinds[0]===30617)return [headEvent];
    if(filter.ids)return delivered?[delivered]:[];
    return latest?[latest]:[];
  };
}
test("Native task comment consumes original kind1 tags and per-author monotonic timestamp with typed media",async()=>{
  const latest=finalizeEvent({kind:1,created_at:Math.floor(Date.now()/1_000)+10,content:"Earlier comment",tags:[["e",task.id,"","root"],["a",`30617:${repo.pubkey}:repo`]]},key);
  commentReads(latest);
  const attachment={url:"/media/"+"a".repeat(64),sha256:"a".repeat(64),type:"image/png",size:12,filename:"image.png"};
  const request={...commentRequest(),body:"Comment with ![image](/media/file)",attachments:[attachment]};
  const result=await publisher()(request,"comment",false,observation());
  assert.equal(result.eventId,delivered.id);assert.equal(delivered.kind,1);assert.equal(delivered.pubkey,viewer);
  assert.equal(delivered.content,request.body);assert.equal(delivered.created_at,latest.created_at+1);
  assert.deepEqual(delivered.tags,[["e",task.id,"","root"],["a",`30617:${repo.pubkey}:repo`],["p",repo.pubkey],["p",viewer],
    ["imeta",`url ${attachment.url}`,"m image/png",`x ${attachment.sha256}`,"size 12","filename image.png"]]);
  assert.equal(admissions,0);assert.equal(signed,1);assert.equal(published,1);
});
test("Native comment UNKNOWN recovery observes the same signed event without a second publish",async()=>{
  commentReads();loseAck=true;const publish=publisher();
  await assert.rejects(publish(commentRequest(),"comment-unknown",false,observation()),/unknown/i);
  relayClient.unconfirmedEvents.clear();loseAck=false;
  assert.equal((await publish(commentRequest(),"comment-unknown",true,observation())).eventId,delivered.id);
  await assert.rejects(publish({...commentRequest(),body:"changed"},"comment-unknown",true,observation()),/unknown|mismatch/i);
  assert.equal(signed,1);assert.equal(published,1);
});
test("Native comment ordering reads both original lowercase and uppercase root references",async()=>{
  const earlier=finalizeEvent({kind:1,created_at:Math.floor(Date.now()/1_000)+10,content:"lowercase",tags:[["e",task.id],["a",`30617:${repo.pubkey}:repo`]]},key);
  const latest=finalizeEvent({kind:1,created_at:earlier.created_at+4,content:"uppercase",tags:[["E",task.id],["a",`30617:${repo.pubkey}:repo`]]},key);
  const other=finalizeEvent({kind:1,created_at:latest.created_at+1,content:"Other task",tags:[["e","f".repeat(64)],["a",`30617:${repo.pubkey}:other`]]},key);
  commentReads();const original=relayClient.fetchEvents;const filters=[];
  relayClient.fetchEvents=async filter=>{filters.push(filter);return filter.kinds[0]===1&&!filter.ids?
    [other,latest,earlier].filter(event=>(filter.since===undefined||event.created_at>=filter.since)&&(filter.until===undefined||event.created_at<=filter.until))
      .slice(0,filter.limit).filter(event=>(!filter["#e"]||event.tags.some(tag=>tag[0]==="e"&&filter["#e"].includes(tag[1])))&&(!filter["#E"]||event.tags.some(tag=>tag[0]==="E"&&filter["#E"].includes(tag[1])))):original(filter);};
  await publisher()(commentRequest(),"comment-uppercase",false,observation());
  assert.equal(delivered.created_at,latest.created_at+1);
  const pages=filters.filter(filter=>filter.kinds[0]===1&&!filter.ids);
  assert.ok(pages.length>1);assert.ok(pages.every(filter=>!filter["#e"]&&!filter["#E"]&&!filter["#a"]));
});
test("Native task activity reads behind other repositories before filtering the actual typed page",async()=>{
  const address=`30617:${repo.pubkey}:repo`;
  const comment=finalizeEvent({kind:1,created_at:30,content:"Confirmed task comment",tags:[["E",task.id],["a",address]]},key);
  const unrelated=[32,31].map(created_at=>finalizeEvent({kind:1,created_at,content:"Other task",tags:[["e","f".repeat(64)],["a",`30617:${repo.pubkey}:other`]]},key));
  const filters=[];
  relayClient.fetchEvents=async filter=>{
    filters.push(filter);
    return [...unrelated,comment].filter(event=>(filter.since===undefined||event.created_at>=filter.since)&&(filter.until===undefined||event.created_at<=filter.until))
      .slice(0,filter.limit).filter(event=>!filter["#a"]||event.tags.some(tag=>tag[0]==="a"&&filter["#a"].includes(tag[1])));
  };
  const query=createProjectsQuery(viewer,()=>active,2);
  const page=await query({view:"WORK_ITEM_ACTIVITY",coordinates:[address]});
  assert.deepEqual(page.events.map(event=>event.id),[comment.id]);assert.equal(page.limit,2);assert.equal(page.pubkey,viewer);
  assert.ok(filters.length>1);assert.ok(filters.every(filter=>filter["#a"]===undefined));
  const bounded=await query({view:"WORK_ITEM_ACTIVITY",coordinates:[address],since:30,until:30});
  assert.deepEqual(bounded.events.map(event=>event.id),[comment.id]);
});
test("Native task activity rejects an unprovable full timestamp bucket and revoked history",async()=>{
  const address=`30617:${repo.pubkey}:repo`;
  const bucket=["one","two"].map(content=>finalizeEvent({kind:1,created_at:30,content,tags:[["e",task.id],["a",address]]},key));
  const query=createProjectsQuery(viewer,()=>active,2);
  relayClient.fetchEvents=async()=>bucket;
  await assert.rejects(query({view:"WORK_ITEM_ACTIVITY",coordinates:[address]}),/bucket/);
  relayClient.fetchEvents=async()=>{active=false;return [bucket[0]];};
  await assert.rejects(query({view:"WORK_ITEM_ACTIVITY",coordinates:[address]}),/identity changed/);
});
test("Native comment requires exact signed root, repository and current identity before signing",async()=>{
  commentReads();const original=relayClient.fetchEvents;
  relayClient.fetchEvents=async filter=>filter.kinds[0]===1621?[{...JSON.parse(JSON.stringify(task)),content:"tampered"}]:original(filter);
  await assert.rejects(publisher()(commentRequest(),"bad-comment-root",false,observation()));
  commentReads();headEvent={...JSON.parse(JSON.stringify(repo)),content:"tampered"};
  await assert.rejects(publisher()(commentRequest(),"bad-comment-repo",false,observation()));
  headEvent=repo;commentReads();const read=relayClient.fetchEvents;
  relayClient.fetchEvents=async filter=>{const result=await read(filter);if(filter.kinds[0]===1)active=false;return result;};
  await assert.rejects(publisher()(commentRequest(),"comment-revoked",false,observation()));
  assert.equal(signed,0);assert.equal(published,0);
});
test("Native comment and task creation reject each other's exclusive request fields",async()=>{
  for(const field of ["workspaceId","name","description","visibility","title","category"])
    await assert.rejects(publisher()({...commentRequest(),[field]:"not allowed"},`comment-field-${field}`,false,observation()));
  for(const field of ["mentions","attachments"])
    await assert.rejects(publisher()({...request(),[field]:[]},`task-field-${field}`,false,observation()));
  assert.equal(reads,0);assert.equal(signed,0);assert.equal(published,0);
});

test("Native task creates the original signed kind1621 payload without workspace or repository-write authority",async()=>{
  const result=await publisher()(request(),"task",false,observation());
  assert.equal(result.eventId,delivered.id);assert.equal(delivered.pubkey,viewer);assert.equal(delivered.kind,1621);
  assert.deepEqual(delivered.tags,[["a",`30617:${repo.pubkey}:repo`],["p",repo.pubkey],["subject","Original task"],["t","issue"]]);
  assert.equal(signed,1);assert.equal(published,1);
});
test("Native UNKNOWN and restarted task recovery only observe the original event and reject changed content",async()=>{
  loseAck=true;const publish=publisher();
  await assert.rejects(publish(request(),"unknown",false,observation()),/unknown/i);
  relayClient.unconfirmedEvents.clear();loseAck=false;
  assert.equal((await publish(request(),"unknown",true,observation())).eventId,delivered.id);
  await assert.rejects(publish({...request(),body:"different"},"unknown",true,observation()),/unknown|mismatch/i);
  assert.equal(signed,1);assert.equal(published,1);
});
test("Native task rejects an invalid signed repository and a replaced head before signing",async()=>{
  repositoryEvent={...JSON.parse(JSON.stringify(repo)),content:"tampered"};
  await assert.rejects(publisher()(request(),"bad-signature",false,observation()));
  repositoryEvent=repo;headEvent=finalizeEvent({...repo,created_at:3},ownerKey);
  await assert.rejects(publisher()(request(),"old-head",false,observation()));
  assert.equal(signed,0);assert.equal(published,0);
});
test("Native task scope loss after head read prevents signing and absent recovery remains unknown",async()=>{
  relayClient.fetchEvents=async filter=>{if(!filter.ids)active=false;return [repo];};
  await assert.rejects(publisher()(request(),"revoked",false,observation()));
  assert.equal(signed,0);assert.equal(published,0);
  active=true;relayClient.fetchEvents=async filter=>filter.kinds[0]===30617?[repo]:[];prepared="a".repeat(64);
  await assert.rejects(publisher()(request(),"absent",true,observation()),/unknown/i);
  assert.equal(signed,0);assert.equal(published,0);
});

// Original useAttachProjectRepository / useBindProjectRepositoryChannel / useAddProjectChannel
// (REQ-24, DD-80, DD-118): the CLIENT republishes only its own verified current head as the
// original template; every other tag and the content stay verbatim.
const channelId="12345678-1234-4234-8234-123456789001",otherChannel="12345678-1234-4234-8234-123456789002";
const projectHead=finalizeEvent({kind:30621,created_at:5,content:"",tags:[["d","garden"],["name","Garden"],["buzz-channel",channelId],
  ["x-unknown","kept"],["a",`30617:${viewer}:zeta`]]},key);
const repositoryHead=finalizeEvent({kind:30617,created_at:5,content:"Mobile",tags:[["d","mobile"],["name","Mobile"],["buzz-channel",channelId],["description","Mobile"]]},key);
function announcementReads(head){
  relayClient.fetchEvents=async filter=>{reads++;
    if(filter.ids&&delivered&&filter.ids.includes(delivered.id))return [delivered];
    if(filter.ids)return filter.ids.includes(head.id)&&filter.kinds.includes(head.kind)?[head]:[];
    return filter.kinds.includes(head.kind)?[head]:[];};
}
const announcementPublisher=(workspaces=[{id:otherChannel,isMember:true}])=>createProjectsPublisher("tenant:viewer",relay,viewer,()=>active,
  {conversationParticipants:people,workspaces:async()=>{admissions++;return workspaces;}},2);
test("Native repository attachment republishes the owned project head with one more sorted member",async()=>{
  announcementReads(projectHead);
  const added=`30617:${viewer}:alpha`;
  const result=await announcementPublisher()({operation:"ATTACH_REPOSITORY",targetEventId:projectHead.id,repositoryAddress:added},"attach",false,observation());
  assert.equal(result.eventId,delivered.id);assert.equal(delivered.kind,30621);assert.equal(delivered.pubkey,viewer);
  assert.deepEqual(delivered.tags,[["d","garden"],["name","Garden"],["buzz-channel",channelId],["x-unknown","kept"],["a",added],["a",`30617:${viewer}:zeta`]]);
  assert.ok(delivered.created_at>projectHead.created_at);assert.equal(admissions,0);
  await assert.rejects(announcementPublisher()({operation:"ATTACH_REPOSITORY",targetEventId:projectHead.id,repositoryAddress:`30617:${viewer}:zeta`},"attach-again",false,observation()));
  assert.equal(signed,1);assert.equal(published,1);
});
test("Native repository channel binding and project channel link admit the Workspace and patch only their tag",async()=>{
  announcementReads(repositoryHead);
  await announcementPublisher()({operation:"BIND_REPOSITORY_CHANNEL",targetEventId:repositoryHead.id,workspaceId:otherChannel},"bind",false,observation());
  assert.equal(delivered.kind,30617);assert.equal(delivered.content,"Mobile");
  assert.deepEqual(delivered.tags,[["d","mobile"],["name","Mobile"],["description","Mobile"],["buzz-channel",otherChannel]]);
  delivered=undefined;prepared=undefined;announcementReads(projectHead);
  await announcementPublisher()({operation:"ADD_PROJECT_CHANNEL",targetEventId:projectHead.id,workspaceId:otherChannel},"link",false,observation());
  assert.equal(delivered.kind,30621);
  assert.deepEqual(delivered.tags,[...projectHead.tags,["buzz-related-channel",otherChannel]]);
  // A Workspace the signer is not a member of is never linked or bound.
  await assert.rejects(announcementPublisher([])({operation:"ADD_PROJECT_CHANNEL",targetEventId:projectHead.id,workspaceId:otherChannel},"not-member",false,observation()));
  assert.equal(signed,2);assert.equal(published,2);
});
test("Native announcement changes refuse another owner's head, mixed fields and a non-https clone URL before signing",async()=>{
  const foreign=finalizeEvent({kind:30621,created_at:5,content:"",tags:[["d","garden"],["name","Garden"]]},ownerKey);
  announcementReads(foreign);
  await assert.rejects(announcementPublisher()({operation:"ATTACH_REPOSITORY",targetEventId:foreign.id,repositoryAddress:`30617:${viewer}:alpha`},"foreign",false,observation()));
  await assert.rejects(announcementPublisher()({operation:"ATTACH_REPOSITORY",targetEventId:projectHead.id,repositoryAddress:`30617:${viewer}:alpha`,workspaceId:otherChannel},"mixed",false,observation()));
  await assert.rejects(announcementPublisher()({operation:"BIND_REPOSITORY_CHANNEL",targetEventId:repositoryHead.id,workspaceId:otherChannel,name:"x"},"mixed-bind",false,observation()));
  await assert.rejects(announcementPublisher()({operation:"CREATE_REPOSITORY",workspaceId:otherChannel,name:"Mobile",cloneUrl:"http://relay.example/mobile.git"},"http-clone",false,observation()));
  assert.equal(signed,0);assert.equal(published,0);
});

const updateRoot=finalizeEvent({kind:1618,created_at:2,content:"Original PR",tags:[["a",`30617:${repo.pubkey}:repo`],["c","a".repeat(40)],
  ["clone","https://projects.test/original.git"],["branch-name","feature"],["target-branch","main"]]},key);
const updateRequest=()=>({operation:"UPDATE_PULL_REQUEST",targetEventId:updateRoot.id,commit:"b".repeat(40),mergeBase:"a".repeat(40)});
function updateReads(history=[]){
  relayClient.fetchEvents=async filter=>{
    reads++;
    if(filter.ids&&filter.kinds[0]===1618)return [updateRoot];
    if(filter.kinds[0]===30617)return [headEvent];
    if(filter.ids)return delivered?[delivered]:[];
    return history.filter(event=>filter.kinds.includes(event.kind)&&(!filter.authors||filter.authors.includes(event.pubkey))
      &&(filter.since===undefined||event.created_at>=filter.since)&&(filter.until===undefined||event.created_at<=filter.until))
      .sort((a,b)=>b.created_at-a.created_at||b.id.localeCompare(a.id)).slice(0,filter.limit);
  };
}
test("Native original review update preserves latest clone metadata and original author/owner timestamp order",async()=>{
  const latest=finalizeEvent({kind:1619,created_at:Math.floor(Date.now()/1000)+7,content:"",tags:[["E",updateRoot.id],["c","c".repeat(40)],["clone","https://projects.test/moved.git"]]},ownerKey);
  updateReads([latest]);
  const result=await publisher()(updateRequest(),"update",false,observation());
  assert.equal(result.eventId,delivered.id);assert.equal(delivered.kind,1619);assert.equal(delivered.created_at,latest.created_at+1);
  assert.deepEqual(delivered.tags,[["a",`30617:${repo.pubkey}:repo`],["p",repo.pubkey],["p",viewer],["E",updateRoot.id],["P",viewer],
    ["c","b".repeat(40)],["clone","https://projects.test/moved.git"],["merge-base","a".repeat(40)]]);
  assert.equal(signed,1);assert.equal(published,1);assert.equal(admissions,0);
});
test("Native review update lost ACK and restart observe the original 1619 without changing key or signing again",async()=>{
  updateReads();loseAck=true;
  await assert.rejects(publisher()(updateRequest(),"update-unknown",false,observation()),/unknown/i);
  const first=delivered;relayClient.unconfirmedEvents.clear();loseAck=false;updateReads();
  assert.equal((await publisher()(updateRequest(),"update-unknown",true,observation())).eventId,first.id);
  await assert.rejects(publisher()({...updateRequest(),commit:"c".repeat(40)},"update-unknown",true,observation()),/unknown|mismatch/i);
  assert.equal(signed,1);assert.equal(published,1);
});
test("Native review update refuses other devices, malformed root, extra tags and retired owner before signing",async()=>{
  updateReads();signingKey=new Uint8Array(32).fill(9);
  await assert.rejects(publisher(getPublicKey(signingKey))(updateRequest(),"stranger-update",false,observation()));
  signingKey=key;updateReads();
  await assert.rejects(publisher()({...updateRequest(),body:"injected"},"mixed-update",false,observation()));
  const original=relayClient.fetchEvents;
  relayClient.fetchEvents=async filter=>filter.ids&&filter.kinds[0]===1618?[{...JSON.parse(JSON.stringify(updateRoot)),content:"forged"}]:original(filter);
  await assert.rejects(publisher()(updateRequest(),"forged-update",false,observation()));
  updateReads();const read=relayClient.fetchEvents;
  relayClient.fetchEvents=async filter=>{const rows=await read(filter);if(filter.kinds[0]===1619)active=false;return rows;};
  await assert.rejects(publisher()(updateRequest(),"retired-update",false,observation()));
  assert.equal(signed,0);assert.equal(published,0);
});
