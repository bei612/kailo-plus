// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse and unparse this JSON data, add this code to your project and do:
//
//    canary, err := UnmarshalCanary(bytes)
//    bytes, err = canary.Marshal()
//
//    applicationModelAdmission, err := UnmarshalApplicationModelAdmission(bytes)
//    bytes, err = applicationModelAdmission.Marshal()
//
//    adapterBindingObservation, err := UnmarshalAdapterBindingObservation(bytes)
//    bytes, err = adapterBindingObservation.Marshal()
//
//    adapterExecutionObservation, err := UnmarshalAdapterExecutionObservation(bytes)
//    bytes, err = adapterExecutionObservation.Marshal()
//
//    adapterExecutionReference, err := UnmarshalAdapterExecutionReference(bytes)
//    bytes, err = adapterExecutionReference.Marshal()
//
//    adapterExecutionResponse, err := UnmarshalAdapterExecutionResponse(bytes)
//    bytes, err = adapterExecutionResponse.Marshal()
//
//    adapterExecutionUsage, err := UnmarshalAdapterExecutionUsage(bytes)
//    bytes, err = adapterExecutionUsage.Marshal()
//
//    adapterPepCheckRequest, err := UnmarshalAdapterPepCheckRequest(bytes)
//    bytes, err = adapterPepCheckRequest.Marshal()
//
//    adapterPepCheckResponse, err := UnmarshalAdapterPepCheckResponse(bytes)
//    bytes, err = adapterPepCheckResponse.Marshal()
//
//    protocolRevisionQuery, err := UnmarshalProtocolRevisionQuery(bytes)
//    bytes, err = protocolRevisionQuery.Marshal()
//
//    adapterProtocolSessionLaunchRequest, err := UnmarshalAdapterProtocolSessionLaunchRequest(bytes)
//    bytes, err = adapterProtocolSessionLaunchRequest.Marshal()
//
//    adapterProtocolSessionLaunchResponse, err := UnmarshalAdapterProtocolSessionLaunchResponse(bytes)
//    bytes, err = adapterProtocolSessionLaunchResponse.Marshal()
//
//    protocolSessionLifecyclePepResponse, err := UnmarshalProtocolSessionLifecyclePepResponse(bytes)
//    bytes, err = protocolSessionLifecyclePepResponse.Marshal()
//
//    adapterProtocolSessionLifecycleRequest, err := UnmarshalAdapterProtocolSessionLifecycleRequest(bytes)
//    bytes, err = adapterProtocolSessionLifecycleRequest.Marshal()
//
//    adapterProtocolSessionLifecycleResponse, err := UnmarshalAdapterProtocolSessionLifecycleResponse(bytes)
//    bytes, err = adapterProtocolSessionLifecycleResponse.Marshal()
//
//    protocolSessionPepRequest, err := UnmarshalProtocolSessionPepRequest(bytes)
//    bytes, err = protocolSessionPepRequest.Marshal()
//
//    protocolSessionPepResponse, err := UnmarshalProtocolSessionPepResponse(bytes)
//    bytes, err = protocolSessionPepResponse.Marshal()
//
//    protocolWriteObservation, err := UnmarshalProtocolWriteObservation(bytes)
//    bytes, err = protocolWriteObservation.Marshal()
//
//    protocolWriteReceipt, err := UnmarshalProtocolWriteReceipt(bytes)
//    bytes, err = protocolWriteReceipt.Marshal()
//
//    adapterQueryRevisionRequest, err := UnmarshalAdapterQueryRevisionRequest(bytes)
//    bytes, err = adapterQueryRevisionRequest.Marshal()
//
//    adapterQueryRevisionResponse, err := UnmarshalAdapterQueryRevisionResponse(bytes)
//    bytes, err = adapterQueryRevisionResponse.Marshal()
//
//    adapterScopeObservation, err := UnmarshalAdapterScopeObservation(bytes)
//    bytes, err = adapterScopeObservation.Marshal()
//
//    actionCommand, err := UnmarshalActionCommand(bytes)
//    bytes, err = actionCommand.Marshal()
//
//    actionSubmission, err := UnmarshalActionSubmission(bytes)
//    bytes, err = actionSubmission.Marshal()
//
//    agentDefinitionPage, err := UnmarshalAgentDefinitionPage(bytes)
//    bytes, err = agentDefinitionPage.Marshal()
//
//    agentDefinitionView, err := UnmarshalAgentDefinitionView(bytes)
//    bytes, err = agentDefinitionView.Marshal()
//
//    agentDelegationPage, err := UnmarshalAgentDelegationPage(bytes)
//    bytes, err = agentDelegationPage.Marshal()
//
//    agentDelegationTargetPage, err := UnmarshalAgentDelegationTargetPage(bytes)
//    bytes, err = agentDelegationTargetPage.Marshal()
//
//    agentDelegationView, err := UnmarshalAgentDelegationView(bytes)
//    bytes, err = agentDelegationView.Marshal()
//
//    agentInstallationCandidate, err := UnmarshalAgentInstallationCandidate(bytes)
//    bytes, err = agentInstallationCandidate.Marshal()
//
//    agentInstallationCandidatePage, err := UnmarshalAgentInstallationCandidatePage(bytes)
//    bytes, err = agentInstallationCandidatePage.Marshal()
//
//    agentInstallationPage, err := UnmarshalAgentInstallationPage(bytes)
//    bytes, err = agentInstallationPage.Marshal()
//
//    agentInstallationProjectionView, err := UnmarshalAgentInstallationProjectionView(bytes)
//    bytes, err = agentInstallationProjectionView.Marshal()
//
//    agentInstallationView, err := UnmarshalAgentInstallationView(bytes)
//    bytes, err = agentInstallationView.Marshal()
//
//    agentMemoryEntryPage, err := UnmarshalAgentMemoryEntryPage(bytes)
//    bytes, err = agentMemoryEntryPage.Marshal()
//
//    agentMemoryEntryView, err := UnmarshalAgentMemoryEntryView(bytes)
//    bytes, err = agentMemoryEntryView.Marshal()
//
//    agentMemoryReadView, err := UnmarshalAgentMemoryReadView(bytes)
//    bytes, err = agentMemoryReadView.Marshal()
//
//    agentVersionConfigurationPage, err := UnmarshalAgentVersionConfigurationPage(bytes)
//    bytes, err = agentVersionConfigurationPage.Marshal()
//
//    agentVersionPage, err := UnmarshalAgentVersionPage(bytes)
//    bytes, err = agentVersionPage.Marshal()
//
//    agentVersionRouteOption, err := UnmarshalAgentVersionRouteOption(bytes)
//    bytes, err = agentVersionRouteOption.Marshal()
//
//    agentVersionView, err := UnmarshalAgentVersionView(bytes)
//    bytes, err = agentVersionView.Marshal()
//
//    applicationBindingPage, err := UnmarshalApplicationBindingPage(bytes)
//    bytes, err = applicationBindingPage.Marshal()
//
//    applicationNativePage, err := UnmarshalApplicationNativePage(bytes)
//    bytes, err = applicationNativePage.Marshal()
//
//    approvalDecisionRequest, err := UnmarshalApprovalDecisionRequest(bytes)
//    bytes, err = approvalDecisionRequest.Marshal()
//
//    approvalView, err := UnmarshalApprovalView(bytes)
//    bytes, err = approvalView.Marshal()
//
//    auditEventPage, err := UnmarshalAuditEventPage(bytes)
//    bytes, err = auditEventPage.Marshal()
//
//    automationDelegationView, err := UnmarshalAutomationDelegationView(bytes)
//    bytes, err = automationDelegationView.Marshal()
//
//    automationDetailView, err := UnmarshalAutomationDetailView(bytes)
//    bytes, err = automationDetailView.Marshal()
//
//    automationPage, err := UnmarshalAutomationPage(bytes)
//    bytes, err = automationPage.Marshal()
//
//    automationRunPage, err := UnmarshalAutomationRunPage(bytes)
//    bytes, err = automationRunPage.Marshal()
//
//    automationRunView, err := UnmarshalAutomationRunView(bytes)
//    bytes, err = automationRunView.Marshal()
//
//    automationVersionView, err := UnmarshalAutomationVersionView(bytes)
//    bytes, err = automationVersionView.Marshal()
//
//    automationView, err := UnmarshalAutomationView(bytes)
//    bytes, err = automationView.Marshal()
//
//    capabilityContractPage, err := UnmarshalCapabilityContractPage(bytes)
//    bytes, err = capabilityContractPage.Marshal()
//
//    capabilityContractView, err := UnmarshalCapabilityContractView(bytes)
//    bytes, err = capabilityContractView.Marshal()
//
//    clientKeyView, err := UnmarshalClientKeyView(bytes)
//    bytes, err = clientKeyView.Marshal()
//
//    clientKeyStatus, err := UnmarshalClientKeyStatus(bytes)
//    bytes, err = clientKeyStatus.Marshal()
//
//    componentConformanceAuthorization, err := UnmarshalComponentConformanceAuthorization(bytes)
//    bytes, err = componentConformanceAuthorization.Marshal()
//
//    componentConformanceWireDigests, err := UnmarshalComponentConformanceWireDigests(bytes)
//    bytes, err = componentConformanceWireDigests.Marshal()
//
//    componentConformanceWireObservation, err := UnmarshalComponentConformanceWireObservation(bytes)
//    bytes, err = componentConformanceWireObservation.Marshal()
//
//    componentReleaseApprovalReport, err := UnmarshalComponentReleaseApprovalReport(bytes)
//    bytes, err = componentReleaseApprovalReport.Marshal()
//
//    componentReleasePage, err := UnmarshalComponentReleasePage(bytes)
//    bytes, err = componentReleasePage.Marshal()
//
//    componentReleaseReceipt, err := UnmarshalComponentReleaseReceipt(bytes)
//    bytes, err = componentReleaseReceipt.Marshal()
//
//    conversationOpenRequest, err := UnmarshalConversationOpenRequest(bytes)
//    bytes, err = conversationOpenRequest.Marshal()
//
//    conversationPage, err := UnmarshalConversationPage(bytes)
//    bytes, err = conversationPage.Marshal()
//
//    conversationParticipant, err := UnmarshalConversationParticipant(bytes)
//    bytes, err = conversationParticipant.Marshal()
//
//    conversationParticipantPage, err := UnmarshalConversationParticipantPage(bytes)
//    bytes, err = conversationParticipantPage.Marshal()
//
//    conversationPreferenceRequest, err := UnmarshalConversationPreferenceRequest(bytes)
//    bytes, err = conversationPreferenceRequest.Marshal()
//
//    conversationView, err := UnmarshalConversationView(bytes)
//    bytes, err = conversationView.Marshal()
//
//    delegatedActionMetadataV1, err := UnmarshalDelegatedActionMetadataV1(bytes)
//    bytes, err = delegatedActionMetadataV1.Marshal()
//
//    discoverableWorkspace, err := UnmarshalDiscoverableWorkspace(bytes)
//    bytes, err = discoverableWorkspace.Marshal()
//
//    discoverableWorkspacePage, err := UnmarshalDiscoverableWorkspacePage(bytes)
//    bytes, err = discoverableWorkspacePage.Marshal()
//
//    evidenceView, err := UnmarshalEvidenceView(bytes)
//    bytes, err = evidenceView.Marshal()
//
//    invitationRedemptionView, err := UnmarshalInvitationRedemptionView(bytes)
//    bytes, err = invitationRedemptionView.Marshal()
//
//    invitationRedemptionRequest, err := UnmarshalInvitationRedemptionRequest(bytes)
//    bytes, err = invitationRedemptionRequest.Marshal()
//
//    issuedInvitation, err := UnmarshalIssuedInvitation(bytes)
//    bytes, err = issuedInvitation.Marshal()
//
//    legacySecretRefPage, err := UnmarshalLegacySecretRefPage(bytes)
//    bytes, err = legacySecretRefPage.Marshal()
//
//    nativeCommunityFacts, err := UnmarshalNativeCommunityFacts(bytes)
//    bytes, err = nativeCommunityFacts.Marshal()
//
//    ownAuditEntry, err := UnmarshalOwnAuditEntry(bytes)
//    bytes, err = ownAuditEntry.Marshal()
//
//    platformInfo, err := UnmarshalPlatformInfo(bytes)
//    bytes, err = platformInfo.Marshal()
//
//    platformTenantPage, err := UnmarshalPlatformTenantPage(bytes)
//    bytes, err = platformTenantPage.Marshal()
//
//    platformToolPage, err := UnmarshalPlatformToolPage(bytes)
//    bytes, err = platformToolPage.Marshal()
//
//    platformToolView, err := UnmarshalPlatformToolView(bytes)
//    bytes, err = platformToolView.Marshal()
//
//    protocolSessionView, err := UnmarshalProtocolSessionView(bytes)
//    bytes, err = protocolSessionView.Marshal()
//
//    readMarkRequest, err := UnmarshalReadMarkRequest(bytes)
//    bytes, err = readMarkRequest.Marshal()
//
//    roleMemberPage, err := UnmarshalRoleMemberPage(bytes)
//    bytes, err = roleMemberPage.Marshal()
//
//    roleWorkspacePage, err := UnmarshalRoleWorkspacePage(bytes)
//    bytes, err = roleWorkspacePage.Marshal()
//
//    platformSessionView, err := UnmarshalPlatformSessionView(bytes)
//    bytes, err = platformSessionView.Marshal()
//
//    taskView, err := UnmarshalTaskView(bytes)
//    bytes, err = taskView.Marshal()
//
//    tenantInvitationView, err := UnmarshalTenantInvitationView(bytes)
//    bytes, err = tenantInvitationView.Marshal()
//
//    userStateVersion, err := UnmarshalUserStateVersion(bytes)
//    bytes, err = userStateVersion.Marshal()
//
//    webChannelView, err := UnmarshalWebChannelView(bytes)
//    bytes, err = webChannelView.Marshal()
//
//    webMessageCursor, err := UnmarshalWebMessageCursor(bytes)
//    bytes, err = webMessageCursor.Marshal()
//
//    webMessageQuery, err := UnmarshalWebMessageQuery(bytes)
//    bytes, err = webMessageQuery.Marshal()
//
//    webMessageType, err := UnmarshalWebMessageType(bytes)
//    bytes, err = webMessageType.Marshal()
//
//    webProfileUpdateRequest, err := UnmarshalWebProfileUpdateRequest(bytes)
//    bytes, err = webProfileUpdateRequest.Marshal()
//
//    webProfileView, err := UnmarshalWebProfileView(bytes)
//    bytes, err = webProfileView.Marshal()
//
//    webPublishMessageRequest, err := UnmarshalWebPublishMessageRequest(bytes)
//    bytes, err = webPublishMessageRequest.Marshal()
//
//    workspaceView, err := UnmarshalWorkspaceView(bytes)
//    bytes, err = workspaceView.Marshal()
//
//    workspaceMemberView, err := UnmarshalWorkspaceMemberView(bytes)
//    bytes, err = workspaceMemberView.Marshal()
//
//    workspacePreferenceRequest, err := UnmarshalWorkspacePreferenceRequest(bytes)
//    bytes, err = workspacePreferenceRequest.Marshal()
//
//    actionTokenSigningDelivery, err := UnmarshalActionTokenSigningDelivery(bytes)
//    bytes, err = actionTokenSigningDelivery.Marshal()
//
//    agentMemoryEntryListInput, err := UnmarshalAgentMemoryEntryListInput(bytes)
//    bytes, err = agentMemoryEntryListInput.Marshal()
//
//    agentMemoryEntryReadInput, err := UnmarshalAgentMemoryEntryReadInput(bytes)
//    bytes, err = agentMemoryEntryReadInput.Marshal()
//
//    agentMemoryWriteInput, err := UnmarshalAgentMemoryWriteInput(bytes)
//    bytes, err = agentMemoryWriteInput.Marshal()
//
//    agentVersionContent, err := UnmarshalAgentVersionContent(bytes)
//    bytes, err = agentVersionContent.Marshal()
//
//    applicationAdapterDirectory, err := UnmarshalApplicationAdapterDirectory(bytes)
//    bytes, err = applicationAdapterDirectory.Marshal()
//
//    applicationBindingCreate, err := UnmarshalApplicationBindingCreate(bytes)
//    bytes, err = applicationBindingCreate.Marshal()
//
//    applicationModelGatewayConfig, err := UnmarshalApplicationModelGatewayConfig(bytes)
//    bytes, err = applicationModelGatewayConfig.Marshal()
//
//    automationApprovalPolicyRef, err := UnmarshalAutomationApprovalPolicyRef(bytes)
//    bytes, err = automationApprovalPolicyRef.Marshal()
//
//    automationScheduleSpec, err := UnmarshalAutomationScheduleSpec(bytes)
//    bytes, err = automationScheduleSpec.Marshal()
//
//    automationVersionContent, err := UnmarshalAutomationVersionContent(bytes)
//    bytes, err = automationVersionContent.Marshal()
//
//    capabilityConformanceVectors, err := UnmarshalCapabilityConformanceVectors(bytes)
//    bytes, err = capabilityConformanceVectors.Marshal()
//
//    capabilityContractRef, err := UnmarshalCapabilityContractRef(bytes)
//    bytes, err = capabilityContractRef.Marshal()
//
//    capabilityContractRegistration, err := UnmarshalCapabilityContractRegistration(bytes)
//    bytes, err = capabilityContractRegistration.Marshal()
//
//    componentActionInput, err := UnmarshalComponentActionInput(bytes)
//    bytes, err = componentActionInput.Marshal()
//
//    componentConformanceEnvironment, err := UnmarshalComponentConformanceEnvironment(bytes)
//    bytes, err = componentConformanceEnvironment.Marshal()
//
//    componentConformanceFixture, err := UnmarshalComponentConformanceFixture(bytes)
//    bytes, err = componentConformanceFixture.Marshal()
//
//    componentConformanceIdentity, err := UnmarshalComponentConformanceIdentity(bytes)
//    bytes, err = componentConformanceIdentity.Marshal()
//
//    componentProtocolPeerEnvironment, err := UnmarshalComponentProtocolPeerEnvironment(bytes)
//    bytes, err = componentProtocolPeerEnvironment.Marshal()
//
//    componentReleaseApprovalTarget, err := UnmarshalComponentReleaseApprovalTarget(bytes)
//    bytes, err = componentReleaseApprovalTarget.Marshal()
//
//    componentReleaseRegistration, err := UnmarshalComponentReleaseRegistration(bytes)
//    bytes, err = componentReleaseRegistration.Marshal()
//
//    contentReference, err := UnmarshalContentReference(bytes)
//    bytes, err = contentReference.Marshal()
//
//    delegationGrantParameters, err := UnmarshalDelegationGrantParameters(bytes)
//    bytes, err = delegationGrantParameters.Marshal()
//
//    delegationScopeParameters, err := UnmarshalDelegationScopeParameters(bytes)
//    bytes, err = delegationScopeParameters.Marshal()
//
//    documentLaunchDescriptor, err := UnmarshalDocumentLaunchDescriptor(bytes)
//    bytes, err = documentLaunchDescriptor.Marshal()
//
//    errorBody, err := UnmarshalErrorBody(bytes)
//    bytes, err = errorBody.Marshal()
//
//    resolvedIdentity, err := UnmarshalResolvedIdentity(bytes)
//    bytes, err = resolvedIdentity.Marshal()
//
//    llmRouteCreateInput, err := UnmarshalLlmRouteCreateInput(bytes)
//    bytes, err = llmRouteCreateInput.Marshal()
//
//    nativeDocumentSelection, err := UnmarshalNativeDocumentSelection(bytes)
//    bytes, err = nativeDocumentSelection.Marshal()
//
//    platformBuildInfo, err := UnmarshalPlatformBuildInfo(bytes)
//    bytes, err = platformBuildInfo.Marshal()
//
//    protocolSessionOpenInput, err := UnmarshalProtocolSessionOpenInput(bytes)
//    bytes, err = protocolSessionOpenInput.Marshal()
//
//    resourceCreate, err := UnmarshalResourceCreate(bytes)
//    bytes, err = resourceCreate.Marshal()
//
//    runtimeProfileDirectory, err := UnmarshalRuntimeProfileDirectory(bytes)
//    bytes, err = runtimeProfileDirectory.Marshal()
//
//    taskStateReport, err := UnmarshalTaskStateReport(bytes)
//    bytes, err = taskStateReport.Marshal()
//
//    workflowRef, err := UnmarshalWorkflowRef(bytes)
//    bytes, err = workflowRef.Marshal()
//
//    workspaceChannelCreate, err := UnmarshalWorkspaceChannelCreate(bytes)
//    bytes, err = workspaceChannelCreate.Marshal()
//
//    workspaceVisibility, err := UnmarshalWorkspaceVisibility(bytes)
//    bytes, err = workspaceVisibility.Marshal()
//
//    affectedOwnerRef, err := UnmarshalAffectedOwnerRef(bytes)
//    bytes, err = affectedOwnerRef.Marshal()
//
//    agentInstallationAdvanceRequest, err := UnmarshalAgentInstallationAdvanceRequest(bytes)
//    bytes, err = agentInstallationAdvanceRequest.Marshal()
//
//    agentInstallationAdvanceResult, err := UnmarshalAgentInstallationAdvanceResult(bytes)
//    bytes, err = agentInstallationAdvanceResult.Marshal()
//
//    agentInstallationWorkflowTarget, err := UnmarshalAgentInstallationWorkflowTarget(bytes)
//    bytes, err = agentInstallationWorkflowTarget.Marshal()
//
//    agentTaskAdvanceRequest, err := UnmarshalAgentTaskAdvanceRequest(bytes)
//    bytes, err = agentTaskAdvanceRequest.Marshal()
//
//    agentTaskAdvanceResult, err := UnmarshalAgentTaskAdvanceResult(bytes)
//    bytes, err = agentTaskAdvanceResult.Marshal()
//
//    agentTaskWorkflowInput, err := UnmarshalAgentTaskWorkflowInput(bytes)
//    bytes, err = agentTaskWorkflowInput.Marshal()
//
//    applicationBindingAdvanceRequest, err := UnmarshalApplicationBindingAdvanceRequest(bytes)
//    bytes, err = applicationBindingAdvanceRequest.Marshal()
//
//    applicationBindingAdvanceResult, err := UnmarshalApplicationBindingAdvanceResult(bytes)
//    bytes, err = applicationBindingAdvanceResult.Marshal()
//
//    applicationBindingTarget, err := UnmarshalApplicationBindingTarget(bytes)
//    bytes, err = applicationBindingTarget.Marshal()
//
//    approvalControlOutcome, err := UnmarshalApprovalControlOutcome(bytes)
//    bytes, err = approvalControlOutcome.Marshal()
//
//    approvalDecisionOutcome, err := UnmarshalApprovalDecisionOutcome(bytes)
//    bytes, err = approvalDecisionOutcome.Marshal()
//
//    approvalDecisionRecord, err := UnmarshalApprovalDecisionRecord(bytes)
//    bytes, err = approvalDecisionRecord.Marshal()
//
//    approvalDecisionUpdate, err := UnmarshalApprovalDecisionUpdate(bytes)
//    bytes, err = approvalDecisionUpdate.Marshal()
//
//    approvalWorkflowInput, err := UnmarshalApprovalWorkflowInput(bytes)
//    bytes, err = approvalWorkflowInput.Marshal()
//
//    approvalInvalidateUpdate, err := UnmarshalApprovalInvalidateUpdate(bytes)
//    bytes, err = approvalInvalidateUpdate.Marshal()
//
//    approvalRefusal, err := UnmarshalApprovalRefusal(bytes)
//    bytes, err = approvalRefusal.Marshal()
//
//    approvalResume, err := UnmarshalApprovalResume(bytes)
//    bytes, err = approvalResume.Marshal()
//
//    approvalRoleRequirement, err := UnmarshalApprovalRoleRequirement(bytes)
//    bytes, err = approvalRoleRequirement.Marshal()
//
//    approvalStateReport, err := UnmarshalApprovalStateReport(bytes)
//    bytes, err = approvalStateReport.Marshal()
//
//    automationScheduleAdmitRequest, err := UnmarshalAutomationScheduleAdmitRequest(bytes)
//    bytes, err = automationScheduleAdmitRequest.Marshal()
//
//    automationScheduleAdmitResult, err := UnmarshalAutomationScheduleAdmitResult(bytes)
//    bytes, err = automationScheduleAdmitResult.Marshal()
//
//    automationScheduleTaskInput, err := UnmarshalAutomationScheduleTaskInput(bytes)
//    bytes, err = automationScheduleTaskInput.Marshal()
//
//    componentActionAdvanceRequest, err := UnmarshalComponentActionAdvanceRequest(bytes)
//    bytes, err = componentActionAdvanceRequest.Marshal()
//
//    componentActionAdvanceResult, err := UnmarshalComponentActionAdvanceResult(bytes)
//    bytes, err = componentActionAdvanceResult.Marshal()
//
//    componentActionTarget, err := UnmarshalComponentActionTarget(bytes)
//    bytes, err = componentActionTarget.Marshal()
//
//    componentConformanceObservation, err := UnmarshalComponentConformanceObservation(bytes)
//    bytes, err = componentConformanceObservation.Marshal()
//
//    componentConformancePlan, err := UnmarshalComponentConformancePlan(bytes)
//    bytes, err = componentConformancePlan.Marshal()
//
//    componentConformanceProbe, err := UnmarshalComponentConformanceProbe(bytes)
//    bytes, err = componentConformanceProbe.Marshal()
//
//    componentConformanceStepObservation, err := UnmarshalComponentConformanceStepObservation(bytes)
//    bytes, err = componentConformanceStepObservation.Marshal()
//
//    conversationProjectionRequest, err := UnmarshalConversationProjectionRequest(bytes)
//    bytes, err = conversationProjectionRequest.Marshal()
//
//    conversationProjectionResult, err := UnmarshalConversationProjectionResult(bytes)
//    bytes, err = conversationProjectionResult.Marshal()
//
//    conversationProjectionTarget, err := UnmarshalConversationProjectionTarget(bytes)
//    bytes, err = conversationProjectionTarget.Marshal()
//
//    freshApprovalAdmissionRequest, err := UnmarshalFreshApprovalAdmissionRequest(bytes)
//    bytes, err = freshApprovalAdmissionRequest.Marshal()
//
//    freshApprovalAdmissionResult, err := UnmarshalFreshApprovalAdmissionResult(bytes)
//    bytes, err = freshApprovalAdmissionResult.Marshal()
//
//    protocolSessionReconcileRequest, err := UnmarshalProtocolSessionReconcileRequest(bytes)
//    bytes, err = protocolSessionReconcileRequest.Marshal()
//
//    protocolSessionReconcileResult, err := UnmarshalProtocolSessionReconcileResult(bytes)
//    bytes, err = protocolSessionReconcileResult.Marshal()
//
//    protocolSessionReconcileRound, err := UnmarshalProtocolSessionReconcileRound(bytes)
//    bytes, err = protocolSessionReconcileRound.Marshal()
//
//    protocolSessionReconcileTarget, err := UnmarshalProtocolSessionReconcileTarget(bytes)
//    bytes, err = protocolSessionReconcileTarget.Marshal()
//
//    resourceProvisionAdvanceRequest, err := UnmarshalResourceProvisionAdvanceRequest(bytes)
//    bytes, err = resourceProvisionAdvanceRequest.Marshal()
//
//    resourceProvisionAdvanceResult, err := UnmarshalResourceProvisionAdvanceResult(bytes)
//    bytes, err = resourceProvisionAdvanceResult.Marshal()
//
//    resourceProvisionTarget, err := UnmarshalResourceProvisionTarget(bytes)
//    bytes, err = resourceProvisionTarget.Marshal()
//
//    tenantDeleteAdvanceRequest, err := UnmarshalTenantDeleteAdvanceRequest(bytes)
//    bytes, err = tenantDeleteAdvanceRequest.Marshal()
//
//    tenantDeleteAdvanceResult, err := UnmarshalTenantDeleteAdvanceResult(bytes)
//    bytes, err = tenantDeleteAdvanceResult.Marshal()

package generated

import "time"

import "encoding/json"

func UnmarshalCanary(data []byte) (Canary, error) {
	var r Canary
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *Canary) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApplicationModelAdmission(data []byte) (ApplicationModelAdmission, error) {
	var r ApplicationModelAdmission
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApplicationModelAdmission) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterBindingObservation(data []byte) (AdapterBindingObservation, error) {
	var r AdapterBindingObservation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterBindingObservation) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterExecutionObservation(data []byte) (AdapterExecutionObservation, error) {
	var r AdapterExecutionObservation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterExecutionObservation) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterExecutionReference(data []byte) (AdapterExecutionReference, error) {
	var r AdapterExecutionReference
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterExecutionReference) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterExecutionResponse(data []byte) (AdapterExecutionResponse, error) {
	var r AdapterExecutionResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterExecutionResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterExecutionUsage(data []byte) (AdapterExecutionUsage, error) {
	var r AdapterExecutionUsage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterExecutionUsage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterPepCheckRequest(data []byte) (AdapterPepCheckRequest, error) {
	var r AdapterPepCheckRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterPepCheckRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterPepCheckResponse(data []byte) (AdapterPepCheckResponse, error) {
	var r AdapterPepCheckResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterPepCheckResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolRevisionQuery(data []byte) (ProtocolRevisionQuery, error) {
	var r ProtocolRevisionQuery
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolRevisionQuery) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterProtocolSessionLaunchRequest(data []byte) (AdapterProtocolSessionLaunchRequest, error) {
	var r AdapterProtocolSessionLaunchRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterProtocolSessionLaunchRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterProtocolSessionLaunchResponse(data []byte) (AdapterProtocolSessionLaunchResponse, error) {
	var r AdapterProtocolSessionLaunchResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterProtocolSessionLaunchResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolSessionLifecyclePepResponse(data []byte) (ProtocolSessionLifecyclePepResponse, error) {
	var r ProtocolSessionLifecyclePepResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolSessionLifecyclePepResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterProtocolSessionLifecycleRequest(data []byte) (AdapterProtocolSessionLifecycleRequest, error) {
	var r AdapterProtocolSessionLifecycleRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterProtocolSessionLifecycleRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterProtocolSessionLifecycleResponse(data []byte) (AdapterProtocolSessionLifecycleResponse, error) {
	var r AdapterProtocolSessionLifecycleResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterProtocolSessionLifecycleResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolSessionPepRequest(data []byte) (ProtocolSessionPepRequest, error) {
	var r ProtocolSessionPepRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolSessionPepRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolSessionPepResponse(data []byte) (ProtocolSessionPepResponse, error) {
	var r ProtocolSessionPepResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolSessionPepResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolWriteObservation(data []byte) (ProtocolWriteObservation, error) {
	var r ProtocolWriteObservation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolWriteObservation) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolWriteReceipt(data []byte) (ProtocolWriteReceipt, error) {
	var r ProtocolWriteReceipt
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolWriteReceipt) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterQueryRevisionRequest(data []byte) (AdapterQueryRevisionRequest, error) {
	var r AdapterQueryRevisionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterQueryRevisionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterQueryRevisionResponse(data []byte) (AdapterQueryRevisionResponse, error) {
	var r AdapterQueryRevisionResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterQueryRevisionResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterScopeObservation(data []byte) (AdapterScopeObservation, error) {
	var r AdapterScopeObservation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterScopeObservation) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalActionCommand(data []byte) (ActionCommand, error) {
	var r ActionCommand
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ActionCommand) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalActionSubmission(data []byte) (ActionSubmission, error) {
	var r ActionSubmission
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ActionSubmission) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentDefinitionPage(data []byte) (AgentDefinitionPage, error) {
	var r AgentDefinitionPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentDefinitionPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentDefinitionView(data []byte) (AgentDefinitionView, error) {
	var r AgentDefinitionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentDefinitionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentDelegationPage(data []byte) (AgentDelegationPage, error) {
	var r AgentDelegationPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentDelegationPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentDelegationTargetPage(data []byte) (AgentDelegationTargetPage, error) {
	var r AgentDelegationTargetPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentDelegationTargetPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentDelegationView(data []byte) (AgentDelegationView, error) {
	var r AgentDelegationView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentDelegationView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInstallationCandidate(data []byte) (AgentInstallationCandidate, error) {
	var r AgentInstallationCandidate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationCandidate) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInstallationCandidatePage(data []byte) (AgentInstallationCandidatePage, error) {
	var r AgentInstallationCandidatePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationCandidatePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInstallationPage(data []byte) (AgentInstallationPage, error) {
	var r AgentInstallationPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInstallationProjectionView(data []byte) (AgentInstallationProjectionView, error) {
	var r AgentInstallationProjectionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationProjectionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInstallationView(data []byte) (AgentInstallationView, error) {
	var r AgentInstallationView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentMemoryEntryPage(data []byte) (AgentMemoryEntryPage, error) {
	var r AgentMemoryEntryPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentMemoryEntryPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentMemoryEntryView(data []byte) (AgentMemoryEntryView, error) {
	var r AgentMemoryEntryView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentMemoryEntryView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentMemoryReadView(data []byte) (AgentMemoryReadView, error) {
	var r AgentMemoryReadView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentMemoryReadView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentVersionConfigurationPage(data []byte) (AgentVersionConfigurationPage, error) {
	var r AgentVersionConfigurationPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentVersionConfigurationPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentVersionPage(data []byte) (AgentVersionPage, error) {
	var r AgentVersionPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentVersionPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentVersionRouteOption(data []byte) (AgentVersionRouteOption, error) {
	var r AgentVersionRouteOption
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentVersionRouteOption) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentVersionView(data []byte) (AgentVersionView, error) {
	var r AgentVersionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentVersionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApplicationBindingPage(data []byte) (ApplicationBindingPage, error) {
	var r ApplicationBindingPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApplicationBindingPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApplicationNativePage(data []byte) (ApplicationNativePage, error) {
	var r ApplicationNativePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApplicationNativePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalDecisionRequest(data []byte) (ApprovalDecisionRequest, error) {
	var r ApprovalDecisionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalDecisionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalView(data []byte) (ApprovalView, error) {
	var r ApprovalView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAuditEventPage(data []byte) (AuditEventPage, error) {
	var r AuditEventPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AuditEventPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationDelegationView(data []byte) (AutomationDelegationView, error) {
	var r AutomationDelegationView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationDelegationView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationDetailView(data []byte) (AutomationDetailView, error) {
	var r AutomationDetailView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationDetailView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationPage(data []byte) (AutomationPage, error) {
	var r AutomationPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationRunPage(data []byte) (AutomationRunPage, error) {
	var r AutomationRunPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationRunPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationRunView(data []byte) (AutomationRunView, error) {
	var r AutomationRunView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationRunView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationVersionView(data []byte) (AutomationVersionView, error) {
	var r AutomationVersionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationVersionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationView(data []byte) (AutomationView, error) {
	var r AutomationView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalCapabilityContractPage(data []byte) (CapabilityContractPage, error) {
	var r CapabilityContractPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *CapabilityContractPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalCapabilityContractView(data []byte) (CapabilityContractView, error) {
	var r CapabilityContractView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *CapabilityContractView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalClientKeyView(data []byte) (ClientKeyView, error) {
	var r ClientKeyView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ClientKeyView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalClientKeyStatus(data []byte) (ClientKeyStatus, error) {
	var r ClientKeyStatus
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ClientKeyStatus) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentConformanceAuthorization(data []byte) (ComponentConformanceAuthorization, error) {
	var r ComponentConformanceAuthorization
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformanceAuthorization) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentConformanceWireDigests(data []byte) (ComponentConformanceWireDigests, error) {
	var r ComponentConformanceWireDigests
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformanceWireDigests) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentConformanceWireObservation(data []byte) (ComponentConformanceWireObservation, error) {
	var r ComponentConformanceWireObservation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformanceWireObservation) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentReleaseApprovalReport(data []byte) (ComponentReleaseApprovalReport, error) {
	var r ComponentReleaseApprovalReport
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentReleaseApprovalReport) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentReleasePage(data []byte) (ComponentReleasePage, error) {
	var r ComponentReleasePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentReleasePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentReleaseReceipt(data []byte) (ComponentReleaseReceipt, error) {
	var r ComponentReleaseReceipt
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentReleaseReceipt) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalConversationOpenRequest(data []byte) (ConversationOpenRequest, error) {
	var r ConversationOpenRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ConversationOpenRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalConversationPage(data []byte) (ConversationPage, error) {
	var r ConversationPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ConversationPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalConversationParticipant(data []byte) (ConversationParticipant, error) {
	var r ConversationParticipant
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ConversationParticipant) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalConversationParticipantPage(data []byte) (ConversationParticipantPage, error) {
	var r ConversationParticipantPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ConversationParticipantPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalConversationPreferenceRequest(data []byte) (ConversationPreferenceRequest, error) {
	var r ConversationPreferenceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ConversationPreferenceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalConversationView(data []byte) (ConversationView, error) {
	var r ConversationView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ConversationView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalDelegatedActionMetadataV1(data []byte) (DelegatedActionMetadataV1, error) {
	var r DelegatedActionMetadataV1
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *DelegatedActionMetadataV1) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalDiscoverableWorkspace(data []byte) (DiscoverableWorkspace, error) {
	var r DiscoverableWorkspace
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *DiscoverableWorkspace) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalDiscoverableWorkspacePage(data []byte) (DiscoverableWorkspacePage, error) {
	var r DiscoverableWorkspacePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *DiscoverableWorkspacePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalEvidenceView(data []byte) (EvidenceView, error) {
	var r EvidenceView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *EvidenceView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalInvitationRedemptionView(data []byte) (InvitationRedemptionView, error) {
	var r InvitationRedemptionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *InvitationRedemptionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalInvitationRedemptionRequest(data []byte) (InvitationRedemptionRequest, error) {
	var r InvitationRedemptionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *InvitationRedemptionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalIssuedInvitation(data []byte) (IssuedInvitation, error) {
	var r IssuedInvitation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *IssuedInvitation) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalLegacySecretRefPage(data []byte) (LegacySecretRefPage, error) {
	var r LegacySecretRefPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *LegacySecretRefPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalNativeCommunityFacts(data []byte) (NativeCommunityFacts, error) {
	var r NativeCommunityFacts
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *NativeCommunityFacts) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalOwnAuditEntry(data []byte) (OwnAuditEntry, error) {
	var r OwnAuditEntry
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *OwnAuditEntry) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPlatformInfo(data []byte) (PlatformInfo, error) {
	var r PlatformInfo
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PlatformInfo) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPlatformTenantPage(data []byte) (PlatformTenantPage, error) {
	var r PlatformTenantPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PlatformTenantPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPlatformToolPage(data []byte) (PlatformToolPage, error) {
	var r PlatformToolPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PlatformToolPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPlatformToolView(data []byte) (PlatformToolView, error) {
	var r PlatformToolView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PlatformToolView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolSessionView(data []byte) (ProtocolSessionView, error) {
	var r ProtocolSessionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolSessionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalReadMarkRequest(data []byte) (ReadMarkRequest, error) {
	var r ReadMarkRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ReadMarkRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalRoleMemberPage(data []byte) (RoleMemberPage, error) {
	var r RoleMemberPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *RoleMemberPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalRoleWorkspacePage(data []byte) (RoleWorkspacePage, error) {
	var r RoleWorkspacePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *RoleWorkspacePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPlatformSessionView(data []byte) (PlatformSessionView, error) {
	var r PlatformSessionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PlatformSessionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalTaskView(data []byte) (TaskView, error) {
	var r TaskView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TaskView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalTenantInvitationView(data []byte) (TenantInvitationView, error) {
	var r TenantInvitationView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TenantInvitationView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalUserStateVersion(data []byte) (UserStateVersion, error) {
	var r UserStateVersion
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *UserStateVersion) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebChannelView(data []byte) (WebChannelView, error) {
	var r WebChannelView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebChannelView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebMessageCursor(data []byte) (WebMessageCursor, error) {
	var r WebMessageCursor
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebMessageCursor) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebMessageQuery(data []byte) (WebMessageQuery, error) {
	var r WebMessageQuery
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebMessageQuery) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebMessageType(data []byte) (WebMessageType, error) {
	var r WebMessageType
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebMessageType) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebProfileUpdateRequest(data []byte) (WebProfileUpdateRequest, error) {
	var r WebProfileUpdateRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebProfileUpdateRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebProfileView(data []byte) (WebProfileView, error) {
	var r WebProfileView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebProfileView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebPublishMessageRequest(data []byte) (WebPublishMessageRequest, error) {
	var r WebPublishMessageRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebPublishMessageRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWorkspaceView(data []byte) (WorkspaceView, error) {
	var r WorkspaceView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkspaceView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWorkspaceMemberView(data []byte) (WorkspaceMemberView, error) {
	var r WorkspaceMemberView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkspaceMemberView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWorkspacePreferenceRequest(data []byte) (WorkspacePreferenceRequest, error) {
	var r WorkspacePreferenceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkspacePreferenceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalActionTokenSigningDelivery(data []byte) (ActionTokenSigningDelivery, error) {
	var r ActionTokenSigningDelivery
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ActionTokenSigningDelivery) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentMemoryEntryListInput(data []byte) (AgentMemoryEntryListInput, error) {
	var r AgentMemoryEntryListInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentMemoryEntryListInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentMemoryEntryReadInput(data []byte) (AgentMemoryEntryReadInput, error) {
	var r AgentMemoryEntryReadInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentMemoryEntryReadInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentMemoryWriteInput(data []byte) (AgentMemoryWriteInput, error) {
	var r AgentMemoryWriteInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentMemoryWriteInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentVersionContent(data []byte) (AgentVersionContent, error) {
	var r AgentVersionContent
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentVersionContent) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApplicationAdapterDirectory(data []byte) (ApplicationAdapterDirectory, error) {
	var r ApplicationAdapterDirectory
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApplicationAdapterDirectory) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApplicationBindingCreate(data []byte) (ApplicationBindingCreate, error) {
	var r ApplicationBindingCreate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApplicationBindingCreate) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApplicationModelGatewayConfig(data []byte) (ApplicationModelGatewayConfig, error) {
	var r ApplicationModelGatewayConfig
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApplicationModelGatewayConfig) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationApprovalPolicyRef(data []byte) (AutomationApprovalPolicyRef, error) {
	var r AutomationApprovalPolicyRef
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationApprovalPolicyRef) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationScheduleSpec(data []byte) (AutomationScheduleSpec, error) {
	var r AutomationScheduleSpec
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationScheduleSpec) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationVersionContent(data []byte) (AutomationVersionContent, error) {
	var r AutomationVersionContent
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationVersionContent) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalCapabilityConformanceVectors(data []byte) (CapabilityConformanceVectors, error) {
	var r CapabilityConformanceVectors
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *CapabilityConformanceVectors) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalCapabilityContractRef(data []byte) (CapabilityContractRef, error) {
	var r CapabilityContractRef
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *CapabilityContractRef) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalCapabilityContractRegistration(data []byte) (CapabilityContractRegistration, error) {
	var r CapabilityContractRegistration
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *CapabilityContractRegistration) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentActionInput(data []byte) (ComponentActionInput, error) {
	var r ComponentActionInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentActionInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentConformanceEnvironment(data []byte) (ComponentConformanceEnvironment, error) {
	var r ComponentConformanceEnvironment
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformanceEnvironment) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentConformanceFixture(data []byte) (ComponentConformanceFixture, error) {
	var r ComponentConformanceFixture
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformanceFixture) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentConformanceIdentity(data []byte) (ComponentConformanceIdentity, error) {
	var r ComponentConformanceIdentity
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformanceIdentity) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentProtocolPeerEnvironment(data []byte) (ComponentProtocolPeerEnvironment, error) {
	var r ComponentProtocolPeerEnvironment
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentProtocolPeerEnvironment) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentReleaseApprovalTarget(data []byte) (ComponentReleaseApprovalTarget, error) {
	var r ComponentReleaseApprovalTarget
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentReleaseApprovalTarget) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentReleaseRegistration(data []byte) (ComponentReleaseRegistration, error) {
	var r ComponentReleaseRegistration
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentReleaseRegistration) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalContentReference(data []byte) (ContentReference, error) {
	var r ContentReference
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ContentReference) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalDelegationGrantParameters(data []byte) (DelegationGrantParameters, error) {
	var r DelegationGrantParameters
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *DelegationGrantParameters) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalDelegationScopeParameters(data []byte) (DelegationScopeParameters, error) {
	var r DelegationScopeParameters
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *DelegationScopeParameters) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalDocumentLaunchDescriptor(data []byte) (DocumentLaunchDescriptor, error) {
	var r DocumentLaunchDescriptor
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *DocumentLaunchDescriptor) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalErrorBody(data []byte) (ErrorBody, error) {
	var r ErrorBody
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ErrorBody) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalResolvedIdentity(data []byte) (ResolvedIdentity, error) {
	var r ResolvedIdentity
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResolvedIdentity) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalLlmRouteCreateInput(data []byte) (LlmRouteCreateInput, error) {
	var r LlmRouteCreateInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *LlmRouteCreateInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalNativeDocumentSelection(data []byte) (NativeDocumentSelection, error) {
	var r NativeDocumentSelection
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *NativeDocumentSelection) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPlatformBuildInfo(data []byte) (PlatformBuildInfo, error) {
	var r PlatformBuildInfo
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PlatformBuildInfo) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolSessionOpenInput(data []byte) (ProtocolSessionOpenInput, error) {
	var r ProtocolSessionOpenInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolSessionOpenInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalResourceCreate(data []byte) (ResourceCreate, error) {
	var r ResourceCreate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResourceCreate) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalRuntimeProfileDirectory(data []byte) (RuntimeProfileDirectory, error) {
	var r RuntimeProfileDirectory
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *RuntimeProfileDirectory) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalTaskStateReport(data []byte) (TaskStateReport, error) {
	var r TaskStateReport
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TaskStateReport) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWorkflowRef(data []byte) (WorkflowRef, error) {
	var r WorkflowRef
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkflowRef) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWorkspaceChannelCreate(data []byte) (WorkspaceChannelCreate, error) {
	var r WorkspaceChannelCreate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkspaceChannelCreate) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWorkspaceVisibility(data []byte) (WorkspaceVisibility, error) {
	var r WorkspaceVisibility
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkspaceVisibility) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAffectedOwnerRef(data []byte) (AffectedOwnerRef, error) {
	var r AffectedOwnerRef
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AffectedOwnerRef) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInstallationAdvanceRequest(data []byte) (AgentInstallationAdvanceRequest, error) {
	var r AgentInstallationAdvanceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationAdvanceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInstallationAdvanceResult(data []byte) (AgentInstallationAdvanceResult, error) {
	var r AgentInstallationAdvanceResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationAdvanceResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInstallationWorkflowTarget(data []byte) (AgentInstallationWorkflowTarget, error) {
	var r AgentInstallationWorkflowTarget
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationWorkflowTarget) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTaskAdvanceRequest(data []byte) (AgentTaskAdvanceRequest, error) {
	var r AgentTaskAdvanceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTaskAdvanceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTaskAdvanceResult(data []byte) (AgentTaskAdvanceResult, error) {
	var r AgentTaskAdvanceResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTaskAdvanceResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTaskWorkflowInput(data []byte) (AgentTaskWorkflowInput, error) {
	var r AgentTaskWorkflowInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTaskWorkflowInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApplicationBindingAdvanceRequest(data []byte) (ApplicationBindingAdvanceRequest, error) {
	var r ApplicationBindingAdvanceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApplicationBindingAdvanceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApplicationBindingAdvanceResult(data []byte) (ApplicationBindingAdvanceResult, error) {
	var r ApplicationBindingAdvanceResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApplicationBindingAdvanceResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApplicationBindingTarget(data []byte) (ApplicationBindingTarget, error) {
	var r ApplicationBindingTarget
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApplicationBindingTarget) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalControlOutcome(data []byte) (ApprovalControlOutcome, error) {
	var r ApprovalControlOutcome
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalControlOutcome) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalDecisionOutcome(data []byte) (ApprovalDecisionOutcome, error) {
	var r ApprovalDecisionOutcome
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalDecisionOutcome) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalDecisionRecord(data []byte) (ApprovalDecisionRecord, error) {
	var r ApprovalDecisionRecord
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalDecisionRecord) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalDecisionUpdate(data []byte) (ApprovalDecisionUpdate, error) {
	var r ApprovalDecisionUpdate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalDecisionUpdate) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalWorkflowInput(data []byte) (ApprovalWorkflowInput, error) {
	var r ApprovalWorkflowInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalWorkflowInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalInvalidateUpdate(data []byte) (ApprovalInvalidateUpdate, error) {
	var r ApprovalInvalidateUpdate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalInvalidateUpdate) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalRefusal(data []byte) (ApprovalRefusal, error) {
	var r ApprovalRefusal
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalRefusal) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalResume(data []byte) (ApprovalResume, error) {
	var r ApprovalResume
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalResume) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalRoleRequirement(data []byte) (ApprovalRoleRequirement, error) {
	var r ApprovalRoleRequirement
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalRoleRequirement) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalApprovalStateReport(data []byte) (ApprovalStateReport, error) {
	var r ApprovalStateReport
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApprovalStateReport) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationScheduleAdmitRequest(data []byte) (AutomationScheduleAdmitRequest, error) {
	var r AutomationScheduleAdmitRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationScheduleAdmitRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationScheduleAdmitResult(data []byte) (AutomationScheduleAdmitResult, error) {
	var r AutomationScheduleAdmitResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationScheduleAdmitResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationScheduleTaskInput(data []byte) (AutomationScheduleTaskInput, error) {
	var r AutomationScheduleTaskInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationScheduleTaskInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentActionAdvanceRequest(data []byte) (ComponentActionAdvanceRequest, error) {
	var r ComponentActionAdvanceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentActionAdvanceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentActionAdvanceResult(data []byte) (ComponentActionAdvanceResult, error) {
	var r ComponentActionAdvanceResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentActionAdvanceResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentActionTarget(data []byte) (ComponentActionTarget, error) {
	var r ComponentActionTarget
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentActionTarget) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentConformanceObservation(data []byte) (ComponentConformanceObservation, error) {
	var r ComponentConformanceObservation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformanceObservation) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentConformancePlan(data []byte) (ComponentConformancePlan, error) {
	var r ComponentConformancePlan
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformancePlan) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentConformanceProbe(data []byte) (ComponentConformanceProbe, error) {
	var r ComponentConformanceProbe
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformanceProbe) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentConformanceStepObservation(data []byte) (ComponentConformanceStepObservation, error) {
	var r ComponentConformanceStepObservation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformanceStepObservation) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalConversationProjectionRequest(data []byte) (ConversationProjectionRequest, error) {
	var r ConversationProjectionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ConversationProjectionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalConversationProjectionResult(data []byte) (ConversationProjectionResult, error) {
	var r ConversationProjectionResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ConversationProjectionResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalConversationProjectionTarget(data []byte) (ConversationProjectionTarget, error) {
	var r ConversationProjectionTarget
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ConversationProjectionTarget) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFreshApprovalAdmissionRequest(data []byte) (FreshApprovalAdmissionRequest, error) {
	var r FreshApprovalAdmissionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FreshApprovalAdmissionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFreshApprovalAdmissionResult(data []byte) (FreshApprovalAdmissionResult, error) {
	var r FreshApprovalAdmissionResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FreshApprovalAdmissionResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolSessionReconcileRequest(data []byte) (ProtocolSessionReconcileRequest, error) {
	var r ProtocolSessionReconcileRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolSessionReconcileRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolSessionReconcileResult(data []byte) (ProtocolSessionReconcileResult, error) {
	var r ProtocolSessionReconcileResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolSessionReconcileResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolSessionReconcileRound(data []byte) (ProtocolSessionReconcileRound, error) {
	var r ProtocolSessionReconcileRound
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolSessionReconcileRound) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProtocolSessionReconcileTarget(data []byte) (ProtocolSessionReconcileTarget, error) {
	var r ProtocolSessionReconcileTarget
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProtocolSessionReconcileTarget) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalResourceProvisionAdvanceRequest(data []byte) (ResourceProvisionAdvanceRequest, error) {
	var r ResourceProvisionAdvanceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResourceProvisionAdvanceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalResourceProvisionAdvanceResult(data []byte) (ResourceProvisionAdvanceResult, error) {
	var r ResourceProvisionAdvanceResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResourceProvisionAdvanceResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalResourceProvisionTarget(data []byte) (ResourceProvisionTarget, error) {
	var r ResourceProvisionTarget
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResourceProvisionTarget) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalTenantDeleteAdvanceRequest(data []byte) (TenantDeleteAdvanceRequest, error) {
	var r TenantDeleteAdvanceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TenantDeleteAdvanceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalTenantDeleteAdvanceResult(data []byte) (TenantDeleteAdvanceResult, error) {
	var r TenantDeleteAdvanceResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TenantDeleteAdvanceResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

// 可用 JSON Schema 子集的可执行定义。它穷举 contracts/README.md 第 1
// 节允许的每一种构造；四侧生成器必须全部生成成功并通过双向序列化。新增构造先加进本文件并四侧验证通过，才允许在其他 schema 中使用。
type Canary struct {
	// 可选的枚举引用
	CapabilityState *CapabilityState `json:"capabilityState,omitempty"`
	// 基础 integer
	Count int64 `json:"count"`
	// 基础 boolean
	Enabled bool `json:"enabled"`
	// 跨文件 $ref 引用封闭枚举
	ErrorClass ErrorClass `json:"errorClass"`
	// format: uuid
	ID string `json:"id"`
	// 基础 string
	Name string `json:"name"`
	// 内联对象，同样显式关闭 additionalProperties
	Nested Nested `json:"nested"`
	// RFC3339 时间戳，按普通 string 传输。format: date-time 不在可用子集内——Dart 的 toIso8601String()
	// 强制补毫秒，四侧线格式不等价。取值合法性由 Core 在 Admission 校验，不由 schema 承担。
	OccurredAt *string `json:"occurredAt,omitempty"`
	// 基础 number
	Ratio float64 `json:"ratio"`
	// 同构数组
	Tags []string `json:"tags"`
	// 变体类型的平坦表达：封闭枚举 tag 加各变体字段全部可选，替代被禁用的 oneOf
	Variants []Variant `json:"variants,omitempty"`
}

// 内联对象，同样显式关闭 additionalProperties
type Nested struct {
	Label   string    `json:"label"`
	Weights []float64 `json:"weights,omitempty"`
}

type Variant struct {
	FileDigest  *string     `json:"fileDigest,omitempty"`
	Kind        VariantKind `json:"kind"`
	MessageBody *string     `json:"messageBody,omitempty"`
	TaskAttempt *int64      `json:"taskAttempt,omitempty"`
}

type ApplicationModelAdmission struct {
	BindingID          string `json:"bindingId"`
	GatewayPrincipalID string `json:"gatewayPrincipalId"`
	Generation         int64  `json:"generation"`
	Method             string `json:"method"`
	Path               string `json:"path"`
	Traceparent        string `json:"traceparent"`
}

// 07§5/6.2：validate_binding 的非正文观察。精确原生scope/实例、隔离与配置引用摘要，不是用户声明的通过布尔值。
type AdapterBindingObservation struct {
	ArtifactDigest    string                    `json:"artifactDigest"`
	BindingID         string                    `json:"bindingId"`
	ConfigDigest      string                    `json:"configDigest"`
	ExecutionMappings []AdapterExecutionMapping `json:"executionMappings"`
	IsolationMode     ApplicationIsolationMode  `json:"isolationMode"`
	NativeInstanceRef string                    `json:"nativeInstanceRef"`
	NativeScopeRef    string                    `json:"nativeScopeRef"`
	SecretReads       []AdapterSecretRead       `json:"secretReads"`
	SecretRefDigest   string                    `json:"secretRefDigest"`
	TenantID          string                    `json:"tenantId"`
	WorkspaceID       *string                   `json:"workspaceId,omitempty"`
}

type AdapterExecutionMapping struct {
	ActionKey        string                 `json:"actionKey"`
	ActionVersion    int64                  `json:"actionVersion"`
	CancelCapability NativeCancelCapability `json:"cancelCapability"`
	NativeType       string                 `json:"nativeType"`
}

type AdapterSecretRead struct {
	Audience  string `json:"audience"`
	RequestID string `json:"requestId"`
	SecretKey string `json:"secretKey"`
	Version   int64  `json:"version"`
}

// ADR-12 execute/observe/cancel/reconcile 的原生观察。字段取自 design03 ExternalExecution；nativeId
// 允许未取得，值域与具体操作的终态证据由接收者验证。取消接收仍为 RUNNING/UNKNOWN，不伪装 CANCELLED。
type AdapterExecutionObservation struct {
	CancelCapability NativeCancelCapability  `json:"cancelCapability"`
	IdempotencyKey   string                  `json:"idempotencyKey"`
	LastObservedAt   *string                 `json:"lastObservedAt,omitempty"`
	NativeID         *string                 `json:"nativeId,omitempty"`
	NativeStatus     *string                 `json:"nativeStatus,omitempty"`
	NativeType       string                  `json:"nativeType"`
	PlatformStatus   ExternalExecutionStatus `json:"platformStatus"`
	TerminalAt       *string                 `json:"terminalAt,omitempty"`
}

// 原 ExternalExecution 的 observe/extract_usage 引用；不携带正文，不新建执行，不接受引用自报 scope。nativeId
// 未取得时只用冻结幂等键查证。
type AdapterExecutionReference struct {
	ExternalExecutionID string  `json:"externalExecutionId"`
	IdempotencyKey      string  `json:"idempotencyKey"`
	NativeID            *string `json:"nativeId,omitempty"`
	NativeType          string  `json:"nativeType"`
}

// ADR-12 执行响应分离原生任务观察与能力结果。HTTP 接收不是终态；resultJson 只在原生 SUCCEEDED 且符合固定结果 schema 时消费。它不进入
// Core 的套件报告。
type AdapterExecutionResponse struct {
	ContentReference *ContentReferenceClass `json:"contentReference,omitempty"`
	Execution        ExecutionClass         `json:"execution"`
	ResultJSON       *string                `json:"resultJson,omitempty"`
}

// design03 的唯一内容引用线格式；不是业务正文。Adapter typed 槽是传递引用的唯一来源，resultJson 不用于识别或重建引用。
type ContentReferenceClass struct {
	AssetID         *string `json:"assetId,omitempty"`
	DisplayName     string  `json:"displayName"`
	MediaType       string  `json:"mediaType"`
	NativeObjectRef string  `json:"nativeObjectRef"`
	NativeRevision  string  `json:"nativeRevision"`
	ResourceID      string  `json:"resourceId"`
}

// ADR-12 execute/observe/cancel/reconcile 的原生观察。字段取自 design03 ExternalExecution；nativeId
// 允许未取得，值域与具体操作的终态证据由接收者验证。取消接收仍为 RUNNING/UNKNOWN，不伪装 CANCELLED。
type ExecutionClass struct {
	CancelCapability NativeCancelCapability  `json:"cancelCapability"`
	IdempotencyKey   string                  `json:"idempotencyKey"`
	LastObservedAt   *string                 `json:"lastObservedAt,omitempty"`
	NativeID         *string                 `json:"nativeId,omitempty"`
	NativeStatus     *string                 `json:"nativeStatus,omitempty"`
	NativeType       string                  `json:"nativeType"`
	PlatformStatus   ExternalExecutionStatus `json:"platformStatus"`
	TerminalAt       *string                 `json:"terminalAt,omitempty"`
}

// DD-48/51/94 extract_usage 的原生终态用量元数据；scope/customer/dimensions 只由 Core 原
// ExternalExecution 决定。完整集合与冻结 action meters 精确相等，缺失不是零。
type AdapterExecutionUsage struct {
	ExternalExecutionID string        `json:"externalExecutionId"`
	IdempotencyKey      string        `json:"idempotencyKey"`
	Measurements        []Measurement `json:"measurements"`
	NativeID            string        `json:"nativeId"`
	NativeType          string        `json:"nativeType"`
}

type Measurement struct {
	MeterKey   string `json:"meterKey"`
	OccurredAt string `json:"occurredAt"`
	Quantity   int64  `json:"quantity"`
}

// ADR-12
// adapter入站fresh校验。ActionToken只瞬时校验、不入history或审计正文；参数由原ActionToken摘要绑定，binding由受认证client精确匹配。
type AdapterPepCheckRequest struct {
	ActionToken      string                 `json:"actionToken"`
	ArgumentsJSON    string                 `json:"argumentsJson"`
	BindingID        string                 `json:"bindingId"`
	ContentReference *ContentReferenceClass `json:"contentReference,omitempty"`
	Operation        string                 `json:"operation"`
}

// 只在原动作和精确binding仍被fresh授权时返回当前授权revision；不是可复用的新授权票据。
type AdapterPepCheckResponse struct {
	ActionExecutionID        string `json:"actionExecutionId"`
	AuthorizationMinZedToken string `json:"authorizationMinZedToken"`
	OperationID              string `json:"operationId"`
}

// DD-90/18§5.4：原保存结果不明会话的确切写入证据查证；只核已有 ACCEPTED writer observation 对应的原生
// VersionId，不提供文件字节或当前权限。
type ProtocolRevisionQuery struct {
	BaseRevision      string                `json:"baseRevision"`
	ProtocolSessionID string                `json:"protocolSessionId"`
	WriteObservation  WriteObservationClass `json:"writeObservation"`
}

// 18 §5.4: authenticated native PutFile evidence for the existing ProtocolSession; never
// file bytes or an authorization grant.
type WriteObservationClass struct {
	BaseModifiedAt time.Time `json:"baseModifiedAt"`
	BytesWritten   int64     `json:"bytesWritten"`
	CorrelationRef string    `json:"correlationRef"`
	Editors        string    `json:"editors"`
	NativeEtag     *string   `json:"nativeEtag,omitempty"`
	Phase          Phase     `json:"phase"`
	ResultRevision *string   `json:"resultRevision,omitempty"`
}

// 18: execute the original admitted file protocol Session, not an arbitrary editor URL or
// native object create. All fields are frozen Core facts and the whole body is covered by
// ActionToken.
type AdapterProtocolSessionLaunchRequest struct {
	AdmittedMode                 TedMode               `json:"admittedMode"`
	AuthorizationTargetNativeRef string                `json:"authorizationTargetNativeRef"`
	ExpiresAt                    string                `json:"expiresAt"`
	IdempotencyKey               string                `json:"idempotencyKey"`
	Locale                       Locale                `json:"locale"`
	ProtocolSessionID            string                `json:"protocolSessionId"`
	Reference                    ContentReferenceClass `json:"reference"`
	Theme                        Theme                 `json:"theme"`
}

// 18: the original native PAT reference plus transient launch descriptor. This value occurs
// only in the original execute response; it must not be stored as reconciliation evidence
// or recovered by reminting a token.
type AdapterProtocolSessionLaunchResponse struct {
	LaunchDescriptor LaunchDescriptorClass `json:"launchDescriptor"`
	NativeSessionRef string                `json:"nativeSessionRef"`
}

// DD-95/103: transient, fixed-origin launch returned by the admitted binding adapter;
// credentials are only string form fields, never a persisted Task, chat or ContentReference.
type LaunchDescriptorClass struct {
	ActionURL    string            `json:"actionUrl"`
	EditorOrigin string            `json:"editorOrigin"`
	ExpiresAt    string            `json:"expiresAt"`
	FormFields   map[string]string `json:"formFields"`
	Method       Method            `json:"method"`
}

// DD-90, 18 §5.1: binding-authenticated permission to observe/revoke the original document
// PAT. These closed lifecycle facts never authorize file reads, writes or token creation.
type ProtocolSessionLifecyclePepResponse struct {
	Decision          DecisionEnum `json:"decision"`
	ExpiresAt         time.Time    `json:"expiresAt"`
	NativeObjectRef   string       `json:"nativeObjectRef"`
	ProtocolSessionID string       `json:"protocolSessionId"`
	RequestedMode     TedMode      `json:"requestedMode"`
}

// 18 §5.1: observe/cancel the same native document PAT only. No access token, launch
// descriptor or file bytes.
type AdapterProtocolSessionLifecycleRequest struct {
	IdempotencyKey    string `json:"idempotencyKey"`
	NativeObjectRef   string `json:"nativeObjectRef"`
	ProtocolSessionID string `json:"protocolSessionId"`
}

// Original Cells PAT metadata only. ABSENT is a successful native lookup; errors must
// remain unavailable, never ABSENT.
type AdapterProtocolSessionLifecycleResponse struct {
	ExpiresAt         *time.Time  `json:"expiresAt,omitempty"`
	NativeObjectRef   string      `json:"nativeObjectRef"`
	NativeSessionRef  *string     `json:"nativeSessionRef,omitempty"`
	NativeState       NativeState `json:"nativeState"`
	ProtocolSessionID string      `json:"protocolSessionId"`
}

// 18 §5.2: authenticated binding→Core PEP for an existing ProtocolSession. No native token
// grants platform permissions.
type ProtocolSessionPepRequest struct {
	BindingID         string                 `json:"bindingId"`
	NativeObjectRef   string                 `json:"nativeObjectRef"`
	NativeOperation   NativeOperation        `json:"nativeOperation"`
	ProtocolSessionID string                 `json:"protocolSessionId"`
	WriteObservation  *WriteObservationClass `json:"writeObservation,omitempty"`
}

// Original Session facts, not native revision existence or write success. Cells must still
// query its exact VersionId and ACLs.
type ProtocolSessionPepResponse struct {
	AdmittedMode  TedMode      `json:"admittedMode"`
	BaseRevision  string       `json:"baseRevision"`
	Decision      DecisionEnum `json:"decision"`
	DisplayName   string       `json:"displayName"`
	ExpiresAt     time.Time    `json:"expiresAt"`
	ExportAllowed bool         `json:"exportAllowed"`
	MinZedToken   string       `json:"minZedToken"`
	// Confirmed original native token/session reference. Required by native READ/WRITE
	// consumers, absent before the first native OPEN creation.
	NativeSessionRef *string `json:"nativeSessionRef,omitempty"`
	// Original active issuer from the HUMAN's frozen ExternalIdentity, never a browser-supplied
	// claim.
	OidcIssuer string `json:"oidcIssuer"`
	// Original active subject paired with oidcIssuer. Cells resolves its existing explicit
	// native user link; no email or display-name fallback.
	OidcSubject     string `json:"oidcSubject"`
	PlatformHumanID string `json:"platformHumanId"`
	// Exact canonical platform PUBLIC_ORIGIN from the Core deployment, never the native request
	// Origin or a browser-supplied field. Required by the native FileInfo consumer; unavailable
	// origin refuses its editor projection.
	PostMessageOrigin *string `json:"postMessageOrigin,omitempty"`
}

// 18 §5.4: authenticated native PutFile evidence for the existing ProtocolSession; never
// file bytes or an authorization grant.
type ProtocolWriteObservation struct {
	BaseModifiedAt time.Time `json:"baseModifiedAt"`
	BytesWritten   int64     `json:"bytesWritten"`
	CorrelationRef string    `json:"correlationRef"`
	Editors        string    `json:"editors"`
	NativeEtag     *string   `json:"nativeEtag,omitempty"`
	Phase          Phase     `json:"phase"`
	ResultRevision *string   `json:"resultRevision,omitempty"`
}

// Receipt of native write evidence. It grants no read or write permission.
type ProtocolWriteReceipt struct {
	ProtocolSessionID string                    `json:"protocolSessionId"`
	State             ProtocolWriteReceiptState `json:"state"`
}

// 07§5.2与ADR-12：查询同一native对象当前权威revision；ActionToken通过Authorization头传输，幂等键与Idempotency-Key头一致。authorizationTargetNativeRef仅为Core从实际受权Resource/Asset解析的原生目标定位，参与同一参数签名；adapter须核实被查对象在该目标及固定binding
// scope内。缺省保持确切目标查询，不授予一般子对象读取。不是execute或权限授予。
type AdapterQueryRevisionRequest struct {
	AuthorizationTargetNativeRef *string                 `json:"authorizationTargetNativeRef,omitempty"`
	IdempotencyKey               string                  `json:"idempotencyKey"`
	NativeObjectRef              string                  `json:"nativeObjectRef"`
	ProtocolReconcile            *ProtocolReconcileClass `json:"protocolReconcile,omitempty"`
}

// DD-90/18§5.4：原保存结果不明会话的确切写入证据查证；只核已有 ACCEPTED writer observation 对应的原生
// VersionId，不提供文件字节或当前权限。
type ProtocolReconcileClass struct {
	BaseRevision      string                `json:"baseRevision"`
	ProtocolSessionID string                `json:"protocolSessionId"`
	WriteObservation  WriteObservationClass `json:"writeObservation"`
}

// 07§5.2与18§5：只返回被查证同一native对象当前权威revision，不替换调用方冻结ContentReference、不以mtime/ETag猜测revision。未知或fresh授权失败不得生成成功应答。
type AdapterQueryRevisionResponse struct {
	CorrelationRef    *string `json:"correlationRef,omitempty"`
	NativeObjectRef   string  `json:"nativeObjectRef"`
	NativeRevision    string  `json:"nativeRevision"`
	ProtocolSessionID *string `json:"protocolSessionId,omitempty"`
}

// DD-98：按同一 platform Resource ref CREATE/LOOKUP；FOUND 保留上游实际引用，不由套件预测或生成 native ID。
type AdapterScopeObservation struct {
	NativeRef           *string           `json:"nativeRef,omitempty"`
	NativeType          *string           `json:"nativeType,omitempty"`
	PlatformResourceRef string            `json:"platformResourceRef"`
	Result              NativeScopeResult `json:"result"`
}

// POST /api/v1/actions 的语义命令。actionKey 由 Core 的 ActionDefinition 目录解析，未登记即 BLOCKED；各动作所需参数按
// actionKey 解释，多出或缺少的参数以 INVALID_PARAMETERS 拒绝。
type ActionCommand struct {
	ActionKey string `json:"actionKey"`
	// 仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
	AgentVersionContent       *AgentVersionContentClass      `json:"agentVersionContent,omitempty"`
	ApplicationBindingCreate  *ApplicationBindingCreateClass `json:"applicationBindingCreate,omitempty"`
	ApplicationBindingID      *string                        `json:"applicationBindingId,omitempty"`
	ApplicationBindingVersion *int64                         `json:"applicationBindingVersion,omitempty"`
	// AgentVersion 管理动作的目标 Asset；Core 核对父 Resource、Tenant、owner、版本与投影。
	AssetID *string `json:"assetId,omitempty"`
	// 调用方实际读取的 Asset 版本；旧版本不能改写新的草稿或发布事实。
	AssetVersion *int64 `json:"assetVersion,omitempty"`
	// 仅 automation.create / automation.publish_version：Core 自有版本内容；publish 产生新的不可变版本，不改写旧版本。
	AutomationVersionContent *AutomationVersionContentClass `json:"automationVersionContent,omitempty"`
	// 仅 capability_contract.approve/deprecate：固定已登记版本。
	CapabilityContractRef *CapabilityContractRefClass `json:"capabilityContractRef,omitempty"`
	// 仅 capability_contract.register：真实 schema 与测试向量内容。
	CapabilityContractRegistration *CapabilityContractRegistrationClass `json:"capabilityContractRegistration,omitempty"`
	ComponentAction                *ComponentActionClass                `json:"componentAction,omitempty"`
	// 仅组件批准：已登记的不可变ComponentRelease标识。
	ComponentReleaseID           *string                            `json:"componentReleaseId,omitempty"`
	ComponentReleaseRegistration *ComponentReleaseRegistrationClass `json:"componentReleaseRegistration,omitempty"`
	ConversationOpen             *ConversationOpenClass             `json:"conversationOpen,omitempty"`
	// 仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
	DelegationGrant *DelegationGrantClass `json:"delegationGrant,omitempty"`
	// 显式 Delegation 管理的稳定 Grant ID；授予者提供新 ID，撤销引用实际已有 ID。
	DelegationID *string `json:"delegationId,omitempty"`
	// 仅 revoke：调用方实际读取的 Grant 版本。
	DelegationVersion *int64 `json:"delegationVersion,omitempty"`
	// 仅 automation.create：同一 Workspace 的确切 AgentInstallation Resource，不从名称或当前默认配置推断。
	ExecutorInstallationResourceID *string `json:"executorInstallationResourceId,omitempty"`
	// EXPLICIT 动作或 HUMAN owner 的一次手动 automation.run，由用户在当前目标详情上确认后设为 true；其他动作不得携带。手动运行只提交
	// resourceId/resourceVersion/workspaceId 与同一幂等键，不选择 Grant、Agent、来源或结果位置。
	ExplicitConfirmation *bool `json:"explicitConfirmation,omitempty"`
	// 调用方幂等键。同一发起者以同一键重发时回答原 operation；参数不同即 IDEMPOTENCY_KEY_REUSED
	IdempotencyKey string `json:"idempotencyKey"`
	// tenant.member.invite.revoke 的目标邀请
	InvitationID *string `json:"invitationId,omitempty"`
	// 仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
	LlmRouteCreate *LlmRouteCreateClass `json:"llmRouteCreate,omitempty"`
	// 仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
	// 输入；其他命令禁止携带。
	MemoryWrite *MemoryWriteClass `json:"memoryWrite,omitempty"`
	// workspace.create 或 AgentDefinition 创建/更新的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
	Name *string `json:"name,omitempty"`
	// 任务控制只接收原 ActionExecution ID；原 Workflow、target 与 scope 由 Core 解析
	OriginalActionExecutionID *string `json:"originalActionExecutionId,omitempty"`
	// 成员动作的目标 Principal；resource.transfer_owner 的新 owner
	PrincipalID *string `json:"principalId,omitempty"`
	// Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
	// identity; no Agent or caller-selected native credentials.
	ProtocolSessionOpen *ProtocolSessionOpenClass `json:"protocolSessionOpen,omitempty"`
	ResourceCreate      *ResourceCreateClass      `json:"resourceCreate,omitempty"`
	// Resource 管理动作的目标；Core 重新核对同 Tenant、scope、owner 和投影
	ResourceID *string `json:"resourceId,omitempty"`
	// 调用方实际读取的 Resource 版本；与当前事实不同即 CONFLICT
	ResourceVersion *int64 `json:"resourceVersion,omitempty"`
	// workspace.create 或 agent.definition.create 的稳定 slug
	Slug *string `json:"slug,omitempty"`
	// 仅 agent.invoke 人工分派：本人在该 Workspace Channel 已持久发布的消息 ID；Core 回读验签并与普通 mention 共用源事件幂等。
	SourceEventID *string `json:"sourceEventId,omitempty"`
	// tenant.suspend / tenant.restore 的目标业务 Tenant；执行 Tenant 仍是会话 Tenant（Platform Catalog）
	TenantID         *string                `json:"tenantId,omitempty"`
	WorkspaceChannel *WorkspaceChannelClass `json:"workspaceChannel,omitempty"`
	// Workspace 内动作的执行 Workspace
	WorkspaceID *string `json:"workspaceId,omitempty"`
	// 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
	WorkspaceVisibility *WorkspaceVisibility `json:"workspaceVisibility,omitempty"`
}

// 仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
//
// 03 §7、17 §3 的 requested 行为内容；不含 owner、Workspace、凭据、provider 地址或 host
// environment。发布不等于安装或运行授权。
type AgentVersionContentClass struct {
	// 精确 contract_key@version，不引用业务能力实现名。
	CapabilityRequirements  []string                           `json:"capabilityRequirements"`
	DeclaredToolResourceIDS []string                           `json:"declaredToolResourceIds"`
	Instructions            string                             `json:"instructions"`
	MemoryPolicy            AgentVersionContentMemoryPolicy    `json:"memoryPolicy"`
	ModelRouteResourceID    string                             `json:"modelRouteResourceId"`
	Parallelism             int64                              `json:"parallelism"`
	PersonaIdentity         AgentVersionContentPersonaIdentity `json:"personaIdentity"`
	// RuntimeProfile capability contract 所声明的回复策略键；不隐式授予触发或读取权限。
	ReplyPolicy          string                        `json:"replyPolicy"`
	RuntimeProfileKey    string                        `json:"runtimeProfileKey"`
	SkillVersionAssetIDS []string                      `json:"skillVersionAssetIds"`
	TriggerDefaults      []AgentTrigger                `json:"triggerDefaults"`
	TurnLimits           AgentVersionContentTurnLimits `json:"turnLimits"`
}

type AgentVersionContentMemoryPolicy struct {
	ColdWrite AgentMemoryColdWrite `json:"coldWrite"`
	CoreWrite AgentMemoryCoreWrite `json:"coreWrite"`
}

type AgentVersionContentPersonaIdentity struct {
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	Description *string `json:"description,omitempty"`
	DisplayName string  `json:"displayName"`
}

type AgentVersionContentTurnLimits struct {
	IdleTimeoutSeconds     int64 `json:"idleTimeoutSeconds"`
	MaxTurnDurationSeconds int64 `json:"maxTurnDurationSeconds"`
}

// DD-88/94：pin 已批准 release 的业务绑定选择。只携带 SecretRef，不接受密钥正文或运行端点 URL。Workspace 取原
// ActionCommand。
type ApplicationBindingCreateClass struct {
	AdapterServiceRef    string                                       `json:"adapterServiceRef"`
	BindingID            string                                       `json:"bindingId"`
	CallIdentityMode     ApplicationCallIdentityMode                  `json:"callIdentityMode"`
	CapabilityCategories []ApplicationBindingCreateCapabilityCategory `json:"capabilityCategories"`
	ComponentReleaseID   string                                       `json:"componentReleaseId"`
	IsolationMode        ApplicationIsolationMode                     `json:"isolationMode"`
	ModelCallMode        ApplicationModelCallMode                     `json:"modelCallMode"`
	NativeInstanceRef    string                                       `json:"nativeInstanceRef"`
	NativeScopeRef       *string                                      `json:"nativeScopeRef,omitempty"`
	NormalizedConfigJSON string                                       `json:"normalizedConfigJson"`
	RetainOnTenantDelete bool                                         `json:"retainOnTenantDelete"`
	SecretRefs           []ApplicationBindingCreateSecretRef          `json:"secretRefs"`
	ServicePrincipalID   string                                       `json:"servicePrincipalId"`
}

type ApplicationBindingCreateCapabilityCategory struct {
	Category string `json:"category"`
	Version  int64  `json:"version"`
}

type ApplicationBindingCreateSecretRef struct {
	Audience  string `json:"audience"`
	Locator   string `json:"locator"`
	SecretKey string `json:"secretKey"`
	Version   int64  `json:"version"`
}

// 仅 automation.create / automation.publish_version：Core 自有版本内容；publish 产生新的不可变版本，不改写旧版本。
//
// REQ-23、DD-107、03 §7 的不可变自动化版本。Schedule 使用 Temporal 原生 interval，不含消息正文、provider 配置或凭据。
type AutomationVersionContentClass struct {
	Action         AutomationVersionContentAction  `json:"action"`
	ApprovalPolicy *ApprovalPolicyElement          `json:"approvalPolicy,omitempty"`
	ResultTarget   AutomationResultTarget          `json:"resultTarget"`
	Trigger        AutomationVersionContentTrigger `json:"trigger"`
}

type AutomationVersionContentAction struct {
	Kind     ActionKind `json:"kind"`
	Template string     `json:"template"`
}

// DD-107 同 Tenant automation.run 的显式已登记审批策略；版本精确冻结，不授予审批权限。
type ApprovalPolicyElement struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
}

type AutomationVersionContentTrigger struct {
	Kind               AutomationTriggerKind `json:"kind"`
	MentionPrincipalID *string               `json:"mentionPrincipalId,omitempty"`
	ScheduleSpec       *ScheduleSpecClass    `json:"scheduleSpec,omitempty"`
	TextPrefix         *string               `json:"textPrefix,omitempty"`
}

// Temporal IntervalSpec 的显式秒数；offset 小于 every，catchupWindow 不小于原生的 10 秒。Overlap 固定
// SKIP，不另实现 cron。
type ScheduleSpecClass struct {
	CatchupWindowSeconds int64 `json:"catchupWindowSeconds"`
	EverySeconds         int64 `json:"everySeconds"`
	OffsetSeconds        int64 `json:"offsetSeconds"`
}

// 仅 capability_contract.approve/deprecate：固定已登记版本。
//
// 固定 Catalog 自然键，不授予业务能力 consume 权限。
type CapabilityContractRefClass struct {
	CategoryKey     string `json:"categoryKey"`
	ContractVersion int64  `json:"contractVersion"`
}

// 仅 capability_contract.register：真实 schema 与测试向量内容。
//
// DD-102：平台管理员登记实际 schema 与一致性测试向量。Core 按实际 canonical JSON 计算摘要并固定原内容；不接受只填摘要。
type CapabilityContractRegistrationClass struct {
	CategoryKey               string                                                  `json:"categoryKey"`
	ContentReferenceSemantics CapabilityContractRegistrationContentReferenceSemantics `json:"contentReferenceSemantics"`
	ContractVersion           int64                                                   `json:"contractVersion"`
	OperationContracts        []CapabilityContractRegistrationOperationContract       `json:"operationContracts"`
	ProtocolSessionKinds      []string                                                `json:"protocolSessionKinds"`
	RequiredDeclarations      []CapabilityRequiredDeclaration                         `json:"requiredDeclarations"`
	ResourceTypeFamily        []CapabilityContractRegistrationResourceTypeFamily      `json:"resourceTypeFamily"`
	SchemaDocuments           []string                                                `json:"schemaDocuments"`
	// CapabilityConformanceVectors 的 JSON 编码，formatVersion 固定格式；任意自然语言对象数组不构成可执行向量。Core
	// 校验所有步骤参数/结果符合契约 schema，覆盖所有 operationContracts，然后固定 canonical digest。
	TestVectorsJSON string `json:"testVectorsJson"`
}

type CapabilityContractRegistrationContentReferenceSemantics struct {
	AuthorizationTargetRule string `json:"authorizationTargetRule"`
	NativeObjectRefRule     string `json:"nativeObjectRefRule"`
	NativeRevisionRule      string `json:"nativeRevisionRule"`
}

type CapabilityContractRegistrationOperationContract struct {
	ContractKey        string               `json:"contractKey"`
	InputSchemaDigest  string               `json:"inputSchemaDigest"`
	OutputSchemaDigest string               `json:"outputSchemaDigest"`
	Permission         CapabilityPermission `json:"permission"`
	Surface            CapabilitySurface    `json:"surface"`
	TargetType         string               `json:"targetType"`
}

type CapabilityContractRegistrationResourceTypeFamily struct {
	Kind    string `json:"kind"`
	TypeKey string `json:"typeKey"`
}

// Kailo HUMAN 通过原 ActionCommand 调用确切 APPLICATION 能力动作。参数是组件原生持久内容引用，不把 SQL、提示或结果正文写入
// Core/Temporal。
type ComponentActionClass struct {
	ActionVersion               int64                 `json:"actionVersion"`
	InputReference              ContentReferenceClass `json:"inputReference"`
	ResultExposurePolicyID      string                `json:"resultExposurePolicyId"`
	ResultExposurePolicyVersion int64                 `json:"resultExposurePolicyVersion"`
}

// 组件登记只提交实际 manifest、包清单与 binding config schema；不接收 suite 通过声明、报告或候选执行地址。Core 解析并冻结内容，原
// Worker 独立执行隔离套件。
type ComponentReleaseRegistrationClass struct {
	BindingConfigSchemaJSON string `json:"bindingConfigSchemaJson"`
	ManifestJSON            string `json:"manifestJson"`
	PackageJSON             string `json:"packageJson"`
}

// 原生私聊的完整 HUMAN Principal 参与者集合，必须包含当前 HUMAN；不接受设备公钥、CONTROL 身份或 Workspace 冒名。
type ConversationOpenClass struct {
	ParticipantPrincipalIDS []string `json:"participantPrincipalIds"`
}

// 仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
type DelegationGrantClass struct {
	ExpiresAt time.Time      `json:"expiresAt"`
	MaxUses   *int64         `json:"maxUses,omitempty"`
	Scopes    []ScopeElement `json:"scopes"`
	ValidFrom time.Time      `json:"validFrom"`
}

// 03 §6 的确切 Action/target/exposure 限制；管理发现与原 Grant 写入共用，发现不授予 permission。
type ScopeElement struct {
	ActionKey          string             `json:"actionKey"`
	ActionVersion      int64              `json:"actionVersion"`
	CreateWorkspaceID  *string            `json:"createWorkspaceId,omitempty"`
	OutputSchemaHash   string             `json:"outputSchemaHash"`
	RedactionPolicy    string             `json:"redactionPolicy"`
	ResultExposureMode ResultExposureMode `json:"resultExposureMode"`
	TargetID           *string            `json:"targetId,omitempty"`
	TargetType         string             `json:"targetType"`
	ToolResourceID     *string            `json:"toolResourceId,omitempty"`
}

// 仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
//
// 受治理 Route 创建只传原生配置与同 Tenant OpenBao 凭据的确切引用。providerCredentialMode 必须明确提供：NONE
// 仅表示固定原生提供方配置不使用认证；SECRET_REF 必须有确切引用。端点、模型正文与 key 不进入 Core 参数。
type LlmRouteCreateClass struct {
	Model                  Model                            `json:"model"`
	Provider               Model                            `json:"provider"`
	ProviderCredentialMode LlmProviderCredentialMode        `json:"providerCredentialMode"`
	ProviderSecretRef      *LlmRouteCreateProviderSecretRef `json:"providerSecretRef,omitempty"`
}

type Model struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
	Sha256   string `json:"sha256"`
}

type LlmRouteCreateProviderSecretRef struct {
	Audience string `json:"audience"`
	Locator  string `json:"locator"`
	Version  int64  `json:"version"`
}

// 仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
// 输入；其他命令禁止携带。
//
// HUMAN Memory Action 本次瞬态输入；正文仅用于原生 NIP-AE 构造，不进入 ActionExecution、审计、outbox 或 history。
type MemoryWriteClass struct {
	// entry.patch 当前原生 value 的 SHA-256。
	BaseHash *string `json:"baseHash,omitempty"`
	// 调用方实际读取的 head；null 只表示原生确认不存在。
	ExpectedHeadEventID *string `json:"expectedHeadEventId,omitempty"`
	// 原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
	ExpectedHeadState ExpectedHeadState `json:"expectedHeadState"`
	// entry.patch 的原生严格 unified diff，不支持 fuzz、offset 或多文件。
	Patch *string `json:"patch,omitempty"`
	Slug  string  `json:"slug"`
	// core.replace 的 profile 或 entry.set 的 value；完整序列化 JSON body 必须满足原生 NIP-44 上界。
	Value *string `json:"value,omitempty"`
}

// Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
// identity; no Agent or caller-selected native credentials.
//
// 03/07/18: the original HUMAN file protocol action, not an arbitrary editor or native URL.
// Revision and presentation are frozen once; session expiry comes from controlled Core
// delivery.
type ProtocolSessionOpenClass struct {
	ActionVersion int64 `json:"actionVersion"`
	// The selected native source binding; must equal the target's real binding, not an
	// authorization claim.
	ApplicationBindingID string `json:"applicationBindingId"`
	Locale               Locale `json:"locale"`
	// Exact approved projection selected by the native menu; never latest.
	ProjectionGeneration int64                 `json:"projectionGeneration"`
	Reference            ContentReferenceClass `json:"reference"`
	Theme                Theme                 `json:"theme"`
}

type ResourceCreateClass struct {
	EvidenceDigest string `json:"evidenceDigest"`
	EvidenceRef    string `json:"evidenceRef"`
	NativeRef      string `json:"nativeRef"`
	NativeType     string `json:"nativeType"`
	TypeKey        string `json:"typeKey"`
}

// workspace.create 的 Buzz 原生频道元数据。只用于创建时向 Relay 物化，不建立第二份频道内容权威。缺省保留旧命令的 stream 行为。
type WorkspaceChannelClass struct {
	ChannelType ChannelType `json:"channelType"`
	Description *string     `json:"description,omitempty"`
	// 原 Buzz 临时频道的不活跃期限（秒）。省略为长期频道；Relay 原生消息活动续期，原生 reaper 到期归档，不表示 Workspace 暂停或删除。
	TTLSeconds *int64 `json:"ttlSeconds,omitempty"`
}

// POST /api/v1/actions 的回应：本次 operation 的门禁与调度状态。gateState=WAITING 时 approvalWorkflowId
// 必有；DENIED 时 reason 必有。invitation 只在 tenant.member.invite 的首次回应中出现，同一幂等键的重放不再给出（DD-83）。
type ActionSubmission struct {
	ActionExecutionID  string                 `json:"actionExecutionId"`
	ActionKey          string                 `json:"actionKey"`
	ApprovalWorkflowID *string                `json:"approvalWorkflowId,omitempty"`
	DispatchState      ActionDispatchState    `json:"dispatchState"`
	DocumentLaunch     *LaunchDescriptorClass `json:"documentLaunch,omitempty"`
	GateState          ActionGateState        `json:"gateState"`
	Invitation         *InvitationClass       `json:"invitation,omitempty"`
	OperationID        string                 `json:"operationId"`
	ProtocolSessionID  *string                `json:"protocolSessionId,omitempty"`
	Reason             *ReasonCode            `json:"reason,omitempty"`
	WorkflowID         *string                `json:"workflowId,omitempty"`
}

// tenant.member.invite 首次回应里一次性出现的邀请（DD-83）。link 含明文凭据（在 URL fragment
// 里），服务端只存其摘要，之后任何回应都不再给出；丢失即撤回重发。
type InvitationClass struct {
	// RFC3339，UTC
	ExpiresAt    string `json:"expiresAt"`
	InvitationID string `json:"invitationId"`
	// 部署登记的链接基址 + '#' + 一次性凭据
	Link string `json:"link"`
}

// 同 Tenant 且当前 discover 权限允许的 AgentDefinition 页；nextOffset 续读同一排序，不代表总量上限。
type AgentDefinitionPage struct {
	Definitions []DefinitionElement `json:"definitions"`
	NextOffset  *int64              `json:"nextOffset,omitempty"`
}

// DD-24/25 的 Core Agent 稳定身份及实际 Resource 事实；不表示版本已发布或 Agent 可运行。
type DefinitionElement struct {
	CurrentPublishedVersionAssetID *string       `json:"currentPublishedVersionAssetId,omitempty"`
	DisplayName                    string        `json:"displayName"`
	OwnerPrincipalID               string        `json:"ownerPrincipalId"`
	ResourceID                     string        `json:"resourceId"`
	ResourceState                  ResourceState `json:"resourceState"`
	ResourceVersion                int64         `json:"resourceVersion"`
	StableSlug                     string        `json:"stableSlug"`
	Status                         string        `json:"status"`
}

// DD-24/25 的 Core Agent 稳定身份及实际 Resource 事实；不表示版本已发布或 Agent 可运行。
type AgentDefinitionView struct {
	CurrentPublishedVersionAssetID *string       `json:"currentPublishedVersionAssetId,omitempty"`
	DisplayName                    string        `json:"displayName"`
	OwnerPrincipalID               string        `json:"ownerPrincipalId"`
	ResourceID                     string        `json:"resourceId"`
	ResourceState                  ResourceState `json:"resourceState"`
	ResourceVersion                int64         `json:"resourceVersion"`
	StableSlug                     string        `json:"stableSlug"`
	Status                         string        `json:"status"`
}

type AgentDelegationPage struct {
	CanGrant               bool           `json:"canGrant"`
	CanRevoke              bool           `json:"canRevoke"`
	Grants                 []GrantElement `json:"grants"`
	InstallationResourceID string         `json:"installationResourceId"`
	NextOffset             *int64         `json:"nextOffset,omitempty"`
	ResourceVersion        int64          `json:"resourceVersion"`
	WorkspaceID            string         `json:"workspaceId"`
}

// 同 Installation 的实际 Grant、Scope 与使用引用；没有 token、正文或新的权限裁决。
type GrantElement struct {
	DelegationID       string               `json:"delegationId"`
	DelegationVersion  int64                `json:"delegationVersion"`
	GrantorPrincipalID string               `json:"grantorPrincipalId"`
	Parameters         DelegationGrantClass `json:"parameters"`
	State              GrantState           `json:"state"`
	Uses               int64                `json:"uses"`
}

// 原 Grant 校验器当前允许的确切 Action/target/exposure；空页没有可授予对象，不伪造默认 Scope。
type AgentDelegationTargetPage struct {
	InstallationResourceID string         `json:"installationResourceId"`
	NextOffset             *int64         `json:"nextOffset,omitempty"`
	ResourceVersion        int64          `json:"resourceVersion"`
	Scopes                 []ScopeElement `json:"scopes"`
	WorkspaceID            string         `json:"workspaceId"`
}

// 同 Installation 的实际 Grant、Scope 与使用引用；没有 token、正文或新的权限裁决。
type AgentDelegationView struct {
	DelegationID       string               `json:"delegationId"`
	DelegationVersion  int64                `json:"delegationVersion"`
	GrantorPrincipalID string               `json:"grantorPrincipalId"`
	Parameters         DelegationGrantClass `json:"parameters"`
	State              GrantState           `json:"state"`
	Uses               int64                `json:"uses"`
}

// 实际 ACTIVE Definition/PUBLISHED Asset 的安装来源与版本；不表示新 Installation 或 runtime 已 ACTIVE。
type AgentInstallationCandidate struct {
	AgentResourceID     string `json:"agentResourceId"`
	AgentVersionAssetID string `json:"agentVersionAssetId"`
	AssetVersion        int64  `json:"assetVersion"`
	DisplayName         string `json:"displayName"`
	Ordinal             int64  `json:"ordinal"`
	ResourceVersion     int64  `json:"resourceVersion"`
}

type AgentInstallationCandidatePage struct {
	// 原 Installation create exposure、目录与 fresh Workspace create；每个候选还须 consume/投影查证，提交时全部重验。
	CanCreate   bool               `json:"canCreate"`
	Candidates  []CandidateElement `json:"candidates"`
	NextOffset  *int64             `json:"nextOffset,omitempty"`
	WorkspaceID string             `json:"workspaceId"`
}

// 实际 ACTIVE Definition/PUBLISHED Asset 的安装来源与版本；不表示新 Installation 或 runtime 已 ACTIVE。
type CandidateElement struct {
	AgentResourceID     string `json:"agentResourceId"`
	AgentVersionAssetID string `json:"agentVersionAssetId"`
	AssetVersion        int64  `json:"assetVersion"`
	DisplayName         string `json:"displayName"`
	Ordinal             int64  `json:"ordinal"`
	ResourceVersion     int64  `json:"resourceVersion"`
}

// 按既有部署登记页长扫描同一 Workspace，再以 fresh Installation Resource read 过滤；空页不代表整个 Workspace 无安装。
type AgentInstallationPage struct {
	Installations []InstallationElement `json:"installations"`
	NextOffset    *int64                `json:"nextOffset,omitempty"`
}

// 03 §7、17 §8：同 Tenant、已准入 Workspace 且 fresh Installation Resource read 允许的只读事实；不授予 Version
// 正文、执行或管理权限。
type InstallationElement struct {
	ActiveProjectionGeneration *int64              `json:"activeProjectionGeneration,omitempty"`
	AgentPrincipalID           string              `json:"agentPrincipalId"`
	AgentPrincipalState        AgentPrincipalState `json:"agentPrincipalState"`
	AgentResourceID            string              `json:"agentResourceId"`
	// 同固定 Version、ACTIVE 投影与原生 Profile 已支持的 Automation 来源结果位置；普通 Agent 仍沿其固定回复策略，Automation
	// 则消息到原 Thread、Schedule/manual 到同 Workspace Channel。不代表 execute、Delegation 或 quota
	// 准入。缺失或空集合不支持 Schedule。
	AutomationResultTargets []AutomationResultTarget         `json:"automationResultTargets,omitempty"`
	ChannelBinding          *InstallationChannelBinding      `json:"channelBinding,omitempty"`
	ExecutionPermission     *InstallationExecutionPermission `json:"executionPermission,omitempty"`
	OwnerPrincipalID        string                           `json:"ownerPrincipalId"`
	PinnedVersionAssetID    string                           `json:"pinnedVersionAssetId"`
	Projection              *ProjectionClass                 `json:"projection,omitempty"`
	ReadPermission          *InstallationReadPermission      `json:"readPermission,omitempty"`
	ResourceID              string                           `json:"resourceId"`
	ResourceState           ResourceState                    `json:"resourceState"`
	ResourceVersion         int64                            `json:"resourceVersion"`
	State                   AgentInstallationState           `json:"state"`
	WorkspaceID             string                           `json:"workspaceId"`
}

type InstallationChannelBinding struct {
	ChannelID *string              `json:"channelId,omitempty"`
	Status    ChannelBindingStatus `json:"status"`
	Triggers  []AgentTrigger       `json:"triggers"`
}

type InstallationExecutionPermission struct {
	CanGrant                 bool    `json:"canGrant"`
	CanRevoke                bool    `json:"canRevoke"`
	Effective                bool    `json:"effective"`
	PendingActionExecutionID *string `json:"pendingActionExecutionId,omitempty"`
	Requested                bool    `json:"requested"`
}

// 17 §8 的持久运行投影摘要；不证明本机进程当前健康，不返回正文、凭据或隔离目录。
type ProjectionClass struct {
	AgentVersionAssetID string                      `json:"agentVersionAssetId"`
	ConfigHash          string                      `json:"configHash"`
	Generation          int64                       `json:"generation"`
	RuntimeProfileKey   string                      `json:"runtimeProfileKey"`
	State               AgentRuntimeProjectionState `json:"state"`
}

type InstallationReadPermission struct {
	CanGrant                 bool    `json:"canGrant"`
	CanRevoke                bool    `json:"canRevoke"`
	Effective                bool    `json:"effective"`
	PendingActionExecutionID *string `json:"pendingActionExecutionId,omitempty"`
	Requested                bool    `json:"requested"`
}

// 17 §8 的持久运行投影摘要；不证明本机进程当前健康，不返回正文、凭据或隔离目录。
type AgentInstallationProjectionView struct {
	AgentVersionAssetID string                      `json:"agentVersionAssetId"`
	ConfigHash          string                      `json:"configHash"`
	Generation          int64                       `json:"generation"`
	RuntimeProfileKey   string                      `json:"runtimeProfileKey"`
	State               AgentRuntimeProjectionState `json:"state"`
}

// 03 §7、17 §8：同 Tenant、已准入 Workspace 且 fresh Installation Resource read 允许的只读事实；不授予 Version
// 正文、执行或管理权限。
type AgentInstallationView struct {
	ActiveProjectionGeneration *int64              `json:"activeProjectionGeneration,omitempty"`
	AgentPrincipalID           string              `json:"agentPrincipalId"`
	AgentPrincipalState        AgentPrincipalState `json:"agentPrincipalState"`
	AgentResourceID            string              `json:"agentResourceId"`
	// 同固定 Version、ACTIVE 投影与原生 Profile 已支持的 Automation 来源结果位置；普通 Agent 仍沿其固定回复策略，Automation
	// 则消息到原 Thread、Schedule/manual 到同 Workspace Channel。不代表 execute、Delegation 或 quota
	// 准入。缺失或空集合不支持 Schedule。
	AutomationResultTargets []AutomationResultTarget                  `json:"automationResultTargets,omitempty"`
	ChannelBinding          *AgentInstallationViewChannelBinding      `json:"channelBinding,omitempty"`
	ExecutionPermission     *AgentInstallationViewExecutionPermission `json:"executionPermission,omitempty"`
	OwnerPrincipalID        string                                    `json:"ownerPrincipalId"`
	PinnedVersionAssetID    string                                    `json:"pinnedVersionAssetId"`
	Projection              *ProjectionClass                          `json:"projection,omitempty"`
	ReadPermission          *AgentInstallationViewReadPermission      `json:"readPermission,omitempty"`
	ResourceID              string                                    `json:"resourceId"`
	ResourceState           ResourceState                             `json:"resourceState"`
	ResourceVersion         int64                                     `json:"resourceVersion"`
	State                   AgentInstallationState                    `json:"state"`
	WorkspaceID             string                                    `json:"workspaceId"`
}

type AgentInstallationViewChannelBinding struct {
	ChannelID *string              `json:"channelId,omitempty"`
	Status    ChannelBindingStatus `json:"status"`
	Triggers  []AgentTrigger       `json:"triggers"`
}

type AgentInstallationViewExecutionPermission struct {
	CanGrant                 bool    `json:"canGrant"`
	CanRevoke                bool    `json:"canRevoke"`
	Effective                bool    `json:"effective"`
	PendingActionExecutionID *string `json:"pendingActionExecutionId,omitempty"`
	Requested                bool    `json:"requested"`
}

type AgentInstallationViewReadPermission struct {
	CanGrant                 bool    `json:"canGrant"`
	CanRevoke                bool    `json:"canRevoke"`
	Effective                bool    `json:"effective"`
	PendingActionExecutionID *string `json:"pendingActionExecutionId,omitempty"`
	Requested                bool    `json:"requested"`
}

// 19 §5：复合游标走到原生末尾才 COMPLETE。BOUND_EXCEEDED/UNKNOWN 不是空库存；只是本次 best-effort head tuple
// snapshot，不是严格存量权威。
type AgentMemoryEntryPage struct {
	Entries                []EntryElement            `json:"entries"`
	InstallationResourceID string                    `json:"installationResourceId"`
	OperationID            string                    `json:"operationId"`
	State                  AgentMemoryEntryPageState `json:"state"`
	WorkspaceID            string                    `json:"workspaceId"`
}

// NIP-AE cold head tuple，不含 value；tombstone 是当前原生 head，不回退旧 value。
type EntryElement struct {
	CreatedAt int64  `json:"createdAt"`
	EventID   string `json:"eventId"`
	Slug      string `json:"slug"`
	Tombstone bool   `json:"tombstone"`
}

// NIP-AE cold head tuple，不含 value；tombstone 是当前原生 head，不回退旧 value。
type AgentMemoryEntryView struct {
	CreatedAt int64  `json:"createdAt"`
	EventID   string `json:"eventId"`
	Slug      string `json:"slug"`
	Tombstone bool   `json:"tombstone"`
}

// DD-66/68、19 §5：fresh HUMAN Installation read 后的原生 core/cold head。正文仅本次 no-store HTTP，不入
// Core 数据库、审计或客户端持久存储。ABSENT 不等于 UNREADABLE；tombstone 可带原 head 引用。
type AgentMemoryReadView struct {
	Content *string `json:"content,omitempty"`
	// UTF-8 bytes of the returned content string, not the whole native NIP-44 JSON body or a
	// billing measurement.
	ContentBytes           *int64                   `json:"contentBytes,omitempty"`
	CreatedAt              *int64                   `json:"createdAt,omitempty"`
	EventID                *string                  `json:"eventId,omitempty"`
	InstallationResourceID string                   `json:"installationResourceId"`
	OperationID            string                   `json:"operationId"`
	Slug                   string                   `json:"slug"`
	State                  AgentMemoryReadViewState `json:"state"`
	// FOUND only: native buzz mem hash of the exact UTF-8 value, used by strict patch baseHash;
	// not the JSON body or a stored plaintext copy.
	ValueHash   *string `json:"valueHash,omitempty"`
	WorkspaceID string  `json:"workspaceId"`
}

// DD-24/25/26：Definition 范围的受权版本配置目录，消费平台发布 RuntimeProfile 合同与已治理 Route。缺真实来源时两目录为空且
// canCreate=false；目录或 canCreate 不授予发布、安装和运行权限。
type AgentVersionConfigurationPage struct {
	AgentResourceID string                          `json:"agentResourceId"`
	CanCreate       bool                            `json:"canCreate"`
	NextOffset      *int64                          `json:"nextOffset"`
	Profiles        []RuntimeProfileDirectorySchema `json:"profiles"`
	ResourceVersion int64                           `json:"resourceVersion"`
	Routes          []RouteElement                  `json:"routes"`
}

type RuntimeProfileDirectorySchema struct {
	CapabilityContract PurpleCapabilityContract `json:"capabilityContract"`
	Key                string                   `json:"key"`
	Kind               RuntimeProfileKind       `json:"kind"`
	Status             string                   `json:"status"`
	WebAvailability    string                   `json:"webAvailability"`
}

type PurpleCapabilityContract struct {
	CapabilityRequirements []string `json:"capabilityRequirements"`
	MaxIdleTimeoutSeconds  int64    `json:"maxIdleTimeoutSeconds"`
	MaxParallelism         int64    `json:"maxParallelism"`
	MaxTurnDurationSeconds int64    `json:"maxTurnDurationSeconds"`
	ReplyPolicies          []string `json:"replyPolicies"`
	// 同一发布合同中回复策略键到 Buzz ResolvedPersona 原生布尔字段的显式映射；缺映射不表示支持。
	ReplyPolicyMappings []PurpleRuntimeReplyPolicyMapping `json:"replyPolicyMappings,omitempty"`
}

type PurpleRuntimeReplyPolicyMapping struct {
	BroadcastReplies bool   `json:"broadcastReplies"`
	Key              string `json:"key"`
	ThreadReplies    bool   `json:"threadReplies"`
}

// 03 §7、17 §3：同 Tenant、fresh read 与 Workspace scope 查证后的既有治理 Route 元数据。原生 revision/hash
// 已回读；不包含 provider 配置、正文、凭据或模型 endpoint，不证明某次执行已获准。
type RouteElement struct {
	HomeWorkspaceID        *string `json:"homeWorkspaceId"`
	NativeConfigHash       string  `json:"nativeConfigHash"`
	NativeConfigResourceID string  `json:"nativeConfigResourceId"`
	NativeRevision         int64   `json:"nativeRevision"`
	OwnerPrincipalID       string  `json:"ownerPrincipalId"`
	ResourceID             string  `json:"resourceId"`
	ResourceVersion        int64   `json:"resourceVersion"`
}

// DD-24/25、17 §3/8：同 Definition 下逐项 fresh Asset read 后的版本目录；DRAFT 可发现，PUBLISHED/RETIRED
// 不可编辑。nextOffset 属原始扫描窗口，空的受权页不证明全集为空。
type AgentVersionPage struct {
	AgentResourceID string           `json:"agentResourceId"`
	NextOffset      *int64           `json:"nextOffset"`
	ResourceVersion int64            `json:"resourceVersion"`
	Versions        []VersionElement `json:"versions"`
}

type VersionElement struct {
	AgentResourceID string `json:"agentResourceId"`
	AssetID         string `json:"assetId"`
	AssetVersion    int64  `json:"assetVersion"`
	// 当前 HUMAN 对此 exact DRAFT 的已登记 EXPLICIT publish 动作及 fresh Asset manage
	// 资格；缺字段不允许发布，不证明已安装或可运行。
	CanPublish *bool `json:"canPublish,omitempty"`
	// 当前 HUMAN 对此 exact PUBLISHED 的已登记 EXPLICIT retire 动作及 fresh Asset manage
	// 资格；缺字段不允许退役，退役只禁止新安装，保留既有安装与在途的固定版本。
	CanRetire *bool `json:"canRetire,omitempty"`
	// 当前 HUMAN 对此 exact DRAFT 的已登记 update 动作及 fresh Asset update 资格；缺字段不允许编辑，提交时仍重验。
	CanUpdate        *bool                    `json:"canUpdate,omitempty"`
	ConfigHash       string                   `json:"configHash"`
	Content          AgentVersionContentClass `json:"content"`
	Ordinal          int64                    `json:"ordinal"`
	OwnerPrincipalID string                   `json:"ownerPrincipalId"`
	State            AgentVersionState        `json:"state"`
}

// 03 §7、17 §3：同 Tenant、fresh read 与 Workspace scope 查证后的既有治理 Route 元数据。原生 revision/hash
// 已回读；不包含 provider 配置、正文、凭据或模型 endpoint，不证明某次执行已获准。
type AgentVersionRouteOption struct {
	HomeWorkspaceID        *string `json:"homeWorkspaceId"`
	NativeConfigHash       string  `json:"nativeConfigHash"`
	NativeConfigResourceID string  `json:"nativeConfigResourceId"`
	NativeRevision         int64   `json:"nativeRevision"`
	OwnerPrincipalID       string  `json:"ownerPrincipalId"`
	ResourceID             string  `json:"resourceId"`
	ResourceVersion        int64   `json:"resourceVersion"`
}

type AgentVersionView struct {
	AgentResourceID string `json:"agentResourceId"`
	AssetID         string `json:"assetId"`
	AssetVersion    int64  `json:"assetVersion"`
	// 当前 HUMAN 对此 exact DRAFT 的已登记 EXPLICIT publish 动作及 fresh Asset manage
	// 资格；缺字段不允许发布，不证明已安装或可运行。
	CanPublish *bool `json:"canPublish,omitempty"`
	// 当前 HUMAN 对此 exact PUBLISHED 的已登记 EXPLICIT retire 动作及 fresh Asset manage
	// 资格；缺字段不允许退役，退役只禁止新安装，保留既有安装与在途的固定版本。
	CanRetire *bool `json:"canRetire,omitempty"`
	// 当前 HUMAN 对此 exact DRAFT 的已登记 update 动作及 fresh Asset update 资格；缺字段不允许编辑，提交时仍重验。
	CanUpdate        *bool                    `json:"canUpdate,omitempty"`
	ConfigHash       string                   `json:"configHash"`
	Content          AgentVersionContentClass `json:"content"`
	Ordinal          int64                    `json:"ordinal"`
	OwnerPrincipalID string                   `json:"ownerPrincipalId"`
	State            AgentVersionState        `json:"state"`
}

// 当前HUMAN管理scope内的真实接入元数据。不是组件内部状态、配置、SecretRef或原生管理credential。
type ApplicationBindingPage struct {
	Bindings   []ApplicationBindingView `json:"bindings"`
	CanCreate  bool                     `json:"canCreate"`
	NextOffset *int64                   `json:"nextOffset,omitempty"`
}

type ApplicationBindingView struct {
	ActiveProjectionGeneration *int64                         `json:"activeProjectionGeneration,omitempty"`
	BindingID                  string                         `json:"bindingId"`
	CanDisable                 bool                           `json:"canDisable"`
	CapabilityCategories       []ApplicationBindingCapability `json:"capabilityCategories"`
	ComponentReleaseID         string                         `json:"componentReleaseId"`
	ComponentTypeKey           string                         `json:"componentTypeKey"`
	// Approved release declares an independent native page. Launch still freshly checks
	// binding, scope and deployment origins.
	HasNativePage *bool                   `json:"hasNativePage,omitempty"`
	State         ApplicationBindingState `json:"state"`
	TenantID      string                  `json:"tenantId"`
	Version       int64                   `json:"version"`
	WorkspaceID   *string                 `json:"workspaceId,omitempty"`
}

type ApplicationBindingCapability struct {
	Category string `json:"category"`
	Version  int64  `json:"version"`
}

// Authorized ACTIVE binding's independent native page. Exact origin is release and
// deployment approved; no native credential or page body is returned.
type ApplicationNativePage struct {
	AllowedOrigins       []string `json:"allowedOrigins"`
	BindingID            string   `json:"bindingId"`
	Origin               string   `json:"origin"`
	ProjectionGeneration int64    `json:"projectionGeneration"`
	URL                  string   `json:"url"`
}

// POST /api/v1/approvals/{workflowId}/decision 的请求体；approver 由 PlatformSession 决定。回应为
// ApprovalDecisionOutcome。
type ApprovalDecisionRequest struct {
	Decision ApprovalDecision `json:"decision"`
}

// GET /api/v1/approvals（待我审批）与 /api/v1/approvals/{workflowId} 的元素。状态只来自 Temporal history
// 的投影。
type ApprovalView struct {
	ActionExecutionID string `json:"actionExecutionId"`
	ActionKey         string `json:"actionKey"`
	// RFC3339，UTC
	ConsumeDeadline *string           `json:"consumeDeadline,omitempty"`
	Decisions       []DecisionElement `json:"decisions"`
	// RFC3339，UTC
	ExpiresAt            string                   `json:"expiresAt"`
	InitiatorPrincipalID string                   `json:"initiatorPrincipalId"`
	Observation          *ReasonCode              `json:"observation,omitempty"`
	Reason               *ReasonCode              `json:"reason,omitempty"`
	RoleRequirements     []RoleRequirementElement `json:"roleRequirements"`
	Status               ApprovalStatus           `json:"status"`
	TargetID             string                   `json:"targetId"`
	TargetType           string                   `json:"targetType"`
	WorkflowID           string                   `json:"workflowId"`
	WorkspaceID          *string                  `json:"workspaceId,omitempty"`
}

// 一条已形成的不可变决定。只有经 FreshApprovalAdmission 通过的 Update 才形成决定；decidedAt 取 workflow.Now()。
type DecisionElement struct {
	ApproverPrincipalID string `json:"approverPrincipalId"`
	// RFC3339，UTC
	DecidedAt string           `json:"decidedAt"`
	Decision  ApprovalDecision `json:"decision"`
	// 该 approver 在决定时经 fresh Check 满足的选择器；同一人可在多个要求中计数，但只产生一个决定
	SatisfiedSelectors []ApprovalSelector `json:"satisfiedSelectors"`
}

// ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
// §4）。
type RoleRequirementElement struct {
	MinDistinct int64            `json:"minDistinct"`
	Selector    ApprovalSelector `json:"selector"`
}

// GET /api/v1/audit/events 的有界回应：当前 Tenant（或其中一个 Workspace）范围内的审计事件，调用方须对该范围持有 audit
// permission，每次 fresh Check。证据只列种类，不含稳定 ID；稳定 ID 经单条解引用在同一授权下取得（.design/03 §14）。
type AuditEventPage struct {
	Events []AuditEventView `json:"events"`
	// 下一页首项之前的事件 ID；缺省即已经读完
	NextCursor *string `json:"nextCursor,omitempty"`
}

type AuditEventView struct {
	ActionKey            string              `json:"actionKey"`
	ActorPrincipalID     *string             `json:"actorPrincipalId,omitempty"`
	Decision             string              `json:"decision"`
	EventType            AuditEventType      `json:"eventType"`
	Evidence             []AuditEvidenceSlot `json:"evidence"`
	ID                   string              `json:"id"`
	InitiatorPrincipalID *string             `json:"initiatorPrincipalId,omitempty"`
	// RFC3339
	OccurredAt  string  `json:"occurredAt"`
	ResultCode  string  `json:"resultCode"`
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

type AuditEvidenceSlot struct {
	Authority *EvidenceAuthority `json:"authority,omitempty"`
	// 证据在该事件中的位置，解引用时使用
	Index int64 `json:"index"`
	// 存量种类不可识别时缺省
	Kind        *EvidenceKind        `json:"kind,omitempty"`
	Sensitivity *EvidenceSensitivity `json:"sensitivity,omitempty"`
}

// 实际 ACTIVE Grant 对该 Automation/run 的引用；不暴露 Secret、授予新权限或查询额度。
type AutomationDelegationView struct {
	DelegationID                   string `json:"delegationId"`
	DelegationVersion              int64  `json:"delegationVersion"`
	ExecutorInstallationResourceID string `json:"executorInstallationResourceId"`
	// RFC3339，UTC；与现有管理查询时间字段一致。
	ExpiresAt        string `json:"expiresAt"`
	OwnerPrincipalID string `json:"ownerPrincipalId"`
}

type AutomationDetailView struct {
	Automation AutomationElement `json:"automation"`
	// 当前 Resource manage；不是运行准入、额度允许或业务成功。
	CanManage bool `json:"canManage"`
	// 仅当前 ACTIVE HUMAN owner、Workspace membership 与 Resource execute，以及已启用固定版本允许显示手动运行；仍须原
	// automation.run 的准入、Delegation、额度及步骤审批。缺省关闭，不是业务成功。
	CanRun               *bool               `json:"canRun,omitempty"`
	Delegations          []DelegationElement `json:"delegations"`
	NextDelegationOffset *int64              `json:"nextDelegationOffset,omitempty"`
	NextVersionOffset    *int64              `json:"nextVersionOffset,omitempty"`
	Versions             []VersionClass      `json:"versions"`
}

type AutomationElement struct {
	DelegationID                   *string         `json:"delegationId,omitempty"`
	ExecutorInstallationResourceID string          `json:"executorInstallationResourceId"`
	OwnerPrincipalID               string          `json:"ownerPrincipalId"`
	PinnedVersionAssetID           *string         `json:"pinnedVersionAssetId,omitempty"`
	ResourceID                     string          `json:"resourceId"`
	ResourceState                  ResourceState   `json:"resourceState"`
	ResourceVersion                int64           `json:"resourceVersion"`
	State                          AutomationState `json:"state"`
	WorkspaceID                    string          `json:"workspaceId"`
}

// 实际 ACTIVE Grant 对该 Automation/run 的引用；不暴露 Secret、授予新权限或查询额度。
type DelegationElement struct {
	DelegationID                   string `json:"delegationId"`
	DelegationVersion              int64  `json:"delegationVersion"`
	ExecutorInstallationResourceID string `json:"executorInstallationResourceId"`
	// RFC3339，UTC；与现有管理查询时间字段一致。
	ExpiresAt        string `json:"expiresAt"`
	OwnerPrincipalID string `json:"ownerPrincipalId"`
}

// Core 自有 AutomationVersion 正文只在该 Asset fresh read 授权后返回；immutable Asset 三态复用既有版本契约。
type VersionClass struct {
	AssetID              string                        `json:"assetId"`
	AssetVersion         int64                         `json:"assetVersion"`
	AutomationResourceID string                        `json:"automationResourceId"`
	ConfigHash           string                        `json:"configHash"`
	Content              AutomationVersionContentClass `json:"content"`
	Ordinal              int64                         `json:"ordinal"`
	OwnerPrincipalID     string                        `json:"ownerPrincipalId"`
	State                AgentVersionState             `json:"state"`
}

type AutomationPage struct {
	Automations               []AutomationElement     `json:"automations"`
	AvailableApprovalPolicies []ApprovalPolicyElement `json:"availableApprovalPolicies,omitempty"`
	// 本次 fresh Workspace create 与已暴露真实动作共同成立；写前仍重新核验。
	CanCreate  bool   `json:"canCreate"`
	NextOffset *int64 `json:"nextOffset,omitempty"`
}

// GET /api/v1/automations/{resource_id}/runs：可读 Automation 的本人运行历史。游标只作分页，不授予权限；每页重新核验。
type AutomationRunPage struct {
	AutomationResourceID string `json:"automationResourceId"`
	// 不透明 createdAt/id 稳定分页边界；缺省表示本次查询没有更多行。
	NextCursor *string      `json:"nextCursor,omitempty"`
	Runs       []RunElement `json:"runs"`
}

// 本人发起的 automation.run；原 TaskProjection 与 UsageEvent 引用，不是新的运行权威。
type RunElement struct {
	// 原 TaskProjection 进度；缺省不推测百分比或成功。
	Progress *string `json:"progress,omitempty"`
	// 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
	StepApprovalTask *StepApprovalTaskClass `json:"stepApprovalTask,omitempty"`
	Task             StepApprovalTaskClass  `json:"task"`
	// 同 Tenant/Workspace/Operation 的原 UsageEvent 引用；不代表已结算，空集合不代表零用量。
	UsageEventIDS []string `json:"usageEventIds"`
}

// 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
//
// GET /api/v1/tasks 与 /api/v1/tasks/{actionExecutionId} 的元素：调用方本人发起的一个受治理动作。observation
// 非空时投影不可担保为当前（PROJECTION_DELAYED）或结果不明（EXTERNAL_RESULT_UNKNOWN），UI 不得把它渲染成成功或失败。
type StepApprovalTaskClass struct {
	ActionExecutionID  string          `json:"actionExecutionId"`
	ActionKey          string          `json:"actionKey"`
	ActionVersion      int64           `json:"actionVersion"`
	ApprovalStatus     *ApprovalStatus `json:"approvalStatus,omitempty"`
	ApprovalWorkflowID *string         `json:"approvalWorkflowId,omitempty"`
	// 仅任务详情且 Core 当前完成本人、权限、原 Workflow 运行事实重查后提供；提交时仍重新准入
	CancelActionKey *string `json:"cancelActionKey,omitempty"`
	// RFC3339，UTC
	CreatedAt     string              `json:"createdAt"`
	DispatchState ActionDispatchState `json:"dispatchState"`
	GateState     ActionGateState     `json:"gateState"`
	Observation   *ReasonCode         `json:"observation,omitempty"`
	OperationID   string              `json:"operationId"`
	Reason        *ReasonCode         `json:"reason,omitempty"`
	// 仅任务详情且 Core 证明原 Workflow 已关闭、终态投影一致、原目标仍在收敛版本并完成本人和权限重查后提供；提交与派发时仍重新准入
	RerunActionKey *string       `json:"rerunActionKey,omitempty"`
	TargetID       string        `json:"targetId"`
	TaskStatus     *TaskStatus   `json:"taskStatus,omitempty"`
	WaitingReason  *string       `json:"waitingReason,omitempty"`
	WorkflowID     *string       `json:"workflowId,omitempty"`
	WorkflowKind   *WorkflowKind `json:"workflowKind,omitempty"`
	WorkspaceID    *string       `json:"workspaceId,omitempty"`
}

// 本人发起的 automation.run；原 TaskProjection 与 UsageEvent 引用，不是新的运行权威。
type AutomationRunView struct {
	// 原 TaskProjection 进度；缺省不推测百分比或成功。
	Progress *string `json:"progress,omitempty"`
	// 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
	StepApprovalTask *StepApprovalTaskClass `json:"stepApprovalTask,omitempty"`
	Task             StepApprovalTaskClass  `json:"task"`
	// 同 Tenant/Workspace/Operation 的原 UsageEvent 引用；不代表已结算，空集合不代表零用量。
	UsageEventIDS []string `json:"usageEventIds"`
}

// Core 自有 AutomationVersion 正文只在该 Asset fresh read 授权后返回；immutable Asset 三态复用既有版本契约。
type AutomationVersionView struct {
	AssetID              string                        `json:"assetId"`
	AssetVersion         int64                         `json:"assetVersion"`
	AutomationResourceID string                        `json:"automationResourceId"`
	ConfigHash           string                        `json:"configHash"`
	Content              AutomationVersionContentClass `json:"content"`
	Ordinal              int64                         `json:"ordinal"`
	OwnerPrincipalID     string                        `json:"ownerPrincipalId"`
	State                AgentVersionState             `json:"state"`
}

type AutomationView struct {
	DelegationID                   *string         `json:"delegationId,omitempty"`
	ExecutorInstallationResourceID string          `json:"executorInstallationResourceId"`
	OwnerPrincipalID               string          `json:"ownerPrincipalId"`
	PinnedVersionAssetID           *string         `json:"pinnedVersionAssetId,omitempty"`
	ResourceID                     string          `json:"resourceId"`
	ResourceState                  ResourceState   `json:"resourceState"`
	ResourceVersion                int64           `json:"resourceVersion"`
	State                          AutomationState `json:"state"`
	WorkspaceID                    string          `json:"workspaceId"`
}

type CapabilityContractPage struct {
	CanRegister bool              `json:"canRegister"`
	Contracts   []ContractElement `json:"contracts"`
	NextOffset  *int64            `json:"nextOffset,omitempty"`
}

// 受权 Catalog 元数据，不复制 schema/测试向量或业务正文，不证明 release/binding 可用。
type ContractElement struct {
	CanApprove                    bool                     `json:"canApprove"`
	CanDeprecate                  bool                     `json:"canDeprecate"`
	CategoryKey                   string                   `json:"categoryKey"`
	ConformanceSuiteDigest        string                   `json:"conformanceSuiteDigest"`
	ContractVersion               int64                    `json:"contractVersion"`
	RegisteredByActionExecutionID string                   `json:"registeredByActionExecutionId"`
	SchemaSetDigest               string                   `json:"schemaSetDigest"`
	Status                        CapabilityContractStatus `json:"status"`
}

// 受权 Catalog 元数据，不复制 schema/测试向量或业务正文，不证明 release/binding 可用。
type CapabilityContractView struct {
	CanApprove                    bool                     `json:"canApprove"`
	CanDeprecate                  bool                     `json:"canDeprecate"`
	CategoryKey                   string                   `json:"categoryKey"`
	ConformanceSuiteDigest        string                   `json:"conformanceSuiteDigest"`
	ContractVersion               int64                    `json:"contractVersion"`
	RegisteredByActionExecutionID string                   `json:"registeredByActionExecutionId"`
	SchemaSetDigest               string                   `json:"schemaSetDigest"`
	Status                        CapabilityContractStatus `json:"status"`
}

// GET /api/v1/identity/client-keys 回应数组的元素：本人登记且未撤销的原生设备公钥（DD-77/79）。
type ClientKeyView struct {
	// RFC3339
	CreatedAt string            `json:"createdAt"`
	Pubkey    string            `json:"pubkey"`
	State     BuzzIdentityState `json:"state"`
}

// 设备公钥登记（POST /api/v1/identity/client-keys）与撤销（DELETE
// /api/v1/identity/client-keys/{pubkey}）的回应。
type ClientKeyStatus struct {
	Pubkey string `json:"pubkey"`
	// 状态仍在收敛时，客户端再次读取设备状态前至少等待的毫秒数；确定终态时缺省
	RecheckAfterMillis *int64            `json:"recheckAfterMillis,omitempty"`
	State              BuzzIdentityState `json:"state"`
	// 推进该状态的 Workflow；本次调用没有需要推进的状态时缺省
	WorkflowID *string `json:"workflowId,omitempty"`
}

// Core私网仅向受信Worker返回的逐次隔离探测凭据。token仅在Activity内存中使用，禁止进入Temporal输入、输出或报告。其声明绑定固定模拟上下文与完整实际参数，不授予生产binding授权。
type ComponentConformanceAuthorization struct {
	ExpectedResponseDigest string                        `json:"expectedResponseDigest"`
	Operation              ComponentConformanceOperation `json:"operation"`
	RequestDigest          string                        `json:"requestDigest"`
	RequestJSON            string                        `json:"requestJson"`
	Token                  string                        `json:"token"`
}

// Core原canonical_digest对同一已授权步骤实际响应的摘要；仅规范化事实，不声明套件通过或登记成功。
type ComponentConformanceWireDigests struct {
	RequestDigest  string  `json:"requestDigest"`
	ResponseDigest string  `json:"responseDigest"`
	ResultDigest   *string `json:"resultDigest,omitempty"`
}

// 受信Worker实际HTTP响应的瞬时核验输入。正文仅在Activity与Core请求内存中存在，不得进入Temporal历史、报告、日志或数据库；不是用户上传的通过声明。
type ComponentConformanceWireObservation struct {
	HTTPStatus   int64      `json:"httpStatus"`
	Probe        ProbeClass `json:"probe"`
	ResponseJSON string     `json:"responseJson"`
}

// 原 ComponentTaskWorkflow 的单个线协议 Activity 输入。步骤来自 Core 冻结计划；调度、尝试次数与 UNKNOWN 对账只由原 Temporal
// history 承接，不建立另一执行账本。
type ProbeClass struct {
	ContentReference *ContentReferenceClass `json:"contentReference,omitempty"`
	Plan             PlanClass              `json:"plan"`
	// 只查询同一步冻结幂等键；不再发送原 execute/CREATE。
	Reconcile *bool `json:"reconcile,omitempty"`
	StepIndex int64 `json:"stepIndex"`
}

// 受信 Worker 从 Core 取得的隔离执行输入。不是用户上传的通过声明；只含冻结引用与平台解释的数据，不含候选地址或凭据。顺序与全部内容进入 planDigest。
type PlanClass struct {
	ActionExecutionID  string         `json:"actionExecutionId"`
	ArtifactDigest     string         `json:"artifactDigest"`
	ComponentReleaseID string         `json:"componentReleaseId"`
	ConnectorKind      *ConnectorKind `json:"connectorKind,omitempty"`
	ContractDigests    []string       `json:"contractDigests"`
	// 独立隔离身份投递的完整规范化摘要，不含私钥或token，不是生产policy。
	IdentityDigest string `json:"identityDigest"`
	OperationID    string `json:"operationId"`
	PlanDigest     string `json:"planDigest"`
	// Core 冻结时为空；原 ComponentTaskWorkflow 启动后写入真实 Temporal run UUID。报告的 runId 仍必须为 UUID，Core 以
	// Describe 与同 workflow 的当前 TaskProjection 核对。
	RunID       string     `json:"runId"`
	Steps       []PlanStep `json:"steps"`
	SuiteDigest string     `json:"suiteDigest"`
	WorkflowID  string     `json:"workflowId"`
}

type PlanStep struct {
	CaseKey string `json:"caseKey"`
	// 只由 Core 从该 release implements 的 ACTIVE 契约步骤固定。存在时 expectedResponseJson 为该能力的业务结果，不是
	// native 任务元数据。
	ContractKey *string `json:"contractKey,omitempty"`
	// Adapter 为实际 HTTP 状态；MCP 原生结果固定 0，不以伪造 HTTP 状态证明协议成功。
	ExpectedHTTPStatus    int64                         `json:"expectedHttpStatus"`
	ExpectedMCPResultKind *MCPResultKind                `json:"expectedMcpResultKind,omitempty"`
	ExpectedResponseJSON  string                        `json:"expectedResponseJson"`
	IdempotencyKey        string                        `json:"idempotencyKey"`
	Operation             ComponentConformanceOperation `json:"operation"`
	ReferenceAssetID      *string                       `json:"referenceAssetId,omitempty"`
	ReferenceFromStepKey  *string                       `json:"referenceFromStepKey,omitempty"`
	ReferenceResourceID   *string                       `json:"referenceResourceId,omitempty"`
	RequestJSON           string                        `json:"requestJson"`
	StepKey               string                        `json:"stepKey"`
}

// 原受信Worker在原审批后的COMPONENT_RELEASE Activity报告实际自身能力。Core自行读取自身与当前Web事实，并重新核验原release套件和审批。
type ComponentReleaseApprovalReport struct {
	RunID       string           `json:"runId"`
	Target      TargetClass      `json:"target"`
	WorkerBuild WorkerBuildClass `json:"workerBuild"`
}

// 原ComponentTaskWorkflow的组件批准目标，只引用原准入与不可变release，不携带用户声明的兼容结论。
type TargetClass struct {
	ActionExecutionID  string `json:"actionExecutionId"`
	ComponentReleaseID string `json:"componentReleaseId"`
	WorkflowID         string `json:"workflowId"`
}

// 设计03的当前已部署主体能力事实，由原受信服务/当前Web产物观察产生，不接受管理表单声明。
type WorkerBuildClass struct {
	AdapterProtocolVersions []string          `json:"adapterProtocolVersions"`
	BuildID                 string            `json:"buildId"`
	ConnectorKinds          []string          `json:"connectorKinds,omitempty"`
	DriverRegistryKeys      []string          `json:"driverRegistryKeys"`
	HostAPIVersion          string            `json:"hostApiVersion"`
	MCPProtocolVersions     []string          `json:"mcpProtocolVersions,omitempty"`
	PlatformPortKeys        []PlatformPortKey `json:"platformPortKeys"`
	ReportedAt              time.Time         `json:"reportedAt"`
	Subject                 Subject           `json:"subject"`
}

// 受Catalog管理权限保护的已登记release元数据，正文与套件令牌不外露；REGISTERED不等于APPROVED或binding可用。
type ComponentReleasePage struct {
	CanApprove  *bool                  `json:"canApprove,omitempty"`
	CanRegister bool                   `json:"canRegister"`
	NextOffset  *int64                 `json:"nextOffset,omitempty"`
	Releases    []ComponentReleaseView `json:"releases"`
}

type ComponentReleaseView struct {
	ApprovedByActionExecutionID   *string                `json:"approvedByActionExecutionId,omitempty"`
	ArtifactDigest                string                 `json:"artifactDigest"`
	ComponentReleaseID            string                 `json:"componentReleaseId"`
	ComponentTypeKey              string                 `json:"componentTypeKey"`
	ManifestDigest                string                 `json:"manifestDigest"`
	OperationID                   string                 `json:"operationId"`
	RegisteredByActionExecutionID string                 `json:"registeredByActionExecutionId"`
	Status                        ComponentReleaseStatus `json:"status"`
	SuiteDigest                   string                 `json:"suiteDigest"`
	Version                       string                 `json:"version"`
	WorkflowID                    string                 `json:"workflowId"`
}

// 原准入同事务登记后的不可变引用；不是组件激活或审批回执。
type ComponentReleaseReceipt struct {
	ActionExecutionID  string                 `json:"actionExecutionId"`
	ComponentReleaseID string                 `json:"componentReleaseId"`
	PlanDigest         string                 `json:"planDigest"`
	Status             ComponentReleaseStatus `json:"status"`
}

// 原生私聊的完整 HUMAN Principal 参与者集合，必须包含当前 HUMAN；不接受设备公钥、CONTROL 身份或 Workspace 冒名。
type ConversationOpenRequest struct {
	ParticipantPrincipalIDS []string `json:"participantPrincipalIds"`
}

type ConversationPage struct {
	Items      []ItemElement `json:"items"`
	NextCursor *string       `json:"nextCursor,omitempty"`
}

// 已认证参与者可见的原 Relay 私聊引用，不包含消息正文。
type ItemElement struct {
	ChannelID               string    `json:"channelId"`
	ID                      string    `json:"id"`
	OperationID             string    `json:"operationId"`
	ParticipantPrincipalIDS []string  `json:"participantPrincipalIds"`
	State                   ItemState `json:"state"`
	Version                 int64     `json:"version"`
}

// 同租户当前有效 HUMAN 及其已投影真实身份公钥，不伪造用户资料。
type ConversationParticipant struct {
	DisplayName string   `json:"displayName"`
	PrincipalID string   `json:"principalId"`
	Pubkeys     []string `json:"pubkeys"`
}

type ConversationParticipantPage struct {
	Items           []ItemClass `json:"items"`
	MaxParticipants int64       `json:"maxParticipants"`
	NextCursor      *string     `json:"nextCursor,omitempty"`
}

// 同租户当前有效 HUMAN 及其已投影真实身份公钥，不伪造用户资料。
type ItemClass struct {
	DisplayName string   `json:"displayName"`
	PrincipalID string   `json:"principalId"`
	Pubkeys     []string `json:"pubkeys"`
}

// PUT /api/v1/user-state/conversations/{conversationId} 的请求体（DD-40）：参与者私聊的收藏与静音，复用同一
// CollaborationUserState version CAS。隐藏状态不在此权威。
type ConversationPreferenceRequest struct {
	Muted   bool  `json:"muted"`
	Starred bool  `json:"starred"`
	Version int64 `json:"version"`
}

// 已认证参与者可见的原 Relay 私聊引用，不包含消息正文。
type ConversationView struct {
	ChannelID               string    `json:"channelId"`
	ID                      string    `json:"id"`
	OperationID             string    `json:"operationId"`
	ParticipantPrincipalIDS []string  `json:"participantPrincipalIds"`
	State                   ItemState `json:"state"`
	Version                 int64     `json:"version"`
}

// 已授权普通 Action 的 v1 平台元数据结果；不含业务正文、邀请凭证、文档或协议会话。仅 agent.invoke、automation.run 及已接入普通
// resource 动作使用；与通用 BFF ActionSubmission 的可选扩展解耦。
type DelegatedActionMetadataV1 struct {
	ActionExecutionID  string              `json:"actionExecutionId"`
	ActionKey          string              `json:"actionKey"`
	ApprovalWorkflowID *string             `json:"approvalWorkflowId,omitempty"`
	DispatchState      ActionDispatchState `json:"dispatchState"`
	GateState          ActionGateState     `json:"gateState"`
	OperationID        string              `json:"operationId"`
	Reason             *ReasonCode         `json:"reason,omitempty"`
	WorkflowID         *string             `json:"workflowId,omitempty"`
}

type DiscoverableWorkspace struct {
	Channel   ChannelClass `json:"channel"`
	CreatedAt time.Time    `json:"createdAt"`
	ID        string       `json:"id"`
	// 已通过当前 HUMAN Workspace 准入，而非只表示 join 已受理。
	IsMember        bool                      `json:"isMember"`
	JoinActionKey   *JoinActionKey            `json:"joinActionKey,omitempty"`
	MemberCount     int64                     `json:"memberCount"`
	MembershipState *WorkspaceMembershipState `json:"membershipState,omitempty"`
	Visibility      WorkspaceVisibility       `json:"visibility"`
}

// Web 经 BFF 以本人身份读取已准入 Workspace 对应的原 Relay 39000 元数据；类型来自原生签名证据，不从消息列表推断，不另存业务正文。
type ChannelClass struct {
	Archived    bool        `json:"archived"`
	ChannelID   string      `json:"channelId"`
	ChannelType ChannelType `json:"channelType"`
	Description *string     `json:"description,omitempty"`
	Name        string      `json:"name"`
	TTLDeadline *time.Time  `json:"ttlDeadline,omitempty"`
	TTLSeconds  *int64      `json:"ttlSeconds,omitempty"`
}

type DiscoverableWorkspacePage struct {
	Items      []DiscoverableWorkspacePageItem `json:"items"`
	NextCursor *string                         `json:"nextCursor,omitempty"`
}

type DiscoverableWorkspacePageItem struct {
	Channel   ChannelClass `json:"channel"`
	CreatedAt time.Time    `json:"createdAt"`
	ID        string       `json:"id"`
	// 已通过当前 HUMAN Workspace 准入，而非只表示 join 已受理。
	IsMember        bool                      `json:"isMember"`
	JoinActionKey   *JoinActionKey            `json:"joinActionKey,omitempty"`
	MemberCount     int64                     `json:"memberCount"`
	MembershipState *WorkspaceMembershipState `json:"membershipState,omitempty"`
	Visibility      WorkspaceVisibility       `json:"visibility"`
}

// GET /api/v1/audit/events/{id}/evidence/{index} 的回应。每次以事件 scope 的当前 audit permission fresh
// 授权；每种证据另向其权威源查证原对象仍存在：明确不存在回 404（正文为 NOT_FOUND 的不可用视图），权威源不提供查证接口为 UNVERIFIABLE，权威源不可达回
// 503。不可用时不回任何 ref 内容。
type EvidenceView struct {
	Authority   *EvidenceAuthority   `json:"authority,omitempty"`
	Available   bool                 `json:"available"`
	Kind        *EvidenceKind        `json:"kind,omitempty"`
	Sensitivity *EvidenceSensitivity `json:"sensitivity,omitempty"`
	// 权威源中的稳定 ID；仅 available 为 true 时出现
	StableID          *string                    `json:"stableId,omitempty"`
	UnavailableReason *EvidenceUnavailableReason `json:"unavailableReason,omitempty"`
	// 该 ID 的版本；证据未登记版本时缺省
	Version *int64 `json:"version,omitempty"`
}

// POST /api/v1/invitations/redeem 的回应与 GET /api/v1/invitations/redemptions
// 的元素：兑换者自己看到的进度（DD-83）。membershipState=INVITED 且 admissionGateState=WAITING 表示等待 Tenant
// admin 确认；ACTIVE 即可登录该 Tenant；REVOKED 即本次邀请已终结，reason 给出原因。
type InvitationRedemptionView struct {
	AdmissionGateState ActionGateState       `json:"admissionGateState"`
	InvitationID       string                `json:"invitationId"`
	MembershipState    TenantMembershipState `json:"membershipState"`
	Reason             *ReasonCode           `json:"reason,omitempty"`
	// RFC3339，UTC
	RedeemedAt string `json:"redeemedAt"`
	TenantID   string `json:"tenantId"`
	TenantName string `json:"tenantName"`
}

// POST /api/v1/invitations/redeem 的请求体（DD-83）。兑换者身份只取网关投影的 issuer/subject，不接受请求体自报。
type InvitationRedemptionRequest struct {
	// 邀请链接 fragment 里的一次性凭据
	Credential string `json:"credential"`
	// 兑换者自报的显示名：只作展示，审批人据此与被邀请人对照，不参与任何判定
	DisplayName string `json:"displayName"`
}

// tenant.member.invite 首次回应里一次性出现的邀请（DD-83）。link 含明文凭据（在 URL fragment
// 里），服务端只存其摘要，之后任何回应都不再给出；丢失即撤回重发。
type IssuedInvitation struct {
	// RFC3339，UTC
	ExpiresAt    string `json:"expiresAt"`
	InvitationID string `json:"invitationId"`
	// 部署登记的链接基址 + '#' + 一次性凭据
	Link string `json:"link"`
}

// GET /api/v1/identity/legacy-secret-refs 的有界视图。只列当前 Tenant 中可发起 DD-85 归位的 SERVER
// binding，不暴露 locator、版本或私钥。
type LegacySecretRefPage struct {
	Bindings   []LegacySecretRefBinding `json:"bindings"`
	NextCursor *string                  `json:"nextCursor,omitempty"`
}

// 业务 Tenant 的旧 SERVER 身份引用；仅给有 tenant manage 权限的人展示。
type LegacySecretRefBinding struct {
	Kind        BindingKind `json:"kind"`
	PrincipalID string      `json:"principalId"`
	Pubkey      string      `json:"pubkey"`
}

// GET /api/v1/native/community 的回应，只对原生入口开放（DD-75/78）。relayUrl 的 authority 就是
// communityHost：Relay 按连接的 Host 绑定 Community，非默认端口属于 host（SF-BUZ-32、SF-BUZ-41）。
type NativeCommunityFacts struct {
	// 该 Tenant 的 Community host，可能带非默认端口
	CommunityHost string `json:"communityHost"`
	// 原生端直连的 Relay 地址
	RelayURL string `json:"relayUrl"`
}

// GET /api/v1/audit 回应数组的元素：调用方本人在当前 Tenant 内的动作（.design/03 §14 的最小集合）。
type OwnAuditEntry struct {
	ActionKey string         `json:"actionKey"`
	Decision  string         `json:"decision"`
	EventType AuditEventType `json:"eventType"`
	// RFC3339
	OccurredAt string `json:"occurredAt"`
	ResultCode string `json:"resultCode"`
	// 动作所在的 Workspace；Tenant 级动作（设备公钥登记、认证等）缺省
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// GET /api/v1/platform-info 的回应（DD-111）：只含公开展示字段，不依赖 PlatformSession
// 与身份解析，仍在网关入口的认证之后。displayName 取自部署配置 PLATFORM_DISPLAY_NAME，是界面上产品名的唯一来源。
type PlatformInfo struct {
	// 部署的显示名，去除首尾空白后非空
	DisplayName string `json:"displayName"`
}

// GET /api/v1/platform/tenants 的有界回应：只对 Platform Catalog Tenant 中持有 fresh Catalog manage
// 的会话开放，列出业务 Tenant 及其当前状态与可发起的暂停/恢复动作提示（DD-96）。动作提交仍由 Core 重新准入。
type PlatformTenantPage struct {
	// 下一页的 Core 索引偏移，缺省即读完
	NextOffset *int64               `json:"nextOffset,omitempty"`
	Tenants    []PlatformTenantView `json:"tenants"`
}

type PlatformTenantView struct {
	ID string `json:"id"`
	// 按该 Tenant 当前状态可发起的暂停（ACTIVE，或协作面 binding 为 ACTIVE 的 ERROR）或恢复（SUSPENDED）动作
	// key；目录未开放、处于收敛中或本页提示判定失败时省略
	LifecycleActionKey *TenantLifecycleActionKey `json:"lifecycleActionKey,omitempty"`
	Name               string                    `json:"name"`
	Slug               string                    `json:"slug"`
	State              TenantState               `json:"state"`
}

type PlatformToolPage struct {
	NextOffset *int64        `json:"nextOffset,omitempty"`
	Tools      []ToolElement `json:"tools"`
}

type ToolElement struct {
	ActionKey        ActionKey     `json:"actionKey"`
	CanConsume       bool          `json:"canConsume"`
	InputSchemaHash  string        `json:"inputSchemaHash"`
	Name             ActionKey     `json:"name"`
	OutputSchemaHash string        `json:"outputSchemaHash"`
	OwnerPrincipalID string        `json:"ownerPrincipalId"`
	ResourceID       string        `json:"resourceId"`
	ResourceState    ResourceState `json:"resourceState"`
	ResourceVersion  int64         `json:"resourceVersion"`
	Source           Source        `json:"source"`
	Status           ToolStatus    `json:"status"`
}

type PlatformToolView struct {
	ActionKey        ActionKey     `json:"actionKey"`
	CanConsume       bool          `json:"canConsume"`
	InputSchemaHash  string        `json:"inputSchemaHash"`
	Name             ActionKey     `json:"name"`
	OutputSchemaHash string        `json:"outputSchemaHash"`
	OwnerPrincipalID string        `json:"ownerPrincipalId"`
	ResourceID       string        `json:"resourceId"`
	ResourceState    ResourceState `json:"resourceState"`
	ResourceVersion  int64         `json:"resourceVersion"`
	Source           Source        `json:"source"`
	Status           ToolStatus    `json:"status"`
}

// 03/18: only the initiating HUMAN's fresh-authorized original Session facts. No PAT,
// launch credential, native body or replacement revision is recoverable from this reader.
type ProtocolSessionView struct {
	ActionExecutionID      string                   `json:"actionExecutionId"`
	AdmittedMode           TedMode                  `json:"admittedMode"`
	ApplicationBindingID   string                   `json:"applicationBindingId"`
	BaseRevision           string                   `json:"baseRevision"`
	EffectiveEditorOrigins []string                 `json:"effectiveEditorOrigins"`
	ExpiresAt              time.Time                `json:"expiresAt"`
	LaunchLocale           Locale                   `json:"launchLocale"`
	LaunchTheme            Theme                    `json:"launchTheme"`
	ProtocolSessionID      string                   `json:"protocolSessionId"`
	Reference              ContentReferenceClass    `json:"reference"`
	ResultRevision         *string                  `json:"resultRevision,omitempty"`
	State                  ProtocolSessionViewState `json:"state"`
	TenantID               string                   `json:"tenantId"`
	Version                int64                    `json:"version"`
	WorkspaceID            *string                  `json:"workspaceId,omitempty"`
}

// PUT /api/v1/user-state/read 的请求体（DD-40、03 §2）。contextKey 只接受调用方可读 Workspace 内的 Channel
// ID、msg:<Buzz event id> 或 thread:<Buzz root event id>；version 是读到的 CollaborationUserState
// 版本，不符即 409。
type ReadMarkRequest struct {
	ContextKey string `json:"contextKey"`
	// RFC3339，Core 统一存成 UTC
	LastReadAt string `json:"lastReadAt"`
	Version    int64  `json:"version"`
}

// GET /api/v1/role-members 的有界回应。只列当前 Tenant 的 ACTIVE HUMAN 成员；角色从 SpiceDB fresh
// 读取，动作可用性只作界面提示，提交时仍重新准入（DD-82）。
type RoleMemberPage struct {
	Members []RoleMemberView `json:"members"`
	// 下一页首项之前的 Principal ID；缺省即已经读完
	NextCursor *string `json:"nextCursor,omitempty"`
}

type RoleMemberView struct {
	CanGrantTenantAdmin     bool   `json:"canGrantTenantAdmin"`
	CanGrantWorkspaceAdmin  bool   `json:"canGrantWorkspaceAdmin"`
	CanRevokeTenantAdmin    bool   `json:"canRevokeTenantAdmin"`
	CanRevokeWorkspaceAdmin bool   `json:"canRevokeWorkspaceAdmin"`
	DisplayName             string `json:"displayName"`
	// 有效 Tenant admin 仅剩此人；该人的撤销按钮禁用，服务端最终准入仍重查
	LastTenantAdmin bool   `json:"lastTenantAdmin"`
	PrincipalID     string `json:"principalId"`
	TenantAdmin     bool   `json:"tenantAdmin"`
	// 没有 workspaceId 时恒为 false
	WorkspaceAdmin bool `json:"workspaceAdmin"`
}

// GET /api/v1/role-workspaces 的有界回应：当前 Principal 对哪些 Workspace 持有 fresh manage
// permission（ACTIVE、暂停中、已暂停、恢复中，以及已有协作面 binding 的 ERROR，各带当前状态），并附当前可用的 Workspace
// 创建、暂停与恢复动作提示。动作提交仍由 Core 重新准入，不等于可进入频道。
type RoleWorkspacePage struct {
	// 当前 Principal 经 fresh Tenant create 检查可见的动作 key；目录未开放或无权时省略
	CreateActionKey *CreateActionKey `json:"createActionKey,omitempty"`
	// 下一页的 Core 索引偏移；不暴露无权 Workspace 的 ID，缺省即读完
	NextOffset *int64              `json:"nextOffset,omitempty"`
	Workspaces []RoleWorkspaceView `json:"workspaces"`
}

type RoleWorkspaceView struct {
	ID string `json:"id"`
	// 当前 Principal 经 fresh Tenant manage 检查、按该 Workspace 当前状态可发起的暂停（ACTIVE 或
	// ERROR）或恢复（SUSPENDED）动作 key；目录未开放、无权、处于收敛中或本页提示判定失败时省略
	LifecycleActionKey *WorkspaceLifecycleActionKey `json:"lifecycleActionKey,omitempty"`
	Name               string                       `json:"name"`
	State              WorkspaceState               `json:"state"`
}

// GET /api/v1/session 的回应：已解析的执行身份与本次 PlatformSession。原生端以 platformSessionId
// 绑定设备持钥证明（DD-79）。
type PlatformSessionView struct {
	AccessMode PlatformSessionAccessMode `json:"accessMode"`
	// 当前选定的 Workspace；未选定时缺省
	CurrentWorkspaceID *string `json:"currentWorkspaceId,omitempty"`
	// HumanIdentity 的显示名，只用于界面上认出本人，不参与任何判定
	DisplayName        string `json:"displayName"`
	HumanIdentityID    string `json:"humanIdentityId"`
	PlatformSessionID  string `json:"platformSessionId"`
	TenantID           string `json:"tenantId"`
	TenantMembershipID string `json:"tenantMembershipId"`
	TenantPrincipalID  string `json:"tenantPrincipalId"`
}

// GET /api/v1/tasks 与 /api/v1/tasks/{actionExecutionId} 的元素：调用方本人发起的一个受治理动作。observation
// 非空时投影不可担保为当前（PROJECTION_DELAYED）或结果不明（EXTERNAL_RESULT_UNKNOWN），UI 不得把它渲染成成功或失败。
type TaskView struct {
	ActionExecutionID  string          `json:"actionExecutionId"`
	ActionKey          string          `json:"actionKey"`
	ActionVersion      int64           `json:"actionVersion"`
	ApprovalStatus     *ApprovalStatus `json:"approvalStatus,omitempty"`
	ApprovalWorkflowID *string         `json:"approvalWorkflowId,omitempty"`
	// 仅任务详情且 Core 当前完成本人、权限、原 Workflow 运行事实重查后提供；提交时仍重新准入
	CancelActionKey *string `json:"cancelActionKey,omitempty"`
	// RFC3339，UTC
	CreatedAt     string              `json:"createdAt"`
	DispatchState ActionDispatchState `json:"dispatchState"`
	GateState     ActionGateState     `json:"gateState"`
	Observation   *ReasonCode         `json:"observation,omitempty"`
	OperationID   string              `json:"operationId"`
	Reason        *ReasonCode         `json:"reason,omitempty"`
	// 仅任务详情且 Core 证明原 Workflow 已关闭、终态投影一致、原目标仍在收敛版本并完成本人和权限重查后提供；提交与派发时仍重新准入
	RerunActionKey *string       `json:"rerunActionKey,omitempty"`
	TargetID       string        `json:"targetId"`
	TaskStatus     *TaskStatus   `json:"taskStatus,omitempty"`
	WaitingReason  *string       `json:"waitingReason,omitempty"`
	WorkflowID     *string       `json:"workflowId,omitempty"`
	WorkflowKind   *WorkflowKind `json:"workflowKind,omitempty"`
	WorkspaceID    *string       `json:"workspaceId,omitempty"`
}

// GET /api/v1/invitations 回应数组的元素：本 Tenant 的邀请，只对持有 Tenant manage
// 的人可见（DD-83）。不含凭据或其摘要。兑换后的确认经 approvalWorkflowId 走既有的审批决定端点。
type TenantInvitationView struct {
	AdmitActionExecutionID *string         `json:"admitActionExecutionId,omitempty"`
	ApprovalStatus         *ApprovalStatus `json:"approvalStatus,omitempty"`
	ApprovalWorkflowID     *string         `json:"approvalWorkflowId,omitempty"`
	// RFC3339，UTC
	CreatedAt string `json:"createdAt"`
	// RFC3339，UTC
	ExpiresAt    string `json:"expiresAt"`
	InvitationID string `json:"invitationId"`
	// 邀请人写给审批人看的称呼，不参与寻址与判定
	InviteeLabel       string                 `json:"inviteeLabel"`
	InviterPrincipalID string                 `json:"inviterPrincipalId"`
	MembershipID       *string                `json:"membershipId,omitempty"`
	MembershipState    *TenantMembershipState `json:"membershipState,omitempty"`
	// RFC3339，UTC；只在 REDEEMED 时出现
	RedeemedAt *string `json:"redeemedAt,omitempty"`
	// 兑换者自报的显示名，只作展示
	RedeemerDisplayName *string                `json:"redeemerDisplayName,omitempty"`
	Status              TenantInvitationStatus `json:"status"`
}

// CollaborationUserState 写入成功后的新版本（PUT /api/v1/user-state/read 与 PUT
// /api/v1/user-state/workspaces/{workspaceId} 的 200 回应）。
type UserStateVersion struct {
	Version int64 `json:"version"`
}

// Web 经 BFF 以本人身份读取已准入 Workspace 对应的原 Relay 39000 元数据；类型来自原生签名证据，不从消息列表推断，不另存业务正文。
type WebChannelView struct {
	Archived    bool        `json:"archived"`
	ChannelID   string      `json:"channelId"`
	ChannelType ChannelType `json:"channelType"`
	Description *string     `json:"description,omitempty"`
	Name        string      `json:"name"`
	TTLDeadline *time.Time  `json:"ttlDeadline,omitempty"`
	TTLSeconds  *int64      `json:"ttlSeconds,omitempty"`
}

// 原 Buzz 线程分页的复合游标；下一请求以 before=createdAt、beforeId=eventId 原样提交，避免同秒回复丢失。
type WebMessageCursor struct {
	CreatedAt int64  `json:"createdAt"`
	EventID   string `json:"eventId"`
}

// 同一已准入 Channel 的原生消息分页或线程读取。before/beforeId 必须成对，频道窗口向前翻历史，线程沿原 Relay
// 协议向后读回复；上界来自运行时配置与原协议上界，不接受任意 Relay filter。
type WebMessageQuery struct {
	Before        *int64          `json:"before,omitempty"`
	BeforeID      *string         `json:"beforeId,omitempty"`
	MessageType   *WebMessageType `json:"messageType,omitempty"`
	ParentEventID *string         `json:"parentEventId,omitempty"`
}

// Own Buzz kind:0 metadata. The authenticated host chooses the signer and Tenant; no raw
// event, author, relay URL or management tags are accepted. Omitted fields are preserved;
// empty strings explicitly clear a field.
type WebProfileUpdateRequest struct {
	About       *string `json:"about,omitempty"`
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	DisplayName *string `json:"displayName,omitempty"`
	// Read snapshot guard only. Core derives the signer from the active identity; a mismatch
	// rejects without publication.
	ExpectedPubkey string  `json:"expectedPubkey"`
	IdempotencyKey string  `json:"idempotencyKey"`
	Nip05Handle    *string `json:"nip05Handle,omitempty"`
}

// Current own profile read from Buzz, never a Core profile copy. An absent kind:0 is an
// empty profile, not a fabricated event.
type WebProfileView struct {
	About *string `json:"about"`
	// Same-origin BFF paths for exact media URLs on the current community. A read projection,
	// never an upload or remote proxy authority.
	AvatarMediaPaths map[string]string `json:"avatarMediaPaths"`
	AvatarURL        *string           `json:"avatarUrl"`
	DisplayName      *string           `json:"displayName"`
	EventID          *string           `json:"eventId"`
	Nip05Handle      *string           `json:"nip05Handle"`
	Pubkey           string            `json:"pubkey"`
}

// Web HUMAN 的原 Buzz 消息语义输入；身份、Channel、回复祖先与 mention 公钥均由 BFF 在原 scope 中解析，不接受 raw tags 或
// signed event。
type WebPublishMessageRequest struct {
	Attachments []WebMessageAttachment `json:"attachments,omitempty"`
	Content     string                 `json:"content"`
	// 用户明确选中的本 Workspace Installation；缺省为空，BFF 排序去重并冻结于原发布幂等记录。
	MentionInstallationIDS []string        `json:"mentionInstallationIds,omitempty"`
	MessageType            *WebMessageType `json:"messageType,omitempty"`
	// 原 Relay 消息引用；BFF 在当前 Channel 回读验签并解析 NIP-10 祖先。
	ParentEventID *string `json:"parentEventId,omitempty"`
}

type WebMessageAttachment struct {
	// 原 Buzz imeta filename；仅为显示及下载名称，不参与媒体存储寻址。
	Filename *string `json:"filename,omitempty"`
	Sha256   string  `json:"sha256"`
	Size     int64   `json:"size"`
	// 沿原 Buzz Markdown 隐藏图片或视频；普通文件仍为文件链接。
	Spoiler *bool  `json:"spoiler,omitempty"`
	Type    string `json:"type"`
	URL     string `json:"url"`
}

// GET /api/v1/workspaces 回应数组的元素：调用方有 ACTIVE WorkspaceMembership 且两侧 binding 都 ACTIVE 的
// Workspace。Workspace id 同时是其 Channel id（DD-80）。
type WorkspaceView struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
	// Core 产品可见性，不从 Relay private 投影推断；旧回应可能省略。
	Visibility *WorkspaceVisibility `json:"visibility,omitempty"`
}

// GET /api/v1/workspaces/{workspaceId}/members 回应数组的元素，按人聚合（DD-77）。
type WorkspaceMemberView struct {
	DisplayName string `json:"displayName"`
	PrincipalID string `json:"principalId"`
	// 此人全部 ACTIVE 的 Buzz 协议公钥：Web 一把，另加每台原生设备一把
	Pubkeys []string                 `json:"pubkeys"`
	State   WorkspaceMembershipState `json:"state"`
}

// PUT /api/v1/user-state/workspaces/{workspaceId} 的请求体（DD-40）：该 Workspace 的收藏与静音。version
// 是读到的 CollaborationUserState 版本，不符即 409；updatedAt 由 Core 用库时钟补写，不取调用方的值。
type WorkspacePreferenceRequest struct {
	Muted   bool  `json:"muted"`
	Starred bool  `json:"starred"`
	Version int64 `json:"version"`
}

// DD-49/70/71/94：Core-only签发投递。只有版本化OpenBao引用及Agent已发布JWKS文件引用，不含私钥正文。
type ActionTokenSigningDelivery struct {
	Issuer          string `json:"issuer"`
	JwksFile        string `json:"jwksFile"`
	PrivateKeyField string `json:"privateKeyField"`
	SecretAudience  string `json:"secretAudience"`
	SecretLocator   string `json:"secretLocator"`
	SecretVersion   int64  `json:"secretVersion"`
	TokenSeconds    int64  `json:"tokenSeconds"`
}

// Installation 只取自受验签的 Invocation Session，不接受调用方目标覆盖。
type AgentMemoryEntryListInput struct {
}

// 只读当前 Invocation Installation 的 cold mem entry，不接受 core 或其他 Installation。
type AgentMemoryEntryReadInput struct {
	Slug string `json:"slug"`
}

// HUMAN Memory Action 本次瞬态输入；正文仅用于原生 NIP-AE 构造，不进入 ActionExecution、审计、outbox 或 history。
type AgentMemoryWriteInput struct {
	// entry.patch 当前原生 value 的 SHA-256。
	BaseHash *string `json:"baseHash,omitempty"`
	// 调用方实际读取的 head；null 只表示原生确认不存在。
	ExpectedHeadEventID *string `json:"expectedHeadEventId,omitempty"`
	// 原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
	ExpectedHeadState ExpectedHeadState `json:"expectedHeadState"`
	// entry.patch 的原生严格 unified diff，不支持 fuzz、offset 或多文件。
	Patch *string `json:"patch,omitempty"`
	Slug  string  `json:"slug"`
	// core.replace 的 profile 或 entry.set 的 value；完整序列化 JSON body 必须满足原生 NIP-44 上界。
	Value *string `json:"value,omitempty"`
}

// 03 §7、17 §3 的 requested 行为内容；不含 owner、Workspace、凭据、provider 地址或 host
// environment。发布不等于安装或运行授权。
type AgentVersionContent struct {
	// 精确 contract_key@version，不引用业务能力实现名。
	CapabilityRequirements  []string                                `json:"capabilityRequirements"`
	DeclaredToolResourceIDS []string                                `json:"declaredToolResourceIds"`
	Instructions            string                                  `json:"instructions"`
	MemoryPolicy            AgentVersionContentMemoryPolicyClass    `json:"memoryPolicy"`
	ModelRouteResourceID    string                                  `json:"modelRouteResourceId"`
	Parallelism             int64                                   `json:"parallelism"`
	PersonaIdentity         AgentVersionContentPersonaIdentityClass `json:"personaIdentity"`
	// RuntimeProfile capability contract 所声明的回复策略键；不隐式授予触发或读取权限。
	ReplyPolicy          string                             `json:"replyPolicy"`
	RuntimeProfileKey    string                             `json:"runtimeProfileKey"`
	SkillVersionAssetIDS []string                           `json:"skillVersionAssetIds"`
	TriggerDefaults      []AgentTrigger                     `json:"triggerDefaults"`
	TurnLimits           AgentVersionContentTurnLimitsClass `json:"turnLimits"`
}

type AgentVersionContentMemoryPolicyClass struct {
	ColdWrite AgentMemoryColdWrite `json:"coldWrite"`
	CoreWrite AgentMemoryCoreWrite `json:"coreWrite"`
}

type AgentVersionContentPersonaIdentityClass struct {
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	Description *string `json:"description,omitempty"`
	DisplayName string  `json:"displayName"`
}

type AgentVersionContentTurnLimitsClass struct {
	IdleTimeoutSeconds     int64 `json:"idleTimeoutSeconds"`
	MaxTurnDurationSeconds int64 `json:"maxTurnDurationSeconds"`
}

// DD-94部署投递面：adapter服务引用解析到固定部署产物/原生实例与受限传输。不是Catalog或业务授权。
type ApplicationAdapterDirectory struct {
	Adapters []ApplicationAdapterDelivery `json:"adapters"`
	// 受控部署事实，不是 Tool 注册表或业务授权；原生 MCP peer 不接收 ActionToken。
	ProtocolPeers []ApplicationProtocolPeerDelivery `json:"protocolPeers,omitempty"`
}

type ApplicationAdapterDelivery struct {
	ActionTokenAudience       string                               `json:"actionTokenAudience"`
	AdapterServiceRef         string                               `json:"adapterServiceRef"`
	ArtifactDigest            string                               `json:"artifactDigest"`
	BaseURL                   string                               `json:"baseUrl"`
	MaxResponseBytes          int64                                `json:"maxResponseBytes"`
	MCPURL                    *string                              `json:"mcpUrl,omitempty"`
	ModelCredentialDeliveries []ApplicationModelCredentialDelivery `json:"modelCredentialDeliveries,omitempty"`
	NativeInstanceRef         string                               `json:"nativeInstanceRef"`
	SecretReaders             []AdapterSecretReader                `json:"secretReaders"`
	TimeoutSeconds            int64                                `json:"timeoutSeconds"`
}

// 受控原生模型凭据交接回执；无密钥值，不创建模型，不替代OpenBao审计或binding准入。
type ApplicationModelCredentialDelivery struct {
	BindingID          string                           `json:"bindingId"`
	ConfigDigest       string                           `json:"configDigest"`
	Generation         int64                            `json:"generation"`
	NativeModelRef     string                           `json:"nativeModelRef"`
	NativeProof        string                           `json:"nativeProof"`
	NativeScopeRef     string                           `json:"nativeScopeRef"`
	RequestID          string                           `json:"requestId"`
	RouteResourceID    string                           `json:"routeResourceId"`
	SecretRef          ApplicationModelServiceSecretRef `json:"secretRef"`
	ServicePrincipalID string                           `json:"servicePrincipalId"`
	VerificationNonce  string                           `json:"verificationNonce"`
}

type ApplicationModelServiceSecretRef struct {
	Audience string `json:"audience"`
	Locator  string `json:"locator"`
	Version  int64  `json:"version"`
}

type AdapterSecretReader struct {
	Audience           string `json:"audience"`
	RoleName           string `json:"roleName"`
	ServicePrincipalID string `json:"servicePrincipalId"`
}

type ApplicationProtocolPeerDelivery struct {
	AdapterServiceRef         string                                   `json:"adapterServiceRef"`
	ArtifactDigest            string                                   `json:"artifactDigest"`
	Bindings                  []ApplicationProtocolPeerBindingDelivery `json:"bindings"`
	MaxResponseBytes          int64                                    `json:"maxResponseBytes"`
	MCPURL                    string                                   `json:"mcpUrl"`
	ModelCredentialDeliveries []ApplicationModelCredentialDelivery     `json:"modelCredentialDeliveries,omitempty"`
	NativeInstanceRef         string                                   `json:"nativeInstanceRef"`
	SecretReaders             []ProtocolPeerSecretReader               `json:"secretReaders,omitempty"`
	TimeoutSeconds            int64                                    `json:"timeoutSeconds"`
}

type ApplicationProtocolPeerBindingDelivery struct {
	BindingID            string `json:"bindingId"`
	ConfigDigest         string `json:"configDigest"`
	CredentialGeneration *int64 `json:"credentialGeneration,omitempty"`
	IsolationMode        string `json:"isolationMode"`
	// 原受控投递映射：无secret值；精确版本由Core以原audience读取并向Gateway独占文件投递。
	NativeCredentials []ApplicationPeerCredentialDelivery `json:"nativeCredentials,omitempty"`
	// 绑定已有原生对象的受控投递事实，不创建对象或授予权限；父项唯一固定实例与作用域。
	NativeResources    []ApplicationNativeResourceDelivery `json:"nativeResources,omitempty"`
	NativeScopeRef     string                              `json:"nativeScopeRef"`
	ServicePrincipalID string                              `json:"servicePrincipalId"`
	TenantID           string                              `json:"tenantId"`
	WorkspaceID        *string                             `json:"workspaceId,omitempty"`
}

type ApplicationPeerCredentialDelivery struct {
	Audience  string `json:"audience"`
	Header    string `json:"header"`
	Locator   string `json:"locator"`
	Prefix    string `json:"prefix"`
	SecretKey string `json:"secretKey"`
	Version   int64  `json:"version"`
}

type ApplicationNativeResourceDelivery struct {
	EvidenceDigest string `json:"evidenceDigest"`
	EvidenceRef    string `json:"evidenceRef"`
	NativeRef      string `json:"nativeRef"`
	NativeType     string `json:"nativeType"`
	TypeKey        string `json:"typeKey"`
}

type ProtocolPeerSecretReader struct {
	Audience           string `json:"audience"`
	RoleName           string `json:"roleName"`
	ServicePrincipalID string `json:"servicePrincipalId"`
}

// DD-88/94：pin 已批准 release 的业务绑定选择。只携带 SecretRef，不接受密钥正文或运行端点 URL。Workspace 取原
// ActionCommand。
type ApplicationBindingCreate struct {
	AdapterServiceRef    string                                            `json:"adapterServiceRef"`
	BindingID            string                                            `json:"bindingId"`
	CallIdentityMode     ApplicationCallIdentityMode                       `json:"callIdentityMode"`
	CapabilityCategories []ApplicationBindingCreateCapabilityCategoryClass `json:"capabilityCategories"`
	ComponentReleaseID   string                                            `json:"componentReleaseId"`
	IsolationMode        ApplicationIsolationMode                          `json:"isolationMode"`
	ModelCallMode        ApplicationModelCallMode                          `json:"modelCallMode"`
	NativeInstanceRef    string                                            `json:"nativeInstanceRef"`
	NativeScopeRef       *string                                           `json:"nativeScopeRef,omitempty"`
	NormalizedConfigJSON string                                            `json:"normalizedConfigJson"`
	RetainOnTenantDelete bool                                              `json:"retainOnTenantDelete"`
	SecretRefs           []ApplicationBindingCreateSecretRefClass          `json:"secretRefs"`
	ServicePrincipalID   string                                            `json:"servicePrincipalId"`
}

type ApplicationBindingCreateCapabilityCategoryClass struct {
	Category string `json:"category"`
	Version  int64  `json:"version"`
}

type ApplicationBindingCreateSecretRefClass struct {
	Audience  string `json:"audience"`
	Locator   string `json:"locator"`
	SecretKey string `json:"secretKey"`
	Version   int64  `json:"version"`
}

// DD-92: modelGateway within the approved binding config. Only existing route and meter
// references; no provider configuration, credential value or native model row.
type ApplicationModelGatewayConfig struct {
	MeterKeys        []string `json:"meterKeys"`
	RouteResourceIDS []string `json:"routeResourceIds"`
}

// DD-107 同 Tenant automation.run 的显式已登记审批策略；版本精确冻结，不授予审批权限。
type AutomationApprovalPolicyRef struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
}

// Temporal IntervalSpec 的显式秒数；offset 小于 every，catchupWindow 不小于原生的 10 秒。Overlap 固定
// SKIP，不另实现 cron。
type AutomationScheduleSpec struct {
	CatchupWindowSeconds int64 `json:"catchupWindowSeconds"`
	EverySeconds         int64 `json:"everySeconds"`
	OffsetSeconds        int64 `json:"offsetSeconds"`
}

// REQ-23、DD-107、03 §7 的不可变自动化版本。Schedule 使用 Temporal 原生 interval，不含消息正文、provider 配置或凭据。
type AutomationVersionContent struct {
	Action         AutomationVersionContentActionClass  `json:"action"`
	ApprovalPolicy *ApprovalPolicyElement               `json:"approvalPolicy,omitempty"`
	ResultTarget   AutomationResultTarget               `json:"resultTarget"`
	Trigger        AutomationVersionContentTriggerClass `json:"trigger"`
}

type AutomationVersionContentActionClass struct {
	Kind     ActionKind `json:"kind"`
	Template string     `json:"template"`
}

type AutomationVersionContentTriggerClass struct {
	Kind               AutomationTriggerKind `json:"kind"`
	MentionPrincipalID *string               `json:"mentionPrincipalId,omitempty"`
	ScheduleSpec       *ScheduleSpecClass    `json:"scheduleSpec,omitempty"`
	TextPrefix         *string               `json:"textPrefix,omitempty"`
}

// DD-102 / ADR-12：能力契约固定的机器向量。每个 case 按 steps 顺序执行契约操作，参数与预期结果是实际
// JSON，不执行文本代码。格式有效不表示组件套件通过；线协议性质、真实执行与 release 证据关联另行核验。
type CapabilityConformanceVectors struct {
	Cases         []Case                 `json:"cases"`
	FormatVersion CapabilityVectorFormat `json:"formatVersion"`
}

type Case struct {
	CaseKey string `json:"caseKey"`
	Steps   []Step `json:"steps"`
}

type Step struct {
	ContractKey        string  `json:"contractKey"`
	ExpectedOutputJSON string  `json:"expectedOutputJson"`
	InputJSON          string  `json:"inputJson"`
	ReferenceAssetID   *string `json:"referenceAssetId,omitempty"`
	// 只引用同 case 已成功的更早 stepKey 的唯一 typed ContentReference；不得指定 JSON 路径或表达式。与固定 Resource/Asset
	// 目标一起进入规范化参数 hash。
	ReferenceFromStepKey *string `json:"referenceFromStepKey,omitempty"`
	ReferenceResourceID  *string `json:"referenceResourceId,omitempty"`
	StepKey              string  `json:"stepKey"`
}

// 固定 Catalog 自然键，不授予业务能力 consume 权限。
type CapabilityContractRef struct {
	CategoryKey     string `json:"categoryKey"`
	ContractVersion int64  `json:"contractVersion"`
}

// DD-102：平台管理员登记实际 schema 与一致性测试向量。Core 按实际 canonical JSON 计算摘要并固定原内容；不接受只填摘要。
type CapabilityContractRegistration struct {
	CategoryKey               string                                                       `json:"categoryKey"`
	ContentReferenceSemantics CapabilityContractRegistrationContentReferenceSemanticsClass `json:"contentReferenceSemantics"`
	ContractVersion           int64                                                        `json:"contractVersion"`
	OperationContracts        []CapabilityContractRegistrationOperationContractClass       `json:"operationContracts"`
	ProtocolSessionKinds      []string                                                     `json:"protocolSessionKinds"`
	RequiredDeclarations      []CapabilityRequiredDeclaration                              `json:"requiredDeclarations"`
	ResourceTypeFamily        []CapabilityContractRegistrationResourceTypeFamilyClass      `json:"resourceTypeFamily"`
	SchemaDocuments           []string                                                     `json:"schemaDocuments"`
	// CapabilityConformanceVectors 的 JSON 编码，formatVersion 固定格式；任意自然语言对象数组不构成可执行向量。Core
	// 校验所有步骤参数/结果符合契约 schema，覆盖所有 operationContracts，然后固定 canonical digest。
	TestVectorsJSON string `json:"testVectorsJson"`
}

type CapabilityContractRegistrationContentReferenceSemanticsClass struct {
	AuthorizationTargetRule string `json:"authorizationTargetRule"`
	NativeObjectRefRule     string `json:"nativeObjectRefRule"`
	NativeRevisionRule      string `json:"nativeRevisionRule"`
}

type CapabilityContractRegistrationOperationContractClass struct {
	ContractKey        string               `json:"contractKey"`
	InputSchemaDigest  string               `json:"inputSchemaDigest"`
	OutputSchemaDigest string               `json:"outputSchemaDigest"`
	Permission         CapabilityPermission `json:"permission"`
	Surface            CapabilitySurface    `json:"surface"`
	TargetType         string               `json:"targetType"`
}

type CapabilityContractRegistrationResourceTypeFamilyClass struct {
	Kind    string `json:"kind"`
	TypeKey string `json:"typeKey"`
}

// Kailo HUMAN 通过原 ActionCommand 调用确切 APPLICATION 能力动作。参数是组件原生持久内容引用，不把 SQL、提示或结果正文写入
// Core/Temporal。
type ComponentActionInput struct {
	ActionVersion               int64                 `json:"actionVersion"`
	InputReference              ContentReferenceClass `json:"inputReference"`
	ResultExposurePolicyID      string                `json:"resultExposurePolicyId"`
	ResultExposurePolicyVersion int64                 `json:"resultExposurePolicyVersion"`
}

// 07§8A 的隔离环境投递配置，不是 Catalog/binding 权威。由运维配置精确绑定已装载候选 artifact；逐次短期模拟 token 仅由 Core
// 对实际请求签发，不接受静态凭据文件或用户 action 自报地址。
type ComponentConformanceEnvironment struct {
	AdapterBaseURL   string `json:"adapterBaseUrl"`
	ArtifactDigest   string `json:"artifactDigest"`
	MaxResponseBytes int64  `json:"maxResponseBytes"`
	MaxSteps         int64  `json:"maxSteps"`
}

// 隔离开发环境受控投递的协议夹具数据，不来自登记请求。Core 只采用固定协议用例并核对全部必需覆盖；没有脚本、条件、路径表达式或通过声明。
type ComponentConformanceFixture struct {
	ArtifactDigest string     `json:"artifactDigest"`
	Steps          []PlanStep `json:"steps"`
}

// 仅用于07§8A隔离套件的模拟上下文投递。不是生产 Catalog、Delegation 或
// ResultExposurePolicy。独立密钥/issuer/audience；其完整摘要固定在原登记计划。
type ComponentConformanceIdentity struct {
	ArtifactDigest  string                                `json:"artifactDigest"`
	Audience        string                                `json:"audience"`
	Contexts        []ComponentConformanceIdentityContext `json:"contexts"`
	Issuer          string                                `json:"issuer"`
	JwksFile        string                                `json:"jwksFile"`
	PrivateKeyField string                                `json:"privateKeyField"`
	SecretAudience  string                                `json:"secretAudience"`
	SecretLocator   string                                `json:"secretLocator"`
	SecretVersion   int64                                 `json:"secretVersion"`
	TokenSeconds    int64                                 `json:"tokenSeconds"`
}

type ComponentConformanceIdentityContext struct {
	ActionDefinitionVersion     int64                    `json:"actionDefinitionVersion"`
	ActionKey                   string                   `json:"actionKey"`
	ActorPrincipalID            string                   `json:"actorPrincipalId"`
	CaseKey                     string                   `json:"caseKey"`
	Operation                   AdapterProtocolOperation `json:"operation"`
	ResultExposurePolicyID      string                   `json:"resultExposurePolicyId"`
	ResultExposurePolicyVersion int64                    `json:"resultExposurePolicyVersion"`
	StepKey                     string                   `json:"stepKey"`
	TargetID                    *string                  `json:"targetId,omitempty"`
	TargetType                  string                   `json:"targetType"`
	TenantID                    string                   `json:"tenantId"`
	WorkspaceID                 *string                  `json:"workspaceId,omitempty"`
}

// 原 COMPONENT_CONFORMANCE_ENVIRONMENT_FILE 的 PROTOCOL_PEER 分支，仅隔离套件运行事实；readOnlyTools
// 固定隔离实例实际上可安全执行的只读探针，不授予生产业务权限。
type ComponentProtocolPeerEnvironment struct {
	ArtifactDigest       string   `json:"artifactDigest"`
	InitializeResultJSON string   `json:"initializeResultJson"`
	ListResultJSON       string   `json:"listResultJson"`
	MaxResponseBytes     int64    `json:"maxResponseBytes"`
	MaxSteps             int64    `json:"maxSteps"`
	MCPURL               string   `json:"mcpUrl"`
	ReadOnlyTools        []string `json:"readOnlyTools"`
	TimeoutSeconds       int64    `json:"timeoutSeconds"`
}

// 原ComponentTaskWorkflow的组件批准目标，只引用原准入与不可变release，不携带用户声明的兼容结论。
type ComponentReleaseApprovalTarget struct {
	ActionExecutionID  string `json:"actionExecutionId"`
	ComponentReleaseID string `json:"componentReleaseId"`
	WorkflowID         string `json:"workflowId"`
}

// 组件登记只提交实际 manifest、包清单与 binding config schema；不接收 suite 通过声明、报告或候选执行地址。Core 解析并冻结内容，原
// Worker 独立执行隔离套件。
type ComponentReleaseRegistration struct {
	BindingConfigSchemaJSON string `json:"bindingConfigSchemaJson"`
	ManifestJSON            string `json:"manifestJson"`
	PackageJSON             string `json:"packageJson"`
}

// design03 的唯一内容引用线格式；不是业务正文。Adapter typed 槽是传递引用的唯一来源，resultJson 不用于识别或重建引用。
type ContentReference struct {
	AssetID         *string `json:"assetId,omitempty"`
	DisplayName     string  `json:"displayName"`
	MediaType       string  `json:"mediaType"`
	NativeObjectRef string  `json:"nativeObjectRef"`
	NativeRevision  string  `json:"nativeRevision"`
	ResourceID      string  `json:"resourceId"`
}

type DelegationGrantParameters struct {
	ExpiresAt time.Time      `json:"expiresAt"`
	MaxUses   *int64         `json:"maxUses,omitempty"`
	Scopes    []ScopeElement `json:"scopes"`
	ValidFrom time.Time      `json:"validFrom"`
}

// 03 §6 的确切 Action/target/exposure 限制；管理发现与原 Grant 写入共用，发现不授予 permission。
type DelegationScopeParameters struct {
	ActionKey          string             `json:"actionKey"`
	ActionVersion      int64              `json:"actionVersion"`
	CreateWorkspaceID  *string            `json:"createWorkspaceId,omitempty"`
	OutputSchemaHash   string             `json:"outputSchemaHash"`
	RedactionPolicy    string             `json:"redactionPolicy"`
	ResultExposureMode ResultExposureMode `json:"resultExposureMode"`
	TargetID           *string            `json:"targetId,omitempty"`
	TargetType         string             `json:"targetType"`
	ToolResourceID     *string            `json:"toolResourceId,omitempty"`
}

// DD-95/103: transient, fixed-origin launch returned by the admitted binding adapter;
// credentials are only string form fields, never a persisted Task, chat or ContentReference.
type DocumentLaunchDescriptor struct {
	ActionURL    string            `json:"actionUrl"`
	EditorOrigin string            `json:"editorOrigin"`
	ExpiresAt    string            `json:"expiresAt"`
	FormFields   map[string]string `json:"formFields"`
	Method       Method            `json:"method"`
}

// 统一错误体（apps/06-工程基线规范.md 第 4 节）。不携带业务正文、secret、原始 SQL、文件内容或完整 prompt/response。
type ErrorBody struct {
	Class ErrorClass `json:"class"`
	// 贯穿 Core、Worker、adapter 与组件的关联键
	OperationID *string    `json:"operationId,omitempty"`
	Reason      ReasonCode `json:"reason"`
}

// BFF 从内网身份 header 解析出的执行身份（.design/09）。它只由已验证的 issuer/subject 推导，不接受调用方自报的任何字段。
type ResolvedIdentity struct {
	// 当前选定的 Workspace；未选定时缺省
	CurrentWorkspaceID *string `json:"currentWorkspaceId,omitempty"`
	HumanIdentityID    string  `json:"humanIdentityId"`
	TenantID           string  `json:"tenantId"`
	TenantMembershipID string  `json:"tenantMembershipId"`
	TenantPrincipalID  string  `json:"tenantPrincipalId"`
}

// 受治理 Route 创建只传原生配置与同 Tenant OpenBao 凭据的确切引用。providerCredentialMode 必须明确提供：NONE
// 仅表示固定原生提供方配置不使用认证；SECRET_REF 必须有确切引用。端点、模型正文与 key 不进入 Core 参数。
type LlmRouteCreateInput struct {
	Model                  Model                                 `json:"model"`
	Provider               Model                                 `json:"provider"`
	ProviderCredentialMode LlmProviderCredentialMode             `json:"providerCredentialMode"`
	ProviderSecretRef      *LlmRouteCreateInputProviderSecretRef `json:"providerSecretRef,omitempty"`
}

type LlmRouteCreateInputProviderSecretRef struct {
	Audience string `json:"audience"`
	Locator  string `json:"locator"`
	Version  int64  `json:"version"`
}

// 18: native authenticated file-menu metadata from the Adapter typed reference producer.
// This is NOT Action admission; the normal Kailo HUMAN session must independently
// fresh-admit the frozen target and version. No ticket or content bytes.
type NativeDocumentSelection struct {
	ActionKey       NativeDocumentSelectionActionKey `json:"actionKey"`
	ActionVersion   int64                            `json:"actionVersion"`
	BindingID       string                           `json:"bindingId"`
	Generation      int64                            `json:"generation"`
	Reference       ContentReferenceClass            `json:"reference"`
	ResourceVersion int64                            `json:"resourceVersion"`
	WorkspaceID     string                           `json:"workspaceId"`
}

// 设计03的当前已部署主体能力事实，由原受信服务/当前Web产物观察产生，不接受管理表单声明。
type PlatformBuildInfo struct {
	AdapterProtocolVersions []string          `json:"adapterProtocolVersions"`
	BuildID                 string            `json:"buildId"`
	ConnectorKinds          []string          `json:"connectorKinds,omitempty"`
	DriverRegistryKeys      []string          `json:"driverRegistryKeys"`
	HostAPIVersion          string            `json:"hostApiVersion"`
	MCPProtocolVersions     []string          `json:"mcpProtocolVersions,omitempty"`
	PlatformPortKeys        []PlatformPortKey `json:"platformPortKeys"`
	ReportedAt              time.Time         `json:"reportedAt"`
	Subject                 Subject           `json:"subject"`
}

// 03/07/18: the original HUMAN file protocol action, not an arbitrary editor or native URL.
// Revision and presentation are frozen once; session expiry comes from controlled Core
// delivery.
type ProtocolSessionOpenInput struct {
	ActionVersion int64 `json:"actionVersion"`
	// The selected native source binding; must equal the target's real binding, not an
	// authorization claim.
	ApplicationBindingID string `json:"applicationBindingId"`
	Locale               Locale `json:"locale"`
	// Exact approved projection selected by the native menu; never latest.
	ProjectionGeneration int64                 `json:"projectionGeneration"`
	Reference            ContentReferenceClass `json:"reference"`
	Theme                Theme                 `json:"theme"`
}

type ResourceCreate struct {
	EvidenceDigest string `json:"evidenceDigest"`
	EvidenceRef    string `json:"evidenceRef"`
	NativeRef      string `json:"nativeRef"`
	NativeType     string `json:"nativeType"`
	TypeKey        string `json:"typeKey"`
}

// 03 §7 的平台发布 Catalog 投递，不是用户 Resource 或 Agent 注册表。部署没有提供实际合同、凭据链与 runtime 对账证据时不得填 ACTIVE。
type RuntimeProfileDirectory struct {
	Profiles []Profile `json:"profiles"`
}

type Profile struct {
	CapabilityContract FluffyCapabilityContract `json:"capabilityContract"`
	Key                string                   `json:"key"`
	Kind               RuntimeProfileKind       `json:"kind"`
	Status             string                   `json:"status"`
	WebAvailability    string                   `json:"webAvailability"`
}

type FluffyCapabilityContract struct {
	CapabilityRequirements []string `json:"capabilityRequirements"`
	MaxIdleTimeoutSeconds  int64    `json:"maxIdleTimeoutSeconds"`
	MaxParallelism         int64    `json:"maxParallelism"`
	MaxTurnDurationSeconds int64    `json:"maxTurnDurationSeconds"`
	ReplyPolicies          []string `json:"replyPolicies"`
	// 同一发布合同中回复策略键到 Buzz ResolvedPersona 原生布尔字段的显式映射；缺映射不表示支持。
	ReplyPolicyMappings []FluffyRuntimeReplyPolicyMapping `json:"replyPolicyMappings,omitempty"`
}

type FluffyRuntimeReplyPolicyMapping struct {
	BroadcastReplies bool   `json:"broadcastReplies"`
	Key              string `json:"key"`
	ThreadReplies    bool   `json:"threadReplies"`
}

// Workflow 经 ProjectTaskState Activity 写回 Core 的一次状态跃迁（.design/06 §3.1）。Core 按 workflowId
// 单调 upsert，eventId 不大于已有值的报告按幂等成功忽略。
type TaskStateReport struct {
	// 报告时的 history 长度；同一 workflow 内单调，重放时取到同一值
	EventID       int64      `json:"eventId"`
	Progress      *string    `json:"progress,omitempty"`
	RunID         string     `json:"runId"`
	Status        TaskStatus `json:"status"`
	WaitingReason *string    `json:"waitingReason,omitempty"`
	// 固定格式的业务 workflow ID
	WorkflowID string `json:"workflowId"`
}

// Core 在 Temporal Start 之前持久化的唯一引用（.design/06）。workflowId 一律取
// platform:<kind>:<tenantId>:<primaryEntityId>:<entityVersion>（前缀是协议常量，不随部署显示名变化；ADR-17
// 迁移窗口内的存量引用仍为旧前缀），使「不分配第二个业务 workflow ID」可被机械校验。
type WorkflowRef struct {
	// RFC3339；Describe 返回 NotFound 时用它判断是否仍在 retention 窗口内
	CreatedAt       string       `json:"createdAt"`
	EntityVersion   int64        `json:"entityVersion"`
	Kind            WorkflowKind `json:"kind"`
	PrimaryEntityID string       `json:"primaryEntityId"`
	// Start 成功后回填；未知时缺省
	RunID    *string `json:"runId,omitempty"`
	TenantID string  `json:"tenantId"`
	// 固定格式的业务 workflow ID
	WorkflowID string `json:"workflowId"`
}

// workspace.create 的 Buzz 原生频道元数据。只用于创建时向 Relay 物化，不建立第二份频道内容权威。缺省保留旧命令的 stream 行为。
type WorkspaceChannelCreate struct {
	ChannelType ChannelType `json:"channelType"`
	Description *string     `json:"description,omitempty"`
	// 原 Buzz 临时频道的不活跃期限（秒）。省略为长期频道；Relay 原生消息活动续期，原生 reaper 到期归档，不表示 Workspace 暂停或删除。
	TTLSeconds *int64 `json:"ttlSeconds,omitempty"`
}

// 请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
type AffectedOwnerRef struct {
	OwnerPrincipalID string `json:"ownerPrincipalId"`
	TargetID         string `json:"targetId"`
	TargetType       string `json:"targetType"`
	TargetVersion    int64  `json:"targetVersion"`
}

// 唯一安装 Workflow 推进同一 ActionExecution/version/generation；取消接收不是原生清理终态。
type AgentInstallationAdvanceRequest struct {
	ActionExecutionID    string `json:"actionExecutionId"`
	AgentVersionAssetID  string `json:"agentVersionAssetId"`
	CancelRequested      bool   `json:"cancelRequested"`
	InstallationID       string `json:"installationId"`
	ProjectionGeneration int64  `json:"projectionGeneration"`
	RunID                string `json:"runId"`
	WorkflowID           string `json:"workflowId"`
}

// Core 查证后的安装生命周期状态；身份/模型/记忆/runtime 未闭合只返回 RUNNING/UNKNOWN，不把 spawn 当 ACTIVE。
type AgentInstallationAdvanceResult struct {
	InstallationID string     `json:"installationId"`
	Status         TaskStatus `json:"status"`
	WaitingReason  string     `json:"waitingReason"`
}

// DD-25/48：既有 ComponentTaskWorkflow 的 AGENT_INSTALLATION 冻结目标；不含凭据或 Version 正文。
type AgentInstallationWorkflowTarget struct {
	ActionExecutionID    string `json:"actionExecutionId"`
	AgentVersionAssetID  string `json:"agentVersionAssetId"`
	InstallationID       string `json:"installationId"`
	ProjectionGeneration int64  `json:"projectionGeneration"`
}

// Worker 推进已冻结 Invocation；未知原生结果只观察，不再次 turn/start。
type AgentTaskAdvanceRequest struct {
	ActivityID                 string `json:"activityId"`
	AgentVersionAssetID        string `json:"agentVersionAssetId"`
	Attempt                    int64  `json:"attempt"`
	CancelRequested            bool   `json:"cancelRequested"`
	HeartbeatIntervalSeconds   int64  `json:"heartbeatIntervalSeconds"`
	InstallationID             string `json:"installationId"`
	InvocationID               string `json:"invocationId"`
	ObservationIntervalSeconds int64  `json:"observationIntervalSeconds"`
	ProjectionGeneration       int64  `json:"projectionGeneration"`
	RunID                      string `json:"runId"`
	WorkflowID                 string `json:"workflowId"`
}

// Core 查证的引用与状态；native completed 缺 reply/usage 证据仍 RUNNING。
type AgentTaskAdvanceResult struct {
	ApprovalInput      *ApprovalInputClass `json:"approvalInput,omitempty"`
	ApprovalWorkflowID *string             `json:"approvalWorkflowId,omitempty"`
	// 已查证安全停止此 Activity；不等于 Invocation 成功或 Capacity 已释放。
	FinishActivity bool       `json:"finishActivity"`
	InvocationID   string     `json:"invocationId"`
	Status         TaskStatus `json:"status"`
	WaitingReason  string     `json:"waitingReason"`
}

// ApprovalWorkflow 的冻结输入（.design/06 §4）。运行中不得更换 Tenant、Workspace、target、参数摘要或策略版本；意图改变时建立新
// ActionExecution。
type ApprovalInputClass struct {
	ActionDefinitionVersion int64                     `json:"actionDefinitionVersion"`
	ActionExecutionID       string                    `json:"actionExecutionId"`
	ActionKey               string                    `json:"actionKey"`
	AffectedOwnerRefs       []AffectedOwnerRefElement `json:"affectedOwnerRefs"`
	// APPROVED 之后等待 consume 的上界；超时自动 INVALIDATED
	ConsumeWindowSeconds int64 `json:"consumeWindowSeconds"`
	// RFC3339，UTC。Core 按 ApprovalPolicy.expires_in 在请求时冻结；Workflow 以 workflow.Now() 与之比较
	ExpiresAt            string                   `json:"expiresAt"`
	InitiatorPrincipalID string                   `json:"initiatorPrincipalId"`
	OperationID          string                   `json:"operationId"`
	OwnerRequirement     ApprovalOwnerRequirement `json:"ownerRequirement"`
	ParameterHash        string                   `json:"parameterHash"`
	PolicyID             string                   `json:"policyId"`
	PolicyVersion        int64                    `json:"policyVersion"`
	Resume               *ResumeClass             `json:"resume,omitempty"`
	RoleRequirements     []RoleRequirementElement `json:"roleRequirements"`
	SelfApproval         ApprovalSelfApproval     `json:"selfApproval"`
	TargetID             string                   `json:"targetId"`
	TargetType           string                   `json:"targetType"`
	TenantID             string                   `json:"tenantId"`
	// TENANT_ONLY 动作缺省
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// 请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
type AffectedOwnerRefElement struct {
	OwnerPrincipalID string `json:"ownerPrincipalId"`
	TargetID         string `json:"targetId"`
	TargetType       string `json:"targetType"`
	TargetVersion    int64  `json:"targetVersion"`
}

// ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
// 才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
type ResumeClass struct {
	// RFC3339，UTC
	ConsumedAt *string `json:"consumedAt,omitempty"`
	// RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
	ConsumeDeadline *string           `json:"consumeDeadline,omitempty"`
	Decisions       []DecisionElement `json:"decisions"`
	// 此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
	// 从零数起，不加上它续跑后的投影会被当成旧事件丢掉
	EventBase int64            `json:"eventBase"`
	Reason    *ReasonCode      `json:"reason,omitempty"`
	Refusals  []RefusalElement `json:"refusals"`
	Status    ApprovalStatus   `json:"status"`
}

// 一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
// §4）。
type RefusalElement struct {
	ApproverPrincipalID string     `json:"approverPrincipalId"`
	Reason              ReasonCode `json:"reason"`
}

// DD-47/48：固定 AgentInvocation 与版本/投影引用；不携带 prompt、token 或原生正文。
type AgentTaskWorkflowInput struct {
	AgentVersionAssetID        string `json:"agentVersionAssetId"`
	CancelPending              bool   `json:"cancelPending"`
	EventBase                  int64  `json:"eventBase"`
	HeartbeatIntervalSeconds   int64  `json:"heartbeatIntervalSeconds"`
	HeartbeatTimeoutSeconds    int64  `json:"heartbeatTimeoutSeconds"`
	InstallationID             string `json:"installationId"`
	InvocationID               string `json:"invocationId"`
	ObservationIntervalSeconds int64  `json:"observationIntervalSeconds"`
	ProjectionGeneration       int64  `json:"projectionGeneration"`
}

type ApplicationBindingAdvanceRequest struct {
	CancelRequested bool                                   `json:"cancelRequested"`
	RunID           string                                 `json:"runId"`
	Target          ApplicationBindingAdvanceRequestTarget `json:"target"`
}

type ApplicationBindingAdvanceRequestTarget struct {
	ActionExecutionID string `json:"actionExecutionId"`
	BindingID         string `json:"bindingId"`
	BindingVersion    int64  `json:"bindingVersion"`
	WorkflowID        string `json:"workflowId"`
}

type ApplicationBindingAdvanceResult struct {
	BindingID     string     `json:"bindingId"`
	Status        TaskStatus `json:"status"`
	WaitingReason string     `json:"waitingReason"`
}

type ApplicationBindingTarget struct {
	ActionExecutionID string `json:"actionExecutionId"`
	BindingID         string `json:"bindingId"`
	BindingVersion    int64  `json:"bindingVersion"`
	WorkflowID        string `json:"workflowId"`
}

// consume、invalidate、withdraw 三个 Update 的结果：执行后的 Approval 状态。
type ApprovalControlOutcome struct {
	Status ApprovalStatus `json:"status"`
}

// decide Update 的结果。admitted=false 表示 FreshApprovalAdmission 未通过，这次 Update 没有形成决定；decision
// 是该 approver 已记录的决定（重复同值时即原决定）。
type ApprovalDecisionOutcome struct {
	Admitted            bool   `json:"admitted"`
	ApproverPrincipalID string `json:"approverPrincipalId"`
	// 已形成的决定；admitted=false 时缺省
	Decision *ApprovalDecision `json:"decision,omitempty"`
	// admitted=false 时的拒绝原因
	Reason *ReasonCode    `json:"reason,omitempty"`
	Status ApprovalStatus `json:"status"`
}

// 一条已形成的不可变决定。只有经 FreshApprovalAdmission 通过的 Update 才形成决定；decidedAt 取 workflow.Now()。
type ApprovalDecisionRecord struct {
	ApproverPrincipalID string `json:"approverPrincipalId"`
	// RFC3339，UTC
	DecidedAt string           `json:"decidedAt"`
	Decision  ApprovalDecision `json:"decision"`
	// 该 approver 在决定时经 fresh Check 满足的选择器；同一人可在多个要求中计数，但只产生一个决定
	SatisfiedSelectors []ApprovalSelector `json:"satisfiedSelectors"`
}

// decide Update 的参数。Update ID 固定为 <approval_workflow_id>:<approver_principal_id>，由 Server
// 侧去重；approverPrincipalId 由 Core 从 PlatformSession 取得，不接受 Browser 自报。
type ApprovalDecisionUpdate struct {
	ApproverPrincipalID string           `json:"approverPrincipalId"`
	Decision            ApprovalDecision `json:"decision"`
}

// ApprovalWorkflow 的冻结输入（.design/06 §4）。运行中不得更换 Tenant、Workspace、target、参数摘要或策略版本；意图改变时建立新
// ActionExecution。
type ApprovalWorkflowInput struct {
	ActionDefinitionVersion int64                     `json:"actionDefinitionVersion"`
	ActionExecutionID       string                    `json:"actionExecutionId"`
	ActionKey               string                    `json:"actionKey"`
	AffectedOwnerRefs       []AffectedOwnerRefElement `json:"affectedOwnerRefs"`
	// APPROVED 之后等待 consume 的上界；超时自动 INVALIDATED
	ConsumeWindowSeconds int64 `json:"consumeWindowSeconds"`
	// RFC3339，UTC。Core 按 ApprovalPolicy.expires_in 在请求时冻结；Workflow 以 workflow.Now() 与之比较
	ExpiresAt            string                   `json:"expiresAt"`
	InitiatorPrincipalID string                   `json:"initiatorPrincipalId"`
	OperationID          string                   `json:"operationId"`
	OwnerRequirement     ApprovalOwnerRequirement `json:"ownerRequirement"`
	ParameterHash        string                   `json:"parameterHash"`
	PolicyID             string                   `json:"policyId"`
	PolicyVersion        int64                    `json:"policyVersion"`
	Resume               *ResumeClass             `json:"resume,omitempty"`
	RoleRequirements     []RoleRequirementElement `json:"roleRequirements"`
	SelfApproval         ApprovalSelfApproval     `json:"selfApproval"`
	TargetID             string                   `json:"targetId"`
	TargetType           string                   `json:"targetType"`
	TenantID             string                   `json:"tenantId"`
	// TENANT_ONLY 动作缺省
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// invalidate Update 的参数：Core 在批准后重新准入不通过时发出（.design/06 §4）。Update ID 固定为
// <action_execution_id>:invalidate。
type ApprovalInvalidateUpdate struct {
	Reason ReasonCode `json:"reason"`
}

// 一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
// §4）。
type ApprovalRefusal struct {
	ApproverPrincipalID string     `json:"approverPrincipalId"`
	Reason              ReasonCode `json:"reason"`
}

// ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
// 才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
type ApprovalResume struct {
	// RFC3339，UTC
	ConsumedAt *string `json:"consumedAt,omitempty"`
	// RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
	ConsumeDeadline *string           `json:"consumeDeadline,omitempty"`
	Decisions       []DecisionElement `json:"decisions"`
	// 此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
	// 从零数起，不加上它续跑后的投影会被当成旧事件丢掉
	EventBase int64            `json:"eventBase"`
	Reason    *ReasonCode      `json:"reason,omitempty"`
	Refusals  []RefusalElement `json:"refusals"`
	Status    ApprovalStatus   `json:"status"`
}

// ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
// §4）。
type ApprovalRoleRequirement struct {
	MinDistinct int64            `json:"minDistinct"`
	Selector    ApprovalSelector `json:"selector"`
}

// ApprovalWorkflow 经 ProjectApprovalState Activity 写回 Core 的一次状态跃迁。Core 按 workflowId 与
// eventId 单调 upsert；ApprovalProjection 只接受这一条写入路径（DD-47）。
type ApprovalStateReport struct {
	// RFC3339，UTC；进入 CONSUMED 时的 workflow.Now()
	ConsumedAt *string `json:"consumedAt,omitempty"`
	// RFC3339，UTC；进入 APPROVED 时由 workflow.Now() 加 consumeWindowSeconds 得出
	ConsumeDeadline *string           `json:"consumeDeadline,omitempty"`
	Decisions       []DecisionElement `json:"decisions"`
	// 报告时跨 run 累计的 history 长度
	EventID int64 `json:"eventId"`
	// RFC3339，UTC
	ExpiresAt string `json:"expiresAt"`
	// INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
	Reason     *ReasonCode    `json:"reason,omitempty"`
	RunID      string         `json:"runId"`
	Status     ApprovalStatus `json:"status"`
	WorkflowID string         `json:"workflowId"`
}

type AutomationScheduleAdmitRequest struct {
	Input      InputClass `json:"input"`
	RunID      string     `json:"runId"`
	WorkflowID string     `json:"workflowId"`
}

// DD-107 Schedule 原生启动 AgentTaskWorkflow 的输入。计划时间仅取 native history，不由调用方提供。
type InputClass struct {
	AutomationResourceID     string `json:"automationResourceId"`
	AutomationVersionAssetID string `json:"automationVersionAssetId"`
	// 原 Workflow continue-as-new 仅携 true 保留已观察取消；首 native Schedule input 缺省。
	CancelPending *bool                    `json:"cancelPending,omitempty"`
	ScheduleID    string                   `json:"scheduleId"`
	SourceKind    AutomationScheduleSource `json:"sourceKind"`
}

type AutomationScheduleAdmitResult struct {
	Admitted   bool            `json:"admitted"`
	ReasonCode string          `json:"reasonCode"`
	TaskInput  *TaskInputClass `json:"taskInput,omitempty"`
}

// DD-47/48：固定 AgentInvocation 与版本/投影引用；不携带 prompt、token 或原生正文。
type TaskInputClass struct {
	AgentVersionAssetID        string `json:"agentVersionAssetId"`
	CancelPending              bool   `json:"cancelPending"`
	EventBase                  int64  `json:"eventBase"`
	HeartbeatIntervalSeconds   int64  `json:"heartbeatIntervalSeconds"`
	HeartbeatTimeoutSeconds    int64  `json:"heartbeatTimeoutSeconds"`
	InstallationID             string `json:"installationId"`
	InvocationID               string `json:"invocationId"`
	ObservationIntervalSeconds int64  `json:"observationIntervalSeconds"`
	ProjectionGeneration       int64  `json:"projectionGeneration"`
}

// DD-107 Schedule 原生启动 AgentTaskWorkflow 的输入。计划时间仅取 native history，不由调用方提供。
type AutomationScheduleTaskInput struct {
	AutomationResourceID     string `json:"automationResourceId"`
	AutomationVersionAssetID string `json:"automationVersionAssetId"`
	// 原 Workflow continue-as-new 仅携 true 保留已观察取消；首 native Schedule input 缺省。
	CancelPending *bool                    `json:"cancelPending,omitempty"`
	ScheduleID    string                   `json:"scheduleId"`
	SourceKind    AutomationScheduleSource `json:"sourceKind"`
}

type ComponentActionAdvanceRequest struct {
	CancelRequested bool                                `json:"cancelRequested"`
	RunID           string                              `json:"runId"`
	Target          ComponentActionAdvanceRequestTarget `json:"target"`
}

// 原 ComponentTaskWorkflow(kind=COMPONENT_ACTION) 的冻结引用；全部业务参数仍从原 AE 的引用/hash读取。
type ComponentActionAdvanceRequestTarget struct {
	ActionExecutionID    string `json:"actionExecutionId"`
	BindingID            string `json:"bindingId"`
	BindingVersion       int64  `json:"bindingVersion"`
	ComponentReleaseID   string `json:"componentReleaseId"`
	ProjectionGeneration int64  `json:"projectionGeneration"`
	WorkflowID           string `json:"workflowId"`
}

type ComponentActionAdvanceResult struct {
	ActionExecutionID string     `json:"actionExecutionId"`
	Status            TaskStatus `json:"status"`
	WaitingReason     string     `json:"waitingReason"`
}

// 原 ComponentTaskWorkflow(kind=COMPONENT_ACTION) 的冻结引用；全部业务参数仍从原 AE 的引用/hash读取。
type ComponentActionTarget struct {
	ActionExecutionID    string `json:"actionExecutionId"`
	BindingID            string `json:"bindingId"`
	BindingVersion       int64  `json:"bindingVersion"`
	ComponentReleaseID   string `json:"componentReleaseId"`
	ProjectionGeneration int64  `json:"projectionGeneration"`
	WorkflowID           string `json:"workflowId"`
}

// 受信 Worker 的一次实际线协议观察，附着冻结 ActionExecution。Core 以自身 plan 逐项匹配，不接收 pass 布尔值；UNKNOWN
// 不表示套件失败或成功。响应正文与测试凭据不进入报告。
type ComponentConformanceObservation struct {
	ActionExecutionID  string               `json:"actionExecutionId"`
	ArtifactDigest     string               `json:"artifactDigest"`
	ComponentReleaseID string               `json:"componentReleaseId"`
	ContractDigests    []string             `json:"contractDigests"`
	Observations       []ObservationElement `json:"observations"`
	OperationID        string               `json:"operationId"`
	PlanDigest         string               `json:"planDigest"`
	RunID              string               `json:"runId"`
	SuiteDigest        string               `json:"suiteDigest"`
	WorkflowID         string               `json:"workflowId"`
}

type ObservationElement struct {
	CaseKey                string                        `json:"caseKey"`
	ContentReference       *ContentReferenceClass        `json:"contentReference,omitempty"`
	ErrorClass             *ErrorClass                   `json:"errorClass,omitempty"`
	HTTPStatus             int64                         `json:"httpStatus"`
	MCPResultKind          *MCPResultKind                `json:"mcpResultKind,omitempty"`
	NativeObservation      *ExecutionClass               `json:"nativeObservation,omitempty"`
	NativeScopeObservation *NativeScopeObservationClass  `json:"nativeScopeObservation,omitempty"`
	Operation              ComponentConformanceOperation `json:"operation"`
	RequestDigest          string                        `json:"requestDigest"`
	ResponseDigest         string                        `json:"responseDigest"`
	// 实际返回的能力结果摘要；原结果正文不进入报告或 Core。
	ResultDigest *string `json:"resultDigest,omitempty"`
	StepKey      string  `json:"stepKey"`
}

// DD-98：按同一 platform Resource ref CREATE/LOOKUP；FOUND 保留上游实际引用，不由套件预测或生成 native ID。
type NativeScopeObservationClass struct {
	NativeRef           *string           `json:"nativeRef,omitempty"`
	NativeType          *string           `json:"nativeType,omitempty"`
	PlatformResourceRef string            `json:"platformResourceRef"`
	Result              NativeScopeResult `json:"result"`
}

// 受信 Worker 从 Core 取得的隔离执行输入。不是用户上传的通过声明；只含冻结引用与平台解释的数据，不含候选地址或凭据。顺序与全部内容进入 planDigest。
type ComponentConformancePlan struct {
	ActionExecutionID  string         `json:"actionExecutionId"`
	ArtifactDigest     string         `json:"artifactDigest"`
	ComponentReleaseID string         `json:"componentReleaseId"`
	ConnectorKind      *ConnectorKind `json:"connectorKind,omitempty"`
	ContractDigests    []string       `json:"contractDigests"`
	// 独立隔离身份投递的完整规范化摘要，不含私钥或token，不是生产policy。
	IdentityDigest string `json:"identityDigest"`
	OperationID    string `json:"operationId"`
	PlanDigest     string `json:"planDigest"`
	// Core 冻结时为空；原 ComponentTaskWorkflow 启动后写入真实 Temporal run UUID。报告的 runId 仍必须为 UUID，Core 以
	// Describe 与同 workflow 的当前 TaskProjection 核对。
	RunID       string                         `json:"runId"`
	Steps       []ComponentConformancePlanStep `json:"steps"`
	SuiteDigest string                         `json:"suiteDigest"`
	WorkflowID  string                         `json:"workflowId"`
}

type ComponentConformancePlanStep struct {
	CaseKey string `json:"caseKey"`
	// 只由 Core 从该 release implements 的 ACTIVE 契约步骤固定。存在时 expectedResponseJson 为该能力的业务结果，不是
	// native 任务元数据。
	ContractKey *string `json:"contractKey,omitempty"`
	// Adapter 为实际 HTTP 状态；MCP 原生结果固定 0，不以伪造 HTTP 状态证明协议成功。
	ExpectedHTTPStatus    int64                         `json:"expectedHttpStatus"`
	ExpectedMCPResultKind *MCPResultKind                `json:"expectedMcpResultKind,omitempty"`
	ExpectedResponseJSON  string                        `json:"expectedResponseJson"`
	IdempotencyKey        string                        `json:"idempotencyKey"`
	Operation             ComponentConformanceOperation `json:"operation"`
	ReferenceAssetID      *string                       `json:"referenceAssetId,omitempty"`
	ReferenceFromStepKey  *string                       `json:"referenceFromStepKey,omitempty"`
	ReferenceResourceID   *string                       `json:"referenceResourceId,omitempty"`
	RequestJSON           string                        `json:"requestJson"`
	StepKey               string                        `json:"stepKey"`
}

// 原 ComponentTaskWorkflow 的单个线协议 Activity 输入。步骤来自 Core 冻结计划；调度、尝试次数与 UNKNOWN 对账只由原 Temporal
// history 承接，不建立另一执行账本。
type ComponentConformanceProbe struct {
	ContentReference *ContentReferenceClass `json:"contentReference,omitempty"`
	Plan             PlanClass              `json:"plan"`
	// 只查询同一步冻结幂等键；不再发送原 execute/CREATE。
	Reconcile *bool `json:"reconcile,omitempty"`
	StepIndex int64 `json:"stepIndex"`
}

type ComponentConformanceStepObservation struct {
	CaseKey                string                        `json:"caseKey"`
	ContentReference       *ContentReferenceClass        `json:"contentReference,omitempty"`
	ErrorClass             *ErrorClass                   `json:"errorClass,omitempty"`
	HTTPStatus             int64                         `json:"httpStatus"`
	MCPResultKind          *MCPResultKind                `json:"mcpResultKind,omitempty"`
	NativeObservation      *ExecutionClass               `json:"nativeObservation,omitempty"`
	NativeScopeObservation *NativeScopeObservationClass  `json:"nativeScopeObservation,omitempty"`
	Operation              ComponentConformanceOperation `json:"operation"`
	RequestDigest          string                        `json:"requestDigest"`
	ResponseDigest         string                        `json:"responseDigest"`
	// 实际返回的能力结果摘要；原结果正文不进入报告或 Core。
	ResultDigest *string `json:"resultDigest,omitempty"`
	StepKey      string  `json:"stepKey"`
}

type ConversationProjectionRequest struct {
	RunID  string                              `json:"runId"`
	Target ConversationProjectionRequestTarget `json:"target"`
}

type ConversationProjectionRequestTarget struct {
	ActionExecutionID string `json:"actionExecutionId"`
	ConversationID    string `json:"conversationId"`
	WorkflowID        string `json:"workflowId"`
}

type ConversationProjectionResult struct {
	ConversationID string     `json:"conversationId"`
	Status         TaskStatus `json:"status"`
	WaitingReason  string     `json:"waitingReason"`
}

type ConversationProjectionTarget struct {
	ActionExecutionID string `json:"actionExecutionId"`
	ConversationID    string `json:"conversationId"`
	WorkflowID        string `json:"workflowId"`
}

// FreshApprovalAdmission Activity 发往 Core service API 的请求（.design/06 §4）：active HUMAN、fresh
// 选择器 permission、owner 对账与职责分离由 Core 判定。
type FreshApprovalAdmissionRequest struct {
	ApprovalWorkflowID  string           `json:"approvalWorkflowId"`
	ApproverPrincipalID string           `json:"approverPrincipalId"`
	Decision            ApprovalDecision `json:"decision"`
}

// FreshApprovalAdmission 的结论。admitted=false 时 reason 必有；该结论作为一条被拒决定进入 history，而不是
// pre-history 拒绝。
type FreshApprovalAdmissionResult struct {
	Admitted           bool               `json:"admitted"`
	Reason             *ReasonCode        `json:"reason,omitempty"`
	SatisfiedSelectors []ApprovalSelector `json:"satisfiedSelectors"`
}

type ProtocolSessionReconcileRequest struct {
	CancelRequested bool                                  `json:"cancelRequested"`
	Round           *RoundClass                           `json:"round,omitempty"`
	RunID           string                                `json:"runId"`
	Target          ProtocolSessionReconcileRequestTarget `json:"target"`
}

// Actual original Session snapshot. The Activity result freezes this query round into
// history, not into a new authority.
type RoundClass struct {
	SessionVersion   int64                    `json:"sessionVersion"`
	State            ProtocolSessionViewState `json:"state"`
	WriteObservation *WriteObservationClass   `json:"writeObservation,omitempty"`
}

// DD-90: immutable first UNKNOWN input for the original Session's one Workflow.
type ProtocolSessionReconcileRequestTarget struct {
	ActionDefinitionID   string `json:"actionDefinitionId"`
	ActionExecutionID    string `json:"actionExecutionId"`
	BaseRevision         string `json:"baseRevision"`
	BindingID            string `json:"bindingId"`
	CorrelationRef       string `json:"correlationRef"`
	NativeObjectRef      string `json:"nativeObjectRef"`
	ProjectionGeneration int64  `json:"projectionGeneration"`
	ProtocolSessionID    string `json:"protocolSessionId"`
	ReleaseID            string `json:"releaseId"`
	SessionVersion       int64  `json:"sessionVersion"`
	WorkflowID           string `json:"workflowId"`
}

type ProtocolSessionReconcileResult struct {
	ProtocolSessionID string     `json:"protocolSessionId"`
	Round             RoundClass `json:"round"`
	Status            TaskStatus `json:"status"`
	WaitingReason     string     `json:"waitingReason"`
}

// Actual original Session snapshot. The Activity result freezes this query round into
// history, not into a new authority.
type ProtocolSessionReconcileRound struct {
	SessionVersion   int64                    `json:"sessionVersion"`
	State            ProtocolSessionViewState `json:"state"`
	WriteObservation *WriteObservationClass   `json:"writeObservation,omitempty"`
}

// DD-90: immutable first UNKNOWN input for the original Session's one Workflow.
type ProtocolSessionReconcileTarget struct {
	ActionDefinitionID   string `json:"actionDefinitionId"`
	ActionExecutionID    string `json:"actionExecutionId"`
	BaseRevision         string `json:"baseRevision"`
	BindingID            string `json:"bindingId"`
	CorrelationRef       string `json:"correlationRef"`
	NativeObjectRef      string `json:"nativeObjectRef"`
	ProjectionGeneration int64  `json:"projectionGeneration"`
	ProtocolSessionID    string `json:"protocolSessionId"`
	ReleaseID            string `json:"releaseId"`
	SessionVersion       int64  `json:"sessionVersion"`
	WorkflowID           string `json:"workflowId"`
}

type ResourceProvisionAdvanceRequest struct {
	CancelRequested bool                                  `json:"cancelRequested"`
	RunID           string                                `json:"runId"`
	Target          ResourceProvisionAdvanceRequestTarget `json:"target"`
}

type ResourceProvisionAdvanceRequestTarget struct {
	ActionExecutionID    string              `json:"actionExecutionId"`
	BindingID            string              `json:"bindingId"`
	BindingVersion       int64               `json:"bindingVersion"`
	ComponentReleaseID   string              `json:"componentReleaseId"`
	NativeInstanceRef    string              `json:"nativeInstanceRef"`
	NativeScopeRef       string              `json:"nativeScopeRef"`
	ProjectionGeneration int64               `json:"projectionGeneration"`
	Reference            ResourceCreateClass `json:"reference"`
	ResourceID           string              `json:"resourceId"`
	ResourceVersion      int64               `json:"resourceVersion"`
	WorkflowID           string              `json:"workflowId"`
}

type ResourceProvisionAdvanceResult struct {
	ResourceID    string     `json:"resourceId"`
	Status        TaskStatus `json:"status"`
	WaitingReason string     `json:"waitingReason"`
}

type ResourceProvisionTarget struct {
	ActionExecutionID    string              `json:"actionExecutionId"`
	BindingID            string              `json:"bindingId"`
	BindingVersion       int64               `json:"bindingVersion"`
	ComponentReleaseID   string              `json:"componentReleaseId"`
	NativeInstanceRef    string              `json:"nativeInstanceRef"`
	NativeScopeRef       string              `json:"nativeScopeRef"`
	ProjectionGeneration int64               `json:"projectionGeneration"`
	Reference            ResourceCreateClass `json:"reference"`
	ResourceID           string              `json:"resourceId"`
	ResourceVersion      int64               `json:"resourceVersion"`
	WorkflowID           string              `json:"workflowId"`
}

// TENANT_LIFECYCLE DELETE Activity 只推进已准入且已冻结的 Tenant 删除，不重新解析绑定或建立新快照。
type TenantDeleteAdvanceRequest struct {
	CancelRequested bool   `json:"cancelRequested"`
	SnapshotID      string `json:"snapshotId"`
	TenantID        string `json:"tenantId"`
	TenantVersion   int64  `json:"tenantVersion"`
}

// Core 返回已经持久化的删除推进事实；UNKNOWN 由错误分类表达，不伪装为 completed 或 canceled。原生证据只保留引用。
type TenantDeleteAdvanceResult struct {
	Canceled                    bool    `json:"canceled"`
	Completed                   bool    `json:"completed"`
	IrreversibleDispatchStarted bool    `json:"irreversibleDispatchStarted"`
	NativeInventoryDigest       *string `json:"nativeInventoryDigest,omitempty"`
	NativeRequestID             *string `json:"nativeRequestId,omitempty"`
	SnapshotID                  string  `json:"snapshotId"`
	SubprocessID                string  `json:"subprocessId"`
}

// 可选的枚举引用
//
// 能力状态。权威定义见 .design/02-源码证据与设计决策.md。BLOCKED 的能力不得生成任何入口、路由、动作、工具或开关。
type CapabilityState string

const (
	AdapterRequired        CapabilityState = "ADAPTER_REQUIRED"
	CapabilityStateBLOCKED CapabilityState = "BLOCKED"
	DesignDefined          CapabilityState = "DESIGN_DEFINED"
	Excluded               CapabilityState = "EXCLUDED"
	UpstreamSupported      CapabilityState = "UPSTREAM_SUPPORTED"
)

// 跨文件 $ref 引用封闭枚举
//
// 错误分类。每个 API 错误、Workflow 失败与 UI 状态必须落在其中之一。权威定义见 apps/06-工程基线规范.md 第 4 节。UNKNOWN
// 表示外部副作用结果不明，等待对账，禁止渲染成成功或失败，也禁止盲目重放。
type ErrorClass string

const (
	ErrorClassBLOCKED  ErrorClass = "BLOCKED"
	ErrorClassCONFLICT ErrorClass = "CONFLICT"
	ErrorClassDENIED   ErrorClass = "DENIED"
	ErrorClassUNKNOWN  ErrorClass = "UNKNOWN"
	Limit              ErrorClass = "LIMIT"
	Precondition       ErrorClass = "PRECONDITION"
)

type VariantKind string

const (
	File    VariantKind = "FILE"
	Message VariantKind = "MESSAGE"
	Task    VariantKind = "TASK"
)

type NativeCancelCapability string

const (
	Supported   NativeCancelCapability = "SUPPORTED"
	Unsupported NativeCancelCapability = "UNSUPPORTED"
)

type ApplicationIsolationMode string

const (
	DedicatedInstance ApplicationIsolationMode = "DEDICATED_INSTANCE"
	Namespace         ApplicationIsolationMode = "NAMESPACE"
	NativeTenant      ApplicationIsolationMode = "NATIVE_TENANT"
	ResourceFilter    ApplicationIsolationMode = "RESOURCE_FILTER"
	ResourceInstance  ApplicationIsolationMode = "RESOURCE_INSTANCE"
)

// design03§6 ExternalExecution 的既定平台状态；HTTP成功和cancel accepted均不构成终态。
type ExternalExecutionStatus string

const (
	ExternalExecutionStatusCANCELLED ExternalExecutionStatus = "CANCELLED"
	ExternalExecutionStatusFAILED    ExternalExecutionStatus = "FAILED"
	ExternalExecutionStatusRUNNING   ExternalExecutionStatus = "RUNNING"
	ExternalExecutionStatusUNKNOWN   ExternalExecutionStatus = "UNKNOWN"
	PendingDispatch                  ExternalExecutionStatus = "PENDING_DISPATCH"
	Succeeded                        ExternalExecutionStatus = "SUCCEEDED"
)

type Phase string

const (
	Accepted      Phase = "ACCEPTED"
	PhaseCONFLICT Phase = "CONFLICT"
	PhaseFAILED   Phase = "FAILED"
	PhaseUNKNOWN  Phase = "UNKNOWN"
	Started       Phase = "STARTED"
)

type TedMode string

const (
	Edit TedMode = "EDIT"
	View TedMode = "VIEW"
)

type Locale string

const (
	En   Locale = "en"
	ZhCN Locale = "zh-CN"
)

type Theme string

const (
	Dark  Theme = "DARK"
	Light Theme = "LIGHT"
)

type Method string

const (
	Get  Method = "GET"
	Post Method = "POST"
)

type DecisionEnum string

const (
	DecisionALLOW DecisionEnum = "ALLOW"
)

type NativeState string

const (
	NativeStateABSENT  NativeState = "ABSENT"
	NativeStateACTIVE  NativeState = "ACTIVE"
	NativeStateEXPIRED NativeState = "EXPIRED"
)

type NativeOperation string

const (
	NativeOperationOBSERVE NativeOperation = "OBSERVE"
	NativeOperationOPEN    NativeOperation = "OPEN"
	NativeOperationREAD    NativeOperation = "READ"
	TokenObserve           NativeOperation = "TOKEN_OBSERVE"
	TokenRevoke            NativeOperation = "TOKEN_REVOKE"
	Write                  NativeOperation = "WRITE"
)

type ProtocolWriteReceiptState string

const (
	PurpleCONFLICT ProtocolWriteReceiptState = "CONFLICT"
	PurpleDIRTY    ProtocolWriteReceiptState = "DIRTY"
	PurpleFAILED   ProtocolWriteReceiptState = "FAILED"
	PurpleSAVED    ProtocolWriteReceiptState = "SAVED"
	PurpleUNKNOWN  ProtocolWriteReceiptState = "UNKNOWN"
)

type NativeScopeResult string

const (
	AbsentFenced           NativeScopeResult = "ABSENT_FENCED"
	NativeScopeResultFOUND NativeScopeResult = "FOUND"
	Refused                NativeScopeResult = "REFUSED"
)

type AgentMemoryColdWrite string

const (
	AgentMemoryColdWriteDISABLED AgentMemoryColdWrite = "DISABLED"
	InvocationScoped             AgentMemoryColdWrite = "INVOCATION_SCOPED"
)

type AgentMemoryCoreWrite string

const (
	AgentWithApproval AgentMemoryCoreWrite = "AGENT_WITH_APPROVAL"
	HumanOnly         AgentMemoryCoreWrite = "HUMAN_ONLY"
)

type AgentTrigger string

const (
	AgentTriggerMENTION AgentTrigger = "MENTION"
	ManualAssignment    AgentTrigger = "MANUAL_ASSIGNMENT"
)

type ApplicationCallIdentityMode string

const (
	EndUserToken    ApplicationCallIdentityMode = "END_USER_TOKEN"
	InstanceService ApplicationCallIdentityMode = "INSTANCE_SERVICE"
	TenantService   ApplicationCallIdentityMode = "TENANT_SERVICE"
)

type ApplicationModelCallMode string

const (
	ApplicationModelCallModeNONE ApplicationModelCallMode = "NONE"
	PlatformLlmRoute             ApplicationModelCallMode = "PLATFORM_LLM_ROUTE"
	SelfManagedModel             ApplicationModelCallMode = "SELF_MANAGED_MODEL"
)

type ActionKind string

const (
	AgentTurn   ActionKind = "AGENT_TURN"
	PostMessage ActionKind = "POST_MESSAGE"
)

type AutomationResultTarget string

const (
	Channel       AutomationResultTarget = "CHANNEL"
	TriggerThread AutomationResultTarget = "TRIGGER_THREAD"
)

type AutomationTriggerKind string

const (
	AutomationTriggerKindMENTION  AutomationTriggerKind = "MENTION"
	AutomationTriggerKindSCHEDULE AutomationTriggerKind = "SCHEDULE"
	ChannelMessage                AutomationTriggerKind = "CHANNEL_MESSAGE"
)

type CapabilityPermission string

const (
	Approve                     CapabilityPermission = "approve"
	Audit                       CapabilityPermission = "audit"
	CapabilityPermissionExecute CapabilityPermission = "execute"
	Consume                     CapabilityPermission = "consume"
	Create                      CapabilityPermission = "create"
	Delegate                    CapabilityPermission = "delegate"
	Delete                      CapabilityPermission = "delete"
	Discover                    CapabilityPermission = "discover"
	Export                      CapabilityPermission = "export"
	Manage                      CapabilityPermission = "manage"
	Read                        CapabilityPermission = "read"
	Share                       CapabilityPermission = "share"
	TransferOwner               CapabilityPermission = "transfer_owner"
	Update                      CapabilityPermission = "update"
)

type CapabilitySurface string

const (
	Action CapabilitySurface = "ACTION"
	Tool   CapabilitySurface = "TOOL"
)

type CapabilityRequiredDeclaration string

const (
	Cancel                               CapabilityRequiredDeclaration = "CANCEL"
	CapabilityRequiredDeclarationOBSERVE CapabilityRequiredDeclaration = "OBSERVE"
	Meter                                CapabilityRequiredDeclaration = "METER"
	OnlineEditing                        CapabilityRequiredDeclaration = "ONLINE_EDITING"
	ReadEdge                             CapabilityRequiredDeclaration = "READ_EDGE"
	RevisionQuery                        CapabilityRequiredDeclaration = "REVISION_QUERY"
	TenantDelete                         CapabilityRequiredDeclaration = "TENANT_DELETE"
	VersionedModel                       CapabilityRequiredDeclaration = "VERSIONED_MODEL"
)

type ResultExposureMode string

const (
	ConsumeOnly              ResultExposureMode = "CONSUME_ONLY"
	ResultExposureModeEXPORT ResultExposureMode = "EXPORT"
	ResultExposureModeREAD   ResultExposureMode = "READ"
)

// 提供方认证的显式封闭选择；NONE 不豁免 Gateway 调用者认证或业务授权。
type LlmProviderCredentialMode string

const (
	LlmProviderCredentialModeNONE LlmProviderCredentialMode = "NONE"
	SecretRef                     LlmProviderCredentialMode = "SECRET_REF"
)

// 原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
type ExpectedHeadState string

const (
	ExpectedHeadStateABSENT ExpectedHeadState = "ABSENT"
	ExpectedHeadStateFOUND  ExpectedHeadState = "FOUND"
)

type ChannelType string

const (
	Forum  ChannelType = "forum"
	Stream ChannelType = "stream"
)

// 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
//
// DD-80 的产品可见性：open 仅指同 Tenant 成员可发现并经 Core 加入；Relay 投影始终 private。
//
// Core 产品可见性，不从 Relay private 投影推断；旧回应可能省略。
type WorkspaceVisibility string

const (
	Open    WorkspaceVisibility = "open"
	Private WorkspaceVisibility = "private"
)

// ActionExecution 的派发状态（.design/03 §6）。UNKNOWN 是结果不明，既不是成功也不是失败——只有已登记的 native query/dedupe
// seam 能把它收敛，不能因无 native ID 就自动重放（DD-48）。
type ActionDispatchState string

const (
	Aborted                    ActionDispatchState = "ABORTED"
	ActionDispatchStateUNKNOWN ActionDispatchState = "UNKNOWN"
	Dispatched                 ActionDispatchState = "DISPATCHED"
	NotDispatched              ActionDispatchState = "NOT_DISPATCHED"
)

// ActionExecution 的准入门禁状态（.design/03 §6）。它与 dispatch_state
// 是两台独立状态机：门禁说的是「允许不允许」，派发说的是「副作用发生没发生」，合并后无法表达「准入通过但派发结果不明」。
type ActionGateState string

const (
	ActionGateStateDENIED  ActionGateState = "DENIED"
	ActionGateStateEXPIRED ActionGateState = "EXPIRED"
	ActionGateStateREVOKED ActionGateState = "REVOKED"
	ActionGateStateWAITING ActionGateState = "WAITING"
	Allowed                ActionGateState = "ALLOWED"
	Evaluating             ActionGateState = "EVALUATING"
)

// 稳定业务 reason code，进入 audit、UI 与告警；文案可本地化，code 不变（apps/06-工程基线规范.md 第 4 节）。新增与新增 API
// 字段同等对待，走兼容检查。本文件只含已被实现使用的 code。
//
// admitted=false 时的拒绝原因
//
// INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
type ReasonCode string

const (
	AdmissionAbandoned           ReasonCode = "ADMISSION_ABANDONED"
	ApprovalConsumeWindowClosed  ReasonCode = "APPROVAL_CONSUME_WINDOW_CLOSED"
	ApprovalDenied               ReasonCode = "APPROVAL_DENIED"
	ApprovalExpired              ReasonCode = "APPROVAL_EXPIRED"
	ApprovalInvalidated          ReasonCode = "APPROVAL_INVALIDATED"
	ApprovalNotOpen              ReasonCode = "APPROVAL_NOT_OPEN"
	ApprovalSelectorUnresolvable ReasonCode = "APPROVAL_SELECTOR_UNRESOLVABLE"
	ApprovalWithdrawn            ReasonCode = "APPROVAL_WITHDRAWN"
	ApproverNotEligible          ReasonCode = "APPROVER_NOT_ELIGIBLE"
	BindingNotActive             ReasonCode = "BINDING_NOT_ACTIVE"
	CapabilityBlocked            ReasonCode = "CAPABILITY_BLOCKED"
	ClientKeyAlreadyBound        ReasonCode = "CLIENT_KEY_ALREADY_BOUND"
	ClientKeyLimitReached        ReasonCode = "CLIENT_KEY_LIMIT_REACHED"
	ClientKeyNotFound            ReasonCode = "CLIENT_KEY_NOT_FOUND"
	ClientKeyProofInvalid        ReasonCode = "CLIENT_KEY_PROOF_INVALID"
	DependencyUnavailable        ReasonCode = "DEPENDENCY_UNAVAILABLE"
	DispatchResultUnknown        ReasonCode = "DISPATCH_RESULT_UNKNOWN"
	DuplicateDecision            ReasonCode = "DUPLICATE_DECISION"
	ExternalResultUnknown        ReasonCode = "EXTERNAL_RESULT_UNKNOWN"
	IdempotencyKeyReused         ReasonCode = "IDEMPOTENCY_KEY_REUSED"
	IdentityHeaderMissing        ReasonCode = "IDENTITY_HEADER_MISSING"
	IdentityUnknown              ReasonCode = "IDENTITY_UNKNOWN"
	InvalidParameters            ReasonCode = "INVALID_PARAMETERS"
	InvitationAlreadyRedeemed    ReasonCode = "INVITATION_ALREADY_REDEEMED"
	InvitationExpired            ReasonCode = "INVITATION_EXPIRED"
	InvitationNotFound           ReasonCode = "INVITATION_NOT_FOUND"
	InvitationRevoked            ReasonCode = "INVITATION_REVOKED"
	InviteeAlreadyMember         ReasonCode = "INVITEE_ALREADY_MEMBER"
	LastTenantAdmin              ReasonCode = "LAST_TENANT_ADMIN"
	NativeSurfaceRequired        ReasonCode = "NATIVE_SURFACE_REQUIRED"
	PayloadTooLarge              ReasonCode = "PAYLOAD_TOO_LARGE"
	PermissionDenied             ReasonCode = "PERMISSION_DENIED"
	ProjectionDelayed            ReasonCode = "PROJECTION_DELAYED"
	PublishRejected              ReasonCode = "PUBLISH_REJECTED"
	PublishResultUnknown         ReasonCode = "PUBLISH_RESULT_UNKNOWN"
	QuotaExhausted               ReasonCode = "QUOTA_EXHAUSTED"
	RateLimited                  ReasonCode = "RATE_LIMITED"
	ScopeGuardFailed             ReasonCode = "SCOPE_GUARD_FAILED"
	SelfApprovalDenied           ReasonCode = "SELF_APPROVAL_DENIED"
	SessionNotActive             ReasonCode = "SESSION_NOT_ACTIVE"
	SurfaceCapabilityUnavailable ReasonCode = "SURFACE_CAPABILITY_UNAVAILABLE"
	TargetNotFound               ReasonCode = "TARGET_NOT_FOUND"
	TargetStateConflict          ReasonCode = "TARGET_STATE_CONFLICT"
	TenantMembershipNotActive    ReasonCode = "TENANT_MEMBERSHIP_NOT_ACTIVE"
	TenantNotActive              ReasonCode = "TENANT_NOT_ACTIVE"
	TenantSelectionNotAvailable  ReasonCode = "TENANT_SELECTION_NOT_AVAILABLE"
	WaitingApproval              ReasonCode = "WAITING_APPROVAL"
)

// 03 §7 Resource 的正式状态，投影未闭合不得呈现 ACTIVE。
type ResourceState string

const (
	ResourceStateACTIVE       ResourceState = "ACTIVE"
	ResourceStateDELETED      ResourceState = "DELETED"
	ResourceStateDELETING     ResourceState = "DELETING"
	ResourceStateFAILED       ResourceState = "FAILED"
	ResourceStatePROVISIONING ResourceState = "PROVISIONING"
	ResourceStateUNKNOWN      ResourceState = "UNKNOWN"
	RetainedReadOnly          ResourceState = "RETAINED_READ_ONLY"
)

type GrantState string

const (
	PurpleACTIVE  GrantState = "ACTIVE"
	PurpleEXPIRED GrantState = "EXPIRED"
	PurpleREVOKED GrantState = "REVOKED"
	StateREVOKING GrantState = "REVOKING"
)

type AgentPrincipalState string

const (
	AgentPrincipalStateACTIVE   AgentPrincipalState = "ACTIVE"
	AgentPrincipalStateDISABLED AgentPrincipalState = "DISABLED"
)

type ChannelBindingStatus string

const (
	FluffyACTIVE   ChannelBindingStatus = "ACTIVE"
	StatusDISABLED ChannelBindingStatus = "DISABLED"
	StatusERROR    ChannelBindingStatus = "ERROR"
)

// 03 §7 的静态运行投影状态，不承载 Invocation 动态准入。
type AgentRuntimeProjectionState string

const (
	AgentRuntimeProjectionStateACTIVE  AgentRuntimeProjectionState = "ACTIVE"
	AgentRuntimeProjectionStateERROR   AgentRuntimeProjectionState = "ERROR"
	AgentRuntimeProjectionStateREVOKED AgentRuntimeProjectionState = "REVOKED"
	Pending                            AgentRuntimeProjectionState = "PENDING"
)

// 03 §7、17 §6 的 Installation 状态；ACTIVE 要求实际投影与运行查证闭合。
type AgentInstallationState string

const (
	AgentInstallationStateACTIVE       AgentInstallationState = "ACTIVE"
	AgentInstallationStateDISABLED     AgentInstallationState = "DISABLED"
	AgentInstallationStateERROR        AgentInstallationState = "ERROR"
	AgentInstallationStatePROVISIONING AgentInstallationState = "PROVISIONING"
	Draining                           AgentInstallationState = "DRAINING"
)

type AgentMemoryEntryPageState string

const (
	BoundExceeded AgentMemoryEntryPageState = "BOUND_EXCEEDED"
	Complete      AgentMemoryEntryPageState = "COMPLETE"
	FluffyUNKNOWN AgentMemoryEntryPageState = "UNKNOWN"
)

type AgentMemoryReadViewState string

const (
	StateABSENT AgentMemoryReadViewState = "ABSENT"
	StateFOUND  AgentMemoryReadViewState = "FOUND"
	Unreadable  AgentMemoryReadViewState = "UNREADABLE"
)

type RuntimeProfileKind string

const (
	LocalACP       RuntimeProfileKind = "LOCAL_ACP"
	RemoteProvider RuntimeProfileKind = "REMOTE_PROVIDER"
	ServerCodex    RuntimeProfileKind = "SERVER_CODEX"
)

type AgentVersionState string

const (
	AgentVersionStateDRAFT   AgentVersionState = "DRAFT"
	AgentVersionStateRETIRED AgentVersionState = "RETIRED"
	Published                AgentVersionState = "PUBLISHED"
)

type ApplicationBindingState string

const (
	ApplicationBindingStateACTIVE       ApplicationBindingState = "ACTIVE"
	ApplicationBindingStateDISABLED     ApplicationBindingState = "DISABLED"
	ApplicationBindingStateERROR        ApplicationBindingState = "ERROR"
	ApplicationBindingStatePROVISIONING ApplicationBindingState = "PROVISIONING"
	Disabling                           ApplicationBindingState = "DISABLING"
	Upgrading                           ApplicationBindingState = "UPGRADING"
)

// approver 的不可变决定（.design/03 §6）。
//
// 已形成的决定；admitted=false 时缺省
type ApprovalDecision string

const (
	ApprovalDecisionAPPROVE ApprovalDecision = "APPROVE"
	ApprovalDecisionDENY    ApprovalDecision = "DENY"
)

// ApprovalPolicy.role_requirements 的角色选择器（.design/03 §4、.design/10 §2）：RESOURCE_APPROVER
// 对目标 Resource/Asset 做 approve，WORKSPACE_ADMIN 对冻结 Workspace 做 manage，TENANT_ADMIN 对冻结
// Tenant 做 manage。
type ApprovalSelector string

const (
	ResourceApprover ApprovalSelector = "RESOURCE_APPROVER"
	TenantAdmin      ApprovalSelector = "TENANT_ADMIN"
	WorkspaceAdmin   ApprovalSelector = "WORKSPACE_ADMIN"
)

// ApprovalWorkflow 的状态（.design/06 §4）：REQUESTED → WAITING → APPROVED | DENIED | EXPIRED |
// CANCELLED；APPROVED → CONSUMED | INVALIDATED。只由 Temporal history 投影。
type ApprovalStatus string

const (
	ApprovalStatusAPPROVED  ApprovalStatus = "APPROVED"
	ApprovalStatusCANCELLED ApprovalStatus = "CANCELLED"
	ApprovalStatusDENIED    ApprovalStatus = "DENIED"
	ApprovalStatusEXPIRED   ApprovalStatus = "EXPIRED"
	ApprovalStatusWAITING   ApprovalStatus = "WAITING"
	Consumed                ApprovalStatus = "CONSUMED"
	Invalidated             ApprovalStatus = "INVALIDATED"
	Requested               ApprovalStatus = "REQUESTED"
)

// AuditEvent 的类型（.design/03 §9）。tenant_id 为空只允许 AUTHENTICATION 与 SESSION，且仅限 AgentGateway
// OIDC callback 之后、Core 尚未解析出可用 TenantMembership 的那段边界（DD-52/54）。
type AuditEventType string

const (
	Access         AuditEventType = "ACCESS"
	Approval       AuditEventType = "APPROVAL"
	Authentication AuditEventType = "AUTHENTICATION"
	Decision       AuditEventType = "DECISION"
	Dispatch       AuditEventType = "DISPATCH"
	Intent         AuditEventType = "INTENT"
	Outcome        AuditEventType = "OUTCOME"
	Reconciliation AuditEventType = "RECONCILIATION"
	Revocation     AuditEventType = "REVOCATION"
	Session        AuditEventType = "SESSION"
)

// EvidenceRef 所指证据的源码权威。
type EvidenceAuthority string

const (
	Agentgateway          EvidenceAuthority = "AGENTGATEWAY"
	Buzz                  EvidenceAuthority = "BUZZ"
	EvidenceAuthorityCORE EvidenceAuthority = "CORE"
	Oidc                  EvidenceAuthority = "OIDC"
	Openmeter             EvidenceAuthority = "OPENMETER"
	Spicedb               EvidenceAuthority = "SPICEDB"
	Temporal              EvidenceAuthority = "TEMPORAL"
)

// 存量种类不可识别时缺省
//
// AuditEvent 中 EvidenceRef 的封闭种类（.design/03 §14）。每种只承载其权威源中的稳定 ID（可带
// version），权威源、证据类型与敏感级别由种类唯一确定（Core 的固定描述表）。库中存量出现不在此列的种类时解释为不可用，不猜测含义。
type EvidenceKind string

const (
	ActionExecutionID           EvidenceKind = "ACTION_EXECUTION_ID"
	AdmitActionExecutionID      EvidenceKind = "ADMIT_ACTION_EXECUTION_ID"
	AgentgatewayUsageID         EvidenceKind = "AGENTGATEWAY_USAGE_ID"
	ApprovalPolicy              EvidenceKind = "APPROVAL_POLICY"
	ApprovalWorkflowID          EvidenceKind = "APPROVAL_WORKFLOW_ID"
	BuzzDeletionInventoryDigest EvidenceKind = "BUZZ_DELETION_INVENTORY_DIGEST"
	BuzzDeletionRequestID       EvidenceKind = "BUZZ_DELETION_REQUEST_ID"
	BuzzEventID                 EvidenceKind = "BUZZ_EVENT_ID"
	BuzzPubkey                  EvidenceKind = "BUZZ_PUBKEY"
	DeploymentBootstrap         EvidenceKind = "DEPLOYMENT_BOOTSTRAP"
	ExternalSubjectSha256       EvidenceKind = "EXTERNAL_SUBJECT_SHA256"
	OpenmeterEventID            EvidenceKind = "OPENMETER_EVENT_ID"
	OriginalActionExecutionID   EvidenceKind = "ORIGINAL_ACTION_EXECUTION_ID"
	PlatformSessionID           EvidenceKind = "PLATFORM_SESSION_ID"
	SecretRefRehomeID           EvidenceKind = "SECRET_REF_REHOME_ID"
	SpicedbRelationship         EvidenceKind = "SPICEDB_RELATIONSHIP"
	SpicedbZedtoken             EvidenceKind = "SPICEDB_ZEDTOKEN"
	TemporalFirstRunID          EvidenceKind = "TEMPORAL_FIRST_RUN_ID"
	TemporalRunID               EvidenceKind = "TEMPORAL_RUN_ID"
	TemporalWorkflowID          EvidenceKind = "TEMPORAL_WORKFLOW_ID"
	TenantDeleteSubprocessID    EvidenceKind = "TENANT_DELETE_SUBPROCESS_ID"
	TenantInvitationID          EvidenceKind = "TENANT_INVITATION_ID"
	TenantLifecycleSnapshotID   EvidenceKind = "TENANT_LIFECYCLE_SNAPSHOT_ID"
	TenantMembershipID          EvidenceKind = "TENANT_MEMBERSHIP_ID"
	TraceID                     EvidenceKind = "TRACE_ID"
	UsageEventID                EvidenceKind = "USAGE_EVENT_ID"
)

// EvidenceRef 的敏感级别。SUMMARY 在当前 audit permission 下可解引用；RESTRICTED 还需 ResultExposure
// 授权，在其交付前一律不可用（fail closed）。
type EvidenceSensitivity string

const (
	EvidenceSensitivityRESTRICTED EvidenceSensitivity = "RESTRICTED"
	Summary                       EvidenceSensitivity = "SUMMARY"
)

// 03 §7、05 §2.9：AutomationDefinition 的真实管理状态，不是 Invocation 终态。
type AutomationState string

const (
	AutomationStateDELETED  AutomationState = "DELETED"
	AutomationStateDISABLED AutomationState = "DISABLED"
	AutomationStateDRAFT    AutomationState = "DRAFT"
	Enabled                 AutomationState = "ENABLED"
	Paused                  AutomationState = "PAUSED"
)

// TaskProjection 的状态（.design/03 §6、.design/06 §3.1）。RUNNING 之外的值都是 Temporal 的终态，与其 close
// status 一一对应：Workflow 自己写回的只有 COMPLETED 与 FAILED，其余三个只来自兜底对账对 Temporal 的观察。任一终态都使
// WorkflowRef 进入 TERMINAL。
type TaskStatus string

const (
	Canceled          TaskStatus = "CANCELED"
	Completed         TaskStatus = "COMPLETED"
	TaskStatusFAILED  TaskStatus = "FAILED"
	TaskStatusRUNNING TaskStatus = "RUNNING"
	Terminated        TaskStatus = "TERMINATED"
	TimedOut          TaskStatus = "TIMED_OUT"
)

// ComponentTaskWorkflow 的封闭 kind 列表。权威定义见 .design/06-Temporal任务工作台.md；新增 kind
// 必须同时出现在那里，否则能力注册表在构建期拒绝。本文件只含已实现的 kind。
type WorkflowKind string

const (
	AgentInstallation        WorkflowKind = "AGENT_INSTALLATION"
	BuzzIdentityProjection   WorkflowKind = "BUZZ_IDENTITY_PROJECTION"
	ComponentAction          WorkflowKind = "COMPONENT_ACTION"
	ComponentBinding         WorkflowKind = "COMPONENT_BINDING"
	ComponentDisable         WorkflowKind = "COMPONENT_DISABLE"
	ComponentRelease         WorkflowKind = "COMPONENT_RELEASE"
	ConversationProjection   WorkflowKind = "CONVERSATION_PROJECTION"
	MembershipProjection     WorkflowKind = "MEMBERSHIP_PROJECTION"
	MembershipRevocation     WorkflowKind = "MEMBERSHIP_REVOCATION"
	ProtocolSessionReconcile WorkflowKind = "PROTOCOL_SESSION_RECONCILE"
	ResourceProvision        WorkflowKind = "RESOURCE_PROVISION"
	SecretRefRehome          WorkflowKind = "SECRET_REF_REHOME"
	TenantLifecycle          WorkflowKind = "TENANT_LIFECYCLE"
	WorkspaceLifecycle       WorkflowKind = "WORKSPACE_LIFECYCLE"
)

type CapabilityContractStatus string

const (
	CapabilityContractStatusACTIVE  CapabilityContractStatus = "ACTIVE"
	CapabilityContractStatusDRAFT   CapabilityContractStatus = "DRAFT"
	CapabilityContractStatusRETIRED CapabilityContractStatus = "RETIRED"
	Deprecated                      CapabilityContractStatus = "DEPRECATED"
)

// BuzzIdentityBinding 状态机。custody=CLIENT 时跳过 PENDING_SECRET，自 RECONCILING 起始。
type BuzzIdentityState string

const (
	BuzzIdentityStateACTIVE      BuzzIdentityState = "ACTIVE"
	BuzzIdentityStateRECONCILING BuzzIdentityState = "RECONCILING"
	BuzzIdentityStateREVOKED     BuzzIdentityState = "REVOKED"
	BuzzIdentityStateREVOKING    BuzzIdentityState = "REVOKING"
	PendingSecret                BuzzIdentityState = "PENDING_SECRET"
)

// 原登记套件的真实操作种类；MCP 方法不属于 AdapterProtocolOperation，也不要求原生 peer 实现 Adapter API。
type ComponentConformanceOperation string

const (
	ComponentConformanceOperationCancel               ComponentConformanceOperation = "cancel"
	ComponentConformanceOperationExecute              ComponentConformanceOperation = "execute"
	ComponentConformanceOperationExtractUsage         ComponentConformanceOperation = "extract_usage"
	ComponentConformanceOperationHandshake            ComponentConformanceOperation = "handshake"
	ComponentConformanceOperationMapNativeStatusError ComponentConformanceOperation = "map_native_status_error"
	ComponentConformanceOperationObserve              ComponentConformanceOperation = "observe"
	ComponentConformanceOperationQueryRevision        ComponentConformanceOperation = "query_revision"
	ComponentConformanceOperationReconcile            ComponentConformanceOperation = "reconcile"
	ComponentConformanceOperationResolveNativeScope   ComponentConformanceOperation = "resolve_native_scope"
	ComponentConformanceOperationValidateBinding      ComponentConformanceOperation = "validate_binding"
	MCPCall                                           ComponentConformanceOperation = "mcp_call"
	MCPInitialize                                     ComponentConformanceOperation = "mcp_initialize"
	MCPList                                           ComponentConformanceOperation = "mcp_list"
)

type ConnectorKind string

const (
	ProtocolPeer  ConnectorKind = "PROTOCOL_PEER"
	RemoteAdapter ConnectorKind = "REMOTE_ADAPTER"
)

type MCPResultKind string

const (
	MCPResultKindERROR MCPResultKind = "ERROR"
	Result             MCPResultKind = "RESULT"
)

type PlatformPortKey string

const (
	AIGateway          PlatformPortKey = "AI_GATEWAY"
	ApprovalWorkflow   PlatformPortKey = "APPROVAL_WORKFLOW"
	Authorization      PlatformPortKey = "AUTHORIZATION"
	CollaborationRelay PlatformPortKey = "COLLABORATION_RELAY"
	CoreInternal       PlatformPortKey = "CORE_INTERNAL"
	IdentityEdge       PlatformPortKey = "IDENTITY_EDGE"
	MeteringBilling    PlatformPortKey = "METERING_BILLING"
	SecretStore        PlatformPortKey = "SECRET_STORE"
)

type Subject string

const (
	BuzzWeb     Subject = "BUZZ_WEB"
	SubjectCORE Subject = "CORE"
	Worker      Subject = "WORKER"
)

type ComponentReleaseStatus string

const (
	ComponentReleaseStatusAPPROVED ComponentReleaseStatus = "APPROVED"
	ComponentReleaseStatusREVOKED  ComponentReleaseStatus = "REVOKED"
	Registered                     ComponentReleaseStatus = "REGISTERED"
	Rejected                       ComponentReleaseStatus = "REJECTED"
)

type ItemState string

const (
	StateDISABLED     ItemState = "DISABLED"
	StatePROVISIONING ItemState = "PROVISIONING"
	StateRECONCILING  ItemState = "RECONCILING"
	TentacledACTIVE   ItemState = "ACTIVE"
)

type JoinActionKey string

const (
	WorkspaceJoin JoinActionKey = "workspace.join"
)

// WorkspaceMembership 状态机。REVOKING 期间立即拒绝新动作；重新授权创建新 membership version，不复活旧投影。
type WorkspaceMembershipState string

const (
	WorkspaceMembershipStateACTIVE       WorkspaceMembershipState = "ACTIVE"
	WorkspaceMembershipStateERROR        WorkspaceMembershipState = "ERROR"
	WorkspaceMembershipStatePROVISIONING WorkspaceMembershipState = "PROVISIONING"
	WorkspaceMembershipStateREVOKED      WorkspaceMembershipState = "REVOKED"
	WorkspaceMembershipStateREVOKING     WorkspaceMembershipState = "REVOKING"
)

// 解引用只显示不可用时的原因：原证据已不存在（HTTP 404）、敏感级别未获授权、存量种类不可识别、权威源无法按该 ID 查证其仍存在。
type EvidenceUnavailableReason string

const (
	EvidenceUnavailableReasonRESTRICTED EvidenceUnavailableReason = "RESTRICTED"
	NotFound                            EvidenceUnavailableReason = "NOT_FOUND"
	Unrecognized                        EvidenceUnavailableReason = "UNRECOGNIZED"
	Unverifiable                        EvidenceUnavailableReason = "UNVERIFIABLE"
)

// TenantMembership 状态机。REVOKING 期间必须立即拒绝新动作，对账完成后才进 REVOKED（.design/10 §4）。
type TenantMembershipState string

const (
	Invited                           TenantMembershipState = "INVITED"
	TenantMembershipStateACTIVE       TenantMembershipState = "ACTIVE"
	TenantMembershipStateERROR        TenantMembershipState = "ERROR"
	TenantMembershipStatePROVISIONING TenantMembershipState = "PROVISIONING"
	TenantMembershipStateREVOKED      TenantMembershipState = "REVOKED"
	TenantMembershipStateREVOKING     TenantMembershipState = "REVOKING"
)

type BindingKind string

const (
	Control BindingKind = "CONTROL"
	Human   BindingKind = "HUMAN"
)

// 按该 Tenant 当前状态可发起的暂停（ACTIVE，或协作面 binding 为 ACTIVE 的 ERROR）或恢复（SUSPENDED）动作
// key；目录未开放、处于收敛中或本页提示判定失败时省略
//
// 业务 Tenant 暂停与恢复的 ActionDefinition key（DD-96）。两者都由 Platform Catalog Tenant 的
// platform-admin 发起；Tenant delete 随 Stage 3 注册，不在此列。
type TenantLifecycleActionKey string

const (
	TenantRestore TenantLifecycleActionKey = "tenant.restore"
	TenantSuspend TenantLifecycleActionKey = "tenant.suspend"
)

// Tenant 状态机。权威定义见 .design/03-领域模型与权限模型.md。DELETING/DELETED 因 GAP-LCM-01
// 开放而不注册入口，但状态本身保留以承载已有记录。
type TenantState string

const (
	TenantStateACTIVE       TenantState = "ACTIVE"
	TenantStateDELETED      TenantState = "DELETED"
	TenantStateDELETING     TenantState = "DELETING"
	TenantStateERROR        TenantState = "ERROR"
	TenantStatePROVISIONING TenantState = "PROVISIONING"
	TenantStateRESTORING    TenantState = "RESTORING"
	TenantStateSUSPENDED    TenantState = "SUSPENDED"
	TenantStateSUSPENDING   TenantState = "SUSPENDING"
)

type ActionKey string

const (
	AgentMemoryEntryList ActionKey = "agent.memory.entry.list"
	AgentMemoryEntryRead ActionKey = "agent.memory.entry.read"
)

type Source string

const (
	PlatformNative Source = "PLATFORM_NATIVE"
)

type ToolStatus string

const (
	StatusPROVISIONING ToolStatus = "PROVISIONING"
	StickyACTIVE       ToolStatus = "ACTIVE"
)

type ProtocolSessionViewState string

const (
	Admitted         ProtocolSessionViewState = "ADMITTED"
	Closed           ProtocolSessionViewState = "CLOSED"
	FluffyCONFLICT   ProtocolSessionViewState = "CONFLICT"
	FluffyDIRTY      ProtocolSessionViewState = "DIRTY"
	FluffyEXPIRED    ProtocolSessionViewState = "EXPIRED"
	FluffyFAILED     ProtocolSessionViewState = "FAILED"
	FluffyREVOKED    ProtocolSessionViewState = "REVOKED"
	FluffySAVED      ProtocolSessionViewState = "SAVED"
	Opening          ProtocolSessionViewState = "OPENING"
	ReadOnly         ProtocolSessionViewState = "READ_ONLY"
	StateOPEN        ProtocolSessionViewState = "OPEN"
	TentacledUNKNOWN ProtocolSessionViewState = "UNKNOWN"
)

type CreateActionKey string

const (
	WorkspaceCreate CreateActionKey = "workspace.create"
)

// 当前 Principal 经 fresh Tenant manage 检查、按该 Workspace 当前状态可发起的暂停（ACTIVE 或
// ERROR）或恢复（SUSPENDED）动作 key；目录未开放、无权、处于收敛中或本页提示判定失败时省略
//
// Workspace 暂停与恢复的 ActionDefinition key（.design/06 §7.3）。两者都从 Tenant scope 发起；当前不登记
// Workspace delete（DD-46）。
type WorkspaceLifecycleActionKey string

const (
	WorkspaceRestore WorkspaceLifecycleActionKey = "workspace.restore"
	WorkspaceSuspend WorkspaceLifecycleActionKey = "workspace.suspend"
)

// Workspace 状态机。权威定义见 .design/03-领域模型与权限模型.md。
type WorkspaceState string

const (
	WorkspaceStateACTIVE       WorkspaceState = "ACTIVE"
	WorkspaceStateERROR        WorkspaceState = "ERROR"
	WorkspaceStatePROVISIONING WorkspaceState = "PROVISIONING"
	WorkspaceStateRESTORING    WorkspaceState = "RESTORING"
	WorkspaceStateSUSPENDED    WorkspaceState = "SUSPENDED"
	WorkspaceStateSUSPENDING   WorkspaceState = "SUSPENDING"
)

// PlatformSession.access_mode（.design/03 §2）；受限会话不授予普通管理面或协作面准入。
type PlatformSessionAccessMode string

const (
	Full                PlatformSessionAccessMode = "FULL"
	LifecycleRestricted PlatformSessionAccessMode = "LIFECYCLE_RESTRICTED"
)

// TenantInvitation 在视图中的状态（DD-83）。库里只存 ISSUED/REDEEMED/REVOKED；EXPIRED 是查询时判定：expires_at
// 已过的 ISSUED 邀请即 EXPIRED，没有回收作业去写它。
type TenantInvitationStatus string

const (
	Issued                        TenantInvitationStatus = "ISSUED"
	Redeemed                      TenantInvitationStatus = "REDEEMED"
	TenantInvitationStatusEXPIRED TenantInvitationStatus = "EXPIRED"
	TenantInvitationStatusREVOKED TenantInvitationStatus = "REVOKED"
)

// 原 Buzz 频道消息语义。缺省 STREAM 保持旧请求；不允许调用者提交任意事件 kind。
type WebMessageType string

const (
	ForumComment         WebMessageType = "FORUM_COMMENT"
	ForumPost            WebMessageType = "FORUM_POST"
	WebMessageTypeSTREAM WebMessageType = "STREAM"
)

type CapabilityVectorFormat string

const (
	V1 CapabilityVectorFormat = "V1"
)

// ADR-12 / design07§5.2 固定的出站逻辑操作。服务入站操作不通过此面调用。
type AdapterProtocolOperation string

const (
	AdapterProtocolOperationCancel               AdapterProtocolOperation = "cancel"
	AdapterProtocolOperationExecute              AdapterProtocolOperation = "execute"
	AdapterProtocolOperationExtractUsage         AdapterProtocolOperation = "extract_usage"
	AdapterProtocolOperationHandshake            AdapterProtocolOperation = "handshake"
	AdapterProtocolOperationMapNativeStatusError AdapterProtocolOperation = "map_native_status_error"
	AdapterProtocolOperationObserve              AdapterProtocolOperation = "observe"
	AdapterProtocolOperationQueryRevision        AdapterProtocolOperation = "query_revision"
	AdapterProtocolOperationReconcile            AdapterProtocolOperation = "reconcile"
	AdapterProtocolOperationResolveNativeScope   AdapterProtocolOperation = "resolve_native_scope"
	AdapterProtocolOperationValidateBinding      AdapterProtocolOperation = "validate_binding"
)

type NativeDocumentSelectionActionKey string

const (
	FileStorageOpenEditV1 NativeDocumentSelectionActionKey = "file_storage.open_edit@v1"
	FileStorageOpenViewV1 NativeDocumentSelectionActionKey = "file_storage.open_view@v1"
)

// ApprovalPolicy.owner_requirement（.design/03 §4）。
type ApprovalOwnerRequirement string

const (
	AllAffectedOwners            ApprovalOwnerRequirement = "ALL_AFFECTED_OWNERS"
	ApprovalOwnerRequirementNONE ApprovalOwnerRequirement = "NONE"
	TargetOwner                  ApprovalOwnerRequirement = "TARGET_OWNER"
)

// ApprovalPolicy.self_approval：发起者能否批准自己的请求（职责分离）。
type ApprovalSelfApproval string

const (
	ApprovalSelfApprovalALLOW ApprovalSelfApproval = "ALLOW"
	ApprovalSelfApprovalDENY  ApprovalSelfApproval = "DENY"
)

type AutomationScheduleSource string

const (
	AutomationScheduleSourceSCHEDULE AutomationScheduleSource = "SCHEDULE"
)
