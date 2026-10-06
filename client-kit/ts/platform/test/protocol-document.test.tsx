import { StrictMode, act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Method, type DocumentLaunchDescriptor } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { ProtocolDocumentAction } from "../src/react/protocol-document-action";
import { ProtocolDocumentSurface } from "../src/react/protocol-document-surface";
import { ProtocolDocumentBridge } from "../src/react/protocol-document-bridge";
import { button, click, render, settle } from "./render";

const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const operationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reference = { resourceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  nativeObjectRef: "node-fixed", nativeRevision: "revision-fixed", displayName: "Report", mediaType: "application/pdf" };
const editorOrigin = "https://editor.example.test";
const launch: DocumentLaunchDescriptor = { method: Method.Post,
  actionUrl: `${editorOrigin}/open?lang=en`, editorOrigin, expiresAt: "2099-01-01T00:00:00Z",
  formFields: { access_token: "test-transient-form-field" } };
const session = { protocolSessionId: sessionId, actionExecutionId: sessionId,
  applicationBindingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", tenantId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  reference, baseRevision: reference.nativeRevision, state: "OPEN", admittedMode: "VIEW",
  launchTheme: "LIGHT", launchLocale: "en", expiresAt: "2099-01-01T00:00:00Z", version: 1,
  effectiveEditorOrigins: [editorOrigin] };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("submits only one transient form under StrictMode and refresh never repeats it", async () => {
  const forms: { action: string; target: string; value: string | null }[] = [];
  vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (this: HTMLFormElement) {
    forms.push({ action: this.action, target: this.target, value: new FormData(this).get("access_token") as string | null });
  });
  const client = createBffClient({ send: async () => ({ status: 200, body: session }) });
  const host = await render(<StrictMode><PlatformProvider client={client} locale="en" documentTheme="LIGHT">
    <ProtocolDocumentSurface bindingId={session.applicationBindingId} sessionId={sessionId} actionExecutionId={sessionId} reference={reference}
      launch={launch} onBack={() => {}} />
  </PlatformProvider></StrictMode>);
  expect(forms).toHaveLength(1);
  expect(forms[0]?.action).toBe(launch.actionUrl);
  expect(forms[0]?.target).toBe(host.querySelector("iframe")?.name);
  expect(document.querySelectorAll('input[name="access_token"]')).toHaveLength(0);
  expect(host.outerHTML).not.toContain("test-transient-form-field");
  await click(button(host, "Refresh"));
  expect(forms).toHaveLength(1);
});

it.each([
  ["wrong original AE", { ...session, actionExecutionId: operationId }, launch],
  ["wrong source binding", { ...session, applicationBindingId: operationId }, launch],
  ["wrong original revision", { ...session, reference: { ...reference, nativeRevision: "latest" } }, launch],
  ["unknown state", { ...session, state: "NEW_STATE" }, launch],
  ["CSP origin absent", { ...session, effectiveEditorOrigins: [] }, launch],
  ["different URL origin", session, { ...launch, actionUrl: "https://other.example.test/open" }],
  ["credential in URL", session, { ...launch, actionUrl: `${editorOrigin}/open?access_token=test` }],
  ["expired descriptor", session, { ...launch, expiresAt: "2000-01-01T00:00:00Z" }],
  ["GET form credential", session, { ...launch, method: Method.Get }],
])("refuses %s before native submission", async (_name, body, descriptor) => {
  const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  const client = createBffClient({ send: async () => ({ status: 200, body }) });
  await render(<PlatformProvider client={client} documentTheme="LIGHT"><ProtocolDocumentSurface bindingId={session.applicationBindingId}
    sessionId={sessionId} actionExecutionId={sessionId} reference={reference} launch={descriptor}
    onBack={() => {}} /></PlatformProvider>);
  expect(submit).not.toHaveBeenCalled();
});

it("keeps credential-free GET query parameters and never creates a form", async () => {
  const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  const client = createBffClient({ send: async () => ({ status: 200, body: session }) });
  const host = await render(<PlatformProvider client={client} documentTheme="LIGHT"><ProtocolDocumentSurface bindingId={session.applicationBindingId}
    sessionId={sessionId} actionExecutionId={sessionId} reference={reference}
    launch={{ ...launch, method: Method.Get, formFields: {} }} onBack={() => {}} /></PlatformProvider>);
  expect(host.querySelector("iframe")?.src).toBe(launch.actionUrl);
  expect(submit).not.toHaveBeenCalled();
});

it("accepts only exact editor/window UI evidence, never a claimed save terminal", async () => {
  vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  const client = createBffClient({ send: async () => ({ status: 200, body: session }) });
  const host = await render(<PlatformProvider client={client} documentTheme="LIGHT"><ProtocolDocumentSurface bindingId={session.applicationBindingId}
    sessionId={sessionId} actionExecutionId={sessionId} reference={reference} launch={launch} onBack={() => {}} /></PlatformProvider>);
  const frame = host.querySelector("iframe")!;
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { source: window, origin: editorOrigin, data: { MessageId: "Edit_Notification" } }));
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "https://other.example.test", data: { MessageId: "Edit_Notification" } }));
  });
  expect(host.textContent).not.toContain("The editor reports changes");
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: editorOrigin, data: { MessageId: "Edit_Notification" } }));
    window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: editorOrigin, data: { MessageId: "SAVED" } }));
  });
  expect(host.textContent).toContain("This is not confirmation");
  expect(host.textContent).not.toContain("Save confirmed");
});

it("removes a launched frame after fresh origins revoke access and never recovers its ticket", async () => {
  const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  let body = session;
  const client = createBffClient({ send: async () => ({ status: 200, body }) });
  const host = await render(<PlatformProvider client={client} documentTheme="LIGHT"><ProtocolDocumentSurface bindingId={session.applicationBindingId}
    sessionId={sessionId} actionExecutionId={sessionId} reference={reference} launch={launch} onBack={() => {}} /></PlatformProvider>);
  body = { ...session, effectiveEditorOrigins: [] };
  await click(button(host, "Refresh"));
  expect(host.querySelector("iframe")).toBeNull();
  body = session;
  await click(button(host, "Refresh"));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("one-time launch cannot be recovered");
});

it("does not register a document write on unsupported hosts", async () => {
  const send = vi.fn(async () => ({ status: 200, body: session }));
  const host = await render(<PlatformProvider client={createBffClient({ send })}>
    <ProtocolDocumentAction bindingId={session.applicationBindingId} projectionGeneration={4} command={{ actionKey: "file_storage.open_view@v1", resourceId: reference.resourceId, resourceVersion: 1 }}
      selection={{ reference, actionVersion: 1 }} onBack={() => {}} />
  </PlatformProvider>);
  expect(host.textContent).toContain("unavailable in this host");
  expect(send).not.toHaveBeenCalled();
});

it("freezes the original request and refuses another operation during explicit UNKNOWN reconciliation", async () => {
  const requests: unknown[] = [];
  const client = createBffClient({ send: async (request) => {
    requests.push(request.body);
    if (requests.length === 1) return { status: 503, body: { class: "UNKNOWN", operationId } };
    return { status: 200, body: { operationId: sessionId, actionExecutionId: sessionId,
      actionKey: "file_storage.open_view@v1", gateState: "DENIED", dispatchState: "NOT_DISPATCHED", reason: "SCOPE_GUARD_FAILED" } };
  } });
  const host = await render(<PlatformProvider client={client} documentTheme="DARK" locale="en">
    <ProtocolDocumentAction bindingId={session.applicationBindingId} projectionGeneration={4} command={{ actionKey: "file_storage.open_view@v1", resourceId: reference.resourceId, resourceVersion: 3 }}
      selection={{ reference, actionVersion: 1 }} onBack={() => {}} />
  </PlatformProvider>);
  await click(button(host, "Confirm"));
  await settle();
  expect(requests).toHaveLength(1);
  await click(button(host, "Check the original request"));
  expect(requests[1]).toEqual(requests[0]);
  expect(host.textContent).toContain(operationId);
  expect(host.textContent).not.toContain("SCOPE_GUARD_FAILED");
});

it("takes the actual native menu reference only after origin/opener/generation checks, then requires confirmation", async () => {
  const native = document.createElement("iframe");
  document.body.append(native);
  const source = native.contentWindow!;
  vi.stubGlobal("opener", source);
  const ready = vi.spyOn(source, "postMessage").mockImplementation(() => {});
  const requests: { method: string; body?: unknown }[] = [];
  const nativeOrigin = "https://files.example.test";
  const bindingId = session.applicationBindingId;
  const client = createBffClient({ send: async (request) => {
    requests.push(request);
    return request.method === "GET" ? { status: 200, body: {
      bindingId, projectionGeneration: 4, origin: nativeOrigin, allowedOrigins: [nativeOrigin], url: `${nativeOrigin}/ui/`,
    } } : { status: 503, body: { class: "UNKNOWN", operationId } };
  } });
  try {
    const host = await render(<PlatformProvider client={client} documentTheme="DARK" locale="en">
      <ProtocolDocumentBridge bindingId={bindingId} onBack={() => {}} />
    </PlatformProvider>);
    expect(ready).toHaveBeenCalledWith(expect.objectContaining({ type: "kailo.document.ready", bindingId }), nativeOrigin);
    const challenge = ready.mock.calls.at(-1)?.[0];
    const selection = { bindingId, generation: 4, workspaceId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      reference, resourceVersion: 8, actionKey: "file_storage.open_view@v1", actionVersion: 1 };
    const data = { type: "kailo.document.selection", nonce: challenge.nonce, selection };
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { source: window, origin: nativeOrigin, data }));
      window.dispatchEvent(new MessageEvent("message", { source, origin: "https://other.example.test", data }));
      window.dispatchEvent(new MessageEvent("message", { source, origin: nativeOrigin, data: { ...data, nonce: "late" } }));
      window.dispatchEvent(new MessageEvent("message", { source, origin: nativeOrigin, data: { ...data,
        selection: { ...selection, generation: 3 } } }));
    });
    expect(host.textContent).not.toContain("Open this exact file revision");
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    await act(async () => window.dispatchEvent(new MessageEvent("message", { source, origin: nativeOrigin, data })));
    expect(host.textContent).toContain("Open this exact file revision");
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    await click(button(host, "Confirm"));
    expect(requests.filter((request) => request.method === "POST")).toEqual([
      expect.objectContaining({ body: expect.objectContaining({ resourceId: reference.resourceId, resourceVersion: 8,
        workspaceId: selection.workspaceId, protocolSessionOpen: { reference, actionVersion: 1, theme: "DARK", locale: "en", applicationBindingId: bindingId, projectionGeneration: 4 } }) }),
    ]);
  } finally { native.remove(); }
});
