// 四侧 round-trip 的 TypeScript 一侧（ADR-03）。
//
// 反序列化再序列化必须与样例语义相等。TypeScript 的类型在运行时被擦除，
// 因此这里额外断言样例的每个键都出现在生成接口的键集合里——否则「类型
// 对得上」会退化成「JSON 原样进出」这种无效验证。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deepStrictEqual, ok } from "node:assert/strict";
import test from "node:test";
import type { DelegatedActionMetadataV1 } from "../src/generated/contracts.js";
import type { DiscoverableWorkspacePage } from "../src/generated/contracts.js";
import type { WorkspaceView } from "../src/generated/contracts.js";

test("workspace membership keeps true, false and absent distinct", () => {
  for (const isMember of [undefined, false, true]) {
    const original: WorkspaceView = { id: "scope", name: "Scope", slug: "scope", ...(isMember === undefined ? {} : { isMember }) };
    const back: WorkspaceView = { id: original.id, name: original.name, slug: original.slug, isMember: original.isMember };
    deepStrictEqual(JSON.parse(JSON.stringify(back)), original);
  }
});

test("public discovery keeps product visibility separate from signed channel metadata", () => {
  const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../../contracts/samples/${name}`, import.meta.url), "utf8"));
  for (const name of ["workspace-public-create.sample.json", "workspace-join.sample.json"]) {
    const original: ActionCommand = load(name);
    const back: ActionCommand = { actionKey: original.actionKey, idempotencyKey: original.idempotencyKey,
      name: original.name, slug: original.slug, workspaceId: original.workspaceId,
      workspaceVisibility: original.workspaceVisibility, workspaceChannel: original.workspaceChannel };
    deepStrictEqual(JSON.parse(JSON.stringify(back)), original);
  }
  const original: DiscoverableWorkspacePage = load("discoverable-workspaces.sample.json");
  const back: DiscoverableWorkspacePage = { nextCursor: original.nextCursor, items: original.items.map(row => ({
    id: row.id, visibility: row.visibility, isMember: row.isMember, memberCount: row.memberCount,
    createdAt: row.createdAt, membershipState: row.membershipState, joinActionKey: row.joinActionKey,
    channel: { channelId: row.channel.channelId, channelType: row.channel.channelType,
      name: row.channel.name, archived: row.channel.archived },
  })) };
  deepStrictEqual(JSON.parse(JSON.stringify(back)), original);
});

test("delegated metadata preserves only platform result", () => {
  const original: DelegatedActionMetadataV1 = JSON.parse(readFileSync(new URL("../../../../contracts/samples/delegated-action-metadata.sample.json", import.meta.url), "utf8"));
  const back: DelegatedActionMetadataV1 = { operationId: original.operationId, actionExecutionId: original.actionExecutionId,
    actionKey: original.actionKey, gateState: original.gateState, dispatchState: original.dispatchState, workflowId: original.workflowId };
  deepStrictEqual(JSON.parse(JSON.stringify(back)), original);
});

test("workspace creation preserves native channel kind and description", () => {
  const original: ActionCommand = JSON.parse(readFileSync(new URL("../../../../contracts/samples/workspace-channel-create.sample.json", import.meta.url), "utf8"));
  ok(original.workspaceChannel);
  const reconstructed: ActionCommand = { actionKey: original.actionKey, idempotencyKey: original.idempotencyKey,
    name: original.name, slug: original.slug, workspaceChannel: {
      channelType: original.workspaceChannel.channelType, description: original.workspaceChannel.description, ttlSeconds: original.workspaceChannel.ttlSeconds,
    } };
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), original);
});
import type { ConversationParticipantPage, ConversationPage, ConversationProjectionRequest, ConversationPreferenceRequest } from "../src/generated/contracts.js";

test("conversation references keep real keys, native scope and frozen workflow", () => {
  const load=(name:string)=>JSON.parse(readFileSync(new URL(`../../../../contracts/samples/${name}`,import.meta.url),"utf8"));
  const command:ActionCommand=load("conversation-open.sample.json");
  const preference:ConversationPreferenceRequest=load("conversation-preference.sample.json");
  const updatedPreference:ConversationPreferenceRequest={starred:preference.starred,muted:preference.muted,version:preference.version};
  deepStrictEqual(JSON.parse(JSON.stringify(updatedPreference)),preference);
  ok(command.conversationOpen);
  const reconstructed:ActionCommand={actionKey:command.actionKey,idempotencyKey:command.idempotencyKey,
    conversationOpen:{participantPrincipalIds:command.conversationOpen.participantPrincipalIds}};
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)),command);
  const directory:ConversationParticipantPage=load("conversation-participants.sample.json");
  const participantPage:ConversationParticipantPage={items:directory.items.map(row=>({principalId:row.principalId,displayName:row.displayName,pubkeys:row.pubkeys})),maxParticipants:directory.maxParticipants,nextCursor:directory.nextCursor};
  deepStrictEqual(JSON.parse(JSON.stringify(participantPage)),directory);
  const original:ConversationPage=load("conversation-page.sample.json");
  const page:ConversationPage={items:original.items.map(row=>({id:row.id,channelId:row.channelId,participantPrincipalIds:row.participantPrincipalIds,state:row.state,version:row.version,operationId:row.operationId})),nextCursor:original.nextCursor};
  deepStrictEqual(JSON.parse(JSON.stringify(page)),original);
  const request:ConversationProjectionRequest=load("conversation-projection.sample.json");
  const projected:ConversationProjectionRequest={target:{actionExecutionId:request.target.actionExecutionId,conversationId:request.target.conversationId,workflowId:request.target.workflowId},runId:request.runId};
  deepStrictEqual(JSON.parse(JSON.stringify(projected)),request);
});
import type { AutomationRunPage, AutomationDetailView } from "../src/generated/contracts.js";
import type { AutomationVersionContent } from "../src/generated/contracts.js";
import type { ComponentConformanceStepObservation } from "../src/generated/contracts.js";
import type { ComponentReleaseApprovalReport } from "../src/generated/contracts.js";
import type { ApplicationNativePage } from "../src/generated/contracts.js";
import type { AdapterBindingObservation, AdapterExecutionReference } from "../src/generated/contracts.js";
import type { ApplicationAdapterDirectory } from "../src/generated/contracts.js";
import type { ApplicationModelAdmission, ApplicationModelGatewayConfig } from "../src/generated/contracts.js";

test("application model preserves exact route references and absent correlation", () => {
  const raw=readFileSync(new URL("../../../../contracts/samples/application-model-admission.sample.json",import.meta.url),"utf8");
  const typed:ApplicationModelAdmission=JSON.parse(raw);
  const back:ApplicationModelAdmission={
    bindingId:typed.bindingId,gatewayPrincipalId:typed.gatewayPrincipalId,generation:typed.generation,
    method:typed.method,path:typed.path,traceparent:typed.traceparent,
  };
  deepStrictEqual(JSON.parse(JSON.stringify(back)),JSON.parse(raw));
  const config=readFileSync(new URL("../../../../contracts/samples/application-model-config.sample.json",import.meta.url),"utf8");
  const parsed:ApplicationModelGatewayConfig=JSON.parse(config);
  const encoded:ApplicationModelGatewayConfig={routeResourceIds:parsed.routeResourceIds,meterKeys:parsed.meterKeys};
  deepStrictEqual(JSON.parse(JSON.stringify(encoded)),JSON.parse(config));
});

test("native credential delivery preserves exact binding, generation and references", () => {
  for (const sample of ["application-peer-credentials.sample.json", "application-model-delivery.sample.json"]) {
  const raw = readFileSync(new URL(`../../../../contracts/samples/${sample}`, import.meta.url), "utf8");
  const typed: ApplicationAdapterDirectory = JSON.parse(raw);
  const reconstructed: ApplicationAdapterDirectory = {
    adapters: typed.adapters,
    protocolPeers: typed.protocolPeers?.map(peer => ({
      adapterServiceRef: peer.adapterServiceRef, mcpUrl: peer.mcpUrl,
      nativeInstanceRef: peer.nativeInstanceRef, artifactDigest: peer.artifactDigest,
      timeoutSeconds: peer.timeoutSeconds, maxResponseBytes: peer.maxResponseBytes,
      secretReaders: peer.secretReaders?.map(reader => ({servicePrincipalId: reader.servicePrincipalId,
        audience: reader.audience, roleName: reader.roleName})),
      modelCredentialDeliveries: peer.modelCredentialDeliveries?.map(receipt => ({
        bindingId: receipt.bindingId, generation: receipt.generation, configDigest: receipt.configDigest,
        servicePrincipalId: receipt.servicePrincipalId, routeResourceId: receipt.routeResourceId,
        nativeScopeRef: receipt.nativeScopeRef, nativeModelRef: receipt.nativeModelRef,
        secretRef: {locator: receipt.secretRef.locator, version: receipt.secretRef.version, audience: receipt.secretRef.audience},
        requestId: receipt.requestId, verificationNonce: receipt.verificationNonce, nativeProof: receipt.nativeProof,
      })),
      bindings: peer.bindings.map(binding => ({
        bindingId: binding.bindingId, tenantId: binding.tenantId, workspaceId: binding.workspaceId,
        servicePrincipalId: binding.servicePrincipalId, nativeScopeRef: binding.nativeScopeRef,
        configDigest: binding.configDigest, isolationMode: binding.isolationMode,
        credentialGeneration: binding.credentialGeneration,
        nativeCredentials: binding.nativeCredentials?.map(credential => ({
          secretKey: credential.secretKey, locator: credential.locator, version: credential.version,
          audience: credential.audience, header: credential.header, prefix: credential.prefix,
        })),
      })),
    })),
  };
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), JSON.parse(raw));
  }
});
import type { ActionCommand, ResourceProvisionAdvanceRequest } from "../src/generated/contracts.js";

test("resource reference keeps evidence and original workflow without inventing scope",()=>{
  const raw=readFileSync(new URL("../../../../contracts/samples/resource-create.sample.json",import.meta.url),"utf8");
  const typed:ActionCommand=JSON.parse(raw);
  ok(typed.resourceCreate);
  const command:ActionCommand={actionKey:typed.actionKey,idempotencyKey:typed.idempotencyKey,workspaceId:typed.workspaceId,
    resourceCreate:{typeKey:typed.resourceCreate.typeKey,nativeType:typed.resourceCreate.nativeType,nativeRef:typed.resourceCreate.nativeRef,
      evidenceRef:typed.resourceCreate.evidenceRef,evidenceDigest:typed.resourceCreate.evidenceDigest}};
  deepStrictEqual(JSON.parse(JSON.stringify(command)),JSON.parse(raw));
  const advanceRaw=readFileSync(new URL("../../../../contracts/samples/resource-provision.sample.json",import.meta.url),"utf8");
  const advance:ResourceProvisionAdvanceRequest=JSON.parse(advanceRaw);
  const reconstructed:ResourceProvisionAdvanceRequest={cancelRequested:advance.cancelRequested,runId:advance.runId,
    target:{actionExecutionId:advance.target.actionExecutionId,resourceId:advance.target.resourceId,workflowId:advance.target.workflowId,
      resourceVersion:advance.target.resourceVersion,bindingId:advance.target.bindingId,bindingVersion:advance.target.bindingVersion,
      componentReleaseId:advance.target.componentReleaseId,projectionGeneration:advance.target.projectionGeneration,
      nativeInstanceRef:advance.target.nativeInstanceRef,nativeScopeRef:advance.target.nativeScopeRef,
      reference:{typeKey:advance.target.reference.typeKey,nativeType:advance.target.reference.nativeType,nativeRef:advance.target.reference.nativeRef,
        evidenceRef:advance.target.reference.evidenceRef,evidenceDigest:advance.target.reference.evidenceDigest}}};
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)),JSON.parse(advanceRaw));
});

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
      stepApprovalTask: run.stepApprovalTask,
      progress: run.progress,
      usageEventIds: run.usageEventIds,
    })),
    nextCursor: page.nextCursor,
  }));
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), original);
});

test("manual capability and deleted definition preserve optional compatibility", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/automation-manual-delete.sample.json", import.meta.url), "utf8");
  const typed: AutomationDetailView[] = JSON.parse(raw);
  const reconstructed: AutomationDetailView[] = typed.map(detail => ({ automation: detail.automation,
    versions: detail.versions, delegations: detail.delegations, canManage: detail.canManage, canRun: detail.canRun }));
  ok(typed[0]!.canRun === undefined && typed[1]!.canRun === true && typed[2]!.automation.state === "DELETED");
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), JSON.parse(raw));
});

import type { Canary, CapabilityConformanceVectors, WebPublishMessageRequest, WebMessageQuery, WebMessageCursor, WebChannelView } from "../src/generated/contracts.js";

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

for (const sample of ["web-publish-mention.sample.json", "web-publish-content-only.sample.json", "web-forum-post.sample.json", "web-forum-comment.sample.json", "web-message-edit.sample.json"]) {
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

test("forum query, cursor and native channel preserve each generated field and legacy absence", () => {
  const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../../contracts/samples/${name}`, import.meta.url), "utf8"));
  for (const name of ["web-forum-query.sample.json", "web-message-query-legacy.sample.json"]) {
    const query: WebMessageQuery = load(name);
    const back: WebMessageQuery = { messageType: query.messageType, parentEventId: query.parentEventId, before: query.before, beforeId: query.beforeId };
    deepStrictEqual(JSON.parse(JSON.stringify(back)), query);
  }
  const cursor: WebMessageCursor = load("web-message-cursor.sample.json");
  const backCursor: WebMessageCursor = { createdAt: cursor.createdAt, eventId: cursor.eventId };
  deepStrictEqual(JSON.parse(JSON.stringify(backCursor)), cursor);
  const channel: WebChannelView = load("web-forum-channel.sample.json");
  const backChannel: WebChannelView = { channelId: channel.channelId, channelType: channel.channelType, name: channel.name, description: channel.description, archived: channel.archived, ttlSeconds: channel.ttlSeconds, ttlDeadline: channel.ttlDeadline };
  deepStrictEqual(JSON.parse(JSON.stringify(backChannel)), channel);
  const query: WebMessageQuery = load("web-forum-query.sample.json");
  deepStrictEqual([query.before, query.beforeId], [cursor.createdAt, cursor.eventId]);
});
