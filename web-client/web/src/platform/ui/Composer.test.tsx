// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
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
  AgentRuntimeProjectionState,
  type AgentInstallationView,
} from "@client-kit/contracts";
import { Composer } from "./ChannelPane";
import { clearAllDrafts, loadDraftEntry } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
import { buildMentionClipboardHtml } from "@client-kit/platform/react/composer/features/messages/lib/mentionClipboard";
import {resetPersistentAgentAudienceStore} from "@client-kit/platform/react/composer/features/messages/lib/persistentAgentAudience";
import {setKeepMentionedAgentsPinned} from "@client-kit/platform/react/composer/features/messages/lib/autoPinMentionedAgentsPreference";
import {loadComposerAgentDirectory} from "@client-kit/platform/react/composer/features/messages/lib/composerAgentDirectory";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: { root: Root; host: HTMLElement; queryClient: QueryClient } | undefined;
afterEach(() => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.host.remove();
    mounted.queryClient.clear();
    mounted = undefined;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(ui: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const queryClient = new QueryClient({defaultOptions:{queries:{retry:false}}});
  mounted = { root, host, queryClient };
  await act(async () => root.render(<QueryClientProvider client={queryClient}><TooltipProvider>{ui}</TooltipProvider></QueryClientProvider>));
  await settle();
  return host;
}
async function settle() {
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 0));});
}
async function rerender(ui: ReactNode) {
  await act(async () => mounted!.root.render(<QueryClientProvider client={mounted!.queryClient}><TooltipProvider>{ui}</TooltipProvider></QueryClientProvider>));
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

function paste(host: HTMLElement, text: string, html: string) {
  // jsdom has no system pasteboard; only the browser event payload is supplied.
  class PasteData {
    values = new Map<string, string>();
    files: File[] = [];
    items: DataTransferItem[] = [];
    getData(type: string) { return this.values.get(type) ?? ""; }
    setData(type: string, value: string) { this.values.set(type, value); }
    get types() { return [...this.values.keys()]; }
  }
  class PasteEvent extends Event {
    clipboardData: PasteData | undefined;
    constructor(type: string, options: EventInit & { clipboardData?: PasteData } = {}) {
      super(type, options); this.clipboardData = options.clipboardData;
    }
  }
  vi.stubGlobal("DataTransfer", PasteData);
  vi.stubGlobal("ClipboardEvent", PasteEvent);
  const data = new PasteData();
  data.setData("text/plain", text); data.setData("text/html", html);
  const input = host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
  input.dispatchEvent(new PasteEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
}

const state = vi.hoisted(() => ({
  pages: [] as { installations: AgentInstallationView[] }[],
  success: true,
  next: false,
  more: vi.fn(),
  publish: vi.fn(),
  principal: "human-a",
}));
vi.mock("@/platform/bff-client", () => ({
  bff: {
    session: async () => ({tenantPrincipalId:state.principal}),
    profile: async () => ({pubkey:"d".repeat(64)}),
    members: async () => [],
    customEmoji: async () => ({pubkey:"d".repeat(64),events:[],mediaPaths:{}}),
    workspaceChannel: async () => ({channelId:"relay-channel-a",channelType:"stream",archived:false}),
    agentDefinition: async (id:string) => ({resourceId:id,resourceState:"ACTIVE",displayName:id.replace("definition-","")}),
    agentInstallations: async (_workspace:string,offset=0) => {
      if (!state.success) throw new Error("Agent directory unavailable");
      return {...state.pages[offset],nextOffset:offset+1<state.pages.length?offset+1:null};
    },
  },
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
    agentResourceId: `definition-${resourceId}`,
    agentPubkey: ({"agent-a":"1","agent-b":"2","agent-c":"3"}[resourceId] ?? "4").repeat(64),
    activeProjectionGeneration: 1,
    projection: {state:AgentRuntimeProjectionState.Active,generation:1,agentVersionAssetId:"version-a",configHash:"hash",runtimeProfileKey:"profile"},
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
      channelId: "relay-channel-a",
      triggers: [AgentTrigger.Mention],
    },
  };
}
beforeEach(() => {
  // JSDOM does not implement the browser observer used by the original Switch.
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  // jsdom has no layout engine; ProseMirror's deferred focus reads Range geometry.
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
  localStorage.clear();
  clearAllDrafts();
  resetPersistentAgentAudienceStore();
  setKeepMentionedAgentsPinned(false);
  setLocale("en");
  state.principal = "human-a";
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
  const option=host.querySelector('[aria-label="Mention Alex"]')!;
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

it.each(["confirmed", "rejected"])("keeps a pending compact send open until its actual %s outcome", async (outcome) => {
  let resolve!: (value: {eventId: string}) => void;
  let reject!: (error: Error) => void;
  const publication = new Promise<{eventId: string}>((yes, no) => { resolve = yes; reject = no; });
  const publish = vi.fn(() => publication);
  const host = await render(<Composer surface="forum" compact draftIdentity={`pulse-${outcome}-deferred`} onPublish={publish}/>);
  await act(async () => host.querySelector<HTMLElement>('[data-testid="message-input"]')!.focus());
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "Pending note");
  await click(button(host, "platform.send"));
  expect(publish).toHaveBeenCalledTimes(1);
  expect(host.querySelector<HTMLElement>('[data-testid="forum-composer"]')!.dataset.compactCollapsed).toBe("false");
  await act(async () => { if (outcome === "confirmed") resolve({eventId:"confirmed"}); else reject(new Error("Rejected")); });
  await settle();
  if (outcome === "confirmed") {
    expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("");
    expect(host.querySelector('[role="status"]')?.textContent).toBeUndefined();
  }
  expect(host.querySelector<HTMLElement>('[data-testid="forum-composer"]')!.dataset.compactCollapsed).toBe(outcome === "confirmed" ? "true" : "false");
  if (outcome === "rejected") expect(host.querySelector('[data-testid="message-input"]')?.textContent).toContain("Pending note");
});

it("publishes the explicit human picker identity and retains it with the same UNKNOWN intent", async () => {
  const pubkey="a".repeat(64);
  const publish=vi.fn().mockRejectedValue(new TransportError("Unknown"));
  const host=await render(<Composer draftIdentity="pulse-scope" mentionPeople={[{pubkey,displayName:"Alex"}]} onPublish={publish}/>);
  await click(host.querySelector('[aria-label="Mention someone"]') as HTMLButtonElement);
  await act(async()=>{host.querySelector('[aria-label="Mention Alex"]')!.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}));});
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

it("pastes original Markdown with the exact copied same-name identity and settles before immediate send", async () => {
  const first = "a".repeat(64), second = "b".repeat(64), publish = vi.fn().mockResolvedValue({});
  const host = await render(<Composer draftIdentity="paste-same-name" mentionPeople={[
    {pubkey:first,displayName:"Sam Lee"},{pubkey:second,displayName:"Sam Lee"},
  ]} onPublish={publish}/>);
  const text = "**Hello** @Sam Lee", html = buildMentionClipboardHtml({text,identities:[{label:"Sam Lee",pubkey:second}]})!;
  await act(async () => {
    paste(host,text,html);
    host.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles:true,cancelable:true}));
    host.querySelector("form")!.dispatchEvent(new Event("submit", {bubbles:true,cancelable:true}));
  });
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0]?.[0]).toBe(text);
  expect(publish.mock.calls[0]?.[4]).toEqual([second]);
});

it("normalizes original rich mention chips without losing surrounding formatting or trusting forged keys", async () => {
  const trusted = "c".repeat(64), forged = "d".repeat(64), publish = vi.fn().mockResolvedValue({});
  const host = await render(<Composer draftIdentity="paste-rich" mentionPeople={[{pubkey:trusted,displayName:"Casey Jones"}]} onPublish={publish}/>);
  await act(async () => paste(host,"not the HTML content",`<p><strong>Hi</strong> <span data-mention="" data-mention-label="Casey Jones" data-mention-pubkey="${trusted}">Casey Jones</span> and <span data-mention="" data-mention-label="Someone Else" data-mention-pubkey="${forged}">Someone Else</span></p>`));
  expect(host.querySelector('[data-testid="message-input"] strong')?.textContent).toBe("Hi");
  await click(button(host,"platform.send"));
  expect(publish.mock.calls[0]?.[0]).toBe("**Hi** @Casey Jones and @Someone Else");
  expect(publish.mock.calls[0]?.[4]).toEqual([trusted]);
});

it("does not attach a late copied identity to replacement text or a different draft", async () => {
  const first = "a".repeat(64), second = "b".repeat(64), publish = vi.fn();
  const people = [{pubkey:first,displayName:"Sam Lee"},{pubkey:second,displayName:"Sam Lee"}];
  const host = await render(<Composer draftIdentity="paste-replace" draftKey="first" mentionPeople={people} onPublish={publish}/>);
  const text = "@Sam Lee", html = buildMentionClipboardHtml({text,identities:[{label:"Sam Lee",pubkey:second}]})!;
  await act(async () => {
    paste(host,text,html);
    const editor = (host.querySelector('[data-testid="message-input"]') as HTMLElement & {editor:Editor}).editor;
    editor.commands.selectAll(); editor.commands.insertContent(text);
  });
  await click(button(host,"platform.send"));
  expect(publish).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("pulse.mentionAmbiguous");
  await rerender(<Composer draftIdentity="paste-replace" draftKey="second" mentionPeople={people} onPublish={publish}/>);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!,text);
  await click(button(host,"platform.send"));
  expect(publish).not.toHaveBeenCalled();
});

it("rechecks the current mention directory before publishing a copied identity", async () => {
  const pubkey="e".repeat(64), publish=vi.fn();
  const host=await render(<Composer draftIdentity="paste-revoked" mentionPeople={[{pubkey,displayName:"Chris Kim"}]} onPublish={publish}/>);
  const text="@Chris Kim";
  await act(async()=>paste(host,text,buildMentionClipboardHtml({text,identities:[{label:"Chris Kim",pubkey}]})!));
  await rerender(<Composer draftIdentity="paste-revoked" mentionPeople={[]} onPublish={publish}/>);
  await click(button(host,"platform.send"));
  expect(publish).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("platform.loadFailed");
});

it("pastes an original copied code block as code rather than flattening its source", async () => {
  const publish=vi.fn().mockResolvedValue({}),host=await render(<Composer draftIdentity="paste-code" onPublish={publish}/>);
  await act(async()=>paste(host,"a < b\nreturn a",'<pre data-buzz-code-block="true"><code>a &lt; b\nreturn a</code></pre>'));
  expect(host.querySelector('[data-testid="message-input"] pre code')?.textContent).toBe("a < b\nreturn a");
  await click(button(host,"platform.send"));
  expect(publish.mock.calls[0]?.[0]).toBe("```\na < b\nreturn a\n```");
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
  state.principal = originalIdentity;
  const host = await render(<Composer workspaceId="workspace-a" draftIdentity={originalIdentity} draftKey="workspace-a" onUpload={upload} />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "old private draft");
  await select(host, "agent-a");
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "old private draft @agent-a");
  const fileInput = host.querySelector<HTMLInputElement>('[data-testid="attach-input"]')!;
  await act(async () => {
    Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["old"], "old.txt", { type: "text/plain" })] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(button(host, "platform.send"));
  const oldKey = state.publish.mock.calls[0][3];
  const nextWorkspace = changed === "channel" ? "workspace-b" : "workspace-a";
  const nextIdentity = changed === "identity" ? "bob" : originalIdentity;
  state.principal = nextIdentity;
  await rerender(<Composer workspaceId={nextWorkspace} draftIdentity={nextIdentity} draftKey={nextWorkspace} onUpload={upload} />);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("");
  expect(host.textContent).not.toContain("old.txt");
  expect(host.textContent).not.toContain("old private draft");
  expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
  expect(button(host, "platform.send").disabled).toBe(true);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "new private draft");
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[1]).toEqual([nextWorkspace, "new private draft", [], expect.any(String), [], {mentionPubkeys: []}]);
  expect(state.publish.mock.calls[1][3]).not.toBe(oldKey);
  state.principal = originalIdentity;
  await rerender(<Composer workspaceId="workspace-a" draftIdentity={originalIdentity} draftKey="workspace-a" onUpload={upload} />);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("old private draft @agent-a");
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
  await click(host.querySelector<HTMLButtonElement>('[data-testid="message-insert-mention"]')!);
  await act(async () => {await vi.waitFor(() => expect(host.querySelector(`[aria-label="Mention ${id}"]`)).not.toBeNull());});
  const option = host.querySelector<HTMLElement>(
    `[aria-label="Mention ${id}"]`,
  )!;
  expect(option).not.toBeNull();
  await act(async () => {
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}
function agentComposer() {
  return <Composer workspaceId="workspace-a" draftIdentity="human-a" draftKey="agent-thread"
    audienceContext={{type:"thread",rootTags:[]}}/>;
}
async function refreshDirectory() {
  await act(async () => {await mounted!.queryClient.invalidateQueries({queryKey:["platform","composer-agent-directory"]});});
  await settle();
}

it("reuses the Buzz picker to send all selected Agents once in canonical order across overlapping pages", async () => {
  state.pages.push({
    installations: [installation("agent-b"), installation("agent-c")],
  });
  state.next = true;
  const host = await render(agentComposer());
  await select(host, "agent-b");
  await select(host, "agent-a");
  expect(host.querySelectorAll('[data-testid^="composer-address-lock-remove-"]')).toHaveLength(2);
  await click(host.querySelector<HTMLButtonElement>('[data-testid="message-insert-mention"]')!);
  expect(host.querySelectorAll("[data-mention-suggestion-index]")).toHaveLength(3);
  await type(
    host.querySelector<HTMLInputElement>('[data-testid="message-input"]')!,
    "@agent-b @agent-a hello",
  );
  await click(button(host, "platform.send"));
  expect(state.publish).toHaveBeenCalledExactlyOnceWith(
    "workspace-a",
    "@agent-b @agent-a hello",
    [],
    expect.any(String),
    ["agent-a", "agent-b"],
    {mentionPubkeys: []},
  );
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("");
});

it("preserves an UNKNOWN intent and changes its key only when the actual selected set changes", async () => {
  state.publish.mockRejectedValue(new TransportError("lost response"));
  const host = await render(agentComposer());
  await select(host, "agent-b");
  await select(host, "agent-a");
  await type(
    host.querySelector<HTMLInputElement>('[data-testid="message-input"]')!,
    "@agent-b @agent-a hello",
  );
  await click(button(host, "platform.send"));
  const key = state.publish.mock.calls[0][3];
  expect(host.textContent).toContain("platform.sendUnknown");
  expect(host.querySelectorAll('[data-testid^="composer-address-lock-remove-"]')).toHaveLength(2);
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[1][3]).toBe(key);
  await click(host.querySelector<HTMLElement>(`[data-testid="composer-address-lock-remove-${"2".repeat(64)}"]`)!);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "@agent-a hello");
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[2][3]).not.toBe(key);
  expect(state.publish.mock.calls[2][4]).toEqual(["agent-a"]);
});

it("fails closed when any selected Agent is revoked even if an overlapping page still has ACTIVE", async () => {
  const host = await render(agentComposer());
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
    "@agent-a @agent-b hello",
  );
  await click(button(host, "platform.send"));
  expect(state.publish).not.toHaveBeenCalled();
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "@agent-b hello");
  await vi.waitFor(() => {
    expect(host.querySelectorAll('[data-testid^="composer-address-lock-remove-"]')).toHaveLength(1);
    expect(host.querySelector(`[data-testid="composer-address-lock-remove-${"1".repeat(64)}"]`)).toBeNull();
  });
  await refreshDirectory();
  await click(button(host, "platform.send"));
  await vi.waitFor(() => {
    expect(state.publish).toHaveBeenCalledTimes(1);
    expect(state.publish.mock.calls[0][4]).toEqual(["agent-b"]);
  });
});

it("selects through the original highlighted picker row with the keyboard", async () => {
  const host = await render(agentComposer());
  await settle();
  const trigger = host.querySelector<HTMLButtonElement>('[data-testid="message-insert-mention"]')!;
  await click(trigger);
  await act(async () => {await vi.waitFor(() => expect(host.querySelector('[aria-label="Mention agent-a"]')).not.toBeNull());});
  const editor = host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
  await act(async () => {
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await act(async () => {
    editor.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toContain("@agent-a");
  expect(host.querySelector(`[data-testid="composer-address-lock-${"1".repeat(64)}"]`)).not.toBeNull();
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
    const host = await render(agentComposer());
    await click(host.querySelector<HTMLButtonElement>('[data-testid="message-insert-mention"]')!);
    await act(async () => {await vi.waitFor(() => expect(host.querySelector('[aria-label="Mention agent-b"]')).not.toBeNull());});
    expect(host.querySelector('[aria-label="Mention agent-a"]')).toBeNull();
    expect(host.querySelector('[aria-label="Mention agent-b"]')).not.toBeNull();
  },
);

it("blocks a selected Agent after execution permission is revoked without changing installation state", async () => {
  const host = await render(agentComposer());
  await select(host, "agent-a");
  const revoked = installation("agent-a");
  revoked.executionPermission!.effective = false;
  state.pages = [{ installations: [revoked, installation("agent-b")] }];
  await type(
    host.querySelector<HTMLInputElement>('[data-testid="message-input"]')!,
    "@agent-a hello",
  );
  await click(button(host, "platform.send"));
  expect(state.publish).not.toHaveBeenCalled();
});

it.each(["pubkey","projection","generation","channel","trigger","principal"])("does not display an Agent with an invalid %s admission fact",async fact=>{
  const invalid = installation("agent-a");
  if (fact === "pubkey") delete invalid.agentPubkey;
  if (fact === "projection") delete invalid.projection;
  if (fact === "generation") invalid.activeProjectionGeneration = 2;
  if (fact === "channel") invalid.channelBinding!.channelId = "other-channel";
  if (fact === "trigger") invalid.channelBinding!.triggers = [];
  if (fact === "principal") invalid.agentPrincipalState = AgentPrincipalState.Disabled;
  state.pages = [{installations:[invalid,installation("agent-b")]}];
  const host = await render(agentComposer());
  await click(host.querySelector<HTMLButtonElement>('[data-testid="message-insert-mention"]')!);
  await act(async()=>{await vi.waitFor(()=>expect(host.querySelector('[aria-label="Mention agent-b"]')).not.toBeNull());});
  expect(host.querySelector('[aria-label="Mention agent-a"]')).toBeNull();
});

it("fences an old identity result and rejects malformed pagination or ambiguous pubkey bindings",async()=>{
  const base = {session:async()=>({tenantPrincipalId:"human-a"}),workspaceChannel:async()=>({channelId:"relay-channel-a",channelType:"stream",archived:false}),
    profile:async()=>({pubkey:"d".repeat(64)}),members:async()=>[],agentDefinition:async()=>({resourceId:"definition-agent-a",resourceState:"ACTIVE",displayName:"Planner"}),
    agentInstallations:async()=>({installations:[installation("agent-a")],nextOffset:null})};
  let current = true;
  const scope = {workspaceId:"workspace-a",principalId:"human-a"};
  const late = {...base,members:async()=>{current=false;return [];}};
  // The read boundary receives the real generated BffClient method shapes;
  // only the HTTP reply is a fixture, not the production directory function.
  await expect(loadComposerAgentDirectory(late as unknown as Parameters<typeof loadComposerAgentDirectory>[0],scope,()=>current)).rejects.toThrow("identity or scope changed");
  const cursor = {...base,agentInstallations:async()=>({installations:[],nextOffset:0})};
  await expect(loadComposerAgentDirectory(cursor as unknown as Parameters<typeof loadComposerAgentDirectory>[0],scope,()=>true)).rejects.toThrow("cursor");
  const duplicate = {...installation("agent-b"),agentPubkey:installation("agent-a").agentPubkey};
  const ambiguous = {...base,agentInstallations:async()=>({installations:[installation("agent-a"),duplicate],nextOffset:null})};
  await expect(loadComposerAgentDirectory(ambiguous as unknown as Parameters<typeof loadComposerAgentDirectory>[0],scope,()=>true)).rejects.toThrow("Ambiguous Agent");
});

it("persists authored drafts without automatic addressing and restores the original prefix once", async () => {
  setKeepMentionedAgentsPinned(true);
  const props = {workspaceId:"workspace-a",draftIdentity:"human-a",draftKey:"prefix-thread",audienceContext:{type:"thread" as const,rootTags:[["p","1".repeat(64)]]}};
  let host = await render(<Composer {...props}/>);
  await act(async () => {await vi.waitFor(() => expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("@agent-a "));});
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "@agent-a authored body");
  expect(loadDraftEntry(props.draftKey)?.content).toBe("authored body");
  await act(async () => mounted!.root.unmount());
  mounted!.host.remove(); mounted!.queryClient.clear(); mounted = undefined;
  host = await render(<Composer {...props}/>);
  await act(async () => {await vi.waitFor(() => expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("@agent-a authored body"));});
  expect(loadDraftEntry(props.draftKey)?.content).toBe("authored body");
  expect(state.publish).not.toHaveBeenCalled();
});

it("preserves identical authored mentions and the full captured UNKNOWN intent instead of stripping its retry", async () => {
  setKeepMentionedAgentsPinned(true);
  state.publish.mockRejectedValue(new TransportError("lost response"));
  const props = {workspaceId:"workspace-a",draftIdentity:"human-a",draftKey:"prefix-unknown",audienceContext:{type:"thread" as const,rootTags:[["p","1".repeat(64)]]}};
  let host = await render(<Composer {...props}/>);
  await act(async () => {await vi.waitFor(() => expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("@agent-a "));});
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "@agent-a @agent-a authored body");
  expect(loadDraftEntry(props.draftKey)?.content).toBe("@agent-a authored body");
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[0][1]).toBe("@agent-a @agent-a authored body");
  const key = state.publish.mock.calls[0][3];
  expect(loadDraftEntry(props.draftKey)?.content).toBe("@agent-a @agent-a authored body");
  expect(loadDraftEntry(props.draftKey)?.sendIntent?.key).toBe(key);
  await act(async () => mounted!.root.unmount());
  mounted!.host.remove(); mounted!.queryClient.clear(); mounted = undefined;
  host = await render(<Composer {...props} autoSendDraftKey={props.draftKey}/>);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("@agent-a @agent-a authored body");
  expect(state.publish).toHaveBeenCalledTimes(1);
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[1][1]).toBe("@agent-a @agent-a authored body");
  expect(state.publish.mock.calls[1][3]).toBe(key);
});
