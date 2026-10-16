// DD-120 / V-SCN-103: the restored Buzz user status (fixed 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/user-status/{statusExpiration,hooks}.test.mjs ported where pure), the BFF read
// adaptation (a cleared status is omitted), the DD-81 publication intent and the original
// SetStatusDialog / profile popover flows.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebUserStatusPage, WebUserStatusUpdateRequest } from "@client-kit/contracts";
import { setLocale } from "../src/i18n";
import { TransportError } from "../src/transport";
import {
  applyUserStatusEventToQueries,
  expireUserStatusQueries,
  fetchUserStatusLookup,
  newestVisibleUserStatus,
  readCurrentUserStatusLookup,
  USER_STATUS_AUTHOR_CHUNK_SIZE,
  userStatusQueryKey,
  userStatusUpdateRequest,
  useSetUserStatusMutation,
  visibleUserStatus,
} from "../src/react/user-status/hooks";
import type { UserStatusInput, UserStatusLookup } from "../src/react/user-status/types";
import { SetStatusDialog } from "../src/react/user-status/ui/SetStatusDialog";
import { UserNameIndicators } from "../src/react/user-status/ui/UserNameIndicators";
import { PresenceHostProvider } from "../src/react/presence/host";
import type { PresenceHost } from "../src/react/presence/context";
import { SidebarProfileCard } from "../src/react/sidebar/sidebar-profile-card";
import { click, render, settle, type } from "./render";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocale("en");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function status(expiresAt?: number) {
  return { text: "Busy", emoji: "🔴", updatedAt: 1, eventId: "event-1", expiresAt };
}
function statusEvent({ id, createdAt, text = "Busy", expiresAt }: { id: string; createdAt: number; text?: string; expiresAt?: number }) {
  const tags = [["d", "general"], ["emoji", "🔴"]];
  if (expiresAt !== undefined) tags.push(["expiration", String(expiresAt)]);
  return { id, kind: 30315, pubkey: ALICE, content: text, tags, created_at: createdAt };
}

describe("original status expiration (statusExpiration.test.mjs)", () => {
  it("expires due statuses in every cached lookup without network traffic", () => {
    const cache = new QueryClient();
    cache.setQueryData(userStatusQueryKey([ALICE]), { [ALICE]: status(100) });
    cache.setQueryData(userStatusQueryKey([ALICE, BOB]), { [ALICE]: status(100), [BOB]: status(101) });
    expect(expireUserStatusQueries(cache, 99)).toBe(false);
    expect(expireUserStatusQueries(cache, 100)).toBe(true);
    const hidden = { text: "", emoji: "", updatedAt: 1, eventId: "event-1" };
    expect(cache.getQueryData(userStatusQueryKey([ALICE]))).toEqual({ [ALICE]: hidden });
    expect(cache.getQueryData(userStatusQueryKey([ALICE, BOB]))).toEqual({ [ALICE]: hidden, [BOB]: status(101) });
  });

  it("applies a live status to a requested lookup before history resolves", () => {
    const cache = new QueryClient();
    cache.setQueryData(userStatusQueryKey([ALICE]), {});
    expect(applyUserStatusEventToQueries(cache, statusEvent({ id: "live", createdAt: 101 }), 101)).toBe(true);
    expect(visibleUserStatus(cache.getQueryData<UserStatusLookup>(userStatusQueryKey([ALICE]))?.[ALICE])?.text).toBe("Busy");
  });

  it("retains the replacement fence against delayed older events after expiry", () => {
    const cache = new QueryClient();
    const key = userStatusQueryKey([ALICE]);
    const read = () => visibleUserStatus(cache.getQueryData<UserStatusLookup>(key)?.[ALICE]);
    cache.setQueryData(key, { [ALICE]: null });
    applyUserStatusEventToQueries(cache, statusEvent({ id: "b", createdAt: 101, expiresAt: 102 }), 101);
    expect(read()?.text).toBe("Busy");
    expect(expireUserStatusQueries(cache, 102)).toBe(true);
    expect(read()).toBeNull();
    applyUserStatusEventToQueries(cache, statusEvent({ id: "a", createdAt: 100, text: "Older" }), 102);
    expect(read()).toBeNull();
    applyUserStatusEventToQueries(cache, statusEvent({ id: "c", createdAt: 103, text: "Newer" }), 102);
    expect(read()?.text).toBe("Newer");
  });

  it("ignores a 30315 that is not the original d=general status", () => {
    const cache = new QueryClient();
    cache.setQueryData(userStatusQueryKey([ALICE]), {});
    expect(applyUserStatusEventToQueries(cache, { ...statusEvent({ id: "x", createdAt: 1 }), tags: [["d", "music"]] })).toBe(false);
    expect(cache.getQueryData(userStatusQueryKey([ALICE]))).toEqual({});
  });
});

describe("BFF status read", () => {
  const view = (pubkey: string, createdAt = 1, text = `Status ${pubkey.slice(0, 4)}`) =>
    ({ pubkey, text, emoji: "💬", createdAt, eventId: `${pubkey.slice(0, 8)}-${createdAt}` });

  it("does not let a pending read replace a newer live status", async () => {
    let resolve!: (page: WebUserStatusPage) => void;
    let current: UserStatusLookup = {};
    const pending = fetchUserStatusLookup([ALICE], () => new Promise((done) => { resolve = done; }), () => current);
    await Promise.resolve();
    current = { [ALICE]: { text: "Live", emoji: "💬", updatedAt: 2, eventId: "live" } };
    resolve({ statuses: [view(ALICE, 1)] });
    expect((await pending)[ALICE]?.eventId).toBe("live");
  });

  it("treats an omitted (cleared) status as none unless a newer live frame landed during the read", async () => {
    const old = { [ALICE]: { text: "Old", emoji: "", updatedAt: 1, eventId: "old" }, [BOB]: null };
    expect(await fetchUserStatusLookup([ALICE, BOB], async () => ({ statuses: [] }), () => old)).toEqual({ [ALICE]: null, [BOB]: null });
    const live = { [ALICE]: { text: "Live", emoji: "", updatedAt: Math.floor(Date.now() / 1000) + 5, eventId: "live" } };
    expect((await fetchUserStatusLookup([ALICE], async () => ({ statuses: [] }), () => live))[ALICE]?.text).toBe("Live");
  });

  it("hides an expired status and rejects malformed entries", async () => {
    const expired = await fetchUserStatusLookup([ALICE], async () => ({ statuses: [{ ...view(ALICE), expiresAt: 1 }] }));
    expect(visibleUserStatus(expired[ALICE])).toBeNull();
    await expect(fetchUserStatusLookup([ALICE], async () => ({ statuses: [{ pubkey: ALICE }] }) as unknown as WebUserStatusPage))
      .rejects.toThrow("Invalid user status entry");
  });

  it("reads every status when the author set exceeds one contract page", async () => {
    const pubkeys = Array.from({ length: USER_STATUS_AUTHOR_CHUNK_SIZE + 7 }, (_, index) => index.toString(16).padStart(64, "0"));
    const chunks: string[][] = [];
    const lookup = await fetchUserStatusLookup(pubkeys, async (chunk) => {
      chunks.push(chunk);
      return { statuses: chunk.map((pubkey) => view(pubkey)) };
    });
    expect(chunks.map((chunk) => chunk.length)).toEqual([USER_STATUS_AUTHOR_CHUNK_SIZE, 7]);
    expect(Object.keys(lookup)).toHaveLength(pubkeys.length);
    for (const pubkey of pubkeys) expect(lookup[pubkey]?.text).toBe(`Status ${pubkey.slice(0, 4)}`);
  });

  it("seeds overlapping lookups with the newest cached version and picks a person's newest key", () => {
    const cache = new QueryClient();
    cache.setQueryData(["user-status", ALICE, "newer"], { [ALICE]: { text: "Newer", emoji: "", updatedAt: 2, eventId: "newer" } });
    cache.setQueryData(["user-status", ALICE, "older"], { [ALICE]: { text: "Older", emoji: "", updatedAt: 1, eventId: "older" } });
    expect(readCurrentUserStatusLookup(cache, [ALICE])[ALICE]?.text).toBe("Newer");
    const lookup: UserStatusLookup = {
      [ALICE]: { text: "Web", emoji: "", updatedAt: 5, eventId: "w" },
      [BOB]: { text: "Desktop", emoji: "", updatedAt: 9, eventId: "d" },
    };
    expect(newestVisibleUserStatus(lookup, [ALICE, BOB])?.text).toBe("Desktop");
    expect(newestVisibleUserStatus({ [ALICE]: null }, [ALICE])).toBeNull();
  });
});

describe("own status publication", () => {
  it("sends empty text alone to clear and trims a set status", () => {
    expect(userStatusUpdateRequest({ text: "  ", emoji: "🔴", expiresAt: 5 })).toEqual({ text: "" });
    expect(userStatusUpdateRequest({ text: " Busy ", emoji: "🔴", expiresAt: 5 })).toEqual({ text: "Busy", emoji: "🔴", expiresAt: 5 });
    expect(userStatusUpdateRequest({ text: "Busy", emoji: "" })).toEqual({ text: "Busy" });
  });

  it("keeps one Idempotency-Key per intent across an UNKNOWN outcome and updates the own lookup", async () => {
    const sent: Array<[WebUserStatusUpdateRequest, string]> = [];
    let unknown = true;
    const host: PresenceHost = {
      queryPresence: async () => ({ presences: [] }),
      updatePresence: async () => {},
      queryUserStatus: async () => ({ statuses: [] }),
      updateUserStatus: async (request, key) => {
        sent.push([request, key]);
        if (unknown) { unknown = false; throw new TransportError("timeout"); }
        return { eventId: "e".repeat(64), createdAt: 4_000_000_000 };
      },
    };
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    cache.setQueryData(userStatusQueryKey([ALICE]), {});
    const harness: { publish?: (input: UserStatusInput) => Promise<unknown> } = {};
    function Harness() {
      const mutation = useSetUserStatusMutation(ALICE);
      useEffect(() => { harness.publish = mutation.mutateAsync; });
      return null;
    }
    await render(<QueryClientProvider client={cache}><PresenceHostProvider host={host}><Harness /></PresenceHostProvider></QueryClientProvider>);
    const input = { text: "Busy", emoji: "🔴", expiresAt: 4_000_003_600 };
    await act(async () => { await expect(harness.publish!(input)).rejects.toBeInstanceOf(TransportError); });
    await act(async () => { await harness.publish!(input); });
    expect(sent).toHaveLength(2);
    expect(sent[1]![1]).toBe(sent[0]![1]);
    expect(sent[0]![0]).toEqual({ text: "Busy", emoji: "🔴", expiresAt: 4_000_003_600 });
    expect(visibleUserStatus(cache.getQueryData<UserStatusLookup>(userStatusQueryKey([ALICE]))?.[ALICE])?.text).toBe("Busy");
    await act(async () => { await harness.publish!({ text: "", emoji: "" }); });
    expect(sent[2]![0]).toEqual({ text: "" });
    expect(sent[2]![1]).not.toBe(sent[0]![1]);
  });
});

describe("original SetStatusDialog", () => {
  async function choose(trigger: HTMLElement, option: string) {
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); trigger.focus(); });
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await settle();
    await click(document.querySelector<HTMLElement>(`[data-testid=${option}]`)!);
  }
  const q = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);

  it("saves text with the default emoji until the end of today, and a preset with one hour", async () => {
    const onSave = vi.fn();
    await render(<SetStatusDialog open onOpenChange={vi.fn()} onSave={onSave} onClear={vi.fn()} hasExistingStatus={false} />);
    const save = q<HTMLButtonElement>("[data-testid=set-status-save]")!;
    expect(save.disabled).toBe(true);
    await type(q<HTMLInputElement>("[data-testid=set-status-input]")!, "Heads down");
    expect(save.disabled).toBe(false);
    await click(save);
    const endOfToday = new Date(); endOfToday.setHours(24, 0, 0, 0);
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ text: "Heads down", emoji: "💬", expiresAt: Math.floor(endOfToday.getTime() / 1000) });
  });

  it("applies a quick status and the chosen duration", async () => {
    const onSave = vi.fn();
    await render(<SetStatusDialog open onOpenChange={vi.fn()} onSave={onSave} onClear={vi.fn()} hasExistingStatus={false} />);
    await click(q("[data-testid=set-status-preset-in-a-meeting]")!);
    expect(q<HTMLInputElement>("[data-testid=set-status-input]")!.value).toBe("In a meeting");
    await choose(q("[data-testid=set-status-duration]")!, "set-status-duration-1-hour");
    expect(q("[data-testid=set-status-duration]")!.textContent).toContain("1 hour");
    const before = Math.floor(Date.now() / 1000);
    await click(q("[data-testid=set-status-save]")!);
    const saved = onSave.mock.calls[0]![0] as UserStatusInput;
    expect(saved.text).toBe("In a meeting");
    expect(saved.emoji).toBe("🗣️");
    expect(saved.expiresAt! - before).toBeGreaterThanOrEqual(3599);
    expect(saved.expiresAt! - before).toBeLessThanOrEqual(3601);
  });

  it("does not save an emoji-only status (empty text clears under DD-120) and clears an existing one", async () => {
    const onClear = vi.fn();
    const onSave = vi.fn();
    await render(<SetStatusDialog open onOpenChange={vi.fn()} onSave={onSave} onClear={onClear} hasExistingStatus
      initialText="Busy" initialEmoji="🔴" />);
    expect(q("[data-testid=set-status-preset-in-a-meeting]")).toBeNull();
    await type(q<HTMLInputElement>("[data-testid=set-status-input]")!, "");
    expect(q<HTMLButtonElement>("[data-testid=set-status-save]")!.disabled).toBe(true);
    await click(q("[data-testid=set-status-clear]")!);
    expect(onClear).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses a custom expiry in the past", async () => {
    await render(<SetStatusDialog open onOpenChange={vi.fn()} onSave={vi.fn()} onClear={vi.fn()} hasExistingStatus={false} />);
    await type(q<HTMLInputElement>("[data-testid=set-status-input]")!, "Away");
    await choose(q("[data-testid=set-status-duration]")!, "set-status-duration-custom");
    const date = q<HTMLInputElement>("[data-testid=set-status-expiration-date]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(date, "2000-01-01");
      date.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(q<HTMLButtonElement>("[data-testid=set-status-save]")!.disabled).toBe(true);
    expect(q('[data-testid=set-status-dialog] [role="alert"]')?.textContent).toBe("Choose a duration in the future.");
  });

  it("opens from the profile popover and shows the saved status in the sidebar card", async () => {
    const onSet = vi.fn();
    const view = await render(<SidebarProfileCard communityLabel="Community" resolvedDisplayName="Ada"
      avatar={<span>avatar</span>} popoverAvatar={<span>popover</span>} onOpenSettings={vi.fn()} onSignOut={vi.fn()}
      selfUserStatus={{ text: "Commuting", emoji: "🚌", updatedAt: 1 }} onSetUserStatus={onSet} onClearUserStatus={vi.fn()} />);
    expect(view.querySelector("[data-testid=sidebar-profile-user-status]")?.textContent).toContain("Commuting");
    await click(view.querySelector<HTMLButtonElement>("[data-testid=sidebar-profile-avatar-button]")!);
    expect(q("[data-testid=profile-popover-set-status]")?.textContent).toContain("Commuting");
    await click(q("[data-testid=profile-popover-set-status]")!);
    await act(async () => { await new Promise<void>((done) => requestAnimationFrame(() => done())); });
    await settle();
    expect(q("[data-testid=set-status-dialog]")).not.toBeNull();
    await type(q<HTMLInputElement>("[data-testid=set-status-input]")!, "Back at desk");
    await click(q("[data-testid=set-status-save]")!);
    expect(onSet).toHaveBeenCalledWith(expect.objectContaining({ text: "Back at desk", emoji: "🚌" }));
  });
});

describe("name indicators", () => {
  it("shows a person's status only through the presence host and never without one", async () => {
    const host: PresenceHost = {
      queryPresence: async () => ({ presences: [] }),
      updatePresence: async () => {},
      queryUserStatus: async (pubkeys) => ({ statuses: pubkeys.includes(BOB)
        ? [{ pubkey: BOB, text: "Out sick", emoji: "🤒", createdAt: 5, eventId: "s" }] : [] }),
      updateUserStatus: async () => ({ eventId: "e" }),
    };
    const none = await render(<UserNameIndicators pubkey={ALICE} />);
    expect(none.innerHTML).toBe("");
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = await render(<QueryClientProvider client={cache}><PresenceHostProvider host={host}>
      <UserNameIndicators pubkey={ALICE} pubkeys={[ALICE, BOB]} />
    </PresenceHostProvider></QueryClientProvider>);
    await vi.waitFor(() => expect(view.querySelector("[data-testid=user-status-indicator]")).not.toBeNull());
    expect(view.querySelector("[data-testid=user-status-indicator]")?.getAttribute("aria-label")).toBe("🤒 Out sick");
  });
});
