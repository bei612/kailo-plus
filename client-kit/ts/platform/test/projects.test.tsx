import { QueryClient,QueryClientProvider } from "@tanstack/react-query";
import { beforeEach,describe,expect,it,vi } from "vitest";
import {setLocale} from "../src/i18n";
import {ProjectsView,loadProjects,type ProjectsHost} from "../src/react/projects";
import type {PulseEvent} from "../src/react/pulse/host";
import {buildProjectReadModels} from "../src/react/projects/projectModels";
import {render,button,click,type} from "./render";
import {ProjectDeleteAction} from "../src/react/projects/ProjectDeleteAction";
import {BffError,TransportError,type BffTransport} from "../src/transport";
import {SidebarProjectsSection,type SidebarProjectMembership} from "../src/react/sidebar/SidebarProjectsSection";
import {SidebarProvider} from "../src/react/sidebar/sidebar";
import {AppSidebarPrimaryMenu} from "../src/react/sidebar/app-sidebar-primary-menu";
import {listSidebarProjects,writeSidebarProjectsFilter} from "../src/react/sidebar/listSidebarProjects";
import {act,useState} from "react";
import {PlatformProvider} from "../src/react/context";
import {createBffClient} from "../src/client";
import {CreateActionKey, ErrorClass, WorkspaceVisibility} from "@client-kit/contracts";
import {getEventHash} from "nostr-tools/pure";
import {prepareProjectCreation,resumeProjectCreation,ProjectCreationPending,ProjectCreationRejected} from "../src/react/projects/createProject";
import {buildProjectBootstrapTemplates} from "../src/react/projects/projectCreation";
import {useCreateProject} from "../src/react/projects/useCreateProject";
import {CreateProjectFormContent} from "../src/react/projects/CreateProjectFormContent";
import {Dialog} from "../src/react/composer/shared/ui/dialog";
import {loadProjectAgents,ProjectAgentPending,ProjectAgentFailed} from "../src/react/projects/projectAgent";

const owner="a".repeat(64),other="b".repeat(64);
function project(name="Real project",id="p",time=10):PulseEvent{return {id,pubkey:owner,kind:30621,created_at:time,content:"",tags:[["d",id],["name",name],["description","Signed announcement"],["a",`30617:${other}:missing`]]};}
function host(rows:PulseEvent[]=[project()]):ProjectsHost{return {scopeKey:"tenant:owner",query:async req=>({events:req.view==="PROJECTS"?rows:[],pubkey:owner,limit:3})};}
const signal=()=>new AbortController().signal;
const bff=createBffClient({send:async()=>({status:200,body:{workspaces:[]}})});
const creationInput={name:"Real creation",description:"Original description",channelVisibility:WorkspaceVisibility.Open,projectVisibility:"listed" as const};
async function creationFixture(){
  const rows:PulseEvent[]=[];
  const h:ProjectsHost={scopeKey:"creation-scope",query:async request=>({pubkey:owner,limit:20,events:rows.filter(event=>event.kind===(request.view==="PROJECTS"?30621:request.view==="REPOSITORIES"?30617:5))})};
  const intent=await prepareProjectCreation(h,creationInput);
  const workspaceId="12345678-1234-4234-8234-123456789012",executionId="22345678-1234-4234-8234-123456789012",operationId="32345678-1234-4234-8234-123456789012";
  const task={actionExecutionId:executionId,operationId,actionKey:CreateActionKey.WorkspaceCreate,targetId:workspaceId,taskStatus:"COMPLETED",gateState:"ALLOWED",dispatchState:"DISPATCHED",workflowId:"workflow"};
  let member=true;
  const send=vi.fn<BffTransport["send"]>(async request=>({status:200,body:request.method==="POST"?{actionExecutionId:executionId,operationId,actionKey:CreateActionKey.WorkspaceCreate}
    :request.path==="/api/v1/workspaces"?[{id:workspaceId,slug:intent.channel.slug,name:intent.input.name,isMember:member}]:task}));
  const client=createBffClient({send});
  const publish=vi.fn<NonNullable<ProjectsHost["publish"]>>(async(request,_key,_observe,observation)=>{
    const templates=buildProjectBootstrapTemplates({...intent.input,ownerPubkey:owner,projectChannelId:workspaceId});
    const template=request.operation==="CREATE_PROJECT"?templates.project:templates.repository;
    const unsigned={...template,pubkey:owner,created_at:10};
    const event={...unsigned,id:getEventHash(unsigned)};
    observation?.onPrepared(event.id);rows.push(event);return {eventId:event.id};
  });
  h.publish=publish;h.completePublication=vi.fn();
  return {h,intent,client,publish,rows,task,send,revoke:()=>{member=false;}};
}
const deleteTrigger=({onOpen,pending}:{onOpen:()=>void;pending:boolean})=><button aria-label="Delete project" disabled={pending} onClick={onOpen}>Open deletion</button>;
beforeEach(()=>{localStorage.clear();setLocale("en");sessionStorage.clear();
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  HTMLElement.prototype.scrollIntoView=vi.fn();
});

describe("governed original project creation",()=>{
  const selectedAgent={agentResourceId:"42345678-1234-4234-8234-123456789012",agentVersionAssetId:"52345678-1234-4234-8234-123456789012",displayName:"Original persona",ordinal:3,resourceVersion:2,assetVersion:4};
  async function agentFixture(){
    const f=await creationFixture();f.intent.input.agent=selectedAgent;f.intent.agent={key:"62345678-1234-4234-8234-123456789012"};
    const agentTask={...f.task,actionExecutionId:"72345678-1234-4234-8234-123456789012",operationId:"82345678-1234-4234-8234-123456789012",
      actionKey:"agent.installation.create",workspaceId:f.task.targetId,targetId:"92345678-1234-4234-8234-123456789012",workflowKind:"AGENT_INSTALLATION",workflowId:"agent-workflow"};
    const installation={resourceId:agentTask.targetId,workspaceId:f.task.targetId,agentResourceId:selectedAgent.agentResourceId,pinnedVersionAssetId:selectedAgent.agentVersionAssetId,
      state:"ACTIVE",resourceState:"ACTIVE",agentPrincipalId:"separate-agent",agentPrincipalState:"ACTIVE",activeProjectionGeneration:2,
      projection:{generation:2,agentVersionAssetId:selectedAgent.agentVersionAssetId,state:"ACTIVE"},channelBinding:{status:"ACTIVE",channelId:"actual-relay-channel"}};
    const candidates={workspaceId:f.task.targetId,canCreate:true,candidates:[selectedAgent]};
    f.send.mockImplementation(async request=>{
      if(request.path.includes("installation-candidates"))return {status:200,body:candidates};
      if(request.path.includes("agent-installations"))return {status:200,body:installation};
      if(request.path==="/api/v1/workspaces")return {status:200,body:[{id:f.task.targetId,slug:f.intent.channel.slug,name:creationInput.name,isMember:true}]};
      if(request.method==="POST")return {status:200,body:(request.body as {actionKey:string}).actionKey==="agent.installation.create"?agentTask:f.task};
      return {status:200,body:request.path.endsWith(agentTask.actionExecutionId)?agentTask:f.task};
    });
    return {...f,agentTask,installation,candidates};
  }
  it("pins the selected persona version and waits for the real installation without replaying project publication",async()=>{
    const f=await agentFixture();f.agentTask.taskStatus="RUNNING";
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toBeInstanceOf(ProjectAgentPending);
    expect(f.publish).toHaveBeenCalledTimes(2);expect(f.intent.agent?.submission?.actionExecutionId).toBe(f.agentTask.actionExecutionId);
    f.agentTask.taskStatus="COMPLETED";
    const result=await resumeProjectCreation(f.client,f.h,f.intent,vi.fn());expect(result.name).toBe(creationInput.name);
    expect(f.publish).toHaveBeenCalledTimes(2);
    const commands=f.send.mock.calls.filter(([r])=>r.method==="POST").map(([r])=>r.body);
    expect(commands).toHaveLength(2);expect(commands[1]).toMatchObject({actionKey:"agent.installation.create",workspaceId:f.task.targetId,
      assetId:selectedAgent.agentVersionAssetId,assetVersion:selectedAgent.assetVersion,idempotencyKey:f.intent.agent?.key});
  });
  it.each(["version","generation","scope","channel"])("does not finish an installation with mismatched %s projection",async field=>{
    const f=await agentFixture();
    if(field==="version")f.installation.pinnedVersionAssetId="substituted-version";
    if(field==="generation")f.installation.activeProjectionGeneration++;
    if(field==="scope")f.installation.workspaceId="another-workspace";
    if(field==="channel")f.installation.channelBinding.status="DISABLED";
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toBeInstanceOf(ProjectAgentPending);
    expect(f.intent.agent?.submission).toBeDefined();expect(f.publish).toHaveBeenCalledTimes(2);
  });
  it("does not silently select a newer published version or discard the already created project",async()=>{
    const f=await agentFixture();f.candidates.candidates=[{...selectedAgent,agentVersionAssetId:"replacement"}];
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toBeInstanceOf(ProjectAgentFailed);
    expect(f.intent.project.acceptedEventId).toBeDefined();expect(f.intent.agent?.command).toBeUndefined();
    expect(f.send.mock.calls.filter(([r])=>r.method==="POST")).toHaveLength(1);
  });
  it("retains an already created project when the selected asset version becomes stale",async()=>{
    const f=await agentFixture();f.candidates.candidates=[{...selectedAgent,assetVersion:selectedAgent.assetVersion+1}];
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toBeInstanceOf(ProjectAgentFailed);
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toBeInstanceOf(ProjectAgentFailed);
    expect(f.publish).toHaveBeenCalledTimes(2);expect(f.send.mock.calls.filter(([r])=>r.method==="POST")).toHaveLength(1);
  });
  it.each(["observation","dispatch"])("keeps an UNKNOWN %s pending even when a negative task projection is present",async source=>{
    const f=await agentFixture();f.agentTask.gateState="DENIED";f.agentTask.taskStatus="FAILED";
    if(source==="observation")Object.assign(f.agentTask,{observation:"EXTERNAL_RESULT_UNKNOWN"});
    else f.agentTask.dispatchState="UNKNOWN";
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toBeInstanceOf(ProjectAgentPending);
    expect(f.intent.agent?.submission).toBeDefined();
  });
  it("recovers a lost installation ACK using its unchanged command and idempotency key",async()=>{
    const f=await agentFixture();const send=f.send.getMockImplementation()!;let lost=true;
    f.send.mockImplementation(async request=>{if(request.method==="POST"&&(request.body as {actionKey:string}).actionKey==="agent.installation.create"&&lost){lost=false;throw new Error("lost ACK");}return send(request);});
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toBeInstanceOf(ProjectAgentPending);
    await resumeProjectCreation(f.client,f.h,f.intent,vi.fn());
    const commands=f.send.mock.calls.filter(([r])=>r.method==="POST"&&(r.body as {actionKey:string}).actionKey==="agent.installation.create");
    expect(commands).toHaveLength(2);expect(commands[0]![0].body).toEqual(commands[1]![0].body);expect(f.publish).toHaveBeenCalledTimes(2);
  });
  it("loads the original Persona identity from the exact current published asset, not a second local registry",async()=>{
    const send=vi.fn(async(request:{path:string})=>({status:200,body:request.path.includes("agent-versions")?
      {assetId:selectedAgent.agentVersionAssetId,agentResourceId:selectedAgent.agentResourceId,state:"PUBLISHED",assetVersion:4,ordinal:3,content:{personaIdentity:{displayName:"Original persona"}}}
      :{definitions:[{resourceId:selectedAgent.agentResourceId,status:"ACTIVE",resourceState:"ACTIVE",resourceVersion:2,currentPublishedVersionAssetId:selectedAgent.agentVersionAssetId}]}}));
    const client=createBffClient({send});expect(await loadProjectAgents(client)).toEqual([selectedAgent]);
    expect(send.mock.calls[1]![0].path).toContain(selectedAgent.agentVersionAssetId);
  });
  it("retains the original Coding agent row after Project list and shows the frozen exact version",async()=>{
    await render(<PlatformProvider client={bff}><Dialog open><CreateProjectFormContent active frozen={{...creationInput,agent:selectedAgent}}
      isCreating={false} onBack={vi.fn()} onCreate={vi.fn()} onCreated={vi.fn()}/></Dialog></PlatformProvider>);
    const listing=document.querySelector('[data-testid="create-project-listing"]')!;
    const agent=document.querySelector<HTMLButtonElement>('[data-testid="create-project-agent"]')!;
    expect(listing.compareDocumentPosition(agent)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(agent.textContent).toContain("Original persona · v3");expect(agent.disabled).toBe(true);
    expect(agent.className).toContain("max-w-[60%]");expect(agent.parentElement?.className).toContain("rounded-xl");
  });
  it("submits the exact published Persona selected in the original dropdown",async()=>{
    const client=createBffClient({send:async request=>({status:200,body:request.path.includes("agent-versions")?
      {assetId:selectedAgent.agentVersionAssetId,agentResourceId:selectedAgent.agentResourceId,state:"PUBLISHED",assetVersion:4,ordinal:3,content:{personaIdentity:{displayName:"Original persona"}}}
      :{definitions:[{resourceId:selectedAgent.agentResourceId,status:"ACTIVE",resourceState:"ACTIVE",resourceVersion:2,currentPublishedVersionAssetId:selectedAgent.agentVersionAssetId}]}})});
    const create=vi.fn().mockResolvedValue(undefined);
    await render(<PlatformProvider client={client}><Dialog open><CreateProjectFormContent active initialName="With agent" isCreating={false}
      onBack={vi.fn()} onCreate={create} onCreated={vi.fn()}/></Dialog></PlatformProvider>);
    const selector=document.querySelector<HTMLButtonElement>('[data-testid="create-project-agent"]')!;
    await vi.waitFor(()=>expect(selector.disabled).toBe(false));
    await vi.waitFor(()=>expect(document.activeElement).toBe(document.querySelector('[data-testid="create-project-name"]')));
    await act(async()=>{selector.focus();selector.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));});
    await vi.waitFor(()=>expect(document.querySelector(`[data-testid="create-project-agent-option-${selectedAgent.agentVersionAssetId}"]`)).not.toBeNull());
    const option=document.querySelector<HTMLElement>(`[data-testid="create-project-agent-option-${selectedAgent.agentVersionAssetId}"]`)!;
    expect(option).not.toBeNull();await click(option);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="create-project-submit"]')!);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({agent:selectedAgent}));
  });
  it("uses one channel action and two original verified announcements in the same workspace",async()=>{
    const f=await creationFixture();const save=vi.fn();
    const result=await resumeProjectCreation(f.client,f.h,f.intent,save);
    expect(result.name).toBe(creationInput.name);expect(result.repositories).toHaveLength(1);
    expect(f.publish.mock.calls.map(call=>call[0].operation)).toEqual(["CREATE_PROJECT","CREATE_REPOSITORY"]);
    expect(f.publish.mock.calls.every(call=>call[0].workspaceId===f.task.targetId)).toBe(true);
    await resumeProjectCreation(f.client,f.h,f.intent,save);
    expect(f.send.mock.calls.filter(call=>call[0].method==="POST")).toHaveLength(1);expect(f.publish).toHaveBeenCalledTimes(2);
  });
  it("keeps an unknown original publication across later refused observation without a new key",async()=>{
    const f=await creationFixture();f.publish.mockRejectedValueOnce(new TransportError("lost ACK"))
      .mockRejectedValueOnce(new BffError(403,"revoked",{class:ErrorClass.Denied}));
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toThrow("lost ACK");
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toBeInstanceOf(ProjectCreationPending);
    expect(f.publish.mock.calls[1]?.slice(0,3)).toEqual([f.publish.mock.calls[0]![0],f.intent.project.key,true]);
    expect(f.intent.project.attempted).toBe(true);
  });
  it("allows only an explicitly unsent first publication to retry without observe-only",async()=>{
    const f=await creationFixture();const unsent=new Error("scope expired before send");unsent.name="RelayPublishNotSentError";
    f.publish.mockRejectedValueOnce(unsent);
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toThrow("before send");
    expect(f.intent.project.attempted).toBe(false);
    await resumeProjectCreation(f.client,f.h,f.intent,vi.fn());expect(f.publish.mock.calls[1]?.[2]).toBe(false);
  });
  it("stops before repository publication if channel membership is revoked after the first announcement",async()=>{
    const f=await creationFixture();const publish=f.h.publish!;f.h.publish=async(...args)=>{const value=await publish(...args);f.revoke();return value;};
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toBeInstanceOf(ProjectCreationPending);
    expect(f.publish).toHaveBeenCalledTimes(1);expect(f.h.completePublication).not.toHaveBeenCalled();
  });
  it.each(["content","id","workspace"])("does not complete a mismatched final %s readback",async field=>{
    const f=await creationFixture();const publish=f.h.publish!;f.h.publish=async(...args)=>{
      const value=await publish(...args);
      if(f.rows.length===2){const event=f.rows[0]!;if(field==="content")event.content="substituted";
        else if(field==="id")event.created_at++;else event.tags=event.tags.map(tag=>tag[0]==="buzz-channel"?["buzz-channel","42345678-1234-4234-8234-123456789012"]:tag);}
      return value;
    };
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toBeInstanceOf(ProjectCreationPending);
    expect(f.h.completePublication).not.toHaveBeenCalled();
  });
  it("distinguishes a terminal rejected channel task from an unconfirmed task",async()=>{
    const f=await creationFixture();f.task.gateState="DENIED";
    await expect(resumeProjectCreation(f.client,f.h,f.intent,vi.fn())).rejects.toBeInstanceOf(ProjectCreationRejected);
    expect(f.publish).not.toHaveBeenCalled();
  });
  it("does not start the next publication after the creation hook unmounts",async()=>{
    const f=await creationFixture();let release!:(value:{eventId:string})=>void;
    f.publish.mockImplementationOnce(async()=>new Promise(resolve=>{release=resolve;}));
    const failed=vi.fn();
    function Form(){const creation=useCreateProject(f.h);return <button onClick={()=>{void creation.create(creationInput).catch(failed);}}>Create actual project</button>;}
    function Host(){const [visible,setVisible]=useState(true);return <><button onClick={()=>setVisible(false)}>Leave creation</button>{visible?<Form/>:null}</>;}
    // Keep the channel slug fixture tied to the hook's newly prepared intent.
    f.send.mockImplementation(async request=>{
      if(request.method==="POST"){const body=request.body as {slug:string};f.intent.channel.slug=body.slug;return {status:200,body:{actionExecutionId:f.task.actionExecutionId,operationId:f.task.operationId,actionKey:CreateActionKey.WorkspaceCreate}};}
      return {status:200,body:request.path==="/api/v1/workspaces"?[{id:f.task.targetId,slug:f.intent.channel.slug,name:creationInput.name,isMember:true}]:f.task};
    });
    const ui=await render(<PlatformProvider client={f.client}><Host/></PlatformProvider>);
    await click(button(ui,"Create actual project"));await vi.waitFor(()=>expect(f.publish).toHaveBeenCalledOnce());
    await click(button(ui,"Leave creation"));await act(async()=>release({eventId:"c".repeat(64)}));
    expect(f.publish).toHaveBeenCalledOnce();expect(failed).toHaveBeenCalled();expect(sessionStorage.length).toBe(1);
  });
  it("does not call a deterministic form rejection an unknown result",async()=>{
    const create=vi.fn().mockRejectedValue(new Error("invalid name"));
    await render(<PlatformProvider client={bff}><Dialog open><CreateProjectFormContent active initialName="Valid" isCreating={false} onBack={vi.fn()} onCreate={create} onCreated={vi.fn()}/></Dialog></PlatformProvider>);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="create-project-submit"]')!);
    expect(document.body.textContent).toContain("Creation was rejected");expect(document.body.textContent).not.toContain("Creation is not confirmed");
  });
  it("does not permit another create when confirmed creation is followed by a failed close/navigation",async()=>{
    const create=vi.fn().mockResolvedValue(undefined);
    await render(<PlatformProvider client={bff}><Dialog open><CreateProjectFormContent active initialName="Valid" isCreating={false} onBack={vi.fn()} onCreate={create} onCreated={()=>{throw new Error("navigation failed");}}/></Dialog></PlatformProvider>);
    const submit=document.querySelector<HTMLButtonElement>('[data-testid="create-project-submit"]')!;
    await click(submit);expect(submit.disabled).toBe(true);expect(document.body.textContent).toContain("Project created, but");
    await click(submit);expect(create).toHaveBeenCalledOnce();
  });
});

describe("original Projects directory management consumers",()=>{
  const cache=()=>new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  async function directory(h:ProjectsHost,client=bff,onSelectedProjectChange=vi.fn()){
    const ui=await render(<PlatformProvider client={client}><QueryClientProvider client={cache()}><ProjectsView host={h} onSelectedProjectChange={onSelectedProjectChange}/></QueryClientProvider></PlatformProvider>);
    await vi.waitFor(()=>expect(ui.querySelector('[role="status"]')).toBeNull());
    return ui;
  }
  async function openMenu(ui:HTMLElement,name:string){
    const trigger=ui.querySelector<HTMLButtonElement>(`button[aria-label="More options for ${name}"]`)!;
    await act(async()=>{trigger.focus();trigger.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));});
    await vi.waitFor(()=>expect(document.querySelector('[role="menu"]')).not.toBeNull());
  }
  it("opens the original empty-state form and completes the existing governed creation chain",async()=>{
    const f=await creationFixture();const original=f.send.getMockImplementation()!;
    f.send.mockImplementation(async request=>{
      if(request.path==="/api/v1/role-workspaces")return {status:200,body:{workspaces:[],createActionKey:CreateActionKey.WorkspaceCreate}};
      if(request.path.startsWith("/api/v1/agent-definitions"))return {status:200,body:{definitions:[]}};
      if(request.method==="POST")f.intent.channel.slug=(request.body as {slug:string}).slug;
      return original(request);
    });
    const selected=vi.fn();const ui=await directory(f.h,f.client,selected);
    await vi.waitFor(()=>expect([...ui.querySelectorAll("button")].some(node=>node.textContent==="Create project")).toBe(true));
    await click(button(ui,"Create project"));
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="create-project-name"]')).not.toBeNull());
    await type(document.querySelector<HTMLInputElement>('[data-testid="create-project-name"]')!,creationInput.name);
    await type(document.querySelector<HTMLTextAreaElement>("textarea")!,creationInput.description);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="create-project-submit"]')!);
    await vi.waitFor(()=>expect(selected).toHaveBeenCalledWith(expect.stringContaining(`30621:${owner}:`)));
    expect(f.publish.mock.calls.map(call=>call[0].operation)).toEqual(["CREATE_PROJECT","CREATE_REPOSITORY"]);
    expect(f.send.mock.calls.filter(([request])=>request.method==="POST")).toHaveLength(1);
    expect(sessionStorage.length).toBe(0);expect(document.querySelector('[data-testid="create-project-name"]')).toBeNull();
    expect(ui.textContent).toContain(creationInput.name);
  });
  it.each(["denied","offline"])("does not render creation when the real capability is %s",async outcome=>{
    const publish=vi.fn();const client=createBffClient({send:async()=>{if(outcome==="offline")throw new TransportError("capability offline");return {status:200,body:{workspaces:[]}};}});
    const ui=await directory({...host([]),publish},client);
    await vi.waitFor(()=>expect(ui.textContent).toContain("No projects yet"));
    expect(ui.querySelector('button[aria-label="Create project"]')).toBeNull();expect(ui.textContent).not.toContain("Create project");
    expect(publish).not.toHaveBeenCalled();
  });
  it.each(["grid","list"])("uses the original %s actions menu and deletes only the winning owned announcement",async layout=>{
    if(layout==="list")localStorage.setItem("buzz.projects.viewMode","list");
    const old=project("Old owned","c".repeat(64));const current={...old,id:"e".repeat(64),created_at:11,tags:old.tags.map(tag=>tag[0]==="name"?["name","Current owned"]:tag)};
    let rows=[old,current];const publish=vi.fn(async()=>{rows=[];return {eventId:"f".repeat(64)};});
    const h:ProjectsHost={scopeKey:"owned-directory",query:async request=>({pubkey:owner,limit:20,events:request.view==="PROJECTS"?rows:[]}),publish};
    const ui=await directory(h);await vi.waitFor(()=>expect(ui.textContent).toContain("Current owned"));
    await openMenu(ui,"Current owned");await click(document.querySelector<HTMLElement>('[role="menuitem"]')!);
    await vi.waitFor(()=>expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());
    await click(button(document.querySelector<HTMLElement>('[role="alertdialog"]')!,"Delete project"));
    await vi.waitFor(()=>expect(ui.textContent).toContain("No projects yet"));
    expect(publish).toHaveBeenCalledWith({operation:"DELETE",targetEventId:current.id},expect.any(String),false,expect.objectContaining({onPrepared:expect.any(Function)}));
    expect(publish).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
    expect(ui.querySelectorAll("button button")).toHaveLength(0);
  });
  it("does not turn another author's directory row into a delete action",async()=>{
    const source={...project("Someone else's project"),pubkey:other};const publish=vi.fn();
    const ui=await directory({...host([source]),publish});await vi.waitFor(()=>expect(ui.textContent).toContain("Someone else's project"));
    expect(ui.querySelector('[aria-label^="More options"]')).toBeNull();expect(publish).not.toHaveBeenCalled();
  });
  it("retains the original list preference across remount and flattens only its compact description",async()=>{
    const source=project();source.tags=source.tags.map(tag=>tag[0]==="description"?["description","## **Original** [description](https://example.invalid)\nnext line"]:tag);
    const h=host([source]);function Host(){const [generation,next]=useState(0);return <><button onClick={()=>next(generation+1)}>Reopen Projects</button><ProjectsView key={generation} host={h}/></>;}
    const ui=await render(<PlatformProvider client={bff}><QueryClientProvider client={cache()}><Host/></QueryClientProvider></PlatformProvider>);
    await vi.waitFor(()=>expect(ui.textContent).toContain("Real project"));
    await click(ui.querySelector<HTMLButtonElement>('[aria-label="List layout"]')!);
    expect(localStorage.getItem("buzz.projects.viewMode")).toBe("list");
    expect(ui.querySelector('[data-testid="projects-row-description"]')?.textContent).toBe("Original description next line");
    await click(button(ui,"Reopen Projects"));
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="project-row-p"]')).not.toBeNull());
    expect(ui.querySelector('[aria-label="List layout"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(ui.querySelector('[data-projects-grid-card]')).toBeNull();
  });
  it("renders the original filtered-empty state rather than the unfiltered directory hint",async()=>{
    const ui=await directory(host());await vi.waitFor(()=>expect(ui.textContent).toContain("Real project"));
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="projects-activity-search"]')!);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="projects-section-search-input"]')).not.toBeNull());
    await type(ui.querySelector<HTMLInputElement>('[data-testid="projects-section-search-input"]')!,"absent-project");
    expect(ui.textContent).toContain("No matching projects");expect(ui.textContent).toContain("Try another owner filter or sort mode.");
    expect(ui.textContent).not.toContain("Projects published to this relay");
  });
});

describe("original SidebarProjectsSection governed hosts",()=>{
  beforeEach(()=>Object.defineProperty(window,"matchMedia",{configurable:true,value:vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))}));
  const childId="12345678-1234-1234-8234-123456789012";
  const membership=():SidebarProjectMembership=>({projectAddresses:[`30621:${owner}:p`],pending:false,addProject:vi.fn().mockResolvedValue(undefined),removeProject:vi.fn().mockResolvedValue(undefined),refresh:vi.fn().mockResolvedValue(undefined)});
  it("places the original project region after the primary header and does not select overview for a project",async()=>{
    const ui=await render(<SidebarProvider><AppSidebarPrimaryMenu selectedView="platform" selectedPlatformSection="projects" projectsOverviewActive={false}
      onSelectHome={vi.fn()} onSelectPlatformSection={vi.fn()} projectsSection={<div data-testid="project-region"/>}/></SidebarProvider>);
    expect(ui.querySelector('[data-testid="sidebar-platform-projects"]')?.getAttribute("data-active")).toBe("false");
    expect(ui.querySelector('[data-testid="sidebar-primary-menu"]')?.contains(ui.querySelector('[data-testid="project-region"]'))).toBe(false);
    expect(ui.querySelector('[data-testid="project-region"]')).not.toBeNull();
  });
  async function sidebar(h=host(),m=membership(),onSelectProject=vi.fn(),onSelectChannel=vi.fn()){
    writeSidebarProjectsFilter("added",h.scopeKey);
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const ui=await render(<PlatformProvider client={bff}><QueryClientProvider client={cache}><SidebarProvider><SidebarProjectsSection host={h} membership={m}
      channels={[{id:childId,name:"Real channel",visibility:"private"}]} selectedProjectId={null} selectedChannelId={null}
      onSelectProject={onSelectProject} onSelectChannel={onSelectChannel}/></SidebarProvider></QueryClientProvider></PlatformProvider>);
    return {ui,cache};
  }
  it("keeps Added distinct from Owned and preserves original ordering without local membership",()=>{
    const a=buildProjectReadModels({projectEvents:[project("Zulu","a",20),{...project("Alpha","b",10),pubkey:other}],repositoryEvents:[]});
    expect(listSidebarProjects({projects:a,currentPubkey:owner,filter:"owned",sort:"name",addedProjectAddresses:new Set()}).map(p=>p.name)).toEqual(["Zulu"]);
    expect(listSidebarProjects({projects:a,currentPubkey:owner,filter:"added",sort:"name",addedProjectAddresses:new Set([`30621:${other}:b`])}).map(p=>p.name)).toEqual(["Alpha"]);
  });
  it("renders the original section, opens a real project and expands only admitted child channels",async()=>{
    const source=project();source.tags.push(["buzz-related-channel",childId],["buzz-related-channel","22345678-1234-1234-8234-123456789012"]);
    const onProject=vi.fn(),onChannel=vi.fn();const {ui}=await sidebar(host([source]),membership(),onProject,onChannel);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="sidebar-project-p"]')).not.toBeNull());
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-project-p"]')!);expect(onProject).toHaveBeenCalledWith(`30621:${owner}:p`);
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-project-expand-p"]')!);
    expect(ui.querySelectorAll('[data-testid^="sidebar-project-channel-"]')).toHaveLength(1);
    expect(ui.textContent).not.toContain("not-admitted");
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-project-channel-p-Real channel"]')!);expect(onChannel).toHaveBeenCalledWith(childId);
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-section-label"]')!);expect(ui.querySelector('[data-testid="sidebar-project-p"]')).toBeNull();
  });
  it("does not retain a project after the authoritative directory refresh fails",async()=>{
    const h=host();const {ui,cache}=await sidebar(h);
    await vi.waitFor(()=>expect(ui.textContent).toContain("Real project"));
    h.query=async()=>{throw new Error("scope revoked");};
    await act(async()=>{await cache.invalidateQueries({queryKey:["sidebar-projects",h.scopeKey]});});
    await vi.waitFor(()=>expect(ui.querySelector('[role="alert"]')).not.toBeNull());
    expect(ui.querySelector('[data-testid="sidebar-project-p"]')).toBeNull();
  });
  it("consumes a rejected asynchronous project navigation without claiming a creation failed",async()=>{
    const navigate=vi.fn().mockRejectedValue(new Error("router unavailable"));
    const {ui}=await sidebar(host(),membership(),navigate);
    await vi.waitFor(()=>expect(ui.querySelector('[data-testid="sidebar-project-p"]')).not.toBeNull());
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-project-p"]')!);
    expect(ui.querySelector('[role="alert"]')).not.toBeNull();expect(navigate).toHaveBeenCalledOnce();
    expect(ui.textContent).not.toContain("Project created");expect(ui.textContent).not.toContain("Creation is not confirmed");
  });
  it("uses the actual controlled project route and clears it on the original detail close",async()=>{
    const h=host();const cache=new QueryClient();const changed=vi.fn();
    function Host(){const [selected,setSelected]=useState<string|null>(`30621:${owner}:p`);return <ProjectsView host={h} selectedProjectId={selected} onSelectedProjectChange={id=>{changed(id);setSelected(id);}}/>;}
    const ui=await render(<PlatformProvider client={bff}><QueryClientProvider client={cache}><Host/></QueryClientProvider></PlatformProvider>);
    await vi.waitFor(()=>expect(ui.querySelector("aside")).not.toBeNull());
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Close project announcement"]')!);
    expect(changed).toHaveBeenCalledWith(null);expect(ui.querySelector("aside")).toBeNull();
  });
  it("uses the Chinese catalog for the original section and Add control",async()=>{
    setLocale("zh-CN");const {ui}=await sidebar(host([]));
    await vi.waitFor(()=>expect(ui.textContent).toContain("暂无项目"));
    expect(ui.querySelector('[data-testid="sidebar-projects-create"]')?.getAttribute("aria-label")).toBe("添加项目");
  });
  it("uses the real Add preference callback and never navigates on an unknown result",async()=>{
    const m=membership();m.projectAddresses=[];m.addProject=vi.fn().mockRejectedValue(new TransportError("lost confirmation"));
    const navigate=vi.fn();const {ui}=await sidebar(host(),m,navigate);
    await vi.waitFor(()=>expect(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-create"]')?.disabled).toBe(false));
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-create"]')!);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="project-browser-result-p"]')!);
    expect(m.addProject).toHaveBeenCalledWith(`30621:${owner}:p`);expect(navigate).not.toHaveBeenCalled();
    m.addProject=vi.fn().mockResolvedValue(undefined);
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-create"]')!);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="project-browser-result-p"]')!);
    expect(navigate).toHaveBeenCalledWith(`30621:${owner}:p`);
  });
  it("does not navigate when an old Add completes after the sidebar scope unmounts",async()=>{
    let resolve!:()=>void;const m=membership();m.addProject=()=>new Promise<void>(done=>{resolve=done;});
    const navigate=vi.fn(),h=host();const cache=new QueryClient();
    function Host(){const [active,setActive]=useState(true);return <><button onClick={()=>setActive(false)}>Leave scope</button>
      {active?<SidebarProvider><SidebarProjectsSection host={h} membership={m} channels={[]} onSelectProject={navigate} onSelectChannel={vi.fn()}/></SidebarProvider>:null}</>;}
    const ui=await render(<PlatformProvider client={bff}><QueryClientProvider client={cache}><Host/></QueryClientProvider></PlatformProvider>);
    await vi.waitFor(()=>expect(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-create"]')?.disabled).toBe(false));
    await click(ui.querySelector<HTMLButtonElement>('[data-testid="sidebar-projects-create"]')!);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="project-browser-result-p"]')!);
    await click(button(ui,"Leave scope"));
    await act(async()=>resolve());expect(navigate).not.toHaveBeenCalled();
  });
});

describe("original Projects announcements",()=>{
  it("reads actual NIP-MP names and retains unresolved repository coordinates without guessing access",async()=>{
    const read=await loadProjects(host(),signal());
    expect(read[0]?.name).toBe("Real project");expect(read[0]?.owner).toBe(owner);
    expect(read[0]?.repositories).toEqual([]);
    expect(read[0]?.unavailableRepositoryAddresses).toEqual([`30617:${other}:missing`]);
  });
  it("only enumerates scoped tombstones and fails closed rather than resurrecting deleted projects",async()=>{
    const h=host();const fetch=h.query;h.query=vi.fn(async req=>{if(req.view==="DELETIONS")throw new Error("Relay unreachable");return fetch(req);});
    await expect(loadProjects(h,signal())).rejects.toThrow("Relay unreachable");
    expect(h.query).toHaveBeenCalledWith(expect.objectContaining({view:"DELETIONS",coordinates:[`30621:${owner}:p`]}));
    const deleted=buildProjectReadModels({projectEvents:[project()],repositoryEvents:[],deletionEvents:[{id:"d",pubkey:owner,kind:5,created_at:11,content:"",tags:[["a",`30621:${owner}:p`]]}]});
    expect(deleted).toEqual([]);
  });
  it("retains the upstream unlisted owner boundary and canonical NIP-MP membership checks",()=>{
    const hidden=project();hidden.tags.push(["buzz-visibility","unlisted"]);
    expect(buildProjectReadModels({projectEvents:[hidden],repositoryEvents:[],viewerPubkey:other})).toEqual([]);
    expect(buildProjectReadModels({projectEvents:[hidden],repositoryEvents:[],viewerPubkey:owner})).toHaveLength(1);
    const invalid=project();invalid.tags.push(["a",`30617:${other}:missing`]);
    expect(buildProjectReadModels({projectEvents:[invalid],repositoryEvents:[]})).toEqual([]);
  });
  it("drains the full oldest second before advancing and refuses an uncompletable bucket",async()=>{
    const query=vi.fn<ProjectsHost["query"]>(async req=>({pubkey:owner,limit:2,events:req.view!=="PROJECTS"?[]:req.since!==undefined?[project("boundary","b",8)]:req.until===7?[project("older","c",7)]:[project("new","a",10),project("boundary","b",8)]}));
    expect(await loadProjects({scopeKey:"scope",query},signal())).toHaveLength(3);
    expect(query).toHaveBeenCalledWith({view:"PROJECTS",coordinates:undefined,since:8,until:8});
    const saturated:ProjectsHost={scopeKey:"scope",query:async req=>({pubkey:owner,limit:2,events:req.view==="PROJECTS"?[project("a","a",8),project("b","b",8)]:[]})};
    await expect(loadProjects(saturated,signal())).rejects.toThrow("timestamp bucket");
  });
  it("refuses a changed signing identity during enumeration",async()=>{
    let n=0;const h:ProjectsHost={scopeKey:"scope",query:async()=>({pubkey:n++===0?owner:other,limit:3,events:[]})};
    await expect(loadProjects(h,signal())).rejects.toThrow("scope changed");
  });
  it("cancels further enumeration when leaving the scope",async()=>{
    const abort=new AbortController();const h=host();const query=h.query;h.query=async r=>{abort.abort();return query(r);};
    await expect(loadProjects(h,abort.signal)).rejects.toThrow();
  });
  it("opens the original announcement card, switches layout and removes old detail on failed fresh read",async()=>{
    const h=host();const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const ui=await render(<PlatformProvider client={bff}><QueryClientProvider client={cache}><ProjectsView host={h}/></QueryClientProvider></PlatformProvider>);
    await vi.waitFor(()=>expect(ui.textContent).toContain("Real project"));
    await click(button(ui,"View Real project"));
    expect(ui.querySelector("aside")?.textContent).toContain(`30617:${other}:missing`);
    expect(ui.querySelector("aside")?.textContent).toContain("does not grant access");
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="List layout"]')!);expect(ui.querySelectorAll("[data-projects-grid-card]")).toHaveLength(0);
    h.query=async()=>{throw new Error("revoked");};await act(async()=>{await cache.invalidateQueries({queryKey:["projects",h.scopeKey]});});
    await vi.waitFor(()=>expect(ui.querySelector('[role="alert"]')).not.toBeNull());
    expect(ui.querySelector("aside")).toBeNull();expect(ui.textContent).not.toContain("Real project");
  });
  it("uses the same Chinese catalog without fabricating create or Git actions",async()=>{
    setLocale("zh-CN");const cache=new QueryClient();
    const ui=await render(<PlatformProvider client={bff}><QueryClientProvider client={cache}><ProjectsView host={host([])}/></QueryClientProvider></PlatformProvider>);
    await vi.waitFor(()=>expect(ui.textContent).toContain("暂无项目"));
    expect(ui.querySelector('button[aria-label="网格布局"]')).not.toBeNull();
    expect(ui.textContent).not.toMatch(/Create project|Delete project|terminal/);
  });
  it("retains the original project deletion dialog and clears only after its accepted tombstone is read back",async()=>{
    const source=project("Owned", "c".repeat(64));const model=buildProjectReadModels({projectEvents:[source],repositoryEvents:[]})[0]!;
    const publish=vi.fn().mockResolvedValue({eventId:"d".repeat(64)});const removed=vi.fn();
    const h={...host([]),publish};
    const ui=await render(<ProjectDeleteAction renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={owner} host={h} onDeleted={removed}/>);
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Delete project"]')!);
    expect(document.body.textContent).toContain("Delete Owned from Projects for everyone");
    await click(button(document.body,"Delete project"));
    expect(publish).toHaveBeenCalledWith({operation:"DELETE",targetEventId:source.id},expect.any(String),false,expect.objectContaining({onPrepared:expect.any(Function)}));
    expect(removed).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
  });
  it("does not discard an UNKNOWN intent after a later denied observation or modal close",async()=>{
    const source=project("Owned", "c".repeat(64));const model=buildProjectReadModels({projectEvents:[source],repositoryEvents:[]})[0]!;
    const publish=vi.fn().mockRejectedValueOnce(new TransportError("lost ACK"))
      .mockRejectedValueOnce(new BffError(403,"Revoked")).mockResolvedValueOnce({eventId:"d".repeat(64)});
    const removed=vi.fn();const h={...host([]),publish};
    const ui=await render(<ProjectDeleteAction renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={owner} host={h} onDeleted={removed}/>);
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Delete project"]')!);
    await click(button(document.body,"Delete project"));
    expect(document.body.textContent).toContain("Could not confirm");
    await click(button(document.body,"Cancel"));await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Delete project"]')!);
    await click(button(document.body,"Delete project"));
    expect(document.body.textContent).toContain("Could not confirm");expect(removed).not.toHaveBeenCalled();
    await click(button(document.body,"Delete project"));
    const first=publish.mock.calls[0]!;
    expect(publish.mock.calls[1]?.slice(0,3)).toEqual([first[0],first[1],true]);expect(publish.mock.calls[2]?.slice(0,3)).toEqual([first[0],first[1],true]);
    expect(removed).toHaveBeenCalledOnce();
  });
  it("does not grant another device key project ownership or remove a concurrent newer head",async()=>{
    const source=project("Owned", "c".repeat(64));const model=buildProjectReadModels({projectEvents:[source],repositoryEvents:[]})[0]!;
    const publish=vi.fn().mockResolvedValue({eventId:"d".repeat(64)});const removed=vi.fn();const h={...host([source]),publish};
    const foreign=await render(<ProjectDeleteAction renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={other} host={h} onDeleted={removed}/>);
    expect(foreign.querySelector("button")).toBeNull();
    const ui=await render(<ProjectDeleteAction renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={owner} host={h} onDeleted={removed}/>);
    await click(ui.querySelector<HTMLButtonElement>('button[aria-label="Delete project"]')!);await click(button(document.body,"Delete project"));
    expect(document.body.textContent).toContain("updated while it was being deleted");expect(removed).not.toHaveBeenCalled();
  });
  it("retains an ACK through failed readback and remount without another publication",async()=>{
    const source=project("Owned","c".repeat(64));const model=buildProjectReadModels({projectEvents:[source],repositoryEvents:[]})[0]!;
    const publish=vi.fn().mockResolvedValue({eventId:"d".repeat(64)}),completePublication=vi.fn(),removed=vi.fn();
    const h={...host([]),publish,completePublication};const fresh=h.query;
    h.query=vi.fn().mockRejectedValueOnce(new Error("directory offline")).mockImplementation(fresh);
    function Host(){const [generation,next]=useState(0);return <><button onClick={()=>next(generation+1)}>Restart view</button><ProjectDeleteAction key={generation} renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={owner} host={h} onDeleted={removed}/></>;}
    const ui=await render(<Host/>);
    await click(ui.querySelector<HTMLButtonElement>('[aria-label="Delete project"]')!);await click(button(document.body,"Delete project"));
    expect(removed).not.toHaveBeenCalled();expect(completePublication).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).acceptedEventId).toBe("d".repeat(64));
    await click(button(ui,"Restart view"));await click(ui.querySelector<HTMLButtonElement>('[aria-label="Delete project"]')!);await click(button(document.body,"Delete project"));
    expect(publish).toHaveBeenCalledTimes(1);expect(removed).toHaveBeenCalledOnce();
    expect(completePublication).toHaveBeenCalledWith(publish.mock.calls[0]![1],"d".repeat(64));expect(sessionStorage.length).toBe(0);
  });
  it("persists the prepared event reference before Native publication and observes it after remount",async()=>{
    const source=project("Owned","c".repeat(64));const model=buildProjectReadModels({projectEvents:[source],repositoryEvents:[]})[0]!;
    const eventId="d".repeat(64);const removed=vi.fn();
    const publish=vi.fn<NonNullable<ProjectsHost["publish"]>>().mockImplementationOnce(async(_request,_key,_observe,observation)=>{
      observation!.onPrepared(eventId);
      expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).eventId).toBe(eventId);
      throw new TransportError("lost ACK");
    }).mockResolvedValueOnce({eventId});
    const h={...host([]),publish};
    function Host(){const [generation,next]=useState(0);return <><button onClick={()=>next(generation+1)}>Restart view</button><ProjectDeleteAction key={generation} renderTrigger={deleteTrigger} project={model} headId={source.id} viewerPubkey={owner} host={h} onDeleted={removed}/></>;}
    const ui=await render(<Host/>);
    await click(ui.querySelector<HTMLButtonElement>('[aria-label="Delete project"]')!);await click(button(document.body,"Delete project"));
    await click(button(ui,"Restart view"));await click(ui.querySelector<HTMLButtonElement>('[aria-label="Delete project"]')!);await click(button(document.body,"Delete project"));
    expect(publish.mock.calls[1]?.slice(0,3)).toEqual([publish.mock.calls[0]![0],publish.mock.calls[0]![1],true]);
    expect(publish.mock.calls[1]?.[3]?.eventId).toBe(eventId);expect(removed).toHaveBeenCalledOnce();
  });
});
