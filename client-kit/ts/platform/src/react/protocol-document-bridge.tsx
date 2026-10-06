import { useEffect, useRef, useState } from "react";
import type { NativeDocumentSelection } from "@client-kit/contracts";
import { newIdempotencyKey } from "../governance";
import { useBffClient, useDocumentTheme, useT } from "./context";
import { validNativePage } from "./native-application-page";
import { ProtocolDocumentAction } from "./protocol-document-action";
import { Button, Notice, ReadFailure } from "./ui";
import { useLoad } from "./use-load";

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const only = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value
  && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));

function validSelection(value: unknown, binding: string, generation: number): value is NativeDocumentSelection {
  if (!only(value, ["bindingId", "generation", "workspaceId", "reference", "resourceVersion", "actionKey", "actionVersion"])
    || value.bindingId !== binding || value.generation !== generation
    || !integer(value.resourceVersion) || value.actionVersion !== 1
    || !uuid(value.workspaceId)
    || !["file_storage.open_view@v1", "file_storage.open_edit@v1"].includes(String(value.actionKey))) return false;
  const reference = value.reference;
  return only(reference, ["resourceId", "nativeObjectRef", "nativeRevision", "displayName", "mediaType"])
    && uuid(reference.resourceId) && text(reference.nativeObjectRef) && text(reference.nativeRevision)
    && typeof reference.displayName === "string" && text(reference.mediaType);
}

/** Native menus transfer a typed reference, never platform credentials or a document launch. */
export function ProtocolDocumentBridge({ bindingId, onBack }: { bindingId: string; onBack: () => void }) {
  const t = useT();
  const theme = useDocumentTheme();
  if (!theme || !uuid(bindingId) || window.opener === null || window.opener === window) {
    return <Notice>{t("document.sourceUnavailable")}<Button onClick={onBack}>{t("platform.back")}</Button></Notice>;
  }
  return <NativeSource key={bindingId} bindingId={bindingId} onBack={onBack} />;
}

function NativeSource({ bindingId, onBack }: { bindingId: string; onBack: () => void }) {
  const client = useBffClient();
  const t = useT();
  const opener = useRef<Window>(window.opener);
  const [selection, setSelection] = useState<NativeDocumentSelection>();
  const [invalid, setInvalid] = useState(false);
  const [state, reload] = useLoad(`document-source:${bindingId}`, () => client.applicationNativePage(bindingId));
  const page = state.status === "ok" && validNativePage(state.data, bindingId) ? state.data : undefined;
  const accepted = useRef(false);

  useEffect(() => {
    if (!page || accepted.current) return;
    const source = opener.current;
    const nonce = newIdempotencyKey();
    const receive = (event: MessageEvent<unknown>) => {
      if (accepted.current || window.opener !== source || event.source !== source || event.origin !== page.origin) return;
      if (!only(event.data, ["type", "nonce", "selection"]) || event.data.type !== "kailo.document.selection"
        || event.data.nonce !== nonce) return;
      if (!validSelection(event.data.selection, bindingId, page.projectionGeneration)) { setInvalid(true); return; }
      accepted.current = true;
      setInvalid(false);
      setSelection(event.data.selection);
    };
    window.addEventListener("message", receive);
    try { source.postMessage({ type: "kailo.document.ready", bindingId, nonce }, page.origin); }
    catch { setInvalid(true); }
    return () => window.removeEventListener("message", receive);
  }, [page, bindingId]);

  if (selection) return <ProtocolDocumentAction
    bindingId={bindingId}
    projectionGeneration={selection.generation}
    command={{ actionKey: selection.actionKey, workspaceId: selection.workspaceId,
      resourceId: selection.reference.resourceId, resourceVersion: selection.resourceVersion }}
    selection={{ reference: selection.reference, actionVersion: selection.actionVersion }} onBack={onBack} />;
  return <section className="flex flex-col gap-3">
    <Button className="w-fit" onClick={onBack}>{t("platform.back")}</Button>
    {state.status === "pending" ? <Notice>{t("platform.loading")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <Notice role={invalid ? "alert" : "status"}>{t(invalid ? "document.sourceInvalid" : "document.awaitSource")}</Notice>}
  </section>;
}
