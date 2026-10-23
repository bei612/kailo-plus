// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectDetailFeedPanels.tsx
// ::commitSelectionItem, ui/DiscussionChannels.tsx (channel rows) and lib/projectShareLinks.ts::commitShareLink:
// the remaining multi-select entry points — commit rows select with a shift range and carry the
// original commit share link; channel items keep their participants.
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n";
import { selectionItemFromChannel } from "../src/react/projects/lib/projectSelection";
import { ProjectSelectionProvider, useProjectSelection } from "../src/react/projects/lib/useProjectSelection";
import { ActivityPanel } from "../src/react/projects/ProjectCommitsPanel";
import { commitShareLink } from "../src/react/projects/projectShareLinks";
import type { Repository } from "../src/react/projects/projectModels";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { render, settle } from "./render";

beforeEach(() => { setLocale("en"); });

const owner = "a".repeat(64);
const repository = { id: "r", name: "repo", description: "", cloneUrls: [], webUrl: null, owner, contributors: [], createdAt: 1,
  status: "open", defaultBranch: "main", repoAddress: `30617:${owner}:repo`, channelId: "11111111-1111-4111-8111-111111111111" } as unknown as Repository;
const commit = (hash: string, subject: string) => ({ hash, shortHash: hash.slice(0, 7), authorName: "Ada", authorEmail: "ada@example.org", timestamp: 1, subject });
const commits = [commit("1".repeat(40), "first"), commit("2".repeat(40), "second"), commit("3".repeat(40), "third")];

function Probe() {
  const selection = useProjectSelection();
  return <output data-testid="selected">{selection?.items.map(item => `${item.id}|${item.shareLink}|${item.channelId}`).join(",")}</output>;
}

describe("remaining Projects selection entry points", () => {
  it("builds the original commit share link only for a linkable repository and git object id", () => {
    expect(commitShareLink(repository, commits[0]!.hash)).toBe(`buzz://repo?owner=${owner}&d=repo&tab=commits&commit=${commits[0]!.hash}`);
    expect(commitShareLink(repository, "not-a-hash")).toBeNull();
    expect(commitShareLink({ ...repository, repoAddress: "bad" }, commits[0]!.hash)).toBeNull();
  });

  it("selects commit rows with the original shift range inside a selection provider", async () => {
    const host = await render(<TooltipProvider><ProjectSelectionProvider resetKey="r:commits">
      <ActivityPanel commitItems={commits.map(item => ({ commit: item, project: repository, projectId: "p" }))} snapshot={null}
        isLoading={false} error={null} project={repository} projectId="p" repoContributors={[]} />
      <Probe />
    </ProjectSelectionProvider></TooltipProvider>);
    const controls = [...host.querySelectorAll<HTMLElement>('[data-testid="projects-row-select"]')];
    expect(controls).toHaveLength(3);
    await act(async () => { controls[0]!.click(); }); await settle();
    await act(async () => { controls[2]!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); }); await settle();
    const selected = host.querySelector('[data-testid="selected"]')!.textContent!.split(",");
    expect(selected.map(entry => entry.split("|")[0])).toEqual(commits.map(item => `commit:p:${item.hash}`));
    expect(selected[0]).toContain(`tab=commits&commit=${commits[0]!.hash}`);
    expect(selected[0]).toContain(repository.channelId!);
  });

  it("renders commit rows without select controls outside a selection provider", async () => {
    const host = await render(<TooltipProvider><ActivityPanel commitItems={[{ commit: commits[0]!, project: repository, projectId: "p" }]}
      snapshot={null} isLoading={false} error={null} project={repository} projectId="p" repoContributors={[]} /></TooltipProvider>);
    expect(host.querySelector('[data-testid="projects-row-select"]')).toBeNull();
  });

  it("keeps channel participants on the original channel selection item", () => {
    expect(selectionItemFromChannel({ channelId: "c", people: ["p1"], title: "#general" }))
      .toMatchObject({ id: "channel:c", kind: "channel", people: ["p1"], title: "#general" });
  });
});
