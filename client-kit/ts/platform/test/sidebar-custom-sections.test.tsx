// DD-125(5), V-SCN-138, REQ-24: Buzz 779af8886caae1317b4de962082429867ab61503
// CustomChannelSection, ChannelSectionDialogs, SidebarDnd and ChannelContextMenu "Move to section",
// with sort and sections persisted through the shared Core preference actions.
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { PlatformProvider } from "../src/react/context";
import {
  CollaborationPreferencesProvider,
  type CollaborationPreferenceActions,
} from "../src/react/collaboration-preferences";
import { ChannelGroupSection } from "../src/react/sidebar/channel-group";
import { ChannelContextMenuItems } from "../src/react/sidebar/channel-context-menu";
import {
  CreateSectionDialog,
  CustomChannelSection,
  DeleteSectionAlertDialog,
  DraggableChannelRow,
  DroppableUngroupedBody,
  SidebarDndContext,
  resolveSidebarDrop,
} from "../src/react/sidebar/custom-channel-section";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { useChannelSortPreference } from "../src/react/sidebar/useChannelSortPreference";
import { button, render, settle, type } from "./render";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
});
afterEach(() => { vi.restoreAllMocks(); });

const client = createBffClient({ send: async () => ({ status: 404, body: {} }) });
const sectionA = { id: "11111111-1111-4111-8111-111111111111", name: "Launch", icon: "🚀" };
const sectionB = { id: "22222222-2222-4222-8222-222222222222", name: "Ops" };
const row = (id: string, name: string) => ({ id, name, lastMessageAt: null });

describe("original drop outcomes", () => {
  it("assigns, unassigns and reorders exactly as handleDragEnd", () => {
    const ids = [sectionA.id, sectionB.id];
    expect(resolveSidebarDrop({ type: "channel", channelId: "c" }, { type: "section", sectionId: sectionB.id }, ids))
      .toEqual({ type: "assign", channelId: "c", sectionId: sectionB.id });
    expect(resolveSidebarDrop({ type: "channel", channelId: "c" }, { type: "ungrouped" }, ids))
      .toEqual({ type: "unassign", channelId: "c" });
    expect(resolveSidebarDrop({ type: "section", sectionId: sectionA.id }, { type: "section", sectionId: sectionB.id }, ids))
      .toEqual({ type: "reorder", sectionIds: [sectionB.id, sectionA.id] });
    expect(resolveSidebarDrop({ type: "section", sectionId: sectionA.id }, { type: "section", sectionId: sectionA.id }, ids)).toBeNull();
    expect(resolveSidebarDrop({ type: "section", sectionId: sectionA.id }, { type: "ungrouped" }, ids)).toBeNull();
  });
});

const handlers = { assign: vi.fn(), unassign: vi.fn(), reorder: vi.fn() };

function Sections({ enabled }: { enabled: boolean }) {
  return <TooltipProvider>
    <SidebarDndContext enabled={enabled} sectionIds={[sectionA.id, sectionB.id]}
      onAssignChannel={handlers.assign} onUnassignChannel={handlers.unassign} onReorderSections={handlers.reorder}>
      {[sectionA, sectionB].map((section, index) => <CustomChannelSection key={section.id} section={section}
        items={section.id === sectionA.id ? [row("w1", "alpha")] : []} hasUnread={false} isCollapsed={false}
        isFirst={index === 0} isLast={index === 1} disabled={!enabled} sortMode="alpha" onSortModeChange={() => {}}
        onToggleCollapsed={() => {}} onRenameSection={() => {}} onDeleteSection={() => {}}
        onMoveSectionUp={() => {}} onMoveSectionDown={() => {}}
        renderRow={(channel) => <DraggableChannelRow channelId={`native-${channel.id}`}><button>{channel.name}</button></DraggableChannelRow>} />)}
      <DroppableUngroupedBody>
        <ChannelGroupSection title="Channels" items={[row("w2", "beta")]} hasUnread={false} isCollapsed={false}
          onToggleCollapsed={() => {}} listTestId="channel-list" actionsTestId="channel-actions"
          renderRow={(channel) => <DraggableChannelRow channelId={`native-${channel.id}`}><button>{channel.name}</button></DraggableChannelRow>} />
      </DroppableUngroupedBody>
    </SidebarDndContext>
  </TooltipProvider>;
}

const fire = async (element: Element, name: string) => {
  await act(async () => { element.dispatchEvent(new Event(name, { bubbles: true, cancelable: true })); });
};
const dragRow = (host: HTMLElement, label: string) =>
  button(host, label).closest("[data-sidebar-draggable-channel]")!;
const dropTarget = (host: HTMLElement, key: string) => host.querySelector(`[data-sidebar-drop-target="${key}"]`)!;

describe("native drag-and-drop over the original targets", () => {
  it("drops a channel on a section, back on Channels, and reorders section headers", async () => {
    Object.values(handlers).forEach((handler) => handler.mockClear());
    const host = await render(<PlatformProvider client={client} locale="en"><Sections enabled /></PlatformProvider>);
    expect(host.querySelector(`[data-testid="section-title-${sectionA.id}"]`)?.textContent).toBe("Launch");

    await fire(dragRow(host, "beta"), "dragstart");
    expect(dragRow(host, "beta").getAttribute("data-sidebar-drag-state")).toBe("dragging");
    await fire(dropTarget(host, `section:${sectionB.id}`), "dragenter");
    await fire(dropTarget(host, `section:${sectionB.id}`), "drop");
    expect(handlers.assign).toHaveBeenCalledWith("native-w2", sectionB.id);

    await fire(dragRow(host, "alpha"), "dragstart");
    await fire(dropTarget(host, "ungrouped"), "drop");
    expect(handlers.unassign).toHaveBeenCalledWith("native-w1");

    const handle = host.querySelector(`[data-sidebar-section-shell="${sectionA.id}"] [draggable="true"]`)!;
    await fire(handle, "dragstart");
    await fire(dropTarget(host, `section:${sectionB.id}`), "drop");
    expect(handlers.reorder).toHaveBeenCalledWith([sectionB.id, sectionA.id]);
  });

  it("keeps rows and headers inert while the Core preferences are not writable", async () => {
    Object.values(handlers).forEach((handler) => handler.mockClear());
    const host = await render(<PlatformProvider client={client} locale="en"><Sections enabled={false} /></PlatformProvider>);
    expect(dragRow(host, "beta").hasAttribute("draggable")).toBe(false);
    expect(host.querySelector(`[data-sidebar-section-shell="${sectionA.id}"] [draggable="true"]`)).toBeNull();
    await fire(dragRow(host, "beta"), "dragstart");
    await fire(dropTarget(host, `section:${sectionB.id}`), "drop");
    expect(handlers.assign).not.toHaveBeenCalled();
  });
});

describe("original section dialogs", () => {
  it("creates a section with a trimmed name and refuses an empty one", async () => {
    const onConfirm = vi.fn();
    await render(<PlatformProvider client={client} locale="en">
      <CreateSectionDialog open onOpenChange={() => {}} onConfirm={onConfirm} /></PlatformProvider>);
    await settle();
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    expect(dialog.textContent).toContain("Sections let you group related channels in the sidebar.");
    const create = button(dialog, "Create");
    expect(create.disabled).toBe(true);
    await type(dialog.querySelector("input")!, "  Launch  ");
    expect(create.disabled).toBe(false);
    await act(async () => { dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(onConfirm).toHaveBeenCalledWith({ name: "Launch" });
  });

  it("states how many channels return to the default group", async () => {
    await render(<PlatformProvider client={client} locale="en">
      <DeleteSectionAlertDialog open onOpenChange={() => {}} sectionName="Launch" channelCount={2} onConfirm={() => {}} /></PlatformProvider>);
    await settle();
    expect(document.querySelector("[data-testid=delete-section-dialog]")?.textContent)
      .toContain('Delete section "Launch"? Its 2 channels will move back to the default Channels group.');
  });
});

const menuItems = () => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")];

describe("original Move to section entry", () => {
  it("is offered in the channel menu and stays inert while preferences are unconfirmed", async () => {
    const actions = { sections: [sectionA], currentSectionId: sectionA.id, onAssign: vi.fn(), onUnassign: vi.fn(),
      onCreateSection: vi.fn(), disabled: true };
    const host = await render(<PlatformProvider client={client} locale="en"><TooltipProvider>
      <ChannelGroupSection title="Channels" items={[row("w", "general")]} hasUnread={false} isCollapsed={false}
        onToggleCollapsed={() => {}} listTestId="channel-list" actionsTestId="channel-actions"
        renderRow={() => <button>Open context</button>}
        renderContextMenu={(channel) => <ChannelContextMenuItems channel={channel} hasUnread={false} onCopy={() => {}}
          sectionActions={actions} />} />
    </TooltipProvider></PlatformProvider>);
    await act(async () => host.querySelector("li")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 1, clientY: 1 })));
    await settle();
    const move = menuItems().find((node) => node.textContent === "Move to section");
    expect(move?.getAttribute("aria-disabled")).toBe("true");
  });
});

const coreSort = vi.fn(async () => true);
const corePreferences = {
  writable: true,
  sortModeFor: (group: string) => group === "dms" ? "recent" : "alpha",
  setSortModeFor: coreSort,
} as unknown as CollaborationPreferenceActions;
const unconfirmedPreferences = { ...corePreferences, writable: false } as CollaborationPreferenceActions;

function SortProbe() {
  const { sortModeFor, setSortModeFor } = useChannelSortPreference("principal");
  return <button onClick={() => setSortModeFor("dms", "alpha")}>{sortModeFor("dms")}</button>;
}

describe("group sort follows the Core preference when the host provides it", () => {
  it("reads and writes sidebar_sort instead of the device store", async () => {
    coreSort.mockClear();
    const host = await render(<CollaborationPreferencesProvider value={corePreferences}><SortProbe /></CollaborationPreferencesProvider>);
    await act(async () => button(host, "recent").click());
    expect(coreSort).toHaveBeenCalledWith("dms", "alpha");
    expect(localStorage.length).toBe(0);
  });

  it("does not write while the Core state is unread or unconfirmed", async () => {
    coreSort.mockClear();
    const host = await render(<CollaborationPreferencesProvider value={unconfirmedPreferences}><SortProbe /></CollaborationPreferencesProvider>);
    await act(async () => button(host, "recent").click());
    expect(coreSort).not.toHaveBeenCalled();
  });
});
