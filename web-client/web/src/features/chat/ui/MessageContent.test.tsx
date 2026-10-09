// @vitest-environment jsdom
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { createBffClient } from "@client-kit/platform/client";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { t } from "@/shared/i18n";
const client = createBffClient({ send: async () => { throw new Error("Rendering performs no BFF writes"); } });
const renderToStaticMarkup = (ui: ReactNode) => renderMarkup(<PlatformProvider client={client} locale="en"><TooltipProvider>{ui}</TooltipProvider></PlatformProvider>);

const PERSON = "11".repeat(32);
const AGENT = "22".repeat(32);
const MULTILINE_CONTENT = "@Alex 第一行\n@Codex(remote) 第二行";
const PLAIN_CONTENT = "@Unknown and `@Alex`";
const IMAGE_URL = "https://relay.example.com/media/poster.png";
const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const SHA = "ab".repeat(32);

describe("MessageContent", () => {
  it("copies the fenced message's actual code through the shared original control", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<PlatformProvider client={client} locale="en"><TooltipProvider><MessageContent content={"```\nfirst\nsecond\n```"} /></TooltipProvider></PlatformProvider>));
      const button = host.querySelector<HTMLButtonElement>('button[aria-label="Copy code block"]');
      expect(button).not.toBeNull();
      await act(async () => button!.click());
      expect(writeText).toHaveBeenCalledExactlyOnceWith("first\nsecond");
      expect(host.querySelector('[data-code-block] pre')).not.toBeNull();
    } finally {
      await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
    }
  });
  it("renders original NIP-30 emoji through the scoped BFF blob route, never its remote origin", () => {
    const url = `https://relay.example.com/media/${SHA}.png`;
    const html = renderToStaticMarkup(<MessageContent workspaceId={WORKSPACE} content=":party:" mediaTags={[["emoji", "party", url]]} />);
    expect(html).toContain('data-custom-emoji=""');
    expect(html).toContain(`src="/api/v1/workspaces/${WORKSPACE}/media/${SHA}"`);
    expect(html).not.toContain(`src="${url}"`);
    const outside = renderToStaticMarkup(<MessageContent workspaceId={WORKSPACE} content=":party:" mediaTags={[["emoji", "party", "https://external.example/tracking.png"]]} />);
    expect(outside).not.toContain("<img");
    expect(outside).toContain(":party:");
  });
  it("renders admitted snapshot text through the original preview without remote images", () => {
    const href = "https://example.com/product";
    const snapshot = ["link-preview", "snapshot", "1", href, "Signed title", "Example", "Signed description", IMAGE_URL, SHA, IMAGE_URL, SHA];
    const html = renderToStaticMarkup(<MessageContent workspaceId={WORKSPACE} content={href} mediaTags={[snapshot]} />);
    expect(html).toContain('data-link-preview="generic-link"');
    expect(html).toContain("Signed title");
    expect(html).toContain("Signed description");
    expect(html).not.toContain("<img");
    expect(html).not.toContain(IMAGE_URL);
    const suppressed = renderToStaticMarkup(<MessageContent workspaceId={WORKSPACE} content={href} mediaTags={[snapshot, ["link-preview", "none"]]} />);
    expect(suppressed).not.toContain("data-link-preview=");
    expect(suppressed).toContain(href);
  });
  it("keeps original image and text spoilers hidden while preserving admitted media reads", () => {
    const html = renderToStaticMarkup(
      <MessageContent
        content={`||hidden text||\n\n||![poster](${IMAGE_URL})||`}
        mediaTags={[["imeta", `url ${IMAGE_URL}`, "m image/png", `x ${SHA}`]]}
        workspaceId={WORKSPACE}
      />,
    );
    expect(html.match(/data-revealed="false"/g)).toHaveLength(2);
    expect(html.match(/aria-label="Reveal spoiler"/g)).toHaveLength(2);
    expect(html).toContain("buzz-spoiler--block");
    expect(html).toContain(`src="/api/v1/workspaces/${WORKSPACE}/media/${SHA}"`);
    expect(html).not.toContain(`src="${IMAGE_URL}"`);
  });

  it("renders human and agent mentions and preserves soft line breaks", () => {
    const html = renderToStaticMarkup(
      <MessageContent
        content={MULTILINE_CONTENT}
        mediaTags={[["p", PERSON], ["p", AGENT]]}
        mentions={[
          { pubkey: PERSON, name: "Alex", isAgent: false },
          { pubkey: AGENT, name: "Codex(remote)", isAgent: true },
        ]}
        workspaceId={WORKSPACE}
      />,
    );

    expect(html.match(/data-mention=""/g)).toHaveLength(2);
    expect(html).toContain(`data-mention-pubkey="${PERSON}"`);
    expect(html).toContain(`data-mention-pubkey="${AGENT}"`);
    expect(html).toContain('data-mention-label="Alex"');
    expect(html).toContain('inline-chip-icon-human');
    expect(html).toContain('wrapping-inline-chip');
    expect(html).toContain('data-mention-kind="agent"');
    expect(html).toContain("inline-chip-icon-agent");
    expect(html).not.toContain("buzz-message-mention");
    expect(html).toContain("<br/>");
  });

  it("keeps untagged mentions and inline code as plain content", () => {
    const html = renderToStaticMarkup(
      <MessageContent
        content={PLAIN_CONTENT}
        mentions={[{ pubkey: PERSON, name: "Alex", isAgent: false }]}
        workspaceId={WORKSPACE}
      />,
    );

    expect(html).not.toContain('data-mention=""');
    expect(html).toContain("@Unknown and <code>@Alex</code>");
  });

  it("only gives resolved mentions a profile affordance when a real host consumer is provided", () => {
    const render = (interactive: boolean) => renderToStaticMarkup(<MessageContent workspaceId={WORKSPACE} content="@Alex" mediaTags={[["p", PERSON]]}
      mentions={[{pubkey:PERSON, name:"Alex", isAgent:false, ...(interactive ? {
        renderProfile: (children: ReactNode) => <span data-profile-for={PERSON}>{children}</span>,
      } : {})}]} />);
    expect(render(false)).not.toContain('data-profile-for');
    expect(render(false)).not.toContain('cursor-pointer');
    expect(render(true)).toContain(`data-profile-for="${PERSON}"`);
    expect(render(true)).toContain('cursor-pointer');
    expect(render(true)).toContain(`data-mention-pubkey="${PERSON}"`);
  });

  it("resolves identities from event tags, never directory order or ambiguous names", () => {
    const mentions = [PERSON, AGENT].map(pubkey => ({pubkey, name:"Alex", isAgent:false,
      renderProfile: (children: ReactNode) => <span data-profile-for={pubkey}>{children}</span>}));
    const render = (tags: string[][]) => renderToStaticMarkup(<MessageContent workspaceId={WORKSPACE}
      content="@Alex" mentions={mentions} mediaTags={tags}/>);
    expect(render([])).not.toContain("data-profile-for");
    expect(render([["p",PERSON], ["p",AGENT]])).not.toContain("data-profile-for");
    expect(render([["p",PERSON]])).toContain(`data-profile-for="${PERSON}"`);
    expect(render([["p",PERSON]])).not.toContain(`data-profile-for="${AGENT}"`);
    expect(render([["p",PERSON], ["buzz:mention-snapshot"], ["mention",AGENT]])).toContain(`data-profile-for="${AGENT}"`);
  });

  it("reserves the final imeta dimensions while a protected image loads", () => {
    const html = renderToStaticMarkup(
      <MessageContent
        content={`![poster](${IMAGE_URL})`}
        mediaTags={[
          ["imeta", `url ${IMAGE_URL}`, "m image/png", `x ${SHA}`, "size 1000", "dim 1080x1920"],
        ]}
        workspaceId={WORKSPACE}
      />,
    );

    expect(html).toContain('data-progressive-image-frame=""');
    expect(html).toContain('data-image-lightbox-trigger=""');
    expect(html).toContain('rounded-2xl');
    expect(html).toContain("aspect-ratio:1080 / 1920");
    expect(html).toContain("width:144px");
    // 平台：媒体按 imeta 的 hash 经 BFF 同源读取，不指向 Relay
    expect(html).toContain(`src="/api/v1/workspaces/${WORKSPACE}/media/${SHA}"`);
    expect(html).not.toContain(`src="${IMAGE_URL}"`);
  });

  it("does not load an image that no imeta entry vouches for", () => {
    const html = renderToStaticMarkup(
      <MessageContent content={`![poster](${IMAGE_URL})`} workspaceId={WORKSPACE} />,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain(`href="${IMAGE_URL}"`);
  });

  it("renders video attachments from imeta through the BFF", () => {
    const html = renderToStaticMarkup(
      <MessageContent
        content={`![video](${IMAGE_URL})`}
        mediaTags={[["imeta", `url ${IMAGE_URL}`, "m video/mp4", `x ${SHA}`]]}
        workspaceId={WORKSPACE}
      />,
    );

    expect(html).toContain("<video");
    expect(html).toContain(`src="/api/v1/workspaces/${WORKSPACE}/media/${SHA}"`);
  });

  it("renders the original image-only triptych and block-media paragraph through the shared mosaic", () => {
    const urls = [IMAGE_URL, "https://relay.example.com/media/second.png", "https://relay.example.com/media/third.png"];
    const hashes = [SHA, "cd".repeat(32), "ef".repeat(32)];
    const html = renderToStaticMarkup(<MessageContent workspaceId={WORKSPACE}
      content={urls.map((url, index) => `![image ${index}](${url})`).join("\n")}
      mediaTags={urls.map((url, index) => ["imeta", `url ${url}`, "m image/png", `x ${hashes[index]}`])} />);
    expect(html).toContain('data-image-mosaic-count="3"');
    expect(html).toContain("h-80 grid-rows-2");
    expect(html).toContain("[&amp;_[data-block-media]:first-child]:row-span-2");
    expect(html.match(/data-block-media=""/g)).toHaveLength(3);
    expect(html.match(/data-image-lightbox-trigger=""/g)).toHaveLength(3);
    expect(html).not.toContain("<p>");
    expect(html).not.toContain(`src="${IMAGE_URL}"`);
  });

  it("opens the original viewer, navigates only this message's admitted gallery and retains zoom/escape/focus", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const otherSha = "cd".repeat(32);
    const otherUrl = "https://relay.example.com/media/second.png";
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, toJSON: () => ({}) });
    // jsdom has no layout; supply only actual visible geometry, not viewer behavior.
    const getComputedStyle = window.getComputedStyle.bind(window);
    const style = vi.spyOn(window, "getComputedStyle").mockImplementation(element => {
      const computed = getComputedStyle(element);
      // jsdom does not supply the browser's default computed opacity.
      if (!computed.opacity) computed.opacity = "1";
      return computed;
    });
    try {
      await act(async () => root.render(<PlatformProvider client={client} locale="en"><TooltipProvider><MessageContent workspaceId={WORKSPACE}
        content={`![poster](${IMAGE_URL})\n\n![second](${otherUrl})\n\n![untrusted](https://untrusted.example/image.png)`}
        mediaTags={[["imeta", `url ${IMAGE_URL}`, "m image/png", `x ${SHA}`], ["imeta", `url ${otherUrl}`, "m image/png", `x ${otherSha}`]]} /></TooltipProvider></PlatformProvider>));
      const triggers = host.querySelectorAll<HTMLButtonElement>('[data-image-lightbox-trigger]');
      expect(triggers).toHaveLength(2);
      triggers[0].focus();
      await act(async () => triggers[0].click());
      let dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
      expect(dialog).not.toBeNull();
      expect(dialog.className).toContain("video-review-theme");
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe(`/api/v1/workspaces/${WORKSPACE}/media/${SHA}`);
      expect(dialog.querySelector('[role="status"]')?.textContent).toBe("1 / 2");
      expect(document.body.style.overflow).toBe("hidden");
      expect(host.getAttribute("inert")).toBe("");
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      expect(dialog.querySelector('[role="status"]')?.textContent).toBe("2 / 2");
      expect(dialog.querySelector('[aria-label="Next image"]')).toBeNull();
      const range = dialog.querySelector<HTMLInputElement>('[aria-label="Image zoom"]')!;
      expect(range.min).toBe("1"); expect(range.max).toBe("3");
      await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click());
      expect(Number(range.value)).toBeGreaterThan(1);
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await act(async () => new Promise(resolve => window.setTimeout(resolve, 300)));
      dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!;
      expect(dialog).toBeNull();
      expect(document.body.style.overflow).not.toBe("hidden");
      expect(host.hasAttribute("inert")).toBe(false);
      expect(document.activeElement).toBe(triggers[0]);
    } finally {
      await act(async () => root.unmount()); host.remove(); rect.mockRestore(); style.mockRestore();
    }
  });

  it("never opens hidden spoiler media and removes the viewer on scope replacement or denied media reads", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, toJSON: () => ({}) });
    const render = async (workspaceId: string, hidden = false) => act(async () => root.render(<PlatformProvider client={client} locale="en"><TooltipProvider><MessageContent workspaceId={workspaceId}
      content={hidden ? `||![poster](${IMAGE_URL})||` : `![poster](${IMAGE_URL})`}
      mediaTags={[["imeta", `url ${IMAGE_URL}`, "m image/png", `x ${SHA}`]]} /></TooltipProvider></PlatformProvider>));
    try {
      await render(WORKSPACE, true);
      expect(host.querySelector("p .buzz-spoiler--block")).toBeNull();
      const hidden = host.querySelector<HTMLButtonElement>('[data-image-lightbox-trigger]')!;
      expect(hidden.tabIndex).toBe(-1);
      await act(async () => hidden.click());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await render("00000000-0000-4000-8000-000000000002");
      await act(async () => host.querySelector<HTMLButtonElement>('[data-image-lightbox-trigger]')!.click());
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      await render(WORKSPACE);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
      expect(host.querySelector('[data-image-lightbox-trigger]')).toBeNull();
      expect(host.textContent).toContain(t("message.imageFailed"));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      await act(async () => root.unmount()); host.remove(); rect.mockRestore();
    }
  });
});
