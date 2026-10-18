// DD-120 / V-SCN-100..102: the restored Buzz presence library (fixed
// 779af8886caae1317b4de962082429867ab61503 desktop/src/features/presence/lib/presence.test.mjs,
// ported where pure) plus the Kailo seams: per-person aggregation, missing != offline,
// BFF snapshot validation, admitted stream ingestion and the self presence chooser.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebPresenceStatus, type WebPresencePage } from "@client-kit/contracts";
import { setLocale } from "../src/i18n";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { MembersPane } from "../src/react/pages";
import { DmHeaderParticipants } from "../src/react/messages/dm-header-participants";
import { AvatarHostProvider } from "../src/react/profile/avatar-host";
import { SidebarProfileCard } from "../src/react/sidebar/sidebar-profile-card";
import {
  activePresencePubkeys,
  aggregatePresence,
  mergePresenceUpdate,
  parseLivePresenceEvent,
  presenceQueryWantsPubkey,
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  PRESENCE_IDLE_TIMEOUT_MS,
  PRESENCE_TTL_SECONDS,
  resolveAutomaticPresenceStatus,
} from "../src/react/presence/lib/presence";
import {
  applyLivePresenceEvent,
  fetchPresenceLookup,
  presenceQueryKey,
  PRESENCE_QUERY_CHUNK_SIZE,
} from "../src/react/presence/hooks";
import { ingestPresenceStreamEvent, PresenceHostProvider } from "../src/react/presence/host";
import { useSelfPresence, type PresenceHost, type PresenceSession } from "../src/react/presence/context";
import type { BffReply, BffRequest } from "../src/transport";
import { click, render, settle } from "./render";
import { ProfileSummaryView } from "../src/react/pulse/ProfileSummaryView";

const WILL = "8e39cba681211b3782d0e4483e9343719b9b7be66515252da5491f26421896b1";
const OTHER = "44b8e82baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocale("en");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("original presence library (presence.test.mjs)", () => {
  it("normalizes, deduplicates and sorts active presence authors", () => {
    const queries = [
      { queryKey: ["presence", WILL.toUpperCase(), OTHER], isActive: () => true },
      { queryKey: ["presence", WILL], isActive: () => true },
      { queryKey: ["presence", "a".repeat(64)], isActive: () => false },
      { queryKey: ["profiles", "b".repeat(64)], isActive: () => true },
    ];
    expect(activePresencePubkeys(queries)).toEqual([OTHER, WILL].sort());
  });

  it("heartbeats every minute with a three-window TTL and a ten-minute idle threshold", () => {
    expect(PRESENCE_HEARTBEAT_INTERVAL_MS).toBe(60_000);
    expect(PRESENCE_TTL_SECONDS).toBe(180);
    expect(PRESENCE_IDLE_TIMEOUT_MS).toBe(600_000);
  });

  it("merges a live update into an existing lookup without dropping absent keys", () => {
    expect(mergePresenceUpdate({}, WILL, "online")).toEqual({ [WILL]: "online" });
    expect(mergePresenceUpdate({ [WILL]: "offline" }, WILL, "online")).toEqual({ [WILL]: "online" });
    const old = { [WILL]: "online" as const };
    expect(mergePresenceUpdate(old, WILL, "online")).toBe(old);
    expect(mergePresenceUpdate({ [OTHER]: "away" }, WILL, "online")).toEqual({ [OTHER]: "away", [WILL]: "online" });
    expect(mergePresenceUpdate(undefined, WILL, "online")).toBeUndefined();
  });

  it("only updates queries that requested the pubkey", () => {
    expect(presenceQueryWantsPubkey(["presence", WILL, OTHER], WILL)).toBe(true);
    expect(presenceQueryWantsPubkey(["presence", OTHER], WILL)).toBe(false);
    expect(presenceQueryWantsPubkey(["presence"], WILL)).toBe(false);
  });

  it("keys a live event off its signer, never a forged p tag, and rejects unknown statuses", () => {
    expect(parseLivePresenceEvent({ pubkey: OTHER, content: "offline" })).toEqual({ pubkey: OTHER, status: "offline" });
    expect(parseLivePresenceEvent({ pubkey: WILL, content: "lurking" })).toBeNull();
    expect(parseLivePresenceEvent({ pubkey: WILL.toUpperCase(), content: "away" })?.pubkey).toBe(WILL);
  });

  it("resolves away after ten idle minutes from in-app activity when no OS idle exists", () => {
    const now = 1_000_000_000;
    expect(resolveAutomaticPresenceStatus(null, now - 1_000, now)).toBe("online");
    expect(resolveAutomaticPresenceStatus(null, now - PRESENCE_IDLE_TIMEOUT_MS, now)).toBe("away");
    expect(resolveAutomaticPresenceStatus(600, now, now)).toBe("away");
    expect(resolveAutomaticPresenceStatus(30, now - 60 * 60_000, now)).toBe("online");
  });
});

describe("DD-120 (5) per-person presence", () => {
  it("is online if any bound key is online, away before offline, and never invents offline", () => {
    expect(aggregatePresence({ [OTHER]: "online" }, [WILL, OTHER])).toBe("online");
    expect(aggregatePresence({ [WILL]: "offline", [OTHER]: "away" }, [WILL, OTHER])).toBe("away");
    expect(aggregatePresence({ [WILL]: "offline" }, [WILL, OTHER])).toBe("offline");
    expect(aggregatePresence({}, [WILL, OTHER])).toBeUndefined();
    expect(aggregatePresence(undefined, [WILL])).toBeUndefined();
    expect(aggregatePresence({ [WILL]: "online" }, [WILL.toUpperCase()])).toBe("online");
  });
});

describe("BFF presence snapshot", () => {
  it("chunks at the contract limit and keeps only requested pubkeys with a fact", async () => {
    const pubkeys = Array.from({ length: PRESENCE_QUERY_CHUNK_SIZE + 3 }, (_, index) => index.toString(16).padStart(64, "0"));
    const requests: string[][] = [];
    const lookup = await fetchPresenceLookup(pubkeys, async (chunk) => {
      requests.push(chunk);
      return { presences: [
        { pubkey: chunk[0]!, status: WebPresenceStatus.Online },
        { pubkey: "f".repeat(64), status: WebPresenceStatus.Online },
      ] };
    });
    expect(requests.map((chunk) => chunk.length)).toEqual([PRESENCE_QUERY_CHUNK_SIZE, 3]);
    expect(Object.keys(lookup).sort()).toEqual([requests[0]![0]!, requests[1]![0]!].sort());
    expect(lookup[pubkeys[1]!]).toBeUndefined();
  });

  it("rejects a malformed snapshot instead of rendering it", async () => {
    await expect(fetchPresenceLookup([WILL], async () => ({ presences: [{ pubkey: WILL, status: "busy" }] }) as unknown as WebPresencePage))
      .rejects.toThrow("Invalid presence entry");
    await expect(fetchPresenceLookup([WILL], async () => ({}) as WebPresencePage)).rejects.toThrow("Invalid presence response");
  });
});

describe("admitted stream ingestion", () => {
  it("applies a member-signed 20001 to successful lookups that requested its signer", () => {
    const cache = new QueryClient();
    cache.setQueryData(presenceQueryKey([WILL, OTHER]), {});
    cache.setQueryData(presenceQueryKey([OTHER]), {});
    expect(applyLivePresenceEvent(cache, { pubkey: WILL, content: "online" })).toBe(true);
    expect(cache.getQueryData(presenceQueryKey([WILL, OTHER]))).toEqual({ [WILL]: "online" });
    expect(cache.getQueryData(presenceQueryKey([OTHER]))).toEqual({});
  });

  it("consumes only h-less 20001/30315 identity frames", () => {
    const cache = new QueryClient();
    cache.setQueryData(presenceQueryKey([WILL]), {});
    const base = { id: "1".repeat(64), pubkey: WILL, created_at: 10, tags: [] as string[][] };
    expect(ingestPresenceStreamEvent(cache, { ...base, kind: 20001, content: "away" })).toBe(true);
    expect(cache.getQueryData(presenceQueryKey([WILL]))).toEqual({ [WILL]: "away" });
    expect(ingestPresenceStreamEvent(cache, { ...base, kind: 20001, content: "online", tags: [["h", "channel"]] })).toBe(false);
    expect(ingestPresenceStreamEvent(cache, { ...base, kind: 9, content: "online" })).toBe(false);
    expect(ingestPresenceStreamEvent(cache, { ...base, kind: 30315, content: "Busy", tags: [["d", "general"]] })).toBe(true);
    expect(cache.getQueryData(presenceQueryKey([WILL]))).toEqual({ [WILL]: "away" });
  });
});

const WIRE = { online: WebPresenceStatus.Online, away: WebPresenceStatus.Away, offline: WebPresenceStatus.Offline } as const;

function presenceHost(lookup: Record<string, "online" | "away" | "offline">): PresenceHost & { calls: string[][]; updates: string[] } {
  const calls: string[][] = [];
  const updates: string[] = [];
  return {
    calls, updates,
    queryPresence: async (pubkeys) => {
      calls.push(pubkeys);
      return { presences: pubkeys.flatMap((pubkey) => {
        const status = lookup[pubkey];
        return status ? [{ pubkey, status: WIRE[status] }] : [];
      }) };
    },
    updatePresence: async (status) => { updates.push(status); },
    queryUserStatus: async () => ({ statuses: [] }),
    updateUserStatus: async () => ({ eventId: "e".repeat(64) }),
  };
}

function withHost(host: PresenceHost, ui: ReactNode, send: (request: BffRequest) => Promise<BffReply> = async () => ({ status: 404, body: {} })) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send })} locale="en">
    <PresenceHostProvider host={host}>{ui}</PresenceHostProvider>
  </PlatformProvider></QueryClientProvider>);
}

describe("presence surfaces", () => {
  const ada = { principalId: "ada", displayName: "Ada", state: "ACTIVE", pubkeys: [WILL, OTHER] };
  const bob = { principalId: "bob", displayName: "Bob", state: "ACTIVE", pubkeys: ["b".repeat(64)] };

  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(420);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 420));
  });

  it("dots a member online through any of their keys and leaves a member without facts undotted", async () => {
    const host = presenceHost({ [OTHER]: "online" });
    const send = async (request: BffRequest): Promise<BffReply> => request.path.endsWith("/members")
      ? { status: 200, body: [ada, bob] }
      : request.path.includes("role-members") || request.path.includes("invitations") ? { status: 403, body: {} }
      : { status: 200, body: { pubkey: request.path.split("/").at(-1), displayName: null, avatarUrl: null, avatarMediaPaths: {} } };
    const view = await withHost(host, <MembersPane workspaceId="workspace" />, send);
    await settle();
    await vi.waitFor(() => expect(view.querySelector('[data-testid="member-presence-ada"]')).not.toBeNull());
    expect(view.querySelector('[data-testid="member-presence-ada"]')?.getAttribute("data-presence-status")).toBe("online");
    expect(view.querySelector('[data-testid="member-presence-ada"]')?.getAttribute("aria-label")).toBe("Online");
    expect(view.querySelector('[data-testid="member-presence-bob"]')).toBeNull();
    // One batched snapshot read for every active key of the roster.
    expect(host.calls).toEqual([[OTHER, WILL, "b".repeat(64)].sort()]);
  });

  it("badges the DM header from the person's keys and never paints missing presence offline", async () => {
    const online = await withHost(presenceHost({ [OTHER]: "away" }), <AvatarHostProvider value={{ locale: "en", rewriteMediaUrl: (url) => url }}>
      <DmHeaderParticipants participants={[{ id: "ada", displayName: "Ada", avatarUrl: null, presencePubkeys: [WILL, OTHER] }]} title="Ada" />
    </AvatarHostProvider>);
    await vi.waitFor(() => expect(online.querySelector('[data-testid="chat-presence-badge"]')).not.toBeNull());
    expect(online.querySelector('[data-testid="chat-presence-badge"]')?.getAttribute("data-presence-status")).toBe("away");
    const missing = await withHost(presenceHost({}), <AvatarHostProvider value={{ locale: "en", rewriteMediaUrl: (url) => url }}>
      <DmHeaderParticipants participants={[{ id: "bob", displayName: "Bob", avatarUrl: null, presencePubkeys: ["b".repeat(64)] }]} title="Bob" />
    </AvatarHostProvider>);
    await settle();
    expect(missing.querySelector('[data-testid="chat-header-dm-avatar"]')).not.toBeNull();
    expect(missing.querySelector('[data-testid="chat-presence-badge"]')).toBeNull();
  });

  it("offers the original online/away/offline chooser from the self presence chip", async () => {
    const choose = vi.fn();
    const view = await render(<SidebarProfileCard communityLabel="Community" resolvedDisplayName="Ada"
      avatar={<span>avatar</span>} popoverAvatar={<span>popover avatar</span>} onOpenSettings={vi.fn()} onSignOut={vi.fn()}
      selfPresenceStatus="online" onSetPresenceStatus={choose} />);
    expect(view.querySelector('[data-testid="self-presence-badge"]')?.getAttribute("aria-label")).toBe("Online");
    await click(view.querySelector<HTMLButtonElement>('[data-testid="sidebar-profile-avatar-button"]')!);
    const chip = document.querySelector<HTMLButtonElement>('[data-testid="profile-popover-presence-trigger"]')!;
    expect(chip.textContent).toBe("Online");
    await click(chip);
    expect([...document.querySelectorAll('[data-testid^="profile-popover-status-"]')].map((node) => node.textContent))
      .toEqual(["Online", "Away", "Offline"]);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="profile-popover-status-offline"]')!);
    expect(choose).toHaveBeenCalledExactlyOnceWith("offline");
  });

  it("keeps the platform popover unchanged when the host has no presence session", async () => {
    const view = await render(<SidebarProfileCard communityLabel="Community" resolvedDisplayName="Ada"
      avatar={<span>avatar</span>} popoverAvatar={<span>popover avatar</span>} onOpenSettings={vi.fn()} onSignOut={vi.fn()} />);
    expect(view.querySelector('[data-testid="self-presence-badge"]')).toBeNull();
    await click(view.querySelector<HTMLButtonElement>('[data-testid="sidebar-profile-avatar-button"]')!);
    expect(document.querySelector('[data-testid="profile-popover-presence-trigger"]')).toBeNull();
    expect(document.querySelector('[data-testid="profile-popover-set-status"]')).toBeNull();
    expect(document.querySelector('[data-testid="profile-popover-sign-out"]')).not.toBeNull();
  });

  it("runs the self heartbeat through the host and stores a manual choice per pubkey", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const host = presenceHost({});
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const probe: { session: PresenceSession | null } = { session: null };
    function Probe() { probe.session = useSelfPresence(); return <output>{probe.session?.currentStatus}</output>; }
    const view = await render(<QueryClientProvider client={cache}>
      <PresenceHostProvider host={host} selfPubkey={WILL.toUpperCase()}><Probe /></PresenceHostProvider>
    </QueryClientProvider>);
    await settle();
    expect(view.textContent).toBe("online");
    expect(host.updates).toEqual(["online"]);
    await act(async () => { vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS); });
    await settle();
    expect(host.updates).toEqual(["online", "online"]);
    await act(async () => { await probe.session!.setStatus("offline"); });
    await settle();
    expect(view.textContent).toBe("offline");
    expect(host.updates.at(-1)).toBe("offline");
    expect(localStorage.getItem(`buzz-presence-preference:${WILL}`)).toBe("offline");
    // Offline releases the lease: no further heartbeats.
    await act(async () => { vi.advanceTimersByTime(3 * PRESENCE_HEARTBEAT_INTERVAL_MS); });
    await settle();
    expect(host.updates.filter((status) => status === "online")).toHaveLength(2);
  });
});

describe("original profile panel hero presence and status (DD-120)", () => {
  const profile = { displayName: "Will", avatarUrl: null, about: null, nip05Handle: null };
  it("badges the hero through any admitted key and shows the newest visible status", async () => {
    const host = { ...presenceHost({ [OTHER]: "away" }),
      queryUserStatus: async (pubkeys: string[]) => ({ statuses: pubkeys.includes(WILL)
        ? [{ pubkey: WILL, text: "Heads down", emoji: "🎧", eventId: "f".repeat(64), createdAt: Math.floor(Date.now() / 1000) }] : [] }) };
    const view = await withHost(host, <ProfileSummaryView displayName="Will" profile={profile} pubkey={WILL}
      presencePubkeys={[WILL, OTHER]} copy={async () => {}} mediaUrl={(url) => url} />);
    await settle();
    await vi.waitFor(() => expect(view.querySelector('[data-testid="user-profile-presence-badge"]')?.getAttribute("aria-label")).toBe("Away"));
    await vi.waitFor(() => expect(view.querySelector('[data-testid="user-profile-user-status"]')?.textContent).toContain("Heads down"));
  });
  it("leaves the hero unbadged without a presence host", async () => {
    const view = await render(<ProfileSummaryView displayName="Will" profile={profile} pubkey={WILL}
      copy={async () => {}} mediaUrl={(url) => url} />);
    expect(view.querySelector('[data-testid="user-profile-presence-badge"]')).toBeNull();
    expect(view.querySelector('[data-testid="user-profile-user-status"]')).toBeNull();
  });
});
