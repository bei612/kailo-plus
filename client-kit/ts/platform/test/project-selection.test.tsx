// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/lib/projectSelection.ts,
// lib/useProjectSelection.tsx and ui/ProjectsSelectionCountMenu.tsx: the restored Projects
// multi-select (state transitions, row/group controls, Escape) and its selection pod actions.
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import {
  EMPTY_PROJECT_SELECTION, nextProjectGroupSelection, nextProjectSelection, projectSelectionPresentation,
  selectionItemFromCommit, selectionItemFromTask, type ProjectSelectionItem,
} from "../src/react/projects/lib/projectSelection";
import { ProjectSelectionProvider, useProjectSelection } from "../src/react/projects/lib/useProjectSelection";
import { ProjectEntityListRow } from "../src/react/projects/ProjectEntityListRow";
import { ProjectSelectableGroup } from "../src/react/projects/ProjectSelectableGroup";
import { ProjectsSelectionCountMenu } from "../src/react/projects/ProjectsSelectionCountMenu";
import { PulseHostProvider, type PulseHost } from "../src/react/pulse/host";
import { render, settle } from "./render";

const task = (id: string, link: string | null = `buzz://task/${id}`) => selectionItemFromTask({ id, title: `Task ${id}`, shareLink: link, channelId: "c" });
const [a, b, c, d] = ["a", "b", "c", "d"].map(id => task(id)) as [ProjectSelectionItem, ProjectSelectionItem, ProjectSelectionItem, ProjectSelectionItem];

beforeEach(() => { setLocale("en"); });

describe("original Projects selection state", () => {
  it("toggles items, keeps one kind, and extends shift ranges from the anchor", () => {
    let state = nextProjectSelection(EMPTY_PROJECT_SELECTION, b);
    state = nextProjectSelection(state, d, { rangeItems: [a, b, c, d], shiftKey: true });
    expect(state.items.map(item => item.id)).toEqual([b.id, c.id, d.id]);
    expect(state.anchorId).toBe(b.id);
    state = nextProjectSelection(state, c);
    expect(state.items.map(item => item.id)).toEqual([b.id, d.id]);
    const commit = selectionItemFromCommit({ commitHash: "abc", projectId: "p", title: "abc" });
    state = nextProjectSelection(state, commit);
    expect(state.items).toEqual([commit]);
  });

  it("selects a whole group, then clears it when it is fully selected", () => {
    let state = nextProjectGroupSelection(nextProjectSelection(EMPTY_PROJECT_SELECTION, a), [a, b]);
    expect(state.items.map(item => item.id)).toEqual([a.id, b.id]);
    state = nextProjectGroupSelection(state, [a, b]);
    expect(state.items).toEqual([]);
  });

  it("offers the original actions: chat, discuss, create review for commits, copy links when present", () => {
    expect(projectSelectionPresentation([a, b])!.actions.map(action => action.id)).toEqual(["chat-agent", "discuss", "copy"]);
    expect(projectSelectionPresentation([task("x", null)])!.actions.map(action => action.id)).toEqual(["chat-agent", "discuss"]);
    const commit = selectionItemFromCommit({ commitHash: "abc", projectId: "p", title: "abc" });
    expect(projectSelectionPresentation([commit])!.actions.map(action => action.id)).toEqual(["chat-agent", "discuss", "create-review"]);
    expect(projectSelectionPresentation([])).toBeNull();
  });
});

function host(copy: PulseHost["copy"]): PulseHost {
  return { scopeKey: "s", pubkey: "p", query: async () => [], publish: async () => ({ eventId: "e" }), copy, startDm: async () => {},
    mediaUrl: url => url, renderContent: content => <p>{content}</p>, renderComposer: () => null };
}

function Pod({ onChat }: { onChat: (items: ProjectSelectionItem[]) => void }) {
  const selection = useProjectSelection()!;
  const presentation = projectSelectionPresentation(selection.items);
  return presentation ? <ProjectsSelectionCountMenu onChatWithAgent={onChat} presentation={presentation} scopeKey="s" selectionItems={selection.items} />
    : <p data-testid="no-selection">none</p>;
}

async function mount(onChat = vi.fn(), copy = vi.fn(async () => {})) {
  const host_ = await render(<PulseHostProvider host={host(copy)}><ProjectSelectionProvider resetKey="tasks">
    <ProjectSelectableGroup count={2} groupKey="g" headerTestId="group" icon={<span />} items={[a, b]} label="Group" testId="g">
      {[a, b].map(item => <ProjectEntityListRow icon={<span />} key={item.id} onClick={() => {}} selection={{ item, rangeItems: [a, b] }}
        testId={`row-${item.id}`} title={item.title} />)}
    </ProjectSelectableGroup>
    <Pod onChat={onChat} />
  </ProjectSelectionProvider></PulseHostProvider>);
  return { host: host_, onChat, copy };
}

const check = async (element: Element) => { await act(async () => { (element as HTMLInputElement).click(); }); await settle(); };

describe("original row/group select controls and selection pod", () => {
  it("selects rows, shows the original summary and clears on Escape", async () => {
    const { host } = await mount();
    expect(host.querySelector('[data-testid="no-selection"]')).not.toBeNull();
    await check(host.querySelector(`[data-testid="row-${a.id}"] [data-testid="projects-row-select"]`)!);
    expect(host.querySelector(`[data-testid="row-${a.id}"]`)?.getAttribute("data-selected")).toBe("true");
    expect(host.querySelector('[data-testid="projects-overview-context-title"]')?.textContent).toBe("1 task");
    await check(host.querySelector('[data-testid="projects-group-select"]')!);
    expect(host.querySelector('[data-testid="projects-overview-context-title"]')?.textContent).toBe("2 tasks");
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    await settle();
    expect(host.querySelector('[data-testid="no-selection"]')).not.toBeNull();
  });

  it("copies the selection links and hands the selection to the Agent chat", async () => {
    const { host, onChat, copy } = await mount();
    await check(host.querySelector('[data-testid="projects-group-select"]')!);
    await act(async () => { host.querySelector<HTMLElement>('[data-testid="projects-selection-copy"]')!.click(); });
    expect(copy).toHaveBeenCalledWith(`${a.shareLink}\n${b.shareLink}`);
    expect(host.querySelector('[data-testid="projects-selection-copy"]')?.textContent).toBe("Copy links");
    // Discuss needs the host's governed draft handoff; without it the entry is not offered.
    expect(host.querySelector('[data-testid="projects-selection-discuss"]')).toBeNull();
    await act(async () => { host.querySelector<HTMLElement>('[data-testid="projects-selection-chat-agent"]')!.click(); });
    await settle();
    expect(onChat).toHaveBeenCalledWith([a, b]);
    expect(host.querySelector('[data-testid="no-selection"]')).not.toBeNull();
  });

  it("renders the pod in Chinese", async () => {
    setLocale("zh-CN");
    const { host } = await mount();
    await check(host.querySelector('[data-testid="projects-group-select"]')!);
    expect(host.querySelector('[data-testid="projects-overview-context-title"]')?.textContent).toBe("2 个任务");
    expect(host.querySelector('[data-testid="projects-selection-clear"]')?.textContent).toBe("清除选择");
  });
});
