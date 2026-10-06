import { act, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { ThreadPanelSurface, ThreadReplyRegion, buildThreadPanelData } from "../src/react/messages/thread";
import { MessageRowSurface, type TimelineMessage } from "../src/react/messages";
import { render, click } from "./render";

const head: TimelineMessage = {id: "head", createdAt: 1, author: "Alice", pubkey: "alice", body: "Root", depth: 0, time: ""};
const branch: TimelineMessage = {...head, id: "branch", parentId: "head", rootId: "head", body: "Branch", createdAt: 2};
const child: TimelineMessage = {...branch, id: "child", parentId: "branch", body: "Child", createdAt: 3};
beforeEach(() => {
  setLocale("zh-CN");
  Object.defineProperty(window, "matchMedia", {configurable: true, value: () => ({matches: false, addEventListener() {}, removeEventListener() {}})});
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {configurable: true, value: vi.fn()});
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {configurable: true, value: vi.fn()});
});
function Harness({close}: {close: () => void}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [target, setTarget] = useState("head");
  const data = buildThreadPanelData([head, branch, child], "head", target, expanded);
  return <ThreadPanelSurface isFocusMode={false} channelId="channel" channelName="Channel" widthPx={380}
    threadHead={data.threadHead} threadReplies={data.visibleReplies} replyTargetMessage={data.replyTargetMessage}
    scrollTargetId={null} onScrollTargetResolved={() => {}} isSending={false} onClose={close}
    onExpandReplies={(message) => setExpanded((old) => {const next = new Set(old); if (!next.delete(message.id)) next.add(message.id); return next;})}
    onSelectReplyTarget={(message) => setTarget(message.id)} onCancelReply={() => setTarget("head")}
    renderRow={(row) => <MessageRowSurface {...row} layoutVariant="thread-reply" renderBody={() => row.message.body} />}
    renderComposer={(props) => <input aria-label={props.placeholder} data-testid="host-composer" defaultValue="preserved draft" />} />;
}
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
