import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { createBffClient } from "@client-kit/platform/client";
import { describe, expect, it } from "vitest";
import { MessageContent } from "@/features/chat/ui/MessageContent";
const client = createBffClient({ send: async () => { throw new Error("Rendering performs no BFF writes"); } });
const renderToStaticMarkup = (ui: ReactNode) => renderMarkup(<PlatformProvider client={client} locale="en">{ui}</PlatformProvider>);

const PERSON = "11".repeat(32);
const AGENT = "22".repeat(32);
const MULTILINE_CONTENT = "@Alex 第一行\n@Codex(remote) 第二行";
const PLAIN_CONTENT = "@Unknown and `@Alex`";
const IMAGE_URL = "https://relay.example.com/media/poster.png";
const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const SHA = "ab".repeat(32);

describe("MessageContent", () => {
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
    expect(html).toContain('data-mention-agent="true"');
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

    expect(html).toContain('data-protected-image-frame="true"');
    expect(html).toContain("aspect-ratio:1080 / 1920");
    expect(html).toContain("width:min(100%, 144px)");
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
});
