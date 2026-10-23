// DD-143 / SF-BUZ-62(2): Buzz 779af8886caae1317b4de962082429867ab61503
// markdownFileCard.ts::resolveSnapshotCard and AgentSnapshotCard (without the import action).
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { PlatformProvider } from "../src/react/context";
import { resolveFileCard, resolveSnapshotCard } from "../src/react/messages/resolveFileCard";
import { SnapshotCard } from "../src/react/messages/SnapshotCard";
import { click, render } from "./render";

const x = "a".repeat(64);
const href = "https://relay.example/media/abc";

describe("original snapshot card classification", () => {
  it("classifies agent/team JSON and PNG snapshots only with a 64-hex digest", () => {
    expect(resolveSnapshotCard({ m: "application/json", x, size: 10, filename: "ada-lovelace.agent.json" }, href, "ada-lovelace.agent.json"))
      .toEqual({ displayName: "Ada Lovelace", href, filename: "ada-lovelace.agent.json", size: 10, sha256: x, snapshotKind: "agent", thumb: undefined });
    expect(resolveSnapshotCard({ m: "image/png", x, filename: "scout.agent.png" }, href, "Scout")?.thumb).toBe(href);
    expect(resolveSnapshotCard({ m: "image/png", x, filename: "crew.team.png" }, href, "")?.snapshotKind).toBe("team");
    expect(resolveSnapshotCard({ m: "image/png", x, filename: "crew.team.png" }, href, "")?.thumb).toBeUndefined();
  });
  it("falls through for missing digests, wrong PNG types and other files", () => {
    expect(resolveSnapshotCard({ m: "application/json", filename: "a.agent.json" }, href, "")).toBeNull();
    expect(resolveSnapshotCard({ m: "application/json", x: "zz", filename: "a.agent.json" }, href, "")).toBeNull();
    expect(resolveSnapshotCard({ m: "image/jpeg", x, filename: "a.agent.png" }, href, "")).toBeNull();
    expect(resolveSnapshotCard({ m: "application/json", x, filename: "a.persona.json" }, href, "")).toBeNull();
    expect(resolveFileCard({ m: "application/json", x, filename: "notes.json" }, href, "")?.filename).toBe("notes.json");
  });
});

describe("snapshot card", () => {
  it.each(["en", "zh-CN"] as const)("downloads through the host and offers no import action (%s)", async (locale) => {
    setLocale(locale);
    const onDownload = vi.fn(async () => undefined);
    const host = await render(<PlatformProvider client={createBffClient({ send: async () => ({ status: 404, body: {} }) })} locale={locale}>
      <SnapshotCard displayName="" href={href} filename="crew.team.json" size={2048} snapshotKind="team" onDownload={onDownload} />
    </PlatformProvider>);
    expect(host.textContent).toContain(locale === "en" ? "Team snapshot" : "团队快照");
    expect(host.textContent).toContain("2.0 KB");
    expect(host.querySelector('[data-testid="agent-snapshot-card-import"]')).toBeNull();
    await click(host.querySelector<HTMLElement>('[data-testid="agent-snapshot-card-download"]')!);
    expect(onDownload).toHaveBeenCalledWith(href, "crew.team.json");
  });
});
