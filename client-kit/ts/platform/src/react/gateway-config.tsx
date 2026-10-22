// DD-134(3)⑥(4) 实时配置（平台范围，Catalog audit）：effective config 与 ConfigResource 当前值均由
// Core 读取并打码后返回，只读。版本历史取 Core 写入并回读确认时保存的写入证据；当前 revision
// 没有证据的标为 UNRECORDED（外部写入或早于证据），不反向导入。这里没有任何写配置入口。

import {
  GatewayConfigRevisionSource,
  type GatewayConfigHistory,
  type GatewayConfigResourceView,
  type GatewayConfigView,
} from "@client-kit/contracts";
import { useState } from "react";
import { useBffClient, useT } from "./context";
import {
  changeLabel, EnumText, GatewayLoad, GatewaySection, revisionSourceLabel, useTimestamp,
} from "./gateway-shared";
import { ActionLabel, Badge, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";

function pretty(json: string | undefined): string {
  if (json === undefined) return "—";
  try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}

function SourceBadge({ source }: { source: GatewayConfigRevisionSource }) {
  return <Badge tone={source === GatewayConfigRevisionSource.CoreRecorded ? "positive" : "negative"}>
    <EnumText table={revisionSourceLabel} value={source} />
  </Badge>;
}

function History({ resource, onBack }: { resource: GatewayConfigResourceView; onBack: () => void }) {
  const client = useBffClient();
  const t = useT();
  const timestamp = useTimestamp();
  const [state, reload] = useLoad(`gateway-config-history:${resource.kind}:${resource.id}`,
    () => client.gatewayConfigHistory(resource.kind, resource.id));
  return <div className="flex flex-col gap-3" data-testid="gateway-config-history">
    <Button className="w-fit" onClick={onBack}>{t("gateway.detail.back")}</Button>
    <h3 className="text-sm font-medium">{t("gateway.config.historyTitle", { kind: resource.kind, id: resource.id })}</h3>
    <GatewayLoad state={state} reload={reload}>{(history: GatewayConfigHistory) => <>
      <p className="flex items-center gap-2 text-sm">
        {t("gateway.config.current", { revision: history.currentRevision === undefined ? "—" : String(history.currentRevision) })}
        <SourceBadge source={history.currentSource} />
      </p>
      {history.currentSource === GatewayConfigRevisionSource.Unrecorded
        ? <p role="status" className="text-sm text-muted-foreground">{t("gateway.config.unrecordedExplain")}</p> : null}
      {!history.revisions.length ? <Notice>{t("gateway.config.noRevisions")}</Notice>
        : history.revisions.map((revision) => <div key={revision.revision} className="flex flex-col gap-2 rounded-md border p-3" data-testid="gateway-config-revision">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{t("gateway.config.revision", { revision: String(revision.revision) })}</span>
            <span className="text-muted-foreground">{timestamp(revision.recordedAt)}</span>
            {revision.deleted ? <Badge tone="negative">{t("gateway.config.deleted")}</Badge> : null}
          </p>
          {revision.actionKey ? <ActionLabel actionKey={revision.actionKey} /> : null}
          <p className="break-all font-mono text-xs">{revision.actionExecutionId
            ? t("gateway.config.producedBy", { execution: revision.actionExecutionId, operation: revision.operationId ?? "—" })
            : t("gateway.config.noExecution")}</p>
          {!revision.changes.length ? <p className="text-xs text-muted-foreground">{t("gateway.config.noChanges")}</p>
            : <Table head={[t("gateway.config.path"), t("gateway.config.change"), t("gateway.config.before"), t("gateway.config.after")]}>
              {revision.changes.map((change) => <tr key={`${change.path}:${change.change}`} data-testid="gateway-config-change">
                <Cell mono>{change.path || "/"}</Cell>
                <Cell><EnumText table={changeLabel} value={change.change} /></Cell>
                <Cell mono>{change.beforeJson ?? "—"}</Cell>
                <Cell mono>{change.afterJson ?? "—"}</Cell>
              </tr>)}
            </Table>}
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">{t("gateway.config.maskedValue")}</summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{pretty(revision.valueJson)}</pre>
          </details>
        </div>)}
    </>}</GatewayLoad>
  </div>;
}

export function ConfigSection() {
  const client = useBffClient();
  const t = useT();
  const timestamp = useTimestamp();
  const [state, reload] = useLoad("gateway-config", () => client.gatewayConfig());
  const [selected, setSelected] = useState<GatewayConfigResourceView | null>(null);
  const [kind, setKind] = useState("");
  return <GatewaySection title={t("gateway.config.title")} testId="gateway-config" description={t("gateway.config.explain")}>
    {selected ? <History resource={selected} onBack={() => setSelected(null)} /> : <>
      <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
      <GatewayLoad state={state} reload={reload}>{(view: GatewayConfigView) => {
        const kinds = [...new Set(view.resources.map((resource) => resource.kind))].sort();
        const shown = view.resources.filter((resource) => !kind || resource.kind === kind);
        const unrecorded = view.resources.filter((resource) => resource.source === GatewayConfigRevisionSource.Unrecorded).length;
        return <>
          <p className="text-xs text-muted-foreground">{t("gateway.config.readAt", { at: timestamp(view.readAt) })}</p>
          {unrecorded ? <p role="status" className="text-sm">{t("gateway.config.unrecordedCount", { count: String(unrecorded) })}</p> : null}
          <details data-testid="gateway-config-effective">
            <summary className="cursor-pointer text-sm font-medium">{t("gateway.config.effective")}</summary>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{pretty(view.effectiveConfigJson)}</pre>
          </details>
          <label className="text-sm">{t("gateway.config.kind")}
            <select aria-label={t("gateway.config.kind")} className="ml-2 h-8 rounded-md border border-input bg-transparent px-2 text-sm"
              value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">{t("gateway.config.allKinds")}</option>
              {kinds.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          {!shown.length ? <Notice>{t("gateway.config.none")}</Notice> : <div className="overflow-x-auto">
            <Table head={[t("gateway.config.kind"), t("gateway.config.id"), t("gateway.config.revisionColumn"), t("gateway.config.updated"),
              t("gateway.config.source"), t("gateway.config.execution"), t("platform.action")]}>
              {shown.map((resource) => <tr key={`${resource.kind}:${resource.id}`} data-testid="gateway-config-row">
                <Cell mono>{resource.kind}</Cell>
                <Cell mono>{resource.id}</Cell>
                <Cell mono>{String(resource.revision)}</Cell>
                <Cell>{timestamp(resource.updatedAt)}</Cell>
                <Cell><SourceBadge source={resource.source} /></Cell>
                <Cell>{resource.actionKey ? <ActionLabel actionKey={resource.actionKey} /> : resource.actionExecutionId
                  ? <code className="text-xs">{resource.actionExecutionId}</code> : "—"}</Cell>
                <Cell><Button onClick={() => setSelected(resource)}>{t("gateway.config.history")}</Button></Cell>
              </tr>)}
            </Table>
          </div>}
        </>;
      }}</GatewayLoad>
    </>}
  </GatewaySection>;
}
