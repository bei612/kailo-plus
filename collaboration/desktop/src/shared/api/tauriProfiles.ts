import { invokeTauri, TauriInvokeError } from "@/shared/api/tauri";
import type { WebProfileUpdateRequest } from "@client-kit/contracts";
import { TransportError } from "@client-kit/platform/transport";
import type {
  Profile,
  UserProfileSummary,
  UserSearchPage,
  UserSearchResult,
  UsersBatchResponse,
} from "@/shared/api/types";

type RawProfile = {
  pubkey: string;
  display_name: string | null;
  avatar_url: string | null;
  about: string | null;
  nip05_handle: string | null;
  owner_pubkey: string | null;
  has_profile_event?: boolean;
};

type RawUserProfileSummary = Omit<RawProfile, "pubkey" | "about"> & {
  name?: string | null;
  is_agent?: boolean;
};

type RawUsersBatchResponse = {
  profiles: Record<string, RawUserProfileSummary>;
  missing: string[];
};

type RawUserSearchResult = RawUserProfileSummary & { pubkey: string };

type RawSearchUsersResponse = {
  users: RawUserSearchResult[];
  next_cursor?: string | null;
};

function fromRawProfile(profile: RawProfile): Profile {
  return {
    pubkey: profile.pubkey,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    about: profile.about,
    nip05Handle: profile.nip05_handle,
    ownerPubkey: profile.owner_pubkey,
    hasProfileEvent: profile.has_profile_event ?? false,
  };
}

function fromRawUserProfileSummary(
  profile: RawUserProfileSummary,
): UserProfileSummary {
  return {
    displayName: profile.display_name,
    name: profile.name ?? null,
    avatarUrl: profile.avatar_url,
    nip05Handle: profile.nip05_handle,
    ownerPubkey: profile.owner_pubkey,
    isAgent: profile.is_agent ?? false,
  };
}

function fromRawUserSearchResult(user: RawUserSearchResult): UserSearchResult {
  return {
    pubkey: user.pubkey,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    nip05Handle: user.nip05_handle,
    ownerPubkey: user.owner_pubkey,
    isAgent: user.is_agent ?? false,
  };
}

export async function getProfile(): Promise<Profile> {
  const profile = await invokeTauri<RawProfile>("get_profile");
  return fromRawProfile(profile);
}

export async function updateProfile(input: WebProfileUpdateRequest & {
  expectedRelayUrl: string;
  expectedSignerPubkey: string;
}): Promise<Profile> {
  try {
    return fromRawProfile(await invokeTauri<RawProfile>("update_profile", { ...input }));
  } catch (error) {
    // A thrown transport/IPC string is not a native publication receipt. Only
    // the original command's typed rejection can make this attempt definite.
    if (error instanceof TauriInvokeError && typeof error.payload === "object" && error.payload !== null
      && "code" in error.payload && error.payload.code === "PROFILE_UPDATE_REJECTED") throw error;
    throw new TransportError("Profile publication result is unknown");
  }
}

export async function uploadProfileAvatar(data: number[], expectedRelayUrl: string, expectedSignerPubkey: string): Promise<{ url: string; type: string }> {
  return invokeTauri("upload_profile_avatar", { data, expectedRelayUrl, expectedSignerPubkey });
}

export async function getUserProfile(pubkey?: string): Promise<Profile> {
  const profile = await invokeTauri<RawProfile>("get_user_profile", { pubkey });
  return fromRawProfile(profile);
}

export async function getUsersBatch(
  pubkeys: string[],
): Promise<UsersBatchResponse> {
  const response = await invokeTauri<RawUsersBatchResponse>("get_users_batch", {
    pubkeys,
  });

  return {
    profiles: Object.fromEntries(
      Object.entries(response.profiles).map(([pubkey, profile]) => [
        pubkey,
        fromRawUserProfileSummary(profile),
      ]),
    ),
    missing: response.missing,
  };
}

export async function searchUsers(
  query: string,
  limit = 8,
  cursor?: string | null,
): Promise<UserSearchPage> {
  const response = await invokeTauri<RawSearchUsersResponse>("search_users", {
    query,
    limit,
    cursor: cursor ?? null,
  });
  return {
    users: response.users.map(fromRawUserSearchResult),
    nextCursor: response.next_cursor ?? null,
  };
}
