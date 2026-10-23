// REQ-24: Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/app/AppTopChrome.tsx
// (global Back/Forward) and desktop/src/app/RootErrorBoundary.tsx.
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { RootErrorBoundary } from "../src/react/root-error-boundary";
import { TopChromeHistoryButtons } from "../src/react/top-chrome-history";
import { click, render } from "./render";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
});

it("renders the original Back/Forward buttons with history availability and host callbacks", async () => {
  const back = vi.fn();
  const forward = vi.fn();
  const host = await render(<TopChromeHistoryButtons canGoBack canGoForward={false} onGoBack={back} onGoForward={forward} />);
  const goBack = host.querySelector<HTMLButtonElement>("[data-testid=global-back]")!;
  const goForward = host.querySelector<HTMLButtonElement>("[data-testid=global-forward]")!;
  expect(goBack.getAttribute("aria-label")).toBe("Go back");
  expect(goForward.getAttribute("aria-label")).toBe("Go forward");
  expect(goBack.disabled).toBe(false);
  expect(goForward.disabled).toBe(true);
  await click(goBack);
  expect(back).toHaveBeenCalledOnce();
  await act(async () => setLocale("zh-CN"));
  expect(host.querySelector("[data-testid=global-back]")?.getAttribute("aria-label")).toBe("后退");
  expect(host.querySelector("[data-testid=global-forward]")?.getAttribute("aria-label")).toBe("前进");
});

it("replaces an uncaught render error with the original Reload splash", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function Broken(): never { throw new Error("storage denied"); }
  const host = await render(<RootErrorBoundary><Broken /></RootErrorBoundary>);
  const splash = host.querySelector("[data-testid=root-error-boundary]")!;
  expect(splash.textContent).toContain("The app failed to start");
  expect(splash.querySelector("button")?.textContent).toBe("Reload");
  const healthy = await render(<RootErrorBoundary><p>ready</p></RootErrorBoundary>);
  expect(healthy.textContent).toBe("ready");
});
