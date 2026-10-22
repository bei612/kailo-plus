// DD-134(5) MCP 服务器向导的草稿生成。这里只把探测结果与所选契约排成既有动作的
// 参数草稿，供平台管理员核对、编辑后提交；契约、release 与 binding 的全部校验、摘要
// 固定与准入仍由 Core 完成（capability_contract.register、component_release.register、
// application_binding.create）。不写交付目录、一致性环境或任何 Gateway 配置。

import {
  CapabilityPermission,
  CapabilitySurface,
  type CapabilityContractRegistration,
  type GatewayMcpBindingFact,
  type GatewayMcpPeerView,
  type GatewayMcpProbeResult,
  type GatewayMcpProbedTool,
} from "@client-kit/contracts";

/** 与 Core collab_bridge::limits::canonical_json 相同：键排序、紧凑输出。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** canonicalJson 的 SHA-256（小写十六进制），与 Core canonical_digest 同一输入。 */
export async function canonicalDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** MCP 文本结果按 Core result_value 规则是字符串；工具未声明 outputSchema 时契约输出取此 schema。 */
export const textResultSchema = { type: "string" } as const;

/** 契约键与类型键的段只允许小写字母、数字与下划线，且以字母开头。 */
export function identifierFrom(raw: string, fallback: string): string {
  const value = raw.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "");
  return value || fallback;
}

export type ToolContractChoice = {
  tool: GatewayMcpProbedTool;
  /** 选中的 ACTIVE 契约键；undefined 表示该工具不纳入本 release。 */
  contractKey?: string;
  permission?: CapabilityPermission;
};

async function outputSchemaOf(tool: GatewayMcpProbedTool): Promise<{ json: string; digest: string }> {
  if (tool.outputSchemaJson && tool.outputSchemaDigest) return { json: tool.outputSchemaJson, digest: tool.outputSchemaDigest };
  return { json: canonicalJson(textResultSchema), digest: await canonicalDigest(textResultSchema) };
}

/**
 * 以探测到的工具 schema 预填一份 capability_contract.register 草稿（DD-102）。测试向量只给
 * 结构，期望输出必须由管理员按隔离实例的真实只读结果填写；Core 校验向量覆盖全部契约键。
 */
export async function contractDraft(categoryKey: string, tools: GatewayMcpProbedTool[]): Promise<CapabilityContractRegistration> {
  const category = identifierFrom(categoryKey, "mcp");
  const documents = new Map<string, string>();
  const operations: CapabilityContractRegistration["operationContracts"] = [];
  const steps: unknown[] = [];
  for (const tool of tools) {
    const verb = identifierFrom(tool.name, "call");
    const output = await outputSchemaOf(tool);
    documents.set(tool.inputSchemaDigest, tool.inputSchemaJson);
    documents.set(output.digest, output.json);
    const contractKey = `${category}.${verb}@v1`;
    operations.push({
      contractKey,
      surface: CapabilitySurface.Tool,
      inputSchemaDigest: tool.inputSchemaDigest,
      outputSchemaDigest: output.digest,
      permission: CapabilityPermission.Consume,
      targetType: "RESOURCE",
    });
    steps.push({ stepKey: verb, contractKey, inputJson: "{}", expectedOutputJson: "\"\"" });
  }
  return {
    categoryKey: category,
    contractVersion: 1,
    resourceTypeFamily: [{ typeKey: `${category}.service`, kind: "SERVICE" }],
    operationContracts: operations,
    contentReferenceSemantics: {
      nativeObjectRefRule: "Opaque reference of the registered MCP service instance.",
      nativeRevisionRule: "Read-only tools; results carry no native revision.",
      authorizationTargetRule: "The registered service Resource of the binding.",
    },
    requiredDeclarations: [],
    protocolSessionKinds: [],
    schemaDocuments: [...documents.values()],
    testVectorsJson: canonicalJson({ formatVersion: "V1", cases: [{ caseKey: "read_only", steps }] }),
  };
}

export type ReleaseDraft = { manifestJson: string; packageJson: string; bindingConfigSchemaJson: string; releaseId: string };

export const emptyBindingConfigSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "BindingConfig",
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

/**
 * PROTOCOL_PEER release 草稿（07 §5.1、DD-94）：connector 只取 PROTOCOL_PEER，adapterBuildRef 是交付
 * 目录登记的运行体 digest，工具与动作来自所选契约。所选契约不是本次草稿登记的，其类型键与输出
 * 摘要在客户端无从得知，以占位写出，必须由管理员核对后提交；摘要按当前文本重新计算。
 */
export async function releaseDraft(input: {
  peer: GatewayMcpPeerView;
  probe: GatewayMcpProbeResult;
  choices: ToolContractChoice[];
  componentTypeKey: string;
  vendor: string;
  artifactVersion: string;
  contract?: CapabilityContractRegistration;
}): Promise<ReleaseDraft> {
  const releaseId = globalThis.crypto.randomUUID();
  const componentTypeKey = identifierFrom(input.componentTypeKey, "mcp_service");
  const chosen = input.choices.filter((choice) => choice.contractKey);
  const implemented = new Map<string, { categoryKey: string; contractVersion: number }>();
  const typeKeys = new Set<string>();
  const actionDefinitions: unknown[] = [];
  const toolDefinitions: unknown[] = [];
  for (const choice of chosen) {
    const contractKey = choice.contractKey!;
    const match = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)@v(\d+)$/.exec(contractKey);
    const categoryKey = match?.[1] ?? contractKey;
    const contractVersion = Number(match?.[3] ?? 1);
    implemented.set(`${categoryKey}@${contractVersion}`, { categoryKey, contractVersion });
    const drafted = input.contract?.categoryKey === categoryKey && input.contract.contractVersion === contractVersion
      ? input.contract : undefined;
    for (const family of drafted?.resourceTypeFamily ?? [{ typeKey: `${categoryKey}.<kind>` }]) typeKeys.add(family.typeKey);
    const operation = drafted?.operationContracts.find((item) => item.contractKey === contractKey);
    const output = operation?.outputSchemaDigest ?? (await outputSchemaOf(choice.tool)).digest;
    const permission = choice.permission ?? operation?.permission ?? "consume";
    actionDefinitions.push({
      actionKey: contractKey, version: 1, capabilityContractKey: contractKey, componentTypeKey,
      targetType: "RESOURCE", tenantRule: "SESSION_TENANT", workspaceRule: "TARGET_HOME_WORKSPACE", permission,
      executionMode: "SYNC", confirmationMode: "NONE", approvalPolicyId: "NONE", workflowType: "NONE",
      capacityPolicy: "NONE", capacityPoolKey: "NONE", quotaPolicy: "NONE", meters: [],
      resultExposurePolicy: { mode: "CONSUME_ONLY", outputSchemaHash: output, redactionPolicy: "PLATFORM_METADATA_ONLY" },
      auditPolicy: "FULL_LIFECYCLE",
      businessObservabilityPolicy: { correlationMode: "OPERATION_NATIVE_REF", progressSource: "NONE", terminalSource: "SYNC_RESULT",
        usageSource: "NONE", costSource: "NONE", redactionPolicy: "PLATFORM_METADATA_ONLY" },
      status: "ACTIVE", inputSchemaDigest: choice.tool.inputSchemaDigest, outputSchemaDigest: output,
    });
    toolDefinitions.push({
      name: choice.tool.name, source: "APPLICATION", actionKey: contractKey, capabilityContractKey: contractKey,
      inputSchemaHash: choice.tool.inputSchemaDigest, outputSchemaHash: output, backendRef: input.peer.adapterServiceRef, status: "ACTIVE",
    });
  }
  const bindingConfigSchemaJson = JSON.stringify(emptyBindingConfigSchema, null, 2);
  const manifest = {
    id: releaseId,
    componentTypeKey,
    version: "1.0.0",
    class: "APPLICATION",
    platformPortKey: "NONE",
    manifestSchemaVersion: 1,
    admissionPath: "EXTERNAL",
    vendor: input.vendor,
    artifactVersion: input.artifactVersion,
    bindingConfigSchemaVersion: 1,
    bindingConfigSchemaDigest: await canonicalDigest(emptyBindingConfigSchema),
    adapterProtocolRange: "NONE",
    frontendDelivery: { mode: "NONE", extensionSlots: [], editorOrigins: [] },
    executionConnector: { mode: "PROTOCOL_PEER", adapterProtocolRange: "NONE", actionTokenAudience: "NONE" },
    adapterBuildRef: input.peer.artifactDigest,
    implements: [...implemented.values()],
    capabilityDeclarations: [...implemented.values()].map((item) => ({
      ...item, cancel: "UNSUPPORTED", observe: "UNSUPPORTED", meter: "UNSUPPORTED", revisionQuery: "UNSUPPORTED",
      versionedModel: "UNSUPPORTED", onlineEditing: "UNSUPPORTED", readEdge: "NONE", tenantDelete: "RETAIN_ON_TENANT_DELETE",
    })),
    allowedModelCallModes: ["NONE"],
    dataStoreIsolation: "DEDICATED_INSTANCE",
    dataLocation: `Self-hosted MCP service ${input.peer.nativeInstanceRef} in the platform operations domain.`,
    secretSchema: [],
    targetResourceTypeKeys: [...typeKeys],
    resourceTypeDefinitions: [...typeKeys].map((typeKey) => ({
      typeKey, capabilityCategory: typeKey.split(".")[0], capabilityContractVersion: implemented.get(
        [...implemented.keys()].find((key) => key.startsWith(`${typeKey.split(".")[0]}@`)) ?? "")?.contractVersion ?? 1,
      incrementalContracts: [], llmGatewayContract: "NOT_USED", transferFormats: [], tenantDeleteActionKey: "NONE", status: "ACTIVE",
    })),
    actionDefinitions,
    toolDefinitions,
    businessObservabilityContract: { correlationSources: ["OPERATION_ID"], businessStateSources: ["CORE_ACTION"],
      aggregationDimensions: ["tenant_id", "workspace_id", "action_key", "component_binding_ref"], redactionPolicy: "PLATFORM_METADATA_ONLY" },
    frontendPresentationContract: { integrationMode: "NONE", themeMapping: {}, localeMapping: {}, themeChangePolicy: "NONE", localeResolutionPolicy: "NONE" },
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  return { releaseId, manifestJson, bindingConfigSchemaJson,
    packageJson: JSON.stringify(await packageFor(releaseId, manifestJson), null, 2) };
}

async function packageFor(releaseId: string, manifestJson: string) {
  return { componentReleaseId: releaseId, manifestDigest: await canonicalDigest(JSON.parse(manifestJson)),
    webArtifacts: [], backendDelivery: "EXTERNAL_SERVICE" };
}

/** 管理员改过文本后重算两处摘要；解析失败返回 null，不改原文。 */
export async function refreshReleaseDigests(draft: ReleaseDraft): Promise<ReleaseDraft | null> {
  try {
    const manifest = JSON.parse(draft.manifestJson);
    const schema = JSON.parse(draft.bindingConfigSchemaJson);
    manifest.bindingConfigSchemaDigest = await canonicalDigest(schema);
    const manifestJson = JSON.stringify(manifest, null, 2);
    const releaseId = typeof manifest.id === "string" ? manifest.id : draft.releaseId;
    const previous = JSON.parse(draft.packageJson);
    const next = { ...previous, componentReleaseId: releaseId, manifestDigest: await canonicalDigest(manifest) };
    return { releaseId, manifestJson, bindingConfigSchemaJson: draft.bindingConfigSchemaJson, packageJson: JSON.stringify(next, null, 2) };
  } catch { return null; }
}

/** 交付目录中能用于本 Tenant 建立连接的归属事实：同 Tenant 且尚未建立。 */
export function usableFacts(facts: GatewayMcpBindingFact[], tenantId: string): GatewayMcpBindingFact[] {
  return facts.filter((fact) => fact.tenantId === tenantId && !fact.bound);
}

/** 未登记端点需要运维加入交付目录的条目模板（无 secret；digest 为运行体镜像 digest）。 */
export function peerEntryTemplate(url: string): string {
  return JSON.stringify({ adapterServiceRef: "<service-ref>", mcpUrl: url, nativeInstanceRef: "<instance-ref>",
    artifactDigest: "sha256:<runtime image digest>", timeoutSeconds: 10, maxResponseBytes: 1048576, bindings: [] }, null, 2);
}
