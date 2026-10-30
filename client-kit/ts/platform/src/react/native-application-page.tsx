import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type ApplicationNativePage, ComponentAdminAccess } from "@client-kit/contracts";
import { useBffClient, useLocale, useNativeAuthenticationHost, useT, useTopLevelReauthentication } from "./context";
import {
  actionMessage, confirmResultMessage, EMBED_MAX_FILES, embedMessage, navigateMessage, pickFiles, preferencesMessage, presentationMessage, replayShortcut,
  useEmbedPresentation, type EmbedConfirm, type EmbedFeature, type EmbedPage,
} from "./native-embed-host";
import { useNativeEntryPresentation } from "./native-application-entries";
import { ADMIN_CATEGORY_LABELS, NativeConfirmDialog, NativePageFrame, NativePageHeader, NativePageSkeleton } from "./native-page-shell";
import { isMacPlatform } from "../keyboard-platform";
import { nativeDeepLinkUrl } from "./native-deep-link";
import { preferenceValues } from "../component-preferences";
import { useStoredComponentPreferences } from "./component-preferences";
import { Button, ReadFailure } from "./ui";
import { adminSurfaceDescriptorUrl, adminSurfaceLaunchUrl, adminSurfaceTitle } from "../admin-surfaces";

/** How long a page may take to complete the wire v1 handshake before it is treated as a DD-127 page. */
export const NATIVE_HANDSHAKE_GRACE_MS = 8000;

/** DD-157 (07 §4.8.7): at most this many component toasts per window, identical ones merged. */
export const NATIVE_TOAST_LIMIT = { count: 5, windowMs: 10_000, duplicateMs: 3_000 };

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
 * DD-138(4)(5), 07 §4.8.3/§4.8.4: `path` (an Inbox item or search result) opens that
 * location inside the descriptor origin; a path leaving it is ignored.
 * DD-138(6), 07 §4.8.5: `adminSurface` opens that declared admin surface instead: Core issues
 * the descriptor under fresh `manage`, the frame loads its fixed path with
 * `kailo_admin_surface`, and the header reads 管理 › category › title.
 */
export function NativeApplicationPage({ bindingId, onBack, title, path, adminSurface }: { bindingId: string; onBack?: () => void; title?: string; path?: string; adminSurface?: string }) {
  const entry = useNativeEntryPresentation(bindingId);
  const client = useBffClient();
  const authenticateNative = useNativeAuthenticationHost();
  const reauthenticate = useTopLevelReauthentication();
  const t = useT();
  const locale = useLocale();
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
      const actual = await client.applicationNativePage(bindingId, adminSurface);
      if (request !== epoch.current) return;
      if (!validNativePage(actual, bindingId)) throw new Error("Invalid approved service page");
      // An admin surface descriptor must be exactly the requested declaration; a plain page carries none.
      if (adminSurface === undefined ? actual.adminSurface !== undefined : !adminSurfaceDescriptorUrl(actual, adminSurface))
        throw new Error("Invalid approved admin surface");
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
  }, [bindingId, client, adminSurface]);
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
  const surface = adminSurface !== undefined && page?.adminSurface?.key === adminSurface ? page.adminSurface : null;
  const frameKey = page ? `${page.bindingId}:${page.projectionGeneration}:${page.url}:${adminSurface ? `admin:${adminSurface}` : path ?? ""}:${frameRevision}` : null;
  // DD-133: theme/locale ride on the launch URL once per document; later
  // changes are posted, never reloaded, so unsaved native work survives.
  const launch = useRef<{ key: string; src: string } | null>(null);
  if (page && frameKey && launch.current?.key !== frameKey) {
    const src = adminSurface !== undefined ? adminSurfaceLaunchUrl(page, adminSurface, presentation) : nativeDeepLinkUrl(page, path, presentation);
    launch.current = src ? { key: frameKey, src } : null;
  }
  const frame = useRef<HTMLIFrameElement>(null);
  const currentFrameKey = useRef(frameKey);
  currentFrameKey.current = frameKey;
  const documentRevision = useRef(0);
  const latest = useRef(presentation);
  latest.current = presentation;
  const [embedded, setEmbedded] = useState<{ key: string; authRequired: boolean; features: EmbedFeature[] } | null>(null);
  const connected = embedded !== null && embedded.key === frameKey;
  const features = connected ? embedded.features : [];
  // DD-157: the component's own header, drawn by Kailo; reset with every document.
  const [header, setHeader] = useState<{ key: string; page: EmbedPage | null } | null>(null);
  const embedPage = header && header.key === frameKey ? header.page : null;
  const headerArrived = header !== null && header.key === frameKey;
  const [confirm, setConfirm] = useState<EmbedConfirm | null>(null);
  const confirming = useRef<EmbedConfirm | null>(null);
  const toasts = useRef<{ at: number; text: string }[]>([]);
  const origin = page?.origin ?? null;
  const postToFrame = useCallback((message: object) => {
    const target = frame.current?.contentWindow;
    // Exact target origin: if the frame is mid-redirect (IdP), nothing is delivered.
    if (target && origin) target.postMessage(message, origin);
  }, [origin]);
  const post = useCallback(() => { postToFrame(presentationMessage(latest.current)); }, [postToFrame]);
  const showToast = useCallback((tone: "success" | "info" | "warning" | "error", text: string, description?: string) => {
    const now = Date.now();
    const key = `${tone}\u0000${text}\u0000${description ?? ""}`;
    toasts.current = toasts.current.filter((item) => now - item.at < NATIVE_TOAST_LIMIT.windowMs);
    if (toasts.current.length >= NATIVE_TOAST_LIMIT.count
      || toasts.current.some((item) => item.text === key && now - item.at < NATIVE_TOAST_LIMIT.duplicateMs)) return;
    toasts.current.push({ at: now, text: key });
    const show = tone === "success" ? toast.success : tone === "warning" ? toast.warning : tone === "error" ? toast.error : toast.info;
    show(text, description ? { description } : undefined);
  }, []);
  useEffect(() => {
    if (!origin || !frameKey) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || !frame.current || event.source !== frame.current.contentWindow) return;
      const message = embedMessage(event.data);
      if (!message) return;
      // A picker belongs to the document and page declaration at the user's click.
      if (message.type === "ready" || message.type === "auth-required" || message.type === "page") ++documentRevision.current;
      if (message.type === "ready") {
        setEmbedded({ key: frameKey, authRequired: false, features: message.features });
        post();
      } else if (message.type === "auth-required") {
        setEmbedded((current) => ({ key: frameKey, authRequired: true, features: current?.key === frameKey ? current.features : [] }));
      } else if (message.type === "page") {
        setHeader({ key: frameKey, page: message.page });
      } else if (message.type === "toast") {
        showToast(message.toast.tone, message.toast.title, message.toast.description);
      } else if (message.type === "confirm") {
        // One Kailo dialog at a time; a second request is declined, never queued behind the first.
        if (confirming.current) { postToFrame(confirmResultMessage(message.confirm.id, false)); return; }
        confirming.current = message.confirm;
        setConfirm(message.confirm);
      } else if (message.type === "shortcut") {
        replayShortcut(message.shortcut, isMacPlatform());
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [origin, frameKey, post, postToFrame, showToast]);
  const activate = (id: string) => {
    const action = connected && features.includes("page") ? embedPage?.actions.find((item) => item.id === id) : null;
    const element = frame.current;
    const target = element?.contentWindow;
    if (!action || action.disabled || action.busy || !element || !target || !origin) return;
    if (!action.files) { target.postMessage(actionMessage(id), origin); return; }
    const revision = documentRevision.current;
    const requestScope = scope.current;
    const current = () => element.isConnected && frame.current === element && element.contentWindow === target
      && currentFrameKey.current === frameKey && scope.current === requestScope && documentRevision.current === revision;
    // Open synchronously inside the click. Never resolve a delayed selection through a mutable frame ref.
    pickFiles(action.files, (selection) => {
      if (current()) target.postMessage(actionMessage(id, selection), origin);
    }, () => {
      if (current()) showToast("error", t("platform.nativePage.tooManyFiles", { count: EMBED_MAX_FILES }));
    });
  };
  // A new document (or another binding) starts without an open confirmation.
  useEffect(() => {
    confirming.current = null;
    setConfirm(null);
  }, [frameKey]);
  const finishConfirm = (confirmed: boolean, option?: boolean) => {
    const current = confirming.current;
    confirming.current = null;
    setConfirm(null);
    if (current) postToFrame(confirmResultMessage(current.id, confirmed, current.option ? option === true : undefined));
    // Keyboard focus goes back to where the user was: inside the component (07 §4.8.7).
    window.setTimeout(() => frame.current?.focus(), 0);
  };
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
  // DD-157: a page that declared `page` stays behind Kailo's skeleton until its first
  // header (its content is ready), so the first paint is never a half-built frame.
  const awaitingHeader = connected && features.includes("page") && !headerArrived && !graceOver && !embedded?.authRequired;
  const awaitingHandshake = page !== null && ((!connected && !graceOver) || awaitingHeader);
  const unhandshaked = page !== null && !connected && graceOver;
  const productTitle = surface ? t("admin.title") : entry?.title ?? title ?? "";
  return <section className="flex h-full min-h-0 flex-1 flex-col bg-background" data-testid="native-application-page">
    {/* DD-138(3)/DD-157: the Kailo page header; Back only where opened from a list. */}
    {onBack ? <div className="px-5 pt-3"><Button onClick={onBack}>{t("platform.back")}</Button></div> : null}
    <NativePageHeader productTitle={productTitle} category={entry?.category ?? null}
      admin={surface ? { category: surface.adminCategory, categoryLabel: t(ADMIN_CATEGORY_LABELS[surface.adminCategory]),
        title: adminSurfaceTitle(surface, locale), readOnly: surface.access === ComponentAdminAccess.ReadOnly } : undefined}
      page={connected && features.includes("page") ? embedPage : null}
      onNavigate={(kind, id) => postToFrame(navigateMessage(kind, id))} onAction={activate} />
    {unhandshaked ? <div className="flex flex-wrap items-center gap-2 px-5 py-3">
      <Button disabled={loading || authenticationPending} onClick={() => signInToService(page.url)}>{t("bindings.signInNative")}</Button>
      <p className="text-sm text-muted-foreground">{t("bindings.nativeBoundary")}</p></div> : null}
    {authenticationError ? <div className="px-5 py-3"><ReadFailure error={authenticationError} onRetry={() => setAuthenticationError(undefined)} /></div> : null}
    {page && connected && embedded?.authRequired ? <div role="alert" className="mx-auto mt-12 flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-border bg-card px-6 py-8 text-center text-sm text-foreground shadow-xs">
      <span>{t("bindings.embedSignInRequired")}</span>
      <Button disabled={authenticationPending} onClick={() => signInAgain(page.url)}>{t("bindings.embedSignIn")}</Button></div> : null}
    {page && frameKey && launch.current ? <NativePageFrame>
      <iframe key={frameKey} ref={frame} onLoad={() => { ++documentRevision.current; }}
        className={`min-h-0 w-full flex-1 border-0 bg-background ${presentation.theme === "dark" ? "[color-scheme:dark]" : "[color-scheme:light]"}${awaitingHandshake ? " invisible" : ""}`}
        title={surface ? adminSurfaceTitle(surface, locale) : productTitle || title || t("bindings.nativeTitle")}
        src={launch.current.src} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer" />
      {awaitingHandshake ? <div role="status" aria-label={t("platform.loading")} data-testid="native-page-loading"><NativePageSkeleton /></div> : null}
    </NativePageFrame>
      : loading ? <NativePageFrame><div role="status" aria-label={t("platform.loading")} data-testid="native-page-loading"><NativePageSkeleton /></div></NativePageFrame>
      : <div className="px-5 py-4"><ReadFailure error={error} onRetry={() => { void reload(true); }} /></div>}
    <NativeConfirmDialog confirm={confirm} onDone={finishConfirm} />
  </section>;
}
