import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  track = new FakeTrack();
  getTracks() {
    return [this.track];
  }
}

class FakeRecorder extends dom.window.EventTarget {
  static isTypeSupported() {
    return true;
  }
  mimeType = "audio/webm";
  state = "inactive";
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.dispatchEvent(
      new dom.window.MessageEvent("dataavailable", {
        data: new Blob([new Uint8Array([1])], { type: this.mimeType }),
      }),
    );
    this.dispatchEvent(new dom.window.Event("stop"));
  }
}

const decodeResolvers = [];
let onAudioContextClose;
class FakeAudioContext {
  close() {
    onAudioContextClose?.();
    return Promise.resolve();
  }
  createAnalyser() {
    return {
      fftSize: 0,
      smoothingTimeConstant: 0,
      getByteTimeDomainData() {},
    };
  }
  createMediaStreamSource() {
    return { connect() {} };
  }
  decodeAudioData() {
    return new Promise((resolve) => decodeResolvers.push(resolve));
  }
}

const streams = [];
const acquireFakeStream = async () => {
  const stream = new FakeStream();
  streams.push(stream);
  return stream;
};
let getUserMediaImpl = acquireFakeStream;
before(() => {
  Object.assign(globalThis, {
    AudioContext: FakeAudioContext,
    document: dom.window.document,
    DOMException: dom.window.DOMException,
    CustomEvent: dom.window.CustomEvent,
    Element: dom.window.Element,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    MutationObserver: dom.window.MutationObserver,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    IS_REACT_ACT_ENVIRONMENT: true,
    MediaRecorder: FakeRecorder,
    window: dom.window,
  });
  Object.defineProperty(dom.window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: (...args) => getUserMediaImpl(...args),
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  dom.window.MediaRecorder = FakeRecorder;
  dom.window.AudioContext = FakeAudioContext;
});

after(() => dom.window.close());

test("the original toolbar emoji trigger follows the real recorder state without changing attachment gating", async () => {
  const { createElement, useState } = await import("react");
  const { act, cleanup, render } = await import("@testing-library/react");
  const { useVoiceNoteRecorder } = await import(
    "@client-kit/platform/react/composer/features/messages/lib/useVoiceNoteRecorder"
  );
  const { MessageComposerToolbar } = await import(
    "@client-kit/platform/react/composer/features/messages/ui/MessageComposerToolbar"
  );
  const { TooltipProvider } = await import(
    "@client-kit/platform/react/sidebar/tooltip"
  );
  let recorder;
  let hasAttachment = false;
  function Composer() {
    const [emojiOpen, setEmojiOpen] = useState(false);
    recorder = useVoiceNoteRecorder();
    return createElement(
      TooltipProvider,
      null,
      createElement(MessageComposerToolbar, {
        editor: null,
        composerDisabled: false,
        formattingDisabled: false,
        isEmojiPickerOpen: emojiOpen,
        onEmojiPickerOpenChange: setEmojiOpen,
        isFormattingOpen: false,
        isSending: false,
        isUploading: false,
        isVoiceNoteRecording: recorder.status !== "idle",
        hasVoiceNoteAttachment: hasAttachment,
        sendDisabled: false,
        onFormattingToggle() {},
        onLinkButton() {},
        onPaperclip() {},
        onVoiceNote() {},
      }),
    );
  }
  const host = render(createElement(Composer));
  const emojiTrigger = () =>
    host.container.querySelector('[data-testid="composer-emoji-button"]');
  const fileTrigger = () =>
    host.container.querySelector(
      'button[aria-label="Attach file"],button[aria-label="添加附件"]',
    );
  try {
    assert.equal(emojiTrigger()?.disabled, false);
    await act(() => recorder.start());
    assert.equal(recorder.status, "recording");
    assert.equal(emojiTrigger()?.disabled, true);
    act(() => recorder.cancel());
    assert.equal(recorder.status, "idle");
    assert.equal(emojiTrigger()?.disabled, false);
    hasAttachment = true;
    host.rerender(createElement(Composer));
    assert.equal(
      emojiTrigger()?.disabled,
      false,
      "the original voice attachment restriction is GIF-only, not ordinary emoji",
    );
    assert.equal(fileTrigger()?.disabled, true);
  } finally {
    host.unmount();
    cleanup();
  }
});

test("permission acquisition is visible, cancellable, and releases a late stream", async () => {
  const { act, cleanup, renderHook } = await import("@testing-library/react");
  const { useVoiceNoteRecorder } = await import(
    "@client-kit/platform/react/composer/features/messages/lib/useVoiceNoteRecorder"
  );
  const { result, unmount } = renderHook(() => useVoiceNoteRecorder());
  const stream = new FakeStream();
  let resolvePermission;
  getUserMediaImpl = () =>
    new Promise((resolve) => {
      resolvePermission = resolve;
    });

  try {
    let startPromise;
    act(() => {
      startPromise = result.current.start();
    });
    assert.equal(result.current.status, "requesting");

    act(() => result.current.cancel());
    assert.equal(result.current.status, "idle");

    await act(async () => {
      resolvePermission(stream);
      await startPromise;
    });
    assert.equal(stream.track.stopped, true);
    assert.equal(result.current.status, "idle");
  } finally {
    getUserMediaImpl = acquireFakeStream;
    unmount();
    cleanup();
  }
});

test("remains usable after Strict Mode replays the mount effect", async () => {
  const { StrictMode, createElement } = await import("react");
  const { act, cleanup, renderHook } = await import("@testing-library/react");
  const { useVoiceNoteRecorder } = await import(
    "@client-kit/platform/react/composer/features/messages/lib/useVoiceNoteRecorder"
  );
  const { result, unmount } = renderHook(() => useVoiceNoteRecorder(), {
    wrapper: ({ children }) => createElement(StrictMode, null, children),
  });

  try {
    await act(() => result.current.start());
    assert.equal(result.current.status, "recording");
    assert.equal(streams.at(-1).track.stopped, false);
  } finally {
    unmount();
    cleanup();
  }
});

test("a cancelled decode cannot stop or attach over a newer recording", async () => {
  const { act, cleanup, renderHook } = await import("@testing-library/react");
  const { useVoiceNoteRecorder } = await import(
    "@client-kit/platform/react/composer/features/messages/lib/useVoiceNoteRecorder"
  );
  const { result, unmount } = renderHook(() => useVoiceNoteRecorder());

  try {
    await act(() => result.current.start());
    let firstFinish;
    await act(async () => {
      firstFinish = result.current.stop();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(decodeResolvers.length, 1);

    act(() => result.current.cancel());
    assert.equal(await firstFinish, null);
    await act(() => result.current.start());
    const secondTrack = streams.at(-1).track;

    await act(async () => {
      decodeResolvers.shift()({
        duration: 1,
        getChannelData: () => new Float32Array([0]),
        numberOfChannels: 1,
        sampleRate: 8_000,
      });
      await Promise.resolve();
    });

    assert.equal(secondTrack.stopped, false);
    assert.equal(result.current.status, "recording");
  } finally {
    unmount();
    cleanup();
  }
});

test("starting the original composer voice note closes the controlled emoji popup and formatting", async () => {
  const { createElement, useState } = await import("react");
  const { act, cleanup, render } = await import("@testing-library/react");
  const { useComposerVoiceNote } = await import(
    "@client-kit/platform/react/composer/features/messages/ui/useComposerVoiceNote"
  );
  const { MessageComposerToolbar } = await import(
    "@client-kit/platform/react/composer/features/messages/ui/MessageComposerToolbar"
  );
  const { TooltipProvider } = await import(
    "@client-kit/platform/react/sidebar/tooltip"
  );
  const media = {
    pendingImetaRef: { current: [] },
    queuedAttachmentsRef: { current: [] },
    uploadFile: async () => {},
  };
  let voiceNote;
  let emojiOpen;
  let formattingOpen;
  const closed = [];
  function Composer() {
    const [emoji, setEmoji] = useState(true);
    const [formatting, setFormatting] = useState(false);
    emojiOpen = emoji;
    formattingOpen = formatting;
    voiceNote = useComposerVoiceNote({
      draftKey: "recording-draft",
      editTargetId: null,
      media,
      setEmojiPickerOpen: (open) => {
        closed.push(["emoji", open]);
        setEmoji(open);
      },
      setFormattingOpen: (open) => {
        closed.push(["formatting", open]);
        setFormatting(open);
      },
    });
    return createElement(
      TooltipProvider,
      null,
      createElement(MessageComposerToolbar, {
        editor: null,
        composerDisabled: false,
        formattingDisabled: false,
        isEmojiPickerOpen: emoji,
        onEmojiPickerOpenChange: setEmoji,
        isFormattingOpen: formatting,
        isSending: false,
        isUploading: false,
        isVoiceNoteRecording: voiceNote.status !== "idle",
        sendDisabled: false,
        onFormattingToggle: setFormatting,
        onLinkButton() {},
        onPaperclip() {},
        onVoiceNote: voiceNote.toggle,
      }),
    );
  }
  const host = render(createElement(Composer));
  const trigger = () =>
    host.container.querySelector('[data-testid="composer-emoji-button"]');
  const voiceTrigger = () =>
    host.container.querySelector("svg.lucide-mic")?.closest("button");
  try {
    assert.equal(trigger()?.getAttribute("aria-expanded"), "true");
    await act(async () => {
      voiceTrigger().click();
      await Promise.resolve();
    });
    assert.equal(voiceNote.status, "recording");
    assert.equal(emojiOpen, false);
    assert.equal(formattingOpen, false);
    assert.deepEqual(closed, [
      ["emoji", false],
      ["formatting", false],
    ]);
    assert.equal(trigger()?.getAttribute("aria-expanded"), "false");
    assert.equal(trigger()?.disabled, true);
  } finally {
    host.unmount();
    cleanup();
  }
});

test("the original edit-target context cancels recording without changing the draft key", async () => {
  const { act, cleanup, renderHook } = await import("@testing-library/react");
  const { useComposerVoiceNote } = await import(
    "@client-kit/platform/react/composer/features/messages/ui/useComposerVoiceNote"
  );
  const uploaded = [];
  const media = {
    pendingImetaRef: { current: [] },
    queuedAttachmentsRef: { current: [] },
    uploadFile: async (file) => uploaded.push(file),
  };
  const { result, rerender, unmount } = renderHook(
    ({ editTargetId }) =>
      useComposerVoiceNote({
        draftKey: null,
        editTargetId,
        media,
        setEmojiPickerOpen() {},
        setFormattingOpen() {},
      }),
    { initialProps: { editTargetId: "original-edit" } },
  );
  try {
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    const track = streams.at(-1).track;
    assert.equal(result.current.status, "recording");
    rerender({ editTargetId: "other-edit" });
    assert.equal(result.current.status, "idle");
    assert.equal(track.stopped, true);
    assert.deepEqual(uploaded, []);
  } finally {
    unmount();
    cleanup();
  }
});

test("a completed decode cannot upload into a new edit context even after recorder cancellation is no longer applicable", async () => {
  const { act, cleanup, renderHook } = await import("@testing-library/react");
  const { flushSync } = await import("react-dom");
  const { useComposerVoiceNote } = await import(
    "@client-kit/platform/react/composer/features/messages/ui/useComposerVoiceNote"
  );
  const uploaded = [];
  const media = {
    pendingImetaRef: { current: [] },
    queuedAttachmentsRef: { current: [] },
    uploadFile: async (file) => uploaded.push(file),
  };
  const { result, rerender, unmount } = renderHook(
    ({ editTargetId }) =>
      useComposerVoiceNote({
        draftKey: "same-draft",
        editTargetId,
        media,
        setEmojiPickerOpen() {},
        setFormattingOpen() {},
      }),
    { initialProps: { editTargetId: "original-edit" } },
  );
  try {
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    let finished;
    await act(async () => {
      finished = result.current.finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(result.current.status, "processing");
    assert.equal(decodeResolvers.length, 1);
    // Audio release precedes the real stop-promise resolution. Switch only
    // after the recorder completes, before the composer's await resumes.
    onAudioContextClose = () => {
      onAudioContextClose = undefined;
      queueMicrotask(() =>
        flushSync(() => rerender({ editTargetId: "other-edit" })),
      );
    };
    let recording;
    await act(async () => {
      decodeResolvers.shift()({
        duration: 1,
        getChannelData: () => new Float32Array([0]),
        numberOfChannels: 1,
        sampleRate: 8_000,
      });
      recording = await finished;
    });
    assert.ok(
      recording?.file,
      "the real recorder returned bytes, not a cancelled null result",
    );
    assert.equal(result.current.status, "idle");
    assert.deepEqual(uploaded, []);
  } finally {
    onAudioContextClose = undefined;
    unmount();
    cleanup();
  }
});

test("the unchanged original composer context uploads exactly one completed recording", async () => {
  const { act, cleanup, renderHook } = await import("@testing-library/react");
  const { useComposerVoiceNote } = await import(
    "@client-kit/platform/react/composer/features/messages/ui/useComposerVoiceNote"
  );
  const uploaded = [];
  const media = {
    pendingImetaRef: { current: [] },
    queuedAttachmentsRef: { current: [] },
    uploadFile: async (file) => uploaded.push(file),
  };
  const { result, unmount } = renderHook(() =>
    useComposerVoiceNote({
      draftKey: "same-draft",
      editTargetId: "same-edit",
      media,
      setEmojiPickerOpen() {},
      setFormattingOpen() {},
    }),
  );
  try {
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    let finished;
    await act(async () => {
      finished = result.current.finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      decodeResolvers.shift()({
        duration: 1,
        getChannelData: () => new Float32Array([0]),
        numberOfChannels: 1,
        sampleRate: 8_000,
      });
      await finished;
    });
    assert.equal(uploaded.length, 1);
    assert.equal(uploaded[0].type, "audio/wav");
    assert.equal(result.current.status, "idle");
  } finally {
    unmount();
    cleanup();
  }
});
