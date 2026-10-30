// DD-164(4)⑥ (design 07 §4.7.4 receipts): for binding managers, whether the
// component has applied Kailo's current member directory (members, roles and
// Resource-level shares). Display only: the receipt grants nothing.
import { ComponentDirectoryReceiptViewState, ComponentReceiptFailureKind, type ComponentDirectoryReceiptView } from "@client-kit/contracts";
import { useBffClient, useT } from "./context";
import { useLoad } from "./use-load";
import { Badge, type Tone } from "./ui";

const stateKeys = {
  [ComponentDirectoryReceiptViewState.Converged]: "bindings.directory.converged",
  [ComponentDirectoryReceiptViewState.Pending]: "bindings.directory.pending",
  [ComponentDirectoryReceiptViewState.NotConverged]: "bindings.directory.notConverged",
  [ComponentDirectoryReceiptViewState.Failed]: "bindings.directory.failed",
  [ComponentDirectoryReceiptViewState.NoReceipt]: "bindings.directory.noReceipt",
} as const;

const kindKeys = {
  [ComponentReceiptFailureKind.Member]: "bindings.directory.kind.member",
  [ComponentReceiptFailureKind.Workspace]: "bindings.directory.kind.workspace",
  [ComponentReceiptFailureKind.Tenant]: "bindings.directory.kind.tenant",
  [ComponentReceiptFailureKind.Share]: "bindings.directory.kind.share",
} as const;

export function receiptTone(state: ComponentDirectoryReceiptViewState): Tone {
  return state === ComponentDirectoryReceiptViewState.Converged ? "positive"
    : state === ComponentDirectoryReceiptViewState.NotConverged || state === ComponentDirectoryReceiptViewState.Failed ? "negative" : "neutral";
}

/** Failure counts per directory part, in a stable order. */
export function failureCounts(view: ComponentDirectoryReceiptView): [ComponentReceiptFailureKind, number][] {
  const counts = new Map<ComponentReceiptFailureKind, number>();
  for (const failure of view.failures ?? []) counts.set(failure.kind, (counts.get(failure.kind) ?? 0) + 1);
  return Object.values(ComponentReceiptFailureKind).filter((kind) => counts.has(kind)).map((kind) => [kind, counts.get(kind)!]);
}

export function DirectoryReceiptStatus({ bindingId }: { bindingId: string }) {
  const client = useBffClient();
  const t = useT();
  const [receipt] = useLoad(`directory-receipt:${bindingId}`, () => client.applicationDirectoryReceipt(bindingId));
  // Not a manager, an older Core or a read failure: the row simply shows no sync status.
  if (receipt.status !== "ok" || !(receipt.data.state in stateKeys)) return null;
  const view = receipt.data;
  return <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs" data-testid="directory-receipt-status">
    <span className="text-muted-foreground">{t("bindings.directory.title")}</span>
    <Badge tone={receiptTone(view.state)}>{t(stateKeys[view.state])}</Badge>
    {failureCounts(view).map(([kind, count]) => <span key={kind} className="text-danger-text">
      {t("bindings.directory.failure", { kind: t(kindKeys[kind]), count })}</span>)}
  </div>;
}
