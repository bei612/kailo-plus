// @vitest-environment jsdom
// DD-118: the Web Projects host reads repository content only through the typed BFF query and
// maps the contract back to the original Buzz Desktop shapes (absent latestCommit -> null).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProjectsHost } from "@client-kit/platform/react/projects";
import { useProjectsHost } from "./ProjectsPane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const repository = `30617:${"b".repeat(64)}:repo`;
const commit = { hash: "1".repeat(40), shortHash: "1111111", authorName: "Ada", authorEmail: "ada@example.test", timestamp: 1_700_000_000, subject: "Initial import" };
let root: Root, element: HTMLDivElement, captured: ProjectsHost | undefined;

function Probe() {
  captured = useProjectsHost("tenant:principal:session");
  return null;
}

beforeEach(async () => {
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () => root.render(<Probe />));
});
afterEach(() => {
  act(() => root.unmount());
  element.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function respond(body: unknown, status = 200) {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it("posts the typed SNAPSHOT query and maps absent commits to the original null", async () => {
  const fetcher = respond({ view: "SNAPSHOT", snapshot: { commits: [commit], contributors: [],
    files: [{ path: "README.md", kind: "file", size: 4, previewContent: "# Hi", lastChangedAt: null }] } });
  const snapshot = await captured!.git!.getProjectRepoSnapshot({ repository, defaultBranch: "main", baseBranch: "main", targetRef: null, targetCommit: null });
  expect(String(fetcher.mock.lastCall![0])).toContain("/api/v1/projects/git/query");
  expect(fetcher.mock.lastCall![1].method).toBe("POST");
  expect(JSON.parse(fetcher.mock.lastCall![1].body)).toEqual({ view: "SNAPSHOT", repository, defaultBranch: "main", baseBranch: "main" });
  expect(snapshot.latestCommit).toBeNull();
  expect(snapshot.files[0]?.latestCommit).toBeNull();
  expect(snapshot.commits).toEqual([commit]);
});

it("names the file by path and the review by its nostr ref, never a Relay URL", async () => {
  const fetcher = respond({ view: "FILE_CONTENT", content: "plan" });
  const target = { repository, defaultBranch: "release", targetRef: `refs/nostr/${"2".repeat(64)}`, targetCommit: "f".repeat(40) };
  expect(await captured!.git!.getProjectRepoFileContent({ ...target, path: "notes/plan.txt" })).toBe("plan");
  const body = JSON.parse(fetcher.mock.lastCall![1].body);
  expect(body).toEqual({ view: "FILE_CONTENT", ...target, path: "notes/plan.txt" });
  expect(JSON.stringify(body)).not.toMatch(/https?:|wss?:/);
});

it("keeps BFF refusals as errors instead of rendering empty content", async () => {
  respond({ class: "REJECTED", reason: "TARGET_NOT_FOUND" }, 404);
  await expect(captured!.git!.getProjectRepoDiff({ repository })).rejects.toMatchObject({ status: 404 });
});

it("rejects reads from a host whose scope ended", async () => {
  const host = captured!;
  const fetcher = respond({ view: "DIFF", diff: { additions: 0, deletions: 0, commitBody: null, files: [] } });
  act(() => root.unmount());
  await expect(host.git!.getProjectRepoDiff({ repository })).rejects.toThrow("Project scope changed");
  expect(fetcher).not.toHaveBeenCalled();
  root = createRoot(element);
});
