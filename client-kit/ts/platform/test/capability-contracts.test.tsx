import { createHash } from "node:crypto";
import { act, useState } from "react";
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
const dialog = () => window.document.querySelector<HTMLElement>("[data-testid=capability-contract-dialog]");
async function rowAction(host: HTMLElement, label: string) {
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-label^="Actions for"]');
  if (!trigger) throw new Error("no row menu");
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  const item = [...window.document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === label);
  if (!item) throw new Error(`no menu item ${label}`);
  await click(item);
}
async function openRegistration(host: HTMLElement) {
  await settle();
  await click(button(host, "Register contract"));
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
    await settle();
    expect(host.textContent).toContain("knowledge");
    expect(host.textContent).toContain("Active contract");
    expect(host.textContent).toContain("Built in");
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("1 total");
    // Digests are technical details of the row, not columns of the table.
    expect(host.querySelector("table")?.textContent).not.toContain("a".repeat(64));
    await click(host.querySelector<HTMLElement>("tbody tr")!);
    expect(host.querySelector(`[data-testid=capability-contract-detail] [title="${"a".repeat(64)}"]`)).not.toBeNull();
    expect([...host.querySelectorAll("button")].some((node) => node.textContent === "Request contract approval")).toBe(false);
    expect(t.send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });

  it("previews and freezes the actual registration document; does not invent caller scope or mark a component ready", async () => {
    const t = transport((request) => request.method === "POST" ? { status: 200, body: receipt(request) } : { status: 200, body: page });
    const host = await mount(t);
    await openRegistration(host);
    await type(host.querySelector("textarea")!, JSON.stringify(document));
    await click(button(host, "Review contract registration"));
    expect(t.send.mock.calls.filter(([r]) => r.method === "POST")).toHaveLength(0);
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    expect(dialog()!.textContent).toContain("Registration creates a draft only");
    expect(dialog()!.querySelector("pre")).toBeNull();
    await click(button(dialog()!, "Show raw data"));
    expect(dialog()!.querySelector("pre")!.textContent).toContain(document.schemaDocuments[0]!.replaceAll('"', '\\"'));
    await click(button(dialog()!, "Register"));
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
    await settle();
    await rowAction(host, "Request contract approval");
    expect(dialog()!.textContent).toContain("Another organization admin must approve it");
    await click(button(dialog()!, "Request approval"));
    expect(t.send.mock.calls.find(([r]) => r.method === "POST")![0].body).toEqual({
      actionKey: "capability_contract.approve", idempotencyKey: expect.any(String),
      capabilityContractRef: { categoryKey: draft.categoryKey, contractVersion: draft.contractVersion },
    });
    expect(host.textContent).toContain("Waiting for another admin to approve.");
    expect(host.querySelector('[title="catalog-approval"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Active contract");
  });

  it("unknown deprecation survives denied directory reads and retry refusal with the exact same command", async () => {
    let writes = 0;
    const t = transport((request) => request.method === "POST"
      ? ++writes === 1 ? { status: 202, body: receipt(request, "ALLOWED", "UNKNOWN") } : { status: 403, body: undefined }
      : writes ? { status: 403, body: undefined } : { status: 200, body: activePage });
    const host = await mount(t);
    await settle();
    await rowAction(host, "Deprecate");
    expect(dialog()!.textContent).toContain("Existing connections keep working");
    expect(button(dialog()!, "Deprecate").className).toContain("bg-danger");
    await click(button(dialog()!, "Deprecate"));
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!);
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
    await settle();
    await rowAction(host, "Deprecate");
    await click(button(dialog()!, "Deprecate"));
    await click(button(host, "Re-check same request"));
    expect(host.textContent).toContain("Outcome is not confirmed.");
    expect(button(host, "Re-check same request")).toBeTruthy();
  });

  it.each([[403, "permission-state", "Only Catalog admins can manage capability contracts."], [404, "empty-state", "Not available here"]] as const)(
    "does not render a Catalog entry for initial HTTP %s but explains why", async (status, state, text) => {
    const t = transport(() => ({ status, body: undefined }));
    const host = await mount(t);
    await settle();
    expect(host.querySelector("[data-testid=capability-contracts]")).toBeNull();
    expect(host.querySelector(`[data-testid=${state}]`)?.textContent).toContain(text);
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
    await settle();
    expect(host.querySelector("[data-testid=error-state]")).not.toBeNull();
    expect(host.querySelector("textarea")).toBeNull();
    expect([...host.querySelectorAll("button")].some((node) => node.textContent === "Request contract approval")).toBe(false);
    expect(t.send.mock.calls.some(([r]) => r.method === "POST")).toBe(false);
  });

  it.each(["{", "null", JSON.stringify({ categoryKey: "INCOMPLETE", contractVersion: 1 }),
    JSON.stringify({ ...document, schemaDocuments: ["not-json"] }),
  ])("malformed registration never prepares a governed command (%s)", async (raw) => {
    const t = transport(() => ({ status: 200, body: page }));
    const host = await mount(t);
    await openRegistration(host);
    await type(host.querySelector("textarea")!, raw);
    await click(button(host, "Review contract registration"));
    expect(host.textContent).toContain("lacks required contract fields");
    expect(dialog()).toBeNull();
    expect(t.send.mock.calls.some(([r]) => r.method === "POST")).toBe(false);
  });

  it("reads the paged Catalog to its end by the BFF cursor and keeps a frozen target across refresh", async () => {
    const second = { ...activePage.contracts[0]!, categoryKey: "files" };
    const t = transport((request) => ({ status: 200, body: request.path.endsWith("offset=3")
      ? { contracts: [second], canRegister: false } : { ...activePage, nextOffset: 3 } }));
    const host = await mount(t);
    await settle();
    expect(t.send.mock.calls.map(([r]) => r.path)).toEqual(["/api/v1/platform/capability-contracts?offset=0", "/api/v1/platform/capability-contracts?offset=3"]);
    expect(host.querySelector("[data-testid=list-total]")?.textContent).toBe("2 total");
    await rowAction(host, "Deprecate");
    await click(button(dialog()!, "Cancel"));
    expect(dialog()).toBeNull();
    await rowAction(host, "Deprecate");
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!);
    expect(dialog()!.textContent).toContain(draft.categoryKey);
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
    await settle();
    await rowAction(host, "Deprecate");
    await click(button(dialog()!, "Deprecate"));
    await click(button(host, "Switch Catalog"));
    await settle();
    expect(host.querySelector("[data-testid=capability-contracts]")).toBeNull();
    expect(host.textContent).not.toContain("capability-op");
    expect(second.send.mock.calls.some(([r]) => r.method === "POST")).toBe(false);
  });
});
