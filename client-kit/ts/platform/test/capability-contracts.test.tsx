import { createHash } from "node:crypto";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { CapabilityContractsPanel } from "../src/react/capability-contracts";
import { PlatformProvider } from "../src/react/context";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { TransportError } from "../src/transport";
import { button, click, render, settle, type } from "./render";

const draft = { categoryKey: "review_fixture", contractVersion: 1, status: "DRAFT",
  schemaSetDigest: "a".repeat(64), conformanceSuiteDigest: "b".repeat(64),
  registeredByActionExecutionId: "registration-ae", canApprove: true, canDeprecate: false };
const page = { contracts: [draft], canRegister: true };
const activePage = { ...page, contracts: [{ ...draft, status: "ACTIVE", canApprove: false, canDeprecate: true }] };
const schemaDocument = JSON.stringify({ additionalProperties: false, properties: {}, type: "object" });
const schemaDigest = createHash("sha256").update(schemaDocument).digest("hex");
const document = { categoryKey: draft.categoryKey, contractVersion: draft.contractVersion,
  resourceTypeFamily: [{ typeKey: "review_fixture.document", kind: "document" }],
  operationContracts: [{ contractKey: "review_fixture.read@v1", surface: "ACTION", permission: "read",
    targetType: "RESOURCE", inputSchemaDigest: schemaDigest, outputSchemaDigest: schemaDigest }],
  contentReferenceSemantics: { nativeObjectRefRule: "native-id", nativeRevisionRule: "native-revision", authorizationTargetRule: "resource" },
  requiredDeclarations: ["OBSERVE"], protocolSessionKinds: [],
  schemaDocuments: [schemaDocument],
  testVectorsJson: JSON.stringify([{ scenario: "read", expected: "refused" }]) };
function transport(route: (request: BffRequest) => BffReply | Promise<BffReply>): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (request: BffRequest) => route(request)) };
}
function mount(t: BffTransport) {
  return render(<PlatformProvider client={createBffClient(t)} locale="en"><CapabilityContractsPanel /></PlatformProvider>);
}
function receipt(request: BffRequest, gateState = "ALLOWED", dispatchState = "DISPATCHED") {
  return { actionKey: (request.body as { actionKey: string }).actionKey, actionExecutionId: "capability-ae",
    operationId: "capability-op", gateState, dispatchState };
}

describe("shared Catalog capability contract management", () => {
  it("shows a built-in seed without fabricating a human registration or approval", async () => {
    const { registeredByActionExecutionId: _, ...seed } = activePage.contracts[0]!;
    const t = transport(() => ({ status: 200, body: { ...activePage,
      contracts: [{ ...seed, categoryKey: "knowledge", bootstrapActionExecutionId: "bootstrap-ae" }] } }));
    const host = await mount(t);
    expect(host.textContent).toContain("knowledge");
    expect(host.textContent).toContain("Active contract");
    expect([...host.querySelectorAll("button")].some((node) => node.textContent === "Request contract approval")).toBe(false);
    expect(t.send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });

  it("previews and freezes the actual registration document; does not invent caller scope or mark a component ready", async () => {
    const t = transport((request) => request.method === "POST" ? { status: 200, body: receipt(request) } : { status: 200, body: page });
    const host = await mount(t);
    await type(host.querySelector("textarea")!, JSON.stringify(document));
    await click(button(host, "Review contract registration"));
    expect(t.send.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(0);
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    expect(host.textContent).toContain("Registration creates a draft only");
    expect(host.querySelector("pre")!.textContent).toContain(document.schemaDocuments[0]!.replaceAll('"', '\\"'));
    await click(button(host, "Submit governed request"));
    expect(t.send.mock.calls.find(([r]) => r.method === "POST")![0].body).toEqual({
      actionKey: "capability_contract.register", idempotencyKey: expect.any(String), explicitConfirmation: true,
      capabilityContractRegistration: document,
    });
    expect(host.textContent).toContain("capability-op");
    expect(host.textContent).not.toContain("Active contract");
    expect(host.querySelector("textarea")!.value).toBe("");
  });

  it("approval submission uses the exact natural key and waits for a different administrator", async () => {
    const t = transport((request) => request.method === "POST" ? { status: 202,
      body: { ...receipt(request, "WAITING", "NOT_DISPATCHED"), approvalWorkflowId: "catalog-approval" } } : { status: 200, body: page });
    const host = await mount(t);
    await click(button(host, "Request contract approval"));
    expect(host.textContent).toContain("Another Catalog tenant administrator must approve");
    await click(button(host, "Submit governed request"));
    expect(t.send.mock.calls.find(([r]) => r.method === "POST")![0].body).toEqual({
      actionKey: "capability_contract.approve", idempotencyKey: expect.any(String),
      capabilityContractRef: { categoryKey: draft.categoryKey, contractVersion: draft.contractVersion },
    });
    expect(host.textContent).toContain("catalog-approval");
    expect(host.textContent).not.toContain("Active contract");
  });

  it("unknown deprecation survives denied directory reads and retry refusal with the exact same command", async () => {
    let writes = 0;
    const t = transport((request) => request.method === "POST"
      ? ++writes === 1 ? { status: 202, body: receipt(request, "ALLOWED", "UNKNOWN") } : { status: 403, body: undefined }
      : writes ? { status: 403, body: undefined } : { status: 200, body: activePage });
    const host = await mount(t);
    await click(button(host, "Review contract deprecation"));
    expect(host.textContent).toContain("Existing bindings remain available");
    await click(button(host, "Submit governed request"));
    await click(button(host, "Refresh"));
    await click(button(host, "Re-check same request"));
    const commands = t.send.mock.calls.filter(([r]) => r.method === "POST").map(([r]) => r.body);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[0]).toMatchObject({ actionKey: "capability_contract.deprecate", explicitConfirmation: true,
      capabilityContractRef: { categoryKey: draft.categoryKey, contractVersion: draft.contractVersion } });
    expect(host.textContent).toContain("Outcome is not confirmed.");
    expect(button(host, "Re-check same request")).toBeTruthy();
    expect([...host.querySelectorAll("button")].some((node) => node.textContent === "Cancel")).toBe(false);
  });

  it("does not discard a transport-unknown intent when the retry conflicts", async () => {
    let writes = 0;
    const t = transport((request) => {
      if (request.method !== "POST") return { status: 200, body: activePage };
      if (++writes === 1) throw new TransportError("no receipt");
      return { status: 409, body: undefined };
    });
    const host = await mount(t);
    await click(button(host, "Review contract deprecation"));
    await click(button(host, "Submit governed request"));
    await click(button(host, "Re-check same request"));
    expect(host.textContent).toContain("Outcome is not confirmed.");
    expect(button(host, "Re-check same request")).toBeTruthy();
  });

  it.each([403, 404])("does not render a Catalog entry for initial HTTP %s", async (status) => {
    const t = transport(() => ({ status, body: undefined }));
    const host = await mount(t);
    expect(host.querySelector("[data-testid=capability-contracts]")).toBeNull();
    expect(t.send.mock.calls.some(([r]) => r.method === "POST")).toBe(false);
  });

  it.each([
    { ...page, nextOffset: 0 },
    { ...page, contracts: [draft, draft] },
    { ...page, contracts: [{ ...draft, status: "UNKNOWN" }] },
    { ...page, contracts: [{ ...draft, schemaSetDigest: "unverified" }] },
    { ...page, contracts: [{ ...draft, status: "ACTIVE" }] },
  ])("unverified or contradictory Catalog metadata cannot create actions (%j)", async (body) => {
    const t = transport(() => ({ status: 200, body }));
    const host = await mount(t);
    expect(host.querySelector("textarea")).toBeNull();
    expect([...host.querySelectorAll("button")].some((node) => node.textContent === "Request contract approval")).toBe(false);
    expect(t.send.mock.calls.some(([r]) => r.method === "POST")).toBe(false);
  });

  it.each(["{", "null", JSON.stringify({ categoryKey: "INCOMPLETE", contractVersion: 1 }),
    JSON.stringify({ ...document, schemaDocuments: ["not-json"] }),
  ])("malformed registration never prepares a governed command (%s)", async (raw) => {
    const t = transport(() => ({ status: 200, body: page }));
    const host = await mount(t);
    await type(host.querySelector("textarea")!, raw);
    await click(button(host, "Review contract registration"));
    expect(host.textContent).toContain("lacks required contract fields");
    expect(host.querySelector("[role=group]")).toBeNull();
    expect(t.send.mock.calls.some(([r]) => r.method === "POST")).toBe(false);
  });

  it("paged metadata preserves a frozen target and follows only the BFF cursor", async () => {
    const t = transport((request) => ({ status: 200, body: request.path.endsWith("offset=3")
      ? { contracts: [], canRegister: false } : { ...activePage, nextOffset: 3 } }));
    const host = await mount(t);
    await click(button(host, "Review contract deprecation"));
    await click(button(host, "Next page"));
    expect(host.querySelector("[role=group]")!.textContent).toContain(draft.categoryKey);
    expect(t.send.mock.calls.some(([r]) => r.path === "/api/v1/platform/capability-contracts?offset=3")).toBe(true);
    expect(t.send.mock.calls.some(([r]) => r.method === "POST")).toBe(false);
  });

  it("an authenticated-client change cannot carry the original UNKNOWN command into another Catalog", async () => {
    const first = transport((request) => ({ status: 200, body: request.method === "POST" ? receipt(request, "ALLOWED", "UNKNOWN") : activePage }));
    const second = transport(() => ({ status: 403, body: undefined }));
    const clients = [createBffClient(first), createBffClient(second)];
    function Host() {
      const [index, setIndex] = useState(0);
      return <><button type="button" onClick={() => setIndex(1)}>Switch Catalog</button>
        <PlatformProvider client={clients[index]!} locale="en"><CapabilityContractsPanel /></PlatformProvider></>;
    }
    const host = await render(<Host />);
    await click(button(host, "Review contract deprecation"));
    await click(button(host, "Submit governed request"));
    await click(button(host, "Switch Catalog"));
    await settle();
    expect(host.querySelector("[data-testid=capability-contracts]")).toBeNull();
    expect(host.textContent).not.toContain("capability-op");
    expect(second.send.mock.calls.some(([r]) => r.method === "POST")).toBe(false);
  });
});
