// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectRepoAvailability.ts. Same reasons and copy. The BFF
// (DD-118) answers with contract reason codes instead of git stderr: TARGET_NOT_FOUND never says
// why (one Relay 404), DEPENDENCY_UNAVAILABLE is the network case. The author-only unbound hint is
// not yet produced by the BFF.
// The membership refinement is not restored: the Relay 404 must stay indistinguishable.
import { translateCurrent as t } from "../../../i18n";
import { BffError, TransportError } from "../../../transport";

export type ProjectRepoUnavailableReason = "missing" | "access" | "unbound" | "authentication" | "network" | "ref" | "unknown";

/** User-facing copy for a classified repository availability failure. */
export type ProjectRepoUnavailablePresentation = { description: string; title: string };

const PRESENTATION_KEYS = {
  authentication: ["projects.git.unavailable.authenticationTitle", "projects.git.unavailable.authentication"],
  missing: ["projects.git.unavailable.missingTitle", "projects.git.unavailable.missing"],
  access: ["projects.git.unavailable.accessTitle", "projects.git.unavailable.access"],
  unbound: ["projects.git.unavailable.unboundTitle", "projects.git.unavailable.unbound"],
  network: ["projects.git.unavailable.networkTitle", "projects.git.unavailable.network"],
  ref: ["projects.git.unavailable.refTitle", "projects.git.unavailable.ref"],
  unknown: ["projects.git.unavailable.unknownTitle", "projects.git.unavailable.unknown"],
} as const satisfies Record<ProjectRepoUnavailableReason, readonly [string, string]>;

/** Returns consistent, sanitized copy for repository availability UI. */
export function projectRepoUnavailablePresentation(reason: ProjectRepoUnavailableReason): ProjectRepoUnavailablePresentation {
  const [title, description] = PRESENTATION_KEYS[reason];
  return { description: t(description), title: t(title) };
}

export function projectRepoUnavailableReason(error: unknown): ProjectRepoUnavailableReason {
  if (error instanceof BffError) {
    const reason = String(error.reason ?? "");
    if (reason === "TARGET_NOT_FOUND") return "missing";
    if (reason === "DEPENDENCY_UNAVAILABLE") return "network";
  }
  if (error instanceof TransportError) return "network";
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === "string"
        ? error.toLowerCase()
        : "";

  if (!message) return "missing";
  if (/\b(?:401|403)\b|authenticat|authoriz|permission denied|access denied/.test(message)) {
    return "authentication";
  }
  if (/\b404\b|repository not found|repository does not exist|not found on the relay/.test(message)) {
    return "missing";
  }
  if (/remote branch .* not found|could not resolve the requested repository ref|couldn't find remote ref/.test(message)) {
    return "ref";
  }
  if (/timed? out|could not resolve host|failed to connect|connection (?:refused|reset)|network is unreachable|offline/.test(message)) {
    return "network";
  }
  return "unknown";
}
