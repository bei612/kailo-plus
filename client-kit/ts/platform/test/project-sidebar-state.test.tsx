import {act,useState} from "react";
import {describe,expect,it} from "vitest";
import {createBffClient} from "../src/client";
import {PlatformProvider} from "../src/react/context";
import {useProjectSidebarMembership} from "../src/react/projects/useProjectSidebarMembership";
import type {CollaborationUserState} from "../src/inbox";
import {TransportError,type BffRequest} from "../src/transport";
import {button,click,render,settle} from "./render";

const address=`30621:${"a".repeat(64)}:garden`;
const state=(version=0,selected=false):CollaborationUserState=>({version,workspacePreferences:{},conversationPreferences:{},readContexts:{},projectPreferences:selected?{[address]:{selected,updatedAt:"2026-10-07T00:00:00Z"}}:{}});
function Harness(){
  const [scope,setScope]=useState("tenant:alice:session");const membership=useProjectSidebarMembership(scope);
  return <><output>{JSON.stringify({addresses:membership.projectAddresses,pending:membership.pending,problem:membership.problem})}</output>
    <button disabled={membership.pending} onClick={()=>void membership.addProject(address).catch(()=>{})}>Add</button>
    <button disabled={membership.pending} onClick={()=>void membership.removeProject(address).catch(()=>{})}>Remove</button>
    <button onClick={()=>void membership.refresh().catch(()=>{})}>Retry</button><button onClick={()=>setScope("tenant:bob:session")}>Switch</button></>;
}
const output=(ui:HTMLElement)=>JSON.parse(ui.querySelector("output")!.textContent!);
describe("original project Added preferences use the sole Core CAS",()=>{
  it("adds and removes only the original address, reuses the shared version and makes duplicate adds inert",async()=>{
    let current=state();const writes:BffRequest[]=[];
    const client=createBffClient({send:async request=>{
      if(request.method==="GET")return {status:200,body:current};
      writes.push(request);const body=request.body as {selected:boolean;version:number};
      current=state(body.version+1,body.selected);return {status:200,body:{version:current.version}};
    }});
    const ui=await render(<PlatformProvider client={client} locale="en"><Harness/></PlatformProvider>);
    await click(button(ui,"Add"));expect(output(ui).addresses).toEqual([address]);
    await click(button(ui,"Add"));expect(writes).toHaveLength(1);
    await click(button(ui,"Remove"));expect(output(ui).addresses).toEqual([]);
    expect(writes.map(r=>r.body)).toEqual([{projectAddress:address,selected:true,version:0},{projectAddress:address,selected:false,version:1}]);
    expect(writes.every(r=>r.path==="/api/v1/user-state/projects")).toBe(true);
  });
  it("retains UNKNOWN after a later denied observation and retries only the identical old CAS",async()=>{
    let current=state(),attempt=0;const writes:unknown[]=[];
    const client=createBffClient({send:async request=>{
      if(request.method==="GET")return {status:200,body:current};
      writes.push(request.body);attempt++;
      if(attempt===1)throw new TransportError("lost receipt");
      if(attempt===2)return {status:403,body:{}};
      current=state(1,true);return {status:200,body:{version:1}};
    }});
    const ui=await render(<PlatformProvider client={client} locale="en"><Harness/></PlatformProvider>);
    await click(button(ui,"Add"));expect(button(ui,"Add").disabled).toBe(true);
    await click(button(ui,"Retry"));expect(button(ui,"Add").disabled).toBe(true);expect(output(ui).problem).toBeTruthy();
    await click(button(ui,"Retry"));expect(output(ui).addresses).toEqual([address]);
    expect(writes).toEqual(Array(3).fill({projectAddress:address,selected:true,version:0}));
  });
  it("observes a completed newer CAS without replaying an uncertain preference",async()=>{
    let current=state();let writes=0;
    const client=createBffClient({send:async request=>{if(request.method==="GET")return {status:200,body:current};writes++;current=state(1,true);throw new TransportError("ACK lost");}});
    const ui=await render(<PlatformProvider client={client}><Harness/></PlatformProvider>);
    await click(button(ui,"Add"));await click(button(ui,"Retry"));
    expect(writes).toBe(1);expect(output(ui).addresses).toEqual([address]);expect(button(ui,"Add").disabled).toBe(false);
  });
  it("hides stale preference data on read failure and rejects an old server with no project field",async()=>{
    let fail=false;const client=createBffClient({send:async()=>{if(fail)throw new Error("revoked");return {status:200,body:state(1,true)};}});
    const ui=await render(<PlatformProvider client={client}><Harness/></PlatformProvider>);
    expect(output(ui).addresses).toEqual([address]);fail=true;await click(button(ui,"Retry"));
    expect(output(ui).addresses).toEqual([]);expect(button(ui,"Add").disabled).toBe(true);
    const old=state();delete old.projectPreferences;
    const legacy=await render(<PlatformProvider client={createBffClient({send:async()=>({status:200,body:old})})}><Harness/></PlatformProvider>);
    expect(button(legacy,"Add").disabled).toBe(true);expect(output(legacy).problem).toBeTruthy();
  });
  it("fences a late write receipt and its follow-up read after an identity change",async()=>{
    let resolve!:(response:{status:number;body:{version:number}})=>void;let reads=0;
    const client=createBffClient({send:async request=>{if(request.method==="GET"){reads++;return {status:200,body:state()};}return new Promise(done=>{resolve=done;});}});
    const ui=await render(<PlatformProvider client={client}><Harness/></PlatformProvider>);
    await click(button(ui,"Add"));await click(button(ui,"Switch"));expect(reads).toBe(2);
    await act(async()=>resolve({status:200,body:{version:1}}));await settle();
    expect(reads).toBe(2);expect(output(ui).addresses).toEqual([]);expect(button(ui,"Add").disabled).toBe(false);
  });
});
