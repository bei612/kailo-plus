// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const mounted = vi.hoisted(() => ({ root: undefined as Root | undefined, selectReaction: vi.fn() }));
vi.mock("react-dom/client", async (original) => {
  const actual = await original<typeof import("react-dom/client")>();
  return { ...actual, default: { ...actual, createRoot: (...args: Parameters<typeof actual.createRoot>) => {
    mounted.root = actual.createRoot(...args);
    return mounted.root;
  } } };
});
vi.mock("@/app/App", async () => {
  const { Tooltip, TooltipContent, TooltipTrigger } = await import("@client-kit/platform/react/sidebar/tooltip");
  const { MessageReactions, UserAvatar } = await import("@client-kit/platform/react/messages");
  return { App: () => <>{["first", "second"].map(label => <Tooltip key={label}>
    <TooltipTrigger asChild><button>{label}</button></TooltipTrigger>
    <TooltipContent>{label} hint</TooltipContent>
  </Tooltip>)}<MessageReactions messageId="admitted-message" canToggle pending={false}
    reactions={[{emoji:"👍",count:1,reactedByCurrentUser:false,users:[]}]}
    onSelect={mounted.selectReaction}/><UserAvatar avatarUrl={null} displayName="Agent"
      shape="squircle" testId="agent-avatar" /></> };
});
vi.mock("@/shared/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/shared/theme/ThemeProvider", () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => children }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(async () => {
  if (mounted.root) await act(async () => mounted.root!.unmount());
  mounted.root = undefined;
  document.body.replaceChildren();
  document.head.querySelector('meta[name="platform-display-name"]')?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const motion = {matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()};
vi.stubGlobal("matchMedia",()=>motion);
const canvasContext={setTransform:vi.fn(),clearRect:vi.fn(),drawImage:vi.fn(),fillText:vi.fn()};
vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);

const host = document.createElement("div");
host.id = "root";
document.body.append(host);
const displayName = document.createElement("meta");
displayName.name = "platform-display-name";
displayName.content = "Tooltip host fixture";
document.head.append(displayName);
await act(async () => { await import("./main"); });

it("uses the original shared root provider: deliberate dwell for every adjacent tooltip", async () => {
  vi.useFakeTimers();
  const { ROUNDED_SQUIRCLE_CLIP_ID, ROUNDED_SQUIRCLE_PATH } = await import("@client-kit/platform/react/thread/AvatarClipPaths");
  expect(host.querySelector('[data-testid="agent-avatar"]')?.classList.contains("rounded-squircle")).toBe(true);
  const clips = host.querySelectorAll(`clipPath[id="${ROUNDED_SQUIRCLE_CLIP_ID}"]`);
  expect(clips).toHaveLength(1);
  expect(clips[0].getAttribute("clipPathUnits")).toBe("objectBoundingBox");
  expect(clips[0].querySelector("path")?.getAttribute("d")).toBe(ROUNDED_SQUIRCLE_PATH);
  const [first, second] = [...host.querySelectorAll("button")];
  const pointer = async (button: HTMLButtonElement, type: string) => act(async () => {
    const event = new MouseEvent(type, { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    button.dispatchEvent(event);
  });
  const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  await pointer(first, "pointermove");
  await advance(499);
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await advance(1);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("first hint");
  expect(first.getAttribute("data-state")).toBe("delayed-open");

  await pointer(first, "pointerout");
  await advance(1);
  await pointer(second, "pointermove");
  await advance(499);
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await advance(1);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("second hint");
  expect(second.getAttribute("data-state")).toBe("delayed-open");

  // Drive the original MessageReactions consumer under the actual main root,
  // rather than invoking a test hook or creating a separate provider tree.
  const reaction=host.querySelector<HTMLButtonElement>('[data-testid="message-reactions"] button')!;
  await act(async()=>reaction.click());
  await advance(20);
  expect(canvasContext.drawImage).toHaveBeenCalled();
  expect(mounted.selectReaction).toHaveBeenCalledExactlyOnceWith("👍");

  const shared=await import("@client-kit/platform/react/emoji-burst");
  const desktop=await import("../../../collaboration/desktop/src/shared/ui/EmojiBurstProvider");
  expect(desktop.EmojiBurstProvider).toBe(shared.EmojiBurstProvider);
  expect(desktop.useEmojiBurst).toBe(shared.useEmojiBurst);

  // Let the original finite animation finish, then change the real preference
  // subscription: reduced motion suppresses visuals, not the governed action.
  await advance(4_000);
  canvasContext.drawImage.mockClear();
  motion.matches=true;
  const sync=motion.addEventListener.mock.calls.at(-1)![1] as () => void;
  sync();
  await act(async()=>reaction.click());
  await advance(20);
  expect(canvasContext.drawImage).not.toHaveBeenCalled();
  expect(mounted.selectReaction).toHaveBeenCalledTimes(2);
});
