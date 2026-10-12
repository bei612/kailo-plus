import { useMessageDeepLinks } from "@/shared/useMessageDeepLinks";
import { useEntityDeepLinks } from "@/shared/useEntityDeepLinks";

/**
 * Subscribe to every deep link that routes inside the app shell —
 * `buzz://channel` and `buzz://message`. They need the router, so they mount
 * in `AppShell`.
 */
export function useAppDeepLinks() {
  useMessageDeepLinks();
  useEntityDeepLinks();
}
