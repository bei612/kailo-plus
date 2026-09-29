import { useMessageDeepLinks } from "@/shared/useMessageDeepLinks";

/**
 * Subscribe to every deep link that routes inside the app shell —
 * `buzz://channel` and `buzz://message`. They need the router, so they mount
 * in `AppShell`.
 */
export function useAppDeepLinks() {
  useMessageDeepLinks();
}
