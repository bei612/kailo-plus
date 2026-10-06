import { useEffect, useId, useRef, useState } from "react";
import type { ContentReference, DocumentLaunchDescriptor, ProtocolSessionView } from "@client-kit/contracts";
import { useBffClient, useDocumentTheme, useLocale, useT } from "./context";
import { Button, Notice, ReadFailure } from "./ui";
import { useLoad } from "./use-load";

const states = ["ADMITTED", "OPENING", "OPEN", "DIRTY", "SAVED", "CONFLICT", "UNKNOWN", "READ_ONLY", "CLOSED", "EXPIRED", "REVOKED", "FAILED"] as const;
const stateMessages = {
  ADMITTED: "document.state.admitted", OPENING: "document.state.opening", OPEN: "document.state.open",
  DIRTY: "document.state.dirty", SAVED: "document.state.saved", CONFLICT: "document.state.conflict",
  UNKNOWN: "document.state.unknown", READ_ONLY: "document.state.readonly", CLOSED: "document.state.closed",
  EXPIRED: "document.state.expired", REVOKED: "document.state.revoked", FAILED: "document.state.failed",
} as const;
const closed = new Set(["CLOSED", "EXPIRED", "REVOKED", "FAILED"]);

function sameReference(left: ContentReference, right: ContentReference): boolean {
  return !!left && !!right && left.resourceId === right.resourceId && left.assetId === right.assetId
    && left.nativeObjectRef === right.nativeObjectRef && left.nativeRevision === right.nativeRevision
    && left.displayName === right.displayName && left.mediaType === right.mediaType;
}

function exactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && url.origin === value
      && value !== window.location.origin;
  } catch { return false; }
}

export function validDocumentSession(session: ProtocolSessionView, sessionId: string, bindingId: string,
  actionExecutionId: string, reference: ContentReference): boolean {
  return !!session && session.protocolSessionId === sessionId && session.applicationBindingId === bindingId
    && session.actionExecutionId === actionExecutionId
    && sameReference(session.reference, reference) && session.baseRevision === reference.nativeRevision
    && states.some((state) => state === session.state)
    && Number.isSafeInteger(session.version) && session.version > 0
    && ["VIEW", "EDIT"].includes(session.admittedMode)
    && ["LIGHT", "DARK"].includes(session.launchTheme) && ["en", "zh-CN"].includes(session.launchLocale)
    && Number.isFinite(Date.parse(String(session.expiresAt)))
    && Array.isArray(session.effectiveEditorOrigins)
    && session.effectiveEditorOrigins.every(exactOrigin);
}

export function validDocumentLaunch(launch: DocumentLaunchDescriptor, session: ProtocolSessionView): boolean {
  try {
    const url = new URL(launch.actionUrl);
    return exactOrigin(launch.editorOrigin) && url.origin === launch.editorOrigin
      && !url.username && !url.password && !url.hash
      && !Array.from(url.searchParams.keys()).some((key) => ["access_token", "token", "refresh_token", "password", "secret"].includes(key.toLowerCase()))
      && session.effectiveEditorOrigins.includes(launch.editorOrigin)
      && !closed.has(session.state) && session.state !== "UNKNOWN"
      && Date.parse(launch.expiresAt) > Date.now()
      && Date.parse(launch.expiresAt) <= Date.parse(String(session.expiresAt))
      && (launch.method === "POST" || launch.method === "GET")
      && launch.formFields !== null && typeof launch.formFields === "object"
      && !Array.isArray(launch.formFields)
      && Object.entries(launch.formFields).every(([key, value]) => key.length > 0
        && typeof value === "string" && !/[\u0000-\u001f\u007f]/.test(key + value))
      // A GET descriptor cannot turn a short-lived form credential into a URL.
      && (launch.method === "POST" || Object.keys(launch.formFields).length === 0);
  } catch { return false; }
}

/** The one Web SOURCE_BOUND_PROTOCOL host. Credentials exist only for this first form submission. */
type DocumentSurfaceProps = {
  bindingId: string;
  sessionId: string;
  actionExecutionId: string;
  reference: ContentReference;
  launch?: DocumentLaunchDescriptor;
  onBack: () => void;
  /** A new, explicit fresh admission, never a replay of this descriptor. */
  onReopen?: () => void;
};

export function ProtocolDocumentSurface(props: DocumentSurfaceProps) {
  return <SessionSurface key={`${props.bindingId}:${props.sessionId}:${props.actionExecutionId}`} {...props} />;
}

function SessionSurface({ bindingId, sessionId, actionExecutionId, reference, launch, onBack, onReopen }: DocumentSurfaceProps) {
  const client = useBffClient();
  const theme = useDocumentTheme();
  const locale = useLocale();
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const frameName = `protocol-document-${useId().replace(/:/g, "")}`;
  const pendingLaunch = useRef(launch);
  const attempted = useRef(false);
  const launchedOrigin = useRef<string | undefined>(undefined);
  const [launched, setLaunched] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [dirtyVersion, setDirtyVersion] = useState<number>();
  const [uiNotice, setUiNotice] = useState<"loading" | "dirty" | "close">();
  const [read, reload] = useLoad(`protocol-session:${sessionId}`, () => client.protocolSession(sessionId));
  const session = read.status === "ok" && validDocumentSession(read.data, sessionId, bindingId, actionExecutionId, reference)
    ? read.data : undefined;
  const latest = useRef(session);
  if (session) latest.current = session;
  const denied = read.status === "error" || (read.status === "ok" && (!session
    || (launchedOrigin.current !== undefined && !session.effectiveEditorOrigins.includes(launchedOrigin.current))));
  const finished = session !== undefined && closed.has(session.state);

  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  useEffect(() => {
    if (!theme || !session || !frame.current || attempted.current) return;
    const descriptor = pendingLaunch.current;
    if (!descriptor) return;
    attempted.current = true;
    pendingLaunch.current = undefined;
    if (!validDocumentLaunch(descriptor, session)) { setInvalid(true); return; }
    launchedOrigin.current = descriptor.editorOrigin;
    if (descriptor.method === "GET") {
      // Native GET launch parameters must not be discarded by HTML form GET.
      frame.current.src = descriptor.actionUrl;
      setLaunched(true);
      return;
    }
    const form = document.createElement("form");
    form.method = descriptor.method;
    form.action = descriptor.actionUrl;
    form.target = frameName;
    form.hidden = true;
    for (const [name, value] of Object.entries(descriptor.formFields)) {
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = name;
      field.value = value;
      form.append(field);
    }
    document.body.append(form);
    try { HTMLFormElement.prototype.submit.call(form); setLaunched(true); }
    catch { setInvalid(true); }
    finally { form.remove(); }
  }, [theme, session, frameName]);

  useEffect(() => {
    if (denied || finished) {
      setBlocked(true);
      setLaunched(false);
      attempted.current = true;
      pendingLaunch.current = undefined;
      launchedOrigin.current = undefined;
    }
  }, [denied, finished]);

  useEffect(() => {
    const message = (event: MessageEvent<unknown>) => {
      if (!frame.current || event.source !== frame.current.contentWindow
        || !launchedOrigin.current || event.origin !== launchedOrigin.current) return;
      let payload = event.data;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch { return; }
      }
      if (!payload || typeof payload !== "object" || !("MessageId" in payload)) return;
      if (payload.MessageId === "App_LoadingStatus") setUiNotice("loading");
      else if (payload.MessageId === "Edit_Notification") {
        setDirtyVersion(latest.current?.version ?? 0);
        setUiNotice("dirty");
      } else if (payload.MessageId === "UI_Close") setUiNotice("close");
      // No client message changes authoritative Session state, permission or usage.
    };
    window.addEventListener("message", message);
    return () => window.removeEventListener("message", message);
  }, []);

  const changedAppearance = session && (session.launchTheme !== theme || session.launchLocale !== locale);
  const safeReopen = session && (session.state === "READ_ONLY" || session.state === "SAVED")
    && (dirtyVersion === undefined || session.version > dirtyVersion);
  return <section className="flex min-h-0 flex-1 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={onBack}>{t("platform.back")}</Button>
      <Button onClick={reload} disabled={read.status === "pending"}>{t("platform.refresh")}</Button>
      {onReopen && safeReopen ? <Button onClick={onReopen}>{t("document.reopen")}</Button> : null}
    </div>
    <h2 className="text-base font-medium">{reference.displayName}</h2>
    <p className="text-sm text-muted-foreground">{t("document.fixedRevision", { revision: reference.nativeRevision })}</p>
    {session ? <p role="status" className="text-sm text-muted-foreground">{t(stateMessages[session.state])}</p> : null}
    {changedAppearance ? <p role="status" className="text-sm text-muted-foreground">{t("document.appearancePending")}</p> : null}
    {uiNotice ? <p role="status" className="text-sm text-muted-foreground">{t(`document.ui.${uiNotice}`)}</p> : null}
    {!theme ? <Notice>{t("document.unsupportedHost")}</Notice>
      : denied ? <ReadFailure error={read.status === "error" ? read.error : undefined} onRetry={reload} />
      : invalid ? <Notice role="alert">{t("document.invalidLaunch")}</Notice>
      : finished ? <Notice>{t("document.closed")}</Notice>
      : blocked ? <Notice>{t("document.noLaunch")}</Notice>
      : <>
        {!launched ? <Notice role="status">{t(read.status === "pending" ? "platform.loading" : pendingLaunch.current ? "document.opening" : "document.noLaunch")}</Notice> : null}
        <iframe ref={frame} name={frameName} title={t("document.editorTitle")}
          className={launched ? "min-h-96 w-full flex-1 border-0" : "hidden"}
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" referrerPolicy="no-referrer" />
      </>}
  </section>;
}
