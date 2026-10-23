// DD-125(3): Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/{lib/waveMessage.ts,ui/WaveMessageAttachment.tsx,ui/MessageRow.tsx},
// desktop/src/features/profile/ui/{UserProfilePrimaryActions.tsx,UserProfilePopover.tsx,
// useProfileInteractionActions.ts}: the marked DM wave, its timeline card and profile entries.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import {
  buildWaveMessageContent, MessageRowSurface, parseWaveMessageContent, waveFallbackName, WAVE_MESSAGE_MARKER,
  type TimelineMessage,
} from "../src/react/messages";
import { InboxMessageRowSurface } from "../src/react/inbox-surface";
import { HuddleHostProvider, HuddleParentProvider, IDLE_HUDDLE_STATE, type HuddleHost, type HuddleParent } from "../src/react/huddle/host";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { Popover, PopoverAnchor } from "../src/react/conversations/popover";
import { UserProfilePopoverBody } from "../src/react/pulse/UserProfilePopover";
import { ProfilePrimaryActions } from "../src/react/pulse/UserProfilePrimaryActions";
import { ProfileDirectMessageProvider, type ProfileDirectMessageHost } from "../src/react/pulse/profile-direct-message";
import { click, render, settle } from "./render";

const huddle = vi.hoisted(() => ({ value: null as null | { isStarting: boolean; activeEphemeralChannelId: string | null; startHuddle: (...args: unknown[]) => Promise<void> } }));
vi.mock("../src/react/huddle/HuddleContext", async (original) => ({
  ...await original<typeof import("../src/react/huddle/HuddleContext")>(),
  useOptionalHuddle: () => huddle.value,
}));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setLocale("en"); huddle.value = null; });
afterEach(() => { vi.restoreAllMocks(); });

describe("original wave message content", () => {
  it("builds and parses the marked kind:9 body", () => {
    const content = buildWaveMessageContent("  Ada Lovelace ");
    expect(content).toBe(`${WAVE_MESSAGE_MARKER}\nAda Lovelace waved at you.`);
    expect(parseWaveMessageContent(content)).toEqual({ fallbackText: "Ada Lovelace waved at you." });
    expect(parseWaveMessageContent(`  \n${content}`)).toEqual({ fallbackText: "Ada Lovelace waved at you." });
    expect(buildWaveMessageContent("   ")).toBe(`${WAVE_MESSAGE_MARKER}\nSomeone waved at you.`);
    expect(parseWaveMessageContent(WAVE_MESSAGE_MARKER)).toEqual({ fallbackText: "Someone waved at you." });
    expect(parseWaveMessageContent("Ada waved at you.")).toBeNull();
    expect(parseWaveMessageContent(`text ${WAVE_MESSAGE_MARKER}`)).toBeNull();
  });

  it("localizes only the builder's exact fallback line", () => {
    expect(waveFallbackName("Ada Lovelace waved at you.")).toBe("Ada Lovelace");
    expect(waveFallbackName("hello there")).toBeNull();
  });
});

const parent: HuddleParent = { kind: "conversation", conversationId: "dm", channelId: "native-dm" };

function fakeHost(unavailableReason: HuddleHost["unavailableReason"] = null): HuddleHost {
  const rejected = () => Promise.reject(new Error("not used"));
  return {
    unavailableReason, startHuddle: rejected, joinHuddle: rejected, leaveHuddle: () => Promise.resolve(),
    endHuddle: () => Promise.resolve(), confirmHuddleActive: () => Promise.resolve(), getHuddleState: () => Promise.resolve(IDLE_HUDDLE_STATE),
    setupAudioWorklet: rejected, setManualMicUnmuted: () => Promise.resolve(), getVoiceInputMode: () => Promise.resolve("voice_activity"),
    setVoiceInputMode: () => Promise.resolve(), listAudioOutputDevices: () => Promise.resolve([]), getAudioOutputDevice: () => Promise.resolve(""),
    setAudioOutputDevice: () => Promise.resolve(), reconnectHuddleAudio: () => Promise.resolve(), addAgentToHuddle: () => Promise.resolve(),
    removeAgentFromHuddle: () => Promise.resolve(), listen: () => () => {},
  };
}

const wave: TimelineMessage = { id: "wave", pubkey: "a".repeat(64), author: "Ada", body: buildWaveMessageContent("Ada"),
  createdAt: 1770000000, depth: 0, time: "", tags: [], kind: 9 };

function row(children: ReactNode) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={cache}><TooltipProvider>{children}</TooltipProvider></QueryClientProvider>;
}

describe("original wave card in the message row", () => {
  it("renders the card instead of the body, with no huddle action without a host", async () => {
    const renderBody = vi.fn(() => "wrong ordinary body");
    const host = await render(row(<MessageRowSurface message={wave} renderBody={renderBody} />));
    const card = host.querySelector<HTMLElement>('[data-testid="message-wave-attachment"]');
    expect(card?.textContent).toContain("Ada waved at you.");
    expect(card?.textContent).not.toContain("Start huddle");
    expect(card?.className).toContain("buzz-wave-hover-trigger");
    expect(renderBody).not.toHaveBeenCalled();
    await act(async () => setLocale("zh-CN"));
    expect(host.querySelector('[data-testid="message-wave-attachment"]')?.textContent).toContain("Ada 向你挥手。");
  });

  it("renders the same card in the Inbox detail row, never the marked wire text", async () => {
    const renderBody = vi.fn(() => "wrong ordinary body");
    const host = await render(row(<InboxMessageRowSurface message={wave} renderBody={renderBody} />));
    const card = host.querySelector<HTMLElement>('[data-testid="message-wave-attachment"]');
    expect(card?.textContent).toContain("Ada waved at you.");
    expect(host.textContent).not.toContain(WAVE_MESSAGE_MARKER);
    expect(renderBody).not.toHaveBeenCalled();
    const plain = await render(row(<InboxMessageRowSurface message={{ ...wave, id: "plain", body: "hello" }} renderBody={renderBody} />));
    expect(plain.querySelector('[data-testid="message-wave-attachment"]')).toBeNull();
    expect(renderBody).toHaveBeenCalled();
  });

  it("starts the governed huddle for the conversation on screen", async () => {
    const startHuddle = vi.fn(async () => {});
    huddle.value = { isStarting: false, activeEphemeralChannelId: null, startHuddle };
    const host = await render(row(<HuddleHostProvider host={fakeHost()}>
      <HuddleParentProvider parent={parent} channelName="Bea <> Ada huddle">
        <MessageRowSurface message={wave} renderBody={() => null} />
      </HuddleParentProvider>
    </HuddleHostProvider>));
    const card = host.querySelector<HTMLElement>('[data-testid="message-wave-attachment"]')!;
    expect(card.textContent).toContain("Start a huddle to talk to them.");
    const start = [...card.querySelectorAll("button")].find((button) => button.textContent === "Start huddle")!;
    expect(start.disabled).toBe(false);
    await click(start);
    expect(startHuddle).toHaveBeenCalledExactlyOnceWith(parent, [], "Bea <> Ada huddle");
  });

  it("keeps start disabled while a huddle is starting or the name is unknown", async () => {
    huddle.value = { isStarting: true, activeEphemeralChannelId: null, startHuddle: vi.fn() };
    const starting = await render(row(<HuddleHostProvider host={fakeHost()}>
      <HuddleParentProvider parent={parent} channelName="Bea <> Ada huddle"><MessageRowSurface message={wave} renderBody={() => null} /></HuddleParentProvider>
    </HuddleHostProvider>));
    expect([...starting.querySelectorAll("button")].find((button) => button.textContent === "Start huddle")?.disabled).toBe(true);
    huddle.value = { isStarting: false, activeEphemeralChannelId: null, startHuddle: vi.fn() };
    const unnamed = await render(row(<HuddleHostProvider host={fakeHost()}>
      <HuddleParentProvider parent={parent}><MessageRowSurface message={wave} renderBody={() => null} /></HuddleParentProvider>
    </HuddleHostProvider>));
    expect([...unnamed.querySelectorAll("button")].find((button) => button.textContent === "Start huddle")?.disabled).toBe(true);
  });

  it("explains an unavailable host instead of failing on click", async () => {
    huddle.value = { isStarting: false, activeEphemeralChannelId: null, startHuddle: vi.fn() };
    const insecure = await render(row(<HuddleHostProvider host={fakeHost("insecure-context")}>
      <HuddleParentProvider parent={parent} channelName="Bea <> Ada huddle"><MessageRowSurface message={wave} renderBody={() => null} /></HuddleParentProvider>
    </HuddleHostProvider>));
    expect([...insecure.querySelectorAll("button")].find((button) => button.textContent === "Start huddle")?.disabled).toBe(true);
    expect(insecure.textContent).toContain("Huddles need a secure (HTTPS) connection in this browser.");
  });
});

describe("original profile Wave entries", () => {
  it("adds the Wave tile between Message and Follow", async () => {
    const onWave = vi.fn();
    const host = await render(<ProfilePrimaryActions onMessage={() => {}} onWave={onWave} />);
    const tiles = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="user-profile-primary-actions"] button')];
    expect(tiles.map((tile) => tile.dataset.testid)).toEqual(["user-profile-message", "user-profile-wave"]);
    await click(tiles[1]!);
    expect(onWave).toHaveBeenCalledOnce();
    const pending = await render(<ProfilePrimaryActions onWave={onWave} wavePending />);
    expect(pending.querySelector<HTMLButtonElement>('[data-testid="user-profile-wave"]')?.disabled).toBe(true);
    expect(pending.querySelector('[data-testid="user-profile-wave"]')?.getAttribute("aria-busy")).toBe("true");
  });

  const other = "b".repeat(64);
  const profile = { displayName: "Bea", avatarUrl: null, about: null, nip05Handle: null };
  function popover(host: ProfileDirectMessageHost, onClose = vi.fn(), role?: string) {
    return <ProfileDirectMessageProvider value={host}><Popover open><PopoverAnchor asChild><span /></PopoverAnchor>
      <UserProfilePopoverBody canOpenProfilePanel={false} onContentMouseEnter={() => {}} onMouseLeave={() => {}}
        onTriggerClick={() => {}} onClose={onClose} pubkey={other} role={role} profile={profile} mediaUrl={(url) => url} />
    </Popover></ProfileDirectMessageProvider>;
  }

  it("waves from the hover card, closing it once the conversation is open", async () => {
    const onClose = vi.fn();
    const waveAction = vi.fn(async (_pubkey: string, onNavigated?: () => void) => { onNavigated?.(); });
    await render(popover({ open: vi.fn(), canMessage: () => true, wave: waveAction, canWave: (pubkey) => pubkey === other }, onClose));
    const button = document.querySelector<HTMLButtonElement>(`[data-testid="user-profile-popover-wave-${other}"]`)!;
    expect(button.getAttribute("aria-label")).toBe("Wave");
    await click(button);
    await settle();
    expect(waveAction).toHaveBeenCalledOnce();
    expect(waveAction.mock.calls[0]?.[0]).toBe(other);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers no Wave for agents, non-people or a host without a DM publication", async () => {
    await render(popover({ open: vi.fn(), canMessage: () => true, wave: vi.fn(), canWave: () => false }));
    expect(document.querySelector(`[data-testid="user-profile-popover-wave-${other}"]`)).toBeNull();
    await render(popover({ open: vi.fn(), canMessage: () => true }));
    expect(document.querySelector(`[data-testid="user-profile-popover-wave-${other}"]`)).toBeNull();
    await render(popover({ open: vi.fn(), canMessage: () => true, wave: vi.fn() }, vi.fn(), "bot"));
    expect(document.querySelector(`[data-testid="user-profile-popover-wave-${other}"]`)).toBeNull();
  });
});
