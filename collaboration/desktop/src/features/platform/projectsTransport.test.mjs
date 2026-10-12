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
const relay="wss://projects.test";
let signed=0,published=0,reads=0,admissions=0,prepared,delivered,active=true,loseAck=false,repositoryEvent=repo,headEvent=repo;
window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
  if(command!=="sign_event")throw new Error(command);
  signed++;return JSON.stringify(finalizeEvent({kind:args.kind,content:args.content,tags:args.tags,created_at:2},key));
}};
const {relayClient}=await import("@/shared/api/relayClient");
const {createProjectsPublisher}=await import("./projectsTransport.ts");
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
const publisher=()=>createProjectsPublisher("tenant:viewer",relay,viewer,()=>active,{workspaces:async()=>{admissions++;assert.fail("Issue must not borrow a workspace scope");}});
const observation=()=>({eventId:prepared,onPrepared:id=>{prepared=id;}});

test("Native existing project operations reject all issue-only fields before reads, admission or publication",async()=>{
  for(const operation of ["CREATE_PROJECT","CREATE_REPOSITORY","DELETE"]){
    const original=operation==="DELETE"?{operation,targetEventId:repo.id}:{operation,workspaceId:"workspace",name:"Project",...(operation==="CREATE_PROJECT"?{visibility:"listed"}:{})};
    for(const field of ["title","body","category"]){
      await assert.rejects(publisher()({...original,[field]:field==="category"?"issue":"content"},`${operation}:${field}`,false,observation()));
      assert.equal(reads,0);assert.equal(admissions,0);assert.equal(signed,0);assert.equal(published,0);
    }
  }
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
