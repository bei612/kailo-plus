// DD-139 (SF-BUZ-61(1)) Desktop host: people candidates and DM rows load the 07 §4.7.3 Tenant
// avatar through this device's platform session (Rust `platform_avatar`, no-redirect client,
// bounded read). Images live only in this provider's memory as data URLs and are dropped with
// it (session/community remount); nothing is written to disk and no other URL is requested.
// A missing avatar or a failed read keeps the original initials and is not retried here.
import * as React from "react";
import { CandidatePictureProvider } from "@client-kit/platform/react/profile/candidate-picture";
import { invokeTauri } from "@/shared/api/tauri";

const AVATAR_ROUTE = "/api/v1/identity/avatars/";

function avatarPath(picture: string): string | null {
  try {
    const url = new URL(picture);
    return url.pathname.startsWith(AVATAR_ROUTE) && !url.search && !url.hash ? url.pathname : null;
  } catch { return null; }
}

export function NativeCandidatePictureProvider({ children }: { children: React.ReactNode }) {
  // picture → data URL (loaded) | null (no avatar or failed); absent = not requested yet.
  const [images, setImages] = React.useState<ReadonlyMap<string, string | null>>(() => new Map());
  const requested = React.useRef(new Set<string>());
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = React.useCallback((picture: string, path: string) => {
    requested.current.add(picture);
    void invokeTauri<string | null>("platform_avatar", { path })
      .then((dataUrl) => dataUrl, () => null)
      .then((dataUrl) => {
        if (mounted.current) setImages((current) => new Map(current).set(picture, dataUrl));
      });
  }, []);
  const resolve = React.useCallback((picture: string) => {
    if (picture.startsWith("data:image/") && [...images.values()].includes(picture)) return picture;
    const path = avatarPath(picture);
    if (!path) return null;
    const loaded = images.get(picture);
    if (loaded !== undefined) return loaded;
    if (!requested.current.has(picture)) queueMicrotask(() => { if (mounted.current && !requested.current.has(picture)) load(picture, path); });
    return null;
  }, [images, load]);
  return <CandidatePictureProvider resolve={resolve}>{children}</CandidatePictureProvider>;
}
