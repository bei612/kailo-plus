// DD-134(7) 模型路由（Tenant 范围）：列表按 route Resource discover 过滤并附时间窗用量；新建沿
// 既有 llm_route.create（选择 Gateway 中已有的原生 provider 与 model 配置，Core 回读 revision
// 与摘要）；停用沿 llm_route.disable（不可逆，引用它的 Agent 与组件随即被拒绝，历史用量保留）。
// 多个来源可能同名同类型（例如都是“qwen · custom”），因此选项与已选来源都显示原生
// provider 与 model 的 ID——它们是 llm_route.create 实际提交的引用。llm_route.create 的契约
// 没有名称或用途字段，表单不收集它们。

import {
  LlmProviderCredentialMode,
  ResourceState,
  type GatewayModelRoutePage,
  type GatewayModelSourcePage,
  type WorkspaceView,
} from "@client-kit/contracts";
import { useState } from "react";
import { useBffClient, useT } from "./context";
import { GatewayActionPanel, useGatewayAction } from "./gateway-action";
import { GatewayLoad, GatewaySection, useDuration, useNumber } from "./gateway-shared";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";

type ModelSource = GatewayModelSourcePage["sources"][number];

/** 来源选项：模型名与类型之外附原生 ID，同名同类型的来源也能区分。 */
export function sourceLabel(source: ModelSource): string {
  return `${source.modelName} · ${source.providerType} · ${source.provider.id} / ${source.model.id}`;
}

function CreateRoute({ action, workspaces }: { action: ReturnType<typeof useGatewayAction>; workspaces: WorkspaceView[] }) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("gateway-model-sources", () => client.gatewayModelSources());
  const [source, setSource] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [locator, setLocator] = useState("");
  const [version, setVersion] = useState("");
  const [audience, setAudience] = useState("");
  const [invalid, setInvalid] = useState(false);
  return <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="gateway-route-create">
    <h3 className="text-sm font-medium">{t("gateway.routes.create")}</h3>
    <p className="text-xs text-muted-foreground">{t("gateway.routes.createExplain")}</p>
    <GatewayLoad state={state} reload={reload}>{(page: GatewayModelSourcePage) => {
      const index = Number(source);
      const chosen = source === "" ? undefined : page.sources[index];
      const prepare = () => {
        const secretVersion = Number(version);
        const needsSecret = chosen?.credentialRequired === true;
        const valid = !!chosen && (!needsSecret || (!!locator.trim() && !!audience.trim() && Number.isSafeInteger(secretVersion) && secretVersion > 0));
        setInvalid(!valid);
        if (!valid || !chosen) return;
        action.prepare({
          actionKey: "llm_route.create", explicitConfirmation: true,
          ...(workspaceId ? { workspaceId } : {}),
          llmRouteCreate: {
            provider: chosen.provider, model: chosen.model,
            providerCredentialMode: needsSecret ? LlmProviderCredentialMode.SecretRef : LlmProviderCredentialMode.None,
            ...(needsSecret ? { providerSecretRef: { locator: locator.trim(), version: secretVersion, audience: audience.trim() } } : {}),
          },
        }, "gateway.routes.createWarning");
      };
      return !page.sources.length ? <Notice>{t("gateway.routes.noSources")}</Notice> : <>
        <label className="text-sm">{t("gateway.routes.source")}
          <select aria-label={t("gateway.routes.source")} className="ml-2 h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            value={source} disabled={action.frozen} onChange={(event) => { setSource(event.target.value); setInvalid(false); }}>
            <option value="">{t("gateway.routes.chooseSource")}</option>
            {page.sources.map((item, position) => <option key={`${item.provider.id}:${item.model.id}`} value={String(position)}>
              {sourceLabel(item)}</option>)}
          </select>
        </label>
        {chosen ? <p className="text-xs text-muted-foreground" data-testid="gateway-route-source-ids">
          {t("gateway.routes.sourceIds", { provider: chosen.provider.id, providerRevision: chosen.provider.revision,
            model: chosen.model.id, modelRevision: chosen.model.revision })}</p> : null}
        <label className="text-sm">{t("gateway.routes.home")}
          <select aria-label={t("gateway.routes.home")} className="ml-2 h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            value={workspaceId} disabled={action.frozen} onChange={(event) => setWorkspaceId(event.target.value)}>
            <option value="">{t("bindings.tenant")}</option>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>
        {chosen?.credentialRequired ? <fieldset className="flex flex-col gap-1 text-sm">
          <legend>{t("gateway.routes.secretRef")}</legend>
          <input aria-label={t("gateway.routes.locator")} placeholder={t("gateway.routes.locator")} className="h-8 rounded-md border border-input bg-transparent px-2"
            value={locator} disabled={action.frozen} onChange={(event) => setLocator(event.target.value)} />
          <input aria-label={t("gateway.routes.version")} placeholder={t("gateway.routes.version")} inputMode="numeric" className="h-8 rounded-md border border-input bg-transparent px-2"
            value={version} disabled={action.frozen} onChange={(event) => setVersion(event.target.value)} />
          <input aria-label={t("gateway.routes.audience")} placeholder={t("gateway.routes.audience")} className="h-8 rounded-md border border-input bg-transparent px-2"
            value={audience} disabled={action.frozen} onChange={(event) => setAudience(event.target.value)} />
        </fieldset> : null}
        {invalid ? <p role="alert">{t("gateway.routes.invalid")}</p> : null}
        <Button className="w-fit" disabled={action.frozen || source === ""} onClick={prepare}>{t("gateway.routes.prepareCreate")}</Button>
      </>;
    }}</GatewayLoad>
  </div>;
}

export function ModelRoutesSection({ from, to, workspaces }: { from: string; to: string; workspaces: WorkspaceView[] }) {
  const client = useBffClient();
  const t = useT();
  const number = useNumber();
  const duration = useDuration();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`gateway-routes:${from}:${to}:${offset}`, () => client.gatewayModelRoutes(from, to, offset));
  const action = useGatewayAction(() => reload());
  const [creating, setCreating] = useState(false);
  return <GatewaySection title={t("gateway.routes.title")} testId="gateway-routes" description={t("gateway.routes.explain")}>
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
    <GatewayActionPanel action={action} testId="gateway-routes-action" />
    <GatewayLoad state={state} reload={reload}>{(page: GatewayModelRoutePage) => <>
      {page.canCreate ? creating ? <CreateRoute action={action} workspaces={workspaces} />
        : <Button className="w-fit" disabled={action.frozen} onClick={() => setCreating(true)}>{t("gateway.routes.create")}</Button> : null}
      {!page.routes.length ? <Notice>{t("gateway.routes.none")}</Notice> : <div className="overflow-x-auto">
        <Table head={[t("gateway.routes.route"), t("platform.state"), t("gateway.routes.model"), t("gateway.routes.references"),
          t("gateway.stats.requests"), t("gateway.tools.failedDenied"), t("gateway.stats.tokens"), t("gateway.tools.p95"), t("platform.action")]}>
          {page.routes.map((route) => <tr key={route.resourceId} data-testid="gateway-route-row">
            <Cell mono title={route.resourceId}>{route.nativeId}</Cell>
            <Cell><Badge tone={route.resourceState === ResourceState.Active ? "positive" : "neutral"}>{route.resourceState}</Badge></Cell>
            <Cell>{[route.provider, route.model].filter(Boolean).join(" · ") || "—"}</Cell>
            <Cell>{t("gateway.routes.referenceCount", { installations: number(route.installationCount), bindings: number(route.bindingCount) })}</Cell>
            <Cell mono>{number(route.requests)}</Cell>
            <Cell mono>{number(route.failed)}</Cell>
            <Cell mono>{number(route.totalTokens)}</Cell>
            <Cell mono>{duration(route.modelP95Ms)}</Cell>
            <Cell>{route.canDisable && route.resourceState === ResourceState.Active ? <Button disabled={action.frozen} onClick={() =>
              action.prepare({ actionKey: "llm_route.disable", explicitConfirmation: true,
                resourceId: route.resourceId, resourceVersion: route.resourceVersion }, "gateway.routes.disableWarning")}>
              {t("gateway.routes.disable")}</Button> : null}</Cell>
          </tr>)}
        </Table>
      </div>}
      <div className="flex gap-2">
        {index > 0 ? <Button onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
        {page.nextOffset !== undefined ? <Button onClick={() => { setOffsets((old) => [...old.slice(0, index + 1), page.nextOffset!]); setIndex(index + 1); }}>{t("roles.next")}</Button> : null}
      </div>
    </>}</GatewayLoad>
  </GatewaySection>;
}
