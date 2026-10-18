// REQ-24: Buzz 779af8886caae1317b4de962082429867ab61503 features/sidebar/ui/sidebarLoadingSkeleton.tsx.
import { beforeEach, expect, it } from "vitest";
import { SidebarLoadingContent, useSidebarLoadingShape, type SidebarLoadingSourceRow } from "../src/react/sidebar/sidebar-loading-skeleton";
import { render } from "./render";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

function Probe({ scopeKey, channels, directMessages, isLoading }: {
  scopeKey: string; channels: readonly SidebarLoadingSourceRow[]; directMessages: readonly SidebarLoadingSourceRow[]; isLoading: boolean;
}) {
  const shape = useSidebarLoadingShape({ scopeKey, channels, directMessages, isLoading });
  return <SidebarLoadingContent shape={shape} />;
}

const none: SidebarLoadingSourceRow[] = [];

it("falls back to the original three channel and two DM placeholders", async () => {
  const host = await render(<Probe scopeKey="tenant:me" channels={none} directMessages={none} isLoading />);
  const loading = host.querySelector("[data-testid=sidebar-loading]")!;
  expect(loading.querySelectorAll("li")).toHaveLength(5);
  expect(loading.querySelectorAll(".rounded-full")).toHaveLength(2);
});

it("remembers the settled shape per scope without storing names or identifiers", async () => {
  const channels = [{ id: "workspace-secret", label: "a-very-long-channel-name" }];
  await render(<Probe scopeKey="tenant:me" channels={channels} directMessages={none} isLoading={false} />);
  const stored = localStorage.getItem("buzz-sidebar-skeleton-shape.v1:tenant:me")!;
  expect(stored).not.toContain("workspace-secret");
  expect(stored).not.toContain("a-very-long-channel-name");
  const host = await render(<Probe scopeKey="tenant:me" channels={none} directMessages={none} isLoading />);
  expect(host.querySelector("[data-testid=sidebar-loading]")!.querySelectorAll("li")).toHaveLength(1);
  const other = await render(<Probe scopeKey="tenant:other" channels={none} directMessages={none} isLoading />);
  expect(other.querySelector("[data-testid=sidebar-loading]")!.querySelectorAll("li")).toHaveLength(5);
});
