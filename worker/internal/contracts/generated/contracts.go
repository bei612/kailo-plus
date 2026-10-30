// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse and unparse this JSON data, add this code to your project and do:
//
//    canary, err := UnmarshalCanary(bytes)
//    bytes, err = canary.Marshal()
//
//    applicationModelAdmission, err := UnmarshalApplicationModelAdmission(bytes)
//    bytes, err = applicationModelAdmission.Marshal()
//
//    fileStorageDeleteInput, err := UnmarshalFileStorageDeleteInput(bytes)
//    bytes, err = fileStorageDeleteInput.Marshal()
//
//    fileStorageDeleteOutput, err := UnmarshalFileStorageDeleteOutput(bytes)
//    bytes, err = fileStorageDeleteOutput.Marshal()
//
//    fileStorageExportInput, err := UnmarshalFileStorageExportInput(bytes)
//    bytes, err = fileStorageExportInput.Marshal()
//
//    fileStorageExportOutput, err := UnmarshalFileStorageExportOutput(bytes)
//    bytes, err = fileStorageExportOutput.Marshal()
//
//    fileStorageListInput, err := UnmarshalFileStorageListInput(bytes)
//    bytes, err = fileStorageListInput.Marshal()
//
//    fileStorageListOutput, err := UnmarshalFileStorageListOutput(bytes)
//    bytes, err = fileStorageListOutput.Marshal()
//
//    fileStorageListRevisionsInput, err := UnmarshalFileStorageListRevisionsInput(bytes)
//    bytes, err = fileStorageListRevisionsInput.Marshal()
//
//    fileStorageListRevisionsOutput, err := UnmarshalFileStorageListRevisionsOutput(bytes)
//    bytes, err = fileStorageListRevisionsOutput.Marshal()
//
//    fileStorageReadInput, err := UnmarshalFileStorageReadInput(bytes)
//    bytes, err = fileStorageReadInput.Marshal()
//
//    fileStorageReadOutput, err := UnmarshalFileStorageReadOutput(bytes)
//    bytes, err = fileStorageReadOutput.Marshal()
//
//    fileStorageShareInput, err := UnmarshalFileStorageShareInput(bytes)
//    bytes, err = fileStorageShareInput.Marshal()
//
//    fileStorageShareOutput, err := UnmarshalFileStorageShareOutput(bytes)
//    bytes, err = fileStorageShareOutput.Marshal()
//
//    fileStorageWriteInput, err := UnmarshalFileStorageWriteInput(bytes)
//    bytes, err = fileStorageWriteInput.Marshal()
//
//    fileStorageWriteOutput, err := UnmarshalFileStorageWriteOutput(bytes)
//    bytes, err = fileStorageWriteOutput.Marshal()
//
//    knowledgeSyncInput, err := UnmarshalKnowledgeSyncInput(bytes)
//    bytes, err = knowledgeSyncInput.Marshal()
//
//    adapterBindingObservation, err := UnmarshalAdapterBindingObservation(bytes)
//    bytes, err = adapterBindingObservation.Marshal()
//
//    adapterBindingReconcileRequest, err := UnmarshalAdapterBindingReconcileRequest(bytes)
//    bytes, err = adapterBindingReconcileRequest.Marshal()
//
//    adapterBindingReconcileResponse, err := UnmarshalAdapterBindingReconcileResponse(bytes)
//    bytes, err = adapterBindingReconcileResponse.Marshal()
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
//    nativeTaskExecutionAdmissionRequest, err := UnmarshalNativeTaskExecutionAdmissionRequest(bytes)
//    bytes, err = nativeTaskExecutionAdmissionRequest.Marshal()
//
//    nativeTaskExecutionAdmissionResponse, err := UnmarshalNativeTaskExecutionAdmissionResponse(bytes)
//    bytes, err = nativeTaskExecutionAdmissionResponse.Marshal()
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
//    adapterReadGrantRequest, err := UnmarshalAdapterReadGrantRequest(bytes)
//    bytes, err = adapterReadGrantRequest.Marshal()
//
//    adapterReadGrantResponse, err := UnmarshalAdapterReadGrantResponse(bytes)
//    bytes, err = adapterReadGrantResponse.Marshal()
//
//    adapterReadReceipt, err := UnmarshalAdapterReadReceipt(bytes)
//    bytes, err = adapterReadReceipt.Marshal()
//
//    adapterScopeObservation, err := UnmarshalAdapterScopeObservation(bytes)
//    bytes, err = adapterScopeObservation.Marshal()
//
//    adapterSearchRequest, err := UnmarshalAdapterSearchRequest(bytes)
//    bytes, err = adapterSearchRequest.Marshal()
//
//    adapterSearchResponse, err := UnmarshalAdapterSearchResponse(bytes)
//    bytes, err = adapterSearchResponse.Marshal()
//
//    adapterSourceResource, err := UnmarshalAdapterSourceResource(bytes)
//    bytes, err = adapterSourceResource.Marshal()
//
//    actionCommand, err := UnmarshalActionCommand(bytes)
//    bytes, err = actionCommand.Marshal()
//
//    actionSubmission, err := UnmarshalActionSubmission(bytes)
//    bytes, err = actionSubmission.Marshal()
//
//    agentActiveTurnPage, err := UnmarshalAgentActiveTurnPage(bytes)
//    bytes, err = agentActiveTurnPage.Marshal()
//
//    agentActiveTurnView, err := UnmarshalAgentActiveTurnView(bytes)
//    bytes, err = agentActiveTurnView.Marshal()
//
//    agentAuthorDirectory, err := UnmarshalAgentAuthorDirectory(bytes)
//    bytes, err = agentAuthorDirectory.Marshal()
//
//    agentCatalogOwners, err := UnmarshalAgentCatalogOwners(bytes)
//    bytes, err = agentCatalogOwners.Marshal()
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
//    agentImportConfigurationPage, err := UnmarshalAgentImportConfigurationPage(bytes)
//    bytes, err = agentImportConfigurationPage.Marshal()
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
//    agentInstallationSkillPage, err := UnmarshalAgentInstallationSkillPage(bytes)
//    bytes, err = agentInstallationSkillPage.Marshal()
//
//    agentInstallationSkillView, err := UnmarshalAgentInstallationSkillView(bytes)
//    bytes, err = agentInstallationSkillView.Marshal()
//
//    agentInstallationToolPage, err := UnmarshalAgentInstallationToolPage(bytes)
//    bytes, err = agentInstallationToolPage.Marshal()
//
//    agentInstallationUsePage, err := UnmarshalAgentInstallationUsePage(bytes)
//    bytes, err = agentInstallationUsePage.Marshal()
//
//    agentInstallationView, err := UnmarshalAgentInstallationView(bytes)
//    bytes, err = agentInstallationView.Marshal()
//
//    agentInvocationPage, err := UnmarshalAgentInvocationPage(bytes)
//    bytes, err = agentInvocationPage.Marshal()
//
//    agentInvocationView, err := UnmarshalAgentInvocationView(bytes)
//    bytes, err = agentInvocationView.Marshal()
//
//    agentMemoryDanglingRefView, err := UnmarshalAgentMemoryDanglingRefView(bytes)
//    bytes, err = agentMemoryDanglingRefView.Marshal()
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
//    agentMemoryReferenceView, err := UnmarshalAgentMemoryReferenceView(bytes)
//    bytes, err = agentMemoryReferenceView.Marshal()
//
//    agentMentionOutcomePage, err := UnmarshalAgentMentionOutcomePage(bytes)
//    bytes, err = agentMentionOutcomePage.Marshal()
//
//    agentMentionOutcomeQueryRequest, err := UnmarshalAgentMentionOutcomeQueryRequest(bytes)
//    bytes, err = agentMentionOutcomeQueryRequest.Marshal()
//
//    agentSessionPage, err := UnmarshalAgentSessionPage(bytes)
//    bytes, err = agentSessionPage.Marshal()
//
//    agentSessionView, err := UnmarshalAgentSessionView(bytes)
//    bytes, err = agentSessionView.Marshal()
//
//    agentSnapshotImportPreview, err := UnmarshalAgentSnapshotImportPreview(bytes)
//    bytes, err = agentSnapshotImportPreview.Marshal()
//
//    agentSnapshotUploadRequest, err := UnmarshalAgentSnapshotUploadRequest(bytes)
//    bytes, err = agentSnapshotUploadRequest.Marshal()
//
//    agentTeamPage, err := UnmarshalAgentTeamPage(bytes)
//    bytes, err = agentTeamPage.Marshal()
//
//    agentTeamSnapshotImportPreview, err := UnmarshalAgentTeamSnapshotImportPreview(bytes)
//    bytes, err = agentTeamSnapshotImportPreview.Marshal()
//
//    agentTeamSnapshotUploadRequest, err := UnmarshalAgentTeamSnapshotUploadRequest(bytes)
//    bytes, err = agentTeamSnapshotUploadRequest.Marshal()
//
//    agentTeamView, err := UnmarshalAgentTeamView(bytes)
//    bytes, err = agentTeamView.Marshal()
//
//    agentTranscriptEvent, err := UnmarshalAgentTranscriptEvent(bytes)
//    bytes, err = agentTranscriptEvent.Marshal()
//
//    agentTranscriptItem, err := UnmarshalAgentTranscriptItem(bytes)
//    bytes, err = agentTranscriptItem.Marshal()
//
//    agentTranscriptPage, err := UnmarshalAgentTranscriptPage(bytes)
//    bytes, err = agentTranscriptPage.Marshal()
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
//    applicationReadResourcePage, err := UnmarshalApplicationReadResourcePage(bytes)
//    bytes, err = applicationReadResourcePage.Marshal()
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
//    automationApprovalStepView, err := UnmarshalAutomationApprovalStepView(bytes)
//    bytes, err = automationApprovalStepView.Marshal()
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
//    automationWebhookSecret, err := UnmarshalAutomationWebhookSecret(bytes)
//    bytes, err = automationWebhookSecret.Marshal()
//
//    businessOperationPage, err := UnmarshalBusinessOperationPage(bytes)
//    bytes, err = businessOperationPage.Marshal()
//
//    businessOperationPhaseCount, err := UnmarshalBusinessOperationPhaseCount(bytes)
//    bytes, err = businessOperationPhaseCount.Marshal()
//
//    businessOperationSummary, err := UnmarshalBusinessOperationSummary(bytes)
//    bytes, err = businessOperationSummary.Marshal()
//
//    businessOperationView, err := UnmarshalBusinessOperationView(bytes)
//    bytes, err = businessOperationView.Marshal()
//
//    capabilityContractPage, err := UnmarshalCapabilityContractPage(bytes)
//    bytes, err = capabilityContractPage.Marshal()
//
//    capabilityContractView, err := UnmarshalCapabilityContractView(bytes)
//    bytes, err = capabilityContractView.Marshal()
//
//    channelTemplateRequest, err := UnmarshalChannelTemplateRequest(bytes)
//    bytes, err = channelTemplateRequest.Marshal()
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
//    componentMemberDirectory, err := UnmarshalComponentMemberDirectory(bytes)
//    bytes, err = componentMemberDirectory.Marshal()
//
//    componentNotificationDelivery, err := UnmarshalComponentNotificationDelivery(bytes)
//    bytes, err = componentNotificationDelivery.Marshal()
//
//    componentNotificationPage, err := UnmarshalComponentNotificationPage(bytes)
//    bytes, err = componentNotificationPage.Marshal()
//
//    componentNotificationReadRequest, err := UnmarshalComponentNotificationReadRequest(bytes)
//    bytes, err = componentNotificationReadRequest.Marshal()
//
//    componentNotificationReceipt, err := UnmarshalComponentNotificationReceipt(bytes)
//    bytes, err = componentNotificationReceipt.Marshal()
//
//    componentNotificationView, err := UnmarshalComponentNotificationView(bytes)
//    bytes, err = componentNotificationView.Marshal()
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
//    componentSearchPage, err := UnmarshalComponentSearchPage(bytes)
//    bytes, err = componentSearchPage.Marshal()
//
//    componentSearchQuery, err := UnmarshalComponentSearchQuery(bytes)
//    bytes, err = componentSearchQuery.Marshal()
//
//    componentUsageAdmission, err := UnmarshalComponentUsageAdmission(bytes)
//    bytes, err = componentUsageAdmission.Marshal()
//
//    componentUsageAdmissionRequest, err := UnmarshalComponentUsageAdmissionRequest(bytes)
//    bytes, err = componentUsageAdmissionRequest.Marshal()
//
//    componentUsagePage, err := UnmarshalComponentUsagePage(bytes)
//    bytes, err = componentUsagePage.Marshal()
//
//    componentUsageReceipt, err := UnmarshalComponentUsageReceipt(bytes)
//    bytes, err = componentUsageReceipt.Marshal()
//
//    componentUsageReport, err := UnmarshalComponentUsageReport(bytes)
//    bytes, err = componentUsageReport.Marshal()
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
//    exportPackageView, err := UnmarshalExportPackageView(bytes)
//    bytes, err = exportPackageView.Marshal()
//
//    feedbackAttachmentContent, err := UnmarshalFeedbackAttachmentContent(bytes)
//    bytes, err = feedbackAttachmentContent.Marshal()
//
//    feedbackSubmissionReceipt, err := UnmarshalFeedbackSubmissionReceipt(bytes)
//    bytes, err = feedbackSubmissionReceipt.Marshal()
//
//    feedbackSubmissionRequest, err := UnmarshalFeedbackSubmissionRequest(bytes)
//    bytes, err = feedbackSubmissionRequest.Marshal()
//
//    followedPrincipalRequest, err := UnmarshalFollowedPrincipalRequest(bytes)
//    bytes, err = followedPrincipalRequest.Marshal()
//
//    gatewayAccess, err := UnmarshalGatewayAccess(bytes)
//    bytes, err = gatewayAccess.Marshal()
//
//    gatewayCallDetail, err := UnmarshalGatewayCallDetail(bytes)
//    bytes, err = gatewayCallDetail.Marshal()
//
//    gatewayCallPage, err := UnmarshalGatewayCallPage(bytes)
//    bytes, err = gatewayCallPage.Marshal()
//
//    gatewayCallView, err := UnmarshalGatewayCallView(bytes)
//    bytes, err = gatewayCallView.Marshal()
//
//    gatewayConfigHistory, err := UnmarshalGatewayConfigHistory(bytes)
//    bytes, err = gatewayConfigHistory.Marshal()
//
//    gatewayConfigView, err := UnmarshalGatewayConfigView(bytes)
//    bytes, err = gatewayConfigView.Marshal()
//
//    gatewayMCPBindingDraft, err := UnmarshalGatewayMCPBindingDraft(bytes)
//    bytes, err = gatewayMCPBindingDraft.Marshal()
//
//    gatewayMCPBindingDraftRequest, err := UnmarshalGatewayMCPBindingDraftRequest(bytes)
//    bytes, err = gatewayMCPBindingDraftRequest.Marshal()
//
//    gatewayMCPBindingFact, err := UnmarshalGatewayMCPBindingFact(bytes)
//    bytes, err = gatewayMCPBindingFact.Marshal()
//
//    gatewayMCPPeerPage, err := UnmarshalGatewayMCPPeerPage(bytes)
//    bytes, err = gatewayMCPPeerPage.Marshal()
//
//    gatewayMCPProbeRequest, err := UnmarshalGatewayMCPProbeRequest(bytes)
//    bytes, err = gatewayMCPProbeRequest.Marshal()
//
//    gatewayMCPProbeResult, err := UnmarshalGatewayMCPProbeResult(bytes)
//    bytes, err = gatewayMCPProbeResult.Marshal()
//
//    gatewayMCPReleasePage, err := UnmarshalGatewayMCPReleasePage(bytes)
//    bytes, err = gatewayMCPReleasePage.Marshal()
//
//    gatewayModelRoutePage, err := UnmarshalGatewayModelRoutePage(bytes)
//    bytes, err = gatewayModelRoutePage.Marshal()
//
//    gatewayModelSourcePage, err := UnmarshalGatewayModelSourcePage(bytes)
//    bytes, err = gatewayModelSourcePage.Marshal()
//
//    gatewayStats, err := UnmarshalGatewayStats(bytes)
//    bytes, err = gatewayStats.Marshal()
//
//    gatewayStatsCounters, err := UnmarshalGatewayStatsCounters(bytes)
//    bytes, err = gatewayStatsCounters.Marshal()
//
//    gatewayToolPage, err := UnmarshalGatewayToolPage(bytes)
//    bytes, err = gatewayToolPage.Marshal()
//
//    gatewayToolTestCallResult, err := UnmarshalGatewayToolTestCallResult(bytes)
//    bytes, err = gatewayToolTestCallResult.Marshal()
//
//    huddleAnnouncementView, err := UnmarshalHuddleAnnouncementView(bytes)
//    bytes, err = huddleAnnouncementView.Marshal()
//
//    huddleLifecycleEvent, err := UnmarshalHuddleLifecycleEvent(bytes)
//    bytes, err = huddleLifecycleEvent.Marshal()
//
//    huddleLifecyclePage, err := UnmarshalHuddleLifecyclePage(bytes)
//    bytes, err = huddleLifecyclePage.Marshal()
//
//    huddlePage, err := UnmarshalHuddlePage(bytes)
//    bytes, err = huddlePage.Marshal()
//
//    huddleView, err := UnmarshalHuddleView(bytes)
//    bytes, err = huddleView.Marshal()
//
//    huddleVoiceView, err := UnmarshalHuddleVoiceView(bytes)
//    bytes, err = huddleVoiceView.Marshal()
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
//    mCPConnectionPage, err := UnmarshalMCPConnectionPage(bytes)
//    bytes, err = mCPConnectionPage.Marshal()
//
//    mCPConnectionPolicyView, err := UnmarshalMCPConnectionPolicyView(bytes)
//    bytes, err = mCPConnectionPolicyView.Marshal()
//
//    mCPConnectionProbeRequest, err := UnmarshalMCPConnectionProbeRequest(bytes)
//    bytes, err = mCPConnectionProbeRequest.Marshal()
//
//    mCPConnectionProbeResult, err := UnmarshalMCPConnectionProbeResult(bytes)
//    bytes, err = mCPConnectionProbeResult.Marshal()
//
//    mCPConnectionRefreshResult, err := UnmarshalMCPConnectionRefreshResult(bytes)
//    bytes, err = mCPConnectionRefreshResult.Marshal()
//
//    mCPConnectionToolView, err := UnmarshalMCPConnectionToolView(bytes)
//    bytes, err = mCPConnectionToolView.Marshal()
//
//    mCPConnectionView, err := UnmarshalMCPConnectionView(bytes)
//    bytes, err = mCPConnectionView.Marshal()
//
//    mCPOauthAttemptView, err := UnmarshalMCPOauthAttemptView(bytes)
//    bytes, err = mCPOauthAttemptView.Marshal()
//
//    mCPOauthStartRequest, err := UnmarshalMCPOauthStartRequest(bytes)
//    bytes, err = mCPOauthStartRequest.Marshal()
//
//    mCPProbedTool, err := UnmarshalMCPProbedTool(bytes)
//    bytes, err = mCPProbedTool.Marshal()
//
//    memberUsagePage, err := UnmarshalMemberUsagePage(bytes)
//    bytes, err = memberUsagePage.Marshal()
//
//    moderationAccessView, err := UnmarshalModerationAccessView(bytes)
//    bytes, err = moderationAccessView.Marshal()
//
//    moderationAuditPage, err := UnmarshalModerationAuditPage(bytes)
//    bytes, err = moderationAuditPage.Marshal()
//
//    moderationReportPage, err := UnmarshalModerationReportPage(bytes)
//    bytes, err = moderationReportPage.Marshal()
//
//    moderationRestrictionPage, err := UnmarshalModerationRestrictionPage(bytes)
//    bytes, err = moderationRestrictionPage.Marshal()
//
//    nativeCommunityFacts, err := UnmarshalNativeCommunityFacts(bytes)
//    bytes, err = nativeCommunityFacts.Marshal()
//
//    nativeHumanActionRequest, err := UnmarshalNativeHumanActionRequest(bytes)
//    bytes, err = nativeHumanActionRequest.Marshal()
//
//    nativeHumanActionResult, err := UnmarshalNativeHumanActionResult(bytes)
//    bytes, err = nativeHumanActionResult.Marshal()
//
//    nativeHumanReadReceipt, err := UnmarshalNativeHumanReadReceipt(bytes)
//    bytes, err = nativeHumanReadReceipt.Marshal()
//
//    nativeHumanResourceResult, err := UnmarshalNativeHumanResourceResult(bytes)
//    bytes, err = nativeHumanResourceResult.Marshal()
//
//    nativeHumanScopeResult, err := UnmarshalNativeHumanScopeResult(bytes)
//    bytes, err = nativeHumanScopeResult.Marshal()
//
//    operationUsageCount, err := UnmarshalOperationUsageCount(bytes)
//    bytes, err = operationUsageCount.Marshal()
//
//    ownAuditEntry, err := UnmarshalOwnAuditEntry(bytes)
//    bytes, err = ownAuditEntry.Marshal()
//
//    platformFeedbackPage, err := UnmarshalPlatformFeedbackPage(bytes)
//    bytes, err = platformFeedbackPage.Marshal()
//
//    platformFeedbackTriageRequest, err := UnmarshalPlatformFeedbackTriageRequest(bytes)
//    bytes, err = platformFeedbackTriageRequest.Marshal()
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
//    projectChannelRequest, err := UnmarshalProjectChannelRequest(bytes)
//    bytes, err = projectChannelRequest.Marshal()
//
//    projectChannelRequestApprovalView, err := UnmarshalProjectChannelRequestApprovalView(bytes)
//    bytes, err = projectChannelRequestApprovalView.Marshal()
//
//    projectPreferenceRequest, err := UnmarshalProjectPreferenceRequest(bytes)
//    bytes, err = projectPreferenceRequest.Marshal()
//
//    projectsGitMergeRequest, err := UnmarshalProjectsGitMergeRequest(bytes)
//    bytes, err = projectsGitMergeRequest.Marshal()
//
//    projectsGitMergeResponse, err := UnmarshalProjectsGitMergeResponse(bytes)
//    bytes, err = projectsGitMergeResponse.Marshal()
//
//    projectsGitQueryRequest, err := UnmarshalProjectsGitQueryRequest(bytes)
//    bytes, err = projectsGitQueryRequest.Marshal()
//
//    projectsGitQueryResponse, err := UnmarshalProjectsGitQueryResponse(bytes)
//    bytes, err = projectsGitQueryResponse.Marshal()
//
//    projectsGitRefRequest, err := UnmarshalProjectsGitRefRequest(bytes)
//    bytes, err = projectsGitRefRequest.Marshal()
//
//    projectsGitRefResponse, err := UnmarshalProjectsGitRefResponse(bytes)
//    bytes, err = projectsGitRefResponse.Marshal()
//
//    projectsPublishRequest, err := UnmarshalProjectsPublishRequest(bytes)
//    bytes, err = projectsPublishRequest.Marshal()
//
//    projectsQueryRequest, err := UnmarshalProjectsQueryRequest(bytes)
//    bytes, err = projectsQueryRequest.Marshal()
//
//    protocolSessionView, err := UnmarshalProtocolSessionView(bytes)
//    bytes, err = protocolSessionView.Marshal()
//
//    pulsePublishRequest, err := UnmarshalPulsePublishRequest(bytes)
//    bytes, err = pulsePublishRequest.Marshal()
//
//    pulseQueryRequest, err := UnmarshalPulseQueryRequest(bytes)
//    bytes, err = pulseQueryRequest.Marshal()
//
//    pushCapability, err := UnmarshalPushCapability(bytes)
//    bytes, err = pushCapability.Marshal()
//
//    pushRegistrationRequest, err := UnmarshalPushRegistrationRequest(bytes)
//    bytes, err = pushRegistrationRequest.Marshal()
//
//    pushRegistrationView, err := UnmarshalPushRegistrationView(bytes)
//    bytes, err = pushRegistrationView.Marshal()
//
//    readMarkRequest, err := UnmarshalReadMarkRequest(bytes)
//    bytes, err = readMarkRequest.Marshal()
//
//    reminderPublishRequest, err := UnmarshalReminderPublishRequest(bytes)
//    bytes, err = reminderPublishRequest.Marshal()
//
//    reminderSourceRequest, err := UnmarshalReminderSourceRequest(bytes)
//    bytes, err = reminderSourceRequest.Marshal()
//
//    reminderView, err := UnmarshalReminderView(bytes)
//    bytes, err = reminderView.Marshal()
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
//    sidebarAssignmentRequest, err := UnmarshalSidebarAssignmentRequest(bytes)
//    bytes, err = sidebarAssignmentRequest.Marshal()
//
//    sidebarSectionRequest, err := UnmarshalSidebarSectionRequest(bytes)
//    bytes, err = sidebarSectionRequest.Marshal()
//
//    sidebarSectionOrderRequest, err := UnmarshalSidebarSectionOrderRequest(bytes)
//    bytes, err = sidebarSectionOrderRequest.Marshal()
//
//    sidebarSortRequest, err := UnmarshalSidebarSortRequest(bytes)
//    bytes, err = sidebarSortRequest.Marshal()
//
//    skillArtifactUploadRequest, err := UnmarshalSkillArtifactUploadRequest(bytes)
//    bytes, err = skillArtifactUploadRequest.Marshal()
//
//    skillArtifactUploadView, err := UnmarshalSkillArtifactUploadView(bytes)
//    bytes, err = skillArtifactUploadView.Marshal()
//
//    skillArtifactViolation, err := UnmarshalSkillArtifactViolation(bytes)
//    bytes, err = skillArtifactViolation.Marshal()
//
//    skillDefinitionPage, err := UnmarshalSkillDefinitionPage(bytes)
//    bytes, err = skillDefinitionPage.Marshal()
//
//    skillDefinitionView, err := UnmarshalSkillDefinitionView(bytes)
//    bytes, err = skillDefinitionView.Marshal()
//
//    skillReferencePage, err := UnmarshalSkillReferencePage(bytes)
//    bytes, err = skillReferencePage.Marshal()
//
//    skillVersionContentView, err := UnmarshalSkillVersionContentView(bytes)
//    bytes, err = skillVersionContentView.Marshal()
//
//    skillVersionPage, err := UnmarshalSkillVersionPage(bytes)
//    bytes, err = skillVersionPage.Marshal()
//
//    skillVersionView, err := UnmarshalSkillVersionView(bytes)
//    bytes, err = skillVersionView.Marshal()
//
//    taskView, err := UnmarshalTaskView(bytes)
//    bytes, err = taskView.Marshal()
//
//    tenantInvitationView, err := UnmarshalTenantInvitationView(bytes)
//    bytes, err = tenantInvitationView.Marshal()
//
//    tenantMemberJoinPage, err := UnmarshalTenantMemberJoinPage(bytes)
//    bytes, err = tenantMemberJoinPage.Marshal()
//
//    tenantMemberJoinView, err := UnmarshalTenantMemberJoinView(bytes)
//    bytes, err = tenantMemberJoinView.Marshal()
//
//    tenantProfileView, err := UnmarshalTenantProfileView(bytes)
//    bytes, err = tenantProfileView.Marshal()
//
//    tenantQuotaPage, err := UnmarshalTenantQuotaPage(bytes)
//    bytes, err = tenantQuotaPage.Marshal()
//
//    threadPreferenceRequest, err := UnmarshalThreadPreferenceRequest(bytes)
//    bytes, err = threadPreferenceRequest.Marshal()
//
//    usageBillingView, err := UnmarshalUsageBillingView(bytes)
//    bytes, err = usageBillingView.Marshal()
//
//    userStateVersion, err := UnmarshalUserStateVersion(bytes)
//    bytes, err = userStateVersion.Marshal()
//
//    webChannelCanvasView, err := UnmarshalWebChannelCanvasView(bytes)
//    bytes, err = webChannelCanvasView.Marshal()
//
//    webChannelView, err := UnmarshalWebChannelView(bytes)
//    bytes, err = webChannelView.Marshal()
//
//    webCustomEmojiMutation, err := UnmarshalWebCustomEmojiMutation(bytes)
//    bytes, err = webCustomEmojiMutation.Marshal()
//
//    webCustomEmojiView, err := UnmarshalWebCustomEmojiView(bytes)
//    bytes, err = webCustomEmojiView.Marshal()
//
//    webGIFCapabilityView, err := UnmarshalWebGIFCapabilityView(bytes)
//    bytes, err = webGIFCapabilityView.Marshal()
//
//    webGIFItem, err := UnmarshalWebGIFItem(bytes)
//    bytes, err = webGIFItem.Marshal()
//
//    webGIFSearchRequest, err := UnmarshalWebGIFSearchRequest(bytes)
//    bytes, err = webGIFSearchRequest.Marshal()
//
//    webGIFSearchView, err := UnmarshalWebGIFSearchView(bytes)
//    bytes, err = webGIFSearchView.Marshal()
//
//    webGIFShareRequest, err := UnmarshalWebGIFShareRequest(bytes)
//    bytes, err = webGIFShareRequest.Marshal()
//
//    webInboxQuery, err := UnmarshalWebInboxQuery(bytes)
//    bytes, err = webInboxQuery.Marshal()
//
//    webLinkPreviewRequest, err := UnmarshalWebLinkPreviewRequest(bytes)
//    bytes, err = webLinkPreviewRequest.Marshal()
//
//    webLinkPreviewSnapshotView, err := UnmarshalWebLinkPreviewSnapshotView(bytes)
//    bytes, err = webLinkPreviewSnapshotView.Marshal()
//
//    webMessageAttachment, err := UnmarshalWebMessageAttachment(bytes)
//    bytes, err = webMessageAttachment.Marshal()
//
//    webMessageAuthorQuery, err := UnmarshalWebMessageAuthorQuery(bytes)
//    bytes, err = webMessageAuthorQuery.Marshal()
//
//    webMessageAuthorView, err := UnmarshalWebMessageAuthorView(bytes)
//    bytes, err = webMessageAuthorView.Marshal()
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
//    webPresencePage, err := UnmarshalWebPresencePage(bytes)
//    bytes, err = webPresencePage.Marshal()
//
//    webPresenceQueryRequest, err := UnmarshalWebPresenceQueryRequest(bytes)
//    bytes, err = webPresenceQueryRequest.Marshal()
//
//    webPresenceUpdateRequest, err := UnmarshalWebPresenceUpdateRequest(bytes)
//    bytes, err = webPresenceUpdateRequest.Marshal()
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
//    webPublishTopicRequest, err := UnmarshalWebPublishTopicRequest(bytes)
//    bytes, err = webPublishTopicRequest.Marshal()
//
//    webSearchQuery, err := UnmarshalWebSearchQuery(bytes)
//    bytes, err = webSearchQuery.Marshal()
//
//    webTypingRequest, err := UnmarshalWebTypingRequest(bytes)
//    bytes, err = webTypingRequest.Marshal()
//
//    webUserStatusPage, err := UnmarshalWebUserStatusPage(bytes)
//    bytes, err = webUserStatusPage.Marshal()
//
//    webUserStatusQueryRequest, err := UnmarshalWebUserStatusQueryRequest(bytes)
//    bytes, err = webUserStatusQueryRequest.Marshal()
//
//    webUserStatusUpdateRequest, err := UnmarshalWebUserStatusUpdateRequest(bytes)
//    bytes, err = webUserStatusUpdateRequest.Marshal()
//
//    webWorkspaceActivityPage, err := UnmarshalWebWorkspaceActivityPage(bytes)
//    bytes, err = webWorkspaceActivityPage.Marshal()
//
//    webWorkspaceActivityQuery, err := UnmarshalWebWorkspaceActivityQuery(bytes)
//    bytes, err = webWorkspaceActivityQuery.Marshal()
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
//    agentDefinitionExportInput, err := UnmarshalAgentDefinitionExportInput(bytes)
//    bytes, err = agentDefinitionExportInput.Marshal()
//
//    agentDefinitionImportInput, err := UnmarshalAgentDefinitionImportInput(bytes)
//    bytes, err = agentDefinitionImportInput.Marshal()
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
//    agentTeamExportInput, err := UnmarshalAgentTeamExportInput(bytes)
//    bytes, err = agentTeamExportInput.Marshal()
//
//    agentTeamImportInput, err := UnmarshalAgentTeamImportInput(bytes)
//    bytes, err = agentTeamImportInput.Marshal()
//
//    agentTeamInput, err := UnmarshalAgentTeamInput(bytes)
//    bytes, err = agentTeamInput.Marshal()
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
//    automationSecretRef, err := UnmarshalAutomationSecretRef(bytes)
//    bytes, err = automationSecretRef.Marshal()
//
//    automationStep, err := UnmarshalAutomationStep(bytes)
//    bytes, err = automationStep.Marshal()
//
//    automationStepTrace, err := UnmarshalAutomationStepTrace(bytes)
//    bytes, err = automationStepTrace.Marshal()
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
//    capabilityVectorBinding, err := UnmarshalCapabilityVectorBinding(bytes)
//    bytes, err = capabilityVectorBinding.Marshal()
//
//    capabilityVectorCapture, err := UnmarshalCapabilityVectorCapture(bytes)
//    bytes, err = capabilityVectorCapture.Marshal()
//
//    componentActionInput, err := UnmarshalComponentActionInput(bytes)
//    bytes, err = componentActionInput.Marshal()
//
//    componentConformanceCaptureValue, err := UnmarshalComponentConformanceCaptureValue(bytes)
//    bytes, err = componentConformanceCaptureValue.Marshal()
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
//    componentConformanceReceiverEnvironment, err := UnmarshalComponentConformanceReceiverEnvironment(bytes)
//    bytes, err = componentConformanceReceiverEnvironment.Marshal()
//
//    componentNativeReceiverObservation, err := UnmarshalComponentNativeReceiverObservation(bytes)
//    bytes, err = componentNativeReceiverObservation.Marshal()
//
//    componentNativeReceiverRequest, err := UnmarshalComponentNativeReceiverRequest(bytes)
//    bytes, err = componentNativeReceiverRequest.Marshal()
//
//    componentPersonRef, err := UnmarshalComponentPersonRef(bytes)
//    bytes, err = componentPersonRef.Marshal()
//
//    componentPreferenceDeclaration, err := UnmarshalComponentPreferenceDeclaration(bytes)
//    bytes, err = componentPreferenceDeclaration.Marshal()
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
//    componentText, err := UnmarshalComponentText(bytes)
//    bytes, err = componentText.Marshal()
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
//    huddleAgentInput, err := UnmarshalHuddleAgentInput(bytes)
//    bytes, err = huddleAgentInput.Marshal()
//
//    huddleStartInput, err := UnmarshalHuddleStartInput(bytes)
//    bytes, err = huddleStartInput.Marshal()
//
//    resolvedIdentity, err := UnmarshalResolvedIdentity(bytes)
//    bytes, err = resolvedIdentity.Marshal()
//
//    llmRouteCreateInput, err := UnmarshalLlmRouteCreateInput(bytes)
//    bytes, err = llmRouteCreateInput.Marshal()
//
//    mCPConnectionCreate, err := UnmarshalMCPConnectionCreate(bytes)
//    bytes, err = mCPConnectionCreate.Marshal()
//
//    mCPConnectionCredentialInput, err := UnmarshalMCPConnectionCredentialInput(bytes)
//    bytes, err = mCPConnectionCredentialInput.Marshal()
//
//    mCPConnectionPolicyUpdate, err := UnmarshalMCPConnectionPolicyUpdate(bytes)
//    bytes, err = mCPConnectionPolicyUpdate.Marshal()
//
//    mCPConnectionUpdate, err := UnmarshalMCPConnectionUpdate(bytes)
//    bytes, err = mCPConnectionUpdate.Marshal()
//
//    mCPToolSelection, err := UnmarshalMCPToolSelection(bytes)
//    bytes, err = mCPToolSelection.Marshal()
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
//    skillVersionUploadInput, err := UnmarshalSkillVersionUploadInput(bytes)
//    bytes, err = skillVersionUploadInput.Marshal()
//
//    taskStateReport, err := UnmarshalTaskStateReport(bytes)
//    bytes, err = taskStateReport.Marshal()
//
//    tenantProfileInput, err := UnmarshalTenantProfileInput(bytes)
//    bytes, err = tenantProfileInput.Marshal()
//
//    tenantQuotaSetting, err := UnmarshalTenantQuotaSetting(bytes)
//    bytes, err = tenantQuotaSetting.Marshal()
//
//    workflowRef, err := UnmarshalWorkflowRef(bytes)
//    bytes, err = workflowRef.Marshal()
//
//    workspaceCanvasSetInput, err := UnmarshalWorkspaceCanvasSetInput(bytes)
//    bytes, err = workspaceCanvasSetInput.Marshal()
//
//    workspaceChannelCreate, err := UnmarshalWorkspaceChannelCreate(bytes)
//    bytes, err = workspaceChannelCreate.Marshal()
//
//    workspaceUpdate, err := UnmarshalWorkspaceUpdate(bytes)
//    bytes, err = workspaceUpdate.Marshal()
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
//    resourceExportAdvanceRequest, err := UnmarshalResourceExportAdvanceRequest(bytes)
//    bytes, err = resourceExportAdvanceRequest.Marshal()
//
//    resourceExportAdvanceResult, err := UnmarshalResourceExportAdvanceResult(bytes)
//    bytes, err = resourceExportAdvanceResult.Marshal()
//
//    resourceExportTarget, err := UnmarshalResourceExportTarget(bytes)
//    bytes, err = resourceExportTarget.Marshal()
//
//    resourceImportAdvanceRequest, err := UnmarshalResourceImportAdvanceRequest(bytes)
//    bytes, err = resourceImportAdvanceRequest.Marshal()
//
//    resourceImportAdvanceResult, err := UnmarshalResourceImportAdvanceResult(bytes)
//    bytes, err = resourceImportAdvanceResult.Marshal()
//
//    resourceImportTarget, err := UnmarshalResourceImportTarget(bytes)
//    bytes, err = resourceImportTarget.Marshal()
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

func UnmarshalFileStorageDeleteInput(data []byte) (FileStorageDeleteInput, error) {
	var r FileStorageDeleteInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageDeleteInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageDeleteOutput(data []byte) (FileStorageDeleteOutput, error) {
	var r FileStorageDeleteOutput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageDeleteOutput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageExportInput(data []byte) (FileStorageExportInput, error) {
	var r FileStorageExportInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageExportInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageExportOutput(data []byte) (FileStorageExportOutput, error) {
	var r FileStorageExportOutput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageExportOutput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageListInput(data []byte) (FileStorageListInput, error) {
	var r FileStorageListInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageListInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageListOutput(data []byte) (FileStorageListOutput, error) {
	var r FileStorageListOutput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageListOutput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageListRevisionsInput(data []byte) (FileStorageListRevisionsInput, error) {
	var r FileStorageListRevisionsInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageListRevisionsInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageListRevisionsOutput(data []byte) (FileStorageListRevisionsOutput, error) {
	var r FileStorageListRevisionsOutput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageListRevisionsOutput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageReadInput(data []byte) (FileStorageReadInput, error) {
	var r FileStorageReadInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageReadInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageReadOutput(data []byte) (FileStorageReadOutput, error) {
	var r FileStorageReadOutput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageReadOutput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageShareInput(data []byte) (FileStorageShareInput, error) {
	var r FileStorageShareInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageShareInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageShareOutput(data []byte) (FileStorageShareOutput, error) {
	var r FileStorageShareOutput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageShareOutput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageWriteInput(data []byte) (FileStorageWriteInput, error) {
	var r FileStorageWriteInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageWriteInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFileStorageWriteOutput(data []byte) (FileStorageWriteOutput, error) {
	var r FileStorageWriteOutput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FileStorageWriteOutput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalKnowledgeSyncInput(data []byte) (KnowledgeSyncInput, error) {
	var r KnowledgeSyncInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *KnowledgeSyncInput) Marshal() ([]byte, error) {
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

func UnmarshalAdapterBindingReconcileRequest(data []byte) (AdapterBindingReconcileRequest, error) {
	var r AdapterBindingReconcileRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterBindingReconcileRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterBindingReconcileResponse(data []byte) (AdapterBindingReconcileResponse, error) {
	var r AdapterBindingReconcileResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterBindingReconcileResponse) Marshal() ([]byte, error) {
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

func UnmarshalNativeTaskExecutionAdmissionRequest(data []byte) (NativeTaskExecutionAdmissionRequest, error) {
	var r NativeTaskExecutionAdmissionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *NativeTaskExecutionAdmissionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalNativeTaskExecutionAdmissionResponse(data []byte) (NativeTaskExecutionAdmissionResponse, error) {
	var r NativeTaskExecutionAdmissionResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *NativeTaskExecutionAdmissionResponse) Marshal() ([]byte, error) {
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

func UnmarshalAdapterReadGrantRequest(data []byte) (AdapterReadGrantRequest, error) {
	var r AdapterReadGrantRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterReadGrantRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterReadGrantResponse(data []byte) (AdapterReadGrantResponse, error) {
	var r AdapterReadGrantResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterReadGrantResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterReadReceipt(data []byte) (AdapterReadReceipt, error) {
	var r AdapterReadReceipt
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterReadReceipt) Marshal() ([]byte, error) {
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

func UnmarshalAdapterSearchRequest(data []byte) (AdapterSearchRequest, error) {
	var r AdapterSearchRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterSearchRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterSearchResponse(data []byte) (AdapterSearchResponse, error) {
	var r AdapterSearchResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterSearchResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAdapterSourceResource(data []byte) (AdapterSourceResource, error) {
	var r AdapterSourceResource
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AdapterSourceResource) Marshal() ([]byte, error) {
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

func UnmarshalAgentActiveTurnPage(data []byte) (AgentActiveTurnPage, error) {
	var r AgentActiveTurnPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentActiveTurnPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentActiveTurnView(data []byte) (AgentActiveTurnView, error) {
	var r AgentActiveTurnView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentActiveTurnView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentAuthorDirectory(data []byte) (AgentAuthorDirectory, error) {
	var r AgentAuthorDirectory
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentAuthorDirectory) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentCatalogOwners(data []byte) (AgentCatalogOwners, error) {
	var r AgentCatalogOwners
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentCatalogOwners) Marshal() ([]byte, error) {
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

func UnmarshalAgentImportConfigurationPage(data []byte) (AgentImportConfigurationPage, error) {
	var r AgentImportConfigurationPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentImportConfigurationPage) Marshal() ([]byte, error) {
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

func UnmarshalAgentInstallationSkillPage(data []byte) (AgentInstallationSkillPage, error) {
	var r AgentInstallationSkillPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationSkillPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInstallationSkillView(data []byte) (AgentInstallationSkillView, error) {
	var r AgentInstallationSkillView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationSkillView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInstallationToolPage(data []byte) (AgentInstallationToolPage, error) {
	var r AgentInstallationToolPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationToolPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInstallationUsePage(data []byte) (AgentInstallationUsePage, error) {
	var r AgentInstallationUsePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInstallationUsePage) Marshal() ([]byte, error) {
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

func UnmarshalAgentInvocationPage(data []byte) (AgentInvocationPage, error) {
	var r AgentInvocationPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInvocationPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentInvocationView(data []byte) (AgentInvocationView, error) {
	var r AgentInvocationView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentInvocationView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentMemoryDanglingRefView(data []byte) (AgentMemoryDanglingRefView, error) {
	var r AgentMemoryDanglingRefView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentMemoryDanglingRefView) Marshal() ([]byte, error) {
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

func UnmarshalAgentMemoryReferenceView(data []byte) (AgentMemoryReferenceView, error) {
	var r AgentMemoryReferenceView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentMemoryReferenceView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentMentionOutcomePage(data []byte) (AgentMentionOutcomePage, error) {
	var r AgentMentionOutcomePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentMentionOutcomePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentMentionOutcomeQueryRequest(data []byte) (AgentMentionOutcomeQueryRequest, error) {
	var r AgentMentionOutcomeQueryRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentMentionOutcomeQueryRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentSessionPage(data []byte) (AgentSessionPage, error) {
	var r AgentSessionPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentSessionPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentSessionView(data []byte) (AgentSessionView, error) {
	var r AgentSessionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentSessionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentSnapshotImportPreview(data []byte) (AgentSnapshotImportPreview, error) {
	var r AgentSnapshotImportPreview
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentSnapshotImportPreview) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentSnapshotUploadRequest(data []byte) (AgentSnapshotUploadRequest, error) {
	var r AgentSnapshotUploadRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentSnapshotUploadRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTeamPage(data []byte) (AgentTeamPage, error) {
	var r AgentTeamPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTeamPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTeamSnapshotImportPreview(data []byte) (AgentTeamSnapshotImportPreview, error) {
	var r AgentTeamSnapshotImportPreview
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTeamSnapshotImportPreview) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTeamSnapshotUploadRequest(data []byte) (AgentTeamSnapshotUploadRequest, error) {
	var r AgentTeamSnapshotUploadRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTeamSnapshotUploadRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTeamView(data []byte) (AgentTeamView, error) {
	var r AgentTeamView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTeamView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTranscriptEvent(data []byte) (AgentTranscriptEvent, error) {
	var r AgentTranscriptEvent
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTranscriptEvent) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTranscriptItem(data []byte) (AgentTranscriptItem, error) {
	var r AgentTranscriptItem
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTranscriptItem) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTranscriptPage(data []byte) (AgentTranscriptPage, error) {
	var r AgentTranscriptPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTranscriptPage) Marshal() ([]byte, error) {
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

func UnmarshalApplicationReadResourcePage(data []byte) (ApplicationReadResourcePage, error) {
	var r ApplicationReadResourcePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ApplicationReadResourcePage) Marshal() ([]byte, error) {
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

func UnmarshalAutomationApprovalStepView(data []byte) (AutomationApprovalStepView, error) {
	var r AutomationApprovalStepView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationApprovalStepView) Marshal() ([]byte, error) {
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

func UnmarshalAutomationWebhookSecret(data []byte) (AutomationWebhookSecret, error) {
	var r AutomationWebhookSecret
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationWebhookSecret) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalBusinessOperationPage(data []byte) (BusinessOperationPage, error) {
	var r BusinessOperationPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *BusinessOperationPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalBusinessOperationPhaseCount(data []byte) (BusinessOperationPhaseCount, error) {
	var r BusinessOperationPhaseCount
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *BusinessOperationPhaseCount) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalBusinessOperationSummary(data []byte) (BusinessOperationSummary, error) {
	var r BusinessOperationSummary
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *BusinessOperationSummary) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalBusinessOperationView(data []byte) (BusinessOperationView, error) {
	var r BusinessOperationView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *BusinessOperationView) Marshal() ([]byte, error) {
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

func UnmarshalChannelTemplateRequest(data []byte) (ChannelTemplateRequest, error) {
	var r ChannelTemplateRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ChannelTemplateRequest) Marshal() ([]byte, error) {
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

func UnmarshalComponentMemberDirectory(data []byte) (ComponentMemberDirectory, error) {
	var r ComponentMemberDirectory
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentMemberDirectory) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentNotificationDelivery(data []byte) (ComponentNotificationDelivery, error) {
	var r ComponentNotificationDelivery
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentNotificationDelivery) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentNotificationPage(data []byte) (ComponentNotificationPage, error) {
	var r ComponentNotificationPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentNotificationPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentNotificationReadRequest(data []byte) (ComponentNotificationReadRequest, error) {
	var r ComponentNotificationReadRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentNotificationReadRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentNotificationReceipt(data []byte) (ComponentNotificationReceipt, error) {
	var r ComponentNotificationReceipt
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentNotificationReceipt) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentNotificationView(data []byte) (ComponentNotificationView, error) {
	var r ComponentNotificationView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentNotificationView) Marshal() ([]byte, error) {
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

func UnmarshalComponentSearchPage(data []byte) (ComponentSearchPage, error) {
	var r ComponentSearchPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentSearchPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentSearchQuery(data []byte) (ComponentSearchQuery, error) {
	var r ComponentSearchQuery
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentSearchQuery) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentUsageAdmission(data []byte) (ComponentUsageAdmission, error) {
	var r ComponentUsageAdmission
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentUsageAdmission) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentUsageAdmissionRequest(data []byte) (ComponentUsageAdmissionRequest, error) {
	var r ComponentUsageAdmissionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentUsageAdmissionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentUsagePage(data []byte) (ComponentUsagePage, error) {
	var r ComponentUsagePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentUsagePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentUsageReceipt(data []byte) (ComponentUsageReceipt, error) {
	var r ComponentUsageReceipt
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentUsageReceipt) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentUsageReport(data []byte) (ComponentUsageReport, error) {
	var r ComponentUsageReport
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentUsageReport) Marshal() ([]byte, error) {
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

func UnmarshalExportPackageView(data []byte) (ExportPackageView, error) {
	var r ExportPackageView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ExportPackageView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFeedbackAttachmentContent(data []byte) (FeedbackAttachmentContent, error) {
	var r FeedbackAttachmentContent
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FeedbackAttachmentContent) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFeedbackSubmissionReceipt(data []byte) (FeedbackSubmissionReceipt, error) {
	var r FeedbackSubmissionReceipt
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FeedbackSubmissionReceipt) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFeedbackSubmissionRequest(data []byte) (FeedbackSubmissionRequest, error) {
	var r FeedbackSubmissionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FeedbackSubmissionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalFollowedPrincipalRequest(data []byte) (FollowedPrincipalRequest, error) {
	var r FollowedPrincipalRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *FollowedPrincipalRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayAccess(data []byte) (GatewayAccess, error) {
	var r GatewayAccess
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayAccess) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayCallDetail(data []byte) (GatewayCallDetail, error) {
	var r GatewayCallDetail
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayCallDetail) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayCallPage(data []byte) (GatewayCallPage, error) {
	var r GatewayCallPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayCallPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayCallView(data []byte) (GatewayCallView, error) {
	var r GatewayCallView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayCallView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayConfigHistory(data []byte) (GatewayConfigHistory, error) {
	var r GatewayConfigHistory
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayConfigHistory) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayConfigView(data []byte) (GatewayConfigView, error) {
	var r GatewayConfigView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayConfigView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayMCPBindingDraft(data []byte) (GatewayMCPBindingDraft, error) {
	var r GatewayMCPBindingDraft
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayMCPBindingDraft) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayMCPBindingDraftRequest(data []byte) (GatewayMCPBindingDraftRequest, error) {
	var r GatewayMCPBindingDraftRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayMCPBindingDraftRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayMCPBindingFact(data []byte) (GatewayMCPBindingFact, error) {
	var r GatewayMCPBindingFact
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayMCPBindingFact) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayMCPPeerPage(data []byte) (GatewayMCPPeerPage, error) {
	var r GatewayMCPPeerPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayMCPPeerPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayMCPProbeRequest(data []byte) (GatewayMCPProbeRequest, error) {
	var r GatewayMCPProbeRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayMCPProbeRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayMCPProbeResult(data []byte) (GatewayMCPProbeResult, error) {
	var r GatewayMCPProbeResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayMCPProbeResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayMCPReleasePage(data []byte) (GatewayMCPReleasePage, error) {
	var r GatewayMCPReleasePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayMCPReleasePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayModelRoutePage(data []byte) (GatewayModelRoutePage, error) {
	var r GatewayModelRoutePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayModelRoutePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayModelSourcePage(data []byte) (GatewayModelSourcePage, error) {
	var r GatewayModelSourcePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayModelSourcePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayStats(data []byte) (GatewayStats, error) {
	var r GatewayStats
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayStats) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayStatsCounters(data []byte) (GatewayStatsCounters, error) {
	var r GatewayStatsCounters
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayStatsCounters) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayToolPage(data []byte) (GatewayToolPage, error) {
	var r GatewayToolPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayToolPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalGatewayToolTestCallResult(data []byte) (GatewayToolTestCallResult, error) {
	var r GatewayToolTestCallResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *GatewayToolTestCallResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalHuddleAnnouncementView(data []byte) (HuddleAnnouncementView, error) {
	var r HuddleAnnouncementView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *HuddleAnnouncementView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalHuddleLifecycleEvent(data []byte) (HuddleLifecycleEvent, error) {
	var r HuddleLifecycleEvent
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *HuddleLifecycleEvent) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalHuddleLifecyclePage(data []byte) (HuddleLifecyclePage, error) {
	var r HuddleLifecyclePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *HuddleLifecyclePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalHuddlePage(data []byte) (HuddlePage, error) {
	var r HuddlePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *HuddlePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalHuddleView(data []byte) (HuddleView, error) {
	var r HuddleView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *HuddleView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalHuddleVoiceView(data []byte) (HuddleVoiceView, error) {
	var r HuddleVoiceView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *HuddleVoiceView) Marshal() ([]byte, error) {
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

func UnmarshalMCPConnectionPage(data []byte) (MCPConnectionPage, error) {
	var r MCPConnectionPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPConnectionPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPConnectionPolicyView(data []byte) (MCPConnectionPolicyView, error) {
	var r MCPConnectionPolicyView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPConnectionPolicyView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPConnectionProbeRequest(data []byte) (MCPConnectionProbeRequest, error) {
	var r MCPConnectionProbeRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPConnectionProbeRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPConnectionProbeResult(data []byte) (MCPConnectionProbeResult, error) {
	var r MCPConnectionProbeResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPConnectionProbeResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPConnectionRefreshResult(data []byte) (MCPConnectionRefreshResult, error) {
	var r MCPConnectionRefreshResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPConnectionRefreshResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPConnectionToolView(data []byte) (MCPConnectionToolView, error) {
	var r MCPConnectionToolView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPConnectionToolView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPConnectionView(data []byte) (MCPConnectionView, error) {
	var r MCPConnectionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPConnectionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPOauthAttemptView(data []byte) (MCPOauthAttemptView, error) {
	var r MCPOauthAttemptView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPOauthAttemptView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPOauthStartRequest(data []byte) (MCPOauthStartRequest, error) {
	var r MCPOauthStartRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPOauthStartRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPProbedTool(data []byte) (MCPProbedTool, error) {
	var r MCPProbedTool
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPProbedTool) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMemberUsagePage(data []byte) (MemberUsagePage, error) {
	var r MemberUsagePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MemberUsagePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalModerationAccessView(data []byte) (ModerationAccessView, error) {
	var r ModerationAccessView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ModerationAccessView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalModerationAuditPage(data []byte) (ModerationAuditPage, error) {
	var r ModerationAuditPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ModerationAuditPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalModerationReportPage(data []byte) (ModerationReportPage, error) {
	var r ModerationReportPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ModerationReportPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalModerationRestrictionPage(data []byte) (ModerationRestrictionPage, error) {
	var r ModerationRestrictionPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ModerationRestrictionPage) Marshal() ([]byte, error) {
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

func UnmarshalNativeHumanActionRequest(data []byte) (NativeHumanActionRequest, error) {
	var r NativeHumanActionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *NativeHumanActionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalNativeHumanActionResult(data []byte) (NativeHumanActionResult, error) {
	var r NativeHumanActionResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *NativeHumanActionResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalNativeHumanReadReceipt(data []byte) (NativeHumanReadReceipt, error) {
	var r NativeHumanReadReceipt
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *NativeHumanReadReceipt) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalNativeHumanResourceResult(data []byte) (NativeHumanResourceResult, error) {
	var r NativeHumanResourceResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *NativeHumanResourceResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalNativeHumanScopeResult(data []byte) (NativeHumanScopeResult, error) {
	var r NativeHumanScopeResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *NativeHumanScopeResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalOperationUsageCount(data []byte) (OperationUsageCount, error) {
	var r OperationUsageCount
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *OperationUsageCount) Marshal() ([]byte, error) {
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

func UnmarshalPlatformFeedbackPage(data []byte) (PlatformFeedbackPage, error) {
	var r PlatformFeedbackPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PlatformFeedbackPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPlatformFeedbackTriageRequest(data []byte) (PlatformFeedbackTriageRequest, error) {
	var r PlatformFeedbackTriageRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PlatformFeedbackTriageRequest) Marshal() ([]byte, error) {
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

func UnmarshalProjectChannelRequest(data []byte) (ProjectChannelRequest, error) {
	var r ProjectChannelRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProjectChannelRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProjectChannelRequestApprovalView(data []byte) (ProjectChannelRequestApprovalView, error) {
	var r ProjectChannelRequestApprovalView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProjectChannelRequestApprovalView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProjectPreferenceRequest(data []byte) (ProjectPreferenceRequest, error) {
	var r ProjectPreferenceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProjectPreferenceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProjectsGitMergeRequest(data []byte) (ProjectsGitMergeRequest, error) {
	var r ProjectsGitMergeRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProjectsGitMergeRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProjectsGitMergeResponse(data []byte) (ProjectsGitMergeResponse, error) {
	var r ProjectsGitMergeResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProjectsGitMergeResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProjectsGitQueryRequest(data []byte) (ProjectsGitQueryRequest, error) {
	var r ProjectsGitQueryRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProjectsGitQueryRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProjectsGitQueryResponse(data []byte) (ProjectsGitQueryResponse, error) {
	var r ProjectsGitQueryResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProjectsGitQueryResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProjectsGitRefRequest(data []byte) (ProjectsGitRefRequest, error) {
	var r ProjectsGitRefRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProjectsGitRefRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProjectsGitRefResponse(data []byte) (ProjectsGitRefResponse, error) {
	var r ProjectsGitRefResponse
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProjectsGitRefResponse) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProjectsPublishRequest(data []byte) (ProjectsPublishRequest, error) {
	var r ProjectsPublishRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProjectsPublishRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalProjectsQueryRequest(data []byte) (ProjectsQueryRequest, error) {
	var r ProjectsQueryRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ProjectsQueryRequest) Marshal() ([]byte, error) {
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

func UnmarshalPulsePublishRequest(data []byte) (PulsePublishRequest, error) {
	var r PulsePublishRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PulsePublishRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPulseQueryRequest(data []byte) (PulseQueryRequest, error) {
	var r PulseQueryRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PulseQueryRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPushCapability(data []byte) (PushCapability, error) {
	var r PushCapability
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PushCapability) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPushRegistrationRequest(data []byte) (PushRegistrationRequest, error) {
	var r PushRegistrationRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PushRegistrationRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalPushRegistrationView(data []byte) (PushRegistrationView, error) {
	var r PushRegistrationView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *PushRegistrationView) Marshal() ([]byte, error) {
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

func UnmarshalReminderPublishRequest(data []byte) (ReminderPublishRequest, error) {
	var r ReminderPublishRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ReminderPublishRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalReminderSourceRequest(data []byte) (ReminderSourceRequest, error) {
	var r ReminderSourceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ReminderSourceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalReminderView(data []byte) (ReminderView, error) {
	var r ReminderView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ReminderView) Marshal() ([]byte, error) {
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

func UnmarshalSidebarAssignmentRequest(data []byte) (SidebarAssignmentRequest, error) {
	var r SidebarAssignmentRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SidebarAssignmentRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSidebarSectionRequest(data []byte) (SidebarSectionRequest, error) {
	var r SidebarSectionRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SidebarSectionRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSidebarSectionOrderRequest(data []byte) (SidebarSectionOrderRequest, error) {
	var r SidebarSectionOrderRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SidebarSectionOrderRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSidebarSortRequest(data []byte) (SidebarSortRequest, error) {
	var r SidebarSortRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SidebarSortRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSkillArtifactUploadRequest(data []byte) (SkillArtifactUploadRequest, error) {
	var r SkillArtifactUploadRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SkillArtifactUploadRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSkillArtifactUploadView(data []byte) (SkillArtifactUploadView, error) {
	var r SkillArtifactUploadView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SkillArtifactUploadView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSkillArtifactViolation(data []byte) (SkillArtifactViolation, error) {
	var r SkillArtifactViolation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SkillArtifactViolation) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSkillDefinitionPage(data []byte) (SkillDefinitionPage, error) {
	var r SkillDefinitionPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SkillDefinitionPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSkillDefinitionView(data []byte) (SkillDefinitionView, error) {
	var r SkillDefinitionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SkillDefinitionView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSkillReferencePage(data []byte) (SkillReferencePage, error) {
	var r SkillReferencePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SkillReferencePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSkillVersionContentView(data []byte) (SkillVersionContentView, error) {
	var r SkillVersionContentView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SkillVersionContentView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSkillVersionPage(data []byte) (SkillVersionPage, error) {
	var r SkillVersionPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SkillVersionPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalSkillVersionView(data []byte) (SkillVersionView, error) {
	var r SkillVersionView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SkillVersionView) Marshal() ([]byte, error) {
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

func UnmarshalTenantMemberJoinPage(data []byte) (TenantMemberJoinPage, error) {
	var r TenantMemberJoinPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TenantMemberJoinPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalTenantMemberJoinView(data []byte) (TenantMemberJoinView, error) {
	var r TenantMemberJoinView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TenantMemberJoinView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalTenantProfileView(data []byte) (TenantProfileView, error) {
	var r TenantProfileView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TenantProfileView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalTenantQuotaPage(data []byte) (TenantQuotaPage, error) {
	var r TenantQuotaPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TenantQuotaPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalThreadPreferenceRequest(data []byte) (ThreadPreferenceRequest, error) {
	var r ThreadPreferenceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ThreadPreferenceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalUsageBillingView(data []byte) (UsageBillingView, error) {
	var r UsageBillingView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *UsageBillingView) Marshal() ([]byte, error) {
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

func UnmarshalWebChannelCanvasView(data []byte) (WebChannelCanvasView, error) {
	var r WebChannelCanvasView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebChannelCanvasView) Marshal() ([]byte, error) {
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

func UnmarshalWebCustomEmojiMutation(data []byte) (WebCustomEmojiMutation, error) {
	var r WebCustomEmojiMutation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebCustomEmojiMutation) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebCustomEmojiView(data []byte) (WebCustomEmojiView, error) {
	var r WebCustomEmojiView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebCustomEmojiView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebGIFCapabilityView(data []byte) (WebGIFCapabilityView, error) {
	var r WebGIFCapabilityView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebGIFCapabilityView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebGIFItem(data []byte) (WebGIFItem, error) {
	var r WebGIFItem
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebGIFItem) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebGIFSearchRequest(data []byte) (WebGIFSearchRequest, error) {
	var r WebGIFSearchRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebGIFSearchRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebGIFSearchView(data []byte) (WebGIFSearchView, error) {
	var r WebGIFSearchView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebGIFSearchView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebGIFShareRequest(data []byte) (WebGIFShareRequest, error) {
	var r WebGIFShareRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebGIFShareRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebInboxQuery(data []byte) (WebInboxQuery, error) {
	var r WebInboxQuery
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebInboxQuery) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebLinkPreviewRequest(data []byte) (WebLinkPreviewRequest, error) {
	var r WebLinkPreviewRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebLinkPreviewRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebLinkPreviewSnapshotView(data []byte) (WebLinkPreviewSnapshotView, error) {
	var r WebLinkPreviewSnapshotView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebLinkPreviewSnapshotView) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebMessageAttachment(data []byte) (WebMessageAttachment, error) {
	var r WebMessageAttachment
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebMessageAttachment) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebMessageAuthorQuery(data []byte) (WebMessageAuthorQuery, error) {
	var r WebMessageAuthorQuery
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebMessageAuthorQuery) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebMessageAuthorView(data []byte) (WebMessageAuthorView, error) {
	var r WebMessageAuthorView
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebMessageAuthorView) Marshal() ([]byte, error) {
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

func UnmarshalWebPresencePage(data []byte) (WebPresencePage, error) {
	var r WebPresencePage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebPresencePage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebPresenceQueryRequest(data []byte) (WebPresenceQueryRequest, error) {
	var r WebPresenceQueryRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebPresenceQueryRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebPresenceUpdateRequest(data []byte) (WebPresenceUpdateRequest, error) {
	var r WebPresenceUpdateRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebPresenceUpdateRequest) Marshal() ([]byte, error) {
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

func UnmarshalWebPublishTopicRequest(data []byte) (WebPublishTopicRequest, error) {
	var r WebPublishTopicRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebPublishTopicRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebSearchQuery(data []byte) (WebSearchQuery, error) {
	var r WebSearchQuery
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebSearchQuery) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebTypingRequest(data []byte) (WebTypingRequest, error) {
	var r WebTypingRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebTypingRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebUserStatusPage(data []byte) (WebUserStatusPage, error) {
	var r WebUserStatusPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebUserStatusPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebUserStatusQueryRequest(data []byte) (WebUserStatusQueryRequest, error) {
	var r WebUserStatusQueryRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebUserStatusQueryRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebUserStatusUpdateRequest(data []byte) (WebUserStatusUpdateRequest, error) {
	var r WebUserStatusUpdateRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebUserStatusUpdateRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebWorkspaceActivityPage(data []byte) (WebWorkspaceActivityPage, error) {
	var r WebWorkspaceActivityPage
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebWorkspaceActivityPage) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalWebWorkspaceActivityQuery(data []byte) (WebWorkspaceActivityQuery, error) {
	var r WebWorkspaceActivityQuery
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WebWorkspaceActivityQuery) Marshal() ([]byte, error) {
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

func UnmarshalAgentDefinitionExportInput(data []byte) (AgentDefinitionExportInput, error) {
	var r AgentDefinitionExportInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentDefinitionExportInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentDefinitionImportInput(data []byte) (AgentDefinitionImportInput, error) {
	var r AgentDefinitionImportInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentDefinitionImportInput) Marshal() ([]byte, error) {
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

func UnmarshalAgentTeamExportInput(data []byte) (AgentTeamExportInput, error) {
	var r AgentTeamExportInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTeamExportInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTeamImportInput(data []byte) (AgentTeamImportInput, error) {
	var r AgentTeamImportInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTeamImportInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAgentTeamInput(data []byte) (AgentTeamInput, error) {
	var r AgentTeamInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AgentTeamInput) Marshal() ([]byte, error) {
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

func UnmarshalAutomationSecretRef(data []byte) (AutomationSecretRef, error) {
	var r AutomationSecretRef
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationSecretRef) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationStep(data []byte) (AutomationStep, error) {
	var r AutomationStep
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationStep) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalAutomationStepTrace(data []byte) (AutomationStepTrace, error) {
	var r AutomationStepTrace
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *AutomationStepTrace) Marshal() ([]byte, error) {
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

func UnmarshalCapabilityVectorBinding(data []byte) (CapabilityVectorBinding, error) {
	var r CapabilityVectorBinding
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *CapabilityVectorBinding) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalCapabilityVectorCapture(data []byte) (CapabilityVectorCapture, error) {
	var r CapabilityVectorCapture
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *CapabilityVectorCapture) Marshal() ([]byte, error) {
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

func UnmarshalComponentConformanceCaptureValue(data []byte) (ComponentConformanceCaptureValue, error) {
	var r ComponentConformanceCaptureValue
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformanceCaptureValue) Marshal() ([]byte, error) {
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

func UnmarshalComponentConformanceReceiverEnvironment(data []byte) (ComponentConformanceReceiverEnvironment, error) {
	var r ComponentConformanceReceiverEnvironment
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentConformanceReceiverEnvironment) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentNativeReceiverObservation(data []byte) (ComponentNativeReceiverObservation, error) {
	var r ComponentNativeReceiverObservation
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentNativeReceiverObservation) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentNativeReceiverRequest(data []byte) (ComponentNativeReceiverRequest, error) {
	var r ComponentNativeReceiverRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentNativeReceiverRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentPersonRef(data []byte) (ComponentPersonRef, error) {
	var r ComponentPersonRef
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentPersonRef) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalComponentPreferenceDeclaration(data []byte) (ComponentPreferenceDeclaration, error) {
	var r ComponentPreferenceDeclaration
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentPreferenceDeclaration) Marshal() ([]byte, error) {
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

func UnmarshalComponentText(data []byte) (ComponentText, error) {
	var r ComponentText
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ComponentText) Marshal() ([]byte, error) {
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

func UnmarshalHuddleAgentInput(data []byte) (HuddleAgentInput, error) {
	var r HuddleAgentInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *HuddleAgentInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalHuddleStartInput(data []byte) (HuddleStartInput, error) {
	var r HuddleStartInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *HuddleStartInput) Marshal() ([]byte, error) {
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

func UnmarshalMCPConnectionCreate(data []byte) (MCPConnectionCreate, error) {
	var r MCPConnectionCreate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPConnectionCreate) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPConnectionCredentialInput(data []byte) (MCPConnectionCredentialInput, error) {
	var r MCPConnectionCredentialInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPConnectionCredentialInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPConnectionPolicyUpdate(data []byte) (MCPConnectionPolicyUpdate, error) {
	var r MCPConnectionPolicyUpdate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPConnectionPolicyUpdate) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPConnectionUpdate(data []byte) (MCPConnectionUpdate, error) {
	var r MCPConnectionUpdate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPConnectionUpdate) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalMCPToolSelection(data []byte) (MCPToolSelection, error) {
	var r MCPToolSelection
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *MCPToolSelection) Marshal() ([]byte, error) {
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

func UnmarshalSkillVersionUploadInput(data []byte) (SkillVersionUploadInput, error) {
	var r SkillVersionUploadInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *SkillVersionUploadInput) Marshal() ([]byte, error) {
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

func UnmarshalTenantProfileInput(data []byte) (TenantProfileInput, error) {
	var r TenantProfileInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TenantProfileInput) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalTenantQuotaSetting(data []byte) (TenantQuotaSetting, error) {
	var r TenantQuotaSetting
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *TenantQuotaSetting) Marshal() ([]byte, error) {
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

func UnmarshalWorkspaceCanvasSetInput(data []byte) (WorkspaceCanvasSetInput, error) {
	var r WorkspaceCanvasSetInput
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkspaceCanvasSetInput) Marshal() ([]byte, error) {
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

func UnmarshalWorkspaceUpdate(data []byte) (WorkspaceUpdate, error) {
	var r WorkspaceUpdate
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *WorkspaceUpdate) Marshal() ([]byte, error) {
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

func UnmarshalResourceExportAdvanceRequest(data []byte) (ResourceExportAdvanceRequest, error) {
	var r ResourceExportAdvanceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResourceExportAdvanceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalResourceExportAdvanceResult(data []byte) (ResourceExportAdvanceResult, error) {
	var r ResourceExportAdvanceResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResourceExportAdvanceResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalResourceExportTarget(data []byte) (ResourceExportTarget, error) {
	var r ResourceExportTarget
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResourceExportTarget) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalResourceImportAdvanceRequest(data []byte) (ResourceImportAdvanceRequest, error) {
	var r ResourceImportAdvanceRequest
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResourceImportAdvanceRequest) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalResourceImportAdvanceResult(data []byte) (ResourceImportAdvanceResult, error) {
	var r ResourceImportAdvanceResult
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResourceImportAdvanceResult) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

func UnmarshalResourceImportTarget(data []byte) (ResourceImportTarget, error) {
	var r ResourceImportTarget
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *ResourceImportTarget) Marshal() ([]byte, error) {
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
	Nested CanaryNested `json:"nested"`
	// RFC3339 时间戳，按普通 string 传输。format: date-time 不在可用子集内——Dart 的 toIso8601String()
	// 强制补毫秒，四侧线格式不等价。取值合法性由 Core 在 Admission 校验，不由 schema 承担。
	OccurredAt *string `json:"occurredAt,omitempty"`
	// 基础 number
	Ratio float64 `json:"ratio"`
	// 同构数组
	Tags []string `json:"tags"`
	// 变体类型的平坦表达：封闭枚举 tag 加各变体字段全部可选，替代被禁用的 oneOf
	Variants []CanaryVariantsItem `json:"variants,omitempty"`
}

// 内联对象，同样显式关闭 additionalProperties
type CanaryNested struct {
	Label   string    `json:"label"`
	Weights []float64 `json:"weights,omitempty"`
}

type CanaryVariantsItem struct {
	FileDigest  *string                `json:"fileDigest,omitempty"`
	Kind        CanaryVariantsItemKind `json:"kind"`
	MessageBody *string                `json:"messageBody,omitempty"`
	TaskAttempt *int64                 `json:"taskAttempt,omitempty"`
}

type ApplicationModelAdmission struct {
	BindingID          string `json:"bindingId"`
	GatewayPrincipalID string `json:"gatewayPrincipalId"`
	Generation         int64  `json:"generation"`
	Method             string `json:"method"`
	Path               string `json:"path"`
	Traceparent        string `json:"traceparent"`
}

// Delete selected native objects in the admitted Resource using the original
// recycle/permanent-delete choice. Each native object identity must be independently
// authorized and retained in the native first-dispatch claim.
type FileStorageDeleteInput struct {
	NativeObjectRefs  []string `json:"nativeObjectRefs"`
	RemovePermanently bool     `json:"removePermanently"`
	ResourceID        string   `json:"resourceId"`
}

// Metadata-only result. Success requires all selected native identities to have linked
// durable deletion or recycle acknowledgements; an accepted job, Finished status or absent
// current object is not terminal evidence.
type FileStorageDeleteOutput struct {
}

// Export exactly the authorized typed native file revision, including empty or non-UTF-8
// files.
type FileStorageExportInput struct {
	DisplayName     string `json:"displayName"`
	MediaType       string `json:"mediaType"`
	NativeObjectRef string `json:"nativeObjectRef"`
	NativeRevision  string `json:"nativeRevision"`
	ResourceID      string `json:"resourceId"`
}

// Immediate authorized binary result using the existing export encoding; not a persisted
// Core blob, URL, or native credential.
type FileStorageExportOutput struct {
	ContentBase64 string `json:"contentBase64"`
	Filename      string `json:"filename"`
	MediaType     string `json:"mediaType"`
}

// DD-89: list the source Resource through its bound native root; the client cannot supply
// another root or native credential.
type FileStorageListInput struct {
	ResourceID string `json:"resourceId"`
}

// DD-89: complete native listing is transported only between components, not persisted by
// Core. Its canonical item digest is the native listing revision, never a fabricated file
// VersionId.
type FileStorageListOutput struct {
	Items           []ContentReference `json:"items"`
	ListingDigest   string             `json:"listingDigest"`
	NativeObjectRef string             `json:"nativeObjectRef"`
	NativeRevision  string             `json:"nativeRevision"`
	OperationID     string             `json:"operationId"`
	ResourceID      string             `json:"resourceId"`
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

// List published native revisions of one UUID inside the admitted Resource's bound root; no
// caller-supplied path or credential.
type FileStorageListRevisionsInput struct {
	NativeObjectRef string `json:"nativeObjectRef"`
	ResourceID      string `json:"resourceId"`
}

// Published version references from the original native version collection; also supplied
// in the adapter's typed ContentReference slot. Not SERVICE list_output or a completion
// receipt.
type FileStorageListRevisionsOutput struct {
	Citations []ContentReference `json:"citations"`
}

// Read the exact typed native file revision in the admitted Resource; never substitute the
// current head.
type FileStorageReadInput struct {
	DisplayName     string `json:"displayName"`
	MediaType       string `json:"mediaType"`
	NativeObjectRef string `json:"nativeObjectRef"`
	NativeRevision  string `json:"nativeRevision"`
	ResourceID      string `json:"resourceId"`
}

// Exact valid UTF-8 native bytes, disclosed only through the original result policy. Binary
// files use export.
type FileStorageReadOutput struct {
	Text string `json:"text"`
}

// Manage an existing native share under the admitted Resource. Revocation removes access
// through that exact share; it neither deletes file content nor grants platform resource
// permission. Native share identity alone is not evidence of ownership or successful
// revocation.
type FileStorageShareInput struct {
	NativeShareRef string                    `json:"nativeShareRef"`
	Operation      FileStorageShareOperation `json:"operation"`
	ResourceID     string                    `json:"resourceId"`
}

// Metadata-only share result. Revocation requires an authorized first-dispatch claim and
// confirmed removal of the frozen native share access. An unowned missing identifier,
// accepted request or partial native cleanup is not successful revocation.
type FileStorageShareOutput struct {
}

// Apply an existing immutable native revision, or dispatch a native first-byte intent. An
// intent is not a ContentReference: its node/revision identifiers name reserved native
// locations only; bytes remain at the source and no result exists before the immutable
// native ACK.
type FileStorageWriteInput struct {
	ContentLength   *int64  `json:"contentLength,omitempty"`
	DisplayName     *string `json:"displayName,omitempty"`
	MediaType       *string `json:"mediaType,omitempty"`
	Multipart       *bool   `json:"multipart,omitempty"`
	NativeDeadline  *int64  `json:"nativeDeadline,omitempty"`
	NativeIntentID  *string `json:"nativeIntentId,omitempty"`
	NativeNodeID    *string `json:"nativeNodeId,omitempty"`
	NativeObjectRef *string `json:"nativeObjectRef,omitempty"`
	NativeRevision  *string `json:"nativeRevision,omitempty"`
	ResourceID      string  `json:"resourceId"`
}

// Metadata-only write result. The exact confirmed result revision belongs in the adapter's
// typed ContentReference slot; an empty result, accepted write, or current head alone is
// not terminal evidence.
type FileStorageWriteOutput struct {
}

// Metadata-only input of the receiver native synchronization admission. Core injects the
// read execution reference and native receiver root.
type KnowledgeSyncInput struct {
	BatchID                     string `json:"batchId"`
	ImportConfigRef             string `json:"importConfigRef"`
	SourceReadActionExecutionID string `json:"sourceReadActionExecutionId"`
	SourceResourceID            string `json:"sourceResourceId"`
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

// 完整原生枚举的同引用观察，非新的任务/结果权威。complete 只在全部原存储流正常结束后成立；部分枚举、超限或不可核验不得当空集合。observations
// 保留所有代次的原始幂等引用，未知任务不得遗漏；Core 自行核验终态，不接收 drained 声明。
type AdapterBindingReconcileResponse struct {
	Complete     bool                           `json:"complete"`
	Observations []AdapterExecutionObservation  `json:"observations"`
	Reference    AdapterBindingReconcileRequest `json:"reference"`
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

// 07§5.2/6.2 已停止新准入的 binding reconcile。引用原停用生命周期及冻结代次，只观察原生任务，不创建 ExternalExecution 或重放动作。
type AdapterBindingReconcileRequest struct {
	BindingID         string `json:"bindingId"`
	ConfigDigest      string `json:"configDigest"`
	Generation        int64  `json:"generation"`
	IdempotencyKey    string `json:"idempotencyKey"`
	NativeInstanceRef string `json:"nativeInstanceRef"`
	NativeScopeRef    string `json:"nativeScopeRef"`
}

// ADR-12 执行响应分离原生任务观察与能力结果。HTTP 接收不是终态；resultJson 只在原生 SUCCEEDED 且符合固定结果 schema 时消费。它不进入
// Core 的套件报告。
type AdapterExecutionResponse struct {
	ContentReference *ContentReference `json:"contentReference,omitempty"`
	// 来源 citation 的 typed 槽；与固定结果 schema 中 citations 逐项一致。它不是源正文读取证明，打开来源时重新授权。
	ContentReferences []ContentReference          `json:"contentReferences,omitempty"`
	Execution         AdapterExecutionObservation `json:"execution"`
	ResultJSON        *string                     `json:"resultJson,omitempty"`
	SourceResources   []AdapterSourceResource     `json:"sourceResources,omitempty"`
}

// Actual native planner source within the existing execution binding. Metadata only:
// neither SQL/content nor a grant. The original action and result-exposure authority must
// authorize every resolved Resource.
type AdapterSourceResource struct {
	NativeRef  string `json:"nativeRef"`
	NativeType string `json:"nativeType"`
}

// DD-48/51/94 extract_usage 的原生终态用量元数据；scope/customer/dimensions 只由 Core 原
// ExternalExecution 决定。完整集合与冻结 action meters 精确相等，缺失不是零。
type AdapterExecutionUsage struct {
	ExternalExecutionID string                                  `json:"externalExecutionId"`
	IdempotencyKey      string                                  `json:"idempotencyKey"`
	Measurements        []AdapterExecutionUsageMeasurementsItem `json:"measurements"`
	NativeID            string                                  `json:"nativeId"`
	NativeType          string                                  `json:"nativeType"`
}

type AdapterExecutionUsageMeasurementsItem struct {
	MeterKey   string `json:"meterKey"`
	OccurredAt string `json:"occurredAt"`
	Quantity   int64  `json:"quantity"`
}

// 绑定 SERVICE 领取原已派发 HUMAN COMPONENT_ACTION 的既存 native task 未消费步骤；不创建执行或延长期限。
type NativeTaskExecutionAdmissionRequest struct {
	ActionExecutionID string                    `json:"actionExecutionId"`
	BindingID         string                    `json:"bindingId"`
	Execution         AdapterExecutionReference `json:"execution"`
	// 首次 dispatch 审计时间与冻结声明期限得出的原 RFC3339 截止时间，不接受续期。
	NativeTaskDeadline string `json:"nativeTaskDeadline"`
}

// 原 ExternalExecution 的 observe/extract_usage 引用；不携带正文，不新建执行，不接受引用自报 scope。nativeId
// 未取得时只用冻结幂等键查证。
type AdapterExecutionReference struct {
	ExternalExecutionID string  `json:"externalExecutionId"`
	IdempotencyKey      string  `json:"idempotencyKey"`
	NativeID            *string `json:"nativeId,omitempty"`
	NativeType          string  `json:"nativeType"`
}

// 仅当次原任务执行上下文可用的票据；原生任务不得持久化票据或参数凭据。
type NativeTaskExecutionAdmissionResponse struct {
	ActionToken        *string                  `json:"actionToken,omitempty"`
	ArgumentsJSON      *string                  `json:"argumentsJson,omitempty"`
	ExpiresAt          *string                  `json:"expiresAt,omitempty"`
	NativeTaskDeadline string                   `json:"nativeTaskDeadline"`
	State              NativeTaskAdmissionState `json:"state"`
}

// ADR-12
// adapter入站fresh校验。ActionToken只瞬时校验、不入history或审计正文；参数由原ActionToken摘要绑定，binding由受认证client精确匹配。
type AdapterPepCheckRequest struct {
	ActionToken      string                  `json:"actionToken"`
	ArgumentsJSON    string                  `json:"argumentsJson"`
	BindingID        string                  `json:"bindingId"`
	ContentReference *ContentReference       `json:"contentReference,omitempty"`
	Operation        string                  `json:"operation"`
	SourceResources  []AdapterSourceResource `json:"sourceResources,omitempty"`
}

// 只在原动作和精确binding仍被fresh授权时返回当前授权revision；不是可复用的新授权票据。
type AdapterPepCheckResponse struct {
	ActionExecutionID        string `json:"actionExecutionId"`
	AuthorizationMinZedToken string `json:"authorizationMinZedToken"`
	// 原业务 AE 冻结的 component_projection_generation；由 Core 核验同 binding 后返回，不从调用方 token
	// 扩展或当前部署配置推断。缺省时原生任务不得新建代次归属。
	BindingGeneration *int64 `json:"bindingGeneration,omitempty"`
	// 仅声明原生异步任务执行期限的 HUMAN COMPONENT_ACTION 返回；原首次 dispatch 时间加已批准声明的期限，RFC3339，不随本次 fresh
	// Check 续期。
	NativeTaskDeadline *string `json:"nativeTaskDeadline,omitempty"`
	OperationID        string  `json:"operationId"`
	// 本次已授权 execute 的 Resource 与其 binding 原生引用事实；不是新授权票据。缺省时消费者不得推断对象身份。
	TargetResource *AdapterAuthorizedResource `json:"targetResource,omitempty"`
}

// 本次已授权 execute 的 Resource 与其 binding 原生引用事实；不是新授权票据。缺省时消费者不得推断对象身份。
type AdapterAuthorizedResource struct {
	NativeInstanceRef string `json:"nativeInstanceRef"`
	NativeRef         string `json:"nativeRef"`
	NativeScopeRef    string `json:"nativeScopeRef"`
	NativeType        string `json:"nativeType"`
	ResourceID        string `json:"resourceId"`
}

// 18: execute the original admitted file protocol Session, not an arbitrary editor URL or
// native object create. All fields are frozen Core facts and the whole body is covered by
// ActionToken.
type AdapterProtocolSessionLaunchRequest struct {
	AdmittedMode                 ProtocolSessionMode   `json:"admittedMode"`
	AuthorizationTargetNativeRef string                `json:"authorizationTargetNativeRef"`
	ExpiresAt                    string                `json:"expiresAt"`
	IdempotencyKey               string                `json:"idempotencyKey"`
	Locale                       ProtocolSessionLocale `json:"locale"`
	ProtocolSessionID            string                `json:"protocolSessionId"`
	Reference                    ContentReference      `json:"reference"`
	Theme                        ProtocolSessionTheme  `json:"theme"`
}

// 18: the original native PAT reference plus transient launch descriptor. This value occurs
// only in the original execute response; it must not be stored as reconciliation evidence
// or recovered by reminting a token.
type AdapterProtocolSessionLaunchResponse struct {
	LaunchDescriptor DocumentLaunchDescriptor `json:"launchDescriptor"`
	NativeSessionRef string                   `json:"nativeSessionRef"`
}

// DD-95/103: transient, fixed-origin launch returned by the admitted binding adapter;
// credentials are only string form fields, never a persisted Task, chat or ContentReference.
type DocumentLaunchDescriptor struct {
	ActionURL    string                         `json:"actionUrl"`
	EditorOrigin string                         `json:"editorOrigin"`
	ExpiresAt    string                         `json:"expiresAt"`
	FormFields   map[string]string              `json:"formFields"`
	Method       DocumentLaunchDescriptorMethod `json:"method"`
}

// DD-90, 18 §5.1: binding-authenticated permission to observe/revoke the original document
// PAT. These closed lifecycle facts never authorize file reads, writes or token creation.
type ProtocolSessionLifecyclePepResponse struct {
	Decision          ProtocolSessionLifecyclePepResponseDecision `json:"decision"`
	ExpiresAt         string                                      `json:"expiresAt"`
	NativeObjectRef   string                                      `json:"nativeObjectRef"`
	ProtocolSessionID string                                      `json:"protocolSessionId"`
	RequestedMode     ProtocolSessionMode                         `json:"requestedMode"`
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
	ExpiresAt         *string                                            `json:"expiresAt,omitempty"`
	NativeObjectRef   string                                             `json:"nativeObjectRef"`
	NativeSessionRef  *string                                            `json:"nativeSessionRef,omitempty"`
	NativeState       AdapterProtocolSessionLifecycleResponseNativeState `json:"nativeState"`
	ProtocolSessionID string                                             `json:"protocolSessionId"`
}

// 18 §5.2: authenticated binding→Core PEP for an existing ProtocolSession. No native token
// grants platform permissions.
type ProtocolSessionPepRequest struct {
	BindingID         string                                   `json:"bindingId"`
	NativeObjectRef   string                                   `json:"nativeObjectRef"`
	NativeOperation   ProtocolSessionPepRequestNativeOperation `json:"nativeOperation"`
	ProtocolSessionID string                                   `json:"protocolSessionId"`
	WriteObservation  *ProtocolWriteObservation                `json:"writeObservation,omitempty"`
}

// 18 §5.4: authenticated native PutFile evidence for the existing ProtocolSession; never
// file bytes or an authorization grant.
type ProtocolWriteObservation struct {
	BaseModifiedAt string                        `json:"baseModifiedAt"`
	BytesWritten   int64                         `json:"bytesWritten"`
	CorrelationRef string                        `json:"correlationRef"`
	Editors        string                        `json:"editors"`
	NativeEtag     *string                       `json:"nativeEtag,omitempty"`
	Phase          ProtocolWriteObservationPhase `json:"phase"`
	ResultRevision *string                       `json:"resultRevision,omitempty"`
}

// Original Session facts, not native revision existence or write success. Cells must still
// query its exact VersionId and ACLs.
type ProtocolSessionPepResponse struct {
	AdmittedMode  ProtocolSessionMode                         `json:"admittedMode"`
	BaseRevision  string                                      `json:"baseRevision"`
	Decision      ProtocolSessionLifecyclePepResponseDecision `json:"decision"`
	DisplayName   string                                      `json:"displayName"`
	ExpiresAt     string                                      `json:"expiresAt"`
	ExportAllowed bool                                        `json:"exportAllowed"`
	MinZedToken   string                                      `json:"minZedToken"`
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

// Receipt of native write evidence. It grants no read or write permission.
type ProtocolWriteReceipt struct {
	ProtocolSessionID string                    `json:"protocolSessionId"`
	State             ProtocolWriteReceiptState `json:"state"`
}

// 07§5.2与ADR-12：查询同一native对象当前权威revision；ActionToken通过Authorization头传输，幂等键与Idempotency-Key头一致。authorizationTargetNativeRef仅为Core从实际受权Resource/Asset解析的原生目标定位，参与同一参数签名；adapter须核实被查对象在该目标及固定binding
// scope内。缺省保持确切目标查询，不授予一般子对象读取。不是execute或权限授予。
type AdapterQueryRevisionRequest struct {
	AuthorizationTargetNativeRef *string                `json:"authorizationTargetNativeRef,omitempty"`
	IdempotencyKey               string                 `json:"idempotencyKey"`
	NativeObjectRef              string                 `json:"nativeObjectRef"`
	ProtocolReconcile            *ProtocolRevisionQuery `json:"protocolReconcile,omitempty"`
}

// DD-90/18§5.4：原保存结果不明会话的确切写入证据查证；只核已有 ACCEPTED writer observation 对应的原生
// VersionId，不提供文件字节或当前权限。
type ProtocolRevisionQuery struct {
	BaseRevision      string                   `json:"baseRevision"`
	ProtocolSessionID string                   `json:"protocolSessionId"`
	WriteObservation  ProtocolWriteObservation `json:"writeObservation"`
}

// 07§5.2与18§5：只返回被查证同一native对象当前权威revision，不替换调用方冻结ContentReference、不以mtime/ETag猜测revision。未知或fresh授权失败不得生成成功应答。
type AdapterQueryRevisionResponse struct {
	CorrelationRef    *string `json:"correlationRef,omitempty"`
	NativeObjectRef   string  `json:"nativeObjectRef"`
	NativeRevision    string  `json:"nativeRevision"`
	ProtocolSessionID *string `json:"protocolSessionId,omitempty"`
}

// DD-89: short-lived source Adapter authorization, not native credentials or proof that the
// batch finished. The endpoint is resolved from the existing controlled adapter directory.
type AdapterReadGrantResponse struct {
	ActionExecutionID string  `json:"actionExecutionId"`
	ActionToken       *string `json:"actionToken,omitempty"`
	ArgumentsJSON     *string `json:"argumentsJson,omitempty"`
	Endpoint          *string `json:"endpoint,omitempty"`
	ExpiresAt         *int64  `json:"expiresAt,omitempty"`
	OperationID       string  `json:"operationId"`
	// Native retry observation. COMPLETED requires both immutable receipts and committed usage;
	// UNKNOWN/PENDING carry no renewed authorization.
	Outcome *AdapterReadGrantResponseOutcome `json:"outcome,omitempty"`
	// 仅 COMPLETED 观察返回同一 Operation 已核实的原接收方子执行引用。
	ReceiverActionExecutionID *string `json:"receiverActionExecutionId,omitempty"`
	// 仅 COMPLETED 观察返回原子执行冻结的 receiver generation，不是当前绑定代次。
	ReceiverGeneration *int64              `json:"receiverGeneration,omitempty"`
	ReceiverReceipt    *AdapterReadReceipt `json:"receiverReceipt,omitempty"`
	// Separate governed receiver action in the same read Operation. The native importer must
	// perform the existing authenticated PEP check with this token immediately before its
	// write; issuance is not completion.
	ReceiverWrite   *AdapterReadGrantResponseReceiverWrite `json:"receiverWrite,omitempty"`
	SourceBindingID string                                 `json:"sourceBindingId"`
	// 仅原生批次 COMPLETED 观察返回已保存的 SOURCE 回执；不是新的读取授权。
	SourceReceipt *AdapterReadReceipt `json:"sourceReceipt,omitempty"`
}

// DD-89: authenticated native source-read or completed receiver-import metadata for one
// original SERVICE Operation; never file bodies or credentials.
//
// 仅原生批次 COMPLETED 观察返回已保存的 SOURCE 回执；不是新的读取授权。
type AdapterReadReceipt struct {
	BindingID string `json:"bindingId"`
	// Original native RFC3339 timestamp; Core validates it without rewriting the native
	// representation.
	CompletedAt     string                               `json:"completedAt"`
	ContentBytes    int64                                `json:"contentBytes"`
	ContentSha256   string                               `json:"contentSha256"`
	IdempotencyKey  string                               `json:"idempotencyKey"`
	Measurements    []AdapterReadReceiptMeasurementsItem `json:"measurements"`
	NativeObjectRef string                               `json:"nativeObjectRef"`
	NativeRevision  string                               `json:"nativeRevision"`
	OperationID     string                               `json:"operationId"`
	Role            ApplicationReadResourceDirection     `json:"role"`
}

type AdapterReadReceiptMeasurementsItem struct {
	MeterKey string `json:"meterKey"`
	Quantity int64  `json:"quantity"`
}

// Separate governed receiver action in the same read Operation. The native importer must
// perform the existing authenticated PEP check with this token immediately before its
// write; issuance is not completion.
type AdapterReadGrantResponseReceiverWrite struct {
	ActionExecutionID string `json:"actionExecutionId"`
	ActionToken       string `json:"actionToken"`
	ArgumentsJSON     string `json:"argumentsJson"`
	ExpiresAt         int64  `json:"expiresAt"`
}

// DD-138(5)、07 §4.8.4/§5.2：Core → adapter POST /platform-adapter/v1/search 的请求体（规范 JSON，其
// SHA-256 即 Search Token 的 normalized_parameter_hash）。resources 只含当前 HUMAN 已 fresh read 的该
// binding Resource，adapter 只在这些 native 对象内检索。
type AdapterSearchRequest struct {
	IdempotencyKey string `json:"idempotencyKey"`
	// 1–20。
	Limit int64 `json:"limit"`
	// ZH_CN 或 EN。
	Locale string `json:"locale"`
	// 去首尾空白后 1–200 字符。
	Query string `json:"query"`
	// 1–50 项。
	Resources []AdapterSearchResource `json:"resources"`
}

type AdapterSearchResource struct {
	NativeID   string `json:"nativeId"`
	NativeType string `json:"nativeType"`
	ResourceID string `json:"resourceId"`
}

// DD-138(5)、07 §4.8.4：adapter search 回应。至多 limit 项；title 1–200 字符、summary 至多 400 字符、path
// 为该组件原生页面 origin 内相对路径。任一项不合则 Core 丢弃该来源的全部结果。不含正文、ContentReference 或凭据。
type AdapterSearchResponse struct {
	Results []AdapterSearchResult `json:"results"`
}

type AdapterSearchResult struct {
	Kind      ComponentSearchResultKind `json:"kind"`
	Path      string                    `json:"path"`
	Summary   *string                   `json:"summary,omitempty"`
	Title     string                    `json:"title"`
	UpdatedAt *string                   `json:"updatedAt,omitempty"`
}

// GET /api/v1/workspaces/{workspaceId}/agent-turns（DD-125(6)）：已准入 Workspace 内本人持有
// Installation audit 的运行中回合；没有 audit 的 Installation 不出现（成员只见 20002）。每次读取写 ACCESS 审计。
type AgentActiveTurnPage struct {
	Turns       []AgentActiveTurnView `json:"turns"`
	WorkspaceID string                `json:"workspaceId"`
}

// DD-125(6)、17 §8：一个仍在运行的 Agent 回合（Invocation DISPATCHING/RUNNING）。只对该 Installation
// Resource audit 持有人呈现（回合开始时刻、活动入口与中断）；其他成员只见 Agent 20002 的工作中信号。读取写 ACCESS 审计。
type AgentActiveTurnView struct {
	// Installation 的 ACTIVE AGENT 公钥，供原工作中 Agent 行匹配资料与 20002。
	AgentPubkey *string `json:"agentPubkey,omitempty"`
	// DD-84 取消控制键（task.cancel.agent.invoke.v1）：本人是原发起人或持有该 Installation manage、控制定义 ACTIVE 且原
	// Workflow 仍 OPEN 时给出。省略即不显示中断；提交仍完整重新准入。
	CancelActionKey *string `json:"cancelActionKey,omitempty"`
	InstallationID  string  `json:"installationId"`
	InvocationID    string  `json:"invocationId"`
	// 该回合的 agent.invoke ActionExecution；中断时作为 DD-84 取消控制的 originalActionExecutionId。
	OriginalActionExecutionID string `json:"originalActionExecutionId"`
	ProjectionGeneration      int64  `json:"projectionGeneration"`
	// AgentSession 根引用。
	RootEventID string `json:"rootEventId"`
	// 原生 turn 开始时刻（RFC3339，取自 Codex turn startedAt）；不可查证时省略，不以本机时钟代替。
	StartedAt *string `json:"startedAt,omitempty"`
	// AgentSession 的原生 thread ID。
	ThreadID *string `json:"threadId,omitempty"`
	// 已记录的原生 turn ID；派发结果尚未记录时省略。
	TurnID *string `json:"turnId,omitempty"`
}

// DD-147(1)：GET /api/v1/workspaces/{workspaceId}/agent-authors。Workspace 成员（与成员名单同一准入）可读的
// Agent 作者目录：本 Workspace 中有 ACTIVE ChannelAgentBinding 的未删除 Installation（排空或故障中的也保留，其历史消息仍需
// owner 行）的 Agent 公钥、persona 显示名与 owner。只供消息行显示“managed by <owner>”，不含 Installation
// 其余字段，不授予任何使用、读取或管理权限；作者名仍只读 Relay kind:0（DD-117(6)）。
type AgentAuthorDirectory struct {
	Agents []AgentAuthorView `json:"agents"`
}

type AgentAuthorView struct {
	// 固定版本 personaIdentity 的显示名；缺省时客户端用公钥简写，不以 Installation 目录合成作者名。
	AgentDisplayName       *string `json:"agentDisplayName,omitempty"`
	AgentPubkey            string  `json:"agentPubkey"`
	InstallationResourceID string  `json:"installationResourceId"`
	// owner 在本 Tenant 的显示名；owner 已不是 ACTIVE 成员时省略，客户端显示原版 owner unavailable。
	OwnerDisplayName *string `json:"ownerDisplayName,omitempty"`
	OwnerPrincipalID string  `json:"ownerPrincipalId"`
}

// DD-131(6)：GET /api/v1/agent-catalog/owners?ids=<id>,<id>。目录条目（本人可 discover 的本 Tenant
// ACTIVE AgentDefinition 与 agent.team）的 owner 名，供原版 “Added by <owner>”。一次至多一页 ID；不属本
// Tenant、非 ACTIVE、非目录类型或读者当前不可 discover 的 ID 一律省略，不能用来查询任意 Principal；不授予任何权限。
type AgentCatalogOwners struct {
	Owners []AgentCatalogOwnerView `json:"owners"`
}

type AgentCatalogOwnerView struct {
	// owner 在本 Tenant 的显示名；owner 已不是 ACTIVE 成员时省略，客户端显示原版 owner unavailable。
	OwnerDisplayName *string `json:"ownerDisplayName,omitempty"`
	OwnerPrincipalID string  `json:"ownerPrincipalId"`
	ResourceID       string  `json:"resourceId"`
}

// 同 Tenant 且当前 discover 权限允许的 AgentDefinition 页；nextOffset 续读同一排序，不代表总量上限。
type AgentDefinitionPage struct {
	Definitions []AgentDefinitionView `json:"definitions"`
	NextOffset  *int64                `json:"nextOffset,omitempty"`
}

// DD-24/25 的 Core Agent 稳定身份及实际 Resource 事实；不表示版本已发布或 Agent 可运行。
type AgentDefinitionView struct {
	// DD-131(6)：该定义已由 agent.definition.share 写入 tenant#member 的 discoverer/reader；缺省即未分享。只表示同
	// Tenant 成员可发现与读取，不授予任何 Installation 使用权。
	CatalogShared                  *bool         `json:"catalogShared,omitempty"`
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
	CanGrant               bool                  `json:"canGrant"`
	CanRevoke              bool                  `json:"canRevoke"`
	Grants                 []AgentDelegationView `json:"grants"`
	InstallationResourceID string                `json:"installationResourceId"`
	NextOffset             *int64                `json:"nextOffset,omitempty"`
	ResourceVersion        int64                 `json:"resourceVersion"`
	WorkspaceID            string                `json:"workspaceId"`
}

// 同 Installation 的实际 Grant、Scope 与使用引用；没有 token、正文或新的权限裁决。state 是持久记录；effectiveState 是
// DD-126(4) 的只读投影，只有它为 ACTIVE 时 Grant 才真实可用（仍不证明当次 permission）。
type AgentDelegationView struct {
	DelegationID      string `json:"delegationId"`
	DelegationVersion int64  `json:"delegationVersion"`
	// DD-126(4)：ACTIVE＝持久 ACTIVE、在有效期内、次数未尽且每个 Scope 的同意摘要与当前解析定义相等；NEEDS_RENEWAL＝其余条件成立但有
	// Scope 的同意摘要已变化或当前已无可解析定义；NOT_YET_VALID/EXPIRED/USES_EXHAUSTED
	// 按时钟与使用次数；REVOKING/REVOKED/SUPERSEDED 取持久状态。
	EffectiveState     DelegationEffectiveState  `json:"effectiveState"`
	GrantorPrincipalID string                    `json:"grantorPrincipalId"`
	Parameters         DelegationGrantParameters `json:"parameters"`
	State              AgentDelegationViewState  `json:"state"`
	// DD-126(5)：state=SUPERSEDED 时替换本 Grant 的续签 Grant。
	SupersededByDelegationID *string `json:"supersededByDelegationId,omitempty"`
	Uses                     int64   `json:"uses"`
}

// 仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
type DelegationGrantParameters struct {
	ExpiresAt string `json:"expiresAt"`
	MaxUses   *int64 `json:"maxUses,omitempty"`
	// DD-126(5)：续签时被替换的本人 Grant；与 renewsDelegationVersion 成对出现，缺省为新授予。
	RenewsDelegationID *string `json:"renewsDelegationId,omitempty"`
	// DD-126(5)：被替换 Grant 的当前 version（CAS）。
	RenewsDelegationVersion *int64                      `json:"renewsDelegationVersion,omitempty"`
	Scopes                  []DelegationScopeParameters `json:"scopes"`
	ValidFrom               string                      `json:"validFrom"`
}

// 03 §6 的确切 Action/target/exposure 限制；管理发现与原 Grant 写入共用，发现不授予 permission。
type DelegationScopeParameters struct {
	ActionKey          string                                      `json:"actionKey"`
	ActionVersion      int64                                       `json:"actionVersion"`
	CreateWorkspaceID  *string                                     `json:"createWorkspaceId,omitempty"`
	OutputSchemaHash   string                                      `json:"outputSchemaHash"`
	RedactionPolicy    string                                      `json:"redactionPolicy"`
	ResultExposureMode DelegationScopeParametersResultExposureMode `json:"resultExposureMode"`
	TargetID           *string                                     `json:"targetId,omitempty"`
	TargetType         string                                      `json:"targetType"`
	ToolResourceID     *string                                     `json:"toolResourceId,omitempty"`
}

// 原 Grant 校验器当前允许的确切 Action/target/exposure；空页没有可授予对象，不伪造默认 Scope。
type AgentDelegationTargetPage struct {
	InstallationResourceID string                      `json:"installationResourceId"`
	NextOffset             *int64                      `json:"nextOffset,omitempty"`
	ResourceVersion        int64                       `json:"resourceVersion"`
	Scopes                 []DelegationScopeParameters `json:"scopes"`
	WorkspaceID            string                      `json:"workspaceId"`
}

// DD-131(2)、DD-26：导入人在本 Tenant 可选的 RuntimeProfile 与已治理
// Route（与版本配置目录同一来源与过滤）。目录为空不阻止导入（导入时不强制选择，DD-131(2)）；canImport 只反映动作开放与 Tenant
// create。目录不授予发布、安装或运行权限。
type AgentImportConfigurationPage struct {
	CanImport  bool                                  `json:"canImport"`
	NextOffset *int64                                `json:"nextOffset"`
	Profiles   []RuntimeProfileDirectoryProfilesItem `json:"profiles"`
	Routes     []AgentVersionRouteOption             `json:"routes"`
}

type RuntimeProfileDirectoryProfilesItem struct {
	CapabilityContract RuntimeProfileDirectoryProfilesItemCapabilityContract `json:"capabilityContract"`
	Key                string                                                `json:"key"`
	Kind               RuntimeProfileKind                                    `json:"kind"`
	Status             string                                                `json:"status"`
	WebAvailability    string                                                `json:"webAvailability"`
}

type RuntimeProfileDirectoryProfilesItemCapabilityContract struct {
	CapabilityRequirements []string `json:"capabilityRequirements"`
	MaxIdleTimeoutSeconds  int64    `json:"maxIdleTimeoutSeconds"`
	MaxParallelism         int64    `json:"maxParallelism"`
	MaxTurnDurationSeconds int64    `json:"maxTurnDurationSeconds"`
	ReplyPolicies          []string `json:"replyPolicies"`
	// 同一发布合同中回复策略键到 Buzz ResolvedPersona 原生布尔字段的显式映射；缺映射不表示支持。
	ReplyPolicyMappings []RuntimeReplyPolicyMapping `json:"replyPolicyMappings,omitempty"`
}

type RuntimeReplyPolicyMapping struct {
	BroadcastReplies bool   `json:"broadcastReplies"`
	Key              string `json:"key"`
	ThreadReplies    bool   `json:"threadReplies"`
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

type AgentInstallationCandidatePage struct {
	// 原 Installation create exposure、目录与 fresh Workspace create；每个候选还须 consume/投影查证，提交时全部重验。
	CanCreate   bool                         `json:"canCreate"`
	Candidates  []AgentInstallationCandidate `json:"candidates"`
	NextOffset  *int64                       `json:"nextOffset,omitempty"`
	WorkspaceID string                       `json:"workspaceId"`
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

// 按既有部署登记页长扫描同一 Workspace，再以 fresh Installation Resource read 过滤；空页不代表整个 Workspace 无安装。
type AgentInstallationPage struct {
	Installations []AgentInstallationView `json:"installations"`
	NextOffset    *int64                  `json:"nextOffset,omitempty"`
}

// 03 §7、17 §8：同 Tenant、已准入 Workspace 且 fresh Installation Resource read 允许的只读事实；不授予 Version
// 正文、执行或管理权限。
type AgentInstallationView struct {
	ActiveProjectionGeneration *int64 `json:"activeProjectionGeneration,omitempty"`
	// 17 §3：固定 Version personaIdentity 的展示名，经同一 Installation Resource read
	// 准入；只供提及与成员目录呈现，不授予执行或 Definition 读取。旧服务缺省时调用方回退到原 Definition 读取。
	AgentDisplayName    *string                                  `json:"agentDisplayName,omitempty"`
	AgentPrincipalID    string                                   `json:"agentPrincipalId"`
	AgentPrincipalState AgentInstallationViewAgentPrincipalState `json:"agentPrincipalState"`
	// 原 Installation 的 ACTIVE AGENT BuzzIdentityBinding 公开公钥；经相同 Resource read 准入，仅供原 Inbox
	// owner/作者匹配，不授予执行或签名权限。旧服务缺省不证明身份映射。
	AgentPubkey     *string `json:"agentPubkey,omitempty"`
	AgentResourceID string  `json:"agentResourceId"`
	// 同固定 Version、ACTIVE 投影与原生 Profile 已支持的 Automation 来源结果位置；普通 Agent 仍沿其固定回复策略，Automation
	// 则消息到原 Thread、Schedule/manual 到同 Workspace Channel。不代表 execute、Delegation 或 quota
	// 准入。缺失或空集合不支持 Schedule。
	AutomationResultTargets []AutomationResultTarget `json:"automationResultTargets,omitempty"`
	// DD-125(6)、17 §8：本人 fresh Installation Resource audit 允许读取会话转写、实时 item
	// 与运行中回合（受审计敏感读取）。false 或缺省时只呈现 20002 工作中信号。
	CanAudit *bool `json:"canAudit,omitempty"`
	// DD-125(6)、05 §2.11：原“停止 / 从频道移除 / 删除”入口。动作目录开放 agent.installation.disable、安装 ACTIVE
	// 且没有未终结投影、本人 fresh Installation manage 时为 true；命令只带 resourceId、resourceVersion 与
	// explicitConfirmation。不代表已准入，旧服务缺省不显示。
	CanDisable *bool `json:"canDisable,omitempty"`
	// DD-125(6)：原“启动”入口。目录开放 agent.installation.enable、安装 DISABLED、固定 Version 仍 PUBLISHED、本人
	// fresh Installation manage 时为 true；命令只带 resourceId、resourceVersion 与 explicitConfirmation。
	CanEnable *bool `json:"canEnable,omitempty"`
	// DD-125(6)、DD-122(4)：原“重启”入口，即对固定 Version 的同版本
	// agent.installation.upgrade（assetId=pinnedVersionAssetId）。canUpgrade 成立且固定 Version 仍
	// PUBLISHED 时为 true；仍沿升级审批与排空。
	CanRestart *bool `json:"canRestart,omitempty"`
	// 当前 ACTIVE 安装可按原 manage 权限申请已发布目标版本；仍须原治理审批，不代表升级已经准入。旧服务缺省不显示入口。
	CanUpgrade          *bool                                     `json:"canUpgrade,omitempty"`
	ChannelBinding      *AgentInstallationViewChannelBinding      `json:"channelBinding,omitempty"`
	ExecutionPermission *AgentInstallationViewExecutionPermission `json:"executionPermission,omitempty"`
	// DD-147(1)：该 Installation owner 在本 Tenant 的显示名，只在其 TenantMembership 与 HumanIdentity 仍为
	// ACTIVE 时给出；可读条件与本视图相同。缺省时客户端显示原版 owner unavailable，不以 Installation 目录合成作者名（DD-117(6)）。
	OwnerDisplayName     *string                              `json:"ownerDisplayName,omitempty"`
	OwnerPrincipalID     string                               `json:"ownerPrincipalId"`
	PinnedVersionAssetID string                               `json:"pinnedVersionAssetId"`
	Projection           *AgentInstallationProjectionView     `json:"projection,omitempty"`
	ReadPermission       *AgentInstallationViewReadPermission `json:"readPermission,omitempty"`
	ResourceID           string                               `json:"resourceId"`
	ResourceState        ResourceState                        `json:"resourceState"`
	ResourceVersion      int64                                `json:"resourceVersion"`
	State                AgentInstallationState               `json:"state"`
	WorkspaceID          string                               `json:"workspaceId"`
}

type AgentInstallationViewChannelBinding struct {
	ChannelID *string                                   `json:"channelId,omitempty"`
	Status    AgentInstallationViewChannelBindingStatus `json:"status"`
	Triggers  []AgentTrigger                            `json:"triggers"`
}

type AgentInstallationViewExecutionPermission struct {
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

type AgentInstallationViewReadPermission struct {
	CanGrant                 bool    `json:"canGrant"`
	CanRevoke                bool    `json:"canRevoke"`
	Effective                bool    `json:"effective"`
	PendingActionExecutionID *string `json:"pendingActionExecutionId,omitempty"`
	Requested                bool    `json:"requested"`
}

// Installation 的 Skill 投影状态（requested/projection/current）；需 Installation read，读取不触发投影或重试。
type AgentInstallationSkillPage struct {
	AgentVersionAssetID    string                       `json:"agentVersionAssetId"`
	Generation             *int64                       `json:"generation,omitempty"`
	InstallationResourceID string                       `json:"installationResourceId"`
	Skills                 []AgentInstallationSkillView `json:"skills"`
}

// DD-135(7)：Installation pinned Version 引用的一个 Skill 的 requested 事实、投影结果与当前状态；不含正文或物化路径。
type AgentInstallationSkillView struct {
	ArtifactDigest string `json:"artifactDigest"`
	Ordinal        int64  `json:"ordinal"`
	// 当前 generation 已以 digest 物化并经 skills/list 核对。
	Projected           bool                         `json:"projected"`
	SkillResourceID     string                       `json:"skillResourceId"`
	SkillVersionAssetID string                       `json:"skillVersionAssetId"`
	StableSlug          string                       `json:"stableSlug"`
	Status              AgentInstallationSkillStatus `json:"status"`
}

// DD-122: the tools an Agent Installation's current generation requests and their effective
// state. Read-only; grants happen only through installation create/upgrade.
type AgentInstallationToolPage struct {
	Generation             int64                       `json:"generation"`
	InstallationResourceID string                      `json:"installationResourceId"`
	Tools                  []AgentInstallationToolView `json:"tools"`
}

type AgentInstallationToolView struct {
	ApplicationBindingID *string                `json:"applicationBindingId,omitempty"`
	BindingStatus        AgentToolBindingStatus `json:"bindingStatus"`
	// APPLICATION only: the requested capability contract key@version.
	CapabilityRequirement *string                     `json:"capabilityRequirement,omitempty"`
	Name                  *string                     `json:"name,omitempty"`
	ReasonCode            *ReasonCode                 `json:"reasonCode,omitempty"`
	Source                AgentInstallationToolSource `json:"source"`
	// Absent when an application capability requirement has no resolved provider yet.
	ToolResourceID *string `json:"toolResourceId,omitempty"`
}

// 05 §2.10、17 §8：一个 Agent Installation 在其 Workspace 的成员使用权目录。requested 是该成员显式持有
// reader/executor/delegator 三项关系；effective 是 fresh read/execute/delegate 全部允许（含 owner/admin
// 既有权限）。canGrant/canRevoke 只说明当前查看者可提交对应受治理请求，不代表请求已准入。
type AgentInstallationUsePage struct {
	InstallationID           string                                `json:"installationId"`
	Members                  []AgentInstallationUsePageMembersItem `json:"members"`
	PendingActionExecutionID *string                               `json:"pendingActionExecutionId,omitempty"`
	ResourceVersion          int64                                 `json:"resourceVersion"`
	// DD-125(6)：原 respondTo 在本页的映射。至少一名成员 requested=true 即 ALLOWLIST，否则 OWNER_ONLY；切换只经逐成员
	// agent.installation.use.grant/revoke，不存在 anyone。旧服务缺省时客户端按 members 推导。
	RespondTo *AgentRespondToMode `json:"respondTo,omitempty"`
}

type AgentInstallationUsePageMembersItem struct {
	CanGrant    bool   `json:"canGrant"`
	CanRevoke   bool   `json:"canRevoke"`
	DisplayName string `json:"displayName"`
	Effective   bool   `json:"effective"`
	PrincipalID string `json:"principalId"`
	Requested   bool   `json:"requested"`
}

// 原 Session 同 generation 调用元事实，逐页 fresh Installation read，且仅本人发起或实际 AE 目标 audit 允许；不返回
// prompt、tool result、reasoning、凭据或成本。未授权项过滤后空页仍可能有 nextCursor。
type AgentInvocationPage struct {
	Invocations []AgentInvocationView `json:"invocations"`
	NextCursor  *string               `json:"nextCursor,omitempty"`
}

// 原 AgentInvocation 持久状态，不替代 Temporal。observation 或 UNKNOWN 时不得渲染为成功/失败；cancelPending
// 不等于已取消；createdAt/updatedAt 是 Core 记录时间，不是假造的原生事件时间。
type AgentInvocationView struct {
	ActionExecutionID string `json:"actionExecutionId"`
	CancelPending     bool   `json:"cancelPending"`
	// 当前 HUMAN 是否为原任务发起人。仅控制任务详情入口；任务读取仍执行自身实时授权。
	CanReadTask bool `json:"canReadTask"`
	// Core 记录的 RFC3339 时间字符串，按原线格式传输。
	CreatedAt     string                    `json:"createdAt"`
	InvocationID  string                    `json:"invocationId"`
	Observation   *ReasonCode               `json:"observation,omitempty"`
	RuntimeTurnID *string                   `json:"runtimeTurnId,omitempty"`
	Status        AgentInvocationViewStatus `json:"status"`
	// Core 记录的 RFC3339 时间字符串，按原线格式传输。
	UpdatedAt string `json:"updatedAt"`
}

// 19 §5：复合游标走到原生末尾才 COMPLETE。BOUND_EXCEEDED/UNKNOWN 不是空库存；只是本次 best-effort head tuple
// snapshot，不是严格存量权威。
type AgentMemoryEntryPage struct {
	Entries                []AgentMemoryEntryView `json:"entries"`
	InstallationResourceID string                 `json:"installationResourceId"`
	OperationID            string                 `json:"operationId"`
	// 仅 HUMAN 管理读取且 state 为 COMPLETE 时提供（DD-125(10)）；BOUND_EXCEEDED/UNKNOWN 与 Agent
	// 记忆工具结果省略，客户端保持 slug 顺序。
	References  *AgentMemoryReferenceView `json:"references,omitempty"`
	State       AgentMemoryEntryPageState `json:"state"`
	WorkspaceID string                    `json:"workspaceId"`
}

// NIP-AE cold head tuple，不含 value 或任何正文；tombstone 是当前原生 head，不回退旧 value。listing 为 COMPLETE
// 的 HUMAN 管理读取另含该条正文中的引用 slug（DD-125(10)），Agent 记忆工具结果不含。
type AgentMemoryEntryView struct {
	CreatedAt int64  `json:"createdAt"`
	EventID   string `json:"eventId"`
	// 仅 HUMAN 管理读取、listing COMPLETE 且非 tombstone 时提供：以原 extract_refs 从该条正文提取的 [[slug]]
	// 引用，按首次出现顺序去重、只含合法 slug。BOUND_EXCEEDED/UNKNOWN、tombstone 与 Agent 记忆工具结果省略。
	OutgoingRefs []string `json:"outgoingRefs,omitempty"`
	Slug         string   `json:"slug"`
	Tombstone    bool     `json:"tombstone"`
}

// 仅 HUMAN 管理读取且 state 为 COMPLETE 时提供（DD-125(10)）；BOUND_EXCEEDED/UNKNOWN 与 Agent
// 记忆工具结果省略，客户端保持 slug 顺序。
//
// agent.memory.entry.list 为 COMPLETE 时，在同一准入与同一次 NIP-AE 读取内，以原 extract_refs 从 core head
// 与各条非 tombstone head 的已解密正文提取的引用关系（DD-125(10)）。只是派生视图：不含正文，不授予任何读取权；客户端据此按
// core、其引用树先序、未被引用者按 slug 排列。
type AgentMemoryReferenceView struct {
	// 本次读取存在 core head；false 时客户端显示“没有 core”。
	CoreExists bool `json:"coreExists"`
	// core profile 中的引用，按首次出现顺序去重，只含合法 slug；没有 core 时为空。
	CoreRefs []string `json:"coreRefs"`
	// 按目标 slug 排序。
	Dangling []AgentMemoryDanglingRefView `json:"dangling"`
}

// 被某条已解密 head 以 [[slug]] 引用、但不在本次 COMPLETE listing 的非 tombstone 条目集合中的目标（原版 Missing
// link，DD-125(10)）。tombstone 目标与没有 core 时对 core 的引用同样悬挂。只含 slug，不含正文。
type AgentMemoryDanglingRefView struct {
	// 引用者 slug，core 记为 "core"；去重并按 slug 排序。
	ReferencedBy []string `json:"referencedBy"`
	Slug         string   `json:"slug"`
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

// DD-121: only agent.invoke executions initiated by the caller for the requested source
// events; no message body, no other member's executions, no Agent internals. A mentioned
// Agent without an outcome is still PENDING (not yet scanned).
type AgentMentionOutcomePage struct {
	Outcomes []AgentMentionOutcomeView `json:"outcomes"`
}

type AgentMentionOutcomeView struct {
	EventID        string                   `json:"eventId"`
	InstallationID string                   `json:"installationId"`
	ReasonCode     *ReasonCode              `json:"reasonCode,omitempty"`
	ReplyEventID   *string                  `json:"replyEventId,omitempty"`
	State          AgentMentionOutcomeState `json:"state"`
}

// DD-121: the caller's own channel messages (event IDs) whose agent.invoke admission
// outcome the caller may see.
type AgentMentionOutcomeQueryRequest struct {
	EventIDS []string `json:"eventIds"`
}

// 17 §8、19 §4：已准入 Workspace 与 Installation read 的原 Session 元事实；不包含或授权 Codex rollout
// 正文。cursor 固定 HUMAN、scope、筛选与原生 generation。
type AgentSessionPage struct {
	NextCursor *string            `json:"nextCursor,omitempty"`
	Sessions   []AgentSessionView `json:"sessions"`
}

type AgentSessionView struct {
	AgentVersionAssetID string `json:"agentVersionAssetId"`
	// Core 记录的 RFC3339 时间字符串，按原线格式传输。
	CreatedAt              string `json:"createdAt"`
	InstallationResourceID string `json:"installationResourceId"`
	ProjectionGeneration   int64  `json:"projectionGeneration"`
	// 既有 BUZZ_EVENT、SCHEDULE 或 MANUAL Session 根引用；不从客户端生成 native thread。
	RootEventID     string  `json:"rootEventId"`
	RuntimeThreadID *string `json:"runtimeThreadId,omitempty"`
	// ABANDONED：只剩 birth 结果不明、Invocation 已全部确定终态的 Session 超过对账期限后由 Core 放弃，不再派发 turn（DD-154）。
	Status      AgentSessionViewStatus `json:"status"`
	WorkspaceID string                 `json:"workspaceId"`
}

// DD-131(2)：校验通过的快照包的导入预览与一次性暂存引用。只含映射后将进入新 DRAFT 的可移植字段与被丢弃的原版字段类别；不回显包正文、名单公钥或记忆。确认导入经
// agent.definition.import。
type AgentSnapshotImportPreview struct {
	// 包内联的头像（≤2 MiB 的 data URL）供预览；上传时已按附件规则存为本 Tenant 内容寻址媒体对象，DRAFT personaIdentity 只引用该对象。
	AvatarDataURL *string `json:"avatarDataUrl,omitempty"`
	// 内联头像在本 Tenant 媒体中的对象地址（/media/<sha256>），即新 DRAFT 的 personaIdentity.avatarUrl。
	AvatarURL          *string                             `json:"avatarUrl,omitempty"`
	Description        *string                             `json:"description,omitempty"`
	DisplayName        string                              `json:"displayName"`
	ExpiresAt          string                              `json:"expiresAt"`
	FormatKey          AgentSnapshotImportPreviewFormatKey `json:"formatKey"`
	IdleTimeoutSeconds *int64                              `json:"idleTimeoutSeconds,omitempty"`
	// 可为空串：包没有 systemPrompt 时生成空指令的 DRAFT，补充后才能发布。
	Instructions           string                  `json:"instructions"`
	MaxTurnDurationSeconds *int64                  `json:"maxTurnDurationSeconds,omitempty"`
	MediaType              AgentSnapshotMediaType  `json:"mediaType"`
	Omitted                []AgentSnapshotOmission `json:"omitted"`
	PackageByteSize        int64                   `json:"packageByteSize"`
	PackageDigest          string                  `json:"packageDigest"`
	Parallelism            *int64                  `json:"parallelism,omitempty"`
	SourceIsBuiltIn        *bool                   `json:"sourceIsBuiltIn,omitempty"`
	UploadID               string                  `json:"uploadId"`
}

// DD-131(2)、DD-143：一次 Agent 快照包的原始字节（标准 base64，Web 与 Desktop 同一 JSON 传输）。解码后 JSON 不超过 5
// MiB、PNG 不超过 10 MiB；格式与版本由 Core 判定。
type AgentSnapshotUploadRequest struct {
	ContentBase64 string                 `json:"contentBase64"`
	MediaType     AgentSnapshotMediaType `json:"mediaType"`
}

// 同 Tenant 且读者当前可 discover 的未删除 AgentTeam 页（DD-131(1)(6)）；nextOffset 续读同一排序。
type AgentTeamPage struct {
	NextOffset *int64          `json:"nextOffset,omitempty"`
	Teams      []AgentTeamView `json:"teams"`
}

// DD-131(1) 的 Tenant 级 agent_team Resource 及 AgentTeam 事实（03 §7）。memberAgentResourceIds
// 只列读者当前可 discover 的成员，次序不变；hiddenMemberCount 是其余成员个数，不暴露其 ID。catalogShared 表示该团队已写入
// tenant#member 的 discoverer/reader（DD-131(6)）。成员停用或删除不改写团队，部署与提及时按当前状态跳过。
type AgentTeamView struct {
	CatalogShared          bool          `json:"catalogShared"`
	Description            *string       `json:"description,omitempty"`
	HiddenMemberCount      int64         `json:"hiddenMemberCount"`
	MemberAgentResourceIDS []string      `json:"memberAgentResourceIds"`
	Name                   string        `json:"name"`
	OwnerPrincipalID       string        `json:"ownerPrincipalId"`
	ResourceID             string        `json:"resourceId"`
	ResourceState          ResourceState `json:"resourceState"`
	ResourceVersion        int64         `json:"resourceVersion"`
}

// DD-131(3)：校验通过的团队快照包的导入预览与一次性暂存引用。团队名与说明进入新 agent_team；每个成员按 DD-131(2) 映射为将新建的 Definition
// 与 DRAFT。团队 instructions 不进入包也不导入（DD-131(1)）。确认导入经 agent.team.import，任一成员失败整包不提交。
type AgentTeamSnapshotImportPreview struct {
	Description     *string                                     `json:"description,omitempty"`
	ExpiresAt       string                                      `json:"expiresAt"`
	FormatKey       AgentTeamSnapshotImportPreviewFormatKey     `json:"formatKey"`
	MediaType       AgentSnapshotMediaType                      `json:"mediaType"`
	Members         []AgentTeamSnapshotImportPreviewMembersItem `json:"members"`
	Name            string                                      `json:"name"`
	PackageByteSize int64                                       `json:"packageByteSize"`
	PackageDigest   string                                      `json:"packageDigest"`
	// 包内带有原版团队 instructions；按 DD-131(1) 不导入。
	TeamInstructionsOmitted bool   `json:"teamInstructionsOmitted"`
	UploadID                string `json:"uploadId"`
}

type AgentTeamSnapshotImportPreviewMembersItem struct {
	// 仅与 avatarUrl 同时出现：包内该成员头像的原字节（data URL），只供预览显示，不写入任何对象。
	AvatarDataURL *string `json:"avatarDataUrl,omitempty"`
	// 该成员内联头像在本 Tenant 媒体中的对象地址（/media/<sha256>），即其 DRAFT 的 personaIdentity.avatarUrl。
	AvatarURL   *string `json:"avatarUrl,omitempty"`
	Description *string `json:"description,omitempty"`
	DisplayName string  `json:"displayName"`
	// 可为空串：成员没有 systemPrompt 时生成空指令的 DRAFT，补充后才能发布。
	Instructions string                  `json:"instructions"`
	Omitted      []AgentSnapshotOmission `json:"omitted"`
}

// DD-131(3)：一次团队快照包的原始字节（标准 base64，Web 与 Desktop 同一 JSON 传输）。解码后 JSON 不超过 25 MiB、PNG 不超过 50
// MiB；格式与版本由 Core 判定。
type AgentTeamSnapshotUploadRequest struct {
	ContentBase64 string                 `json:"contentBase64"`
	MediaType     AgentSnapshotMediaType `json:"mediaType"`
}

// GET /api/v1/agent-installations/{id}/transcript/stream 的 SSE 数据帧（DD-125(6)）：Core 从同一
// Installation 原生进程读到的 item/started、item/completed、turn/started、turn/completed 通知，按 thread
// 解析到 AgentSession 后转发；只在建立时与周期性再准入下 Installation audit 成立期间发送，建立时写 ACCESS
// 审计。帧不落库，断线后以分页读取补齐。
type AgentTranscriptEvent struct {
	// 原生通知时间（item 的 startedAtMs/completedAtMs 或 turn 通知的 emittedAtMs），Unix 毫秒。
	AtMS           *int64 `json:"atMs,omitempty"`
	InstallationID string `json:"installationId"`
	// ITEM_STARTED / ITEM_COMPLETED 时给出。
	Item                 *AgentTranscriptItem      `json:"item,omitempty"`
	Phase                AgentTranscriptEventPhase `json:"phase"`
	ProjectionGeneration int64                     `json:"projectionGeneration"`
	RootEventID          string                    `json:"rootEventId"`
	ThreadID             string                    `json:"threadId"`
	TurnID               string                    `json:"turnId"`
}

// ITEM_STARTED / ITEM_COMPLETED 时给出。
//
// DD-125(6)、SF-COD-09/17、17 §8：一条 Codex ThreadItem 的转写适配形状。BFF 只在 Installation Resource
// audit 准入后，由 Core 经同一 Installation 的原生 app-server 读取（thread/items/list 或
// item/started、item/completed 通知），按固定 Codex 类型逐字段映射后直接回应；Core 不存储、不复制正文。变体按 kind
// 解释，各变体字段全部可选（contracts §1 平坦结构）。客户端把它适配为原 Buzz 转写条目。
type AgentTranscriptItem struct {
	// COMMAND_EXECUTION 的 stdout/stderr 聚合输出。
	AggregatedOutput *string `json:"aggregatedOutput,omitempty"`
	// 工具调用参数的 JSON 文本（原生 arguments 原样序列化）。
	ArgumentsJSON *string `json:"argumentsJson,omitempty"`
	// COMMAND_EXECUTION 的命令。
	Command *string `json:"command,omitempty"`
	// item/completed 的 completedAtMs（Unix 毫秒）；历史页没有该原生事实时省略。
	CompletedAtMS *int64 `json:"completedAtMs,omitempty"`
	// COMMAND_EXECUTION 的工作目录（Installation 隔离目录内）。
	Cwd *string `json:"cwd,omitempty"`
	// COMMAND_EXECUTION、MCP_TOOL_CALL、DYNAMIC_TOOL_CALL 的原生耗时。
	DurationMS *int64 `json:"durationMs,omitempty"`
	// MCP_TOOL_CALL 的原生 error.message。
	ErrorText *string `json:"errorText,omitempty"`
	ExitCode  *int64  `json:"exitCode,omitempty"`
	// FILE_CHANGE 的逐文件变更。
	FileChanges []AgentTranscriptFileChange `json:"fileChanges,omitempty"`
	// 原生 ThreadItem.id。
	ItemID string                  `json:"itemId"`
	Kind   AgentTranscriptItemKind `json:"kind"`
	// 原生 ThreadItem 的 type 标签原文（如 commandExecution）；OTHER 时客户端以原 raw 条目呈现。
	NativeType string                       `json:"nativeType"`
	Phase      *AgentTranscriptMessagePhase `json:"phase,omitempty"`
	// WEB_SEARCH 的查询词（部署已关闭托管搜索，一般不出现）。
	Query *string `json:"query,omitempty"`
	// REASONING 的原文段（原生提供时）。
	ReasoningContent []string `json:"reasoningContent,omitempty"`
	// REASONING 的 summary 段。
	ReasoningSummary []string `json:"reasoningSummary,omitempty"`
	// 工具结果中的文本内容按原顺序以换行连接；非文本内容不转发。
	ResultText *string `json:"resultText,omitempty"`
	// MCP_TOOL_CALL 的 MCP server 名；DYNAMIC_TOOL_CALL 的 namespace。
	Server *string `json:"server,omitempty"`
	// item/started 的 startedAtMs（Unix 毫秒）；历史页没有该原生事实时省略。
	StartedAtMS *int64                     `json:"startedAtMs,omitempty"`
	Status      *AgentTranscriptItemStatus `json:"status,omitempty"`
	// USER_MESSAGE 的文本输入按原顺序以换行连接；AGENT_MESSAGE 与 PLAN 的正文。
	Text *string `json:"text,omitempty"`
	// MCP_TOOL_CALL / DYNAMIC_TOOL_CALL 的工具名。
	Tool *string `json:"tool,omitempty"`
	// 所属原生 turn ID。
	TurnID string `json:"turnId"`
}

type AgentTranscriptFileChange struct {
	ChangeKind AgentTranscriptFileChangeKind `json:"changeKind"`
	// 原生 unified diff 文本。
	Diff string `json:"diff"`
	// UPDATE 改名时的目标路径。
	MovePath *string `json:"movePath,omitempty"`
	Path     string  `json:"path"`
}

// GET
// /api/v1/agent-installations/{id}/transcript?rootEventId&projectionGeneration&cursor（DD-125(6)、V-SCN-143）：按
// AgentSession 分页读取 Codex thread/items/list（升序），要求 Installation Resource audit，受审计敏感读取，Core
// 不复制正文。nextCursor 绑定读者、Installation 与 Session，原生 cursor 不外露。activeTurn 只在该 Session
// 有运行中回合时给出。Session 尚无原生 thread 时 items 为空且省略 threadId。
type AgentTranscriptPage struct {
	ActiveTurn           *AgentActiveTurnView  `json:"activeTurn,omitempty"`
	InstallationID       string                `json:"installationId"`
	Items                []AgentTranscriptItem `json:"items"`
	NextCursor           *string               `json:"nextCursor,omitempty"`
	ProjectionGeneration int64                 `json:"projectionGeneration"`
	RootEventID          string                `json:"rootEventId"`
	ThreadID             *string               `json:"threadId,omitempty"`
}

// DD-24/25/26：Definition 范围的受权版本配置目录，消费平台发布 RuntimeProfile 合同与已治理 Route。缺真实来源时两目录为空且
// canCreate=false；目录或 canCreate 不授予发布、安装和运行权限。
type AgentVersionConfigurationPage struct {
	AgentResourceID string                                `json:"agentResourceId"`
	CanCreate       bool                                  `json:"canCreate"`
	NextOffset      *int64                                `json:"nextOffset"`
	Profiles        []RuntimeProfileDirectoryProfilesItem `json:"profiles"`
	ResourceVersion int64                                 `json:"resourceVersion"`
	Routes          []AgentVersionRouteOption             `json:"routes"`
}

// DD-24/25、17 §3/8：同 Definition 下逐项 fresh Asset read 后的版本目录；DRAFT 可发现，PUBLISHED/RETIRED
// 不可编辑。nextOffset 属原始扫描窗口，空的受权页不证明全集为空。
type AgentVersionPage struct {
	AgentResourceID string             `json:"agentResourceId"`
	NextOffset      *int64             `json:"nextOffset"`
	ResourceVersion int64              `json:"resourceVersion"`
	Versions        []AgentVersionView `json:"versions"`
}

type AgentVersionView struct {
	AgentResourceID string `json:"agentResourceId"`
	AssetID         string `json:"assetId"`
	AssetVersion    int64  `json:"assetVersion"`
	// Exact avatar URLs belonging to this authorized Version's current Tenant Community mapped
	// to the existing same-origin profile media reader. Read projection only; not content, a
	// credential, or an arbitrary remote proxy.
	AvatarMediaPaths map[string]string `json:"avatarMediaPaths,omitempty"`
	// 当前 HUMAN 对此 exact DRAFT 的已登记 EXPLICIT publish 动作及 fresh Asset manage
	// 资格；缺字段不允许发布，不证明已安装或可运行。
	CanPublish *bool `json:"canPublish,omitempty"`
	// 当前 HUMAN 对此 exact PUBLISHED 的已登记 EXPLICIT retire 动作及 fresh Asset manage
	// 资格；缺字段不允许退役，退役只禁止新安装，保留既有安装与在途的固定版本。
	CanRetire *bool `json:"canRetire,omitempty"`
	// 当前 HUMAN 对此 exact DRAFT 的已登记 update 动作及 fresh Asset update 资格；缺字段不允许编辑，提交时仍重验。
	CanUpdate        *bool               `json:"canUpdate,omitempty"`
	ConfigHash       string              `json:"configHash"`
	Content          AgentVersionContent `json:"content"`
	Ordinal          int64               `json:"ordinal"`
	OwnerPrincipalID string              `json:"ownerPrincipalId"`
	State            AgentVersionState   `json:"state"`
}

// 仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
//
// 03 §7、17 §3 的 requested 行为内容；不含 owner、Workspace、凭据、provider 地址或 host
// environment。发布不等于安装或运行授权。DRAFT 可缺 runtimeProfileKey、modelRouteResourceId 与
// replyPolicy，instructions 可为空串（DD-131(2) 导入草稿与原版一致不要求运行配置）；agent.version.publish
// 准入时三者必须齐备且 instructions 非空，PUBLISHED 版本总是完整。
type AgentVersionContent struct {
	// 精确 contract_key@version，不引用业务能力实现名。
	CapabilityRequirements  []string                        `json:"capabilityRequirements"`
	DeclaredToolResourceIDS []string                        `json:"declaredToolResourceIds"`
	Instructions            string                          `json:"instructions"`
	MemoryPolicy            AgentVersionContentMemoryPolicy `json:"memoryPolicy"`
	// DRAFT 可缺省；发布时必填。
	ModelRouteResourceID *string                            `json:"modelRouteResourceId,omitempty"`
	Parallelism          int64                              `json:"parallelism"`
	PersonaIdentity      AgentVersionContentPersonaIdentity `json:"personaIdentity"`
	// RuntimeProfile capability contract 所声明的回复策略键；不隐式授予触发或读取权限。DRAFT 可缺省；发布时必填。
	ReplyPolicy *string `json:"replyPolicy,omitempty"`
	// DRAFT 可缺省；发布时必填。
	RuntimeProfileKey    *string                       `json:"runtimeProfileKey,omitempty"`
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

// 当前HUMAN管理scope内的真实接入元数据。不是组件内部状态、配置、SecretRef或原生管理credential。
type ApplicationBindingPage struct {
	// 仅 canCreate=true 时给出：Catalog 中已 APPROVED 的 APPLICATION release 的绑定所需公开声明（03
	// §9）。secretSchema 只含键与格式声明，供 Tenant admin 按项提交 bindingSecretValues；不含任何 secret
	// 值、SecretRef、locator 或 Catalog 管理权。
	BindableReleases []ApplicationBindableRelease `json:"bindableReleases,omitempty"`
	Bindings         []ApplicationBindingView     `json:"bindings"`
	CanCreate        bool                         `json:"canCreate"`
	NextOffset       *int64                       `json:"nextOffset,omitempty"`
}

type ApplicationBindableRelease struct {
	ComponentReleaseID string                      `json:"componentReleaseId"`
	ComponentTypeKey   string                      `json:"componentTypeKey"`
	SecretSchema       []ApplicationBindableSecret `json:"secretSchema"`
	Version            string                      `json:"version"`
}

type ApplicationBindableSecret struct {
	LengthOrFormat string `json:"lengthOrFormat"`
	SecretKey      string `json:"secretKey"`
	ValueType      string `json:"valueType"`
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
	HasNativePage *bool `json:"hasNativePage,omitempty"`
	// Active approved binding declares a SERVICE read receiver. Resource discovery and writes
	// still freshly check the original source share and receiver update permissions.
	HasReadReceiver *bool `json:"hasReadReceiver,omitempty"`
	// Core 在已准入绑定事务中冻结的已批准 release 最大暴露边界。固定归属于
	// binding/release/generation/action/version；不是授权，不能替代 fresh target permission、schema 或
	// redaction 校验。未 ACTIVE 的绑定仅向 canCreate 管理者提供部署引用，仍不得执行。
	HumanActionPolicies []ApplicationHumanActionPolicy `json:"humanActionPolicies,omitempty"`
	// DD-127(4): presentation category the approved NATIVE_PAGE release declares. The sidebar
	// labels the entry by capabilityCategories ∪ this value; it grants nothing.
	NativePageCategory *NativePageCategory `json:"nativePageCategory,omitempty"`
	// DD-138: preference items the pinned APPROVED KAILO_EMBED release declares for Kailo
	// settings (07 §4.8.2). Kailo settings render them by category, never by component. Absent
	// when none; Core keeps no values.
	Preferences []ComponentPreferenceDeclaration `json:"preferences,omitempty"`
	State       ApplicationBindingState          `json:"state"`
	TenantID    string                           `json:"tenantId"`
	Version     int64                            `json:"version"`
	WorkspaceID *string                          `json:"workspaceId,omitempty"`
}

type ApplicationBindingCapability struct {
	Category string `json:"category"`
	Version  int64  `json:"version"`
}

type ApplicationHumanActionPolicy struct {
	ActionKey                   string `json:"actionKey"`
	ActionVersion               int64  `json:"actionVersion"`
	ComponentReleaseID          string `json:"componentReleaseId"`
	Generation                  int64  `json:"generation"`
	ResultExposurePolicyID      string `json:"resultExposurePolicyId"`
	ResultExposurePolicyVersion int64  `json:"resultExposurePolicyVersion"`
}

// DD-138：KAILO_EMBED release 向 Kailo 设置页贡献的一项偏好声明（03
// FrontendPresentationContract.preference_declarations[]，07 §4.8.2）。值对象，随 APPROVED release
// 固定；Core 不保存偏好的值。键规则、选项数量与文案长度由 Core 登记时校验。
type ComponentPreferenceDeclaration struct {
	// BOOLEAN 为 true/false，ENUM 为 options[].value 之一。
	DefaultValue string                   `json:"defaultValue"`
	Description  *ComponentPreferenceText `json:"description,omitempty"`
	// Kailo 侧偏好键，2–4 段以 . 连接，不含组件名。
	Key   string                  `json:"key"`
	Label ComponentPreferenceText `json:"label"`
	// ENUM 时 2–12 项；BOOLEAN 时为空。
	Options          []ComponentPreferenceOption  `json:"options"`
	SettingsCategory ComponentPreferenceCategory  `json:"settingsCategory"`
	ValueType        ComponentPreferenceValueType `json:"valueType"`
}

type ComponentPreferenceText struct {
	En   string `json:"EN"`
	ZhCN string `json:"ZH_CN"`
}

type ComponentPreferenceOption struct {
	Label ComponentPreferenceText `json:"label"`
	Value string                  `json:"value"`
}

// Authorized ACTIVE binding's independent native page. Exact origin is release and
// deployment approved; no native credential or page body is returned.
type ApplicationNativePage struct {
	AllowedOrigins []string `json:"allowedOrigins"`
	BindingID      string   `json:"bindingId"`
	Origin         string   `json:"origin"`
	// DD-138: preference items the pinned APPROVED KAILO_EMBED release declares for Kailo
	// settings (07 §4.8.2); the host sends their values to this page only. Absent when none.
	Preferences          []ComponentPreferenceDeclaration `json:"preferences,omitempty"`
	ProjectionGeneration int64                            `json:"projectionGeneration"`
	URL                  string                           `json:"url"`
}

// Existing Resource references authorized for a HUMAN configuring a receiver binding's
// service read permission. No business body, credential or independent directory authority.
type ApplicationReadResourcePage struct {
	BindingID          string                           `json:"bindingId"`
	BindingVersion     int64                            `json:"bindingVersion"`
	Direction          ApplicationReadResourceDirection `json:"direction"`
	NextOffset         *int64                           `json:"nextOffset,omitempty"`
	Resources          []ApplicationReadResource        `json:"resources"`
	ServicePrincipalID string                           `json:"servicePrincipalId"`
	TenantID           string                           `json:"tenantId"`
	WorkspaceID        *string                          `json:"workspaceId,omitempty"`
}

type ApplicationReadResource struct {
	BindingID   string  `json:"bindingId"`
	NativeRef   string  `json:"nativeRef"`
	ResourceID  string  `json:"resourceId"`
	TypeKey     string  `json:"typeKey"`
	Version     int64   `json:"version"`
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// POST /api/v1/approvals/{workflowId}/decision 的请求体；approver 由 PlatformSession 决定。回应为
// ApprovalDecisionOutcome。
type ApprovalDecisionRequest struct {
	Decision ApprovalDecision `json:"decision"`
}

// GET /api/v1/approvals（待我审批）、GET /api/v1/approvals/initiated（本人发起且已有结果的审批，DD-125(5) Inbox
// Needs action 的第二来源）与 /api/v1/approvals/{workflowId} 的元素。状态只来自 Temporal history 的投影。
type ApprovalView struct {
	ActionExecutionID string                      `json:"actionExecutionId"`
	ActionKey         string                      `json:"actionKey"`
	AutomationStep    *AutomationApprovalStepView `json:"automationStep,omitempty"`
	// RFC3339，UTC
	ConsumeDeadline *string                  `json:"consumeDeadline,omitempty"`
	Decisions       []ApprovalDecisionRecord `json:"decisions"`
	// RFC3339，UTC
	ExpiresAt             string                             `json:"expiresAt"`
	InitiatorPrincipalID  string                             `json:"initiatorPrincipalId"`
	Observation           *ReasonCode                        `json:"observation,omitempty"`
	ProjectChannelRequest *ProjectChannelRequestApprovalView `json:"projectChannelRequest,omitempty"`
	Reason                *ReasonCode                        `json:"reason,omitempty"`
	RoleRequirements      []ApprovalRoleRequirement          `json:"roleRequirements"`
	Status                ApprovalStatus                     `json:"status"`
	TargetID              string                             `json:"targetId"`
	TargetType            string                             `json:"targetType"`
	WorkflowID            string                             `json:"workflowId"`
	WorkspaceID           *string                            `json:"workspaceId,omitempty"`
}

// 有权读取的审批所绑定不可变 AutomationVersion 中的步骤展示，不是另一审批或内容权威。
type AutomationApprovalStepView struct {
	ID             string  `json:"id"`
	Message        string  `json:"message"`
	Name           *string `json:"name,omitempty"`
	VersionAssetID string  `json:"versionAssetId"`
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

// DD-140：有权读取的审批所冻结的项目频道申请与提议的 Installation，供 owner 端以原版对话框呈现；不是另一审批或内容权威。
type ProjectChannelRequestApprovalView struct {
	InstallationResourceID string                `json:"installationResourceId"`
	Request                ProjectChannelRequest `json:"request"`
}

// DD-140：托管 Agent 平台原生工具 project_channel_request 的输入，与固定 Buzz
// projectChannelRequest.ts::parseProjectChannelRequest 同形同界；只是提议，绑定 workspace.create 且必须由
// Installation owner 批准。
type ProjectChannelRequest struct {
	Description *string `json:"description,omitempty"`
	// 该 Installation 的 ACTIVE ChannelAgentBinding 所在 Workspace（即其频道 ID）。
	HomeChannelID string              `json:"homeChannelId"`
	Name          string              `json:"name"`
	TemplateName  *string             `json:"templateName,omitempty"`
	TTLSeconds    *int64              `json:"ttlSeconds,omitempty"`
	Visibility    WorkspaceVisibility `json:"visibility"`
}

// ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
// §4）。
type ApprovalRoleRequirement struct {
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

type AutomationDetailView struct {
	Automation AutomationView `json:"automation"`
	// 当前 Resource manage；不是运行准入、额度允许或业务成功。
	CanManage bool `json:"canManage"`
	// 仅当前 ACTIVE HUMAN owner、Workspace membership 与 Resource execute，以及已启用固定版本允许显示手动运行；仍须原
	// automation.run 的准入、Delegation、额度及步骤审批。缺省关闭，不是业务成功。
	CanRun               *bool                      `json:"canRun,omitempty"`
	Delegations          []AutomationDelegationView `json:"delegations"`
	NextDelegationOffset *int64                     `json:"nextDelegationOffset,omitempty"`
	NextVersionOffset    *int64                     `json:"nextVersionOffset,omitempty"`
	Versions             []AutomationVersionView    `json:"versions"`
}

type AutomationView struct {
	// RFC3339，UTC，与既有管理查询时间字段一致。原 AutomationDefinition 写事务记录的真实创建时间；历史无证据时省略，不回填当前时间。
	CreatedAt                      *string         `json:"createdAt,omitempty"`
	DelegationID                   *string         `json:"delegationId,omitempty"`
	ExecutorInstallationResourceID string          `json:"executorInstallationResourceId"`
	OwnerPrincipalID               string          `json:"ownerPrincipalId"`
	PinnedVersionAssetID           *string         `json:"pinnedVersionAssetId,omitempty"`
	ResourceID                     string          `json:"resourceId"`
	ResourceState                  ResourceState   `json:"resourceState"`
	ResourceVersion                int64           `json:"resourceVersion"`
	State                          AutomationState `json:"state"`
	// RFC3339，UTC，与既有管理查询时间字段一致。原 AutomationDefinition/Version 实际写入时间；未观察到更新的历史行省略，不从
	// UUID、审计投递时间或浏览器时钟推测。
	UpdatedAt *string `json:"updatedAt,omitempty"`
	// 当前 WEBHOOK 密钥展示形式的末四位，仅用于辨认；密钥本身不可再取回（DD-116）。
	WebhookSecretHint *string `json:"webhookSecretHint,omitempty"`
	// WEBHOOK 触发的公开投递地址（部署配置的公开基址 + /hooks/{resourceId}）；只在密钥 ACTIVE 时给出（DD-116）。
	WebhookURL  *string `json:"webhookUrl,omitempty"`
	WorkspaceID string  `json:"workspaceId"`
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

// Core 自有 AutomationVersion 正文只在该 Asset fresh read 授权后返回；immutable Asset 三态复用既有版本契约。
type AutomationVersionView struct {
	AssetID              string                   `json:"assetId"`
	AssetVersion         int64                    `json:"assetVersion"`
	AutomationResourceID string                   `json:"automationResourceId"`
	ConfigHash           string                   `json:"configHash"`
	Content              AutomationVersionContent `json:"content"`
	Ordinal              int64                    `json:"ordinal"`
	OwnerPrincipalID     string                   `json:"ownerPrincipalId"`
	State                AgentVersionState        `json:"state"`
}

// 仅 automation.create / automation.publish_version：Core 自有版本内容；publish 产生新的不可变版本，不改写旧版本。
//
// REQ-23、DD-107、03 §7 的不可变自动化版本。Schedule 使用 Temporal 原生 interval/calendar，不含触发消息正文、provider
// 配置或凭据。
type AutomationVersionContent struct {
	Action         *AutomationVersionContentAction `json:"action,omitempty"`
	ApprovalPolicy *AutomationApprovalPolicyRef    `json:"approvalPolicy,omitempty"`
	// 固定 Buzz WorkflowDef 的可选说明；随原不可变版本和 config_hash 冻结。旧版本缺省不补写，空值与空白沿原 YAML 保留。
	Description *string `json:"description,omitempty"`
	// 2保留历史单副作用步骤；3为有序多消息。旧单 action 格式缺省保持原摘要。
	FormatVersion *int64 `json:"formatVersion,omitempty"`
	// 原工作流名称；随不可变版本冻结。旧版本缺省不补写、不重算历史摘要。
	Name         *string                `json:"name,omitempty"`
	ResultTarget AutomationResultTarget `json:"resultTarget"`
	//
	// 不可与旧action混用。格式3逐条发送消息并查证原生回执，支持消息间Delay及首副作用前一个原策略审批；UNKNOWN不推进。步骤审批不可同时声明版本级approvalPolicy。其余原动作仍在恢复范围。
	Steps   []AutomationStep                `json:"steps,omitempty"`
	Trigger AutomationVersionContentTrigger `json:"trigger"`
}

type AutomationVersionContentAction struct {
	Kind     AutomationVersionContentActionKind `json:"kind"`
	Template string                             `json:"template"`
}

// DD-107 同 Tenant automation.run 的显式已登记审批策略；版本精确冻结，不授予审批权限。
//
// request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
type AutomationApprovalPolicyRef struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
}

// 原 Buzz 有序步骤的已接通动作；步骤执行和延时仍归 Temporal。call_webhook 需要工作区管理权限（原
// requires_elevated_authority），保存与每次运行均重新核验。其它原动作不由此宣称已实现。
type AutomationStep struct {
	Action AutomationStepAction `json:"action"`
	// request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
	ApprovalPolicy *AutomationApprovalPolicyRef `json:"approvalPolicy,omitempty"`
	// 原请求体模板；不保存响应正文。
	Body     *string `json:"body,omitempty"`
	Duration *string `json:"duration,omitempty"`
	// 原 buzz-sdk build_reaction 的字符上限；目标仅为该次真实触发消息。
	Emoji *string `json:"emoji,omitempty"`
	// 原附加请求头，值可含原模板变量。凭据类请求头（Authorization、Cookie，以及名称含 token/secret/password/api-key/apikey
	// 者）不得明文保存，必须改用 secretHeaders。
	Headers map[string]string `json:"headers,omitempty"`
	ID      string            `json:"id"`
	// 固定 Buzz Step.if 的 evalexpr 条件，原 4096 UTF-8
	// 字节上限；为假时跳过该步骤（不失败）。只允许引用触发变量（trigger_text/author/channel_id/timestamp/emoji/message_id/is_reply），引用步骤输出在定义校验时以
	// CAPABILITY_BLOCKED 拒绝。Kailo 在 automation.run 准入时按已验签触发事件一次求值并把跳过集合冻结进该
	// ActionExecution；求值错误使该运行在任何副作用前失败。
	If      *string `json:"if,omitempty"`
	Message *string `json:"message,omitempty"`
	// 原 HTTP 方法，缺省 POST。
	Method *AutomationStepMethod `json:"method,omitempty"`
	Name   *string               `json:"name,omitempty"`
	// Kailo 治理：请求头密钥只以同 Tenant OpenBao SecretRef 保存，Core 仅在派发时读取 field=value
	// 注入请求，不写入版本、参数、审计或轨迹。名称不得与 headers 重复（不区分大小写）。
	SecretHeaders map[string]AutomationSecretRef `json:"secretHeaders,omitempty"`
	Text          *string                        `json:"text,omitempty"`
	// 固定 Buzz Step.timeout_secs。Delay 由原 AgentTask 的独立 Temporal Timer
	// 执行；send_message/add_reaction/set_channel_topic/call_webhook 由 Core
	// 自本运行首次到达该步骤起计时，截止前未派发则以 STEP_TIMEOUT 失败，已派发的结果走既有对账（不明记 UNKNOWN，不重放）；call_webhook
	// 的单次请求另受原 10 秒上限。缺省保持既有版本行为，不给历史补写默认值。
	TimeoutSecs *int64 `json:"timeout_secs,omitempty"`
	// 原频道主题；空字符串清空主题，不改变频道名称、描述或成员。
	Topic *string `json:"topic,omitempty"`
	// 固定 Buzz ActionDef::CallWebhook.url：公网 HTTPS
	// 端点。scheme、主机与端口必须是字面值（原模板变量只可出现在路径与查询中），不得含用户信息。Core 每次派发前按 DNS 结果拒绝非全局单播地址，并只经
	// AgentGateway 出站，不跟随重定向。
	URL *string `json:"url,omitempty"`
}

// 同 Tenant OpenBao KV v2 的精确版本引用（DD-70）；只是 locator，不含密钥正文。audience 必须是 Core 的服务身份。
type AutomationSecretRef struct {
	Audience string `json:"audience"`
	Locator  string `json:"locator"`
	Version  int64  `json:"version"`
}

type AutomationVersionContentTrigger struct {
	// 固定 Buzz TriggerDef::ReactionAdded.emoji；仅 REACTION_ADDED，可选，精确匹配原回应内容。
	Emoji *string `json:"emoji,omitempty"`
	// 固定 Buzz evalexpr 消息触发条件；CHANNEL_MESSAGE/MENTION/DIFF_POSTED/REACTION_ADDED（DIFF_POSTED
	// 为同频道 kind:40008，与消息触发同一组变量；REACTION_ADDED 另有 trigger_emoji 与被回应消息 trigger_message_id），原
	// 4096 UTF-8 字节上限。只匹配已验签且当前准入 HUMAN 事件；错误不匹配，不持久化触发正文。旧 textPrefix 若同时存在则均须满足。
	Filter             *string                 `json:"filter,omitempty"`
	Kind               AutomationTriggerKind   `json:"kind"`
	MentionPrincipalID *string                 `json:"mentionPrincipalId,omitempty"`
	ScheduleSpec       *AutomationScheduleSpec `json:"scheduleSpec,omitempty"`
	TextPrefix         *string                 `json:"textPrefix,omitempty"`
}

// Temporal 原生 Schedule：显式 interval 或 Buzz UTC cron，二者互斥。catchupWindow 不小于原生的 10 秒，Overlap
// 固定 SKIP。
type AutomationScheduleSpec struct {
	CatchupWindowSeconds int64 `json:"catchupWindowSeconds"`
	// 原 Buzz UTC cron：表单五字段，YAML 六字段包含秒、七字段增加年份；匹配由 Temporal 原生日历执行，不建立本地定时器。
	Cron         *string `json:"cron,omitempty"`
	EverySeconds *int64  `json:"everySeconds,omitempty"`
	// 旧 interval 缺省保持原格式及摘要；cron 必须显式 CRON。互斥及必需字段由领域消费者验证。
	Kind          *AutomationScheduleSpecKind `json:"kind,omitempty"`
	OffsetSeconds *int64                      `json:"offsetSeconds,omitempty"`
}

type AutomationPage struct {
	Automations               []AutomationView              `json:"automations"`
	AvailableApprovalPolicies []AutomationApprovalPolicyRef `json:"availableApprovalPolicies,omitempty"`
	// 本次 fresh Workspace create 与已暴露真实动作共同成立；写前仍重新核验。
	CanCreate  bool   `json:"canCreate"`
	NextOffset *int64 `json:"nextOffset,omitempty"`
}

// GET /api/v1/automations/{resource_id}/runs：可读 Automation 的本人运行历史。游标只作分页，不授予权限；每页重新核验。
type AutomationRunPage struct {
	AutomationResourceID string `json:"automationResourceId"`
	// 不透明 createdAt/id 稳定分页边界；缺省表示本次查询没有更多行。
	NextCursor *string             `json:"nextCursor,omitempty"`
	Runs       []AutomationRunView `json:"runs"`
}

// 本人发起的 automation.run；原 TaskProjection 与 UsageEvent 引用，不是新的运行权威。
type AutomationRunView struct {
	// 原 TaskProjection 步骤证据。旧投影缺省表示尚无步骤证据，不表示没有步骤或运行成功；不通过读取原 history 旁路回填。
	ExecutionTrace []AutomationStepTrace `json:"executionTrace,omitempty"`
	// 原 TaskProjection 进度；缺省不推测百分比或成功。
	Progress *string `json:"progress,omitempty"`
	// 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
	StepApprovalTask *TaskView `json:"stepApprovalTask,omitempty"`
	Task             TaskView  `json:"task"`
	// 同 Tenant/Workspace/Operation 的原 UsageEvent 引用；不代表已结算，空集合不代表零用量。
	UsageEventIDS []string `json:"usageEventIds"`
}

// 既有 TaskProjection 中固定 AutomationVersion 步骤的可核验证据；不是执行权威。不含正文、模板、密钥、任意输出或原始 Temporal
// history。时间仅来自原生事实，未知时省略。
type AutomationStepTrace struct {
	// 原生计时终态时间 RFC3339；不存在则省略，不由父任务完成推断。
	CompletedAt *string                   `json:"completedAt,omitempty"`
	Error       *ReasonCode               `json:"error,omitempty"`
	Output      AutomationStepTraceOutput `json:"output"`
	// 原生步骤开始时间 RFC3339；不存在则省略，不用投影更新时间替代。
	StartedAt *string              `json:"startedAt,omitempty"`
	Status    AutomationStepStatus `json:"status"`
	StepID    string               `json:"stepId"`
}

type AutomationStepTraceOutput struct {
	ActionExecutionID  *string `json:"actionExecutionId,omitempty"`
	ApprovalWorkflowID *string `json:"approvalWorkflowId,omitempty"`
	EventID            *string `json:"eventId,omitempty"`
	HistoryEventID     *int64  `json:"historyEventId,omitempty"`
	// call_webhook 实际收到的 HTTP 状态码；不保存响应正文或请求头。
	HTTPStatus *int64 `json:"httpStatus,omitempty"`
	// call_webhook 本次派发的稳定请求引用（随请求发送的 Kailo-Request-Id）。
	RequestID  *string `json:"requestId,omitempty"`
	RunID      *string `json:"runId,omitempty"`
	WorkflowID *string `json:"workflowId,omitempty"`
}

// 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
//
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

// GET /api/v1/operations 的有界回应（.design/14 §7）：本人发起或实际执行的操作，或调用方对其持有 audit permission 的
// Tenant/Workspace 范围内的操作，每次 fresh Check；新的在前。
type BusinessOperationPage struct {
	// 下一页首项之前的 ActionExecution ID；缺省即已读完
	NextCursor *string                 `json:"nextCursor,omitempty"`
	Operations []BusinessOperationView `json:"operations"`
}

// 业务操作时间线的一项：一个根 Governed Action（.design/14 §2、§7）。只含平台元数据与权威引用，不含参数、正文、prompt/response
// 或原生结果；用量只来自 Core UsageEvent outbox 的冻结 quantity 与投递事实，不是余额或账单。
type BusinessOperationView struct {
	ActionExecutionID string          `json:"actionExecutionId"`
	ActionKey         string          `json:"actionKey"`
	ActionVersion     int64           `json:"actionVersion"`
	ActorPrincipalID  string          `json:"actorPrincipalId"`
	ApprovalStatus    *ApprovalStatus `json:"approvalStatus,omitempty"`
	// RFC3339，UTC
	CreatedAt            string                 `json:"createdAt"`
	InitiatorPrincipalID string                 `json:"initiatorPrincipalId"`
	OperationID          string                 `json:"operationId"`
	Phase                BusinessOperationPhase `json:"phase"`
	Reason               *ReasonCode            `json:"reason,omitempty"`
	TargetID             string                 `json:"targetId"`
	// RFC3339，UTC；只在阶段为确定终态且终态时间来自 TaskProjection 或同 operation 的审计事实时给出
	TerminalAt   *string              `json:"terminalAt,omitempty"`
	Usage        []OperationUsageLine `json:"usage"`
	UsageState   OperationUsageState  `json:"usageState"`
	WorkflowKind *WorkflowKind        `json:"workflowKind,omitempty"`
	// 缺省即 Tenant 级动作
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

type OperationUsageLine struct {
	MeterKey string `json:"meterKey"`
	// 冻结 CloudEvent 的 quantity；status 非 COMMITTED 时不表示已入账
	Quantity int64                 `json:"quantity"`
	Status   UsageSettlementStatus `json:"status"`
}

// GET /api/v1/operations/summary：Tenant 或其中一个 Workspace 在区间内的业务聚合（.design/14 §7），调用方须对该范围持有
// audit permission，每次 fresh Check。等待审批、运行中、UNKNOWN、投影落后与撤销单列，不从分母中丢弃；平均耗时只取有确定终态时间的操作。
type BusinessOperationSummary struct {
	Actions []BusinessOperationActionSummary `json:"actions"`
	// RFC3339，含
	From     string                        `json:"from"`
	Phases   []BusinessOperationPhaseCount `json:"phases"`
	TenantID string                        `json:"tenantId"`
	// RFC3339，不含
	To          string                `json:"to"`
	Total       int64                 `json:"total"`
	UsageStates []OperationUsageCount `json:"usageStates"`
	WorkspaceID *string               `json:"workspaceId,omitempty"`
}

type BusinessOperationActionSummary struct {
	ActionKey string `json:"actionKey"`
	// timedTerminalCount 为 0 时缺省
	AverageTerminalSeconds *float64                      `json:"averageTerminalSeconds,omitempty"`
	Phases                 []BusinessOperationPhaseCount `json:"phases"`
	// 有确定终态时间、计入平均耗时的操作数
	TimedTerminalCount int64 `json:"timedTerminalCount"`
	Total              int64 `json:"total"`
}

// 一个阶段在所选范围与区间内的根业务操作数量。只列出现过的阶段，不补零。
type BusinessOperationPhaseCount struct {
	Count int64                  `json:"count"`
	Phase BusinessOperationPhase `json:"phase"`
}

// 一个用量结算状态在所选范围与区间内的根业务操作数量。只列出现过的状态，不补零。
type OperationUsageCount struct {
	Count int64               `json:"count"`
	State OperationUsageState `json:"state"`
}

type CapabilityContractPage struct {
	CanRegister bool                     `json:"canRegister"`
	Contracts   []CapabilityContractView `json:"contracts"`
	NextOffset  *int64                   `json:"nextOffset,omitempty"`
}

// 受权 Catalog 元数据，不复制 schema/测试向量或业务正文，不证明 release/binding 可用。
type CapabilityContractView struct {
	// PLATFORM_SEED 的部署引导证据；不冒充人为登记或批准。
	BootstrapActionExecutionID    *string                  `json:"bootstrapActionExecutionId,omitempty"`
	CanApprove                    bool                     `json:"canApprove"`
	CanDeprecate                  bool                     `json:"canDeprecate"`
	CategoryKey                   string                   `json:"categoryKey"`
	ConformanceSuiteDigest        string                   `json:"conformanceSuiteDigest"`
	ContractVersion               int64                    `json:"contractVersion"`
	RegisteredByActionExecutionID *string                  `json:"registeredByActionExecutionId,omitempty"`
	SchemaSetDigest               string                   `json:"schemaSetDigest"`
	Status                        CapabilityContractStatus `json:"status"`
}

// PUT /api/v1/user-state/channel-templates/{templateId} 的请求体（DD-125(4)、03
// CollaborationUserState.channel_templates）：新建或替换本人的原频道模板；templateId 由客户端以 UUID 生成。字段沿原
// ChannelTemplateRecord；agentResourceIds 只引用同 Tenant 的 AgentDefinition Resource（≙ 原
// persona），原 runtime/model/backend 与 team 条目不适用。canvasTemplate 不超过 64 KiB，每人至多 200
// 个模板。模板不授予任何权限：应用时仍逐项提交 workspace.create、workspace.canvas.set 与
// agent.installation.create。DELETE 同一路径以 UserStateVersion 为请求体。version 不符即 409。
type ChannelTemplateRequest struct {
	AgentResourceIDS []string                          `json:"agentResourceIds"`
	CanvasTemplate   *string                           `json:"canvasTemplate,omitempty"`
	ChannelType      WorkspaceChannelCreateChannelType `json:"channelType"`
	Description      *string                           `json:"description,omitempty"`
	Name             string                            `json:"name"`
	Version          int64                             `json:"version"`
	Visibility       WorkspaceVisibility               `json:"visibility"`
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
	// 仅成功 validate_binding：严格解析既有 AdapterBindingObservation 并核对请求的 SecretRef 后，仅去除实际
	// secretReads.requestId 的固定字段摘要。完整实际响应仍由 responseDigest 固定；不代替绑定激活的 OpenBao 审计核验。
	BindingDigest *string `json:"bindingDigest,omitempty"`
	// DD-124：仅当冻结步骤声明 captures 且实际应答为带原生状态的 SUCCEEDED 时，从 typed ContentReference 或登记的
	// generatedRefs 输出字段取出的值。
	Captures                  []ComponentConformanceCaptureValue  `json:"captures,omitempty"`
	NativeReceiverObservation *ComponentNativeReceiverObservation `json:"nativeReceiverObservation,omitempty"`
	RequestDigest             string                              `json:"requestDigest"`
	ResponseDigest            string                              `json:"responseDigest"`
	ResultDigest              *string                             `json:"resultDigest,omitempty"`
}

// DD-124(2): one captured value of the current suite run. Core derives it only from the
// candidate's actual wire response or typed ContentReference; it is kept only in that
// step's observation evidence and re-checked when the report is recorded. Never a fixture,
// seed or administrator value.
type ComponentConformanceCaptureValue struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// 原生 SyncLog 的真实批次与同批多个原 SERVICE read Operation 元数据；completed 不能单独证明通过，Core 仍核对每个
// SOURCE/RECEIVER 回执及冻结请求。DD-124(4)：请求省略 importConfigRef 时，本观察是隔离 Core 真实 APPLICATION
// 接收方动作的原生执行（nativeBatchId 为其原生任务标识，nativeStatus 为原生状态原值），每个 read Operation 锚定该动作而无
// nativeBatch；RECEIVER case 中不读取来源的步骤（如 read/export/search/delete）可无 read Operation，读取由整个
// case 承载。执行、operation 与批次标识须为隔离 Core 本次生成且不在计划或 fixture 中。
type ComponentNativeReceiverObservation struct {
	Completed      bool                             `json:"completed"`
	FinishedAt     *string                          `json:"finishedAt,omitempty"`
	NativeBatchID  string                           `json:"nativeBatchId"`
	NativeStatus   string                           `json:"nativeStatus"`
	ReadOperations []ComponentNativeReadObservation `json:"readOperations"`
	Request        ComponentNativeReceiverRequest   `json:"request"`
	StartedAt      string                           `json:"startedAt"`
}

type ComponentNativeReadObservation struct {
	ActionExecutionID string `json:"actionExecutionId"`
	// 原生批次读取必填且等于 readRequest.nativeBatch；锚定 APPLICATION 接收方动作的读取必须省略（readRequest 携带
	// receiverActionExecutionId）。
	NativeBatch               *AdapterReadGrantRequestNativeBatch `json:"nativeBatch,omitempty"`
	OperationID               string                              `json:"operationId"`
	ReadRequest               AdapterReadGrantRequest             `json:"readRequest"`
	ReceiverActionExecutionID string                              `json:"receiverActionExecutionId"`
	ReceiverGeneration        int64                               `json:"receiverGeneration"`
	ReceiverReceipt           AdapterReadReceipt                  `json:"receiverReceipt"`
	SourceBindingID           string                              `json:"sourceBindingId"`
	SourceReceipt             AdapterReadReceipt                  `json:"sourceReceipt"`
	SourceResourceID          string                              `json:"sourceResourceId"`
}

// Native SERVICE importer provenance instead of a HUMAN/AGENT execution. Core requires
// exactly one mode, freezes these references, and resolves the receiver from its
// authenticated binding.
//
// 原生批次读取必填且等于 readRequest.nativeBatch；锚定 APPLICATION 接收方动作的读取必须省略（readRequest 携带
// receiverActionExecutionId）。
type AdapterReadGrantRequestNativeBatch struct {
	ActionKey          string `json:"actionKey"`
	ActionVersion      int64  `json:"actionVersion"`
	BatchID            string `json:"batchId"`
	ImportConfigRef    string `json:"importConfigRef"`
	ReceiverResourceID string `json:"receiverResourceId"`
}

// DD-89: receiver binding authenticates as its own ServicePrincipal for one source-resource
// read batch. Input is checked against the approved source action schema; Core retains its
// digest, not the returned business content.
type AdapterReadGrantRequest struct {
	ActionKey      string `json:"actionKey"`
	ActionVersion  int64  `json:"actionVersion"`
	IdempotencyKey string `json:"idempotencyKey"`
	InputJSON      string `json:"inputJson"`
	// Native SERVICE importer provenance instead of a HUMAN/AGENT execution. Core requires
	// exactly one mode, freezes these references, and resolves the receiver from its
	// authenticated binding.
	NativeBatch *AdapterReadGrantRequestNativeBatch `json:"nativeBatch,omitempty"`
	// 只观察已存在的同一原生 SOURCE AE；必须匹配原 key/nativeBatch（或锚定的 receiverActionExecutionId 与
	// receiverArgumentsJson）/输入，查无或未就绪不得创建、续发 grant 或进入新准入。
	ObserveActionExecutionID  *string `json:"observeActionExecutionId,omitempty"`
	ReceiverActionExecutionID *string `json:"receiverActionExecutionId,omitempty"`
	ReceiverArgumentsJSON     *string `json:"receiverArgumentsJson,omitempty"`
	ReceiverBindingID         string  `json:"receiverBindingId"`
	SourceResourceID          string  `json:"sourceResourceId"`
}

// 07§8A 隔离原生接收方验证的冻结请求。原生生成真实 batch ID；同键重入与观察必须保持全部字段，不是生产 execute 输入或通用 HTTP
// 脚本。DD-124(4)：importConfigRef 存在时为 NATIVE_MANAGED 原生批次，由候选实现原生发起；省略时为隔离部署内的 APPLICATION
// 接收方动作（如经 READ_EDGE 的 ingest），由平台维护的隔离部署以真实 APPLICATION ActionExecution
// 准入与派发，原能力输入只由已登记向量与 fixture 前置值冻结。
type ComponentNativeReceiverRequest struct {
	BindingID string `json:"bindingId"`
	// 受控夹具固定的 RFC3339 首派期限，须受原生 SyncLog 保留策略约束；过期仍可观察同一批次，不得续期重派。
	ExpiresAt       string  `json:"expiresAt"`
	Generation      int64   `json:"generation"`
	IdempotencyKey  string  `json:"idempotencyKey"`
	ImportConfigRef *string `json:"importConfigRef,omitempty"`
}

// 受信Worker实际HTTP响应的瞬时核验输入。正文仅在Activity与Core请求内存中存在，不得进入Temporal历史、报告、日志或数据库；不是用户上传的通过声明。
type ComponentConformanceWireObservation struct {
	HTTPStatus   int64                     `json:"httpStatus"`
	Probe        ComponentConformanceProbe `json:"probe"`
	ResponseJSON string                    `json:"responseJson"`
}

// 原 ComponentTaskWorkflow 的单个线协议 Activity 输入。步骤来自 Core 冻结计划；调度、尝试次数与 UNKNOWN 对账只由原 Temporal
// history 承接，不建立另一执行账本。
type ComponentConformanceProbe struct {
	// DD-124：本步 CAPTURE 绑定所需的值，只取同 case 更早步骤已记录观察中的 captures；Core 代入后签名，登记时再按报告重算，不能以 fixture
	// 或管理员值替代。
	Captures         []ComponentConformanceCaptureValue `json:"captures,omitempty"`
	ContentReference *ContentReference                  `json:"contentReference,omitempty"`
	Plan             ComponentConformancePlan           `json:"plan"`
	// 只查询同一步冻结幂等键；不再发送原 execute/CREATE。
	Reconcile *bool `json:"reconcile,omitempty"`
	StepIndex int64 `json:"stepIndex"`
}

// 受信 Worker 从 Core 取得的隔离执行输入。不是用户上传的通过声明；只含冻结引用与平台解释的数据，不含候选地址或凭据。顺序与全部内容进入 planDigest。
type ComponentConformancePlan struct {
	ActionExecutionID  string                                 `json:"actionExecutionId"`
	ArtifactDigest     string                                 `json:"artifactDigest"`
	ComponentReleaseID string                                 `json:"componentReleaseId"`
	ConnectorKind      *ComponentConformancePlanConnectorKind `json:"connectorKind,omitempty"`
	ContractDigests    []string                               `json:"contractDigests"`
	// 独立隔离身份投递的完整规范化摘要，不含私钥或token，不是生产policy。
	IdentityDigest string `json:"identityDigest"`
	OperationID    string `json:"operationId"`
	PlanDigest     string `json:"planDigest"`
	// DD-124(4)：仅含接收方向步骤的计划。Core 冻结时从已核验的隔离身份复制；登记与批准以它核对当前 Core 构建与来源类别已 APPROVED 的 release。
	ReceiverEnvironment *ComponentConformanceReceiverEnvironment `json:"receiverEnvironment,omitempty"`
	// Core 冻结时为空；原 ComponentTaskWorkflow 启动后写入真实 Temporal run UUID。报告的 runId 仍必须为 UUID，Core 以
	// Describe 与同 workflow 的当前 TaskProjection 核对。
	RunID       string                     `json:"runId"`
	Steps       []ComponentConformanceStep `json:"steps"`
	SuiteDigest string                     `json:"suiteDigest"`
	WorkflowID  string                     `json:"workflowId"`
}

// DD-124(4)：仅含接收方向步骤的计划。Core 冻结时从已核验的隔离身份复制；登记与批准以它核对当前 Core 构建与来源类别已 APPROVED 的 release。
//
// DD-124(4), 07 §8A: identity of the isolated receiver deployment a plan with
// receiver_start/receiver_observe steps observes. isolatedCoreBuildId is the
// PlatformBuildInfo CORE buildId of the isolated Core/Worker and must equal the current
// production Core build. sourceReleaseId with its artifact and manifest digests names the
// production Catalog release, APPROVED and declaring read_edge SOURCE or BOTH, that the
// isolated deployment runs as the source. It is delivered with the isolated identity, fixed
// by the plan identity digest and copied into the plan; it is not evidence that any step
// passed.
//
// DD-124(4)：计划含 receiver_start/receiver_observe 步骤时必填；固定隔离接收方部署的 Core 构建与来源
// release，随身份摘要进入原计划。
type ComponentConformanceReceiverEnvironment struct {
	IsolatedCoreBuildID  string `json:"isolatedCoreBuildId"`
	SourceArtifactDigest string `json:"sourceArtifactDigest"`
	SourceManifestDigest string `json:"sourceManifestDigest"`
	SourceReleaseID      string `json:"sourceReleaseId"`
}

type ComponentConformanceStep struct {
	// DD-124：仅 V2 契约步骤。Core 冻结时已代入 PRECONDITION 的 fixture 值，这里只保留 CAPTURE 的代入位置声明（不含值）；运行时 Core
	// 在 ActionToken 签名前代入请求、在比对前代入期望。权限拒绝重放保留同一 INPUT 声明。接收方向步骤只保留本步自身捕获的 INPUT 声明：请求不被代入，Core
	// 以它们比对隔离 Core 实际产生的接收方准入。
	Bindings []CapabilityVectorBinding `json:"bindings,omitempty"`
	// DD-124：仅 V2 契约步骤。本步 SUCCEEDED 且原生终态证据完整时由 Core 从实际应答的封闭槽位取值，写入本步观察证据。
	Captures []CapabilityVectorCapture `json:"captures,omitempty"`
	CaseKey  string                    `json:"caseKey"`
	// 只由 Core 从该 release implements 的 ACTIVE 契约步骤固定。存在时 expectedResponseJson 为该能力的业务结果，不是
	// native 任务元数据。
	ContractKey *string `json:"contractKey,omitempty"`
	// Adapter 为实际 HTTP 状态；MCP 原生结果固定 0，不以伪造 HTTP 状态证明协议成功。
	ExpectedHTTPStatus    int64                                          `json:"expectedHttpStatus"`
	ExpectedMCPResultKind *ComponentConformanceStepExpectedMCPResultKind `json:"expectedMcpResultKind,omitempty"`
	ExpectedResponseJSON  string                                         `json:"expectedResponseJson"`
	IdempotencyKey        string                                         `json:"idempotencyKey"`
	// 仅接收方向步骤（V1 的 NATIVE_INTERNAL/NATIVE 能力步骤，或 V2 RECEIVER case 的步骤），由 Core
	// 保留已代入前置值的原能力向量输入；SOURCE AE 与 batch 必须以同批真实入站观察替换，不是预造授权。
	NativeReceiverInputJSON *string                       `json:"nativeReceiverInputJson,omitempty"`
	Operation               ComponentConformanceOperation `json:"operation"`
	ReferenceAssetID        *string                       `json:"referenceAssetId,omitempty"`
	ReferenceFromStepKey    *string                       `json:"referenceFromStepKey,omitempty"`
	ReferenceResourceID     *string                       `json:"referenceResourceId,omitempty"`
	RequestJSON             string                        `json:"requestJson"`
	StepKey                 string                        `json:"stepKey"`
}

// DD-124(2): one substitution position of a V2 step. pointer is an RFC 6901 JSON Pointer
// into the step input (INPUT) or expected output (EXPECTED); the literal there must be
// exactly the reserved placeholder {{SOURCE:key}}. INPUT may bind PRECONDITION or CAPTURE;
// EXPECTED may bind CAPTURE or a PRECONDITION already sent as INPUT in this case. In a
// RECEIVER case INPUT may also bind the step's own captures: Core compares that input with
// the admission the isolated Core actually produced whenever the step's evidence has reads.
// The plan digest fixes the declaration, never the value.
type CapabilityVectorBinding struct {
	Key     string                        `json:"key"`
	Pointer string                        `json:"pointer"`
	Side    CapabilityVectorSide          `json:"side"`
	Source  CapabilityVectorBindingSource `json:"source"`
}

// DD-124(1)(2): a value this step's actual SUCCEEDED observation produces for later steps
// of the same case. key is unique in the case and must be consumed at least once. pointer
// is present only for GENERATED_REF and must equal an EXPECTED generatedRefs entry of the
// step's contract key; in a RECEIVER case it equals an INPUT entry and reads the admission
// the isolated Core produced. ACTION_EXECUTION_ID and OPERATION_ID exist only in RECEIVER
// cases; a step of a RECEIVER case takes them and CONTENT_REFERENCE_* from its own read and
// the receiver's read_receipt of that admission, so a capturing step's evidence has reads.
type CapabilityVectorCapture struct {
	Key     string                      `json:"key"`
	Pointer *string                     `json:"pointer,omitempty"`
	Slot    CapabilityVectorCaptureSlot `json:"slot"`
}

// Read-only member directory snapshot for an embedded component (.design/07 §4.7.4,
// DD-133(4)): every ACTIVE HUMAN member in the native page entry binding's scope with Kailo
// display name, avatar URL, Tenant role and ACTIVE Workspace memberships. A full snapshot,
// never paged: a person absent from it is removed from the component organisation.
// directoryVersion is the SHA-256 (hex) of the canonical JSON of every other field. No
// email, Buzz key, session or credential.
type ComponentMemberDirectory struct {
	BindingID string `json:"bindingId"`
	// Lowercase hex SHA-256 of the canonical JSON of this snapshot without directoryVersion;
	// unchanged content keeps the same version.
	DirectoryVersion string                     `json:"directoryVersion"`
	Members          []ComponentDirectoryMember `json:"members"`
	Tenant           ComponentDirectoryTenant   `json:"tenant"`
	// Every ACTIVE Workspace in the binding scope (only the binding's own Workspace when it has
	// one).
	Workspaces []ComponentDirectoryWorkspace `json:"workspaces"`
}

type ComponentDirectoryMember struct {
	// Kailo display name: the member's SERVER HUMAN kind:0 display_name (else name), else the
	// HumanIdentity display name.
	DisplayName string `json:"displayName"`
	// One entry per ACTIVE external identity; the component keys its account on issuer +
	// subject.
	Identities  []ComponentDirectoryIdentity   `json:"identities"`
	PrincipalID string                         `json:"principalId"`
	TenantRole  ComponentDirectoryRole         `json:"tenantRole"`
	Workspaces  []ComponentDirectoryMembership `json:"workspaces"`
}

type ComponentDirectoryIdentity struct {
	Issuer string `json:"issuer"`
	// <PUBLIC_ORIGIN>/api/v1/identity/avatars/<subject>, the same value as the IdP picture
	// claim.
	Picture string `json:"picture"`
	Subject string `json:"subject"`
}

type ComponentDirectoryMembership struct {
	Role        ComponentDirectoryRole `json:"role"`
	WorkspaceID string                 `json:"workspaceId"`
}

type ComponentDirectoryTenant struct {
	Name     string `json:"name"`
	TenantID string `json:"tenantId"`
}

type ComponentDirectoryWorkspace struct {
	Name        string `json:"name"`
	WorkspaceID string `json:"workspaceId"`
}

// DD-138(4)、07 §4.8.3：组件以其成员目录 client 的 client-credentials 令牌向 Core 服务监听面 POST
// /service/v1/component-notifications/bindings/{bindingId}/notifications 投递的一条通知。不建立
// ActionExecution、不授予权限；未知字段整体拒绝。
type ComponentNotificationDelivery struct {
	// 触发者；须在同一目录范围内且不是接收人。
	Actor    *ComponentPersonRef           `json:"actor,omitempty"`
	Category ComponentNotificationCategory `json:"category"`
	// 1–128 个字母、数字、. _ : -，在该 binding 内唯一；同键同内容返回首次结果，同键异内容 409。
	IdempotencyKey string `json:"idempotencyKey"`
	// 事件发生时刻（RFC3339），不晚于 Core 当前时刻 5 分钟；缺省取接收时刻。
	OccurredAt *string `json:"occurredAt,omitempty"`
	// 组件页面 origin 内的相对路径：1–1024 字符，以单个 / 开头，无反斜杠、空白与控制字符，无凭据类查询参数。
	Path      string             `json:"path"`
	Recipient ComponentPersonRef `json:"recipient"`
	// 每种语言 1–280 字符，不含控制字符。
	Summary *ComponentText `json:"summary,omitempty"`
	// 每种语言 1–120 字符，不含控制字符。
	Title ComponentText `json:"title"`
}

// 触发者；须在同一目录范围内且不是接收人。
//
// 组件以 OIDC issuer + subject 指称 Kailo 成员（与 07 §4.7.4 成员目录 identities[] 同值）；Core 只在该 binding
// 当前目录范围内解析。
//
// count meter 必填、file_storage_bytes 不得出现；须在该 binding 当前目录范围内。
type ComponentPersonRef struct {
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
}

// 每种语言 1–280 字符，不含控制字符。
//
// 组件向 Kailo 提供的中英文文案（键恰为 ZH_CN、EN）。长度与字符规则由 Core 按使用处校验。
//
// 每种语言 1–120 字符，不含控制字符。
type ComponentText struct {
	En   string `json:"EN"`
	ZhCN string `json:"ZH_CN"`
}

// DD-138(4)：GET /api/v1/inbox/component-notifications 的一页，按 receivedAt 倒序；nextCursor
// 缺省表示没有更多。
type ComponentNotificationPage struct {
	Items      []ComponentNotificationView `json:"items"`
	NextCursor *string                     `json:"nextCursor,omitempty"`
	// 当前可见范围内本人未读条目总数（不受分页影响）。
	UnreadCount int64 `json:"unreadCount"`
}

// DD-138(4)、03 ComponentNotification：当前会话 Principal
// 收件箱中的一条组件通知。只含呈现类别，不含组件名、component_type_key 或 binding 配置；bindingId 只用于在 Kailo
// 内容区打开该原生页面入口。
type ComponentNotificationView struct {
	ActorDisplayName *string `json:"actorDisplayName,omitempty"`
	// 07 §4.7.3 Tenant 头像地址；缺省时客户端显示首字母。
	ActorPicture       *string                       `json:"actorPicture,omitempty"`
	ActorPrincipalID   *string                       `json:"actorPrincipalId,omitempty"`
	BindingID          string                        `json:"bindingId"`
	Category           ComponentNotificationCategory `json:"category"`
	NativePageCategory *NativePageCategory           `json:"nativePageCategory,omitempty"`
	NotificationID     string                        `json:"notificationId"`
	OccurredAt         string                        `json:"occurredAt"`
	Path               string                        `json:"path"`
	ReadAt             *string                       `json:"readAt,omitempty"`
	ReceivedAt         string                        `json:"receivedAt"`
	Summary            *ComponentText                `json:"summary,omitempty"`
	Title              ComponentText                 `json:"title"`
	WorkspaceID        *string                       `json:"workspaceId,omitempty"`
}

// DD-138(4)：POST /api/v1/inbox/component-notifications/read。接收人把本人的条目标记为已读（个人状态，不建立
// ActionExecution）；1–100 个 ID，非本人或不可见的 ID 被忽略。
type ComponentNotificationReadRequest struct {
	NotificationIDS []string `json:"notificationIds"`
}

// DD-138(4)：投递回执。新建 201、同键同内容重复 200（duplicate=true）。
type ComponentNotificationReceipt struct {
	Duplicate      bool   `json:"duplicate"`
	NotificationID string `json:"notificationId"`
}

// 原受信Worker在原审批后的COMPONENT_RELEASE Activity报告实际自身能力。Core自行读取自身与当前Web事实，并重新核验原release套件和审批。
type ComponentReleaseApprovalReport struct {
	RunID       string                         `json:"runId"`
	Target      ComponentReleaseApprovalTarget `json:"target"`
	WorkerBuild PlatformBuildInfo              `json:"workerBuild"`
}

// 原ComponentTaskWorkflow的组件批准目标，只引用原准入与不可变release，不携带用户声明的兼容结论。
type ComponentReleaseApprovalTarget struct {
	ActionExecutionID  string `json:"actionExecutionId"`
	ComponentReleaseID string `json:"componentReleaseId"`
	WorkflowID         string `json:"workflowId"`
}

// 设计03的当前已部署主体能力事实，由原受信服务/当前Web产物观察产生，不接受管理表单声明。
type PlatformBuildInfo struct {
	AdapterProtocolVersions []string                                `json:"adapterProtocolVersions"`
	BuildID                 string                                  `json:"buildId"`
	ConnectorKinds          []string                                `json:"connectorKinds,omitempty"`
	DriverRegistryKeys      []string                                `json:"driverRegistryKeys"`
	HostAPIVersion          string                                  `json:"hostApiVersion"`
	MCPProtocolVersions     []string                                `json:"mcpProtocolVersions,omitempty"`
	PlatformPortKeys        []PlatformBuildInfoPlatformPortKeysItem `json:"platformPortKeys"`
	ReportedAt              string                                  `json:"reportedAt"`
	Subject                 PlatformBuildInfoSubject                `json:"subject"`
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

// DD-138(5)、07 §4.8.4：组件内容搜索结果。每项已解析到可在 Kailo 内容区打开的原生页面入口（bindingId 为该呈现类别生效的入口，不是 adapter
// binding）；sources 列出每个呈现类别来源的状态。
type ComponentSearchPage struct {
	Results []ComponentSearchResult `json:"results"`
	Sources []ComponentSearchSource `json:"sources"`
}

type ComponentSearchResult struct {
	BindingID          string                    `json:"bindingId"`
	Kind               ComponentSearchResultKind `json:"kind"`
	NativePageCategory NativePageCategory        `json:"nativePageCategory"`
	Path               string                    `json:"path"`
	Summary            *string                   `json:"summary,omitempty"`
	Title              string                    `json:"title"`
	UpdatedAt          *string                   `json:"updatedAt,omitempty"`
}

type ComponentSearchSource struct {
	NativePageCategory NativePageCategory         `json:"nativePageCategory"`
	State              ComponentSearchSourceState `json:"state"`
}

// DD-138(5)、07 §4.8.4：POST /api/v1/search/components。q 去首尾空白后 1–200 字符；limit 为每个来源的上限
// 1–20（缺省 8）；locale 为 ZH_CN 或 EN（缺省 ZH_CN）。
type ComponentSearchQuery struct {
	Limit  *int64  `json:"limit,omitempty"`
	Locale *string `json:"locale,omitempty"`
	Q      string  `json:"q"`
}

// DD-163(3)：额度准入结论。OpenMeter 不可读时 Core 以 503 回应而不给出结论，组件不得放行。组件可把 ALLOWED 缓存至多 60 秒。
type ComponentUsageAdmission struct {
	Decision ComponentUsageDecision `json:"decision"`
	// 该额度项当前周期的结束时刻（RFC3339）；没有 entitlement 时不给出。
	PeriodResetAt *string `json:"periodResetAt,omitempty"`
}

// DD-163、07 §4.8.8：组件在动作开始前向 POST
// /service/v1/component-usage/bindings/{bindingId}/admission 询问额度。身份、前提与 meter
// 类别规则同上报；未知字段整体拒绝。
type ComponentUsageAdmissionRequest struct {
	// count meter 必填、file_storage_bytes 不得出现；须在该 binding 当前目录范围内。
	Member   *ComponentPersonRef `json:"member,omitempty"`
	MeterKey ComponentUsageMeter `json:"meterKey"`
}

// DD-163(4)：GET /api/v1/usage/components?from=&to=，Tenant 在区间内按组件（binding）拆分的 committed
// usage。调用方须持有 Tenant audit permission，每次 fresh Check。数值直接读 OpenMeter（group_by
// component_binding_id），不复制成账本；缺失事实以确定状态表达。
type ComponentUsagePage struct {
	// RFC3339，含
	From   string                `json:"from"`
	Meters []ComponentMeterUsage `json:"meters"`
	// RFC3339，不含
	To string `json:"to"`
}

type ComponentMeterUsage struct {
	// 原生 meter 的聚合方式原文
	Aggregation *string                 `json:"aggregation,omitempty"`
	Bindings    []ComponentBindingUsage `json:"bindings"`
	// 随 Core 固定的组件 meter 键
	MeterKey string          `json:"meterKey"`
	State    MeterUsageState `json:"state"`
}

type ComponentBindingUsage struct {
	BindingID          string              `json:"bindingId"`
	NativePageCategory *NativePageCategory `json:"nativePageCategory,omitempty"`
	// OpenMeter 返回的十进制原文
	Quantity string `json:"quantity"`
	// Workspace 级 binding 的 Workspace；Tenant 级 binding 不给出
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// DD-163：上报回执。新建 201、同键同内容重复 200（duplicate=true）。usageEventId 是 Core UsageEvent 与 OpenMeter
// event 的同一 ID；回执不表示 OpenMeter 已存储。
type ComponentUsageReceipt struct {
	Duplicate    bool   `json:"duplicate"`
	UsageEventID string `json:"usageEventId"`
}

// DD-163、07 §4.8.8：组件以其成员目录 client 的 client-credentials 令牌向 Core 服务监听面 POST
// /service/v1/component-usage/bindings/{bindingId}/reports 上报的一条已发生用量。Core 写
// COMPONENT_REPORT UsageEvent；不建立 ActionExecution、不授予权限；未知字段整体拒绝。
type ComponentUsageReport struct {
	// 1–128 个字母、数字、. _ : -，在该 binding 内唯一；同键同内容返回首次结果，同键异内容 409。
	IdempotencyKey string `json:"idempotencyKey"`
	// count meter 必填、file_storage_bytes 不得出现；须在该 binding 当前目录范围内。
	Member   *ComponentPersonRef `json:"member,omitempty"`
	MeterKey ComponentUsageMeter `json:"meterKey"`
	// RFC3339，不晚于 Core 当前时刻 5 分钟，不早于 7 天前。
	OccurredAt string `json:"occurredAt"`
	// 非负整数；count meter 恰为 1，file_storage_bytes 为字节数且不超过 10^15。
	Quantity int64 `json:"quantity"`
}

type ConversationPage struct {
	Items      []ConversationView `json:"items"`
	NextCursor *string            `json:"nextCursor,omitempty"`
}

// 已认证参与者可见的原 Relay 私聊引用，不包含消息正文。
type ConversationView struct {
	ChannelID               string                `json:"channelId"`
	ID                      string                `json:"id"`
	OperationID             string                `json:"operationId"`
	ParticipantPrincipalIDS []string              `json:"participantPrincipalIds"`
	State                   ConversationViewState `json:"state"`
	Version                 int64                 `json:"version"`
}

type ConversationParticipantPage struct {
	Items           []ConversationParticipant `json:"items"`
	MaxParticipants int64                     `json:"maxParticipants"`
	NextCursor      *string                   `json:"nextCursor,omitempty"`
}

// 同租户当前有效 HUMAN 及其已投影真实身份公钥，不伪造用户资料。
type ConversationParticipant struct {
	DisplayName string `json:"displayName"`
	// DD-139：同 Tenant 头像地址 <PUBLIC_ORIGIN>/api/v1/identity/avatars/<subject>（07 §4.7.3），只对有
	// ACTIVE 外部身份的成员给出；只是地址，不含图片或资料正文，读取仍按该路由的 Tenant 准入。
	Picture     *string  `json:"picture,omitempty"`
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

type DiscoverableWorkspacePage struct {
	Items      []DiscoverableWorkspace `json:"items"`
	NextCursor *string                 `json:"nextCursor,omitempty"`
}

type DiscoverableWorkspace struct {
	// 与 updateActionKey 同时给出且为 true 时，Channel 是被原生 reaper 按 TTL 到期归档的，界面只提供以 workspace.update 的
	// reopen 解档；省略或 false 时 updateActionKey 只用于修改名称、描述、TTL 与可见性。
	CanReopen *bool          `json:"canReopen,omitempty"`
	Channel   WebChannelView `json:"channel"`
	CreatedAt string         `json:"createdAt"`
	ID        string         `json:"id"`
	// 已通过当前 HUMAN Workspace 准入，而非只表示 join 已受理。
	IsMember      bool                                `json:"isMember"`
	JoinActionKey *DiscoverableWorkspaceJoinActionKey `json:"joinActionKey,omitempty"`
	// 当前 Principal 持有 ACTIVE WorkspaceMembership、fresh Workspace discover
	// 检查通过且目录已开放时给出；主体固定为本人。省略即不显示退出入口。
	LeaveActionKey  *DiscoverableWorkspaceLeaveActionKey `json:"leaveActionKey,omitempty"`
	MemberCount     int64                                `json:"memberCount"`
	MembershipState *WorkspaceMembershipState            `json:"membershipState,omitempty"`
	// 当前 Principal 经 fresh Workspace manage 检查、目录已开放、Workspace ACTIVE 且没有未终结的 workspace.update
	// 时给出；Channel 已归档时仅在 canReopen 为 true 时给出。省略即不显示编辑入口，提交仍重新准入。
	UpdateActionKey *DiscoverableWorkspaceUpdateActionKey `json:"updateActionKey,omitempty"`
	Visibility      WorkspaceVisibility                   `json:"visibility"`
}

// Web 经 BFF 以本人身份读取已准入 Workspace 对应的原 Relay 39000 元数据；类型来自原生签名证据，不从消息列表推断，不另存业务正文。
type WebChannelView struct {
	Archived    bool                              `json:"archived"`
	ChannelID   string                            `json:"channelId"`
	ChannelType WorkspaceChannelCreateChannelType `json:"channelType"`
	Description *string                           `json:"description,omitempty"`
	Name        string                            `json:"name"`
	// 原 39000 topic 标签；Relay 对空主题省略该标签，缺省即无主题。
	Topic       *string `json:"topic,omitempty"`
	TTLDeadline *string `json:"ttlDeadline,omitempty"`
	TTLSeconds  *int64  `json:"ttlSeconds,omitempty"`
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

// DD-42、06 §7.1：源 Tenant 的 ExportPackage Asset。只给当前对该 Asset 有 read 的 HUMAN；READY 后才有
// digest、大小与下载路径。字节只经下载路由返回，不进入本视图、审计或 Workflow 历史。
type ExportPackageView struct {
	ActionExecutionID string  `json:"actionExecutionId"`
	ByteSize          *int64  `json:"byteSize,omitempty"`
	ContentDigest     *string `json:"contentDigest,omitempty"`
	DownloadPath      *string `json:"downloadPath,omitempty"`
	// 原版文件名：`<显示名>.agent.json` 或 `.agent.png`；团队为 `.team.*`。
	FileName         *string            `json:"fileName,omitempty"`
	FormatKey        string             `json:"formatKey"`
	MediaType        string             `json:"mediaType"`
	PackageAssetID   string             `json:"packageAssetId"`
	SourceAssetID    *string            `json:"sourceAssetId,omitempty"`
	SourceResourceID string             `json:"sourceResourceId"`
	State            ExportPackageState `json:"state"`
}

// DD-158(2): authenticated operator attachment read with encoding=base64 for native JSON
// transport; same audited bytes as the binary response, nosniff.
type FeedbackAttachmentContent struct {
	DataBase64 string `json:"dataBase64"`
	MIMEType   string `json:"mimeType"`
	Sha256     string `json:"sha256"`
}

// DD-158(1)：反馈已记入 Core 的回执；同键重放返回同一回执。
type FeedbackSubmissionReceipt struct {
	CreatedAt  string `json:"createdAt"`
	FeedbackID string `json:"feedbackId"`
}

// DD-158(1)：POST /api/v1/feedback。ACTIVE Tenant 成员的 HUMAN 会话提交给部署运营方的私有反馈；不是 Governed
// Action。idempotencyKey 由客户端在首次发送前冻结，同一本人同键重放返回原回执、同键异内容 409。
type FeedbackSubmissionRequest struct {
	Attachment *FeedbackAttachmentUpload `json:"attachment,omitempty"`
	Category   *FeedbackCategory         `json:"category,omitempty"`
	Client     FeedbackClient            `json:"client"`
	// 本人在提交前预览并同意附带的固定诊断字段（应用版本、平台、User-Agent、语言、采集时间），≤4096 字节
	Diagnostics    *string `json:"diagnostics,omitempty"`
	IdempotencyKey string  `json:"idempotencyKey"`
	// 去首尾空白后 1–4000 字符
	Message string `json:"message"`
}

type FeedbackAttachmentUpload struct {
	// 标准 base64，解码后 ≤2 MiB
	DataBase64 string `json:"dataBase64"`
	// image/png、image/jpeg 或 image/webp；Core 另按文件头复核
	MIMEType string `json:"mimeType"`
}

// PUT /api/v1/user-state/followed-principals 的请求体（DD-125(5)、03
// CollaborationUserState.followed_principals）：原 Pulse 关注/取消关注，取代逐公钥 kind 3。pubkey 是被关注者的任一
// Buzz 公钥，Core 解析为同 Tenant 的 HUMAN Principal 并按 Principal 存储；关注要求该公钥当前
// ACTIVE，取消关注也接受其已撤销的历史公钥。读取时按被关注 Principal 的全部 ACTIVE 公钥展开。version 不符即 409。
type FollowedPrincipalRequest struct {
	Followed bool   `json:"followed"`
	Pubkey   string `json:"pubkey"`
	Version  int64  `json:"version"`
}

// DD-134(2)：本会话在网关管理区可用的分区。只决定入口与按钮是否呈现；每个查询与动作仍在 BFF fresh 授权，前端隐藏不构成授权。
type GatewayAccess struct {
	// TENANT 范围：application_binding.create 的准入预评估（Tenant manage）。
	CanBindMCP bool `json:"canBindMcp"`
	// llm_route.create 的准入预评估（Tenant create）。
	CanCreateModelRoute bool `json:"canCreateModelRoute"`
	// PLATFORM 范围：active HUMAN 且 Catalog Tenant manage（交付目录读取、受控探测、契约与 release 登记批准）。
	CanManageMCP bool `json:"canManageMcp"`
	// PLATFORM 范围：Catalog Tenant audit。
	CanReadConfig bool `json:"canReadConfig"`
	// TENANT 范围：Tenant discover。PLATFORM 范围恒为 false（平台只在实时配置中看到 route 的 Gateway 投影）。
	CanReadModelRoutes bool `json:"canReadModelRoutes"`
	// PLATFORM：Catalog Tenant audit；TENANT：Tenant audit（Workspace audit 只在选择该 Workspace 时生效）。
	CanReadStats bool `json:"canReadStats"`
	// TENANT 范围：Tenant discover。PLATFORM 范围恒为 false。
	CanReadTools bool              `json:"canReadTools"`
	Scope        GatewayAdminScope `json:"scope"`
	TenantID     string            `json:"tenantId"`
}

// DD-134(3)⑤：单次调用下钻。TENANT 范围关联 ActionExecution 与同 operation 的 AuditEvent；PLATFORM 范围只有
// call。
type GatewayCallDetail struct {
	AuditEvents []GatewayCallAuditEvent `json:"auditEvents"`
	Call        GatewayCallView         `json:"call"`
	Execution   *GatewayCallExecution   `json:"execution,omitempty"`
}

type GatewayCallAuditEvent struct {
	ActionExecutionID *string        `json:"actionExecutionId,omitempty"`
	ActionKey         string         `json:"actionKey"`
	Decision          string         `json:"decision"`
	EventID           string         `json:"eventId"`
	EventType         AuditEventType `json:"eventType"`
	OccurredAt        string         `json:"occurredAt"`
	ResultCode        string         `json:"resultCode"`
}

// DD-134(3)⑤：一次模型或工具调用的元数据。不含 prompt 预览、turn、payload、工具参数或结果正文。PLATFORM 范围只填 Gateway 原生字段与
// tenantId。
type GatewayCallView struct {
	ActionExecutionID           *string `json:"actionExecutionId,omitempty"`
	AgentInstallationResourceID *string `json:"agentInstallationResourceId,omitempty"`
	AgentName                   *string `json:"agentName,omitempty"`
	ApplicationBindingID        *string `json:"applicationBindingId,omitempty"`
	// MODEL 为 request log ID 前缀 model:，TOOL 为 ActionExecution ID 前缀 tool:。
	CallID      string          `json:"callId"`
	CompletedAt *string         `json:"completedAt,omitempty"`
	DurationMS  *int64          `json:"durationMs,omitempty"`
	HTTPStatus  *int64          `json:"httpStatus,omitempty"`
	InputTokens *int64          `json:"inputTokens,omitempty"`
	Kind        GatewayCallKind `json:"kind"`
	Model       *string         `json:"model,omitempty"`
	// Gateway 上的模型路由名（request log 的请求模型）。
	ModelRouteKey        *string                      `json:"modelRouteKey,omitempty"`
	ModelRouteResourceID *string                      `json:"modelRouteResourceId,omitempty"`
	OperationID          *string                      `json:"operationId,omitempty"`
	Outcome              GatewayCallOutcome           `json:"outcome"`
	OutputTokens         *int64                       `json:"outputTokens,omitempty"`
	Provider             *string                      `json:"provider,omitempty"`
	ReasonCode           *ReasonCode                  `json:"reasonCode,omitempty"`
	RequestLogID         *string                      `json:"requestLogId,omitempty"`
	StartedAt            string                       `json:"startedAt"`
	TenantID             *string                      `json:"tenantId,omitempty"`
	ToolName             *string                      `json:"toolName,omitempty"`
	ToolResourceID       *string                      `json:"toolResourceId,omitempty"`
	ToolSource           *AgentInstallationToolSource `json:"toolSource,omitempty"`
	TotalTokens          *int64                       `json:"totalTokens,omitempty"`
	TraceID              *string                      `json:"traceId,omitempty"`
	UsageState           *OperationUsageState         `json:"usageState,omitempty"`
	WorkspaceID          *string                      `json:"workspaceId,omitempty"`
}

type GatewayCallExecution struct {
	ActionExecutionID       string              `json:"actionExecutionId"`
	ActionKey               string              `json:"actionKey"`
	ActionVersion           int64               `json:"actionVersion"`
	CreatedAt               string              `json:"createdAt"`
	DispatchState           ActionDispatchState `json:"dispatchState"`
	GateState               ActionGateState     `json:"gateState"`
	OperationID             string              `json:"operationId"`
	ParentActionExecutionID *string             `json:"parentActionExecutionId,omitempty"`
	ReasonCode              *ReasonCode         `json:"reasonCode,omitempty"`
	UpdatedAt               *string             `json:"updatedAt,omitempty"`
}

// DD-134(3)：时间窗内的调用列表，按开始时间倒序；nextCursor 只在同一查询条件内继续。
type GatewayCallPage struct {
	Calls             []GatewayCallView `json:"calls"`
	ModelLogAvailable bool              `json:"modelLogAvailable"`
	NextCursor        *string           `json:"nextCursor,omitempty"`
	Scope             GatewayAdminScope `json:"scope"`
	Truncated         bool              `json:"truncated"`
}

// DD-134(3)⑥：一个 ConfigResource 的 Core 写入证据（打码后的值）与相邻已记录 revision 之间的差异；当前 revision 没有证据时
// currentSource=UNRECORDED。
type GatewayConfigHistory struct {
	CurrentRevision *int64                      `json:"currentRevision,omitempty"`
	CurrentSource   GatewayConfigRevisionSource `json:"currentSource"`
	ID              string                      `json:"id"`
	Kind            string                      `json:"kind"`
	Revisions       []GatewayConfigRevisionView `json:"revisions"`
}

type GatewayConfigRevisionView struct {
	ActionExecutionID *string               `json:"actionExecutionId,omitempty"`
	ActionKey         *string               `json:"actionKey,omitempty"`
	Changes           []GatewayConfigChange `json:"changes"`
	Deleted           bool                  `json:"deleted"`
	OperationID       *string               `json:"operationId,omitempty"`
	RecordedAt        string                `json:"recordedAt"`
	Revision          int64                 `json:"revision"`
	ValueDigest       string                `json:"valueDigest"`
	ValueJSON         string                `json:"valueJson"`
}

type GatewayConfigChange struct {
	AfterJSON  *string                 `json:"afterJson,omitempty"`
	BeforeJSON *string                 `json:"beforeJson,omitempty"`
	Change     GatewayConfigChangeKind `json:"change"`
	// RFC 6901 JSON pointer。
	Path string `json:"path"`
}

// DD-134(3)⑥(4)：Gateway effective config 与 ConfigResource 当前值，均已在 Core 打码；只读。
type GatewayConfigView struct {
	EffectiveConfigJSON string                      `json:"effectiveConfigJson"`
	ReadAt              string                      `json:"readAt"`
	Resources           []GatewayConfigResourceView `json:"resources"`
}

type GatewayConfigResourceView struct {
	ActionExecutionID *string                     `json:"actionExecutionId,omitempty"`
	ActionKey         *string                     `json:"actionKey,omitempty"`
	ID                string                      `json:"id"`
	Kind              string                      `json:"kind"`
	OperationID       *string                     `json:"operationId,omitempty"`
	Revision          int64                       `json:"revision"`
	Source            GatewayConfigRevisionSource `json:"source"`
	UpdatedAt         *string                     `json:"updatedAt,omitempty"`
	ValueJSON         string                      `json:"valueJson"`
}

// DD-134(5)⑥：需由运维加入交付目录 protocolPeers[].bindings 的条目（不含 secret）；Core 回读到同 bindingId 的条目后才放行
// application_binding.create。
type GatewayMCPBindingDraft struct {
	AdapterServiceRef  string `json:"adapterServiceRef"`
	BindingID          string `json:"bindingId"`
	ConfigDigest       string `json:"configDigest"`
	DirectoryEntryJSON string `json:"directoryEntryJson"`
	ServicePrincipalID string `json:"servicePrincipalId"`
}

// DD-134(5)⑥：为尚无交付归属事实的连接生成目录条目草稿；纯计算，不写任何状态。
type GatewayMCPBindingDraftRequest struct {
	ComponentReleaseID   string                   `json:"componentReleaseId"`
	IsolationMode        ApplicationIsolationMode `json:"isolationMode"`
	NativeScopeRef       string                   `json:"nativeScopeRef"`
	NormalizedConfigJSON string                   `json:"normalizedConfigJson"`
	WorkspaceID          *string                  `json:"workspaceId,omitempty"`
}

// DD-134(5)①：部署交付目录的 protocolPeers 与一致性环境（只读，Catalog manage）。URL 已去掉 userinfo、query 与
// fragment。
type GatewayMCPPeerPage struct {
	ConformanceArtifactDigest *string              `json:"conformanceArtifactDigest,omitempty"`
	DirectoryAvailable        bool                 `json:"directoryAvailable"`
	Peers                     []GatewayMCPPeerView `json:"peers"`
}

type GatewayMCPPeerView struct {
	AdapterServiceRef string                  `json:"adapterServiceRef"`
	ArtifactDigest    string                  `json:"artifactDigest"`
	BindingFacts      []GatewayMCPBindingFact `json:"bindingFacts"`
	// 部署一致性环境存在且其 artifactDigest 等于本条目。
	ConformanceReady  bool   `json:"conformanceReady"`
	MaxResponseBytes  int64  `json:"maxResponseBytes"`
	MCPURL            string `json:"mcpUrl"`
	NativeInstanceRef string `json:"nativeInstanceRef"`
	TimeoutSeconds    int64  `json:"timeoutSeconds"`
}

// DD-98/134(5)⑥：交付目录中一条 binding 归属事实（运维域），不是授权；不含 secret。
type GatewayMCPBindingFact struct {
	BindingID string `json:"bindingId"`
	// 已有同 ID 的 ApplicationBinding。
	Bound              bool                     `json:"bound"`
	ConfigDigest       string                   `json:"configDigest"`
	CredentialKeys     []string                 `json:"credentialKeys"`
	IsolationMode      ApplicationIsolationMode `json:"isolationMode"`
	NativeScopeRef     string                   `json:"nativeScopeRef"`
	ServicePrincipalID string                   `json:"servicePrincipalId"`
	TenantID           string                   `json:"tenantId"`
	WorkspaceID        *string                  `json:"workspaceId,omitempty"`
}

// DD-134(5)②：受控探测只接受交付目录条目引用，不接受 URL。
type GatewayMCPProbeRequest struct {
	AdapterServiceRef string `json:"adapterServiceRef"`
}

// DD-134(5)②：经 Gateway 临时验证 route 的 initialize 与 tools/list 结果（route
// 已删除并回读不存在）。matchingContracts 为输入 schema 摘要一致的 ACTIVE 契约 TOOL 键，并带该契约生成 PROTOCOL_PEER
// release 草稿所需的 Catalog 元数据（DD-134(5)③④），不含 schema 正文。
type GatewayMCPProbeResult struct {
	AdapterServiceRef string                 `json:"adapterServiceRef"`
	ProbedAt          string                 `json:"probedAt"`
	ProbeID           string                 `json:"probeId"`
	ProtocolVersion   *string                `json:"protocolVersion,omitempty"`
	ServerName        *string                `json:"serverName,omitempty"`
	ServerVersion     *string                `json:"serverVersion,omitempty"`
	Tools             []GatewayMCPProbedTool `json:"tools"`
	ToolSchemaDigest  string                 `json:"toolSchemaDigest"`
}

type GatewayMCPProbedTool struct {
	Description        *string                   `json:"description,omitempty"`
	DisplayTitle       *string                   `json:"displayTitle,omitempty"`
	InputSchemaDigest  string                    `json:"inputSchemaDigest"`
	InputSchemaJSON    string                    `json:"inputSchemaJson"`
	MatchingContracts  []GatewayMCPContractMatch `json:"matchingContracts"`
	Name               string                    `json:"name"`
	OutputSchemaDigest *string                   `json:"outputSchemaDigest,omitempty"`
	OutputSchemaJSON   *string                   `json:"outputSchemaJson,omitempty"`
	ReadOnlyHint       *bool                     `json:"readOnlyHint,omitempty"`
}

type GatewayMCPContractMatch struct {
	CategoryKey     string `json:"categoryKey"`
	ContractKey     string `json:"contractKey"`
	ContractVersion int64  `json:"contractVersion"`
	// 该 ACTIVE 契约的全部 operation 契约键；release 须为每个键登记动作与工具。
	OperationContractKeys []string `json:"operationContractKeys"`
	// 该 TOOL 契约键在 ACTIVE 契约中的输出 schema 摘要；release 的动作与工具逐字采用。
	OutputSchemaDigest string               `json:"outputSchemaDigest"`
	Permission         CapabilityPermission `json:"permission"`
	// 该 ACTIVE 契约 resourceTypeFamily 的全部 typeKey；release 须逐一登记。
	ResourceTypeKeys []string `json:"resourceTypeKeys"`
	// 该 TOOL 契约键在 ACTIVE 契约中的 targetType。
	TargetType string `json:"targetType"`
}

// DD-134(5)⑥：业务 Tenant 可建立连接的已批准 PROTOCOL_PEER release 与本 Tenant 的交付归属事实（Tenant manage）。
type GatewayMCPReleasePage struct {
	Releases []GatewayMCPReleaseView `json:"releases"`
}

type GatewayMCPReleaseView struct {
	AdapterBuildRef string `json:"adapterBuildRef"`
	// 交付目录中 artifactDigest 等于 adapterBuildRef 的 peer；没有时省略。
	AdapterServiceRef       *string                     `json:"adapterServiceRef,omitempty"`
	AllowedModelCallModes   []ApplicationModelCallMode  `json:"allowedModelCallModes"`
	BindingConfigSchemaJSON *string                     `json:"bindingConfigSchemaJson,omitempty"`
	BindingIDS              []string                    `json:"bindingIds"`
	CapabilityCategories    []GatewayMCPReleaseCategory `json:"capabilityCategories"`
	ComponentReleaseID      string                      `json:"componentReleaseId"`
	ComponentTypeKey        string                      `json:"componentTypeKey"`
	DeliveryFacts           []GatewayMCPBindingFact     `json:"deliveryFacts"`
	NativeInstanceRef       *string                     `json:"nativeInstanceRef,omitempty"`
	// DD-155(3)：release 所选能力类别任一声明 tenantDelete=RETAIN_ON_TENANT_DELETE 即为
	// true；建立连接的保留选项取此值，Core 要求一致。
	RetainOnTenantDelete *bool                   `json:"retainOnTenantDelete,omitempty"`
	SecretKeys           []string                `json:"secretKeys"`
	Status               ComponentReleaseStatus  `json:"status"`
	Tools                []GatewayMCPReleaseTool `json:"tools"`
	Version              string                  `json:"version"`
}

type GatewayMCPReleaseCategory struct {
	Category string `json:"category"`
	Version  int64  `json:"version"`
}

type GatewayMCPReleaseTool struct {
	ActionKey             string `json:"actionKey"`
	CapabilityContractKey string `json:"capabilityContractKey"`
	Name                  string `json:"name"`
}

// DD-134(7)：本 Tenant 的 llm_route Resource（按 discover 过滤）与时间窗用量；新建沿 llm_route.create，停用沿
// llm_route.disable。
type GatewayModelRoutePage struct {
	CanCreate  bool                    `json:"canCreate"`
	From       string                  `json:"from"`
	NextOffset *int64                  `json:"nextOffset,omitempty"`
	Routes     []GatewayModelRouteView `json:"routes"`
	To         string                  `json:"to"`
}

type GatewayModelRouteView struct {
	BindingCount      int64         `json:"bindingCount"`
	CanDisable        bool          `json:"canDisable"`
	Failed            *int64        `json:"failed,omitempty"`
	HomeWorkspaceID   *string       `json:"homeWorkspaceId,omitempty"`
	InstallationCount int64         `json:"installationCount"`
	Model             *string       `json:"model,omitempty"`
	ModelP95MS        *int64        `json:"modelP95Ms,omitempty"`
	NativeID          string        `json:"nativeId"`
	OwnerPrincipalID  string        `json:"ownerPrincipalId"`
	Provider          *string       `json:"provider,omitempty"`
	Requests          *int64        `json:"requests,omitempty"`
	ResourceID        string        `json:"resourceId"`
	ResourceState     ResourceState `json:"resourceState"`
	ResourceVersion   int64         `json:"resourceVersion"`
	TotalTokens       *int64        `json:"totalTokens,omitempty"`
}

// DD-134(7)：Gateway 中已存在、尚未被 llm_route 引用的原生 provider 与 model ConfigResource（打码），供
// llm_route.create 选择；revision 与 sha256 为 Core 回读值。
type GatewayModelSourcePage struct {
	Sources []GatewayModelSource `json:"sources"`
}

type GatewayModelSource struct {
	CredentialRequired *bool         `json:"credentialRequired,omitempty"`
	Model              ModelClass    `json:"model"`
	ModelName          string        `json:"modelName"`
	Provider           ProviderClass `json:"provider"`
	ProviderType       string        `json:"providerType"`
}

type ModelClass struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
	Sha256   string `json:"sha256"`
}

type ProviderClass struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
	Sha256   string `json:"sha256"`
}

// DD-134(3)：时间窗内按一个维度的聚合与时间桶。每次请求实时计算；扫描原始记录超出上限时 truncated=true，结果只基于已扫描部分。
type GatewayStats struct {
	Buckets       []GatewayStatsBucket  `json:"buckets"`
	BucketSeconds int64                 `json:"bucketSeconds"`
	Dimension     GatewayStatsDimension `json:"dimension"`
	From          string                `json:"from"`
	// Gateway request log 是否可读；false 时模型调用计数缺失，不显示为零。
	ModelLogAvailable bool                 `json:"modelLogAvailable"`
	Rows              []GatewayStatsRow    `json:"rows"`
	Scope             GatewayAdminScope    `json:"scope"`
	To                string               `json:"to"`
	Totals            GatewayStatsCounters `json:"totals"`
	Truncated         bool                 `json:"truncated"`
	WorkspaceID       *string              `json:"workspaceId,omitempty"`
}

type GatewayStatsBucket struct {
	Denied      int64  `json:"denied"`
	Failed      int64  `json:"failed"`
	Requests    int64  `json:"requests"`
	Start       string `json:"start"`
	TotalTokens int64  `json:"totalTokens"`
}

type GatewayStatsRow struct {
	Counters GatewayStatsCounters `json:"counters"`
	// 维度键：llm_route Resource ID 或 Gateway route 名、Tool Resource ID、Installation Resource
	// ID、binding ID 或 Tenant ID；UNATTRIBUTED 为无法归属的记录。
	Key  string           `json:"key"`
	Kind *GatewayCallKind `json:"kind,omitempty"`
	// 受权的展示名（工具名、Agent 名、模型名）；平台范围不含业务名称。
	Label *string `json:"label,omitempty"`
}

// DD-134(3)④：计数与分位数。错误率由呈现层按 failed/requests 计算；模型与工具时延分列，不混算。
type GatewayStatsCounters struct {
	// 模型调用：Gateway 日志已有而没有 durable UsageEvent 或已记 BILLING_UNAVAILABLE 审计的次数（14 §8）。
	BillingUnavailable int64 `json:"billingUnavailable"`
	Denied             int64 `json:"denied"`
	Failed             int64 `json:"failed"`
	InputTokens        int64 `json:"inputTokens"`
	// 模型调用 Gateway durationMs 的 P50；没有模型调用时省略。
	ModelP50MS   *int64 `json:"modelP50Ms,omitempty"`
	ModelP95MS   *int64 `json:"modelP95Ms,omitempty"`
	OutputTokens int64  `json:"outputTokens"`
	Requests     int64  `json:"requests"`
	Running      int64  `json:"running"`
	Succeeded    int64  `json:"succeeded"`
	// 工具调用 Core 观测时延（INTENT 到 OUTCOME）的 P50；没有已终结工具调用时省略。
	ToolP50MS   *int64 `json:"toolP50Ms,omitempty"`
	ToolP95MS   *int64 `json:"toolP95Ms,omitempty"`
	TotalTokens int64  `json:"totalTokens"`
	Unknown     int64  `json:"unknown"`
}

// DD-134(6)：本 Tenant 的 PLATFORM_NATIVE 与 APPLICATION 工具（按 Tool Resource discover
// 过滤），附时间窗内调用统计。停用只作用于所属连接；PLATFORM_NATIVE 无启停入口。
type GatewayToolPage struct {
	From       string            `json:"from"`
	NextOffset *int64            `json:"nextOffset,omitempty"`
	To         string            `json:"to"`
	Tools      []GatewayToolView `json:"tools"`
}

type GatewayToolView struct {
	ActionKey                 string                   `json:"actionKey"`
	ApplicationBindingID      *string                  `json:"applicationBindingId,omitempty"`
	ApplicationBindingVersion *int64                   `json:"applicationBindingVersion,omitempty"`
	BindingState              *ApplicationBindingState `json:"bindingState,omitempty"`
	BindingWorkspaceID        *string                  `json:"bindingWorkspaceId,omitempty"`
	CanDisableBinding         bool                     `json:"canDisableBinding"`
	// 契约 permission 为 discover、consume 或 read，且存在本人可作用的 ACTIVE 目标 Resource 与有效结果策略；最终准入仍在提交时
	// fresh 重做。
	CanTestCall           bool                  `json:"canTestCall"`
	CapabilityContractKey *string               `json:"capabilityContractKey,omitempty"`
	ComponentReleaseID    *string               `json:"componentReleaseId,omitempty"`
	ComponentTypeKey      *string               `json:"componentTypeKey,omitempty"`
	ContractPermission    *CapabilityPermission `json:"contractPermission,omitempty"`
	Denied                int64                 `json:"denied"`
	Failed                int64                 `json:"failed"`
	// 仅 USER_REGISTERED_EXTERNAL（DD-149）：所属连接器
	MCPConnectionID *string `json:"mcpConnectionId,omitempty"`
	// 仅 USER_REGISTERED_EXTERNAL：连接器显示名
	MCPConnectionName *string                     `json:"mcpConnectionName,omitempty"`
	Name              string                      `json:"name"`
	ReleaseVersion    *string                     `json:"releaseVersion,omitempty"`
	Requests          int64                       `json:"requests"`
	ResourceID        string                      `json:"resourceId"`
	ResourceState     ResourceState               `json:"resourceState"`
	ResourceVersion   int64                       `json:"resourceVersion"`
	Source            AgentInstallationToolSource `json:"source"`
	TestCall          *GatewayToolTestCall        `json:"testCall,omitempty"`
	ToolP95MS         *int64                      `json:"toolP95Ms,omitempty"`
}

type GatewayToolTestCall struct {
	ActionKey     string `json:"actionKey"`
	ActionVersion int64  `json:"actionVersion"`
	// 契约固定的输入 schema（canonical JSON）。
	InputSchemaJSON             string                  `json:"inputSchemaJson"`
	ResultExposurePolicyID      string                  `json:"resultExposurePolicyId"`
	ResultExposurePolicyVersion int64                   `json:"resultExposurePolicyVersion"`
	Targets                     []GatewayToolTestTarget `json:"targets"`
}

type GatewayToolTestTarget struct {
	DisplayName     string  `json:"displayName"`
	ResourceID      string  `json:"resourceId"`
	ResourceVersion int64   `json:"resourceVersion"`
	WorkspaceID     *string `json:"workspaceId,omitempty"`
}

// DD-134(6)：网关管理区测试调用的同请求回应。submission 是该工具 ActionDefinition 的准入与派发结论；resultJson
// 只在本次调用已确定成功时出现，是经 ExtMcp 按冻结 ResultExposurePolicy 与输出 schema 过滤后的 canonical
// JSON，只回给发起人本人且 Core 不保存；toolError 为真表示原生工具返回了错误结果（不含正文）。结果不明时两者都缺省，ActionExecution 停在
// UNKNOWN，不重放。
type GatewayToolTestCallResult struct {
	ResultJSON *string          `json:"resultJson,omitempty"`
	Submission ActionSubmission `json:"submission"`
	ToolError  *bool            `json:"toolError,omitempty"`
}

// POST /api/v1/actions 的回应：本次 operation 的门禁与调度状态。gateState=WAITING 时 approvalWorkflowId
// 必有；DENIED 时 reason 必有。invitation 只在 tenant.member.invite
// 的首次回应中出现，同一幂等键的重放不再给出（DD-83）。webhookSecret 同理，只在生成或轮换 WEBHOOK 密钥的 automation.enable /
// automation.rotate_webhook_secret 首次回应中出现（DD-116）。
type ActionSubmission struct {
	ActionExecutionID  string                    `json:"actionExecutionId"`
	ActionKey          string                    `json:"actionKey"`
	ApprovalWorkflowID *string                   `json:"approvalWorkflowId,omitempty"`
	DispatchState      ActionDispatchState       `json:"dispatchState"`
	DocumentLaunch     *DocumentLaunchDescriptor `json:"documentLaunch,omitempty"`
	GateState          ActionGateState           `json:"gateState"`
	// 仅 huddle.start（DD-125(3)）：Core 预分配的 HuddleBuzzBinding；同一幂等键的重放给出同一值
	HuddleID          *string                  `json:"huddleId,omitempty"`
	Invitation        *IssuedInvitation        `json:"invitation,omitempty"`
	OperationID       string                   `json:"operationId"`
	ProtocolSessionID *string                  `json:"protocolSessionId,omitempty"`
	Reason            *ReasonCode              `json:"reason,omitempty"`
	WebhookSecret     *AutomationWebhookSecret `json:"webhookSecret,omitempty"`
	WorkflowID        *string                  `json:"workflowId,omitempty"`
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

// DD-116：WEBHOOK 触发密钥的唯一一次明文交付。只出现在生成或轮换该密钥的那次 ActionSubmission 中；之后只给出
// AutomationView.webhookSecretHint。投递方用它按 Standard Webhooks 对
// `{webhook-id}.{webhook-timestamp}.{正文}` 计算 HMAC-SHA256。
type AutomationWebhookSecret struct {
	AutomationResourceID string `json:"automationResourceId"`
	Hint                 string `json:"hint"`
	// 32 字节随机密钥的 base64 展示形式。
	Secret string `json:"secret"`
	// 公开投递地址；部署未配置公开基址时省略。
	URL *string `json:"url,omitempty"`
}

// POST /api/v1/huddles/{huddleId}/announcement（仅 Web 创建者，DD-125(3)）：BFF 以本人 SERVER 身份为
// ACTIVE 的 Huddle 各签一次 48106（临时频道，原 voice_mode_guidelines 正文）与 48100（父频道，content 为
// ephemeral_channel_id），签名事件随绑定持久化，重试只重投同一事件、不重签（DD-81）。48106 按原版尽力发布，48100 是必需的发现链接。
type HuddleAnnouncementView struct {
	// 48106 事件 ID；尽力发布
	GuidelinesEventID *string `json:"guidelinesEventId,omitempty"`
	// Relay 已接受或回读到 48100
	StartedDelivered bool `json:"startedDelivered"`
	// 48100 事件 ID
	StartedEventID string `json:"startedEventId"`
}

// GET /api/v1/huddles/{huddleId}/lifecycle：该 Huddle 在父频道中的生命周期事件（按 created_at 升序）与 Relay
// 合成的存活（48104，房间非空才为 true），供原 huddlePresence 重建参与者与卡片状态。
type HuddleLifecyclePage struct {
	Events []HuddleLifecycleEvent `json:"events"`
	// Relay 48104 存活查询是否返回该会话
	Live bool `json:"live"`
}

// 父频道中一条原版 Huddle 生命周期事件（kind 48100–48103，SF-BUZ-53），由 BFF 以本人身份读取并校验签名：48100
// 只取临时频道创建者签名，48101/48102 只取 Relay 签名，48103 取创建者或 Relay 签名。content 按原 JSON 解析为下列字段，未知字段丢弃。
type HuddleLifecycleEvent struct {
	AdmissionID *string `json:"admissionId,omitempty"`
	// 事件 created_at（Unix 秒）
	CreatedAt          int64   `json:"createdAt"`
	EphemeralChannelID string  `json:"ephemeralChannelId"`
	EventID            string  `json:"eventId"`
	Generation         *string `json:"generation,omitempty"`
	Kind               int64   `json:"kind"`
	// 48101/48102 的 p 标签
	ParticipantPubkey *string `json:"participantPubkey,omitempty"`
	// 签名者公钥
	Pubkey         string `json:"pubkey"`
	RosterRevision *int64 `json:"rosterRevision,omitempty"`
}

// GET /api/v1/huddles：一个父 Workspace 或父私聊中本人可见、尚未结束的 Huddle（PROVISIONING 或 ACTIVE），按创建时间倒序。
type HuddlePage struct {
	Items []HuddleView `json:"items"`
}

// 本人可见的一个原版 Huddle 临时频道投影（HuddleBuzzBinding，DD-125(3)）。只含平台引用与状态，不含音频、参与者音频状态或消息正文；参与者与存活由
// Relay 的 48101–48104 呈现。
type HuddleView struct {
	AgentInstallationResourceIDS []string `json:"agentInstallationResourceIds"`
	// Core 预分配的临时 Channel UUID（原 ephemeral_channel_id）
	ChannelID   string `json:"channelId"`
	ChannelName string `json:"channelName"`
	CreatedAt   string `json:"createdAt"`
	// 临时频道 created_by：本人发起会话的 HUMAN 公钥
	CreatorPubkey        string  `json:"creatorPubkey"`
	EndedAt              *string `json:"endedAt,omitempty"`
	HuddleID             string  `json:"huddleId"`
	InitiatorPrincipalID string  `json:"initiatorPrincipalId"`
	// 发起该 Huddle 的 huddle.start operation
	OperationID          string      `json:"operationId"`
	ParentChannelID      string      `json:"parentChannelId"`
	ParentConversationID *string     `json:"parentConversationId,omitempty"`
	ParentWorkspaceID    *string     `json:"parentWorkspaceId,omitempty"`
	State                HuddleState `json:"state"`
	Version              int64       `json:"version"`
}

// GET /api/v1/huddles/voice：Web Huddle
// 的转写与朗读是否可用（DD-125(3)、V-SCN-160）。不可用时通话、加入、发言、收听与离开不受影响。
type HuddleVoiceView struct {
	Speech        HuddleVoiceAvailability `json:"speech"`
	Transcription HuddleVoiceAvailability `json:"transcription"`
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

// GET /api/v1/identity/legacy-secret-refs 的有界视图。只列当前 Tenant 中可发起 DD-85 归位的 SERVER
// binding，不暴露 locator、版本或私钥。
type LegacySecretRefPage struct {
	Bindings   []LegacySecretRefBinding `json:"bindings"`
	NextCursor *string                  `json:"nextCursor,omitempty"`
}

// 业务 Tenant 的旧 SERVER 身份引用；仅给有 tenant manage 权限的人展示。
type LegacySecretRefBinding struct {
	Kind        LegacySecretRefBindingKind `json:"kind"`
	PrincipalID string                     `json:"principalId"`
	Pubkey      string                     `json:"pubkey"`
}

// DD-149(10)：本人可发现的连接器与登记能力。
type MCPConnectionPage struct {
	CanRegisterPersonal     bool                    `json:"canRegisterPersonal"`
	CanRegisterTenant       bool                    `json:"canRegisterTenant"`
	Connections             []MCPConnectionView     `json:"connections"`
	Policy                  MCPConnectionPolicyView `json:"policy"`
	RegistrableWorkspaceIDS []string                `json:"registrableWorkspaceIds"`
}

// DD-149(10)：连接器详情；凭据只以 credentialSet 表示，从不回显。
type MCPConnectionView struct {
	APIKeyHeader        *string               `json:"apiKeyHeader,omitempty"`
	AuthMode            MCPConnectionAuthMode `json:"authMode"`
	CanManage           bool                  `json:"canManage"`
	CreatedAt           *string               `json:"createdAt,omitempty"`
	CredentialSet       bool                  `json:"credentialSet"`
	CredentialUpdatedAt *string               `json:"credentialUpdatedAt,omitempty"`
	DisplayName         string                `json:"displayName"`
	// 最近一次探测的清单摘要与已确认的不同
	Drift               bool                    `json:"drift"`
	EndpointHost        string                  `json:"endpointHost"`
	EndpointURL         string                  `json:"endpointUrl"`
	Generation          int64                   `json:"generation"`
	Health              MCPConnectionHealth     `json:"health"`
	HealthCheckedAt     *string                 `json:"healthCheckedAt,omitempty"`
	ID                  string                  `json:"id"`
	ObservedToolsDigest *string                 `json:"observedToolsDigest,omitempty"`
	OwnerDisplayName    *string                 `json:"ownerDisplayName,omitempty"`
	OwnerPrincipalID    string                  `json:"ownerPrincipalId"`
	ServerName          *string                 `json:"serverName,omitempty"`
	ServerVersion       *string                 `json:"serverVersion,omitempty"`
	Slug                string                  `json:"slug"`
	State               MCPConnectionState      `json:"state"`
	Tools               []MCPConnectionToolView `json:"tools"`
	ToolsDigest         string                  `json:"toolsDigest"`
	Transport           MCPConnectionTransport  `json:"transport"`
	Version             int64                   `json:"version"`
	Visibility          MCPConnectionVisibility `json:"visibility"`
	WorkspaceID         *string                 `json:"workspaceId,omitempty"`
}

type MCPConnectionToolView struct {
	CallPolicy      MCPToolCallPolicy `json:"callPolicy"`
	Description     *string           `json:"description,omitempty"`
	DestructiveHint *bool             `json:"destructiveHint,omitempty"`
	InputSchemaJSON string            `json:"inputSchemaJson"`
	// Agent 看到的工具名 <slug>__<上游名>
	Name           string      `json:"name"`
	ReadOnlyHint   *bool       `json:"readOnlyHint,omitempty"`
	Risk           MCPToolRisk `json:"risk"`
	RiskDeclared   bool        `json:"riskDeclared"`
	Title          *string     `json:"title,omitempty"`
	ToolResourceID string      `json:"toolResourceId"`
	UpstreamName   string      `json:"upstreamName"`
}

// DD-149(4)(5)：Tenant 连接器策略与部署出站上限。
type MCPConnectionPolicyView struct {
	CanManage             bool                  `json:"canManage"`
	EgressHostSuffixes    []string              `json:"egressHostSuffixes"`
	MemberRegistration    MCPMemberRegistration `json:"memberRegistration"`
	PlatformAnyPublicHost bool                  `json:"platformAnyPublicHost"`
	PlatformHostSuffixes  []string              `json:"platformHostSuffixes"`
	Version               int64                 `json:"version"`
}

// DD-149(7)：添加连接器前的只读探测。
type MCPConnectionProbeRequest struct {
	APIKeyHeader   *string                       `json:"apiKeyHeader,omitempty"`
	AuthMode       MCPConnectionAuthMode         `json:"authMode"`
	Credential     *MCPConnectionCredentialInput `json:"credential,omitempty"`
	EndpointURL    string                        `json:"endpointUrl"`
	OauthAttemptID *string                       `json:"oauthAttemptId,omitempty"`
	Transport      MCPConnectionTransport        `json:"transport"`
}

// DD-149(5)：仅 mcp_connection.create 与 mcp_connection.rotate_credential 的瞬态凭据（API_KEY 或
// BEARER）；Core 写入该 Tenant 的 OpenBao 后只保存 SecretRef，值不进入
// parameters、ActionExecution、日志、审计或回应。其他命令禁止携带。
//
// DD-149(5)：API Key 或 Bearer 的一次性输入，只随
// mcp_connection.create、mcp_connection.rotate_credential 与探测请求；Core 写入 OpenBao 后只保存
// SecretRef，从不回显、记录或进入 parameters。
type MCPConnectionCredentialInput struct {
	Value string `json:"value"`
}

// DD-149(10)：以已保存凭据重新探测；变化需经 mcp_connection.update 重新确认。
type MCPConnectionRefreshResult struct {
	AddedTools   []string                  `json:"addedTools"`
	ChangedTools []string                  `json:"changedTools"`
	CheckedAt    string                    `json:"checkedAt"`
	Drift        bool                      `json:"drift"`
	Health       MCPConnectionHealth       `json:"health"`
	Probe        *MCPConnectionProbeResult `json:"probe,omitempty"`
	RemovedTools []string                  `json:"removedTools"`
}

// DD-149(7)：探测结果。toolsDigest 是规范化清单摘要，登记与更新以它比对 fresh 探测。
type MCPConnectionProbeResult struct {
	EndpointHost string `json:"endpointHost"`
	// 上游 instructions（不可信内容，截断至 2000 字符）
	Instructions    *string         `json:"instructions,omitempty"`
	ProtocolVersion string          `json:"protocolVersion"`
	ServerName      *string         `json:"serverName,omitempty"`
	ServerVersion   *string         `json:"serverVersion,omitempty"`
	Tools           []MCPProbedTool `json:"tools"`
	ToolsDigest     string          `json:"toolsDigest"`
}

type MCPProbedTool struct {
	// 上游描述（不可信内容，界面以纯文本显示）
	Description         *string           `json:"description,omitempty"`
	DestructiveHint     *bool             `json:"destructiveHint,omitempty"`
	IdempotentHint      *bool             `json:"idempotentHint,omitempty"`
	InputSchemaJSON     string            `json:"inputSchemaJson"`
	OpenWorldHint       *bool             `json:"openWorldHint,omitempty"`
	OutputSchemaJSON    *string           `json:"outputSchemaJson,omitempty"`
	ReadOnlyHint        *bool             `json:"readOnlyHint,omitempty"`
	SuggestedCallPolicy MCPToolCallPolicy `json:"suggestedCallPolicy"`
	SuggestedRisk       MCPToolRisk       `json:"suggestedRisk"`
	Title               *string           `json:"title,omitempty"`
	UpstreamName        string            `json:"upstreamName"`
}

// DD-149(6)：OAuth 授权尝试的状态；从不包含令牌。
type MCPOauthAttemptView struct {
	AttemptID           string  `json:"attemptId"`
	AuthorizationServer *string `json:"authorizationServer,omitempty"`
	AuthorizationURL    *string `json:"authorizationUrl,omitempty"`
	ExpiresAt           string  `json:"expiresAt"`
	// 固定原因码
	Failure *string              `json:"failure,omitempty"`
	State   MCPOauthAttemptState `json:"state"`
}

// DD-149(6)：发起一次 OAuth 授权尝试。forConnectionId 只用于轮换已存在连接器的授权。
type MCPOauthStartRequest struct {
	// 未提供注册端点时的预注册 client ID
	ClientID *string `json:"clientId,omitempty"`
	// 可选预注册 client 密钥，一次性输入，写入 OpenBao
	ClientSecret    *string                `json:"clientSecret,omitempty"`
	EndpointURL     string                 `json:"endpointUrl"`
	ForConnectionID *string                `json:"forConnectionId,omitempty"`
	Transport       MCPConnectionTransport `json:"transport"`
}

// DD-163(4)：GET /api/v1/usage/me，当前会话成员本人的用量（「我的用量」）。只列带成员维度的额度项；数值直接读 OpenMeter（按 Customer
// 与本人 member_principal_id 过滤），不含组织上限与组织已用。
type MemberUsagePage struct {
	Items []MemberUsageView `json:"items"`
}

type MemberUsageView struct {
	Feature TenantQuotaFeature `json:"feature"`
	// 本人每期上限；未设置成员上限时不给出。
	MemberLimitPerPeriod *int64           `json:"memberLimitPerPeriod,omitempty"`
	PeriodResetAt        *string          `json:"periodResetAt,omitempty"`
	State                MemberUsageState `json:"state"`
	// 本人本期已用（OpenMeter committed）；state 为 UNAVAILABLE 时不给出。
	Used *float64 `json:"used,omitempty"`
}

// GET /api/v1/moderation/access（DD-125(2)）：原版只对 Community owner/admin 显示的审核入口在 Kailo 对应
// Tenant manage。canModerate 是与 moderation.ban 准入同一条 fresh 判定（目录开放、非 Platform Catalog、scope
// guard 与 tenant manage）的提示，不是授权票据，提交时仍完整重新准入；它不读取任何限制或队列事实。
type ModerationAccessView struct {
	CanModerate bool `json:"canModerate"`
}

// GET /api/v1/moderation/audit（DD-125(2)）：Relay moderation_actions（审核日志）是唯一权威，Core 以 Tenant
// CONTROL 经 NIP-98 读取 /moderation/audit，只回给 fresh Tenant manage 的请求者，每次读取写 ACCESS
// 审计，不复制。单次至多 500 行，按时间倒序。CONTROL 签发的执法行其 actorPubkey 是 CONTROL；发起人与准入记录在 Core 的
// ActionExecution 与 AuditEvent。
type ModerationAuditPage struct {
	Items []ModerationAuditView `json:"items"`
	// Relay 返回已达单次读取上界（500 行）
	Truncated bool `json:"truncated"`
}

type ModerationAuditView struct {
	// Relay 审核日志词表（ban、unban、timeout、untimeout、resolve:<action>、dismiss_report、escalate 等），原样呈现
	Action      string  `json:"action"`
	ActorPubkey string  `json:"actorPubkey"`
	ChannelID   *string `json:"channelId,omitempty"`
	// RFC3339
	CreatedAt     string  `json:"createdAt"`
	ID            string  `json:"id"`
	PublicReason  *string `json:"publicReason,omitempty"`
	TargetEventID *string `json:"targetEventId,omitempty"`
	TargetPubkey  *string `json:"targetPubkey,omitempty"`
}

// GET /api/v1/moderation/reports[?status=open]（DD-125(2)、V-SCN-130）：Relay
// moderation_reports 是唯一权威，Core 以 Tenant CONTROL 经 NIP-98 读取 /moderation/reports，只回给 fresh
// Tenant manage 的请求者，每次读取写 ACCESS 审计，Core 不复制。单次至多 500 行（Relay 上界），按创建时间倒序。reporterPubkey
// 只出现在此审核面，不得进入被举报人可见的任何视图。
type ModerationReportPage struct {
	Items []ModerationReportView `json:"items"`
	// Relay 返回已达单次读取上界（500 行），更早的行未包含
	Truncated bool `json:"truncated"`
}

type ModerationReportView struct {
	// 事件目标所在 Relay Channel；其余目标缺省
	ChannelID *string `json:"channelId,omitempty"`
	// RFC3339
	CreatedAt string `json:"createdAt"`
	// Relay 举报行 ID
	ID             string  `json:"id"`
	Note           *string `json:"note,omitempty"`
	ReporterPubkey string  `json:"reporterPubkey"`
	// 签名的 kind 1984 事件 ID；9044 以它定位举报
	ReportEventID string               `json:"reportEventId"`
	ReportType    ModerationReportType `json:"reportType"`
	// RFC3339
	ResolvedAt       *string                `json:"resolvedAt,omitempty"`
	ResolvedByPubkey *string                `json:"resolvedByPubkey,omitempty"`
	Status           ModerationReportStatus `json:"status"`
	// 事件 ID、公钥或附件 SHA-256（十六进制）
	Target string `json:"target"`
	// 事件目标由 CONTROL 回读得到的签名者；pubkey 目标即其本身；不可读时缺省
	TargetAuthorPubkey *string                    `json:"targetAuthorPubkey,omitempty"`
	TargetKind         ModerationReportTargetKind `json:"targetKind"`
	// targetAuthorPubkey 属于本 Tenant 某 HUMAN Principal 时给出；AGENT 或未知公钥缺省（不提供封禁与踢出）
	TargetPrincipalID *string `json:"targetPrincipalId,omitempty"`
	// channelId 对应本 Tenant 的 Workspace 时给出，供 moderation.message.delete 与
	// workspace.member.revoke 定位
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// GET /api/v1/moderation/restricted（DD-125(2)、V-SCN-127）：Relay community_bans
// 中当前有效的封禁与禁言，是唯一权威；Core 以 Tenant CONTROL 经 NIP-98 读取 /moderation/restricted，只回给 fresh
// Tenant manage 的请求者，每次读取写 ACCESS 审计，不复制。成员与原版一样读不到自己的限制。
type ModerationRestrictionPage struct {
	Items []ModerationRestrictionView `json:"items"`
}

type ModerationRestrictionView struct {
	// RFC3339；永久封禁缺省
	BanExpiresAt *string `json:"banExpiresAt,omitempty"`
	Banned       bool    `json:"banned"`
	// RFC3339；未禁言缺省
	MutedUntil *string `json:"mutedUntil,omitempty"`
	// 该公钥属于本 Tenant 某 HUMAN Principal 时给出
	PrincipalID *string `json:"principalId,omitempty"`
	Pubkey      string  `json:"pubkey"`
	// RFC3339
	UpdatedAt string `json:"updatedAt"`
}

// GET /api/v1/native/community 的回应，只对原生入口开放（DD-75/78）。relayUrl 的 authority 就是
// communityHost：Relay 按连接的 Host 绑定 Community，非默认端口属于 host（SF-BUZ-32、SF-BUZ-41）。
type NativeCommunityFacts struct {
	// 该 Tenant 的 Community host，可能带非默认端口
	CommunityHost string `json:"communityHost"`
	// DD-81/160：仅从当前 ACTIVE Community 的可信 NIP-11、实际 ready 的 writer policy 读取的规范 publication
	// epoch。Native 新签 1631 前冻结并作为唯一 kailo:publication 标签签名；缺失不猜测或回填历史意图。
	PublicationEpoch *string `json:"publicationEpoch,omitempty"`
	// 读取上述部署事实时 Core 的 Unix 秒时刻；Native 仅以本次可信读的时刻判断原签事件是否严格超过窗口，不信任 Webview now 或设备跳钟。
	PublishResultObservedAtUnixSeconds *int64 `json:"publishResultObservedAtUnixSeconds,omitempty"`
	// DD-81：与 Core 发布对账器同源的 PUBLISH_RESULT_SETTLE_SECONDS 部署事实，必须为正且不小于 Relay 时间漂移窗口；缺失时不得猜测未送达。
	PublishResultSettleSeconds *int64 `json:"publishResultSettleSeconds,omitempty"`
	// 当前固定 Relay NIP-11 的 max_limit；旧客户端忽略，新 Pulse 消费者缺失时不猜测上限。
	RelayQueryLimit *int64 `json:"relayQueryLimit,omitempty"`
	// 原生端直连的 Relay 地址
	RelayURL string `json:"relayUrl"`
}

// Binding SERVICE transport. Command, observation and scope/resource access additionally
// require the independently verified native HUMAN token. readReceipt is SERVICE-only
// incurred-usage metadata for the already admitted original HUMAN SYNC operation; it never
// authorizes content disclosure. Tokens stay in transport, not this document.
type NativeHumanActionRequest struct {
	// Native metadata access uses existing tenant/workspace permissions. Scope and identity
	// come exclusively from the authenticated binding and HUMAN token, never from
	// client-selected IDs. This is not Action admission or a reusable ticket.
	AuthorizeScope *NativeHumanScopeQuery `json:"authorizeScope,omitempty"`
	BindingID      string                 `json:"bindingId"`
	Command        *ActionCommand         `json:"command,omitempty"`
	IdempotencyKey *string                `json:"idempotencyKey,omitempty"`
	// Same-request writer admission for the original dispatched AE/EE and native intent, never
	// another execute. Both the binding SERVICE and independent current HUMAN credentials are
	// required.
	NativeExecutionAdmission *NativeHumanActionRequestNativeExecutionAdmission `json:"nativeExecutionAdmission,omitempty"`
	ReadReceipt              *NativeHumanReadReceipt                           `json:"readReceipt,omitempty"`
	// Read the already-registered exact native object for the verified HUMAN and action. This
	// never creates a Resource or native object.
	ResolveResource *NativeHumanResourceQuery `json:"resolveResource,omitempty"`
	SourceResources []AdapterSourceResource   `json:"sourceResources,omitempty"`
}

// Native metadata access uses existing tenant/workspace permissions. Scope and identity
// come exclusively from the authenticated binding and HUMAN token, never from
// client-selected IDs. This is not Action admission or a reusable ticket.
type NativeHumanScopeQuery struct {
	Permission NativeHumanScopeQueryPermission `json:"permission"`
}

// POST /api/v1/actions 的语义命令。actionKey 由 Core 的 ActionDefinition 目录解析，未登记即 BLOCKED；各动作所需参数按
// actionKey 解释，多出或缺少的参数以 INVALID_PARAMETERS 拒绝。
type ActionCommand struct {
	ActionKey string `json:"actionKey"`
	// 仅 agent.definition.export（DD-131(2)、05 §2.12）：目标 Definition 的一个 PUBLISHED AgentVersion
	// 与包媒体类型；其他动作携带即拒绝。
	AgentDefinitionExport *AgentDefinitionExportInput `json:"agentDefinitionExport,omitempty"`
	// 仅 agent.definition.import（DD-131(2)、05 §2.12）：本会话上传的快照包引用、包 digest 与本 Tenant
	// 重选的运行配置；其他动作携带即拒绝。
	AgentDefinitionImport *AgentDefinitionImportInput `json:"agentDefinitionImport,omitempty"`
	// 仅 agent.team.create / agent.team.update 且必带（DD-131(1)、05 §2.12）；其他动作携带即拒绝。
	AgentTeam *AgentTeamInput `json:"agentTeam,omitempty"`
	// 仅 agent.team.export（DD-131(3)、05 §2.12）：团队快照包媒体类型；其他动作携带即拒绝。
	AgentTeamExport *AgentTeamExportInput `json:"agentTeamExport,omitempty"`
	// 仅 agent.team.import（DD-131(3)、05 §2.12）：本会话上传的团队快照包引用与包 digest；其他动作携带即拒绝。
	AgentTeamImport *AgentTeamImportInput `json:"agentTeamImport,omitempty"`
	// 仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
	AgentVersionContent       *AgentVersionContent      `json:"agentVersionContent,omitempty"`
	ApplicationBindingCreate  *ApplicationBindingCreate `json:"applicationBindingCreate,omitempty"`
	ApplicationBindingID      *string                   `json:"applicationBindingId,omitempty"`
	ApplicationBindingVersion *int64                    `json:"applicationBindingVersion,omitempty"`
	// AgentVersion 管理动作的目标 Asset；Core 核对父 Resource、Tenant、owner、版本与投影。
	AssetID *string `json:"assetId,omitempty"`
	// 调用方实际读取的 Asset 版本；旧版本不能改写新的草稿或发布事实。
	AssetVersion *int64 `json:"assetVersion,omitempty"`
	// 仅 automation.create / automation.publish_version：Core 自有版本内容；publish 产生新的不可变版本，不改写旧版本。
	AutomationVersionContent *AutomationVersionContent `json:"automationVersionContent,omitempty"`
	// 仅 application_binding.create 的瞬态输入（03 §9、DD-70）：按已批准 release 的 secretSchema 逐项提交 secret
	// 值，每个 secretKey 恰好一项。Core 在同一 Governed Action 的准入通过后写入该 Tenant 的 OpenBao namespace，只把版本号记成
	// SecretRef；值不进入 Params、ActionExecution、日志、Workflow history、AuditEvent 或回应。其他命令禁止携带。
	BindingSecretValues []ApplicationBindingSecretValue `json:"bindingSecretValues,omitempty"`
	// 仅 capability_contract.approve/deprecate：固定已登记版本。
	CapabilityContractRef *CapabilityContractRef `json:"capabilityContractRef,omitempty"`
	// 仅 capability_contract.register：真实 schema 与测试向量内容。
	CapabilityContractRegistration *CapabilityContractRegistration `json:"capabilityContractRegistration,omitempty"`
	ComponentAction                *ComponentActionInput           `json:"componentAction,omitempty"`
	// 仅组件批准：已登记的不可变ComponentRelease标识。
	ComponentReleaseID           *string                       `json:"componentReleaseId,omitempty"`
	ComponentReleaseRegistration *ComponentReleaseRegistration `json:"componentReleaseRegistration,omitempty"`
	ConversationOpen             *ConversationOpenRequest      `json:"conversationOpen,omitempty"`
	// 仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
	DelegationGrant *DelegationGrantParameters `json:"delegationGrant,omitempty"`
	// 显式 Delegation 管理的稳定 Grant ID；授予者提供新 ID，撤销引用实际已有 ID。
	DelegationID *string `json:"delegationId,omitempty"`
	// 仅 revoke：调用方实际读取的 Grant 版本。
	DelegationVersion *int64 `json:"delegationVersion,omitempty"`
	// 仅 automation.create：同一 Workspace 的确切 AgentInstallation Resource，不从名称或当前默认配置推断。
	ExecutorInstallationResourceID *string `json:"executorInstallationResourceId,omitempty"`
	// EXPLICIT 动作或 HUMAN owner 的一次手动 automation.run，由用户在当前目标详情上确认后设为 true；其他动作不得携带。手动运行只提交
	// resourceId/resourceVersion/workspaceId 与同一幂等键，不选择 Grant、Agent、来源或结果位置。
	ExplicitConfirmation *bool `json:"explicitConfirmation,omitempty"`
	// 仅 resource.grant_read/revoke_read：授予或收回的 permission，省略即 read。AGENT 接收者按其工具契约所需 permission
	// 授予（DD-122）；HUMAN 与 SERVICE 接收者只接受 read
	GrantPermission *ResourceGrantPermission `json:"grantPermission,omitempty"`
	HuddleAgent     *HuddleAgentInput        `json:"huddleAgent,omitempty"`
	// 仅 huddle.agent.add / huddle.agent.remove / huddle.end 且必带（DD-125(3)）：目标
	// HuddleBuzzBinding；父 Workspace 的 Huddle 另须 workspaceId 等于其父 Workspace。
	HuddleID    *string           `json:"huddleId,omitempty"`
	HuddleStart *HuddleStartInput `json:"huddleStart,omitempty"`
	// 调用方幂等键。同一发起者以同一键重发时回答原 operation；参数不同即 IDEMPOTENCY_KEY_REUSED
	IdempotencyKey string `json:"idempotencyKey"`
	// tenant.member.invite.revoke 的目标邀请
	InvitationID *string `json:"invitationId,omitempty"`
	// 仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
	LlmRouteCreate *LlmRouteCreateInput `json:"llmRouteCreate,omitempty"`
	// 仅 mcp_connection.create（DD-149、05 §2.15）且必带；其他动作携带即拒绝。
	MCPConnectionCreate *MCPConnectionCreate `json:"mcpConnectionCreate,omitempty"`
	// DD-149(5)：仅 mcp_connection.create 与 mcp_connection.rotate_credential 的瞬态凭据（API_KEY 或
	// BEARER）；Core 写入该 Tenant 的 OpenBao 后只保存 SecretRef，值不进入
	// parameters、ActionExecution、日志、审计或回应。其他命令禁止携带。
	MCPConnectionCredential *MCPConnectionCredentialInput `json:"mcpConnectionCredential,omitempty"`
	// 仅 mcp_connection.policy.update 且必带。
	MCPConnectionPolicyUpdate *MCPConnectionPolicyUpdate `json:"mcpConnectionPolicyUpdate,omitempty"`
	// 仅 mcp_connection.update 且必带；目标连接器由 resourceId 与 resourceVersion 给出。
	MCPConnectionUpdate *MCPConnectionUpdate `json:"mcpConnectionUpdate,omitempty"`
	// DD-149(6)：仅 OAUTH 连接器的 mcp_connection.rotate_credential：本人本会话已完成且未使用的授权尝试。
	MCPOauthAttemptID *string `json:"mcpOauthAttemptId,omitempty"`
	// 仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
	// 输入；其他命令禁止携带。
	MemoryWrite *AgentMemoryWriteInput `json:"memoryWrite,omitempty"`
	// 仅 moderation.message.delete 且必带（DD-125(2)）：workspaceId 所指 Workspace Channel 中一条消息的 Relay
	// 事件 ID；Core 以 CONTROL 回读确认属于该 Channel 后签 9005，按 DD-81 以 9005 事件 ID 对账。
	ModerationEventID *string `json:"moderationEventId,omitempty"`
	// 仅 moderation.ban / unban / timeout / untimeout 且必带（DD-125(2)）。targetPubkey
	// 是消息签名者或成员栏所列公钥，Core 解析为同 Tenant 非本人、非有效 Tenant admin 的 HUMAN Principal，并对其全部非 REVOKED 公钥由
	// CONTROL 签 9040–9043；AGENT 公钥以 PERMISSION_DENIED 拒绝（停用走
	// agent.installation.disable）。timeoutDuration 只随 moderation.timeout 且必带，到期时刻在准入时冻结。
	ModerationMember *ModerationMemberTarget `json:"moderationMember,omitempty"`
	// 仅 moderation.report.submit（DD-125(2)、05 §2.11）且必带：原举报对话框的一条消息举报。Core 在 workspaceId 或
	// conversationId（恰好一个）给出的本人当前可读范围内以本人身份回读 eventId，以其签名者为 p 目标（HUMAN 目标须同 Tenant），再以本人身份签
	// kind 1984（e 标签带 reportType）；note 去首尾空白后作为正文，空即省略。
	ModerationReport *ModerationReportSubmit `json:"moderationReport,omitempty"`
	// 仅 moderation.report.resolve 且必带（DD-125(2)）：同一目标的一组未结举报（1–100 条 kind 1984 事件
	// ID，不重复），CONTROL 逐条签 9044 并按举报状态回读；只记决定、不执法。dismiss 与 dismissed 配对，其余与 resolved 配对。
	ModerationResolution *ModerationReportResolution `json:"moderationResolution,omitempty"`
	// workspace.create 或 AgentDefinition 创建/更新的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
	Name *string `json:"name,omitempty"`
	// 任务控制只接收原 ActionExecution ID；原 Workflow、target 与 scope 由 Core 解析。Agent
	// 回合中断（task.cancel.agent.invoke.v1）的发起人可以是原发起人或该 Installation manage 持有人（DD-125(6) 扩展
	// DD-84），其余规则不变
	OriginalActionExecutionID *string `json:"originalActionExecutionId,omitempty"`
	// 成员动作的目标 Principal；resource.transfer_owner 的新 owner；resource.grant_read/revoke_read 的同
	// Tenant 接收者，Core 核对真实 HUMAN 成员、原 AGENT Installation 或 receiverResource 所属 SERVICE
	PrincipalID *string `json:"principalId,omitempty"`
	// Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
	// identity; no Agent or caller-selected native credentials.
	ProtocolSessionOpen *ProtocolSessionOpenInput `json:"protocolSessionOpen,omitempty"`
	// 仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
	// 核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略时，原 AGENT Installation 仍只接受自身 AGENT；组件
	// Resource 接收者必须是同 Tenant 的 HUMAN，授予时重新核对有效成员与目标 scope。
	ReceiverResource *ActionCommandReceiverResource `json:"receiverResource,omitempty"`
	ResourceCreate   *ResourceCreate                `json:"resourceCreate,omitempty"`
	// Resource 管理动作的目标；Core 重新核对同 Tenant、scope、owner 和投影。agent.installation.disable /
	// agent.installation.enable（DD-125(6)、05 §2.11）只带 resourceId、resourceVersion 与
	// explicitConfirmation=true：目标 Workspace 由 Installation 的 home Workspace
	// 解析（TARGET_HOME_WORKSPACE），不接受 workspaceId、assetId 或其他参数；原“重启”是 assetId 等于固定 Version 的
	// agent.installation.upgrade
	ResourceID *string `json:"resourceId,omitempty"`
	// 调用方实际读取的 Resource 版本；与当前事实不同即 CONFLICT
	ResourceVersion *int64 `json:"resourceVersion,omitempty"`
	// 仅 skill.version.create（DD-135(3)）：本会话一次性上传引用与能力需求；其他动作携带即拒绝。
	SkillVersionUpload *SkillVersionUploadInput `json:"skillVersionUpload,omitempty"`
	// workspace.create 或 agent.definition.create 的稳定 slug
	Slug *string `json:"slug,omitempty"`
	// 仅 agent.invoke 人工分派：本人在该 Workspace Channel 已持久发布的消息 ID；Core 回读验签并与普通 mention 共用源事件幂等。
	SourceEventID *string `json:"sourceEventId,omitempty"`
	// tenant.suspend / tenant.restore 的目标业务 Tenant；执行 Tenant 仍是会话 Tenant（Platform Catalog）
	TenantID *string `json:"tenantId,omitempty"`
	// 仅 tenant.profile.update（DD-158(3)）且必带；其他动作携带即拒绝。
	TenantProfile *TenantProfileInput `json:"tenantProfile,omitempty"`
	// 仅 tenant.quota.set（DD-123）
	TenantQuotaSetting *TenantQuotaSetting `json:"tenantQuotaSetting,omitempty"`
	// 仅 workspace.canvas.set 且必带（DD-125(4)）：目标 Workspace 由 workspaceId 给出，须带
	// explicitConfirmation=true；正文是瞬态输入，只冻结摘要。其他命令禁止携带。
	WorkspaceCanvas  *WorkspaceCanvasSetInput `json:"workspaceCanvas,omitempty"`
	WorkspaceChannel *WorkspaceChannelCreate  `json:"workspaceChannel,omitempty"`
	// Workspace 内动作的执行 Workspace
	WorkspaceID *string `json:"workspaceId,omitempty"`
	// 仅 workspace.update 使用且必带，目标 Workspace 由 workspaceId 给出；该动作不接受顶层 name、workspaceVisibility
	// 或 workspaceChannel。workspace.leave 只带 workspaceId，主体固定为发起人，不接受 principalId。
	WorkspaceUpdate *WorkspaceUpdate `json:"workspaceUpdate,omitempty"`
	// 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
	WorkspaceVisibility *WorkspaceVisibility `json:"workspaceVisibility,omitempty"`
}

// 仅 agent.definition.export（DD-131(2)、05 §2.12）：目标 Definition 的一个 PUBLISHED AgentVersion
// 与包媒体类型；其他动作携带即拒绝。
//
// 仅 agent.definition.export（DD-131(2)、05 §2.12）：命令的 Resource 目标是 AgentDefinition，这里冻结其一个
// PUBLISHED AgentVersion 与包的媒体类型。包只含可移植字段，不含
// owner、公钥、Installation、绑定、llm_route、RuntimeProfile、Delegation、记忆或任何 SecretRef。
type AgentDefinitionExportInput struct {
	MediaType      AgentSnapshotMediaType `json:"mediaType"`
	VersionAssetID string                 `json:"versionAssetId"`
}

// 仅 agent.definition.import（DD-131(2)、05 §2.12）：本会话上传的快照包引用、包 digest 与本 Tenant
// 重选的运行配置；其他动作携带即拒绝。
//
// 仅 agent.definition.import（DD-131(2)、05 §2.12）：引用本 PlatformSession、本人的一次性快照上传与其包字节
// SHA-256；包不携带运行时与模型路由（DD-26）。导入时不强制选择：所给的 Profile 与 Route 在准入与 Workflow 内各自重验，缺省的由 owner
// 发布前在版本编辑器补齐（DD-131(2)）。
type AgentDefinitionImportInput struct {
	ModelRouteResourceID *string `json:"modelRouteResourceId,omitempty"`
	// 上传返回的包字节 SHA-256；准入与 Workflow 读取包时重算比对。
	PackageDigest     string  `json:"packageDigest"`
	RuntimeProfileKey *string `json:"runtimeProfileKey,omitempty"`
	UploadID          string  `json:"uploadId"`
}

// 仅 agent.team.create / agent.team.update 且必带（DD-131(1)、05 §2.12）；其他动作携带即拒绝。
//
// 仅 agent.team.create / agent.team.update 且必带（DD-131(1)、05 §2.12）：Tenant 级 Agent
// 团队的名称、说明与有序成员。成员是同 Tenant、发起人当前可 read 的 AgentDefinition Resource，按给出次序保存、不重复、至多 64
// 个（沿原团队目录上限）；不含原版团队级 instructions、内置 welcome 团队或任何运行配置。update 另带 resourceId 与读到的
// resourceVersion 做 CAS。
type AgentTeamInput struct {
	// 可选说明，至多 2000 字符；去首尾空白后为空即省略
	Description            *string  `json:"description,omitempty"`
	MemberAgentResourceIDS []string `json:"memberAgentResourceIds"`
	// 去首尾空白后非空，至多 200 字符
	Name string `json:"name"`
}

// 仅 agent.team.export（DD-131(3)、05 §2.12）：团队快照包媒体类型；其他动作携带即拒绝。
//
// 仅 agent.team.export（DD-131(3)、05 §2.12）：命令的 Resource 目标是
// agent_team，这里只冻结包媒体类型。各成员取审批开始时冻结的当前已发布版本；包是团队信息加各成员的 DD-131(2) 清单，不含团队
// instructions、owner、公钥、Installation、绑定、llm_route、RuntimeProfile、记忆或任何 SecretRef。
type AgentTeamExportInput struct {
	MediaType AgentSnapshotMediaType `json:"mediaType"`
}

// 仅 agent.team.import（DD-131(3)、05 §2.12）：本会话上传的团队快照包引用与包 digest；其他动作携带即拒绝。
//
// 仅 agent.team.import（DD-131(3)、05 §2.12）：本会话、本人上传的 buzz-team-snapshot@1 包引用与包
// digest。agent_team 没有 slug；各成员 Definition 的 slug 由 Core 按成员显示名规范化生成并在本 Tenant 内加序号去重。成员
// DRAFT 不带运行配置，由 owner 发布前补齐。
type AgentTeamImportInput struct {
	PackageDigest string `json:"packageDigest"`
	UploadID      string `json:"uploadId"`
}

// DD-88/94：pin 已批准 release 的业务绑定选择。不接受密钥正文、调用方自选 SecretRef 或运行端点 URL；secret 值只经同一
// ActionCommand 的瞬态 bindingSecretValues 提交（03 §9）。Workspace 取原 ActionCommand。
type ApplicationBindingCreate struct {
	AdapterServiceRef    string                           `json:"adapterServiceRef"`
	BindingID            string                           `json:"bindingId"`
	CallIdentityMode     ApplicationCallIdentityMode      `json:"callIdentityMode"`
	CapabilityCategories []ApplicationCapabilitySelection `json:"capabilityCategories"`
	ComponentReleaseID   string                           `json:"componentReleaseId"`
	IsolationMode        ApplicationIsolationMode         `json:"isolationMode"`
	ModelCallMode        ApplicationModelCallMode         `json:"modelCallMode"`
	NativeInstanceRef    string                           `json:"nativeInstanceRef"`
	NativeScopeRef       *string                          `json:"nativeScopeRef,omitempty"`
	NormalizedConfigJSON string                           `json:"normalizedConfigJson"`
	RetainOnTenantDelete bool                             `json:"retainOnTenantDelete"`
	// 必须为空数组。binding 的 SecretRef 只由 Core 在本动作内把 bindingSecretValues 写入该 Tenant OpenBao
	// namespace 的 application-binding/<bindingId>/<secretKey> 后按返回版本生成；调用方提供的 locator/version
	// 一律拒绝（03 §9，不以运维旁路写入的 KV 冒充受治理写入）。
	SecretRefs         []ApplicationBindingSecretRef `json:"secretRefs"`
	ServicePrincipalID string                        `json:"servicePrincipalId"`
}

type ApplicationCapabilitySelection struct {
	Category string `json:"category"`
	Version  int64  `json:"version"`
}

type ApplicationBindingSecretRef struct {
	Audience  string `json:"audience"`
	Locator   string `json:"locator"`
	SecretKey string `json:"secretKey"`
	Version   int64  `json:"version"`
}

type ApplicationBindingSecretValue struct {
	SecretKey string `json:"secretKey"`
	Value     string `json:"value"`
}

// 仅 capability_contract.approve/deprecate：固定已登记版本。
//
// 固定 Catalog 自然键，不授予业务能力 consume 权限。
type CapabilityContractRef struct {
	CategoryKey     string `json:"categoryKey"`
	ContractVersion int64  `json:"contractVersion"`
}

// 仅 capability_contract.register：真实 schema 与测试向量内容。
//
// DD-102：平台管理员登记实际 schema 与一致性测试向量。Core 按实际 canonical JSON 计算摘要并固定原内容；不接受只填摘要。
type CapabilityContractRegistration struct {
	CategoryKey               string                                                  `json:"categoryKey"`
	ContentReferenceSemantics CapabilityContractRegistrationContentReferenceSemantics `json:"contentReferenceSemantics"`
	ContractVersion           int64                                                   `json:"contractVersion"`
	OperationContracts        []CapabilityContractRegistrationOperationContractsItem  `json:"operationContracts"`
	ProtocolSessionKinds      []string                                                `json:"protocolSessionKinds"`
	RequiredDeclarations      []CapabilityRequiredDeclaration                         `json:"requiredDeclarations"`
	ResourceTypeFamily        []CapabilityContractRegistrationResourceTypeFamilyItem  `json:"resourceTypeFamily"`
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

type CapabilityContractRegistrationOperationContractsItem struct {
	ContractKey        string               `json:"contractKey"`
	InputSchemaDigest  string               `json:"inputSchemaDigest"`
	OutputSchemaDigest string               `json:"outputSchemaDigest"`
	Permission         CapabilityPermission `json:"permission"`
	Surface            CapabilitySurface    `json:"surface"`
	TargetType         string               `json:"targetType"`
}

type CapabilityContractRegistrationResourceTypeFamilyItem struct {
	Kind    string `json:"kind"`
	TypeKey string `json:"typeKey"`
}

// Kailo HUMAN 通过原 ActionCommand 调用确切 APPLICATION 能力动作。inputReference 或 inputJson 恰一：前者保持持久
// ContentReference，后者是原登记能力 inputSchema 的规范化元数据参数，不把 SQL、提示或结果正文写入 Core/Temporal。Core
// 仍校验原目标、能力 schema、审批和用量。
type ComponentActionInput struct {
	ActionVersion int64 `json:"actionVersion"`
	// Canonical JSON for the existing registered capability input schema; mutually exclusive
	// with inputReference, validated before AE admission.
	InputJSON                   *string           `json:"inputJson,omitempty"`
	InputReference              *ContentReference `json:"inputReference,omitempty"`
	ResultExposurePolicyID      string            `json:"resultExposurePolicyId"`
	ResultExposurePolicyVersion int64             `json:"resultExposurePolicyVersion"`
}

// 组件登记只提交实际 manifest、包清单与 binding config schema；不接收 suite 通过声明、报告或候选执行地址。Core 解析并冻结内容，原
// Worker 独立执行隔离套件。
type ComponentReleaseRegistration struct {
	BindingConfigSchemaJSON string `json:"bindingConfigSchemaJson"`
	ManifestJSON            string `json:"manifestJson"`
	PackageJSON             string `json:"packageJson"`
}

// 原生私聊的完整 HUMAN Principal 参与者集合，必须包含当前 HUMAN；不接受设备公钥、CONTROL 身份或 Workspace 冒名。
type ConversationOpenRequest struct {
	ParticipantPrincipalIDS []string `json:"participantPrincipalIds"`
}

// 仅 huddle.agent.add / huddle.agent.remove（DD-125(3)）且必带，目标 Huddle 由 ActionCommand.huddleId
// 给出。加入要求父 Workspace 中 ACTIVE、有 ChannelAgentBinding 且本人有 execute 的 Installation，Tenant
// CONTROL 以 9000 role=bot 投影并回读；移除另接受父 Workspace manage，CONTROL 以 9001 移出并回读。私聊父的 Huddle 没有
// Agent。
type HuddleAgentInput struct {
	AgentInstallationResourceID string `json:"agentInstallationResourceId"`
}

// 仅 huddle.start（DD-125(3)、05 §2.11）且必带：在父 Workspace 或父私聊中发起原版 Huddle。parentWorkspaceId 与
// parentConversationId 恰有一个：前者要求执行 Workspace 即该 Workspace（discover），后者要求本人是该私聊当前参与者。Core
// 预分配 HuddleBuzzBinding 与临时 Channel UUID，由 Tenant CONTROL 以带 creator 的
// 9007（private、stream、ttl=3600）投影临时频道，并以 9000 role=bot 加入所选 Agent；私聊父不接受
// Agent。creatorPubkey 是本人发起会话的 ACTIVE HUMAN 公钥（原生端为该设备 CLIENT 公钥），省略即本人 SERVER
// 公钥（Web）；它是临时频道的 created_by，也是唯一可签 48100/48106 的公钥。
type HuddleStartInput struct {
	// 原 Add agents 所选 Agent（至多 20 个，沿原 MAX_HUDDLE_AGENTS）：父 Workspace 中 ACTIVE、有
	// ChannelAgentBinding 且本人有 execute 的 Installation
	AgentInstallationResourceIDS []string `json:"agentInstallationResourceIds,omitempty"`
	// 原 buildHuddleChannelName 生成的临时频道名
	ChannelName string `json:"channelName"`
	// 64 位小写十六进制 Nostr 公钥；省略即本人 SERVER 公钥
	CreatorPubkey *string `json:"creatorPubkey,omitempty"`
	// 父私聊（ConversationBuzzBinding id）
	ParentConversationID *string `json:"parentConversationId,omitempty"`
	// 父 Workspace；须等于 ActionCommand.workspaceId
	ParentWorkspaceID *string `json:"parentWorkspaceId,omitempty"`
}

// 仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
//
// 受治理 Route 创建只传原生配置与同 Tenant OpenBao 凭据的确切引用。providerCredentialMode 必须明确提供：NONE
// 仅表示固定原生提供方配置不使用认证；SECRET_REF 必须有确切引用。端点、模型正文与 key 不进入 Core 参数。
type LlmRouteCreateInput struct {
	Model                  LlmRouteCreateInputNativeSource       `json:"model"`
	Provider               LlmRouteCreateInputNativeSource       `json:"provider"`
	ProviderCredentialMode LlmProviderCredentialMode             `json:"providerCredentialMode"`
	ProviderSecretRef      *LlmRouteCreateInputProviderSecretRef `json:"providerSecretRef,omitempty"`
}

type LlmRouteCreateInputNativeSource struct {
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
	Sha256   string `json:"sha256"`
}

type LlmRouteCreateInputProviderSecretRef struct {
	Audience string `json:"audience"`
	Locator  string `json:"locator"`
	Version  int64  `json:"version"`
}

// 仅 mcp_connection.create（DD-149、05 §2.15）且必带；其他动作携带即拒绝。
//
// 仅 mcp_connection.create（DD-149、05 §2.15）：端点、认证方式、可见范围与确认的工具清单。凭据值只经
// ActionCommand.mcpConnectionCredential 一次性提交；OAuth 只引用本人本会话已完成的授权尝试。
type MCPConnectionCreate struct {
	// 仅 API_KEY：小写 header 名
	APIKeyHeader *string               `json:"apiKeyHeader,omitempty"`
	AuthMode     MCPConnectionAuthMode `json:"authMode"`
	// 连接器显示名，1–80 字符
	DisplayName string `json:"displayName"`
	// https 端点；不含 userinfo、query 与 fragment
	EndpointURL string `json:"endpointUrl"`
	// 仅 OAUTH：本人本会话已完成且未使用的授权尝试
	OauthAttemptID *string `json:"oauthAttemptId,omitempty"`
	// OAUTH 且可见范围不是 PERSONAL 时必须为 true：同意其他人的 Agent 以本人授权调用
	SharedAuthorizationConsent *bool              `json:"sharedAuthorizationConsent,omitempty"`
	Tools                      []MCPToolSelection `json:"tools"`
	// 确认时探测结果的清单摘要；提交时 Core 重新探测比对
	ToolsDigest string                  `json:"toolsDigest"`
	Transport   MCPConnectionTransport  `json:"transport"`
	Visibility  MCPConnectionVisibility `json:"visibility"`
	// 仅 WORKSPACE 可见范围：所属 Workspace
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// DD-149(7)：确认清单中的一个上游工具。未列出的上游工具即不启用。
type MCPToolSelection struct {
	CallPolicy MCPToolCallPolicy `json:"callPolicy"`
	Enabled    bool              `json:"enabled"`
	Risk       MCPToolRisk       `json:"risk"`
	// 风险等级低于 annotations 建议时必须为 true，作为管理员声明冻结进审计
	RiskDeclared *bool `json:"riskDeclared,omitempty"`
	// 上游 tools/list 中的工具名，原样
	UpstreamName string `json:"upstreamName"`
}

// 仅 mcp_connection.policy.update 且必带。
//
// 仅 mcp_connection.policy.update：Tenant 连接器策略；白名单条目须落在部署声明的出站上限内。
type MCPConnectionPolicyUpdate struct {
	// 小写主机名后缀；空表示只受部署上限约束
	EgressHostSuffixes []string              `json:"egressHostSuffixes"`
	MemberRegistration MCPMemberRegistration `json:"memberRegistration"`
}

// 仅 mcp_connection.update 且必带；目标连接器由 resourceId 与 resourceVersion 给出。
//
// 仅 mcp_connection.update：以新探测结果重新确认工具清单、风险、策略与可见范围，形成新 generation。
type MCPConnectionUpdate struct {
	SharedAuthorizationConsent *bool                   `json:"sharedAuthorizationConsent,omitempty"`
	Tools                      []MCPToolSelection      `json:"tools"`
	ToolsDigest                string                  `json:"toolsDigest"`
	Visibility                 MCPConnectionVisibility `json:"visibility"`
	// 仅 WORKSPACE 可见范围
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// 仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
// 输入；其他命令禁止携带。
//
// HUMAN Memory Action 本次瞬态输入；正文仅用于原生 NIP-AE 构造，不进入 ActionExecution、审计、outbox 或 history。
type AgentMemoryWriteInput struct {
	// entry.patch 当前原生 value 的 SHA-256。
	BaseHash *string `json:"baseHash,omitempty"`
	// 调用方实际读取的 head；null 只表示原生确认不存在。
	ExpectedHeadEventID *string `json:"expectedHeadEventId,omitempty"`
	// 原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
	ExpectedHeadState AgentMemoryWriteInputExpectedHeadState `json:"expectedHeadState"`
	// entry.patch 的原生严格 unified diff，不支持 fuzz、offset 或多文件。
	Patch *string `json:"patch,omitempty"`
	Slug  string  `json:"slug"`
	// core.replace 的 profile 或 entry.set 的 value；完整序列化 JSON body 必须满足原生 NIP-44 上界。
	Value *string `json:"value,omitempty"`
}

// 仅 moderation.ban / unban / timeout / untimeout 且必带（DD-125(2)）。targetPubkey
// 是消息签名者或成员栏所列公钥，Core 解析为同 Tenant 非本人、非有效 Tenant admin 的 HUMAN Principal，并对其全部非 REVOKED 公钥由
// CONTROL 签 9040–9043；AGENT 公钥以 PERMISSION_DENIED 拒绝（停用走
// agent.installation.disable）。timeoutDuration 只随 moderation.timeout 且必带，到期时刻在准入时冻结。
type ModerationMemberTarget struct {
	// 64 位小写十六进制 Nostr 公钥
	TargetPubkey    string                     `json:"targetPubkey"`
	TimeoutDuration *ModerationTimeoutDuration `json:"timeoutDuration,omitempty"`
}

// 仅 moderation.report.submit（DD-125(2)、05 §2.11）且必带：原举报对话框的一条消息举报。Core 在 workspaceId 或
// conversationId（恰好一个）给出的本人当前可读范围内以本人身份回读 eventId，以其签名者为 p 目标（HUMAN 目标须同 Tenant），再以本人身份签
// kind 1984（e 标签带 reportType）；note 去首尾空白后作为正文，空即省略。
type ModerationReportSubmit struct {
	// 消息所在私聊；本人须为其当前参与者
	ConversationID *string `json:"conversationId,omitempty"`
	// 被举报消息的 Relay 事件 ID（64 位小写十六进制）
	EventID string `json:"eventId"`
	// 原“补充说明（可选）”，至多 1000 字符
	Note       *string              `json:"note,omitempty"`
	ReportType ModerationReportType `json:"reportType"`
	// 消息所在 Workspace Channel；本人须为其当前成员
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// 仅 moderation.report.resolve 且必带（DD-125(2)）：同一目标的一组未结举报（1–100 条 kind 1984 事件
// ID，不重复），CONTROL 逐条签 9044 并按举报状态回读；只记决定、不执法。dismiss 与 dismissed 配对，其余与 resolved 配对。
type ModerationReportResolution struct {
	ReportEventIDS   []string                   `json:"reportEventIds"`
	ResolutionAction ModerationResolutionAction `json:"resolutionAction"`
	Status           ModerationResolutionStatus `json:"status"`
}

// Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
// identity; no Agent or caller-selected native credentials.
//
// 03/07/18: the original HUMAN file protocol action, not an arbitrary editor or native URL.
// Revision and presentation are frozen once; session expiry comes from controlled Core
// delivery.
type ProtocolSessionOpenInput struct {
	ActionVersion int64 `json:"actionVersion"`
	// The selected native source binding; must equal the target's real binding, not an
	// authorization claim.
	ApplicationBindingID string                `json:"applicationBindingId"`
	Locale               ProtocolSessionLocale `json:"locale"`
	// Exact approved projection selected by the native menu; never latest.
	ProjectionGeneration int64                `json:"projectionGeneration"`
	Reference            ContentReference     `json:"reference"`
	Theme                ProtocolSessionTheme `json:"theme"`
}

// 仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
// 核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略时，原 AGENT Installation 仍只接受自身 AGENT；组件
// Resource 接收者必须是同 Tenant 的 HUMAN，授予时重新核对有效成员与目标 scope。
type ActionCommandReceiverResource struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
}

type ResourceCreate struct {
	EvidenceDigest string `json:"evidenceDigest"`
	EvidenceRef    string `json:"evidenceRef"`
	NativeRef      string `json:"nativeRef"`
	NativeType     string `json:"nativeType"`
	TypeKey        string `json:"typeKey"`
}

// 仅 skill.version.create（DD-135(3)）：本会话一次性上传引用与能力需求；其他动作携带即拒绝。
//
// 仅 skill.version.create（DD-135(3)）：引用本 PlatformSession、本人、目标定义的一次性上传及其规范 artifact
// digest；能力需求只声明契约键与版本，不授予工具。
type SkillVersionUploadInput struct {
	// 上传返回的规范 SKILL.md SHA-256（64 位小写十六进制）；准入事务内重算比对。
	ArtifactDigest string `json:"artifactDigest"`
	// contract_key@version，去重；须是引用它的 AgentVersion 能力需求的子集。
	CapabilityRequirements []string `json:"capabilityRequirements"`
	UploadID               string   `json:"uploadId"`
}

// 仅 tenant.profile.update（DD-158(3)）且必带；其他动作携带即拒绝。
//
// 仅 tenant.profile.update 且必带（DD-158(3)、05 §2.11）：Tenant 显示名与图标。name 去首尾空白后 1–64 字符；icon
// 是客户端按原版缩到 256 px 的 PNG/JPEG/WebP data URL（≤96 KiB）或单个 emoji；clearIcon=true 清除图标且不得同时给
// icon。至少给出一项；目标固定为会话 Tenant，按 resourceVersion（读到的 Tenant version）CAS。
type TenantProfileInput struct {
	ClearIcon *bool   `json:"clearIcon,omitempty"`
	Icon      *string `json:"icon,omitempty"`
	Name      *string `json:"name,omitempty"`
}

// 仅 tenant.quota.set（DD-123）
//
// DD-123/DD-163: tenant.quota.set parameters. Writes only the Tenant Customer's hard-limit
// OpenMeter entitlement for the platform feature, resetting monthly; memberLimitPerPeriod
// (only knowledge_answers and data_queries) is the per-member cap kept in the same
// entitlement's metadata. A setting without it removes the member cap.
type TenantQuotaSetting struct {
	Feature        TenantQuotaFeature `json:"feature"`
	LimitPerPeriod int64              `json:"limitPerPeriod"`
	// DD-163(3): per-member cap per period; only for quota items with a member dimension
	// (knowledge_answers, data_queries).
	MemberLimitPerPeriod *int64 `json:"memberLimitPerPeriod,omitempty"`
}

// 仅 workspace.canvas.set 且必带（DD-125(4)）：目标 Workspace 由 workspaceId 给出，须带
// explicitConfirmation=true；正文是瞬态输入，只冻结摘要。其他命令禁止携带。
//
// 仅 workspace.canvas.set（DD-125(4)、05 §2.11）的瞬态输入：原频道 Canvas 的 Markdown 正文（SF-BUZ-54，UTF-8
// 不超过 64 KiB，空串即原“清空”）。Core 只用它签 Tenant CONTROL 的 kind 40100 并按 DD-81 对账；正文不进入
// Params、ActionExecution、审计、日志或 Workflow history，只冻结其 SHA-256 与字节数，同一幂等键重发须携带同一正文。
type WorkspaceCanvasSetInput struct {
	Content string `json:"content"`
}

// workspace.create 的 Buzz 原生频道元数据。只用于创建时向 Relay 物化，不建立第二份频道内容权威。缺省保留旧命令的 stream 行为。
type WorkspaceChannelCreate struct {
	ChannelType WorkspaceChannelCreateChannelType `json:"channelType"`
	Description *string                           `json:"description,omitempty"`
	// 原 Buzz 临时频道的不活跃期限（秒）。省略为长期频道；Relay 原生消息活动续期，原生 reaper 到期归档，不表示 Workspace 暂停或删除。
	TTLSeconds *int64 `json:"ttlSeconds,omitempty"`
}

// 仅 workspace.update 使用且必带，目标 Workspace 由 workspaceId 给出；该动作不接受顶层 name、workspaceVisibility
// 或 workspaceChannel。workspace.leave 只带 workspaceId，主体固定为发起人，不接受 principalId。
//
// workspace.update 的冻结目标状态（DD-119）。至少给出 name、description、ttlSeconds/clearTtl、visibility
// 之一，或只给 reopen=true；省略的字段保持不变。Core 在 Admission 校验组合，空集、ttlSeconds 与 clearTtl 同时出现、reopen
// 与其他字段混用或取 false 均以 INVALID_PARAMETERS 拒绝。stream/forum 类型只在创建时设定，不可编辑；slug 不变。
type WorkspaceUpdate struct {
	// 只能为 true：清除 TTL 改为长期频道（原 9002 空 ttl 标签）；与 ttlSeconds 互斥。
	ClearTTL *bool `json:"clearTtl,omitempty"`
	// 原 9002 about；空字符串清空描述。
	Description *string `json:"description,omitempty"`
	// 新的频道与 Workspace 显示名；CONTROL 9002 回读 39000 一致后才在同一事务提交 Core 的 Workspace 名称。
	Name *string `json:"name,omitempty"`
	// 只能为 true 且单独出现：解档被原生 reaper 按 TTL 到期归档的 Channel。要求 Workspace ACTIVE、回读 archived=true 且设有
	// TTL，CONTROL 发 archived=false 后回读确认；主动归档仍用 workspace.suspend/restore。
	Reopen *bool `json:"reopen,omitempty"`
	// 设置原 Buzz 临时频道的不活跃期限（秒）。
	TTLSeconds *int64 `json:"ttlSeconds,omitempty"`
	// 只在准入事务内改写 Core 的 Workspace 可见性；已有成员不变，不写 SpiceDB，Relay 投影保持 private、不发送 visibility 标签。
	Visibility *WorkspaceVisibility `json:"visibility,omitempty"`
}

// Same-request writer admission for the original dispatched AE/EE and native intent, never
// another execute. Both the binding SERVICE and independent current HUMAN credentials are
// required.
type NativeHumanActionRequestNativeExecutionAdmission struct {
	ActionExecutionID   string `json:"actionExecutionId"`
	ExternalExecutionID string `json:"externalExecutionId"`
	NativeIntentID      string `json:"nativeIntentId"`
}

// Original HUMAN synchronous application read completion, authenticated by its binding
// SERVICE. Metadata only; no body, replacement identity, native Task or ExternalExecution.
type NativeHumanReadReceipt struct {
	CompletedAt     string                                   `json:"completedAt"`
	ContentBytes    int64                                    `json:"contentBytes"`
	ContentSha256   string                                   `json:"contentSha256"`
	IdempotencyKey  string                                   `json:"idempotencyKey"`
	Measurements    []NativeHumanReadReceiptMeasurementsItem `json:"measurements"`
	NativeObjectRef string                                   `json:"nativeObjectRef"`
	NativeRevision  string                                   `json:"nativeRevision"`
	OperationID     string                                   `json:"operationId"`
	StartedAt       string                                   `json:"startedAt"`
}

type NativeHumanReadReceiptMeasurementsItem struct {
	MeterKey string `json:"meterKey"`
	Quantity int64  `json:"quantity"`
}

// Read the already-registered exact native object for the verified HUMAN and action. This
// never creates a Resource or native object.
type NativeHumanResourceQuery struct {
	ActionKey     string  `json:"actionKey"`
	ActionVersion int64   `json:"actionVersion"`
	NativeRef     string  `json:"nativeRef"`
	NativeType    string  `json:"nativeType"`
	WorkspaceID   *string `json:"workspaceId,omitempty"`
}

// Reference-only observation of the original HUMAN AE. Component terminal status comes from
// original component-action audit after native/usage reconciliation. Native-origin platform
// resource permission actions use their exact permission-outcome audit; that outcome does
// not assert completion of a component's native sharing RPCs. Never infer a terminal result
// from HTTP acceptance.
type NativeHumanActionResult struct {
	// Original admitted canonical capability metadata input; exactly one input form, never a
	// result body or a new execution authority.
	InputJSON      *string           `json:"inputJson,omitempty"`
	InputReference *ContentReference `json:"inputReference,omitempty"`
	// Original dispatched native-writer reference only. Neither existence nor RUNNING proves
	// byte completion; no bearer is exposed by observation.
	NativeExecution *NativeHumanActionResultNativeExecution `json:"nativeExecution,omitempty"`
	// Transient same-request writer bearer for the exact original AE/EE. The native task must
	// atomically claim the byte step before using it; never persisted or exposed to the browser.
	NativeExecutionAdmission *NativeHumanActionResultNativeExecutionAdmission `json:"nativeExecutionAdmission,omitempty"`
	NativeID                 *string                                          `json:"nativeId,omitempty"`
	NativeType               *string                                          `json:"nativeType,omitempty"`
	// First native same-request read only. Never returned by idempotency observation or retried
	// admission; the bearer is not persisted.
	ReadAdmission  *NativeHumanActionResultReadAdmission `json:"readAdmission,omitempty"`
	Submission     ActionSubmission                      `json:"submission"`
	TerminalStatus *TaskStatus                           `json:"terminalStatus,omitempty"`
}

// Original dispatched native-writer reference only. Neither existence nor RUNNING proves
// byte completion; no bearer is exposed by observation.
type NativeHumanActionResultNativeExecution struct {
	BindingGeneration   int64  `json:"bindingGeneration"`
	ExternalExecutionID string `json:"externalExecutionId"`
	IdempotencyKey      string `json:"idempotencyKey"`
	NativeIntentID      string `json:"nativeIntentId"`
}

// Transient same-request writer bearer for the exact original AE/EE. The native task must
// atomically claim the byte step before using it; never persisted or exposed to the browser.
type NativeHumanActionResultNativeExecutionAdmission struct {
	ActionToken   string `json:"actionToken"`
	ArgumentsJSON string `json:"argumentsJson"`
	// RFC3339 admission expiry, preserved verbatim across language bindings and validated by
	// the native writer before every byte step.
	ExpiresAt string `json:"expiresAt"`
}

// First native same-request read only. Never returned by idempotency observation or retried
// admission; the bearer is not persisted.
type NativeHumanActionResultReadAdmission struct {
	ActionToken   string `json:"actionToken"`
	ArgumentsJSON string `json:"argumentsJson"`
	ExpiresAt     int64  `json:"expiresAt"`
}

// Current already-registered native Resource selected under the original HUMAN action
// permission. Metadata only, not an admission ticket; submission rechecks version, binding
// and permission.
type NativeHumanResourceResult struct {
	Resource NativeHumanResourceSelection `json:"resource"`
}

type NativeHumanResourceSelection struct {
	NativeInstanceRef string `json:"nativeInstanceRef"`
	NativeRef         string `json:"nativeRef"`
	NativeScopeRef    string `json:"nativeScopeRef"`
	NativeType        string `json:"nativeType"`
	ResourceID        string `json:"resourceId"`
	ResourceVersion   int64  `json:"resourceVersion"`
}

// Fresh permission check for native metadata in the authenticated binding's existing
// tenant/workspace scope. Not an ActionExecution, permission cache, or execution ticket;
// native Resource bodies still require their own current read permission.
type NativeHumanScopeResult struct {
	Scope NativeHumanScopeSelection `json:"scope"`
}

type NativeHumanScopeSelection struct {
	BindingID         string                          `json:"bindingId"`
	CheckedRevision   string                          `json:"checkedRevision"`
	Generation        int64                           `json:"generation"`
	NativeInstanceRef string                          `json:"nativeInstanceRef"`
	NativeScopeRef    string                          `json:"nativeScopeRef"`
	Permission        NativeHumanScopeQueryPermission `json:"permission"`
	TenantID          string                          `json:"tenantId"`
	WorkspaceID       *string                         `json:"workspaceId,omitempty"`
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

// DD-158(2)：GET /api/v1/platform/feedback 的有界回应，只对 Platform Catalog Tenant 中持有 fresh
// Catalog manage 的会话开放；读取受审计。图片经 GET /api/v1/platform/feedback/{feedbackId}/attachment 取回。
type PlatformFeedbackPage struct {
	Items []PlatformFeedbackView `json:"items"`
	// 下一页偏移，缺省即读完
	NextOffset *int64 `json:"nextOffset,omitempty"`
}

type PlatformFeedbackView struct {
	Attachment  *FeedbackAttachmentView `json:"attachment,omitempty"`
	Category    *FeedbackCategory       `json:"category,omitempty"`
	Client      FeedbackClient          `json:"client"`
	CreatedAt   string                  `json:"createdAt"`
	Diagnostics *string                 `json:"diagnostics,omitempty"`
	FeedbackID  string                  `json:"feedbackId"`
	Message     string                  `json:"message"`
	State       FeedbackState           `json:"state"`
	TenantID    string                  `json:"tenantId"`
	TenantName  string                  `json:"tenantName"`
	Version     int64                   `json:"version"`
}

type FeedbackAttachmentView struct {
	ByteSize int64  `json:"byteSize"`
	MIMEType string `json:"mimeType"`
	Sha256   string `json:"sha256"`
}

// DD-158(2)：PUT /api/v1/platform/feedback/{feedbackId}。运营方按读到的 version CAS
// 前移分拣状态（NEW→TRIAGED→CLOSED，不可回退）。
type PlatformFeedbackTriageRequest struct {
	State   FeedbackState `json:"state"`
	Version int64         `json:"version"`
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
	NextOffset *int64             `json:"nextOffset,omitempty"`
	Tools      []PlatformToolView `json:"tools"`
}

type PlatformToolView struct {
	// DD-140 (1)：平台原生工具名到动作键的封闭映射；记忆工具即其自身，project_channel_request 为
	// workspace.create。DD-149：连接器工具为其调用策略对应的子动作键。
	ActionKey  PlatformToolViewActionKey `json:"actionKey"`
	CanConsume bool                      `json:"canConsume"`
	// 仅 USER_REGISTERED_EXTERNAL（DD-149）：所属连接器与冻结的工具元数据。描述是上游提供的不可信文本。
	Connector       *PlatformToolConnector `json:"connector,omitempty"`
	InputSchemaHash string                 `json:"inputSchemaHash"`
	// PLATFORM_NATIVE
	// 为固定原生工具名（agent.memory.entry.list、agent.memory.entry.read、project_channel_request）；USER_REGISTERED_EXTERNAL
	// 为 <连接器标识>__<上游工具名>（DD-149(3)）。
	Name             string                 `json:"name"`
	OutputSchemaHash string                 `json:"outputSchemaHash"`
	OwnerPrincipalID string                 `json:"ownerPrincipalId"`
	ResourceID       string                 `json:"resourceId"`
	ResourceState    ResourceState          `json:"resourceState"`
	ResourceVersion  int64                  `json:"resourceVersion"`
	Source           PlatformToolViewSource `json:"source"`
	Status           PlatformToolViewStatus `json:"status"`
}

// 仅 USER_REGISTERED_EXTERNAL（DD-149）：所属连接器与冻结的工具元数据。描述是上游提供的不可信文本。
type PlatformToolConnector struct {
	CallPolicy      MCPToolCallPolicy       `json:"callPolicy"`
	ConnectionID    string                  `json:"connectionId"`
	ConnectionName  string                  `json:"connectionName"`
	ConnectionState MCPConnectionState      `json:"connectionState"`
	Description     *string                 `json:"description,omitempty"`
	Risk            MCPToolRisk             `json:"risk"`
	Title           *string                 `json:"title,omitempty"`
	UpstreamName    string                  `json:"upstreamName"`
	Visibility      MCPConnectionVisibility `json:"visibility"`
	WorkspaceID     *string                 `json:"workspaceId,omitempty"`
}

// DD-40 original Projects Added/remove preference. Native coordinate only, not membership
// or content permission. Uses the same CollaborationUserState version CAS.
type ProjectPreferenceRequest struct {
	ProjectAddress string `json:"projectAddress"`
	Selected       bool   `json:"selected"`
	Version        int64  `json:"version"`
}

// DD-118: the original Buzz Desktop merge_project_pull_request through BFF. Only when the
// person's own SERVER key is the repository coordinate owner: Core merges the review's
// source branch into the target branch in a temporary clone, pushes as that owner (Relay
// pre-receive policy decides), then publishes the owner-signed original kind 1631 merged
// status through the existing publication chain. Carries the Idempotency-Key header; the
// push is keyed by (repository, target ref, old->new) and reconciled from info/refs; 1631
// follows DD-81.
type ProjectsGitMergeRequest struct {
	// Original expected source head; a moved source branch is a conflict, never a silent merge
	// of other commits.
	ExpectedCommit string `json:"expectedCommit"`
	// The original 1618 review being merged.
	PullRequestEventID string `json:"pullRequestEventId"`
	Repository         string `json:"repository"`
	SourceBranch       string `json:"sourceBranch"`
	TargetBranch       string `json:"targetBranch"`
}

// DD-118: the original ProjectRepoMergeResult without its English message. statusEventId is
// the owner-signed 1631 merged status; it is present once that publication is accepted.
type ProjectsGitMergeResponse struct {
	MergeCommit   string  `json:"mergeCommit"`
	StatusEventID *string `json:"statusEventId,omitempty"`
}

// DD-118: the original Buzz Desktop remote repository reads
// (get_project_repo_snapshot/get_project_repo_file_content/get_project_repo_diff) through
// BFF. The repository is named by its 30617 coordinate, never by a clone URL; Relay
// authorize_git_read decides access with the person's own SERVER identity.
type ProjectsGitQueryRequest struct {
	BaseBranch    *string `json:"baseBranch,omitempty"`
	DefaultBranch *string `json:"defaultBranch,omitempty"`
	// FILE_CONTENT only.
	Path         *string                     `json:"path,omitempty"`
	Repository   string                      `json:"repository"`
	TargetCommit *string                     `json:"targetCommit,omitempty"`
	TargetRef    *string                     `json:"targetRef,omitempty"`
	View         ProjectsGitQueryRequestView `json:"view"`
}

// DD-118: exactly one of snapshot/content/diff matches the requested view, in the original
// Buzz Desktop shapes (ProjectRepoSnapshot, file preview, ProjectRepoDiff) with the
// original 64 KiB, 2000-line and 250-file bounds.
type ProjectsGitQueryResponse struct {
	// FILE_CONTENT preview; null when the file is binary or over the original preview bound.
	Content  *string                     `json:"content,omitempty"`
	Diff     *ProjectRepoDiff            `json:"diff,omitempty"`
	Snapshot *ProjectRepoSnapshot        `json:"snapshot,omitempty"`
	View     ProjectsGitQueryRequestView `json:"view"`
}

type ProjectRepoDiff struct {
	Additions  int64                 `json:"additions"`
	CommitBody *string               `json:"commitBody"`
	Deletions  int64                 `json:"deletions"`
	Files      []ProjectRepoDiffFile `json:"files"`
}

type ProjectRepoDiffFile struct {
	Additions int64  `json:"additions"`
	Deletions int64  `json:"deletions"`
	Patch     string `json:"patch"`
	Path      string `json:"path"`
	Truncated bool   `json:"truncated"`
}

type ProjectRepoSnapshot struct {
	Commits      []ProjectRepoCommit      `json:"commits"`
	Contributors []ProjectRepoContributor `json:"contributors"`
	Files        []ProjectRepoFile        `json:"files"`
	// Absent when the original value is null.
	LatestCommit *ProjectRepoCommit `json:"latestCommit,omitempty"`
}

// Absent when the original value is null.
type ProjectRepoCommit struct {
	AuthorEmail string `json:"authorEmail"`
	AuthorName  string `json:"authorName"`
	Hash        string `json:"hash"`
	ShortHash   string `json:"shortHash"`
	Subject     string `json:"subject"`
	Timestamp   int64  `json:"timestamp"`
}

type ProjectRepoContributor struct {
	CommitCount  int64  `json:"commitCount"`
	Email        string `json:"email"`
	LastCommitAt int64  `json:"lastCommitAt"`
	Name         string `json:"name"`
}

type ProjectRepoFile struct {
	Kind          string `json:"kind"`
	LastChangedAt *int64 `json:"lastChangedAt"`
	// Absent when the original value is null.
	LatestCommit   *ProjectRepoCommit `json:"latestCommit,omitempty"`
	Path           string             `json:"path"`
	PreviewContent *string            `json:"previewContent"`
	Size           *int64             `json:"size"`
}

// DD-118: the original Buzz Desktop
// create_project_remote_branch/delete_project_remote_branch through BFF. The person's own
// SERVER identity pushes to the Relay repository named by its 30617 coordinate; Relay
// pre-receive policy decides. The request carries the Idempotency-Key header; the push is
// keyed by (repository, ref, old->new) and reconciled from info/refs.
type ProjectsGitRefRequest struct {
	// CREATE_BRANCH: the new branch. DELETE_BRANCH: the branch to delete.
	Branch string `json:"branch"`
	// CREATE_BRANCH: the source branch head the new branch starts at. DELETE_BRANCH: the branch
	// head being deleted.
	ExpectedCommit string                 `json:"expectedCommit"`
	Operation      ProjectGitRefOperation `json:"operation"`
	Repository     string                 `json:"repository"`
	// CREATE_BRANCH only: the original source branch.
	SourceBranch *string `json:"sourceBranch,omitempty"`
}

// DD-118: the original ProjectRepoBranchResult without its English message; the branch and
// the commit the ref now points at (DELETE_BRANCH: the deleted head).
type ProjectsGitRefResponse struct {
	Branch string `json:"branch"`
	Commit string `json:"commit"`
}

// Typed original Community announcement mutation. Actor is the authenticated SERVER or
// CLIENT signer, never supplied by this request. Creation resolves the home Channel from an
// admitted Workspace; metadata is transient and remains Relay-owned. DELETE selects a real
// signed current announcement; it does not delete its channel or repositories.
// UPDATE_PULL_REQUEST publishes the original kind-1619 head update for the named immutable
// 1618 root, only as its author or repository owner; it carries commit and optional
// mergeBase, never a caller author, tags or clone URL. CREATE_PULL_REQUEST publishes the
// original NIP-34 1618 review for a branch already on the repository (DD-118); the push
// itself is not part of this request. APPROVE_PULL_REQUEST and the request-changes /
// inline-line variants of CREATE_PULL_REQUEST_COMMENT publish the original labeled kind-1
// review comments (desktop pullRequestReviews.ts::submitProjectPullRequestReview,
// hooks.ts::createProjectPullRequestComment) against the named review head; they introduce
// no new Nostr kind (DD-118(5)). ATTACH_REPOSITORY (original useAttachProjectRepository /
// useAddProjectRepository) republishes the signer's current 30621 head named by
// targetEventId with one more member `a` coordinate; every other tag and the content are
// kept. BIND_REPOSITORY_CHANNEL (original useBindProjectRepositoryChannel) republishes the
// signer's current 30617 head with `buzz-channel` replaced by the admitted Workspace's
// Channel. ADD_PROJECT_CHANNEL (original useAddProjectChannel) appends that Channel as a
// `buzz-related-channel` tag to the signer's current 30621 head; the Channel itself is
// created by the existing workspace.create action, never by this request. None of them
// grants Git, Channel or project authority (REQ-24, DD-80, DD-118).
type ProjectsPublishRequest struct {
	// Original inline diff anchor `line`: a 1-based line on the given side of the review diff.
	AnchorLine *int64 `json:"anchorLine,omitempty"`
	// Original inline diff anchor `file` (normalizeProjectPullRequestCommentAnchor):
	// repository-relative, no leading slash, backslash, NUL, empty, `.` or `..` segment; at
	// most 4096 UTF-16 code units. Only on CREATE_PULL_REQUEST_COMMENT, together with
	// anchorSide, anchorLine and commit.
	AnchorPath *string `json:"anchorPath,omitempty"`
	// Original inline diff anchor `side`.
	AnchorSide *ProjectPullRequestCommentSide `json:"anchorSide,omitempty"`
	// Original transient display label, trimmed and limited to 128 Unicode characters by the
	// consumer. Never an identity or authorization claim.
	AssigneeLabel *string `json:"assigneeLabel,omitempty"`
	// Other HUMAN recipient of an original issue-author/repository-owner assignment. Resolved
	// against the admitted Tenant's existing HUMAN identity directory; never a signing
	// identity. Self operations do not accept this field.
	AssigneePubkey *string                `json:"assigneePubkey,omitempty"`
	Attachments    []WebMessageAttachment `json:"attachments,omitempty"`
	// Original complete markdown including attachment markdown. Issues may be empty; comments
	// must be nonempty after trim. Current Relay NIP-11 and body admission limits are enforced
	// before signing.
	Body *string `json:"body,omitempty"`
	// Original 1618 `branch-name`: the compare branch, already present on the Relay repository.
	BranchName *string               `json:"branchName,omitempty"`
	Category   *ProjectIssueCategory `json:"category,omitempty"`
	// CREATE_REPOSITORY only: the original optional `clone` tag of a new repository
	// announcement (AddProjectRepositoryDialog Clone URL). Only metadata: Kailo reads
	// repository content through the 30617 coordinate (DD-118) and never fetches this URL.
	CloneURL *string `json:"cloneUrl,omitempty"`
	// Original `c`. UPDATE_PULL_REQUEST: the already-pushed head frozen by this update intent.
	// CREATE_PULL_REQUEST: compare branch head read from the trusted repository state.
	// APPROVE_PULL_REQUEST and CREATE_PULL_REQUEST_COMMENT with reviewDecision or an anchor:
	// the review head the reviewer looked at; the consumer refuses with TARGET_STATE_CONFLICT
	// unless it is still the review's current trusted head. Required by those review comments
	// and refused on ordinary comments.
	Commit      *string  `json:"commit,omitempty"`
	Description *string  `json:"description,omitempty"`
	Mentions    []string `json:"mentions,omitempty"`
	// Original 1618/1619 `merge-base`, when known.
	MergeBase *string                     `json:"mergeBase,omitempty"`
	Name      *string                     `json:"name,omitempty"`
	Operation ProjectPublicationOperation `json:"operation"`
	// Optional immutable original per-self assignment operation head. Same publication intent
	// retains it across UNKNOWN observation; never an authorization grant.
	PriorEventID *string `json:"priorEventId,omitempty"`
	// Original pullRequestReviews.ts lifecycle states the UI may publish (NIP-34
	// 1630/1633/1632). Merged (1631) happens through git and is never accepted here. Only the
	// review author or repository owner signs it.
	PullRequestStatus *ProjectPullRequestLifecycleStatus `json:"pullRequestStatus,omitempty"`
	// ATTACH_REPOSITORY only: the original NIP-34 repository coordinate added as a member `a`
	// tag. A coordinate, never a clone URL or an access grant; the repository head may not
	// exist yet when it is the first step of the original add-repository sequence.
	RepositoryAddress *string `json:"repositoryAddress,omitempty"`
	// Original hooks.ts ProjectPullRequestCommentDecision on CREATE_PULL_REQUEST_COMMENT only:
	// adds the `changes-requested` label. Only a requested reviewer or the repository owner,
	// never the review author, may request changes on an open or draft review; readers trust
	// nothing else (projectPullRequests.mjs).
	ReviewDecision *ProjectPullRequestCommentDecision `json:"reviewDecision,omitempty"`
	// Original requested reviewers (p tags beside the repository owner). Never a signing
	// identity or grant.
	Reviewers []string `json:"reviewers,omitempty"`
	// Original 1618 `target-branch`: the base branch.
	TargetBranch  *string `json:"targetBranch,omitempty"`
	TargetEventID *string `json:"targetEventId,omitempty"`
	// Original trimmed issue subject; the consumer additionally enforces the original
	// JavaScript 256 UTF-16 code-unit limit.
	Title       *string                   `json:"title,omitempty"`
	Visibility  *ProjectListingVisibility `json:"visibility,omitempty"`
	WorkspaceID *string                   `json:"workspaceId,omitempty"`
}

type WebMessageAttachment struct {
	// 原 Buzz imeta 模糊预览编码。
	Blurhash *string `json:"blurhash,omitempty"`
	// 原 Buzz imeta 媒体尺寸显示元数据。
	Dim *string `json:"dim,omitempty"`
	// 原附件 Markdown 链接显示名称；与 filename 分离，只写入消息正文，不生成 imeta 字段。
	DisplayLabel *string `json:"displayLabel,omitempty"`
	// 原 video/mp4 时长（秒），须为正有限数；Relay 校验原 sidecar。
	Duration *float64 `json:"duration,omitempty"`
	// 原 Buzz imeta filename；仅为显示及下载名称，不参与媒体存储寻址。
	Filename *string `json:"filename,omitempty"`
	// 原 video/mp4 独立 poster 图片引用；只允许当前 Community 的媒体路径，Relay 校验原图片 sidecar。
	Image  *string `json:"image,omitempty"`
	Sha256 string  `json:"sha256"`
	Size   int64   `json:"size"`
	// 沿原 Buzz Markdown 隐藏图片或视频；普通文件仍为文件链接。
	Spoiler *bool `json:"spoiler,omitempty"`
	// 当前 Community 内与附件 hash 相同的原 .thumb.jpg 引用；Relay 验证实际缩略图存在。
	Thumb *string `json:"thumb,omitempty"`
	Type  string  `json:"type"`
	URL   string  `json:"url"`
}

// Original Buzz Community project/repository announcements, coordinate-scoped work-item
// events and tombstones. Reads do not authorize Git transport or mutations.
// REPOSITORY_STATES returns the original trusted 30618 repository state (signed by the
// coordinate owner or the Relay itself) for the requested 30617 coordinates.
type ProjectsQueryRequest struct {
	Coordinates []string                 `json:"coordinates,omitempty"`
	Since       *int64                   `json:"since,omitempty"`
	Until       *int64                   `json:"until,omitempty"`
	View        ProjectsQueryRequestView `json:"view"`
}

// 03/18: only the initiating HUMAN's fresh-authorized original Session facts. No PAT,
// launch credential, native body or replacement revision is recoverable from this reader.
type ProtocolSessionView struct {
	ActionExecutionID      string                             `json:"actionExecutionId"`
	AdmittedMode           ProtocolSessionMode                `json:"admittedMode"`
	ApplicationBindingID   string                             `json:"applicationBindingId"`
	BaseRevision           string                             `json:"baseRevision"`
	EffectiveEditorOrigins []string                           `json:"effectiveEditorOrigins"`
	ExpiresAt              string                             `json:"expiresAt"`
	LaunchLocale           ProtocolSessionLocale              `json:"launchLocale"`
	LaunchTheme            ProtocolSessionTheme               `json:"launchTheme"`
	ProtocolSessionID      string                             `json:"protocolSessionId"`
	Reference              ContentReference                   `json:"reference"`
	ResultRevision         *string                            `json:"resultRevision,omitempty"`
	State                  ProtocolSessionReconcileRoundState `json:"state"`
	TenantID               string                             `json:"tenantId"`
	Version                int64                              `json:"version"`
	WorkspaceID            *string                            `json:"workspaceId,omitempty"`
}

type PulsePublishRequest struct {
	Attachments   []WebMessageAttachment       `json:"attachments,omitempty"`
	Content       string                       `json:"content"`
	Mentions      []string                     `json:"mentions,omitempty"`
	Operation     PulsePublishRequestOperation `json:"operation"`
	TargetEventID *string                      `json:"targetEventId,omitempty"`
}

type PulseQueryRequest struct {
	Authors  []string              `json:"authors,omitempty"`
	Before   *int64                `json:"before,omitempty"`
	EventIDS []string              `json:"eventIds,omitempty"`
	View     PulseQueryRequestView `json:"view"`
}

// DD-151(2)：GET /api/v1/push/capability（仅原生端）。部署是否配置了 APNs 与 FCM 凭据；只回读配置事实，不回显任何凭据字段。
type PushCapability struct {
	Apns PushAvailability `json:"apns"`
	Fcm  PushAvailability `json:"fcm"`
}

// DD-151(1)：PUT /api/v1/push/registration（仅原生端）。本设备登记、更新令牌或开关通知。proof 是本设备 CLIENT 私钥签名的
// NIP-98 事件（u 为本路径、method 为 PUT、session 为当前 PlatformSession），设备公钥即 proof 的签名者，必须是本人 ACTIVE
// 的设备公钥。expectedVersion 为 0 表示首次登记，其余按 DD-40 version CAS。token 明文只写入本 Tenant 的
// OpenBao，任何回应、日志与审计都不回显。
type PushRegistrationRequest struct {
	// iOS bundle id 或 Android application id；必须与部署配置的推送主题一致。
	AppID           string `json:"appId"`
	Enabled         bool   `json:"enabled"`
	ExpectedVersion int64  `json:"expectedVersion"`
	// 系统通知文案的语言；通知不含正文。
	Locale   ProtocolSessionLocale `json:"locale"`
	Platform PushPlatform          `json:"platform"`
	// NIP-98 HTTP Auth 事件（kind 27235）。
	Proof map[string]interface{} `json:"proof"`
	// APNs 设备令牌（十六进制）或 FCM 注册令牌。
	Token string `json:"token"`
}

// DD-151(1)：本设备的推送登记（GET/PUT /api/v1/push/registration）。不含令牌或其摘要。
type PushRegistrationView struct {
	AppID        string                `json:"appId"`
	DevicePubkey string                `json:"devicePubkey"`
	Enabled      bool                  `json:"enabled"`
	Locale       ProtocolSessionLocale `json:"locale"`
	Platform     PushPlatform          `json:"platform"`
	State        PushRegistrationState `json:"state"`
	UpdatedAt    string                `json:"updatedAt"`
	Version      int64                 `json:"version"`
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

// Original reminder create/complete/snooze/cancel. Identity comes only from the
// authenticated host; mutations select the actual current signed 30300 head. Source
// messages are freshly authorized and read by the host; no caller-supplied preview, author,
// kind, ciphertext or key is trusted.
type ReminderPublishRequest struct {
	ChannelID     *string           `json:"channelId,omitempty"`
	EventID       *string           `json:"eventId,omitempty"`
	NotBefore     *int64            `json:"notBefore,omitempty"`
	Note          *string           `json:"note,omitempty"`
	Operation     ReminderOperation `json:"operation"`
	SourceEventID *string           `json:"sourceEventId,omitempty"`
}

// 原 Reminder 目标引用重新读取；字段只是查找键，必须重做当前用户、channel scope 与事件签名/归属检查，不能以已解密提醒或目录缓存授予正文读取。
type ReminderSourceRequest struct {
	ChannelID string `json:"channelId"`
	EventID   string `json:"eventId"`
}

// Original Buzz 30300 author-only encrypted reminder, decrypted only by its own SERVER or
// local CLIENT identity. A transient Relay read, never a Core body record. Embedded target
// metadata is a historical preview, not current authorization.
type ReminderView struct {
	Content   ReminderContent `json:"content"`
	CreatedAt int64           `json:"createdAt"`
	EventID   string          `json:"eventId"`
	ID        string          `json:"id"`
	NotBefore *int64          `json:"notBefore,omitempty"`
}

type ReminderContent struct {
	Note   *string         `json:"note,omitempty"`
	Status ReminderStatus  `json:"status"`
	Target *ReminderTarget `json:"target,omitempty"`
}

type ReminderTarget struct {
	AuthorPubkey string `json:"authorPubkey"`
	ChannelID    string `json:"channelId"`
	EventID      string `json:"eventId"`
	Preview      string `json:"preview"`
}

// GET /api/v1/role-members 的有界回应。只列当前 Tenant 的 ACTIVE HUMAN 成员；角色从 SpiceDB fresh
// 读取，动作可用性只作界面提示，提交时仍重新准入（DD-82）。
type RoleMemberPage struct {
	Members []RoleMemberView `json:"members"`
	// 下一页首项之前的 Principal ID；缺省即已经读完
	NextCursor *string `json:"nextCursor,omitempty"`
}

type RoleMemberView struct {
	// 当前 Workspace manage 与 workspace.member.add 目录均有效且已开放，目标在该 Workspace 没有未撤销的
	// WorkspaceMembership（不存在或 REVOKED）；省略或 false 不显示添加动作，提交仍重新准入。
	CanAddToWorkspace      *bool `json:"canAddToWorkspace,omitempty"`
	CanGrantTenantAdmin    bool  `json:"canGrantTenantAdmin"`
	CanGrantWorkspaceAdmin bool  `json:"canGrantWorkspaceAdmin"`
	// 当前 Tenant manage 与 tenant.member.revoke 目录均有效，且不是最后有效 Tenant admin；提交仍走原审批与重新准入，省略或 false
	// 不显示动作。
	CanRemoveFromTenant *bool `json:"canRemoveFromTenant,omitempty"`
	// 当前 Workspace manage 与 workspace.member.revoke 目录均有效，目标存在可撤 WorkspaceMembership；省略或 false
	// 不显示动作，提交仍重新准入。
	CanRemoveFromWorkspace  *bool `json:"canRemoveFromWorkspace,omitempty"`
	CanRevokeTenantAdmin    bool  `json:"canRevokeTenantAdmin"`
	CanRevokeWorkspaceAdmin bool  `json:"canRevokeWorkspaceAdmin"`
	// RFC3339，TenantMembership 的原始创建时间，用于原版 Added 日期；不是审批通过、激活或最近重新加入时间。只向具有 Tenant manage
	// 的查看者提供，旧服务或仅 Workspace manage 时省略，客户端不编造日期。
	CreatedAt   *string `json:"createdAt,omitempty"`
	DisplayName string  `json:"displayName"`
	// 有效 Tenant admin 仅剩此人；该人的撤销按钮禁用，服务端最终准入仍重查
	LastTenantAdmin bool `json:"lastTenantAdmin"`
	// DD-139：同 Tenant 头像地址 <PUBLIC_ORIGIN>/api/v1/identity/avatars/<subject>（07 §4.7.3），只对有
	// ACTIVE 外部身份的成员给出；只是地址，不含图片或资料正文，读取仍按该路由的 Tenant 准入。
	Picture     *string `json:"picture,omitempty"`
	PrincipalID string  `json:"principalId"`
	// 同一 Tenant、同一 HUMAN Principal 当前 ACTIVE 的 Buzz 身份公钥，按公钥排序；仅向具有 Tenant manage
	// 的查看者提供非空列表，无有效绑定、旧服务或仅 Workspace manage 时省略。缺省不提供可读取资料的身份凭据，不以当前查看者或其他 Workspace 身份替代。
	Pubkeys     []string `json:"pubkeys,omitempty"`
	TenantAdmin bool     `json:"tenantAdmin"`
	// 没有 workspaceId 时恒为 false
	WorkspaceAdmin bool `json:"workspaceAdmin"`
}

// GET /api/v1/role-workspaces 的有界回应：当前 Principal 对哪些 Workspace 持有 fresh manage
// permission（ACTIVE、暂停中、已暂停、恢复中、删除中，以及已有协作面 binding 的 ERROR，各带当前状态），并附当前可用的 Workspace
// 创建、暂停、恢复与删除动作提示。动作提交仍由 Core 重新准入，不等于可进入频道。
type RoleWorkspacePage struct {
	// 当前 Principal 经 fresh Tenant create 检查可见的动作 key；目录未开放或无权时省略
	CreateActionKey *RoleWorkspacePageCreateActionKey `json:"createActionKey,omitempty"`
	// 下一页的 Core 索引偏移；不暴露无权 Workspace 的 ID，缺省即读完
	NextOffset *int64              `json:"nextOffset,omitempty"`
	Workspaces []RoleWorkspaceView `json:"workspaces"`
}

type RoleWorkspaceView struct {
	// DD-150：当前 Principal 经 fresh Workspace manage 检查、目录已开放、Workspace 为 ACTIVE 或 SUSPENDED
	// 且没有未终结的生命周期动作（编辑、暂停、恢复、删除）时给出；省略即不显示删除入口，提交仍由 Core 重新准入。删除进行中的 Workspace 以 state=DELETING
	// 出现，直到删除链全部回读确认后从本页消失
	DeleteActionKey *RoleWorkspaceViewDeleteActionKey `json:"deleteActionKey,omitempty"`
	ID              string                            `json:"id"`
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
	// 当前 Tenant 的显示名，也就是其绑定 Community 的名称（01 §2：一个 Tenant 绑定一个
	// Community），只用于界面上认出本人所在社区，不参与任何判定；读不到时缺省
	TenantName        *string `json:"tenantName,omitempty"`
	TenantPrincipalID string  `json:"tenantPrincipalId"`
}

// PUT /api/v1/user-state/sidebar-assignments 的请求体（DD-125(5)）：原
// assignChannel/unassignChannel。channelKey 是原生 Buzz Channel ID，必须属于本人当前是成员的 Workspace
// 或参与中的私聊；sectionId 缺省即移出分区，给出时必须是现有分区。每人至多 1000 个归属（原
// MAX_CHANNEL_SECTION_ASSIGNMENTS）。失去资格的归属保留但不呈现。version 不符即 409。
type SidebarAssignmentRequest struct {
	ChannelKey string  `json:"channelKey"`
	SectionID  *string `json:"sectionId,omitempty"`
	Version    int64   `json:"version"`
}

// PUT /api/v1/user-state/sidebar-sections/{sectionId} 的请求体（DD-125(5)、03
// CollaborationUserState.sidebar_sections）：新建或改名原自定义频道分区；sectionId 由客户端以 UUID 生成。name
// 去首尾空白后非空，icon 缺省即无图标，order 是原分区顺序。每人至多 100 个分区（原 MAX_CHANNEL_SECTIONS）。version 不符即
// 409。DELETE 同一路径以 UserStateVersion 为请求体，同时清除指向该分区的归属与该分区的排序分组。
type SidebarSectionRequest struct {
	Icon    *string `json:"icon,omitempty"`
	Name    string  `json:"name"`
	Order   int64   `json:"order"`
	Version int64   `json:"version"`
}

// PUT /api/v1/user-state/sidebar-section-order 的请求体（DD-125(5)）：原
// reorderSections/moveSectionUp/moveSectionDown 的结果顺序。sectionIds 必须恰为当前全部分区 ID 的一个排列，Core
// 按下标写回 order。version 不符即 409。
type SidebarSectionOrderRequest struct {
	SectionIDS []string `json:"sectionIds"`
	Version    int64    `json:"version"`
}

// PUT /api/v1/user-state/sidebar-sort 的请求体（DD-125(5)、03
// CollaborationUserState.sidebar_sort）：原分组排序。groupKey 只接受原固定分组 starred/channels/forums/dms
// 或 section:<现有分区 ID>；每人至多 104 个分组（原 MAX_CHANNEL_SORT_GROUPS）。version 不符即 409。
type SidebarSortRequest struct {
	GroupKey string          `json:"groupKey"`
	Mode     SidebarSortMode `json:"mode"`
	Version  int64           `json:"version"`
}

// DD-135(2)(3)：一次 Skill 上传的原始字节（标准 base64，两端同一 JSON 传输）。解码后不超过 1 MiB；编码只接受 SKILL.md、tar 或
// tar.gz，由 Core 判定。
type SkillArtifactUploadRequest struct {
	ContentBase64 string `json:"contentBase64"`
}

// DD-135(2)(3)：上传校验结果。accepted 时给出一次性 uploadId、规范 artifact digest 与 frontmatter
// 元数据；否则只给逐项违规，不暂存字节。
type SkillArtifactUploadView struct {
	Accepted         bool                   `json:"accepted"`
	ArtifactByteSize *int64                 `json:"artifactByteSize,omitempty"`
	ArtifactDigest   *string                `json:"artifactDigest,omitempty"`
	Description      *string                `json:"description,omitempty"`
	Encoding         *SkillArtifactEncoding `json:"encoding,omitempty"`
	ExpiresAt        *string                `json:"expiresAt,omitempty"`
	ShortDescription *string                `json:"shortDescription,omitempty"`
	SkillName        *string                `json:"skillName,omitempty"`
	SkillResourceID  string                 `json:"skillResourceId"`
	// 上传字节数。缺省条件同 uploadDigest。
	UploadByteSize *int64 `json:"uploadByteSize,omitempty"`
	// 上传字节的 SHA-256。请求体超过上限、上传未被完整读取时缺省（UPLOAD_TOO_LARGE）。
	UploadDigest *string                  `json:"uploadDigest,omitempty"`
	UploadID     *string                  `json:"uploadId,omitempty"`
	Violations   []SkillArtifactViolation `json:"violations"`
}

type SkillArtifactViolation struct {
	Code SkillArtifactViolationCode `json:"code"`
	// 违规条目在上传包内的路径（不含正文）；与整体相关的违规省略。
	Path *string `json:"path,omitempty"`
}

// 同 Tenant 且当前 discover 允许的 Skill 定义页；nextOffset 续读同一排序。
type SkillDefinitionPage struct {
	Definitions []SkillDefinitionView `json:"definitions"`
	NextOffset  *int64                `json:"nextOffset,omitempty"`
}

// DD-135(1)(4)：Tenant 级 Skill 定义与 Resource 事实；can* 只是当前 HUMAN 的 fresh 入口提示，提交时仍重验。
type SkillDefinitionView struct {
	CanDisable *bool `json:"canDisable,omitempty"`
	CanShare   *bool `json:"canShare,omitempty"`
	CanUpload  *bool `json:"canUpload,omitempty"`
	// 本 Tenant 成员同时持有该定义的 discoverer 与 reader（DD-131(6)）。
	CatalogShared                  bool                  `json:"catalogShared"`
	CurrentPublishedVersionAssetID *string               `json:"currentPublishedVersionAssetId,omitempty"`
	DisplayName                    string                `json:"displayName"`
	OwnerPrincipalID               string                `json:"ownerPrincipalId"`
	ResourceID                     string                `json:"resourceId"`
	ResourceVersion                int64                 `json:"resourceVersion"`
	StableSlug                     string                `json:"stableSlug"`
	Status                         SkillDefinitionStatus `json:"status"`
}

// DD-135(4)：AgentVersion 编辑器可选的 Skill 版本目录——当前 HUMAN fresh 可 read 的 ACTIVE 定义下的 PUBLISHED
// 版本；不授予任何 Installation permission。
type SkillReferencePage struct {
	NextOffset *int64             `json:"nextOffset,omitempty"`
	Versions   []SkillVersionView `json:"versions"`
}

// DD-135(1)(2)：不可变 SkillVersion 的元数据；正文只经内容读取端点返回。state 与 AgentVersion 共用同一生命周期枚举。
type SkillVersionView struct {
	ArtifactByteSize       int64    `json:"artifactByteSize"`
	ArtifactDigest         string   `json:"artifactDigest"`
	ArtifactFormat         string   `json:"artifactFormat"`
	AssetID                string   `json:"assetId"`
	AssetVersion           int64    `json:"assetVersion"`
	CanPublish             *bool    `json:"canPublish,omitempty"`
	CanRetire              *bool    `json:"canRetire,omitempty"`
	CapabilityRequirements []string `json:"capabilityRequirements"`
	// 是所属定义当前的发布指针。
	Current          *bool             `json:"current,omitempty"`
	Description      string            `json:"description"`
	MetadataHash     string            `json:"metadataHash"`
	Ordinal          int64             `json:"ordinal"`
	OwnerPrincipalID string            `json:"ownerPrincipalId"`
	ShortDescription *string           `json:"shortDescription,omitempty"`
	SkillName        string            `json:"skillName"`
	SkillResourceID  string            `json:"skillResourceId"`
	StableSlug       string            `json:"stableSlug"`
	State            AgentVersionState `json:"state"`
}

// DD-135(4)(8)：一个可读版本的规范 SKILL.md 正文；读取即对该版本的 read，返回前以 digest 重算。不进入审计或日志。
type SkillVersionContentView struct {
	ArtifactDigest string `json:"artifactDigest"`
	AssetID        string `json:"assetId"`
	Content        string `json:"content"`
}

// 一个 Skill 定义的版本页（ordinal 降序）；DRAFT 只对版本 Asset read 持有者列出。
type SkillVersionPage struct {
	NextOffset      *int64             `json:"nextOffset,omitempty"`
	ResourceVersion int64              `json:"resourceVersion"`
	SkillResourceID string             `json:"skillResourceId"`
	Versions        []SkillVersionView `json:"versions"`
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

// GET /api/v1/tenant-member-joins 的有界回应（DD-125(9)）。每次请求 fresh 校验 Tenant manage，否则
// PERMISSION_DENIED；不建立 ActionExecution、不写访问审计。不带 after 时 items 为空，只给当前游标供建账；带 after
// 时按（进入时刻，membership）升序返回其后进入 ACTIVE 的其他成员，单页有上界。
type TenantMemberJoinPage struct {
	// 不透明位置，下一次作为 after 原样回传；空串表示起点（本 Tenant 尚无记下进入时刻的成员）。客户端不得解析或构造；格式非法时服务端回 400。
	Cursor string `json:"cursor"`
	// 游标之后仍有未扫描的成员事实，应立即以新 cursor 续读；为 true 时本页 items 可能为空。
	HasMore bool                   `json:"hasMore"`
	Items   []TenantMemberJoinView `json:"items"`
}

// 一名在游标之后进入 ACTIVE 的同 Tenant 其他 HUMAN 成员（DD-125(9)）。只含 Principal ID、显示名与进入时刻，不含公钥、IdP
// 身份或邀请凭据；按 HUMAN Principal 计，新设备公钥（DD-77）不产生条目。
type TenantMemberJoinView struct {
	DisplayName string `json:"displayName"`
	// TenantMembership 最近一次转入 ACTIVE 的时刻（重新加入覆盖），RFC3339 UTC；不是邀请或创建时间。
	JoinedAt    string `json:"joinedAt"`
	PrincipalID string `json:"principalId"`
}

// DD-158(3)：GET /api/v1/tenant/profile。会话 Tenant 的显示名、图标与版本，全体 ACTIVE 成员可读；本人有 Tenant
// manage 时给出 updateActionKey（tenant.profile.update），提交仍由 Core 重新准入。
type TenantProfileView struct {
	Icon *string `json:"icon,omitempty"`
	Name string  `json:"name"`
	// BFF_STREAM_RETRY_MILLIS 部署事实；在线资料读取中断后再次读取前的等待。afterVersion
	// 查询只等待有限的再准入时间，回应前重新校验本人会话与成员资格。
	RefreshAfterMillis *int64  `json:"refreshAfterMillis,omitempty"`
	UpdateActionKey    *string `json:"updateActionKey,omitempty"`
	Version            int64   `json:"version"`
}

// DD-123/DD-163: platform quota items of the Tenant read from OpenMeter (the only
// authority). Tenant admin and auditor only.
type TenantQuotaPage struct {
	Quotas []TenantQuotaView `json:"quotas"`
	// Present only when the caller may set quotas now (Tenant manage); auditors read without it.
	SetActionKey *TenantQuotaPageSetActionKey `json:"setActionKey,omitempty"`
}

type TenantQuotaView struct {
	Feature        TenantQuotaFeature `json:"feature"`
	HardLimit      bool               `json:"hardLimit"`
	HasAccess      bool               `json:"hasAccess"`
	LimitPerPeriod *int64             `json:"limitPerPeriod,omitempty"`
	// DD-163(3): per-member cap kept in the entitlement metadata; absent when no member cap is
	// set.
	MemberLimitPerPeriod *int64   `json:"memberLimitPerPeriod,omitempty"`
	PeriodResetAt        *string  `json:"periodResetAt,omitempty"`
	Usage                *float64 `json:"usage,omitempty"`
}

// PUT /api/v1/user-state/threads 的请求体（DD-40、DD-125(1)、03
// CollaborationUserState.thread_preferences）。threadKey 为 thread:<Buzz root event id>，Core
// 以本人 SERVER 身份回读根事件并核验当前 Workspace 成员或私聊参与资格。保留原联动：followed=true 记 FOLLOWED（关注即解除静音），false
// 记 MUTED（取消关注即静音）；每人至多 500 条，超出淘汰最早写入的关注。version 是读到的 CollaborationUserState 版本，不符即 409。不是
// Governed Action。
type ThreadPreferenceRequest struct {
	Followed  bool   `json:"followed"`
	ThreadKey string `json:"threadKey"`
	Version   int64  `json:"version"`
}

// GET /api/v1/usage-billing：Tenant 或其中一个 Workspace 在区间内的用量与账单视图（.design/11 §6–7、.design/14
// §7–8），调用方须对该范围持有 audit permission，每次 fresh Check。committed usage、额度与账单直接读 OpenMeter，Core
// 不复制或聚合成账本；投递计数只来自 Core UsageEvent outbox。缺口用确定状态表达，不显示零或已结算。
type UsageBillingView struct {
	BillingState     UsageSectionState      `json:"billingState"`
	CustomerState    UsageCustomerState     `json:"customerState"`
	Delivery         []UsageDeliveryCount   `json:"delivery"`
	Entitlements     []UsageEntitlementView `json:"entitlements"`
	EntitlementState UsageSectionState      `json:"entitlementState"`
	// RFC3339，含
	From           string                `json:"from"`
	Invoices       []UsageInvoiceView    `json:"invoices"`
	Meters         []UsageMeterView      `json:"meters"`
	OperationUsage []OperationUsageCount `json:"operationUsage"`
	TenantID       string                `json:"tenantId"`
	// RFC3339，不含
	To          string  `json:"to"`
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

type UsageDeliveryCount struct {
	Count  int64                 `json:"count"`
	Status UsageSettlementStatus `json:"status"`
}

type UsageEntitlementView struct {
	// 仅 metered；OpenMeter 十进制原文
	Balance *string `json:"balance,omitempty"`
	// 原生 entitlement 类型原文
	EntitlementType string `json:"entitlementType"`
	FeatureKey      string `json:"featureKey"`
	HasAccess       bool   `json:"hasAccess"`
	// 仅 metered
	Overage *string `json:"overage,omitempty"`
	// 仅 metered；当前用量周期内的原生 usage
	Usage *string `json:"usage,omitempty"`
}

type UsageInvoiceView struct {
	Currency          *string `json:"currency,omitempty"`
	ID                string  `json:"id"`
	IssuedAt          *string `json:"issuedAt,omitempty"`
	Number            *string `json:"number,omitempty"`
	ServicePeriodFrom *string `json:"servicePeriodFrom,omitempty"`
	ServicePeriodTo   *string `json:"servicePeriodTo,omitempty"`
	// 原生 invoice status 原文；只有原生终态才可称为已结算
	Status string `json:"status"`
	// 原生 totals.total 十进制原文
	Total *string `json:"total,omitempty"`
}

type UsageMeterView struct {
	// 原生 meter 的聚合方式原文
	Aggregation *string `json:"aggregation,omitempty"`
	// ActionDefinition 登记的平台 meter 选择键
	MeterKey string `json:"meterKey"`
	// 仅 COMMITTED 时给出；OpenMeter 返回的十进制原文
	Quantity *string         `json:"quantity,omitempty"`
	State    MeterUsageState `json:"state"`
}

// CollaborationUserState 写入成功后的新版本（/api/v1/user-state/* 各 PUT/DELETE 的 200 回应）。DD-125 的
// DELETE /api/v1/user-state/sidebar-sections/{sectionId} 与 DELETE
// /api/v1/user-state/channel-templates/{templateId} 也以它为请求体：version 是读到的版本，不符即 409。
type UserStateVersion struct {
	Version int64 `json:"version"`
}

// GET /api/v1/workspaces/{workspaceId}/canvas（DD-125(4)、V-SCN-135）：BFF 以本人身份在已准入 Workspace
// 的 Channel 下按 #h 读取 kind 40100，只采纳作者为该 Tenant CONTROL 的最新一条并验签；其他作者的 40100 一律忽略。正文原样透传，不进
// Core 存储。没有采纳的事件时 content、eventId、createdAt 都省略（原“No canvas set”）。
type WebChannelCanvasView struct {
	// 原 Markdown 正文；空串表示管理者已清空。
	Content *string `json:"content,omitempty"`
	// 被采纳事件的 created_at，RFC3339。
	CreatedAt *string `json:"createdAt,omitempty"`
	// 被采纳的 CONTROL 40100 事件 ID。
	EventID *string `json:"eventId,omitempty"`
	// 固定为 workspace.canvas.set：目录已开放、Workspace ACTIVE 且本人经 fresh Workspace manage 检查时给出（≙ 原
	// canEditNarrative）。省略即不显示编辑入口；提交仍重新准入。
	SetActionKey *string `json:"setActionKey,omitempty"`
	WorkspaceID  string  `json:"workspaceId"`
}

// Own NIP-30 set mutation. The admitted host derives the signer and community; omitted
// imageUrl removes only the caller's entry.
type WebCustomEmojiMutation struct {
	ExpectedPubkey string  `json:"expectedPubkey"`
	IdempotencyKey string  `json:"idempotencyKey"`
	ImageURL       *string `json:"imageUrl,omitempty"`
	Shortcode      string  `json:"shortcode"`
}

// Verified original per-author kind:30030 snapshots, not a Core-owned emoji directory.
// Clients apply the original deterministic community union.
type WebCustomEmojiView struct {
	Events     []map[string]interface{} `json:"events"`
	MediaPaths map[string]string        `json:"mediaPaths"`
	Pubkey     string                   `json:"pubkey"`
}

// GET /api/v1/gifs（DD-125(5)、09 §3、V-SCN-140）：原 GIF 选择器是否出现。available 仅在本 Tenant ACTIVE
// TenantBuzzBinding 的 NIP-11 快照与运行期文档一致且广告 buzz-gif/gif（provider klipy，原 /gifs/search 与
// /gifs/share）、并且部署登记了至少一个 GIF 图片来源时为 true；否则按原版不出现。imageOrigins 是部署登记的 https 来源（与 Web 静态
// CSP img-src 追加项同一份），Web 只对这些来源内联渲染无 imeta 的 GIF；KLIPY 密钥只在 Relay 部署环境。
type WebGIFCapabilityView struct {
	Available    bool     `json:"available"`
	ImageOrigins []string `json:"imageOrigins"`
}

// POST /api/v1/gifs/search：BFF 以本人身份经 NIP-98 转发 Relay 原 /gifs/search（成员门与 GIF 限速由 Relay
// 执行，超额以 LIMIT 类回应）。query 为空即原 trending，至多 200 字符；locale 为浏览器语言（1–32 字符）。原 KLIPY
// customer_id 由 BFF 按 Tenant 与本人 Principal 派生为稳定匿名标识，Browser 不提供。
type WebGIFSearchRequest struct {
	Locale string `json:"locale"`
	Query  string `json:"query"`
}

// POST /api/v1/gifs/search 的回应：原 Relay 固定一页（24 项）结果，按提供方顺序。
type WebGIFSearchView struct {
	Gifs []WebGIFItem `json:"gifs"`
}

// 原 normalizeKlipyGifs 的一项（BFF 归一化，Browser 不接收提供方原始 JSON）：original 取 md/hd/sm/xs 的首个完整
// gif，preview 取 sm.webp/sm.gif/xs.webp/xs.gif/md.webp 或 original，poster 取首个完整 jpg。所有地址都是
// https 且来源在部署登记的 GIF 图片来源之内，否则该项不返回。发送时原版把 url 以 ![image](url) 追加到正文，不带 imeta。
type WebGIFItem struct {
	Height        int64   `json:"height"`
	PosterURL     *string `json:"posterUrl,omitempty"`
	PreviewHeight int64   `json:"previewHeight"`
	PreviewURL    string  `json:"previewUrl"`
	PreviewWidth  int64   `json:"previewWidth"`
	Size          int64   `json:"size"`
	Slug          string  `json:"slug"`
	Title         string  `json:"title"`
	URL           string  `json:"url"`
	Width         int64   `json:"width"`
}

// POST /api/v1/gifs/share（原选择时的分享上报，尽力而为）：BFF 以本人身份经 NIP-98 转发 Relay 原 /gifs/share，成功回
// 204。slug 为 1–200 字符。
type WebGIFShareRequest struct {
	Slug string `json:"slug"`
}

// DD-39/72/75：本人原 Relay mentions feed。Core 逐项核验当前资源准入、签名和频道线程归属；不接受身份、scope 或任意 Relay
// filter。
type WebInboxQuery struct {
	Limit *int64 `json:"limit,omitempty"`
	Since *int64 `json:"since,omitempty"`
}

// POST /api/v1/workspaces/{workspaceId}/link-previews 与
// /api/v1/conversations/{conversationId}/link-previews（DD-125(5)、09 §3、V-SCN-139）：Web 原
// composer 的链接预览抓取由 BFF 代为执行。只接受 http/https 与默认端口；BFF 每一跳在 DNS 解析后拒绝回环、私网、链路本地、CGNAT、组播、ULA
// 与部署登记的内部网段，只连接已校验地址，至多 3 次跳转、256 KB，不带 cookie 与凭据；按 Principal 限速，超额以 LIMIT
// 类拒绝；预览图以本人身份上传为 Relay 媒体。审计只记主机与 URL 摘要。
type WebLinkPreviewRequest struct {
	// 原 extractSupportedLinkPreviews 识别出的链接（http/https）。
	URL string `json:"url"`
}

// BFF 为本人短期持有的一份链接预览快照（DD-125(5)）。字段即原 11 元素 link-preview snapshot 标签的内容（版本 1）：canonicalUrl
// 为 https、无凭据与片段；title 不超过 300 字节、siteName 100 字节、description 1000 字节；imageUrl/faviconUrl
// 是本人上传的 Relay 媒体地址，缺省即无图。发布请求只能以 snapshotId 引用本人未过期的快照（linkPreviewSnapshotIds），Browser
// 不提交原始标签。
type WebLinkPreviewSnapshotView struct {
	CanonicalURL string `json:"canonicalUrl"`
	Description  string `json:"description"`
	// 快照失效时刻，RFC3339；之后发布引用它以 TARGET_NOT_FOUND 拒绝。
	ExpiresAt  string  `json:"expiresAt"`
	FaviconURL *string `json:"faviconUrl,omitempty"`
	ImageURL   *string `json:"imageUrl,omitempty"`
	SiteName   string  `json:"siteName"`
	SnapshotID string  `json:"snapshotId"`
	Title      string  `json:"title"`
	// 请求的链接，原样回显，供 composer 与正文中的链接对应。
	URL string `json:"url"`
}

// Typed read of authors proven by signed events in one currently admitted channel or
// private conversation. No caller-selected pubkey or Relay filter; Core partitions Relay
// reads by its existing page/NIP-11 limits.
type WebMessageAuthorQuery struct {
	EventIDS []string `json:"eventIds"`
}

// Exact event-id keyed profiles from one fresh admitted read. Every requested message must
// be verified; a missing kind:0 is an empty profile, while missing message proof fails the
// whole read. No profile body is persisted by Core.
type WebMessageAuthorView struct {
	Profiles map[string]WebProfileView `json:"profiles"`
}

// Profile read from Buzz for the current identity or an author proven by a currently
// admitted channel/private-conversation message, never a Core profile copy. An absent
// kind:0 is an empty profile, not a fabricated event.
type WebProfileView struct {
	About *string `json:"about,omitempty"`
	// Same-origin BFF paths for exact media URLs on the current community. A read projection,
	// never an upload or remote proxy authority.
	AvatarMediaPaths map[string]string `json:"avatarMediaPaths"`
	AvatarURL        *string           `json:"avatarUrl,omitempty"`
	DisplayName      *string           `json:"displayName,omitempty"`
	EventID          *string           `json:"eventId,omitempty"`
	Nip05Handle      *string           `json:"nip05Handle,omitempty"`
	Pubkey           string            `json:"pubkey"`
}

// 原 Buzz 线程分页的复合游标；下一请求以 before=createdAt、beforeId=eventId 原样提交，避免同秒回复丢失。
type WebMessageCursor struct {
	CreatedAt int64  `json:"createdAt"`
	EventID   string `json:"eventId"`
}

// 同一已准入 Channel 的原生消息分页或线程读取。before/beforeId 必须成对，频道窗口向前翻历史，线程沿原 Relay
// 协议向后读回复；上界来自运行时配置与原协议上界，不接受任意 Relay filter。
type WebMessageQuery struct {
	// 原 Inbox Agents：仅 Workspace 内读取本人拥有且 ACTIVE 的既有安装作者消息；Core fresh read 解析其公开签名身份，不接受任意
	// author。不得与线程读取或其他消息类型组合。
	AgentInstallationID *string `json:"agentInstallationId,omitempty"`
	// 原 Inbox item 冷定位：仅在路径指定并 freshly admitted 的 Workspace/Conversation 内验证精确 Stream/Forum
	// 消息及线程祖先。不能与其他 messageType、parentEventId、agentInstallationId 或分页游标组合；不是全局 event
	// 读取或权限证明。缺省保持原窗口/线程语义。
	AnchorEventID *string         `json:"anchorEventId,omitempty"`
	Before        *int64          `json:"before,omitempty"`
	BeforeID      *string         `json:"beforeId,omitempty"`
	MessageType   *WebMessageType `json:"messageType,omitempty"`
	ParentEventID *string         `json:"parentEventId,omitempty"`
}

// DD-120: only snapshot events signed by the Relay itself whose single p tag is a requested
// pubkey bound in this Tenant. A pubkey without a fact is absent, never reported offline.
type WebPresencePage struct {
	Presences []WebPresenceView `json:"presences"`
}

type WebPresenceView struct {
	ObservedAt *int64            `json:"observedAt,omitempty"`
	Pubkey     string            `json:"pubkey"`
	Status     WebPresenceStatus `json:"status"`
}

// DD-120: presence for the requested pubkeys from the Relay-signed 20001 snapshot.
type WebPresenceQueryRequest struct {
	Pubkeys []string `json:"pubkeys"`
}

// DD-120: the person's own presence heartbeat or manual choice. Core signs the original
// kind 20001 with the person's SERVER key over the existing NIP-42 session connection;
// latest wins, not stored, never reconciled by event ID. offline releases the presence
// lease.
type WebPresenceUpdateRequest struct {
	Status WebPresenceStatus `json:"status"`
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

// Web HUMAN 的原 Buzz 消息语义输入；身份、Channel、回复祖先与 mention 公钥均由 BFF 在原 scope 中解析，不接受 raw tags 或
// signed event。
type WebPublishMessageRequest struct {
	// DD-148 原 Agent 收件人栏：须为同一请求 mentionInstallationIds 的子集（否则 SCOPE_GUARD_FAILED 前的 400）；BFF
	// 排序去重并冻结于同一发布意图（幂等重放逐项比较），对其中经准入并实际投递的 Installation 的 AGENT 公钥签原版 ["mention", <pubkey>,
	// "agent-address"] 标签，与 p 并存，只作呈现元数据，不改变通知或 agent.invoke 准入；与
	// editEventId、deleteEventId、sendToChannelSourceEventId 互斥，私聊目标拒绝。缺省为空。
	AddressedInstallationIDS []string               `json:"addressedInstallationIds,omitempty"`
	Attachments              []WebMessageAttachment `json:"attachments,omitempty"`
	Content                  string                 `json:"content"`
	// 删除本人原 Buzz 消息；BFF 回读当前 Channel 原事件核对本人签名身份，发原 kind 5。与
	// editEventId、parentEventId、非空正文、附件及提及互斥；不授予 kind 9005 管理员删除权限。
	DeleteEventID *string `json:"deleteEventId,omitempty"`
	// 编辑原 Buzz 消息；BFF 回读同 Channel 原事件并核对本人签名身份，发原 kind 40003。与 parentEventId 互斥，缺省保持原新消息语义。
	EditEventID *string `json:"editEventId,omitempty"`
	// DD-125(5) 原 composer 链接预览：本人经 BFF 抓取得到、尚未过期的快照 ID（至多 8 个，去重保序）。只用于新的 STREAM
	// 消息（kind:9，含线程回复）：BFF 只接受本人的快照，按原 11 元素 link-preview snapshot 标签随该消息发布并把 ID
	// 冻结在发布幂等记录；canonicalUrl 不在正文中的快照按原接收规则不签入（正文照常发布）；引用他人或已过期的快照以 TARGET_NOT_FOUND 拒绝。与
	// suppressLinkPreviews、editEventId（原编辑不带快照）、deleteEventId、sendToChannelSourceEventId 互斥；不接受
	// Browser 提交的原始 link-preview 标签。
	LinkPreviewSnapshotIDS []string `json:"linkPreviewSnapshotIds,omitempty"`
	// 用户明确选中的本 Workspace Installation；缺省为空，BFF 排序去重并冻结于原发布幂等记录。
	MentionInstallationIDS []string `json:"mentionInstallationIds,omitempty"`
	// 原 Buzz HUMAN 提及的精确公钥；缺省为空。BFF 核对当前 Tenant、消息目的地成员及 ACTIVE 身份，排序去重冻结在原发布幂等记录；不接受 Agent
	// 公钥绕过 Installation 准入。
	MentionPubkeys []string        `json:"mentionPubkeys,omitempty"`
	MessageType    *WebMessageType `json:"messageType,omitempty"`
	// 原 Relay 消息引用；BFF 在当前 Channel 回读验签并解析 NIP-10 祖先。
	ParentEventID *string `json:"parentEventId,omitempty"`
	// DD-125(8) 原“不邀请直接发送 / 仍然发送”：被提及但不是该 Workspace ACTIVE 成员、且本次不邀请的 HUMAN 公钥；缺省为空。只用于
	// Workspace 的新消息（含线程回复），与 mentionPubkeys 不相交，与
	// editEventId、deleteEventId、sendToChannelSourceEventId 互斥，私聊目标拒绝。BFF 校验每个公钥都是同 Tenant
	// ACTIVE HUMAN Principal（TenantMembership ACTIVE）的 ACTIVE 公钥（不要求目的地成员资格，否则
	// PERMISSION_DENIED），签原版 ["mention", <pubkey>] 引用标签，排序去重后冻结进同一发布意图（幂等重放逐项比较）；不发 p、不通知、不进入
	// Inbox，也不授予读取或成员资格，接收方只用它解析 @名字 的显示。
	ReferenceMentionPubkeys []string `json:"referenceMentionPubkeys,omitempty"`
	// DD-125(1) 原“发送到频道”：当前 Channel 中一条线程回复的 Relay 事件 ID。BFF 回读该回复，要求作者为本人或本人是其 Installation
	// owner，按原 getSendToChannelSemantics 只复制正文与 emoji/imeta/link-preview/mention
	// 标签、重算提及并排除源作者，由线程根按原截断规则生成 buzz:sent-from-thread，以本人身份发一条新的顶层 kind:9，沿 DD-81 幂等与对账。与
	// parentEventId、editEventId、deleteEventId 互斥；content 须为空且不带附件、提及或 Installation
	// 提及——正文与标签只取自回读的源事件，不接受 Browser 提交的原始标签。
	SendToChannelSourceEventID *string `json:"sendToChannelSourceEventId,omitempty"`
	// DD-125(5) 原 link-preview none：为 true 时签发唯一的 ["link-preview", "none"] 标签，接收方不显示预览。与
	// editEventId 同用即原“对所有人移除预览”（本人消息的 40003 编辑）。省略或 false 不加该标签。
	SuppressLinkPreviews *bool `json:"suppressLinkPreviews,omitempty"`
}

// Web HUMAN 修改已准入 Workspace 对应 Channel 的原主题（DD-119、09 §3）。BFF 以本人 SERVER 身份按 DD-81 签发严格
// h+topic 两标签的 kind 9002，幂等键沿原发布的 Idempotency-Key 请求头；不接受 raw tags、signed event
// 或任何管理标签。结果不明只对账不重签；已归档 Channel 不接受。
type WebPublishTopicRequest struct {
	// 原频道主题；空字符串清空主题，不改变频道名称、描述、TTL 或成员。
	Topic string `json:"topic"`
}

// DD-39 / REQ-24：原 Buzz TopbarSearch 的语义查询。Core 以本人 SERVER 身份向原 Relay FTS 查询，只在当前已准入
// Channel/DM 范围内读取；不接受任意 Relay filter、租户或身份。页与 frame 上界来自已核验 NIP-11 和既有 BFF 配置。
type WebSearchQuery struct {
	Authors   []string `json:"authors,omitempty"`
	ChannelID *string  `json:"channelId,omitempty"`
	Limit     *int64   `json:"limit,omitempty"`
	Q         string   `json:"q"`
	Since     *int64   `json:"since,omitempty"`
	Until     *int64   `json:"until,omitempty"`
}

// DD-120(1)：线程内输入中提示的类型化线程引用，POST /api/v1/workspaces/{workspace_id}/typing 与
// /api/v1/conversations/{conversation_id}/typing 的可选请求体；缺省请求体即主频道输入。Core 以本人 SERVER 身份签发原版
// kind 20002：唯一 h 标签取自已准入的 scope，按原 buildThreadReferenceTags 追加 e root/reply 标签；不接受 raw
// tags、频道或身份。瞬时事件最新者为准，超时不报成功也不重签。
type WebTypingRequest struct {
	// 原 typingParentEventId：线程面板的 thread head 事件 ID（64 位小写十六进制），成为 e reply 标签
	ParentEventID string `json:"parentEventId"`
	// 原 typingRootEventId：thread head 所在线程的根事件 ID；缺省或等于 parentEventId 时只发 e reply 标签
	RootEventID *string `json:"rootEventId,omitempty"`
}

// DD-120: the latest verified 30315 per requested pubkey; empty content means cleared and
// is omitted.
type WebUserStatusPage struct {
	Statuses []WebUserStatusView `json:"statuses"`
}

type WebUserStatusView struct {
	CreatedAt int64   `json:"createdAt"`
	Emoji     *string `json:"emoji,omitempty"`
	EventID   string  `json:"eventId"`
	ExpiresAt *int64  `json:"expiresAt,omitempty"`
	Pubkey    string  `json:"pubkey"`
	Text      string  `json:"text"`
}

// DD-120: the original NIP-38 kind 30315 `d=general` statuses for the requested pubkeys.
type WebUserStatusQueryRequest struct {
	Pubkeys []string `json:"pubkeys"`
}

// DD-120: the person's own original NIP-38 30315 (`d=general`, optional `emoji` and
// `expiration` tags), published by Core with the SERVER key under DD-81 (Idempotency-Key
// header). Empty text clears the status.
type WebUserStatusUpdateRequest struct {
	Emoji     *string `json:"emoji,omitempty"`
	ExpiresAt *int64  `json:"expiresAt,omitempty"`
	Text      string  `json:"text"`
}

// POST /api/v1/workspace-activity 的回应：按请求顺序给出每个 Workspace 的原生 Channel ID 与经签名、scope
// 与窗口边界核验的首页事件，语义与单个 GET /workspaces/{id}/messages 首页相同。任一项准入或核验失败即整次失败，不返回部分结果。
type WebWorkspaceActivityPage struct {
	Items []WebWorkspaceActivity `json:"items"`
}

type WebWorkspaceActivity struct {
	ChannelID   string                   `json:"channelId"`
	Events      []map[string]interface{} `json:"events"`
	WorkspaceID string                   `json:"workspaceId"`
}

// POST /api/v1/workspace-activity：一次读取调用方多个已加入 Workspace 的原版频道窗口首页（侧栏最近活动与未读、Inbox
// 原兴趣规则的输入），对应固定 Buzz desktop/src-tauri/src/commands/channels/fetch.rs 的批量 last-message
// 查询。每项仍单独做 HUMAN 协作准入；同一请求内 Workspace 不得重复。messageType 只接受频道窗口的 STREAM 或 FORUM_POST。
type WebWorkspaceActivityQuery struct {
	Items []WebWorkspaceActivityTarget `json:"items"`
}

type WebWorkspaceActivityTarget struct {
	MessageType WebMessageType `json:"messageType"`
	WorkspaceID string         `json:"workspaceId"`
}

// GET /api/v1/workspaces 回应数组的元素：调用方有 ACTIVE WorkspaceMembership 或 fresh manage 管理资格，且两侧
// binding 都 ACTIVE 的 Workspace。管理可见不代表可读取协作消息；isMember 投影真实成员事实。Workspace id 同时是其 Channel
// id（DD-80）。
type WorkspaceView struct {
	ID string `json:"id"`
	// 调用方是否有 ACTIVE WorkspaceMembership；管理资格不使该值为真。旧回应缺省表示未知，不得当作已加入频道。
	IsMember *bool  `json:"isMember,omitempty"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
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

// DD-94部署投递面：adapter服务引用解析到固定部署产物/原生实例与受限传输。不是Catalog或业务授权。
type ApplicationAdapterDirectory struct {
	Adapters []ApplicationAdapterDelivery `json:"adapters"`
	// 受控部署事实，不是 Tool 注册表或业务授权；原生 MCP peer 不接收 ActionToken。
	ProtocolPeers []ApplicationProtocolPeerDelivery `json:"protocolPeers,omitempty"`
}

type ApplicationAdapterDelivery struct {
	ActionTokenAudience string `json:"actionTokenAudience"`
	AdapterServiceRef   string `json:"adapterServiceRef"`
	ArtifactDigest      string `json:"artifactDigest"`
	BaseURL             string `json:"baseUrl"`
	// 可选的既有原生对象受控归属证据；复用同一绑定事实结构，仅供既有resource.create核验，不授予权限或创建原生对象。无登记证据时省略，不投递空数组。
	Bindings                  []ApplicationProtocolPeerBindingDelivery `json:"bindings,omitempty"`
	MaxResponseBytes          int64                                    `json:"maxResponseBytes"`
	MCPURL                    *string                                  `json:"mcpUrl,omitempty"`
	ModelCredentialDeliveries []ApplicationModelCredentialDelivery     `json:"modelCredentialDeliveries,omitempty"`
	// 受控原生浏览器认证信任投递；IdP只认证HUMAN，不承载实例业务许可。绑定、ACTIVE成员与SpiceDB实时检查决定权限；不由请求提供issuer/subject/key
	// URL。
	NativeHumanIdentities []ApplicationNativeHumanIdentity `json:"nativeHumanIdentities,omitempty"`
	NativeInstanceRef     string                           `json:"nativeInstanceRef"`
	SecretReaders         []ApplicationSecretReader        `json:"secretReaders"`
	TimeoutSeconds        int64                            `json:"timeoutSeconds"`
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

type ApplicationNativeHumanIdentity struct {
	Audience           string `json:"audience"`
	BindingID          string `json:"bindingId"`
	ConfigDigest       string `json:"configDigest"`
	Generation         int64  `json:"generation"`
	IdentityProviderID string `json:"identityProviderId"`
	JwksFile           string `json:"jwksFile"`
}

type ApplicationSecretReader struct {
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
	SecretReaders             []ApplicationSecretReader                `json:"secretReaders,omitempty"`
	TimeoutSeconds            int64                                    `json:"timeoutSeconds"`
}

// DD-92: modelGateway within the approved binding config. Only existing route and meter
// references; no provider configuration, credential value or native model row.
type ApplicationModelGatewayConfig struct {
	MeterKeys        []string `json:"meterKeys"`
	RouteResourceIDS []string `json:"routeResourceIds"`
}

// DD-102 / ADR-12：能力契约固定的机器向量。每个 case 按 steps 顺序执行契约操作，参数与预期结果是实际
// JSON，不执行文本代码。格式有效不表示组件套件通过；线协议性质、真实执行与 release 证据关联另行核验。DD-124：V2 的每个值只来自
// LITERAL、PRECONDITION 或 CAPTURE；generatedRefs、preconditionKinds、preconditions、bindings 与
// captures 只属于 V2，V1 仍按原规则执行。
type CapabilityConformanceVectors struct {
	Cases         []CapabilityConformanceVectorsCasesItem `json:"cases"`
	FormatVersion CapabilityVectorFormat                  `json:"formatVersion"`
	// V2 only. Contract fields whose values the implementation generates (opaque non-empty
	// strings). nativeRevision is always implementation-generated and need not be listed. A
	// listed position present in a step document may never be LITERAL; EXPECTED entries are the
	// only output fields a GENERATED_REF capture of a FORWARD step may read. A step of a
	// RECEIVER case is not sent by the production Core: its input is the admission the isolated
	// Core produced, so a GENERATED_REF capture of that step reads an INPUT entry of its own
	// contract key.
	GeneratedRefs []CapabilityVectorGeneratedRef `json:"generatedRefs,omitempty"`
	// V2 only. Closed list of native object kinds a case may declare as preconditions and the
	// properties each must verify by a literal expectation.
	PreconditionKinds []CapabilityVectorPreconditionKind `json:"preconditionKinds,omitempty"`
}

type CapabilityConformanceVectorsCasesItem struct {
	CaseKey string `json:"caseKey"`
	// V2 only; absent means FORWARD. A RECEIVER case (DD-124(3)(4)) runs entirely in the
	// isolated deployment; the production plan observes each of its steps only through
	// receiver_start/receiver_observe and accepts the isolated Core's execution and operation
	// ids, both read_receipts, native batch or execution and native terminal evidence, never
	// business results: every step names the receiver Resource by referenceResourceKey and
	// expects {}. Every platform Resource id of the case, typed or a
	// resourceId/sourceResourceId/assetId member of a step document, is a PRECONDITION. A step
	// input is the admission the isolated Core performs: it may bind the step's own
	// ACTION_EXECUTION_ID, OPERATION_ID or GENERATED_REF captures and earlier steps' captures,
	// which the isolated deployment supplies from its own run. The case as a whole carries the
	// source reads; Core compares a step's input with the admission whenever its evidence has
	// reads.
	Direction *CapabilityVectorCaseDirection `json:"direction,omitempty"`
	// V2 only. Native objects the isolated fixture creates through the candidate's own native
	// entry before the run; the fixture supplies only their actual identifiers. Every
	// registered property of the kind is declared with its literal value and verified by a
	// later literal expectation of this case; in a RECEIVER case, whose expectations are {}, by
	// a literal member of a later step input, which Core compares with the isolated admission.
	Preconditions []CapabilityVectorPrecondition                   `json:"preconditions,omitempty"`
	Steps         []CapabilityConformanceVectorsCasesItemStepsItem `json:"steps"`
}

type CapabilityVectorPrecondition struct {
	Key        string                                 `json:"key"`
	Kind       string                                 `json:"kind"`
	Properties []CapabilityVectorPreconditionProperty `json:"properties"`
}

type CapabilityVectorPreconditionProperty struct {
	Name      string `json:"name"`
	ValueJSON string `json:"valueJson"`
}

type CapabilityConformanceVectorsCasesItemStepsItem struct {
	// V2 only. Every reserved placeholder in inputJson/expectedOutputJson is declared here
	// exactly once.
	Bindings []CapabilityVectorBinding `json:"bindings,omitempty"`
	// V2 only. Values this step's SUCCEEDED observation with complete native terminal evidence
	// provides to later steps.
	Captures           []CapabilityVectorCapture `json:"captures,omitempty"`
	ContractKey        string                    `json:"contractKey"`
	ExpectedOutputJSON string                    `json:"expectedOutputJson"`
	InputJSON          string                    `json:"inputJson"`
	ReferenceAssetID   *string                   `json:"referenceAssetId,omitempty"`
	// V1 only. 只引用同 case 已成功的更早 stepKey 的唯一 typed ContentReference；不得指定 JSON 路径或表达式。与固定
	// Resource/Asset 目标一起进入规范化参数 hash。
	ReferenceFromStepKey *string `json:"referenceFromStepKey,omitempty"`
	// Literal platform Resource id of the step target. DD-124(4): a RECEIVER case never names a
	// platform Resource by literal; it uses referenceResourceKey.
	ReferenceResourceID *string `json:"referenceResourceId,omitempty"`
	// V2 only. Key of a PRECONDITION of this case whose fixture value is the step's reference
	// Resource id; Core freezes that value into the plan step's referenceResourceId. DD-124(4):
	// in a receiver-direction case it is the id the isolated Core's real resource.create (DD-98
	// existing native reference) returned. Mutually exclusive with referenceResourceId,
	// referenceAssetId and referenceFromStepKey; it counts as this step sending that
	// precondition.
	ReferenceResourceKey *string `json:"referenceResourceKey,omitempty"`
	StepKey              string  `json:"stepKey"`
}

type CapabilityVectorGeneratedRef struct {
	ContractKey string               `json:"contractKey"`
	Pointer     string               `json:"pointer"`
	Side        CapabilityVectorSide `json:"side"`
}

type CapabilityVectorPreconditionKind struct {
	Description string   `json:"description"`
	Kind        string   `json:"kind"`
	Properties  []string `json:"properties"`
}

// 07§8A 的隔离环境投递配置，不是 Catalog/binding 权威。由运维配置精确绑定已装载候选 artifact；逐次短期模拟 token 仅由 Core
// 对实际请求签发，不接受静态凭据文件或用户 action 自报地址。
type ComponentConformanceEnvironment struct {
	AdapterBaseURL   string `json:"adapterBaseUrl"`
	ArtifactDigest   string `json:"artifactDigest"`
	MaxResponseBytes int64  `json:"maxResponseBytes"`
	MaxSteps         int64  `json:"maxSteps"`
	// 仅隔离原生接收方套件：原 receiver ServicePrincipal 的受控 OIDC 投递，逐 binding/generation 选择；不是生产绑定注册表，不转发
	// Worker 的平台 bearer。
	NativeReadAuthorities []ComponentNativeReadAuthority `json:"nativeReadAuthorities,omitempty"`
	// DD-124(4)：仅隔离部署内 APPLICATION 接收方动作（省略 importConfigRef 的
	// receiver_start/receiver_observe）。平台维护的隔离部署入口 origin，不是候选 adapter；它以隔离 HUMAN 经隔离 Core 原
	// Action Admission 准入与派发并观察该动作。
	ReceiverActionBaseURL *string `json:"receiverActionBaseUrl,omitempty"`
}

type ComponentNativeReadAuthority struct {
	BindingID            string `json:"bindingId"`
	CoreBaseURL          string `json:"coreBaseUrl"`
	Generation           int64  `json:"generation"`
	OidcClientID         string `json:"oidcClientId"`
	OidcClientSecretFile string `json:"oidcClientSecretFile"`
	OidcTokenURL         string `json:"oidcTokenUrl"`
}

// 隔离开发环境受控投递的协议夹具数据，不来自登记请求。Core 只采用固定协议用例并核对全部必需覆盖；没有脚本、条件、路径表达式或通过声明。
type ComponentConformanceFixture struct {
	ArtifactDigest string `json:"artifactDigest"`
	// 接收方向步骤（V1 NATIVE_INTERNAL/NATIVE 契约步骤，V2 direction=RECEIVER case 的每个步骤）各恰一项的冻结接收方请求；Core
	// 以计划步骤幂等键替换 idempotencyKey。DD-124(4)：NATIVE_MANAGED 键的请求携带与已代入向量输入一致的
	// importConfigRef；APPLICATION 接收方动作省略它。请求只是隔离部署内的启动/观察引用，不含任何执行、operation 或批次标识。
	NativeReceivers []ComponentNativeReceiverFixture `json:"nativeReceivers,omitempty"`
	// DD-124(1)：V2 契约 case 声明的前置原生对象取值。只能是候选实现原生入口创建时实际返回的标识（接收方向 case 的平台 Resource 前置值为隔离 Core
	// 经真实 resource.create 登记既有原生引用后返回的 Resource ID，DD-124(4)）；Core
	// 在冻结计划时代入，并核对每个声明恰有一个取值。不是期望值来源。
	Preconditions []ComponentConformancePreconditionValue `json:"preconditions,omitempty"`
	Steps         []ComponentConformanceStep              `json:"steps"`
}

type ComponentNativeReceiverFixture struct {
	CaseKey     string                         `json:"caseKey"`
	ContractKey string                         `json:"contractKey"`
	Request     ComponentNativeReceiverRequest `json:"request"`
	StepKey     string                         `json:"stepKey"`
}

type ComponentConformancePreconditionValue struct {
	// 计划内 case 键 <categoryKey>:<contractVersion>:<caseKey>。
	CaseKey string `json:"caseKey"`
	Key     string `json:"key"`
	Value   string `json:"value"`
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
	// DD-124(4)：计划含 receiver_start/receiver_observe 步骤时必填；固定隔离接收方部署的 Core 构建与来源
	// release，随身份摘要进入原计划。
	ReceiverEnvironment *ComponentConformanceReceiverEnvironment `json:"receiverEnvironment,omitempty"`
	SecretAudience      string                                   `json:"secretAudience"`
	SecretLocator       string                                   `json:"secretLocator"`
	SecretVersion       int64                                    `json:"secretVersion"`
	TokenSeconds        int64                                    `json:"tokenSeconds"`
}

type ComponentConformanceIdentityContext struct {
	ActionDefinitionVersion int64  `json:"actionDefinitionVersion"`
	ActionKey               string `json:"actionKey"`
	ActorPrincipalID        string `json:"actorPrincipalId"`
	// 隔离环境PEP的实际模拟授权revision，不得指向生产SpiceDB事实。
	AuthorizationMinZedToken string `json:"authorizationMinZedToken"`
	CaseKey                  string `json:"caseKey"`
	// execute场景必填的隔离native执行引用；不在生产库创建ExternalExecution。
	ExternalExecutionID *string                       `json:"externalExecutionId,omitempty"`
	Operation           ComponentConformanceOperation `json:"operation"`
	// 业务上下文必填并与版本成对；确切 application_binding.create 的 handshake/validate_binding
	// 管理上下文必须省略两字段，不授业务内容访问。
	ResultExposurePolicyID *string `json:"resultExposurePolicyId,omitempty"`
	// 业务上下文必填；结果为 NONE 的确切绑定管理上下文必须与策略 ID 一起省略。
	ResultExposurePolicyVersion *int64  `json:"resultExposurePolicyVersion,omitempty"`
	StepKey                     string  `json:"stepKey"`
	TargetID                    *string `json:"targetId,omitempty"`
	TargetType                  string  `json:"targetType"`
	TenantID                    string  `json:"tenantId"`
	WorkspaceID                 *string `json:"workspaceId,omitempty"`
}

// 原 COMPONENT_CONFORMANCE_ENVIRONMENT_FILE 的 PROTOCOL_PEER 分支，仅隔离套件运行事实；readOnlyTools
// 固定隔离实例实际上可安全执行的只读探针，不授予生产业务权限。
type ComponentProtocolPeerEnvironment struct {
	ArtifactDigest       string `json:"artifactDigest"`
	InitializeResultJSON string `json:"initializeResultJson"`
	ListResultJSON       string `json:"listResultJson"`
	MaxResponseBytes     int64  `json:"maxResponseBytes"`
	MaxSteps             int64  `json:"maxSteps"`
	MCPURL               string `json:"mcpUrl"`
	// 隔离原生MCP的既有版本化SecretRef与header映射；经原Core/OpenBao审计和Gateway文件投递，不含凭据值，不借用生产binding身份。
	NativeCredentials []ApplicationPeerCredentialDelivery `json:"nativeCredentials,omitempty"`
	ReadOnlyTools     []string                            `json:"readOnlyTools"`
	TimeoutSeconds    int64                               `json:"timeoutSeconds"`
}

// 统一错误体（apps/06-工程基线规范.md 第 4 节）。不携带业务正文、secret、原始 SQL、文件内容或完整 prompt/response。
type ErrorBody struct {
	Class ErrorClass `json:"class"`
	// 贯穿 Core、Worker、adapter 与组件的关联键
	OperationID *string    `json:"operationId,omitempty"`
	Reason      ReasonCode `json:"reason"`
	// 仅随 PUBLISH_REJECTED：Relay 以社区禁言或封禁拒绝本人内容写入时的结构化原因，供原禁言横幅倒计时（DD-125(2)、V-SCN-129）。只来自
	// Relay 对本人这次写入的拒绝文本，不是限制列表读取；其他拒绝缺省。
	Restriction *PublishRestriction `json:"restriction,omitempty"`
}

// 仅随 PUBLISH_REJECTED：Relay 以社区禁言或封禁拒绝本人内容写入时的结构化原因，供原禁言横幅倒计时（DD-125(2)、V-SCN-129）。只来自
// Relay 对本人这次写入的拒绝文本，不是限制列表读取；其他拒绝缺省。
type PublishRestriction struct {
	Kind PublishRestrictionKind `json:"kind"`
	// TIMED_OUT 的到期时刻（RFC3339，取自 Relay 拒绝文本的 unix 秒）；BANNED 或拒绝文本未给出可解析时刻时缺省
	Until *string `json:"until,omitempty"`
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

// 18: native authenticated file-menu metadata from the Adapter typed reference producer.
// This is NOT Action admission; the normal Kailo HUMAN session must independently
// fresh-admit the frozen target and version. No ticket or content bytes.
type NativeDocumentSelection struct {
	ActionKey       NativeDocumentSelectionActionKey `json:"actionKey"`
	ActionVersion   int64                            `json:"actionVersion"`
	BindingID       string                           `json:"bindingId"`
	Generation      int64                            `json:"generation"`
	Reference       ContentReference                 `json:"reference"`
	ResourceVersion int64                            `json:"resourceVersion"`
	WorkspaceID     string                           `json:"workspaceId"`
}

// 03 §7 的平台发布 Catalog 投递，不是用户 Resource 或 Agent 注册表。部署没有提供实际合同、凭据链与 runtime 对账证据时不得填 ACTIVE。
type RuntimeProfileDirectory struct {
	Profiles []RuntimeProfileDirectoryProfilesItem `json:"profiles"`
}

// Workflow 经 ProjectTaskState Activity 写回 Core 的一次状态跃迁（.design/06 §3.1）。Core 按 workflowId
// 单调 upsert，eventId 不大于已有值的报告按幂等成功忽略。
type TaskStateReport struct {
	// AgentTask 的 ProjectAgentTaskState Activity 原生执行 ID，仅由 ActivityInfo 投递。Core
	// 校验同固定执行链的已调度载荷后生成步骤投影；旧 writer/修复报告缺省时保留原轨迹，不推测或清空。
	ActivityID *string `json:"activityId,omitempty"`
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
	ApprovalInput      *ApprovalWorkflowInput `json:"approvalInput,omitempty"`
	ApprovalWorkflowID *string                `json:"approvalWorkflowId,omitempty"`
	// 同不可变自动化版本的下一 Delay；Core 须读回原 execution chain 的 TimerFired 才允许后续副作用。
	DelayStep *AgentTaskAdvanceResultDelayStep `json:"delayStep,omitempty"`
	// 已查证安全停止此 Activity；不等于 Invocation 成功或 Capacity 已释放。
	FinishActivity bool       `json:"finishActivity"`
	InvocationID   string     `json:"invocationId"`
	Status         TaskStatus `json:"status"`
	WaitingReason  string     `json:"waitingReason"`
}

// ApprovalWorkflow 的冻结输入（.design/06 §4）。运行中不得更换 Tenant、Workspace、target、参数摘要或策略版本；意图改变时建立新
// ActionExecution。
type ApprovalWorkflowInput struct {
	ActionDefinitionVersion int64              `json:"actionDefinitionVersion"`
	ActionExecutionID       string             `json:"actionExecutionId"`
	ActionKey               string             `json:"actionKey"`
	AffectedOwnerRefs       []AffectedOwnerRef `json:"affectedOwnerRefs"`
	// APPROVED 之后等待 consume 的上界；超时自动 INVALIDATED
	ConsumeWindowSeconds int64 `json:"consumeWindowSeconds"`
	// RFC3339，UTC。Core 按 ApprovalPolicy.expires_in 在请求时冻结；Workflow 以 workflow.Now() 与之比较
	ExpiresAt            string                    `json:"expiresAt"`
	InitiatorPrincipalID string                    `json:"initiatorPrincipalId"`
	OperationID          string                    `json:"operationId"`
	OwnerRequirement     ApprovalOwnerRequirement  `json:"ownerRequirement"`
	ParameterHash        string                    `json:"parameterHash"`
	PolicyID             string                    `json:"policyId"`
	PolicyVersion        int64                     `json:"policyVersion"`
	Resume               *ApprovalResume           `json:"resume,omitempty"`
	RoleRequirements     []ApprovalRoleRequirement `json:"roleRequirements"`
	SelfApproval         ApprovalSelfApproval      `json:"selfApproval"`
	TargetID             string                    `json:"targetId"`
	TargetType           string                    `json:"targetType"`
	TenantID             string                    `json:"tenantId"`
	// TENANT_ONLY 动作缺省
	WorkspaceID *string `json:"workspaceId,omitempty"`
}

// 请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
type AffectedOwnerRef struct {
	OwnerPrincipalID string `json:"ownerPrincipalId"`
	TargetID         string `json:"targetId"`
	TargetType       string `json:"targetType"`
	TargetVersion    int64  `json:"targetVersion"`
}

// ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
// 才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
type ApprovalResume struct {
	// RFC3339，UTC
	ConsumedAt *string `json:"consumedAt,omitempty"`
	// RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
	ConsumeDeadline *string                  `json:"consumeDeadline,omitempty"`
	Decisions       []ApprovalDecisionRecord `json:"decisions"`
	// 此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
	// 从零数起，不加上它续跑后的投影会被当成旧事件丢掉
	EventBase int64             `json:"eventBase"`
	Reason    *ReasonCode       `json:"reason,omitempty"`
	Refusals  []ApprovalRefusal `json:"refusals"`
	Status    ApprovalStatus    `json:"status"`
}

// 一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
// §4）。
type ApprovalRefusal struct {
	ApproverPrincipalID string     `json:"approverPrincipalId"`
	Reason              ReasonCode `json:"reason"`
}

// 同不可变自动化版本的下一 Delay；Core 须读回原 execution chain 的 TimerFired 才允许后续副作用。
type AgentTaskAdvanceResultDelayStep struct {
	ID      string `json:"id"`
	Seconds int64  `json:"seconds"`
	// 显式 Delay 步骤时限；独立原生 Timer，不替换 seconds。缺省走原 history 分支。
	TimeoutSeconds *int64 `json:"timeoutSeconds,omitempty"`
}

type ApplicationBindingAdvanceRequest struct {
	CancelRequested bool                     `json:"cancelRequested"`
	RunID           string                   `json:"runId"`
	Target          ApplicationBindingTarget `json:"target"`
}

type ApplicationBindingTarget struct {
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

// decide Update 的参数。Update ID 固定为 <approval_workflow_id>:<approver_principal_id>，由 Server
// 侧去重；approverPrincipalId 由 Core 从 PlatformSession 取得，不接受 Browser 自报。
type ApprovalDecisionUpdate struct {
	ApproverPrincipalID string           `json:"approverPrincipalId"`
	Decision            ApprovalDecision `json:"decision"`
}

// invalidate Update 的参数：Core 在批准后重新准入不通过时发出（.design/06 §4）。Update ID 固定为
// <action_execution_id>:invalidate。
type ApprovalInvalidateUpdate struct {
	Reason ReasonCode `json:"reason"`
}

// ApprovalWorkflow 经 ProjectApprovalState Activity 写回 Core 的一次状态跃迁。Core 按 workflowId 与
// eventId 单调 upsert；ApprovalProjection 只接受这一条写入路径（DD-47）。
type ApprovalStateReport struct {
	// RFC3339，UTC；进入 CONSUMED 时的 workflow.Now()
	ConsumedAt *string `json:"consumedAt,omitempty"`
	// RFC3339，UTC；进入 APPROVED 时由 workflow.Now() 加 consumeWindowSeconds 得出
	ConsumeDeadline *string                  `json:"consumeDeadline,omitempty"`
	Decisions       []ApprovalDecisionRecord `json:"decisions"`
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
	Input      AutomationScheduleTaskInput `json:"input"`
	RunID      string                      `json:"runId"`
	WorkflowID string                      `json:"workflowId"`
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

type AutomationScheduleAdmitResult struct {
	Admitted   bool                    `json:"admitted"`
	ReasonCode string                  `json:"reasonCode"`
	TaskInput  *AgentTaskWorkflowInput `json:"taskInput,omitempty"`
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

type ComponentActionAdvanceRequest struct {
	CancelRequested bool                  `json:"cancelRequested"`
	RunID           string                `json:"runId"`
	Target          ComponentActionTarget `json:"target"`
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

type ComponentActionAdvanceResult struct {
	ActionExecutionID string     `json:"actionExecutionId"`
	Status            TaskStatus `json:"status"`
	WaitingReason     string     `json:"waitingReason"`
}

// 受信 Worker 的一次实际线协议观察，附着冻结 ActionExecution。Core 以自身 plan 逐项匹配，不接收 pass 布尔值；UNKNOWN
// 不表示套件失败或成功。响应正文与测试凭据不进入报告。
type ComponentConformanceObservation struct {
	ActionExecutionID  string                                `json:"actionExecutionId"`
	ArtifactDigest     string                                `json:"artifactDigest"`
	ComponentReleaseID string                                `json:"componentReleaseId"`
	ContractDigests    []string                              `json:"contractDigests"`
	Observations       []ComponentConformanceStepObservation `json:"observations"`
	OperationID        string                                `json:"operationId"`
	PlanDigest         string                                `json:"planDigest"`
	RunID              string                                `json:"runId"`
	SuiteDigest        string                                `json:"suiteDigest"`
	WorkflowID         string                                `json:"workflowId"`
}

type ComponentConformanceStepObservation struct {
	// 成功 validate_binding 的固定字段摘要，由 Core 从真实回执按 component_conformance_wire_digests 计算；其他操作不得携带。
	BindingDigest *string `json:"bindingDigest,omitempty"`
	// DD-124：本步声明的捕获值，只由 Core 从本次实际应答的封闭槽位取得；仅随该步观察证据保存。
	Captures                  []ComponentConformanceCaptureValue             `json:"captures,omitempty"`
	CaseKey                   string                                         `json:"caseKey"`
	ContentReference          *ContentReference                              `json:"contentReference,omitempty"`
	ErrorClass                *ErrorClass                                    `json:"errorClass,omitempty"`
	HTTPStatus                int64                                          `json:"httpStatus"`
	MCPResultKind             *ComponentConformanceStepExpectedMCPResultKind `json:"mcpResultKind,omitempty"`
	NativeObservation         *AdapterExecutionObservation                   `json:"nativeObservation,omitempty"`
	NativeReceiverObservation *ComponentNativeReceiverObservation            `json:"nativeReceiverObservation,omitempty"`
	NativeScopeObservation    *AdapterScopeObservation                       `json:"nativeScopeObservation,omitempty"`
	Operation                 ComponentConformanceOperation                  `json:"operation"`
	RequestDigest             string                                         `json:"requestDigest"`
	ResponseDigest            string                                         `json:"responseDigest"`
	// 实际返回的能力结果摘要；原结果正文不进入报告或 Core。
	ResultDigest *string `json:"resultDigest,omitempty"`
	StepKey      string  `json:"stepKey"`
}

// DD-98：按同一 platform Resource ref CREATE/LOOKUP；FOUND 保留上游实际引用，不由套件预测或生成 native ID。
type AdapterScopeObservation struct {
	NativeRef           *string           `json:"nativeRef,omitempty"`
	NativeType          *string           `json:"nativeType,omitempty"`
	PlatformResourceRef string            `json:"platformResourceRef"`
	Result              NativeScopeResult `json:"result"`
}

type ConversationProjectionRequest struct {
	RunID  string                       `json:"runId"`
	Target ConversationProjectionTarget `json:"target"`
}

type ConversationProjectionTarget struct {
	ActionExecutionID string `json:"actionExecutionId"`
	ConversationID    string `json:"conversationId"`
	WorkflowID        string `json:"workflowId"`
}

type ConversationProjectionResult struct {
	ConversationID string     `json:"conversationId"`
	Status         TaskStatus `json:"status"`
	WaitingReason  string     `json:"waitingReason"`
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
	CancelRequested bool                           `json:"cancelRequested"`
	Round           *ProtocolSessionReconcileRound `json:"round,omitempty"`
	RunID           string                         `json:"runId"`
	Target          ProtocolSessionReconcileTarget `json:"target"`
}

// Actual original Session snapshot. The Activity result freezes this query round into
// history, not into a new authority.
type ProtocolSessionReconcileRound struct {
	SessionVersion   int64                              `json:"sessionVersion"`
	State            ProtocolSessionReconcileRoundState `json:"state"`
	WriteObservation *ProtocolWriteObservation          `json:"writeObservation,omitempty"`
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

type ProtocolSessionReconcileResult struct {
	ProtocolSessionID string                        `json:"protocolSessionId"`
	Round             ProtocolSessionReconcileRound `json:"round"`
	Status            TaskStatus                    `json:"status"`
	WaitingReason     string                        `json:"waitingReason"`
}

type ResourceExportAdvanceRequest struct {
	CancelRequested bool                 `json:"cancelRequested"`
	RunID           string               `json:"runId"`
	Target          ResourceExportTarget `json:"target"`
}

// 06 §7.1、DD-42：源 Tenant 的 RESOURCE_EXPORT 冻结目标。只引用本 Tenant 的 ActionExecution、来源
// Resource、准入时预写的 ExportPackage Asset 与 TransferFormat；不携带包字节或任何来源内容。
type ResourceExportTarget struct {
	ActionExecutionID string `json:"actionExecutionId"`
	FormatKey         string `json:"formatKey"`
	PackageAssetID    string `json:"packageAssetId"`
	SourceResourceID  string `json:"sourceResourceId"`
	WorkflowID        string `json:"workflowId"`
}

type ResourceExportAdvanceResult struct {
	PackageAssetID string     `json:"packageAssetId"`
	Status         TaskStatus `json:"status"`
	WaitingReason  string     `json:"waitingReason"`
}

type ResourceImportAdvanceRequest struct {
	CancelRequested bool                 `json:"cancelRequested"`
	RunID           string               `json:"runId"`
	Target          ResourceImportTarget `json:"target"`
}

// 06 §7.1、DD-42：目标 Tenant 的 RESOURCE_IMPORT 冻结目标。只引用本 Tenant 的 ActionExecution、新建
// Resource/Asset 与包 format/digest；不携带包字节、来源 Tenant 或来源 ID。
type ResourceImportTarget struct {
	ActionExecutionID string `json:"actionExecutionId"`
	FormatKey         string `json:"formatKey"`
	PackageDigest     string `json:"packageDigest"`
	ResourceID        string `json:"resourceId"`
	VersionAssetID    string `json:"versionAssetId"`
	WorkflowID        string `json:"workflowId"`
}

type ResourceImportAdvanceResult struct {
	ResourceID    string     `json:"resourceId"`
	Status        TaskStatus `json:"status"`
	WaitingReason string     `json:"waitingReason"`
}

type ResourceProvisionAdvanceRequest struct {
	CancelRequested bool                    `json:"cancelRequested"`
	RunID           string                  `json:"runId"`
	Target          ResourceProvisionTarget `json:"target"`
}

type ResourceProvisionTarget struct {
	ActionExecutionID    string         `json:"actionExecutionId"`
	BindingID            string         `json:"bindingId"`
	BindingVersion       int64          `json:"bindingVersion"`
	ComponentReleaseID   string         `json:"componentReleaseId"`
	NativeInstanceRef    string         `json:"nativeInstanceRef"`
	NativeScopeRef       string         `json:"nativeScopeRef"`
	ProjectionGeneration int64          `json:"projectionGeneration"`
	Reference            ResourceCreate `json:"reference"`
	ResourceID           string         `json:"resourceId"`
	ResourceVersion      int64          `json:"resourceVersion"`
	WorkflowID           string         `json:"workflowId"`
}

type ResourceProvisionAdvanceResult struct {
	ResourceID    string     `json:"resourceId"`
	Status        TaskStatus `json:"status"`
	WaitingReason string     `json:"waitingReason"`
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
	ErrorClassBLOCKED      ErrorClass = "BLOCKED"
	ErrorClassCONFLICT     ErrorClass = "CONFLICT"
	ErrorClassDENIED       ErrorClass = "DENIED"
	ErrorClassPRECONDITION ErrorClass = "PRECONDITION"
	ErrorClassUNKNOWN      ErrorClass = "UNKNOWN"
	Limit                  ErrorClass = "LIMIT"
)

type CanaryVariantsItemKind string

const (
	CanaryVariantsItemKindFILE CanaryVariantsItemKind = "FILE"
	Message                    CanaryVariantsItemKind = "MESSAGE"
	Task                       CanaryVariantsItemKind = "TASK"
)

type FileStorageShareOperation string

const (
	Revoke FileStorageShareOperation = "REVOKE"
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
	ExternalExecutionStatusSUCCEEDED ExternalExecutionStatus = "SUCCEEDED"
	ExternalExecutionStatusUNKNOWN   ExternalExecutionStatus = "UNKNOWN"
	PendingDispatch                  ExternalExecutionStatus = "PENDING_DISPATCH"
)

// 单次原生任务准入查询结果，不是新的持久任务生命周期。PENDING_REFERENCE 无票据；ADMITTED 才允许消费原任务尚未领取步骤。
type NativeTaskAdmissionState string

const (
	NativeTaskAdmissionStateADMITTED NativeTaskAdmissionState = "ADMITTED"
	PendingReference                 NativeTaskAdmissionState = "PENDING_REFERENCE"
)

type ProtocolSessionMode string

const (
	Edit ProtocolSessionMode = "EDIT"
	View ProtocolSessionMode = "VIEW"
)

// 系统通知文案的语言；通知不含正文。
type ProtocolSessionLocale string

const (
	En   ProtocolSessionLocale = "en"
	ZhCN ProtocolSessionLocale = "zh-CN"
)

type ProtocolSessionTheme string

const (
	Dark  ProtocolSessionTheme = "DARK"
	Light ProtocolSessionTheme = "LIGHT"
)

type DocumentLaunchDescriptorMethod string

const (
	DocumentLaunchDescriptorMethodGET  DocumentLaunchDescriptorMethod = "GET"
	DocumentLaunchDescriptorMethodPOST DocumentLaunchDescriptorMethod = "POST"
)

type ProtocolSessionLifecyclePepResponseDecision string

const (
	ProtocolSessionLifecyclePepResponseDecisionALLOW ProtocolSessionLifecyclePepResponseDecision = "ALLOW"
)

type AdapterProtocolSessionLifecycleResponseNativeState string

const (
	AdapterProtocolSessionLifecycleResponseNativeStateABSENT  AdapterProtocolSessionLifecycleResponseNativeState = "ABSENT"
	AdapterProtocolSessionLifecycleResponseNativeStateACTIVE  AdapterProtocolSessionLifecycleResponseNativeState = "ACTIVE"
	AdapterProtocolSessionLifecycleResponseNativeStateEXPIRED AdapterProtocolSessionLifecycleResponseNativeState = "EXPIRED"
)

type ProtocolSessionPepRequestNativeOperation string

const (
	ProtocolSessionPepRequestNativeOperationOBSERVE ProtocolSessionPepRequestNativeOperation = "OBSERVE"
	ProtocolSessionPepRequestNativeOperationOPEN    ProtocolSessionPepRequestNativeOperation = "OPEN"
	ProtocolSessionPepRequestNativeOperationREAD    ProtocolSessionPepRequestNativeOperation = "READ"
	ProtocolSessionPepRequestNativeOperationWRITE   ProtocolSessionPepRequestNativeOperation = "WRITE"
	TokenObserve                                    ProtocolSessionPepRequestNativeOperation = "TOKEN_OBSERVE"
	TokenRevoke                                     ProtocolSessionPepRequestNativeOperation = "TOKEN_REVOKE"
)

type ProtocolWriteObservationPhase string

const (
	ProtocolWriteObservationPhaseACCEPTED ProtocolWriteObservationPhase = "ACCEPTED"
	ProtocolWriteObservationPhaseCONFLICT ProtocolWriteObservationPhase = "CONFLICT"
	ProtocolWriteObservationPhaseFAILED   ProtocolWriteObservationPhase = "FAILED"
	ProtocolWriteObservationPhaseUNKNOWN  ProtocolWriteObservationPhase = "UNKNOWN"
	Started                               ProtocolWriteObservationPhase = "STARTED"
)

type ProtocolWriteReceiptState string

const (
	ProtocolWriteReceiptStateCONFLICT ProtocolWriteReceiptState = "CONFLICT"
	ProtocolWriteReceiptStateDIRTY    ProtocolWriteReceiptState = "DIRTY"
	ProtocolWriteReceiptStateFAILED   ProtocolWriteReceiptState = "FAILED"
	ProtocolWriteReceiptStateSAVED    ProtocolWriteReceiptState = "SAVED"
	ProtocolWriteReceiptStateUNKNOWN  ProtocolWriteReceiptState = "UNKNOWN"
)

// Native retry observation. COMPLETED requires both immutable receipts and committed usage;
// UNKNOWN/PENDING carry no renewed authorization.
type AdapterReadGrantResponseOutcome string

const (
	AdapterReadGrantResponseOutcomeCOMPLETED AdapterReadGrantResponseOutcome = "COMPLETED"
	AdapterReadGrantResponseOutcomePENDING   AdapterReadGrantResponseOutcome = "PENDING"
	AdapterReadGrantResponseOutcomeUNKNOWN   AdapterReadGrantResponseOutcome = "UNKNOWN"
)

type ApplicationReadResourceDirection string

const (
	ApplicationReadResourceDirectionRECEIVER ApplicationReadResourceDirection = "RECEIVER"
	Source                                   ApplicationReadResourceDirection = "SOURCE"
)

// DD-138(5)、07 §4.8.4：组件搜索结果的类别（封闭枚举）。
type ComponentSearchResultKind string

const (
	ComponentSearchResultKindFILE ComponentSearchResultKind = "FILE"
	Dashboard                     ComponentSearchResultKind = "DASHBOARD"
	Document                      ComponentSearchResultKind = "DOCUMENT"
	Folder                        ComponentSearchResultKind = "FOLDER"
	KnowledgeBase                 ComponentSearchResultKind = "KNOWLEDGE_BASE"
	Question                      ComponentSearchResultKind = "QUESTION"
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

// DD-126(4)：ACTIVE＝持久 ACTIVE、在有效期内、次数未尽且每个 Scope 的同意摘要与当前解析定义相等；NEEDS_RENEWAL＝其余条件成立但有
// Scope 的同意摘要已变化或当前已无可解析定义；NOT_YET_VALID/EXPIRED/USES_EXHAUSTED
// 按时钟与使用次数；REVOKING/REVOKED/SUPERSEDED 取持久状态。
type DelegationEffectiveState string

const (
	DelegationEffectiveStateACTIVE     DelegationEffectiveState = "ACTIVE"
	DelegationEffectiveStateEXPIRED    DelegationEffectiveState = "EXPIRED"
	DelegationEffectiveStateREVOKED    DelegationEffectiveState = "REVOKED"
	DelegationEffectiveStateREVOKING   DelegationEffectiveState = "REVOKING"
	DelegationEffectiveStateSUPERSEDED DelegationEffectiveState = "SUPERSEDED"
	NeedsRenewal                       DelegationEffectiveState = "NEEDS_RENEWAL"
	NotYetValid                        DelegationEffectiveState = "NOT_YET_VALID"
	UsesExhausted                      DelegationEffectiveState = "USES_EXHAUSTED"
)

type DelegationScopeParametersResultExposureMode string

const (
	ConsumeOnly                                       DelegationScopeParametersResultExposureMode = "CONSUME_ONLY"
	DelegationScopeParametersResultExposureModeEXPORT DelegationScopeParametersResultExposureMode = "EXPORT"
	DelegationScopeParametersResultExposureModeREAD   DelegationScopeParametersResultExposureMode = "READ"
)

type AgentDelegationViewState string

const (
	AgentDelegationViewStateACTIVE     AgentDelegationViewState = "ACTIVE"
	AgentDelegationViewStateEXPIRED    AgentDelegationViewState = "EXPIRED"
	AgentDelegationViewStateREVOKED    AgentDelegationViewState = "REVOKED"
	AgentDelegationViewStateREVOKING   AgentDelegationViewState = "REVOKING"
	AgentDelegationViewStateSUPERSEDED AgentDelegationViewState = "SUPERSEDED"
)

type RuntimeProfileKind string

const (
	LocalACP       RuntimeProfileKind = "LOCAL_ACP"
	RemoteProvider RuntimeProfileKind = "REMOTE_PROVIDER"
	ServerCodex    RuntimeProfileKind = "SERVER_CODEX"
)

type AgentInstallationViewAgentPrincipalState string

const (
	AgentInstallationViewAgentPrincipalStateACTIVE   AgentInstallationViewAgentPrincipalState = "ACTIVE"
	AgentInstallationViewAgentPrincipalStateDISABLED AgentInstallationViewAgentPrincipalState = "DISABLED"
)

type AutomationResultTarget string

const (
	Channel       AutomationResultTarget = "CHANNEL"
	TriggerThread AutomationResultTarget = "TRIGGER_THREAD"
)

type AgentInstallationViewChannelBindingStatus string

const (
	AgentInstallationViewChannelBindingStatusACTIVE   AgentInstallationViewChannelBindingStatus = "ACTIVE"
	AgentInstallationViewChannelBindingStatusDISABLED AgentInstallationViewChannelBindingStatus = "DISABLED"
	AgentInstallationViewChannelBindingStatusERROR    AgentInstallationViewChannelBindingStatus = "ERROR"
)

type AgentTrigger string

const (
	AgentTriggerMENTION AgentTrigger = "MENTION"
	ManualAssignment    AgentTrigger = "MANUAL_ASSIGNMENT"
)

// 03 §7 的静态运行投影状态，不承载 Invocation 动态准入。
type AgentRuntimeProjectionState string

const (
	AgentRuntimeProjectionStateACTIVE  AgentRuntimeProjectionState = "ACTIVE"
	AgentRuntimeProjectionStateERROR   AgentRuntimeProjectionState = "ERROR"
	AgentRuntimeProjectionStatePENDING AgentRuntimeProjectionState = "PENDING"
	AgentRuntimeProjectionStateREVOKED AgentRuntimeProjectionState = "REVOKED"
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

// DD-135(5)(7)、17 §4：Installation 中一个被引 Skill 的当前状态。PROJECTION_FAILED 与 RUNTIME_NOT_READY
// 来自 generation 投影；DISABLED 与 NO_PERMISSION 来自读取时的 fresh 判定，与每次 turn/start 前的判定同一规则。
type AgentInstallationSkillStatus string

const (
	AgentInstallationSkillStatusDISABLED     AgentInstallationSkillStatus = "DISABLED"
	AgentInstallationSkillStatusNOPERMISSION AgentInstallationSkillStatus = "NO_PERMISSION"
	Effective                                AgentInstallationSkillStatus = "EFFECTIVE"
	ProjectionFailed                         AgentInstallationSkillStatus = "PROJECTION_FAILED"
	RuntimeNotReady                          AgentInstallationSkillStatus = "RUNTIME_NOT_READY"
)

type AgentToolBindingStatus string

const (
	AgentToolBindingStatusACTIVE       AgentToolBindingStatus = "ACTIVE"
	AgentToolBindingStatusNOPERMISSION AgentToolBindingStatus = "NO_PERMISSION"
	AgentToolBindingStatusPENDING      AgentToolBindingStatus = "PENDING"
	AgentToolBindingStatusREVOKED      AgentToolBindingStatus = "REVOKED"
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
	DelegationRenewalRequired    ReasonCode = "DELEGATION_RENEWAL_REQUIRED"
	DelegationRequired           ReasonCode = "DELEGATION_REQUIRED"
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
	PublishRejected              ReasonCode = "PUBLISH_REJECTED"
	PublishResultUnknown         ReasonCode = "PUBLISH_RESULT_UNKNOWN"
	QuotaExhausted               ReasonCode = "QUOTA_EXHAUSTED"
	RateLimited                  ReasonCode = "RATE_LIMITED"
	ReasonCodePROJECTIONDELAYED  ReasonCode = "PROJECTION_DELAYED"
	ScopeGuardFailed             ReasonCode = "SCOPE_GUARD_FAILED"
	SelfApprovalDenied           ReasonCode = "SELF_APPROVAL_DENIED"
	SessionNotActive             ReasonCode = "SESSION_NOT_ACTIVE"
	StepTimeout                  ReasonCode = "STEP_TIMEOUT"
	SurfaceCapabilityUnavailable ReasonCode = "SURFACE_CAPABILITY_UNAVAILABLE"
	TargetNotFound               ReasonCode = "TARGET_NOT_FOUND"
	TargetStateConflict          ReasonCode = "TARGET_STATE_CONFLICT"
	TenantMembershipNotActive    ReasonCode = "TENANT_MEMBERSHIP_NOT_ACTIVE"
	TenantNotActive              ReasonCode = "TENANT_NOT_ACTIVE"
	TenantSelectionNotAvailable  ReasonCode = "TENANT_SELECTION_NOT_AVAILABLE"
	WaitingApproval              ReasonCode = "WAITING_APPROVAL"
)

type AgentInstallationToolSource string

const (
	AgentInstallationToolSourcePLATFORMNATIVE         AgentInstallationToolSource = "PLATFORM_NATIVE"
	AgentInstallationToolSourceUSERREGISTEREDEXTERNAL AgentInstallationToolSource = "USER_REGISTERED_EXTERNAL"
	Application                                       AgentInstallationToolSource = "APPLICATION"
)

// DD-125(6)：原 respondTo 在本页的映射。至少一名成员 requested=true 即 ALLOWLIST，否则 OWNER_ONLY；切换只经逐成员
// agent.installation.use.grant/revoke，不存在 anyone。旧服务缺省时客户端按 members 推导。
//
// 原 Buzz respondTo 在 Kailo 的映射（DD-125(6)、05 §2.10）：OWNER_ONLY ≙ 默认（只有 owner、Workspace
// manage 与 Tenant manage 持有使用权），ALLOWLIST ≙ 至少一名成员经 agent.installation.use.grant 显式授予。原
// anyone 不提供：频道成员关系不推导业务 Resource permission（10 §3）。
type AgentRespondToMode string

const (
	Allowlist AgentRespondToMode = "ALLOWLIST"
	OwnerOnly AgentRespondToMode = "OWNER_ONLY"
)

type AgentInvocationViewStatus string

const (
	AgentInvocationViewStatusCANCELED  AgentInvocationViewStatus = "CANCELED"
	AgentInvocationViewStatusCOMPLETED AgentInvocationViewStatus = "COMPLETED"
	AgentInvocationViewStatusFAILED    AgentInvocationViewStatus = "FAILED"
	AgentInvocationViewStatusRUNNING   AgentInvocationViewStatus = "RUNNING"
	AgentInvocationViewStatusUNKNOWN   AgentInvocationViewStatus = "UNKNOWN"
	Created                            AgentInvocationViewStatus = "CREATED"
	Dispatching                        AgentInvocationViewStatus = "DISPATCHING"
)

type AgentMemoryEntryPageState string

const (
	AgentMemoryEntryPageStateCOMPLETE AgentMemoryEntryPageState = "COMPLETE"
	AgentMemoryEntryPageStateUNKNOWN  AgentMemoryEntryPageState = "UNKNOWN"
	BoundExceeded                     AgentMemoryEntryPageState = "BOUND_EXCEEDED"
)

type AgentMemoryReadViewState string

const (
	AgentMemoryReadViewStateABSENT AgentMemoryReadViewState = "ABSENT"
	AgentMemoryReadViewStateFOUND  AgentMemoryReadViewState = "FOUND"
	Unreadable                     AgentMemoryReadViewState = "UNREADABLE"
)

type AgentMentionOutcomeState string

const (
	AgentMentionOutcomeStateDENIED  AgentMentionOutcomeState = "DENIED"
	AgentMentionOutcomeStateFAILED  AgentMentionOutcomeState = "FAILED"
	AgentMentionOutcomeStateRUNNING AgentMentionOutcomeState = "RUNNING"
	Replied                         AgentMentionOutcomeState = "REPLIED"
)

// ABANDONED：只剩 birth 结果不明、Invocation 已全部确定终态的 Session 超过对账期限后由 Core 放弃，不再派发 turn（DD-154）。
type AgentSessionViewStatus string

const (
	Abandoned                     AgentSessionViewStatus = "ABANDONED"
	AgentSessionViewStatusACTIVE  AgentSessionViewStatus = "ACTIVE"
	AgentSessionViewStatusCLOSED  AgentSessionViewStatus = "CLOSED"
	AgentSessionViewStatusPENDING AgentSessionViewStatus = "PENDING"
	AgentSessionViewStatusUNKNOWN AgentSessionViewStatus = "UNKNOWN"
	Starting                      AgentSessionViewStatus = "STARTING"
)

type AgentSnapshotImportPreviewFormatKey string

const (
	BuzzAgentSnapshot1 AgentSnapshotImportPreviewFormatKey = "buzz-agent-snapshot@1"
)

// 05 §2.12 TransferFormat 的 package_media_type：`.agent.json` 清单本身，或 tEXt
// `buzz_agent_snapshot` 承载同一清单的 `.agent.png`。
type AgentSnapshotMediaType string

const (
	ApplicationJSON AgentSnapshotMediaType = "application/json"
	ImagePNG        AgentSnapshotMediaType = "image/png"
)

// DD-131(2)：快照中存在、导入不带入新 DRAFT 的原版字段。RUNTIME/MODEL/PROVIDER/NAME_POOL
// 属本机运行时（DD-26）；RESPOND_TO_ALLOWLIST 的名单公钥属来源身份；RESPOND_TO_ANYONE
// 不提供（DD-125(6)）；SESSION_POLICY 由运行时合同决定；MEMORY 见 DD-131(4)；AVATAR
// 只指包引用的外部头像地址（内联头像按附件规则导入，不在此列）；SKILLS 由 owner 按本 Tenant 目录重选。
type AgentSnapshotOmission string

const (
	AgentSnapshotOmissionMODEL AgentSnapshotOmission = "MODEL"
	Avatar                     AgentSnapshotOmission = "AVATAR"
	Memory                     AgentSnapshotOmission = "MEMORY"
	NamePool                   AgentSnapshotOmission = "NAME_POOL"
	Provider                   AgentSnapshotOmission = "PROVIDER"
	RespondToAllowlist         AgentSnapshotOmission = "RESPOND_TO_ALLOWLIST"
	RespondToAnyone            AgentSnapshotOmission = "RESPOND_TO_ANYONE"
	Runtime                    AgentSnapshotOmission = "RUNTIME"
	SessionPolicy              AgentSnapshotOmission = "SESSION_POLICY"
	Skills                     AgentSnapshotOmission = "SKILLS"
)

type AgentTeamSnapshotImportPreviewFormatKey string

const (
	BuzzTeamSnapshot1 AgentTeamSnapshotImportPreviewFormatKey = "buzz-team-snapshot@1"
)

// Codex FileUpdateChange.kind 的标签（add/delete/update）；update 的改名目标另以 movePath 给出。
type AgentTranscriptFileChangeKind string

const (
	Add                                 AgentTranscriptFileChangeKind = "ADD"
	AgentTranscriptFileChangeKindDELETE AgentTranscriptFileChangeKind = "DELETE"
	AgentTranscriptFileChangeKindUPDATE AgentTranscriptFileChangeKind = "UPDATE"
)

// DD-125(6)、SF-COD-17：Codex app-server 持久 ThreadItem 的类型标签在转写线格式中的封闭投影。BFF 只把固定 Codex 的
// userMessage/agentMessage/plan/reasoning/commandExecution/fileChange/mcpToolCall/dynamicToolCall/webSearch/imageView/contextCompaction
// 映射为对应值，其余原生类型一律 OTHER 并保留 nativeType；客户端按原 Buzz 转写条目（TranscriptItem）呈现。
type AgentTranscriptItemKind string

const (
	AgentMessage                 AgentTranscriptItemKind = "AGENT_MESSAGE"
	AgentTranscriptItemKindOTHER AgentTranscriptItemKind = "OTHER"
	CommandExecution             AgentTranscriptItemKind = "COMMAND_EXECUTION"
	ContextCompaction            AgentTranscriptItemKind = "CONTEXT_COMPACTION"
	DynamicToolCall              AgentTranscriptItemKind = "DYNAMIC_TOOL_CALL"
	FileChange                   AgentTranscriptItemKind = "FILE_CHANGE"
	ImageView                    AgentTranscriptItemKind = "IMAGE_VIEW"
	MCPToolCall                  AgentTranscriptItemKind = "MCP_TOOL_CALL"
	Plan                         AgentTranscriptItemKind = "PLAN"
	Reasoning                    AgentTranscriptItemKind = "REASONING"
	UserMessage                  AgentTranscriptItemKind = "USER_MESSAGE"
	WebSearch                    AgentTranscriptItemKind = "WEB_SEARCH"
)

// Codex agentMessage 的 phase（commentary / final_answer）；原生缺省 phase 的旧消息省略本字段。
type AgentTranscriptMessagePhase string

const (
	Commentary  AgentTranscriptMessagePhase = "COMMENTARY"
	FinalAnswer AgentTranscriptMessagePhase = "FINAL_ANSWER"
)

// Codex commandExecution/fileChange/mcpToolCall/dynamicToolCall
// 的原生状态（inProgress/completed/failed/declined）在转写中的封闭投影；无状态的条目省略。
type AgentTranscriptItemStatus string

const (
	AgentTranscriptItemStatusCOMPLETED AgentTranscriptItemStatus = "COMPLETED"
	AgentTranscriptItemStatusFAILED    AgentTranscriptItemStatus = "FAILED"
	Declined                           AgentTranscriptItemStatus = "DECLINED"
	InProgress                         AgentTranscriptItemStatus = "IN_PROGRESS"
)

// 实时转写帧的来源通知：item/started、item/completed、turn/started、turn/completed（SF-COD-17）。只转发 Core
// 已从同一 Installation 原生进程读到的通知，不合成。
type AgentTranscriptEventPhase string

const (
	ItemCompleted AgentTranscriptEventPhase = "ITEM_COMPLETED"
	ItemStarted   AgentTranscriptEventPhase = "ITEM_STARTED"
	TurnCompleted AgentTranscriptEventPhase = "TURN_COMPLETED"
	TurnStarted   AgentTranscriptEventPhase = "TURN_STARTED"
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

type AgentVersionState string

const (
	AgentVersionStateDRAFT   AgentVersionState = "DRAFT"
	AgentVersionStateRETIRED AgentVersionState = "RETIRED"
	Published                AgentVersionState = "PUBLISHED"
)

// DD-127(4): presentation category the approved NATIVE_PAGE release declares. The sidebar
// labels the entry by capabilityCategories ∪ this value; it grants nothing.
//
// DD-127(4)：NATIVE_PAGE 入口的呈现类别，决定侧边栏标签与图标；不授予能力、不参与类别解析或授权。
type NativePageCategory string

const (
	DataQuery                     NativePageCategory = "data_query"
	Knowledge                     NativePageCategory = "knowledge"
	NativePageCategoryFileStorage NativePageCategory = "file_storage"
)

// DD-138：组件偏好项所属的 Kailo 设置功能分类（07 §4.8.2）。APPEARANCE 外观、NOTIFICATIONS 通知、DOCUMENTS
// 文档与文件、ANSWERS 问答；不按组件分类。
type ComponentPreferenceCategory string

const (
	Answers       ComponentPreferenceCategory = "ANSWERS"
	Appearance    ComponentPreferenceCategory = "APPEARANCE"
	Documents     ComponentPreferenceCategory = "DOCUMENTS"
	Notifications ComponentPreferenceCategory = "NOTIFICATIONS"
)

// DD-138：组件偏好项的取值类型。只有布尔与封闭选项，不接受自由文本、数字区间、URL、凭据或用户数据（07 §4.8.2）。
type ComponentPreferenceValueType string

const (
	Boolean ComponentPreferenceValueType = "BOOLEAN"
	Enum    ComponentPreferenceValueType = "ENUM"
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

// 只在准入事务内改写 Core 的 Workspace 可见性；已有成员不变，不写 SpiceDB，Relay 投影保持 private、不发送 visibility 标签。
//
// DD-80 的产品可见性：open 仅指同 Tenant 成员可发现并经 Core 加入；Relay 投影始终 private。
//
// 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
//
// Core 产品可见性，不从 Relay private 投影推断；旧回应可能省略。
type WorkspaceVisibility string

const (
	Private                 WorkspaceVisibility = "private"
	WorkspaceVisibilityOpen WorkspaceVisibility = "open"
)

// ApprovalWorkflow 的状态（.design/06 §4）：REQUESTED → WAITING → APPROVED | DENIED | EXPIRED |
// CANCELLED；APPROVED → CONSUMED | INVALIDATED。只由 Temporal history 投影。
type ApprovalStatus string

const (
	ApprovalStatusAPPROVED  ApprovalStatus = "APPROVED"
	ApprovalStatusCANCELLED ApprovalStatus = "CANCELLED"
	ApprovalStatusCONSUMED  ApprovalStatus = "CONSUMED"
	ApprovalStatusDENIED    ApprovalStatus = "DENIED"
	ApprovalStatusEXPIRED   ApprovalStatus = "EXPIRED"
	ApprovalStatusWAITING   ApprovalStatus = "WAITING"
	Invalidated             ApprovalStatus = "INVALIDATED"
	Requested               ApprovalStatus = "REQUESTED"
)

// AuditEvent 的类型（.design/03 §9）。tenant_id 为空只允许 AUTHENTICATION 与 SESSION，且仅限 AgentGateway
// OIDC callback 之后、Core 尚未解析出可用 TenantMembership 的那段边界（DD-52/54）。
type AuditEventType string

const (
	Access                 AuditEventType = "ACCESS"
	AuditEventTypeAPPROVAL AuditEventType = "APPROVAL"
	Authentication         AuditEventType = "AUTHENTICATION"
	Decision               AuditEventType = "DECISION"
	Dispatch               AuditEventType = "DISPATCH"
	Intent                 AuditEventType = "INTENT"
	Outcome                AuditEventType = "OUTCOME"
	Reconciliation         AuditEventType = "RECONCILIATION"
	Revocation             AuditEventType = "REVOCATION"
	Session                AuditEventType = "SESSION"
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
// version），权威源、证据类型与敏感级别由种类唯一确定（Core 的固定描述表）。库中存量出现不在此列的种类时解释为不可用，不猜测含义。DD-135(8) 的 Skill
// 证据：`SKILL_SLUG` 为定义 slug；`SKILL_VERSION_ASSET_ID` 为版本 Asset ID，version
// 为版本序号；`SKILL_ARTIFACT_DIGEST` 为规范 artifact 的 SHA-256，version 为其字节数；`SKILL_UPLOAD_DIGEST`
// 为上传字节的 SHA-256。均不含 SKILL.md 正文。
type EvidenceKind string

const (
	AdmitActionExecutionID        EvidenceKind = "ADMIT_ACTION_EXECUTION_ID"
	AgentVersionAssetID           EvidenceKind = "AGENT_VERSION_ASSET_ID"
	AgentgatewayUsageID           EvidenceKind = "AGENTGATEWAY_USAGE_ID"
	ApplicationBindingID          EvidenceKind = "APPLICATION_BINDING_ID"
	ApprovalPolicy                EvidenceKind = "APPROVAL_POLICY"
	ApprovalWorkflowID            EvidenceKind = "APPROVAL_WORKFLOW_ID"
	BuzzDeletionInventoryDigest   EvidenceKind = "BUZZ_DELETION_INVENTORY_DIGEST"
	BuzzDeletionRequestID         EvidenceKind = "BUZZ_DELETION_REQUEST_ID"
	BuzzEventID                   EvidenceKind = "BUZZ_EVENT_ID"
	BuzzPubkey                    EvidenceKind = "BUZZ_PUBKEY"
	DeploymentBootstrap           EvidenceKind = "DEPLOYMENT_BOOTSTRAP"
	EvidenceKindACTIONEXECUTIONID EvidenceKind = "ACTION_EXECUTION_ID"
	ExportPackageAssetID          EvidenceKind = "EXPORT_PACKAGE_ASSET_ID"
	ExternalSubjectSha256         EvidenceKind = "EXTERNAL_SUBJECT_SHA256"
	OpenmeterEventID              EvidenceKind = "OPENMETER_EVENT_ID"
	OriginalActionExecutionID     EvidenceKind = "ORIGINAL_ACTION_EXECUTION_ID"
	PlatformSessionID             EvidenceKind = "PLATFORM_SESSION_ID"
	SecretRefRehomeID             EvidenceKind = "SECRET_REF_REHOME_ID"
	SkillArtifactDigest           EvidenceKind = "SKILL_ARTIFACT_DIGEST"
	SkillSlug                     EvidenceKind = "SKILL_SLUG"
	SkillUploadDigest             EvidenceKind = "SKILL_UPLOAD_DIGEST"
	SkillVersionAssetID           EvidenceKind = "SKILL_VERSION_ASSET_ID"
	SpicedbRelationship           EvidenceKind = "SPICEDB_RELATIONSHIP"
	SpicedbZedtoken               EvidenceKind = "SPICEDB_ZEDTOKEN"
	TemporalFirstRunID            EvidenceKind = "TEMPORAL_FIRST_RUN_ID"
	TemporalRunID                 EvidenceKind = "TEMPORAL_RUN_ID"
	TemporalWorkflowID            EvidenceKind = "TEMPORAL_WORKFLOW_ID"
	TenantDeleteSubprocessID      EvidenceKind = "TENANT_DELETE_SUBPROCESS_ID"
	TenantInvitationID            EvidenceKind = "TENANT_INVITATION_ID"
	TenantLifecycleSnapshotID     EvidenceKind = "TENANT_LIFECYCLE_SNAPSHOT_ID"
	TenantMembershipID            EvidenceKind = "TENANT_MEMBERSHIP_ID"
	TraceID                       EvidenceKind = "TRACE_ID"
	TransferFormat                EvidenceKind = "TRANSFER_FORMAT"
	TransferPackageDigest         EvidenceKind = "TRANSFER_PACKAGE_DIGEST"
	UsageEventID                  EvidenceKind = "USAGE_EVENT_ID"
	WorkspaceLifecycleSnapshotID  EvidenceKind = "WORKSPACE_LIFECYCLE_SNAPSHOT_ID"
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

type AutomationVersionContentActionKind string

const (
	AgentTurn   AutomationVersionContentActionKind = "AGENT_TURN"
	PostMessage AutomationVersionContentActionKind = "POST_MESSAGE"
)

type AutomationStepAction string

const (
	AddReaction     AutomationStepAction = "add_reaction"
	CallWebhook     AutomationStepAction = "call_webhook"
	Delay           AutomationStepAction = "delay"
	RequestApproval AutomationStepAction = "request_approval"
	SendMessage     AutomationStepAction = "send_message"
	SetChannelTopic AutomationStepAction = "set_channel_topic"
)

// 原 HTTP 方法，缺省 POST。
type AutomationStepMethod string

const (
	AutomationStepMethodDELETE AutomationStepMethod = "DELETE"
	AutomationStepMethodGET    AutomationStepMethod = "GET"
	AutomationStepMethodPOST   AutomationStepMethod = "POST"
	Patch                      AutomationStepMethod = "PATCH"
	Put                        AutomationStepMethod = "PUT"
)

type AutomationTriggerKind string

const (
	AutomationTriggerKindMENTION  AutomationTriggerKind = "MENTION"
	AutomationTriggerKindSCHEDULE AutomationTriggerKind = "SCHEDULE"
	ChannelMessage                AutomationTriggerKind = "CHANNEL_MESSAGE"
	DiffPosted                    AutomationTriggerKind = "DIFF_POSTED"
	ReactionAdded                 AutomationTriggerKind = "REACTION_ADDED"
	Webhook                       AutomationTriggerKind = "WEBHOOK"
)

// 旧 interval 缺省保持原格式及摘要；cron 必须显式 CRON。互斥及必需字段由领域消费者验证。
type AutomationScheduleSpecKind string

const (
	Cron     AutomationScheduleSpecKind = "CRON"
	Interval AutomationScheduleSpecKind = "INTERVAL"
)

type AutomationStepStatus string

const (
	AutomationStepStatusCancelled       AutomationStepStatus = "cancelled"
	AutomationStepStatusPending         AutomationStepStatus = "pending"
	AutomationStepStatusWaitingApproval AutomationStepStatus = "waiting_approval"
	Completed                           AutomationStepStatus = "completed"
	Failed                              AutomationStepStatus = "failed"
	Running                             AutomationStepStatus = "running"
	Skipped                             AutomationStepStatus = "skipped"
	Unknown                             AutomationStepStatus = "unknown"
)

// ActionExecution 的派发状态（.design/03 §6）。UNKNOWN 是结果不明，既不是成功也不是失败——只有已登记的 native query/dedupe
// seam 能把它收敛，不能因无 native ID 就自动重放（DD-48）。
type ActionDispatchState string

const (
	ActionDispatchStateABORTED       ActionDispatchState = "ABORTED"
	ActionDispatchStateNOTDISPATCHED ActionDispatchState = "NOT_DISPATCHED"
	ActionDispatchStateUNKNOWN       ActionDispatchState = "UNKNOWN"
	Dispatched                       ActionDispatchState = "DISPATCHED"
)

// ActionExecution 的准入门禁状态（.design/03 §6）。它与 dispatch_state
// 是两台独立状态机：门禁说的是「允许不允许」，派发说的是「副作用发生没发生」，合并后无法表达「准入通过但派发结果不明」。
type ActionGateState string

const (
	ActionGateStateALLOWED    ActionGateState = "ALLOWED"
	ActionGateStateDENIED     ActionGateState = "DENIED"
	ActionGateStateEVALUATING ActionGateState = "EVALUATING"
	ActionGateStateEXPIRED    ActionGateState = "EXPIRED"
	ActionGateStateREVOKED    ActionGateState = "REVOKED"
	ActionGateStateWAITING    ActionGateState = "WAITING"
)

// TaskProjection 的状态（.design/03 §6、.design/06 §3.1）。RUNNING 之外的值都是 Temporal 的终态，与其 close
// status 一一对应：Workflow 自己写回的只有 COMPLETED 与 FAILED，其余三个只来自兜底对账对 Temporal 的观察。任一终态都使
// WorkflowRef 进入 TERMINAL。
type TaskStatus string

const (
	TaskStatusCANCELED   TaskStatus = "CANCELED"
	TaskStatusCOMPLETED  TaskStatus = "COMPLETED"
	TaskStatusFAILED     TaskStatus = "FAILED"
	TaskStatusRUNNING    TaskStatus = "RUNNING"
	TaskStatusTERMINATED TaskStatus = "TERMINATED"
	TaskStatusTIMEDOUT   TaskStatus = "TIMED_OUT"
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
	ResourceExport           WorkflowKind = "RESOURCE_EXPORT"
	ResourceImport           WorkflowKind = "RESOURCE_IMPORT"
	ResourceProvision        WorkflowKind = "RESOURCE_PROVISION"
	SecretRefRehome          WorkflowKind = "SECRET_REF_REHOME"
	TenantLifecycle          WorkflowKind = "TENANT_LIFECYCLE"
	WorkspaceLifecycle       WorkflowKind = "WORKSPACE_LIFECYCLE"
)

// 业务操作视图的当前阶段（.design/14 §7、§8），由 Core 按 ActionExecution 准入/派发、ApprovalProjection 与
// TaskProjection 唯一推导；投影不可担保为当前时为 PROJECTION_DELAYED，外部结果不明时为 UNKNOWN，二者都不是成功或失败。APPLIED
// 只用于无 Workflow 的同步动作返回结果；CANCEL_REQUESTED 只表示取消控制被接受，不表示原任务已终结。
type BusinessOperationPhase string

const (
	Applied                                 BusinessOperationPhase = "APPLIED"
	AwaitingApproval                        BusinessOperationPhase = "AWAITING_APPROVAL"
	BusinessOperationPhaseABORTED           BusinessOperationPhase = "ABORTED"
	BusinessOperationPhaseCANCELED          BusinessOperationPhase = "CANCELED"
	BusinessOperationPhaseCOMPLETED         BusinessOperationPhase = "COMPLETED"
	BusinessOperationPhaseDENIED            BusinessOperationPhase = "DENIED"
	BusinessOperationPhaseEVALUATING        BusinessOperationPhase = "EVALUATING"
	BusinessOperationPhaseEXPIRED           BusinessOperationPhase = "EXPIRED"
	BusinessOperationPhaseFAILED            BusinessOperationPhase = "FAILED"
	BusinessOperationPhasePROJECTIONDELAYED BusinessOperationPhase = "PROJECTION_DELAYED"
	BusinessOperationPhaseREVOKED           BusinessOperationPhase = "REVOKED"
	BusinessOperationPhaseRUNNING           BusinessOperationPhase = "RUNNING"
	BusinessOperationPhaseTERMINATED        BusinessOperationPhase = "TERMINATED"
	BusinessOperationPhaseTIMEDOUT          BusinessOperationPhase = "TIMED_OUT"
	BusinessOperationPhaseUNKNOWN           BusinessOperationPhase = "UNKNOWN"
	CancelRequested                         BusinessOperationPhase = "CANCEL_REQUESTED"
	NotStarted                              BusinessOperationPhase = "NOT_STARTED"
)

// Core UsageEvent outbox 的投递事实（.design/11 §4 第 7 条）。PENDING_PUBLISH 尚未取得 OpenMeter
// 回应；ACCEPTED 只表示 202 接收；COMMITTED 表示按 ID/source 查到 stored_at；UNKNOWN 待对账；FAILED 为确定拒绝。均不表示
// invoice 已结算。
type UsageSettlementStatus string

const (
	PendingPublish                 UsageSettlementStatus = "PENDING_PUBLISH"
	UsageSettlementStatusACCEPTED  UsageSettlementStatus = "ACCEPTED"
	UsageSettlementStatusCOMMITTED UsageSettlementStatus = "COMMITTED"
	UsageSettlementStatusFAILED    UsageSettlementStatus = "FAILED"
	UsageSettlementStatusUNKNOWN   UsageSettlementStatus = "UNKNOWN"
)

// 一个业务操作的用量结算状态（.design/11 §4、§6，.design/14
// §8）。NOT_METERED：动作定义没有用量来源；NOT_DISPATCHED：有计量但没有派发；BILLING_UNAVAILABLE：已派发却没有可结算的持久用量事实（不显示零）；SETTLEMENT_PENDING：用量事件待发布或
// OpenMeter 仅 202 接收；COMMITTED：全部事件已按 ID/source 查到
// stored_at；UNKNOWN：投递或查证结果不明，待对账；FAILED：投递被确定拒绝。COMMITTED 不代表账单已结算。
type OperationUsageState string

const (
	BillingUnavailable               OperationUsageState = "BILLING_UNAVAILABLE"
	NotMetered                       OperationUsageState = "NOT_METERED"
	OperationUsageStateCOMMITTED     OperationUsageState = "COMMITTED"
	OperationUsageStateFAILED        OperationUsageState = "FAILED"
	OperationUsageStateNOTDISPATCHED OperationUsageState = "NOT_DISPATCHED"
	OperationUsageStateUNKNOWN       OperationUsageState = "UNKNOWN"
	SettlementPending                OperationUsageState = "SETTLEMENT_PENDING"
)

type CapabilityContractStatus string

const (
	CapabilityContractStatusACTIVE  CapabilityContractStatus = "ACTIVE"
	CapabilityContractStatusDRAFT   CapabilityContractStatus = "DRAFT"
	CapabilityContractStatusRETIRED CapabilityContractStatus = "RETIRED"
	Deprecated                      CapabilityContractStatus = "DEPRECATED"
)

type WorkspaceChannelCreateChannelType string

const (
	Forum  WorkspaceChannelCreateChannelType = "forum"
	Stream WorkspaceChannelCreateChannelType = "stream"
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
	Cancel                               ComponentConformanceOperation = "cancel"
	ComponentConformanceOperationExecute ComponentConformanceOperation = "execute"
	ExtractUsage                         ComponentConformanceOperation = "extract_usage"
	Handshake                            ComponentConformanceOperation = "handshake"
	MCPCall                              ComponentConformanceOperation = "mcp_call"
	MCPInitialize                        ComponentConformanceOperation = "mcp_initialize"
	MCPList                              ComponentConformanceOperation = "mcp_list"
	MapNativeStatusError                 ComponentConformanceOperation = "map_native_status_error"
	Observe                              ComponentConformanceOperation = "observe"
	QueryRevision                        ComponentConformanceOperation = "query_revision"
	ReceiverObserve                      ComponentConformanceOperation = "receiver_observe"
	ReceiverStart                        ComponentConformanceOperation = "receiver_start"
	Reconcile                            ComponentConformanceOperation = "reconcile"
	ResolveNativeScope                   ComponentConformanceOperation = "resolve_native_scope"
	ValidateBinding                      ComponentConformanceOperation = "validate_binding"
)

type ComponentConformancePlanConnectorKind string

const (
	ProtocolPeer  ComponentConformancePlanConnectorKind = "PROTOCOL_PEER"
	RemoteAdapter ComponentConformancePlanConnectorKind = "REMOTE_ADAPTER"
)

// DD-124(2): the vector document a JSON Pointer addresses — the step input or its expected
// output.
type CapabilityVectorSide string

const (
	Expected CapabilityVectorSide = "EXPECTED"
	Input    CapabilityVectorSide = "INPUT"
)

// DD-124(1)(2): the two non-literal value sources of a V2 conformance vector. Every other
// value is LITERAL; there is no third binding source.
type CapabilityVectorBindingSource string

const (
	CapabilityVectorBindingSourcePRECONDITION CapabilityVectorBindingSource = "PRECONDITION"
	Capture                                   CapabilityVectorBindingSource = "CAPTURE"
)

// DD-124(1): the closed observation slots a CAPTURE may take. CONTENT_REFERENCE_* read the
// adapter's typed ContentReference; GENERATED_REF reads an output field listed in the
// vector document's generatedRefs; ACTION_EXECUTION_ID/OPERATION_ID are the SOURCE read
// ActionExecution and Operation the isolated Core generated for a step of a RECEIVER case
// in this run (never present in the plan or fixture).
type CapabilityVectorCaptureSlot string

const (
	CapabilityVectorCaptureSlotACTIONEXECUTIONID CapabilityVectorCaptureSlot = "ACTION_EXECUTION_ID"
	ContentReferenceNativeObjectRef              CapabilityVectorCaptureSlot = "CONTENT_REFERENCE_NATIVE_OBJECT_REF"
	ContentReferenceNativeRevision               CapabilityVectorCaptureSlot = "CONTENT_REFERENCE_NATIVE_REVISION"
	GeneratedRef                                 CapabilityVectorCaptureSlot = "GENERATED_REF"
	OperationID                                  CapabilityVectorCaptureSlot = "OPERATION_ID"
)

type ComponentConformanceStepExpectedMCPResultKind string

const (
	ComponentConformanceStepExpectedMCPResultKindERROR ComponentConformanceStepExpectedMCPResultKind = "ERROR"
	Result                                             ComponentConformanceStepExpectedMCPResultKind = "RESULT"
)

// 成员目录中的 Kailo 角色（.design/07 §4.7.4、DD-133(4)）：SpiceDB 对 Tenant 或 Workspace 有 `manage` 为
// ADMIN，否则 MEMBER。只供组件派生自身角色，不授予 Kailo 侧任何权限。
type ComponentDirectoryRole string

const (
	Admin  ComponentDirectoryRole = "ADMIN"
	Member ComponentDirectoryRole = "MEMBER"
)

// DD-138(4)、07 §4.8.3：组件投递到 Kailo 收件箱的通知类别（封闭枚举）。SHARED 分享给你；MENTIONED 提及你；COMMENTED
// 评论了你的对象；ACCESS_REQUESTED 访问申请（进入「需要处理」）；TASK_COMPLETED 任务完成；CONTENT_UPDATED 你关注的内容有更新。
type ComponentNotificationCategory string

const (
	AccessRequested ComponentNotificationCategory = "ACCESS_REQUESTED"
	Commented       ComponentNotificationCategory = "COMMENTED"
	ContentUpdated  ComponentNotificationCategory = "CONTENT_UPDATED"
	Mentioned       ComponentNotificationCategory = "MENTIONED"
	Shared          ComponentNotificationCategory = "SHARED"
	TaskCompleted   ComponentNotificationCategory = "TASK_COMPLETED"
)

type PlatformBuildInfoPlatformPortKeysItem string

const (
	AIGateway          PlatformBuildInfoPlatformPortKeysItem = "AI_GATEWAY"
	ApprovalWorkflow   PlatformBuildInfoPlatformPortKeysItem = "APPROVAL_WORKFLOW"
	Authorization      PlatformBuildInfoPlatformPortKeysItem = "AUTHORIZATION"
	CollaborationRelay PlatformBuildInfoPlatformPortKeysItem = "COLLABORATION_RELAY"
	CoreInternal       PlatformBuildInfoPlatformPortKeysItem = "CORE_INTERNAL"
	IdentityEdge       PlatformBuildInfoPlatformPortKeysItem = "IDENTITY_EDGE"
	MeteringBilling    PlatformBuildInfoPlatformPortKeysItem = "METERING_BILLING"
	SecretStore        PlatformBuildInfoPlatformPortKeysItem = "SECRET_STORE"
)

type PlatformBuildInfoSubject string

const (
	BuzzWeb                      PlatformBuildInfoSubject = "BUZZ_WEB"
	PlatformBuildInfoSubjectCORE PlatformBuildInfoSubject = "CORE"
	Worker                       PlatformBuildInfoSubject = "WORKER"
)

type ComponentReleaseStatus string

const (
	ComponentReleaseStatusAPPROVED ComponentReleaseStatus = "APPROVED"
	ComponentReleaseStatusREVOKED  ComponentReleaseStatus = "REVOKED"
	Registered                     ComponentReleaseStatus = "REGISTERED"
	Rejected                       ComponentReleaseStatus = "REJECTED"
)

// DD-138(5)：一次「搜索全部」中某个组件来源的结果状态。ANSWERED 表示该来源已按合同回应（可为零条）；UNAVAILABLE
// 表示该来源超时、不可达或回应不合合同，其结果整体未采信。
type ComponentSearchSourceState string

const (
	Answered                              ComponentSearchSourceState = "ANSWERED"
	ComponentSearchSourceStateUNAVAILABLE ComponentSearchSourceState = "UNAVAILABLE"
)

// DD-163(3)：组件额度准入结论（CHECK，不预留）。TENANT_QUOTA_EXHAUSTED：该 Tenant
// 的额度项无访问；MEMBER_QUOTA_EXHAUSTED：设置了成员上限且本人本期已用不小于它。两者组件都拒绝该动作且不产生原生副作用。
type ComponentUsageDecision string

const (
	ComponentUsageDecisionALLOWED ComponentUsageDecision = "ALLOWED"
	MemberQuotaExhausted          ComponentUsageDecision = "MEMBER_QUOTA_EXHAUSTED"
	TenantQuotaExhausted          ComponentUsageDecision = "TENANT_QUOTA_EXHAUSTED"
)

// DD-163、07 §4.8.8：组件可上报或询问准入的平台 meter，随 Core 固定。knowledge_answer_count 只属 knowledge
// 呈现类别、data_query_count 只属 data_query、file_storage_bytes 只属
// file_storage；component_model_tokens 只来自 Gateway durable usage，不可上报。
type ComponentUsageMeter string

const (
	DataQueryCount       ComponentUsageMeter = "data_query_count"
	FileStorageBytes     ComponentUsageMeter = "file_storage_bytes"
	KnowledgeAnswerCount ComponentUsageMeter = "knowledge_answer_count"
)

// 一个已登记 meter 在所选区间内的 OpenMeter committed usage 查询结论（.design/11 §7）。COMMITTED：原生查询返回该
// Customer 的聚合值；NO_COMMITTED_USAGE：原生查询成功且区间内没有已存储事件；WORKSPACE_DIMENSION_UNAVAILABLE：原生
// meter 未声明 workspace_id 维度，不能按 Workspace 归因；METER_NOT_REGISTERED：动作登记的 meter 在 OpenMeter
// 中不存在或不唯一；UNAVAILABLE：查询失败或结果不可查证。后三者都不显示数值。
type MeterUsageState string

const (
	MeterNotRegistered            MeterUsageState = "METER_NOT_REGISTERED"
	MeterUsageStateCOMMITTED      MeterUsageState = "COMMITTED"
	MeterUsageStateUNAVAILABLE    MeterUsageState = "UNAVAILABLE"
	NoCommittedUsage              MeterUsageState = "NO_COMMITTED_USAGE"
	WorkspaceDimensionUnavailable MeterUsageState = "WORKSPACE_DIMENSION_UNAVAILABLE"
)

type ConversationViewState string

const (
	ConversationViewStateACTIVE       ConversationViewState = "ACTIVE"
	ConversationViewStateDISABLED     ConversationViewState = "DISABLED"
	ConversationViewStatePROVISIONING ConversationViewState = "PROVISIONING"
	ConversationViewStateRECONCILING  ConversationViewState = "RECONCILING"
)

type DiscoverableWorkspaceJoinActionKey string

const (
	WorkspaceJoin DiscoverableWorkspaceJoinActionKey = "workspace.join"
)

type DiscoverableWorkspaceLeaveActionKey string

const (
	WorkspaceLeave DiscoverableWorkspaceLeaveActionKey = "workspace.leave"
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

type DiscoverableWorkspaceUpdateActionKey string

const (
	DiscoverableWorkspaceUpdateActionKeyWorkspaceUpdate DiscoverableWorkspaceUpdateActionKey = "workspace.update"
)

// 解引用只显示不可用时的原因：原证据已不存在（HTTP 404）、敏感级别未获授权、存量种类不可识别、权威源无法按该 ID 查证其仍存在。
type EvidenceUnavailableReason string

const (
	EvidenceUnavailableReasonRESTRICTED EvidenceUnavailableReason = "RESTRICTED"
	NotFound                            EvidenceUnavailableReason = "NOT_FOUND"
	Unrecognized                        EvidenceUnavailableReason = "UNRECOGNIZED"
	Unverifiable                        EvidenceUnavailableReason = "UNVERIFIABLE"
)

// 03 §3 ExportPackage 的状态：只有 READY 可下载；ERROR 是确定失败，DELETED 是 Tenant 销毁后的墓碑。
type ExportPackageState string

const (
	Creating                  ExportPackageState = "CREATING"
	ExportPackageStateDELETED ExportPackageState = "DELETED"
	ExportPackageStateERROR   ExportPackageState = "ERROR"
	ExportPackageStateREVOKED ExportPackageState = "REVOKED"
	Ready                     ExportPackageState = "READY"
)

// DD-158(1)：原版“发送反馈”的类别（Bug、Praise、Needs work）。
type FeedbackCategory string

const (
	Bug       FeedbackCategory = "BUG"
	NeedsWork FeedbackCategory = "NEEDS_WORK"
	Praise    FeedbackCategory = "PRAISE"
)

// DD-158(1)：提交反馈的客户端，只用于运营方分拣。
type FeedbackClient string

const (
	Desktop FeedbackClient = "DESKTOP"
	Mobile  FeedbackClient = "MOBILE"
	Web     FeedbackClient = "WEB"
)

// DD-134(2)：网关管理区的范围取会话 Tenant。PLATFORM：Platform Catalog Tenant 会话，只见 Gateway 原生事实与 Tenant
// 归属 ID；TENANT：业务 Tenant 会话，按 Tenant/Workspace audit 下钻本 Tenant 的业务关联。
type GatewayAdminScope string

const (
	GatewayAdminScopeTENANT GatewayAdminScope = "TENANT"
	Platform                GatewayAdminScope = "PLATFORM"
)

// DD-134(3)：MODEL 取 Gateway request log（时延为 Gateway durationMs）；TOOL 取 Core 工具子
// ActionExecution 与审计（时延为 Core 观测的 INTENT 到 OUTCOME 间隔）。两者时延不混算。
type GatewayCallKind string

const (
	GatewayCallKindMODEL GatewayCallKind = "MODEL"
	GatewayCallKindTOOL  GatewayCallKind = "TOOL"
)

// DD-134(3)：一次调用的呈现状态。DENIED 是准入拒绝（含 PEP 拒绝）；UNKNOWN 是结果不明、待原 operation 对账；RUNNING 是已准入未终结。
type GatewayCallOutcome string

const (
	GatewayCallOutcomeDENIED    GatewayCallOutcome = "DENIED"
	GatewayCallOutcomeFAILED    GatewayCallOutcome = "FAILED"
	GatewayCallOutcomeRUNNING   GatewayCallOutcome = "RUNNING"
	GatewayCallOutcomeSUCCEEDED GatewayCallOutcome = "SUCCEEDED"
	GatewayCallOutcomeUNKNOWN   GatewayCallOutcome = "UNKNOWN"
)

// DD-134(3)⑥：CORE_RECORDED 表示 Core 写入并回读确认时保存了该 revision 的写入证据；UNRECORDED 表示外部写入或早于写入证据，按
// 17 §9 作为投影不一致信号，不反向导入。
type GatewayConfigRevisionSource string

const (
	CoreRecorded GatewayConfigRevisionSource = "CORE_RECORDED"
	Unrecorded   GatewayConfigRevisionSource = "UNRECORDED"
)

// DD-134(3)⑥：打码后的值在相邻两个已记录 revision 之间按 JSON 路径的差异。
type GatewayConfigChangeKind string

const (
	Added   GatewayConfigChangeKind = "ADDED"
	Changed GatewayConfigChangeKind = "CHANGED"
	Removed GatewayConfigChangeKind = "REMOVED"
)

type CapabilityPermission string

const (
	Approve                      CapabilityPermission = "approve"
	Audit                        CapabilityPermission = "audit"
	CapabilityPermissionConsume  CapabilityPermission = "consume"
	CapabilityPermissionDelete   CapabilityPermission = "delete"
	CapabilityPermissionDiscover CapabilityPermission = "discover"
	CapabilityPermissionExecute  CapabilityPermission = "execute"
	CapabilityPermissionManage   CapabilityPermission = "manage"
	CapabilityPermissionRead     CapabilityPermission = "read"
	Create                       CapabilityPermission = "create"
	Delegate                     CapabilityPermission = "delegate"
	Export                       CapabilityPermission = "export"
	Share                        CapabilityPermission = "share"
	TransferOwner                CapabilityPermission = "transfer_owner"
	Update                       CapabilityPermission = "update"
)

type ApplicationModelCallMode string

const (
	ApplicationModelCallModeNONE ApplicationModelCallMode = "NONE"
	PlatformLlmRoute             ApplicationModelCallMode = "PLATFORM_LLM_ROUTE"
	SelfManagedModel             ApplicationModelCallMode = "SELF_MANAGED_MODEL"
)

// DD-134(3)④：聚合维度。TOOL、AGENT、BINDING 只在 TENANT 范围可用；TENANT 只在 PLATFORM 范围可用。
type GatewayStatsDimension string

const (
	Agent                       GatewayStatsDimension = "AGENT"
	Binding                     GatewayStatsDimension = "BINDING"
	GatewayStatsDimensionTENANT GatewayStatsDimension = "TENANT"
	GatewayStatsDimensionTOOL   GatewayStatsDimension = "TOOL"
	ModelRoute                  GatewayStatsDimension = "MODEL_ROUTE"
)

// HuddleBuzzBinding 状态（03 §2、DD-125(3)）：PROVISIONING 为 CONTROL 9007/9000 投影尚未回读一致（结果不明保留并按
// Channel UUID 对账）；ACTIVE 为投影回读一致；ENDED 为观察到 48103 或临时频道已归档，终态、不复用；ERROR 为 Relay
// 确定拒绝投影，不再签发。
type HuddleState string

const (
	Ended                   HuddleState = "ENDED"
	HuddleStateACTIVE       HuddleState = "ACTIVE"
	HuddleStateERROR        HuddleState = "ERROR"
	HuddleStatePROVISIONING HuddleState = "PROVISIONING"
)

// Web Huddle 转写或朗读的可用性（DD-125(3)、V-SCN-160）：UNAVAILABLE 为 Huddle
// 语音推理服务未部署、超出部署登记的并发上界或不可用，此时按原版“仅语音模式”显示不可用而通话照常。
type HuddleVoiceAvailability string

const (
	HuddleVoiceAvailabilityAVAILABLE   HuddleVoiceAvailability = "AVAILABLE"
	HuddleVoiceAvailabilityUNAVAILABLE HuddleVoiceAvailability = "UNAVAILABLE"
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

type LegacySecretRefBindingKind string

const (
	Control LegacySecretRefBindingKind = "CONTROL"
	Human   LegacySecretRefBindingKind = "HUMAN"
)

// DD-149(5)(6)：连接器认证方式。
type MCPConnectionAuthMode string

const (
	APIKey                    MCPConnectionAuthMode = "API_KEY"
	Bearer                    MCPConnectionAuthMode = "BEARER"
	MCPConnectionAuthModeNONE MCPConnectionAuthMode = "NONE"
	Oauth                     MCPConnectionAuthMode = "OAUTH"
)

// DD-149(10)：最近一次探测观测；不是授权或状态权威。
type MCPConnectionHealth string

const (
	AuthFailed              MCPConnectionHealth = "AUTH_FAILED"
	EgressDenied            MCPConnectionHealth = "EGRESS_DENIED"
	Ok                      MCPConnectionHealth = "OK"
	ProtocolError           MCPConnectionHealth = "PROTOCOL_ERROR"
	ReauthorizationRequired MCPConnectionHealth = "REAUTHORIZATION_REQUIRED"
	Unchecked               MCPConnectionHealth = "UNCHECKED"
	Unreachable             MCPConnectionHealth = "UNREACHABLE"
)

// DD-149(3)：连接器状态；DELETED 是墓碑。
type MCPConnectionState string

const (
	MCPConnectionStateACTIVE   MCPConnectionState = "ACTIVE"
	MCPConnectionStateDELETED  MCPConnectionState = "DELETED"
	MCPConnectionStateDISABLED MCPConnectionState = "DISABLED"
)

// DD-149(7)：工具调用策略。AUTO 只允许 READ_ONLY；CONFIRM 由 Agent 负责人逐次确认；APPROVAL 由 Tenant 管理员逐次批准。
type MCPToolCallPolicy string

const (
	Auto                      MCPToolCallPolicy = "AUTO"
	Confirm                   MCPToolCallPolicy = "CONFIRM"
	MCPToolCallPolicyAPPROVAL MCPToolCallPolicy = "APPROVAL"
)

// DD-149(7)：工具风险等级（annotations 只是提示，最终为管理员确认值）。
type MCPToolRisk string

const (
	Destructive         MCPToolRisk = "DESTRUCTIVE"
	MCPToolRiskREADONLY MCPToolRisk = "READ_ONLY"
	MCPToolRiskWRITE    MCPToolRisk = "WRITE"
)

// DD-149(7)：连接器端点的 MCP 传输。STREAMABLE_HTTP 为现行 Streamable HTTP；SSE 为旧版 HTTP+SSE。
type MCPConnectionTransport string

const (
	SSE            MCPConnectionTransport = "SSE"
	StreamableHTTP MCPConnectionTransport = "STREAMABLE_HTTP"
)

// DD-149(4)：连接器与其工具的可见范围。
type MCPConnectionVisibility string

const (
	MCPConnectionVisibilityTENANT MCPConnectionVisibility = "TENANT"
	Personal                      MCPConnectionVisibility = "PERSONAL"
	Workspace                     MCPConnectionVisibility = "WORKSPACE"
)

// DD-149(4)：Tenant 连接器策略中普通成员的登记权限。
type MCPMemberRegistration string

const (
	MCPMemberRegistrationDISABLED MCPMemberRegistration = "DISABLED"
	PersonalOnly                  MCPMemberRegistration = "PERSONAL_ONLY"
)

// DD-149(6)：一次 OAuth 授权尝试的状态。
type MCPOauthAttemptState string

const (
	MCPOauthAttemptStateCOMPLETED MCPOauthAttemptState = "COMPLETED"
	MCPOauthAttemptStateCONSUMED  MCPOauthAttemptState = "CONSUMED"
	MCPOauthAttemptStateEXPIRED   MCPOauthAttemptState = "EXPIRED"
	MCPOauthAttemptStateFAILED    MCPOauthAttemptState = "FAILED"
	MCPOauthAttemptStatePENDING   MCPOauthAttemptState = "PENDING"
)

type TenantQuotaFeature string

const (
	AgentMemoryWrites             TenantQuotaFeature = "agent_memory_writes"
	AgentTokens                   TenantQuotaFeature = "agent_tokens"
	AutomationRuns                TenantQuotaFeature = "automation_runs"
	ComponentTokens               TenantQuotaFeature = "component_tokens"
	DataQueries                   TenantQuotaFeature = "data_queries"
	KnowledgeAnswers              TenantQuotaFeature = "knowledge_answers"
	TenantQuotaFeatureFileStorage TenantQuotaFeature = "file_storage"
)

// DD-163(4)：成员本人在一个额度项上的当前状态。AVAILABLE：可用；MEMBER_LIMIT_REACHED：本人已达成员上限；TENANT_EXHAUSTED：组织额度已用完（不显示组织数字）；UNAVAILABLE：OpenMeter
// 不可读或映射不唯一，不显示数值。
type MemberUsageState string

const (
	MemberLimitReached          MemberUsageState = "MEMBER_LIMIT_REACHED"
	MemberUsageStateAVAILABLE   MemberUsageState = "AVAILABLE"
	MemberUsageStateUNAVAILABLE MemberUsageState = "UNAVAILABLE"
	TenantExhausted             MemberUsageState = "TENANT_EXHAUSTED"
)

// 原 Buzz NIP-56 举报类型（buzz-relay handlers/report.rs::REPORT_TYPES，SF-BUZ-52）。线格式即 kind 1984
// 目标标签第三元素，Relay 只接受这七个值（DD-125(2)）。
type ModerationReportType string

const (
	Illegal       ModerationReportType = "illegal"
	Impersonation ModerationReportType = "impersonation"
	Malware       ModerationReportType = "malware"
	Nudity        ModerationReportType = "nudity"
	Other         ModerationReportType = "other"
	Profanity     ModerationReportType = "profanity"
	Spam          ModerationReportType = "spam"
)

// Relay moderation_reports.status（buzz migrations/0006_moderation.sql 的 CHECK
// 词表，SF-BUZ-52）。open 是唯一可处理状态；Relay 举报表是唯一权威，Core 不复制（DD-125(2)）。
type ModerationReportStatus string

const (
	Escalated                       ModerationReportStatus = "escalated"
	ModerationReportStatusDismissed ModerationReportStatus = "dismissed"
	ModerationReportStatusOpen      ModerationReportStatus = "open"
	ModerationReportStatusResolved  ModerationReportStatus = "resolved"
)

// 举报目标类别（Relay report_json.target_kind）：event 为消息事件、pubkey 为成员、blob 为附件（SF-BUZ-52）。
type ModerationReportTargetKind string

const (
	Blob   ModerationReportTargetKind = "blob"
	Event  ModerationReportTargetKind = "event"
	Pubkey ModerationReportTargetKind = "pubkey"
)

type NativeHumanScopeQueryPermission string

const (
	NativeHumanScopeQueryPermissionDiscover NativeHumanScopeQueryPermission = "discover"
	NativeHumanScopeQueryPermissionManage   NativeHumanScopeQueryPermission = "manage"
)

type ApplicationCallIdentityMode string

const (
	EndUserToken    ApplicationCallIdentityMode = "END_USER_TOKEN"
	InstanceService ApplicationCallIdentityMode = "INSTANCE_SERVICE"
	TenantService   ApplicationCallIdentityMode = "TENANT_SERVICE"
)

type CapabilitySurface string

const (
	Action                CapabilitySurface = "ACTION"
	CapabilitySurfaceTOOL CapabilitySurface = "TOOL"
)

type CapabilityRequiredDeclaration string

const (
	CapabilityRequiredDeclarationCANCEL  CapabilityRequiredDeclaration = "CANCEL"
	CapabilityRequiredDeclarationOBSERVE CapabilityRequiredDeclaration = "OBSERVE"
	Meter                                CapabilityRequiredDeclaration = "METER"
	OnlineEditing                        CapabilityRequiredDeclaration = "ONLINE_EDITING"
	ReadEdge                             CapabilityRequiredDeclaration = "READ_EDGE"
	RevisionQuery                        CapabilityRequiredDeclaration = "REVISION_QUERY"
	TenantDelete                         CapabilityRequiredDeclaration = "TENANT_DELETE"
	VersionedModel                       CapabilityRequiredDeclaration = "VERSIONED_MODEL"
)

// 仅 resource.grant_read/revoke_read：授予或收回的 permission，省略即 read。AGENT 接收者按其工具契约所需 permission
// 授予（DD-122）；HUMAN 与 SERVICE 接收者只接受 read
type ResourceGrantPermission string

const (
	ResourceGrantPermissionConsume  ResourceGrantPermission = "consume"
	ResourceGrantPermissionDiscover ResourceGrantPermission = "discover"
	ResourceGrantPermissionExecute  ResourceGrantPermission = "execute"
	ResourceGrantPermissionRead     ResourceGrantPermission = "read"
)

// 提供方认证的显式封闭选择；NONE 不豁免 Gateway 调用者认证或业务授权。
type LlmProviderCredentialMode string

const (
	LlmProviderCredentialModeNONE LlmProviderCredentialMode = "NONE"
	SecretRef                     LlmProviderCredentialMode = "SECRET_REF"
)

// 原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
type AgentMemoryWriteInputExpectedHeadState string

const (
	AgentMemoryWriteInputExpectedHeadStateABSENT AgentMemoryWriteInputExpectedHeadState = "ABSENT"
	AgentMemoryWriteInputExpectedHeadStateFOUND  AgentMemoryWriteInputExpectedHeadState = "FOUND"
)

// 原禁言时长预设（moderation/lib/timeout.ts::TIMEOUT_PRESETS：1 小时、24 小时、7 天）。到期时刻由 Core
// 在准入时以数据库时钟冻结，不接受调用方给出的绝对时刻（DD-125(2)）。
type ModerationTimeoutDuration string

const (
	OneDay    ModerationTimeoutDuration = "ONE_DAY"
	OneHour   ModerationTimeoutDuration = "ONE_HOUR"
	SevenDays ModerationTimeoutDuration = "SEVEN_DAYS"
)

// 审核队列可提交的 kind 9044 action 标签（原 settings/lib/moderationQueue.ts::resolvableActions）。9044
// 只记决定、不执法；delete/kick/ban 须先经各自受治理动作执法（DD-125(2)）。原队列不提供禁言，因此不含 timeout。
type ModerationResolutionAction string

const (
	Ban                              ModerationResolutionAction = "ban"
	Dismiss                          ModerationResolutionAction = "dismiss"
	Escalate                         ModerationResolutionAction = "escalate"
	Kick                             ModerationResolutionAction = "kick"
	ModerationResolutionActionDelete ModerationResolutionAction = "delete"
)

// kind 9044 的 status 标签（moderation_commands.rs，SF-BUZ-52）：dismiss 只与 dismissed 配对，其余处理一律
// resolved。
type ModerationResolutionStatus string

const (
	ModerationResolutionStatusDismissed ModerationResolutionStatus = "dismissed"
	ModerationResolutionStatusResolved  ModerationResolutionStatus = "resolved"
)

// DD-158(2)：运营方分拣状态 NEW→TRIAGED→CLOSED；超过 180 天的 CLOSED 记录由 Core 清除。
type FeedbackState string

const (
	FeedbackStateCLOSED FeedbackState = "CLOSED"
	New                 FeedbackState = "NEW"
	Triaged             FeedbackState = "TRIAGED"
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

// DD-140 (1)：平台原生工具名到动作键的封闭映射；记忆工具即其自身，project_channel_request 为
// workspace.create。DD-149：连接器工具为其调用策略对应的子动作键。
type PlatformToolViewActionKey string

const (
	AgentMemoryEntryList                     PlatformToolViewActionKey = "agent.memory.entry.list"
	AgentMemoryEntryRead                     PlatformToolViewActionKey = "agent.memory.entry.read"
	MCPConnectionToolInvoke                  PlatformToolViewActionKey = "mcp_connection.tool.invoke"
	MCPConnectionToolInvokeApproved          PlatformToolViewActionKey = "mcp_connection.tool.invoke_approved"
	MCPConnectionToolInvokeConfirmed         PlatformToolViewActionKey = "mcp_connection.tool.invoke_confirmed"
	PlatformToolViewActionKeyWorkspaceCreate PlatformToolViewActionKey = "workspace.create"
)

type PlatformToolViewSource string

const (
	PlatformToolViewSourcePLATFORMNATIVE         PlatformToolViewSource = "PLATFORM_NATIVE"
	PlatformToolViewSourceUSERREGISTEREDEXTERNAL PlatformToolViewSource = "USER_REGISTERED_EXTERNAL"
)

type PlatformToolViewStatus string

const (
	PlatformToolViewStatusACTIVE       PlatformToolViewStatus = "ACTIVE"
	PlatformToolViewStatusPROVISIONING PlatformToolViewStatus = "PROVISIONING"
)

type ProjectsGitQueryRequestView string

const (
	Diff        ProjectsGitQueryRequestView = "DIFF"
	FileContent ProjectsGitQueryRequestView = "FILE_CONTENT"
	Snapshot    ProjectsGitQueryRequestView = "SNAPSHOT"
)

type ProjectGitRefOperation string

const (
	CreateBranch ProjectGitRefOperation = "CREATE_BRANCH"
	DeleteBranch ProjectGitRefOperation = "DELETE_BRANCH"
)

// Original inline diff anchor `side`.
type ProjectPullRequestCommentSide string

const (
	Old                              ProjectPullRequestCommentSide = "old"
	ProjectPullRequestCommentSideNew ProjectPullRequestCommentSide = "new"
)

type ProjectIssueCategory string

const (
	ChangeRequest ProjectIssueCategory = "change-request"
	Improvement   ProjectIssueCategory = "improvement"
	Issue         ProjectIssueCategory = "issue"
)

type ProjectPublicationOperation string

const (
	AddProjectChannel                 ProjectPublicationOperation = "ADD_PROJECT_CHANNEL"
	ApprovePullRequest                ProjectPublicationOperation = "APPROVE_PULL_REQUEST"
	AssignIssue                       ProjectPublicationOperation = "ASSIGN_ISSUE"
	AttachRepository                  ProjectPublicationOperation = "ATTACH_REPOSITORY"
	BindRepositoryChannel             ProjectPublicationOperation = "BIND_REPOSITORY_CHANNEL"
	CreateIssue                       ProjectPublicationOperation = "CREATE_ISSUE"
	CreateIssueComment                ProjectPublicationOperation = "CREATE_ISSUE_COMMENT"
	CreateProject                     ProjectPublicationOperation = "CREATE_PROJECT"
	CreatePullRequest                 ProjectPublicationOperation = "CREATE_PULL_REQUEST"
	CreatePullRequestComment          ProjectPublicationOperation = "CREATE_PULL_REQUEST_COMMENT"
	CreateRepository                  ProjectPublicationOperation = "CREATE_REPOSITORY"
	ProjectPublicationOperationDELETE ProjectPublicationOperation = "DELETE"
	SelfAssignIssue                   ProjectPublicationOperation = "SELF_ASSIGN_ISSUE"
	SelfUnassignIssue                 ProjectPublicationOperation = "SELF_UNASSIGN_ISSUE"
	SetPullRequestStatus              ProjectPublicationOperation = "SET_PULL_REQUEST_STATUS"
	UnassignIssue                     ProjectPublicationOperation = "UNASSIGN_ISSUE"
	UpdatePullRequest                 ProjectPublicationOperation = "UPDATE_PULL_REQUEST"
)

// Original pullRequestReviews.ts lifecycle states the UI may publish (NIP-34
// 1630/1633/1632). Merged (1631) happens through git and is never accepted here. Only the
// review author or repository owner signs it.
type ProjectPullRequestLifecycleStatus string

const (
	Closed                                ProjectPullRequestLifecycleStatus = "closed"
	Draft                                 ProjectPullRequestLifecycleStatus = "draft"
	ProjectPullRequestLifecycleStatusOpen ProjectPullRequestLifecycleStatus = "open"
)

// Original hooks.ts ProjectPullRequestCommentDecision on CREATE_PULL_REQUEST_COMMENT only:
// adds the `changes-requested` label. Only a requested reviewer or the repository owner,
// never the review author, may request changes on an open or draft review; readers trust
// nothing else (projectPullRequests.mjs).
type ProjectPullRequestCommentDecision string

const (
	RequestChanges ProjectPullRequestCommentDecision = "request-changes"
)

type ProjectListingVisibility string

const (
	Listed   ProjectListingVisibility = "listed"
	Unlisted ProjectListingVisibility = "unlisted"
)

type ProjectsQueryRequestView string

const (
	Deletions        ProjectsQueryRequestView = "DELETIONS"
	Projects         ProjectsQueryRequestView = "PROJECTS"
	Repositories     ProjectsQueryRequestView = "REPOSITORIES"
	RepositoryStates ProjectsQueryRequestView = "REPOSITORY_STATES"
	WorkItemActivity ProjectsQueryRequestView = "WORK_ITEM_ACTIVITY"
	WorkItems        ProjectsQueryRequestView = "WORK_ITEMS"
)

type ProtocolSessionReconcileRoundState string

const (
	Opening                                    ProtocolSessionReconcileRoundState = "OPENING"
	ProtocolSessionReconcileRoundStateADMITTED ProtocolSessionReconcileRoundState = "ADMITTED"
	ProtocolSessionReconcileRoundStateCLOSED   ProtocolSessionReconcileRoundState = "CLOSED"
	ProtocolSessionReconcileRoundStateCONFLICT ProtocolSessionReconcileRoundState = "CONFLICT"
	ProtocolSessionReconcileRoundStateDIRTY    ProtocolSessionReconcileRoundState = "DIRTY"
	ProtocolSessionReconcileRoundStateEXPIRED  ProtocolSessionReconcileRoundState = "EXPIRED"
	ProtocolSessionReconcileRoundStateFAILED   ProtocolSessionReconcileRoundState = "FAILED"
	ProtocolSessionReconcileRoundStateOPEN     ProtocolSessionReconcileRoundState = "OPEN"
	ProtocolSessionReconcileRoundStateREADONLY ProtocolSessionReconcileRoundState = "READ_ONLY"
	ProtocolSessionReconcileRoundStateREVOKED  ProtocolSessionReconcileRoundState = "REVOKED"
	ProtocolSessionReconcileRoundStateSAVED    ProtocolSessionReconcileRoundState = "SAVED"
	ProtocolSessionReconcileRoundStateUNKNOWN  ProtocolSessionReconcileRoundState = "UNKNOWN"
)

type PulsePublishRequestOperation string

const (
	Like   PulsePublishRequestOperation = "LIKE"
	Note   PulsePublishRequestOperation = "NOTE"
	Unlike PulsePublishRequestOperation = "UNLIKE"
)

type PulseQueryRequestView string

const (
	Agents    PulseQueryRequestView = "AGENTS"
	Contacts  PulseQueryRequestView = "CONTACTS"
	Liked     PulseQueryRequestView = "LIKED"
	Notes     PulseQueryRequestView = "NOTES"
	Profiles  PulseQueryRequestView = "PROFILES"
	Reactions PulseQueryRequestView = "REACTIONS"
)

// DD-151(2)：本部署是否配置了该提供方的推送凭据。NOT_CONFIGURED 时客户端保留原版“此版本不可用”。
type PushAvailability string

const (
	Configured    PushAvailability = "CONFIGURED"
	NotConfigured PushAvailability = "NOT_CONFIGURED"
)

// DD-151(1)：设备推送登记的提供方。APNS 为 iOS，FCM 为 Android。
type PushPlatform string

const (
	Apns PushPlatform = "APNS"
	Fcm  PushPlatform = "FCM"
)

// DD-151(1)(5)：ACTIVE 可投递；INVALID 是提供方报告令牌失效，重新登记新令牌后恢复；REVOKED 是设备公钥或成员资格撤销、Tenant
// 删除后的终态，令牌已删除。
type PushRegistrationState string

const (
	Invalid                      PushRegistrationState = "INVALID"
	PushRegistrationStateACTIVE  PushRegistrationState = "ACTIVE"
	PushRegistrationStateREVOKED PushRegistrationState = "REVOKED"
)

type ReminderOperation string

const (
	ReminderOperationCANCEL   ReminderOperation = "CANCEL"
	ReminderOperationCOMPLETE ReminderOperation = "COMPLETE"
	ReminderOperationCREATE   ReminderOperation = "CREATE"
	Snooze                    ReminderOperation = "SNOOZE"
)

type ReminderStatus string

const (
	Done                    ReminderStatus = "done"
	ReminderStatusCancelled ReminderStatus = "cancelled"
	ReminderStatusPending   ReminderStatus = "pending"
)

type RoleWorkspacePageCreateActionKey string

const (
	RoleWorkspacePageCreateActionKeyWorkspaceCreate RoleWorkspacePageCreateActionKey = "workspace.create"
)

type RoleWorkspaceViewDeleteActionKey string

const (
	WorkspaceDelete RoleWorkspaceViewDeleteActionKey = "workspace.delete"
)

// 当前 Principal 经 fresh Tenant manage 检查、按该 Workspace 当前状态可发起的暂停（ACTIVE 或
// ERROR）或恢复（SUSPENDED）动作 key；目录未开放、无权、处于收敛中或本页提示判定失败时省略
//
// Workspace 暂停与恢复的 ActionDefinition key（.design/06 §7.3）。两者都从 Tenant scope
// 发起。删除（DD-150）不在本枚举：它不是可逆生命周期，经 RoleWorkspaceView.deleteActionKey 单独提示。
type WorkspaceLifecycleActionKey string

const (
	WorkspaceRestore WorkspaceLifecycleActionKey = "workspace.restore"
	WorkspaceSuspend WorkspaceLifecycleActionKey = "workspace.suspend"
)

// Workspace 状态机中对外可见的状态。权威定义见 .design/03-领域模型与权限模型.md。DD-150 的 DELETED 是 Core
// 内的墓碑，不出现在任何对外视图中（列表与提示都不返回已删除的 Workspace），因此不在本枚举。
type WorkspaceState string

const (
	WorkspaceStateACTIVE       WorkspaceState = "ACTIVE"
	WorkspaceStateDELETING     WorkspaceState = "DELETING"
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

// 原 Buzz 侧栏分组排序（channelSortPreference.ts::ChannelSortMode）：alpha 按名称，recent
// 按最近消息（DD-125(5)）。
type SidebarSortMode string

const (
	Alpha  SidebarSortMode = "alpha"
	Recent SidebarSortMode = "recent"
)

// DD-135(2)：上传字节的编码。规范 artifact 恒为一个 SKILL.md，与上传编码无关。
type SkillArtifactEncoding string

const (
	SkillMd SkillArtifactEncoding = "SKILL_MD"
	Tar     SkillArtifactEncoding = "TAR"
	TarGzip SkillArtifactEncoding = "TAR_GZIP"
)

// DD-135(2)(9)：上传校验的封闭违规码；与路径一起逐项返回，不含文件正文。
type SkillArtifactViolationCode string

const (
	ArchiveInvalid            SkillArtifactViolationCode = "ARCHIVE_INVALID"
	ControlCharacter          SkillArtifactViolationCode = "CONTROL_CHARACTER"
	DescriptionTooLong        SkillArtifactViolationCode = "DESCRIPTION_TOO_LONG"
	DuplicateSkillMd          SkillArtifactViolationCode = "DUPLICATE_SKILL_MD"
	EntryLimitExceeded        SkillArtifactViolationCode = "ENTRY_LIMIT_EXCEEDED"
	ExecutableEntry           SkillArtifactViolationCode = "EXECUTABLE_ENTRY"
	ExpandedTooLarge          SkillArtifactViolationCode = "EXPANDED_TOO_LARGE"
	ExtraEntry                SkillArtifactViolationCode = "EXTRA_ENTRY"
	InvalidFrontmatter        SkillArtifactViolationCode = "INVALID_FRONTMATTER"
	LinkEntry                 SkillArtifactViolationCode = "LINK_ENTRY"
	MissingDescription        SkillArtifactViolationCode = "MISSING_DESCRIPTION"
	MissingFrontmatter        SkillArtifactViolationCode = "MISSING_FRONTMATTER"
	MissingSkillMd            SkillArtifactViolationCode = "MISSING_SKILL_MD"
	NameMismatch              SkillArtifactViolationCode = "NAME_MISMATCH"
	NotUtf8                   SkillArtifactViolationCode = "NOT_UTF8"
	SkillMdTooLarge           SkillArtifactViolationCode = "SKILL_MD_TOO_LARGE"
	SpecialEntry              SkillArtifactViolationCode = "SPECIAL_ENTRY"
	UnsafePath                SkillArtifactViolationCode = "UNSAFE_PATH"
	UnsupportedEncoding       SkillArtifactViolationCode = "UNSUPPORTED_ENCODING"
	UnsupportedFrontmatterKey SkillArtifactViolationCode = "UNSUPPORTED_FRONTMATTER_KEY"
	UploadTooLarge            SkillArtifactViolationCode = "UPLOAD_TOO_LARGE"
)

// DD-135(1)、03 §7：SkillDefinition 状态。DISABLED 不可逆，DELETED 是 Tenant 销毁墓碑。
type SkillDefinitionStatus string

const (
	SkillDefinitionStatusACTIVE       SkillDefinitionStatus = "ACTIVE"
	SkillDefinitionStatusDELETED      SkillDefinitionStatus = "DELETED"
	SkillDefinitionStatusDISABLED     SkillDefinitionStatus = "DISABLED"
	SkillDefinitionStatusPROVISIONING SkillDefinitionStatus = "PROVISIONING"
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

type TenantQuotaPageSetActionKey string

const (
	TenantQuotaSet TenantQuotaPageSetActionKey = "tenant.quota.set"
)

// 用量与账单页中额度、账单两类 Customer
// 级事实的读取结论。AVAILABLE：原生查询成功（列表可以为空）；UNAVAILABLE：原生查询失败或结果不可查证；TENANT_SCOPE_ONLY：所选
// Workspace 视图不展示 Customer 级事实；NOT_PROVISIONED：Tenant 没有有效 Customer 映射。
type UsageSectionState string

const (
	TenantScopeOnly                 UsageSectionState = "TENANT_SCOPE_ONLY"
	UsageSectionStateAVAILABLE      UsageSectionState = "AVAILABLE"
	UsageSectionStateNOTPROVISIONED UsageSectionState = "NOT_PROVISIONED"
	UsageSectionStateUNAVAILABLE    UsageSectionState = "UNAVAILABLE"
)

// 当前 Tenant 的 OpenMeter Customer 映射（DD-38、.design/11 §3）。ACTIVE：Core binding 有效且原生 Customer
// 读回同 Tenant 且未删除；NOT_PROVISIONED：没有 binding；REVOKED：binding 已撤销；UNAVAILABLE：原生事实不可读或与
// binding 不一致，结果不明。
type UsageCustomerState string

const (
	UsageCustomerStateACTIVE         UsageCustomerState = "ACTIVE"
	UsageCustomerStateNOTPROVISIONED UsageCustomerState = "NOT_PROVISIONED"
	UsageCustomerStateREVOKED        UsageCustomerState = "REVOKED"
	UsageCustomerStateUNAVAILABLE    UsageCustomerState = "UNAVAILABLE"
)

// 原 Buzz 频道消息语义。缺省 STREAM 保持旧请求；不允许调用者提交任意事件 kind。
type WebMessageType string

const (
	ForumComment         WebMessageType = "FORUM_COMMENT"
	ForumPost            WebMessageType = "FORUM_POST"
	WebMessageTypeSTREAM WebMessageType = "STREAM"
)

type WebPresenceStatus string

const (
	Away    WebPresenceStatus = "away"
	Offline WebPresenceStatus = "offline"
	Online  WebPresenceStatus = "online"
)

// V2 only; absent means FORWARD. A RECEIVER case (DD-124(3)(4)) runs entirely in the
// isolated deployment; the production plan observes each of its steps only through
// receiver_start/receiver_observe and accepts the isolated Core's execution and operation
// ids, both read_receipts, native batch or execution and native terminal evidence, never
// business results: every step names the receiver Resource by referenceResourceKey and
// expects {}. Every platform Resource id of the case, typed or a
// resourceId/sourceResourceId/assetId member of a step document, is a PRECONDITION. A step
// input is the admission the isolated Core performs: it may bind the step's own
// ACTION_EXECUTION_ID, OPERATION_ID or GENERATED_REF captures and earlier steps' captures,
// which the isolated deployment supplies from its own run. The case as a whole carries the
// source reads; Core compares a step's input with the admission whenever its evidence has
// reads.
//
// DD-124(3)(4): the direction of a whole V2 case. FORWARD cases are driven by the
// production Core probe execute. RECEIVER marks a case that depends on the service read
// edge (an ingest consuming a source through READ_EDGE, a NATIVE_MANAGED receiver key):
// every step of it runs in the isolated deployment of 07 §8A and the production plan only
// observes each step through receiver_start/receiver_observe; steps are never split between
// the directions.
type CapabilityVectorCaseDirection string

const (
	CapabilityVectorCaseDirectionRECEIVER CapabilityVectorCaseDirection = "RECEIVER"
	Forward                               CapabilityVectorCaseDirection = "FORWARD"
)

type CapabilityVectorFormat string

const (
	V1 CapabilityVectorFormat = "V1"
	V2 CapabilityVectorFormat = "V2"
)

// Relay 以社区限制拒绝本人内容写入的类别（DD-125(2)）：TIMED_OUT 对应 `restricted: you are timed out until
// <ts>`，BANNED 对应 `blocked: you are banned from this community`。
type PublishRestrictionKind string

const (
	Banned                         PublishRestrictionKind = "BANNED"
	PublishRestrictionKindTIMEDOUT PublishRestrictionKind = "TIMED_OUT"
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

type NativeScopeResult string

const (
	AbsentFenced           NativeScopeResult = "ABSENT_FENCED"
	NativeScopeResultFOUND NativeScopeResult = "FOUND"
	Refused                NativeScopeResult = "REFUSED"
)
