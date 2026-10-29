// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { BffError, TransportError } from "@client-kit/platform/transport";
import { clearTimeoutState, getTimeoutSnapshot } from "@client-kit/platform/react/moderation";
import { setLocale } from "@client-kit/platform/i18n";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentTrigger,
  AgentInstallationState,
  AgentInstallationViewAgentPrincipalState,
  ResourceState,
  AgentInstallationViewChannelBindingStatus,
  AgentRuntimeProjectionState,
  ErrorClass,
  PublishRestrictionKind,
  ReasonCode,
  type AgentInstallationView,
} from "@client-kit/contracts";
import { Composer } from "./ChannelPane";
import type { MediaUploadOptions } from "@/platform/bff-client";
import { draftMessageTarget } from "./InboxDrafts";
import { clearAllDrafts, loadDraftEntry, loadPendingSend } from "@client-kit/platform/react/composer/features/messages/lib/useDrafts";
import { buildMentionClipboardHtml } from "@client-kit/platform/react/composer/features/messages/lib/mentionClipboard";
import {resetPersistentAgentAudienceStore} from "@client-kit/platform/react/composer/features/messages/lib/persistentAgentAudience";
import {setKeepMentionedAgentsPinned} from "@client-kit/platform/react/composer/features/messages/lib/autoPinMentionedAgentsPreference";
import {loadComposerAgentDirectory} from "@client-kit/platform/react/composer/features/messages/lib/composerAgentDirectory";
import { toast } from "sonner";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: { root: Root; host: HTMLElement; queryClient: QueryClient } | undefined;
afterEach(async () => {
  if (mounted) {
    act(() => mounted!.root.unmount());
    mounted.host.remove();
    mounted.queryClient.clear();
    mounted = undefined;
  }
  // @tiptap/react destroys an unmounted editor on a timer, including editors a test unmounted
  // itself; let every pending destroy run while jsdom still provides window.
  await new Promise((resolve) => setTimeout(resolve, 20));
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

function voiceDevices() {
  // JSDOM supplies FileReader, but not the modern Blob.arrayBuffer API.
  const readArrayBuffer = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("FileReader did not return audio bytes"));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  class RecordingBlob extends Blob { arrayBuffer() { return readArrayBuffer(this); } }
  class RecordingFile extends File { arrayBuffer() { return readArrayBuffer(this); } }
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  class Recorder extends EventTarget {
    static isTypeSupported() { return true; }
    mimeType = "audio/webm";
    state = "inactive";
    start() { this.state = "recording"; }
    stop() {
      if (this.state === "inactive") return;
      this.state = "inactive";
      const data = new Event("dataavailable");
      Object.defineProperty(data, "data", {value: new RecordingBlob([new Uint8Array([1])], {type: this.mimeType})});
      this.dispatchEvent(data);
      this.dispatchEvent(new Event("stop"));
    }
  }
  class Audio {
    close() { return Promise.resolve(); }
    createAnalyser() { return {fftSize:0,smoothingTimeConstant:0,getByteTimeDomainData() {}}; }
    createMediaStreamSource() { return {connect() {}}; }
    async decodeAudioData() {
      return {numberOfChannels:1,sampleRate:24000,duration:0.01,getChannelData:()=>new Float32Array(240)};
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("AudioContext", Audio);
  vi.stubGlobal("Blob", RecordingBlob);
  vi.stubGlobal("File", RecordingFile);
  const microphoneNavigator = Object.create(navigator);
  Object.defineProperty(microphoneNavigator, "platform", {value: navigator.platform});
  Object.defineProperty(microphoneNavigator, "userAgent", {value: navigator.userAgent});
  Object.defineProperty(microphoneNavigator, "mediaDevices", {value: {getUserMedia}});
  vi.stubGlobal("navigator", microphoneNavigator);
  return {track, getUserMedia};
}

it("the real Web voice toolbar records one original WAV, uploads through its existing media host and only publishes after acknowledgement", async () => {
  const {track, getUserMedia} = voiceDevices();
  let acknowledge: ((value: {sha256:string;size:number;type:string;url:string}) => void) | undefined;
  const upload = vi.fn((_file: File) => new Promise<{sha256:string;size:number;type:string;url:string}>(resolve => {acknowledge=resolve;}));
  state.upload.mockImplementation((workspace: string, file: File) => {expect(workspace).toBe("workspace-a"); return upload(file);});
  const publish = vi.fn().mockResolvedValue({eventId:"voice-message",operationId:"voice-operation"});
  const host = await render(<Composer workspaceId="workspace-a" draftIdentity="human-a" draftKey="voice" onPublish={publish}/>);
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Record voice note"]')!);
  expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({audio:{autoGainControl:true,echoCancellation:true,noiseSuppression:true}});
  expect(host.querySelector('[data-testid="voice-note-recorder"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Discard voice note"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="finish-voice-note"]')).not.toBeNull();
  expect(host.querySelector<HTMLInputElement>('[data-testid="attach-input"]')!.disabled).toBe(true);
  expect(publish).not.toHaveBeenCalled();
  await click(host.querySelector<HTMLButtonElement>('[data-testid="finish-voice-note"]')!);
  await settle();
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(state.upload).toHaveBeenCalledTimes(1);
  const recording = upload.mock.calls[0]![0];
  expect(recording.name).toMatch(/^voice-note-\d+\.wav$/);
  expect(recording.type).toBe("audio/wav");
  expect(new TextDecoder().decode((await recording.arrayBuffer()).slice(0,4))).toBe("RIFF");
  expect(host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('[data-testid="attach-input"]')!.disabled).toBe(true);
  expect(host.querySelector('[data-testid="remove-composer-voice-note"]')).toBeNull();
  expect(publish).not.toHaveBeenCalled();
  const descriptor = {sha256:"a".repeat(64),size:recording.size,type:recording.type,url:`https://relay.invalid/media/${"a".repeat(64)}.wav`};
  await act(async () => acknowledge!(descriptor)); await settle();
  expect(host.querySelector('[data-testid="remove-composer-voice-note"]')).not.toBeNull();
  expect(host.querySelector<HTMLInputElement>('[data-testid="attach-input"]')!.disabled).toBe(true);
  await click(host.querySelector<HTMLButtonElement>('[data-testid="send-message"]')!);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0]![1]).toEqual([{...descriptor,filename:recording.name,spoiler:false}]);
  expect(host.querySelector('[data-testid="remove-composer-voice-note"]')).toBeNull();
});

it("shows the original per-file upload progress and cancels one upload without a problem or attachment", async () => {
  type Descriptor = {sha256:string;size:number;type:string;url:string};
  const uploads: {options?: MediaUploadOptions; resolve: (descriptor: Descriptor) => void}[] = [];
  const upload = vi.fn((_file: File, options?: MediaUploadOptions) => new Promise<Descriptor>(resolve => { uploads.push({options, resolve}); }));
  const host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="upload-progress" onUpload={upload} />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "with a file");
  const fileInput = host.querySelector<HTMLInputElement>('[data-testid="attach-input"]')!;
  await act(async () => {
    Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["one"], "one.txt", { type: "text/plain" })] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
  expect(upload).toHaveBeenCalledTimes(1);
  const progress = () => host.querySelector('[data-testid="upload-progress"]');
  // No byte counts yet: the original indeterminate bar, then the reported percentage.
  expect(progress()).not.toBeNull();
  expect(progress()!.getAttribute("aria-valuenow")).toBeNull();
  await act(async () => uploads[0]!.options!.onProgress!(40));
  expect(progress()!.getAttribute("aria-valuenow")).toBe("40");
  // DD-146: sending stays available while uploading; it holds the send until confirmation.
  expect(button(host, "platform.send").disabled).toBe(false);

  await click(host.querySelector<HTMLButtonElement>('button[aria-label="Cancel upload"]')!);
  expect(uploads[0]!.options!.signal!.aborted).toBe(true);
  expect(button(host, "platform.send").disabled).toBe(false);
  await vi.waitFor(() => expect(progress()).toBeNull(), {timeout: 3_000});
  // A late receipt for the canceled request never becomes an attachment or a problem.
  await act(async () => uploads[0]!.resolve({ sha256: "a".repeat(64), size: 3, type: "text/plain", url: "media:one" }));
  await settle();
  expect(host.textContent).not.toContain("one.txt");
  expect(host.textContent).not.toContain("platform.uploadFailed");
  await click(button(host, "platform.send"));
  expect(state.publish.mock.calls[0]?.[2]).toEqual([]);
});

it("the real Web discard control releases the microphone without uploading or publishing", async () => {
  const {track} = voiceDevices();
  const upload = vi.fn(); const publish = vi.fn();
  const host = await render(<Composer draftIdentity="human-a" draftKey="voice-discard" onUpload={upload} onPublish={publish}/>);
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Record voice note"]')!);
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Discard voice note"]')!);
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(upload).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  // The recorder is idle at once: the original ingress controls (with Record) return immediately.
  expect(host.querySelector('[aria-label="Record voice note"]')).not.toBeNull();
  // The original MessageComposerToolbar AnimatePresence then plays the recorder's exit; it is only
  // instant when no animation frame has advanced its enter animation yet.
  await vi.waitFor(() => expect(host.querySelector('[data-testid="voice-note-recorder"]')).toBeNull(), {timeout: 3000});
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(upload).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
});

it("a Web recording upload acknowledgement from an old actor cannot enter the next actual draft", async () => {
  voiceDevices();
  let acknowledge: ((value:{sha256:string;size:number;type:string;url:string})=>void) | undefined;
  const upload = vi.fn((_file: File) => new Promise<{sha256:string;size:number;type:string;url:string}>(resolve=>{acknowledge=resolve;}));
  const host = await render(<Composer draftIdentity="human-a" draftKey="same-draft" onUpload={upload}/>);
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Record voice note"]')!);
  await click(host.querySelector<HTMLButtonElement>('[data-testid="finish-voice-note"]')!); await settle();
  expect(upload).toHaveBeenCalledTimes(1);
  await rerender(<Composer draftIdentity="human-b" draftKey="same-draft" onUpload={upload}/>); await settle();
  await act(async () => acknowledge!({sha256:"b".repeat(64),size:524,type:"audio/wav",url:`https://relay.invalid/media/${"b".repeat(64)}.wav`}));
  await settle();
  expect(host.querySelector('[data-testid="remove-composer-voice-note"]')).toBeNull();
  expect(loadDraftEntry("same-draft")?.pendingImeta ?? []).toEqual([]);
});

it.each(["en","zh-CN"] as const)("Web unsupported microphone state keeps the original error in %s without media writes", async locale => {
  setLocale(locale); vi.stubGlobal("MediaRecorder", undefined);
  const error = vi.spyOn(toast,"error");
  const upload = vi.fn();
  const host = await render(<Composer draftIdentity="human-a" draftKey="voice-unavailable" onUpload={upload}/>);
  await click(host.querySelector<HTMLButtonElement>(locale === "en" ? '[aria-label="Record voice note"]' : '[aria-label="录制语音"]')!);
  expect(error).toHaveBeenCalledWith(locale === "en" ? "Voice recording is not available in this environment." : "当前环境不支持录音。");
  expect(upload).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="voice-note-recorder"]')).toBeNull();
});

function paste(host: HTMLElement, text: string, html: string, files: File[] = []) {
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
  data.files = files;
  data.items = files.map(file => ({kind:"file",type:file.type,getAsFile:()=>file}) as DataTransferItem);
  const input = host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
  input.dispatchEvent(new PasteEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
}

const state = vi.hoisted(() => ({
  pages: [] as { installations: AgentInstallationView[] }[],
  success: true,
  next: false,
  more: vi.fn(),
  publish: vi.fn(),
  upload: vi.fn(),
  gifs: [] as {slug:string;title:string;url:string;previewUrl:string;width:number;height:number;previewWidth:number;previewHeight:number;size:number}[],
  principal: "human-a",
  // DD-125(8): Workspace roster, Tenant participant directory, role projection and actions.
  members: vi.fn(),
  participants: vi.fn(),
  roleMembers: vi.fn(),
  submit: vi.fn(),
}));
// The shell re-exports the client-kit BffError; the double keeps that class so a structured
// rejection reaches the same instanceof checks as in production.
vi.mock("@/platform/bff-client", async () => ({
  BffError: (await vi.importActual<typeof import("@client-kit/platform/transport")>("@client-kit/platform/transport")).BffError,
  bff: {
    gifCapability: async () => ({available:state.gifs.length > 0,imageOrigins:["https://static.klipy.com"]}),
    gifSearch: async () => ({gifs:state.gifs}),
    gifShare: async () => undefined,
    session: async () => ({tenantPrincipalId:state.principal}),
    profile: async () => ({pubkey:"d".repeat(64)}),
    members: (...args: unknown[]) => state.members(...args),
    conversationParticipants: (...args: unknown[]) => state.participants(...args),
    roleMembers: (...args: unknown[]) => state.roleMembers(...args),
    submitAction: (...args: unknown[]) => state.submit(...args),
    customEmoji: async () => ({pubkey:"d".repeat(64),events:[],mediaPaths:{}}),
    workspaceChannel: async () => ({channelId:"relay-channel-a",channelType:"stream",archived:false}),
    agentDefinitions: async () => ({definitions:[{displayName:"Scout"}]}),
    agentDefinition: async (id:string) => ({resourceId:id,resourceState:"ACTIVE",displayName:id.replace("definition-","")}),
    agentInstallations: async (_workspace:string,offset=0) => {
      if (!state.success) throw new Error("Agent directory unavailable");
      return {...state.pages[offset],nextOffset:offset+1<state.pages.length?offset+1:null};
    },
  },
  publishMessage: state.publish,
  markRead: vi.fn(),
  openStream: vi.fn(),
  uploadMedia: state.upload,
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
    agentPrincipalState: AgentInstallationViewAgentPrincipalState.Active,
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
      status: AgentInstallationViewChannelBindingStatus.Active,
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
  state.gifs = [];
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
  state.upload.mockReset();
  state.members.mockReset().mockResolvedValue([]);
  state.participants.mockReset().mockResolvedValue({items: [], maxParticipants: 8});
  state.roleMembers.mockReset().mockRejectedValue(new BffError(403, "role-members → 403"));
  state.submit.mockReset();
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

// DD-125(2), V-SCN-129: a Relay timeout arrives as PUBLISH_REJECTED with a structured
// restriction; the original banner state is recorded instead of a generic error, a ban says
// so, and an accepted send lifts the recorded timeout.
it("records the original community timeout from a structured rejection and clears it on an accepted send", async () => {
  clearTimeoutState();
  const until = new Date(Date.now() + 3_600_000).toISOString();
  const rejected = (restriction: { kind: PublishRestrictionKind; until?: string }) =>
    new BffError(403, "rejected", { class: ErrorClass.Denied, reason: ReasonCode.PublishRejected, restriction });
  const publish = vi.fn()
    .mockRejectedValueOnce(rejected({ kind: PublishRestrictionKind.TimedOut, until }))
    .mockRejectedValueOnce(rejected({ kind: PublishRestrictionKind.Banned }))
    .mockResolvedValue({ eventId: "e".repeat(64), operationId: "operation" });
  const host = await render(<Composer draftIdentity="moderation-timeout" onPublish={publish} />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "Hello");
  await click(button(host, "platform.send"));
  await settle();
  expect(getTimeoutSnapshot()).toEqual({ active: true, expiresAtMs: Date.parse(until) });
  expect(host.textContent).not.toContain("platform.sendRejected");
  expect(host.textContent).not.toContain("platform.sendFailed");
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toContain("Hello");
  await click(button(host, "platform.send"));
  await settle();
  expect(host.textContent).toContain("moderation.banned");
  await click(button(host, "platform.send"));
  await settle();
  expect(publish).toHaveBeenCalledTimes(3);
  expect(getTimeoutSnapshot().active).toBe(false);
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
  await vi.waitFor(()=>expect(host.querySelector('[aria-label="Mention Alex"]')).not.toBeNull());
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

const snapshotBytes = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]);
const snapshotHash = "7f47b756761a46e6d4a4d96f0d8a4448f8449235009d1f3ad1493f5c773c19e8";
function snapshotHtml(filename: string, sha256 = snapshotHash) {
  return `<a data-buzz-agent-snapshot="${encodeURIComponent(JSON.stringify({version:1,displayName:"Writer",filename,
    sha256,size:snapshotBytes.length,type:"image/png"}))}">Writer</a>`;
}

it.each(["agent", "team"])("pastes a copied %s snapshot through the shared handler and restores its named attachment draft", async kind => {
  const filename = `Writer.${kind}.png`;
  const descriptor = {sha256:snapshotHash,size:snapshotBytes.length,type:"image/png",url:`https://relay.invalid/media/${snapshotHash}.png`};
  const upload = vi.fn().mockResolvedValue(descriptor);
  const publish = vi.fn().mockResolvedValue({});
  const props = {workspaceId:"snapshot-workspace",draftIdentity:"alice",draftKey:`paste-${kind}`,onUpload:upload,onPublish:publish};
  let host = await render(<Composer {...props} />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "Keep authored text");
  await act(async () => paste(host,"Writer",snapshotHtml(filename),[new File([snapshotBytes],"image.png",{type:"image/png"})]));
  await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
  await settle();
  expect(upload.mock.calls[0][0].name).toBe(filename);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("Keep authored text");
  expect(loadDraftEntry(props.draftKey)?.pendingImeta[0]).toMatchObject({...descriptor,filename});
  expect(publish).not.toHaveBeenCalled();
  await act(async () => {mounted!.root.unmount();mounted!.host.remove();mounted!.queryClient.clear();mounted=undefined;});
  host = await render(<Composer {...props} />);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("Keep authored text");
  expect(loadDraftEntry(props.draftKey)?.pendingImeta[0].filename).toBe(filename);
  expect(upload).toHaveBeenCalledOnce();
  await click(button(host,"platform.send"));
  expect(publish).toHaveBeenCalledOnce();
  expect(publish.mock.calls[0][0]).toBe("Keep authored text");
  expect(publish.mock.calls[0][1][0]).toMatchObject({...descriptor,filename});
});

it("does not trust snapshot HTML naming when bytes mismatch and keeps every ordinary pasted file", async () => {
  const upload = vi.fn(async (file: File) => ({sha256:snapshotHash,size:file.size,type:file.type,url:`https://relay.invalid/media/${snapshotHash}.png`}));
  const host = await render(<Composer draftIdentity="alice" draftKey="paste-untrusted" workspaceId="snapshot-workspace" onUpload={upload}/>);
  const files = [new File([snapshotBytes],"ordinary.png",{type:"image/png"}),new File(["two"],"second.txt",{type:"text/plain"})];
  await act(async () => paste(host,"Writer",snapshotHtml("Forged.agent.png","0".repeat(64)),files));
  await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  expect(upload.mock.calls.map(([file])=>file.name)).toEqual(["ordinary.png","second.txt"]);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("");
});

it("waits for every snapshot byte reader before Enter, then preserves the original queued upload send", async () => {
  const Reader = FileReader;
  const reads: {release:()=>void;finished:Promise<void>}[] = [];
  vi.stubGlobal("FileReader", class extends Reader {
    override readAsArrayBuffer(blob: Blob) {
      reads.push({release:()=>super.readAsArrayBuffer(blob),finished:new Promise(resolve=>this.addEventListener("loadend",()=>resolve(),{once:true}))});
    }
  });
  const receipts: ((value: {sha256:string;size:number;type:string;url:string})=>void)[] = [];
  const upload = vi.fn(() => new Promise<{sha256:string;size:number;type:string;url:string}>(resolve=>receipts.push(resolve)));
  const publish = vi.fn().mockResolvedValue({});
  const host = await render(<Composer workspaceId="snapshot-workspace" draftIdentity="alice" draftKey="paste-read-lock" onUpload={upload} onPublish={publish}/>);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!,"Send together");
  for (const name of ["First.agent.png","Second.team.png"]) {
    await act(async()=>paste(host,"Snapshot",snapshotHtml(name),[new File([snapshotBytes],"image.png",{type:"image/png"})]));
  }
  expect(reads).toHaveLength(2);
  const enter = async () => {await act(async()=>{host.querySelector('[data-testid="message-input"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));});};
  await enter();expect(publish).not.toHaveBeenCalled();expect(button(host,"platform.send").disabled).toBe(true);
  await act(async()=>{reads[0].release();await reads[0].finished;});
  await vi.waitFor(()=>expect(upload).toHaveBeenCalledTimes(1));
  await enter();expect(publish).not.toHaveBeenCalled();expect(button(host,"platform.send").disabled).toBe(true);
  await act(async()=>{reads[1].release();await reads[1].finished;});
  await vi.waitFor(()=>expect(upload).toHaveBeenCalledTimes(2));
  expect(button(host,"platform.send").disabled).toBe(false);
  await click(button(host,"platform.send"));
  expect(publish).not.toHaveBeenCalled();
  await act(async()=>{for (const receipt of receipts) receipt({sha256:snapshotHash,size:snapshotBytes.length,type:"image/png",url:`https://relay.invalid/media/${snapshotHash}.png`});});
  await vi.waitFor(()=>expect(publish).toHaveBeenCalledOnce());
  expect(publish.mock.calls[0][0]).toBe("Send together");
  expect(publish.mock.calls[0][1].map((file: {filename:string})=>file.filename)).toEqual(["First.agent.png","Second.team.png"]);
});

it("freezes every file from one snapshot paste in the original queued batch before the first upload receipt", async () => {
  const receipts: ((value: {sha256:string;size:number;type:string;url:string})=>void)[] = [];
  const upload = vi.fn((_file:File) => new Promise<{sha256:string;size:number;type:string;url:string}>(resolve=>receipts.push(resolve)));
  const publish = vi.fn().mockResolvedValue({});
  const host = await render(<Composer workspaceId="snapshot-workspace" draftIdentity="alice" draftKey="paste-one-batch" onUpload={upload} onPublish={publish}/>);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!,"Both files");
  await act(async()=>paste(host,"Writer",snapshotHtml("Writer.agent.png"),[
    new File([snapshotBytes],"image.png",{type:"image/png"}),new File(["notes"],"notes.txt",{type:"text/plain"}),
  ]));
  await vi.waitFor(()=>expect(upload).toHaveBeenCalledTimes(1));
  expect(button(host,"platform.send").disabled).toBe(false);
  await click(button(host,"platform.send"));
  expect(publish).not.toHaveBeenCalled();
  expect(loadPendingSend("paste-one-batch")?.missingFileNames).toEqual(["Writer.agent.png","notes.txt"]);
  await act(async()=>receipts[0]({sha256:snapshotHash,size:snapshotBytes.length,type:"image/png",url:`https://relay.invalid/media/${snapshotHash}.png`}));
  await vi.waitFor(()=>expect(upload).toHaveBeenCalledTimes(2));
  expect(upload.mock.calls[1][0].name).toBe("notes.txt");
  expect(publish).not.toHaveBeenCalled();
  await act(async()=>receipts[1]({sha256:"b".repeat(64),size:5,type:"text/plain",url:`https://relay.invalid/media/${"b".repeat(64)}.txt`}));
  await vi.waitFor(()=>expect(publish).toHaveBeenCalledOnce());
  expect(publish.mock.calls[0][0]).toBe("Both files");
  expect(publish.mock.calls[0][1].map((file:{filename:string})=>file.filename)).toEqual(["Writer.agent.png","notes.txt"]);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("");
  expect(loadDraftEntry("paste-one-batch")?.pendingImeta ?? []).toEqual([]);
});

it.each(["identity", "draft"])("retires an asynchronous snapshot paste when the %s changes before its byte read completes", async changed => {
  const upload = vi.fn();
  const Reader = FileReader;
  let release!: () => void;
  let readFinished!: Promise<void>;
  vi.stubGlobal("FileReader", class extends Reader {
    override readAsArrayBuffer(blob: Blob) {
      readFinished = new Promise(resolve => this.addEventListener("loadend",()=>resolve(),{once:true}));
      release=()=>super.readAsArrayBuffer(blob);
    }
  });
  const host = await render(<Composer draftIdentity="alice" draftKey="before" workspaceId="snapshot-workspace" onUpload={upload}/>);
  await act(async () => paste(host,"Writer",snapshotHtml("Writer.agent.png"),[new File([snapshotBytes],"image.png",{type:"image/png"})]));
  expect(release).toBeTypeOf("function");
  expect(upload).not.toHaveBeenCalled();
  const nextDraft = changed === "identity" ? "before" : "after";
  await rerender(<Composer draftIdentity={changed === "identity" ? "bob" : "alice"} draftKey={nextDraft} workspaceId="snapshot-workspace" onUpload={upload}/>);
  await act(async () => {release();await readFinished;});
  await settle();
  expect(upload).not.toHaveBeenCalled();
  expect(loadDraftEntry(nextDraft)?.pendingImeta ?? []).toEqual([]);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("");
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
  let consumed = false;
  const consume = vi.fn(async () => { consumed = true; });
  const publish = state.publish.getMockImplementation()!;
  state.publish.mockImplementation((...args: unknown[]) => { expect(consumed).toBe(true); return publish(...args); });
  let host = await render(<Composer workspaceId="workspace-unsent" draftIdentity="alice" draftKey="workspace-unsent" />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "unsent Inbox draft");
  await act(async () => { mounted!.root.unmount(); mounted!.host.remove(); mounted = undefined; });
  host = await render(<Composer workspaceId="workspace-unsent" draftIdentity="alice" draftKey="workspace-unsent" autoSendDraftKey="workspace-unsent" onAutoSendConsumed={consume} />);
  await settle();
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(state.publish.mock.calls[0][1]).toBe("unsent Inbox draft");
  expect(consume).toHaveBeenCalledTimes(1);
  await rerender(<Composer workspaceId="workspace-unsent" draftIdentity="alice" draftKey="workspace-unsent" autoSendDraftKey="workspace-unsent" />);
  await settle();
  expect(state.publish).toHaveBeenCalledTimes(1);
});

it("does not dispatch a draft when its one-shot navigation reference cannot be consumed", async () => {
  let host = await render(<Composer workspaceId="workspace-unsent" draftIdentity="alice" draftKey="workspace-unsent" />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "not dispatched");
  await act(async () => { mounted!.root.unmount(); mounted!.host.remove(); mounted = undefined; });
  host = await render(<Composer workspaceId="workspace-unsent" draftIdentity="alice" draftKey="workspace-unsent" autoSendDraftKey="workspace-unsent"
    onAutoSendConsumed={async () => {throw new Error("Navigation unavailable");}} />);
  await settle();
  expect(state.publish).not.toHaveBeenCalled();
  expect(host.textContent).toContain("platform.sendFailed");
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("not dispatched");
});

it("persists and reopens the native DM draft scope through the actual Composer", async () => {
  const nativeChannel = "native-dm"; const rootId = "a".repeat(64); const replyId = "b".repeat(64);
  const key = `thread:${nativeChannel}:${rootId}:${replyId}`;
  const props = {draftIdentity:"alice", draftKey:key, draftChannelId:nativeChannel, channelType:"dm" as const, onPublish:state.publish};
  let host = await render(<Composer {...props} />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "native scoped draft");
  expect(loadDraftEntry(key)?.channelId).toBe(nativeChannel);
  expect(draftMessageTarget({key,draft:loadDraftEntry(key)!})).toMatchObject({parentEventId:replyId,threadRootId:rootId});
  await act(async () => { mounted!.root.unmount(); mounted!.host.remove(); mounted = undefined; });
  host = await render(<Composer {...props} />);
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("native scoped draft");
  expect(loadDraftEntry(key)?.channelId).toBe(nativeChannel);
  expect(state.publish).not.toHaveBeenCalled();
});

it("does not automatically retry an UNKNOWN intent created while navigation consumption is pending", async () => {
  state.publish.mockRejectedValue(new TransportError("lost response"));
  let release!: () => void;
  const consumption = new Promise<void>(resolve => { release=resolve; });
  let host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="workspace-a" />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "same retained intent");
  await act(async () => { mounted!.root.unmount(); mounted!.host.remove(); mounted = undefined; });
  host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="workspace-a" autoSendDraftKey="workspace-a" onAutoSendConsumed={() => consumption} />);
  await click(button(host,"platform.send"));
  expect(state.publish).toHaveBeenCalledTimes(1);
  const intent = loadDraftEntry("workspace-a")?.sendIntent;
  expect(intent).toBeDefined();
  await act(async () => release()); await settle();
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(loadDraftEntry("workspace-a")?.sendIntent).toEqual(intent);
  expect(host.textContent).toContain("platform.sendUnknown");
});

it("Escape cancels the real edit and restores the existing text and uploaded attachment draft without publishing", async () => {
  const publish = vi.fn();
  const canceled = vi.fn();
  const descriptor = {sha256:"a".repeat(64),size:4,type:"text/plain",url:"media:kept"};
  const upload = vi.fn().mockResolvedValue(descriptor);
  const target = {id:"e".repeat(64),author:"Alice",pubkey:"alice",body:"Published text",createdAt:1,time:"",depth:0,tags:[]};
  function Host() {
    const [editing, setEditing] = useState(false);
    return <><button onClick={() => setEditing(true)}>Edit existing</button>
      <Composer workspaceId="escape-workspace" draftIdentity="alice" draftKey={editing ? `edit:${target.id}` : "escape-draft"}
        editTarget={editing ? target : undefined} onUpload={upload} onPublish={publish}
        onCancelEdit={() => {canceled(); setEditing(false);}} /></>;
  }
  const host = await render(<Host />);
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "Unsent draft");
  const picker = host.querySelector<HTMLInputElement>('[data-testid="attach-input"]')!;
  await act(async () => {
    Object.defineProperty(picker,"files",{configurable:true,value:[new File(["kept"],"kept.txt",{type:"text/plain"})]});
    picker.dispatchEvent(new Event("change",{bubbles:true}));
  });
  await settle();
  expect(loadDraftEntry("escape-draft")?.pendingImeta[0]).toMatchObject({...descriptor,filename:"kept.txt"});
  await click(button(host,"Edit existing"));
  await settle();
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("Published text");
  await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "Discard this edit");
  await act(async () => host.querySelector('[data-testid="message-input"]')!.dispatchEvent(
    new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
  await settle();
  expect(canceled).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("Unsent draft");
  expect(host.textContent).toContain("kept.txt");
  expect(loadDraftEntry("escape-draft")?.pendingImeta[0]).toMatchObject({...descriptor,filename:"kept.txt"});
  expect(upload).toHaveBeenCalledOnce();
  expect(publish).not.toHaveBeenCalled();
});

it("Escape dismisses mention autocomplete before canceling an edit, and cannot cancel an in-flight save", async () => {
  let release!: (value: object) => void;
  const publish = vi.fn(() => new Promise<object>(resolve => {release=resolve;}));
  const canceled = vi.fn();
  const target = {id:"f".repeat(64),author:"Alice",pubkey:"alice",body:"Original",createdAt:1,time:"",depth:0,tags:[]};
  const host = await render(<Composer draftIdentity="alice" draftKey="escape-edit" editTarget={target}
    mentionPeople={[{pubkey:"b".repeat(64),displayName:"Bob"}]} onPublish={publish} onCancelEdit={canceled} />);
  const input = () => host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
  await type(input(),"@Bo");
  // The suggestion list resolves on a later macrotask; under CI load 1 s was not enough (wait on the state, not a fixed budget).
  await vi.waitFor(() => expect(host.querySelector('[data-mention-suggestion-index]')).not.toBeNull(), {timeout:15000});
  await act(async () => input().dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
  expect(canceled).not.toHaveBeenCalled();
  expect(host.querySelector('[data-mention-suggestion-index]')).toBeNull();
  await type(input(),"Changed body");
  await click(button(host,"platform.send"));
  expect(publish).toHaveBeenCalledOnce();
  await act(async () => input().dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
  expect(canceled).not.toHaveBeenCalled();
  await act(async () => release({}));
  // Once the save settles, Escape cancels the edit; retry the key until the in-flight guard has cleared.
  await vi.waitFor(async () => {
    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})));
    expect(canceled).toHaveBeenCalled();
  }, {timeout:15000});
  expect(canceled).toHaveBeenCalledOnce();
}, 30_000);

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
  // Original useMentionSendFlow: each Send cleared its own composer; only its own receipt settles it.
  expect(host.querySelector('[data-testid="message-input"]')?.textContent).toBe("");
  await act(async () => oldReceipt());
  expect(host.querySelector('[data-testid="composer-pending-send"]')?.textContent).toContain("platform.pendingSendPublishing");
  expect(loadPendingSend("workspace-b")?.draft.content).toBe("new send");
  await act(async () => newReceipt());
  await settle();
  expect(host.querySelector('[data-testid="composer-pending-send"]')).toBeNull();
  expect(loadPendingSend("workspace-b")).toBeUndefined();
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
    {addressedInstallationIds: ["agent-a", "agent-b"], mentionPubkeys: []},
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

it("selecting a mention with Enter does not leave the editor's paragraph split behind the mention", async () => {
  const host = await render(agentComposer());
  await settle();
  await click(host.querySelector<HTMLButtonElement>('[data-testid="message-insert-mention"]')!);
  await act(async () => {await vi.waitFor(() => expect(host.querySelector('[aria-label="Mention agent-a"]')).not.toBeNull());});
  const editor = host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
  await act(async () => {
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  // Original useMentions replaces up to the live selection, which also absorbs the
  // splitBlock ProseMirror applied for that Enter: one paragraph, mention first.
  expect(editor.querySelectorAll("p")).toHaveLength(1);
  expect(editor.textContent).toMatch(/^@agent-[ab] $/);
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
  if (fact === "principal") invalid.agentPrincipalState = AgentInstallationViewAgentPrincipalState.Disabled;
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

describe("DD-125(8) mentioning people outside the Workspace channel", () => {
  const member = "a".repeat(64), outsider = "b".repeat(64);
  const outsideComposer = () => <Composer workspaceId="workspace-a" draftIdentity="human-a" draftKey="outside"
    mentionPeople={[{pubkey: member, displayName: "Mia"}]} nonMemberMentionWorkspaceId="workspace-a"/>;
  const dialogButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')];
  async function mentionOutsider(host: HTMLElement) {
    state.participants.mockResolvedValue({items: [{principalId: "olive", displayName: "Olive", pubkeys: [outsider]}], maxParticipants: 8});
    await click(host.querySelector<HTMLButtonElement>('[aria-label="Mention someone"]')!);
    await act(async () => {await vi.waitFor(() => expect(host.querySelector('[aria-label="Mention Olive"]')).not.toBeNull());});
    expect(host.textContent).toContain("not in channel");
    await act(async () => {host.querySelector('[aria-label="Mention Olive"]')!.dispatchEvent(new MouseEvent("mousedown", {bubbles: true}));});
    await click(button(host, "platform.send"));
    await act(async () => {await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());});
  }

  it("without add admission keeps the draft on Cancel and sends anyway as reference-only mentions", async () => {
    const host = await render(outsideComposer());
    await mentionOutsider(host);
    expect(state.publish).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain("Olive is not in this channel.");
    expect(dialogButtons().map(entry => entry.textContent)).toEqual(["Cancel", "Send anyway"]);
    await click(dialogButtons()[0]!);
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(state.publish).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="message-input"]')?.textContent).toContain("@Olive");
    await click(button(host, "platform.send"));
    await act(async () => {await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')).not.toBeNull());});
    await click(dialogButtons().find(entry => entry.textContent === "Send anyway")!);
    await act(async () => {await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));});
    const [workspace, content, , , installations, intent] = state.publish.mock.calls[0]!;
    expect([workspace, content, installations]).toEqual(["workspace-a", "@Olive", []]);
    expect(intent).toEqual({mentionPubkeys: [], referenceMentionPubkeys: [outsider]});
    expect(state.submit).not.toHaveBeenCalled();
  });

  it("re-queries an UNKNOWN reference-only send under the same key and choice without prompting again", async () => {
    state.publish.mockRejectedValue(new TransportError("lost response"));
    const host = await render(outsideComposer());
    await mentionOutsider(host);
    await click(dialogButtons().find(entry => entry.textContent === "Send anyway")!);
    await act(async () => {await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));});
    const first = state.publish.mock.calls[0]!;
    await click(button(host, "platform.send"));
    await act(async () => {await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(2));});
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(state.publish.mock.calls[1]).toEqual(first);
    expect(state.publish.mock.calls[1]![5]).toEqual({mentionPubkeys: [], referenceMentionPubkeys: [outsider]});
  });

  it("invites with admission and publishes the full mention only after the membership is ACTIVE", async () => {
    state.roleMembers.mockResolvedValue({members: [{principalId: "olive", displayName: "Olive", tenantAdmin: false, workspaceAdmin: false,
      lastTenantAdmin: false, canGrantTenantAdmin: false, canRevokeTenantAdmin: false, canGrantWorkspaceAdmin: false,
      canRevokeWorkspaceAdmin: false, canAddToWorkspace: true}]});
    // The membership becomes ACTIVE only after the governed add was submitted.
    state.members.mockImplementation(async () => state.submit.mock.calls.length > 0
      ? [{principalId: "olive", displayName: "Olive", pubkeys: [outsider], state: "ACTIVE"}] : []);
    state.submit.mockImplementation(async (command: {actionKey: string; principalId: string}) => ({actionExecutionId: "execution", actionKey: command.actionKey,
      operationId: "operation", gateState: "ALLOWED", dispatchState: "DISPATCHED"}));
    const host = await render(outsideComposer());
    await mentionOutsider(host);
    expect(dialogButtons().map(entry => entry.textContent)).toEqual(["Cancel", "Do nothing", "Invite"]);
    await click(dialogButtons().find(entry => entry.textContent === "Invite")!);
    await act(async () => {await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));});
    expect(state.submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({actionKey: "workspace.member.add", workspaceId: "workspace-a", principalId: "olive"}));
    expect(state.publish.mock.calls[0]![5]).toEqual({mentionPubkeys: [outsider]});
  });
});

describe("DD-146 original send flow: clear at Send, restore on failure", () => {
  type Descriptor = {sha256:string;size:number;type:string;url:string};
  async function attachPending(host: HTMLElement) {
    const fileInput = host.querySelector<HTMLInputElement>('[data-testid="attach-input"]')!;
    await act(async () => {
      Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["one"], "one.txt", { type: "text/plain" })] });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
  }
  function uploader() {
    const uploads: {file: File; options?: MediaUploadOptions; resolve: (d: Descriptor) => void; reject: (e: unknown) => void}[] = [];
    const upload = vi.fn((file: File, options?: MediaUploadOptions) => new Promise<Descriptor>((resolve, reject) => { uploads.push({file, options, resolve, reject}); }));
    return {upload, uploads};
  }
  const input = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-testid="message-input"]')!;
  const pill = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-testid="composer-queued-send"]');
  const recovery = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-testid="composer-pending-send"]');
  const descriptor = { sha256: "a".repeat(64), size: 3, type: "text/plain", url: "media:one" };
  const composer = (draftKey: string, upload: ReturnType<typeof uploader>["upload"]) =>
    <Composer workspaceId="workspace-a" draftIdentity="alice" draftKey={draftKey} onUpload={upload} />;

  it("clears the composer at Send and publishes once, only with the confirmed attachment", async () => {
    const {upload, uploads} = uploader();
    const host = await render(composer("queued-ok", upload));
    await type(input(host), "with a file");
    await attachPending(host);
    await click(button(host, "platform.send"));
    await settle();
    expect(state.publish).not.toHaveBeenCalled();
    expect(input(host).textContent).toBe("");
    expect(loadDraftEntry("queued-ok")).toBeUndefined();
    expect(pill(host)).not.toBeNull();
    // The composer is free for the next message while the frozen one waits for its upload.
    expect(input(host).getAttribute("contenteditable")).toBe("true");
    await act(async () => uploads[0]!.options!.onProgress!(50));
    expect(pill(host)!.textContent).toContain("platform.sendAfterUpload");
    await act(async () => uploads[0]!.resolve(descriptor));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
    expect(state.publish.mock.calls[0][1]).toBe("with a file");
    expect(state.publish.mock.calls[0][2]).toEqual([expect.objectContaining({ sha256: descriptor.sha256, url: descriptor.url })]);
    await settle();
    expect(pill(host)).toBeNull();
    expect(recovery(host)).toBeNull();
    expect(input(host).textContent).toBe("");
  });

  it("restores the draft when a queued upload fails, never publishing", async () => {
    const {upload, uploads} = uploader();
    const host = await render(composer("queued-fail", upload));
    await type(input(host), "keep me");
    await attachPending(host);
    await click(button(host, "platform.send"));
    expect(input(host).textContent).toBe("");
    await act(async () => uploads[0]!.reject(new BffError(413, "too large")));
    await settle(); await settle();
    expect(state.publish).not.toHaveBeenCalled();
    expect(input(host).textContent).toBe("keep me");
    expect(host.textContent).toContain("platform.uploadTooLarge");
    expect(pill(host)).toBeNull();
    expect(recovery(host)).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="composer-queued-media-attachment"]')?.textContent).toContain("one.txt");
    expect(loadPendingSend("queued-fail")?.missingFileNames).toEqual(["one.txt"]);
  });

  it("Cancel restores the draft and its canceled file without publishing", async () => {
    const {upload, uploads} = uploader();
    const host = await render(composer("queued-cancel", upload));
    await type(input(host), "maybe later");
    await attachPending(host);
    await click(button(host, "platform.send"));
    await click(host.querySelector<HTMLElement>('[data-testid="composer-queued-send-cancel"]')!);
    await settle(); await settle();
    expect(uploads[0]!.options!.signal!.aborted).toBe(true);
    expect(input(host).textContent).toBe("maybe later");
    // Original restoreQueuedAttachments: the canceled local file is back in the composer.
    expect(upload).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="composer-queued-media-attachment"]')?.textContent).toContain("one.txt");
    await act(async () => uploads[0]!.resolve(descriptor));
    await settle();
    expect(state.publish).not.toHaveBeenCalled();
  });

  it.each(["failure", "unknown", "cancel"])("retains the original local attachment after %s without upload until explicit Send", async outcome => {
    const {upload, uploads} = uploader();
    const key = `retained-${outcome}`;
    const host = await render(composer(key, upload));
    await type(input(host), "keep body and file");
    await attachPending(host);
    await click(button(host, "platform.send"));
    if (outcome === "cancel") await click(host.querySelector<HTMLElement>('[data-testid="composer-queued-send-cancel"]')!);
    else await act(async () => uploads[0]!.reject(outcome === "unknown" ? new TransportError("lost upload receipt") : new BffError(413, "too large")));
    await settle(); await settle();
    expect(input(host).textContent).toBe("keep body and file");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(state.publish).not.toHaveBeenCalled();
    expect(loadPendingSend(key)?.stage).toBe(outcome === "unknown" ? "unknown" : "failed");
    expect(loadPendingSend(key)?.missingFileNames).toEqual(["one.txt"]);
    expect(host.querySelector('[data-testid="composer-queued-media-attachment"]')?.textContent).toContain("one.txt");
    await click(button(host, "platform.send"));
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(uploads[1]!.file).toBe(uploads[0]!.file);
    expect(state.publish).not.toHaveBeenCalled();
    await act(async () => uploads[1]!.resolve(descriptor));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledOnce());
    expect(state.publish.mock.calls[0][1]).toBe("keep body and file");
    expect(state.publish.mock.calls[0][2]).toEqual([expect.objectContaining({sha256:descriptor.sha256,filename:"one.txt"})]);
  });

  it("keeps confirmed media and freezes a failed batch file until explicit Send", async () => {
    const {upload, uploads} = uploader();
    const host = await render(composer("partial-batch", upload));
    await type(input(host), "both stay");
    await act(async () => paste(host, "", "", [new File(["one"],"one.txt"),new File(["two"],"two.txt")]));
    await click(button(host, "platform.send"));
    await act(async () => uploads[0]!.resolve(descriptor));
    await vi.waitFor(() => expect(uploads).toHaveLength(2));
    await act(async () => uploads[1]!.reject(new TransportError("lost second receipt")));
    await settle(); await settle();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(state.publish).not.toHaveBeenCalled();
    expect(loadDraftEntry("partial-batch")?.pendingImeta[0]).toMatchObject({sha256:descriptor.sha256,filename:"one.txt"});
    expect(loadPendingSend("partial-batch")?.missingFileNames).toEqual(["two.txt"]);
    await click(button(host, "platform.send"));
    await vi.waitFor(() => expect(uploads).toHaveLength(3));
    expect(uploads[2]!.file.name).toBe("two.txt");
    await act(async () => uploads[2]!.resolve({...descriptor,sha256:"b".repeat(64),url:"media:two"}));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledOnce());
    expect(state.publish.mock.calls[0][2].map((file:{filename:string})=>file.filename)).toEqual(["one.txt","two.txt"]);
  });

  it("retains files in the same draft scope but a reload with missing bytes cannot send only the body", async () => {
    const {upload, uploads} = uploader();
    let host = await render(composer("retained-revisit", upload));
    await type(input(host), "needs file");
    await attachPending(host);
    await click(button(host, "platform.send"));
    await act(async () => uploads[0]!.reject(new TransportError("upload unknown")));
    await settle();
    await rerender(composer("another-draft", upload));
    await rerender(composer("retained-revisit", upload));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(input(host).textContent).toBe("needs file");
    expect(button(host,"platform.send").disabled).toBe(false);
    await act(async()=>{mounted!.root.unmount();mounted!.host.remove();mounted!.queryClient.clear();mounted=undefined;});
    // Same persisted names, but File bytes do not survive a fresh JS lifetime.
    clearAllDrafts();
    host = await render(composer("retained-revisit", upload));
    expect(input(host).textContent).toBe("needs file");
    await act(async()=>{input(host).dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));});
    await settle();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(state.publish).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="composer-queued-media-attachment"]')?.textContent).toContain("one.txt");
    expect(button(host,"platform.send").disabled).toBe(true);
  });

  it("does not lend recovered File bytes to another identity with the same draft key", async () => {
    const {upload, uploads} = uploader();
    const host = await render(composer("retained-identity", upload));
    await type(input(host), "alice file");
    await attachPending(host);
    await click(button(host,"platform.send"));
    await act(async()=>uploads[0]!.reject(new TransportError("lost receipt")));
    await settle();
    await rerender(<Composer workspaceId="workspace-a" draftIdentity="bob" draftKey="retained-identity" onUpload={upload}/>);
    expect(input(host).textContent).toBe("");
    expect(host.querySelector('[data-testid="composer-queued-media-attachment"]')).toBeNull();
    await rerender(composer("retained-identity",upload));
    expect(input(host).textContent).toBe("alice file");
    expect(button(host,"platform.send").disabled).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("does not write an old publication recovery into a later identity's draft store", async () => {
    let reject!: (error: unknown) => void;
    state.publish.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const {upload} = uploader();
    const host = await render(composer("shared-local-key", upload));
    await type(input(host), "alice pending");
    await click(button(host,"platform.send"));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledOnce());
    await rerender(<Composer workspaceId="workspace-a" draftIdentity="bob" draftKey="shared-local-key" onUpload={upload}/>);
    await type(input(host), "bob owns this draft");
    await act(async()=>reject(new TransportError("alice late receipt unknown")));
    await settle();
    expect(input(host).textContent).toBe("bob owns this draft");
    expect(loadPendingSend("shared-local-key")).toBeUndefined();
    expect(loadDraftEntry("shared-local-key")?.content).toBe("bob owns this draft");
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not let an old A publication replace a newer pending send after identity A to B to A", async () => {
    let rejectOld!: (error: unknown) => void;
    state.publish.mockImplementationOnce(() => new Promise((_resolve, fail) => { rejectOld = fail; }))
      .mockRejectedValueOnce(new TransportError("new A receipt unknown"));
    const {upload} = uploader();
    const host = await render(composer("aba", upload));
    await type(input(host), "old A");
    await click(button(host,"platform.send"));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledOnce());
    await rerender(<Composer workspaceId="workspace-a" draftIdentity="bob" draftKey="aba" onUpload={upload}/>);
    await rerender(composer("aba", upload));
    await type(input(host), "new A");
    await click(button(host,"platform.send"));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(2));
    await settle();
    const newerDraft = loadDraftEntry("aba");
    const newerPending = loadPendingSend("aba");
    await act(async()=>rejectOld(new TransportError("old A late receipt")));
    await settle();
    expect(input(host).textContent).toBe("new A");
    expect(loadDraftEntry("aba")).toEqual(newerDraft);
    expect(loadPendingSend("aba")).toEqual(newerPending);
    await click(button(host,"platform.send"));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(3));
    expect(state.publish.mock.calls[2][3]).toBe(state.publish.mock.calls[1][3]);
  });

  it("keeps a new owner edit UNKNOWN key when the retired owner edit is explicitly rejected", async () => {
    let rejectOld!: (error: unknown) => void;
    const publish = vi.fn().mockRejectedValueOnce(new TransportError("new edit unknown"))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockRejectedValue(new TransportError("new edit still unknown"));
    const target = {id:"e".repeat(64),author:"Alice",pubkey:"alice",body:"Original",createdAt:1,time:"",depth:0,tags:[]};
    const host = await render(<Composer draftIdentity="bob" draftKey="edit-owner" editTarget={{...target,pubkey:"bob"}} onPublish={publish}/>);
    await type(input(host), "new edit");
    await click(button(host,"platform.send"));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
    await settle();
    const key = publish.mock.calls[0][2];
    await rerender(<Composer draftIdentity="alice" draftKey="edit-owner" editTarget={target} onPublish={publish}/>);
    await type(input(host), "old edit");
    await click(button(host,"platform.send"));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    await rerender(<Composer draftIdentity="bob" draftKey="edit-owner" editTarget={{...target,pubkey:"bob"}} onPublish={publish}/>);
    expect(input(host).textContent).toBe("new edit");
    await act(async()=>rejectOld(new BffError(403,"rejected",{class:ErrorClass.Denied,reason:ReasonCode.PublishRejected})));
    await click(button(host,"platform.send"));
    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish.mock.calls[2][2]).toBe(key);
    expect(input(host).textContent).toBe("new edit");
  });

  const draftGif = {slug:"draft-gif",title:"Draft GIF",url:"https://static.klipy.com/draft.gif",previewUrl:"https://static.klipy.com/draft-preview.gif",width:40,height:30,previewWidth:40,previewHeight:30,size:99};
  function enableDraftGif() {
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("matchMedia", (query:string) => ({matches:false,media:query,addEventListener() {},removeEventListener() {},addListener() {},removeListener() {}}));
    state.gifs = [draftGif];
  }
  async function chooseDraftGif(host: HTMLElement) {
    await vi.waitFor(()=>expect((input(host) as HTMLElement & {editor?:Editor}).editor).toBeDefined());
    await act(async()=>input(host).focus());
    await settle();
    await vi.waitFor(()=>expect(host.querySelector('[data-testid="composer-emoji-button"]')?.getAttribute("aria-label")).toBe("Insert emoji or GIF"));
    await click(host.querySelector<HTMLElement>('[data-testid="composer-emoji-button"]')!);
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="composer-gif-tab"]')).not.toBeNull());
    const tab = document.querySelector<HTMLElement>('[data-testid="composer-gif-tab"]')!;
    await act(async()=>tab.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,button:0})));
    await click(tab);
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="klipy-gif-grid"] button')).not.toBeNull());
    await click(document.querySelector<HTMLElement>('[data-testid="klipy-gif-grid"] button')!);
    await settle();
  }

  it("persists a GIF-only unsent draft, restores it on return and sends one Markdown image without upload", async () => {
    enableDraftGif();
    const {upload} = uploader();
    const host = await render(composer("gif-only", upload));
    await type(input(host), "temporary caption");
    await type(input(host), "");
    await chooseDraftGif(host);
    expect(loadDraftEntry("gif-only")).toMatchObject({content:"",pendingImeta:[{sha256:"",type:"image/gif",url:draftGif.url}]});
    await rerender(composer("gif-other", upload));
    expect(host.querySelector('[data-testid="composer-gif-attachment"]')).toBeNull();
    await rerender(<div/>);
    await act(async()=>{ await new Promise(resolve=>setTimeout(resolve,20)); });
    await rerender(composer("gif-only", upload));
    expect(input(host).textContent).toBe("");
    expect(host.querySelectorAll('[data-testid="composer-gif-attachment"]')).toHaveLength(1);
    expect(upload).not.toHaveBeenCalled();
    await click(button(host,"platform.send"));
    await vi.waitFor(()=>expect(state.publish).toHaveBeenCalledOnce());
    expect(state.publish.mock.calls[0][1]).toBe(`![image](${draftGif.url})`);
    expect(state.publish.mock.calls[0][2]).toEqual([]);
  });

  it.each(["unsent", "unknown", "rejected"] as const)("consumes Inbox navigation for a GIF-only %s draft without duplicate publication", async (outcome) => {
    enableDraftGif();
    if (outcome === "unknown") state.publish.mockRejectedValue(new TransportError("GIF receipt unknown"));
    if (outcome === "rejected") state.publish.mockRejectedValue(new BffError(403,"rejected",{class:ErrorClass.Denied,reason:ReasonCode.PublishRejected}));
    const {upload} = uploader();
    const key = `gif-navigation-${outcome}`;
    const consume = vi.fn(async()=>{});
    const host = await render(composer(key, upload));
    await type(input(host), "temporary caption");
    await type(input(host), "");
    await chooseDraftGif(host);
    expect(loadDraftEntry(key)?.content).toBe("");
    if (outcome === "unknown") {
      await click(button(host,"platform.send"));
      await vi.waitFor(()=>expect(state.publish).toHaveBeenCalledOnce());
      await settle();
    }
    const originalKey = outcome === "unknown" ? state.publish.mock.calls[0][3] : undefined;
    await rerender(<div/>);
    await act(async()=>{ await new Promise(resolve=>setTimeout(resolve,20)); });
    const auto = <Composer workspaceId="workspace-a" draftIdentity="alice" draftKey={key}
      autoSendDraftKey={key} onAutoSendConsumed={consume} onUpload={upload}/>;
    await rerender(auto);
    await vi.waitFor(()=>expect(consume).toHaveBeenCalledOnce());
    if (outcome === "unknown") {
      await vi.waitFor(()=>expect(host.textContent).toContain("platform.sendUnknown"));
      expect(state.publish).toHaveBeenCalledOnce();
      expect(loadDraftEntry(key)?.sendIntent?.key).toBe(originalKey);
    } else {
      await vi.waitFor(()=>expect(state.publish).toHaveBeenCalledOnce());
      expect(consume.mock.invocationCallOrder[0]).toBeLessThan(state.publish.mock.invocationCallOrder[0]!);
    }
    expect(state.publish.mock.calls[0][1]).toBe(`![image](${draftGif.url})`);
    expect(state.publish.mock.calls[0][2]).toEqual([]);
    await settle();
    if (outcome === "unsent") {
      expect(loadDraftEntry(key)).toBeUndefined();
      expect(host.querySelector('[data-testid="composer-gif-attachment"]')).toBeNull();
    } else {
      if (outcome === "rejected" && recovery(host)) {
        expect(recovery(host)!.dataset.stage).toBe("failed");
        expect(loadPendingSend(key)?.extras).toMatchObject({gifs:[expect.objectContaining({url:draftGif.url})]});
        await click(recovery(host)!.querySelector<HTMLElement>('[data-testid="composer-pending-send-restore"]')!);
        await settle();
      }
      expect(host.querySelectorAll('[data-testid="composer-gif-attachment"]')).toHaveLength(1);
      expect(loadDraftEntry(key)?.pendingImeta).toEqual([expect.objectContaining({sha256:"",url:draftGif.url})]);
      if (outcome === "rejected") expect(loadDraftEntry(key)?.sendIntent).toBeUndefined();
    }
    await rerender(auto);
    await settle();
    expect(consume).toHaveBeenCalledOnce();
    expect(state.publish).toHaveBeenCalledOnce();
    if (outcome === "unknown") {
      await click(button(host,"platform.send"));
      await vi.waitFor(()=>expect(state.publish).toHaveBeenCalledTimes(2));
      expect(state.publish.mock.calls[1].slice(1,4)).toEqual(state.publish.mock.calls[0].slice(1,4));
    }
    expect(upload).not.toHaveBeenCalled();
  });

  it("holds GIF navigation while an original attachment upload is pending", async () => {
    enableDraftGif();
    const {upload,uploads} = uploader();
    const consume = vi.fn(async()=>{});
    const host = await render(composer("gif-upload-navigation", upload));
    await type(input(host), "caption");
    await chooseDraftGif(host);
    await attachPending(host);
    await rerender(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="gif-upload-navigation"
      autoSendDraftKey="gif-upload-navigation" onAutoSendConsumed={consume} onUpload={upload}/>);
    await settle();
    expect(consume).not.toHaveBeenCalled();
    expect(state.publish).not.toHaveBeenCalled();
    await act(async()=>uploads[0]!.resolve(descriptor));
    await vi.waitFor(()=>expect(state.publish).toHaveBeenCalledOnce());
    expect(consume).toHaveBeenCalledOnce();
    expect(state.publish.mock.calls[0][1]).toBe(`caption\n![image](${draftGif.url})`);
    expect(state.publish.mock.calls[0][2]).toEqual([expect.objectContaining({sha256:descriptor.sha256})]);
    expect(upload).toHaveBeenCalledOnce();
  });

  it("restores a confirmed file and selected GIF as distinct outgoing media", async () => {
    enableDraftGif();
    const {upload,uploads} = uploader();
    const host = await render(composer("gif-mixed", upload));
    await type(input(host), "mixed");
    await attachPending(host);
    await act(async()=>uploads[0]!.resolve(descriptor));
    await chooseDraftGif(host);
    expect(loadDraftEntry("gif-mixed")?.pendingImeta).toHaveLength(2);
    await rerender(composer("other", upload));
    await rerender(composer("gif-mixed", upload));
    await click(button(host,"platform.send"));
    await vi.waitFor(()=>expect(state.publish).toHaveBeenCalledOnce());
    expect(state.publish.mock.calls[0][1]).toBe(`mixed\n![image](${draftGif.url})`);
    expect(state.publish.mock.calls[0][2]).toEqual([expect.objectContaining({sha256:descriptor.sha256})]);
    expect(upload).toHaveBeenCalledOnce();
  });

  it("removes a restored GIF-only draft without resurrecting it on the next visit", async () => {
    enableDraftGif();
    const {upload} = uploader();
    const host = await render(composer("gif-remove", upload));
    await type(input(host), "temporary caption");
    await type(input(host), "");
    await chooseDraftGif(host);
    await rerender(composer("other", upload));
    await rerender(composer("gif-remove", upload));
    await click(host.querySelector<HTMLElement>('[data-testid="composer-gif-attachment"] button')!);
    await settle();
    expect(loadDraftEntry("gif-remove")).toBeUndefined();
    await rerender(composer("other", upload));
    await rerender(composer("gif-remove", upload));
    expect(host.querySelector('[data-testid="composer-gif-attachment"]')).toBeNull();
    expect(state.publish).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps an unsent GIF in its identity draft and preserves the UNKNOWN key on return", async () => {
    enableDraftGif();
    state.publish.mockRejectedValue(new TransportError("lost GIF response"));
    const {upload} = uploader();
    const identityComposer = (identity:string) => <Composer workspaceId="workspace-a" draftIdentity={identity} draftKey="gif-identity" onUpload={upload}/>;
    const host = await render(identityComposer("alice"));
    await type(input(host), "authored");
    await chooseDraftGif(host);
    await rerender(identityComposer("bob"));
    expect(host.querySelector('[data-testid="composer-gif-attachment"]')).toBeNull();
    expect(input(host).textContent).toBe("");
    await rerender(identityComposer("alice"));
    expect(host.querySelectorAll('[data-testid="composer-gif-attachment"]')).toHaveLength(1);
    await click(button(host,"platform.send"));
    await vi.waitFor(()=>expect(state.publish).toHaveBeenCalledOnce());
    await settle();
    const first = state.publish.mock.calls[0];
    expect(first[1]).toBe(`authored\n![image](${draftGif.url})`);
    await rerender(composer("other-unknown", upload));
    await rerender(identityComposer("alice"));
    await click(button(host,"platform.send"));
    await vi.waitFor(()=>expect(state.publish).toHaveBeenCalledTimes(2));
    expect(state.publish.mock.calls[1].slice(1,4)).toEqual(first.slice(1,4));
    expect(upload).not.toHaveBeenCalled();
  });

  it("restores selected GIF and failed local file across draft visits without uploading", async () => {
    const gif = {slug:"kept-gif",title:"Kept GIF",url:"https://static.klipy.com/kept.gif",previewUrl:"https://static.klipy.com/preview.gif",width:40,height:40,previewWidth:40,previewHeight:40,size:99};
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("matchMedia", (query:string) => ({matches:false,media:query,addEventListener() {},removeEventListener() {},addListener() {},removeListener() {}}));
    state.gifs = [gif];
    const {upload, uploads} = uploader();
    const host = await render(composer("gif-file", upload));
    await type(input(host), "body with GIF");
    await vi.waitFor(()=>expect(host.querySelector('[data-testid="composer-emoji-button"]')?.getAttribute("aria-label")).toBe("Insert emoji or GIF"), {timeout:15000});
    await click(host.querySelector<HTMLElement>('[data-testid="composer-emoji-button"]')!);
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="composer-gif-tab"]')).not.toBeNull(), {timeout:15000});
    const tab = document.querySelector<HTMLElement>('[data-testid="composer-gif-tab"]')!;
    await act(async()=>tab.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,button:0})));
    await click(tab);
    await vi.waitFor(()=>expect(document.querySelector('[data-testid="klipy-gif-grid"] button')).not.toBeNull(), {timeout:15000});
    await click(document.querySelector<HTMLElement>('[data-testid="klipy-gif-grid"] button')!);
    await attachPending(host);
    await click(button(host,"platform.send"));
    await act(async()=>uploads[0]!.reject(new TransportError("file receipt unknown")));
    // The unknown upload restores the frozen message into the composer; wait for that, not a settle count.
    await vi.waitFor(()=>expect(input(host).textContent).toBe("body with GIF"), {timeout:15000});
    await rerender(composer("other-gif-draft", upload));
    await rerender(composer("gif-file", upload));
    expect(host.querySelectorAll('[data-testid="composer-gif-attachment"]')).toHaveLength(1);
    expect(upload).toHaveBeenCalledOnce();
    await click(button(host,"platform.send"));
    await vi.waitFor(()=>expect(uploads).toHaveLength(2), {timeout:15000});
    await act(async()=>uploads[1]!.resolve(descriptor));
    await vi.waitFor(()=>expect(state.publish).toHaveBeenCalledOnce(), {timeout:15000});
    expect(state.publish.mock.calls[0][1]).toContain(gif.url);
    expect(state.publish.mock.calls[0][2]).toEqual([expect.objectContaining({sha256:descriptor.sha256})]);
  }, 30_000);

  it("keeps a failed send as a recovery when the composer has moved on", async () => {
    const {upload, uploads} = uploader();
    const host = await render(composer("queued-moved-on", upload));
    await type(input(host), "first");
    await attachPending(host);
    await click(button(host, "platform.send"));
    await type(input(host), "second");
    await act(async () => uploads[0]!.reject(new BffError(413, "too large")));
    await settle(); await settle();
    expect(input(host).textContent).toBe("second");
    expect(recovery(host)!.dataset.stage).toBe("failed");
    expect(recovery(host)!.querySelector<HTMLButtonElement>('[data-testid="composer-pending-send-restore"]')!.disabled).toBe(true);
    await type(input(host), "");
    await settle();
    await click(recovery(host)!.querySelector<HTMLElement>('[data-testid="composer-pending-send-restore"]')!);
    await settle();
    expect(input(host).textContent).toBe("first");
    expect(recovery(host)).toBeNull();
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("restores an UNKNOWN publication with its key: the retry is the same send", async () => {
    state.publish.mockRejectedValue(new TransportError("lost response"));
    const {upload, uploads} = uploader();
    const host = await render(composer("queued-unknown", upload));
    await type(input(host), "uncertain");
    await attachPending(host);
    await click(button(host, "platform.send"));
    await act(async () => uploads[0]!.resolve(descriptor));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
    await settle();
    const key = state.publish.mock.calls[0][3];
    expect(input(host).textContent).toBe("uncertain");
    expect(loadDraftEntry("queued-unknown")?.sendIntent?.key).toBe(key);
    await click(button(host, "platform.send"));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(2));
    expect(state.publish.mock.calls[1][3]).toBe(key);
    expect(state.publish.mock.calls[1][2]).toEqual(state.publish.mock.calls[0][2]);
    await rerender(composer("queued-unknown", upload));
    await settle();
    expect(state.publish).toHaveBeenCalledTimes(2);
  });

  it("offers a send left pending by a reload, never resending it by itself", async () => {
    const {upload} = uploader();
    const first = await render(composer("queued-reload", upload));
    await type(input(first), "before reload");
    await attachPending(first);
    await click(button(first, "platform.send"));
    expect(input(first).textContent).toBe("");
    // A fresh JS lifetime loses local bytes but retains the persisted message.
    act(() => mounted!.root.unmount());
    mounted!.host.remove();
    mounted = undefined;
    clearAllDrafts();
    const host = await render(composer("queued-reload", upload));
    await settle();
    expect(state.publish).not.toHaveBeenCalled();
    expect(input(host).textContent).toBe("");
    expect(recovery(host)!.dataset.stage).toBe("unknown");
    expect(recovery(host)!.textContent).toContain("platform.pendingSendMissingFiles");
    await click(recovery(host)!.querySelector<HTMLElement>('[data-testid="composer-pending-send-restore"]')!);
    await settle();
    expect(input(host).textContent).toBe("before reload");
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("an UNKNOWN pending send restored after a reload keeps its DD-81 key", async () => {
    state.publish.mockRejectedValue(new TransportError("lost response"));
    const {upload, uploads} = uploader();
    const first = await render(composer("queued-reload-unknown", upload));
    await type(input(first), "maybe delivered");
    await attachPending(first);
    await click(button(first, "platform.send"));
    // The composer moved on before the answer: the UNKNOWN send waits as a recovery.
    await type(input(first), "next thought");
    await act(async () => uploads[0]!.resolve(descriptor));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
    await settle();
    const key = state.publish.mock.calls[0][3];
    act(() => mounted!.root.unmount());
    mounted!.host.remove();
    mounted = undefined;
    const host = await render(composer("queued-reload-unknown", upload));
    await settle();
    expect(state.publish).toHaveBeenCalledTimes(1);
    expect(recovery(host)!.dataset.stage).toBe("unknown");
    expect(input(host).textContent).toBe("next thought");
    await type(input(host), "");
    await settle();
    await click(recovery(host)!.querySelector<HTMLElement>('[data-testid="composer-pending-send-restore"]')!);
    await settle();
    expect(input(host).textContent).toBe("maybe delivered");
    expect(loadDraftEntry("queued-reload-unknown")?.sendIntent?.key).toBe(key);
    expect(host.textContent).toContain("platform.sendUnknown");
    expect(state.publish).toHaveBeenCalledTimes(1);
  });

  it("clears an ordinary send at Send and restores it on a definite rejection with a fresh key next time", async () => {
    let reject!: (error: unknown) => void;
    state.publish.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="plain-reject" />);
    await type(input(host), "plain message");
    await click(button(host, "platform.send"));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
    expect(input(host).textContent).toBe("");
    expect(recovery(host)!.textContent).toContain("platform.pendingSendPublishing");
    expect(loadPendingSend("plain-reject")?.draft.sendIntent?.key).toBe(state.publish.mock.calls[0][3]);
    await act(async () => reject(new BffError(403, "rejected", { class: ErrorClass.Denied, reason: ReasonCode.PublishRejected })));
    await settle();
    expect(input(host).textContent).toBe("plain message");
    expect(host.textContent).toContain("platform.sendRejected");
    expect(loadPendingSend("plain-reject")).toBeUndefined();
    await click(button(host, "platform.send"));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(2));
    expect(state.publish.mock.calls[1][3]).not.toBe(state.publish.mock.calls[0][3]);
  });

  it("keeps a failed ordinary send as a recovery when the next message is already being written", async () => {
    let reject!: (error: unknown) => void;
    state.publish.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const host = await render(<Composer workspaceId="workspace-a" draftIdentity="alice" draftKey="plain-moved-on" />);
    await type(input(host), "first plain");
    await click(button(host, "platform.send"));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
    await type(input(host), "second plain");
    await act(async () => reject(new BffError(403, "rejected", { class: ErrorClass.Denied, reason: ReasonCode.PublishRejected })));
    await settle();
    expect(input(host).textContent).toBe("second plain");
    expect(recovery(host)!.dataset.stage).toBe("failed");
    expect(loadPendingSend("plain-moved-on")?.draft.content).toBe("first plain");
    await click(recovery(host)!.querySelector<HTMLElement>('[data-testid="composer-pending-send-discard"]')!);
    expect(recovery(host)).toBeNull();
    expect(loadPendingSend("plain-moved-on")).toBeUndefined();
    expect(input(host).textContent).toBe("second plain");
  });
});

describe("DD-144 Agent mention in a DM", () => {
  it("refuses an @Agent mention before sending and keeps the draft", async () => {
    const host = await render(<Composer workspaceId="workspace-a" channelType="dm" draftIdentity="alice" draftKey="dm-agent" />);
    await settle();
    await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "hey @Scout can you help");
    await click(button(host, "platform.send"));
    await settle();
    expect(state.publish).not.toHaveBeenCalled();
    expect(host.textContent).toContain("dm.agentMentionRefused");
    expect(host.querySelector('[data-testid="message-input"]')!.textContent).toBe("hey @Scout can you help");
  });
  it("sends a DM that names no Agent", async () => {
    const host = await render(<Composer workspaceId="workspace-a" channelType="dm" draftIdentity="alice" draftKey="dm-human" />);
    await settle();
    await type(host.querySelector<HTMLElement>('[data-testid="message-input"]')!, "hey @Scoutmaster");
    await click(button(host, "platform.send"));
    await vi.waitFor(() => expect(state.publish).toHaveBeenCalledTimes(1));
  });
});

