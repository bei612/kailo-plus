import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplicationNativePage } from "@client-kit/contracts";
import { useBffClient, useNativeAuthenticationHost, useT } from "./context";
import { Button, Notice, ReadFailure } from "./ui";

export function validNativePage(page: ApplicationNativePage, bindingId: string): boolean {
  try {
    const url = new URL(page.url);
    return page.bindingId === bindingId && Number.isSafeInteger(page.projectionGeneration)
      && page.projectionGeneration > 0 && ["http:", "https:"].includes(url.protocol)
      && !url.username && !url.password && url.origin === page.origin
      && Array.isArray(page.allowedOrigins) && page.allowedOrigins.includes(page.origin)
      && page.allowedOrigins.every((origin) => {
        const allowed = new URL(origin);
        return ["http:", "https:"].includes(allowed.protocol) && allowed.origin === origin
          && origin !== window.location.origin;
      })
      && url.origin !== window.location.origin;
  } catch { return false; }
}

/** The independent service owns its complete page and session in both hosts. */
export function NativeApplicationPage({ bindingId, onBack }: { bindingId: string; onBack: () => void }) {
  const client = useBffClient();
  const authenticateNative = useNativeAuthenticationHost();
  const t = useT();
  const [approved, setApproved] = useState<ApplicationNativePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [frameRevision, setFrameRevision] = useState(0);
  const [error, setError] = useState<unknown>();
  const [authenticationError, setAuthenticationError] = useState<unknown>();
  const [authenticationPending, setAuthenticationPending] = useState(false);
  const epoch = useRef(0);
  const scope = useRef(0);
  const authenticating = useRef(false);
  const reload = useCallback(async (refreshFrame: boolean) => {
    const request = ++epoch.current;
    setLoading(true);
    try {
      const actual = await client.applicationNativePage(bindingId);
      if (request !== epoch.current) return;
      if (!validNativePage(actual, bindingId)) throw new Error("Invalid approved service page");
      setApproved(actual);
      setError(undefined);
      if (refreshFrame) setFrameRevision((revision) => revision + 1);
    } catch (failure) {
      if (request !== epoch.current) return;
      setApproved(null);
      setError(failure);
    } finally {
      if (request === epoch.current) setLoading(false);
    }
  }, [bindingId, client]);
  useEffect(() => {
    ++scope.current;
    setAuthenticationPending(false);
    setAuthenticationError(undefined);
    authenticating.current = false;
    setApproved(null);
    void reload(false);
    // A focus check revalidates admission without remounting an unchanged
    // native page and losing its unsaved work. Failure removes it immediately.
    const recheck = () => {
      const refreshFrame = authenticating.current;
      authenticating.current = false;
      void reload(refreshFrame);
    };
    window.addEventListener("focus", recheck);
    return () => { ++scope.current; ++epoch.current; window.removeEventListener("focus", recheck); };
  }, [reload]);
  const page = approved && validNativePage(approved, bindingId) ? approved : null;
  return <section className="flex h-full min-h-0 flex-1 flex-col gap-3" data-testid="native-application-page">
    <div className="flex flex-wrap items-center gap-2"><Button onClick={onBack}>{t("platform.back")}</Button>
      <Button disabled={loading} onClick={() => { void reload(true); }}>{t("platform.refresh")}</Button>
      {page ? <Button disabled={loading || authenticationPending} onClick={() => {
        if (authenticateNative) {
          const request = scope.current;
          setAuthenticationPending(true); setAuthenticationError(undefined);
          void authenticateNative(bindingId).then(() => {
            if (request === scope.current) void reload(true);
          }, (failure) => { if (request === scope.current) setAuthenticationError(failure); })
            .finally(() => { if (request === scope.current) setAuthenticationPending(false); });
          return;
        }
        authenticating.current = true;
        // Explicit authentication only. The complete service remains mounted
        // here; no platform token, selected native URL or service secret is sent.
        window.open(page.url, "_blank", "popup,noopener,noreferrer");
      }}>{t("bindings.signInNative")}</Button> : null}</div>
    {authenticationError ? <ReadFailure error={authenticationError} onRetry={() => setAuthenticationError(undefined)} /> : null}
    <p className="text-sm text-muted-foreground">{t("bindings.nativeBoundary")}</p>
    {page ? <iframe key={`${page.bindingId}:${page.projectionGeneration}:${page.url}:${frameRevision}`}
      className="min-h-0 w-full flex-1 border-0" title={t("bindings.nativeTitle")}
      src={page.url} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer" />
      : loading ? <Notice role="status">{t("platform.loading")}</Notice>
      : <ReadFailure error={error} onRetry={() => { void reload(true); }} />}
  </section>;
}
