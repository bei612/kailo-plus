import { act } from "react";
import type { AgentInstallationView } from "@client-kit/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { InstallationSessions } from "../src/react/agent-activity/InstallationSessions";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

const installation = { resourceId: "installation", workspaceId: "workspace" } as AgentInstallationView;
const session = { installationResourceId: "installation", workspaceId: "workspace", rootEventId: "root/event",
  projectionGeneration: 2, agentVersionAssetId: "version", runtimeThreadId: "native-thread", status: "ACTIVE",
  createdAt: "2026-10-10T00:00:00Z" };
const invocation = { invocationId: "invocation", actionExecutionId: "execution", runtimeTurnId: "native-turn",
  status: "RUNNING", cancelPending: false, canReadTask: true, createdAt: "2026-10-10T00:00:01Z", updatedAt: "2026-10-10T00:00:02Z" };
const sessionPath = "/api/v1/agent-installations/installation/sessions";
const invocationPath = "/api/v1/agent-installations/installation/invocations?rootEventId=root%2Fevent&projectionGeneration=2";
const execution = { actionExecutionId: "execution", operationId: "operation", actionKey: "agent.invoke", actionVersion: 1,
  targetId: "installation", workspaceId: "workspace", gateState: "ALLOWED", dispatchState: "DISPATCHED",
  taskStatus: "RUNNING", createdAt: invocation.createdAt };

async function setup(override: (request: BffRequest) => BffReply | undefined | Promise<BffReply | undefined> = () => undefined,
  locale: "en" | "zh-CN" = "en") {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    const response = await override(request);
    if (response) return response;
    if (request.path === sessionPath) return { status: 200, body: { sessions: [session] } };
    if (request.path === invocationPath) return { status: 200, body: { invocations: [invocation] } };
    if (request.path === "/api/v1/tasks/execution") return { status: 200, body: execution };
    return { status: 503, body: undefined };
  });
  const host = await render(<PlatformProvider client={createBffClient({ send })} locale={locale} currentPrincipalId="human">
    <InstallationSessions installation={installation} />
  </PlatformProvider>);
  await settle();
  return { host, send };
}
const invocations = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-testid="agent-session-invocations"]')!;
const sessionKey = (generation = session.projectionGeneration) => JSON.stringify([session.rootEventId, generation]);
// DD-170: a session is a table row (its time and state); the row opens its invocations.
async function openSession(host: HTMLElement, generation?: number) {
  const row = [...host.querySelectorAll<HTMLElement>("tr[data-row-key]")].find((node) => node.dataset.rowKey === sessionKey(generation));
  if (!row) throw new Error(`Missing session row: ${host.textContent}`);
  await click(row);
}

describe("Installation's admitted Session / Invocation records", () => {
  it.each(["en", "zh-CN"] as const)("uses the shared original header and real BFF generation reader in %s", async locale => {
    const { host, send } = await setup(undefined, locale);
    expect(host.querySelector("h3")?.textContent).toBe(locale === "en" ? "Sessions" : "会话");
    expect(host.querySelector("time")?.dateTime).toBe(session.createdAt);
    // The root event is an identifier, never the session's main text or a button label.
    expect([...host.querySelectorAll("button")].some((node) => node.textContent === session.rootEventId)).toBe(false);
    expect(host.textContent).toContain(locale === "en" ? "1 total" : "共 1 条");
    await openSession(host);
    expect(send).toHaveBeenCalledWith({ method: "GET", path: invocationPath });
    expect(invocations(host).textContent).toContain("native-thread");
    expect(invocations(host).textContent).toContain("native-turn");
    expect(invocations(host).textContent).toContain(locale === "en" ? "Running" : "运行中");
    expect(host.querySelector('[data-testid="bot-activity-composer-trigger"]')).toBeNull();
    expect(send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });

  it("follows the existing separately admitted action reader without resuming the runtime", async () => {
    const { host, send } = await setup();
    await openSession(host);
    await click(button(invocations(host), "Action execution"));
    expect(send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/tasks/execution" });
    expect(invocations(host).textContent).toContain("operation");
    expect(send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });

  it("continues an empty authorized-filtered invocation page using the opaque cursor", async () => {
    const { host, send } = await setup(request => {
      if (request.path === invocationPath) return { status: 200, body: { invocations: [], nextCursor: "opaque-next" } };
      if (request.path === `${invocationPath}&cursor=opaque-next`) return { status: 200, body: { invocations: [invocation] } };
    });
    await openSession(host);
    // DD-170 §16.2(3): the bounded read follows the opaque cursor to the end and counts the result.
    expect(send).toHaveBeenCalledWith({ method: "GET", path: `${invocationPath}&cursor=opaque-next` });
    expect(invocations(host).textContent).toContain("native-turn");
    expect(invocations(host).textContent).toContain("1 total");
  });

  it("reads every Session generation page and opens the chosen one without carrying the previous body", async () => {
    const { host, send } = await setup(request => {
      if (request.path === sessionPath) return { status: 200, body: { sessions: [session], nextCursor: "older" } };
      if (request.path === `${sessionPath}?cursor=older`) return { status: 200, body: { sessions: [{ ...session, projectionGeneration: 1 }] } };
      if (request.path.endsWith("rootEventId=root%2Fevent&projectionGeneration=1")) return { status: 200, body: { invocations: [] } };
    });
    expect(host.textContent).toContain("2 total");
    await openSession(host);
    expect(invocations(host).textContent).toContain("native-turn");
    await openSession(host, 1);
    expect(send).toHaveBeenCalledWith({ method: "GET", path: invocationPath.replace("Generation=2", "Generation=1") });
    expect(invocations(host).textContent).not.toContain("native-turn");
  });

  it.each(["COMPLETED", "FAILED"])("does not render %s as terminal when original task observation is unknown", async status => {
    const { host } = await setup(request => request.path === invocationPath ? { status: 200,
      body: { invocations: [{ ...invocation, status, observation: "EXTERNAL_RESULT_UNKNOWN" }] } } : undefined);
    await openSession(host);
    expect(invocations(host).textContent).toContain("The outcome is not known yet");
    expect(invocations(host).textContent).not.toContain(status === "COMPLETED" ? "Completed" : "Failed");
  });

  it("keeps cancellation requested distinct from a canceled outcome", async () => {
    const { host } = await setup(request => request.path === invocationPath ? { status: 200,
      body: { invocations: [{ ...invocation, status: "CANCELED", cancelPending: true }] } } : undefined);
    await openSession(host);
    expect(invocations(host).textContent).toContain("Cancellation requested; outcome not confirmed");
    expect(invocations(host).textContent).not.toContain("Canceled");
  });

  it("keeps UNKNOWN ahead of an outstanding cancellation request", async () => {
    const { host } = await setup(request => request.path === invocationPath ? { status: 200,
      body: { invocations: [{ ...invocation, status: "UNKNOWN", cancelPending: true }] } } : undefined);
    await openSession(host);
    expect(invocations(host).textContent).toContain("Unknown");
    expect(invocations(host).textContent).not.toContain("Cancellation requested");
  });

  it("shows an audit-only execution reference without offering an unreadable task button", async () => {
    const { host, send } = await setup(request => request.path === invocationPath ? { status: 200,
      body: { invocations: [{ ...invocation, canReadTask: false }] } } : undefined);
    await openSession(host);
    expect(invocations(host).textContent).toContain("execution");
    expect([...invocations(host).querySelectorAll("button")].some(item => item.textContent === "Action execution")).toBe(false);
    expect(send.mock.calls.some(([request]) => request.path.startsWith("/api/v1/tasks/"))).toBe(false);
  });

  it.each([{ workspaceId: "another" }, { installationResourceId: "another" }, { status: "NEW_UNKNOWN_STATE" },
    { createdAt: "not-a-time" }])("rejects an invalid or cross-scope Session record %j", async change => {
    const { host, send } = await setup(request => request.path === sessionPath ? { status: 200,
      body: { sessions: [{ ...session, ...change }] } } : undefined);
    expect(host.querySelector('[data-testid="error-state"]')).not.toBeNull();
    expect(host.querySelector(`[title="${session.rootEventId}"]`)).toBeNull();
    expect(send.mock.calls).toHaveLength(1);
  });

  it.each([{ status: "FUTURE_STATE" }, { observation: "FUTURE_REASON" }, { runtimeTurnId: "" }])("rejects invalid Invocation records %j", async change => {
    const { host } = await setup(request => request.path === invocationPath ? { status: 200,
      body: { invocations: [{ ...invocation, ...change }] } } : undefined);
    await openSession(host);
    expect(invocations(host).querySelector('[data-testid="error-state"]')).not.toBeNull();
    expect(invocations(host).textContent).not.toContain("native-turn");
  });

  it("clears previously visible records on foreground re-admission refusal", async () => {
    let refused = false;
    const { host } = await setup(request => refused && request.path.startsWith(sessionPath) ?
      { status: 403, body: { reason: "PERMISSION_DENIED" } } : undefined);
    await openSession(host);
    refused = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    await settle();
    expect(host.querySelector('[data-testid="permission-state"]')).not.toBeNull();
    expect(host.textContent).not.toContain("native-thread");
    expect(host.textContent).not.toContain("No sessions recorded");
  });

  it("refuses repeated cursors rather than looping through the same page", async () => {
    const { host, send } = await setup(request => request.path.startsWith(sessionPath) ?
      { status: 200, body: { sessions: [session], nextCursor: "repeat" } } : undefined);
    expect(host.querySelector('[data-testid="error-state"]')).not.toBeNull();
    expect(host.querySelector(`[title="${session.rootEventId}"]`)).toBeNull();
    expect(send.mock.calls.filter(([request]) => request.path.startsWith(sessionPath))).toHaveLength(2);
  });
});
