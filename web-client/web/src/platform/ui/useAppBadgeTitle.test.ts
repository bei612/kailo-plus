// Buzz 779af8886caae1317b4de962082429867ab61503 setDesktopAppBadge semantics in the Web tab title.
import { describe, expect, it } from "vitest";
import { appBadgeState, appBadgeTitle } from "./useAppBadgeTitle";

describe("original app badge in the Web tab title", () => {
  it("counts the Home badge, else shows a dot for channel-only unreads, else nothing", () => {
    expect(appBadgeState(3, 5)).toEqual({ kind: "count", count: 3 });
    expect(appBadgeState(0, 2)).toEqual({ kind: "dot" });
    expect(appBadgeState(null, 0)).toEqual({ kind: "none" });
    expect(appBadgeTitle("Kailo", { kind: "count", count: 3 })).toBe("(3) Kailo");
    expect(appBadgeTitle("Kailo", { kind: "dot" })).toBe("• Kailo");
    expect(appBadgeTitle("Kailo", { kind: "none" })).toBe("Kailo");
  });
});
