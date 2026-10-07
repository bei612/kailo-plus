import { act, StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebCustomEmojiMutation, WebCustomEmojiView } from "@client-kit/contracts";
import { CustomEmojiSettingsCard } from "../src/react/custom-emoji/CustomEmojiSettingsCard";
import { useEmojiSettings, type CustomEmojiHost } from "../src/react/custom-emoji/hooks";
import { customEmojiFromTags, unionCustomEmoji } from "../src/react/custom-emoji/emoji";
import remarkCustomEmoji from "../src/react/custom-emoji/remarkCustomEmoji";
import { setLocale } from "../src/i18n";
import { BffError, TransportError } from "../src/transport";
import { button, click, render } from "./render";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const peer = Uint8Array.from({ length: 32 }, (_, i) => i + 2);
const author = getPublicKey(secret);
const uploaded = `https://community.example/media/${"a".repeat(64)}.png`;
function signed(entries: string[][], key = secret, createdAt = 1) {
  return finalizeEvent({ kind: 30030, created_at: createdAt, content: "", tags: [["d", "buzz:custom-emoji"], ...entries] }, key);
}
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); }
async function mount(host: CustomEmojiHost) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = await render(<QueryClientProvider client={client}><CustomEmojiSettingsCard host={host} /></QueryClientProvider>);
  await flush();
  return element;
}
function fixture() {
  let current: WebCustomEmojiView = { pubkey: author, events: [signed([["emoji", "own", uploaded]]), signed([["emoji", "peer", uploaded]], peer)], mediaPaths: {} };
  const read = vi.fn(async () => current);
  const publish = vi.fn(async (request: WebCustomEmojiMutation) => {
    const entries = customEmojiFromTags((current.events[0] as ReturnType<typeof signed>).tags)
      .filter((entry) => entry.shortcode !== request.shortcode).map((entry) => ["emoji", entry.shortcode, entry.url]);
    if (request.imageUrl) entries.push(["emoji", request.shortcode, request.imageUrl]);
    const event = signed(entries, secret, 2);
    current = { ...current, events: [event, current.events[1]!] };
    return { eventId: event.id };
  });
  const host: CustomEmojiHost = { scope: author, read, publish, rewriteRelayUrl: (url) => url,
    pickAndUploadMedia: vi.fn(async () => [{ url: uploaded, filename: "party.png", type: "image/png" }]) };
  return { host, publish, read };
}

beforeEach(() => setLocale("en"));
describe("original NIP-30 custom emoji", () => {
  it("keeps the captured identity live after StrictMode effect replay", async () => {
    const { host } = fixture();
    const view = await host.read();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["custom-emoji", host.scope], { view, events: view.events });
    let settings: ReturnType<typeof useEmojiSettings> | undefined;
    function Probe() { settings = useEmojiSettings(host); return null; }
    await render(<StrictMode><QueryClientProvider client={client}><Probe /></QueryClientProvider></StrictMode>);
    await act(async () => {
      await expect(settings!.setEmoji.mutateAsync({ shortcode: "party", url: uploaded })).resolves.toBe("party");
    });
  });

  it("preserves original normalization, deterministic collisions and duplicate handling", () => {
    const a = signed([["emoji", ":JOY:", "https://b.example/x"], ["emoji", "joy", "https://a.example/x"]]);
    const b = signed([["emoji", "joy", "https://a.example/x"]], peer);
    expect(customEmojiFromTags(a.tags)).toEqual([{ shortcode: "joy", url: "https://b.example/x" }]);
    expect(unionCustomEmoji([a, b])).toEqual(unionCustomEmoji([b, a]));
    expect(unionCustomEmoji([a, b])).toEqual([{ shortcode: "joy", url: "https://a.example/x" }]);
  });

  it("retains the full original own/community groups and never offers peer deletion", async () => {
    const { host } = fixture();
    const element = await mount(host);
    expect(element.textContent).toContain("My emoji");
    expect(element.textContent).toContain("Community emoji");
    expect(element.querySelectorAll('button[aria-label^="Remove"]')).toHaveLength(1);
    expect(element.textContent).toContain(":peer:");
  });

  it("uploads then signs only the captured author's set and confirms exact readback", async () => {
    const { host, publish } = fixture();
    const element = await mount(host);
    await click(button(element, "Upload image"));
    await click(button(element, "Save emoji"));
    await flush();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0]).toMatchObject({ expectedPubkey: author, shortcode: "party", imageUrl: uploaded });
    expect(element.textContent).toContain(":party:");
    expect(element.querySelector<HTMLInputElement>("input")!.value).toBe("");
  });

  it("removes only the selected own entry while retaining the peer set", async () => {
    const { host, publish } = fixture();
    const element = await mount(host);
    await click(element.querySelector<HTMLButtonElement>('button[aria-label="Remove :own:"]')!);
    await flush();
    expect(publish.mock.calls[0]![0]).toMatchObject({ expectedPubkey: author, shortcode: "own" });
    expect(publish.mock.calls[0]![0]).not.toHaveProperty("imageUrl");
    expect(element.textContent).not.toContain(":own:");
    expect(element.textContent).toContain(":peer:");
  });

  it("keeps a mismatching signed readback UNKNOWN instead of treating any set as success", async () => {
    const { host, publish } = fixture();
    const element = await mount(host);
    publish.mockResolvedValueOnce({ eventId: "f".repeat(64) });
    await click(button(element, "Upload image"));
    await click(button(element, "Save emoji"));
    expect(element.querySelector<HTMLInputElement>("input")!.value).toBe("party");
    expect(button(element, "Clear").disabled).toBe(true);
  });

  it("keeps the upload and same intent when an ACK cannot be read back", async () => {
    const { host, publish, read } = fixture();
    const element = await mount(host);
    await click(button(element, "Upload image"));
    read.mockRejectedValueOnce(new BffError(403, "revoked after publish"));
    await click(button(element, "Save emoji"));
    await flush();
    expect(element.querySelector<HTMLInputElement>("input")!.value).toBe("party");
    expect(element.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
    expect(button(element, "Clear").disabled).toBe(true);
    await click(button(element, "Save emoji"));
    await flush();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]![0]).toEqual(publish.mock.calls[0]![0]);
  });

  it("never treats transport ambiguity as a failed or cleared edit", async () => {
    const { host, publish } = fixture();
    const element = await mount(host);
    publish.mockRejectedValueOnce(new TransportError("lost receipt"));
    await click(button(element, "Upload image"));
    await click(button(element, "Save emoji"));
    expect(element.querySelector<HTMLInputElement>("input")!.value).toBe("party");
    expect(button(element, "Clear").disabled).toBe(true);
  });

  it("uses original inline shortcode transformation without rewriting code or links", () => {
    const text = { type: "text", value: ":joy: :unknown:" };
    const code = { type: "code", value: ":joy:" };
    const link = { type: "link", url: "https://example.test", children: [{ type: "text", value: ":joy:" }] };
    const tree = { type: "root", children: [{ type: "paragraph", children: [text, code, link] }] };
    remarkCustomEmoji({ customEmoji: [{ shortcode: "joy", url: uploaded }] })(tree);
    expect(JSON.stringify(tree)).toContain('"hName":"emoji"');
    expect(code.value).toBe(":joy:");
    expect(link.children[0]!.value).toBe(":joy:");
    expect(JSON.stringify(tree)).toContain(":unknown:");
  });
});
