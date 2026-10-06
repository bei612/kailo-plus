import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  FeedItemCategory,
  GetHomeFeedInput,
  HomeFeedResponse,
  RelayEvent,
  SearchMessagesInput,
  SearchMessagesResponse,
  ThreadCursor,
  ThreadRepliesResponse,
  AcpAvailabilityStatus,
  AcpRuntimeCatalogEntry,
  AuthStatus,
} from "@/shared/api/types";

export * from "@/shared/api/tauriChannels";
export { sendChannelMessage } from "@/shared/api/tauriMessages";
export { getEventById, getEventsByIds } from "@/shared/api/tauriEvents";

type RawFeedItem = {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  created_at: number;
  channel_id: string | null;
  channel_name: string;
  channel_type: string | null;
  tags: string[][];
  category: FeedItemCategory;
};

type RawHomeFeedResponse = {
  feed: {
    mentions: RawFeedItem[];
  };
  meta: {
    since: number;
    total: number;
    generated_at: number;
  };
};

type RawSearchHit = {
  event_id: string;
  content: string;
  kind: number;
  pubkey: string;
  channel_id: string | null;
  channel_name: string | null;
  created_at: number;
  score: number;
};

type RawSearchResponse = {
  hits: RawSearchHit[];
  found: number;
};

export type RawAcpRuntimeCatalogEntry = {
  id: string;
  label: string;
  avatar_url: string;
  availability: AcpAvailabilityStatus;
  command: string | null;
  binary_path: string | null;
  default_args: string[];
  mcp_command: string | null;
  model_env_var?: string | null;
  provider_env_var?: string | null;
  thinking_env_var?: string | null;
  max_tokens_env_var?: string | null;
  context_limit_env_var?: string | null;
  max_rounds_env_var?: string | null;
  install_hint: string;
  install_instructions_url: string;
  can_auto_install: boolean;
  requires_external_cli?: boolean;
  underlying_cli_path: string | null;
  node_required: boolean;
  auth_status: AuthStatus;
  login_hint?: string;
  source: "builtin" | "preset" | "custom";
  /** Definition-level env vars for `source: custom` entries; absent for builtin/preset. */
  definition_env?: Record<string, string>;
  max_parallelism?: number;
  effort_canonical_values?: string[] | null;
};

export type {
  RawInstallRuntimeResult,
  RawInstallStepResult,
} from "./installTypes";

/** Error normalized from a rejected Tauri invocation with its wire payload. */
export class TauriInvokeError extends Error {
  readonly payload: unknown;

  constructor(message: string, payload: unknown) {
    super(message);
    this.name = "TauriInvokeError";
    this.payload = payload;
  }
}

function toTauriError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new TauriInvokeError(error, error);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return new TauriInvokeError(error.message, error);
  }

  try {
    return new TauriInvokeError(JSON.stringify(error), error);
  } catch {
    return new TauriInvokeError("Unknown Tauri error", error);
  }
}

export async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    // HTTP backoff lives in Rust. Do not apply its separate ApiCalls quota
    // to the WebSocket gate, but preserve the failure for the caller.
    throw toTauriError(error);
  }
}

export function fromRawFeedItem(item: RawFeedItem) {
  return {
    id: item.id,
    kind: item.kind,
    pubkey: item.pubkey,
    content: item.content,
    createdAt: item.created_at,
    channelId: item.channel_id,
    channelName: item.channel_name,
    // Canonicalize the wire `null` to undefined so FeedItem's optional
    // channelType contract holds at runtime (enrichment and the DM
    // notification filter both key off `=== undefined`).
    channelType: item.channel_type ?? undefined,
    tags: item.tags,
    category: item.category,
  };
}

function fromRawSearchHit(hit: RawSearchHit) {
  return {
    eventId: hit.event_id,
    content: hit.content,
    kind: hit.kind,
    pubkey: hit.pubkey,
    channelId: hit.channel_id,
    channelName: hit.channel_name,
    createdAt: hit.created_at,
    score: hit.score,
  };
}

export function getRelayWsUrl(): Promise<string> {
  return invokeTauri<string>("get_relay_ws_url");
}

export function getRelayHttpUrl(): Promise<string> {
  return invokeTauri<string>("get_relay_http_url");
}

export async function getHomeFeed(
  input: GetHomeFeedInput = {},
): Promise<HomeFeedResponse> {
  const response = await invokeTauri<RawHomeFeedResponse>("get_feed", input);

  return {
    feed: {
      mentions: response.feed.mentions.map(fromRawFeedItem),
    },
    meta: {
      since: response.meta.since,
      total: response.meta.total,
      generatedAt: response.meta.generated_at,
    },
  };
}

export async function searchMessages(
  input: SearchMessagesInput,
): Promise<SearchMessagesResponse> {
  const response = await invokeTauri<RawSearchResponse>("search_messages", {
    q: input.q,
    limit: input.limit,
    channelId: input.channelId,
    authors: input.authors,
    since: input.since,
    until: input.until,
  });

  return {
    hits: response.hits.map(fromRawSearchHit),
    found: response.found,
  };
}

type RawThreadCursor = {
  created_at: number;
  event_id: string;
};

type RawThreadRepliesResponse = {
  events: RelayEvent[];
  next_cursor: RawThreadCursor | null;
};

/**
 * Fetch the full reply subtree under a thread root, server-side.
 *
 * Unlike the channel timeline (which the desktop assembles from its local
 * cache), this walks `thread_metadata` on the relay, so a thread renders
 * complete even when its replies fell outside the channel cold-load window —
 * the descendant gap that made deep/old threads silently incomplete.
 *
 * Paging is forward keyset on `(createdAt, eventId)`: pass the returned
 * `nextCursor` back as `cursor` for the next page. `nextCursor` is non-null only
 * when a full page was returned. The returned `events` are raw nostr events
 * (`RelayEvent`), chronological (oldest first). These are the *replies* under
 * the root (depth >= 1); the root event itself is NOT returned (the relay query
 * keys on `root_event_id`, which a root row lacks). The caller already holds
 * the root — it is the open thread head.
 */
export async function getThreadReplies(
  rootEventId: string,
  channelId?: string | null,
  options?: {
    limit?: number;
    depthLimit?: number;
    cursor?: ThreadCursor | null;
  },
): Promise<ThreadRepliesResponse> {
  const response = await invokeTauri<RawThreadRepliesResponse>(
    "get_thread_replies",
    {
      rootEventId,
      channelId: channelId ?? null,
      limit: options?.limit ?? null,
      depthLimit: options?.depthLimit ?? null,
      cursor: options?.cursor
        ? {
            created_at: options.cursor.createdAt,
            event_id: options.cursor.eventId,
          }
        : null,
    },
  );

  return {
    events: response.events,
    nextCursor: response.next_cursor
      ? {
          createdAt: response.next_cursor.created_at,
          eventId: response.next_cursor.event_id,
        }
      : null,
  };
}

export type BlobDescriptor = import("@client-kit/platform/react/composer/features/messages/lib/imetaMediaMarkdown").BlobDescriptor;

export async function pickAndUploadMedia(
  progressId?: string,
): Promise<BlobDescriptor[]> {
  return invokeTauri<BlobDescriptor[]>("pick_and_upload_media", { progressId });
}
export async function uploadMediaBytes(
  data: number[],
  filename?: string,
  /** Correlation id for `media-upload-progress` events from the Rust side. */
  progressId?: string,
): Promise<BlobDescriptor> {
  return invokeTauri<BlobDescriptor>("upload_media_bytes", {
    data,
    filename,
    progressId,
  });
}

export async function signRelayEvent(input: {
  kind: number;
  content: string;
  createdAt?: number;
  tags: string[][];
}): Promise<RelayEvent> {
  const eventJson = await invokeTauri<string>("sign_event", input);
  return JSON.parse(eventJson) as RelayEvent;
}

export async function createAuthEvent(input: {
  challenge: string;
  relayUrl: string;
}): Promise<RelayEvent> {
  const eventJson = await invokeTauri<string>("create_auth_event", input);
  return JSON.parse(eventJson) as RelayEvent;
}

export function fromRawAcpRuntimeCatalogEntry(
  entry: RawAcpRuntimeCatalogEntry,
): AcpRuntimeCatalogEntry {
  return {
    id: entry.id,
    label: entry.label,
    avatarUrl: entry.avatar_url,
    availability: entry.availability,
    command: entry.command,
    binaryPath: entry.binary_path,
    defaultArgs: entry.default_args,
    mcpCommand: entry.mcp_command,
    modelEnvVar: entry.model_env_var ?? null,
    providerEnvVar: entry.provider_env_var ?? null,
    thinkingEnvVar: entry.thinking_env_var ?? null,
    maxTokensEnvVar: entry.max_tokens_env_var ?? null,
    contextLimitEnvVar: entry.context_limit_env_var ?? null,
    maxRoundsEnvVar: entry.max_rounds_env_var ?? null,
    installHint: entry.install_hint,
    installInstructionsUrl: entry.install_instructions_url,
    canAutoInstall: entry.can_auto_install,
    requiresExternalCli: entry.requires_external_cli ?? false,
    underlyingCliPath: entry.underlying_cli_path,
    nodeRequired: entry.node_required,
    authStatus: entry.auth_status,
    loginHint: entry.login_hint ?? null,
    source: entry.source,
    definitionEnv: entry.definition_env ?? {},
    effortCanonicalValues: entry.effort_canonical_values ?? null,
    ...(entry.max_parallelism !== undefined && {
      maxParallelism: entry.max_parallelism,
    }),
  };
}

// ── Backend provider discovery ────────────────────────────────────────────────

// ── NIP-44 encrypt-to-self ───────────────────────────────────────────────────
