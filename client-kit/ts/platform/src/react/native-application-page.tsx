import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApplicationNativePage } from "@client-kit/contracts";
import { useBffClient, useNativeAuthenticationHost, useT, useTopLevelReauthentication } from "./context";
import { embedRequest, nativeEmbedUrl, preferencesMessage, presentationMessage, useEmbedPresentation } from "./native-embed-host";
import { preferenceValues } from "../component-preferences";
import { useStoredComponentPreferences } from "./component-preferences";
import { Button, Notice, ReadFailure } from "./ui";

/** How long a page may take to complete the wire v1 handshake before it is treated as a DD-127 page. */
export const NATIVE_HANDSHAKE_GRACE_MS = 8000;

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

/**
 * The independent service owns its complete page and session in both hosts.
 * DD-138(3): the page is a Kailo page — no host chrome (no "service workspace",
 * back, refresh or boundary note) around a page that completed the handshake;
 * only the DD-127 entry for a page without the Kailo runtime keeps its explicit
 * sign-in button and boundary note. `onBack` renders a Back button only where
 * the page is opened from a list (the binding management panel), not from the
 * sidebar entry.
 */
export function NativeApplicationPage({ bindingId, onBack, title }: { bindingId: string; onBack?: () => void; title?: string }) {
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
  // DD-138: every declared preference of this page with its effective value,
  // posted after `ready` and whenever Kailo settings change one of them.
  const stored = useStoredComponentPreferences();
  const declared = page?.preferences;
  const values = useMemo(() => preferenceValues(declared, stored), [declared, stored]);
  const valuesKey = JSON.stringify(values);
  // biome-ignore lint/correctness/useExhaustiveDependencies: valuesKey carries the content of `values`
  useEffect(() => {
    const target = frame.current?.contentWindow;
    if (!connected || !origin || !target || !declared?.length) return;
    target.postMessage(preferencesMessage(values), origin);
  }, [connected, origin, declared, valuesKey]);
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
  // A page that has not (yet) completed the handshake within a short grace
  // period is a DD-127 page without the Kailo runtime: keep its explicit entry.
  // Until then Kailo shows its own loading state over the (still loading) frame.
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    setGraceOver(false);
    if (!frameKey) return;
    const timer = window.setTimeout(() => setGraceOver(true), NATIVE_HANDSHAKE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [frameKey]);
  const awaitingHandshake = page !== null && !connected && !graceOver;
  const unhandshaked = page !== null && !connected && graceOver;
  return <section className="flex h-full min-h-0 flex-1 flex-col gap-3" data-testid="native-application-page">
    {onBack ? <div><Button onClick={onBack}>{t("platform.back")}</Button></div> : null}
    {unhandshaked ? <div className="flex flex-wrap items-center gap-2">
      <Button disabled={loading || authenticationPending} onClick={() => signInToService(page.url)}>{t("bindings.signInNative")}</Button>
      <p className="text-sm text-muted-foreground">{t("bindings.nativeBoundary")}</p></div> : null}
    {authenticationError ? <ReadFailure error={authenticationError} onRetry={() => setAuthenticationError(undefined)} /> : null}
    {page && connected && embedded?.authRequired ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
      <span>{t("bindings.embedSignInRequired")}</span>
      <Button disabled={authenticationPending} onClick={() => signInAgain(page.url)}>{t("bindings.embedSignIn")}</Button></div> : null}
    {page && frameKey && launch.current ? <div className="relative flex min-h-0 w-full flex-1 flex-col">
      <iframe key={frameKey} ref={frame}
        className={`min-h-0 w-full flex-1 border-0${awaitingHandshake ? " invisible" : ""}`} title={title ?? t("bindings.nativeTitle")}
        src={launch.current.src} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer" />
      {awaitingHandshake ? <div className="absolute inset-0 flex items-center justify-center" data-testid="native-page-loading">
        <Notice role="status">{t("platform.loading")}</Notice></div> : null}
    </div>
      : loading ? <Notice role="status">{t("platform.loading")}</Notice>
      : <ReadFailure error={error} onRetry={() => { void reload(true); }} />}
  </section>;
}
