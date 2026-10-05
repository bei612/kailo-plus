// 四侧 round-trip 的 TypeScript 一侧（ADR-03）。
//
// 反序列化再序列化必须与样例语义相等。TypeScript 的类型在运行时被擦除，
// 因此这里额外断言样例的每个键都出现在生成接口的键集合里——否则「类型
// 对得上」会退化成「JSON 原样进出」这种无效验证。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deepStrictEqual, ok } from "node:assert/strict";
import test from "node:test";
import type { AutomationRunPage } from "../src/generated/contracts.js";
import type { AutomationVersionContent } from "../src/generated/contracts.js";
import type { ComponentConformanceStepObservation } from "../src/generated/contracts.js";
import type { ComponentReleaseApprovalReport } from "../src/generated/contracts.js";
import type { ApplicationNativePage } from "../src/generated/contracts.js";
import type { AdapterBindingObservation, AdapterExecutionReference } from "../src/generated/contracts.js";

test("binding observation preserves execution mappings, credential references and optional scope", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/application-binding-observations.sample.json", import.meta.url), "utf8");
  const typed: AdapterBindingObservation[] = JSON.parse(raw);
  const reconstructed: AdapterBindingObservation[] = typed.map(row => ({
    bindingId: row.bindingId, tenantId: row.tenantId, workspaceId: row.workspaceId,
    nativeInstanceRef: row.nativeInstanceRef, nativeScopeRef: row.nativeScopeRef,
    isolationMode: row.isolationMode, configDigest: row.configDigest,
    secretRefDigest: row.secretRefDigest, artifactDigest: row.artifactDigest,
    executionMappings: row.executionMappings.map(mapping => ({ actionKey: mapping.actionKey,
      actionVersion: mapping.actionVersion, nativeType: mapping.nativeType, cancelCapability: mapping.cancelCapability })),
    secretReads: row.secretReads.map(read => ({ secretKey: read.secretKey, requestId: read.requestId,
      version: read.version, audience: read.audience })),
  }));
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), JSON.parse(raw));
});

test("execution reference does not invent an unknown native ID", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/adapter-execution-references.sample.json", import.meta.url), "utf8");
  const typed: AdapterExecutionReference[] = JSON.parse(raw);
  const reconstructed: AdapterExecutionReference[] = typed.map(row => ({
    externalExecutionId: row.externalExecutionId, idempotencyKey: row.idempotencyKey,
    nativeType: row.nativeType, nativeId: row.nativeId,
  }));
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), JSON.parse(raw));
});

test("native page preserves binding generation and exact origins", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/application-native-page.sample.json", import.meta.url), "utf8");
  const typed: ApplicationNativePage = JSON.parse(raw);
  const reconstructed: ApplicationNativePage = {
    bindingId: typed.bindingId, projectionGeneration: typed.projectionGeneration,
    url: typed.url, origin: typed.origin, allowedOrigins: [...typed.allowedOrigins],
  };
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), JSON.parse(raw));
});

test("component observations preserve references, UNKNOWN and absent evidence", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/component-conformance-observations.sample.json", import.meta.url), "utf8");
  const original: unknown = JSON.parse(raw);
  const typed: ComponentConformanceStepObservation[] = JSON.parse(raw);
  const reconstructed: ComponentConformanceStepObservation[] = typed.map(step => ({
    caseKey: step.caseKey, stepKey: step.stepKey, operation: step.operation,
    requestDigest: step.requestDigest, responseDigest: step.responseDigest,
    resultDigest: step.resultDigest, httpStatus: step.httpStatus, errorClass: step.errorClass,
    contentReference: step.contentReference && {
      resourceId: step.contentReference.resourceId, assetId: step.contentReference.assetId,
      nativeObjectRef: step.contentReference.nativeObjectRef, nativeRevision: step.contentReference.nativeRevision,
      displayName: step.contentReference.displayName, mediaType: step.contentReference.mediaType,
    },
    nativeObservation: step.nativeObservation && {
      idempotencyKey: step.nativeObservation.idempotencyKey, nativeType: step.nativeObservation.nativeType,
      nativeId: step.nativeObservation.nativeId, nativeStatus: step.nativeObservation.nativeStatus,
      platformStatus: step.nativeObservation.platformStatus, cancelCapability: step.nativeObservation.cancelCapability,
      lastObservedAt: step.nativeObservation.lastObservedAt, terminalAt: step.nativeObservation.terminalAt,
    },
    nativeScopeObservation: step.nativeScopeObservation && {
      platformResourceRef: step.nativeScopeObservation.platformResourceRef, result: step.nativeScopeObservation.result,
      nativeType: step.nativeScopeObservation.nativeType, nativeRef: step.nativeScopeObservation.nativeRef,
    },
  }));
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), original);
});

test("automation POST_MESSAGE round-trip preserves action and native schedule", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/automation-post-message.sample.json", import.meta.url), "utf8");
  const original: unknown = JSON.parse(raw);
  const typed: AutomationVersionContent = JSON.parse(raw);
  ok(typed.action.kind === "POST_MESSAGE");
  const reconstructed: AutomationVersionContent = {
    trigger: { kind: typed.trigger.kind, scheduleSpec: typed.trigger.scheduleSpec && {
      everySeconds: typed.trigger.scheduleSpec.everySeconds, offsetSeconds: typed.trigger.scheduleSpec.offsetSeconds,
      catchupWindowSeconds: typed.trigger.scheduleSpec.catchupWindowSeconds,
    } },
    action: { kind: typed.action.kind, template: typed.action.template }, resultTarget: typed.resultTarget,
    ...(typed.approvalPolicy ? { approvalPolicy: { id: typed.approvalPolicy.id, version: typed.approvalPolicy.version } } : {}),
  };
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), original);
});

test("component release approval preserves deployment subject and NONE host API", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/component-release-approval.sample.json", import.meta.url), "utf8");
  const typed: ComponentReleaseApprovalReport = JSON.parse(raw);
  const reconstructed: ComponentReleaseApprovalReport = {
    target: { actionExecutionId: typed.target.actionExecutionId, componentReleaseId: typed.target.componentReleaseId, workflowId: typed.target.workflowId },
    runId: typed.runId,
    workerBuild: { subject: typed.workerBuild.subject, buildId: typed.workerBuild.buildId, hostApiVersion: typed.workerBuild.hostApiVersion,
      adapterProtocolVersions: typed.workerBuild.adapterProtocolVersions, driverRegistryKeys: typed.workerBuild.driverRegistryKeys,
      platformPortKeys: typed.workerBuild.platformPortKeys, reportedAt: typed.workerBuild.reportedAt },
  };
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), JSON.parse(raw));
});

test("automation run pages preserve UNKNOWN and empty page", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/automation-run-pages.sample.json", import.meta.url), "utf8");
  const original: unknown = JSON.parse(raw);
  const typed: AutomationRunPage[] = JSON.parse(raw);
  const reconstructed: AutomationRunPage[] = typed.map(page => ({
    automationResourceId: page.automationResourceId,
    runs: page.runs.map(run => ({
      task: run.task,
      progress: run.progress,
      usageEventIds: run.usageEventIds,
    })),
    nextCursor: page.nextCursor,
  }));
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), original);
});

import type { Canary, CapabilityConformanceVectors, WebPublishMessageRequest } from "../src/generated/contracts.js";

const samplePath = fileURLToPath(
  new URL("../../../../contracts/samples/canary.sample.json", import.meta.url),
);

test("capability vectors round-trip preserves steps and encoded values", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/capability-conformance-vectors.sample.json", import.meta.url), "utf8");
  const original: unknown = JSON.parse(raw);
  const typed: CapabilityConformanceVectors = JSON.parse(raw);
  deepStrictEqual(JSON.parse(JSON.stringify(typed)), original);
  // Explicit construction makes deletion/type drift of a nested field a compile
  // error; a JSON cast alone would not verify the generated TypeScript contract.
  const reconstructed: CapabilityConformanceVectors = {
    formatVersion: typed.formatVersion,
    cases: typed.cases.map(item => ({
      caseKey: item.caseKey,
      steps: item.steps.map(step => ({
        stepKey: step.stepKey, contractKey: step.contractKey,
        inputJson: step.inputJson, expectedOutputJson: step.expectedOutputJson,
      })),
    })),
  };
  deepStrictEqual(reconstructed, original);
});

test("canary round-trip 保留每个字段", () => {
  const raw = readFileSync(samplePath, "utf8");
  const original: unknown = JSON.parse(raw);

  const typed = JSON.parse(raw) as Canary;
  const back: unknown = JSON.parse(JSON.stringify(typed));

  deepStrictEqual(back, original, "round-trip 后与样例不等");

  // 生成接口必须覆盖样例的顶层键；缺任一个说明 schema 与生成物脱节
  const src = readFileSync(
    fileURLToPath(new URL("../src/generated/contracts.ts", import.meta.url)),
    "utf8",
  );
  const iface = src.slice(src.indexOf("export interface Canary"));
  for (const key of Object.keys(original as Record<string, unknown>)) {
    ok(iface.includes(key), `生成的 Canary 接口缺少字段 ${key}`);
  }
});

for (const sample of ["web-publish-mention.sample.json", "web-publish-content-only.sample.json"]) {
  test(`WebPublishMessageRequest round-trip ${sample}`, () => {
    const raw = readFileSync(new URL(`../../../../contracts/samples/${sample}`, import.meta.url), "utf8");
    const original: unknown = JSON.parse(raw);
    const typed = JSON.parse(raw) as WebPublishMessageRequest;
    deepStrictEqual(JSON.parse(JSON.stringify(typed)), original);
    const src = readFileSync(new URL("../src/generated/contracts.ts", import.meta.url), "utf8");
    const iface = src.match(/export interface WebPublishMessageRequest \{([^}]+)\}/s)?.[1] ?? "";
    for (const key of Object.keys(typed)) ok(iface.includes(key), `request field ${key}`);
    const attachment = src.match(/export interface WebMessageAttachment \{([^}]+)\}/s)?.[1] ?? "";
    for (const item of typed.attachments ?? []) {
      for (const key of Object.keys(item)) ok(attachment.includes(key), `attachment field ${key}`);
    }
  });
}
