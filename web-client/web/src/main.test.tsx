// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const mounted = vi.hoisted(() => ({ root: undefined as Root | undefined }));
vi.mock("react-dom/client", async (original) => {
  const actual = await original<typeof import("react-dom/client")>();
  return { ...actual, default: { ...actual, createRoot: (...args: Parameters<typeof actual.createRoot>) => {
    mounted.root = actual.createRoot(...args);
    return mounted.root;
  } } };
});
vi.mock("@/app/App", async () => {
  const { Tooltip, TooltipContent, TooltipTrigger } = await import("@client-kit/platform/react/sidebar/tooltip");
  return { App: () => <>{["first", "second"].map(label => <Tooltip key={label}>
    <TooltipTrigger asChild><button>{label}</button></TooltipTrigger>
    <TooltipContent>{label} hint</TooltipContent>
  </Tooltip>)}</> };
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
});

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
});
