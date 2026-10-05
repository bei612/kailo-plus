import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { ApplicationBindingsPanel, bindingDocument } from "../src/react/application-bindings";
import { NativeApplicationPage, validNativePage } from "../src/react/native-application-page";
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

describe("shared external service connection management", () => {
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

  it("opens only a server-resolved native page and removes the frame when access is revoked", async () => {
    let revoked = false;
    const { host, send } = await mount((request) => request.path.endsWith("/native-page")
      ? revoked ? { status: 403, body: {} } : { status: 200, body: nativePage }
      : { status: 200, body: { bindings: [{ ...connection, hasNativePage: true }], canCreate: false } });
    await click(button(host, "Open service page"));
    const frame = host.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe(nativePage.url);
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-forms allow-downloads");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(send.mock.calls.at(-1)?.[0].path).toBe(`/api/v1/application-bindings/${connection.bindingId}/native-page`);
    revoked = true;
    await click(button(host, "Refresh"));
    expect(host.querySelector("iframe")).toBeNull();
    expect(send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });

  it("passes only the binding ID to the native host, never a caller-selected URL", async () => {
    const openNativePage = vi.fn(async (_bindingId: string) => {});
    const client = createBffClient({ send: async () => ({ status: 200, body: nativePage }) });
    const host = await render(<PlatformProvider client={client} locale="en" openNativePage={openNativePage}>
      <NativeApplicationPage bindingId={connection.bindingId} onBack={() => {}} />
    </PlatformProvider>);
    expect(host.querySelector("iframe")).toBeNull();
    await click(button(host, "Open service page"));
    expect(openNativePage.mock.calls).toEqual([[connection.bindingId]]);
  });

  it("rejects wrong binding, stale generation, unapproved origins and platform origin frames", async () => {
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
    }
  });
});
