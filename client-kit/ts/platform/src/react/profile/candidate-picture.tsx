// DD-139 (SF-BUZ-61(1)): people candidates and DM rows show the original ProfileAvatar from the
// 07 §4.7.3 Tenant avatar address carried by the BFF view (`picture`). The host decides whether
// it can load that address under its own session (Web: same-site cookie); without a host
// resolver, or for any other URL, nothing reaches the network and the original initials remain.
import { createContext, useCallback, useContext, type ReactNode } from "react";

type PictureResolver = (picture: string) => string | null;
const Context = createContext<PictureResolver | null>(null);

export function CandidatePictureProvider({ resolve, children }: { resolve: PictureResolver; children: ReactNode }) {
  return <Context.Provider value={resolve}>{children}</Context.Provider>;
}

/** The loadable address for a candidate's `picture`, or null (initials). */
export function useCandidatePictureResolver(): (picture: string | undefined | null) => string | null {
  const resolve = useContext(Context);
  return useCallback((picture: string | undefined | null) => (picture && resolve ? resolve(picture) : null), [resolve]);
}

/** Web host resolver: only the deployment's own avatar route on this origin, never another host. */
export function sameOriginAvatarPicture(origin: string): PictureResolver {
  return (picture) => {
    try {
      const url = new URL(picture);
      return url.origin === origin && url.pathname.startsWith("/api/v1/identity/avatars/") ? url.href : null;
    } catch { return null; }
  };
}
