// Transport-only seam for the original Buzz avatar editor. No identity or
// profile authority lives here: each host captures its existing actor scope.
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { translate, type PlatformLocale } from "../../i18n";

export type AvatarHost = {
  locale: PlatformLocale;
  uploadMediaBytes: (bytes: number[], filename?: string) => Promise<{ url: string; type: string }>;
  rewriteMediaUrl: (url: string) => string;
  performDefaultHaptic: () => void;
};
type AvatarViewHost = Pick<AvatarHost, "locale" | "rewriteMediaUrl">;
const Context = createContext<AvatarViewHost | AvatarHost | null>(null);
export function AvatarHostProvider({ value, children }: { value: AvatarViewHost | AvatarHost; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAvatarHost(): AvatarHost {
  const host = useAvatarViewHost();
  if (!("uploadMediaBytes" in host) || typeof host.uploadMediaBytes !== "function"
    || !("performDefaultHaptic" in host) || typeof host.performDefaultHaptic !== "function") {
    throw new Error("Profile avatar editor requires its authenticated upload transport");
  }
  return host as AvatarHost;
}
export function useAvatarViewHost(): AvatarViewHost | AvatarHost {
  const host = useContext(Context);
  if (!host) throw new Error("Profile avatar requires its authenticated host transport");
  return host;
}
export function useAvatarText() {
  const { locale } = useAvatarViewHost();
  return useCallback((key: Parameters<typeof translate>[1], variables: Parameters<typeof translate>[2] = {}) => translate(locale, key, variables), [locale]);
}
