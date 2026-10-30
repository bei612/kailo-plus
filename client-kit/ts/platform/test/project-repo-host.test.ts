// Buzz 779af8886caae1317b4de962082429867ab61503 projectRepoHost / projectGitError: the repository
// card host mark and path (DD-118) and the clone failure copy that keeps 401/403/404 as one answer
// (DD-160(1)).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n";
import { TransportError } from "../src/transport";
import { projectCloneErrorPresentation } from "../src/react/projects/lib/projectGitError";
import { projectRepoHostForRepository, projectRepoPresentation, repositoryDisplayPath } from "../src/react/projects/lib/projectRepoHost";
import { projectRepoUnavailablePresentation } from "../src/react/projects/lib/projectRepoAvailability";

const owner = "a".repeat(64);

describe("repository host presentation", () => {
  it("gates local clone to Kailo-hosted repositories and links external ones only over http(s) (useProjectRepoHost)", () => {
    const hosted = projectRepoPresentation({ cloneUrls: [`https://relay.example/git/${owner}/app`], dtag: "app", owner, webUrl: "https://relay.example/app" });
    expect(hosted.canCloneLocally).toBe(true);
    expect(hosted.controls).toEqual({ externalUrl: null, remoteKind: "kailo", remoteLabel: null });
    const external = projectRepoPresentation({ cloneUrls: ["https://github.com/org/tool.git"], dtag: "tool", owner, webUrl: "https://github.com/org/tool" });
    expect(external.canCloneLocally).toBe(false);
    expect(external.controls).toEqual({ externalUrl: "https://github.com/org/tool", remoteKind: "external", remoteLabel: "github.com" });
    const unsafe = projectRepoPresentation({ cloneUrls: ["https://github.com/org/tool.git"], dtag: "tool", owner, webUrl: "javascript:alert(1)" });
    expect(unsafe.webUrl).toBeNull();
    expect(unsafe.controls.externalUrl).toBeNull();
    const bare = projectRepoPresentation({ cloneUrls: [], dtag: "x", owner, webUrl: null });
    expect(bare).toMatchObject({ canCloneLocally: false, controls: { externalUrl: null, remoteKind: undefined, remoteLabel: null } });
  });

  it("treats a canonical same-owner clone URL as Kailo-hosted and claims nothing without one", () => {
    const hosted = { cloneUrls: [`https://relay.example/git/${owner}/app`], dtag: "app", owner };
    expect(projectRepoHostForRepository(hosted)).toEqual({ kind: "kailo" });
    expect(repositoryDisplayPath(hosted, "Dana")).toBe("Dana/app");
    expect(repositoryDisplayPath(hosted, "  ")).toBe("aaaaaaaa…/app");
    expect(projectRepoHostForRepository({ cloneUrls: [], dtag: "app", owner })).toEqual({ kind: "unresolved" });
    expect(repositoryDisplayPath({ cloneUrls: [], dtag: "app", owner }, "Dana")).toBeNull();
  });

  it("names external git data by host and path, never another owner's canonical path", () => {
    const external = { cloneUrls: ["https://github.com/org/tool.git"], dtag: "tool", owner };
    expect(projectRepoHostForRepository(external)).toEqual({ kind: "external", host: "github.com" });
    expect(repositoryDisplayPath(external, "Dana")).toBe("github.com/org/tool");
    const foreign = { cloneUrls: [`https://relay.example/git/${"b".repeat(64)}/app`], dtag: "app", owner };
    expect(projectRepoHostForRepository(foreign)).toEqual({ kind: "external", host: "relay.example" });
    expect(projectRepoHostForRepository({ cloneUrls: ["not a url"], dtag: "x", owner })).toEqual({ kind: "unresolved" });
    expect(repositoryDisplayPath({ cloneUrls: ["not a url"], dtag: "x", owner })).toBeNull();
  });
});

describe("clone failure presentation", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => setLocale("zh-CN"));

  it("does not distinguish a missing repository from a denied one", () => {
    const unreadable = projectRepoUnavailablePresentation("unknown");
    expect(projectCloneErrorPresentation("project_repo_not_found")).toEqual(unreadable);
    expect(projectCloneErrorPresentation(new Error("project_repo_unavailable"))).toEqual(unreadable);
  });

  it("separates unreachable from other failures", () => {
    expect(projectCloneErrorPresentation("project_repo_timeout")).toEqual(projectRepoUnavailablePresentation("network"));
    expect(projectCloneErrorPresentation(new TransportError("offline"))).toEqual(projectRepoUnavailablePresentation("network"));
    expect(projectCloneErrorPresentation("project_repo_failed")).toEqual({
      title: "Couldn’t clone repository",
      description: "Try again. If the problem continues, contact the repository owner.",
    });
  });
});
