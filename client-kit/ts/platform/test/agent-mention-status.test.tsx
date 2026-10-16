// DD-121, V-SCN-105/106: the sender-only Agent @mention outcome line under the own message row.
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentMentionOutcomeState, ReasonCode } from "@client-kit/contracts";
import { setLocale } from "../src/i18n";
import { AgentMentionStatus, MessageRowSurface, agentMentionDenial, type AgentMentionStatusEntry, type TimelineMessage } from "../src/react/messages";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { button, click, render } from "./render";

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocale("en");
});

const entry = (state: AgentMentionStatusEntry["state"], extra: Partial<AgentMentionStatusEntry> = {}): AgentMentionStatusEntry =>
  ({ key: "installation-a", name: "Research", state, ...extra });

it("maps DENIED reasons to renewal, admin grant or retry-later", () => {
  expect(agentMentionDenial(ReasonCode.PermissionDenied, true)).toBe("delegation");
  // Core uses PERMISSION_DENIED for missing execute use as well; without use it needs an admin.
  expect(agentMentionDenial(ReasonCode.PermissionDenied, false)).toBe("use");
  expect(agentMentionDenial(ReasonCode.CapabilityBlocked, true)).toBe("use");
  expect(agentMentionDenial(ReasonCode.ScopeGuardFailed, true)).toBe("use");
  expect(agentMentionDenial(ReasonCode.QuotaExhausted, true)).toBe("unavailable");
  expect(agentMentionDenial(ReasonCode.DependencyUnavailable, true)).toBe("unavailable");
  expect(agentMentionDenial(undefined, true)).toBe("unavailable");
});

it("shows processing for PENDING/RUNNING and nothing once REPLIED", async () => {
  const pending = await render(<AgentMentionStatus entries={[entry("PENDING")]} />);
  expect(pending.textContent).toBe("Research is working on it…");
  expect(pending.querySelector('[data-state="running"]')?.getAttribute("role")).toBe("status");
  const running = await render(<AgentMentionStatus entries={[entry(AgentMentionOutcomeState.Running)]} />);
  expect(running.textContent).toBe("Research is working on it…");
  const replied = await render(<AgentMentionStatus entries={[entry(AgentMentionOutcomeState.Replied)]} />);
  expect(replied.innerHTML).toBe("");
  const failed = await render(<AgentMentionStatus entries={[entry(AgentMentionOutcomeState.Failed)]} />);
  expect(failed.textContent).toBe("Research could not process this message.");
});

it("offers delegation renewal only for a delegable PERMISSION_DENIED and never retries itself", async () => {
  const onRenew = vi.fn();
  const host = await render(<AgentMentionStatus onRenewDelegation={onRenew} entries={[
    entry(AgentMentionOutcomeState.Denied, { reasonCode: ReasonCode.PermissionDenied, delegable: true }),
    entry(AgentMentionOutcomeState.Denied, { key: "installation-b", name: "Writer", reasonCode: ReasonCode.PermissionDenied, delegable: false }),
    entry(AgentMentionOutcomeState.Denied, { key: "installation-c", name: "Coder", reasonCode: ReasonCode.RateLimited, delegable: true }),
  ]} />);
  expect(host.textContent).toContain("Research did not respond: your delegation to it has expired or was never granted.");
  expect(host.textContent).toContain("Writer did not respond: an admin needs to grant you use of it.");
  expect(host.textContent).toContain("Coder did not respond: temporarily unavailable. Try again later.");
  expect(host.querySelectorAll("button")).toHaveLength(1);
  await click(button(host, "Renew delegation"));
  expect(onRenew).toHaveBeenCalledExactlyOnceWith("installation-a");
  // Without a host navigation there is no dead action.
  const bare = await render(<AgentMentionStatus entries={[entry(AgentMentionOutcomeState.Denied, { reasonCode: ReasonCode.PermissionDenied, delegable: true })]} />);
  expect(bare.querySelector("button")).toBeNull();
});

it("renders the Chinese copy from the shared catalog", async () => {
  await act(async () => setLocale("zh-CN"));
  const host = await render(<AgentMentionStatus onRenewDelegation={() => {}} entries={[
    entry("PENDING", { key: "a", name: "研究助理" }),
    entry(AgentMentionOutcomeState.Denied, { key: "b", name: "研究助理", reasonCode: ReasonCode.PermissionDenied, delegable: true }),
    entry(AgentMentionOutcomeState.Denied, { key: "c", name: "写作助理", reasonCode: ReasonCode.CapabilityBlocked }),
  ]} />);
  expect(host.textContent).toContain("研究助理 正在处理…");
  expect(host.textContent).toContain("研究助理 未响应：你对它的委托已过期或尚未委托");
  expect(host.textContent).toContain("续签委托");
  expect(host.textContent).toContain("写作助理 未响应：需要管理员授予使用权");
});

it("mounts the status under the message body only when the host provides it", async () => {
  const message: TimelineMessage = { id: "message", pubkey: "author", author: "Alice", body: "Hello", createdAt: 1770000000, depth: 0, time: "", tags: [] };
  const plain = await render(<TooltipProvider><MessageRowSurface message={message} renderBody={(className) => <p className={className}>Hello</p>} /></TooltipProvider>);
  expect(plain.querySelector('[data-testid="agent-mention-status"]')).toBeNull();
  const withStatus = await render(<TooltipProvider><MessageRowSurface message={message} renderBody={(className) => <p className={className}>Hello</p>}
    agentMentionStatus={<AgentMentionStatus entries={[entry("PENDING")]} />} /></TooltipProvider>);
  const body = withStatus.querySelector('[data-testid="message-body"]');
  expect(body?.querySelector('[data-testid="agent-mention-status"]')?.textContent).toBe("Research is working on it…");
});
