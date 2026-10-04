import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { ComponentReleasesPanel } from "../src/react/component-releases";
import { PlatformProvider } from "../src/react/context";
import { type BffReply, type BffRequest, TransportError } from "../src/transport";
import { button, click, render, type } from "./render";

const manifest = '{"id":"release-fixture","exact":9007199254740993}';
const componentPackage = '{"manifestDigest":"fixture"}';
const bindingSchema = "true";
const pending = { actionKey: "component_release.register", actionExecutionId: "registration-action",
  operationId: "registration-operation", gateState: "ALLOWED", dispatchState: "DISPATCHED", workflowId: "registration-workflow" };

async function mount(route: (request: BffRequest) => BffReply | Promise<BffReply>) {
  const send = vi.fn(async (request: BffRequest) => route(request));
  const host = await render(<PlatformProvider client={createBffClient({ send })} locale="en"><ComponentReleasesPanel /></PlatformProvider>);
  return { host, send };
}

async function prepare(host: HTMLElement) {
  const inputs = host.querySelectorAll("textarea");
  expect(inputs.length).toBe(3);
  const [manifestInput, packageInput, schemaInput] = inputs;
  if (!manifestInput || !packageInput || !schemaInput) throw new Error("registration form is absent");
  await type(manifestInput, manifest); await type(packageInput, componentPackage); await type(schemaInput, bindingSchema);
  await click(button(host, "Review release registration"));
}

describe("shared ComponentRelease registration", () => {
  it("sends exact source documents through the original governed Action and does not call dispatch success REGISTERED", async () => {
    const { host, send } = await mount((request) => request.method === "GET"
      ? { status: 200, body: { releases: [], canRegister: true } }
      : { status: 200, body: pending });
    await prepare(host);
    expect(send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
    await click(button(host, "Submit governed request"));
    const writes = send.mock.calls.filter(([request]) => request.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toMatchObject({ path: "/api/v1/actions", body: { actionKey: "component_release.register",
      explicitConfirmation: true, componentReleaseRegistration: { manifestJson: manifest,
        packageJson: componentPackage, bindingConfigSchemaJson: bindingSchema } } });
    expect(host.textContent).toContain(pending.workflowId);
    expect(host.textContent).toContain("No registered component releases");
    expect(button(host, "View registration task")).toBeTruthy();
    expect([...host.querySelectorAll("button")].some((node) => /Approve|Revoke|Activate/.test(node.textContent ?? ""))).toBe(false);
  });

  it("keeps the original idempotency key and documents after an uncertain write and later read refusal", async () => {
    let writes = 0;
    const { host, send } = await mount((request) => {
      if (request.method === "GET") return writes ? { status: 403, body: {} } : { status: 200, body: { releases: [], canRegister: true } };
      writes++;
      if (writes === 1) throw new TransportError("lost response");
      return { status: 200, body: pending };
    });
    await prepare(host); await click(button(host, "Submit governed request"));
    expect([...host.querySelectorAll("button")].some((node) => node.textContent === "Cancel")).toBe(false);
    await click(button(host, "Re-check same request"));
    const requests = send.mock.calls.filter(([request]) => request.method === "POST").map(([request]) => request);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });

  it("does not expose a registration form on denied Catalog or absent canRegister fact", async () => {
    for (const reply of [{ status: 403, body: {} }, { status: 200, body: { releases: [] } },
      { status: 200, body: { releases: [], canRegister: false } }]) {
      const { host, send } = await mount(() => reply);
      expect(host.querySelector("textarea")).toBeNull();
      expect(send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
    }
  });

  it("does not turn a malformed dispatched receipt into success or a fresh registration", async () => {
    const { host } = await mount((request) => request.method === "GET"
      ? { status: 200, body: { releases: [], canRegister: true } }
      : { status: 200, body: { ...pending, workflowId: undefined } });
    await prepare(host); await click(button(host, "Submit governed request"));
    expect(host.textContent).not.toContain(pending.workflowId);
    expect(button(host, "Re-check same request")).toBeTruthy();
    expect(button(host, "Review release registration").disabled).toBe(true);
  });

  it("rejects unknown release states instead of rendering them as approved", async () => {
    const { host } = await mount(() => ({ status: 200, body: { canRegister: true, releases: [{
      componentReleaseId: "release-fixture", componentTypeKey: "fixture", version: "1.0.0", status: "NEW_UPSTREAM_STATUS",
      artifactDigest: "a".repeat(64), manifestDigest: "b".repeat(64), suiteDigest: "c".repeat(64),
      registeredByActionExecutionId: pending.actionExecutionId, operationId: pending.operationId, workflowId: pending.workflowId,
    }] } }));
    expect(host.textContent).not.toContain("NEW_UPSTREAM_STATUS");
    expect(host.querySelector("textarea")).toBeNull();
  });
});
