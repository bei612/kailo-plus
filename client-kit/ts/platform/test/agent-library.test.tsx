import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { AgentDefinitionsPage } from "../src/react/agents";
import { PlatformProvider } from "../src/react/context";
import { effectiveAgentDescription } from "../src/react/agent-library/agentDescription";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

// After implementation: the actual shared page and its real BFF requests.
const pubkey = "a".repeat(64);
const definition = { resourceId: "definition", displayName: "Definition title", stableSlug: "not-the-card-description",
  ownerPrincipalId: "owner", resourceVersion: 3, resourceState: "ACTIVE", status: "ACTIVE", currentPublishedVersionAssetId: "published" };
const content = { personaIdentity: { displayName: "Published persona", description: "  Owner-authored description  ", avatarUrl: "https://community.example/persona.png" },
  instructions: "Original instructions", runtimeProfileKey: "runtime-profile", modelRouteResourceId: "route", replyPolicy: "THREAD",
  skillVersionAssetIds: [], declaredToolResourceIds: [], capabilityRequirements: [], triggerDefaults: ["MENTION"], parallelism: 2,
  turnLimits: { idleTimeoutSeconds: 30, maxTurnDurationSeconds: 90 }, memoryPolicy: { coreWrite: "HUMAN_ONLY", coldWrite: "DISABLED" } };
const version = { assetId: "published", agentResourceId: definition.resourceId, ownerPrincipalId: "owner", assetVersion: 4, ordinal: 2,
  state: "PUBLISHED", configHash: "b".repeat(64), content, avatarMediaPaths: { [content.personaIdentity.avatarUrl]: "/api/v1/profile/media/persona" } };
const installation = { resourceId: "installation", workspaceId: "workspace", agentResourceId: definition.resourceId,
  pinnedVersionAssetId: "pinned", agentPrincipalId: "independent-agent", agentPrincipalState: "ACTIVE", agentPubkey: pubkey,
  ownerPrincipalId: "owner", resourceVersion: 1, resourceState: "ACTIVE", state: "ACTIVE", activeProjectionGeneration: 1,
  projection: { generation: 1, agentVersionAssetId: "pinned", runtimeProfileKey: "runtime-profile", configHash: "c".repeat(64), state: "ACTIVE" } };
const denied = { status: 403, body: {} };
function fixture(extra?: (request: BffRequest) => BffReply | Promise<BffReply> | undefined) {
  const send = vi.fn(async (request: BffRequest) => {
    const override = extra?.(request);
    if (override) return override;
    if (request.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [definition] } };
    if (request.path === "/api/v1/agent-versions/published") return { status: 200, body: version };
    if (request.path === "/api/v1/agent-versions/pinned") return { status: 200, body: { ...version, assetId: "pinned",
      content: { ...content, personaIdentity: { ...content.personaIdentity, displayName: "Exact pinned persona" } } } };
    if (request.path === "/api/v1/workspaces") return { status: 200, body: [{ id: "workspace", name: "Real workspace", slug: "real" }] };
    if (request.path.startsWith("/api/v1/agent-installations?")) return { status: 200, body: { installations: [installation] } };
    if (request.path === "/api/v1/tasks") return { status: 200, body: [] };
    return denied;
  });
  const client = createBffClient({ send });
  const rewrite = vi.fn((url: string) => version.avatarMediaPaths[url as keyof typeof version.avatarMediaPaths] ?? url);
  const ui = <PlatformProvider client={client} locale="en"><AgentDefinitionsPage avatarHost={() => ({ locale: "en",
    uploadMediaBytes: vi.fn(), performDefaultHaptic: vi.fn(), rewriteMediaUrl: rewrite })} /></PlatformProvider>;
  return { send, ui, rewrite };
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("Image", function () {
    const image = document.createElement("img");
    let source = "";
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1 } });
    Object.defineProperty(image, "src", { get: () => source, set: (value: string) => {
      source = value; queueMicrotask(() => image.dispatchEvent(new Event("load")));
    } });
    return image;
  });
});
afterEach(() => vi.unstubAllGlobals());
const card = (id: string) => document.querySelector<HTMLElement>(`[data-testid="agent-${id}"]`)!;

describe("original Agent library identity consumers", () => {
  it("loads the published Persona face in the original card instead of a slug and fabricated readiness badge", async () => {
    const f = fixture(); await render(f.ui); await settle();
    const face = card("definition-definition");
    expect(face.textContent).toContain("Published persona");
    expect(face.textContent).toContain("Owner-authored description");
    expect(face.textContent).not.toContain(definition.stableSlug);
    expect(face.textContent).not.toContain("Definition ready");
    expect(face.className).toContain("aspect-[4/5]");
    expect(face.querySelector("img")?.getAttribute("src")).toBe("/api/v1/profile/media/persona");
    expect(f.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-versions/published" });
    expect(f.send.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
  });
  it.each(["asset", "definition", "state"])("does not expose a mismatched %s published identity", async field => {
    const bad = { ...version, ...(field === "asset" ? { assetId: "other" } : field === "definition" ? { agentResourceId: "other" } : { state: "DRAFT" }) };
    const f = fixture(request => request.path === "/api/v1/agent-versions/published" ? { status: 200, body: bad } : undefined);
    await render(f.ui); await settle();
    expect(card("definition-definition").textContent).toContain(definition.displayName);
    expect(card("definition-definition").textContent).not.toContain("Published persona");
    expect(card("definition-definition").querySelector("img")).toBeNull();
    expect(card("definition-definition").parentElement?.querySelector("[role=status]")).not.toBeNull();
  });
  it("keeps version denial distinct from an absent authored description and allows authorized retry", async () => {
    let revoked = true;
    const f = fixture(request => request.path === "/api/v1/agent-versions/published" && revoked ? denied : undefined);
    await render(f.ui); await settle();
    expect(card("definition-definition").querySelector("img")).toBeNull();
    revoked = false;
    await click(button(card("definition-definition").parentElement!, "Try again"));
    expect(card("definition-definition").textContent).toContain("Published persona");
    expect(f.send.mock.calls.filter(([request]) => request.path === "/api/v1/agent-versions/published")).toHaveLength(2);
  });
  it("renders the authorized exact pinned Persona avatar without borrowing the current published identity", async () => {
    const f = fixture(); await render(f.ui); await settle();
    const face = card("installation-installation");
    expect(face.textContent).toContain("Exact pinned persona");
    expect(face.querySelector("img")?.getAttribute("src")).toBe("/api/v1/profile/media/persona");
    expect(face.textContent).not.toContain("Published persona");
    expect(f.send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/agent-versions/pinned" });
  });
  it.each(["asset", "definition", "denied"])("does not show another installation Persona when the pinned version is %s", async condition => {
    const f = fixture(request => request.path === "/api/v1/agent-versions/pinned" ? condition === "denied" ? denied : { status: 200,
      body: { ...version, ...(condition === "asset" ? { assetId: "other" } : { assetId: "pinned", agentResourceId: "other" }) } } : undefined);
    await render(f.ui); await settle();
    expect(card("installation-installation").querySelector("img")).toBeNull();
    expect(card("installation-installation").textContent).not.toContain("Published persona");
    expect(card("installation-installation").parentElement?.querySelector("[role=status], [role=alert]")).not.toBeNull();
  });
  it("does not misuse the HUMAN-only profile reader for an AGENT even when its exact public mapping exists", async () => {
    const f = fixture();
    await render(f.ui); await settle();
    expect(card("installation-installation").querySelector("img")?.getAttribute("src")).toBe("/api/v1/profile/media/persona");
    expect(f.send.mock.calls.some(([request]) => request.path.includes("/profiles/"))).toBe(false);
  });
  it("renders original card skeletons while the authorized directory is pending", async () => {
    const f = fixture(request => request.path === "/api/v1/agent-definitions" ? new Promise(() => {}) : undefined);
    await render(f.ui); await settle();
    const loading = document.querySelector('[role=status][aria-label="Loading…"]')!;
    expect(loading.querySelectorAll(":scope > div")).toHaveLength(3);
    expect(loading.querySelector('[class*="h-24 w-24"]')).not.toBeNull();
    expect(loading.querySelector('[class*="w-14"]')).not.toBeNull();
    expect(loading.querySelector('[class*="w-32"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="new-agent-card"]')).toBeNull();
  });
  it("re-reads both exact published and pinned versions after the original page refresh", async () => {
    const f = fixture(); await render(f.ui); await settle();
    const count = (path: string) => f.send.mock.calls.filter(([request]) => request.path === path).length;
    const published = count("/api/v1/agent-versions/published"), pinned = count("/api/v1/agent-versions/pinned");
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-definitions"] > div button[aria-label="Refresh"]')!);
    expect(count("/api/v1/agent-versions/published")).toBeGreaterThan(published);
    expect(count("/api/v1/agent-versions/pinned")).toBeGreaterThan(pinned);
  });
  it("preserves the original authored-description trim/null rules without a synthetic fallback", () => {
    expect(effectiveAgentDescription({ description: " \n " })).toBeNull();
    expect(effectiveAgentDescription({ description: null })).toBeNull();
    expect(effectiveAgentDescription({})).toBeNull();
    expect(effectiveAgentDescription({ description: "  authored  " })).toBe("authored");
  });
});
