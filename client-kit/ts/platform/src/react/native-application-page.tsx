import { useEffect, useState } from "react";
import type { ApplicationNativePage } from "@client-kit/contracts";
import { useBffClient, useNativePageHost, useT } from "./context";
import { Button, Notice, ReadFailure } from "./ui";
import { useLoad } from "./use-load";

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

/** Shared entry and state; only the isolated native window is host-specific. */
export function NativeApplicationPage({ bindingId, onBack }: { bindingId: string; onBack: () => void }) {
  const client = useBffClient();
  const nativeHost = useNativePageHost();
  const t = useT();
  const [state, reload] = useLoad(`native-application:${bindingId}`, () => client.applicationNativePage(bindingId));
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    // Returning to the platform rechecks access, without inventing a polling
    // interval or treating the independent service's login as our session.
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);
  const page = state.status === "ok" && validNativePage(state.data, bindingId) ? state.data : null;
  return <section className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2"><Button onClick={onBack}>{t("platform.back")}</Button>
      <Button onClick={reload}>{t("platform.refresh")}</Button>
      {page && !nativeHost ? <a href={page.url} target="_blank" rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        className="text-sm text-foreground underline underline-offset-4 hover:text-muted-foreground">
        {t("bindings.openIndependent")}
      </a> : null}</div>
    <p className="text-sm text-muted-foreground">{t("bindings.nativeBoundary")}</p>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : nativeHost ? <Button disabled={opening} onClick={() => {
        setOpening(true); setError(undefined);
        // Native host receives the binding ID, never a browser-selected URL.
        void nativeHost(bindingId).catch(setError).finally(() => setOpening(false));
      }}>{t("bindings.openNative")}</Button>
      : null}
    {error ? <ReadFailure error={error} onRetry={() => setError(undefined)} /> : null}
  </section>;
}
