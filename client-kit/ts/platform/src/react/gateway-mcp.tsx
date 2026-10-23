// DD-134(5) MCP 服务器向导：只编排既有动作，不新增动作，不写交付目录或一致性环境。
// 平台范围（Catalog manage）：①选择部署交付目录中的端点（手填 URL 只做精确匹配）→ ②经网关
// 受控探测 initialize 与 tools/list → ③为工具选择 ACTIVE 契约或预填契约登记草稿
// （capability_contract.register，另一位平台管理员批准）→ ④生成 PROTOCOL_PEER 发行草稿并提交
// component_release.register → ⑤component_release.approve 等待第二位平台管理员。
// Tenant 范围（Tenant manage）：⑥对已批准发行建立连接（application_binding.create），交付目录
// 须已有该连接的归属事实，缺少时生成需运维登记的条目草稿；⑦连接 ACTIVE 后工具出现在工具列表。

import {
  ApplicationIsolationMode,
  ApplicationModelCallMode,
  ApplicationCallIdentityMode,
  type CapabilityContractRegistration,
  type GatewayMcpBindingDraft,
  type GatewayMcpBindingFact,
  type GatewayMcpPeerPage,
  type GatewayMcpPeerView,
  type GatewayMcpProbeResult,
  type GatewayMcpReleasePage,
  type GatewayMcpReleaseView,
  type WorkspaceView,
} from "@client-kit/contracts";
import { type ReactNode, useState } from "react";
import {
  canonicalDigest, contractDraft, peerEntryTemplate, refreshReleaseDigests, releaseDraft, type ReleaseDraft,
  type ToolContractChoice, UncoveredOperationsError, usableFacts,
} from "../gateway-drafts";
import { writeFailure } from "../transport";
import { useBffClient, useFailureText, useT } from "./context";
import { GatewayActionPanel, useGatewayAction } from "./gateway-action";
import { GatewayLoad, GatewaySection, shortDigest, useTimestamp } from "./gateway-shared";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";

const textareaClass = "min-h-32 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs";
const inputClass = "h-8 rounded-md border border-input bg-transparent px-2 text-sm";

function Step({ index, title, children, testId }: { index: number; title: string; children: ReactNode; testId?: string }) {
  return <section className="flex flex-col gap-2 rounded-md border p-3" data-testid={testId}>
    <h3 className="text-sm font-medium">{`${index}. ${title}`}</h3>
    {children}
  </section>;
}

/** ①端点：交付目录是运维域事实（DD-94(2)(5)），未登记的 URL 不探测、不登记。 */
function EndpointStep({ page, selected, onSelect }: {
  page: GatewayMcpPeerPage; selected: GatewayMcpPeerView | null; onSelect: (peer: GatewayMcpPeerView | null) => void;
}) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [unmatched, setUnmatched] = useState<string | null>(null);
  const match = () => {
    const wanted = url.trim();
    const peer = page.peers.find((item) => item.mcpUrl === wanted) ?? null;
    setUnmatched(peer ? null : wanted);
    onSelect(peer);
  };
  return <Step index={1} title={t("gateway.mcp.endpoint")} testId="gateway-mcp-endpoint">
    <p className="text-xs text-muted-foreground">{t("gateway.mcp.endpointExplain")}</p>
    {!page.directoryAvailable ? <p role="status" className="text-sm">{t("gateway.mcp.directoryUnavailable")}</p> : null}
    {page.peers.length ? <Table head={[t("gateway.mcp.serviceRef"), t("gateway.mcp.url"), t("gateway.mcp.artifact"),
      t("gateway.mcp.conformance"), t("gateway.mcp.facts"), t("platform.action")]}>
      {page.peers.map((peer) => <tr key={peer.adapterServiceRef} data-testid="gateway-mcp-peer">
        <Cell mono>{peer.adapterServiceRef}</Cell>
        <Cell mono>{peer.mcpUrl}</Cell>
        <Cell mono title={peer.artifactDigest}>{shortDigest(peer.artifactDigest)}</Cell>
        <Cell><Badge tone={peer.conformanceReady ? "positive" : "neutral"}>
          {t(peer.conformanceReady ? "gateway.mcp.conformanceReady" : "gateway.mcp.conformanceMissing")}</Badge></Cell>
        <Cell>{String(peer.bindingFacts.length)}</Cell>
        <Cell>{selected?.adapterServiceRef === peer.adapterServiceRef ? <Badge tone="positive">{t("gateway.mcp.selected")}</Badge>
          : <Button onClick={() => { setUnmatched(null); onSelect(peer); }}>{t("gateway.mcp.select")}</Button>}</Cell>
      </tr>)}
    </Table> : <Notice>{t("gateway.mcp.noPeers")}</Notice>}
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label={t("gateway.mcp.url")} placeholder={t("gateway.mcp.urlPlaceholder")} className={`${inputClass} min-w-64`}
        value={url} onChange={(event) => setUrl(event.target.value)} />
      <Button disabled={!url.trim()} onClick={match}>{t("gateway.mcp.match")}</Button>
    </div>
    {unmatched !== null ? <div role="alert" className="flex flex-col gap-1 text-sm" data-testid="gateway-mcp-unregistered">
      <p>{t("gateway.mcp.unregistered")}</p>
      <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{peerEntryTemplate(unmatched)}</pre>
    </div> : null}
  </Step>;
}

/** ②受控探测：只读查询，不创建 release、Tool 或 Resource；Core 留 ACCESS 审计。 */
function ProbeStep({ peer, probe, onProbe }: {
  peer: GatewayMcpPeerView; probe: GatewayMcpProbeResult | null; onProbe: (result: GatewayMcpProbeResult) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const timestamp = useTimestamp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const result = await client.gatewayMcpProbe({ adapterServiceRef: peer.adapterServiceRef });
      if (!result || result.adapterServiceRef !== peer.adapterServiceRef || !Array.isArray(result.tools)) throw new Error("probe");
      onProbe(result);
    } catch (failure) {
      const failed = writeFailure(failure);
      setError(failed.kind === "rejected" ? failureText(failed) : t("gateway.mcp.probeUnknown"));
    } finally { setBusy(false); }
  };
  return <Step index={2} title={t("gateway.mcp.probe")} testId="gateway-mcp-probe">
    <p className="text-xs text-muted-foreground">{t("gateway.mcp.probeExplain")}</p>
    <Button className="w-fit" disabled={busy} onClick={() => void run()}>{t(busy ? "platform.loading" : "gateway.mcp.runProbe")}</Button>
    {error ? <p role="alert" className="text-sm">{error}</p> : null}
    {probe ? <div className="flex flex-col gap-2 text-sm" data-testid="gateway-mcp-probe-result">
      <p>{t("gateway.mcp.server", { name: probe.serverName ?? "—", version: probe.serverVersion ?? "—",
        protocol: probe.protocolVersion ?? "—", at: timestamp(probe.probedAt) })}</p>
      <p className="break-all font-mono text-xs">{t("gateway.mcp.schemaDigest", { digest: probe.toolSchemaDigest })}</p>
      {!probe.tools.length ? <Notice>{t("gateway.mcp.noTools")}</Notice> : <Table head={[t("gateway.tools.name"),
        t("gateway.mcp.description"), t("gateway.mcp.readOnly"), t("gateway.mcp.matches")]}>
        {probe.tools.map((tool) => <tr key={tool.name} data-testid="gateway-mcp-probed-tool">
          <Cell mono>{tool.name}</Cell>
          <Cell>{tool.description ?? tool.displayTitle ?? "—"}</Cell>
          <Cell>{tool.readOnlyHint === undefined ? "—" : t(tool.readOnlyHint ? "gateway.mcp.yes" : "gateway.mcp.no")}</Cell>
          <Cell mono>{tool.matchingContracts.map((item) => item.contractKey).join(", ") || "—"}</Cell>
        </tr>)}
      </Table>}
    </div> : null}
  </Step>;
}

/** ③契约：ACTIVE 契约中输入 schema 摘要一致者可选；没有时预填登记草稿，由另一位平台管理员批准。 */
function ContractStep({ probe, choices, onChoices, contract, onContract }: {
  probe: GatewayMcpProbeResult; choices: ToolContractChoice[]; onChoices: (choices: ToolContractChoice[]) => void;
  contract: CapabilityContractRegistration | null; onContract: (contract: CapabilityContractRegistration | null) => void;
}) {
  const t = useT();
  const register = useGatewayAction();
  const approve = useGatewayAction();
  const [category, setCategory] = useState("");
  const [document, setDocument] = useState("");
  const [invalid, setInvalid] = useState(false);
  const unmatched = probe.tools.filter((tool) => !tool.matchingContracts.length);
  const choose = (name: string, contractKey: string) => onChoices(choices.map((choice) => choice.tool.name !== name ? choice
    : { ...choice, contractKey: contractKey || undefined,
      permission: choice.tool.matchingContracts.find((item) => item.contractKey === contractKey)?.permission }));
  const draft = async () => {
    try {
      const value = await contractDraft(category || "mcp", unmatched.length ? unmatched : probe.tools);
      setDocument(JSON.stringify(value, null, 2)); setInvalid(false);
    } catch { setInvalid(true); }
  };
  const prepare = () => {
    let value: CapabilityContractRegistration | null = null;
    try { value = JSON.parse(document); } catch { value = null; }
    const valid = !!value && typeof value.categoryKey === "string" && Array.isArray(value.operationContracts)
      && Array.isArray(value.schemaDocuments) && typeof value.testVectorsJson === "string";
    setInvalid(!valid);
    if (!valid || !value) return;
    onContract(value);
    register.prepare({ actionKey: "capability_contract.register", explicitConfirmation: true, capabilityContractRegistration: value },
      "gateway.mcp.contractWarning");
  };
  return <Step index={3} title={t("gateway.mcp.contracts")} testId="gateway-mcp-contracts">
    <p className="text-xs text-muted-foreground">{t("gateway.mcp.contractsExplain")}</p>
    <Table head={[t("gateway.tools.name"), t("gateway.mcp.contract")]}>
      {choices.map((choice) => <tr key={choice.tool.name}>
        <Cell mono>{choice.tool.name}</Cell>
        <Cell><select aria-label={t("gateway.mcp.contractFor", { tool: choice.tool.name })} className={inputClass}
          value={choice.contractKey ?? ""} onChange={(event) => choose(choice.tool.name, event.target.value)}>
          <option value="">{t("gateway.mcp.excluded")}</option>
          {choice.tool.matchingContracts.map((item) => <option key={item.contractKey} value={item.contractKey}>
            {`${item.contractKey} · ${item.permission}`}</option>)}
        </select></Cell>
      </tr>)}
    </Table>
    {unmatched.length ? <p role="status" className="text-sm">{t("gateway.mcp.unmatched", { tools: unmatched.map((tool) => tool.name).join(", ") })}</p> : null}
    <div className="flex flex-col gap-2 border-t pt-2">
      <p className="text-xs text-muted-foreground">{t("gateway.mcp.draftExplain")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={t("gateway.mcp.category")} placeholder={t("gateway.mcp.category")} className={inputClass}
          value={category} disabled={register.frozen} onChange={(event) => setCategory(event.target.value)} />
        <Button disabled={register.frozen} onClick={() => void draft()}>{t("gateway.mcp.draftContract")}</Button>
      </div>
      {invalid && !document ? <p role="alert">{t("capabilities.invalid")}</p> : null}
      {document ? <>
        <textarea aria-label={t("gateway.mcp.contractDocument")} className={textareaClass} value={document} disabled={register.frozen}
          onChange={(event) => { setDocument(event.target.value); setInvalid(false); }} />
        {invalid ? <p role="alert">{t("capabilities.invalid")}</p> : null}
        <Button className="w-fit" disabled={register.frozen} onClick={prepare}>{t("gateway.mcp.registerContract")}</Button>
      </> : null}
      <GatewayActionPanel action={register} testId="gateway-mcp-contract-action" />
      {contract && register.submission && !register.unknown ? <Button className="w-fit" disabled={approve.frozen} onClick={() =>
        approve.prepare({ actionKey: "capability_contract.approve",
          capabilityContractRef: { categoryKey: contract.categoryKey, contractVersion: contract.contractVersion } },
        "gateway.mcp.contractApproveWarning")}>{t("gateway.mcp.requestContractApproval")}</Button> : null}
      <GatewayActionPanel action={approve} testId="gateway-mcp-contract-approval" />
      {contract ? <p className="text-xs text-muted-foreground">{t("gateway.mcp.reprobeAfterApproval")}</p> : null}
    </div>
  </Step>;
}

/** ④⑤发行登记与批准：草稿可编辑，摘要按当前文本重算；登记人不能自批（self_approval=DENY）。 */
function ReleaseStep({ peer, probe, choices }: {
  peer: GatewayMcpPeerView; probe: GatewayMcpProbeResult; choices: ToolContractChoice[];
}) {
  const t = useT();
  const register = useGatewayAction();
  const approve = useGatewayAction();
  const [typeKey, setTypeKey] = useState(peer.adapterServiceRef);
  const [vendor, setVendor] = useState("");
  const [version, setVersion] = useState("");
  const [draft, setDraft] = useState<ReleaseDraft | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [uncovered, setUncovered] = useState<string[]>([]);
  const chosen = choices.filter((choice) => choice.contractKey);
  const generate = async () => {
    try {
      setDraft(await releaseDraft({ peer, probe, choices, componentTypeKey: typeKey, vendor: vendor.trim(), artifactVersion: version.trim() }));
      setInvalid(false); setUncovered([]);
    } catch (error) {
      setInvalid(true);
      setUncovered(error instanceof UncoveredOperationsError ? error.contractKeys : []);
    }
  };
  const refresh = async () => {
    if (!draft) return;
    const next = await refreshReleaseDigests(draft);
    setInvalid(!next);
    if (next) setDraft(next);
  };
  const prepare = () => {
    if (!draft) return;
    try { JSON.parse(draft.manifestJson); JSON.parse(draft.packageJson); JSON.parse(draft.bindingConfigSchemaJson); } catch { setInvalid(true); return; }
    register.prepare({ actionKey: "component_release.register", explicitConfirmation: true,
      componentReleaseRegistration: { manifestJson: draft.manifestJson, packageJson: draft.packageJson,
        bindingConfigSchemaJson: draft.bindingConfigSchemaJson } }, "gateway.mcp.releaseWarning");
  };
  const edit = (field: "manifestJson" | "packageJson" | "bindingConfigSchemaJson", value: string) => {
    if (draft) setDraft({ ...draft, [field]: value });
    setInvalid(false);
  };
  return <Step index={4} title={t("gateway.mcp.release")} testId="gateway-mcp-release">
    <p className="text-xs text-muted-foreground">{t("gateway.mcp.releaseExplain")}</p>
    {!chosen.length ? <Notice>{t("gateway.mcp.chooseContractsFirst")}</Notice> : <>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={t("gateway.mcp.componentType")} placeholder={t("gateway.mcp.componentType")} className={inputClass}
          value={typeKey} disabled={register.frozen} onChange={(event) => setTypeKey(event.target.value)} />
        <input aria-label={t("gateway.mcp.vendor")} placeholder={t("gateway.mcp.vendor")} className={inputClass}
          value={vendor} disabled={register.frozen} onChange={(event) => setVendor(event.target.value)} />
        <input aria-label={t("gateway.mcp.artifactVersion")} placeholder={t("gateway.mcp.artifactVersion")} className={inputClass}
          value={version} disabled={register.frozen} onChange={(event) => setVersion(event.target.value)} />
        <Button disabled={register.frozen || !vendor.trim() || !version.trim()} onClick={() => void generate()}>{t("gateway.mcp.draftRelease")}</Button>
      </div>
      {draft ? <>
        {(["manifestJson", "packageJson", "bindingConfigSchemaJson"] as const).map((field) => <label key={field} className="text-sm">
          {t(field === "manifestJson" ? "components.manifest" : field === "packageJson" ? "components.package" : "components.bindingSchema")}
          <textarea className={textareaClass} value={draft[field]} disabled={register.frozen}
            onChange={(event) => edit(field, event.target.value)} />
        </label>)}
        <div className="flex gap-2">
          <Button disabled={register.frozen} onClick={() => void refresh()}>{t("gateway.mcp.refreshDigests")}</Button>
          <Button disabled={register.frozen} onClick={prepare}>{t("components.register")}</Button>
        </div>
      </> : null}
      {invalid ? <p role="alert">{t("components.invalid")}</p> : null}
      {uncovered.length ? <p className="font-mono text-xs" data-testid="gateway-mcp-uncovered">{uncovered.join(", ")}</p> : null}
    </>}
    <GatewayActionPanel action={register} testId="gateway-mcp-release-action" />
    {draft && register.submission && !register.unknown ? <Step index={5} title={t("gateway.mcp.approval")} testId="gateway-mcp-approval">
      <p className="text-xs text-muted-foreground">{t("gateway.mcp.approvalExplain")}</p>
      <Button className="w-fit" disabled={approve.frozen} onClick={() => approve.prepare({ actionKey: "component_release.approve",
        componentReleaseId: draft.releaseId }, "components.approveWarning")}>{t("components.requestApproval")}</Button>
      <GatewayActionPanel action={approve} testId="gateway-mcp-approval-action" />
    </Step> : null}
  </Step>;
}

export function McpWizard() {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("gateway-mcp-peers", () => client.gatewayMcpPeers());
  const [peer, setPeer] = useState<GatewayMcpPeerView | null>(null);
  const [probe, setProbe] = useState<GatewayMcpProbeResult | null>(null);
  const [choices, setChoices] = useState<ToolContractChoice[]>([]);
  const [contract, setContract] = useState<CapabilityContractRegistration | null>(null);
  const select = (next: GatewayMcpPeerView | null) => { setPeer(next); setProbe(null); setChoices([]); };
  const probed = (result: GatewayMcpProbeResult) => {
    setProbe(result);
    setChoices(result.tools.map((tool) => {
      const only = tool.matchingContracts.length === 1 ? tool.matchingContracts[0] : undefined;
      return { tool, contractKey: only?.contractKey, permission: only?.permission };
    }));
  };
  return <GatewaySection title={t("gateway.mcp.wizardTitle")} testId="gateway-mcp-wizard" description={t("gateway.mcp.wizardExplain")}>
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
    <GatewayLoad state={state} reload={reload}>{(page: GatewayMcpPeerPage) => <div className="flex flex-col gap-3">
      <EndpointStep page={page} selected={peer} onSelect={select} />
      {peer ? <ProbeStep key={peer.adapterServiceRef} peer={peer} probe={probe} onProbe={probed} /> : null}
      {peer && probe ? <ContractStep probe={probe} choices={choices} onChoices={setChoices} contract={contract} onContract={setContract} /> : null}
      {peer && probe ? <ReleaseStep peer={peer} probe={probe} choices={choices} /> : null}
      <p className="text-xs text-muted-foreground">{t("gateway.mcp.bindingInTenant")}</p>
    </div>}</GatewayLoad>
  </GatewaySection>;
}

/** ⑥建立连接：选择交付目录中本 Tenant 尚未使用的归属事实；配置摘要须与事实一致（Core 复核）。 */
function BindRelease({ release, fact, tenantId, onClose, onSettled }: {
  release: GatewayMcpReleaseView; fact: GatewayMcpBindingFact; tenantId: string; onClose: () => void; onSettled: () => void;
}) {
  const t = useT();
  const action = useGatewayAction(() => onSettled());
  const [config, setConfig] = useState("{}");
  const [mode, setMode] = useState<ApplicationModelCallMode>(release.allowedModelCallModes[0] ?? ApplicationModelCallMode.None);
  const [retain, setRetain] = useState(false);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<"invalid" | "digest" | "secrets" | null>(null);
  const prepare = async () => {
    let parsed: unknown;
    try { parsed = JSON.parse(config); } catch { parsed = undefined; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { setProblem("invalid"); return; }
    if (await canonicalDigest(parsed) !== fact.configDigest) { setProblem("digest"); return; }
    const values = release.secretKeys.map((secretKey) => ({ secretKey, value: secrets[secretKey] ?? "" }));
    if (values.some((entry) => !entry.value)) { setProblem("secrets"); return; }
    if (fact.tenantId !== tenantId || !release.adapterServiceRef || !release.nativeInstanceRef) { setProblem("invalid"); return; }
    setProblem(null);
    action.prepare({
      actionKey: "application_binding.create", explicitConfirmation: true,
      ...(fact.workspaceId ? { workspaceId: fact.workspaceId } : {}),
      applicationBindingCreate: {
        bindingId: fact.bindingId, componentReleaseId: release.componentReleaseId, servicePrincipalId: fact.servicePrincipalId,
        adapterServiceRef: release.adapterServiceRef, nativeInstanceRef: release.nativeInstanceRef, nativeScopeRef: fact.nativeScopeRef,
        isolationMode: fact.isolationMode, capabilityCategories: release.capabilityCategories.map((item) => ({ category: item.category, version: item.version })),
        normalizedConfigJson: JSON.stringify(parsed), secretRefs: [], modelCallMode: mode,
        callIdentityMode: ApplicationCallIdentityMode.InstanceService, retainOnTenantDelete: retain,
      },
      ...(values.length ? { bindingSecretValues: values } : {}),
    }, "gateway.mcp.bindWarning");
  };
  return <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="gateway-mcp-bind">
    <h3 className="text-sm font-medium">{t("gateway.mcp.bindTitle", { release: `${release.componentTypeKey} · ${release.version}` })}</h3>
    <p className="break-all font-mono text-xs">{t("gateway.mcp.factLine", { binding: fact.bindingId, scope: fact.nativeScopeRef,
      workspace: fact.workspaceId ?? t("bindings.tenant") })}</p>
    <label className="text-sm">{t("gateway.mcp.config")}
      <textarea className={textareaClass} value={config} disabled={action.frozen} onChange={(event) => { setConfig(event.target.value); setProblem(null); }} />
    </label>
    <label className="text-sm">{t("gateway.mcp.modelMode")}
      <select aria-label={t("gateway.mcp.modelMode")} className={`ml-2 ${inputClass}`} value={mode} disabled={action.frozen}
        onChange={(event) => setMode(event.target.value as ApplicationModelCallMode)}>
        {release.allowedModelCallModes.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={retain} disabled={action.frozen} onChange={(event) => setRetain(event.target.checked)} />
      {t("gateway.mcp.retain")}
    </label>
    {release.secretKeys.length ? <fieldset className="flex flex-col gap-1 text-sm">
      <legend>{t("gateway.mcp.secrets")}</legend>
      {release.secretKeys.map((secretKey) => <input key={secretKey} type="password" autoComplete="off" aria-label={secretKey} placeholder={secretKey}
        className={inputClass} disabled={action.frozen} value={secrets[secretKey] ?? ""}
        onChange={(event) => setSecrets((old) => ({ ...old, [secretKey]: event.target.value }))} />)}
    </fieldset> : null}
    {problem ? <p role="alert">{t(problem === "digest" ? "gateway.mcp.configDigestMismatch"
      : problem === "secrets" ? "bindings.secretsMissing" : "bindings.invalid")}</p> : null}
    <div className="flex gap-2">
      <Button disabled={action.frozen} onClick={() => void prepare()}>{t("gateway.mcp.prepareBind")}</Button>
      {!action.frozen ? <Button onClick={onClose}>{t("platform.cancel")}</Button> : null}
    </div>
    <GatewayActionPanel action={action} testId="gateway-mcp-bind-action" />
    {action.submission && !action.unknown ? <p className="text-xs text-muted-foreground">{t("gateway.mcp.toolsAppear")}</p> : null}
  </div>;
}

/** 缺少归属事实时：生成需运维加入交付目录的条目草稿（纯计算，不写状态）。 */
function DraftFact({ release, workspaces }: { release: GatewayMcpReleaseView; workspaces: WorkspaceView[] }) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const [config, setConfig] = useState("{}");
  const [isolation, setIsolation] = useState<ApplicationIsolationMode>(ApplicationIsolationMode.DedicatedInstance);
  const [scope, setScope] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [draft, setDraft] = useState<GatewayMcpBindingDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generate = async () => {
    setError(null);
    try {
      setDraft(await client.gatewayMcpBindingDraft({ componentReleaseId: release.componentReleaseId, normalizedConfigJson: config,
        isolationMode: isolation, nativeScopeRef: scope.trim(), ...(workspaceId ? { workspaceId } : {}) }));
    } catch (failure) {
      const failed = writeFailure(failure);
      setError(failed.kind === "rejected" ? failureText(failed) : t("gateway.readFailed"));
    }
  };
  return <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="gateway-mcp-draft-fact">
    <p className="text-xs text-muted-foreground">{t("gateway.mcp.draftFactExplain")}</p>
    <label className="text-sm">{t("gateway.mcp.config")}
      <textarea className={textareaClass} value={config} onChange={(event) => setConfig(event.target.value)} />
    </label>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label={t("gateway.mcp.isolation")} className={inputClass} value={isolation}
        onChange={(event) => setIsolation(event.target.value as ApplicationIsolationMode)}>
        {Object.values(ApplicationIsolationMode).map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <input aria-label={t("gateway.mcp.nativeScope")} placeholder={t("gateway.mcp.nativeScope")} className={inputClass}
        value={scope} onChange={(event) => setScope(event.target.value)} />
      <select aria-label={t("bindings.scope")} className={inputClass} value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
        <option value="">{t("bindings.tenant")}</option>
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
      <Button disabled={!scope.trim()} onClick={() => void generate()}>{t("gateway.mcp.draftFact")}</Button>
    </div>
    {error ? <p role="alert" className="text-sm">{error}</p> : null}
    {draft ? <div className="flex flex-col gap-1 text-sm" data-testid="gateway-mcp-draft-entry">
      <p>{t("gateway.mcp.draftFactResult", { service: draft.adapterServiceRef })}</p>
      <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{draft.directoryEntryJson}</pre>
    </div> : null}
  </div>;
}

export function McpBindingSection({ tenantId, workspaces, onBound }: { tenantId: string; workspaces: WorkspaceView[]; onBound: () => void }) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("gateway-mcp-releases", () => client.gatewayMcpReleases());
  const [binding, setBinding] = useState<{ release: string; fact: string } | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  return <GatewaySection title={t("gateway.mcp.bindingTitle")} testId="gateway-mcp-bindings" description={t("gateway.mcp.bindingExplain")}>
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
    <GatewayLoad state={state} reload={reload}>{(page: GatewayMcpReleasePage) => !page.releases.length
      ? <Notice>{t("gateway.mcp.noReleases")}</Notice>
      : <div className="flex flex-col gap-3">{page.releases.map((release) => {
        const facts = usableFacts(release.deliveryFacts, tenantId);
        const open = binding?.release === release.componentReleaseId ? facts.find((fact) => fact.bindingId === binding.fact) : undefined;
        return <div key={release.componentReleaseId} className="flex flex-col gap-2 rounded-md border p-3" data-testid="gateway-mcp-release-row">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{`${release.componentTypeKey} · ${release.version}`}</span>
            <Badge tone="neutral">{release.status}</Badge>
            {release.bindingIds.length ? <Badge tone="positive">{t("gateway.mcp.bound", { count: String(release.bindingIds.length) })}</Badge> : null}
          </p>
          <p className="font-mono text-xs">{release.tools.map((tool) => `${tool.name} → ${tool.capabilityContractKey}`).join(", ")}</p>
          {!release.adapterServiceRef ? <p role="status" className="text-sm">{t("gateway.mcp.noPeerForRelease")}</p> : null}
          {facts.length ? <Table head={[t("gateway.mcp.bindingId"), t("gateway.mcp.nativeScope"), t("bindings.scope"), t("platform.action")]}>
            {facts.map((fact) => <tr key={fact.bindingId}>
              <Cell mono>{fact.bindingId}</Cell>
              <Cell mono>{fact.nativeScopeRef}</Cell>
              <Cell>{fact.workspaceId ? workspaces.find((item) => item.id === fact.workspaceId)?.name ?? fact.workspaceId : t("bindings.tenant")}</Cell>
              <Cell><Button disabled={binding !== null || !release.adapterServiceRef} onClick={() =>
                setBinding({ release: release.componentReleaseId, fact: fact.bindingId })}>{t("gateway.mcp.useFact")}</Button></Cell>
            </tr>)}
          </Table> : <p className="text-sm text-muted-foreground">{t("gateway.mcp.noFacts")}</p>}
          {open ? <BindRelease release={release} fact={open} tenantId={tenantId} onClose={() => setBinding(null)}
            onSettled={() => { onBound(); }} /> : null}
          {drafting === release.componentReleaseId ? <DraftFact release={release} workspaces={workspaces} />
            : <Button className="w-fit" onClick={() => setDrafting(release.componentReleaseId)}>{t("gateway.mcp.newFact")}</Button>}
        </div>;
      })}</div>}</GatewayLoad>
  </GatewaySection>;
}
