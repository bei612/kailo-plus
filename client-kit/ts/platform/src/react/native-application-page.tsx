import { useCallback, useEffect, useRef, useState } from "react";
import type { ApplicationNativePage } from "@client-kit/contracts";
import { useBffClient, useNativeAuthenticationHost, useT, useTopLevelReauthentication } from "./context";
import { embedRequest, nativeEmbedUrl, presentationMessage, useEmbedPresentation } from "./native-embed-host";
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
  const reauthenticate = useTopLevelReauthentication();
  const t = useT();
  const presentation = useEmbedPresentation();
  const [approved, setApproved] = useState<ApplicationNativePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [frameRevision, setFrameRevision] = useState(0);
  const [error, setError] = useState<unknown>();
  const [authenticationError, setAuthenticationError] = useState<unknown>();
  const [authenticationPending, setAuthenticationPending] = useState(false);
  const epoch = useRef(0);
  const scope = useRef(0);
  const authenticating = useRef(false);
  // `background` is the focus revalidation: it must not disable the controls, because the
  // click that moves focus out of the native iframe would land on a just-disabled button.
  const reload = useCallback(async (refreshFrame: boolean, background = false) => {
    const request = ++epoch.current;
    if (!background) setLoading(true);
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
      void reload(refreshFrame, true);
    };
    window.addEventListener("focus", recheck);
    return () => { ++scope.current; ++epoch.current; window.removeEventListener("focus", recheck); };
  }, [reload]);
  const page = approved && validNativePage(approved, bindingId) ? approved : null;
  const frameKey = page ? `${page.bindingId}:${page.projectionGeneration}:${page.url}:${frameRevision}` : null;
  // DD-133: theme/locale ride on the launch URL once per document; later
  // changes are posted, never reloaded, so unsaved native work survives.
  const launch = useRef<{ key: string; src: string } | null>(null);
  if (page && frameKey && launch.current?.key !== frameKey)
    launch.current = { key: frameKey, src: nativeEmbedUrl(page.url, presentation) };
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(presentation);
  latest.current = presentation;
  const [embedded, setEmbedded] = useState<{ key: string; authRequired: boolean } | null>(null);
  const connected = embedded !== null && embedded.key === frameKey;
  const origin = page?.origin ?? null;
  const post = useCallback(() => {
    const target = frame.current?.contentWindow;
    // Exact target origin: if the frame is mid-redirect (IdP), nothing is delivered.
    if (target && origin) target.postMessage(presentationMessage(latest.current), origin);
  }, [origin]);
  useEffect(() => {
    if (!origin || !frameKey) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || !frame.current || event.source !== frame.current.contentWindow) return;
      const request = embedRequest(event.data);
      if (request === "ready") {
        setEmbedded({ key: frameKey, authRequired: false });
        post();
      } else if (request === "auth-required") {
        setEmbedded({ key: frameKey, authRequired: true });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [origin, frameKey, post]);
  useEffect(() => { if (connected) post(); }, [connected, post, presentation.theme, presentation.locale]);
  const authenticateInHost = (): boolean => {
    if (!authenticateNative) return false;
    const request = scope.current;
    setAuthenticationPending(true); setAuthenticationError(undefined);
    void authenticateNative(bindingId).then(() => {
      if (request === scope.current) void reload(true);
    }, (failure) => { if (request === scope.current) setAuthenticationError(failure); })
      .finally(() => { if (request === scope.current) setAuthenticationPending(false); });
    return true;
  };
  const signInToService = (url: string) => {
    if (authenticateInHost()) return;
    authenticating.current = true;
    // Explicit authentication only. The complete service remains mounted
    // here; no platform token, selected native URL or service secret is sent.
    window.open(url, "_blank", "popup,noopener,noreferrer");
  };
  // DD-133(2): a component that lost its silent IdP session asks for a
  // top-level sign-in; the frame itself never shows a login form.
  const signInAgain = (url: string) => {
    if (authenticateInHost()) return;
    if (reauthenticate) reauthenticate();
    else signInToService(url);
  };
  return <section className="flex h-full min-h-0 flex-1 flex-col gap-3" data-testid="native-application-page">
    <div className="flex flex-wrap items-center gap-2"><Button onClick={onBack}>{t("platform.back")}</Button>
      <Button disabled={loading} onClick={() => { void reload(true); }}>{t("platform.refresh")}</Button>
      {page && !connected ? <Button disabled={loading || authenticationPending} onClick={() => signInToService(page.url)}>
        {t("bindings.signInNative")}</Button> : null}</div>
    {authenticationError ? <ReadFailure error={authenticationError} onRetry={() => setAuthenticationError(undefined)} /> : null}
    {page && connected && embedded?.authRequired ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
      <span>{t("bindings.embedSignInRequired")}</span>
      <Button disabled={authenticationPending} onClick={() => signInAgain(page.url)}>{t("bindings.embedSignIn")}</Button></div> : null}
    {connected ? null : <p className="text-sm text-muted-foreground">{t("bindings.nativeBoundary")}</p>}
    {page && frameKey && launch.current ? <iframe key={frameKey} ref={frame}
      className="min-h-0 w-full flex-1 border-0" title={t("bindings.nativeTitle")}
      src={launch.current.src} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer" />
      : loading ? <Notice role="status">{t("platform.loading")}</Notice>
      : <ReadFailure error={error} onRetry={() => { void reload(true); }} />}
  </section>;
}
