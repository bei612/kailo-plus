export type { Channel, ChannelType, ChannelVisibility, ChannelRole } from "@client-kit/platform/react/search/types";
import type { Channel, ChannelRole } from "@client-kit/platform/react/search/types";

export type ChannelDetail = Channel & {
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  topicSetBy: string | null;
  topicSetAt: string | null;
  purposeSetBy: string | null;
  purposeSetAt: string | null;
  topicRequired: boolean;
  maxMembers: number | null;
  nip29GroupId: string | null;
};

export type ChannelMember = {
  pubkey: string;
  role: ChannelRole;
  isAgent: boolean;
  joinedAt: string;
  displayName: string | null;
};

export type { Identity, IdentityStorage } from "./identityTypes";

export type Profile = {
  pubkey: string;
  displayName: string | null;
  avatarUrl: string | null;
  about: string | null;
  nip05Handle: string | null;
  ownerPubkey: string | null;
  /** True when a real kind:0 metadata event exists on the relay for this pubkey.
   * False for the synthesized fallback returned when no event is present.
   * Used by the onboarding gate to distinguish new users from returning users
   * whose display name happens to be empty. */
  hasProfileEvent: boolean;
};

export type UserProfileSummary = {
  displayName: string | null;
  /** Kind-0 `name` field, kept separate from `displayName` so @mention text
   * can be matched against either alias (agents/CLI resolve mentions against
   * `display_name` *or* `name` at send time). */
  name?: string | null;
  avatarUrl: string | null;
  nip05Handle: string | null;
  ownerPubkey: string | null;
  isAgent?: boolean;
};

export type UsersBatchResponse = {
  profiles: Record<string, UserProfileSummary>;
  missing: string[];
};

export type { UserSearchResult } from "@client-kit/platform/react/search/types";
import type { UserSearchResult } from "@client-kit/platform/react/search/types";

export type UserSearchPage = {
  users: UserSearchResult[];
  nextCursor: string | null;
};

export type {
  ProjectLocalRepository,
  ProjectLocalRepoSnapshot,
  ProjectRepoBranchResult,
  ProjectRepoCommit,
  ProjectRepoContributor,
  ProjectRepoCloneResult,
  ProjectRepoDiff,
  ProjectRepoDiffFile,
  ProjectRepoFile,
  ProjectRepoMergeResult,
  ProjectRepoPullResult,
  ProjectRepoPushResult,
  ProjectRepoSnapshot,
  ProjectRepoSyncStatus,
} from "./projectGitTypes";

export type RelayEvent = {
  id: string;
  /** Local-only render identity for optimistic events that are later acknowledged. */
  localKey?: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
  pending?: boolean;
};

export type SendChannelMessageResult = {
  eventId: string;
  parentEventId: string | null;
  rootEventId: string | null;
  depth: number;
  createdAt: number;
};

/**
 * `mention` rows come from the relay feed (`get_feed`); `activity` rows are
 * thread replies the client synthesizes from its own unread projection.
 */
export type FeedItemCategory = "mention" | "activity";

export type FeedItem = {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  createdAt: number;
  channelId: string | null;
  channelName: string;
  channelType?: string;
  tags: string[][];
  category: FeedItemCategory;
};

export type HomeFeed = {
  mentions: FeedItem[];
};

/** Inbox view model: relay mentions plus locally synthesized thread activity. */
export type InboxFeed = {
  mentions: FeedItem[];
  activity: FeedItem[];
};

export type HomeFeedMeta = {
  since: number;
  total: number;
  generatedAt: number;
};

export type HomeFeedResponse = {
  feed: HomeFeed;
  meta: HomeFeedMeta;
};

export type GetHomeFeedInput = {
  since?: number;
  limit?: number;
};

export type {
  SearchHit,
  SearchMessagesInput,
  SearchMessagesResponse,
} from "./searchTypes";

/** ACP conversation boundary configured on an agent definition. */
export type AcpSessionPolicy = "channel" | "thread";
export type { JsonValue, RestartChange, RestartDiffEntry } from "./restartDiff";

/** Inbound author gate mode. Mirrors buzz-acp's --respond-to CLI flag. */
export type RespondToMode = "owner-only" | "allowlist" | "anyone";

export type AcpAvailabilityStatus =
  | "available"
  | "adapter_missing"
  | "adapter_outdated"
  | "cli_missing"
  | "not_installed";

/** Authentication/login status for a CLI-based ACP runtime. */
export type AuthStatus =
  | { status: "logged_in" }
  | { status: "logged_out" }
  | { status: "config_invalid"; diagnostic: string }
  | { status: "not_applicable" }
  | { status: "unknown" };

export type AcpRuntimeCatalogEntry = {
  id: string;
  label: string;
  avatarUrl: string;
  availability: AcpAvailabilityStatus;
  command: string | null;
  binaryPath: string | null;
  defaultArgs: string[];
  mcpCommand: string | null;
  /** Environment variable used to apply the initial model, when supported. */
  modelEnvVar: string | null;
  /** Environment variable used to apply the selected LLM provider, when supported. */
  providerEnvVar: string | null;
  /** Environment variable used to apply thinking effort, when supported. */
  thinkingEnvVar: string | null;
  /**
   * Canonical accepted effort values for this runtime, in display order.
   *
   * Non-null only for runtimes with a static finite effort vocabulary
   * (currently Goose: `["off","low","medium","high","max"]`). The renderer
   * uses this instead of the TS-side `GOOSE_EFFORT_CANONICAL_VALUES` duplicate.
   * Null for buzz-agent (provider/model catalog), Claude/Codex/unknown runtimes.
   */
  effortCanonicalValues: string[] | null;
  maxTokensEnvVar: string | null;
  contextLimitEnvVar: string | null;
  maxRoundsEnvVar: string | null;
  installHint: string;
  installInstructionsUrl: string;
  canAutoInstall: boolean;
  /** True when the runtime depends on a separately installed vendor CLI. */
  requiresExternalCli: boolean;
  underlyingCliPath: string | null;
  /** True when an npm adapter step is pending but Node.js / npm is absent. */
  nodeRequired: boolean;
  /** Login/auth status for CLI-based runtimes. */
  authStatus: AuthStatus;
  /** Hint for completing authentication; null when not applicable or already logged in. */
  loginHint: string | null;
  /** "builtin" (compiled in), "preset" (PATH-probed, not editable), or "custom" (user JSON). Controls UI editability. */
  source: "builtin" | "preset" | "custom";
  /**
   * Definition-level env vars for `source: custom` entries. Populated from
   * `HarnessDefinition.env` so saves don't erase existing vars. Absent for
   * builtin/preset entries.
   */
  definitionEnv?: Record<string, string>;
  /** Spawn-time parallelism cap; absent for uncapped harnesses. */
  maxParallelism?: number;
};

export type {
  InstallRuntimeResult,
  InstallStepResult,
} from "./installTypes";
// Persona (agent definition) types live in a sibling module to keep this
// file inside the repo-wide size ratchet; re-exported so import paths
// (`@/shared/api/types`) are unchanged.
export type {
  AgentPersona,
  CatalogSourceCoordinate,
  CreatePersonaInput,
  PersonaBehaviorInput,
  UpdatePersonaInput,
} from "./personaTypes";

// ── Team types ────────────────────────────────────────────────────────────────
export type {
  AgentTeam,
  CreateTeamInput,
  TeamCatalogSourceCoordinate,
  UpdateTeamInput,
} from "./teamTypes";

export type {
  ApprovalActionResponse,
  Workflow,
  WorkflowApproval,
  WorkflowApprovalStatus,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSaveResult,
  WorkflowStatus,
  TraceEntry,
  TriggerWorkflowResponse,
} from "@/shared/api/workflowTypes";
export type {
  ContactEntry,
  ContactListResponse,
  PublishNoteResult,
  UserNote,
  UserNotesCursor,
  UserNotesResponse,
} from "./socialTypes";

/**
 * Forward keyset cursor for the server-side thread read (`get_thread_replies`).
 *
 * The event-id tiebreak is load-bearing: thread replies routinely share a
 * `createdAt` second (bursty threads), so a timestamp-only cursor would skip
 * every tied reply past the page limit. The pair `(createdAt, eventId)` orders
 * replies unambiguously and lets paging resume strictly after the last event.
 */
export type ThreadCursor = {
  createdAt: number;
  eventId: string;
};

export type ThreadRepliesResponse = {
  /** The reply subtree (chronological, oldest first), depth >= 1. Excludes the root event (relay keys on `root_event_id`, which a root row lacks); the caller already holds the root. */
  events: RelayEvent[];
  /** Present only when a full page was returned — pass back to fetch the next page. */
  nextCursor: ThreadCursor | null;
};

/**
 * Composite backward keyset cursor for channel-timeline paging via the bridge
 * (`getChannelMessagesBefore`).
 *
 * The event-id tiebreak is load-bearing for the dense-second case: the relay
 * orders `created_at DESC, id ASC` and advances past a second denser than one
 * page with `id > eventId`. A bare `createdAt` (`until`) cursor cannot escape
 * such a second — it re-returns the same slice forever, leaving older history
 * unreachable. `(createdAt, eventId)` moves strictly older every page.
 */
export type ChannelPageCursor = {
  createdAt: number;
  eventId: string;
};
