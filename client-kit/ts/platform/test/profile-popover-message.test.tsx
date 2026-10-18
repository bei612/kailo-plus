// REQ-24: Buzz 779af8886caae1317b4de962082429867ab61503 features/profile/ui/UserProfilePopover.tsx
// hover-card Message action (useProfileInteractionActions::handleMessage).
import { beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { Popover, PopoverAnchor } from "../src/react/conversations/popover";
import { UserProfilePopoverBody } from "../src/react/pulse/UserProfilePopover";
import { ProfileDirectMessageProvider, type ProfileDirectMessageHost } from "../src/react/pulse/profile-direct-message";
import { click, render, settle } from "./render";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setLocale("en"); });

const other = "b".repeat(64);
const profile = { displayName: "Bea", avatarUrl: null, about: null, nip05Handle: null };

function body(host: ProfileDirectMessageHost | null, onClose = vi.fn(), role?: string) {
  const content = <Popover open><PopoverAnchor asChild><span /></PopoverAnchor><UserProfilePopoverBody canOpenProfilePanel={false} onContentMouseEnter={() => {}} onMouseLeave={() => {}}
    onTriggerClick={() => {}} onClose={onClose} pubkey={other} role={role} profile={profile} mediaUrl={(url) => url} /></Popover>;
  return host ? <ProfileDirectMessageProvider value={host}>{content}</ProfileDirectMessageProvider> : content;
}

it("opens the person's direct message from the hover card and closes it", async () => {
  const open = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  await render(body({ open, canMessage: (pubkey) => pubkey === other }, onClose));
  const message = document.querySelector<HTMLButtonElement>(`[data-testid="user-profile-popover-message-${other}"]`)!;
  expect(message.textContent).toContain("Message");
  await click(message);
  await settle();
  expect(open).toHaveBeenCalledExactlyOnceWith(other);
  expect(onClose).toHaveBeenCalledOnce();
});

it("offers no Message for the signed-in person, agents or without a host", async () => {
  await render(body({ open: vi.fn(), canMessage: () => false }));
  expect(document.querySelector(`[data-testid="user-profile-popover-message-${other}"]`)).toBeNull();
  await render(body({ open: vi.fn(), canMessage: () => true }, vi.fn(), "bot"));
  expect(document.querySelector(`[data-testid="user-profile-popover-message-${other}"]`)).toBeNull();
  await render(body(null));
  expect(document.querySelector(`[data-testid="user-profile-popover-message-${other}"]`)).toBeNull();
});
