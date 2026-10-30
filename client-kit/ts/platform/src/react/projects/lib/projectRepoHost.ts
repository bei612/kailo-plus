// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectRepoHost.ts (projectRepoHost,
// projectRepoHostForRepository, repositoryDisplayPath), used by the repository cards, and
// desktop/src/features/projects/useProjectRepoHost.ts (useProjectRepoPresentation: remote label,
// external link and clone gating) for the project detail checkout controls.
// DD-118: the governed Projects read names a repository by its 30617 coordinate and carries no
// Relay origin, so "hosted here" is decided from the announcement itself: an explicit clone URL with
// the canonical `/git/<owner>/<repo>` path of that same owner is a Kailo-hosted repository and any
// other explicit clone URL is external git data. Without a clone URL nothing is claimed (the
// original unresolved mark): Git availability is not invented for a bare announcement. Presentation
// only — the Desktop git host and the BFF remain the boundary for every clone and read.

export type ProjectRepoHost =
  | { kind: "kailo" }
  | { kind: "external"; host: string }
  | { kind: "unresolved" };

type RepositoryHostInput = { cloneUrls: string[]; dtag: string; owner: string; webUrl?: string | null };

const CANONICAL_PATH = /^\/git\/([0-9a-f]{64})\/([^/]+?)(?:\.git)?\/?$/i;

export function projectRepoHostForRepository(repository: RepositoryHostInput | null | undefined): ProjectRepoHost {
  if (!repository) return { kind: "unresolved" };
  const cloneUrl = repository.cloneUrls[0];
  if (!cloneUrl) return { kind: "unresolved" };
  try {
    const url = new URL(cloneUrl);
    const canonical = CANONICAL_PATH.exec(url.pathname);
    if (canonical && canonical[1]!.toLowerCase() === repository.owner.toLowerCase()) return { kind: "kailo" };
    return url.host ? { kind: "external", host: url.host } : { kind: "unresolved" };
  } catch {
    return { kind: "unresolved" };
  }
}

/**
 * Where the git data lives: "github.com/org/repo" for external repositories (`.git` stripped),
 * "owner/repo" for Kailo-hosted ones with the resolved owner label (short pubkey fallback).
 */
export function repositoryDisplayPath(repository: RepositoryHostInput | null | undefined, ownerLabel?: string | null): string | null {
  if (!repository) return null;
  const host = projectRepoHostForRepository(repository);
  if (host.kind === "kailo") {
    const owner = ownerLabel?.trim() || `${repository.owner.slice(0, 8)}…`;
    return `${owner}/${repository.dtag}`;
  }
  if (host.kind !== "external") return null;
  try {
    const url = new URL(repository.cloneUrls[0]!);
    const path = url.pathname.replace(/\/+$/, "").replace(/\.git$/i, "");
    return `${url.host}${path}`;
  } catch {
    return null;
  }
}

export type ProjectRepoPresentation = {
  host: ProjectRepoHost;
  /** The announcement's web page, only when it is an http(s) URL. */
  webUrl: string | null;
  /**
   * DD-160(1): the Desktop host clones only by 30617 coordinate from the admitted Relay, so only a
   * Kailo-hosted repository can be checked out locally. The original also allowed github.com
   * clones; Kailo never hands an announced URL to git, so those stay remote-only.
   */
  canCloneLocally: boolean;
  /** Original remote dropdown: the external host as the remote label plus an "open" link. */
  controls: { externalUrl: string | null; remoteKind?: "kailo" | "external"; remoteLabel: string | null };
};

function safeWebUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function projectRepoPresentation(repository: RepositoryHostInput | null | undefined): ProjectRepoPresentation {
  const host = projectRepoHostForRepository(repository);
  const webUrl = safeWebUrl(repository?.webUrl);
  return {
    host,
    webUrl,
    canCloneLocally: host.kind === "kailo",
    controls: {
      externalUrl: host.kind === "external" ? webUrl : null,
      remoteKind: host.kind === "unresolved" ? undefined : host.kind,
      remoteLabel: host.kind === "external" ? host.host : null,
    },
  };
}
