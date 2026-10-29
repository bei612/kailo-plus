import { describe, expect, it } from "vitest";
import { createBffClient } from "../src/client";
import {
  MAX_THREAD_PREFERENCES,
  checkCollaborationPreferences,
  followedPubkeys,
  isNotifiedForThread,
  movedSectionOrder,
  patchPreferences,
  type CollaborationPreferences,
} from "../src/collaboration-preferences";
import type { CollaborationUserState } from "../src/inbox";
import { useCollaborationPreferenceActions } from "../src/react/collaboration-preferences";
import { useInboxState } from "../src/react/use-inbox-state";
import type { BffRequest } from "../src/transport";
import { button, click, render, settle } from "./render";

const root = (n: number) => n.toString(16).padStart(64, "0");
const section = (id: string, order: number) => ({ id, name: id.slice(0, 4), order });
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

describe("DD-125 preference projection", () => {
  it("rejects shapes the Core writer never produces", () => {
    expect(() => checkCollaborationPreferences({ threadPreferences: { [`thread:${root(1)}`]: { state: "FOLLOWED", updatedAt: "2026-10-18T00:00:00Z" } } })).not.toThrow();
    expect(() => checkCollaborationPreferences({ threadPreferences: { "thread:x": { state: "FOLLOWED", updatedAt: "2026-10-18T00:00:00Z" } } })).toThrow();
    expect(() => checkCollaborationPreferences({ sidebarSections: { sections: [section("nope", 0)], assignments: {} } })).toThrow();
    expect(() => checkCollaborationPreferences({ followedPrincipals: { [ids[0]!]: { followedAt: "2026-10-18T00:00:00Z", pubkeys: ["A".repeat(64)] } } })).toThrow();
  });

  it("keeps the original follow/mute coupling and evicts the earliest follow over the cap", () => {
    let state: CollaborationPreferences = {};
    state = patchPreferences.thread(state, root(0), false, "2026-10-18T00:00:00.000Z");
    for (let n = 1; n <= MAX_THREAD_PREFERENCES; n += 1)
      state = patchPreferences.thread(state, root(n), true, new Date(Date.UTC(2026, 9, 18, 0, 0, n)).toISOString());
    expect(Object.keys(state.threadPreferences ?? {})).toHaveLength(MAX_THREAD_PREFERENCES);
    expect(state.threadPreferences?.[`thread:${root(0)}`]?.state).toBe("MUTED");
    expect(state.threadPreferences?.[`thread:${root(1)}`]).toBeUndefined();
    // isNotifiedForThread: a mute wins over participation; a follow notifies without it.
    expect(isNotifiedForThread(state, root(0), true)).toBe(false);
    expect(isNotifiedForThread(state, root(2), false)).toBe(true);
    expect(isNotifiedForThread(state, root(9999), true)).toBe(true);
  });

  it("moves a section by swapping it with its neighbour in display order", () => {
    const sections = [section(ids[0]!, 0), section(ids[1]!, 1), section(ids[2]!, 2)];
    expect(movedSectionOrder(sections, ids[1]!, "up")).toEqual([ids[1], ids[0], ids[2]]);
    expect(movedSectionOrder(sections, ids[2]!, "down")).toBeNull();
    const deleted = patchPreferences.deleteSection({
      sidebarSections: { sections, assignments: { [ids[2]!]: ids[0]! } },
      sidebarSort: { [`section:${ids[0]}`]: { mode: "recent", updatedAt: "2026-10-18T00:00:00Z" } },
    }, ids[0]!, "2026-10-18T00:00:01Z");
    expect(deleted.sidebarSections?.assignments).toEqual({});
    expect(deleted.sidebarSort).toEqual({});
  });

  it("expands followed Principals to every active key", () => {
    expect(followedPubkeys({ followedPrincipals: {
      [ids[0]!]: { followedAt: "2026-10-18T00:00:00Z", pubkeys: [root(1), root(2)] },
      [ids[1]!]: { followedAt: "2026-10-18T00:00:00Z", pubkeys: [root(2)] },
    } })).toEqual([root(1), root(2)]);
  });
});

const empty = (version: number): CollaborationUserState => ({ version, workspacePreferences: {}, readContexts: {} });

function Harness({ client }: { client: ReturnType<typeof createBffClient> }) {
  const reads = useInboxState(client);
  const actions = useCollaborationPreferenceActions(client, reads);
  return <>
    <output>{JSON.stringify({ version: reads.state?.version ?? null, following: actions.isFollowingThread(root(7)), muted: actions.isThreadMuted(root(7)) })}</output>
    <button disabled={!actions.writable} onClick={() => void actions.followThread(root(7))}>Follow</button>
    <button disabled={!actions.writable} onClick={() => void actions.unfollowThread(root(7))}>Unfollow</button>
  </>;
}

describe("DD-125 preference writes share the read-mark CAS queue", () => {
  it("sends the read version, projects the ACK locally and re-reads after a conflict", async () => {
    let current = empty(3);
    let conflict = false;
    const writes: BffRequest[] = [];
    const client = createBffClient({ send: async (request) => {
      if (request.method === "GET" && request.path === "/api/v1/workspaces") return { status: 200, body: [] };
      if (request.method === "GET" && request.path.startsWith("/api/v1/conversations")) return { status: 200, body: { items: [] } };
      if (request.method === "GET") return { status: 200, body: current };
      writes.push(request);
      if (conflict) return { status: 409, body: undefined };
      const body = request.body as { followed: boolean; version: number };
      current = { ...current, version: body.version + 1,
        threadPreferences: { [`thread:${root(7)}`]: { state: body.followed ? "FOLLOWED" : "MUTED", updatedAt: "2026-10-18T00:00:00Z" } } };
      return { status: 200, body: { version: current.version } };
    } });
    const ui = await render(<Harness client={client} />);
    await settle();
    const output = () => JSON.parse(ui.querySelector("output")!.textContent!);
    expect(output()).toEqual({ version: 3, following: false, muted: false });

    await click(button(ui, "Follow"));
    expect(writes[0]).toMatchObject({ method: "PUT", path: "/api/v1/user-state/threads",
      body: { threadKey: `thread:${root(7)}`, followed: true, version: 3 } });
    expect(output()).toEqual({ version: 4, following: true, muted: false });

    // Another end moved the version: the stale write is refused and the authority re-read.
    current = { ...current, version: 6 };
    conflict = true;
    await click(button(ui, "Unfollow"));
    await settle();
    expect(writes[1]).toMatchObject({ body: { followed: false, version: 4 } });
    expect(output()).toEqual({ version: 6, following: true, muted: false });
  });
});

const workspace = "44444444-4444-4444-8444-444444444444";

function MuteHarness({ client }: { client: ReturnType<typeof createBffClient> }) {
  const reads = useInboxState(client);
  const actions = useCollaborationPreferenceActions(client, reads);
  return <>
    <output>{JSON.stringify({ version: reads.state?.version ?? null, muted: actions.isWorkspaceMuted(workspace) ?? null })}</output>
    <button disabled={!actions.writable} onClick={() => void actions.setWorkspaceMuted(workspace, true)}>Mute</button>
  </>;
}

describe("DD-150(3) channel mute is the Workspace preference", () => {
  it("writes muted with the Star and version of the same Core snapshot, no action", async () => {
    let current: CollaborationUserState = { version: 5, readContexts: {},
      workspacePreferences: { [workspace]: { starred: true, muted: false } } };
    const writes: BffRequest[] = [];
    const client = createBffClient({ send: async (request) => {
      if (request.method === "GET" && request.path === "/api/v1/workspaces") return { status: 200, body: [] };
      if (request.method === "GET" && request.path.startsWith("/api/v1/conversations")) return { status: 200, body: { items: [] } };
      if (request.method === "GET") return { status: 200, body: current };
      writes.push(request);
      const body = request.body as { muted: boolean; starred: boolean; version: number };
      current = { ...current, version: body.version + 1,
        workspacePreferences: { [workspace]: { starred: body.starred, muted: body.muted } } };
      return { status: 200, body: { version: current.version } };
    } });
    const ui = await render(<MuteHarness client={client} />);
    await settle();
    const output = () => JSON.parse(ui.querySelector("output")!.textContent!);
    expect(output()).toEqual({ version: 5, muted: false });
    await click(button(ui, "Mute"));
    await settle();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "PUT", path: `/api/v1/user-state/workspaces/${workspace}`,
      body: { muted: true, starred: true, version: 5 } });
    expect(writes.some((request) => request.path === "/api/v1/actions")).toBe(false);
    expect(output()).toEqual({ version: 6, muted: true });
  });
});

function StarHarness({ client }: { client: ReturnType<typeof createBffClient> }) {
  const reads = useInboxState(client);
  const actions = useCollaborationPreferenceActions(client, reads);
  return <>
    <output>{JSON.stringify({ version: reads.state?.version ?? null, starred: actions.isWorkspaceStarred(workspace) ?? null })}</output>
    <button disabled={!actions.writable} onClick={() => void actions.setWorkspaceStarred(workspace, true)}>Star</button>
  </>;
}

describe("Desktop channel Star is the Workspace preference", () => {
  it("writes starred with the mute and version of the same Core snapshot, no action", async () => {
    let current: CollaborationUserState = { version: 7, readContexts: {},
      workspacePreferences: { [workspace]: { starred: false, muted: true } } };
    const writes: BffRequest[] = [];
    const client = createBffClient({ send: async (request) => {
      if (request.method === "GET" && request.path === "/api/v1/workspaces") return { status: 200, body: [] };
      if (request.method === "GET" && request.path.startsWith("/api/v1/conversations")) return { status: 200, body: { items: [] } };
      if (request.method === "GET") return { status: 200, body: current };
      writes.push(request);
      const body = request.body as { muted: boolean; starred: boolean; version: number };
      current = { ...current, version: body.version + 1,
        workspacePreferences: { [workspace]: { starred: body.starred, muted: body.muted } } };
      return { status: 200, body: { version: current.version } };
    } });
    const ui = await render(<StarHarness client={client} />);
    await settle();
    const output = () => JSON.parse(ui.querySelector("output")!.textContent!);
    expect(output()).toEqual({ version: 7, starred: false });
    await click(button(ui, "Star"));
    await settle();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: "PUT", path: `/api/v1/user-state/workspaces/${workspace}`,
      body: { starred: true, muted: true, version: 7 } });
    expect(writes.some((request) => request.path === "/api/v1/actions")).toBe(false);
    expect(output()).toEqual({ version: 8, starred: true });
  });
});
