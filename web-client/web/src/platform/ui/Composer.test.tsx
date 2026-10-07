// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TransportError } from "@client-kit/platform/transport";
import { setLocale } from "@client-kit/platform/i18n";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AgentTrigger,
  AgentInstallationState,
  AgentPrincipalState,
  ResourceState,
  ChannelBindingStatus,
  type AgentInstallationView,
} from "@client-kit/contracts";
import { Composer } from "./ChannelPane";
import { loadDraftEntry } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: { root: Root; host: HTMLElement } | undefined;
afterEach(() => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.host.remove();
    mounted = undefined;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(ui: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => root.render(<TooltipProvider>{ui}</TooltipProvider>));
  return host;
}
async function settle() {
  await act(async () => {});
}
async function rerender(ui: ReactNode) {
  await act(async () => mounted!.root.render(<TooltipProvider>{ui}</TooltipProvider>));
}
function button(host: HTMLElement, label: string) {
  const found = [...host.querySelectorAll("button")].find(
    (entry) => entry.textContent === label || (label === "platform.send" && entry.dataset.testid === "send-message"),
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(target: HTMLElement) {
  await act(async () => target.click());
}
async function type(input: HTMLElement, value: string) {
  await act(async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = value;
    input.replaceChildren(paragraph);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const state = vi.hoisted(() => ({
  pages: [] as { installations: AgentInstallationView[] }[],
  success: true,
  next: false,
  more: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: () => ({
    data: { pages: state.pages },
    isSuccess: state.success,
    isPending: false,
    isError: !state.success,
    hasNextPage: state.next,
    isFetchingNextPage: false,
    fetchNextPage: state.more,
  }),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));
vi.mock("@/platform/bff-client", () => ({
  bff: {},
  BffError: class extends Error {},
  publishMessage: state.publish,
  markRead: vi.fn(),
  openStream: vi.fn(),
  uploadMedia: vi.fn(),
  fetchUserState: vi.fn(),
  mediaUrl: (workspace: string, sha256: string) => `/api/v1/workspaces/${workspace}/media/${sha256}`,
}));
vi.mock("@/shared/i18n", () => ({ t: (key: string) => key }));
vi.mock("@/features/chat/ui/MessageContent", () => ({
  MessageContent: () => null,
}));

function installation(resourceId: string): AgentInstallationView {
  return {
    resourceId,
    workspaceId: "workspace-a",
    agentResourceId: "definition-a",
    pinnedVersionAssetId: "version-a",
    agentPrincipalId: resourceId,
    agentPrincipalState: AgentPrincipalState.Active,
    ownerPrincipalId: "human-a",
    resourceVersion: 1,
    resourceState: ResourceState.Active,
    state: AgentInstallationState.Active,
    executionPermission: {
      requested: true,
      effective: true,
      canGrant: false,
      canRevoke: true,
    },
    channelBinding: {
      status: ChannelBindingStatus.Active,
      triggers: [AgentTrigger.Mention],
    },
  };
}
beforeEach(() => {
  // jsdom has no layout engine; ProseMirror's deferred focus reads Range geometry.
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  localStorage.clear();
  setLocale("en");
  state.pages = [
    { installations: [installation("agent-b"), installation("agent-a")] },
  ];
  state.success = true;
  state.next = false;
  state.more.mockReset();
  state.publish
    .mockReset()
    .mockResolvedValue({ eventId: "event", operationId: "operation" });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

it("restores Pulse compact focus/blur and below-editor autocomplete while retaining an uncertain draft", async () => {
  const publish=vi.fn().mockRejectedValue(new TransportError("Unknown"));
  const host=await render(<Composer surface="forum" compact autocompleteBelow composerHeader={<span>Current author</span>}
    draftIdentity="pulse-compact" mentionPeople={[{pubkey:"a".repeat(64),displayName:"Alex"}]} onPublish={publish}/>);
  const form=host.querySelector<HTMLFormElement>('[data-testid="forum-composer"]')!;
  expect(form.dataset.compactCollapsed).toBe("true");
  expect(host.querySelector('[data-testid="message-composer-toolbar"]')).toBeNull();
  expect(form.textContent).toContain("Current author");
  await act(async()=>host.querySelector<HTMLElement>('[data-testid="message-input"]')!.focus());
  expect(form.dataset.compactCollapsed).toBe("false");
  expect(host.querySelector('[data-testid="message-composer-toolbar"]')).not.toBeNull();
  await act(async()=>form.dispatchEvent(new FocusEvent("focusout",{bubbles:true,relatedTarget:null})));
  expect(form.dataset.compactCollapsed).toBe("true");
  await act(async()=>host.querySelector<HTMLElement>('[data-testid="message-input"]')!.focus());
  await click(host.querySelector('[aria-label="Mention someone"]') as HTMLButtonElement);
  const option=host.querySelector('[aria-label="Mention someone Alex"]')!;
  expect(option.closest('[data-testid="mention-autocomplete-layer"]')?.className).toContain("top-full");
  expect(form.className).toContain("overflow-visible");
  await act(async()=>option.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})));
  await click(button(host,"platform.send"));await settle();
  expect(publish).toHaveBeenCalledTimes(1);
  expect(form.dataset.compactCollapsed).toBe("false");
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toContain("Alex");
  expect(host.querySelector('[role="status"]')).not.toBeNull();
});

it("collapses the original compact form only after confirmed publication clears the draft",async()=>{
  const publish=vi.fn().mockResolvedValue({eventId:"confirmed"});
  const host=await render(<Composer surface="forum" compact draftIdentity="pulse-confirmed" onPublish={publish}/>);
  await act(async()=>host.querySelector<HTMLElement>('[data-testid="message-input"]')!.focus());
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!,"Original note");
  await click(button(host,"platform.send"));await settle();
  expect(publish).toHaveBeenCalledTimes(1);
  expect(host.querySelector<HTMLElement>('[data-testid="forum-composer"]')!.dataset.compactCollapsed).toBe("true");
});

it("publishes the explicit human picker identity and retains it with the same UNKNOWN intent", async () => {
  const pubkey="a".repeat(64);
  const publish=vi.fn().mockRejectedValue(new TransportError("Unknown"));
  const host=await render(<Composer draftIdentity="pulse-scope" mentionPeople={[{pubkey,displayName:"Alex"}]} onPublish={publish}/>);
  await click(host.querySelector('[aria-label="Mention someone"]') as HTMLButtonElement);
  await act(async()=>{host.querySelector('[aria-label="Mention someone Alex"]')!.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));});
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toContain("Alex");
  await click(button(host,"platform.send"));
  await settle();
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0]?.[4]).toEqual([pubkey]);
  await click(button(host,"platform.send"));
  await settle();
  expect(publish.mock.calls[1]?.[2]).toEqual(publish.mock.calls[0]?.[2]);
  expect(publish.mock.calls[1]?.[4]).toEqual([pubkey]);
});

it("resolves a typed human mention only from the current projected directory",async()=>{
  const pubkey="b".repeat(64),publish=vi.fn().mockResolvedValue({});
  const host=await render(<Composer draftIdentity="pulse-typed" mentionPeople={[{pubkey,displayName:"Blair"}]} onPublish={publish}/>);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!,"Hello @Blair");
  await click(button(host,"platform.send"));await settle();
  expect(publish.mock.calls[0]?.[4]).toEqual([pubkey]);
});

it("maps ambiguous human names through the shared localized error without publishing",async()=>{
  const publish=vi.fn();
  const host=await render(<Composer draftIdentity="pulse-ambiguous" mentionPeople={[
    {pubkey:"a".repeat(64),displayName:"Alex"},{pubkey:"b".repeat(64),displayName:"Alex"},
  ]} onPublish={publish}/>);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!,"Hello @Alex");
  await click(button(host,"platform.send"));await settle();
  expect(publish).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("pulse.mentionAmbiguous");
});

it("uses the original rich text toolbar and preserves a scoped UNKNOWN draft and idempotency key after remount", async () => {
  state.publish.mockRejectedValue(new TransportError("lost response"));
  let host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="workspace-a" />);
  expect(host.querySelector('[data-testid="message-input"]')?.getAttribute("contenteditable")).toBe("true");
  expect(host.querySelector('[aria-label="Toggle formatting"]')).not.toBeNull();
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "saved draft");
  await click(button(host, "platform.send"));
  const key = state.publish.mock.calls[0][3];
  await act(async () => { mounted!.root.unmount(); mounted!.host.remove(); mounted = undefined; });
  host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="workspace-a" />);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("saved draft");
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[1][3]).toBe(key);
});

it("preserves original rich editor formatting through draft restore and Markdown send", async () => {
  let host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="workspace-a" />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "format me");
  await click(host.querySelector<HTMLElement>('[aria-label="Toggle formatting"]')!);
  await act(async () => {
    const input = host.querySelector<HTMLElement>('[data-testid="message-input"]')! as HTMLElement & { editor: Editor };
    input.editor.commands.selectAll();
  });
  await click(host.querySelector<HTMLElement>('[aria-label="Bold"]')!);
  await act(async () => { mounted!.root.unmount(); mounted!.host.remove(); mounted = undefined; });
  host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="workspace-a" />);
  expect(host.querySelector('[data-testid="message-input"] strong')?.textContent).toBe("format me");
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[0][1]).toBe("**format me**");
});

it("restores UNKNOWN Inbox drafts without automatically redispatching their publication", async () => {
  state.publish.mockRejectedValue(new TransportError("lost response"));
  let host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="workspace-a" />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "retained Inbox send");
  await click(button(host, "platform.send"));
  const key = state.publish.mock.calls[0][3];
  await act(async () => { mounted!.root.unmount(); mounted!.host.remove(); mounted = undefined; });
  host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="workspace-a" autoSendDraftKey="workspace-a" />);
  await settle();
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(state.publish.mock.calls[0][3]).toBe(key);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("retained Inbox send");
  expect(host.textContent).toContain("platform.sendUnknown");
  await rerender(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="workspace-a" autoSendDraftKey="workspace-a" />);
  await settle();
  expect(state.publish).toHaveBeenCalledTimes(1);
});

it("sends an unsent Inbox draft once after confirmation", async () => {
  let host = await render(<Composer workspaceId="workspace-unsent" draftIdentity="alice" draftKey="workspace-unsent" />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "unsent Inbox draft");
  await act(async () => { mounted!.root.unmount(); mounted!.host.remove(); mounted = undefined; });
  host = await render(<Composer workspaceId="workspace-unsent" draftIdentity="alice" draftKey="workspace-unsent" autoSendDraftKey="workspace-unsent" />);
  await settle();
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(state.publish.mock.calls[0][1]).toBe("unsent Inbox draft");
  await rerender(<Composer workspaceId="workspace-unsent" draftIdentity="alice" draftKey="workspace-unsent" autoSendDraftKey="workspace-unsent" />);
  await settle();
  expect(state.publish).toHaveBeenCalledTimes(1);
});

it("restores an original edit body and never changes an unresolved edit's key for changed content", async () => {
  const publish = vi.fn().mockRejectedValue(new TransportError("lost edit receipt"));
  const confirmed = vi.fn();
  const target = {id:"a".repeat(64),author:"Alice",pubkey:"alice",body:"Original body",createdAt:1,time:"",depth:0,tags:[]};
  const props = {workspaceId:"workspace-edit",draftIdentity:"alice",draftKey:`edit:workspace-edit:${target.id}`,editTarget:target,onPublish:publish,onConfirmed:confirmed};
  let host = await render(<Composer {...props} />);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("Original body");
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "Edited body");
  await click(button(host,"platform.send"));
  const key = publish.mock.calls[0][2];
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "A different edit");
  await click(button(host,"platform.send"));
  expect(publish).toHaveBeenCalledTimes(1);
  expect(confirmed).not.toHaveBeenCalled();
  expect(host.textContent).toContain("platform.sendUnknown");
  await act(async () => { mounted!.root.unmount(); mounted!.host.remove(); mounted = undefined; });
  host = await render(<Composer {...props} autoSendDraftKey={props.draftKey} />);
  await settle();
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][2]).toBe(key);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("A different edit");
});

it.each(["voice-note-report.mp4", undefined])("publishes original edit attachment metadata and label with filename %s", async (filename) => {
  const hash = "b".repeat(64);
  const url = `https://relay.invalid/media/${hash}.mp4`;
  const thumb = `https://relay.invalid/media/${hash}.thumb.jpg`;
  const image = filename ? `https://relay.invalid/media/${"d".repeat(64)}.jpg` : undefined;
  const publish = vi.fn().mockResolvedValue({eventId:"edit-receipt",operationId:"edit-operation"});
  const target = {id:"c".repeat(64),author:"Alice",pubkey:"alice",body:`Original\n\n[Report label](${url})`,createdAt:1,time:"",depth:0,
    tags:[["imeta",`url ${url}`,`x ${hash}`,"m video/mp4","size 12",...(filename ? [`filename ${filename}`] : []),"dim 640x480",`thumb ${thumb}`,"duration 3",...(image ? [`image ${image}`] : []),"blurhash original-blur"]]};
  const draftKey = `edit:workspace-metadata:${target.id}`;
  const host = await render(<Composer workspaceId="workspace-metadata" draftIdentity="alice" draftKey={draftKey} editTarget={target} onPublish={publish} />);
  await settle();
  const metadata = {displayLabel:"Report label", ...(filename ? {filename} : {}), dim:"640x480", thumb, duration:3, ...(image ? {image} : {}), blurhash:"original-blur"};
  expect(loadDraftEntry(draftKey)?.pendingImeta[0]).toMatchObject(metadata);
  expect(loadDraftEntry(draftKey)?.pendingImeta[0]?.filename).toBe(filename);
  if (!filename) {
    expect(host.querySelector('img')?.getAttribute('src')).toBe(`/api/v1/workspaces/workspace-metadata/media/${hash}.thumb.jpg`);
  }
  await click(button(host,"platform.send"));
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][1][0]).toEqual({sha256:hash, url, type:"video/mp4", size:12, spoiler:false, ...metadata});
  expect(publish.mock.calls[0][0]).toBe("Original");
});

it.each(["identity", "channel"])("does not transfer an old draft, attachments, mentions or intent into an empty %s scope", async (changed) => {
  state.publish.mockRejectedValue(new TransportError("lost response"));
  const upload = vi.fn().mockResolvedValue({ sha256: "a".repeat(64), size: 4, type: "text/plain", url: "media:old" });
  const originalIdentity = `alice-${changed}`;
  const host = await render(<Composer workspaceId="workspace-a" draftIdentity={originalIdentity} draftKey="workspace-a" onUpload={upload} />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "old private draft");
  await select(host, "agent-a");
  const fileInput = host.querySelector<HTMLInputElement>('[data-testid="attach-input"]')!;
  await act(async () => {
    Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["old"], "old.txt", { type: "text/plain" })] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(button(host, "platform.send"));
  const oldKey = state.publish.mock.calls[0][3];
  const nextWorkspace = changed === "channel" ? "workspace-b" : "workspace-a";
  const nextIdentity = changed === "identity" ? "bob" : originalIdentity;
  await rerender(<Composer workspaceId={nextWorkspace} draftIdentity={nextIdentity} draftKey={nextWorkspace} onUpload={upload} />);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("");
  expect(host.textContent).not.toContain("old.txt");
  expect(host.textContent).not.toContain("old private draft");
  expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
  expect(button(host, "platform.send").disabled).toBe(true);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "new private draft");
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[1]).toEqual([nextWorkspace, "new private draft", [], expect.any(String), []]);
  expect(state.publish.mock.calls[1][3]).not.toBe(oldKey);
  await rerender(<Composer workspaceId="workspace-a" draftIdentity={originalIdentity} draftKey="workspace-a" onUpload={upload} />);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("old private draft");
  expect(host.textContent).toContain("old.txt");
});

it("does not let an old scope receipt unlock a new scope send", async () => {
  let oldReceipt!: () => void;
  let newReceipt!: () => void;
  state.publish.mockImplementationOnce(() => new Promise((resolve) => { oldReceipt = () => resolve({eventId:"old-event",operationId:"old-operation"}); }))
    .mockImplementationOnce(() => new Promise((resolve) => { newReceipt = () => resolve({eventId:"new-event",operationId:"new-operation"}); }));
  const host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="workspace-a" />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "old send");
  await click(button(host, "platform.send"));
  await rerender(<Composer workspaceId="workspace-b" draftIdentity="alice" draftKey="workspace-b" />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "new send");
  await click(button(host, "platform.send"));
  await act(async () => oldReceipt());
  expect(button(host, "platform.send").disabled).toBe(true);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("new send");
  await act(async () => newReceipt());
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("");
});

it("reuses original image preview, spoiler, drawing upload and revert against admitted BFF media", async () => {
  const hash = "a".repeat(64);
  const editedHash = "b".repeat(64);
  const original = { sha256: hash, size: 4, type: "image/png", url: `https://relay.invalid/media/${hash}.png` };
  const edited = { ...original, sha256: editedHash, url: `https://relay.invalid/media/${editedHash}.png` };
  const upload = vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(edited);
  const fetchBytes = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer });
  vi.stubGlobal("fetch", fetchBytes);
  vi.stubGlobal("Image", class { src = ""; naturalWidth = 32; naturalHeight = 32; decode = async () => {}; });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:edited-source") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const drawing = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(drawing as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback({ arrayBuffer: async () => new Uint8Array([3, 4]).buffer } as Blob));
  const host = await render(<Composer workspaceId="workspace-a" onUpload={upload} />);
  const fileInput = host.querySelector<HTMLInputElement>('[data-testid="attach-input"]')!;
  await act(async () => {
    Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["png"], "picture.png", { type: "image/png" })] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(host.querySelector("img")?.getAttribute("src")).toBe(`/api/v1/workspaces/workspace-a/media/${hash}`);
  await click(host.querySelector<HTMLElement>('[data-testid="composer-attachment-annotate"]')!);
  await click(document.querySelector<HTMLElement>('[data-testid="composer-attachment-spoiler"]')!);
  expect(document.querySelector('[data-lightbox-media-spoiler]')).not.toBeNull();
  await click(document.querySelector<HTMLElement>('[data-testid="composer-attachment-edit"]')!);
  const sourceImage = document.querySelector<HTMLImageElement>('[role="dialog"] img')!;
  await act(async () => {
    Object.defineProperties(sourceImage, { naturalWidth: { value: 32 }, naturalHeight: { value: 32 } });
    sourceImage.dispatchEvent(new Event("load"));
  });
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="composer-image-editor-canvas"]')!;
  Object.defineProperty(canvas, "setPointerCapture", { value: vi.fn() });
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, width: 32, height: 32, bottom: 32, right: 32, toJSON: () => ({}) });
  await act(async () => {
    canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 8, clientY: 8, button: 0 }));
    canvas.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
  });
  await click(document.querySelector<HTMLElement>('[data-testid="composer-image-editor-save"]')!);
  expect(fetchBytes).toHaveBeenCalledWith(`/api/v1/workspaces/workspace-a/media/${hash}`, { credentials: "same-origin" });
  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload.mock.calls[1][0].type).toBe("image/png");
  expect(host.querySelector("img")?.getAttribute("src")).toBe(`/api/v1/workspaces/workspace-a/media/${editedHash}`);
  await click(host.querySelector<HTMLElement>('[data-testid="composer-attachment-annotate"]')!);
  expect(document.querySelector('[data-lightbox-media-spoiler]')).not.toBeNull();
  await click(document.querySelector<HTMLElement>('[data-testid="composer-attachment-revert"]')!);
  await click(document.querySelector<HTMLElement>('[aria-label="Close lightbox"]')!);
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[0][2]).toEqual([{ ...original, filename: "picture.png", spoiler: true }]);
  expect(host.querySelector('[data-testid="composer-media-attachment"]')).toBeNull();
});
async function select(host: HTMLElement, id: string) {
  await click(button(host, "platform.mentionAgent"));
  const option = host.querySelector<HTMLElement>(
    `[data-testid="mention-suggestion-${id}"] button`,
  )!;
  expect(option).not.toBeNull();
  await act(async () => {
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}

it("reuses the Buzz picker to send all selected Agents once in canonical order across overlapping pages", async () => {
  state.pages.push({
    installations: [installation("agent-b"), installation("agent-c")],
  });
  state.next = true;
  const host = await render(<Composer workspaceId="workspace-a" />);
  await select(host, "agent-b");
  await select(host, "agent-a");
  await click(button(host, "platform.mentionAgent"));
  expect(
    host.querySelector('[data-testid="mention-suggestion-agent-b"]'),
  ).toBeNull();
  expect(host.querySelectorAll("[data-mention-suggestion-index]")).toHaveLength(
    1,
  );
  await click(button(host, "platform.moreMentionAgents"));
  expect(state.more).toHaveBeenCalledOnce();
  await type(
    host.querySelector<HTMLInputElement>('[data-testid="message-input"]')!,
    "hello",
  );
  await click(button(host, "platform.send"));
  expect(state.publish).toHaveBeenCalledExactlyOnceWith(
    "workspace-a",
    "hello",
    [],
    expect.any(String),
    ["agent-a", "agent-b"],
  );
  expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
});

it("preserves an UNKNOWN intent and changes its key only when the actual selected set changes", async () => {
  state.publish.mockRejectedValue(new TransportError("lost response"));
  const host = await render(<Composer workspaceId="workspace-a" />);
  await select(host, "agent-b");
  await select(host, "agent-a");
  await type(
    host.querySelector<HTMLInputElement>('[data-testid="message-input"]')!,
    "hello",
  );
  await click(button(host, "platform.send"));
  const key = state.publish.mock.calls[0][3];
  expect(host.textContent).toContain("platform.sendUnknown");
  expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2);
  await click(button(host, "agent-a"));
  await select(host, "agent-a");
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[1][3]).toBe(key);
  await click(button(host, "agent-b"));
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[2][3]).not.toBe(key);
  expect(state.publish.mock.calls[2][4]).toEqual(["agent-a"]);
});

it("fails closed when any selected Agent is revoked even if an overlapping page still has ACTIVE", async () => {
  const host = await render(<Composer workspaceId="workspace-a" />);
  await select(host, "agent-a");
  await select(host, "agent-b");
  state.pages = [
    { installations: [installation("agent-a"), installation("agent-b")] },
    {
      installations: [
        { ...installation("agent-a"), state: AgentInstallationState.Disabled },
      ],
    },
  ];
  await type(
    host.querySelector<HTMLInputElement>('[data-testid="message-input"]')!,
    "hello",
  );
  expect(button(host, "platform.send").disabled).toBe(true);
  await click(button(host, "platform.send"));
  expect(state.publish).not.toHaveBeenCalled();
  await click(button(host, "agent-a"));
  await click(button(host, "platform.send"));
  await settle();
  expect(state.publish.mock.calls[0][4]).toEqual(["agent-b"]);
});

it("selects through the original highlighted picker row with the keyboard", async () => {
  const host = await render(<Composer workspaceId="workspace-a" />);
  const trigger = button(host, "platform.mentionAgent");
  await click(trigger);
  await act(async () => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await act(async () => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(button(host, "agent-a").getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector('[data-testid="mention-autocomplete"]')).toBeNull();
});

it.each([false, undefined])(
  "excludes an Agent when execution permission is %s on either overlapping page",
  async (effective) => {
    const unavailable = installation("agent-a");
    unavailable.executionPermission =
      effective === undefined
        ? undefined
        : { ...unavailable.executionPermission!, effective };
    state.pages = [
      { installations: [unavailable] },
      { installations: [installation("agent-a"), installation("agent-b")] },
    ];
    const host = await render(<Composer workspaceId="workspace-a" />);
    await click(button(host, "platform.mentionAgent"));
    expect(host.querySelector('[data-testid="mention-suggestion-agent-a"]')).toBeNull();
    expect(host.querySelector('[data-testid="mention-suggestion-agent-b"]')).not.toBeNull();
  },
);

it("blocks a selected Agent after execution permission is revoked without changing installation state", async () => {
  const host = await render(<Composer workspaceId="workspace-a" />);
  await select(host, "agent-a");
  const revoked = installation("agent-a");
  revoked.executionPermission!.effective = false;
  state.pages = [{ installations: [revoked, installation("agent-b")] }];
  await type(
    host.querySelector<HTMLInputElement>('[data-testid="message-input"]')!,
    "hello",
  );
  expect(button(host, "platform.send").disabled).toBe(true);
  await click(button(host, "platform.send"));
  expect(state.publish).not.toHaveBeenCalled();
});
