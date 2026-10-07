// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MarkdownCodeBlock } from "../../src/shared/ui/markdown/CodeBlock";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { setLocale } from "@client-kit/platform/i18n";

const native = vi.hoisted(() => ({ copy: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/shared/api/tauriMedia", () => ({ copyTextToSystemClipboard: native.copy }));
vi.mock("@/shared/theme/ThemeProvider", () => ({ useTheme: () => ({ themeName: "buzz" }) }));

it("the native original wrapper injects its system clipboard into the same shared copy UI", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  setLocale("en");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<TooltipProvider><MarkdownCodeBlock language="text"><code>{"one\ntwo\n"}</code></MarkdownCodeBlock></TooltipProvider>));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Copy code block"]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(native.copy).toHaveBeenCalledExactlyOnceWith("one\ntwo");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
