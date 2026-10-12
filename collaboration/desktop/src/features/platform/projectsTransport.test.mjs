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
let signed=0,published=0,reads=0,admissions=0,prepared,delivered,active=true,loseAck=false,repositoryEvent=repo,headEvent=repo;
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
  if(command!=="sign_event")throw new Error(command);
  signed++;return JSON.stringify(finalizeEvent({kind:args.kind,content:args.content,tags:args.tags,created_at:args.createdAt??2},key));
}};
const {relayClient}=await import("@/shared/api/relayClient");
const {createProjectsPublisher,createProjectsQuery}=await import("./projectsTransport.ts");
const {RelayPublishUnknownError}=await import("@/shared/api/relayPublishOutcome");
beforeEach(()=>{
  signed=0;published=0;reads=0;admissions=0;prepared=undefined;delivered=undefined;active=true;loseAck=false;repositoryEvent=repo;headEvent=repo;
  relayClient.unconfirmedEvents.clear();
  relayClient.ensureConnected=async()=>{relayClient.relayUrl=relay;};
  relayClient.fetchEvents=async filter=>{reads++;return filter.kinds.length===1&&filter.kinds[0]===30617
    ?(filter.ids?[repositoryEvent]:[headEvent]):delivered?[delivered]:[];};
  relayClient.publishEvent=async event=>{assert.equal(prepared,event.id);published++;delivered=event;if(loseAck)throw new RelayPublishUnknownError(event.id,"lost ACK");};
});
after(()=>dom.window.close());
const request=()=>({operation:"CREATE_ISSUE",targetEventId:repo.id,title:"Original task",body:"Original body",category:"issue"});
const publisher=()=>createProjectsPublisher("tenant:viewer",relay,viewer,()=>active,{workspaces:async()=>{admissions++;assert.fail("Issue must not borrow a workspace scope");}},2);
const observation=()=>({eventId:prepared,onPrepared:id=>{prepared=id;}});

test("Native existing project operations reject all issue-only fields before reads, admission or publication",async()=>{
  for(const operation of ["CREATE_PROJECT","CREATE_REPOSITORY","DELETE"]){
    const original=operation==="DELETE"?{operation,targetEventId:repo.id}:{operation,workspaceId:"workspace",name:"Project",...(operation==="CREATE_PROJECT"?{visibility:"listed"}:{})};
    for(const field of ["title","body","category","mentions","attachments"]){
      await assert.rejects(publisher()({...original,[field]:field==="category"?"issue":"content"},`${operation}:${field}`,false,observation()));
      assert.equal(reads,0);assert.equal(admissions,0);assert.equal(signed,0);assert.equal(published,0);
    }
  }
});

const commentRequest=()=>({operation:"CREATE_ISSUE_COMMENT",targetEventId:task.id,body:"Original comment",mentions:[viewer],attachments:[]});
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
