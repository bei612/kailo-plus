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
import { newIdempotencyKey } from "./governance";

/** 与 Core collab_bridge::limits::canonical_json 相同：键排序、紧凑输出。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * SHA-256（FIPS 180-4）。部署的 Web 入口是 HTTP，不是安全上下文，浏览器不提供 crypto.subtle，
 * 因此这里用纯实现；只用于向导草稿里的摘要，最终摘要以 Core 重算为准。
 */
export function sha256Hex(input: string): string {
  const data = new TextEncoder().encode(input);
  const length = ((data.length + 9 + 63) >> 6) << 6;
  const bytes = new Uint8Array(length);
  bytes.set(data);
  bytes[data.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bits = data.length * 8;
  view.setUint32(length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(length - 4, bits >>> 0);
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (value: number, shift: number) => (value >>> shift) | (value << (32 - shift));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [hash[0]!, hash[1]!, hash[2]!, hash[3]!, hash[4]!, hash[5]!, hash[6]!, hash[7]!];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) hash[i] = (hash[i]! + next[i]!) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}

/** canonicalJson 的 SHA-256（小写十六进制），与 Core canonical_digest 同一输入。 */
export async function canonicalDigest(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
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

/** 所选 ACTIVE 契约中有 operation 没有对应工具：Core 要求 release 覆盖契约的全部 operation。 */
export class UncoveredOperationsError extends Error {
  constructor(readonly contractKeys: string[]) {
    super(`uncovered contract operations: ${contractKeys.join(", ")}`);
    this.name = "UncoveredOperationsError";
  }
}

/**
 * PROTOCOL_PEER release 草稿（07 §5.1、DD-94、DD-134(5)④）。工具只能对应探测时已 ACTIVE 的契约键
 * （DD-134(5)③），因此 resourceTypeFamily、targetType、permission 与输出摘要一律取探测结果所带的
 * ACTIVE 契约 Catalog 元数据，不在客户端推断或占位；本会话刚登记的契约须经批准并重新探测后才可选。
 * 规则与 Core 的 component_release::registration / validate_declarations 及
 * application_binding_native::Connector::validate_action 对齐（PROTOCOL_PEER 的观测来源含 CORE_ACTION
 * 与 AGENTGATEWAY；APPLICATION 动作 capacityPolicy=NATIVE；同步、无 meter 与 quota）。
 * 跨语言对照样例见 contracts/samples/gateway-mcp-release-draft.sample.json，两侧测试共用。
 */
export async function releaseDraft(input: {
  peer: GatewayMcpPeerView;
  probe: GatewayMcpProbeResult;
  choices: ToolContractChoice[];
  componentTypeKey: string;
  vendor: string;
  artifactVersion: string;
}): Promise<ReleaseDraft> {
  const releaseId = newIdempotencyKey();
  const componentTypeKey = identifierFrom(input.componentTypeKey, "mcp_service");
  const chosen = input.choices.filter((choice) => choice.contractKey);
  const implemented = new Map<string, { categoryKey: string; contractVersion: number }>();
  const resourceTypes = new Map<string, { categoryKey: string; contractVersion: number }>();
  const required = new Set<string>();
  const covered = new Set<string>();
  const actionDefinitions: unknown[] = [];
  const toolDefinitions: unknown[] = [];
  for (const choice of chosen) {
    const contractKey = choice.contractKey!;
    const match = choice.tool.matchingContracts.find((item) => item.contractKey === contractKey);
    if (!match) throw new UncoveredOperationsError([contractKey]);
    const { categoryKey, contractVersion } = match;
    implemented.set(`${categoryKey}@${contractVersion}`, { categoryKey, contractVersion });
    for (const typeKey of match.resourceTypeKeys) resourceTypes.set(typeKey, { categoryKey, contractVersion });
    for (const key of match.operationContractKeys) required.add(key);
    if (covered.has(contractKey)) throw new UncoveredOperationsError([contractKey]);
    covered.add(contractKey);
    const output = match.outputSchemaDigest;
    actionDefinitions.push({
      actionKey: contractKey, version: 1, capabilityContractKey: contractKey, componentTypeKey,
      targetType: match.targetType, tenantRule: "SESSION_TENANT", workspaceRule: "TARGET_HOME_WORKSPACE", permission: match.permission,
      executionMode: "SYNC", confirmationMode: "NONE", approvalPolicyId: "NONE", workflowType: "NONE",
      capacityPolicy: "NATIVE", capacityPoolKey: "NONE", quotaPolicy: "NONE", meters: [],
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
  const uncovered = [...required].filter((key) => !covered.has(key)).sort();
  if (uncovered.length) throw new UncoveredOperationsError(uncovered);
  const typeKeys = [...resourceTypes.keys()].sort();
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
    targetResourceTypeKeys: typeKeys,
    resourceTypeDefinitions: typeKeys.map((typeKey) => ({
      typeKey, capabilityCategory: resourceTypes.get(typeKey)!.categoryKey,
      capabilityContractVersion: resourceTypes.get(typeKey)!.contractVersion,
      incrementalContracts: [], llmGatewayContract: "NOT_USED", transferFormats: [], tenantDeleteActionKey: "NONE", status: "ACTIVE",
    })),
    actionDefinitions,
    toolDefinitions,
    businessObservabilityContract: { correlationSources: ["OPERATION_ID"], businessStateSources: ["CORE_ACTION", "AGENTGATEWAY"],
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
