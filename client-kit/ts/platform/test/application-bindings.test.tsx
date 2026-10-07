import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { ApplicationBindingsPanel, bindingDocument } from "../src/react/application-bindings";
import { NativeApplicationPage, validNativePage } from "../src/react/native-application-page";
import { NativeApplicationEntries } from "../src/react/native-application-entries";
import { SidebarProvider } from "../src/react/sidebar/sidebar";
import { act, useState } from "react";
import { PlatformProvider } from "../src/react/context";
import { type BffReply, type BffRequest, TransportError } from "../src/transport";
import { button, click, render, type } from "./render";

const connection = {
  bindingId: "connection-fixture", tenantId: "tenant-fixture", componentReleaseId: "release-fixture",
  componentTypeKey: "external_fixture", state: "ACTIVE", version: 3, activeProjectionGeneration: 1,
  capabilityCategories: [{ category: "knowledge", version: 1 }], canDisable: true,
};
const creation = {
  bindingId: "connection-fixture", componentReleaseId: "release-fixture", servicePrincipalId: "service-fixture",
  adapterServiceRef: "adapter-fixture", nativeInstanceRef: "native-fixture", isolationMode: "NAMESPACE",
  capabilityCategories: [{ category: "knowledge", version: 1 }], normalizedConfigJson: '{"id":9007199254740993}',
  secretRefs: [{ secretKey: "api_key", locator: "secret-ref-fixture", version: 1, audience: "adapter-fixture" }],
  modelCallMode: "NONE", callIdentityMode: "INSTANCE_SERVICE", retainOnTenantDelete: true,
};
const dispatched = (actionKey: string) => ({ actionKey, actionExecutionId: "binding-action", operationId: "binding-operation",
  gateState: "ALLOWED", dispatchState: "DISPATCHED", workflowId: "binding-workflow" });

async function mount(route: (request: BffRequest) => BffReply | Promise<BffReply>) {
  const send = vi.fn(async (request: BffRequest) => request.path === "/api/v1/workspaces"
    ? { status: 200, body: [{ id: "workspace-fixture", name: "Workspace fixture" }] } : route(request));
  const host = await render(<PlatformProvider client={createBffClient({ send })} locale="en"><ApplicationBindingsPanel /></PlatformProvider>);
  return { host, send };
}

const readSource = { resourceId: "source-resource", version: 7, bindingId: "source-binding", typeKey: "files", nativeRef: "native-source" };
const readReceiver = { resourceId: "receiver-resource", version: 9, bindingId: connection.bindingId, typeKey: "knowledge", nativeRef: "native-receiver" };
function readPage(direction: string) {
  return { bindingId: connection.bindingId, bindingVersion: connection.version, tenantId: connection.tenantId,
    servicePrincipalId: "receiver-service", direction, resources: [direction === "SOURCE" ? readSource : readReceiver] };
}
async function selectResource(host: HTMLElement, label: string, id: string) {
  const select = [...host.querySelectorAll("label")].find(row => row.textContent?.startsWith(label))?.querySelector("select");
  if (!select) throw new Error(`missing resource picker: ${label}`);
  await act(async () => { select.value = id; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function selectReadPair(host: HTMLElement) {
  await click(button(host, "Resource read permissions"));
  await selectResource(host, "Receiving resource", readReceiver.resourceId);
  await selectResource(host, "Source resource", readSource.resourceId);
}

describe("shared SERVICE read permissions on existing connection management", () => {
  it("renders the same receiver workflow in Chinese without a raw SERVICE ID input",async()=>{
    const client=createBffClient({send:async request=>({status:200,body:request.path==="/api/v1/workspaces"?[]:
      request.path.includes("/read-resources")?readPage(new URL(request.path,"https://test.invalid").searchParams.get("direction")!):
      {bindings:[{...connection,hasReadReceiver:true}],canCreate:false}})});
    const host=await render(<PlatformProvider client={client} locale="zh-CN"><ApplicationBindingsPanel/></PlatformProvider>);
    await click(button(host,"资源读取权限"));
    expect(host.textContent).toContain("接收资源"); expect(host.textContent).toContain("源资源");
    expect(host.querySelector("input")).toBeNull();
    expect(button(host,"申请读取权限").disabled).toBe(true);
  });

  it("uses directory references and the binding SERVICE, then follows original owner approval", async () => {
    const {host,send} = await mount(request => request.method === "POST"
      ? {status:200,body:{actionKey:"resource.grant_read",actionExecutionId:"read-action",operationId:"read-operation",
        gateState:"WAITING",dispatchState:"NOT_DISPATCHED",approvalWorkflowId:"owner-approval"}}
      : {status:200,body:request.path.includes("/read-resources")
        ? readPage(new URL(request.path,"https://test.invalid").searchParams.get("direction")!)
        : {bindings:[{...connection,hasReadReceiver:true}],canCreate:false}});
    await selectReadPair(host);
    await click(button(host,"Request read access"));
    expect(send.mock.calls.filter(([request])=>request.method==="POST")).toHaveLength(0);
    expect(host.textContent).toContain("source owner approves");
    await click(button(host,"Confirm"));
    const command=send.mock.calls.find(([request])=>request.method==="POST")?.[0].body;
    expect(command).toMatchObject({actionKey:"resource.grant_read",resourceId:readSource.resourceId,resourceVersion:7,
      principalId:"receiver-service",receiverResource:{id:readReceiver.resourceId,version:9}});
    expect(command).not.toHaveProperty("applicationBindingId");
    expect(command).not.toHaveProperty("nativeRef");
    expect(host.textContent).toContain("Check its task for the outcome");
    expect(button(host,"Back").disabled).toBe(false);
  });

  it("retains UNKNOWN grant intent and scope and accepts the actual synchronous receipt without a workflow ID",async()=>{
    let writes=0;
    const {host,send}=await mount(request=>{
      if(request.method==="POST") {
        if(++writes===1) throw new TransportError("unconfirmed response");
        return {status:200,body:{actionKey:"resource.revoke_read",actionExecutionId:"read-action",operationId:"read-operation",
          gateState:"ALLOWED",dispatchState:"DISPATCHED"}};
      }
      return {status:200,body:request.path.includes("/read-resources")
        ? readPage(new URL(request.path,"https://test.invalid").searchParams.get("direction")!)
        : {bindings:[{...connection,hasReadReceiver:true}],canCreate:false}};
    });
    await selectReadPair(host); await click(button(host,"Revoke read access")); await click(button(host,"Confirm"));
    expect(button(host,"Back").disabled).toBe(true);
    expect(host.querySelector("select")?.disabled).toBe(true);
    expect([...host.querySelectorAll("button")].some(item=>item.textContent==="Cancel")).toBe(false);
    await click(button(host,"Re-check same request"));
    const requests=send.mock.calls.filter(([request])=>request.method==="POST").map(([request])=>request);
    expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]?.body).toMatchObject({actionKey:"resource.revoke_read",explicitConfirmation:true});
    expect(button(host,"Back").disabled).toBe(false);
  });

  it("does not expose an unsupported receiver or accept a foreign binding/resource directory",async()=>{
    const unsupported=await mount(()=>({status:200,body:{bindings:[connection],canCreate:false}}));
    expect(unsupported.host.textContent).not.toContain("Resource read permissions");
    const {host,send}=await mount(request=>({status:200,body:request.path.includes("/read-resources")
      ? {...readPage("SOURCE"),bindingId:"another-binding"}
      : {bindings:[{...connection,hasReadReceiver:true}],canCreate:false}}));
    await click(button(host,"Resource read permissions"));
    expect(button(host,"Request read access").disabled).toBe(true);
    expect(host.textContent).not.toContain("native-source");
    expect(send.mock.calls.every(([request])=>request.method==="GET")).toBe(true);
  });

  it("does not combine source and receiver pages resolved to different SERVICE identities",async()=>{
    const {host,send}=await mount(request=>{
      const direction=new URL(request.path,"https://test.invalid").searchParams.get("direction")!;
      return {status:200,body:request.path.includes("/read-resources")
        ? {...readPage(direction),servicePrincipalId:direction==="SOURCE"?"stale-service":"receiver-service"}
        : {bindings:[{...connection,hasReadReceiver:true}],canCreate:false}};
    });
    await selectReadPair(host);
    expect(button(host,"Request read access").disabled).toBe(true);
    expect(send.mock.calls.every(([request])=>request.method==="GET")).toBe(true);
  });

  it("withdraws old selections and late receipts when the authenticated BFF client changes",async()=>{
    let finish:((reply:BffReply)=>void)|undefined;
    const first=createBffClient({send:async request=>{
      if(request.method==="POST") return new Promise<BffReply>(resolve=>{finish=resolve;});
      return {status:200,body:request.path==="/api/v1/workspaces"?[]:request.path.includes("/read-resources")
        ?readPage(new URL(request.path,"https://test.invalid").searchParams.get("direction")!)
        :{bindings:[{...connection,hasReadReceiver:true}],canCreate:false}};
    }});
    const secondSend=vi.fn(async():Promise<BffReply>=>({status:403,body:{}}));
    const second=createBffClient({send:secondSend});
    function SwitchActor(){const [client,setClient]=useState(first);return <PlatformProvider client={client} locale="en">
      <button onClick={()=>setClient(second)}>Switch actor</button><ApplicationBindingsPanel/></PlatformProvider>;}
    const host=await render(<SwitchActor/>); await selectReadPair(host);
    await click(button(host,"Request read access")); await click(button(host,"Confirm"));
    await click(button(host,"Switch actor"));
    await act(async()=>finish?.({status:200,body:{actionKey:"resource.grant_read",actionExecutionId:"old-read-action",
      operationId:"old-read-operation",gateState:"ALLOWED",dispatchState:"DISPATCHED"}}));
    expect(host.textContent).not.toContain("old-read-operation");
    expect(host.textContent).not.toContain("native-source");
    expect(host.querySelector('[data-testid="service-read-permissions"]')).toBeNull();
    expect(host.textContent).toContain("Not allowed");
  });
});

describe("shared external service connection management", () => {
  beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  afterEach(() => vi.unstubAllGlobals());
  it("submits creation through the original action without interpreting native configuration or claiming active", async () => {
    const { host, send } = await mount((request) => request.method === "GET"
      ? { status: 200, body: { bindings: [], canCreate: true } }
      : { status: 200, body: dispatched("application_binding.create") });
    const document = host.querySelector("textarea");
    if (!document) throw new Error("connection document is absent");
    await type(document, JSON.stringify(creation));
    await click(button(host, "Review connection"));
    expect(send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
    await click(button(host, "Submit governed request"));
    const writes = send.mock.calls.filter(([request]) => request.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toMatchObject({ path: "/api/v1/actions", body: {
      actionKey: "application_binding.create", explicitConfirmation: true, applicationBindingCreate: creation,
    } });
    expect(host.textContent).toContain("No connections in this scope.");
    expect(host.textContent).toContain("Check its task for the outcome");
    expect(button(host, "View connection task")).toBeTruthy();
  });

  it("disconnects only the exact binding version and explains that native data is preserved", async () => {
    const { host, send } = await mount((request) => request.method === "GET"
      ? { status: 200, body: { bindings: [connection], canCreate: false } }
      : { status: 200, body: dispatched("application_binding.disable") });
    await click(button(host, "Disconnect from Kailo"));
    expect(host.textContent).toContain("does not stop the external service or delete its data");
    await click(button(host, "Submit governed request"));
    const writes = send.mock.calls.filter(([request]) => request.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toMatchObject({ path: "/api/v1/actions", body: {
      actionKey: "application_binding.disable", applicationBindingId: connection.bindingId,
      applicationBindingVersion: connection.version, explicitConfirmation: true,
    } });
  });

  it("retains one immutable intent and scope after uncertain delivery, even after read permission is revoked", async () => {
    let writes = 0;
    const { host, send } = await mount((request) => {
      if (request.method === "GET") return writes ? { status: 403, body: {} }
        : { status: 200, body: { bindings: [connection], canCreate: false } };
      writes++;
      if (writes === 1) throw new TransportError("lost response");
      return { status: 200, body: dispatched("application_binding.disable") };
    });
    await click(button(host, "Disconnect from Kailo"));
    await click(button(host, "Submit governed request"));
    expect(host.querySelector("select")?.disabled).toBe(true);
    expect([...host.querySelectorAll("button")].some((element) => element.textContent === "Cancel")).toBe(false);
    await click(button(host, "Re-check same request"));
    const requests = send.mock.calls.filter(([request]) => request.method === "POST").map(([request]) => request);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(host.querySelector("select")?.disabled).toBe(false);
  });

  it("rejects wrong-scope rows, unknown state, missing active generation and missing permission facts", async () => {
    for (const row of [{ ...connection, workspaceId: "other-workspace" }, { ...connection, state: "NEW_STATE" },
      { ...connection, activeProjectionGeneration: undefined }, { ...connection, canDisable: undefined }]) {
      const { host, send } = await mount(() => ({ status: 200, body: { bindings: [row], canCreate: true } }));
      expect(host.querySelector("textarea")).toBeNull();
      expect(host.textContent).not.toContain("No connections in this scope.");
      expect([...host.querySelectorAll("button")].some((element) => element.textContent === "Disconnect from Kailo")).toBe(false);
      expect(send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
    }
  });

  it("rejects extra credential fields and unsafe numeric selectors while preserving config bytes", () => {
    expect(bindingDocument(JSON.stringify(creation))?.normalizedConfigJson).toBe(creation.normalizedConfigJson);
    expect(bindingDocument(JSON.stringify({ ...creation, password: "not-a-real-secret" }))).toBeNull();
    expect(bindingDocument(JSON.stringify({ ...creation, secretRefs: [{ ...creation.secretRefs[0], value: "not-a-real-secret" }] }))).toBeNull();
    expect(bindingDocument(JSON.stringify({ ...creation, capabilityCategories: [{ category: "knowledge", version: Number.MAX_SAFE_INTEGER + 1 }] }))).toBeNull();
  });

  const nativePage = { bindingId: connection.bindingId, projectionGeneration: 1,
    url: "https://service.example.test/admin/#/settings", origin: "https://service.example.test",
    allowedOrigins: ["https://service.example.test", "https://login.example.test"] };

  it("opens the complete independent native page without a frame and removes its entry when access is revoked", async () => {
    let revoked = false;
    const { host, send } = await mount((request) => request.path.endsWith("/native-page")
      ? revoked ? { status: 403, body: {} } : { status: 200, body: nativePage }
      : { status: 200, body: { bindings: [{ ...connection, hasNativePage: true }], canCreate: false } });
    await click(button(host, "Open service page"));
    expect(host.querySelector("iframe")).toBeNull();
    const independent = host.querySelector("a");
    expect(independent?.getAttribute("href")).toBe(nativePage.url);
    expect(independent?.getAttribute("target")).toBe("_blank");
    expect(independent?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(independent?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(independent?.textContent).toContain("Open service in a new tab");
    expect(send.mock.calls.at(-1)?.[0].path).toBe(`/api/v1/application-bindings/${connection.bindingId}/native-page`);
    revoked = true;
    await click(button(host, "Refresh"));
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("a")).toBeNull();
    expect(send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });

  it("passes only the binding ID to the native host, never a caller-selected URL", async () => {
    const openNativePage = vi.fn(async (_bindingId: string) => {});
    const client = createBffClient({ send: async () => ({ status: 200, body: nativePage }) });
    const host = await render(<PlatformProvider client={client} locale="en" openNativePage={openNativePage}>
      <NativeApplicationPage bindingId={connection.bindingId} onBack={() => {}} />
    </PlatformProvider>);
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("a")).toBeNull();
    await click(button(host, "Open service page"));
    expect(openNativePage.mock.calls).toEqual([[connection.bindingId]]);
  });

  it("rejects wrong binding, stale generation, unapproved origins and platform origin pages", async () => {
    for (const page of [{ ...nativePage, bindingId: "another-binding" },
      { ...nativePage, projectionGeneration: 0 }, { ...nativePage, allowedOrigins: [] },
      { ...nativePage, url: "https://user:password@service.example.test/admin" },
      { ...nativePage, allowedOrigins: [...nativePage.allowedOrigins, window.location.origin] }]) {
      expect(validNativePage(page, connection.bindingId)).toBe(false);
      const client = createBffClient({ send: async () => ({ status: 200, body: page }) });
      const host = await render(<PlatformProvider client={client} locale="en">
        <NativeApplicationPage bindingId={connection.bindingId} onBack={() => {}} />
      </PlatformProvider>);
      expect(host.querySelector("iframe")).toBeNull();
      expect(host.querySelector("a")).toBeNull();
    }
  });

  it("discovers a native sidebar entry without management permission and opens only the fresh approved Web page", async () => {
    let revoked = false;
    const send=vi.fn(async(request:BffRequest)=>request.path.endsWith("/native-page")
      ? {status:200,body:nativePage}
      : revoked ? {status:403,body:{}} : {status:200,body:{bindings:[{...connection,hasNativePage:true,canDisable:false}],canCreate:false}});
    const host=await render(<PlatformProvider client={createBffClient({send})} locale="en"><SidebarProvider>
      <NativeApplicationEntries scopeKey="human" />
    </SidebarProvider></PlatformProvider>);
    expect(document.querySelector(`a[href="${nativePage.url}"]`)).toBeNull();
    await click(host.querySelector<HTMLButtonElement>(`button[aria-label="${connection.componentTypeKey}"]`)!);
    const link=document.querySelector(`a[href="${nativePage.url}"]`);
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(document.querySelector("iframe")).toBeNull();
    expect(send.mock.calls.every(([request])=>request.method==="GET")).toBe(true);
    revoked=true;
    await act(async()=>window.dispatchEvent(new Event("focus")));
    expect(document.querySelector(`a[href="${nativePage.url}"]`)).toBeNull();
    expect(host.textContent).not.toContain(connection.componentTypeKey);
  });

  it("uses the same discovered entry for Desktop and hands only its binding to the isolated host",async()=>{
    const openNativePage=vi.fn(async(_id:string)=>{});
    const client=createBffClient({send:async(request)=>({status:200,body:request.path.endsWith("/native-page")?nativePage:
      {bindings:[{...connection,hasNativePage:true}],canCreate:false}})});
    const host=await render(<PlatformProvider client={client} locale="zh-CN" openNativePage={openNativePage}><SidebarProvider>
      <NativeApplicationEntries scopeKey="human" />
    </SidebarProvider></PlatformProvider>);
    await click(host.querySelector<HTMLButtonElement>(`button[aria-label="${connection.componentTypeKey}"]`)!);
    await click(button(document.body,"打开服务页面"));
    expect(openNativePage.mock.calls).toEqual([[connection.bindingId]]);
    expect(document.querySelector(`a[href="${nativePage.url}"]`)).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("does not manufacture entries for inactive, non-native or empty bindings",async()=>{
    for(const bindings of [[],[{...connection,state:"DISABLED",hasNativePage:true}],[{...connection,hasNativePage:false}]]){
      const client=createBffClient({send:async()=>({status:200,body:{bindings,canCreate:false}})});
      const host=await render(<PlatformProvider client={client} locale="en"><SidebarProvider><NativeApplicationEntries scopeKey="human" /></SidebarProvider></PlatformProvider>);
      expect(host.querySelector('[data-testid="native-application-entries"]')).toBeNull();
      expect(host.textContent).not.toContain(connection.componentTypeKey);
    }
  });

  it("consumes later authorized pages but rejects a repeating offset rather than reusing stale entries",async()=>{
    const send=vi.fn(async(request:BffRequest)=>({status:200,body:request.path.endsWith("offset=0")
      ? {bindings:[],canCreate:false,nextOffset:1}
      : {bindings:[{...connection,hasNativePage:true}],canCreate:false,nextOffset:1}}));
    const host=await render(<PlatformProvider client={createBffClient({send})} locale="en"><SidebarProvider><NativeApplicationEntries scopeKey="human" /></SidebarProvider></PlatformProvider>);
    await click(button(host,"Next page"));
    expect(send.mock.calls.at(-1)?.[0].path).toBe("/api/v1/application-bindings?offset=1");
    expect(host.textContent).not.toContain(connection.componentTypeKey);
    expect([...host.querySelectorAll("button")].some((element)=>element.textContent==="Next page")).toBe(false);
  });

  it("withdraws the old workspace entry and late native response on a scope change",async()=>{
    let resolvePage:((reply:BffReply)=>void)|undefined;
    const send=vi.fn(async(request:BffRequest):Promise<BffReply>=>request.path.endsWith("/native-page")
      ? new Promise((resolve)=>{resolvePage=resolve;})
      : {status:200,body:{bindings:request.path.includes("workspaceId=first")?[{...connection,workspaceId:"first",hasNativePage:true}]:[],canCreate:false}});
    const client=createBffClient({send});
    function Consumer(){const [id,setId]=useState("first");return <PlatformProvider client={client} locale="en"><button onClick={()=>setId("second")}>Switch scope</button><SidebarProvider><NativeApplicationEntries scopeKey="human" workspace={{id,name:id}} /></SidebarProvider></PlatformProvider>;}
    const host=await render(<Consumer/>);
    await click(host.querySelector<HTMLButtonElement>(`button[aria-label="${connection.componentTypeKey}"]`)!);
    await click(button(host,"Switch scope"));
    await act(async()=>resolvePage?.({status:200,body:nativePage}));
    expect(host.textContent).not.toContain(connection.componentTypeKey);
    expect(document.querySelector(`a[href="${nativePage.url}"]`)).toBeNull();
    expect(send.mock.calls.some(([request])=>request.path.includes("workspaceId=second"))).toBe(true);
  });
});
