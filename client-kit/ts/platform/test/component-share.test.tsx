// DD-164(4): the component asks, Kailo shares (V-SCN-274, V-SCN-275).
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { ComponentShareDialog, normalizedGrants } from "../src/react/component-share-dialog";
import { embedMessage } from "../src/react/native-embed-host";
import { DirectoryReceiptStatus, failureCounts } from "../src/react/directory-receipt-status";
import { resolveNativeOrigin } from "../src/react/native-application-entries";
import type { BffRequest } from "../src/transport";
import { render, settle, until } from "./render";

const INTENT = "0b7c2f0e-3a4b-4c5d-8e9f-0123456789ab";
const OWNER = "10000000-0000-4000-8000-000000000001";
const QA3 = "10000000-0000-4000-8000-000000000003";
const WS = "20000000-0000-4000-8000-000000000001";
const intent = (extra: object = {}) => ({
  intentId: INTENT, bindingId: "30000000-0000-4000-8000-000000000001", nativePageCategory: "file_storage", nativeType: "folder",
  name: "华东区周报", allowedSubjects: ["PRINCIPAL", "WORKSPACE", "TENANT"], grants: [], canShare: true,
  ownerPrincipalId: OWNER, expiresAt: "2026-10-30T05:00:00Z", ...extra });

function host(routes: Record<string, (request: BffRequest) => { status: number; body?: unknown }>) {
  const requests: BffRequest[] = [];
  const client = createBffClient({ send: async (request) => {
    requests.push(request);
    const key = `${request.method} ${request.path.split("?")[0]}`;
    const route = routes[key];
    return route ? route(request) as never : { status: 404, body: { class: "PERMANENT", reason: "NOT_FOUND" } } as never;
  } });
  return { client, requests };
}

const people = {
  "GET /api/v1/conversation-participants": () => ({ status: 200, body: { items: [
    { principalId: OWNER, displayName: "kailo-qa-1", pubkeys: [] }, { principalId: QA3, displayName: "kailo-qa-3", pubkeys: [] }], maxParticipants: 9 } }),
  "GET /api/v1/workspaces": () => ({ status: 200, body: [{ id: WS, name: "华东销售", isMember: true }] }),
};

afterEach(() => vi.restoreAllMocks());

describe("wire v1 share", () => {
  it("accepts only a UUID intent from the component", () => {
    expect(embedMessage({ source: "kailo-embed", version: 1, type: "share", intentId: INTENT.toUpperCase() })).toEqual({ type: "share", intentId: INTENT });
    for (const intentId of [undefined, "", "x", `${INTENT}x`, 7])
      expect(embedMessage({ source: "kailo-embed", version: 1, type: "share", intentId })).toBeNull();
  });

  it("normalizes grants: one per subject, everyone read-only, never the owner", () => {
    expect(normalizedGrants([
      { subject: { kind: "PRINCIPAL", principalId: OWNER }, access: "WRITE" },
      { subject: { kind: "TENANT" }, access: "WRITE" },
      { subject: { kind: "WORKSPACE", workspaceId: WS }, access: "READ" },
      { subject: { kind: "WORKSPACE", workspaceId: WS }, access: "WRITE" },
    ] as never, OWNER)).toEqual([{ subject: { kind: "TENANT" }, access: "READ" }, { subject: { kind: "WORKSPACE", workspaceId: WS }, access: "WRITE" }]);
  });
});

describe("ComponentShareDialog", () => {
  it("shows a definite state for an expired or foreign intent", async () => {
    const { client } = host({ ...people });
    const view = await render(<PlatformProvider client={client} locale="zh-CN"><ComponentShareDialog intentId={INTENT} onClose={() => {}} /></PlatformProvider>);
    await until(() => !!document.querySelector('[data-testid="component-share-unavailable"]'), "expired state");
    expect(document.body.textContent).toContain("这次分享请求已失效");
    expect(view).toBeTruthy();
  });

  it("submits component.share.set with the complete grant list", async () => {
    const submitted: unknown[] = [];
    const { client } = host({ ...people,
      [`GET /api/v1/component-shares/intents/${INTENT}`]: () => ({ status: 200, body: intent({ grants: [{ subject: { kind: "TENANT" }, access: "READ" }] }) }),
      "POST /api/v1/actions": (request) => { submitted.push(request.body); return { status: 200, body: {
        actionExecutionId: "a", actionKey: "component.share.set", operationId: "o", gateState: "ALLOWED", dispatchState: "DISPATCHED" } }; },
    });
    const onClose = vi.fn();
    await render(<PlatformProvider client={client} locale="zh-CN"><ComponentShareDialog intentId={INTENT} onClose={onClose} /></PlatformProvider>);
    await until(() => !!document.querySelector('[data-testid="component-share-add"]'), "editor");
    await settle();
    expect(document.body.textContent).toContain("分享「华东区周报」");
    expect(document.body.textContent).toContain("组织内全体成员");
    const [kind, target, access] = [...document.querySelectorAll<HTMLSelectElement>('[data-testid="component-share-add"] select')];
    expect([...target!.options].map((option) => option.textContent)).toEqual(["请选择…", "kailo-qa-3"]); // never the owner
    await act(async () => { target!.value = QA3; target!.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { access!.value = "WRITE"; access!.dispatchEvent(new Event("change", { bubbles: true })); });
    const add = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="component-share-add"] button')][0]!;
    await act(async () => add.click());
    expect(kind).toBeTruthy();
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="component-share-save"]')!.click());
    await settle();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ actionKey: "component.share.set", componentShareSet: { intentId: INTENT,
      grants: [{ subject: { kind: "TENANT" }, access: "READ" }, { subject: { kind: "PRINCIPAL", principalId: QA3 }, access: "WRITE" }] } });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the same request for a retry when the outcome is unknown, and is read-only without share", async () => {
    const keys: string[] = [];
    const { client } = host({ ...people,
      [`GET /api/v1/component-shares/intents/${INTENT}`]: () => ({ status: 200, body: intent({ resourceId: "40000000-0000-4000-8000-000000000001", resourceVersion: 3 }) }),
      "POST /api/v1/actions": (request) => { keys.push((request.body as { idempotencyKey: string }).idempotencyKey); return { status: 200, body: {
        actionExecutionId: "a", actionKey: "component.share.set", operationId: "o", gateState: "ALLOWED", dispatchState: "UNKNOWN" } }; },
    });
    await render(<PlatformProvider client={client} locale="zh-CN"><ComponentShareDialog intentId={INTENT} onClose={() => {}} /></PlatformProvider>);
    await until(() => !!document.querySelector('[data-testid="component-share-save"]'), "editor");
    const save = () => document.querySelector<HTMLButtonElement>('[data-testid="component-share-save"]')!;
    await act(async () => save().click());
    await until(() => !!document.querySelector('[data-testid="component-share-unknown"]'), "unknown");
    await act(async () => save().click());
    await settle();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("offers no editing to a member without share", async () => {
    const { client } = host({ ...people, [`GET /api/v1/component-shares/intents/${INTENT}`]: () => ({ status: 200, body: intent({ canShare: false }) }) });
    await render(<PlatformProvider client={client} locale="en"><ComponentShareDialog intentId={INTENT} onClose={() => {}} /></PlatformProvider>);
    await until(() => !!document.querySelector('[data-testid="component-share-read-only"]'), "read-only");
    expect(document.querySelector('[data-testid="component-share-add"]')).toBeNull();
    expect(document.querySelector('[data-testid="component-share-save"]')).toBeNull();
  });
});

describe("directory receipts and the open route", () => {
  it("counts failures per directory part and shows the sync state", async () => {
    expect(failureCounts({ bindingId: "b", state: "FAILED", failures: [
      { kind: "SHARE", ref: "r1", reasonCode: "NATIVE_OBJECT_MISSING" }, { kind: "MEMBER", ref: "m", reasonCode: "X" }, { kind: "SHARE", ref: "r2", reasonCode: "Y" }] } as never))
      .toEqual([["MEMBER", 1], ["SHARE", 2]]);
    const { client } = host({ "GET /api/v1/application-bindings/b1/directory-receipt": () => ({ status: 200, body: { bindingId: "b1", state: "NOT_CONVERGED" } }) });
    await render(<PlatformProvider client={client} locale="zh-CN"><DirectoryReceiptStatus bindingId="b1" /></PlatformProvider>);
    await until(() => !!document.querySelector('[data-testid="directory-receipt-status"]'), "receipt");
    expect(document.body.textContent).toContain("成员与分享未同步");
  });

  it("resolves a component origin only among pages this user may open", async () => {
    const binding = (id: string) => ({ bindingId: id, tenantId: "t", componentReleaseId: "r", componentTypeKey: "cells", state: "ACTIVE", version: 1,
      activeProjectionGeneration: 1, capabilityCategories: [], canDisable: false, hasNativePage: true });
    const { client } = host({
      "GET /api/v1/application-bindings": (request) => ({ status: 200, body: request.path.includes("workspaceId")
        ? { bindings: [{ ...binding("b2"), workspaceId: WS }], canCreate: false } : { bindings: [binding("b1")], canCreate: false } }),
      "GET /api/v1/application-bindings/b1/native-page": () => ({ status: 200, body: { bindingId: "b1", origin: "http://192.168.0.193:58094" } }),
      "GET /api/v1/application-bindings/b2/native-page": () => ({ status: 200, body: { bindingId: "b2", origin: "http://192.168.0.193:58092" } }),
      "GET /api/v1/workspaces": () => ({ status: 200, body: [{ id: WS, name: "w", isMember: true }] }),
    });
    expect(await resolveNativeOrigin(client, "http://192.168.0.193:58094")).toEqual({ bindingId: "b1" });
    expect(await resolveNativeOrigin(client, "http://192.168.0.193:58092")).toEqual({ bindingId: "b2", workspaceId: WS });
    expect(await resolveNativeOrigin(client, "http://192.168.0.193:58095")).toBeNull();
    expect(await resolveNativeOrigin(client, "http://192.168.0.193:58092/x")).toBeNull();
  });
});
