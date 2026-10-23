// DD-131(7)：原版“发送给成员”——READY 导出包作为普通附件经受治理的私聊打开与会话发布链发送（DD-81 同一意图）。
import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ConversationViewState, type ActionCommand, type ConversationView, type ExportPackageView } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { ConversationVisibilityProvider } from "../src/react/new-message";
import { SnapshotSendPanel, type SnapshotShareIntent } from "../src/react/agent-library/SnapshotSendPanel";
import { AgentSnapshotExportDialog, type SnapshotExportTarget } from "../src/react/agent-library/AgentSnapshotExportDialog";
import { sha256Hex } from "../src/react/agent-library/AgentSnapshotImportDialog";
import { BffError, TransportError, type BffReply, type BffRequest } from "../src/transport";
import { click, render, settle } from "./render";

const alice = { principalId: "alice", displayName: "Alice", pubkeys: ["a".repeat(64)] };
const bob = { principalId: "bob", displayName: "Bob", pubkeys: ["b".repeat(64)] };
const dm: ConversationView = { id: "dm-1", channelId: "native-dm", participantPrincipalIds: ["alice", "me"],
  state: ConversationViewState.Active, operationId: "op-open", version: 1 };
const pkg = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

function routes() {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path.startsWith("/api/v1/conversation-participants"))
      return { status: 200, body: { items: [alice, bob], maxParticipants: 9 } };
    if (request.path.startsWith("/api/v1/conversations")) return { status: 200, body: { items: [dm] } };
    if (request.path === "/api/v1/actions") return { status: 202, body: { actionKey: "conversation.open",
      actionExecutionId: "exec-open", operationId: "op-open", gateState: "ALLOWED", dispatchState: "DISPATCHED" } };
    return { status: 404, body: {} };
  });
  return send;
}
function opens(send: ReturnType<typeof routes>): ActionCommand[] {
  return send.mock.calls.map(([request]) => request as BffRequest)
    .filter((request) => request.path === "/api/v1/actions").map((request) => request.body as ActionCommand);
}

async function view() {
  return { byteSize: pkg.length, contentDigest: await sha256Hex(pkg), fileName: "Writer.agent.png", mediaType: "image/png" };
}

async function mount(props: { send: (intent: SnapshotShareIntent) => Promise<void>; dedupesRetry: boolean;
  readBytes?: () => Promise<Uint8Array>; onSent?: () => void }, transport = routes()) {
  const host = await render(<PlatformProvider client={createBffClient({ send: transport })} locale="en" currentPrincipalId="me">
    <ConversationVisibilityProvider value={{ read: async () => new Set<string>(), prepare: vi.fn() }}>
      <SnapshotSendPanel view={await view()} label="Writer" readBytes={props.readBytes ?? (async () => pkg)} send={props.send}
        dedupesRetry={props.dedupesRetry} onSent={props.onSent ?? (() => {})} testIdPrefix="share" />
    </ConversationVisibilityProvider>
  </PlatformProvider>);
  await settle();
  return { host, transport };
}

async function pick(name: string) {
  const input = document.querySelector<HTMLInputElement>("[data-testid=share-recipient-search]")!;
  await act(async () => input.focus());
  await settle();
  const option = [...document.querySelectorAll<HTMLButtonElement>("[data-testid=share-recipient-results] button")]
    .find((button) => button.textContent?.includes(name));
  if (!option) throw new Error(`no ${name} in ${document.querySelector("[data-testid=share-recipient-results]")?.textContent}`);
  await click(option);
}
const sendButton = () => document.querySelector<HTMLButtonElement>("[data-testid=share-send]");

describe("snapshot send to people", () => {
  it("opens the direct message through conversation.open and sends the verified package once as an attachment", async () => {
    const send = vi.fn(async (_intent: SnapshotShareIntent) => {});
    const onSent = vi.fn();
    const { transport } = await mount({ send, dedupesRetry: true, onSent });
    expect(sendButton()).toBeNull();
    await pick("Alice");
    expect(document.querySelector("[data-testid=share-recipient-chip-alice]")).not.toBeNull();
    await click(sendButton()!);
    expect(opens(transport)).toEqual([expect.objectContaining({ actionKey: "conversation.open",
      conversationOpen: { participantPrincipalIds: ["alice", "me"] } })]);
    expect(send).toHaveBeenCalledTimes(1);
    const intent = send.mock.calls[0]![0];
    expect(intent).toMatchObject({ conversation: dm, fileName: "Writer.agent.png", mediaType: "image/png", label: "Writer" });
    expect([...intent.bytes]).toEqual([...pkg]);
    expect(intent.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("retries an unknown publication only as the same message when the host deduplicates by its key", async () => {
    const send = vi.fn(async (_intent: SnapshotShareIntent) => {})
      .mockRejectedValueOnce(new TransportError("lost receipt"));
    const onSent = vi.fn();
    const { transport } = await mount({ send, dedupesRetry: true, onSent });
    await pick("Alice");
    await click(sendButton()!);
    expect(document.querySelector("[data-testid=share-send-unknown]")?.textContent).toContain("never a second copy");
    expect(onSent).not.toHaveBeenCalled();
    // The uncertain send owns its recipients.
    expect(document.querySelector<HTMLInputElement>("[data-testid=share-recipient-search]")!.disabled).toBe(true);
    await click(sendButton()!);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].idempotencyKey).toBe(send.mock.calls[0]![0].idempotencyKey);
    expect(opens(transport)).toHaveLength(1);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("never resends an unknown publication on a host whose send is not keyed by the intent", async () => {
    const send = vi.fn(async (_intent: SnapshotShareIntent) => { throw new TransportError("relay publish outcome unknown"); });
    await mount({ send, dedupesRetry: false });
    await pick("Alice");
    await click(sendButton()!);
    expect(document.querySelector("[data-testid=share-send-unknown]")?.textContent).toContain("Check the conversation");
    expect(sendButton()!.disabled).toBe(true);
    await click(sendButton()!);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("releases a definitely refused send so the next Send is a new message", async () => {
    const send = vi.fn(async (_intent: SnapshotShareIntent) => {})
      .mockRejectedValueOnce(new BffError(403, "denied", { class: "REJECTED", reason: "PERMISSION_DENIED" } as never));
    await mount({ send, dedupesRetry: true });
    await pick("Alice");
    await click(sendButton()!);
    expect(document.querySelector("[data-testid=share-send-failed]")).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>("[data-testid=share-recipient-search]")!.disabled).toBe(false);
    await click(sendButton()!);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].idempotencyKey).not.toBe(send.mock.calls[0]![0].idempotencyKey);
  });

  it("does not send bytes that no longer match the READY package", async () => {
    const send = vi.fn(async (_intent: SnapshotShareIntent) => {});
    await mount({ send, dedupesRetry: true, readBytes: async () => new Uint8Array([1, 2, 3]) });
    await pick("Alice");
    await click(sendButton()!);
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid=share-send-failed]")?.textContent).toContain("Export it again");
  });
});

describe("export dialog send entry", () => {
  const target: SnapshotExportTarget = { resourceId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", resourceVersion: 3,
    displayName: "Writer", versionAssetId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a" };
  const executionId = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
  const packageId = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";

  it("offers sending to people on a READY PNG package only when the host can send", async () => {
    const ready: ExportPackageView = { packageAssetId: packageId, actionExecutionId: executionId, sourceResourceId: target.resourceId,
      sourceAssetId: target.versionAssetId, formatKey: "buzz-agent-snapshot@1", mediaType: "image/png",
      state: "READY" as ExportPackageView["state"], contentDigest: await sha256Hex(pkg), byteSize: pkg.length,
      fileName: "Writer.agent.png", downloadPath: `/api/v1/export-packages/${packageId}/content` };
    const transport = vi.fn(async (request: BffRequest): Promise<BffReply> => {
      if (request.path === `/api/v1/export-packages/by-action/${executionId}`) return { status: 200, body: ready };
      if (request.path === "/api/v1/actions") return { status: 202, body: { actionKey: "agent.definition.export",
        actionExecutionId: executionId, operationId: "5a6b7c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d", gateState: "ALLOWED", dispatchState: "DISPATCHED" } };
      return routes()(request);
    });
    for (const [sendToConversation, shown] of [[undefined, false], [vi.fn(async () => {}), true]] as const) {
      const host = await render(<PlatformProvider client={createBffClient({ send: transport })} locale="zh-CN" currentPrincipalId="me">
        <ConversationVisibilityProvider value={{ read: async () => new Set<string>(), prepare: vi.fn() }}>
          <AgentSnapshotExportDialog target={target} onClose={() => {}}
            host={{ save: vi.fn(), readBytes: async () => pkg, sendToConversation, sendDedupesRetry: true }} />
        </ConversationVisibilityProvider>
      </PlatformProvider>);
      await click(document.querySelector<HTMLButtonElement>("[data-testid=agent-snapshot-export-confirm]")!);
      await settle(); await settle();
      const panel = document.querySelector("[data-testid=agent-snapshot-export-send-panel]");
      expect(panel !== null).toBe(shown);
      if (panel) expect(panel.textContent).toContain("发送给成员");
      host.remove();
    }
  });
});
