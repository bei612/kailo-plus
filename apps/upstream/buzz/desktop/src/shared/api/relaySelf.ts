import { useQuery } from "@tanstack/react-query";

import { invokeTauri } from "@/shared/api/tauri";

/**
 * Read the active relay's NIP-11 `self` pubkey (its own signing key, hex), or
 * `null` when the relay advertises none or an invalid key. Network and malformed
 * document failures reject the request. Callers that use this value to trust
 * relay-signed state must treat both `null` and errors as untrusted.
 */
function getRelaySelf(): Promise<string | null> {
  return invokeTauri<string | null>("get_relay_self");
}

/**
 * The active relay's NIP-11 `self` pubkey (hex), or `null` when it advertises
 * none. Used to attribute relay-signed events to their actor. Community-scoped
 * and effectively static for a session, so it is cached indefinitely; a `null`
 * result is a valid answer, while request failures remain query errors.
 */
export function useRelaySelfQuery(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["relaySelf"],
    queryFn: getRelaySelf,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
