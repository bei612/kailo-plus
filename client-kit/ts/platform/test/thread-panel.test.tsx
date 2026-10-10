import { act, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { MessageThreadSummaryRow, ThreadPanelSurface, ThreadReplyRegion, buildThreadPanelData } from "../src/react/messages/thread";
import { buildMainTimelineEntries } from "../src/react/messages/thread/threadPanel";
import { MessageRowSurface, type TimelineMessage } from "../src/react/messages";
import { render, click } from "./render";
import { buildAnimatedAvatarUrl } from "../src/react/profile/buzz/shared/lib/animatedAvatar";

const head: TimelineMessage = {id: "head", createdAt: 1, author: "Alice", pubkey: "alice", body: "Root", depth: 0, time: ""};
const branch: TimelineMessage = {...head, id: "branch", parentId: "head", rootId: "head", body: "Branch", createdAt: 2};
const child: TimelineMessage = {...branch, id: "child", parentId: "branch", body: "Child", createdAt: 3};
beforeEach(() => {
  setLocale("zh-CN");
  Object.defineProperty(window, "matchMedia", {configurable: true, value: () => ({matches: false, addEventListener() {}, removeEventListener() {}})});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {configurable: true, value: vi.fn()});
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {configurable: true, value: vi.fn()});
});
afterEach(() => vi.unstubAllGlobals());
function Harness({close, messages = [head, branch, child], resolveMediaUrl, typingPubkeys = [], typingChannel, typingAvatar = null, disabled = false}: {
  close: () => void;
  messages?: TimelineMessage[];
  resolveMediaUrl?: (url: string) => string | undefined;
  typingPubkeys?: string[];
  typingAvatar?: string | null;
  typingChannel?: import("react").ComponentProps<typeof ThreadPanelSurface>["typingChannel"];
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState("head");
  const data = buildThreadPanelData(messages, "head", target, expanded);
  return <ThreadPanelSurface isFocusMode={false} channelId="channel" channelName="Channel" widthPx={380}
    resolveMediaUrl={resolveMediaUrl}
    disabled={disabled} threadTypingPubkeys={typingPubkeys} typingChannel={typingChannel}
    profiles={{bob:{displayName:"Bob",avatarUrl:typingAvatar,nip05Handle:null,ownerPubkey:null}}}
    threadHead={data.threadHead} threadReplies={data.visibleReplies} replyTargetMessage={data.replyTargetMessage}
    scrollTargetId={null} onScrollTargetResolved={() => {}} isSending={false} onClose={close}
    onExpandReplies={(message) => setExpanded((old) => {const next = new Set(old); if (!next.delete(message.id)) next.add(message.id); return next;})}
    onSelectReplyTarget={(message) => setTarget(message.id)} onCancelReply={() => setTarget("head")}
    renderRow={(row) => <MessageRowSurface {...row} layoutVariant="thread-reply" renderBody={() => row.message.body} />}
    renderComposer={(props) => <input aria-label={props.placeholder} data-testid="host-composer" defaultValue="preserved draft" />} />;
}
it.each(["en", "zh-CN"] as const)("restores the original %s thread typing activity rail without replacing the composer", async (locale) => {
  setLocale(locale);
  function Activity() {
    const [enabled, setEnabled] = useState(true);
    return <><button onClick={() => setEnabled(false)}>clear activity</button>
      <Harness close={vi.fn()} typingPubkeys={enabled ? ["bob"] : []} /></>;
  }
  const host = await render(<Activity />);
  const composer = host.querySelector('[data-testid="host-composer"]');
  const dock = host.querySelector('[data-testid="thread-composer-overlay"] .composer-dock')!;
  expect(dock.classList.contains("composer-dock--with-activity")).toBe(true);
  const indicator = dock.querySelector('[data-testid="message-typing-indicator"]')!;
  expect(indicator.textContent).toContain(locale === "en" ? "Bob is typing" : "Bob正在输入");
  expect(indicator.className).toContain("py-0");
  expect(indicator.closest(".composer-dock-activity")?.className).toContain("absolute");
  await click([...host.querySelectorAll("button")].find(button => button.textContent === "clear activity")!);
  expect(dock.classList.contains("composer-dock--with-activity")).toBe(false);
  await vi.waitFor(() => expect(dock.querySelector('[data-testid="message-typing-indicator"]')).toBeNull());
  expect(host.querySelector('[data-testid="host-composer"]')).toBe(composer);
  expect((composer as HTMLInputElement).value).toBe("preserved draft");
});
it("does not expose thread typing when the admitted host is disabled", async () => {
  const host = await render(<Harness close={vi.fn()} typingPubkeys={["bob"]} disabled />);
  expect(host.querySelector('[data-testid="message-typing-indicator"]')).toBeNull();
  expect(host.querySelector(".composer-dock--with-activity")).toBeNull();
});
it("keeps typing avatars on the actual host media resolver and rejects unadmitted URLs", async () => {
  const avatar = "https://publisher.example/avatar.png";
  const attempted: string[] = [];
  vi.stubGlobal("Image", function () {
    const image = document.createElement("img");
    Object.defineProperty(image, "src", {set: (url: string) => attempted.push(url)});
    return image;
  });
  const resolver = vi.fn(() => undefined);
  const host = await render(<Harness close={vi.fn()} typingPubkeys={["bob"]} typingAvatar={avatar} resolveMediaUrl={resolver} />);
  expect(host.querySelector('[data-testid="message-typing-indicator"]')?.textContent).toContain("Bob正在输入");
  expect(resolver).toHaveBeenCalledWith(avatar);
  expect(host.querySelector('[data-testid="message-typing-avatar"] img')).toBeNull();
  expect(attempted).toEqual([]);
});
it("uses the original DM participant fallback when the native channel has no fetched profile", async () => {
  const host = await render(<Harness close={vi.fn()} typingPubkeys={["peer"]}
    typingChannel={{channelType:"dm",participantPubkeys:["peer"],participants:["Direct peer"]}} />);
  expect(host.querySelector('[data-testid="message-typing-indicator"]')?.textContent).toContain("Direct peer正在输入");
});
it("shares the original tree, collapsed summary, guides, dock and close control without remounting a host draft", async () => {
  const close = vi.fn(); const host = await render(<Harness close={close} />);
  expect(host.querySelector('[data-testid="message-thread-head"]')?.textContent).toContain("Root");
  expect(host.textContent).not.toContain("Child");
  const input = host.querySelector<HTMLInputElement>('[data-testid="host-composer"]')!;
  const summary = host.querySelector<HTMLButtonElement>('[data-testid="message-thread-summary"]')!;
  expect(summary).not.toBeNull();
  await click(summary);
  expect(host.textContent).toContain("Child");
  const rail = host.querySelector<HTMLButtonElement>('[data-testid="thread-collapse-rail"]')!;
  expect(rail).not.toBeNull();
  await click(rail);
  expect(host.textContent).not.toContain("Child");
  expect(host.querySelector('[data-testid="thread-composer-overlay"]')?.className).toContain("absolute");
  expect(host.querySelector('[data-testid="host-composer"]')).toBe(input);
  expect(input.value).toBe("preserved draft");
  await click(host.querySelector<HTMLButtonElement>('[aria-label="关闭面板"]')!);
  expect(close).toHaveBeenCalledTimes(1);
});
it("keeps original main-list and collapsed-branch avatars on the actual host media resolver", async () => {
  vi.stubGlobal("Image", function () {
    const image = document.createElement("img");
    let source = "";
    Object.defineProperties(image, {complete: {value: true}, naturalWidth: {value: 1}});
    Object.defineProperty(image, "src", {get: () => source, set: (value: string) => {
      source = value;
      queueMicrotask(() => image.dispatchEvent(new Event("load")));
    }});
    return image;
  });
  const poster = "https://community.example/media/poster.png";
  const animation = "https://community.example/media/animation.png";
  const avatarUrl = buildAnimatedAvatarUrl(poster, animation);
  const paths: Record<string, string> = {[poster]: "/admitted-media/poster.png", [animation]: "/admitted-media/animation.png"};
  const resolveMediaUrl = vi.fn((url: string) => paths[url]);
  const participant = {...child, pubkey: "participant", author: "Participant", avatarUrl};
  const main = buildMainTimelineEntries([head, {...participant, parentId: "head"}])[0]!;
  const open = vi.fn();
  const mainHost = await render(<MessageThreadSummaryRow message={main.message} summary={main.summary!}
    onOpenThread={open} resolveMediaUrl={resolveMediaUrl} />);
  await vi.waitFor(() => expect(mainHost.querySelector<HTMLImageElement>('[data-testid="message-thread-summary-avatar-0-image"]')?.getAttribute("src")).toBe(paths[poster]));
  await click(mainHost.querySelector<HTMLButtonElement>('[data-testid="message-thread-summary"]')!);
  expect(open).toHaveBeenCalledWith(head);
  const host = await render(<Harness close={vi.fn()} resolveMediaUrl={resolveMediaUrl}
    messages={[head, branch, participant]} />);
  const imageSource = () => host.querySelector<HTMLImageElement>('[data-testid="message-thread-summary-avatar-0-image"]')?.getAttribute("src");
  await vi.waitFor(() => expect(imageSource()).toBe(paths[poster]));
  const avatar = host.querySelector<HTMLElement>('[data-testid="message-thread-summary-avatar-0"]')!;
  expect(avatar.className).toContain("h-6 w-6 text-2xs");
  expect(avatar.dataset.avatarShape).toBe("circle");
  await act(async () => avatar.dispatchEvent(new MouseEvent("mouseover", {bubbles: true})));
  await vi.waitFor(() => expect(imageSource()).toBe(paths[animation]));
  await act(async () => avatar.dispatchEvent(new MouseEvent("mouseout", {bubbles: true})));
  await vi.waitFor(() => expect(imageSource()).toBe(paths[poster]));
  const summary = host.querySelector<HTMLButtonElement>('[data-testid="message-thread-summary"]')!;
  expect(summary.className).toContain("h-[1.875rem]");
  await click(summary);
  expect(host.querySelector('[data-testid="message-thread-summary"]')).toBeNull();
  expect(host.textContent).toContain("Child");
  expect(host.querySelector<HTMLInputElement>('[data-testid="host-composer"]')?.value).toBe("preserved draft");
  expect(resolveMediaUrl).toHaveBeenCalledWith(poster);
  expect(resolveMediaUrl).toHaveBeenCalledWith(animation);
});
it("renders terminal failure as the original retry card, never an empty thread, and updates locale", async () => {
  const retry = vi.fn();
  const host = await render(<ThreadReplyRegion isPending={false} isError deferredCount={0} liveCount={0} onRetry={retry} renderSkeleton={() => "skeleton"} renderList={() => "list"} />);
  expect(host.textContent).toContain("无法加载回复");
  expect(host.textContent).not.toContain("此分支尚无回复");
  await click(host.querySelector<HTMLButtonElement>('[data-testid="message-thread-replies-retry"]')!);
  expect(retry).toHaveBeenCalledTimes(1);
  await act(async () => setLocale("en"));
  expect(host.textContent).toContain("Couldn’t load replies");
});
