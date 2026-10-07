// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDefinitionsPane } from "./AgentDefinitionsPane";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { createBffClient } from "@client-kit/platform/client";
import type { AgentDefinitionsPage } from "@client-kit/platform/react/pages";
import type { AgentVersionView } from "@client-kit/contracts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type AgentProps = NonNullable<ComponentProps<typeof AgentDefinitionsPage>>;
const state = vi.hoisted(() => ({ props: null as AgentProps | null, upload: vi.fn() }));
vi.mock("../bff-client", () => ({ uploadProfileAvatar: state.upload }));
vi.mock("@client-kit/platform/react/pages", () => ({ AgentDefinitionsPage: (props: AgentProps) => {
  state.props = props; return <div data-testid="shared-agent-page" />;
} }));
let root: Root | null = null;
let element: HTMLDivElement | null = null;
beforeEach(() => { state.props = null; state.upload.mockReset(); });
afterEach(() => { if (root) act(() => root!.unmount()); root = null; element?.remove(); element = null; });
const pubkey = "a".repeat(64);
const profile = { pubkey, eventId: null, displayName: null, about: null, avatarUrl: null, nip05Handle: null, avatarMediaPaths: {} };
async function mount(status = 200) {
  const send = vi.fn(async () => ({ status, body: status === 200 ? profile : undefined }));
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  await act(async () => root!.render(<PlatformProvider client={createBffClient({ send })} locale="zh-CN">
    <AgentDefinitionsPane workspaceId="workspace" />
  </PlatformProvider>));
  return send;
}
describe("Web original Agent avatar host", () => {
  it("uses only authorized exact media mappings and the existing actor-bound uploader", async () => {
    const send = await mount();
    const savedUrl = `https://community.example/media/${"b".repeat(64)}.png`;
    const savedPath = `/api/v1/profile/media/${"b".repeat(64)}`;
    // Only the generated view projection is consumed by this transport; this
    // fixture deliberately has no content and cannot invent an Agent version.
    const version = { avatarMediaPaths: { [savedUrl]: savedPath } } as AgentVersionView;
    const avatar = state.props!.avatarHost!(version);
    expect(avatar.locale).toBe("zh-CN");
    expect(avatar.rewriteMediaUrl(savedUrl)).toBe(savedPath);
    expect(avatar.rewriteMediaUrl(`${savedUrl}?preview=1`)).toBe(savedPath);
    const arbitrary = `https://different.example/media/${"b".repeat(64)}.png`;
    expect(avatar.rewriteMediaUrl(arbitrary)).toBe(arbitrary);
    const uploaded = { url: `https://community.example/media/${"c".repeat(64)}.png`, sha256: "c".repeat(64), type: "image/png" };
    state.upload.mockResolvedValue(uploaded);
    expect(await avatar.uploadMediaBytes([137, 80, 78, 71])).toEqual(uploaded);
    expect(state.upload).toHaveBeenCalledExactlyOnceWith([137, 80, 78, 71], pubkey);
    expect(avatar.rewriteMediaUrl(uploaded.url)).toBe(`/api/v1/profile/media/${uploaded.sha256}`);
    expect(send.mock.calls).toHaveLength(1);
    expect(element!.querySelector('[data-testid="shared-agent-page"]')).not.toBeNull();
  });

  it("does not manufacture an upload host if the authenticated actor read is refused", async () => {
    await mount(403);
    expect(state.props).toBeNull();
    expect(element!.querySelector('[data-testid="shared-agent-page"]')).toBeNull();
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("drops uploaded mappings when the host remounts the actual tenant/principal scope", async () => {
    const client = createBffClient({ send: async () => ({ status: 200, body: profile }) });
    element = document.createElement("div"); document.body.append(element); root = createRoot(element);
    const renderScope = (scope: string) => act(async () => root!.render(<PlatformProvider client={client} locale="zh-CN">
      <AgentDefinitionsPane key={scope} />
    </PlatformProvider>));
    await renderScope("tenant-a:principal-a");
    const uploaded = { url: `https://community.example/media/${"d".repeat(64)}.png`, sha256: "d".repeat(64), type: "image/png" };
    state.upload.mockResolvedValue(uploaded);
    await state.props!.avatarHost!().uploadMediaBytes([137, 80, 78, 71]);
    expect(state.props!.avatarHost!().rewriteMediaUrl(uploaded.url)).toBe(`/api/v1/profile/media/${uploaded.sha256}`);
    await renderScope("tenant-b:principal-b");
    expect(state.props!.avatarHost!().rewriteMediaUrl(uploaded.url)).toBe(uploaded.url);
  });
});
