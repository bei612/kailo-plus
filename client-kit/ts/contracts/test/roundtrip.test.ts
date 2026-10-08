// 四侧 round-trip 的 TypeScript 一侧（ADR-03）。
//
// 反序列化再序列化必须与样例语义相等。TypeScript 的类型在运行时被擦除，
// 因此这里额外断言样例的每个键都出现在生成接口的键集合里——否则「类型
// 对得上」会退化成「JSON 原样进出」这种无效验证。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deepStrictEqual, ok } from "node:assert/strict";
import test from "node:test";

test("native source resources preserve complete metadata and legacy absence", () => {
  const sample: {
    pep: import("../src/generated/contracts.js").AdapterPepCheckRequest;
    response: import("../src/generated/contracts.js").AdapterExecutionResponse;
    human: import("../src/generated/contracts.js").NativeHumanActionRequest;
  } = JSON.parse(readFileSync(new URL("../../../../contracts/samples/adapter-source-resources.sample.json", import.meta.url), "utf8"));
  for (const present of [true, false]) {
    const value = structuredClone(sample);
    if (!present) { delete value.pep.sourceResources; delete value.response.sourceResources; delete value.human.sourceResources; }
    const sources = (rows: typeof value.pep.sourceResources) => rows?.map(row => ({nativeType:row.nativeType,nativeRef:row.nativeRef}));
    const pep: typeof value.pep = {bindingId:value.pep.bindingId,actionToken:value.pep.actionToken,operation:value.pep.operation,
      argumentsJson:value.pep.argumentsJson,sourceResources:sources(value.pep.sourceResources)};
    const response: typeof value.response = {execution:value.response.execution,sourceResources:sources(value.response.sourceResources)};
    const human: typeof value.human = {bindingId:value.human.bindingId,idempotencyKey:value.human.idempotencyKey,
      sourceResources:sources(value.human.sourceResources)};
    deepStrictEqual(JSON.parse(JSON.stringify({pep,response,human})),value);
  }
});

test("Project preference preserves original coordinate and shared CAS", () => {
  const sample: import("../src/generated/contracts.js").ProjectPreferenceRequest[] = JSON.parse(readFileSync(new URL("../../../../contracts/samples/project-preference.sample.json",import.meta.url),"utf8"));
  const actual: typeof sample = sample.map(row=>({projectAddress:row.projectAddress,selected:row.selected,version:row.version}));
  deepStrictEqual(JSON.parse(JSON.stringify(actual)),sample);
});

test("Projects publication preserves native metadata and exact head reference", () => {
  const sample: import("../src/generated/contracts.js").ProjectsPublishRequest[] = JSON.parse(readFileSync(new URL("../../../../contracts/samples/projects-publication.sample.json",import.meta.url),"utf8"));
  const actual: typeof sample = sample.map(row=>({operation:row.operation,targetEventId:row.targetEventId,workspaceId:row.workspaceId,name:row.name,description:row.description,visibility:row.visibility}));
  deepStrictEqual(JSON.parse(JSON.stringify(actual)),sample);
});


test("Inbox Agent identity and author query preserve legacy absence", () => {
  const sample: {query: import("../src/generated/contracts.js").WebMessageQuery; installation: import("../src/generated/contracts.js").AgentInstallationView} = JSON.parse(readFileSync(new URL("../../../../contracts/samples/inbox-agent.sample.json",import.meta.url),"utf8"));
  for (const present of [true,false]) {
    const value=structuredClone(sample);
    if (!present) {delete value.query.agentInstallationId;delete value.installation.agentPubkey;}
    const query:typeof value.query={agentInstallationId:value.query.agentInstallationId};
    const row=value.installation;
    const installation:typeof row={resourceId:row.resourceId,workspaceId:row.workspaceId,agentResourceId:row.agentResourceId,pinnedVersionAssetId:row.pinnedVersionAssetId,agentPrincipalId:row.agentPrincipalId,ownerPrincipalId:row.ownerPrincipalId,agentPrincipalState:row.agentPrincipalState,resourceVersion:row.resourceVersion,resourceState:row.resourceState,state:row.state,agentPubkey:row.agentPubkey};
    deepStrictEqual(JSON.parse(JSON.stringify({query,installation})),value);
  }
});


test("custom emoji preserves explicit removal and signed set view", () => {
  const sample = JSON.parse(readFileSync(new URL("../../../../contracts/samples/web-custom-emoji.sample.json", import.meta.url), "utf8"));
  for (const key of ["add", "remove"]) {
    const value: import("../src/generated/contracts.js").WebCustomEmojiMutation = sample[key];
    const typed: typeof value = { idempotencyKey: value.idempotencyKey, expectedPubkey: value.expectedPubkey, shortcode: value.shortcode, imageUrl: value.imageUrl };
    deepStrictEqual(JSON.parse(JSON.stringify(typed)), value);
  }
  const value: import("../src/generated/contracts.js").WebCustomEmojiView = sample.view;
  const typed: typeof value = { pubkey: value.pubkey, events: value.events, mediaPaths: value.mediaPaths };
  deepStrictEqual(JSON.parse(JSON.stringify(typed)), value);
});

test("AgentVersionView preserves exact avatar map and legacy absence", () => {
  const sample: import("../src/generated/contracts.js").AgentVersionView = JSON.parse(readFileSync(
    new URL("../../../../contracts/samples/agent-version-view.sample.json", import.meta.url), "utf8"));
  for (const include of [true, false]) {
    if (!include) delete sample.avatarMediaPaths;
    const back: typeof sample = {
      assetId:sample.assetId, agentResourceId:sample.agentResourceId, ordinal:sample.ordinal,
      assetVersion:sample.assetVersion, ownerPrincipalId:sample.ownerPrincipalId, content:sample.content,
      avatarMediaPaths:sample.avatarMediaPaths, configHash:sample.configHash, state:sample.state,
    };
    deepStrictEqual(JSON.parse(JSON.stringify(back)), sample);
  }
});

test("native human action preserves controlled trust and nonterminal references", () => {
  const sample: {
    trust: import("../src/generated/contracts.js").ApplicationNativeHumanIdentity;
    request: import("../src/generated/contracts.js").NativeHumanActionRequest;
    result: import("../src/generated/contracts.js").NativeHumanActionResult;
    resourceRequest: import("../src/generated/contracts.js").NativeHumanActionRequest;
    resourceResult: import("../src/generated/contracts.js").NativeHumanResourceResult;
  } = JSON.parse(readFileSync(new URL("../../../../contracts/samples/native-human-action.sample.json", import.meta.url), "utf8"));
  const t=sample.trust, r=sample.request, o=sample.result;
  const trust: typeof t = {bindingId:t.bindingId,configDigest:t.configDigest,generation:t.generation,
    identityProviderId:t.identityProviderId,audience:t.audience,jwksFile:t.jwksFile,accessClaim:t.accessClaim,accessValue:t.accessValue};
  const request: typeof r = {bindingId:r.bindingId,idempotencyKey:r.idempotencyKey,command:r.command};
  const result: typeof o = {submission:o.submission,inputReference:o.inputReference,terminalStatus:o.terminalStatus,nativeType:o.nativeType,nativeId:o.nativeId};
  const q=sample.resourceRequest.resolveResource!;
  const resourceRequest:typeof sample.resourceRequest={bindingId:sample.resourceRequest.bindingId,
    resolveResource:{workspaceId:q.workspaceId,actionKey:q.actionKey,actionVersion:q.actionVersion,nativeType:q.nativeType,nativeRef:q.nativeRef}};
  const s=sample.resourceResult.resource;
  const resourceResult:typeof sample.resourceResult={resource:{resourceId:s.resourceId,resourceVersion:s.resourceVersion,
    nativeType:s.nativeType,nativeRef:s.nativeRef,nativeInstanceRef:s.nativeInstanceRef,nativeScopeRef:s.nativeScopeRef}};
  deepStrictEqual(JSON.parse(JSON.stringify({trust,request,result,resourceRequest,resourceResult})),sample);
});

test("automation topic step preserves explicit empty topic", () => {
  const sample: import("../src/generated/contracts.js").AutomationStep = JSON.parse(readFileSync(new URL(
    "../../../../contracts/samples/automation-topic-step.sample.json", import.meta.url), "utf8"));
  const actual: import("../src/generated/contracts.js").AutomationStep = {id:sample.id,action:sample.action,topic:sample.topic};
  deepStrictEqual(JSON.parse(JSON.stringify(actual)), sample);
});

test("read receipts preserve native precision roles and quantities", () => {
  const sample: import("../src/generated/contracts.js").AdapterReadReceipt[] = JSON.parse(readFileSync(new URL(
    "../../../../contracts/samples/adapter-read-receipts.sample.json", import.meta.url), "utf8"));
  const actual: import("../src/generated/contracts.js").AdapterReadReceipt[] = sample.map(value => ({
    bindingId:value.bindingId,operationId:value.operationId,role:value.role,idempotencyKey:value.idempotencyKey,
    nativeObjectRef:value.nativeObjectRef,nativeRevision:value.nativeRevision,contentSha256:value.contentSha256,
    contentBytes:value.contentBytes,completedAt:value.completedAt,measurements:value.measurements.map(item=>({meterKey:item.meterKey,quantity:item.quantity})),
  }));
  deepStrictEqual(JSON.parse(JSON.stringify(actual)),sample);
});

test("automation reaction step preserves original emoji", () => {
  const sample: import("../src/generated/contracts.js").AutomationStep = JSON.parse(readFileSync(new URL(
    "../../../../contracts/samples/automation-reaction-step.sample.json", import.meta.url), "utf8"));
  const actual: import("../src/generated/contracts.js").AutomationStep = {id:sample.id,action:sample.action,emoji:sample.emoji};
  deepStrictEqual(JSON.parse(JSON.stringify(actual)), sample);
});
import type { ApplicationReadResourcePage, ApplicationBindingView } from "../src/generated/contracts.js";

test("application read resources preserve metadata and legacy entry absence", () => {
  const sample: {page:ApplicationReadResourcePage; binding:ApplicationBindingView} = JSON.parse(readFileSync(new URL(
    "../../../../contracts/samples/application-read-resources.sample.json",import.meta.url),"utf8"));
  const p=sample.page;
  const page:ApplicationReadResourcePage={bindingId:p.bindingId,bindingVersion:p.bindingVersion,tenantId:p.tenantId,
    servicePrincipalId:p.servicePrincipalId,workspaceId:p.workspaceId,direction:p.direction,nextOffset:p.nextOffset,
    resources:p.resources.map(r=>({resourceId:r.resourceId,version:r.version,bindingId:r.bindingId,typeKey:r.typeKey,
      nativeRef:r.nativeRef,workspaceId:r.workspaceId}))};
  deepStrictEqual(JSON.parse(JSON.stringify(page)),sample.page);
  for(const available of [true,false,undefined]) {
    const binding:ApplicationBindingView={...sample.binding,hasReadReceiver:available};
    deepStrictEqual(JSON.parse(JSON.stringify(binding)).hasReadReceiver,available);
  }
});
import type { ActionCommand as ServiceReadPermissionCommand } from "../src/generated/contracts.js";

test("service read permission preserves receiver and legacy absence", () => {
  const sample: ServiceReadPermissionCommand = JSON.parse(readFileSync(new URL(
    "../../../../contracts/samples/resource-service-read-permission.sample.json", import.meta.url), "utf8"));
  for (const service of [true, false]) {
    const value = {...sample};
    if (!service) delete value.receiverResource;
    const back: ServiceReadPermissionCommand = {
      actionKey:value.actionKey, idempotencyKey:value.idempotencyKey,
      resourceId:value.resourceId, resourceVersion:value.resourceVersion, principalId:value.principalId,
      receiverResource:value.receiverResource && {id:value.receiverResource.id,version:value.receiverResource.version},
    };
    deepStrictEqual(JSON.parse(JSON.stringify(back)), value);
  }
});
import type { AutomationStep, AutomationApprovalStepView } from "../src/generated/contracts.js";

test("automation approval step preserves policy and immutable view reference", () => {
  const sample: {step: AutomationStep; view: AutomationApprovalStepView} = JSON.parse(readFileSync(
    new URL("../../../../contracts/samples/automation-approval-step.sample.json", import.meta.url), "utf8"));
  const step: AutomationStep = {id:sample.step.id, name:sample.step.name, action:sample.step.action,
    approvalPolicy:sample.step.approvalPolicy, message:sample.step.message};
  const view: AutomationApprovalStepView = {id:sample.view.id,name:sample.view.name,
    versionAssetId:sample.view.versionAssetId,message:sample.view.message};
  deepStrictEqual(JSON.parse(JSON.stringify({step,view})),sample);
});
import type { AdapterReadGrantRequest, AdapterReadGrantResponse } from "../src/generated/contracts.js";

test("native sync grant preserves own admission and read-only terminal outcomes", () => {
  const request: AdapterReadGrantRequest = JSON.parse(readFileSync(new URL("../../../../contracts/samples/adapter-native-read-grant-request.sample.json",import.meta.url),"utf8"));
  const native=request.nativeBatch!;
  const back: AdapterReadGrantRequest={receiverBindingId:request.receiverBindingId,sourceResourceId:request.sourceResourceId,
    actionKey:request.actionKey,actionVersion:request.actionVersion,idempotencyKey:request.idempotencyKey,inputJson:request.inputJson,
    nativeBatch:{receiverResourceId:native.receiverResourceId,importConfigRef:native.importConfigRef,batchId:native.batchId,
      actionKey:native.actionKey,actionVersion:native.actionVersion}};
  deepStrictEqual(JSON.parse(JSON.stringify(back)),request);
  const responses: AdapterReadGrantResponse[]=JSON.parse(readFileSync(new URL("../../../../contracts/samples/adapter-native-read-grant-responses.sample.json",import.meta.url),"utf8"));
  const actual: AdapterReadGrantResponse[]=responses.map(r=>({actionExecutionId:r.actionExecutionId,operationId:r.operationId,
    sourceBindingId:r.sourceBindingId,endpoint:r.endpoint,actionToken:r.actionToken,expiresAt:r.expiresAt,argumentsJson:r.argumentsJson,
    outcome:r.outcome,receiverReceipt:r.receiverReceipt,receiverWrite:r.receiverWrite&&{
      actionExecutionId:r.receiverWrite.actionExecutionId,actionToken:r.receiverWrite.actionToken,
      expiresAt:r.receiverWrite.expiresAt,argumentsJson:r.receiverWrite.argumentsJson}}));
  deepStrictEqual(JSON.parse(JSON.stringify(actual)),responses);
  const listing: import("../src/generated/contracts.js").FileStorageListOutput=JSON.parse(readFileSync(new URL("../../../../contracts/samples/file-storage-list-output.sample.json",import.meta.url),"utf8"));
  const listed: import("../src/generated/contracts.js").FileStorageListOutput={resourceId:listing.resourceId,nativeObjectRef:listing.nativeObjectRef,
    nativeRevision:listing.nativeRevision,listingDigest:listing.listingDigest,operationId:listing.operationId,items:listing.items};
  deepStrictEqual(JSON.parse(JSON.stringify(listed)),listing);
});

test("receiver read grant preserves distinct source and receiver provenance", () => {
  const request: AdapterReadGrantRequest = JSON.parse(readFileSync(new URL("../../../../contracts/samples/adapter-read-grant-request.sample.json", import.meta.url), "utf8"));
  const back: AdapterReadGrantRequest = {receiverBindingId:request.receiverBindingId,receiverActionExecutionId:request.receiverActionExecutionId,
    receiverArgumentsJson:request.receiverArgumentsJson,sourceResourceId:request.sourceResourceId,actionKey:request.actionKey,
    actionVersion:request.actionVersion,idempotencyKey:request.idempotencyKey,inputJson:request.inputJson};
  deepStrictEqual(JSON.parse(JSON.stringify(back)),request);
  const response: AdapterReadGrantResponse = JSON.parse(readFileSync(new URL("../../../../contracts/samples/adapter-read-grant-response.sample.json", import.meta.url), "utf8"));
  const reply: AdapterReadGrantResponse = {actionExecutionId:response.actionExecutionId,operationId:response.operationId,
    sourceBindingId:response.sourceBindingId,endpoint:response.endpoint,actionToken:response.actionToken,
    expiresAt:response.expiresAt,argumentsJson:response.argumentsJson};
  deepStrictEqual(JSON.parse(JSON.stringify(reply)),response);
});
import type { ComponentConformanceIdentity } from "../src/generated/contracts.js";

test("conformance identity preserves isolated authorization and execution", () => {
  const sample: ComponentConformanceIdentity = JSON.parse(readFileSync(new URL("../../../../contracts/samples/component-conformance-identity.sample.json",import.meta.url),"utf8"));
  const back: ComponentConformanceIdentity = {...sample,contexts:sample.contexts.map(c=>({
    caseKey:c.caseKey,stepKey:c.stepKey,operation:c.operation,tenantId:c.tenantId,
    actorPrincipalId:c.actorPrincipalId,authorizationMinZedToken:c.authorizationMinZedToken,
    externalExecutionId:c.externalExecutionId,actionKey:c.actionKey,actionDefinitionVersion:c.actionDefinitionVersion,
    targetType:c.targetType,targetId:c.targetId,resultExposurePolicyId:c.resultExposurePolicyId,
    resultExposurePolicyVersion:c.resultExposurePolicyVersion,
  }))};
  deepStrictEqual(JSON.parse(JSON.stringify(back)),sample);
});
import type { RoleMemberPage } from "../src/generated/contracts.js";

test("member removal permissions preserve true false and legacy absence", () => {
  const sample: RoleMemberPage = JSON.parse(readFileSync(new URL("../../../../contracts/samples/member-action-availability.sample.json", import.meta.url), "utf8"));
  for (const permission of [true, false, undefined]) {
    const value: RoleMemberPage = {members:sample.members.map(row=>({...row,canRemoveFromWorkspace:permission,canRemoveFromTenant:permission}))};
    const back: RoleMemberPage = {members:value.members.map(row=>({principalId:row.principalId,displayName:row.displayName,
      tenantAdmin:row.tenantAdmin,workspaceAdmin:row.workspaceAdmin,canGrantTenantAdmin:row.canGrantTenantAdmin,
      canRevokeTenantAdmin:row.canRevokeTenantAdmin,canGrantWorkspaceAdmin:row.canGrantWorkspaceAdmin,
      canRevokeWorkspaceAdmin:row.canRevokeWorkspaceAdmin,lastTenantAdmin:row.lastTenantAdmin,
      canRemoveFromWorkspace:row.canRemoveFromWorkspace,canRemoveFromTenant:row.canRemoveFromTenant}))};
    deepStrictEqual(JSON.parse(JSON.stringify(back)),JSON.parse(JSON.stringify(value)));
  }
});
import type { AgentInstallationView } from "../src/generated/contracts.js";

test("Installation upgrade permission keeps false and legacy absence", () => {
  const sample: AgentInstallationView = JSON.parse(readFileSync(new URL("../../../../contracts/samples/agent-installation-upgrade.sample.json", import.meta.url), "utf8"));
  for (const canUpgrade of [true,false,undefined]) {
    const value = {...sample,canUpgrade};
    const back:AgentInstallationView={resourceId:value.resourceId,workspaceId:value.workspaceId,
      agentResourceId:value.agentResourceId,pinnedVersionAssetId:value.pinnedVersionAssetId,
      agentPrincipalId:value.agentPrincipalId,ownerPrincipalId:value.ownerPrincipalId,
      agentPrincipalState:value.agentPrincipalState,resourceVersion:value.resourceVersion,
      resourceState:value.resourceState,state:value.state,canUpgrade:value.canUpgrade};
    deepStrictEqual(JSON.parse(JSON.stringify(back)),JSON.parse(JSON.stringify(value)));
  }
});
import type { ProjectsQueryRequest } from "../src/generated/contracts.js";

test("Projects query preserves scoped coordinates and absent optional window", () => {
  const sample: ProjectsQueryRequest = JSON.parse(readFileSync(new URL("../../../../contracts/samples/projects-query.sample.json", import.meta.url), "utf8"));
  for (const value of [sample, {view:"PROJECTS"} as ProjectsQueryRequest]) {
    const back:ProjectsQueryRequest={view:value.view,coordinates:value.coordinates,since:value.since,until:value.until};
    deepStrictEqual(JSON.parse(JSON.stringify(back)),value);
  }
});
import type { CapabilityContractPage } from "../src/generated/contracts.js";

test("seed and human contract registration preserve separate evidence", () => {
  const value: CapabilityContractPage = JSON.parse(readFileSync(new URL("../../../../contracts/samples/capability-seed-page.sample.json", import.meta.url), "utf8"));
  for (const seeded of [true, false]) {
    const row = value.contracts[0]!;
    if (!seeded) {
      row.registeredByActionExecutionId = row.bootstrapActionExecutionId;
      delete row.bootstrapActionExecutionId;
    }
    const back: CapabilityContractPage = { canRegister: value.canRegister,
      contracts: value.contracts.map(c => ({ categoryKey: c.categoryKey, contractVersion: c.contractVersion,
        status: c.status, schemaSetDigest: c.schemaSetDigest, conformanceSuiteDigest: c.conformanceSuiteDigest,
        bootstrapActionExecutionId: c.bootstrapActionExecutionId, registeredByActionExecutionId: c.registeredByActionExecutionId,
        canApprove: c.canApprove, canDeprecate: c.canDeprecate })) };
    deepStrictEqual(JSON.parse(JSON.stringify(back)), value);
  }
});
import type { ComponentProtocolPeerEnvironment } from "../src/generated/contracts.js";

test("component conformance keeps native secret references and legacy absence", () => {
  const original: ComponentProtocolPeerEnvironment = JSON.parse(readFileSync(new URL("../../../../contracts/samples/component-peer-conformance.sample.json", import.meta.url), "utf8"));
  for (const include of [true, false]) {
    if (!include) delete original.nativeCredentials;
    const reconstructed: ComponentProtocolPeerEnvironment = {
      artifactDigest: original.artifactDigest, mcpUrl: original.mcpUrl,
      timeoutSeconds: original.timeoutSeconds, maxResponseBytes: original.maxResponseBytes,
      maxSteps: original.maxSteps, readOnlyTools: original.readOnlyTools,
      initializeResultJson: original.initializeResultJson, listResultJson: original.listResultJson,
      nativeCredentials: original.nativeCredentials?.map(ref => ({
        secretKey: ref.secretKey, locator: ref.locator, version: ref.version,
        audience: ref.audience, header: ref.header, prefix: ref.prefix,
      })),
    };
    deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), original);
  }
});
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

test("remote native resource evidence uses the original binding delivery shape", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/application-native-resources.sample.json", import.meta.url), "utf8");
  const typed: ApplicationAdapterDirectory = JSON.parse(raw);
  const back: ApplicationAdapterDirectory = { adapters: typed.adapters.map(adapter => ({
    adapterServiceRef: adapter.adapterServiceRef, baseUrl: adapter.baseUrl,
    nativeInstanceRef: adapter.nativeInstanceRef, artifactDigest: adapter.artifactDigest,
    actionTokenAudience: adapter.actionTokenAudience, timeoutSeconds: adapter.timeoutSeconds,
    maxResponseBytes: adapter.maxResponseBytes, secretReaders: adapter.secretReaders,
    bindings: adapter.bindings?.map(binding => ({
      bindingId: binding.bindingId, tenantId: binding.tenantId, workspaceId: binding.workspaceId,
      servicePrincipalId: binding.servicePrincipalId, nativeScopeRef: binding.nativeScopeRef,
      configDigest: binding.configDigest, isolationMode: binding.isolationMode,
      nativeResources: binding.nativeResources?.map(resource => ({
        typeKey: resource.typeKey, nativeType: resource.nativeType, nativeRef: resource.nativeRef,
        evidenceRef: resource.evidenceRef, evidenceDigest: resource.evidenceDigest,
      })),
    })),
  })) };
  deepStrictEqual(JSON.parse(JSON.stringify(back)), JSON.parse(raw));
});

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

test("automation cron round-trip preserves exact spec and legacy interval", () => {
  const original: unknown = JSON.parse(readFileSync(new URL("../../../../contracts/samples/automation-cron.sample.json", import.meta.url), "utf8"));
  const typed = original as AutomationVersionContent[];
  const reconstructed = typed.map((row): AutomationVersionContent => ({
    trigger: { kind: row.trigger.kind, scheduleSpec: row.trigger.scheduleSpec && {
      kind: row.trigger.scheduleSpec.kind, cron: row.trigger.scheduleSpec.cron,
      everySeconds: row.trigger.scheduleSpec.everySeconds, offsetSeconds: row.trigger.scheduleSpec.offsetSeconds,
      catchupWindowSeconds: row.trigger.scheduleSpec.catchupWindowSeconds,
    } }, action: { kind: row.action!.kind, template: row.action!.template }, resultTarget: row.resultTarget,
  }));
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), original);
});

test("automation POST_MESSAGE round-trip preserves action and native schedule", () => {
  const raw = readFileSync(new URL("../../../../contracts/samples/automation-post-message.sample.json", import.meta.url), "utf8");
  const original: unknown = JSON.parse(raw);
  const typed: AutomationVersionContent = JSON.parse(raw);
  ok(typed.action?.kind === "POST_MESSAGE");
  const reconstructed: AutomationVersionContent = {
    ...(typed.name !== undefined ? { name: typed.name } : {}),
    trigger: { kind: typed.trigger.kind, scheduleSpec: typed.trigger.scheduleSpec && {
      everySeconds: typed.trigger.scheduleSpec.everySeconds, offsetSeconds: typed.trigger.scheduleSpec.offsetSeconds,
      catchupWindowSeconds: typed.trigger.scheduleSpec.catchupWindowSeconds,
    } },
    action: { kind: typed.action.kind, template: typed.action.template }, resultTarget: typed.resultTarget,
    ...(typed.approvalPolicy ? { approvalPolicy: { id: typed.approvalPolicy.id, version: typed.approvalPolicy.version } } : {}),
  };
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)), original);
});

test("ordered automation steps retain IDs, duration, names and version discriminator", () => {
  for (const name of ["automation-steps.sample.json", "automation-message-sequence.sample.json", "automation-trigger-filter.sample.json"]) {
  const original = JSON.parse(readFileSync(new URL(`../../../../contracts/samples/${name}`, import.meta.url), "utf8"));
  const typed: AutomationVersionContent = original;
  ok((typed.formatVersion === 2 || typed.formatVersion === 3) && typed.steps && typed.action === undefined);
  const reconstructed: AutomationVersionContent = {name:typed.name,formatVersion:typed.formatVersion,
    trigger: {kind:typed.trigger.kind,textPrefix:typed.trigger.textPrefix,filter:typed.trigger.filter,
      mentionPrincipalId:typed.trigger.mentionPrincipalId,scheduleSpec:typed.trigger.scheduleSpec},
    steps:typed.steps.map((step) => ({id:step.id,name:step.name,action:step.action,duration:step.duration,text:step.text})),resultTarget:typed.resultTarget};
  deepStrictEqual(JSON.parse(JSON.stringify(reconstructed)),original);
  }
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

import type { Canary, CapabilityConformanceVectors, WebPublishMessageRequest, WebMessageQuery, WebMessageCursor, WebChannelView, PulsePublishRequest, PulseQueryRequest, NativeCommunityFacts } from "../src/generated/contracts.js";

test("Pulse shares original attachment fields and optional native Relay limit", () => {
  const load = (name:string) => JSON.parse(readFileSync(new URL(`../../../../contracts/samples/${name}`,import.meta.url),"utf8"));
  const publish:PulsePublishRequest=load("pulse-publish.sample.json");
  const back:PulsePublishRequest={operation:publish.operation,content:publish.content,targetEventId:publish.targetEventId,mentions:publish.mentions,attachments:publish.attachments};
  deepStrictEqual(JSON.parse(JSON.stringify(back)),publish);
  const query:PulseQueryRequest=load("pulse-query.sample.json");
  deepStrictEqual(JSON.parse(JSON.stringify({view:query.view,authors:query.authors,eventIds:query.eventIds,before:query.before} satisfies PulseQueryRequest)),query);
  for(const relayQueryLimit of [undefined,100]) {
    const facts:NativeCommunityFacts={relayUrl:"wss://relay.example",communityHost:"relay.example",relayQueryLimit};
    deepStrictEqual(JSON.parse(JSON.stringify(facts)),{relayUrl:facts.relayUrl,communityHost:facts.communityHost,...(relayQueryLimit===undefined?{}:{relayQueryLimit})});
  }
});

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

for (const sample of ["web-publish-mention.sample.json", "web-publish-content-only.sample.json", "web-forum-post.sample.json", "web-forum-comment.sample.json", "web-message-edit.sample.json", "web-message-delete.sample.json"]) {
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
