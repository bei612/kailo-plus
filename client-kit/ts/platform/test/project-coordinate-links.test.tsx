// REQ-24 / DD-118 / DD-160(5): original entityLinks.tsx coordinate navigation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { EntityLinkAnchor, openProjectEntity, type ProjectsHost } from "../src/react/projects";
import type { PulseEvent } from "../src/react/pulse/host";
import type { ParsedEntityLink } from "../src/react/projects/entityLink";
import { render, click } from "./render";

const owner = "b".repeat(64), viewer = "a".repeat(64), hash = "f".repeat(40);
const repo = `30617:${owner}:repo`, project = `30621:${owner}:project`;
function fixture() {
  const rows: PulseEvent[] = [
    { id: "8".repeat(64), pubkey: owner, kind: 30617, created_at: 20, content: "", tags: [["d", "repo"], ["name", "Readable repository"], ["clone", "https://example.test/repo.git"]] },
    { id: "9".repeat(64), pubkey: owner, kind: 30621, created_at: 20, content: "", tags: [["d", "project"], ["name", "Readable project"], ["a", repo]] },
  ];
  const kinds: Record<string, number[]> = { PROJECTS: [30621], REPOSITORIES: [30617], DELETIONS: [5] };
  const query = vi.fn<ProjectsHost["query"]>(async request => ({ pubkey: viewer, limit: 20, bindingVersion: 3,
    events: rows.filter(row => kinds[request.view]?.includes(row.kind)) }));
  return { rows, query, host: { scopeKey: "tenant:human", query } satisfies ProjectsHost };
}
const client = createBffClient({ send: async () => ({ status: 200, body: {} }) });
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("coordinate link original consumers", () => {
  it.each(["en", "zh-CN"] as const)("opens project and repository links using the current directory in %s", async locale => {
    const f = fixture(), opened = vi.fn(async () => {}), failed = vi.fn();
    const view = await render(<PlatformProvider client={client} locale={locale}>
      <EntityLinkAnchor href={`buzz://project?owner=${owner}&d=project`} runtime={{ host: f.host, onOpen: opened, copyLink: vi.fn(), onError: failed }}/>
      <EntityLinkAnchor href={`buzz://repo?owner=${owner}&d=repo&tab=commits&commit=${hash}`} runtime={{ host: f.host, onOpen: opened, copyLink: vi.fn(), onError: failed }}/>
    </PlatformProvider>);
    await vi.waitFor(() => expect(view.querySelector('[data-buzz-link-kind="project"]')?.getAttribute("aria-label")).toContain("Readable project"));
    await vi.waitFor(() => expect(view.querySelector('[data-buzz-link-kind="repo"]')?.getAttribute("aria-label")).toContain("Readable repository"));
    expect(view.querySelector('[data-buzz-link-kind="repo"]')?.getAttribute("aria-label")).toContain(locale === "en" ? "Open commit" : "打开仓库");
    f.query.mockClear();
    await click(view.querySelector<HTMLElement>('[data-buzz-link-kind="project"]')!);
    await vi.waitFor(() => expect(opened).toHaveBeenCalledWith(project, {}));
    await click(view.querySelector<HTMLElement>('[data-buzz-link-kind="repo"]')!);
    await vi.waitFor(() => expect(opened).toHaveBeenCalledWith(project, { repositoryId: `${owner}:repo`, tab: "commits", commitHash: hash }));
    expect(f.query.mock.calls.filter(([request]) => request.view === "PROJECTS")).toHaveLength(2);
    expect(failed).not.toHaveBeenCalled();
  });

  it("keeps project tabs and standalone repositories, and rejects missing or other-owner coordinates", async () => {
    const f = fixture(), opened = vi.fn(async () => {}), signal = new AbortController().signal;
    await openProjectEntity(f.host, { type: "project", owner, dtag: "project", tab: "issues" }, signal, opened);
    expect(opened).toHaveBeenLastCalledWith(project, { tab: "issues" });
    f.rows.splice(1, 1);
    await openProjectEntity(f.host, { type: "repo", owner, dtag: "repo" }, signal, opened);
    expect(opened).toHaveBeenLastCalledWith(repo, { repositoryId: `${owner}:repo` });
    opened.mockClear();
    for (const link of [
      { type: "project", owner, dtag: "project" },
      { type: "repo", owner: viewer, dtag: "repo" },
      { type: "repo", owner, dtag: "missing" },
    ] satisfies ParsedEntityLink[]) await expect(openProjectEntity(f.host, link, signal, opened)).rejects.toThrow("unavailable");
    expect(opened).not.toHaveBeenCalled();
  });

  it("keeps the repository coordinate when the same commit is linked from two repositories", async () => {
    const f = fixture(), opened = vi.fn(async () => {});
    const second = `30617:${owner}:second`;
    f.rows.push({ ...f.rows[0]!, id: "7".repeat(64), tags: [["d", "second"], ["name", "Second repository"], ["clone", "https://example.test/second.git"]] });
    f.rows[1]!.tags.push(["a", second]);
    for (const dtag of ["repo", "second"]) {
      await openProjectEntity(f.host, { type: "repo", owner, dtag, tab: "commits", commitHash: hash }, new AbortController().signal, opened);
      expect(opened).toHaveBeenLastCalledWith(project, { repositoryId: `${owner}:${dtag}`, tab: "commits", commitHash: hash });
    }
    f.rows.push({ id: "6".repeat(64), pubkey: owner, kind: 5, created_at: 21, content: "", tags: [["a", second]] });
    opened.mockClear();
    await expect(openProjectEntity(f.host, { type: "repo", owner, dtag: "second", tab: "commits", commitHash: hash }, new AbortController().signal, opened)).rejects.toThrow("unavailable");
    expect(opened).not.toHaveBeenCalled();
  });

  it.each(["repo", "project"] as const)("does not navigate a warm %s link after fresh access is refused", async type => {
    const f = fixture(), opened = vi.fn(async () => {}), failed = vi.fn();
    const view = await render(<PlatformProvider client={client} locale="en"><EntityLinkAnchor
      href={`buzz://${type}?owner=${owner}&d=${type === "repo" ? "repo" : "project"}`}
      runtime={{ host: f.host, onOpen: opened, copyLink: vi.fn(), onError: failed }}/></PlatformProvider>);
    await vi.waitFor(() => expect(view.querySelector('[data-buzz-link-kind]')?.getAttribute("aria-label")).toContain("Readable"));
    f.query.mockRejectedValue(new Error("current reader revoked"));
    await click(view.querySelector<HTMLElement>('[data-buzz-link-kind]')!);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(opened).not.toHaveBeenCalled();
    expect(view.querySelector('[data-buzz-link-kind]')?.getAttribute("aria-label")).not.toContain("Readable");
  });

  it("refuses scope changes between directory pages and aborts an old click after identity replacement", async () => {
    const f = fixture(), opened = vi.fn(async () => {}), failed = vi.fn();
    let switchHost!: (host: ProjectsHost) => void;
    function Surface() {
      const [host, setHost] = useState<ProjectsHost>(f.host); switchHost = setHost;
      return <EntityLinkAnchor href={`buzz://repo?owner=${owner}&d=repo`} runtime={{ host, onOpen: opened, copyLink: vi.fn(), onError: failed }}/>;
    }
    const view = await render(<PlatformProvider client={client} locale="en"><Surface/></PlatformProvider>);
    await vi.waitFor(() => expect(view.querySelector('[data-buzz-link-kind]')?.getAttribute("aria-label")).toContain("Readable"));
    let resolve!: (page: Awaited<ReturnType<ProjectsHost["query"]>>) => void;
    f.query.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await click(view.querySelector<HTMLElement>('[data-buzz-link-kind]')!);
    await act(async () => switchHost({ scopeKey: "other:identity", query: async () => { throw new Error("unreadable"); } }));
    await act(async () => resolve({ pubkey: viewer, limit: 20, bindingVersion: 3, events: f.rows.filter(row => row.kind === 30621) }));
    expect(opened).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
    const changed = fixture();
    changed.query.mockImplementation(async request => ({ pubkey: viewer, limit: 20,
      bindingVersion: request.view === "PROJECTS" ? 3 : 4, events: changed.rows.filter(row => row.kind === (request.view === "PROJECTS" ? 30621 : 30617)) }));
    await expect(openProjectEntity(changed.host, { type: "repo", owner, dtag: "repo" }, new AbortController().signal, opened)).rejects.toThrow("scope changed");
    expect(opened).not.toHaveBeenCalled();
  });
});
