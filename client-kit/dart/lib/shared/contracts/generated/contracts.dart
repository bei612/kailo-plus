// To parse this JSON data, do
//
//     final canary = canaryFromJson(jsonString);
//     final applicationModelAdmission = applicationModelAdmissionFromJson(jsonString);
//     final fileStorageDeleteInput = fileStorageDeleteInputFromJson(jsonString);
//     final fileStorageDeleteOutput = fileStorageDeleteOutputFromJson(jsonString);
//     final fileStorageExportInput = fileStorageExportInputFromJson(jsonString);
//     final fileStorageExportOutput = fileStorageExportOutputFromJson(jsonString);
//     final fileStorageListInput = fileStorageListInputFromJson(jsonString);
//     final fileStorageListOutput = fileStorageListOutputFromJson(jsonString);
//     final fileStorageListRevisionsInput = fileStorageListRevisionsInputFromJson(jsonString);
//     final fileStorageListRevisionsOutput = fileStorageListRevisionsOutputFromJson(jsonString);
//     final fileStorageReadInput = fileStorageReadInputFromJson(jsonString);
//     final fileStorageReadOutput = fileStorageReadOutputFromJson(jsonString);
//     final fileStorageShareInput = fileStorageShareInputFromJson(jsonString);
//     final fileStorageShareOutput = fileStorageShareOutputFromJson(jsonString);
//     final fileStorageWriteInput = fileStorageWriteInputFromJson(jsonString);
//     final fileStorageWriteOutput = fileStorageWriteOutputFromJson(jsonString);
//     final knowledgeSyncInput = knowledgeSyncInputFromJson(jsonString);
//     final adapterBindingObservation = adapterBindingObservationFromJson(jsonString);
//     final adapterBindingReconcileRequest = adapterBindingReconcileRequestFromJson(jsonString);
//     final adapterBindingReconcileResponse = adapterBindingReconcileResponseFromJson(jsonString);
//     final adapterExecutionObservation = adapterExecutionObservationFromJson(jsonString);
//     final adapterExecutionReference = adapterExecutionReferenceFromJson(jsonString);
//     final adapterExecutionResponse = adapterExecutionResponseFromJson(jsonString);
//     final adapterExecutionUsage = adapterExecutionUsageFromJson(jsonString);
//     final nativeTaskExecutionAdmissionRequest = nativeTaskExecutionAdmissionRequestFromJson(jsonString);
//     final nativeTaskExecutionAdmissionResponse = nativeTaskExecutionAdmissionResponseFromJson(jsonString);
//     final adapterPepCheckRequest = adapterPepCheckRequestFromJson(jsonString);
//     final adapterPepCheckResponse = adapterPepCheckResponseFromJson(jsonString);
//     final protocolRevisionQuery = protocolRevisionQueryFromJson(jsonString);
//     final adapterProtocolSessionLaunchRequest = adapterProtocolSessionLaunchRequestFromJson(jsonString);
//     final adapterProtocolSessionLaunchResponse = adapterProtocolSessionLaunchResponseFromJson(jsonString);
//     final protocolSessionLifecyclePepResponse = protocolSessionLifecyclePepResponseFromJson(jsonString);
//     final adapterProtocolSessionLifecycleRequest = adapterProtocolSessionLifecycleRequestFromJson(jsonString);
//     final adapterProtocolSessionLifecycleResponse = adapterProtocolSessionLifecycleResponseFromJson(jsonString);
//     final protocolSessionPepRequest = protocolSessionPepRequestFromJson(jsonString);
//     final protocolSessionPepResponse = protocolSessionPepResponseFromJson(jsonString);
//     final protocolWriteObservation = protocolWriteObservationFromJson(jsonString);
//     final protocolWriteReceipt = protocolWriteReceiptFromJson(jsonString);
//     final adapterQueryRevisionRequest = adapterQueryRevisionRequestFromJson(jsonString);
//     final adapterQueryRevisionResponse = adapterQueryRevisionResponseFromJson(jsonString);
//     final adapterReadGrantRequest = adapterReadGrantRequestFromJson(jsonString);
//     final adapterReadGrantResponse = adapterReadGrantResponseFromJson(jsonString);
//     final adapterReadReceipt = adapterReadReceiptFromJson(jsonString);
//     final adapterScopeObservation = adapterScopeObservationFromJson(jsonString);
//     final adapterSearchRequest = adapterSearchRequestFromJson(jsonString);
//     final adapterSearchResponse = adapterSearchResponseFromJson(jsonString);
//     final adapterSourceResource = adapterSourceResourceFromJson(jsonString);
//     final actionCommand = actionCommandFromJson(jsonString);
//     final actionSubmission = actionSubmissionFromJson(jsonString);
//     final agentActiveTurnPage = agentActiveTurnPageFromJson(jsonString);
//     final agentActiveTurnView = agentActiveTurnViewFromJson(jsonString);
//     final agentAuthorDirectory = agentAuthorDirectoryFromJson(jsonString);
//     final agentCatalogOwners = agentCatalogOwnersFromJson(jsonString);
//     final agentDefinitionPage = agentDefinitionPageFromJson(jsonString);
//     final agentDefinitionView = agentDefinitionViewFromJson(jsonString);
//     final agentDelegationPage = agentDelegationPageFromJson(jsonString);
//     final agentDelegationTargetPage = agentDelegationTargetPageFromJson(jsonString);
//     final agentDelegationView = agentDelegationViewFromJson(jsonString);
//     final agentImportConfigurationPage = agentImportConfigurationPageFromJson(jsonString);
//     final agentInstallationCandidate = agentInstallationCandidateFromJson(jsonString);
//     final agentInstallationCandidatePage = agentInstallationCandidatePageFromJson(jsonString);
//     final agentInstallationPage = agentInstallationPageFromJson(jsonString);
//     final agentInstallationProjectionView = agentInstallationProjectionViewFromJson(jsonString);
//     final agentInstallationSkillPage = agentInstallationSkillPageFromJson(jsonString);
//     final agentInstallationSkillView = agentInstallationSkillViewFromJson(jsonString);
//     final agentInstallationToolPage = agentInstallationToolPageFromJson(jsonString);
//     final agentInstallationUsePage = agentInstallationUsePageFromJson(jsonString);
//     final agentInstallationView = agentInstallationViewFromJson(jsonString);
//     final agentInvocationPage = agentInvocationPageFromJson(jsonString);
//     final agentInvocationView = agentInvocationViewFromJson(jsonString);
//     final agentMemoryDanglingRefView = agentMemoryDanglingRefViewFromJson(jsonString);
//     final agentMemoryEntryPage = agentMemoryEntryPageFromJson(jsonString);
//     final agentMemoryEntryView = agentMemoryEntryViewFromJson(jsonString);
//     final agentMemoryReadView = agentMemoryReadViewFromJson(jsonString);
//     final agentMemoryReferenceView = agentMemoryReferenceViewFromJson(jsonString);
//     final agentMentionOutcomePage = agentMentionOutcomePageFromJson(jsonString);
//     final agentMentionOutcomeQueryRequest = agentMentionOutcomeQueryRequestFromJson(jsonString);
//     final agentSessionPage = agentSessionPageFromJson(jsonString);
//     final agentSessionView = agentSessionViewFromJson(jsonString);
//     final agentSnapshotImportPreview = agentSnapshotImportPreviewFromJson(jsonString);
//     final agentSnapshotUploadRequest = agentSnapshotUploadRequestFromJson(jsonString);
//     final agentTeamPage = agentTeamPageFromJson(jsonString);
//     final agentTeamSnapshotImportPreview = agentTeamSnapshotImportPreviewFromJson(jsonString);
//     final agentTeamSnapshotUploadRequest = agentTeamSnapshotUploadRequestFromJson(jsonString);
//     final agentTeamView = agentTeamViewFromJson(jsonString);
//     final agentTranscriptEvent = agentTranscriptEventFromJson(jsonString);
//     final agentTranscriptItem = agentTranscriptItemFromJson(jsonString);
//     final agentTranscriptPage = agentTranscriptPageFromJson(jsonString);
//     final agentVersionConfigurationPage = agentVersionConfigurationPageFromJson(jsonString);
//     final agentVersionPage = agentVersionPageFromJson(jsonString);
//     final agentVersionRouteOption = agentVersionRouteOptionFromJson(jsonString);
//     final agentVersionView = agentVersionViewFromJson(jsonString);
//     final applicationBindingPage = applicationBindingPageFromJson(jsonString);
//     final applicationNativePage = applicationNativePageFromJson(jsonString);
//     final applicationReadResourcePage = applicationReadResourcePageFromJson(jsonString);
//     final approvalDecisionRequest = approvalDecisionRequestFromJson(jsonString);
//     final approvalView = approvalViewFromJson(jsonString);
//     final auditEventPage = auditEventPageFromJson(jsonString);
//     final automationApprovalStepView = automationApprovalStepViewFromJson(jsonString);
//     final automationDelegationView = automationDelegationViewFromJson(jsonString);
//     final automationDetailView = automationDetailViewFromJson(jsonString);
//     final automationPage = automationPageFromJson(jsonString);
//     final automationRunPage = automationRunPageFromJson(jsonString);
//     final automationRunView = automationRunViewFromJson(jsonString);
//     final automationVersionView = automationVersionViewFromJson(jsonString);
//     final automationView = automationViewFromJson(jsonString);
//     final automationWebhookSecret = automationWebhookSecretFromJson(jsonString);
//     final businessOperationPage = businessOperationPageFromJson(jsonString);
//     final businessOperationPhaseCount = businessOperationPhaseCountFromJson(jsonString);
//     final businessOperationSummary = businessOperationSummaryFromJson(jsonString);
//     final businessOperationView = businessOperationViewFromJson(jsonString);
//     final capabilityContractPage = capabilityContractPageFromJson(jsonString);
//     final capabilityContractView = capabilityContractViewFromJson(jsonString);
//     final channelTemplateRequest = channelTemplateRequestFromJson(jsonString);
//     final clientKeyView = clientKeyViewFromJson(jsonString);
//     final clientKeyStatus = clientKeyStatusFromJson(jsonString);
//     final componentConformanceAuthorization = componentConformanceAuthorizationFromJson(jsonString);
//     final componentConformanceWireDigests = componentConformanceWireDigestsFromJson(jsonString);
//     final componentConformanceWireObservation = componentConformanceWireObservationFromJson(jsonString);
//     final componentMemberDirectory = componentMemberDirectoryFromJson(jsonString);
//     final componentNotificationDelivery = componentNotificationDeliveryFromJson(jsonString);
//     final componentNotificationPage = componentNotificationPageFromJson(jsonString);
//     final componentNotificationReadRequest = componentNotificationReadRequestFromJson(jsonString);
//     final componentNotificationReceipt = componentNotificationReceiptFromJson(jsonString);
//     final componentNotificationView = componentNotificationViewFromJson(jsonString);
//     final componentReleaseApprovalReport = componentReleaseApprovalReportFromJson(jsonString);
//     final componentReleasePage = componentReleasePageFromJson(jsonString);
//     final componentReleaseReceipt = componentReleaseReceiptFromJson(jsonString);
//     final componentSearchPage = componentSearchPageFromJson(jsonString);
//     final componentSearchQuery = componentSearchQueryFromJson(jsonString);
//     final conversationOpenRequest = conversationOpenRequestFromJson(jsonString);
//     final conversationPage = conversationPageFromJson(jsonString);
//     final conversationParticipant = conversationParticipantFromJson(jsonString);
//     final conversationParticipantPage = conversationParticipantPageFromJson(jsonString);
//     final conversationPreferenceRequest = conversationPreferenceRequestFromJson(jsonString);
//     final conversationView = conversationViewFromJson(jsonString);
//     final delegatedActionMetadataV1 = delegatedActionMetadataV1FromJson(jsonString);
//     final discoverableWorkspace = discoverableWorkspaceFromJson(jsonString);
//     final discoverableWorkspacePage = discoverableWorkspacePageFromJson(jsonString);
//     final evidenceView = evidenceViewFromJson(jsonString);
//     final exportPackageView = exportPackageViewFromJson(jsonString);
//     final followedPrincipalRequest = followedPrincipalRequestFromJson(jsonString);
//     final gatewayAccess = gatewayAccessFromJson(jsonString);
//     final gatewayCallDetail = gatewayCallDetailFromJson(jsonString);
//     final gatewayCallPage = gatewayCallPageFromJson(jsonString);
//     final gatewayCallView = gatewayCallViewFromJson(jsonString);
//     final gatewayConfigHistory = gatewayConfigHistoryFromJson(jsonString);
//     final gatewayConfigView = gatewayConfigViewFromJson(jsonString);
//     final gatewayMcpBindingDraft = gatewayMcpBindingDraftFromJson(jsonString);
//     final gatewayMcpBindingDraftRequest = gatewayMcpBindingDraftRequestFromJson(jsonString);
//     final gatewayMcpBindingFact = gatewayMcpBindingFactFromJson(jsonString);
//     final gatewayMcpPeerPage = gatewayMcpPeerPageFromJson(jsonString);
//     final gatewayMcpProbeRequest = gatewayMcpProbeRequestFromJson(jsonString);
//     final gatewayMcpProbeResult = gatewayMcpProbeResultFromJson(jsonString);
//     final gatewayMcpReleasePage = gatewayMcpReleasePageFromJson(jsonString);
//     final gatewayModelRoutePage = gatewayModelRoutePageFromJson(jsonString);
//     final gatewayModelSourcePage = gatewayModelSourcePageFromJson(jsonString);
//     final gatewayStats = gatewayStatsFromJson(jsonString);
//     final gatewayStatsCounters = gatewayStatsCountersFromJson(jsonString);
//     final gatewayToolPage = gatewayToolPageFromJson(jsonString);
//     final gatewayToolTestCallResult = gatewayToolTestCallResultFromJson(jsonString);
//     final huddleAnnouncementView = huddleAnnouncementViewFromJson(jsonString);
//     final huddleLifecycleEvent = huddleLifecycleEventFromJson(jsonString);
//     final huddleLifecyclePage = huddleLifecyclePageFromJson(jsonString);
//     final huddlePage = huddlePageFromJson(jsonString);
//     final huddleView = huddleViewFromJson(jsonString);
//     final huddleVoiceView = huddleVoiceViewFromJson(jsonString);
//     final invitationRedemptionView = invitationRedemptionViewFromJson(jsonString);
//     final invitationRedemptionRequest = invitationRedemptionRequestFromJson(jsonString);
//     final issuedInvitation = issuedInvitationFromJson(jsonString);
//     final legacySecretRefPage = legacySecretRefPageFromJson(jsonString);
//     final mcpConnectionPage = mcpConnectionPageFromJson(jsonString);
//     final mcpConnectionPolicyView = mcpConnectionPolicyViewFromJson(jsonString);
//     final mcpConnectionProbeRequest = mcpConnectionProbeRequestFromJson(jsonString);
//     final mcpConnectionProbeResult = mcpConnectionProbeResultFromJson(jsonString);
//     final mcpConnectionRefreshResult = mcpConnectionRefreshResultFromJson(jsonString);
//     final mcpConnectionToolView = mcpConnectionToolViewFromJson(jsonString);
//     final mcpConnectionView = mcpConnectionViewFromJson(jsonString);
//     final mcpOauthAttemptView = mcpOauthAttemptViewFromJson(jsonString);
//     final mcpOauthStartRequest = mcpOauthStartRequestFromJson(jsonString);
//     final mcpProbedTool = mcpProbedToolFromJson(jsonString);
//     final moderationAccessView = moderationAccessViewFromJson(jsonString);
//     final moderationAuditPage = moderationAuditPageFromJson(jsonString);
//     final moderationReportPage = moderationReportPageFromJson(jsonString);
//     final moderationRestrictionPage = moderationRestrictionPageFromJson(jsonString);
//     final nativeCommunityFacts = nativeCommunityFactsFromJson(jsonString);
//     final nativeHumanActionRequest = nativeHumanActionRequestFromJson(jsonString);
//     final nativeHumanActionResult = nativeHumanActionResultFromJson(jsonString);
//     final nativeHumanReadReceipt = nativeHumanReadReceiptFromJson(jsonString);
//     final nativeHumanResourceResult = nativeHumanResourceResultFromJson(jsonString);
//     final nativeHumanScopeResult = nativeHumanScopeResultFromJson(jsonString);
//     final operationUsageCount = operationUsageCountFromJson(jsonString);
//     final ownAuditEntry = ownAuditEntryFromJson(jsonString);
//     final platformInfo = platformInfoFromJson(jsonString);
//     final platformTenantPage = platformTenantPageFromJson(jsonString);
//     final platformToolPage = platformToolPageFromJson(jsonString);
//     final platformToolView = platformToolViewFromJson(jsonString);
//     final projectChannelRequest = projectChannelRequestFromJson(jsonString);
//     final projectChannelRequestApprovalView = projectChannelRequestApprovalViewFromJson(jsonString);
//     final projectPreferenceRequest = projectPreferenceRequestFromJson(jsonString);
//     final projectsGitMergeRequest = projectsGitMergeRequestFromJson(jsonString);
//     final projectsGitMergeResponse = projectsGitMergeResponseFromJson(jsonString);
//     final projectsGitQueryRequest = projectsGitQueryRequestFromJson(jsonString);
//     final projectsGitQueryResponse = projectsGitQueryResponseFromJson(jsonString);
//     final projectsGitRefRequest = projectsGitRefRequestFromJson(jsonString);
//     final projectsGitRefResponse = projectsGitRefResponseFromJson(jsonString);
//     final projectsPublishRequest = projectsPublishRequestFromJson(jsonString);
//     final projectsQueryRequest = projectsQueryRequestFromJson(jsonString);
//     final protocolSessionView = protocolSessionViewFromJson(jsonString);
//     final pulsePublishRequest = pulsePublishRequestFromJson(jsonString);
//     final pulseQueryRequest = pulseQueryRequestFromJson(jsonString);
//     final readMarkRequest = readMarkRequestFromJson(jsonString);
//     final reminderPublishRequest = reminderPublishRequestFromJson(jsonString);
//     final reminderSourceRequest = reminderSourceRequestFromJson(jsonString);
//     final reminderView = reminderViewFromJson(jsonString);
//     final roleMemberPage = roleMemberPageFromJson(jsonString);
//     final roleWorkspacePage = roleWorkspacePageFromJson(jsonString);
//     final platformSessionView = platformSessionViewFromJson(jsonString);
//     final sidebarAssignmentRequest = sidebarAssignmentRequestFromJson(jsonString);
//     final sidebarSectionRequest = sidebarSectionRequestFromJson(jsonString);
//     final sidebarSectionOrderRequest = sidebarSectionOrderRequestFromJson(jsonString);
//     final sidebarSortRequest = sidebarSortRequestFromJson(jsonString);
//     final skillArtifactUploadRequest = skillArtifactUploadRequestFromJson(jsonString);
//     final skillArtifactUploadView = skillArtifactUploadViewFromJson(jsonString);
//     final skillArtifactViolation = skillArtifactViolationFromJson(jsonString);
//     final skillDefinitionPage = skillDefinitionPageFromJson(jsonString);
//     final skillDefinitionView = skillDefinitionViewFromJson(jsonString);
//     final skillReferencePage = skillReferencePageFromJson(jsonString);
//     final skillVersionContentView = skillVersionContentViewFromJson(jsonString);
//     final skillVersionPage = skillVersionPageFromJson(jsonString);
//     final skillVersionView = skillVersionViewFromJson(jsonString);
//     final taskView = taskViewFromJson(jsonString);
//     final tenantInvitationView = tenantInvitationViewFromJson(jsonString);
//     final tenantMemberJoinPage = tenantMemberJoinPageFromJson(jsonString);
//     final tenantMemberJoinView = tenantMemberJoinViewFromJson(jsonString);
//     final tenantQuotaPage = tenantQuotaPageFromJson(jsonString);
//     final threadPreferenceRequest = threadPreferenceRequestFromJson(jsonString);
//     final usageBillingView = usageBillingViewFromJson(jsonString);
//     final userStateVersion = userStateVersionFromJson(jsonString);
//     final webChannelCanvasView = webChannelCanvasViewFromJson(jsonString);
//     final webChannelView = webChannelViewFromJson(jsonString);
//     final webCustomEmojiMutation = webCustomEmojiMutationFromJson(jsonString);
//     final webCustomEmojiView = webCustomEmojiViewFromJson(jsonString);
//     final webGifCapabilityView = webGifCapabilityViewFromJson(jsonString);
//     final webGifItem = webGifItemFromJson(jsonString);
//     final webGifSearchRequest = webGifSearchRequestFromJson(jsonString);
//     final webGifSearchView = webGifSearchViewFromJson(jsonString);
//     final webGifShareRequest = webGifShareRequestFromJson(jsonString);
//     final webInboxQuery = webInboxQueryFromJson(jsonString);
//     final webLinkPreviewRequest = webLinkPreviewRequestFromJson(jsonString);
//     final webLinkPreviewSnapshotView = webLinkPreviewSnapshotViewFromJson(jsonString);
//     final webMessageAttachment = webMessageAttachmentFromJson(jsonString);
//     final webMessageAuthorQuery = webMessageAuthorQueryFromJson(jsonString);
//     final webMessageAuthorView = webMessageAuthorViewFromJson(jsonString);
//     final webMessageCursor = webMessageCursorFromJson(jsonString);
//     final webMessageQuery = webMessageQueryFromJson(jsonString);
//     final webMessageType = webMessageTypeFromJson(jsonString);
//     final webPresencePage = webPresencePageFromJson(jsonString);
//     final webPresenceQueryRequest = webPresenceQueryRequestFromJson(jsonString);
//     final webPresenceUpdateRequest = webPresenceUpdateRequestFromJson(jsonString);
//     final webProfileUpdateRequest = webProfileUpdateRequestFromJson(jsonString);
//     final webProfileView = webProfileViewFromJson(jsonString);
//     final webPublishMessageRequest = webPublishMessageRequestFromJson(jsonString);
//     final webPublishTopicRequest = webPublishTopicRequestFromJson(jsonString);
//     final webSearchQuery = webSearchQueryFromJson(jsonString);
//     final webTypingRequest = webTypingRequestFromJson(jsonString);
//     final webUserStatusPage = webUserStatusPageFromJson(jsonString);
//     final webUserStatusQueryRequest = webUserStatusQueryRequestFromJson(jsonString);
//     final webUserStatusUpdateRequest = webUserStatusUpdateRequestFromJson(jsonString);
//     final webWorkspaceActivityPage = webWorkspaceActivityPageFromJson(jsonString);
//     final webWorkspaceActivityQuery = webWorkspaceActivityQueryFromJson(jsonString);
//     final workspaceView = workspaceViewFromJson(jsonString);
//     final workspaceMemberView = workspaceMemberViewFromJson(jsonString);
//     final workspacePreferenceRequest = workspacePreferenceRequestFromJson(jsonString);
//     final actionTokenSigningDelivery = actionTokenSigningDeliveryFromJson(jsonString);
//     final agentDefinitionExportInput = agentDefinitionExportInputFromJson(jsonString);
//     final agentDefinitionImportInput = agentDefinitionImportInputFromJson(jsonString);
//     final agentMemoryEntryListInput = agentMemoryEntryListInputFromJson(jsonString);
//     final agentMemoryEntryReadInput = agentMemoryEntryReadInputFromJson(jsonString);
//     final agentMemoryWriteInput = agentMemoryWriteInputFromJson(jsonString);
//     final agentTeamExportInput = agentTeamExportInputFromJson(jsonString);
//     final agentTeamImportInput = agentTeamImportInputFromJson(jsonString);
//     final agentTeamInput = agentTeamInputFromJson(jsonString);
//     final agentVersionContent = agentVersionContentFromJson(jsonString);
//     final applicationAdapterDirectory = applicationAdapterDirectoryFromJson(jsonString);
//     final applicationBindingCreate = applicationBindingCreateFromJson(jsonString);
//     final applicationModelGatewayConfig = applicationModelGatewayConfigFromJson(jsonString);
//     final automationApprovalPolicyRef = automationApprovalPolicyRefFromJson(jsonString);
//     final automationScheduleSpec = automationScheduleSpecFromJson(jsonString);
//     final automationSecretRef = automationSecretRefFromJson(jsonString);
//     final automationStep = automationStepFromJson(jsonString);
//     final automationStepTrace = automationStepTraceFromJson(jsonString);
//     final automationVersionContent = automationVersionContentFromJson(jsonString);
//     final capabilityConformanceVectors = capabilityConformanceVectorsFromJson(jsonString);
//     final capabilityContractRef = capabilityContractRefFromJson(jsonString);
//     final capabilityContractRegistration = capabilityContractRegistrationFromJson(jsonString);
//     final capabilityVectorBinding = capabilityVectorBindingFromJson(jsonString);
//     final capabilityVectorCapture = capabilityVectorCaptureFromJson(jsonString);
//     final componentActionInput = componentActionInputFromJson(jsonString);
//     final componentConformanceCaptureValue = componentConformanceCaptureValueFromJson(jsonString);
//     final componentConformanceEnvironment = componentConformanceEnvironmentFromJson(jsonString);
//     final componentConformanceFixture = componentConformanceFixtureFromJson(jsonString);
//     final componentConformanceIdentity = componentConformanceIdentityFromJson(jsonString);
//     final componentConformanceReceiverEnvironment = componentConformanceReceiverEnvironmentFromJson(jsonString);
//     final componentNativeReceiverObservation = componentNativeReceiverObservationFromJson(jsonString);
//     final componentNativeReceiverRequest = componentNativeReceiverRequestFromJson(jsonString);
//     final componentPersonRef = componentPersonRefFromJson(jsonString);
//     final componentPreferenceDeclaration = componentPreferenceDeclarationFromJson(jsonString);
//     final componentProtocolPeerEnvironment = componentProtocolPeerEnvironmentFromJson(jsonString);
//     final componentReleaseApprovalTarget = componentReleaseApprovalTargetFromJson(jsonString);
//     final componentReleaseRegistration = componentReleaseRegistrationFromJson(jsonString);
//     final componentText = componentTextFromJson(jsonString);
//     final contentReference = contentReferenceFromJson(jsonString);
//     final delegationGrantParameters = delegationGrantParametersFromJson(jsonString);
//     final delegationScopeParameters = delegationScopeParametersFromJson(jsonString);
//     final documentLaunchDescriptor = documentLaunchDescriptorFromJson(jsonString);
//     final errorBody = errorBodyFromJson(jsonString);
//     final huddleAgentInput = huddleAgentInputFromJson(jsonString);
//     final huddleStartInput = huddleStartInputFromJson(jsonString);
//     final resolvedIdentity = resolvedIdentityFromJson(jsonString);
//     final llmRouteCreateInput = llmRouteCreateInputFromJson(jsonString);
//     final mcpConnectionCreate = mcpConnectionCreateFromJson(jsonString);
//     final mcpConnectionCredentialInput = mcpConnectionCredentialInputFromJson(jsonString);
//     final mcpConnectionPolicyUpdate = mcpConnectionPolicyUpdateFromJson(jsonString);
//     final mcpConnectionUpdate = mcpConnectionUpdateFromJson(jsonString);
//     final mcpToolSelection = mcpToolSelectionFromJson(jsonString);
//     final nativeDocumentSelection = nativeDocumentSelectionFromJson(jsonString);
//     final platformBuildInfo = platformBuildInfoFromJson(jsonString);
//     final protocolSessionOpenInput = protocolSessionOpenInputFromJson(jsonString);
//     final resourceCreate = resourceCreateFromJson(jsonString);
//     final runtimeProfileDirectory = runtimeProfileDirectoryFromJson(jsonString);
//     final skillVersionUploadInput = skillVersionUploadInputFromJson(jsonString);
//     final taskStateReport = taskStateReportFromJson(jsonString);
//     final tenantQuotaSetting = tenantQuotaSettingFromJson(jsonString);
//     final workflowRef = workflowRefFromJson(jsonString);
//     final workspaceCanvasSetInput = workspaceCanvasSetInputFromJson(jsonString);
//     final workspaceChannelCreate = workspaceChannelCreateFromJson(jsonString);
//     final workspaceUpdate = workspaceUpdateFromJson(jsonString);
//     final workspaceVisibility = workspaceVisibilityFromJson(jsonString);
//     final affectedOwnerRef = affectedOwnerRefFromJson(jsonString);
//     final agentInstallationAdvanceRequest = agentInstallationAdvanceRequestFromJson(jsonString);
//     final agentInstallationAdvanceResult = agentInstallationAdvanceResultFromJson(jsonString);
//     final agentInstallationWorkflowTarget = agentInstallationWorkflowTargetFromJson(jsonString);
//     final agentTaskAdvanceRequest = agentTaskAdvanceRequestFromJson(jsonString);
//     final agentTaskAdvanceResult = agentTaskAdvanceResultFromJson(jsonString);
//     final agentTaskWorkflowInput = agentTaskWorkflowInputFromJson(jsonString);
//     final applicationBindingAdvanceRequest = applicationBindingAdvanceRequestFromJson(jsonString);
//     final applicationBindingAdvanceResult = applicationBindingAdvanceResultFromJson(jsonString);
//     final applicationBindingTarget = applicationBindingTargetFromJson(jsonString);
//     final approvalControlOutcome = approvalControlOutcomeFromJson(jsonString);
//     final approvalDecisionOutcome = approvalDecisionOutcomeFromJson(jsonString);
//     final approvalDecisionRecord = approvalDecisionRecordFromJson(jsonString);
//     final approvalDecisionUpdate = approvalDecisionUpdateFromJson(jsonString);
//     final approvalWorkflowInput = approvalWorkflowInputFromJson(jsonString);
//     final approvalInvalidateUpdate = approvalInvalidateUpdateFromJson(jsonString);
//     final approvalRefusal = approvalRefusalFromJson(jsonString);
//     final approvalResume = approvalResumeFromJson(jsonString);
//     final approvalRoleRequirement = approvalRoleRequirementFromJson(jsonString);
//     final approvalStateReport = approvalStateReportFromJson(jsonString);
//     final automationScheduleAdmitRequest = automationScheduleAdmitRequestFromJson(jsonString);
//     final automationScheduleAdmitResult = automationScheduleAdmitResultFromJson(jsonString);
//     final automationScheduleTaskInput = automationScheduleTaskInputFromJson(jsonString);
//     final componentActionAdvanceRequest = componentActionAdvanceRequestFromJson(jsonString);
//     final componentActionAdvanceResult = componentActionAdvanceResultFromJson(jsonString);
//     final componentActionTarget = componentActionTargetFromJson(jsonString);
//     final componentConformanceObservation = componentConformanceObservationFromJson(jsonString);
//     final componentConformancePlan = componentConformancePlanFromJson(jsonString);
//     final componentConformanceProbe = componentConformanceProbeFromJson(jsonString);
//     final componentConformanceStepObservation = componentConformanceStepObservationFromJson(jsonString);
//     final conversationProjectionRequest = conversationProjectionRequestFromJson(jsonString);
//     final conversationProjectionResult = conversationProjectionResultFromJson(jsonString);
//     final conversationProjectionTarget = conversationProjectionTargetFromJson(jsonString);
//     final freshApprovalAdmissionRequest = freshApprovalAdmissionRequestFromJson(jsonString);
//     final freshApprovalAdmissionResult = freshApprovalAdmissionResultFromJson(jsonString);
//     final protocolSessionReconcileRequest = protocolSessionReconcileRequestFromJson(jsonString);
//     final protocolSessionReconcileResult = protocolSessionReconcileResultFromJson(jsonString);
//     final protocolSessionReconcileRound = protocolSessionReconcileRoundFromJson(jsonString);
//     final protocolSessionReconcileTarget = protocolSessionReconcileTargetFromJson(jsonString);
//     final resourceExportAdvanceRequest = resourceExportAdvanceRequestFromJson(jsonString);
//     final resourceExportAdvanceResult = resourceExportAdvanceResultFromJson(jsonString);
//     final resourceExportTarget = resourceExportTargetFromJson(jsonString);
//     final resourceImportAdvanceRequest = resourceImportAdvanceRequestFromJson(jsonString);
//     final resourceImportAdvanceResult = resourceImportAdvanceResultFromJson(jsonString);
//     final resourceImportTarget = resourceImportTargetFromJson(jsonString);
//     final resourceProvisionAdvanceRequest = resourceProvisionAdvanceRequestFromJson(jsonString);
//     final resourceProvisionAdvanceResult = resourceProvisionAdvanceResultFromJson(jsonString);
//     final resourceProvisionTarget = resourceProvisionTargetFromJson(jsonString);
//     final tenantDeleteAdvanceRequest = tenantDeleteAdvanceRequestFromJson(jsonString);
//     final tenantDeleteAdvanceResult = tenantDeleteAdvanceResultFromJson(jsonString);

import 'dart:convert';

Canary canaryFromJson(String str) => Canary.fromJson(json.decode(str));

String canaryToJson(Canary data) => json.encode(data.toJson());

ApplicationModelAdmission applicationModelAdmissionFromJson(String str) =>
    ApplicationModelAdmission.fromJson(json.decode(str));

String applicationModelAdmissionToJson(ApplicationModelAdmission data) =>
    json.encode(data.toJson());

FileStorageDeleteInput fileStorageDeleteInputFromJson(String str) =>
    FileStorageDeleteInput.fromJson(json.decode(str));

String fileStorageDeleteInputToJson(FileStorageDeleteInput data) =>
    json.encode(data.toJson());

FileStorageDeleteOutput fileStorageDeleteOutputFromJson(String str) =>
    FileStorageDeleteOutput.fromJson(json.decode(str));

String fileStorageDeleteOutputToJson(FileStorageDeleteOutput data) =>
    json.encode(data.toJson());

FileStorageExportInput fileStorageExportInputFromJson(String str) =>
    FileStorageExportInput.fromJson(json.decode(str));

String fileStorageExportInputToJson(FileStorageExportInput data) =>
    json.encode(data.toJson());

FileStorageExportOutput fileStorageExportOutputFromJson(String str) =>
    FileStorageExportOutput.fromJson(json.decode(str));

String fileStorageExportOutputToJson(FileStorageExportOutput data) =>
    json.encode(data.toJson());

FileStorageListInput fileStorageListInputFromJson(String str) =>
    FileStorageListInput.fromJson(json.decode(str));

String fileStorageListInputToJson(FileStorageListInput data) =>
    json.encode(data.toJson());

FileStorageListOutput fileStorageListOutputFromJson(String str) =>
    FileStorageListOutput.fromJson(json.decode(str));

String fileStorageListOutputToJson(FileStorageListOutput data) =>
    json.encode(data.toJson());

FileStorageListRevisionsInput fileStorageListRevisionsInputFromJson(
  String str,
) => FileStorageListRevisionsInput.fromJson(json.decode(str));

String fileStorageListRevisionsInputToJson(
  FileStorageListRevisionsInput data,
) => json.encode(data.toJson());

FileStorageListRevisionsOutput fileStorageListRevisionsOutputFromJson(
  String str,
) => FileStorageListRevisionsOutput.fromJson(json.decode(str));

String fileStorageListRevisionsOutputToJson(
  FileStorageListRevisionsOutput data,
) => json.encode(data.toJson());

FileStorageReadInput fileStorageReadInputFromJson(String str) =>
    FileStorageReadInput.fromJson(json.decode(str));

String fileStorageReadInputToJson(FileStorageReadInput data) =>
    json.encode(data.toJson());

FileStorageReadOutput fileStorageReadOutputFromJson(String str) =>
    FileStorageReadOutput.fromJson(json.decode(str));

String fileStorageReadOutputToJson(FileStorageReadOutput data) =>
    json.encode(data.toJson());

FileStorageShareInput fileStorageShareInputFromJson(String str) =>
    FileStorageShareInput.fromJson(json.decode(str));

String fileStorageShareInputToJson(FileStorageShareInput data) =>
    json.encode(data.toJson());

FileStorageShareOutput fileStorageShareOutputFromJson(String str) =>
    FileStorageShareOutput.fromJson(json.decode(str));

String fileStorageShareOutputToJson(FileStorageShareOutput data) =>
    json.encode(data.toJson());

FileStorageWriteInput fileStorageWriteInputFromJson(String str) =>
    FileStorageWriteInput.fromJson(json.decode(str));

String fileStorageWriteInputToJson(FileStorageWriteInput data) =>
    json.encode(data.toJson());

FileStorageWriteOutput fileStorageWriteOutputFromJson(String str) =>
    FileStorageWriteOutput.fromJson(json.decode(str));

String fileStorageWriteOutputToJson(FileStorageWriteOutput data) =>
    json.encode(data.toJson());

KnowledgeSyncInput knowledgeSyncInputFromJson(String str) =>
    KnowledgeSyncInput.fromJson(json.decode(str));

String knowledgeSyncInputToJson(KnowledgeSyncInput data) =>
    json.encode(data.toJson());

AdapterBindingObservation adapterBindingObservationFromJson(String str) =>
    AdapterBindingObservation.fromJson(json.decode(str));

String adapterBindingObservationToJson(AdapterBindingObservation data) =>
    json.encode(data.toJson());

AdapterBindingReconcileRequest adapterBindingReconcileRequestFromJson(
  String str,
) => AdapterBindingReconcileRequest.fromJson(json.decode(str));

String adapterBindingReconcileRequestToJson(
  AdapterBindingReconcileRequest data,
) => json.encode(data.toJson());

AdapterBindingReconcileResponse adapterBindingReconcileResponseFromJson(
  String str,
) => AdapterBindingReconcileResponse.fromJson(json.decode(str));

String adapterBindingReconcileResponseToJson(
  AdapterBindingReconcileResponse data,
) => json.encode(data.toJson());

AdapterExecutionObservation adapterExecutionObservationFromJson(String str) =>
    AdapterExecutionObservation.fromJson(json.decode(str));

String adapterExecutionObservationToJson(AdapterExecutionObservation data) =>
    json.encode(data.toJson());

AdapterExecutionReference adapterExecutionReferenceFromJson(String str) =>
    AdapterExecutionReference.fromJson(json.decode(str));

String adapterExecutionReferenceToJson(AdapterExecutionReference data) =>
    json.encode(data.toJson());

AdapterExecutionResponse adapterExecutionResponseFromJson(String str) =>
    AdapterExecutionResponse.fromJson(json.decode(str));

String adapterExecutionResponseToJson(AdapterExecutionResponse data) =>
    json.encode(data.toJson());

AdapterExecutionUsage adapterExecutionUsageFromJson(String str) =>
    AdapterExecutionUsage.fromJson(json.decode(str));

String adapterExecutionUsageToJson(AdapterExecutionUsage data) =>
    json.encode(data.toJson());

NativeTaskExecutionAdmissionRequest nativeTaskExecutionAdmissionRequestFromJson(
  String str,
) => NativeTaskExecutionAdmissionRequest.fromJson(json.decode(str));

String nativeTaskExecutionAdmissionRequestToJson(
  NativeTaskExecutionAdmissionRequest data,
) => json.encode(data.toJson());

NativeTaskExecutionAdmissionResponse
nativeTaskExecutionAdmissionResponseFromJson(String str) =>
    NativeTaskExecutionAdmissionResponse.fromJson(json.decode(str));

String nativeTaskExecutionAdmissionResponseToJson(
  NativeTaskExecutionAdmissionResponse data,
) => json.encode(data.toJson());

AdapterPepCheckRequest adapterPepCheckRequestFromJson(String str) =>
    AdapterPepCheckRequest.fromJson(json.decode(str));

String adapterPepCheckRequestToJson(AdapterPepCheckRequest data) =>
    json.encode(data.toJson());

AdapterPepCheckResponse adapterPepCheckResponseFromJson(String str) =>
    AdapterPepCheckResponse.fromJson(json.decode(str));

String adapterPepCheckResponseToJson(AdapterPepCheckResponse data) =>
    json.encode(data.toJson());

ProtocolRevisionQuery protocolRevisionQueryFromJson(String str) =>
    ProtocolRevisionQuery.fromJson(json.decode(str));

String protocolRevisionQueryToJson(ProtocolRevisionQuery data) =>
    json.encode(data.toJson());

AdapterProtocolSessionLaunchRequest adapterProtocolSessionLaunchRequestFromJson(
  String str,
) => AdapterProtocolSessionLaunchRequest.fromJson(json.decode(str));

String adapterProtocolSessionLaunchRequestToJson(
  AdapterProtocolSessionLaunchRequest data,
) => json.encode(data.toJson());

AdapterProtocolSessionLaunchResponse
adapterProtocolSessionLaunchResponseFromJson(String str) =>
    AdapterProtocolSessionLaunchResponse.fromJson(json.decode(str));

String adapterProtocolSessionLaunchResponseToJson(
  AdapterProtocolSessionLaunchResponse data,
) => json.encode(data.toJson());

ProtocolSessionLifecyclePepResponse protocolSessionLifecyclePepResponseFromJson(
  String str,
) => ProtocolSessionLifecyclePepResponse.fromJson(json.decode(str));

String protocolSessionLifecyclePepResponseToJson(
  ProtocolSessionLifecyclePepResponse data,
) => json.encode(data.toJson());

AdapterProtocolSessionLifecycleRequest
adapterProtocolSessionLifecycleRequestFromJson(String str) =>
    AdapterProtocolSessionLifecycleRequest.fromJson(json.decode(str));

String adapterProtocolSessionLifecycleRequestToJson(
  AdapterProtocolSessionLifecycleRequest data,
) => json.encode(data.toJson());

AdapterProtocolSessionLifecycleResponse
adapterProtocolSessionLifecycleResponseFromJson(String str) =>
    AdapterProtocolSessionLifecycleResponse.fromJson(json.decode(str));

String adapterProtocolSessionLifecycleResponseToJson(
  AdapterProtocolSessionLifecycleResponse data,
) => json.encode(data.toJson());

ProtocolSessionPepRequest protocolSessionPepRequestFromJson(String str) =>
    ProtocolSessionPepRequest.fromJson(json.decode(str));

String protocolSessionPepRequestToJson(ProtocolSessionPepRequest data) =>
    json.encode(data.toJson());

ProtocolSessionPepResponse protocolSessionPepResponseFromJson(String str) =>
    ProtocolSessionPepResponse.fromJson(json.decode(str));

String protocolSessionPepResponseToJson(ProtocolSessionPepResponse data) =>
    json.encode(data.toJson());

ProtocolWriteObservation protocolWriteObservationFromJson(String str) =>
    ProtocolWriteObservation.fromJson(json.decode(str));

String protocolWriteObservationToJson(ProtocolWriteObservation data) =>
    json.encode(data.toJson());

ProtocolWriteReceipt protocolWriteReceiptFromJson(String str) =>
    ProtocolWriteReceipt.fromJson(json.decode(str));

String protocolWriteReceiptToJson(ProtocolWriteReceipt data) =>
    json.encode(data.toJson());

AdapterQueryRevisionRequest adapterQueryRevisionRequestFromJson(String str) =>
    AdapterQueryRevisionRequest.fromJson(json.decode(str));

String adapterQueryRevisionRequestToJson(AdapterQueryRevisionRequest data) =>
    json.encode(data.toJson());

AdapterQueryRevisionResponse adapterQueryRevisionResponseFromJson(String str) =>
    AdapterQueryRevisionResponse.fromJson(json.decode(str));

String adapterQueryRevisionResponseToJson(AdapterQueryRevisionResponse data) =>
    json.encode(data.toJson());

AdapterReadGrantRequest adapterReadGrantRequestFromJson(String str) =>
    AdapterReadGrantRequest.fromJson(json.decode(str));

String adapterReadGrantRequestToJson(AdapterReadGrantRequest data) =>
    json.encode(data.toJson());

AdapterReadGrantResponse adapterReadGrantResponseFromJson(String str) =>
    AdapterReadGrantResponse.fromJson(json.decode(str));

String adapterReadGrantResponseToJson(AdapterReadGrantResponse data) =>
    json.encode(data.toJson());

AdapterReadReceipt adapterReadReceiptFromJson(String str) =>
    AdapterReadReceipt.fromJson(json.decode(str));

String adapterReadReceiptToJson(AdapterReadReceipt data) =>
    json.encode(data.toJson());

AdapterScopeObservation adapterScopeObservationFromJson(String str) =>
    AdapterScopeObservation.fromJson(json.decode(str));

String adapterScopeObservationToJson(AdapterScopeObservation data) =>
    json.encode(data.toJson());

AdapterSearchRequest adapterSearchRequestFromJson(String str) =>
    AdapterSearchRequest.fromJson(json.decode(str));

String adapterSearchRequestToJson(AdapterSearchRequest data) =>
    json.encode(data.toJson());

AdapterSearchResponse adapterSearchResponseFromJson(String str) =>
    AdapterSearchResponse.fromJson(json.decode(str));

String adapterSearchResponseToJson(AdapterSearchResponse data) =>
    json.encode(data.toJson());

AdapterSourceResource adapterSourceResourceFromJson(String str) =>
    AdapterSourceResource.fromJson(json.decode(str));

String adapterSourceResourceToJson(AdapterSourceResource data) =>
    json.encode(data.toJson());

ActionCommand actionCommandFromJson(String str) =>
    ActionCommand.fromJson(json.decode(str));

String actionCommandToJson(ActionCommand data) => json.encode(data.toJson());

ActionSubmission actionSubmissionFromJson(String str) =>
    ActionSubmission.fromJson(json.decode(str));

String actionSubmissionToJson(ActionSubmission data) =>
    json.encode(data.toJson());

AgentActiveTurnPage agentActiveTurnPageFromJson(String str) =>
    AgentActiveTurnPage.fromJson(json.decode(str));

String agentActiveTurnPageToJson(AgentActiveTurnPage data) =>
    json.encode(data.toJson());

AgentActiveTurnView agentActiveTurnViewFromJson(String str) =>
    AgentActiveTurnView.fromJson(json.decode(str));

String agentActiveTurnViewToJson(AgentActiveTurnView data) =>
    json.encode(data.toJson());

AgentAuthorDirectory agentAuthorDirectoryFromJson(String str) =>
    AgentAuthorDirectory.fromJson(json.decode(str));

String agentAuthorDirectoryToJson(AgentAuthorDirectory data) =>
    json.encode(data.toJson());

AgentCatalogOwners agentCatalogOwnersFromJson(String str) =>
    AgentCatalogOwners.fromJson(json.decode(str));

String agentCatalogOwnersToJson(AgentCatalogOwners data) =>
    json.encode(data.toJson());

AgentDefinitionPage agentDefinitionPageFromJson(String str) =>
    AgentDefinitionPage.fromJson(json.decode(str));

String agentDefinitionPageToJson(AgentDefinitionPage data) =>
    json.encode(data.toJson());

AgentDefinitionView agentDefinitionViewFromJson(String str) =>
    AgentDefinitionView.fromJson(json.decode(str));

String agentDefinitionViewToJson(AgentDefinitionView data) =>
    json.encode(data.toJson());

AgentDelegationPage agentDelegationPageFromJson(String str) =>
    AgentDelegationPage.fromJson(json.decode(str));

String agentDelegationPageToJson(AgentDelegationPage data) =>
    json.encode(data.toJson());

AgentDelegationTargetPage agentDelegationTargetPageFromJson(String str) =>
    AgentDelegationTargetPage.fromJson(json.decode(str));

String agentDelegationTargetPageToJson(AgentDelegationTargetPage data) =>
    json.encode(data.toJson());

AgentDelegationView agentDelegationViewFromJson(String str) =>
    AgentDelegationView.fromJson(json.decode(str));

String agentDelegationViewToJson(AgentDelegationView data) =>
    json.encode(data.toJson());

AgentImportConfigurationPage agentImportConfigurationPageFromJson(String str) =>
    AgentImportConfigurationPage.fromJson(json.decode(str));

String agentImportConfigurationPageToJson(AgentImportConfigurationPage data) =>
    json.encode(data.toJson());

AgentInstallationCandidate agentInstallationCandidateFromJson(String str) =>
    AgentInstallationCandidate.fromJson(json.decode(str));

String agentInstallationCandidateToJson(AgentInstallationCandidate data) =>
    json.encode(data.toJson());

AgentInstallationCandidatePage agentInstallationCandidatePageFromJson(
  String str,
) => AgentInstallationCandidatePage.fromJson(json.decode(str));

String agentInstallationCandidatePageToJson(
  AgentInstallationCandidatePage data,
) => json.encode(data.toJson());

AgentInstallationPage agentInstallationPageFromJson(String str) =>
    AgentInstallationPage.fromJson(json.decode(str));

String agentInstallationPageToJson(AgentInstallationPage data) =>
    json.encode(data.toJson());

AgentInstallationProjectionView agentInstallationProjectionViewFromJson(
  String str,
) => AgentInstallationProjectionView.fromJson(json.decode(str));

String agentInstallationProjectionViewToJson(
  AgentInstallationProjectionView data,
) => json.encode(data.toJson());

AgentInstallationSkillPage agentInstallationSkillPageFromJson(String str) =>
    AgentInstallationSkillPage.fromJson(json.decode(str));

String agentInstallationSkillPageToJson(AgentInstallationSkillPage data) =>
    json.encode(data.toJson());

AgentInstallationSkillView agentInstallationSkillViewFromJson(String str) =>
    AgentInstallationSkillView.fromJson(json.decode(str));

String agentInstallationSkillViewToJson(AgentInstallationSkillView data) =>
    json.encode(data.toJson());

AgentInstallationToolPage agentInstallationToolPageFromJson(String str) =>
    AgentInstallationToolPage.fromJson(json.decode(str));

String agentInstallationToolPageToJson(AgentInstallationToolPage data) =>
    json.encode(data.toJson());

AgentInstallationUsePage agentInstallationUsePageFromJson(String str) =>
    AgentInstallationUsePage.fromJson(json.decode(str));

String agentInstallationUsePageToJson(AgentInstallationUsePage data) =>
    json.encode(data.toJson());

AgentInstallationView agentInstallationViewFromJson(String str) =>
    AgentInstallationView.fromJson(json.decode(str));

String agentInstallationViewToJson(AgentInstallationView data) =>
    json.encode(data.toJson());

AgentInvocationPage agentInvocationPageFromJson(String str) =>
    AgentInvocationPage.fromJson(json.decode(str));

String agentInvocationPageToJson(AgentInvocationPage data) =>
    json.encode(data.toJson());

AgentInvocationView agentInvocationViewFromJson(String str) =>
    AgentInvocationView.fromJson(json.decode(str));

String agentInvocationViewToJson(AgentInvocationView data) =>
    json.encode(data.toJson());

AgentMemoryDanglingRefView agentMemoryDanglingRefViewFromJson(String str) =>
    AgentMemoryDanglingRefView.fromJson(json.decode(str));

String agentMemoryDanglingRefViewToJson(AgentMemoryDanglingRefView data) =>
    json.encode(data.toJson());

AgentMemoryEntryPage agentMemoryEntryPageFromJson(String str) =>
    AgentMemoryEntryPage.fromJson(json.decode(str));

String agentMemoryEntryPageToJson(AgentMemoryEntryPage data) =>
    json.encode(data.toJson());

AgentMemoryEntryView agentMemoryEntryViewFromJson(String str) =>
    AgentMemoryEntryView.fromJson(json.decode(str));

String agentMemoryEntryViewToJson(AgentMemoryEntryView data) =>
    json.encode(data.toJson());

AgentMemoryReadView agentMemoryReadViewFromJson(String str) =>
    AgentMemoryReadView.fromJson(json.decode(str));

String agentMemoryReadViewToJson(AgentMemoryReadView data) =>
    json.encode(data.toJson());

AgentMemoryReferenceView agentMemoryReferenceViewFromJson(String str) =>
    AgentMemoryReferenceView.fromJson(json.decode(str));

String agentMemoryReferenceViewToJson(AgentMemoryReferenceView data) =>
    json.encode(data.toJson());

AgentMentionOutcomePage agentMentionOutcomePageFromJson(String str) =>
    AgentMentionOutcomePage.fromJson(json.decode(str));

String agentMentionOutcomePageToJson(AgentMentionOutcomePage data) =>
    json.encode(data.toJson());

AgentMentionOutcomeQueryRequest agentMentionOutcomeQueryRequestFromJson(
  String str,
) => AgentMentionOutcomeQueryRequest.fromJson(json.decode(str));

String agentMentionOutcomeQueryRequestToJson(
  AgentMentionOutcomeQueryRequest data,
) => json.encode(data.toJson());

AgentSessionPage agentSessionPageFromJson(String str) =>
    AgentSessionPage.fromJson(json.decode(str));

String agentSessionPageToJson(AgentSessionPage data) =>
    json.encode(data.toJson());

AgentSessionView agentSessionViewFromJson(String str) =>
    AgentSessionView.fromJson(json.decode(str));

String agentSessionViewToJson(AgentSessionView data) =>
    json.encode(data.toJson());

AgentSnapshotImportPreview agentSnapshotImportPreviewFromJson(String str) =>
    AgentSnapshotImportPreview.fromJson(json.decode(str));

String agentSnapshotImportPreviewToJson(AgentSnapshotImportPreview data) =>
    json.encode(data.toJson());

AgentSnapshotUploadRequest agentSnapshotUploadRequestFromJson(String str) =>
    AgentSnapshotUploadRequest.fromJson(json.decode(str));

String agentSnapshotUploadRequestToJson(AgentSnapshotUploadRequest data) =>
    json.encode(data.toJson());

AgentTeamPage agentTeamPageFromJson(String str) =>
    AgentTeamPage.fromJson(json.decode(str));

String agentTeamPageToJson(AgentTeamPage data) => json.encode(data.toJson());

AgentTeamSnapshotImportPreview agentTeamSnapshotImportPreviewFromJson(
  String str,
) => AgentTeamSnapshotImportPreview.fromJson(json.decode(str));

String agentTeamSnapshotImportPreviewToJson(
  AgentTeamSnapshotImportPreview data,
) => json.encode(data.toJson());

AgentTeamSnapshotUploadRequest agentTeamSnapshotUploadRequestFromJson(
  String str,
) => AgentTeamSnapshotUploadRequest.fromJson(json.decode(str));

String agentTeamSnapshotUploadRequestToJson(
  AgentTeamSnapshotUploadRequest data,
) => json.encode(data.toJson());

AgentTeamView agentTeamViewFromJson(String str) =>
    AgentTeamView.fromJson(json.decode(str));

String agentTeamViewToJson(AgentTeamView data) => json.encode(data.toJson());

AgentTranscriptEvent agentTranscriptEventFromJson(String str) =>
    AgentTranscriptEvent.fromJson(json.decode(str));

String agentTranscriptEventToJson(AgentTranscriptEvent data) =>
    json.encode(data.toJson());

AgentTranscriptItem agentTranscriptItemFromJson(String str) =>
    AgentTranscriptItem.fromJson(json.decode(str));

String agentTranscriptItemToJson(AgentTranscriptItem data) =>
    json.encode(data.toJson());

AgentTranscriptPage agentTranscriptPageFromJson(String str) =>
    AgentTranscriptPage.fromJson(json.decode(str));

String agentTranscriptPageToJson(AgentTranscriptPage data) =>
    json.encode(data.toJson());

AgentVersionConfigurationPage agentVersionConfigurationPageFromJson(
  String str,
) => AgentVersionConfigurationPage.fromJson(json.decode(str));

String agentVersionConfigurationPageToJson(
  AgentVersionConfigurationPage data,
) => json.encode(data.toJson());

AgentVersionPage agentVersionPageFromJson(String str) =>
    AgentVersionPage.fromJson(json.decode(str));

String agentVersionPageToJson(AgentVersionPage data) =>
    json.encode(data.toJson());

AgentVersionRouteOption agentVersionRouteOptionFromJson(String str) =>
    AgentVersionRouteOption.fromJson(json.decode(str));

String agentVersionRouteOptionToJson(AgentVersionRouteOption data) =>
    json.encode(data.toJson());

AgentVersionView agentVersionViewFromJson(String str) =>
    AgentVersionView.fromJson(json.decode(str));

String agentVersionViewToJson(AgentVersionView data) =>
    json.encode(data.toJson());

ApplicationBindingPage applicationBindingPageFromJson(String str) =>
    ApplicationBindingPage.fromJson(json.decode(str));

String applicationBindingPageToJson(ApplicationBindingPage data) =>
    json.encode(data.toJson());

ApplicationNativePage applicationNativePageFromJson(String str) =>
    ApplicationNativePage.fromJson(json.decode(str));

String applicationNativePageToJson(ApplicationNativePage data) =>
    json.encode(data.toJson());

ApplicationReadResourcePage applicationReadResourcePageFromJson(String str) =>
    ApplicationReadResourcePage.fromJson(json.decode(str));

String applicationReadResourcePageToJson(ApplicationReadResourcePage data) =>
    json.encode(data.toJson());

ApprovalDecisionRequest approvalDecisionRequestFromJson(String str) =>
    ApprovalDecisionRequest.fromJson(json.decode(str));

String approvalDecisionRequestToJson(ApprovalDecisionRequest data) =>
    json.encode(data.toJson());

ApprovalView approvalViewFromJson(String str) =>
    ApprovalView.fromJson(json.decode(str));

String approvalViewToJson(ApprovalView data) => json.encode(data.toJson());

AuditEventPage auditEventPageFromJson(String str) =>
    AuditEventPage.fromJson(json.decode(str));

String auditEventPageToJson(AuditEventPage data) => json.encode(data.toJson());

AutomationApprovalStepView automationApprovalStepViewFromJson(String str) =>
    AutomationApprovalStepView.fromJson(json.decode(str));

String automationApprovalStepViewToJson(AutomationApprovalStepView data) =>
    json.encode(data.toJson());

AutomationDelegationView automationDelegationViewFromJson(String str) =>
    AutomationDelegationView.fromJson(json.decode(str));

String automationDelegationViewToJson(AutomationDelegationView data) =>
    json.encode(data.toJson());

AutomationDetailView automationDetailViewFromJson(String str) =>
    AutomationDetailView.fromJson(json.decode(str));

String automationDetailViewToJson(AutomationDetailView data) =>
    json.encode(data.toJson());

AutomationPage automationPageFromJson(String str) =>
    AutomationPage.fromJson(json.decode(str));

String automationPageToJson(AutomationPage data) => json.encode(data.toJson());

AutomationRunPage automationRunPageFromJson(String str) =>
    AutomationRunPage.fromJson(json.decode(str));

String automationRunPageToJson(AutomationRunPage data) =>
    json.encode(data.toJson());

AutomationRunView automationRunViewFromJson(String str) =>
    AutomationRunView.fromJson(json.decode(str));

String automationRunViewToJson(AutomationRunView data) =>
    json.encode(data.toJson());

AutomationVersionView automationVersionViewFromJson(String str) =>
    AutomationVersionView.fromJson(json.decode(str));

String automationVersionViewToJson(AutomationVersionView data) =>
    json.encode(data.toJson());

AutomationView automationViewFromJson(String str) =>
    AutomationView.fromJson(json.decode(str));

String automationViewToJson(AutomationView data) => json.encode(data.toJson());

AutomationWebhookSecret automationWebhookSecretFromJson(String str) =>
    AutomationWebhookSecret.fromJson(json.decode(str));

String automationWebhookSecretToJson(AutomationWebhookSecret data) =>
    json.encode(data.toJson());

BusinessOperationPage businessOperationPageFromJson(String str) =>
    BusinessOperationPage.fromJson(json.decode(str));

String businessOperationPageToJson(BusinessOperationPage data) =>
    json.encode(data.toJson());

BusinessOperationPhaseCount businessOperationPhaseCountFromJson(String str) =>
    BusinessOperationPhaseCount.fromJson(json.decode(str));

String businessOperationPhaseCountToJson(BusinessOperationPhaseCount data) =>
    json.encode(data.toJson());

BusinessOperationSummary businessOperationSummaryFromJson(String str) =>
    BusinessOperationSummary.fromJson(json.decode(str));

String businessOperationSummaryToJson(BusinessOperationSummary data) =>
    json.encode(data.toJson());

BusinessOperationView businessOperationViewFromJson(String str) =>
    BusinessOperationView.fromJson(json.decode(str));

String businessOperationViewToJson(BusinessOperationView data) =>
    json.encode(data.toJson());

CapabilityContractPage capabilityContractPageFromJson(String str) =>
    CapabilityContractPage.fromJson(json.decode(str));

String capabilityContractPageToJson(CapabilityContractPage data) =>
    json.encode(data.toJson());

CapabilityContractView capabilityContractViewFromJson(String str) =>
    CapabilityContractView.fromJson(json.decode(str));

String capabilityContractViewToJson(CapabilityContractView data) =>
    json.encode(data.toJson());

ChannelTemplateRequest channelTemplateRequestFromJson(String str) =>
    ChannelTemplateRequest.fromJson(json.decode(str));

String channelTemplateRequestToJson(ChannelTemplateRequest data) =>
    json.encode(data.toJson());

ClientKeyView clientKeyViewFromJson(String str) =>
    ClientKeyView.fromJson(json.decode(str));

String clientKeyViewToJson(ClientKeyView data) => json.encode(data.toJson());

ClientKeyStatus clientKeyStatusFromJson(String str) =>
    ClientKeyStatus.fromJson(json.decode(str));

String clientKeyStatusToJson(ClientKeyStatus data) =>
    json.encode(data.toJson());

ComponentConformanceAuthorization componentConformanceAuthorizationFromJson(
  String str,
) => ComponentConformanceAuthorization.fromJson(json.decode(str));

String componentConformanceAuthorizationToJson(
  ComponentConformanceAuthorization data,
) => json.encode(data.toJson());

ComponentConformanceWireDigests componentConformanceWireDigestsFromJson(
  String str,
) => ComponentConformanceWireDigests.fromJson(json.decode(str));

String componentConformanceWireDigestsToJson(
  ComponentConformanceWireDigests data,
) => json.encode(data.toJson());

ComponentConformanceWireObservation componentConformanceWireObservationFromJson(
  String str,
) => ComponentConformanceWireObservation.fromJson(json.decode(str));

String componentConformanceWireObservationToJson(
  ComponentConformanceWireObservation data,
) => json.encode(data.toJson());

ComponentMemberDirectory componentMemberDirectoryFromJson(String str) =>
    ComponentMemberDirectory.fromJson(json.decode(str));

String componentMemberDirectoryToJson(ComponentMemberDirectory data) =>
    json.encode(data.toJson());

ComponentNotificationDelivery componentNotificationDeliveryFromJson(
  String str,
) => ComponentNotificationDelivery.fromJson(json.decode(str));

String componentNotificationDeliveryToJson(
  ComponentNotificationDelivery data,
) => json.encode(data.toJson());

ComponentNotificationPage componentNotificationPageFromJson(String str) =>
    ComponentNotificationPage.fromJson(json.decode(str));

String componentNotificationPageToJson(ComponentNotificationPage data) =>
    json.encode(data.toJson());

ComponentNotificationReadRequest componentNotificationReadRequestFromJson(
  String str,
) => ComponentNotificationReadRequest.fromJson(json.decode(str));

String componentNotificationReadRequestToJson(
  ComponentNotificationReadRequest data,
) => json.encode(data.toJson());

ComponentNotificationReceipt componentNotificationReceiptFromJson(String str) =>
    ComponentNotificationReceipt.fromJson(json.decode(str));

String componentNotificationReceiptToJson(ComponentNotificationReceipt data) =>
    json.encode(data.toJson());

ComponentNotificationView componentNotificationViewFromJson(String str) =>
    ComponentNotificationView.fromJson(json.decode(str));

String componentNotificationViewToJson(ComponentNotificationView data) =>
    json.encode(data.toJson());

ComponentReleaseApprovalReport componentReleaseApprovalReportFromJson(
  String str,
) => ComponentReleaseApprovalReport.fromJson(json.decode(str));

String componentReleaseApprovalReportToJson(
  ComponentReleaseApprovalReport data,
) => json.encode(data.toJson());

ComponentReleasePage componentReleasePageFromJson(String str) =>
    ComponentReleasePage.fromJson(json.decode(str));

String componentReleasePageToJson(ComponentReleasePage data) =>
    json.encode(data.toJson());

ComponentReleaseReceipt componentReleaseReceiptFromJson(String str) =>
    ComponentReleaseReceipt.fromJson(json.decode(str));

String componentReleaseReceiptToJson(ComponentReleaseReceipt data) =>
    json.encode(data.toJson());

ComponentSearchPage componentSearchPageFromJson(String str) =>
    ComponentSearchPage.fromJson(json.decode(str));

String componentSearchPageToJson(ComponentSearchPage data) =>
    json.encode(data.toJson());

ComponentSearchQuery componentSearchQueryFromJson(String str) =>
    ComponentSearchQuery.fromJson(json.decode(str));

String componentSearchQueryToJson(ComponentSearchQuery data) =>
    json.encode(data.toJson());

ConversationOpenRequest conversationOpenRequestFromJson(String str) =>
    ConversationOpenRequest.fromJson(json.decode(str));

String conversationOpenRequestToJson(ConversationOpenRequest data) =>
    json.encode(data.toJson());

ConversationPage conversationPageFromJson(String str) =>
    ConversationPage.fromJson(json.decode(str));

String conversationPageToJson(ConversationPage data) =>
    json.encode(data.toJson());

ConversationParticipant conversationParticipantFromJson(String str) =>
    ConversationParticipant.fromJson(json.decode(str));

String conversationParticipantToJson(ConversationParticipant data) =>
    json.encode(data.toJson());

ConversationParticipantPage conversationParticipantPageFromJson(String str) =>
    ConversationParticipantPage.fromJson(json.decode(str));

String conversationParticipantPageToJson(ConversationParticipantPage data) =>
    json.encode(data.toJson());

ConversationPreferenceRequest conversationPreferenceRequestFromJson(
  String str,
) => ConversationPreferenceRequest.fromJson(json.decode(str));

String conversationPreferenceRequestToJson(
  ConversationPreferenceRequest data,
) => json.encode(data.toJson());

ConversationView conversationViewFromJson(String str) =>
    ConversationView.fromJson(json.decode(str));

String conversationViewToJson(ConversationView data) =>
    json.encode(data.toJson());

DelegatedActionMetadataV1 delegatedActionMetadataV1FromJson(String str) =>
    DelegatedActionMetadataV1.fromJson(json.decode(str));

String delegatedActionMetadataV1ToJson(DelegatedActionMetadataV1 data) =>
    json.encode(data.toJson());

DiscoverableWorkspace discoverableWorkspaceFromJson(String str) =>
    DiscoverableWorkspace.fromJson(json.decode(str));

String discoverableWorkspaceToJson(DiscoverableWorkspace data) =>
    json.encode(data.toJson());

DiscoverableWorkspacePage discoverableWorkspacePageFromJson(String str) =>
    DiscoverableWorkspacePage.fromJson(json.decode(str));

String discoverableWorkspacePageToJson(DiscoverableWorkspacePage data) =>
    json.encode(data.toJson());

EvidenceView evidenceViewFromJson(String str) =>
    EvidenceView.fromJson(json.decode(str));

String evidenceViewToJson(EvidenceView data) => json.encode(data.toJson());

ExportPackageView exportPackageViewFromJson(String str) =>
    ExportPackageView.fromJson(json.decode(str));

String exportPackageViewToJson(ExportPackageView data) =>
    json.encode(data.toJson());

FollowedPrincipalRequest followedPrincipalRequestFromJson(String str) =>
    FollowedPrincipalRequest.fromJson(json.decode(str));

String followedPrincipalRequestToJson(FollowedPrincipalRequest data) =>
    json.encode(data.toJson());

GatewayAccess gatewayAccessFromJson(String str) =>
    GatewayAccess.fromJson(json.decode(str));

String gatewayAccessToJson(GatewayAccess data) => json.encode(data.toJson());

GatewayCallDetail gatewayCallDetailFromJson(String str) =>
    GatewayCallDetail.fromJson(json.decode(str));

String gatewayCallDetailToJson(GatewayCallDetail data) =>
    json.encode(data.toJson());

GatewayCallPage gatewayCallPageFromJson(String str) =>
    GatewayCallPage.fromJson(json.decode(str));

String gatewayCallPageToJson(GatewayCallPage data) =>
    json.encode(data.toJson());

GatewayCallView gatewayCallViewFromJson(String str) =>
    GatewayCallView.fromJson(json.decode(str));

String gatewayCallViewToJson(GatewayCallView data) =>
    json.encode(data.toJson());

GatewayConfigHistory gatewayConfigHistoryFromJson(String str) =>
    GatewayConfigHistory.fromJson(json.decode(str));

String gatewayConfigHistoryToJson(GatewayConfigHistory data) =>
    json.encode(data.toJson());

GatewayConfigView gatewayConfigViewFromJson(String str) =>
    GatewayConfigView.fromJson(json.decode(str));

String gatewayConfigViewToJson(GatewayConfigView data) =>
    json.encode(data.toJson());

GatewayMcpBindingDraft gatewayMcpBindingDraftFromJson(String str) =>
    GatewayMcpBindingDraft.fromJson(json.decode(str));

String gatewayMcpBindingDraftToJson(GatewayMcpBindingDraft data) =>
    json.encode(data.toJson());

GatewayMcpBindingDraftRequest gatewayMcpBindingDraftRequestFromJson(
  String str,
) => GatewayMcpBindingDraftRequest.fromJson(json.decode(str));

String gatewayMcpBindingDraftRequestToJson(
  GatewayMcpBindingDraftRequest data,
) => json.encode(data.toJson());

GatewayMcpBindingFact gatewayMcpBindingFactFromJson(String str) =>
    GatewayMcpBindingFact.fromJson(json.decode(str));

String gatewayMcpBindingFactToJson(GatewayMcpBindingFact data) =>
    json.encode(data.toJson());

GatewayMcpPeerPage gatewayMcpPeerPageFromJson(String str) =>
    GatewayMcpPeerPage.fromJson(json.decode(str));

String gatewayMcpPeerPageToJson(GatewayMcpPeerPage data) =>
    json.encode(data.toJson());

GatewayMcpProbeRequest gatewayMcpProbeRequestFromJson(String str) =>
    GatewayMcpProbeRequest.fromJson(json.decode(str));

String gatewayMcpProbeRequestToJson(GatewayMcpProbeRequest data) =>
    json.encode(data.toJson());

GatewayMcpProbeResult gatewayMcpProbeResultFromJson(String str) =>
    GatewayMcpProbeResult.fromJson(json.decode(str));

String gatewayMcpProbeResultToJson(GatewayMcpProbeResult data) =>
    json.encode(data.toJson());

GatewayMcpReleasePage gatewayMcpReleasePageFromJson(String str) =>
    GatewayMcpReleasePage.fromJson(json.decode(str));

String gatewayMcpReleasePageToJson(GatewayMcpReleasePage data) =>
    json.encode(data.toJson());

GatewayModelRoutePage gatewayModelRoutePageFromJson(String str) =>
    GatewayModelRoutePage.fromJson(json.decode(str));

String gatewayModelRoutePageToJson(GatewayModelRoutePage data) =>
    json.encode(data.toJson());

GatewayModelSourcePage gatewayModelSourcePageFromJson(String str) =>
    GatewayModelSourcePage.fromJson(json.decode(str));

String gatewayModelSourcePageToJson(GatewayModelSourcePage data) =>
    json.encode(data.toJson());

GatewayStats gatewayStatsFromJson(String str) =>
    GatewayStats.fromJson(json.decode(str));

String gatewayStatsToJson(GatewayStats data) => json.encode(data.toJson());

GatewayStatsCounters gatewayStatsCountersFromJson(String str) =>
    GatewayStatsCounters.fromJson(json.decode(str));

String gatewayStatsCountersToJson(GatewayStatsCounters data) =>
    json.encode(data.toJson());

GatewayToolPage gatewayToolPageFromJson(String str) =>
    GatewayToolPage.fromJson(json.decode(str));

String gatewayToolPageToJson(GatewayToolPage data) =>
    json.encode(data.toJson());

GatewayToolTestCallResult gatewayToolTestCallResultFromJson(String str) =>
    GatewayToolTestCallResult.fromJson(json.decode(str));

String gatewayToolTestCallResultToJson(GatewayToolTestCallResult data) =>
    json.encode(data.toJson());

HuddleAnnouncementView huddleAnnouncementViewFromJson(String str) =>
    HuddleAnnouncementView.fromJson(json.decode(str));

String huddleAnnouncementViewToJson(HuddleAnnouncementView data) =>
    json.encode(data.toJson());

HuddleLifecycleEvent huddleLifecycleEventFromJson(String str) =>
    HuddleLifecycleEvent.fromJson(json.decode(str));

String huddleLifecycleEventToJson(HuddleLifecycleEvent data) =>
    json.encode(data.toJson());

HuddleLifecyclePage huddleLifecyclePageFromJson(String str) =>
    HuddleLifecyclePage.fromJson(json.decode(str));

String huddleLifecyclePageToJson(HuddleLifecyclePage data) =>
    json.encode(data.toJson());

HuddlePage huddlePageFromJson(String str) =>
    HuddlePage.fromJson(json.decode(str));

String huddlePageToJson(HuddlePage data) => json.encode(data.toJson());

HuddleView huddleViewFromJson(String str) =>
    HuddleView.fromJson(json.decode(str));

String huddleViewToJson(HuddleView data) => json.encode(data.toJson());

HuddleVoiceView huddleVoiceViewFromJson(String str) =>
    HuddleVoiceView.fromJson(json.decode(str));

String huddleVoiceViewToJson(HuddleVoiceView data) =>
    json.encode(data.toJson());

InvitationRedemptionView invitationRedemptionViewFromJson(String str) =>
    InvitationRedemptionView.fromJson(json.decode(str));

String invitationRedemptionViewToJson(InvitationRedemptionView data) =>
    json.encode(data.toJson());

InvitationRedemptionRequest invitationRedemptionRequestFromJson(String str) =>
    InvitationRedemptionRequest.fromJson(json.decode(str));

String invitationRedemptionRequestToJson(InvitationRedemptionRequest data) =>
    json.encode(data.toJson());

IssuedInvitation issuedInvitationFromJson(String str) =>
    IssuedInvitation.fromJson(json.decode(str));

String issuedInvitationToJson(IssuedInvitation data) =>
    json.encode(data.toJson());

LegacySecretRefPage legacySecretRefPageFromJson(String str) =>
    LegacySecretRefPage.fromJson(json.decode(str));

String legacySecretRefPageToJson(LegacySecretRefPage data) =>
    json.encode(data.toJson());

McpConnectionPage mcpConnectionPageFromJson(String str) =>
    McpConnectionPage.fromJson(json.decode(str));

String mcpConnectionPageToJson(McpConnectionPage data) =>
    json.encode(data.toJson());

McpConnectionPolicyView mcpConnectionPolicyViewFromJson(String str) =>
    McpConnectionPolicyView.fromJson(json.decode(str));

String mcpConnectionPolicyViewToJson(McpConnectionPolicyView data) =>
    json.encode(data.toJson());

McpConnectionProbeRequest mcpConnectionProbeRequestFromJson(String str) =>
    McpConnectionProbeRequest.fromJson(json.decode(str));

String mcpConnectionProbeRequestToJson(McpConnectionProbeRequest data) =>
    json.encode(data.toJson());

McpConnectionProbeResult mcpConnectionProbeResultFromJson(String str) =>
    McpConnectionProbeResult.fromJson(json.decode(str));

String mcpConnectionProbeResultToJson(McpConnectionProbeResult data) =>
    json.encode(data.toJson());

McpConnectionRefreshResult mcpConnectionRefreshResultFromJson(String str) =>
    McpConnectionRefreshResult.fromJson(json.decode(str));

String mcpConnectionRefreshResultToJson(McpConnectionRefreshResult data) =>
    json.encode(data.toJson());

McpConnectionToolView mcpConnectionToolViewFromJson(String str) =>
    McpConnectionToolView.fromJson(json.decode(str));

String mcpConnectionToolViewToJson(McpConnectionToolView data) =>
    json.encode(data.toJson());

McpConnectionView mcpConnectionViewFromJson(String str) =>
    McpConnectionView.fromJson(json.decode(str));

String mcpConnectionViewToJson(McpConnectionView data) =>
    json.encode(data.toJson());

McpOauthAttemptView mcpOauthAttemptViewFromJson(String str) =>
    McpOauthAttemptView.fromJson(json.decode(str));

String mcpOauthAttemptViewToJson(McpOauthAttemptView data) =>
    json.encode(data.toJson());

McpOauthStartRequest mcpOauthStartRequestFromJson(String str) =>
    McpOauthStartRequest.fromJson(json.decode(str));

String mcpOauthStartRequestToJson(McpOauthStartRequest data) =>
    json.encode(data.toJson());

McpProbedTool mcpProbedToolFromJson(String str) =>
    McpProbedTool.fromJson(json.decode(str));

String mcpProbedToolToJson(McpProbedTool data) => json.encode(data.toJson());

ModerationAccessView moderationAccessViewFromJson(String str) =>
    ModerationAccessView.fromJson(json.decode(str));

String moderationAccessViewToJson(ModerationAccessView data) =>
    json.encode(data.toJson());

ModerationAuditPage moderationAuditPageFromJson(String str) =>
    ModerationAuditPage.fromJson(json.decode(str));

String moderationAuditPageToJson(ModerationAuditPage data) =>
    json.encode(data.toJson());

ModerationReportPage moderationReportPageFromJson(String str) =>
    ModerationReportPage.fromJson(json.decode(str));

String moderationReportPageToJson(ModerationReportPage data) =>
    json.encode(data.toJson());

ModerationRestrictionPage moderationRestrictionPageFromJson(String str) =>
    ModerationRestrictionPage.fromJson(json.decode(str));

String moderationRestrictionPageToJson(ModerationRestrictionPage data) =>
    json.encode(data.toJson());

NativeCommunityFacts nativeCommunityFactsFromJson(String str) =>
    NativeCommunityFacts.fromJson(json.decode(str));

String nativeCommunityFactsToJson(NativeCommunityFacts data) =>
    json.encode(data.toJson());

NativeHumanActionRequest nativeHumanActionRequestFromJson(String str) =>
    NativeHumanActionRequest.fromJson(json.decode(str));

String nativeHumanActionRequestToJson(NativeHumanActionRequest data) =>
    json.encode(data.toJson());

NativeHumanActionResult nativeHumanActionResultFromJson(String str) =>
    NativeHumanActionResult.fromJson(json.decode(str));

String nativeHumanActionResultToJson(NativeHumanActionResult data) =>
    json.encode(data.toJson());

NativeHumanReadReceipt nativeHumanReadReceiptFromJson(String str) =>
    NativeHumanReadReceipt.fromJson(json.decode(str));

String nativeHumanReadReceiptToJson(NativeHumanReadReceipt data) =>
    json.encode(data.toJson());

NativeHumanResourceResult nativeHumanResourceResultFromJson(String str) =>
    NativeHumanResourceResult.fromJson(json.decode(str));

String nativeHumanResourceResultToJson(NativeHumanResourceResult data) =>
    json.encode(data.toJson());

NativeHumanScopeResult nativeHumanScopeResultFromJson(String str) =>
    NativeHumanScopeResult.fromJson(json.decode(str));

String nativeHumanScopeResultToJson(NativeHumanScopeResult data) =>
    json.encode(data.toJson());

OperationUsageCount operationUsageCountFromJson(String str) =>
    OperationUsageCount.fromJson(json.decode(str));

String operationUsageCountToJson(OperationUsageCount data) =>
    json.encode(data.toJson());

OwnAuditEntry ownAuditEntryFromJson(String str) =>
    OwnAuditEntry.fromJson(json.decode(str));

String ownAuditEntryToJson(OwnAuditEntry data) => json.encode(data.toJson());

PlatformInfo platformInfoFromJson(String str) =>
    PlatformInfo.fromJson(json.decode(str));

String platformInfoToJson(PlatformInfo data) => json.encode(data.toJson());

PlatformTenantPage platformTenantPageFromJson(String str) =>
    PlatformTenantPage.fromJson(json.decode(str));

String platformTenantPageToJson(PlatformTenantPage data) =>
    json.encode(data.toJson());

PlatformToolPage platformToolPageFromJson(String str) =>
    PlatformToolPage.fromJson(json.decode(str));

String platformToolPageToJson(PlatformToolPage data) =>
    json.encode(data.toJson());

PlatformToolView platformToolViewFromJson(String str) =>
    PlatformToolView.fromJson(json.decode(str));

String platformToolViewToJson(PlatformToolView data) =>
    json.encode(data.toJson());

ProjectChannelRequest projectChannelRequestFromJson(String str) =>
    ProjectChannelRequest.fromJson(json.decode(str));

String projectChannelRequestToJson(ProjectChannelRequest data) =>
    json.encode(data.toJson());

ProjectChannelRequestApprovalView projectChannelRequestApprovalViewFromJson(
  String str,
) => ProjectChannelRequestApprovalView.fromJson(json.decode(str));

String projectChannelRequestApprovalViewToJson(
  ProjectChannelRequestApprovalView data,
) => json.encode(data.toJson());

ProjectPreferenceRequest projectPreferenceRequestFromJson(String str) =>
    ProjectPreferenceRequest.fromJson(json.decode(str));

String projectPreferenceRequestToJson(ProjectPreferenceRequest data) =>
    json.encode(data.toJson());

ProjectsGitMergeRequest projectsGitMergeRequestFromJson(String str) =>
    ProjectsGitMergeRequest.fromJson(json.decode(str));

String projectsGitMergeRequestToJson(ProjectsGitMergeRequest data) =>
    json.encode(data.toJson());

ProjectsGitMergeResponse projectsGitMergeResponseFromJson(String str) =>
    ProjectsGitMergeResponse.fromJson(json.decode(str));

String projectsGitMergeResponseToJson(ProjectsGitMergeResponse data) =>
    json.encode(data.toJson());

ProjectsGitQueryRequest projectsGitQueryRequestFromJson(String str) =>
    ProjectsGitQueryRequest.fromJson(json.decode(str));

String projectsGitQueryRequestToJson(ProjectsGitQueryRequest data) =>
    json.encode(data.toJson());

ProjectsGitQueryResponse projectsGitQueryResponseFromJson(String str) =>
    ProjectsGitQueryResponse.fromJson(json.decode(str));

String projectsGitQueryResponseToJson(ProjectsGitQueryResponse data) =>
    json.encode(data.toJson());

ProjectsGitRefRequest projectsGitRefRequestFromJson(String str) =>
    ProjectsGitRefRequest.fromJson(json.decode(str));

String projectsGitRefRequestToJson(ProjectsGitRefRequest data) =>
    json.encode(data.toJson());

ProjectsGitRefResponse projectsGitRefResponseFromJson(String str) =>
    ProjectsGitRefResponse.fromJson(json.decode(str));

String projectsGitRefResponseToJson(ProjectsGitRefResponse data) =>
    json.encode(data.toJson());

ProjectsPublishRequest projectsPublishRequestFromJson(String str) =>
    ProjectsPublishRequest.fromJson(json.decode(str));

String projectsPublishRequestToJson(ProjectsPublishRequest data) =>
    json.encode(data.toJson());

ProjectsQueryRequest projectsQueryRequestFromJson(String str) =>
    ProjectsQueryRequest.fromJson(json.decode(str));

String projectsQueryRequestToJson(ProjectsQueryRequest data) =>
    json.encode(data.toJson());

ProtocolSessionView protocolSessionViewFromJson(String str) =>
    ProtocolSessionView.fromJson(json.decode(str));

String protocolSessionViewToJson(ProtocolSessionView data) =>
    json.encode(data.toJson());

PulsePublishRequest pulsePublishRequestFromJson(String str) =>
    PulsePublishRequest.fromJson(json.decode(str));

String pulsePublishRequestToJson(PulsePublishRequest data) =>
    json.encode(data.toJson());

PulseQueryRequest pulseQueryRequestFromJson(String str) =>
    PulseQueryRequest.fromJson(json.decode(str));

String pulseQueryRequestToJson(PulseQueryRequest data) =>
    json.encode(data.toJson());

ReadMarkRequest readMarkRequestFromJson(String str) =>
    ReadMarkRequest.fromJson(json.decode(str));

String readMarkRequestToJson(ReadMarkRequest data) =>
    json.encode(data.toJson());

ReminderPublishRequest reminderPublishRequestFromJson(String str) =>
    ReminderPublishRequest.fromJson(json.decode(str));

String reminderPublishRequestToJson(ReminderPublishRequest data) =>
    json.encode(data.toJson());

ReminderSourceRequest reminderSourceRequestFromJson(String str) =>
    ReminderSourceRequest.fromJson(json.decode(str));

String reminderSourceRequestToJson(ReminderSourceRequest data) =>
    json.encode(data.toJson());

ReminderView reminderViewFromJson(String str) =>
    ReminderView.fromJson(json.decode(str));

String reminderViewToJson(ReminderView data) => json.encode(data.toJson());

RoleMemberPage roleMemberPageFromJson(String str) =>
    RoleMemberPage.fromJson(json.decode(str));

String roleMemberPageToJson(RoleMemberPage data) => json.encode(data.toJson());

RoleWorkspacePage roleWorkspacePageFromJson(String str) =>
    RoleWorkspacePage.fromJson(json.decode(str));

String roleWorkspacePageToJson(RoleWorkspacePage data) =>
    json.encode(data.toJson());

PlatformSessionView platformSessionViewFromJson(String str) =>
    PlatformSessionView.fromJson(json.decode(str));

String platformSessionViewToJson(PlatformSessionView data) =>
    json.encode(data.toJson());

SidebarAssignmentRequest sidebarAssignmentRequestFromJson(String str) =>
    SidebarAssignmentRequest.fromJson(json.decode(str));

String sidebarAssignmentRequestToJson(SidebarAssignmentRequest data) =>
    json.encode(data.toJson());

SidebarSectionRequest sidebarSectionRequestFromJson(String str) =>
    SidebarSectionRequest.fromJson(json.decode(str));

String sidebarSectionRequestToJson(SidebarSectionRequest data) =>
    json.encode(data.toJson());

SidebarSectionOrderRequest sidebarSectionOrderRequestFromJson(String str) =>
    SidebarSectionOrderRequest.fromJson(json.decode(str));

String sidebarSectionOrderRequestToJson(SidebarSectionOrderRequest data) =>
    json.encode(data.toJson());

SidebarSortRequest sidebarSortRequestFromJson(String str) =>
    SidebarSortRequest.fromJson(json.decode(str));

String sidebarSortRequestToJson(SidebarSortRequest data) =>
    json.encode(data.toJson());

SkillArtifactUploadRequest skillArtifactUploadRequestFromJson(String str) =>
    SkillArtifactUploadRequest.fromJson(json.decode(str));

String skillArtifactUploadRequestToJson(SkillArtifactUploadRequest data) =>
    json.encode(data.toJson());

SkillArtifactUploadView skillArtifactUploadViewFromJson(String str) =>
    SkillArtifactUploadView.fromJson(json.decode(str));

String skillArtifactUploadViewToJson(SkillArtifactUploadView data) =>
    json.encode(data.toJson());

SkillArtifactViolation skillArtifactViolationFromJson(String str) =>
    SkillArtifactViolation.fromJson(json.decode(str));

String skillArtifactViolationToJson(SkillArtifactViolation data) =>
    json.encode(data.toJson());

SkillDefinitionPage skillDefinitionPageFromJson(String str) =>
    SkillDefinitionPage.fromJson(json.decode(str));

String skillDefinitionPageToJson(SkillDefinitionPage data) =>
    json.encode(data.toJson());

SkillDefinitionView skillDefinitionViewFromJson(String str) =>
    SkillDefinitionView.fromJson(json.decode(str));

String skillDefinitionViewToJson(SkillDefinitionView data) =>
    json.encode(data.toJson());

SkillReferencePage skillReferencePageFromJson(String str) =>
    SkillReferencePage.fromJson(json.decode(str));

String skillReferencePageToJson(SkillReferencePage data) =>
    json.encode(data.toJson());

SkillVersionContentView skillVersionContentViewFromJson(String str) =>
    SkillVersionContentView.fromJson(json.decode(str));

String skillVersionContentViewToJson(SkillVersionContentView data) =>
    json.encode(data.toJson());

SkillVersionPage skillVersionPageFromJson(String str) =>
    SkillVersionPage.fromJson(json.decode(str));

String skillVersionPageToJson(SkillVersionPage data) =>
    json.encode(data.toJson());

SkillVersionView skillVersionViewFromJson(String str) =>
    SkillVersionView.fromJson(json.decode(str));

String skillVersionViewToJson(SkillVersionView data) =>
    json.encode(data.toJson());

TaskView taskViewFromJson(String str) => TaskView.fromJson(json.decode(str));

String taskViewToJson(TaskView data) => json.encode(data.toJson());

TenantInvitationView tenantInvitationViewFromJson(String str) =>
    TenantInvitationView.fromJson(json.decode(str));

String tenantInvitationViewToJson(TenantInvitationView data) =>
    json.encode(data.toJson());

TenantMemberJoinPage tenantMemberJoinPageFromJson(String str) =>
    TenantMemberJoinPage.fromJson(json.decode(str));

String tenantMemberJoinPageToJson(TenantMemberJoinPage data) =>
    json.encode(data.toJson());

TenantMemberJoinView tenantMemberJoinViewFromJson(String str) =>
    TenantMemberJoinView.fromJson(json.decode(str));

String tenantMemberJoinViewToJson(TenantMemberJoinView data) =>
    json.encode(data.toJson());

TenantQuotaPage tenantQuotaPageFromJson(String str) =>
    TenantQuotaPage.fromJson(json.decode(str));

String tenantQuotaPageToJson(TenantQuotaPage data) =>
    json.encode(data.toJson());

ThreadPreferenceRequest threadPreferenceRequestFromJson(String str) =>
    ThreadPreferenceRequest.fromJson(json.decode(str));

String threadPreferenceRequestToJson(ThreadPreferenceRequest data) =>
    json.encode(data.toJson());

UsageBillingView usageBillingViewFromJson(String str) =>
    UsageBillingView.fromJson(json.decode(str));

String usageBillingViewToJson(UsageBillingView data) =>
    json.encode(data.toJson());

UserStateVersion userStateVersionFromJson(String str) =>
    UserStateVersion.fromJson(json.decode(str));

String userStateVersionToJson(UserStateVersion data) =>
    json.encode(data.toJson());

WebChannelCanvasView webChannelCanvasViewFromJson(String str) =>
    WebChannelCanvasView.fromJson(json.decode(str));

String webChannelCanvasViewToJson(WebChannelCanvasView data) =>
    json.encode(data.toJson());

WebChannelView webChannelViewFromJson(String str) =>
    WebChannelView.fromJson(json.decode(str));

String webChannelViewToJson(WebChannelView data) => json.encode(data.toJson());

WebCustomEmojiMutation webCustomEmojiMutationFromJson(String str) =>
    WebCustomEmojiMutation.fromJson(json.decode(str));

String webCustomEmojiMutationToJson(WebCustomEmojiMutation data) =>
    json.encode(data.toJson());

WebCustomEmojiView webCustomEmojiViewFromJson(String str) =>
    WebCustomEmojiView.fromJson(json.decode(str));

String webCustomEmojiViewToJson(WebCustomEmojiView data) =>
    json.encode(data.toJson());

WebGifCapabilityView webGifCapabilityViewFromJson(String str) =>
    WebGifCapabilityView.fromJson(json.decode(str));

String webGifCapabilityViewToJson(WebGifCapabilityView data) =>
    json.encode(data.toJson());

WebGifItem webGifItemFromJson(String str) =>
    WebGifItem.fromJson(json.decode(str));

String webGifItemToJson(WebGifItem data) => json.encode(data.toJson());

WebGifSearchRequest webGifSearchRequestFromJson(String str) =>
    WebGifSearchRequest.fromJson(json.decode(str));

String webGifSearchRequestToJson(WebGifSearchRequest data) =>
    json.encode(data.toJson());

WebGifSearchView webGifSearchViewFromJson(String str) =>
    WebGifSearchView.fromJson(json.decode(str));

String webGifSearchViewToJson(WebGifSearchView data) =>
    json.encode(data.toJson());

WebGifShareRequest webGifShareRequestFromJson(String str) =>
    WebGifShareRequest.fromJson(json.decode(str));

String webGifShareRequestToJson(WebGifShareRequest data) =>
    json.encode(data.toJson());

WebInboxQuery webInboxQueryFromJson(String str) =>
    WebInboxQuery.fromJson(json.decode(str));

String webInboxQueryToJson(WebInboxQuery data) => json.encode(data.toJson());

WebLinkPreviewRequest webLinkPreviewRequestFromJson(String str) =>
    WebLinkPreviewRequest.fromJson(json.decode(str));

String webLinkPreviewRequestToJson(WebLinkPreviewRequest data) =>
    json.encode(data.toJson());

WebLinkPreviewSnapshotView webLinkPreviewSnapshotViewFromJson(String str) =>
    WebLinkPreviewSnapshotView.fromJson(json.decode(str));

String webLinkPreviewSnapshotViewToJson(WebLinkPreviewSnapshotView data) =>
    json.encode(data.toJson());

WebMessageAttachment webMessageAttachmentFromJson(String str) =>
    WebMessageAttachment.fromJson(json.decode(str));

String webMessageAttachmentToJson(WebMessageAttachment data) =>
    json.encode(data.toJson());

WebMessageAuthorQuery webMessageAuthorQueryFromJson(String str) =>
    WebMessageAuthorQuery.fromJson(json.decode(str));

String webMessageAuthorQueryToJson(WebMessageAuthorQuery data) =>
    json.encode(data.toJson());

WebMessageAuthorView webMessageAuthorViewFromJson(String str) =>
    WebMessageAuthorView.fromJson(json.decode(str));

String webMessageAuthorViewToJson(WebMessageAuthorView data) =>
    json.encode(data.toJson());

WebMessageCursor webMessageCursorFromJson(String str) =>
    WebMessageCursor.fromJson(json.decode(str));

String webMessageCursorToJson(WebMessageCursor data) =>
    json.encode(data.toJson());

WebMessageQuery webMessageQueryFromJson(String str) =>
    WebMessageQuery.fromJson(json.decode(str));

String webMessageQueryToJson(WebMessageQuery data) =>
    json.encode(data.toJson());

WebMessageType webMessageTypeFromJson(String str) =>
    webMessageTypeValues.map[json.decode(str)]!;

String webMessageTypeToJson(WebMessageType data) =>
    json.encode(webMessageTypeValues.reverse[data]);

WebPresencePage webPresencePageFromJson(String str) =>
    WebPresencePage.fromJson(json.decode(str));

String webPresencePageToJson(WebPresencePage data) =>
    json.encode(data.toJson());

WebPresenceQueryRequest webPresenceQueryRequestFromJson(String str) =>
    WebPresenceQueryRequest.fromJson(json.decode(str));

String webPresenceQueryRequestToJson(WebPresenceQueryRequest data) =>
    json.encode(data.toJson());

WebPresenceUpdateRequest webPresenceUpdateRequestFromJson(String str) =>
    WebPresenceUpdateRequest.fromJson(json.decode(str));

String webPresenceUpdateRequestToJson(WebPresenceUpdateRequest data) =>
    json.encode(data.toJson());

WebProfileUpdateRequest webProfileUpdateRequestFromJson(String str) =>
    WebProfileUpdateRequest.fromJson(json.decode(str));

String webProfileUpdateRequestToJson(WebProfileUpdateRequest data) =>
    json.encode(data.toJson());

WebProfileView webProfileViewFromJson(String str) =>
    WebProfileView.fromJson(json.decode(str));

String webProfileViewToJson(WebProfileView data) => json.encode(data.toJson());

WebPublishMessageRequest webPublishMessageRequestFromJson(String str) =>
    WebPublishMessageRequest.fromJson(json.decode(str));

String webPublishMessageRequestToJson(WebPublishMessageRequest data) =>
    json.encode(data.toJson());

WebPublishTopicRequest webPublishTopicRequestFromJson(String str) =>
    WebPublishTopicRequest.fromJson(json.decode(str));

String webPublishTopicRequestToJson(WebPublishTopicRequest data) =>
    json.encode(data.toJson());

WebSearchQuery webSearchQueryFromJson(String str) =>
    WebSearchQuery.fromJson(json.decode(str));

String webSearchQueryToJson(WebSearchQuery data) => json.encode(data.toJson());

WebTypingRequest webTypingRequestFromJson(String str) =>
    WebTypingRequest.fromJson(json.decode(str));

String webTypingRequestToJson(WebTypingRequest data) =>
    json.encode(data.toJson());

WebUserStatusPage webUserStatusPageFromJson(String str) =>
    WebUserStatusPage.fromJson(json.decode(str));

String webUserStatusPageToJson(WebUserStatusPage data) =>
    json.encode(data.toJson());

WebUserStatusQueryRequest webUserStatusQueryRequestFromJson(String str) =>
    WebUserStatusQueryRequest.fromJson(json.decode(str));

String webUserStatusQueryRequestToJson(WebUserStatusQueryRequest data) =>
    json.encode(data.toJson());

WebUserStatusUpdateRequest webUserStatusUpdateRequestFromJson(String str) =>
    WebUserStatusUpdateRequest.fromJson(json.decode(str));

String webUserStatusUpdateRequestToJson(WebUserStatusUpdateRequest data) =>
    json.encode(data.toJson());

WebWorkspaceActivityPage webWorkspaceActivityPageFromJson(String str) =>
    WebWorkspaceActivityPage.fromJson(json.decode(str));

String webWorkspaceActivityPageToJson(WebWorkspaceActivityPage data) =>
    json.encode(data.toJson());

WebWorkspaceActivityQuery webWorkspaceActivityQueryFromJson(String str) =>
    WebWorkspaceActivityQuery.fromJson(json.decode(str));

String webWorkspaceActivityQueryToJson(WebWorkspaceActivityQuery data) =>
    json.encode(data.toJson());

WorkspaceView workspaceViewFromJson(String str) =>
    WorkspaceView.fromJson(json.decode(str));

String workspaceViewToJson(WorkspaceView data) => json.encode(data.toJson());

WorkspaceMemberView workspaceMemberViewFromJson(String str) =>
    WorkspaceMemberView.fromJson(json.decode(str));

String workspaceMemberViewToJson(WorkspaceMemberView data) =>
    json.encode(data.toJson());

WorkspacePreferenceRequest workspacePreferenceRequestFromJson(String str) =>
    WorkspacePreferenceRequest.fromJson(json.decode(str));

String workspacePreferenceRequestToJson(WorkspacePreferenceRequest data) =>
    json.encode(data.toJson());

ActionTokenSigningDelivery actionTokenSigningDeliveryFromJson(String str) =>
    ActionTokenSigningDelivery.fromJson(json.decode(str));

String actionTokenSigningDeliveryToJson(ActionTokenSigningDelivery data) =>
    json.encode(data.toJson());

AgentDefinitionExportInput agentDefinitionExportInputFromJson(String str) =>
    AgentDefinitionExportInput.fromJson(json.decode(str));

String agentDefinitionExportInputToJson(AgentDefinitionExportInput data) =>
    json.encode(data.toJson());

AgentDefinitionImportInput agentDefinitionImportInputFromJson(String str) =>
    AgentDefinitionImportInput.fromJson(json.decode(str));

String agentDefinitionImportInputToJson(AgentDefinitionImportInput data) =>
    json.encode(data.toJson());

AgentMemoryEntryListInput agentMemoryEntryListInputFromJson(String str) =>
    AgentMemoryEntryListInput.fromJson(json.decode(str));

String agentMemoryEntryListInputToJson(AgentMemoryEntryListInput data) =>
    json.encode(data.toJson());

AgentMemoryEntryReadInput agentMemoryEntryReadInputFromJson(String str) =>
    AgentMemoryEntryReadInput.fromJson(json.decode(str));

String agentMemoryEntryReadInputToJson(AgentMemoryEntryReadInput data) =>
    json.encode(data.toJson());

AgentMemoryWriteInput agentMemoryWriteInputFromJson(String str) =>
    AgentMemoryWriteInput.fromJson(json.decode(str));

String agentMemoryWriteInputToJson(AgentMemoryWriteInput data) =>
    json.encode(data.toJson());

AgentTeamExportInput agentTeamExportInputFromJson(String str) =>
    AgentTeamExportInput.fromJson(json.decode(str));

String agentTeamExportInputToJson(AgentTeamExportInput data) =>
    json.encode(data.toJson());

AgentTeamImportInput agentTeamImportInputFromJson(String str) =>
    AgentTeamImportInput.fromJson(json.decode(str));

String agentTeamImportInputToJson(AgentTeamImportInput data) =>
    json.encode(data.toJson());

AgentTeamInput agentTeamInputFromJson(String str) =>
    AgentTeamInput.fromJson(json.decode(str));

String agentTeamInputToJson(AgentTeamInput data) => json.encode(data.toJson());

AgentVersionContent agentVersionContentFromJson(String str) =>
    AgentVersionContent.fromJson(json.decode(str));

String agentVersionContentToJson(AgentVersionContent data) =>
    json.encode(data.toJson());

ApplicationAdapterDirectory applicationAdapterDirectoryFromJson(String str) =>
    ApplicationAdapterDirectory.fromJson(json.decode(str));

String applicationAdapterDirectoryToJson(ApplicationAdapterDirectory data) =>
    json.encode(data.toJson());

ApplicationBindingCreate applicationBindingCreateFromJson(String str) =>
    ApplicationBindingCreate.fromJson(json.decode(str));

String applicationBindingCreateToJson(ApplicationBindingCreate data) =>
    json.encode(data.toJson());

ApplicationModelGatewayConfig applicationModelGatewayConfigFromJson(
  String str,
) => ApplicationModelGatewayConfig.fromJson(json.decode(str));

String applicationModelGatewayConfigToJson(
  ApplicationModelGatewayConfig data,
) => json.encode(data.toJson());

AutomationApprovalPolicyRef automationApprovalPolicyRefFromJson(String str) =>
    AutomationApprovalPolicyRef.fromJson(json.decode(str));

String automationApprovalPolicyRefToJson(AutomationApprovalPolicyRef data) =>
    json.encode(data.toJson());

AutomationScheduleSpec automationScheduleSpecFromJson(String str) =>
    AutomationScheduleSpec.fromJson(json.decode(str));

String automationScheduleSpecToJson(AutomationScheduleSpec data) =>
    json.encode(data.toJson());

AutomationSecretRef automationSecretRefFromJson(String str) =>
    AutomationSecretRef.fromJson(json.decode(str));

String automationSecretRefToJson(AutomationSecretRef data) =>
    json.encode(data.toJson());

AutomationStep automationStepFromJson(String str) =>
    AutomationStep.fromJson(json.decode(str));

String automationStepToJson(AutomationStep data) => json.encode(data.toJson());

AutomationStepTrace automationStepTraceFromJson(String str) =>
    AutomationStepTrace.fromJson(json.decode(str));

String automationStepTraceToJson(AutomationStepTrace data) =>
    json.encode(data.toJson());

AutomationVersionContent automationVersionContentFromJson(String str) =>
    AutomationVersionContent.fromJson(json.decode(str));

String automationVersionContentToJson(AutomationVersionContent data) =>
    json.encode(data.toJson());

CapabilityConformanceVectors capabilityConformanceVectorsFromJson(String str) =>
    CapabilityConformanceVectors.fromJson(json.decode(str));

String capabilityConformanceVectorsToJson(CapabilityConformanceVectors data) =>
    json.encode(data.toJson());

CapabilityContractRef capabilityContractRefFromJson(String str) =>
    CapabilityContractRef.fromJson(json.decode(str));

String capabilityContractRefToJson(CapabilityContractRef data) =>
    json.encode(data.toJson());

CapabilityContractRegistration capabilityContractRegistrationFromJson(
  String str,
) => CapabilityContractRegistration.fromJson(json.decode(str));

String capabilityContractRegistrationToJson(
  CapabilityContractRegistration data,
) => json.encode(data.toJson());

CapabilityVectorBinding capabilityVectorBindingFromJson(String str) =>
    CapabilityVectorBinding.fromJson(json.decode(str));

String capabilityVectorBindingToJson(CapabilityVectorBinding data) =>
    json.encode(data.toJson());

CapabilityVectorCapture capabilityVectorCaptureFromJson(String str) =>
    CapabilityVectorCapture.fromJson(json.decode(str));

String capabilityVectorCaptureToJson(CapabilityVectorCapture data) =>
    json.encode(data.toJson());

ComponentActionInput componentActionInputFromJson(String str) =>
    ComponentActionInput.fromJson(json.decode(str));

String componentActionInputToJson(ComponentActionInput data) =>
    json.encode(data.toJson());

ComponentConformanceCaptureValue componentConformanceCaptureValueFromJson(
  String str,
) => ComponentConformanceCaptureValue.fromJson(json.decode(str));

String componentConformanceCaptureValueToJson(
  ComponentConformanceCaptureValue data,
) => json.encode(data.toJson());

ComponentConformanceEnvironment componentConformanceEnvironmentFromJson(
  String str,
) => ComponentConformanceEnvironment.fromJson(json.decode(str));

String componentConformanceEnvironmentToJson(
  ComponentConformanceEnvironment data,
) => json.encode(data.toJson());

ComponentConformanceFixture componentConformanceFixtureFromJson(String str) =>
    ComponentConformanceFixture.fromJson(json.decode(str));

String componentConformanceFixtureToJson(ComponentConformanceFixture data) =>
    json.encode(data.toJson());

ComponentConformanceIdentity componentConformanceIdentityFromJson(String str) =>
    ComponentConformanceIdentity.fromJson(json.decode(str));

String componentConformanceIdentityToJson(ComponentConformanceIdentity data) =>
    json.encode(data.toJson());

ComponentConformanceReceiverEnvironment
componentConformanceReceiverEnvironmentFromJson(String str) =>
    ComponentConformanceReceiverEnvironment.fromJson(json.decode(str));

String componentConformanceReceiverEnvironmentToJson(
  ComponentConformanceReceiverEnvironment data,
) => json.encode(data.toJson());

ComponentNativeReceiverObservation componentNativeReceiverObservationFromJson(
  String str,
) => ComponentNativeReceiverObservation.fromJson(json.decode(str));

String componentNativeReceiverObservationToJson(
  ComponentNativeReceiverObservation data,
) => json.encode(data.toJson());

ComponentNativeReceiverRequest componentNativeReceiverRequestFromJson(
  String str,
) => ComponentNativeReceiverRequest.fromJson(json.decode(str));

String componentNativeReceiverRequestToJson(
  ComponentNativeReceiverRequest data,
) => json.encode(data.toJson());

ComponentPersonRef componentPersonRefFromJson(String str) =>
    ComponentPersonRef.fromJson(json.decode(str));

String componentPersonRefToJson(ComponentPersonRef data) =>
    json.encode(data.toJson());

ComponentPreferenceDeclaration componentPreferenceDeclarationFromJson(
  String str,
) => ComponentPreferenceDeclaration.fromJson(json.decode(str));

String componentPreferenceDeclarationToJson(
  ComponentPreferenceDeclaration data,
) => json.encode(data.toJson());

ComponentProtocolPeerEnvironment componentProtocolPeerEnvironmentFromJson(
  String str,
) => ComponentProtocolPeerEnvironment.fromJson(json.decode(str));

String componentProtocolPeerEnvironmentToJson(
  ComponentProtocolPeerEnvironment data,
) => json.encode(data.toJson());

ComponentReleaseApprovalTarget componentReleaseApprovalTargetFromJson(
  String str,
) => ComponentReleaseApprovalTarget.fromJson(json.decode(str));

String componentReleaseApprovalTargetToJson(
  ComponentReleaseApprovalTarget data,
) => json.encode(data.toJson());

ComponentReleaseRegistration componentReleaseRegistrationFromJson(String str) =>
    ComponentReleaseRegistration.fromJson(json.decode(str));

String componentReleaseRegistrationToJson(ComponentReleaseRegistration data) =>
    json.encode(data.toJson());

ComponentText componentTextFromJson(String str) =>
    ComponentText.fromJson(json.decode(str));

String componentTextToJson(ComponentText data) => json.encode(data.toJson());

ContentReference contentReferenceFromJson(String str) =>
    ContentReference.fromJson(json.decode(str));

String contentReferenceToJson(ContentReference data) =>
    json.encode(data.toJson());

DelegationGrantParameters delegationGrantParametersFromJson(String str) =>
    DelegationGrantParameters.fromJson(json.decode(str));

String delegationGrantParametersToJson(DelegationGrantParameters data) =>
    json.encode(data.toJson());

DelegationScopeParameters delegationScopeParametersFromJson(String str) =>
    DelegationScopeParameters.fromJson(json.decode(str));

String delegationScopeParametersToJson(DelegationScopeParameters data) =>
    json.encode(data.toJson());

DocumentLaunchDescriptor documentLaunchDescriptorFromJson(String str) =>
    DocumentLaunchDescriptor.fromJson(json.decode(str));

String documentLaunchDescriptorToJson(DocumentLaunchDescriptor data) =>
    json.encode(data.toJson());

ErrorBody errorBodyFromJson(String str) => ErrorBody.fromJson(json.decode(str));

String errorBodyToJson(ErrorBody data) => json.encode(data.toJson());

HuddleAgentInput huddleAgentInputFromJson(String str) =>
    HuddleAgentInput.fromJson(json.decode(str));

String huddleAgentInputToJson(HuddleAgentInput data) =>
    json.encode(data.toJson());

HuddleStartInput huddleStartInputFromJson(String str) =>
    HuddleStartInput.fromJson(json.decode(str));

String huddleStartInputToJson(HuddleStartInput data) =>
    json.encode(data.toJson());

ResolvedIdentity resolvedIdentityFromJson(String str) =>
    ResolvedIdentity.fromJson(json.decode(str));

String resolvedIdentityToJson(ResolvedIdentity data) =>
    json.encode(data.toJson());

LlmRouteCreateInput llmRouteCreateInputFromJson(String str) =>
    LlmRouteCreateInput.fromJson(json.decode(str));

String llmRouteCreateInputToJson(LlmRouteCreateInput data) =>
    json.encode(data.toJson());

McpConnectionCreate mcpConnectionCreateFromJson(String str) =>
    McpConnectionCreate.fromJson(json.decode(str));

String mcpConnectionCreateToJson(McpConnectionCreate data) =>
    json.encode(data.toJson());

McpConnectionCredentialInput mcpConnectionCredentialInputFromJson(String str) =>
    McpConnectionCredentialInput.fromJson(json.decode(str));

String mcpConnectionCredentialInputToJson(McpConnectionCredentialInput data) =>
    json.encode(data.toJson());

McpConnectionPolicyUpdate mcpConnectionPolicyUpdateFromJson(String str) =>
    McpConnectionPolicyUpdate.fromJson(json.decode(str));

String mcpConnectionPolicyUpdateToJson(McpConnectionPolicyUpdate data) =>
    json.encode(data.toJson());

McpConnectionUpdate mcpConnectionUpdateFromJson(String str) =>
    McpConnectionUpdate.fromJson(json.decode(str));

String mcpConnectionUpdateToJson(McpConnectionUpdate data) =>
    json.encode(data.toJson());

McpToolSelection mcpToolSelectionFromJson(String str) =>
    McpToolSelection.fromJson(json.decode(str));

String mcpToolSelectionToJson(McpToolSelection data) =>
    json.encode(data.toJson());

NativeDocumentSelection nativeDocumentSelectionFromJson(String str) =>
    NativeDocumentSelection.fromJson(json.decode(str));

String nativeDocumentSelectionToJson(NativeDocumentSelection data) =>
    json.encode(data.toJson());

PlatformBuildInfo platformBuildInfoFromJson(String str) =>
    PlatformBuildInfo.fromJson(json.decode(str));

String platformBuildInfoToJson(PlatformBuildInfo data) =>
    json.encode(data.toJson());

ProtocolSessionOpenInput protocolSessionOpenInputFromJson(String str) =>
    ProtocolSessionOpenInput.fromJson(json.decode(str));

String protocolSessionOpenInputToJson(ProtocolSessionOpenInput data) =>
    json.encode(data.toJson());

ResourceCreate resourceCreateFromJson(String str) =>
    ResourceCreate.fromJson(json.decode(str));

String resourceCreateToJson(ResourceCreate data) => json.encode(data.toJson());

RuntimeProfileDirectory runtimeProfileDirectoryFromJson(String str) =>
    RuntimeProfileDirectory.fromJson(json.decode(str));

String runtimeProfileDirectoryToJson(RuntimeProfileDirectory data) =>
    json.encode(data.toJson());

SkillVersionUploadInput skillVersionUploadInputFromJson(String str) =>
    SkillVersionUploadInput.fromJson(json.decode(str));

String skillVersionUploadInputToJson(SkillVersionUploadInput data) =>
    json.encode(data.toJson());

TaskStateReport taskStateReportFromJson(String str) =>
    TaskStateReport.fromJson(json.decode(str));

String taskStateReportToJson(TaskStateReport data) =>
    json.encode(data.toJson());

TenantQuotaSetting tenantQuotaSettingFromJson(String str) =>
    TenantQuotaSetting.fromJson(json.decode(str));

String tenantQuotaSettingToJson(TenantQuotaSetting data) =>
    json.encode(data.toJson());

WorkflowRef workflowRefFromJson(String str) =>
    WorkflowRef.fromJson(json.decode(str));

String workflowRefToJson(WorkflowRef data) => json.encode(data.toJson());

WorkspaceCanvasSetInput workspaceCanvasSetInputFromJson(String str) =>
    WorkspaceCanvasSetInput.fromJson(json.decode(str));

String workspaceCanvasSetInputToJson(WorkspaceCanvasSetInput data) =>
    json.encode(data.toJson());

WorkspaceChannelCreate workspaceChannelCreateFromJson(String str) =>
    WorkspaceChannelCreate.fromJson(json.decode(str));

String workspaceChannelCreateToJson(WorkspaceChannelCreate data) =>
    json.encode(data.toJson());

WorkspaceUpdate workspaceUpdateFromJson(String str) =>
    WorkspaceUpdate.fromJson(json.decode(str));

String workspaceUpdateToJson(WorkspaceUpdate data) =>
    json.encode(data.toJson());

WorkspaceVisibility workspaceVisibilityFromJson(String str) =>
    workspaceVisibilityValues.map[json.decode(str)]!;

String workspaceVisibilityToJson(WorkspaceVisibility data) =>
    json.encode(workspaceVisibilityValues.reverse[data]);

AffectedOwnerRef affectedOwnerRefFromJson(String str) =>
    AffectedOwnerRef.fromJson(json.decode(str));

String affectedOwnerRefToJson(AffectedOwnerRef data) =>
    json.encode(data.toJson());

AgentInstallationAdvanceRequest agentInstallationAdvanceRequestFromJson(
  String str,
) => AgentInstallationAdvanceRequest.fromJson(json.decode(str));

String agentInstallationAdvanceRequestToJson(
  AgentInstallationAdvanceRequest data,
) => json.encode(data.toJson());

AgentInstallationAdvanceResult agentInstallationAdvanceResultFromJson(
  String str,
) => AgentInstallationAdvanceResult.fromJson(json.decode(str));

String agentInstallationAdvanceResultToJson(
  AgentInstallationAdvanceResult data,
) => json.encode(data.toJson());

AgentInstallationWorkflowTarget agentInstallationWorkflowTargetFromJson(
  String str,
) => AgentInstallationWorkflowTarget.fromJson(json.decode(str));

String agentInstallationWorkflowTargetToJson(
  AgentInstallationWorkflowTarget data,
) => json.encode(data.toJson());

AgentTaskAdvanceRequest agentTaskAdvanceRequestFromJson(String str) =>
    AgentTaskAdvanceRequest.fromJson(json.decode(str));

String agentTaskAdvanceRequestToJson(AgentTaskAdvanceRequest data) =>
    json.encode(data.toJson());

AgentTaskAdvanceResult agentTaskAdvanceResultFromJson(String str) =>
    AgentTaskAdvanceResult.fromJson(json.decode(str));

String agentTaskAdvanceResultToJson(AgentTaskAdvanceResult data) =>
    json.encode(data.toJson());

AgentTaskWorkflowInput agentTaskWorkflowInputFromJson(String str) =>
    AgentTaskWorkflowInput.fromJson(json.decode(str));

String agentTaskWorkflowInputToJson(AgentTaskWorkflowInput data) =>
    json.encode(data.toJson());

ApplicationBindingAdvanceRequest applicationBindingAdvanceRequestFromJson(
  String str,
) => ApplicationBindingAdvanceRequest.fromJson(json.decode(str));

String applicationBindingAdvanceRequestToJson(
  ApplicationBindingAdvanceRequest data,
) => json.encode(data.toJson());

ApplicationBindingAdvanceResult applicationBindingAdvanceResultFromJson(
  String str,
) => ApplicationBindingAdvanceResult.fromJson(json.decode(str));

String applicationBindingAdvanceResultToJson(
  ApplicationBindingAdvanceResult data,
) => json.encode(data.toJson());

ApplicationBindingTarget applicationBindingTargetFromJson(String str) =>
    ApplicationBindingTarget.fromJson(json.decode(str));

String applicationBindingTargetToJson(ApplicationBindingTarget data) =>
    json.encode(data.toJson());

ApprovalControlOutcome approvalControlOutcomeFromJson(String str) =>
    ApprovalControlOutcome.fromJson(json.decode(str));

String approvalControlOutcomeToJson(ApprovalControlOutcome data) =>
    json.encode(data.toJson());

ApprovalDecisionOutcome approvalDecisionOutcomeFromJson(String str) =>
    ApprovalDecisionOutcome.fromJson(json.decode(str));

String approvalDecisionOutcomeToJson(ApprovalDecisionOutcome data) =>
    json.encode(data.toJson());

ApprovalDecisionRecord approvalDecisionRecordFromJson(String str) =>
    ApprovalDecisionRecord.fromJson(json.decode(str));

String approvalDecisionRecordToJson(ApprovalDecisionRecord data) =>
    json.encode(data.toJson());

ApprovalDecisionUpdate approvalDecisionUpdateFromJson(String str) =>
    ApprovalDecisionUpdate.fromJson(json.decode(str));

String approvalDecisionUpdateToJson(ApprovalDecisionUpdate data) =>
    json.encode(data.toJson());

ApprovalWorkflowInput approvalWorkflowInputFromJson(String str) =>
    ApprovalWorkflowInput.fromJson(json.decode(str));

String approvalWorkflowInputToJson(ApprovalWorkflowInput data) =>
    json.encode(data.toJson());

ApprovalInvalidateUpdate approvalInvalidateUpdateFromJson(String str) =>
    ApprovalInvalidateUpdate.fromJson(json.decode(str));

String approvalInvalidateUpdateToJson(ApprovalInvalidateUpdate data) =>
    json.encode(data.toJson());

ApprovalRefusal approvalRefusalFromJson(String str) =>
    ApprovalRefusal.fromJson(json.decode(str));

String approvalRefusalToJson(ApprovalRefusal data) =>
    json.encode(data.toJson());

ApprovalResume approvalResumeFromJson(String str) =>
    ApprovalResume.fromJson(json.decode(str));

String approvalResumeToJson(ApprovalResume data) => json.encode(data.toJson());

ApprovalRoleRequirement approvalRoleRequirementFromJson(String str) =>
    ApprovalRoleRequirement.fromJson(json.decode(str));

String approvalRoleRequirementToJson(ApprovalRoleRequirement data) =>
    json.encode(data.toJson());

ApprovalStateReport approvalStateReportFromJson(String str) =>
    ApprovalStateReport.fromJson(json.decode(str));

String approvalStateReportToJson(ApprovalStateReport data) =>
    json.encode(data.toJson());

AutomationScheduleAdmitRequest automationScheduleAdmitRequestFromJson(
  String str,
) => AutomationScheduleAdmitRequest.fromJson(json.decode(str));

String automationScheduleAdmitRequestToJson(
  AutomationScheduleAdmitRequest data,
) => json.encode(data.toJson());

AutomationScheduleAdmitResult automationScheduleAdmitResultFromJson(
  String str,
) => AutomationScheduleAdmitResult.fromJson(json.decode(str));

String automationScheduleAdmitResultToJson(
  AutomationScheduleAdmitResult data,
) => json.encode(data.toJson());

AutomationScheduleTaskInput automationScheduleTaskInputFromJson(String str) =>
    AutomationScheduleTaskInput.fromJson(json.decode(str));

String automationScheduleTaskInputToJson(AutomationScheduleTaskInput data) =>
    json.encode(data.toJson());

ComponentActionAdvanceRequest componentActionAdvanceRequestFromJson(
  String str,
) => ComponentActionAdvanceRequest.fromJson(json.decode(str));

String componentActionAdvanceRequestToJson(
  ComponentActionAdvanceRequest data,
) => json.encode(data.toJson());

ComponentActionAdvanceResult componentActionAdvanceResultFromJson(String str) =>
    ComponentActionAdvanceResult.fromJson(json.decode(str));

String componentActionAdvanceResultToJson(ComponentActionAdvanceResult data) =>
    json.encode(data.toJson());

ComponentActionTarget componentActionTargetFromJson(String str) =>
    ComponentActionTarget.fromJson(json.decode(str));

String componentActionTargetToJson(ComponentActionTarget data) =>
    json.encode(data.toJson());

ComponentConformanceObservation componentConformanceObservationFromJson(
  String str,
) => ComponentConformanceObservation.fromJson(json.decode(str));

String componentConformanceObservationToJson(
  ComponentConformanceObservation data,
) => json.encode(data.toJson());

ComponentConformancePlan componentConformancePlanFromJson(String str) =>
    ComponentConformancePlan.fromJson(json.decode(str));

String componentConformancePlanToJson(ComponentConformancePlan data) =>
    json.encode(data.toJson());

ComponentConformanceProbe componentConformanceProbeFromJson(String str) =>
    ComponentConformanceProbe.fromJson(json.decode(str));

String componentConformanceProbeToJson(ComponentConformanceProbe data) =>
    json.encode(data.toJson());

ComponentConformanceStepObservation componentConformanceStepObservationFromJson(
  String str,
) => ComponentConformanceStepObservation.fromJson(json.decode(str));

String componentConformanceStepObservationToJson(
  ComponentConformanceStepObservation data,
) => json.encode(data.toJson());

ConversationProjectionRequest conversationProjectionRequestFromJson(
  String str,
) => ConversationProjectionRequest.fromJson(json.decode(str));

String conversationProjectionRequestToJson(
  ConversationProjectionRequest data,
) => json.encode(data.toJson());

ConversationProjectionResult conversationProjectionResultFromJson(String str) =>
    ConversationProjectionResult.fromJson(json.decode(str));

String conversationProjectionResultToJson(ConversationProjectionResult data) =>
    json.encode(data.toJson());

ConversationProjectionTarget conversationProjectionTargetFromJson(String str) =>
    ConversationProjectionTarget.fromJson(json.decode(str));

String conversationProjectionTargetToJson(ConversationProjectionTarget data) =>
    json.encode(data.toJson());

FreshApprovalAdmissionRequest freshApprovalAdmissionRequestFromJson(
  String str,
) => FreshApprovalAdmissionRequest.fromJson(json.decode(str));

String freshApprovalAdmissionRequestToJson(
  FreshApprovalAdmissionRequest data,
) => json.encode(data.toJson());

FreshApprovalAdmissionResult freshApprovalAdmissionResultFromJson(String str) =>
    FreshApprovalAdmissionResult.fromJson(json.decode(str));

String freshApprovalAdmissionResultToJson(FreshApprovalAdmissionResult data) =>
    json.encode(data.toJson());

ProtocolSessionReconcileRequest protocolSessionReconcileRequestFromJson(
  String str,
) => ProtocolSessionReconcileRequest.fromJson(json.decode(str));

String protocolSessionReconcileRequestToJson(
  ProtocolSessionReconcileRequest data,
) => json.encode(data.toJson());

ProtocolSessionReconcileResult protocolSessionReconcileResultFromJson(
  String str,
) => ProtocolSessionReconcileResult.fromJson(json.decode(str));

String protocolSessionReconcileResultToJson(
  ProtocolSessionReconcileResult data,
) => json.encode(data.toJson());

ProtocolSessionReconcileRound protocolSessionReconcileRoundFromJson(
  String str,
) => ProtocolSessionReconcileRound.fromJson(json.decode(str));

String protocolSessionReconcileRoundToJson(
  ProtocolSessionReconcileRound data,
) => json.encode(data.toJson());

ProtocolSessionReconcileTarget protocolSessionReconcileTargetFromJson(
  String str,
) => ProtocolSessionReconcileTarget.fromJson(json.decode(str));

String protocolSessionReconcileTargetToJson(
  ProtocolSessionReconcileTarget data,
) => json.encode(data.toJson());

ResourceExportAdvanceRequest resourceExportAdvanceRequestFromJson(String str) =>
    ResourceExportAdvanceRequest.fromJson(json.decode(str));

String resourceExportAdvanceRequestToJson(ResourceExportAdvanceRequest data) =>
    json.encode(data.toJson());

ResourceExportAdvanceResult resourceExportAdvanceResultFromJson(String str) =>
    ResourceExportAdvanceResult.fromJson(json.decode(str));

String resourceExportAdvanceResultToJson(ResourceExportAdvanceResult data) =>
    json.encode(data.toJson());

ResourceExportTarget resourceExportTargetFromJson(String str) =>
    ResourceExportTarget.fromJson(json.decode(str));

String resourceExportTargetToJson(ResourceExportTarget data) =>
    json.encode(data.toJson());

ResourceImportAdvanceRequest resourceImportAdvanceRequestFromJson(String str) =>
    ResourceImportAdvanceRequest.fromJson(json.decode(str));

String resourceImportAdvanceRequestToJson(ResourceImportAdvanceRequest data) =>
    json.encode(data.toJson());

ResourceImportAdvanceResult resourceImportAdvanceResultFromJson(String str) =>
    ResourceImportAdvanceResult.fromJson(json.decode(str));

String resourceImportAdvanceResultToJson(ResourceImportAdvanceResult data) =>
    json.encode(data.toJson());

ResourceImportTarget resourceImportTargetFromJson(String str) =>
    ResourceImportTarget.fromJson(json.decode(str));

String resourceImportTargetToJson(ResourceImportTarget data) =>
    json.encode(data.toJson());

ResourceProvisionAdvanceRequest resourceProvisionAdvanceRequestFromJson(
  String str,
) => ResourceProvisionAdvanceRequest.fromJson(json.decode(str));

String resourceProvisionAdvanceRequestToJson(
  ResourceProvisionAdvanceRequest data,
) => json.encode(data.toJson());

ResourceProvisionAdvanceResult resourceProvisionAdvanceResultFromJson(
  String str,
) => ResourceProvisionAdvanceResult.fromJson(json.decode(str));

String resourceProvisionAdvanceResultToJson(
  ResourceProvisionAdvanceResult data,
) => json.encode(data.toJson());

ResourceProvisionTarget resourceProvisionTargetFromJson(String str) =>
    ResourceProvisionTarget.fromJson(json.decode(str));

String resourceProvisionTargetToJson(ResourceProvisionTarget data) =>
    json.encode(data.toJson());

TenantDeleteAdvanceRequest tenantDeleteAdvanceRequestFromJson(String str) =>
    TenantDeleteAdvanceRequest.fromJson(json.decode(str));

String tenantDeleteAdvanceRequestToJson(TenantDeleteAdvanceRequest data) =>
    json.encode(data.toJson());

TenantDeleteAdvanceResult tenantDeleteAdvanceResultFromJson(String str) =>
    TenantDeleteAdvanceResult.fromJson(json.decode(str));

String tenantDeleteAdvanceResultToJson(TenantDeleteAdvanceResult data) =>
    json.encode(data.toJson());

///可用 JSON Schema 子集的可执行定义。它穷举 contracts/README.md 第 1
///节允许的每一种构造；四侧生成器必须全部生成成功并通过双向序列化。新增构造先加进本文件并四侧验证通过，才允许在其他 schema 中使用。
class Canary {
  ///可选的枚举引用
  final CapabilityState? capabilityState;

  ///基础 integer
  final int count;

  ///基础 boolean
  final bool enabled;

  ///跨文件 $ref 引用封闭枚举
  final ErrorClass errorClass;

  ///format: uuid
  final String id;

  ///基础 string
  final String name;

  ///内联对象，同样显式关闭 additionalProperties
  final CanaryNested nested;

  ///RFC3339 时间戳，按普通 string 传输。format: date-time 不在可用子集内——Dart 的 toIso8601String()
  ///强制补毫秒，四侧线格式不等价。取值合法性由 Core 在 Admission 校验，不由 schema 承担。
  final String? occurredAt;

  ///基础 number
  final double ratio;

  ///同构数组
  final List<String> tags;

  ///变体类型的平坦表达：封闭枚举 tag 加各变体字段全部可选，替代被禁用的 oneOf
  final List<CanaryVariantsItem>? variants;

  Canary({
    this.capabilityState,
    required this.count,
    required this.enabled,
    required this.errorClass,
    required this.id,
    required this.name,
    required this.nested,
    this.occurredAt,
    required this.ratio,
    required this.tags,
    this.variants,
  });

  factory Canary.fromJson(Map<String, dynamic> json) => Canary(
    capabilityState: json["capabilityState"] == null
        ? null
        : capabilityStateValues.map[json["capabilityState"]]!,
    count: json["count"],
    enabled: json["enabled"],
    errorClass: errorClassValues.map[json["errorClass"]]!,
    id: json["id"],
    name: json["name"],
    nested: CanaryNested.fromJson(json["nested"]),
    occurredAt: json["occurredAt"],
    ratio: json["ratio"]?.toDouble(),
    tags: List<String>.from(json["tags"].map((x) => x)),
    variants: json["variants"] == null
        ? null
        : List<CanaryVariantsItem>.from(
            json["variants"]!.map((x) => CanaryVariantsItem.fromJson(x)),
          ),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "capabilityState": capabilityStateValues.reverse[capabilityState],
    "count": count,
    "enabled": enabled,
    "errorClass": errorClassValues.reverse[errorClass],
    "id": id,
    "name": name,
    "nested": nested.toJson(),
    "occurredAt": occurredAt,
    "ratio": ratio,
    "tags": List<dynamic>.from(tags.map((x) => x)),
    "variants": variants == null
        ? null
        : List<dynamic>.from(variants!.map((x) => x.toJson())),
  });
}

///可选的枚举引用
///
///能力状态。权威定义见 .design/02-源码证据与设计决策.md。BLOCKED 的能力不得生成任何入口、路由、动作、工具或开关。
enum CapabilityState {
  ADAPTER_REQUIRED,
  BLOCKED,
  DESIGN_DEFINED,
  EXCLUDED,
  UPSTREAM_SUPPORTED,
}

final capabilityStateValues = EnumValues({
  "ADAPTER_REQUIRED": CapabilityState.ADAPTER_REQUIRED,
  "BLOCKED": CapabilityState.BLOCKED,
  "DESIGN_DEFINED": CapabilityState.DESIGN_DEFINED,
  "EXCLUDED": CapabilityState.EXCLUDED,
  "UPSTREAM_SUPPORTED": CapabilityState.UPSTREAM_SUPPORTED,
});

///跨文件 $ref 引用封闭枚举
///
///错误分类。每个 API 错误、Workflow 失败与 UI 状态必须落在其中之一。权威定义见 apps/06-工程基线规范.md 第 4 节。UNKNOWN
///表示外部副作用结果不明，等待对账，禁止渲染成成功或失败，也禁止盲目重放。
enum ErrorClass { BLOCKED, CONFLICT, DENIED, LIMIT, PRECONDITION, UNKNOWN }

final errorClassValues = EnumValues({
  "BLOCKED": ErrorClass.BLOCKED,
  "CONFLICT": ErrorClass.CONFLICT,
  "DENIED": ErrorClass.DENIED,
  "LIMIT": ErrorClass.LIMIT,
  "PRECONDITION": ErrorClass.PRECONDITION,
  "UNKNOWN": ErrorClass.UNKNOWN,
});

///内联对象，同样显式关闭 additionalProperties
class CanaryNested {
  final String label;
  final List<double>? weights;

  CanaryNested({required this.label, this.weights});

  factory CanaryNested.fromJson(Map<String, dynamic> json) => CanaryNested(
    label: json["label"],
    weights: json["weights"] == null
        ? null
        : List<double>.from(json["weights"]!.map((x) => x?.toDouble())),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "label": label,
    "weights": weights == null
        ? null
        : List<dynamic>.from(weights!.map((x) => x)),
  });
}

class CanaryVariantsItem {
  final String? fileDigest;
  final CanaryVariantsItemKind kind;
  final String? messageBody;
  final int? taskAttempt;

  CanaryVariantsItem({
    this.fileDigest,
    required this.kind,
    this.messageBody,
    this.taskAttempt,
  });

  factory CanaryVariantsItem.fromJson(Map<String, dynamic> json) =>
      CanaryVariantsItem(
        fileDigest: json["fileDigest"],
        kind: canaryVariantsItemKindValues.map[json["kind"]]!,
        messageBody: json["messageBody"],
        taskAttempt: json["taskAttempt"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "fileDigest": fileDigest,
    "kind": canaryVariantsItemKindValues.reverse[kind],
    "messageBody": messageBody,
    "taskAttempt": taskAttempt,
  });
}

enum CanaryVariantsItemKind { FILE, MESSAGE, TASK }

final canaryVariantsItemKindValues = EnumValues({
  "FILE": CanaryVariantsItemKind.FILE,
  "MESSAGE": CanaryVariantsItemKind.MESSAGE,
  "TASK": CanaryVariantsItemKind.TASK,
});

class ApplicationModelAdmission {
  final String bindingId;
  final String gatewayPrincipalId;
  final int generation;
  final String method;
  final String path;
  final String traceparent;

  ApplicationModelAdmission({
    required this.bindingId,
    required this.gatewayPrincipalId,
    required this.generation,
    required this.method,
    required this.path,
    required this.traceparent,
  });

  factory ApplicationModelAdmission.fromJson(Map<String, dynamic> json) =>
      ApplicationModelAdmission(
        bindingId: json["bindingId"],
        gatewayPrincipalId: json["gatewayPrincipalId"],
        generation: json["generation"],
        method: json["method"],
        path: json["path"],
        traceparent: json["traceparent"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "gatewayPrincipalId": gatewayPrincipalId,
    "generation": generation,
    "method": method,
    "path": path,
    "traceparent": traceparent,
  });
}

///Delete selected native objects in the admitted Resource using the original
///recycle/permanent-delete choice. Each native object identity must be independently
///authorized and retained in the native first-dispatch claim.
class FileStorageDeleteInput {
  final List<String> nativeObjectRefs;
  final bool removePermanently;
  final String resourceId;

  FileStorageDeleteInput({
    required this.nativeObjectRefs,
    required this.removePermanently,
    required this.resourceId,
  });

  factory FileStorageDeleteInput.fromJson(Map<String, dynamic> json) =>
      FileStorageDeleteInput(
        nativeObjectRefs: List<String>.from(
          json["nativeObjectRefs"].map((x) => x),
        ),
        removePermanently: json["removePermanently"],
        resourceId: json["resourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nativeObjectRefs": List<dynamic>.from(nativeObjectRefs.map((x) => x)),
    "removePermanently": removePermanently,
    "resourceId": resourceId,
  });
}

///Metadata-only result. Success requires all selected native identities to have linked
///durable deletion or recycle acknowledgements; an accepted job, Finished status or absent
///current object is not terminal evidence.
class FileStorageDeleteOutput {
  FileStorageDeleteOutput();

  factory FileStorageDeleteOutput.fromJson(Map<String, dynamic> json) =>
      FileStorageDeleteOutput();

  Map<String, dynamic> toJson() => _stripNulls({});
}

///Export exactly the authorized typed native file revision, including empty or non-UTF-8
///files.
class FileStorageExportInput {
  final String displayName;
  final String mediaType;
  final String nativeObjectRef;
  final String nativeRevision;
  final String resourceId;

  FileStorageExportInput({
    required this.displayName,
    required this.mediaType,
    required this.nativeObjectRef,
    required this.nativeRevision,
    required this.resourceId,
  });

  factory FileStorageExportInput.fromJson(Map<String, dynamic> json) =>
      FileStorageExportInput(
        displayName: json["displayName"],
        mediaType: json["mediaType"],
        nativeObjectRef: json["nativeObjectRef"],
        nativeRevision: json["nativeRevision"],
        resourceId: json["resourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "displayName": displayName,
    "mediaType": mediaType,
    "nativeObjectRef": nativeObjectRef,
    "nativeRevision": nativeRevision,
    "resourceId": resourceId,
  });
}

///Immediate authorized binary result using the existing export encoding; not a persisted
///Core blob, URL, or native credential.
class FileStorageExportOutput {
  final String contentBase64;
  final String filename;
  final String mediaType;

  FileStorageExportOutput({
    required this.contentBase64,
    required this.filename,
    required this.mediaType,
  });

  factory FileStorageExportOutput.fromJson(Map<String, dynamic> json) =>
      FileStorageExportOutput(
        contentBase64: json["contentBase64"],
        filename: json["filename"],
        mediaType: json["mediaType"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "contentBase64": contentBase64,
    "filename": filename,
    "mediaType": mediaType,
  });
}

///DD-89: list the source Resource through its bound native root; the client cannot supply
///another root or native credential.
class FileStorageListInput {
  final String resourceId;

  FileStorageListInput({required this.resourceId});

  factory FileStorageListInput.fromJson(Map<String, dynamic> json) =>
      FileStorageListInput(resourceId: json["resourceId"]);

  Map<String, dynamic> toJson() => _stripNulls({"resourceId": resourceId});
}

///DD-89: complete native listing is transported only between components, not persisted by
///Core. Its canonical item digest is the native listing revision, never a fabricated file
///VersionId.
class FileStorageListOutput {
  final List<ContentReference> items;
  final String listingDigest;
  final String nativeObjectRef;
  final String nativeRevision;
  final String operationId;
  final String resourceId;

  FileStorageListOutput({
    required this.items,
    required this.listingDigest,
    required this.nativeObjectRef,
    required this.nativeRevision,
    required this.operationId,
    required this.resourceId,
  });

  factory FileStorageListOutput.fromJson(Map<String, dynamic> json) =>
      FileStorageListOutput(
        items: List<ContentReference>.from(
          json["items"].map((x) => ContentReference.fromJson(x)),
        ),
        listingDigest: json["listingDigest"],
        nativeObjectRef: json["nativeObjectRef"],
        nativeRevision: json["nativeRevision"],
        operationId: json["operationId"],
        resourceId: json["resourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "items": List<dynamic>.from(items.map((x) => x.toJson())),
    "listingDigest": listingDigest,
    "nativeObjectRef": nativeObjectRef,
    "nativeRevision": nativeRevision,
    "operationId": operationId,
    "resourceId": resourceId,
  });
}

///design03 的唯一内容引用线格式；不是业务正文。Adapter typed 槽是传递引用的唯一来源，resultJson 不用于识别或重建引用。
class ContentReference {
  final String? assetId;
  final String displayName;
  final String mediaType;
  final String nativeObjectRef;
  final String nativeRevision;
  final String resourceId;

  ContentReference({
    this.assetId,
    required this.displayName,
    required this.mediaType,
    required this.nativeObjectRef,
    required this.nativeRevision,
    required this.resourceId,
  });

  factory ContentReference.fromJson(Map<String, dynamic> json) =>
      ContentReference(
        assetId: json["assetId"],
        displayName: json["displayName"],
        mediaType: json["mediaType"],
        nativeObjectRef: json["nativeObjectRef"],
        nativeRevision: json["nativeRevision"],
        resourceId: json["resourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "assetId": assetId,
    "displayName": displayName,
    "mediaType": mediaType,
    "nativeObjectRef": nativeObjectRef,
    "nativeRevision": nativeRevision,
    "resourceId": resourceId,
  });
}

///List published native revisions of one UUID inside the admitted Resource's bound root; no
///caller-supplied path or credential.
class FileStorageListRevisionsInput {
  final String nativeObjectRef;
  final String resourceId;

  FileStorageListRevisionsInput({
    required this.nativeObjectRef,
    required this.resourceId,
  });

  factory FileStorageListRevisionsInput.fromJson(Map<String, dynamic> json) =>
      FileStorageListRevisionsInput(
        nativeObjectRef: json["nativeObjectRef"],
        resourceId: json["resourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nativeObjectRef": nativeObjectRef,
    "resourceId": resourceId,
  });
}

///Published version references from the original native version collection; also supplied
///in the adapter's typed ContentReference slot. Not SERVICE list_output or a completion
///receipt.
class FileStorageListRevisionsOutput {
  final List<ContentReference> citations;

  FileStorageListRevisionsOutput({required this.citations});

  factory FileStorageListRevisionsOutput.fromJson(Map<String, dynamic> json) =>
      FileStorageListRevisionsOutput(
        citations: List<ContentReference>.from(
          json["citations"].map((x) => ContentReference.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "citations": List<dynamic>.from(citations.map((x) => x.toJson())),
  });
}

///Read the exact typed native file revision in the admitted Resource; never substitute the
///current head.
class FileStorageReadInput {
  final String displayName;
  final String mediaType;
  final String nativeObjectRef;
  final String nativeRevision;
  final String resourceId;

  FileStorageReadInput({
    required this.displayName,
    required this.mediaType,
    required this.nativeObjectRef,
    required this.nativeRevision,
    required this.resourceId,
  });

  factory FileStorageReadInput.fromJson(Map<String, dynamic> json) =>
      FileStorageReadInput(
        displayName: json["displayName"],
        mediaType: json["mediaType"],
        nativeObjectRef: json["nativeObjectRef"],
        nativeRevision: json["nativeRevision"],
        resourceId: json["resourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "displayName": displayName,
    "mediaType": mediaType,
    "nativeObjectRef": nativeObjectRef,
    "nativeRevision": nativeRevision,
    "resourceId": resourceId,
  });
}

///Exact valid UTF-8 native bytes, disclosed only through the original result policy. Binary
///files use export.
class FileStorageReadOutput {
  final String text;

  FileStorageReadOutput({required this.text});

  factory FileStorageReadOutput.fromJson(Map<String, dynamic> json) =>
      FileStorageReadOutput(text: json["text"]);

  Map<String, dynamic> toJson() => _stripNulls({"text": text});
}

///Manage an existing native share under the admitted Resource. Revocation removes access
///through that exact share; it neither deletes file content nor grants platform resource
///permission. Native share identity alone is not evidence of ownership or successful
///revocation.
class FileStorageShareInput {
  final String nativeShareRef;
  final FileStorageShareOperation operation;
  final String resourceId;

  FileStorageShareInput({
    required this.nativeShareRef,
    required this.operation,
    required this.resourceId,
  });

  factory FileStorageShareInput.fromJson(Map<String, dynamic> json) =>
      FileStorageShareInput(
        nativeShareRef: json["nativeShareRef"],
        operation: fileStorageShareOperationValues.map[json["operation"]]!,
        resourceId: json["resourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nativeShareRef": nativeShareRef,
    "operation": fileStorageShareOperationValues.reverse[operation],
    "resourceId": resourceId,
  });
}

enum FileStorageShareOperation { REVOKE }

final fileStorageShareOperationValues = EnumValues({
  "REVOKE": FileStorageShareOperation.REVOKE,
});

///Metadata-only share result. Revocation requires an authorized first-dispatch claim and
///confirmed removal of the frozen native share access. An unowned missing identifier,
///accepted request or partial native cleanup is not successful revocation.
class FileStorageShareOutput {
  FileStorageShareOutput();

  factory FileStorageShareOutput.fromJson(Map<String, dynamic> json) =>
      FileStorageShareOutput();

  Map<String, dynamic> toJson() => _stripNulls({});
}

///Apply an existing immutable native revision, or dispatch a native first-byte intent. An
///intent is not a ContentReference: its node/revision identifiers name reserved native
///locations only; bytes remain at the source and no result exists before the immutable
///native ACK.
class FileStorageWriteInput {
  final int? contentLength;
  final String? displayName;
  final String? mediaType;
  final bool? multipart;
  final int? nativeDeadline;
  final String? nativeIntentId;
  final String? nativeNodeId;
  final String? nativeObjectRef;
  final String? nativeRevision;
  final String resourceId;

  FileStorageWriteInput({
    this.contentLength,
    this.displayName,
    this.mediaType,
    this.multipart,
    this.nativeDeadline,
    this.nativeIntentId,
    this.nativeNodeId,
    this.nativeObjectRef,
    this.nativeRevision,
    required this.resourceId,
  });

  factory FileStorageWriteInput.fromJson(Map<String, dynamic> json) =>
      FileStorageWriteInput(
        contentLength: json["contentLength"],
        displayName: json["displayName"],
        mediaType: json["mediaType"],
        multipart: json["multipart"],
        nativeDeadline: json["nativeDeadline"],
        nativeIntentId: json["nativeIntentId"],
        nativeNodeId: json["nativeNodeId"],
        nativeObjectRef: json["nativeObjectRef"],
        nativeRevision: json["nativeRevision"],
        resourceId: json["resourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "contentLength": contentLength,
    "displayName": displayName,
    "mediaType": mediaType,
    "multipart": multipart,
    "nativeDeadline": nativeDeadline,
    "nativeIntentId": nativeIntentId,
    "nativeNodeId": nativeNodeId,
    "nativeObjectRef": nativeObjectRef,
    "nativeRevision": nativeRevision,
    "resourceId": resourceId,
  });
}

///Metadata-only write result. The exact confirmed result revision belongs in the adapter's
///typed ContentReference slot; an empty result, accepted write, or current head alone is
///not terminal evidence.
class FileStorageWriteOutput {
  FileStorageWriteOutput();

  factory FileStorageWriteOutput.fromJson(Map<String, dynamic> json) =>
      FileStorageWriteOutput();

  Map<String, dynamic> toJson() => _stripNulls({});
}

///Metadata-only input of the receiver native synchronization admission. Core injects the
///read execution reference and native receiver root.
class KnowledgeSyncInput {
  final String batchId;
  final String importConfigRef;
  final String sourceReadActionExecutionId;
  final String sourceResourceId;

  KnowledgeSyncInput({
    required this.batchId,
    required this.importConfigRef,
    required this.sourceReadActionExecutionId,
    required this.sourceResourceId,
  });

  factory KnowledgeSyncInput.fromJson(Map<String, dynamic> json) =>
      KnowledgeSyncInput(
        batchId: json["batchId"],
        importConfigRef: json["importConfigRef"],
        sourceReadActionExecutionId: json["sourceReadActionExecutionId"],
        sourceResourceId: json["sourceResourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "batchId": batchId,
    "importConfigRef": importConfigRef,
    "sourceReadActionExecutionId": sourceReadActionExecutionId,
    "sourceResourceId": sourceResourceId,
  });
}

///07§5/6.2：validate_binding 的非正文观察。精确原生scope/实例、隔离与配置引用摘要，不是用户声明的通过布尔值。
class AdapterBindingObservation {
  final String artifactDigest;
  final String bindingId;
  final String configDigest;
  final List<AdapterExecutionMapping> executionMappings;
  final ApplicationIsolationMode isolationMode;
  final String nativeInstanceRef;
  final String nativeScopeRef;
  final List<AdapterSecretRead> secretReads;
  final String secretRefDigest;
  final String tenantId;
  final String? workspaceId;

  AdapterBindingObservation({
    required this.artifactDigest,
    required this.bindingId,
    required this.configDigest,
    required this.executionMappings,
    required this.isolationMode,
    required this.nativeInstanceRef,
    required this.nativeScopeRef,
    required this.secretReads,
    required this.secretRefDigest,
    required this.tenantId,
    this.workspaceId,
  });

  factory AdapterBindingObservation.fromJson(
    Map<String, dynamic> json,
  ) => AdapterBindingObservation(
    artifactDigest: json["artifactDigest"],
    bindingId: json["bindingId"],
    configDigest: json["configDigest"],
    executionMappings: List<AdapterExecutionMapping>.from(
      json["executionMappings"].map((x) => AdapterExecutionMapping.fromJson(x)),
    ),
    isolationMode: applicationIsolationModeValues.map[json["isolationMode"]]!,
    nativeInstanceRef: json["nativeInstanceRef"],
    nativeScopeRef: json["nativeScopeRef"],
    secretReads: List<AdapterSecretRead>.from(
      json["secretReads"].map((x) => AdapterSecretRead.fromJson(x)),
    ),
    secretRefDigest: json["secretRefDigest"],
    tenantId: json["tenantId"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "artifactDigest": artifactDigest,
    "bindingId": bindingId,
    "configDigest": configDigest,
    "executionMappings": List<dynamic>.from(
      executionMappings.map((x) => x.toJson()),
    ),
    "isolationMode": applicationIsolationModeValues.reverse[isolationMode],
    "nativeInstanceRef": nativeInstanceRef,
    "nativeScopeRef": nativeScopeRef,
    "secretReads": List<dynamic>.from(secretReads.map((x) => x.toJson())),
    "secretRefDigest": secretRefDigest,
    "tenantId": tenantId,
    "workspaceId": workspaceId,
  });
}

class AdapterExecutionMapping {
  final String actionKey;
  final int actionVersion;
  final NativeCancelCapability cancelCapability;
  final String nativeType;

  AdapterExecutionMapping({
    required this.actionKey,
    required this.actionVersion,
    required this.cancelCapability,
    required this.nativeType,
  });

  factory AdapterExecutionMapping.fromJson(Map<String, dynamic> json) =>
      AdapterExecutionMapping(
        actionKey: json["actionKey"],
        actionVersion: json["actionVersion"],
        cancelCapability:
            nativeCancelCapabilityValues.map[json["cancelCapability"]]!,
        nativeType: json["nativeType"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "actionVersion": actionVersion,
    "cancelCapability": nativeCancelCapabilityValues.reverse[cancelCapability],
    "nativeType": nativeType,
  });
}

enum NativeCancelCapability { SUPPORTED, UNSUPPORTED }

final nativeCancelCapabilityValues = EnumValues({
  "SUPPORTED": NativeCancelCapability.SUPPORTED,
  "UNSUPPORTED": NativeCancelCapability.UNSUPPORTED,
});

enum ApplicationIsolationMode {
  DEDICATED_INSTANCE,
  NAMESPACE,
  NATIVE_TENANT,
  RESOURCE_FILTER,
  RESOURCE_INSTANCE,
}

final applicationIsolationModeValues = EnumValues({
  "DEDICATED_INSTANCE": ApplicationIsolationMode.DEDICATED_INSTANCE,
  "NAMESPACE": ApplicationIsolationMode.NAMESPACE,
  "NATIVE_TENANT": ApplicationIsolationMode.NATIVE_TENANT,
  "RESOURCE_FILTER": ApplicationIsolationMode.RESOURCE_FILTER,
  "RESOURCE_INSTANCE": ApplicationIsolationMode.RESOURCE_INSTANCE,
});

class AdapterSecretRead {
  final String audience;
  final String requestId;
  final String secretKey;
  final int version;

  AdapterSecretRead({
    required this.audience,
    required this.requestId,
    required this.secretKey,
    required this.version,
  });

  factory AdapterSecretRead.fromJson(Map<String, dynamic> json) =>
      AdapterSecretRead(
        audience: json["audience"],
        requestId: json["requestId"],
        secretKey: json["secretKey"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "audience": audience,
    "requestId": requestId,
    "secretKey": secretKey,
    "version": version,
  });
}

///完整原生枚举的同引用观察，非新的任务/结果权威。complete 只在全部原存储流正常结束后成立；部分枚举、超限或不可核验不得当空集合。observations
///保留所有代次的原始幂等引用，未知任务不得遗漏；Core 自行核验终态，不接收 drained 声明。
class AdapterBindingReconcileResponse {
  final bool complete;
  final List<AdapterExecutionObservation> observations;
  final AdapterBindingReconcileRequest reference;

  AdapterBindingReconcileResponse({
    required this.complete,
    required this.observations,
    required this.reference,
  });

  factory AdapterBindingReconcileResponse.fromJson(Map<String, dynamic> json) =>
      AdapterBindingReconcileResponse(
        complete: json["complete"],
        observations: List<AdapterExecutionObservation>.from(
          json["observations"].map(
            (x) => AdapterExecutionObservation.fromJson(x),
          ),
        ),
        reference: AdapterBindingReconcileRequest.fromJson(json["reference"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "complete": complete,
    "observations": List<dynamic>.from(observations.map((x) => x.toJson())),
    "reference": reference.toJson(),
  });
}

///ADR-12 execute/observe/cancel/reconcile 的原生观察。字段取自 design03 ExternalExecution；nativeId
///允许未取得，值域与具体操作的终态证据由接收者验证。取消接收仍为 RUNNING/UNKNOWN，不伪装 CANCELLED。
class AdapterExecutionObservation {
  final NativeCancelCapability cancelCapability;
  final String idempotencyKey;
  final String? lastObservedAt;
  final String? nativeId;
  final String? nativeStatus;
  final String nativeType;
  final ExternalExecutionStatus platformStatus;
  final String? terminalAt;

  AdapterExecutionObservation({
    required this.cancelCapability,
    required this.idempotencyKey,
    this.lastObservedAt,
    this.nativeId,
    this.nativeStatus,
    required this.nativeType,
    required this.platformStatus,
    this.terminalAt,
  });

  factory AdapterExecutionObservation.fromJson(Map<String, dynamic> json) =>
      AdapterExecutionObservation(
        cancelCapability:
            nativeCancelCapabilityValues.map[json["cancelCapability"]]!,
        idempotencyKey: json["idempotencyKey"],
        lastObservedAt: json["lastObservedAt"],
        nativeId: json["nativeId"],
        nativeStatus: json["nativeStatus"],
        nativeType: json["nativeType"],
        platformStatus:
            externalExecutionStatusValues.map[json["platformStatus"]]!,
        terminalAt: json["terminalAt"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "cancelCapability": nativeCancelCapabilityValues.reverse[cancelCapability],
    "idempotencyKey": idempotencyKey,
    "lastObservedAt": lastObservedAt,
    "nativeId": nativeId,
    "nativeStatus": nativeStatus,
    "nativeType": nativeType,
    "platformStatus": externalExecutionStatusValues.reverse[platformStatus],
    "terminalAt": terminalAt,
  });
}

///design03§6 ExternalExecution 的既定平台状态；HTTP成功和cancel accepted均不构成终态。
enum ExternalExecutionStatus {
  CANCELLED,
  FAILED,
  PENDING_DISPATCH,
  RUNNING,
  SUCCEEDED,
  UNKNOWN,
}

final externalExecutionStatusValues = EnumValues({
  "CANCELLED": ExternalExecutionStatus.CANCELLED,
  "FAILED": ExternalExecutionStatus.FAILED,
  "PENDING_DISPATCH": ExternalExecutionStatus.PENDING_DISPATCH,
  "RUNNING": ExternalExecutionStatus.RUNNING,
  "SUCCEEDED": ExternalExecutionStatus.SUCCEEDED,
  "UNKNOWN": ExternalExecutionStatus.UNKNOWN,
});

///07§5.2/6.2 已停止新准入的 binding reconcile。引用原停用生命周期及冻结代次，只观察原生任务，不创建 ExternalExecution 或重放动作。
class AdapterBindingReconcileRequest {
  final String bindingId;
  final String configDigest;
  final int generation;
  final String idempotencyKey;
  final String nativeInstanceRef;
  final String nativeScopeRef;

  AdapterBindingReconcileRequest({
    required this.bindingId,
    required this.configDigest,
    required this.generation,
    required this.idempotencyKey,
    required this.nativeInstanceRef,
    required this.nativeScopeRef,
  });

  factory AdapterBindingReconcileRequest.fromJson(Map<String, dynamic> json) =>
      AdapterBindingReconcileRequest(
        bindingId: json["bindingId"],
        configDigest: json["configDigest"],
        generation: json["generation"],
        idempotencyKey: json["idempotencyKey"],
        nativeInstanceRef: json["nativeInstanceRef"],
        nativeScopeRef: json["nativeScopeRef"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "configDigest": configDigest,
    "generation": generation,
    "idempotencyKey": idempotencyKey,
    "nativeInstanceRef": nativeInstanceRef,
    "nativeScopeRef": nativeScopeRef,
  });
}

///ADR-12 执行响应分离原生任务观察与能力结果。HTTP 接收不是终态；resultJson 只在原生 SUCCEEDED 且符合固定结果 schema 时消费。它不进入
///Core 的套件报告。
class AdapterExecutionResponse {
  final ContentReference? contentReference;

  ///来源 citation 的 typed 槽；与固定结果 schema 中 citations 逐项一致。它不是源正文读取证明，打开来源时重新授权。
  final List<ContentReference>? contentReferences;
  final AdapterExecutionObservation execution;
  final String? resultJson;
  final List<AdapterSourceResource>? sourceResources;

  AdapterExecutionResponse({
    this.contentReference,
    this.contentReferences,
    required this.execution,
    this.resultJson,
    this.sourceResources,
  });

  factory AdapterExecutionResponse.fromJson(Map<String, dynamic> json) =>
      AdapterExecutionResponse(
        contentReference: json["contentReference"] == null
            ? null
            : ContentReference.fromJson(json["contentReference"]),
        contentReferences: json["contentReferences"] == null
            ? null
            : List<ContentReference>.from(
                json["contentReferences"]!.map(
                  (x) => ContentReference.fromJson(x),
                ),
              ),
        execution: AdapterExecutionObservation.fromJson(json["execution"]),
        resultJson: json["resultJson"],
        sourceResources: json["sourceResources"] == null
            ? null
            : List<AdapterSourceResource>.from(
                json["sourceResources"]!.map(
                  (x) => AdapterSourceResource.fromJson(x),
                ),
              ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "contentReference": contentReference?.toJson(),
    "contentReferences": contentReferences == null
        ? null
        : List<dynamic>.from(contentReferences!.map((x) => x.toJson())),
    "execution": execution.toJson(),
    "resultJson": resultJson,
    "sourceResources": sourceResources == null
        ? null
        : List<dynamic>.from(sourceResources!.map((x) => x.toJson())),
  });
}

///Actual native planner source within the existing execution binding. Metadata only:
///neither SQL/content nor a grant. The original action and result-exposure authority must
///authorize every resolved Resource.
class AdapterSourceResource {
  final String nativeRef;
  final String nativeType;

  AdapterSourceResource({required this.nativeRef, required this.nativeType});

  factory AdapterSourceResource.fromJson(Map<String, dynamic> json) =>
      AdapterSourceResource(
        nativeRef: json["nativeRef"],
        nativeType: json["nativeType"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"nativeRef": nativeRef, "nativeType": nativeType});
}

///DD-48/51/94 extract_usage 的原生终态用量元数据；scope/customer/dimensions 只由 Core 原
///ExternalExecution 决定。完整集合与冻结 action meters 精确相等，缺失不是零。
class AdapterExecutionUsage {
  final String externalExecutionId;
  final String idempotencyKey;
  final List<AdapterExecutionUsageMeasurementsItem> measurements;
  final String nativeId;
  final String nativeType;

  AdapterExecutionUsage({
    required this.externalExecutionId,
    required this.idempotencyKey,
    required this.measurements,
    required this.nativeId,
    required this.nativeType,
  });

  factory AdapterExecutionUsage.fromJson(Map<String, dynamic> json) =>
      AdapterExecutionUsage(
        externalExecutionId: json["externalExecutionId"],
        idempotencyKey: json["idempotencyKey"],
        measurements: List<AdapterExecutionUsageMeasurementsItem>.from(
          json["measurements"].map(
            (x) => AdapterExecutionUsageMeasurementsItem.fromJson(x),
          ),
        ),
        nativeId: json["nativeId"],
        nativeType: json["nativeType"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "externalExecutionId": externalExecutionId,
    "idempotencyKey": idempotencyKey,
    "measurements": List<dynamic>.from(measurements.map((x) => x.toJson())),
    "nativeId": nativeId,
    "nativeType": nativeType,
  });
}

class AdapterExecutionUsageMeasurementsItem {
  final String meterKey;
  final String occurredAt;
  final int quantity;

  AdapterExecutionUsageMeasurementsItem({
    required this.meterKey,
    required this.occurredAt,
    required this.quantity,
  });

  factory AdapterExecutionUsageMeasurementsItem.fromJson(
    Map<String, dynamic> json,
  ) => AdapterExecutionUsageMeasurementsItem(
    meterKey: json["meterKey"],
    occurredAt: json["occurredAt"],
    quantity: json["quantity"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "meterKey": meterKey,
    "occurredAt": occurredAt,
    "quantity": quantity,
  });
}

///绑定 SERVICE 领取原已派发 HUMAN COMPONENT_ACTION 的既存 native task 未消费步骤；不创建执行或延长期限。
class NativeTaskExecutionAdmissionRequest {
  final String actionExecutionId;
  final String bindingId;
  final AdapterExecutionReference execution;

  ///首次 dispatch 审计时间与冻结声明期限得出的原 RFC3339 截止时间，不接受续期。
  final String nativeTaskDeadline;

  NativeTaskExecutionAdmissionRequest({
    required this.actionExecutionId,
    required this.bindingId,
    required this.execution,
    required this.nativeTaskDeadline,
  });

  factory NativeTaskExecutionAdmissionRequest.fromJson(
    Map<String, dynamic> json,
  ) => NativeTaskExecutionAdmissionRequest(
    actionExecutionId: json["actionExecutionId"],
    bindingId: json["bindingId"],
    execution: AdapterExecutionReference.fromJson(json["execution"]),
    nativeTaskDeadline: json["nativeTaskDeadline"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "bindingId": bindingId,
    "execution": execution.toJson(),
    "nativeTaskDeadline": nativeTaskDeadline,
  });
}

///原 ExternalExecution 的 observe/extract_usage 引用；不携带正文，不新建执行，不接受引用自报 scope。nativeId
///未取得时只用冻结幂等键查证。
class AdapterExecutionReference {
  final String externalExecutionId;
  final String idempotencyKey;
  final String? nativeId;
  final String nativeType;

  AdapterExecutionReference({
    required this.externalExecutionId,
    required this.idempotencyKey,
    this.nativeId,
    required this.nativeType,
  });

  factory AdapterExecutionReference.fromJson(Map<String, dynamic> json) =>
      AdapterExecutionReference(
        externalExecutionId: json["externalExecutionId"],
        idempotencyKey: json["idempotencyKey"],
        nativeId: json["nativeId"],
        nativeType: json["nativeType"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "externalExecutionId": externalExecutionId,
    "idempotencyKey": idempotencyKey,
    "nativeId": nativeId,
    "nativeType": nativeType,
  });
}

///仅当次原任务执行上下文可用的票据；原生任务不得持久化票据或参数凭据。
class NativeTaskExecutionAdmissionResponse {
  final String? actionToken;
  final String? argumentsJson;
  final String? expiresAt;
  final String nativeTaskDeadline;
  final NativeTaskAdmissionState state;

  NativeTaskExecutionAdmissionResponse({
    this.actionToken,
    this.argumentsJson,
    this.expiresAt,
    required this.nativeTaskDeadline,
    required this.state,
  });

  factory NativeTaskExecutionAdmissionResponse.fromJson(
    Map<String, dynamic> json,
  ) => NativeTaskExecutionAdmissionResponse(
    actionToken: json["actionToken"],
    argumentsJson: json["argumentsJson"],
    expiresAt: json["expiresAt"],
    nativeTaskDeadline: json["nativeTaskDeadline"],
    state: nativeTaskAdmissionStateValues.map[json["state"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionToken": actionToken,
    "argumentsJson": argumentsJson,
    "expiresAt": expiresAt,
    "nativeTaskDeadline": nativeTaskDeadline,
    "state": nativeTaskAdmissionStateValues.reverse[state],
  });
}

///单次原生任务准入查询结果，不是新的持久任务生命周期。PENDING_REFERENCE 无票据；ADMITTED 才允许消费原任务尚未领取步骤。
enum NativeTaskAdmissionState { ADMITTED, PENDING_REFERENCE }

final nativeTaskAdmissionStateValues = EnumValues({
  "ADMITTED": NativeTaskAdmissionState.ADMITTED,
  "PENDING_REFERENCE": NativeTaskAdmissionState.PENDING_REFERENCE,
});

///ADR-12
///adapter入站fresh校验。ActionToken只瞬时校验、不入history或审计正文；参数由原ActionToken摘要绑定，binding由受认证client精确匹配。
class AdapterPepCheckRequest {
  final String actionToken;
  final String argumentsJson;
  final String bindingId;
  final ContentReference? contentReference;
  final String operation;
  final List<AdapterSourceResource>? sourceResources;

  AdapterPepCheckRequest({
    required this.actionToken,
    required this.argumentsJson,
    required this.bindingId,
    this.contentReference,
    required this.operation,
    this.sourceResources,
  });

  factory AdapterPepCheckRequest.fromJson(Map<String, dynamic> json) =>
      AdapterPepCheckRequest(
        actionToken: json["actionToken"],
        argumentsJson: json["argumentsJson"],
        bindingId: json["bindingId"],
        contentReference: json["contentReference"] == null
            ? null
            : ContentReference.fromJson(json["contentReference"]),
        operation: json["operation"],
        sourceResources: json["sourceResources"] == null
            ? null
            : List<AdapterSourceResource>.from(
                json["sourceResources"]!.map(
                  (x) => AdapterSourceResource.fromJson(x),
                ),
              ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionToken": actionToken,
    "argumentsJson": argumentsJson,
    "bindingId": bindingId,
    "contentReference": contentReference?.toJson(),
    "operation": operation,
    "sourceResources": sourceResources == null
        ? null
        : List<dynamic>.from(sourceResources!.map((x) => x.toJson())),
  });
}

///只在原动作和精确binding仍被fresh授权时返回当前授权revision；不是可复用的新授权票据。
class AdapterPepCheckResponse {
  final String actionExecutionId;
  final String authorizationMinZedToken;

  ///原业务 AE 冻结的 component_projection_generation；由 Core 核验同 binding 后返回，不从调用方 token
  ///扩展或当前部署配置推断。缺省时原生任务不得新建代次归属。
  final int? bindingGeneration;

  ///仅声明原生异步任务执行期限的 HUMAN COMPONENT_ACTION 返回；原首次 dispatch 时间加已批准声明的期限，RFC3339，不随本次 fresh
  ///Check 续期。
  final String? nativeTaskDeadline;
  final String operationId;

  ///本次已授权 execute 的 Resource 与其 binding 原生引用事实；不是新授权票据。缺省时消费者不得推断对象身份。
  final AdapterAuthorizedResource? targetResource;

  AdapterPepCheckResponse({
    required this.actionExecutionId,
    required this.authorizationMinZedToken,
    this.bindingGeneration,
    this.nativeTaskDeadline,
    required this.operationId,
    this.targetResource,
  });

  factory AdapterPepCheckResponse.fromJson(Map<String, dynamic> json) =>
      AdapterPepCheckResponse(
        actionExecutionId: json["actionExecutionId"],
        authorizationMinZedToken: json["authorizationMinZedToken"],
        bindingGeneration: json["bindingGeneration"],
        nativeTaskDeadline: json["nativeTaskDeadline"],
        operationId: json["operationId"],
        targetResource: json["targetResource"] == null
            ? null
            : AdapterAuthorizedResource.fromJson(json["targetResource"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "authorizationMinZedToken": authorizationMinZedToken,
    "bindingGeneration": bindingGeneration,
    "nativeTaskDeadline": nativeTaskDeadline,
    "operationId": operationId,
    "targetResource": targetResource?.toJson(),
  });
}

///本次已授权 execute 的 Resource 与其 binding 原生引用事实；不是新授权票据。缺省时消费者不得推断对象身份。
class AdapterAuthorizedResource {
  final String nativeInstanceRef;
  final String nativeRef;
  final String nativeScopeRef;
  final String nativeType;
  final String resourceId;

  AdapterAuthorizedResource({
    required this.nativeInstanceRef,
    required this.nativeRef,
    required this.nativeScopeRef,
    required this.nativeType,
    required this.resourceId,
  });

  factory AdapterAuthorizedResource.fromJson(Map<String, dynamic> json) =>
      AdapterAuthorizedResource(
        nativeInstanceRef: json["nativeInstanceRef"],
        nativeRef: json["nativeRef"],
        nativeScopeRef: json["nativeScopeRef"],
        nativeType: json["nativeType"],
        resourceId: json["resourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nativeInstanceRef": nativeInstanceRef,
    "nativeRef": nativeRef,
    "nativeScopeRef": nativeScopeRef,
    "nativeType": nativeType,
    "resourceId": resourceId,
  });
}

///18: execute the original admitted file protocol Session, not an arbitrary editor URL or
///native object create. All fields are frozen Core facts and the whole body is covered by
///ActionToken.
class AdapterProtocolSessionLaunchRequest {
  final ProtocolSessionMode admittedMode;
  final String authorizationTargetNativeRef;
  final String expiresAt;
  final String idempotencyKey;
  final ProtocolSessionLocale locale;
  final String protocolSessionId;
  final ContentReference reference;
  final ProtocolSessionTheme theme;

  AdapterProtocolSessionLaunchRequest({
    required this.admittedMode,
    required this.authorizationTargetNativeRef,
    required this.expiresAt,
    required this.idempotencyKey,
    required this.locale,
    required this.protocolSessionId,
    required this.reference,
    required this.theme,
  });

  factory AdapterProtocolSessionLaunchRequest.fromJson(
    Map<String, dynamic> json,
  ) => AdapterProtocolSessionLaunchRequest(
    admittedMode: protocolSessionModeValues.map[json["admittedMode"]]!,
    authorizationTargetNativeRef: json["authorizationTargetNativeRef"],
    expiresAt: json["expiresAt"],
    idempotencyKey: json["idempotencyKey"],
    locale: protocolSessionLocaleValues.map[json["locale"]]!,
    protocolSessionId: json["protocolSessionId"],
    reference: ContentReference.fromJson(json["reference"]),
    theme: protocolSessionThemeValues.map[json["theme"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "admittedMode": protocolSessionModeValues.reverse[admittedMode],
    "authorizationTargetNativeRef": authorizationTargetNativeRef,
    "expiresAt": expiresAt,
    "idempotencyKey": idempotencyKey,
    "locale": protocolSessionLocaleValues.reverse[locale],
    "protocolSessionId": protocolSessionId,
    "reference": reference.toJson(),
    "theme": protocolSessionThemeValues.reverse[theme],
  });
}

enum ProtocolSessionMode { EDIT, VIEW }

final protocolSessionModeValues = EnumValues({
  "EDIT": ProtocolSessionMode.EDIT,
  "VIEW": ProtocolSessionMode.VIEW,
});

enum ProtocolSessionLocale { EN, ZH_CN }

final protocolSessionLocaleValues = EnumValues({
  "en": ProtocolSessionLocale.EN,
  "zh-CN": ProtocolSessionLocale.ZH_CN,
});

enum ProtocolSessionTheme { DARK, LIGHT }

final protocolSessionThemeValues = EnumValues({
  "DARK": ProtocolSessionTheme.DARK,
  "LIGHT": ProtocolSessionTheme.LIGHT,
});

///18: the original native PAT reference plus transient launch descriptor. This value occurs
///only in the original execute response; it must not be stored as reconciliation evidence
///or recovered by reminting a token.
class AdapterProtocolSessionLaunchResponse {
  final DocumentLaunchDescriptor launchDescriptor;
  final String nativeSessionRef;

  AdapterProtocolSessionLaunchResponse({
    required this.launchDescriptor,
    required this.nativeSessionRef,
  });

  factory AdapterProtocolSessionLaunchResponse.fromJson(
    Map<String, dynamic> json,
  ) => AdapterProtocolSessionLaunchResponse(
    launchDescriptor: DocumentLaunchDescriptor.fromJson(
      json["launchDescriptor"],
    ),
    nativeSessionRef: json["nativeSessionRef"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "launchDescriptor": launchDescriptor.toJson(),
    "nativeSessionRef": nativeSessionRef,
  });
}

///DD-95/103: transient, fixed-origin launch returned by the admitted binding adapter;
///credentials are only string form fields, never a persisted Task, chat or ContentReference.
class DocumentLaunchDescriptor {
  final String actionUrl;
  final String editorOrigin;
  final String expiresAt;
  final Map<String, String> formFields;
  final DocumentLaunchDescriptorMethod method;

  DocumentLaunchDescriptor({
    required this.actionUrl,
    required this.editorOrigin,
    required this.expiresAt,
    required this.formFields,
    required this.method,
  });

  factory DocumentLaunchDescriptor.fromJson(Map<String, dynamic> json) =>
      DocumentLaunchDescriptor(
        actionUrl: json["actionUrl"],
        editorOrigin: json["editorOrigin"],
        expiresAt: json["expiresAt"],
        formFields: Map.from(
          json["formFields"],
        ).map((k, v) => MapEntry<String, String>(k, v)),
        method: documentLaunchDescriptorMethodValues.map[json["method"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionUrl": actionUrl,
    "editorOrigin": editorOrigin,
    "expiresAt": expiresAt,
    "formFields": Map.from(
      formFields,
    ).map((k, v) => MapEntry<String, dynamic>(k, v)),
    "method": documentLaunchDescriptorMethodValues.reverse[method],
  });
}

enum DocumentLaunchDescriptorMethod { GET, POST }

final documentLaunchDescriptorMethodValues = EnumValues({
  "GET": DocumentLaunchDescriptorMethod.GET,
  "POST": DocumentLaunchDescriptorMethod.POST,
});

///DD-90, 18 §5.1: binding-authenticated permission to observe/revoke the original document
///PAT. These closed lifecycle facts never authorize file reads, writes or token creation.
class ProtocolSessionLifecyclePepResponse {
  final ProtocolSessionLifecyclePepResponseDecision decision;
  final String expiresAt;
  final String nativeObjectRef;
  final String protocolSessionId;
  final ProtocolSessionMode requestedMode;

  ProtocolSessionLifecyclePepResponse({
    required this.decision,
    required this.expiresAt,
    required this.nativeObjectRef,
    required this.protocolSessionId,
    required this.requestedMode,
  });

  factory ProtocolSessionLifecyclePepResponse.fromJson(
    Map<String, dynamic> json,
  ) => ProtocolSessionLifecyclePepResponse(
    decision: protocolSessionLifecyclePepResponseDecisionValues
        .map[json["decision"]]!,
    expiresAt: json["expiresAt"],
    nativeObjectRef: json["nativeObjectRef"],
    protocolSessionId: json["protocolSessionId"],
    requestedMode: protocolSessionModeValues.map[json["requestedMode"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "decision":
        protocolSessionLifecyclePepResponseDecisionValues.reverse[decision],
    "expiresAt": expiresAt,
    "nativeObjectRef": nativeObjectRef,
    "protocolSessionId": protocolSessionId,
    "requestedMode": protocolSessionModeValues.reverse[requestedMode],
  });
}

enum ProtocolSessionLifecyclePepResponseDecision { ALLOW }

final protocolSessionLifecyclePepResponseDecisionValues = EnumValues({
  "ALLOW": ProtocolSessionLifecyclePepResponseDecision.ALLOW,
});

///18 §5.1: observe/cancel the same native document PAT only. No access token, launch
///descriptor or file bytes.
class AdapterProtocolSessionLifecycleRequest {
  final String idempotencyKey;
  final String nativeObjectRef;
  final String protocolSessionId;

  AdapterProtocolSessionLifecycleRequest({
    required this.idempotencyKey,
    required this.nativeObjectRef,
    required this.protocolSessionId,
  });

  factory AdapterProtocolSessionLifecycleRequest.fromJson(
    Map<String, dynamic> json,
  ) => AdapterProtocolSessionLifecycleRequest(
    idempotencyKey: json["idempotencyKey"],
    nativeObjectRef: json["nativeObjectRef"],
    protocolSessionId: json["protocolSessionId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "idempotencyKey": idempotencyKey,
    "nativeObjectRef": nativeObjectRef,
    "protocolSessionId": protocolSessionId,
  });
}

///Original Cells PAT metadata only. ABSENT is a successful native lookup; errors must
///remain unavailable, never ABSENT.
class AdapterProtocolSessionLifecycleResponse {
  final String? expiresAt;
  final String nativeObjectRef;
  final String? nativeSessionRef;
  final AdapterProtocolSessionLifecycleResponseNativeState nativeState;
  final String protocolSessionId;

  AdapterProtocolSessionLifecycleResponse({
    this.expiresAt,
    required this.nativeObjectRef,
    this.nativeSessionRef,
    required this.nativeState,
    required this.protocolSessionId,
  });

  factory AdapterProtocolSessionLifecycleResponse.fromJson(
    Map<String, dynamic> json,
  ) => AdapterProtocolSessionLifecycleResponse(
    expiresAt: json["expiresAt"],
    nativeObjectRef: json["nativeObjectRef"],
    nativeSessionRef: json["nativeSessionRef"],
    nativeState: adapterProtocolSessionLifecycleResponseNativeStateValues
        .map[json["nativeState"]]!,
    protocolSessionId: json["protocolSessionId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "expiresAt": expiresAt,
    "nativeObjectRef": nativeObjectRef,
    "nativeSessionRef": nativeSessionRef,
    "nativeState": adapterProtocolSessionLifecycleResponseNativeStateValues
        .reverse[nativeState],
    "protocolSessionId": protocolSessionId,
  });
}

enum AdapterProtocolSessionLifecycleResponseNativeState {
  ABSENT,
  ACTIVE,
  EXPIRED,
}

final adapterProtocolSessionLifecycleResponseNativeStateValues = EnumValues({
  "ABSENT": AdapterProtocolSessionLifecycleResponseNativeState.ABSENT,
  "ACTIVE": AdapterProtocolSessionLifecycleResponseNativeState.ACTIVE,
  "EXPIRED": AdapterProtocolSessionLifecycleResponseNativeState.EXPIRED,
});

///18 §5.2: authenticated binding→Core PEP for an existing ProtocolSession. No native token
///grants platform permissions.
class ProtocolSessionPepRequest {
  final String bindingId;
  final String nativeObjectRef;
  final ProtocolSessionPepRequestNativeOperation nativeOperation;
  final String protocolSessionId;
  final ProtocolWriteObservation? writeObservation;

  ProtocolSessionPepRequest({
    required this.bindingId,
    required this.nativeObjectRef,
    required this.nativeOperation,
    required this.protocolSessionId,
    this.writeObservation,
  });

  factory ProtocolSessionPepRequest.fromJson(Map<String, dynamic> json) =>
      ProtocolSessionPepRequest(
        bindingId: json["bindingId"],
        nativeObjectRef: json["nativeObjectRef"],
        nativeOperation: protocolSessionPepRequestNativeOperationValues
            .map[json["nativeOperation"]]!,
        protocolSessionId: json["protocolSessionId"],
        writeObservation: json["writeObservation"] == null
            ? null
            : ProtocolWriteObservation.fromJson(json["writeObservation"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "nativeObjectRef": nativeObjectRef,
    "nativeOperation":
        protocolSessionPepRequestNativeOperationValues.reverse[nativeOperation],
    "protocolSessionId": protocolSessionId,
    "writeObservation": writeObservation?.toJson(),
  });
}

enum ProtocolSessionPepRequestNativeOperation {
  OBSERVE,
  OPEN,
  READ,
  TOKEN_OBSERVE,
  TOKEN_REVOKE,
  WRITE,
}

final protocolSessionPepRequestNativeOperationValues = EnumValues({
  "OBSERVE": ProtocolSessionPepRequestNativeOperation.OBSERVE,
  "OPEN": ProtocolSessionPepRequestNativeOperation.OPEN,
  "READ": ProtocolSessionPepRequestNativeOperation.READ,
  "TOKEN_OBSERVE": ProtocolSessionPepRequestNativeOperation.TOKEN_OBSERVE,
  "TOKEN_REVOKE": ProtocolSessionPepRequestNativeOperation.TOKEN_REVOKE,
  "WRITE": ProtocolSessionPepRequestNativeOperation.WRITE,
});

///18 §5.4: authenticated native PutFile evidence for the existing ProtocolSession; never
///file bytes or an authorization grant.
class ProtocolWriteObservation {
  final String baseModifiedAt;
  final int bytesWritten;
  final String correlationRef;
  final String editors;
  final String? nativeEtag;
  final ProtocolWriteObservationPhase phase;
  final String? resultRevision;

  ProtocolWriteObservation({
    required this.baseModifiedAt,
    required this.bytesWritten,
    required this.correlationRef,
    required this.editors,
    this.nativeEtag,
    required this.phase,
    this.resultRevision,
  });

  factory ProtocolWriteObservation.fromJson(Map<String, dynamic> json) =>
      ProtocolWriteObservation(
        baseModifiedAt: json["baseModifiedAt"],
        bytesWritten: json["bytesWritten"],
        correlationRef: json["correlationRef"],
        editors: json["editors"],
        nativeEtag: json["nativeEtag"],
        phase: protocolWriteObservationPhaseValues.map[json["phase"]]!,
        resultRevision: json["resultRevision"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "baseModifiedAt": baseModifiedAt,
    "bytesWritten": bytesWritten,
    "correlationRef": correlationRef,
    "editors": editors,
    "nativeEtag": nativeEtag,
    "phase": protocolWriteObservationPhaseValues.reverse[phase],
    "resultRevision": resultRevision,
  });
}

enum ProtocolWriteObservationPhase {
  ACCEPTED,
  CONFLICT,
  FAILED,
  STARTED,
  UNKNOWN,
}

final protocolWriteObservationPhaseValues = EnumValues({
  "ACCEPTED": ProtocolWriteObservationPhase.ACCEPTED,
  "CONFLICT": ProtocolWriteObservationPhase.CONFLICT,
  "FAILED": ProtocolWriteObservationPhase.FAILED,
  "STARTED": ProtocolWriteObservationPhase.STARTED,
  "UNKNOWN": ProtocolWriteObservationPhase.UNKNOWN,
});

///Original Session facts, not native revision existence or write success. Cells must still
///query its exact VersionId and ACLs.
class ProtocolSessionPepResponse {
  final ProtocolSessionMode admittedMode;
  final String baseRevision;
  final ProtocolSessionLifecyclePepResponseDecision decision;
  final String displayName;
  final String expiresAt;
  final bool exportAllowed;
  final String minZedToken;

  ///Confirmed original native token/session reference. Required by native READ/WRITE
  ///consumers, absent before the first native OPEN creation.
  final String? nativeSessionRef;

  ///Original active issuer from the HUMAN's frozen ExternalIdentity, never a browser-supplied
  ///claim.
  final String oidcIssuer;

  ///Original active subject paired with oidcIssuer. Cells resolves its existing explicit
  ///native user link; no email or display-name fallback.
  final String oidcSubject;
  final String platformHumanId;

  ///Exact canonical platform PUBLIC_ORIGIN from the Core deployment, never the native request
  ///Origin or a browser-supplied field. Required by the native FileInfo consumer; unavailable
  ///origin refuses its editor projection.
  final String? postMessageOrigin;

  ProtocolSessionPepResponse({
    required this.admittedMode,
    required this.baseRevision,
    required this.decision,
    required this.displayName,
    required this.expiresAt,
    required this.exportAllowed,
    required this.minZedToken,
    this.nativeSessionRef,
    required this.oidcIssuer,
    required this.oidcSubject,
    required this.platformHumanId,
    this.postMessageOrigin,
  });

  factory ProtocolSessionPepResponse.fromJson(Map<String, dynamic> json) =>
      ProtocolSessionPepResponse(
        admittedMode: protocolSessionModeValues.map[json["admittedMode"]]!,
        baseRevision: json["baseRevision"],
        decision: protocolSessionLifecyclePepResponseDecisionValues
            .map[json["decision"]]!,
        displayName: json["displayName"],
        expiresAt: json["expiresAt"],
        exportAllowed: json["exportAllowed"],
        minZedToken: json["minZedToken"],
        nativeSessionRef: json["nativeSessionRef"],
        oidcIssuer: json["oidcIssuer"],
        oidcSubject: json["oidcSubject"],
        platformHumanId: json["platformHumanId"],
        postMessageOrigin: json["postMessageOrigin"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "admittedMode": protocolSessionModeValues.reverse[admittedMode],
    "baseRevision": baseRevision,
    "decision":
        protocolSessionLifecyclePepResponseDecisionValues.reverse[decision],
    "displayName": displayName,
    "expiresAt": expiresAt,
    "exportAllowed": exportAllowed,
    "minZedToken": minZedToken,
    "nativeSessionRef": nativeSessionRef,
    "oidcIssuer": oidcIssuer,
    "oidcSubject": oidcSubject,
    "platformHumanId": platformHumanId,
    "postMessageOrigin": postMessageOrigin,
  });
}

///Receipt of native write evidence. It grants no read or write permission.
class ProtocolWriteReceipt {
  final String protocolSessionId;
  final ProtocolWriteReceiptState state;

  ProtocolWriteReceipt({required this.protocolSessionId, required this.state});

  factory ProtocolWriteReceipt.fromJson(Map<String, dynamic> json) =>
      ProtocolWriteReceipt(
        protocolSessionId: json["protocolSessionId"],
        state: protocolWriteReceiptStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "protocolSessionId": protocolSessionId,
    "state": protocolWriteReceiptStateValues.reverse[state],
  });
}

enum ProtocolWriteReceiptState { CONFLICT, DIRTY, FAILED, SAVED, UNKNOWN }

final protocolWriteReceiptStateValues = EnumValues({
  "CONFLICT": ProtocolWriteReceiptState.CONFLICT,
  "DIRTY": ProtocolWriteReceiptState.DIRTY,
  "FAILED": ProtocolWriteReceiptState.FAILED,
  "SAVED": ProtocolWriteReceiptState.SAVED,
  "UNKNOWN": ProtocolWriteReceiptState.UNKNOWN,
});

///
///07§5.2与ADR-12：查询同一native对象当前权威revision；ActionToken通过Authorization头传输，幂等键与Idempotency-Key头一致。authorizationTargetNativeRef仅为Core从实际受权Resource/Asset解析的原生目标定位，参与同一参数签名；adapter须核实被查对象在该目标及固定binding
///scope内。缺省保持确切目标查询，不授予一般子对象读取。不是execute或权限授予。
class AdapterQueryRevisionRequest {
  final String? authorizationTargetNativeRef;
  final String idempotencyKey;
  final String nativeObjectRef;
  final ProtocolRevisionQuery? protocolReconcile;

  AdapterQueryRevisionRequest({
    this.authorizationTargetNativeRef,
    required this.idempotencyKey,
    required this.nativeObjectRef,
    this.protocolReconcile,
  });

  factory AdapterQueryRevisionRequest.fromJson(Map<String, dynamic> json) =>
      AdapterQueryRevisionRequest(
        authorizationTargetNativeRef: json["authorizationTargetNativeRef"],
        idempotencyKey: json["idempotencyKey"],
        nativeObjectRef: json["nativeObjectRef"],
        protocolReconcile: json["protocolReconcile"] == null
            ? null
            : ProtocolRevisionQuery.fromJson(json["protocolReconcile"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "authorizationTargetNativeRef": authorizationTargetNativeRef,
    "idempotencyKey": idempotencyKey,
    "nativeObjectRef": nativeObjectRef,
    "protocolReconcile": protocolReconcile?.toJson(),
  });
}

///DD-90/18§5.4：原保存结果不明会话的确切写入证据查证；只核已有 ACCEPTED writer observation 对应的原生
///VersionId，不提供文件字节或当前权限。
class ProtocolRevisionQuery {
  final String baseRevision;
  final String protocolSessionId;
  final ProtocolWriteObservation writeObservation;

  ProtocolRevisionQuery({
    required this.baseRevision,
    required this.protocolSessionId,
    required this.writeObservation,
  });

  factory ProtocolRevisionQuery.fromJson(Map<String, dynamic> json) =>
      ProtocolRevisionQuery(
        baseRevision: json["baseRevision"],
        protocolSessionId: json["protocolSessionId"],
        writeObservation: ProtocolWriteObservation.fromJson(
          json["writeObservation"],
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "baseRevision": baseRevision,
    "protocolSessionId": protocolSessionId,
    "writeObservation": writeObservation.toJson(),
  });
}

///
///07§5.2与18§5：只返回被查证同一native对象当前权威revision，不替换调用方冻结ContentReference、不以mtime/ETag猜测revision。未知或fresh授权失败不得生成成功应答。
class AdapterQueryRevisionResponse {
  final String? correlationRef;
  final String nativeObjectRef;
  final String nativeRevision;
  final String? protocolSessionId;

  AdapterQueryRevisionResponse({
    this.correlationRef,
    required this.nativeObjectRef,
    required this.nativeRevision,
    this.protocolSessionId,
  });

  factory AdapterQueryRevisionResponse.fromJson(Map<String, dynamic> json) =>
      AdapterQueryRevisionResponse(
        correlationRef: json["correlationRef"],
        nativeObjectRef: json["nativeObjectRef"],
        nativeRevision: json["nativeRevision"],
        protocolSessionId: json["protocolSessionId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "correlationRef": correlationRef,
    "nativeObjectRef": nativeObjectRef,
    "nativeRevision": nativeRevision,
    "protocolSessionId": protocolSessionId,
  });
}

///DD-89: short-lived source Adapter authorization, not native credentials or proof that the
///batch finished. The endpoint is resolved from the existing controlled adapter directory.
class AdapterReadGrantResponse {
  final String actionExecutionId;
  final String? actionToken;
  final String? argumentsJson;
  final String? endpoint;
  final int? expiresAt;
  final String operationId;

  ///Native retry observation. COMPLETED requires both immutable receipts and committed usage;
  ///UNKNOWN/PENDING carry no renewed authorization.
  final AdapterReadGrantResponseOutcome? outcome;

  ///仅 COMPLETED 观察返回同一 Operation 已核实的原接收方子执行引用。
  final String? receiverActionExecutionId;

  ///仅 COMPLETED 观察返回原子执行冻结的 receiver generation，不是当前绑定代次。
  final int? receiverGeneration;
  final AdapterReadReceipt? receiverReceipt;

  ///Separate governed receiver action in the same read Operation. The native importer must
  ///perform the existing authenticated PEP check with this token immediately before its
  ///write; issuance is not completion.
  final AdapterReadGrantResponseReceiverWrite? receiverWrite;
  final String sourceBindingId;

  ///仅原生批次 COMPLETED 观察返回已保存的 SOURCE 回执；不是新的读取授权。
  final AdapterReadReceipt? sourceReceipt;

  AdapterReadGrantResponse({
    required this.actionExecutionId,
    this.actionToken,
    this.argumentsJson,
    this.endpoint,
    this.expiresAt,
    required this.operationId,
    this.outcome,
    this.receiverActionExecutionId,
    this.receiverGeneration,
    this.receiverReceipt,
    this.receiverWrite,
    required this.sourceBindingId,
    this.sourceReceipt,
  });

  factory AdapterReadGrantResponse.fromJson(Map<String, dynamic> json) =>
      AdapterReadGrantResponse(
        actionExecutionId: json["actionExecutionId"],
        actionToken: json["actionToken"],
        argumentsJson: json["argumentsJson"],
        endpoint: json["endpoint"],
        expiresAt: json["expiresAt"],
        operationId: json["operationId"],
        outcome: json["outcome"] == null
            ? null
            : adapterReadGrantResponseOutcomeValues.map[json["outcome"]]!,
        receiverActionExecutionId: json["receiverActionExecutionId"],
        receiverGeneration: json["receiverGeneration"],
        receiverReceipt: json["receiverReceipt"] == null
            ? null
            : AdapterReadReceipt.fromJson(json["receiverReceipt"]),
        receiverWrite: json["receiverWrite"] == null
            ? null
            : AdapterReadGrantResponseReceiverWrite.fromJson(
                json["receiverWrite"],
              ),
        sourceBindingId: json["sourceBindingId"],
        sourceReceipt: json["sourceReceipt"] == null
            ? null
            : AdapterReadReceipt.fromJson(json["sourceReceipt"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionToken": actionToken,
    "argumentsJson": argumentsJson,
    "endpoint": endpoint,
    "expiresAt": expiresAt,
    "operationId": operationId,
    "outcome": adapterReadGrantResponseOutcomeValues.reverse[outcome],
    "receiverActionExecutionId": receiverActionExecutionId,
    "receiverGeneration": receiverGeneration,
    "receiverReceipt": receiverReceipt?.toJson(),
    "receiverWrite": receiverWrite?.toJson(),
    "sourceBindingId": sourceBindingId,
    "sourceReceipt": sourceReceipt?.toJson(),
  });
}

///Native retry observation. COMPLETED requires both immutable receipts and committed usage;
///UNKNOWN/PENDING carry no renewed authorization.
enum AdapterReadGrantResponseOutcome { COMPLETED, PENDING, UNKNOWN }

final adapterReadGrantResponseOutcomeValues = EnumValues({
  "COMPLETED": AdapterReadGrantResponseOutcome.COMPLETED,
  "PENDING": AdapterReadGrantResponseOutcome.PENDING,
  "UNKNOWN": AdapterReadGrantResponseOutcome.UNKNOWN,
});

///DD-89: authenticated native source-read or completed receiver-import metadata for one
///original SERVICE Operation; never file bodies or credentials.
///
///仅原生批次 COMPLETED 观察返回已保存的 SOURCE 回执；不是新的读取授权。
class AdapterReadReceipt {
  final String bindingId;

  ///Original native RFC3339 timestamp; Core validates it without rewriting the native
  ///representation.
  final String completedAt;
  final int contentBytes;
  final String contentSha256;
  final String idempotencyKey;
  final List<AdapterReadReceiptMeasurementsItem> measurements;
  final String nativeObjectRef;
  final String nativeRevision;
  final String operationId;
  final ApplicationReadResourceDirection role;

  AdapterReadReceipt({
    required this.bindingId,
    required this.completedAt,
    required this.contentBytes,
    required this.contentSha256,
    required this.idempotencyKey,
    required this.measurements,
    required this.nativeObjectRef,
    required this.nativeRevision,
    required this.operationId,
    required this.role,
  });

  factory AdapterReadReceipt.fromJson(Map<String, dynamic> json) =>
      AdapterReadReceipt(
        bindingId: json["bindingId"],
        completedAt: json["completedAt"],
        contentBytes: json["contentBytes"],
        contentSha256: json["contentSha256"],
        idempotencyKey: json["idempotencyKey"],
        measurements: List<AdapterReadReceiptMeasurementsItem>.from(
          json["measurements"].map(
            (x) => AdapterReadReceiptMeasurementsItem.fromJson(x),
          ),
        ),
        nativeObjectRef: json["nativeObjectRef"],
        nativeRevision: json["nativeRevision"],
        operationId: json["operationId"],
        role: applicationReadResourceDirectionValues.map[json["role"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "completedAt": completedAt,
    "contentBytes": contentBytes,
    "contentSha256": contentSha256,
    "idempotencyKey": idempotencyKey,
    "measurements": List<dynamic>.from(measurements.map((x) => x.toJson())),
    "nativeObjectRef": nativeObjectRef,
    "nativeRevision": nativeRevision,
    "operationId": operationId,
    "role": applicationReadResourceDirectionValues.reverse[role],
  });
}

class AdapterReadReceiptMeasurementsItem {
  final String meterKey;
  final int quantity;

  AdapterReadReceiptMeasurementsItem({
    required this.meterKey,
    required this.quantity,
  });

  factory AdapterReadReceiptMeasurementsItem.fromJson(
    Map<String, dynamic> json,
  ) => AdapterReadReceiptMeasurementsItem(
    meterKey: json["meterKey"],
    quantity: json["quantity"],
  );

  Map<String, dynamic> toJson() =>
      _stripNulls({"meterKey": meterKey, "quantity": quantity});
}

enum ApplicationReadResourceDirection { RECEIVER, SOURCE }

final applicationReadResourceDirectionValues = EnumValues({
  "RECEIVER": ApplicationReadResourceDirection.RECEIVER,
  "SOURCE": ApplicationReadResourceDirection.SOURCE,
});

///Separate governed receiver action in the same read Operation. The native importer must
///perform the existing authenticated PEP check with this token immediately before its
///write; issuance is not completion.
class AdapterReadGrantResponseReceiverWrite {
  final String actionExecutionId;
  final String actionToken;
  final String argumentsJson;
  final int expiresAt;

  AdapterReadGrantResponseReceiverWrite({
    required this.actionExecutionId,
    required this.actionToken,
    required this.argumentsJson,
    required this.expiresAt,
  });

  factory AdapterReadGrantResponseReceiverWrite.fromJson(
    Map<String, dynamic> json,
  ) => AdapterReadGrantResponseReceiverWrite(
    actionExecutionId: json["actionExecutionId"],
    actionToken: json["actionToken"],
    argumentsJson: json["argumentsJson"],
    expiresAt: json["expiresAt"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionToken": actionToken,
    "argumentsJson": argumentsJson,
    "expiresAt": expiresAt,
  });
}

///DD-138(5)、07 §4.8.4/§5.2：Core → adapter POST /platform-adapter/v1/search 的请求体（规范 JSON，其
///SHA-256 即 Search Token 的 normalized_parameter_hash）。resources 只含当前 HUMAN 已 fresh read 的该
///binding Resource，adapter 只在这些 native 对象内检索。
class AdapterSearchRequest {
  final String idempotencyKey;

  ///1–20。
  final int limit;

  ///ZH_CN 或 EN。
  final String locale;

  ///去首尾空白后 1–200 字符。
  final String query;

  ///1–50 项。
  final List<AdapterSearchResource> resources;

  AdapterSearchRequest({
    required this.idempotencyKey,
    required this.limit,
    required this.locale,
    required this.query,
    required this.resources,
  });

  factory AdapterSearchRequest.fromJson(Map<String, dynamic> json) =>
      AdapterSearchRequest(
        idempotencyKey: json["idempotencyKey"],
        limit: json["limit"],
        locale: json["locale"],
        query: json["query"],
        resources: List<AdapterSearchResource>.from(
          json["resources"].map((x) => AdapterSearchResource.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "idempotencyKey": idempotencyKey,
    "limit": limit,
    "locale": locale,
    "query": query,
    "resources": List<dynamic>.from(resources.map((x) => x.toJson())),
  });
}

class AdapterSearchResource {
  final String nativeId;
  final String nativeType;
  final String resourceId;

  AdapterSearchResource({
    required this.nativeId,
    required this.nativeType,
    required this.resourceId,
  });

  factory AdapterSearchResource.fromJson(Map<String, dynamic> json) =>
      AdapterSearchResource(
        nativeId: json["nativeId"],
        nativeType: json["nativeType"],
        resourceId: json["resourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nativeId": nativeId,
    "nativeType": nativeType,
    "resourceId": resourceId,
  });
}

///DD-138(5)、07 §4.8.4：adapter search 回应。至多 limit 项；title 1–200 字符、summary 至多 400 字符、path
///为该组件原生页面 origin 内相对路径。任一项不合则 Core 丢弃该来源的全部结果。不含正文、ContentReference 或凭据。
class AdapterSearchResponse {
  final List<AdapterSearchResult> results;

  AdapterSearchResponse({required this.results});

  factory AdapterSearchResponse.fromJson(Map<String, dynamic> json) =>
      AdapterSearchResponse(
        results: List<AdapterSearchResult>.from(
          json["results"].map((x) => AdapterSearchResult.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "results": List<dynamic>.from(results.map((x) => x.toJson())),
  });
}

class AdapterSearchResult {
  final ComponentSearchResultKind kind;
  final String path;
  final String? summary;
  final String title;
  final String? updatedAt;

  AdapterSearchResult({
    required this.kind,
    required this.path,
    this.summary,
    required this.title,
    this.updatedAt,
  });

  factory AdapterSearchResult.fromJson(Map<String, dynamic> json) =>
      AdapterSearchResult(
        kind: componentSearchResultKindValues.map[json["kind"]]!,
        path: json["path"],
        summary: json["summary"],
        title: json["title"],
        updatedAt: json["updatedAt"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "kind": componentSearchResultKindValues.reverse[kind],
    "path": path,
    "summary": summary,
    "title": title,
    "updatedAt": updatedAt,
  });
}

///DD-138(5)、07 §4.8.4：组件搜索结果的类别（封闭枚举）。
enum ComponentSearchResultKind {
  DASHBOARD,
  DOCUMENT,
  FILE,
  FOLDER,
  KNOWLEDGE_BASE,
  QUESTION,
}

final componentSearchResultKindValues = EnumValues({
  "DASHBOARD": ComponentSearchResultKind.DASHBOARD,
  "DOCUMENT": ComponentSearchResultKind.DOCUMENT,
  "FILE": ComponentSearchResultKind.FILE,
  "FOLDER": ComponentSearchResultKind.FOLDER,
  "KNOWLEDGE_BASE": ComponentSearchResultKind.KNOWLEDGE_BASE,
  "QUESTION": ComponentSearchResultKind.QUESTION,
});

///GET /api/v1/workspaces/{workspaceId}/agent-turns（DD-125(6)）：已准入 Workspace 内本人持有
///Installation audit 的运行中回合；没有 audit 的 Installation 不出现（成员只见 20002）。每次读取写 ACCESS 审计。
class AgentActiveTurnPage {
  final List<AgentActiveTurnView> turns;
  final String workspaceId;

  AgentActiveTurnPage({required this.turns, required this.workspaceId});

  factory AgentActiveTurnPage.fromJson(Map<String, dynamic> json) =>
      AgentActiveTurnPage(
        turns: List<AgentActiveTurnView>.from(
          json["turns"].map((x) => AgentActiveTurnView.fromJson(x)),
        ),
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "turns": List<dynamic>.from(turns.map((x) => x.toJson())),
    "workspaceId": workspaceId,
  });
}

///DD-125(6)、17 §8：一个仍在运行的 Agent 回合（Invocation DISPATCHING/RUNNING）。只对该 Installation
///Resource audit 持有人呈现（回合开始时刻、活动入口与中断）；其他成员只见 Agent 20002 的工作中信号。读取写 ACCESS 审计。
class AgentActiveTurnView {
  ///Installation 的 ACTIVE AGENT 公钥，供原工作中 Agent 行匹配资料与 20002。
  final String? agentPubkey;

  ///DD-84 取消控制键（task.cancel.agent.invoke.v1）：本人是原发起人或持有该 Installation manage、控制定义 ACTIVE 且原
  ///Workflow 仍 OPEN 时给出。省略即不显示中断；提交仍完整重新准入。
  final String? cancelActionKey;
  final String installationId;
  final String invocationId;

  ///该回合的 agent.invoke ActionExecution；中断时作为 DD-84 取消控制的 originalActionExecutionId。
  final String originalActionExecutionId;
  final int projectionGeneration;

  ///AgentSession 根引用。
  final String rootEventId;

  ///原生 turn 开始时刻（RFC3339，取自 Codex turn startedAt）；不可查证时省略，不以本机时钟代替。
  final String? startedAt;

  ///AgentSession 的原生 thread ID。
  final String? threadId;

  ///已记录的原生 turn ID；派发结果尚未记录时省略。
  final String? turnId;

  AgentActiveTurnView({
    this.agentPubkey,
    this.cancelActionKey,
    required this.installationId,
    required this.invocationId,
    required this.originalActionExecutionId,
    required this.projectionGeneration,
    required this.rootEventId,
    this.startedAt,
    this.threadId,
    this.turnId,
  });

  factory AgentActiveTurnView.fromJson(Map<String, dynamic> json) =>
      AgentActiveTurnView(
        agentPubkey: json["agentPubkey"],
        cancelActionKey: json["cancelActionKey"],
        installationId: json["installationId"],
        invocationId: json["invocationId"],
        originalActionExecutionId: json["originalActionExecutionId"],
        projectionGeneration: json["projectionGeneration"],
        rootEventId: json["rootEventId"],
        startedAt: json["startedAt"],
        threadId: json["threadId"],
        turnId: json["turnId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentPubkey": agentPubkey,
    "cancelActionKey": cancelActionKey,
    "installationId": installationId,
    "invocationId": invocationId,
    "originalActionExecutionId": originalActionExecutionId,
    "projectionGeneration": projectionGeneration,
    "rootEventId": rootEventId,
    "startedAt": startedAt,
    "threadId": threadId,
    "turnId": turnId,
  });
}

///DD-147(1)：GET /api/v1/workspaces/{workspaceId}/agent-authors。Workspace 成员（与成员名单同一准入）可读的
///Agent 作者目录：本 Workspace 中有 ACTIVE ChannelAgentBinding 的未删除 Installation（排空或故障中的也保留，其历史消息仍需
///owner 行）的 Agent 公钥、persona 显示名与 owner。只供消息行显示“managed by <owner>”，不含 Installation
///其余字段，不授予任何使用、读取或管理权限；作者名仍只读 Relay kind:0（DD-117(6)）。
class AgentAuthorDirectory {
  final List<AgentAuthorView> agents;

  AgentAuthorDirectory({required this.agents});

  factory AgentAuthorDirectory.fromJson(Map<String, dynamic> json) =>
      AgentAuthorDirectory(
        agents: List<AgentAuthorView>.from(
          json["agents"].map((x) => AgentAuthorView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agents": List<dynamic>.from(agents.map((x) => x.toJson())),
  });
}

class AgentAuthorView {
  ///固定版本 personaIdentity 的显示名；缺省时客户端用公钥简写，不以 Installation 目录合成作者名。
  final String? agentDisplayName;
  final String agentPubkey;
  final String installationResourceId;

  ///owner 在本 Tenant 的显示名；owner 已不是 ACTIVE 成员时省略，客户端显示原版 owner unavailable。
  final String? ownerDisplayName;
  final String ownerPrincipalId;

  AgentAuthorView({
    this.agentDisplayName,
    required this.agentPubkey,
    required this.installationResourceId,
    this.ownerDisplayName,
    required this.ownerPrincipalId,
  });

  factory AgentAuthorView.fromJson(Map<String, dynamic> json) =>
      AgentAuthorView(
        agentDisplayName: json["agentDisplayName"],
        agentPubkey: json["agentPubkey"],
        installationResourceId: json["installationResourceId"],
        ownerDisplayName: json["ownerDisplayName"],
        ownerPrincipalId: json["ownerPrincipalId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentDisplayName": agentDisplayName,
    "agentPubkey": agentPubkey,
    "installationResourceId": installationResourceId,
    "ownerDisplayName": ownerDisplayName,
    "ownerPrincipalId": ownerPrincipalId,
  });
}

///DD-131(6)：GET /api/v1/agent-catalog/owners?ids=<id>,<id>。目录条目（本人可 discover 的本 Tenant
///ACTIVE AgentDefinition 与 agent.team）的 owner 名，供原版 “Added by <owner>”。一次至多一页 ID；不属本
///Tenant、非 ACTIVE、非目录类型或读者当前不可 discover 的 ID 一律省略，不能用来查询任意 Principal；不授予任何权限。
class AgentCatalogOwners {
  final List<AgentCatalogOwnerView> owners;

  AgentCatalogOwners({required this.owners});

  factory AgentCatalogOwners.fromJson(Map<String, dynamic> json) =>
      AgentCatalogOwners(
        owners: List<AgentCatalogOwnerView>.from(
          json["owners"].map((x) => AgentCatalogOwnerView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "owners": List<dynamic>.from(owners.map((x) => x.toJson())),
  });
}

class AgentCatalogOwnerView {
  ///owner 在本 Tenant 的显示名；owner 已不是 ACTIVE 成员时省略，客户端显示原版 owner unavailable。
  final String? ownerDisplayName;
  final String ownerPrincipalId;
  final String resourceId;

  AgentCatalogOwnerView({
    this.ownerDisplayName,
    required this.ownerPrincipalId,
    required this.resourceId,
  });

  factory AgentCatalogOwnerView.fromJson(Map<String, dynamic> json) =>
      AgentCatalogOwnerView(
        ownerDisplayName: json["ownerDisplayName"],
        ownerPrincipalId: json["ownerPrincipalId"],
        resourceId: json["resourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "ownerDisplayName": ownerDisplayName,
    "ownerPrincipalId": ownerPrincipalId,
    "resourceId": resourceId,
  });
}

///同 Tenant 且当前 discover 权限允许的 AgentDefinition 页；nextOffset 续读同一排序，不代表总量上限。
class AgentDefinitionPage {
  final List<AgentDefinitionView> definitions;
  final int? nextOffset;

  AgentDefinitionPage({required this.definitions, this.nextOffset});

  factory AgentDefinitionPage.fromJson(Map<String, dynamic> json) =>
      AgentDefinitionPage(
        definitions: List<AgentDefinitionView>.from(
          json["definitions"].map((x) => AgentDefinitionView.fromJson(x)),
        ),
        nextOffset: json["nextOffset"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "definitions": List<dynamic>.from(definitions.map((x) => x.toJson())),
    "nextOffset": nextOffset,
  });
}

///DD-24/25 的 Core Agent 稳定身份及实际 Resource 事实；不表示版本已发布或 Agent 可运行。
class AgentDefinitionView {
  ///DD-131(6)：该定义已由 agent.definition.share 写入 tenant#member 的 discoverer/reader；缺省即未分享。只表示同
  ///Tenant 成员可发现与读取，不授予任何 Installation 使用权。
  final bool? catalogShared;
  final String? currentPublishedVersionAssetId;
  final String displayName;
  final String ownerPrincipalId;
  final String resourceId;
  final ResourceState resourceState;
  final int resourceVersion;
  final String stableSlug;
  final String status;

  AgentDefinitionView({
    this.catalogShared,
    this.currentPublishedVersionAssetId,
    required this.displayName,
    required this.ownerPrincipalId,
    required this.resourceId,
    required this.resourceState,
    required this.resourceVersion,
    required this.stableSlug,
    required this.status,
  });

  factory AgentDefinitionView.fromJson(Map<String, dynamic> json) =>
      AgentDefinitionView(
        catalogShared: json["catalogShared"],
        currentPublishedVersionAssetId: json["currentPublishedVersionAssetId"],
        displayName: json["displayName"],
        ownerPrincipalId: json["ownerPrincipalId"],
        resourceId: json["resourceId"],
        resourceState: resourceStateValues.map[json["resourceState"]]!,
        resourceVersion: json["resourceVersion"],
        stableSlug: json["stableSlug"],
        status: json["status"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "catalogShared": catalogShared,
    "currentPublishedVersionAssetId": currentPublishedVersionAssetId,
    "displayName": displayName,
    "ownerPrincipalId": ownerPrincipalId,
    "resourceId": resourceId,
    "resourceState": resourceStateValues.reverse[resourceState],
    "resourceVersion": resourceVersion,
    "stableSlug": stableSlug,
    "status": status,
  });
}

///03 §7 Resource 的正式状态，投影未闭合不得呈现 ACTIVE。
enum ResourceState {
  ACTIVE,
  DELETED,
  DELETING,
  FAILED,
  PROVISIONING,
  RETAINED_READ_ONLY,
  UNKNOWN,
}

final resourceStateValues = EnumValues({
  "ACTIVE": ResourceState.ACTIVE,
  "DELETED": ResourceState.DELETED,
  "DELETING": ResourceState.DELETING,
  "FAILED": ResourceState.FAILED,
  "PROVISIONING": ResourceState.PROVISIONING,
  "RETAINED_READ_ONLY": ResourceState.RETAINED_READ_ONLY,
  "UNKNOWN": ResourceState.UNKNOWN,
});

class AgentDelegationPage {
  final bool canGrant;
  final bool canRevoke;
  final List<AgentDelegationView> grants;
  final String installationResourceId;
  final int? nextOffset;
  final int resourceVersion;
  final String workspaceId;

  AgentDelegationPage({
    required this.canGrant,
    required this.canRevoke,
    required this.grants,
    required this.installationResourceId,
    this.nextOffset,
    required this.resourceVersion,
    required this.workspaceId,
  });

  factory AgentDelegationPage.fromJson(Map<String, dynamic> json) =>
      AgentDelegationPage(
        canGrant: json["canGrant"],
        canRevoke: json["canRevoke"],
        grants: List<AgentDelegationView>.from(
          json["grants"].map((x) => AgentDelegationView.fromJson(x)),
        ),
        installationResourceId: json["installationResourceId"],
        nextOffset: json["nextOffset"],
        resourceVersion: json["resourceVersion"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "canGrant": canGrant,
    "canRevoke": canRevoke,
    "grants": List<dynamic>.from(grants.map((x) => x.toJson())),
    "installationResourceId": installationResourceId,
    "nextOffset": nextOffset,
    "resourceVersion": resourceVersion,
    "workspaceId": workspaceId,
  });
}

///同 Installation 的实际 Grant、Scope 与使用引用；没有 token、正文或新的权限裁决。state 是持久记录；effectiveState 是
///DD-126(4) 的只读投影，只有它为 ACTIVE 时 Grant 才真实可用（仍不证明当次 permission）。
class AgentDelegationView {
  final String delegationId;
  final int delegationVersion;

  ///DD-126(4)：ACTIVE＝持久 ACTIVE、在有效期内、次数未尽且每个 Scope 的同意摘要与当前解析定义相等；NEEDS_RENEWAL＝其余条件成立但有
  ///Scope 的同意摘要已变化或当前已无可解析定义；NOT_YET_VALID/EXPIRED/USES_EXHAUSTED
  ///按时钟与使用次数；REVOKING/REVOKED/SUPERSEDED 取持久状态。
  final DelegationEffectiveState effectiveState;
  final String grantorPrincipalId;
  final DelegationGrantParameters parameters;
  final AgentDelegationViewState state;

  ///DD-126(5)：state=SUPERSEDED 时替换本 Grant 的续签 Grant。
  final String? supersededByDelegationId;
  final int uses;

  AgentDelegationView({
    required this.delegationId,
    required this.delegationVersion,
    required this.effectiveState,
    required this.grantorPrincipalId,
    required this.parameters,
    required this.state,
    this.supersededByDelegationId,
    required this.uses,
  });

  factory AgentDelegationView.fromJson(Map<String, dynamic> json) =>
      AgentDelegationView(
        delegationId: json["delegationId"],
        delegationVersion: json["delegationVersion"],
        effectiveState:
            delegationEffectiveStateValues.map[json["effectiveState"]]!,
        grantorPrincipalId: json["grantorPrincipalId"],
        parameters: DelegationGrantParameters.fromJson(json["parameters"]),
        state: agentDelegationViewStateValues.map[json["state"]]!,
        supersededByDelegationId: json["supersededByDelegationId"],
        uses: json["uses"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "delegationId": delegationId,
    "delegationVersion": delegationVersion,
    "effectiveState": delegationEffectiveStateValues.reverse[effectiveState],
    "grantorPrincipalId": grantorPrincipalId,
    "parameters": parameters.toJson(),
    "state": agentDelegationViewStateValues.reverse[state],
    "supersededByDelegationId": supersededByDelegationId,
    "uses": uses,
  });
}

///DD-126(4)：ACTIVE＝持久 ACTIVE、在有效期内、次数未尽且每个 Scope 的同意摘要与当前解析定义相等；NEEDS_RENEWAL＝其余条件成立但有
///Scope 的同意摘要已变化或当前已无可解析定义；NOT_YET_VALID/EXPIRED/USES_EXHAUSTED
///按时钟与使用次数；REVOKING/REVOKED/SUPERSEDED 取持久状态。
enum DelegationEffectiveState {
  ACTIVE,
  EXPIRED,
  NEEDS_RENEWAL,
  NOT_YET_VALID,
  REVOKED,
  REVOKING,
  SUPERSEDED,
  USES_EXHAUSTED,
}

final delegationEffectiveStateValues = EnumValues({
  "ACTIVE": DelegationEffectiveState.ACTIVE,
  "EXPIRED": DelegationEffectiveState.EXPIRED,
  "NEEDS_RENEWAL": DelegationEffectiveState.NEEDS_RENEWAL,
  "NOT_YET_VALID": DelegationEffectiveState.NOT_YET_VALID,
  "REVOKED": DelegationEffectiveState.REVOKED,
  "REVOKING": DelegationEffectiveState.REVOKING,
  "SUPERSEDED": DelegationEffectiveState.SUPERSEDED,
  "USES_EXHAUSTED": DelegationEffectiveState.USES_EXHAUSTED,
});

///仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
class DelegationGrantParameters {
  final String expiresAt;
  final int? maxUses;

  ///DD-126(5)：续签时被替换的本人 Grant；与 renewsDelegationVersion 成对出现，缺省为新授予。
  final String? renewsDelegationId;

  ///DD-126(5)：被替换 Grant 的当前 version（CAS）。
  final int? renewsDelegationVersion;
  final List<DelegationScopeParameters> scopes;
  final String validFrom;

  DelegationGrantParameters({
    required this.expiresAt,
    this.maxUses,
    this.renewsDelegationId,
    this.renewsDelegationVersion,
    required this.scopes,
    required this.validFrom,
  });

  factory DelegationGrantParameters.fromJson(Map<String, dynamic> json) =>
      DelegationGrantParameters(
        expiresAt: json["expiresAt"],
        maxUses: json["maxUses"],
        renewsDelegationId: json["renewsDelegationId"],
        renewsDelegationVersion: json["renewsDelegationVersion"],
        scopes: List<DelegationScopeParameters>.from(
          json["scopes"].map((x) => DelegationScopeParameters.fromJson(x)),
        ),
        validFrom: json["validFrom"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "expiresAt": expiresAt,
    "maxUses": maxUses,
    "renewsDelegationId": renewsDelegationId,
    "renewsDelegationVersion": renewsDelegationVersion,
    "scopes": List<dynamic>.from(scopes.map((x) => x.toJson())),
    "validFrom": validFrom,
  });
}

///03 §6 的确切 Action/target/exposure 限制；管理发现与原 Grant 写入共用，发现不授予 permission。
class DelegationScopeParameters {
  final String actionKey;
  final int actionVersion;
  final String? createWorkspaceId;
  final String outputSchemaHash;
  final String redactionPolicy;
  final DelegationScopeParametersResultExposureMode resultExposureMode;
  final String? targetId;
  final String targetType;
  final String? toolResourceId;

  DelegationScopeParameters({
    required this.actionKey,
    required this.actionVersion,
    this.createWorkspaceId,
    required this.outputSchemaHash,
    required this.redactionPolicy,
    required this.resultExposureMode,
    this.targetId,
    required this.targetType,
    this.toolResourceId,
  });

  factory DelegationScopeParameters.fromJson(Map<String, dynamic> json) =>
      DelegationScopeParameters(
        actionKey: json["actionKey"],
        actionVersion: json["actionVersion"],
        createWorkspaceId: json["createWorkspaceId"],
        outputSchemaHash: json["outputSchemaHash"],
        redactionPolicy: json["redactionPolicy"],
        resultExposureMode: delegationScopeParametersResultExposureModeValues
            .map[json["resultExposureMode"]]!,
        targetId: json["targetId"],
        targetType: json["targetType"],
        toolResourceId: json["toolResourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "actionVersion": actionVersion,
    "createWorkspaceId": createWorkspaceId,
    "outputSchemaHash": outputSchemaHash,
    "redactionPolicy": redactionPolicy,
    "resultExposureMode": delegationScopeParametersResultExposureModeValues
        .reverse[resultExposureMode],
    "targetId": targetId,
    "targetType": targetType,
    "toolResourceId": toolResourceId,
  });
}

enum DelegationScopeParametersResultExposureMode { CONSUME_ONLY, EXPORT, READ }

final delegationScopeParametersResultExposureModeValues = EnumValues({
  "CONSUME_ONLY": DelegationScopeParametersResultExposureMode.CONSUME_ONLY,
  "EXPORT": DelegationScopeParametersResultExposureMode.EXPORT,
  "READ": DelegationScopeParametersResultExposureMode.READ,
});

enum AgentDelegationViewState { ACTIVE, EXPIRED, REVOKED, REVOKING, SUPERSEDED }

final agentDelegationViewStateValues = EnumValues({
  "ACTIVE": AgentDelegationViewState.ACTIVE,
  "EXPIRED": AgentDelegationViewState.EXPIRED,
  "REVOKED": AgentDelegationViewState.REVOKED,
  "REVOKING": AgentDelegationViewState.REVOKING,
  "SUPERSEDED": AgentDelegationViewState.SUPERSEDED,
});

///原 Grant 校验器当前允许的确切 Action/target/exposure；空页没有可授予对象，不伪造默认 Scope。
class AgentDelegationTargetPage {
  final String installationResourceId;
  final int? nextOffset;
  final int resourceVersion;
  final List<DelegationScopeParameters> scopes;
  final String workspaceId;

  AgentDelegationTargetPage({
    required this.installationResourceId,
    this.nextOffset,
    required this.resourceVersion,
    required this.scopes,
    required this.workspaceId,
  });

  factory AgentDelegationTargetPage.fromJson(Map<String, dynamic> json) =>
      AgentDelegationTargetPage(
        installationResourceId: json["installationResourceId"],
        nextOffset: json["nextOffset"],
        resourceVersion: json["resourceVersion"],
        scopes: List<DelegationScopeParameters>.from(
          json["scopes"].map((x) => DelegationScopeParameters.fromJson(x)),
        ),
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "installationResourceId": installationResourceId,
    "nextOffset": nextOffset,
    "resourceVersion": resourceVersion,
    "scopes": List<dynamic>.from(scopes.map((x) => x.toJson())),
    "workspaceId": workspaceId,
  });
}

///DD-131(2)、DD-26：导入人在本 Tenant 可选的 RuntimeProfile 与已治理
///Route（与版本配置目录同一来源与过滤）。目录为空不阻止导入（导入时不强制选择，DD-131(2)）；canImport 只反映动作开放与 Tenant
///create。目录不授予发布、安装或运行权限。
class AgentImportConfigurationPage {
  final bool canImport;
  final int? nextOffset;
  final List<RuntimeProfileDirectoryProfilesItem> profiles;
  final List<AgentVersionRouteOption> routes;

  AgentImportConfigurationPage({
    required this.canImport,
    required this.nextOffset,
    required this.profiles,
    required this.routes,
  });

  factory AgentImportConfigurationPage.fromJson(Map<String, dynamic> json) =>
      AgentImportConfigurationPage(
        canImport: json["canImport"],
        nextOffset: json["nextOffset"],
        profiles: List<RuntimeProfileDirectoryProfilesItem>.from(
          json["profiles"].map(
            (x) => RuntimeProfileDirectoryProfilesItem.fromJson(x),
          ),
        ),
        routes: List<AgentVersionRouteOption>.from(
          json["routes"].map((x) => AgentVersionRouteOption.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "canImport": canImport,
    "nextOffset": nextOffset,
    "profiles": List<dynamic>.from(profiles.map((x) => x.toJson())),
    "routes": List<dynamic>.from(routes.map((x) => x.toJson())),
  });
}

class RuntimeProfileDirectoryProfilesItem {
  final RuntimeProfileDirectoryProfilesItemCapabilityContract
  capabilityContract;
  final String key;
  final RuntimeProfileKind kind;
  final String status;
  final String webAvailability;

  RuntimeProfileDirectoryProfilesItem({
    required this.capabilityContract,
    required this.key,
    required this.kind,
    required this.status,
    required this.webAvailability,
  });

  factory RuntimeProfileDirectoryProfilesItem.fromJson(
    Map<String, dynamic> json,
  ) => RuntimeProfileDirectoryProfilesItem(
    capabilityContract:
        RuntimeProfileDirectoryProfilesItemCapabilityContract.fromJson(
          json["capabilityContract"],
        ),
    key: json["key"],
    kind: runtimeProfileKindValues.map[json["kind"]]!,
    status: json["status"],
    webAvailability: json["webAvailability"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "capabilityContract": capabilityContract.toJson(),
    "key": key,
    "kind": runtimeProfileKindValues.reverse[kind],
    "status": status,
    "webAvailability": webAvailability,
  });
}

class RuntimeProfileDirectoryProfilesItemCapabilityContract {
  final List<String> capabilityRequirements;
  final int maxIdleTimeoutSeconds;
  final int maxParallelism;
  final int maxTurnDurationSeconds;
  final List<String> replyPolicies;

  ///同一发布合同中回复策略键到 Buzz ResolvedPersona 原生布尔字段的显式映射；缺映射不表示支持。
  final List<RuntimeReplyPolicyMapping>? replyPolicyMappings;

  RuntimeProfileDirectoryProfilesItemCapabilityContract({
    required this.capabilityRequirements,
    required this.maxIdleTimeoutSeconds,
    required this.maxParallelism,
    required this.maxTurnDurationSeconds,
    required this.replyPolicies,
    this.replyPolicyMappings,
  });

  factory RuntimeProfileDirectoryProfilesItemCapabilityContract.fromJson(
    Map<String, dynamic> json,
  ) => RuntimeProfileDirectoryProfilesItemCapabilityContract(
    capabilityRequirements: List<String>.from(
      json["capabilityRequirements"].map((x) => x),
    ),
    maxIdleTimeoutSeconds: json["maxIdleTimeoutSeconds"],
    maxParallelism: json["maxParallelism"],
    maxTurnDurationSeconds: json["maxTurnDurationSeconds"],
    replyPolicies: List<String>.from(json["replyPolicies"].map((x) => x)),
    replyPolicyMappings: json["replyPolicyMappings"] == null
        ? null
        : List<RuntimeReplyPolicyMapping>.from(
            json["replyPolicyMappings"]!.map(
              (x) => RuntimeReplyPolicyMapping.fromJson(x),
            ),
          ),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "capabilityRequirements": List<dynamic>.from(
      capabilityRequirements.map((x) => x),
    ),
    "maxIdleTimeoutSeconds": maxIdleTimeoutSeconds,
    "maxParallelism": maxParallelism,
    "maxTurnDurationSeconds": maxTurnDurationSeconds,
    "replyPolicies": List<dynamic>.from(replyPolicies.map((x) => x)),
    "replyPolicyMappings": replyPolicyMappings == null
        ? null
        : List<dynamic>.from(replyPolicyMappings!.map((x) => x.toJson())),
  });
}

class RuntimeReplyPolicyMapping {
  final bool broadcastReplies;
  final String key;
  final bool threadReplies;

  RuntimeReplyPolicyMapping({
    required this.broadcastReplies,
    required this.key,
    required this.threadReplies,
  });

  factory RuntimeReplyPolicyMapping.fromJson(Map<String, dynamic> json) =>
      RuntimeReplyPolicyMapping(
        broadcastReplies: json["broadcastReplies"],
        key: json["key"],
        threadReplies: json["threadReplies"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "broadcastReplies": broadcastReplies,
    "key": key,
    "threadReplies": threadReplies,
  });
}

enum RuntimeProfileKind { LOCAL_ACP, REMOTE_PROVIDER, SERVER_CODEX }

final runtimeProfileKindValues = EnumValues({
  "LOCAL_ACP": RuntimeProfileKind.LOCAL_ACP,
  "REMOTE_PROVIDER": RuntimeProfileKind.REMOTE_PROVIDER,
  "SERVER_CODEX": RuntimeProfileKind.SERVER_CODEX,
});

///03 §7、17 §3：同 Tenant、fresh read 与 Workspace scope 查证后的既有治理 Route 元数据。原生 revision/hash
///已回读；不包含 provider 配置、正文、凭据或模型 endpoint，不证明某次执行已获准。
class AgentVersionRouteOption {
  final String? homeWorkspaceId;
  final String nativeConfigHash;
  final String nativeConfigResourceId;
  final int nativeRevision;
  final String ownerPrincipalId;
  final String resourceId;
  final int resourceVersion;

  AgentVersionRouteOption({
    required this.homeWorkspaceId,
    required this.nativeConfigHash,
    required this.nativeConfigResourceId,
    required this.nativeRevision,
    required this.ownerPrincipalId,
    required this.resourceId,
    required this.resourceVersion,
  });

  factory AgentVersionRouteOption.fromJson(Map<String, dynamic> json) =>
      AgentVersionRouteOption(
        homeWorkspaceId: json["homeWorkspaceId"],
        nativeConfigHash: json["nativeConfigHash"],
        nativeConfigResourceId: json["nativeConfigResourceId"],
        nativeRevision: json["nativeRevision"],
        ownerPrincipalId: json["ownerPrincipalId"],
        resourceId: json["resourceId"],
        resourceVersion: json["resourceVersion"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "homeWorkspaceId": homeWorkspaceId,
    "nativeConfigHash": nativeConfigHash,
    "nativeConfigResourceId": nativeConfigResourceId,
    "nativeRevision": nativeRevision,
    "ownerPrincipalId": ownerPrincipalId,
    "resourceId": resourceId,
    "resourceVersion": resourceVersion,
  });
}

class AgentInstallationCandidatePage {
  ///原 Installation create exposure、目录与 fresh Workspace create；每个候选还须 consume/投影查证，提交时全部重验。
  final bool canCreate;
  final List<AgentInstallationCandidate> candidates;
  final int? nextOffset;
  final String workspaceId;

  AgentInstallationCandidatePage({
    required this.canCreate,
    required this.candidates,
    this.nextOffset,
    required this.workspaceId,
  });

  factory AgentInstallationCandidatePage.fromJson(Map<String, dynamic> json) =>
      AgentInstallationCandidatePage(
        canCreate: json["canCreate"],
        candidates: List<AgentInstallationCandidate>.from(
          json["candidates"].map((x) => AgentInstallationCandidate.fromJson(x)),
        ),
        nextOffset: json["nextOffset"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "canCreate": canCreate,
    "candidates": List<dynamic>.from(candidates.map((x) => x.toJson())),
    "nextOffset": nextOffset,
    "workspaceId": workspaceId,
  });
}

///实际 ACTIVE Definition/PUBLISHED Asset 的安装来源与版本；不表示新 Installation 或 runtime 已 ACTIVE。
class AgentInstallationCandidate {
  final String agentResourceId;
  final String agentVersionAssetId;
  final int assetVersion;
  final String displayName;
  final int ordinal;
  final int resourceVersion;

  AgentInstallationCandidate({
    required this.agentResourceId,
    required this.agentVersionAssetId,
    required this.assetVersion,
    required this.displayName,
    required this.ordinal,
    required this.resourceVersion,
  });

  factory AgentInstallationCandidate.fromJson(Map<String, dynamic> json) =>
      AgentInstallationCandidate(
        agentResourceId: json["agentResourceId"],
        agentVersionAssetId: json["agentVersionAssetId"],
        assetVersion: json["assetVersion"],
        displayName: json["displayName"],
        ordinal: json["ordinal"],
        resourceVersion: json["resourceVersion"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentResourceId": agentResourceId,
    "agentVersionAssetId": agentVersionAssetId,
    "assetVersion": assetVersion,
    "displayName": displayName,
    "ordinal": ordinal,
    "resourceVersion": resourceVersion,
  });
}

///按既有部署登记页长扫描同一 Workspace，再以 fresh Installation Resource read 过滤；空页不代表整个 Workspace 无安装。
class AgentInstallationPage {
  final List<AgentInstallationView> installations;
  final int? nextOffset;

  AgentInstallationPage({required this.installations, this.nextOffset});

  factory AgentInstallationPage.fromJson(Map<String, dynamic> json) =>
      AgentInstallationPage(
        installations: List<AgentInstallationView>.from(
          json["installations"].map((x) => AgentInstallationView.fromJson(x)),
        ),
        nextOffset: json["nextOffset"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "installations": List<dynamic>.from(installations.map((x) => x.toJson())),
    "nextOffset": nextOffset,
  });
}

///03 §7、17 §8：同 Tenant、已准入 Workspace 且 fresh Installation Resource read 允许的只读事实；不授予 Version
///正文、执行或管理权限。
class AgentInstallationView {
  final int? activeProjectionGeneration;

  ///17 §3：固定 Version personaIdentity 的展示名，经同一 Installation Resource read
  ///准入；只供提及与成员目录呈现，不授予执行或 Definition 读取。旧服务缺省时调用方回退到原 Definition 读取。
  final String? agentDisplayName;
  final String agentPrincipalId;
  final AgentInstallationViewAgentPrincipalState agentPrincipalState;

  ///原 Installation 的 ACTIVE AGENT BuzzIdentityBinding 公开公钥；经相同 Resource read 准入，仅供原 Inbox
  ///owner/作者匹配，不授予执行或签名权限。旧服务缺省不证明身份映射。
  final String? agentPubkey;
  final String agentResourceId;

  ///同固定 Version、ACTIVE 投影与原生 Profile 已支持的 Automation 来源结果位置；普通 Agent 仍沿其固定回复策略，Automation
  ///则消息到原 Thread、Schedule/manual 到同 Workspace Channel。不代表 execute、Delegation 或 quota
  ///准入。缺失或空集合不支持 Schedule。
  final List<AutomationResultTarget>? automationResultTargets;

  ///DD-125(6)、17 §8：本人 fresh Installation Resource audit 允许读取会话转写、实时 item
  ///与运行中回合（受审计敏感读取）。false 或缺省时只呈现 20002 工作中信号。
  final bool? canAudit;

  ///DD-125(6)、05 §2.11：原“停止 / 从频道移除 / 删除”入口。动作目录开放 agent.installation.disable、安装 ACTIVE
  ///且没有未终结投影、本人 fresh Installation manage 时为 true；命令只带 resourceId、resourceVersion 与
  ///explicitConfirmation。不代表已准入，旧服务缺省不显示。
  final bool? canDisable;

  ///DD-125(6)：原“启动”入口。目录开放 agent.installation.enable、安装 DISABLED、固定 Version 仍 PUBLISHED、本人
  ///fresh Installation manage 时为 true；命令只带 resourceId、resourceVersion 与 explicitConfirmation。
  final bool? canEnable;

  ///DD-125(6)、DD-122(4)：原“重启”入口，即对固定 Version 的同版本
  ///agent.installation.upgrade（assetId=pinnedVersionAssetId）。canUpgrade 成立且固定 Version 仍
  ///PUBLISHED 时为 true；仍沿升级审批与排空。
  final bool? canRestart;

  ///当前 ACTIVE 安装可按原 manage 权限申请已发布目标版本；仍须原治理审批，不代表升级已经准入。旧服务缺省不显示入口。
  final bool? canUpgrade;
  final AgentInstallationViewChannelBinding? channelBinding;
  final AgentInstallationViewExecutionPermission? executionPermission;

  ///DD-147(1)：该 Installation owner 在本 Tenant 的显示名，只在其 TenantMembership 与 HumanIdentity 仍为
  ///ACTIVE 时给出；可读条件与本视图相同。缺省时客户端显示原版 owner unavailable，不以 Installation 目录合成作者名（DD-117(6)）。
  final String? ownerDisplayName;
  final String ownerPrincipalId;
  final String pinnedVersionAssetId;
  final AgentInstallationProjectionView? projection;
  final AgentInstallationViewReadPermission? readPermission;
  final String resourceId;
  final ResourceState resourceState;
  final int resourceVersion;
  final AgentInstallationState state;
  final String workspaceId;

  AgentInstallationView({
    this.activeProjectionGeneration,
    this.agentDisplayName,
    required this.agentPrincipalId,
    required this.agentPrincipalState,
    this.agentPubkey,
    required this.agentResourceId,
    this.automationResultTargets,
    this.canAudit,
    this.canDisable,
    this.canEnable,
    this.canRestart,
    this.canUpgrade,
    this.channelBinding,
    this.executionPermission,
    this.ownerDisplayName,
    required this.ownerPrincipalId,
    required this.pinnedVersionAssetId,
    this.projection,
    this.readPermission,
    required this.resourceId,
    required this.resourceState,
    required this.resourceVersion,
    required this.state,
    required this.workspaceId,
  });

  factory AgentInstallationView.fromJson(
    Map<String, dynamic> json,
  ) => AgentInstallationView(
    activeProjectionGeneration: json["activeProjectionGeneration"],
    agentDisplayName: json["agentDisplayName"],
    agentPrincipalId: json["agentPrincipalId"],
    agentPrincipalState: agentInstallationViewAgentPrincipalStateValues
        .map[json["agentPrincipalState"]]!,
    agentPubkey: json["agentPubkey"],
    agentResourceId: json["agentResourceId"],
    automationResultTargets: json["automationResultTargets"] == null
        ? null
        : List<AutomationResultTarget>.from(
            json["automationResultTargets"]!.map(
              (x) => automationResultTargetValues.map[x]!,
            ),
          ),
    canAudit: json["canAudit"],
    canDisable: json["canDisable"],
    canEnable: json["canEnable"],
    canRestart: json["canRestart"],
    canUpgrade: json["canUpgrade"],
    channelBinding: json["channelBinding"] == null
        ? null
        : AgentInstallationViewChannelBinding.fromJson(json["channelBinding"]),
    executionPermission: json["executionPermission"] == null
        ? null
        : AgentInstallationViewExecutionPermission.fromJson(
            json["executionPermission"],
          ),
    ownerDisplayName: json["ownerDisplayName"],
    ownerPrincipalId: json["ownerPrincipalId"],
    pinnedVersionAssetId: json["pinnedVersionAssetId"],
    projection: json["projection"] == null
        ? null
        : AgentInstallationProjectionView.fromJson(json["projection"]),
    readPermission: json["readPermission"] == null
        ? null
        : AgentInstallationViewReadPermission.fromJson(json["readPermission"]),
    resourceId: json["resourceId"],
    resourceState: resourceStateValues.map[json["resourceState"]]!,
    resourceVersion: json["resourceVersion"],
    state: agentInstallationStateValues.map[json["state"]]!,
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "activeProjectionGeneration": activeProjectionGeneration,
    "agentDisplayName": agentDisplayName,
    "agentPrincipalId": agentPrincipalId,
    "agentPrincipalState": agentInstallationViewAgentPrincipalStateValues
        .reverse[agentPrincipalState],
    "agentPubkey": agentPubkey,
    "agentResourceId": agentResourceId,
    "automationResultTargets": automationResultTargets == null
        ? null
        : List<dynamic>.from(
            automationResultTargets!.map(
              (x) => automationResultTargetValues.reverse[x],
            ),
          ),
    "canAudit": canAudit,
    "canDisable": canDisable,
    "canEnable": canEnable,
    "canRestart": canRestart,
    "canUpgrade": canUpgrade,
    "channelBinding": channelBinding?.toJson(),
    "executionPermission": executionPermission?.toJson(),
    "ownerDisplayName": ownerDisplayName,
    "ownerPrincipalId": ownerPrincipalId,
    "pinnedVersionAssetId": pinnedVersionAssetId,
    "projection": projection?.toJson(),
    "readPermission": readPermission?.toJson(),
    "resourceId": resourceId,
    "resourceState": resourceStateValues.reverse[resourceState],
    "resourceVersion": resourceVersion,
    "state": agentInstallationStateValues.reverse[state],
    "workspaceId": workspaceId,
  });
}

enum AgentInstallationViewAgentPrincipalState { ACTIVE, DISABLED }

final agentInstallationViewAgentPrincipalStateValues = EnumValues({
  "ACTIVE": AgentInstallationViewAgentPrincipalState.ACTIVE,
  "DISABLED": AgentInstallationViewAgentPrincipalState.DISABLED,
});

enum AutomationResultTarget { CHANNEL, TRIGGER_THREAD }

final automationResultTargetValues = EnumValues({
  "CHANNEL": AutomationResultTarget.CHANNEL,
  "TRIGGER_THREAD": AutomationResultTarget.TRIGGER_THREAD,
});

class AgentInstallationViewChannelBinding {
  final String? channelId;
  final AgentInstallationViewChannelBindingStatus status;
  final List<AgentTrigger> triggers;

  AgentInstallationViewChannelBinding({
    this.channelId,
    required this.status,
    required this.triggers,
  });

  factory AgentInstallationViewChannelBinding.fromJson(
    Map<String, dynamic> json,
  ) => AgentInstallationViewChannelBinding(
    channelId: json["channelId"],
    status:
        agentInstallationViewChannelBindingStatusValues.map[json["status"]]!,
    triggers: List<AgentTrigger>.from(
      json["triggers"].map((x) => agentTriggerValues.map[x]!),
    ),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "channelId": channelId,
    "status": agentInstallationViewChannelBindingStatusValues.reverse[status],
    "triggers": List<dynamic>.from(
      triggers.map((x) => agentTriggerValues.reverse[x]),
    ),
  });
}

enum AgentInstallationViewChannelBindingStatus { ACTIVE, DISABLED, ERROR }

final agentInstallationViewChannelBindingStatusValues = EnumValues({
  "ACTIVE": AgentInstallationViewChannelBindingStatus.ACTIVE,
  "DISABLED": AgentInstallationViewChannelBindingStatus.DISABLED,
  "ERROR": AgentInstallationViewChannelBindingStatus.ERROR,
});

enum AgentTrigger { MANUAL_ASSIGNMENT, MENTION }

final agentTriggerValues = EnumValues({
  "MANUAL_ASSIGNMENT": AgentTrigger.MANUAL_ASSIGNMENT,
  "MENTION": AgentTrigger.MENTION,
});

class AgentInstallationViewExecutionPermission {
  final bool canGrant;
  final bool canRevoke;
  final bool effective;
  final String? pendingActionExecutionId;
  final bool requested;

  AgentInstallationViewExecutionPermission({
    required this.canGrant,
    required this.canRevoke,
    required this.effective,
    this.pendingActionExecutionId,
    required this.requested,
  });

  factory AgentInstallationViewExecutionPermission.fromJson(
    Map<String, dynamic> json,
  ) => AgentInstallationViewExecutionPermission(
    canGrant: json["canGrant"],
    canRevoke: json["canRevoke"],
    effective: json["effective"],
    pendingActionExecutionId: json["pendingActionExecutionId"],
    requested: json["requested"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "canGrant": canGrant,
    "canRevoke": canRevoke,
    "effective": effective,
    "pendingActionExecutionId": pendingActionExecutionId,
    "requested": requested,
  });
}

///17 §8 的持久运行投影摘要；不证明本机进程当前健康，不返回正文、凭据或隔离目录。
class AgentInstallationProjectionView {
  final String agentVersionAssetId;
  final String configHash;
  final int generation;
  final String runtimeProfileKey;
  final AgentRuntimeProjectionState state;

  AgentInstallationProjectionView({
    required this.agentVersionAssetId,
    required this.configHash,
    required this.generation,
    required this.runtimeProfileKey,
    required this.state,
  });

  factory AgentInstallationProjectionView.fromJson(Map<String, dynamic> json) =>
      AgentInstallationProjectionView(
        agentVersionAssetId: json["agentVersionAssetId"],
        configHash: json["configHash"],
        generation: json["generation"],
        runtimeProfileKey: json["runtimeProfileKey"],
        state: agentRuntimeProjectionStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentVersionAssetId": agentVersionAssetId,
    "configHash": configHash,
    "generation": generation,
    "runtimeProfileKey": runtimeProfileKey,
    "state": agentRuntimeProjectionStateValues.reverse[state],
  });
}

///03 §7 的静态运行投影状态，不承载 Invocation 动态准入。
enum AgentRuntimeProjectionState { ACTIVE, ERROR, PENDING, REVOKED }

final agentRuntimeProjectionStateValues = EnumValues({
  "ACTIVE": AgentRuntimeProjectionState.ACTIVE,
  "ERROR": AgentRuntimeProjectionState.ERROR,
  "PENDING": AgentRuntimeProjectionState.PENDING,
  "REVOKED": AgentRuntimeProjectionState.REVOKED,
});

class AgentInstallationViewReadPermission {
  final bool canGrant;
  final bool canRevoke;
  final bool effective;
  final String? pendingActionExecutionId;
  final bool requested;

  AgentInstallationViewReadPermission({
    required this.canGrant,
    required this.canRevoke,
    required this.effective,
    this.pendingActionExecutionId,
    required this.requested,
  });

  factory AgentInstallationViewReadPermission.fromJson(
    Map<String, dynamic> json,
  ) => AgentInstallationViewReadPermission(
    canGrant: json["canGrant"],
    canRevoke: json["canRevoke"],
    effective: json["effective"],
    pendingActionExecutionId: json["pendingActionExecutionId"],
    requested: json["requested"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "canGrant": canGrant,
    "canRevoke": canRevoke,
    "effective": effective,
    "pendingActionExecutionId": pendingActionExecutionId,
    "requested": requested,
  });
}

///03 §7、17 §6 的 Installation 状态；ACTIVE 要求实际投影与运行查证闭合。
enum AgentInstallationState { ACTIVE, DISABLED, DRAINING, ERROR, PROVISIONING }

final agentInstallationStateValues = EnumValues({
  "ACTIVE": AgentInstallationState.ACTIVE,
  "DISABLED": AgentInstallationState.DISABLED,
  "DRAINING": AgentInstallationState.DRAINING,
  "ERROR": AgentInstallationState.ERROR,
  "PROVISIONING": AgentInstallationState.PROVISIONING,
});

///Installation 的 Skill 投影状态（requested/projection/current）；需 Installation read，读取不触发投影或重试。
class AgentInstallationSkillPage {
  final String agentVersionAssetId;
  final int? generation;
  final String installationResourceId;
  final List<AgentInstallationSkillView> skills;

  AgentInstallationSkillPage({
    required this.agentVersionAssetId,
    this.generation,
    required this.installationResourceId,
    required this.skills,
  });

  factory AgentInstallationSkillPage.fromJson(Map<String, dynamic> json) =>
      AgentInstallationSkillPage(
        agentVersionAssetId: json["agentVersionAssetId"],
        generation: json["generation"],
        installationResourceId: json["installationResourceId"],
        skills: List<AgentInstallationSkillView>.from(
          json["skills"].map((x) => AgentInstallationSkillView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentVersionAssetId": agentVersionAssetId,
    "generation": generation,
    "installationResourceId": installationResourceId,
    "skills": List<dynamic>.from(skills.map((x) => x.toJson())),
  });
}

///DD-135(7)：Installation pinned Version 引用的一个 Skill 的 requested 事实、投影结果与当前状态；不含正文或物化路径。
class AgentInstallationSkillView {
  final String artifactDigest;
  final int ordinal;

  ///当前 generation 已以 digest 物化并经 skills/list 核对。
  final bool projected;
  final String skillResourceId;
  final String skillVersionAssetId;
  final String stableSlug;
  final AgentInstallationSkillStatus status;

  AgentInstallationSkillView({
    required this.artifactDigest,
    required this.ordinal,
    required this.projected,
    required this.skillResourceId,
    required this.skillVersionAssetId,
    required this.stableSlug,
    required this.status,
  });

  factory AgentInstallationSkillView.fromJson(Map<String, dynamic> json) =>
      AgentInstallationSkillView(
        artifactDigest: json["artifactDigest"],
        ordinal: json["ordinal"],
        projected: json["projected"],
        skillResourceId: json["skillResourceId"],
        skillVersionAssetId: json["skillVersionAssetId"],
        stableSlug: json["stableSlug"],
        status: agentInstallationSkillStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "artifactDigest": artifactDigest,
    "ordinal": ordinal,
    "projected": projected,
    "skillResourceId": skillResourceId,
    "skillVersionAssetId": skillVersionAssetId,
    "stableSlug": stableSlug,
    "status": agentInstallationSkillStatusValues.reverse[status],
  });
}

///DD-135(5)(7)、17 §4：Installation 中一个被引 Skill 的当前状态。PROJECTION_FAILED 与 RUNTIME_NOT_READY
///来自 generation 投影；DISABLED 与 NO_PERMISSION 来自读取时的 fresh 判定，与每次 turn/start 前的判定同一规则。
enum AgentInstallationSkillStatus {
  DISABLED,
  EFFECTIVE,
  NO_PERMISSION,
  PROJECTION_FAILED,
  RUNTIME_NOT_READY,
}

final agentInstallationSkillStatusValues = EnumValues({
  "DISABLED": AgentInstallationSkillStatus.DISABLED,
  "EFFECTIVE": AgentInstallationSkillStatus.EFFECTIVE,
  "NO_PERMISSION": AgentInstallationSkillStatus.NO_PERMISSION,
  "PROJECTION_FAILED": AgentInstallationSkillStatus.PROJECTION_FAILED,
  "RUNTIME_NOT_READY": AgentInstallationSkillStatus.RUNTIME_NOT_READY,
});

///DD-122: the tools an Agent Installation's current generation requests and their effective
///state. Read-only; grants happen only through installation create/upgrade.
class AgentInstallationToolPage {
  final int generation;
  final String installationResourceId;
  final List<AgentInstallationToolView> tools;

  AgentInstallationToolPage({
    required this.generation,
    required this.installationResourceId,
    required this.tools,
  });

  factory AgentInstallationToolPage.fromJson(Map<String, dynamic> json) =>
      AgentInstallationToolPage(
        generation: json["generation"],
        installationResourceId: json["installationResourceId"],
        tools: List<AgentInstallationToolView>.from(
          json["tools"].map((x) => AgentInstallationToolView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "generation": generation,
    "installationResourceId": installationResourceId,
    "tools": List<dynamic>.from(tools.map((x) => x.toJson())),
  });
}

class AgentInstallationToolView {
  final String? applicationBindingId;
  final AgentToolBindingStatus bindingStatus;

  ///APPLICATION only: the requested capability contract key@version.
  final String? capabilityRequirement;
  final String? name;
  final ReasonCode? reasonCode;
  final AgentInstallationToolSource source;

  ///Absent when an application capability requirement has no resolved provider yet.
  final String? toolResourceId;

  AgentInstallationToolView({
    this.applicationBindingId,
    required this.bindingStatus,
    this.capabilityRequirement,
    this.name,
    this.reasonCode,
    required this.source,
    this.toolResourceId,
  });

  factory AgentInstallationToolView.fromJson(Map<String, dynamic> json) =>
      AgentInstallationToolView(
        applicationBindingId: json["applicationBindingId"],
        bindingStatus: agentToolBindingStatusValues.map[json["bindingStatus"]]!,
        capabilityRequirement: json["capabilityRequirement"],
        name: json["name"],
        reasonCode: json["reasonCode"] == null
            ? null
            : reasonCodeValues.map[json["reasonCode"]]!,
        source: agentInstallationToolSourceValues.map[json["source"]]!,
        toolResourceId: json["toolResourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "applicationBindingId": applicationBindingId,
    "bindingStatus": agentToolBindingStatusValues.reverse[bindingStatus],
    "capabilityRequirement": capabilityRequirement,
    "name": name,
    "reasonCode": reasonCodeValues.reverse[reasonCode],
    "source": agentInstallationToolSourceValues.reverse[source],
    "toolResourceId": toolResourceId,
  });
}

enum AgentToolBindingStatus { ACTIVE, NO_PERMISSION, PENDING, REVOKED }

final agentToolBindingStatusValues = EnumValues({
  "ACTIVE": AgentToolBindingStatus.ACTIVE,
  "NO_PERMISSION": AgentToolBindingStatus.NO_PERMISSION,
  "PENDING": AgentToolBindingStatus.PENDING,
  "REVOKED": AgentToolBindingStatus.REVOKED,
});

///稳定业务 reason code，进入 audit、UI 与告警；文案可本地化，code 不变（apps/06-工程基线规范.md 第 4 节）。新增与新增 API
///字段同等对待，走兼容检查。本文件只含已被实现使用的 code。
///
///admitted=false 时的拒绝原因
///
///INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
enum ReasonCode {
  ADMISSION_ABANDONED,
  APPROVAL_CONSUME_WINDOW_CLOSED,
  APPROVAL_DENIED,
  APPROVAL_EXPIRED,
  APPROVAL_INVALIDATED,
  APPROVAL_NOT_OPEN,
  APPROVAL_SELECTOR_UNRESOLVABLE,
  APPROVAL_WITHDRAWN,
  APPROVER_NOT_ELIGIBLE,
  BINDING_NOT_ACTIVE,
  CAPABILITY_BLOCKED,
  CLIENT_KEY_ALREADY_BOUND,
  CLIENT_KEY_LIMIT_REACHED,
  CLIENT_KEY_NOT_FOUND,
  CLIENT_KEY_PROOF_INVALID,
  DELEGATION_RENEWAL_REQUIRED,
  DELEGATION_REQUIRED,
  DEPENDENCY_UNAVAILABLE,
  DISPATCH_RESULT_UNKNOWN,
  DUPLICATE_DECISION,
  EXTERNAL_RESULT_UNKNOWN,
  IDEMPOTENCY_KEY_REUSED,
  IDENTITY_HEADER_MISSING,
  IDENTITY_UNKNOWN,
  INVALID_PARAMETERS,
  INVITATION_ALREADY_REDEEMED,
  INVITATION_EXPIRED,
  INVITATION_NOT_FOUND,
  INVITATION_REVOKED,
  INVITEE_ALREADY_MEMBER,
  LAST_TENANT_ADMIN,
  NATIVE_SURFACE_REQUIRED,
  PAYLOAD_TOO_LARGE,
  PERMISSION_DENIED,
  PROJECTION_DELAYED,
  PUBLISH_REJECTED,
  PUBLISH_RESULT_UNKNOWN,
  QUOTA_EXHAUSTED,
  RATE_LIMITED,
  SCOPE_GUARD_FAILED,
  SELF_APPROVAL_DENIED,
  SESSION_NOT_ACTIVE,
  STEP_TIMEOUT,
  SURFACE_CAPABILITY_UNAVAILABLE,
  TARGET_NOT_FOUND,
  TARGET_STATE_CONFLICT,
  TENANT_MEMBERSHIP_NOT_ACTIVE,
  TENANT_NOT_ACTIVE,
  TENANT_SELECTION_NOT_AVAILABLE,
  WAITING_APPROVAL,
}

final reasonCodeValues = EnumValues({
  "ADMISSION_ABANDONED": ReasonCode.ADMISSION_ABANDONED,
  "APPROVAL_CONSUME_WINDOW_CLOSED": ReasonCode.APPROVAL_CONSUME_WINDOW_CLOSED,
  "APPROVAL_DENIED": ReasonCode.APPROVAL_DENIED,
  "APPROVAL_EXPIRED": ReasonCode.APPROVAL_EXPIRED,
  "APPROVAL_INVALIDATED": ReasonCode.APPROVAL_INVALIDATED,
  "APPROVAL_NOT_OPEN": ReasonCode.APPROVAL_NOT_OPEN,
  "APPROVAL_SELECTOR_UNRESOLVABLE": ReasonCode.APPROVAL_SELECTOR_UNRESOLVABLE,
  "APPROVAL_WITHDRAWN": ReasonCode.APPROVAL_WITHDRAWN,
  "APPROVER_NOT_ELIGIBLE": ReasonCode.APPROVER_NOT_ELIGIBLE,
  "BINDING_NOT_ACTIVE": ReasonCode.BINDING_NOT_ACTIVE,
  "CAPABILITY_BLOCKED": ReasonCode.CAPABILITY_BLOCKED,
  "CLIENT_KEY_ALREADY_BOUND": ReasonCode.CLIENT_KEY_ALREADY_BOUND,
  "CLIENT_KEY_LIMIT_REACHED": ReasonCode.CLIENT_KEY_LIMIT_REACHED,
  "CLIENT_KEY_NOT_FOUND": ReasonCode.CLIENT_KEY_NOT_FOUND,
  "CLIENT_KEY_PROOF_INVALID": ReasonCode.CLIENT_KEY_PROOF_INVALID,
  "DELEGATION_RENEWAL_REQUIRED": ReasonCode.DELEGATION_RENEWAL_REQUIRED,
  "DELEGATION_REQUIRED": ReasonCode.DELEGATION_REQUIRED,
  "DEPENDENCY_UNAVAILABLE": ReasonCode.DEPENDENCY_UNAVAILABLE,
  "DISPATCH_RESULT_UNKNOWN": ReasonCode.DISPATCH_RESULT_UNKNOWN,
  "DUPLICATE_DECISION": ReasonCode.DUPLICATE_DECISION,
  "EXTERNAL_RESULT_UNKNOWN": ReasonCode.EXTERNAL_RESULT_UNKNOWN,
  "IDEMPOTENCY_KEY_REUSED": ReasonCode.IDEMPOTENCY_KEY_REUSED,
  "IDENTITY_HEADER_MISSING": ReasonCode.IDENTITY_HEADER_MISSING,
  "IDENTITY_UNKNOWN": ReasonCode.IDENTITY_UNKNOWN,
  "INVALID_PARAMETERS": ReasonCode.INVALID_PARAMETERS,
  "INVITATION_ALREADY_REDEEMED": ReasonCode.INVITATION_ALREADY_REDEEMED,
  "INVITATION_EXPIRED": ReasonCode.INVITATION_EXPIRED,
  "INVITATION_NOT_FOUND": ReasonCode.INVITATION_NOT_FOUND,
  "INVITATION_REVOKED": ReasonCode.INVITATION_REVOKED,
  "INVITEE_ALREADY_MEMBER": ReasonCode.INVITEE_ALREADY_MEMBER,
  "LAST_TENANT_ADMIN": ReasonCode.LAST_TENANT_ADMIN,
  "NATIVE_SURFACE_REQUIRED": ReasonCode.NATIVE_SURFACE_REQUIRED,
  "PAYLOAD_TOO_LARGE": ReasonCode.PAYLOAD_TOO_LARGE,
  "PERMISSION_DENIED": ReasonCode.PERMISSION_DENIED,
  "PROJECTION_DELAYED": ReasonCode.PROJECTION_DELAYED,
  "PUBLISH_REJECTED": ReasonCode.PUBLISH_REJECTED,
  "PUBLISH_RESULT_UNKNOWN": ReasonCode.PUBLISH_RESULT_UNKNOWN,
  "QUOTA_EXHAUSTED": ReasonCode.QUOTA_EXHAUSTED,
  "RATE_LIMITED": ReasonCode.RATE_LIMITED,
  "SCOPE_GUARD_FAILED": ReasonCode.SCOPE_GUARD_FAILED,
  "SELF_APPROVAL_DENIED": ReasonCode.SELF_APPROVAL_DENIED,
  "SESSION_NOT_ACTIVE": ReasonCode.SESSION_NOT_ACTIVE,
  "STEP_TIMEOUT": ReasonCode.STEP_TIMEOUT,
  "SURFACE_CAPABILITY_UNAVAILABLE": ReasonCode.SURFACE_CAPABILITY_UNAVAILABLE,
  "TARGET_NOT_FOUND": ReasonCode.TARGET_NOT_FOUND,
  "TARGET_STATE_CONFLICT": ReasonCode.TARGET_STATE_CONFLICT,
  "TENANT_MEMBERSHIP_NOT_ACTIVE": ReasonCode.TENANT_MEMBERSHIP_NOT_ACTIVE,
  "TENANT_NOT_ACTIVE": ReasonCode.TENANT_NOT_ACTIVE,
  "TENANT_SELECTION_NOT_AVAILABLE": ReasonCode.TENANT_SELECTION_NOT_AVAILABLE,
  "WAITING_APPROVAL": ReasonCode.WAITING_APPROVAL,
});

enum AgentInstallationToolSource {
  APPLICATION,
  PLATFORM_NATIVE,
  USER_REGISTERED_EXTERNAL,
}

final agentInstallationToolSourceValues = EnumValues({
  "APPLICATION": AgentInstallationToolSource.APPLICATION,
  "PLATFORM_NATIVE": AgentInstallationToolSource.PLATFORM_NATIVE,
  "USER_REGISTERED_EXTERNAL":
      AgentInstallationToolSource.USER_REGISTERED_EXTERNAL,
});

///05 §2.10、17 §8：一个 Agent Installation 在其 Workspace 的成员使用权目录。requested 是该成员显式持有
///reader/executor/delegator 三项关系；effective 是 fresh read/execute/delegate 全部允许（含 owner/admin
///既有权限）。canGrant/canRevoke 只说明当前查看者可提交对应受治理请求，不代表请求已准入。
class AgentInstallationUsePage {
  final String installationId;
  final List<AgentInstallationUsePageMembersItem> members;
  final String? pendingActionExecutionId;
  final int resourceVersion;

  ///DD-125(6)：原 respondTo 在本页的映射。至少一名成员 requested=true 即 ALLOWLIST，否则 OWNER_ONLY；切换只经逐成员
  ///agent.installation.use.grant/revoke，不存在 anyone。旧服务缺省时客户端按 members 推导。
  final AgentRespondToMode? respondTo;

  AgentInstallationUsePage({
    required this.installationId,
    required this.members,
    this.pendingActionExecutionId,
    required this.resourceVersion,
    this.respondTo,
  });

  factory AgentInstallationUsePage.fromJson(Map<String, dynamic> json) =>
      AgentInstallationUsePage(
        installationId: json["installationId"],
        members: List<AgentInstallationUsePageMembersItem>.from(
          json["members"].map(
            (x) => AgentInstallationUsePageMembersItem.fromJson(x),
          ),
        ),
        pendingActionExecutionId: json["pendingActionExecutionId"],
        resourceVersion: json["resourceVersion"],
        respondTo: json["respondTo"] == null
            ? null
            : agentRespondToModeValues.map[json["respondTo"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "installationId": installationId,
    "members": List<dynamic>.from(members.map((x) => x.toJson())),
    "pendingActionExecutionId": pendingActionExecutionId,
    "resourceVersion": resourceVersion,
    "respondTo": agentRespondToModeValues.reverse[respondTo],
  });
}

class AgentInstallationUsePageMembersItem {
  final bool canGrant;
  final bool canRevoke;
  final String displayName;
  final bool effective;
  final String principalId;
  final bool requested;

  AgentInstallationUsePageMembersItem({
    required this.canGrant,
    required this.canRevoke,
    required this.displayName,
    required this.effective,
    required this.principalId,
    required this.requested,
  });

  factory AgentInstallationUsePageMembersItem.fromJson(
    Map<String, dynamic> json,
  ) => AgentInstallationUsePageMembersItem(
    canGrant: json["canGrant"],
    canRevoke: json["canRevoke"],
    displayName: json["displayName"],
    effective: json["effective"],
    principalId: json["principalId"],
    requested: json["requested"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "canGrant": canGrant,
    "canRevoke": canRevoke,
    "displayName": displayName,
    "effective": effective,
    "principalId": principalId,
    "requested": requested,
  });
}

///DD-125(6)：原 respondTo 在本页的映射。至少一名成员 requested=true 即 ALLOWLIST，否则 OWNER_ONLY；切换只经逐成员
///agent.installation.use.grant/revoke，不存在 anyone。旧服务缺省时客户端按 members 推导。
///
///原 Buzz respondTo 在 Kailo 的映射（DD-125(6)、05 §2.10）：OWNER_ONLY ≙ 默认（只有 owner、Workspace
///manage 与 Tenant manage 持有使用权），ALLOWLIST ≙ 至少一名成员经 agent.installation.use.grant 显式授予。原
///anyone 不提供：频道成员关系不推导业务 Resource permission（10 §3）。
enum AgentRespondToMode { ALLOWLIST, OWNER_ONLY }

final agentRespondToModeValues = EnumValues({
  "ALLOWLIST": AgentRespondToMode.ALLOWLIST,
  "OWNER_ONLY": AgentRespondToMode.OWNER_ONLY,
});

///原 Session 同 generation 调用元事实，逐页 fresh Installation read，且仅本人发起或实际 AE 目标 audit 允许；不返回
///prompt、tool result、reasoning、凭据或成本。未授权项过滤后空页仍可能有 nextCursor。
class AgentInvocationPage {
  final List<AgentInvocationView> invocations;
  final String? nextCursor;

  AgentInvocationPage({required this.invocations, this.nextCursor});

  factory AgentInvocationPage.fromJson(Map<String, dynamic> json) =>
      AgentInvocationPage(
        invocations: List<AgentInvocationView>.from(
          json["invocations"].map((x) => AgentInvocationView.fromJson(x)),
        ),
        nextCursor: json["nextCursor"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "invocations": List<dynamic>.from(invocations.map((x) => x.toJson())),
    "nextCursor": nextCursor,
  });
}

///原 AgentInvocation 持久状态，不替代 Temporal。observation 或 UNKNOWN 时不得渲染为成功/失败；cancelPending
///不等于已取消；createdAt/updatedAt 是 Core 记录时间，不是假造的原生事件时间。
class AgentInvocationView {
  final String actionExecutionId;
  final bool cancelPending;

  ///当前 HUMAN 是否为原任务发起人。仅控制任务详情入口；任务读取仍执行自身实时授权。
  final bool canReadTask;

  ///Core 记录的 RFC3339 时间字符串，按原线格式传输。
  final String createdAt;
  final String invocationId;
  final ReasonCode? observation;
  final String? runtimeTurnId;
  final AgentInvocationViewStatus status;

  ///Core 记录的 RFC3339 时间字符串，按原线格式传输。
  final String updatedAt;

  AgentInvocationView({
    required this.actionExecutionId,
    required this.cancelPending,
    required this.canReadTask,
    required this.createdAt,
    required this.invocationId,
    this.observation,
    this.runtimeTurnId,
    required this.status,
    required this.updatedAt,
  });

  factory AgentInvocationView.fromJson(Map<String, dynamic> json) =>
      AgentInvocationView(
        actionExecutionId: json["actionExecutionId"],
        cancelPending: json["cancelPending"],
        canReadTask: json["canReadTask"],
        createdAt: json["createdAt"],
        invocationId: json["invocationId"],
        observation: json["observation"] == null
            ? null
            : reasonCodeValues.map[json["observation"]]!,
        runtimeTurnId: json["runtimeTurnId"],
        status: agentInvocationViewStatusValues.map[json["status"]]!,
        updatedAt: json["updatedAt"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "cancelPending": cancelPending,
    "canReadTask": canReadTask,
    "createdAt": createdAt,
    "invocationId": invocationId,
    "observation": reasonCodeValues.reverse[observation],
    "runtimeTurnId": runtimeTurnId,
    "status": agentInvocationViewStatusValues.reverse[status],
    "updatedAt": updatedAt,
  });
}

enum AgentInvocationViewStatus {
  CANCELED,
  COMPLETED,
  CREATED,
  DISPATCHING,
  FAILED,
  RUNNING,
  UNKNOWN,
}

final agentInvocationViewStatusValues = EnumValues({
  "CANCELED": AgentInvocationViewStatus.CANCELED,
  "COMPLETED": AgentInvocationViewStatus.COMPLETED,
  "CREATED": AgentInvocationViewStatus.CREATED,
  "DISPATCHING": AgentInvocationViewStatus.DISPATCHING,
  "FAILED": AgentInvocationViewStatus.FAILED,
  "RUNNING": AgentInvocationViewStatus.RUNNING,
  "UNKNOWN": AgentInvocationViewStatus.UNKNOWN,
});

///19 §5：复合游标走到原生末尾才 COMPLETE。BOUND_EXCEEDED/UNKNOWN 不是空库存；只是本次 best-effort head tuple
///snapshot，不是严格存量权威。
class AgentMemoryEntryPage {
  final List<AgentMemoryEntryView> entries;
  final String installationResourceId;
  final String operationId;

  ///仅 HUMAN 管理读取且 state 为 COMPLETE 时提供（DD-125(10)）；BOUND_EXCEEDED/UNKNOWN 与 Agent
  ///记忆工具结果省略，客户端保持 slug 顺序。
  final AgentMemoryReferenceView? references;
  final AgentMemoryEntryPageState state;
  final String workspaceId;

  AgentMemoryEntryPage({
    required this.entries,
    required this.installationResourceId,
    required this.operationId,
    this.references,
    required this.state,
    required this.workspaceId,
  });

  factory AgentMemoryEntryPage.fromJson(Map<String, dynamic> json) =>
      AgentMemoryEntryPage(
        entries: List<AgentMemoryEntryView>.from(
          json["entries"].map((x) => AgentMemoryEntryView.fromJson(x)),
        ),
        installationResourceId: json["installationResourceId"],
        operationId: json["operationId"],
        references: json["references"] == null
            ? null
            : AgentMemoryReferenceView.fromJson(json["references"]),
        state: agentMemoryEntryPageStateValues.map[json["state"]]!,
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "entries": List<dynamic>.from(entries.map((x) => x.toJson())),
    "installationResourceId": installationResourceId,
    "operationId": operationId,
    "references": references?.toJson(),
    "state": agentMemoryEntryPageStateValues.reverse[state],
    "workspaceId": workspaceId,
  });
}

///NIP-AE cold head tuple，不含 value 或任何正文；tombstone 是当前原生 head，不回退旧 value。listing 为 COMPLETE
///的 HUMAN 管理读取另含该条正文中的引用 slug（DD-125(10)），Agent 记忆工具结果不含。
class AgentMemoryEntryView {
  final int createdAt;
  final String eventId;

  ///仅 HUMAN 管理读取、listing COMPLETE 且非 tombstone 时提供：以原 extract_refs 从该条正文提取的 [[slug]]
  ///引用，按首次出现顺序去重、只含合法 slug。BOUND_EXCEEDED/UNKNOWN、tombstone 与 Agent 记忆工具结果省略。
  final List<String>? outgoingRefs;
  final String slug;
  final bool tombstone;

  AgentMemoryEntryView({
    required this.createdAt,
    required this.eventId,
    this.outgoingRefs,
    required this.slug,
    required this.tombstone,
  });

  factory AgentMemoryEntryView.fromJson(Map<String, dynamic> json) =>
      AgentMemoryEntryView(
        createdAt: json["createdAt"],
        eventId: json["eventId"],
        outgoingRefs: json["outgoingRefs"] == null
            ? null
            : List<String>.from(json["outgoingRefs"]!.map((x) => x)),
        slug: json["slug"],
        tombstone: json["tombstone"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "createdAt": createdAt,
    "eventId": eventId,
    "outgoingRefs": outgoingRefs == null
        ? null
        : List<dynamic>.from(outgoingRefs!.map((x) => x)),
    "slug": slug,
    "tombstone": tombstone,
  });
}

///仅 HUMAN 管理读取且 state 为 COMPLETE 时提供（DD-125(10)）；BOUND_EXCEEDED/UNKNOWN 与 Agent
///记忆工具结果省略，客户端保持 slug 顺序。
///
///agent.memory.entry.list 为 COMPLETE 时，在同一准入与同一次 NIP-AE 读取内，以原 extract_refs 从 core head
///与各条非 tombstone head 的已解密正文提取的引用关系（DD-125(10)）。只是派生视图：不含正文，不授予任何读取权；客户端据此按
///core、其引用树先序、未被引用者按 slug 排列。
class AgentMemoryReferenceView {
  ///本次读取存在 core head；false 时客户端显示“没有 core”。
  final bool coreExists;

  ///core profile 中的引用，按首次出现顺序去重，只含合法 slug；没有 core 时为空。
  final List<String> coreRefs;

  ///按目标 slug 排序。
  final List<AgentMemoryDanglingRefView> dangling;

  AgentMemoryReferenceView({
    required this.coreExists,
    required this.coreRefs,
    required this.dangling,
  });

  factory AgentMemoryReferenceView.fromJson(Map<String, dynamic> json) =>
      AgentMemoryReferenceView(
        coreExists: json["coreExists"],
        coreRefs: List<String>.from(json["coreRefs"].map((x) => x)),
        dangling: List<AgentMemoryDanglingRefView>.from(
          json["dangling"].map((x) => AgentMemoryDanglingRefView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "coreExists": coreExists,
    "coreRefs": List<dynamic>.from(coreRefs.map((x) => x)),
    "dangling": List<dynamic>.from(dangling.map((x) => x.toJson())),
  });
}

///被某条已解密 head 以 [[slug]] 引用、但不在本次 COMPLETE listing 的非 tombstone 条目集合中的目标（原版 Missing
///link，DD-125(10)）。tombstone 目标与没有 core 时对 core 的引用同样悬挂。只含 slug，不含正文。
class AgentMemoryDanglingRefView {
  ///引用者 slug，core 记为 "core"；去重并按 slug 排序。
  final List<String> referencedBy;
  final String slug;

  AgentMemoryDanglingRefView({required this.referencedBy, required this.slug});

  factory AgentMemoryDanglingRefView.fromJson(Map<String, dynamic> json) =>
      AgentMemoryDanglingRefView(
        referencedBy: List<String>.from(json["referencedBy"].map((x) => x)),
        slug: json["slug"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "referencedBy": List<dynamic>.from(referencedBy.map((x) => x)),
    "slug": slug,
  });
}

enum AgentMemoryEntryPageState { BOUND_EXCEEDED, COMPLETE, UNKNOWN }

final agentMemoryEntryPageStateValues = EnumValues({
  "BOUND_EXCEEDED": AgentMemoryEntryPageState.BOUND_EXCEEDED,
  "COMPLETE": AgentMemoryEntryPageState.COMPLETE,
  "UNKNOWN": AgentMemoryEntryPageState.UNKNOWN,
});

///DD-66/68、19 §5：fresh HUMAN Installation read 后的原生 core/cold head。正文仅本次 no-store HTTP，不入
///Core 数据库、审计或客户端持久存储。ABSENT 不等于 UNREADABLE；tombstone 可带原 head 引用。
class AgentMemoryReadView {
  final String? content;

  ///UTF-8 bytes of the returned content string, not the whole native NIP-44 JSON body or a
  ///billing measurement.
  final int? contentBytes;
  final int? createdAt;
  final String? eventId;
  final String installationResourceId;
  final String operationId;
  final String slug;
  final AgentMemoryReadViewState state;

  ///FOUND only: native buzz mem hash of the exact UTF-8 value, used by strict patch baseHash;
  ///not the JSON body or a stored plaintext copy.
  final String? valueHash;
  final String workspaceId;

  AgentMemoryReadView({
    this.content,
    this.contentBytes,
    this.createdAt,
    this.eventId,
    required this.installationResourceId,
    required this.operationId,
    required this.slug,
    required this.state,
    this.valueHash,
    required this.workspaceId,
  });

  factory AgentMemoryReadView.fromJson(Map<String, dynamic> json) =>
      AgentMemoryReadView(
        content: json["content"],
        contentBytes: json["contentBytes"],
        createdAt: json["createdAt"],
        eventId: json["eventId"],
        installationResourceId: json["installationResourceId"],
        operationId: json["operationId"],
        slug: json["slug"],
        state: agentMemoryReadViewStateValues.map[json["state"]]!,
        valueHash: json["valueHash"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "content": content,
    "contentBytes": contentBytes,
    "createdAt": createdAt,
    "eventId": eventId,
    "installationResourceId": installationResourceId,
    "operationId": operationId,
    "slug": slug,
    "state": agentMemoryReadViewStateValues.reverse[state],
    "valueHash": valueHash,
    "workspaceId": workspaceId,
  });
}

enum AgentMemoryReadViewState { ABSENT, FOUND, UNREADABLE }

final agentMemoryReadViewStateValues = EnumValues({
  "ABSENT": AgentMemoryReadViewState.ABSENT,
  "FOUND": AgentMemoryReadViewState.FOUND,
  "UNREADABLE": AgentMemoryReadViewState.UNREADABLE,
});

///DD-121: only agent.invoke executions initiated by the caller for the requested source
///events; no message body, no other member's executions, no Agent internals. A mentioned
///Agent without an outcome is still PENDING (not yet scanned).
class AgentMentionOutcomePage {
  final List<AgentMentionOutcomeView> outcomes;

  AgentMentionOutcomePage({required this.outcomes});

  factory AgentMentionOutcomePage.fromJson(Map<String, dynamic> json) =>
      AgentMentionOutcomePage(
        outcomes: List<AgentMentionOutcomeView>.from(
          json["outcomes"].map((x) => AgentMentionOutcomeView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "outcomes": List<dynamic>.from(outcomes.map((x) => x.toJson())),
  });
}

class AgentMentionOutcomeView {
  final String eventId;
  final String installationId;
  final ReasonCode? reasonCode;
  final String? replyEventId;
  final AgentMentionOutcomeState state;

  AgentMentionOutcomeView({
    required this.eventId,
    required this.installationId,
    this.reasonCode,
    this.replyEventId,
    required this.state,
  });

  factory AgentMentionOutcomeView.fromJson(Map<String, dynamic> json) =>
      AgentMentionOutcomeView(
        eventId: json["eventId"],
        installationId: json["installationId"],
        reasonCode: json["reasonCode"] == null
            ? null
            : reasonCodeValues.map[json["reasonCode"]]!,
        replyEventId: json["replyEventId"],
        state: agentMentionOutcomeStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "eventId": eventId,
    "installationId": installationId,
    "reasonCode": reasonCodeValues.reverse[reasonCode],
    "replyEventId": replyEventId,
    "state": agentMentionOutcomeStateValues.reverse[state],
  });
}

enum AgentMentionOutcomeState { DENIED, FAILED, REPLIED, RUNNING }

final agentMentionOutcomeStateValues = EnumValues({
  "DENIED": AgentMentionOutcomeState.DENIED,
  "FAILED": AgentMentionOutcomeState.FAILED,
  "REPLIED": AgentMentionOutcomeState.REPLIED,
  "RUNNING": AgentMentionOutcomeState.RUNNING,
});

///DD-121: the caller's own channel messages (event IDs) whose agent.invoke admission
///outcome the caller may see.
class AgentMentionOutcomeQueryRequest {
  final List<String> eventIds;

  AgentMentionOutcomeQueryRequest({required this.eventIds});

  factory AgentMentionOutcomeQueryRequest.fromJson(Map<String, dynamic> json) =>
      AgentMentionOutcomeQueryRequest(
        eventIds: List<String>.from(json["eventIds"].map((x) => x)),
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"eventIds": List<dynamic>.from(eventIds.map((x) => x))});
}

///17 §8、19 §4：已准入 Workspace 与 Installation read 的原 Session 元事实；不包含或授权 Codex rollout
///正文。cursor 固定 HUMAN、scope、筛选与原生 generation。
class AgentSessionPage {
  final String? nextCursor;
  final List<AgentSessionView> sessions;

  AgentSessionPage({this.nextCursor, required this.sessions});

  factory AgentSessionPage.fromJson(Map<String, dynamic> json) =>
      AgentSessionPage(
        nextCursor: json["nextCursor"],
        sessions: List<AgentSessionView>.from(
          json["sessions"].map((x) => AgentSessionView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nextCursor": nextCursor,
    "sessions": List<dynamic>.from(sessions.map((x) => x.toJson())),
  });
}

class AgentSessionView {
  final String agentVersionAssetId;

  ///Core 记录的 RFC3339 时间字符串，按原线格式传输。
  final String createdAt;
  final String installationResourceId;
  final int projectionGeneration;

  ///既有 BUZZ_EVENT、SCHEDULE 或 MANUAL Session 根引用；不从客户端生成 native thread。
  final String rootEventId;
  final String? runtimeThreadId;

  ///ABANDONED：只剩 birth 结果不明、Invocation 已全部确定终态的 Session 超过对账期限后由 Core 放弃，不再派发 turn（DD-154）。
  final AgentSessionViewStatus status;
  final String workspaceId;

  AgentSessionView({
    required this.agentVersionAssetId,
    required this.createdAt,
    required this.installationResourceId,
    required this.projectionGeneration,
    required this.rootEventId,
    this.runtimeThreadId,
    required this.status,
    required this.workspaceId,
  });

  factory AgentSessionView.fromJson(Map<String, dynamic> json) =>
      AgentSessionView(
        agentVersionAssetId: json["agentVersionAssetId"],
        createdAt: json["createdAt"],
        installationResourceId: json["installationResourceId"],
        projectionGeneration: json["projectionGeneration"],
        rootEventId: json["rootEventId"],
        runtimeThreadId: json["runtimeThreadId"],
        status: agentSessionViewStatusValues.map[json["status"]]!,
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentVersionAssetId": agentVersionAssetId,
    "createdAt": createdAt,
    "installationResourceId": installationResourceId,
    "projectionGeneration": projectionGeneration,
    "rootEventId": rootEventId,
    "runtimeThreadId": runtimeThreadId,
    "status": agentSessionViewStatusValues.reverse[status],
    "workspaceId": workspaceId,
  });
}

///ABANDONED：只剩 birth 结果不明、Invocation 已全部确定终态的 Session 超过对账期限后由 Core 放弃，不再派发 turn（DD-154）。
enum AgentSessionViewStatus {
  ABANDONED,
  ACTIVE,
  CLOSED,
  PENDING,
  STARTING,
  UNKNOWN,
}

final agentSessionViewStatusValues = EnumValues({
  "ABANDONED": AgentSessionViewStatus.ABANDONED,
  "ACTIVE": AgentSessionViewStatus.ACTIVE,
  "CLOSED": AgentSessionViewStatus.CLOSED,
  "PENDING": AgentSessionViewStatus.PENDING,
  "STARTING": AgentSessionViewStatus.STARTING,
  "UNKNOWN": AgentSessionViewStatus.UNKNOWN,
});

///DD-131(2)：校验通过的快照包的导入预览与一次性暂存引用。只含映射后将进入新 DRAFT 的可移植字段与被丢弃的原版字段类别；不回显包正文、名单公钥或记忆。确认导入经
///agent.definition.import。
class AgentSnapshotImportPreview {
  ///包内联的头像（≤2 MiB 的 data URL）供预览；上传时已按附件规则存为本 Tenant 内容寻址媒体对象，DRAFT personaIdentity 只引用该对象。
  final String? avatarDataUrl;

  ///内联头像在本 Tenant 媒体中的对象地址（/media/<sha256>），即新 DRAFT 的 personaIdentity.avatarUrl。
  final String? avatarUrl;
  final String? description;
  final String displayName;
  final String expiresAt;
  final AgentSnapshotImportPreviewFormatKey formatKey;
  final int? idleTimeoutSeconds;

  ///可为空串：包没有 systemPrompt 时生成空指令的 DRAFT，补充后才能发布。
  final String instructions;
  final int? maxTurnDurationSeconds;
  final AgentSnapshotMediaType mediaType;
  final List<AgentSnapshotOmission> omitted;
  final int packageByteSize;
  final String packageDigest;
  final int? parallelism;
  final bool? sourceIsBuiltIn;
  final String uploadId;

  AgentSnapshotImportPreview({
    this.avatarDataUrl,
    this.avatarUrl,
    this.description,
    required this.displayName,
    required this.expiresAt,
    required this.formatKey,
    this.idleTimeoutSeconds,
    required this.instructions,
    this.maxTurnDurationSeconds,
    required this.mediaType,
    required this.omitted,
    required this.packageByteSize,
    required this.packageDigest,
    this.parallelism,
    this.sourceIsBuiltIn,
    required this.uploadId,
  });

  factory AgentSnapshotImportPreview.fromJson(Map<String, dynamic> json) =>
      AgentSnapshotImportPreview(
        avatarDataUrl: json["avatarDataUrl"],
        avatarUrl: json["avatarUrl"],
        description: json["description"],
        displayName: json["displayName"],
        expiresAt: json["expiresAt"],
        formatKey:
            agentSnapshotImportPreviewFormatKeyValues.map[json["formatKey"]]!,
        idleTimeoutSeconds: json["idleTimeoutSeconds"],
        instructions: json["instructions"],
        maxTurnDurationSeconds: json["maxTurnDurationSeconds"],
        mediaType: agentSnapshotMediaTypeValues.map[json["mediaType"]]!,
        omitted: List<AgentSnapshotOmission>.from(
          json["omitted"].map((x) => agentSnapshotOmissionValues.map[x]!),
        ),
        packageByteSize: json["packageByteSize"],
        packageDigest: json["packageDigest"],
        parallelism: json["parallelism"],
        sourceIsBuiltIn: json["sourceIsBuiltIn"],
        uploadId: json["uploadId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "avatarDataUrl": avatarDataUrl,
    "avatarUrl": avatarUrl,
    "description": description,
    "displayName": displayName,
    "expiresAt": expiresAt,
    "formatKey": agentSnapshotImportPreviewFormatKeyValues.reverse[formatKey],
    "idleTimeoutSeconds": idleTimeoutSeconds,
    "instructions": instructions,
    "maxTurnDurationSeconds": maxTurnDurationSeconds,
    "mediaType": agentSnapshotMediaTypeValues.reverse[mediaType],
    "omitted": List<dynamic>.from(
      omitted.map((x) => agentSnapshotOmissionValues.reverse[x]),
    ),
    "packageByteSize": packageByteSize,
    "packageDigest": packageDigest,
    "parallelism": parallelism,
    "sourceIsBuiltIn": sourceIsBuiltIn,
    "uploadId": uploadId,
  });
}

enum AgentSnapshotImportPreviewFormatKey { BUZZ_AGENT_SNAPSHOT_1 }

final agentSnapshotImportPreviewFormatKeyValues = EnumValues({
  "buzz-agent-snapshot@1":
      AgentSnapshotImportPreviewFormatKey.BUZZ_AGENT_SNAPSHOT_1,
});

///05 §2.12 TransferFormat 的 package_media_type：`.agent.json` 清单本身，或 tEXt
///`buzz_agent_snapshot` 承载同一清单的 `.agent.png`。
enum AgentSnapshotMediaType { APPLICATION_JSON, IMAGE_PNG }

final agentSnapshotMediaTypeValues = EnumValues({
  "application/json": AgentSnapshotMediaType.APPLICATION_JSON,
  "image/png": AgentSnapshotMediaType.IMAGE_PNG,
});

///DD-131(2)：快照中存在、导入不带入新 DRAFT 的原版字段。RUNTIME/MODEL/PROVIDER/NAME_POOL
///属本机运行时（DD-26）；RESPOND_TO_ALLOWLIST 的名单公钥属来源身份；RESPOND_TO_ANYONE
///不提供（DD-125(6)）；SESSION_POLICY 由运行时合同决定；MEMORY 见 DD-131(4)；AVATAR
///只指包引用的外部头像地址（内联头像按附件规则导入，不在此列）；SKILLS 由 owner 按本 Tenant 目录重选。
enum AgentSnapshotOmission {
  AVATAR,
  MEMORY,
  MODEL,
  NAME_POOL,
  PROVIDER,
  RESPOND_TO_ALLOWLIST,
  RESPOND_TO_ANYONE,
  RUNTIME,
  SESSION_POLICY,
  SKILLS,
}

final agentSnapshotOmissionValues = EnumValues({
  "AVATAR": AgentSnapshotOmission.AVATAR,
  "MEMORY": AgentSnapshotOmission.MEMORY,
  "MODEL": AgentSnapshotOmission.MODEL,
  "NAME_POOL": AgentSnapshotOmission.NAME_POOL,
  "PROVIDER": AgentSnapshotOmission.PROVIDER,
  "RESPOND_TO_ALLOWLIST": AgentSnapshotOmission.RESPOND_TO_ALLOWLIST,
  "RESPOND_TO_ANYONE": AgentSnapshotOmission.RESPOND_TO_ANYONE,
  "RUNTIME": AgentSnapshotOmission.RUNTIME,
  "SESSION_POLICY": AgentSnapshotOmission.SESSION_POLICY,
  "SKILLS": AgentSnapshotOmission.SKILLS,
});

///DD-131(2)、DD-143：一次 Agent 快照包的原始字节（标准 base64，Web 与 Desktop 同一 JSON 传输）。解码后 JSON 不超过 5
///MiB、PNG 不超过 10 MiB；格式与版本由 Core 判定。
class AgentSnapshotUploadRequest {
  final String contentBase64;
  final AgentSnapshotMediaType mediaType;

  AgentSnapshotUploadRequest({
    required this.contentBase64,
    required this.mediaType,
  });

  factory AgentSnapshotUploadRequest.fromJson(Map<String, dynamic> json) =>
      AgentSnapshotUploadRequest(
        contentBase64: json["contentBase64"],
        mediaType: agentSnapshotMediaTypeValues.map[json["mediaType"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "contentBase64": contentBase64,
    "mediaType": agentSnapshotMediaTypeValues.reverse[mediaType],
  });
}

///同 Tenant 且读者当前可 discover 的未删除 AgentTeam 页（DD-131(1)(6)）；nextOffset 续读同一排序。
class AgentTeamPage {
  final int? nextOffset;
  final List<AgentTeamView> teams;

  AgentTeamPage({this.nextOffset, required this.teams});

  factory AgentTeamPage.fromJson(Map<String, dynamic> json) => AgentTeamPage(
    nextOffset: json["nextOffset"],
    teams: List<AgentTeamView>.from(
      json["teams"].map((x) => AgentTeamView.fromJson(x)),
    ),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "nextOffset": nextOffset,
    "teams": List<dynamic>.from(teams.map((x) => x.toJson())),
  });
}

///DD-131(1) 的 Tenant 级 agent_team Resource 及 AgentTeam 事实（03 §7）。memberAgentResourceIds
///只列读者当前可 discover 的成员，次序不变；hiddenMemberCount 是其余成员个数，不暴露其 ID。catalogShared 表示该团队已写入
///tenant#member 的 discoverer/reader（DD-131(6)）。成员停用或删除不改写团队，部署与提及时按当前状态跳过。
class AgentTeamView {
  final bool catalogShared;
  final String? description;
  final int hiddenMemberCount;
  final List<String> memberAgentResourceIds;
  final String name;
  final String ownerPrincipalId;
  final String resourceId;
  final ResourceState resourceState;
  final int resourceVersion;

  AgentTeamView({
    required this.catalogShared,
    this.description,
    required this.hiddenMemberCount,
    required this.memberAgentResourceIds,
    required this.name,
    required this.ownerPrincipalId,
    required this.resourceId,
    required this.resourceState,
    required this.resourceVersion,
  });

  factory AgentTeamView.fromJson(Map<String, dynamic> json) => AgentTeamView(
    catalogShared: json["catalogShared"],
    description: json["description"],
    hiddenMemberCount: json["hiddenMemberCount"],
    memberAgentResourceIds: List<String>.from(
      json["memberAgentResourceIds"].map((x) => x),
    ),
    name: json["name"],
    ownerPrincipalId: json["ownerPrincipalId"],
    resourceId: json["resourceId"],
    resourceState: resourceStateValues.map[json["resourceState"]]!,
    resourceVersion: json["resourceVersion"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "catalogShared": catalogShared,
    "description": description,
    "hiddenMemberCount": hiddenMemberCount,
    "memberAgentResourceIds": List<dynamic>.from(
      memberAgentResourceIds.map((x) => x),
    ),
    "name": name,
    "ownerPrincipalId": ownerPrincipalId,
    "resourceId": resourceId,
    "resourceState": resourceStateValues.reverse[resourceState],
    "resourceVersion": resourceVersion,
  });
}

///DD-131(3)：校验通过的团队快照包的导入预览与一次性暂存引用。团队名与说明进入新 agent_team；每个成员按 DD-131(2) 映射为将新建的 Definition
///与 DRAFT。团队 instructions 不进入包也不导入（DD-131(1)）。确认导入经 agent.team.import，任一成员失败整包不提交。
class AgentTeamSnapshotImportPreview {
  final String? description;
  final String expiresAt;
  final AgentTeamSnapshotImportPreviewFormatKey formatKey;
  final AgentSnapshotMediaType mediaType;
  final List<AgentTeamSnapshotImportPreviewMembersItem> members;
  final String name;
  final int packageByteSize;
  final String packageDigest;

  ///包内带有原版团队 instructions；按 DD-131(1) 不导入。
  final bool teamInstructionsOmitted;
  final String uploadId;

  AgentTeamSnapshotImportPreview({
    this.description,
    required this.expiresAt,
    required this.formatKey,
    required this.mediaType,
    required this.members,
    required this.name,
    required this.packageByteSize,
    required this.packageDigest,
    required this.teamInstructionsOmitted,
    required this.uploadId,
  });

  factory AgentTeamSnapshotImportPreview.fromJson(Map<String, dynamic> json) =>
      AgentTeamSnapshotImportPreview(
        description: json["description"],
        expiresAt: json["expiresAt"],
        formatKey: agentTeamSnapshotImportPreviewFormatKeyValues
            .map[json["formatKey"]]!,
        mediaType: agentSnapshotMediaTypeValues.map[json["mediaType"]]!,
        members: List<AgentTeamSnapshotImportPreviewMembersItem>.from(
          json["members"].map(
            (x) => AgentTeamSnapshotImportPreviewMembersItem.fromJson(x),
          ),
        ),
        name: json["name"],
        packageByteSize: json["packageByteSize"],
        packageDigest: json["packageDigest"],
        teamInstructionsOmitted: json["teamInstructionsOmitted"],
        uploadId: json["uploadId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "description": description,
    "expiresAt": expiresAt,
    "formatKey":
        agentTeamSnapshotImportPreviewFormatKeyValues.reverse[formatKey],
    "mediaType": agentSnapshotMediaTypeValues.reverse[mediaType],
    "members": List<dynamic>.from(members.map((x) => x.toJson())),
    "name": name,
    "packageByteSize": packageByteSize,
    "packageDigest": packageDigest,
    "teamInstructionsOmitted": teamInstructionsOmitted,
    "uploadId": uploadId,
  });
}

enum AgentTeamSnapshotImportPreviewFormatKey { BUZZ_TEAM_SNAPSHOT_1 }

final agentTeamSnapshotImportPreviewFormatKeyValues = EnumValues({
  "buzz-team-snapshot@1":
      AgentTeamSnapshotImportPreviewFormatKey.BUZZ_TEAM_SNAPSHOT_1,
});

class AgentTeamSnapshotImportPreviewMembersItem {
  ///仅与 avatarUrl 同时出现：包内该成员头像的原字节（data URL），只供预览显示，不写入任何对象。
  final String? avatarDataUrl;

  ///该成员内联头像在本 Tenant 媒体中的对象地址（/media/<sha256>），即其 DRAFT 的 personaIdentity.avatarUrl。
  final String? avatarUrl;
  final String? description;
  final String displayName;

  ///可为空串：成员没有 systemPrompt 时生成空指令的 DRAFT，补充后才能发布。
  final String instructions;
  final List<AgentSnapshotOmission> omitted;

  AgentTeamSnapshotImportPreviewMembersItem({
    this.avatarDataUrl,
    this.avatarUrl,
    this.description,
    required this.displayName,
    required this.instructions,
    required this.omitted,
  });

  factory AgentTeamSnapshotImportPreviewMembersItem.fromJson(
    Map<String, dynamic> json,
  ) => AgentTeamSnapshotImportPreviewMembersItem(
    avatarDataUrl: json["avatarDataUrl"],
    avatarUrl: json["avatarUrl"],
    description: json["description"],
    displayName: json["displayName"],
    instructions: json["instructions"],
    omitted: List<AgentSnapshotOmission>.from(
      json["omitted"].map((x) => agentSnapshotOmissionValues.map[x]!),
    ),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "avatarDataUrl": avatarDataUrl,
    "avatarUrl": avatarUrl,
    "description": description,
    "displayName": displayName,
    "instructions": instructions,
    "omitted": List<dynamic>.from(
      omitted.map((x) => agentSnapshotOmissionValues.reverse[x]),
    ),
  });
}

///DD-131(3)：一次团队快照包的原始字节（标准 base64，Web 与 Desktop 同一 JSON 传输）。解码后 JSON 不超过 25 MiB、PNG 不超过 50
///MiB；格式与版本由 Core 判定。
class AgentTeamSnapshotUploadRequest {
  final String contentBase64;
  final AgentSnapshotMediaType mediaType;

  AgentTeamSnapshotUploadRequest({
    required this.contentBase64,
    required this.mediaType,
  });

  factory AgentTeamSnapshotUploadRequest.fromJson(Map<String, dynamic> json) =>
      AgentTeamSnapshotUploadRequest(
        contentBase64: json["contentBase64"],
        mediaType: agentSnapshotMediaTypeValues.map[json["mediaType"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "contentBase64": contentBase64,
    "mediaType": agentSnapshotMediaTypeValues.reverse[mediaType],
  });
}

///GET /api/v1/agent-installations/{id}/transcript/stream 的 SSE 数据帧（DD-125(6)）：Core 从同一
///Installation 原生进程读到的 item/started、item/completed、turn/started、turn/completed 通知，按 thread
///解析到 AgentSession 后转发；只在建立时与周期性再准入下 Installation audit 成立期间发送，建立时写 ACCESS
///审计。帧不落库，断线后以分页读取补齐。
class AgentTranscriptEvent {
  ///原生通知时间（item 的 startedAtMs/completedAtMs 或 turn 通知的 emittedAtMs），Unix 毫秒。
  final int? atMs;
  final String installationId;

  ///ITEM_STARTED / ITEM_COMPLETED 时给出。
  final AgentTranscriptItem? item;
  final AgentTranscriptEventPhase phase;
  final int projectionGeneration;
  final String rootEventId;
  final String threadId;
  final String turnId;

  AgentTranscriptEvent({
    this.atMs,
    required this.installationId,
    this.item,
    required this.phase,
    required this.projectionGeneration,
    required this.rootEventId,
    required this.threadId,
    required this.turnId,
  });

  factory AgentTranscriptEvent.fromJson(Map<String, dynamic> json) =>
      AgentTranscriptEvent(
        atMs: json["atMs"],
        installationId: json["installationId"],
        item: json["item"] == null
            ? null
            : AgentTranscriptItem.fromJson(json["item"]),
        phase: agentTranscriptEventPhaseValues.map[json["phase"]]!,
        projectionGeneration: json["projectionGeneration"],
        rootEventId: json["rootEventId"],
        threadId: json["threadId"],
        turnId: json["turnId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "atMs": atMs,
    "installationId": installationId,
    "item": item?.toJson(),
    "phase": agentTranscriptEventPhaseValues.reverse[phase],
    "projectionGeneration": projectionGeneration,
    "rootEventId": rootEventId,
    "threadId": threadId,
    "turnId": turnId,
  });
}

///ITEM_STARTED / ITEM_COMPLETED 时给出。
///
///DD-125(6)、SF-COD-09/17、17 §8：一条 Codex ThreadItem 的转写适配形状。BFF 只在 Installation Resource
///audit 准入后，由 Core 经同一 Installation 的原生 app-server 读取（thread/items/list 或
///item/started、item/completed 通知），按固定 Codex 类型逐字段映射后直接回应；Core 不存储、不复制正文。变体按 kind
///解释，各变体字段全部可选（contracts §1 平坦结构）。客户端把它适配为原 Buzz 转写条目。
class AgentTranscriptItem {
  ///COMMAND_EXECUTION 的 stdout/stderr 聚合输出。
  final String? aggregatedOutput;

  ///工具调用参数的 JSON 文本（原生 arguments 原样序列化）。
  final String? argumentsJson;

  ///COMMAND_EXECUTION 的命令。
  final String? command;

  ///item/completed 的 completedAtMs（Unix 毫秒）；历史页没有该原生事实时省略。
  final int? completedAtMs;

  ///COMMAND_EXECUTION 的工作目录（Installation 隔离目录内）。
  final String? cwd;

  ///COMMAND_EXECUTION、MCP_TOOL_CALL、DYNAMIC_TOOL_CALL 的原生耗时。
  final int? durationMs;

  ///MCP_TOOL_CALL 的原生 error.message。
  final String? errorText;
  final int? exitCode;

  ///FILE_CHANGE 的逐文件变更。
  final List<AgentTranscriptFileChange>? fileChanges;

  ///原生 ThreadItem.id。
  final String itemId;
  final AgentTranscriptItemKind kind;

  ///原生 ThreadItem 的 type 标签原文（如 commandExecution）；OTHER 时客户端以原 raw 条目呈现。
  final String nativeType;
  final AgentTranscriptMessagePhase? phase;

  ///WEB_SEARCH 的查询词（部署已关闭托管搜索，一般不出现）。
  final String? query;

  ///REASONING 的原文段（原生提供时）。
  final List<String>? reasoningContent;

  ///REASONING 的 summary 段。
  final List<String>? reasoningSummary;

  ///工具结果中的文本内容按原顺序以换行连接；非文本内容不转发。
  final String? resultText;

  ///MCP_TOOL_CALL 的 MCP server 名；DYNAMIC_TOOL_CALL 的 namespace。
  final String? server;

  ///item/started 的 startedAtMs（Unix 毫秒）；历史页没有该原生事实时省略。
  final int? startedAtMs;
  final AgentTranscriptItemStatus? status;

  ///USER_MESSAGE 的文本输入按原顺序以换行连接；AGENT_MESSAGE 与 PLAN 的正文。
  final String? text;

  ///MCP_TOOL_CALL / DYNAMIC_TOOL_CALL 的工具名。
  final String? tool;

  ///所属原生 turn ID。
  final String turnId;

  AgentTranscriptItem({
    this.aggregatedOutput,
    this.argumentsJson,
    this.command,
    this.completedAtMs,
    this.cwd,
    this.durationMs,
    this.errorText,
    this.exitCode,
    this.fileChanges,
    required this.itemId,
    required this.kind,
    required this.nativeType,
    this.phase,
    this.query,
    this.reasoningContent,
    this.reasoningSummary,
    this.resultText,
    this.server,
    this.startedAtMs,
    this.status,
    this.text,
    this.tool,
    required this.turnId,
  });

  factory AgentTranscriptItem.fromJson(Map<String, dynamic> json) =>
      AgentTranscriptItem(
        aggregatedOutput: json["aggregatedOutput"],
        argumentsJson: json["argumentsJson"],
        command: json["command"],
        completedAtMs: json["completedAtMs"],
        cwd: json["cwd"],
        durationMs: json["durationMs"],
        errorText: json["errorText"],
        exitCode: json["exitCode"],
        fileChanges: json["fileChanges"] == null
            ? null
            : List<AgentTranscriptFileChange>.from(
                json["fileChanges"]!.map(
                  (x) => AgentTranscriptFileChange.fromJson(x),
                ),
              ),
        itemId: json["itemId"],
        kind: agentTranscriptItemKindValues.map[json["kind"]]!,
        nativeType: json["nativeType"],
        phase: json["phase"] == null
            ? null
            : agentTranscriptMessagePhaseValues.map[json["phase"]]!,
        query: json["query"],
        reasoningContent: json["reasoningContent"] == null
            ? null
            : List<String>.from(json["reasoningContent"]!.map((x) => x)),
        reasoningSummary: json["reasoningSummary"] == null
            ? null
            : List<String>.from(json["reasoningSummary"]!.map((x) => x)),
        resultText: json["resultText"],
        server: json["server"],
        startedAtMs: json["startedAtMs"],
        status: json["status"] == null
            ? null
            : agentTranscriptItemStatusValues.map[json["status"]]!,
        text: json["text"],
        tool: json["tool"],
        turnId: json["turnId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "aggregatedOutput": aggregatedOutput,
    "argumentsJson": argumentsJson,
    "command": command,
    "completedAtMs": completedAtMs,
    "cwd": cwd,
    "durationMs": durationMs,
    "errorText": errorText,
    "exitCode": exitCode,
    "fileChanges": fileChanges == null
        ? null
        : List<dynamic>.from(fileChanges!.map((x) => x.toJson())),
    "itemId": itemId,
    "kind": agentTranscriptItemKindValues.reverse[kind],
    "nativeType": nativeType,
    "phase": agentTranscriptMessagePhaseValues.reverse[phase],
    "query": query,
    "reasoningContent": reasoningContent == null
        ? null
        : List<dynamic>.from(reasoningContent!.map((x) => x)),
    "reasoningSummary": reasoningSummary == null
        ? null
        : List<dynamic>.from(reasoningSummary!.map((x) => x)),
    "resultText": resultText,
    "server": server,
    "startedAtMs": startedAtMs,
    "status": agentTranscriptItemStatusValues.reverse[status],
    "text": text,
    "tool": tool,
    "turnId": turnId,
  });
}

class AgentTranscriptFileChange {
  final AgentTranscriptFileChangeKind changeKind;

  ///原生 unified diff 文本。
  final String diff;

  ///UPDATE 改名时的目标路径。
  final String? movePath;
  final String path;

  AgentTranscriptFileChange({
    required this.changeKind,
    required this.diff,
    this.movePath,
    required this.path,
  });

  factory AgentTranscriptFileChange.fromJson(Map<String, dynamic> json) =>
      AgentTranscriptFileChange(
        changeKind:
            agentTranscriptFileChangeKindValues.map[json["changeKind"]]!,
        diff: json["diff"],
        movePath: json["movePath"],
        path: json["path"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "changeKind": agentTranscriptFileChangeKindValues.reverse[changeKind],
    "diff": diff,
    "movePath": movePath,
    "path": path,
  });
}

///Codex FileUpdateChange.kind 的标签（add/delete/update）；update 的改名目标另以 movePath 给出。
enum AgentTranscriptFileChangeKind { ADD, DELETE, UPDATE }

final agentTranscriptFileChangeKindValues = EnumValues({
  "ADD": AgentTranscriptFileChangeKind.ADD,
  "DELETE": AgentTranscriptFileChangeKind.DELETE,
  "UPDATE": AgentTranscriptFileChangeKind.UPDATE,
});

///DD-125(6)、SF-COD-17：Codex app-server 持久 ThreadItem 的类型标签在转写线格式中的封闭投影。BFF 只把固定 Codex 的
///userMessage/agentMessage/plan/reasoning/commandExecution/fileChange/mcpToolCall/dynamicToolCall/webSearch/imageView/contextCompaction
///映射为对应值，其余原生类型一律 OTHER 并保留 nativeType；客户端按原 Buzz 转写条目（TranscriptItem）呈现。
enum AgentTranscriptItemKind {
  AGENT_MESSAGE,
  COMMAND_EXECUTION,
  CONTEXT_COMPACTION,
  DYNAMIC_TOOL_CALL,
  FILE_CHANGE,
  IMAGE_VIEW,
  MCP_TOOL_CALL,
  OTHER,
  PLAN,
  REASONING,
  USER_MESSAGE,
  WEB_SEARCH,
}

final agentTranscriptItemKindValues = EnumValues({
  "AGENT_MESSAGE": AgentTranscriptItemKind.AGENT_MESSAGE,
  "COMMAND_EXECUTION": AgentTranscriptItemKind.COMMAND_EXECUTION,
  "CONTEXT_COMPACTION": AgentTranscriptItemKind.CONTEXT_COMPACTION,
  "DYNAMIC_TOOL_CALL": AgentTranscriptItemKind.DYNAMIC_TOOL_CALL,
  "FILE_CHANGE": AgentTranscriptItemKind.FILE_CHANGE,
  "IMAGE_VIEW": AgentTranscriptItemKind.IMAGE_VIEW,
  "MCP_TOOL_CALL": AgentTranscriptItemKind.MCP_TOOL_CALL,
  "OTHER": AgentTranscriptItemKind.OTHER,
  "PLAN": AgentTranscriptItemKind.PLAN,
  "REASONING": AgentTranscriptItemKind.REASONING,
  "USER_MESSAGE": AgentTranscriptItemKind.USER_MESSAGE,
  "WEB_SEARCH": AgentTranscriptItemKind.WEB_SEARCH,
});

///Codex agentMessage 的 phase（commentary / final_answer）；原生缺省 phase 的旧消息省略本字段。
enum AgentTranscriptMessagePhase { COMMENTARY, FINAL_ANSWER }

final agentTranscriptMessagePhaseValues = EnumValues({
  "COMMENTARY": AgentTranscriptMessagePhase.COMMENTARY,
  "FINAL_ANSWER": AgentTranscriptMessagePhase.FINAL_ANSWER,
});

///Codex commandExecution/fileChange/mcpToolCall/dynamicToolCall
///的原生状态（inProgress/completed/failed/declined）在转写中的封闭投影；无状态的条目省略。
enum AgentTranscriptItemStatus { COMPLETED, DECLINED, FAILED, IN_PROGRESS }

final agentTranscriptItemStatusValues = EnumValues({
  "COMPLETED": AgentTranscriptItemStatus.COMPLETED,
  "DECLINED": AgentTranscriptItemStatus.DECLINED,
  "FAILED": AgentTranscriptItemStatus.FAILED,
  "IN_PROGRESS": AgentTranscriptItemStatus.IN_PROGRESS,
});

///实时转写帧的来源通知：item/started、item/completed、turn/started、turn/completed（SF-COD-17）。只转发 Core
///已从同一 Installation 原生进程读到的通知，不合成。
enum AgentTranscriptEventPhase {
  ITEM_COMPLETED,
  ITEM_STARTED,
  TURN_COMPLETED,
  TURN_STARTED,
}

final agentTranscriptEventPhaseValues = EnumValues({
  "ITEM_COMPLETED": AgentTranscriptEventPhase.ITEM_COMPLETED,
  "ITEM_STARTED": AgentTranscriptEventPhase.ITEM_STARTED,
  "TURN_COMPLETED": AgentTranscriptEventPhase.TURN_COMPLETED,
  "TURN_STARTED": AgentTranscriptEventPhase.TURN_STARTED,
});

///GET
////api/v1/agent-installations/{id}/transcript?rootEventId&projectionGeneration&cursor（DD-125(6)、V-SCN-143）：按
///AgentSession 分页读取 Codex thread/items/list（升序），要求 Installation Resource audit，受审计敏感读取，Core
///不复制正文。nextCursor 绑定读者、Installation 与 Session，原生 cursor 不外露。activeTurn 只在该 Session
///有运行中回合时给出。Session 尚无原生 thread 时 items 为空且省略 threadId。
class AgentTranscriptPage {
  final AgentActiveTurnView? activeTurn;
  final String installationId;
  final List<AgentTranscriptItem> items;
  final String? nextCursor;
  final int projectionGeneration;
  final String rootEventId;
  final String? threadId;

  AgentTranscriptPage({
    this.activeTurn,
    required this.installationId,
    required this.items,
    this.nextCursor,
    required this.projectionGeneration,
    required this.rootEventId,
    this.threadId,
  });

  factory AgentTranscriptPage.fromJson(Map<String, dynamic> json) =>
      AgentTranscriptPage(
        activeTurn: json["activeTurn"] == null
            ? null
            : AgentActiveTurnView.fromJson(json["activeTurn"]),
        installationId: json["installationId"],
        items: List<AgentTranscriptItem>.from(
          json["items"].map((x) => AgentTranscriptItem.fromJson(x)),
        ),
        nextCursor: json["nextCursor"],
        projectionGeneration: json["projectionGeneration"],
        rootEventId: json["rootEventId"],
        threadId: json["threadId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "activeTurn": activeTurn?.toJson(),
    "installationId": installationId,
    "items": List<dynamic>.from(items.map((x) => x.toJson())),
    "nextCursor": nextCursor,
    "projectionGeneration": projectionGeneration,
    "rootEventId": rootEventId,
    "threadId": threadId,
  });
}

///DD-24/25/26：Definition 范围的受权版本配置目录，消费平台发布 RuntimeProfile 合同与已治理 Route。缺真实来源时两目录为空且
///canCreate=false；目录或 canCreate 不授予发布、安装和运行权限。
class AgentVersionConfigurationPage {
  final String agentResourceId;
  final bool canCreate;
  final int? nextOffset;
  final List<RuntimeProfileDirectoryProfilesItem> profiles;
  final int resourceVersion;
  final List<AgentVersionRouteOption> routes;

  AgentVersionConfigurationPage({
    required this.agentResourceId,
    required this.canCreate,
    required this.nextOffset,
    required this.profiles,
    required this.resourceVersion,
    required this.routes,
  });

  factory AgentVersionConfigurationPage.fromJson(Map<String, dynamic> json) =>
      AgentVersionConfigurationPage(
        agentResourceId: json["agentResourceId"],
        canCreate: json["canCreate"],
        nextOffset: json["nextOffset"],
        profiles: List<RuntimeProfileDirectoryProfilesItem>.from(
          json["profiles"].map(
            (x) => RuntimeProfileDirectoryProfilesItem.fromJson(x),
          ),
        ),
        resourceVersion: json["resourceVersion"],
        routes: List<AgentVersionRouteOption>.from(
          json["routes"].map((x) => AgentVersionRouteOption.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentResourceId": agentResourceId,
    "canCreate": canCreate,
    "nextOffset": nextOffset,
    "profiles": List<dynamic>.from(profiles.map((x) => x.toJson())),
    "resourceVersion": resourceVersion,
    "routes": List<dynamic>.from(routes.map((x) => x.toJson())),
  });
}

///DD-24/25、17 §3/8：同 Definition 下逐项 fresh Asset read 后的版本目录；DRAFT 可发现，PUBLISHED/RETIRED
///不可编辑。nextOffset 属原始扫描窗口，空的受权页不证明全集为空。
class AgentVersionPage {
  final String agentResourceId;
  final int? nextOffset;
  final int resourceVersion;
  final List<AgentVersionView> versions;

  AgentVersionPage({
    required this.agentResourceId,
    required this.nextOffset,
    required this.resourceVersion,
    required this.versions,
  });

  factory AgentVersionPage.fromJson(Map<String, dynamic> json) =>
      AgentVersionPage(
        agentResourceId: json["agentResourceId"],
        nextOffset: json["nextOffset"],
        resourceVersion: json["resourceVersion"],
        versions: List<AgentVersionView>.from(
          json["versions"].map((x) => AgentVersionView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentResourceId": agentResourceId,
    "nextOffset": nextOffset,
    "resourceVersion": resourceVersion,
    "versions": List<dynamic>.from(versions.map((x) => x.toJson())),
  });
}

class AgentVersionView {
  final String agentResourceId;
  final String assetId;
  final int assetVersion;

  ///Exact avatar URLs belonging to this authorized Version's current Tenant Community mapped
  ///to the existing same-origin profile media reader. Read projection only; not content, a
  ///credential, or an arbitrary remote proxy.
  final Map<String, String>? avatarMediaPaths;

  ///当前 HUMAN 对此 exact DRAFT 的已登记 EXPLICIT publish 动作及 fresh Asset manage
  ///资格；缺字段不允许发布，不证明已安装或可运行。
  final bool? canPublish;

  ///当前 HUMAN 对此 exact PUBLISHED 的已登记 EXPLICIT retire 动作及 fresh Asset manage
  ///资格；缺字段不允许退役，退役只禁止新安装，保留既有安装与在途的固定版本。
  final bool? canRetire;

  ///当前 HUMAN 对此 exact DRAFT 的已登记 update 动作及 fresh Asset update 资格；缺字段不允许编辑，提交时仍重验。
  final bool? canUpdate;
  final String configHash;
  final AgentVersionContent content;
  final int ordinal;
  final String ownerPrincipalId;
  final AgentVersionState state;

  AgentVersionView({
    required this.agentResourceId,
    required this.assetId,
    required this.assetVersion,
    this.avatarMediaPaths,
    this.canPublish,
    this.canRetire,
    this.canUpdate,
    required this.configHash,
    required this.content,
    required this.ordinal,
    required this.ownerPrincipalId,
    required this.state,
  });

  factory AgentVersionView.fromJson(Map<String, dynamic> json) =>
      AgentVersionView(
        agentResourceId: json["agentResourceId"],
        assetId: json["assetId"],
        assetVersion: json["assetVersion"],
        avatarMediaPaths: json["avatarMediaPaths"] == null
            ? null
            : Map.from(
                json["avatarMediaPaths"]!,
              ).map((k, v) => MapEntry<String, String>(k, v)),
        canPublish: json["canPublish"],
        canRetire: json["canRetire"],
        canUpdate: json["canUpdate"],
        configHash: json["configHash"],
        content: AgentVersionContent.fromJson(json["content"]),
        ordinal: json["ordinal"],
        ownerPrincipalId: json["ownerPrincipalId"],
        state: agentVersionStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentResourceId": agentResourceId,
    "assetId": assetId,
    "assetVersion": assetVersion,
    "avatarMediaPaths": avatarMediaPaths == null
        ? null
        : Map.from(
            avatarMediaPaths!,
          ).map((k, v) => MapEntry<String, dynamic>(k, v)),
    "canPublish": canPublish,
    "canRetire": canRetire,
    "canUpdate": canUpdate,
    "configHash": configHash,
    "content": content.toJson(),
    "ordinal": ordinal,
    "ownerPrincipalId": ownerPrincipalId,
    "state": agentVersionStateValues.reverse[state],
  });
}

///仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
///
///03 §7、17 §3 的 requested 行为内容；不含 owner、Workspace、凭据、provider 地址或 host
///environment。发布不等于安装或运行授权。DRAFT 可缺 runtimeProfileKey、modelRouteResourceId 与
///replyPolicy，instructions 可为空串（DD-131(2) 导入草稿与原版一致不要求运行配置）；agent.version.publish
///准入时三者必须齐备且 instructions 非空，PUBLISHED 版本总是完整。
class AgentVersionContent {
  ///精确 contract_key@version，不引用业务能力实现名。
  final List<String> capabilityRequirements;
  final List<String> declaredToolResourceIds;
  final String instructions;
  final AgentVersionContentMemoryPolicy memoryPolicy;

  ///DRAFT 可缺省；发布时必填。
  final String? modelRouteResourceId;
  final int parallelism;
  final AgentVersionContentPersonaIdentity personaIdentity;

  ///RuntimeProfile capability contract 所声明的回复策略键；不隐式授予触发或读取权限。DRAFT 可缺省；发布时必填。
  final String? replyPolicy;

  ///DRAFT 可缺省；发布时必填。
  final String? runtimeProfileKey;
  final List<String> skillVersionAssetIds;
  final List<AgentTrigger> triggerDefaults;
  final AgentVersionContentTurnLimits turnLimits;

  AgentVersionContent({
    required this.capabilityRequirements,
    required this.declaredToolResourceIds,
    required this.instructions,
    required this.memoryPolicy,
    this.modelRouteResourceId,
    required this.parallelism,
    required this.personaIdentity,
    this.replyPolicy,
    this.runtimeProfileKey,
    required this.skillVersionAssetIds,
    required this.triggerDefaults,
    required this.turnLimits,
  });

  factory AgentVersionContent.fromJson(Map<String, dynamic> json) =>
      AgentVersionContent(
        capabilityRequirements: List<String>.from(
          json["capabilityRequirements"].map((x) => x),
        ),
        declaredToolResourceIds: List<String>.from(
          json["declaredToolResourceIds"].map((x) => x),
        ),
        instructions: json["instructions"],
        memoryPolicy: AgentVersionContentMemoryPolicy.fromJson(
          json["memoryPolicy"],
        ),
        modelRouteResourceId: json["modelRouteResourceId"],
        parallelism: json["parallelism"],
        personaIdentity: AgentVersionContentPersonaIdentity.fromJson(
          json["personaIdentity"],
        ),
        replyPolicy: json["replyPolicy"],
        runtimeProfileKey: json["runtimeProfileKey"],
        skillVersionAssetIds: List<String>.from(
          json["skillVersionAssetIds"].map((x) => x),
        ),
        triggerDefaults: List<AgentTrigger>.from(
          json["triggerDefaults"].map((x) => agentTriggerValues.map[x]!),
        ),
        turnLimits: AgentVersionContentTurnLimits.fromJson(json["turnLimits"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "capabilityRequirements": List<dynamic>.from(
      capabilityRequirements.map((x) => x),
    ),
    "declaredToolResourceIds": List<dynamic>.from(
      declaredToolResourceIds.map((x) => x),
    ),
    "instructions": instructions,
    "memoryPolicy": memoryPolicy.toJson(),
    "modelRouteResourceId": modelRouteResourceId,
    "parallelism": parallelism,
    "personaIdentity": personaIdentity.toJson(),
    "replyPolicy": replyPolicy,
    "runtimeProfileKey": runtimeProfileKey,
    "skillVersionAssetIds": List<dynamic>.from(
      skillVersionAssetIds.map((x) => x),
    ),
    "triggerDefaults": List<dynamic>.from(
      triggerDefaults.map((x) => agentTriggerValues.reverse[x]),
    ),
    "turnLimits": turnLimits.toJson(),
  });
}

class AgentVersionContentMemoryPolicy {
  final AgentMemoryColdWrite coldWrite;
  final AgentMemoryCoreWrite coreWrite;

  AgentVersionContentMemoryPolicy({
    required this.coldWrite,
    required this.coreWrite,
  });

  factory AgentVersionContentMemoryPolicy.fromJson(Map<String, dynamic> json) =>
      AgentVersionContentMemoryPolicy(
        coldWrite: agentMemoryColdWriteValues.map[json["coldWrite"]]!,
        coreWrite: agentMemoryCoreWriteValues.map[json["coreWrite"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "coldWrite": agentMemoryColdWriteValues.reverse[coldWrite],
    "coreWrite": agentMemoryCoreWriteValues.reverse[coreWrite],
  });
}

enum AgentMemoryColdWrite { DISABLED, INVOCATION_SCOPED }

final agentMemoryColdWriteValues = EnumValues({
  "DISABLED": AgentMemoryColdWrite.DISABLED,
  "INVOCATION_SCOPED": AgentMemoryColdWrite.INVOCATION_SCOPED,
});

enum AgentMemoryCoreWrite { AGENT_WITH_APPROVAL, HUMAN_ONLY }

final agentMemoryCoreWriteValues = EnumValues({
  "AGENT_WITH_APPROVAL": AgentMemoryCoreWrite.AGENT_WITH_APPROVAL,
  "HUMAN_ONLY": AgentMemoryCoreWrite.HUMAN_ONLY,
});

class AgentVersionContentPersonaIdentity {
  final String? avatarUrl;
  final String? description;
  final String displayName;

  AgentVersionContentPersonaIdentity({
    this.avatarUrl,
    this.description,
    required this.displayName,
  });

  factory AgentVersionContentPersonaIdentity.fromJson(
    Map<String, dynamic> json,
  ) => AgentVersionContentPersonaIdentity(
    avatarUrl: json["avatarUrl"],
    description: json["description"],
    displayName: json["displayName"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "avatarUrl": avatarUrl,
    "description": description,
    "displayName": displayName,
  });
}

class AgentVersionContentTurnLimits {
  final int idleTimeoutSeconds;
  final int maxTurnDurationSeconds;

  AgentVersionContentTurnLimits({
    required this.idleTimeoutSeconds,
    required this.maxTurnDurationSeconds,
  });

  factory AgentVersionContentTurnLimits.fromJson(Map<String, dynamic> json) =>
      AgentVersionContentTurnLimits(
        idleTimeoutSeconds: json["idleTimeoutSeconds"],
        maxTurnDurationSeconds: json["maxTurnDurationSeconds"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "idleTimeoutSeconds": idleTimeoutSeconds,
    "maxTurnDurationSeconds": maxTurnDurationSeconds,
  });
}

enum AgentVersionState { DRAFT, PUBLISHED, RETIRED }

final agentVersionStateValues = EnumValues({
  "DRAFT": AgentVersionState.DRAFT,
  "PUBLISHED": AgentVersionState.PUBLISHED,
  "RETIRED": AgentVersionState.RETIRED,
});

///当前HUMAN管理scope内的真实接入元数据。不是组件内部状态、配置、SecretRef或原生管理credential。
class ApplicationBindingPage {
  ///仅 canCreate=true 时给出：Catalog 中已 APPROVED 的 APPLICATION release 的绑定所需公开声明（03
  ///§9）。secretSchema 只含键与格式声明，供 Tenant admin 按项提交 bindingSecretValues；不含任何 secret
  ///值、SecretRef、locator 或 Catalog 管理权。
  final List<ApplicationBindableRelease>? bindableReleases;
  final List<ApplicationBindingView> bindings;
  final bool canCreate;
  final int? nextOffset;

  ApplicationBindingPage({
    this.bindableReleases,
    required this.bindings,
    required this.canCreate,
    this.nextOffset,
  });

  factory ApplicationBindingPage.fromJson(Map<String, dynamic> json) =>
      ApplicationBindingPage(
        bindableReleases: json["bindableReleases"] == null
            ? null
            : List<ApplicationBindableRelease>.from(
                json["bindableReleases"]!.map(
                  (x) => ApplicationBindableRelease.fromJson(x),
                ),
              ),
        bindings: List<ApplicationBindingView>.from(
          json["bindings"].map((x) => ApplicationBindingView.fromJson(x)),
        ),
        canCreate: json["canCreate"],
        nextOffset: json["nextOffset"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindableReleases": bindableReleases == null
        ? null
        : List<dynamic>.from(bindableReleases!.map((x) => x.toJson())),
    "bindings": List<dynamic>.from(bindings.map((x) => x.toJson())),
    "canCreate": canCreate,
    "nextOffset": nextOffset,
  });
}

class ApplicationBindableRelease {
  final String componentReleaseId;
  final String componentTypeKey;
  final List<ApplicationBindableSecret> secretSchema;
  final String version;

  ApplicationBindableRelease({
    required this.componentReleaseId,
    required this.componentTypeKey,
    required this.secretSchema,
    required this.version,
  });

  factory ApplicationBindableRelease.fromJson(Map<String, dynamic> json) =>
      ApplicationBindableRelease(
        componentReleaseId: json["componentReleaseId"],
        componentTypeKey: json["componentTypeKey"],
        secretSchema: List<ApplicationBindableSecret>.from(
          json["secretSchema"].map(
            (x) => ApplicationBindableSecret.fromJson(x),
          ),
        ),
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "componentReleaseId": componentReleaseId,
    "componentTypeKey": componentTypeKey,
    "secretSchema": List<dynamic>.from(secretSchema.map((x) => x.toJson())),
    "version": version,
  });
}

class ApplicationBindableSecret {
  final String lengthOrFormat;
  final String secretKey;
  final String valueType;

  ApplicationBindableSecret({
    required this.lengthOrFormat,
    required this.secretKey,
    required this.valueType,
  });

  factory ApplicationBindableSecret.fromJson(Map<String, dynamic> json) =>
      ApplicationBindableSecret(
        lengthOrFormat: json["lengthOrFormat"],
        secretKey: json["secretKey"],
        valueType: json["valueType"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "lengthOrFormat": lengthOrFormat,
    "secretKey": secretKey,
    "valueType": valueType,
  });
}

class ApplicationBindingView {
  final int? activeProjectionGeneration;
  final String bindingId;
  final bool canDisable;
  final List<ApplicationBindingCapability> capabilityCategories;
  final String componentReleaseId;
  final String componentTypeKey;

  ///Approved release declares an independent native page. Launch still freshly checks
  ///binding, scope and deployment origins.
  final bool? hasNativePage;

  ///Active approved binding declares a SERVICE read receiver. Resource discovery and writes
  ///still freshly check the original source share and receiver update permissions.
  final bool? hasReadReceiver;

  ///DD-127(4): presentation category the approved NATIVE_PAGE release declares. The sidebar
  ///labels the entry by capabilityCategories ∪ this value; it grants nothing.
  final NativePageCategory? nativePageCategory;

  ///DD-138: preference items the pinned APPROVED KAILO_EMBED release declares for Kailo
  ///settings (07 §4.8.2). Kailo settings render them by category, never by component. Absent
  ///when none; Core keeps no values.
  final List<ComponentPreferenceDeclaration>? preferences;
  final ApplicationBindingState state;
  final String tenantId;
  final int version;
  final String? workspaceId;

  ApplicationBindingView({
    this.activeProjectionGeneration,
    required this.bindingId,
    required this.canDisable,
    required this.capabilityCategories,
    required this.componentReleaseId,
    required this.componentTypeKey,
    this.hasNativePage,
    this.hasReadReceiver,
    this.nativePageCategory,
    this.preferences,
    required this.state,
    required this.tenantId,
    required this.version,
    this.workspaceId,
  });

  factory ApplicationBindingView.fromJson(Map<String, dynamic> json) =>
      ApplicationBindingView(
        activeProjectionGeneration: json["activeProjectionGeneration"],
        bindingId: json["bindingId"],
        canDisable: json["canDisable"],
        capabilityCategories: List<ApplicationBindingCapability>.from(
          json["capabilityCategories"].map(
            (x) => ApplicationBindingCapability.fromJson(x),
          ),
        ),
        componentReleaseId: json["componentReleaseId"],
        componentTypeKey: json["componentTypeKey"],
        hasNativePage: json["hasNativePage"],
        hasReadReceiver: json["hasReadReceiver"],
        nativePageCategory: json["nativePageCategory"] == null
            ? null
            : nativePageCategoryValues.map[json["nativePageCategory"]]!,
        preferences: json["preferences"] == null
            ? null
            : List<ComponentPreferenceDeclaration>.from(
                json["preferences"]!.map(
                  (x) => ComponentPreferenceDeclaration.fromJson(x),
                ),
              ),
        state: applicationBindingStateValues.map[json["state"]]!,
        tenantId: json["tenantId"],
        version: json["version"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "activeProjectionGeneration": activeProjectionGeneration,
    "bindingId": bindingId,
    "canDisable": canDisable,
    "capabilityCategories": List<dynamic>.from(
      capabilityCategories.map((x) => x.toJson()),
    ),
    "componentReleaseId": componentReleaseId,
    "componentTypeKey": componentTypeKey,
    "hasNativePage": hasNativePage,
    "hasReadReceiver": hasReadReceiver,
    "nativePageCategory": nativePageCategoryValues.reverse[nativePageCategory],
    "preferences": preferences == null
        ? null
        : List<dynamic>.from(preferences!.map((x) => x.toJson())),
    "state": applicationBindingStateValues.reverse[state],
    "tenantId": tenantId,
    "version": version,
    "workspaceId": workspaceId,
  });
}

class ApplicationBindingCapability {
  final String category;
  final int version;

  ApplicationBindingCapability({required this.category, required this.version});

  factory ApplicationBindingCapability.fromJson(Map<String, dynamic> json) =>
      ApplicationBindingCapability(
        category: json["category"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"category": category, "version": version});
}

///DD-127(4): presentation category the approved NATIVE_PAGE release declares. The sidebar
///labels the entry by capabilityCategories ∪ this value; it grants nothing.
///
///DD-127(4)：NATIVE_PAGE 入口的呈现类别，决定侧边栏标签与图标；不授予能力、不参与类别解析或授权。
enum NativePageCategory { DATA_QUERY, FILE_STORAGE, KNOWLEDGE }

final nativePageCategoryValues = EnumValues({
  "data_query": NativePageCategory.DATA_QUERY,
  "file_storage": NativePageCategory.FILE_STORAGE,
  "knowledge": NativePageCategory.KNOWLEDGE,
});

///DD-138：KAILO_EMBED release 向 Kailo 设置页贡献的一项偏好声明（03
///FrontendPresentationContract.preference_declarations[]，07 §4.8.2）。值对象，随 APPROVED release
///固定；Core 不保存偏好的值。键规则、选项数量与文案长度由 Core 登记时校验。
class ComponentPreferenceDeclaration {
  ///BOOLEAN 为 true/false，ENUM 为 options[].value 之一。
  final String defaultValue;
  final ComponentPreferenceText? description;

  ///Kailo 侧偏好键，2–4 段以 . 连接，不含组件名。
  final String key;
  final ComponentPreferenceText label;

  ///ENUM 时 2–12 项；BOOLEAN 时为空。
  final List<ComponentPreferenceOption> options;
  final ComponentPreferenceCategory settingsCategory;
  final ComponentPreferenceValueType valueType;

  ComponentPreferenceDeclaration({
    required this.defaultValue,
    this.description,
    required this.key,
    required this.label,
    required this.options,
    required this.settingsCategory,
    required this.valueType,
  });

  factory ComponentPreferenceDeclaration.fromJson(Map<String, dynamic> json) =>
      ComponentPreferenceDeclaration(
        defaultValue: json["defaultValue"],
        description: json["description"] == null
            ? null
            : ComponentPreferenceText.fromJson(json["description"]),
        key: json["key"],
        label: ComponentPreferenceText.fromJson(json["label"]),
        options: List<ComponentPreferenceOption>.from(
          json["options"].map((x) => ComponentPreferenceOption.fromJson(x)),
        ),
        settingsCategory:
            componentPreferenceCategoryValues.map[json["settingsCategory"]]!,
        valueType: componentPreferenceValueTypeValues.map[json["valueType"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "defaultValue": defaultValue,
    "description": description?.toJson(),
    "key": key,
    "label": label.toJson(),
    "options": List<dynamic>.from(options.map((x) => x.toJson())),
    "settingsCategory":
        componentPreferenceCategoryValues.reverse[settingsCategory],
    "valueType": componentPreferenceValueTypeValues.reverse[valueType],
  });
}

class ComponentPreferenceText {
  final String en;
  final String zhCn;

  ComponentPreferenceText({required this.en, required this.zhCn});

  factory ComponentPreferenceText.fromJson(Map<String, dynamic> json) =>
      ComponentPreferenceText(en: json["EN"], zhCn: json["ZH_CN"]);

  Map<String, dynamic> toJson() => _stripNulls({"EN": en, "ZH_CN": zhCn});
}

class ComponentPreferenceOption {
  final ComponentPreferenceText label;
  final String value;

  ComponentPreferenceOption({required this.label, required this.value});

  factory ComponentPreferenceOption.fromJson(Map<String, dynamic> json) =>
      ComponentPreferenceOption(
        label: ComponentPreferenceText.fromJson(json["label"]),
        value: json["value"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"label": label.toJson(), "value": value});
}

///DD-138：组件偏好项所属的 Kailo 设置功能分类（07 §4.8.2）。APPEARANCE 外观、NOTIFICATIONS 通知、DOCUMENTS
///文档与文件、ANSWERS 问答；不按组件分类。
enum ComponentPreferenceCategory {
  ANSWERS,
  APPEARANCE,
  DOCUMENTS,
  NOTIFICATIONS,
}

final componentPreferenceCategoryValues = EnumValues({
  "ANSWERS": ComponentPreferenceCategory.ANSWERS,
  "APPEARANCE": ComponentPreferenceCategory.APPEARANCE,
  "DOCUMENTS": ComponentPreferenceCategory.DOCUMENTS,
  "NOTIFICATIONS": ComponentPreferenceCategory.NOTIFICATIONS,
});

///DD-138：组件偏好项的取值类型。只有布尔与封闭选项，不接受自由文本、数字区间、URL、凭据或用户数据（07 §4.8.2）。
enum ComponentPreferenceValueType { BOOLEAN, ENUM }

final componentPreferenceValueTypeValues = EnumValues({
  "BOOLEAN": ComponentPreferenceValueType.BOOLEAN,
  "ENUM": ComponentPreferenceValueType.ENUM,
});

enum ApplicationBindingState {
  ACTIVE,
  DISABLED,
  DISABLING,
  ERROR,
  PROVISIONING,
  UPGRADING,
}

final applicationBindingStateValues = EnumValues({
  "ACTIVE": ApplicationBindingState.ACTIVE,
  "DISABLED": ApplicationBindingState.DISABLED,
  "DISABLING": ApplicationBindingState.DISABLING,
  "ERROR": ApplicationBindingState.ERROR,
  "PROVISIONING": ApplicationBindingState.PROVISIONING,
  "UPGRADING": ApplicationBindingState.UPGRADING,
});

///Authorized ACTIVE binding's independent native page. Exact origin is release and
///deployment approved; no native credential or page body is returned.
class ApplicationNativePage {
  final List<String> allowedOrigins;
  final String bindingId;
  final String origin;

  ///DD-138: preference items the pinned APPROVED KAILO_EMBED release declares for Kailo
  ///settings (07 §4.8.2); the host sends their values to this page only. Absent when none.
  final List<ComponentPreferenceDeclaration>? preferences;
  final int projectionGeneration;
  final String url;

  ApplicationNativePage({
    required this.allowedOrigins,
    required this.bindingId,
    required this.origin,
    this.preferences,
    required this.projectionGeneration,
    required this.url,
  });

  factory ApplicationNativePage.fromJson(Map<String, dynamic> json) =>
      ApplicationNativePage(
        allowedOrigins: List<String>.from(json["allowedOrigins"].map((x) => x)),
        bindingId: json["bindingId"],
        origin: json["origin"],
        preferences: json["preferences"] == null
            ? null
            : List<ComponentPreferenceDeclaration>.from(
                json["preferences"]!.map(
                  (x) => ComponentPreferenceDeclaration.fromJson(x),
                ),
              ),
        projectionGeneration: json["projectionGeneration"],
        url: json["url"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "allowedOrigins": List<dynamic>.from(allowedOrigins.map((x) => x)),
    "bindingId": bindingId,
    "origin": origin,
    "preferences": preferences == null
        ? null
        : List<dynamic>.from(preferences!.map((x) => x.toJson())),
    "projectionGeneration": projectionGeneration,
    "url": url,
  });
}

///Existing Resource references authorized for a HUMAN configuring a receiver binding's
///service read permission. No business body, credential or independent directory authority.
class ApplicationReadResourcePage {
  final String bindingId;
  final int bindingVersion;
  final ApplicationReadResourceDirection direction;
  final int? nextOffset;
  final List<ApplicationReadResource> resources;
  final String servicePrincipalId;
  final String tenantId;
  final String? workspaceId;

  ApplicationReadResourcePage({
    required this.bindingId,
    required this.bindingVersion,
    required this.direction,
    this.nextOffset,
    required this.resources,
    required this.servicePrincipalId,
    required this.tenantId,
    this.workspaceId,
  });

  factory ApplicationReadResourcePage.fromJson(Map<String, dynamic> json) =>
      ApplicationReadResourcePage(
        bindingId: json["bindingId"],
        bindingVersion: json["bindingVersion"],
        direction:
            applicationReadResourceDirectionValues.map[json["direction"]]!,
        nextOffset: json["nextOffset"],
        resources: List<ApplicationReadResource>.from(
          json["resources"].map((x) => ApplicationReadResource.fromJson(x)),
        ),
        servicePrincipalId: json["servicePrincipalId"],
        tenantId: json["tenantId"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "bindingVersion": bindingVersion,
    "direction": applicationReadResourceDirectionValues.reverse[direction],
    "nextOffset": nextOffset,
    "resources": List<dynamic>.from(resources.map((x) => x.toJson())),
    "servicePrincipalId": servicePrincipalId,
    "tenantId": tenantId,
    "workspaceId": workspaceId,
  });
}

class ApplicationReadResource {
  final String bindingId;
  final String nativeRef;
  final String resourceId;
  final String typeKey;
  final int version;
  final String? workspaceId;

  ApplicationReadResource({
    required this.bindingId,
    required this.nativeRef,
    required this.resourceId,
    required this.typeKey,
    required this.version,
    this.workspaceId,
  });

  factory ApplicationReadResource.fromJson(Map<String, dynamic> json) =>
      ApplicationReadResource(
        bindingId: json["bindingId"],
        nativeRef: json["nativeRef"],
        resourceId: json["resourceId"],
        typeKey: json["typeKey"],
        version: json["version"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "nativeRef": nativeRef,
    "resourceId": resourceId,
    "typeKey": typeKey,
    "version": version,
    "workspaceId": workspaceId,
  });
}

///POST /api/v1/approvals/{workflowId}/decision 的请求体；approver 由 PlatformSession 决定。回应为
///ApprovalDecisionOutcome。
class ApprovalDecisionRequest {
  final ApprovalDecision decision;

  ApprovalDecisionRequest({required this.decision});

  factory ApprovalDecisionRequest.fromJson(Map<String, dynamic> json) =>
      ApprovalDecisionRequest(
        decision: approvalDecisionValues.map[json["decision"]]!,
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"decision": approvalDecisionValues.reverse[decision]});
}

///approver 的不可变决定（.design/03 §6）。
///
///已形成的决定；admitted=false 时缺省
enum ApprovalDecision { APPROVE, DENY }

final approvalDecisionValues = EnumValues({
  "APPROVE": ApprovalDecision.APPROVE,
  "DENY": ApprovalDecision.DENY,
});

///GET /api/v1/approvals（待我审批）、GET /api/v1/approvals/initiated（本人发起且已有结果的审批，DD-125(5) Inbox
///Needs action 的第二来源）与 /api/v1/approvals/{workflowId} 的元素。状态只来自 Temporal history 的投影。
class ApprovalView {
  final String actionExecutionId;
  final String actionKey;
  final AutomationApprovalStepView? automationStep;

  ///RFC3339，UTC
  final String? consumeDeadline;
  final List<ApprovalDecisionRecord> decisions;

  ///RFC3339，UTC
  final String expiresAt;
  final String initiatorPrincipalId;
  final ReasonCode? observation;
  final ProjectChannelRequestApprovalView? projectChannelRequest;
  final ReasonCode? reason;
  final List<ApprovalRoleRequirement> roleRequirements;
  final ApprovalStatus status;
  final String targetId;
  final String targetType;
  final String workflowId;
  final String? workspaceId;

  ApprovalView({
    required this.actionExecutionId,
    required this.actionKey,
    this.automationStep,
    this.consumeDeadline,
    required this.decisions,
    required this.expiresAt,
    required this.initiatorPrincipalId,
    this.observation,
    this.projectChannelRequest,
    this.reason,
    required this.roleRequirements,
    required this.status,
    required this.targetId,
    required this.targetType,
    required this.workflowId,
    this.workspaceId,
  });

  factory ApprovalView.fromJson(Map<String, dynamic> json) => ApprovalView(
    actionExecutionId: json["actionExecutionId"],
    actionKey: json["actionKey"],
    automationStep: json["automationStep"] == null
        ? null
        : AutomationApprovalStepView.fromJson(json["automationStep"]),
    consumeDeadline: json["consumeDeadline"],
    decisions: List<ApprovalDecisionRecord>.from(
      json["decisions"].map((x) => ApprovalDecisionRecord.fromJson(x)),
    ),
    expiresAt: json["expiresAt"],
    initiatorPrincipalId: json["initiatorPrincipalId"],
    observation: json["observation"] == null
        ? null
        : reasonCodeValues.map[json["observation"]]!,
    projectChannelRequest: json["projectChannelRequest"] == null
        ? null
        : ProjectChannelRequestApprovalView.fromJson(
            json["projectChannelRequest"],
          ),
    reason: json["reason"] == null
        ? null
        : reasonCodeValues.map[json["reason"]]!,
    roleRequirements: List<ApprovalRoleRequirement>.from(
      json["roleRequirements"].map((x) => ApprovalRoleRequirement.fromJson(x)),
    ),
    status: approvalStatusValues.map[json["status"]]!,
    targetId: json["targetId"],
    targetType: json["targetType"],
    workflowId: json["workflowId"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "automationStep": automationStep?.toJson(),
    "consumeDeadline": consumeDeadline,
    "decisions": List<dynamic>.from(decisions.map((x) => x.toJson())),
    "expiresAt": expiresAt,
    "initiatorPrincipalId": initiatorPrincipalId,
    "observation": reasonCodeValues.reverse[observation],
    "projectChannelRequest": projectChannelRequest?.toJson(),
    "reason": reasonCodeValues.reverse[reason],
    "roleRequirements": List<dynamic>.from(
      roleRequirements.map((x) => x.toJson()),
    ),
    "status": approvalStatusValues.reverse[status],
    "targetId": targetId,
    "targetType": targetType,
    "workflowId": workflowId,
    "workspaceId": workspaceId,
  });
}

///有权读取的审批所绑定不可变 AutomationVersion 中的步骤展示，不是另一审批或内容权威。
class AutomationApprovalStepView {
  final String id;
  final String message;
  final String? name;
  final String versionAssetId;

  AutomationApprovalStepView({
    required this.id,
    required this.message,
    this.name,
    required this.versionAssetId,
  });

  factory AutomationApprovalStepView.fromJson(Map<String, dynamic> json) =>
      AutomationApprovalStepView(
        id: json["id"],
        message: json["message"],
        name: json["name"],
        versionAssetId: json["versionAssetId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "id": id,
    "message": message,
    "name": name,
    "versionAssetId": versionAssetId,
  });
}

///一条已形成的不可变决定。只有经 FreshApprovalAdmission 通过的 Update 才形成决定；decidedAt 取 workflow.Now()。
class ApprovalDecisionRecord {
  final String approverPrincipalId;

  ///RFC3339，UTC
  final String decidedAt;
  final ApprovalDecision decision;

  ///该 approver 在决定时经 fresh Check 满足的选择器；同一人可在多个要求中计数，但只产生一个决定
  final List<ApprovalSelector> satisfiedSelectors;

  ApprovalDecisionRecord({
    required this.approverPrincipalId,
    required this.decidedAt,
    required this.decision,
    required this.satisfiedSelectors,
  });

  factory ApprovalDecisionRecord.fromJson(Map<String, dynamic> json) =>
      ApprovalDecisionRecord(
        approverPrincipalId: json["approverPrincipalId"],
        decidedAt: json["decidedAt"],
        decision: approvalDecisionValues.map[json["decision"]]!,
        satisfiedSelectors: List<ApprovalSelector>.from(
          json["satisfiedSelectors"].map((x) => approvalSelectorValues.map[x]!),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "approverPrincipalId": approverPrincipalId,
    "decidedAt": decidedAt,
    "decision": approvalDecisionValues.reverse[decision],
    "satisfiedSelectors": List<dynamic>.from(
      satisfiedSelectors.map((x) => approvalSelectorValues.reverse[x]),
    ),
  });
}

///ApprovalPolicy.role_requirements 的角色选择器（.design/03 §4、.design/10 §2）：RESOURCE_APPROVER
///对目标 Resource/Asset 做 approve，WORKSPACE_ADMIN 对冻结 Workspace 做 manage，TENANT_ADMIN 对冻结
///Tenant 做 manage。
enum ApprovalSelector { RESOURCE_APPROVER, TENANT_ADMIN, WORKSPACE_ADMIN }

final approvalSelectorValues = EnumValues({
  "RESOURCE_APPROVER": ApprovalSelector.RESOURCE_APPROVER,
  "TENANT_ADMIN": ApprovalSelector.TENANT_ADMIN,
  "WORKSPACE_ADMIN": ApprovalSelector.WORKSPACE_ADMIN,
});

///DD-140：有权读取的审批所冻结的项目频道申请与提议的 Installation，供 owner 端以原版对话框呈现；不是另一审批或内容权威。
class ProjectChannelRequestApprovalView {
  final String installationResourceId;
  final ProjectChannelRequest request;

  ProjectChannelRequestApprovalView({
    required this.installationResourceId,
    required this.request,
  });

  factory ProjectChannelRequestApprovalView.fromJson(
    Map<String, dynamic> json,
  ) => ProjectChannelRequestApprovalView(
    installationResourceId: json["installationResourceId"],
    request: ProjectChannelRequest.fromJson(json["request"]),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "installationResourceId": installationResourceId,
    "request": request.toJson(),
  });
}

///DD-140：托管 Agent 平台原生工具 project_channel_request 的输入，与固定 Buzz
///projectChannelRequest.ts::parseProjectChannelRequest 同形同界；只是提议，绑定 workspace.create 且必须由
///Installation owner 批准。
class ProjectChannelRequest {
  final String? description;

  ///该 Installation 的 ACTIVE ChannelAgentBinding 所在 Workspace（即其频道 ID）。
  final String homeChannelId;
  final String name;
  final String? templateName;
  final int? ttlSeconds;
  final WorkspaceVisibility visibility;

  ProjectChannelRequest({
    this.description,
    required this.homeChannelId,
    required this.name,
    this.templateName,
    this.ttlSeconds,
    required this.visibility,
  });

  factory ProjectChannelRequest.fromJson(Map<String, dynamic> json) =>
      ProjectChannelRequest(
        description: json["description"],
        homeChannelId: json["homeChannelId"],
        name: json["name"],
        templateName: json["templateName"],
        ttlSeconds: json["ttlSeconds"],
        visibility: workspaceVisibilityValues.map[json["visibility"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "description": description,
    "homeChannelId": homeChannelId,
    "name": name,
    "templateName": templateName,
    "ttlSeconds": ttlSeconds,
    "visibility": workspaceVisibilityValues.reverse[visibility],
  });
}

///只在准入事务内改写 Core 的 Workspace 可见性；已有成员不变，不写 SpiceDB，Relay 投影保持 private、不发送 visibility 标签。
///
///DD-80 的产品可见性：open 仅指同 Tenant 成员可发现并经 Core 加入；Relay 投影始终 private。
///
///仅 workspace.create 使用；省略保持旧命令的 private 可见性。
///
///Core 产品可见性，不从 Relay private 投影推断；旧回应可能省略。
enum WorkspaceVisibility { OPEN, PRIVATE }

final workspaceVisibilityValues = EnumValues({
  "open": WorkspaceVisibility.OPEN,
  "private": WorkspaceVisibility.PRIVATE,
});

///ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
///§4）。
class ApprovalRoleRequirement {
  final int minDistinct;
  final ApprovalSelector selector;

  ApprovalRoleRequirement({required this.minDistinct, required this.selector});

  factory ApprovalRoleRequirement.fromJson(Map<String, dynamic> json) =>
      ApprovalRoleRequirement(
        minDistinct: json["minDistinct"],
        selector: approvalSelectorValues.map[json["selector"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "minDistinct": minDistinct,
    "selector": approvalSelectorValues.reverse[selector],
  });
}

///ApprovalWorkflow 的状态（.design/06 §4）：REQUESTED → WAITING → APPROVED | DENIED | EXPIRED |
///CANCELLED；APPROVED → CONSUMED | INVALIDATED。只由 Temporal history 投影。
enum ApprovalStatus {
  APPROVED,
  CANCELLED,
  CONSUMED,
  DENIED,
  EXPIRED,
  INVALIDATED,
  REQUESTED,
  WAITING,
}

final approvalStatusValues = EnumValues({
  "APPROVED": ApprovalStatus.APPROVED,
  "CANCELLED": ApprovalStatus.CANCELLED,
  "CONSUMED": ApprovalStatus.CONSUMED,
  "DENIED": ApprovalStatus.DENIED,
  "EXPIRED": ApprovalStatus.EXPIRED,
  "INVALIDATED": ApprovalStatus.INVALIDATED,
  "REQUESTED": ApprovalStatus.REQUESTED,
  "WAITING": ApprovalStatus.WAITING,
});

///GET /api/v1/audit/events 的有界回应：当前 Tenant（或其中一个 Workspace）范围内的审计事件，调用方须对该范围持有 audit
///permission，每次 fresh Check。证据只列种类，不含稳定 ID；稳定 ID 经单条解引用在同一授权下取得（.design/03 §14）。
class AuditEventPage {
  final List<AuditEventView> events;

  ///下一页首项之前的事件 ID；缺省即已经读完
  final String? nextCursor;

  AuditEventPage({required this.events, this.nextCursor});

  factory AuditEventPage.fromJson(Map<String, dynamic> json) => AuditEventPage(
    events: List<AuditEventView>.from(
      json["events"].map((x) => AuditEventView.fromJson(x)),
    ),
    nextCursor: json["nextCursor"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "events": List<dynamic>.from(events.map((x) => x.toJson())),
    "nextCursor": nextCursor,
  });
}

class AuditEventView {
  final String actionKey;
  final String? actorPrincipalId;
  final String decision;
  final AuditEventType eventType;
  final List<AuditEvidenceSlot> evidence;
  final String id;
  final String? initiatorPrincipalId;

  ///RFC3339
  final String occurredAt;
  final String resultCode;
  final String? workspaceId;

  AuditEventView({
    required this.actionKey,
    this.actorPrincipalId,
    required this.decision,
    required this.eventType,
    required this.evidence,
    required this.id,
    this.initiatorPrincipalId,
    required this.occurredAt,
    required this.resultCode,
    this.workspaceId,
  });

  factory AuditEventView.fromJson(Map<String, dynamic> json) => AuditEventView(
    actionKey: json["actionKey"],
    actorPrincipalId: json["actorPrincipalId"],
    decision: json["decision"],
    eventType: auditEventTypeValues.map[json["eventType"]]!,
    evidence: List<AuditEvidenceSlot>.from(
      json["evidence"].map((x) => AuditEvidenceSlot.fromJson(x)),
    ),
    id: json["id"],
    initiatorPrincipalId: json["initiatorPrincipalId"],
    occurredAt: json["occurredAt"],
    resultCode: json["resultCode"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "actorPrincipalId": actorPrincipalId,
    "decision": decision,
    "eventType": auditEventTypeValues.reverse[eventType],
    "evidence": List<dynamic>.from(evidence.map((x) => x.toJson())),
    "id": id,
    "initiatorPrincipalId": initiatorPrincipalId,
    "occurredAt": occurredAt,
    "resultCode": resultCode,
    "workspaceId": workspaceId,
  });
}

///AuditEvent 的类型（.design/03 §9）。tenant_id 为空只允许 AUTHENTICATION 与 SESSION，且仅限 AgentGateway
///OIDC callback 之后、Core 尚未解析出可用 TenantMembership 的那段边界（DD-52/54）。
enum AuditEventType {
  ACCESS,
  APPROVAL,
  AUTHENTICATION,
  DECISION,
  DISPATCH,
  INTENT,
  OUTCOME,
  RECONCILIATION,
  REVOCATION,
  SESSION,
}

final auditEventTypeValues = EnumValues({
  "ACCESS": AuditEventType.ACCESS,
  "APPROVAL": AuditEventType.APPROVAL,
  "AUTHENTICATION": AuditEventType.AUTHENTICATION,
  "DECISION": AuditEventType.DECISION,
  "DISPATCH": AuditEventType.DISPATCH,
  "INTENT": AuditEventType.INTENT,
  "OUTCOME": AuditEventType.OUTCOME,
  "RECONCILIATION": AuditEventType.RECONCILIATION,
  "REVOCATION": AuditEventType.REVOCATION,
  "SESSION": AuditEventType.SESSION,
});

class AuditEvidenceSlot {
  final EvidenceAuthority? authority;

  ///证据在该事件中的位置，解引用时使用
  final int index;

  ///存量种类不可识别时缺省
  final EvidenceKind? kind;
  final EvidenceSensitivity? sensitivity;

  AuditEvidenceSlot({
    this.authority,
    required this.index,
    this.kind,
    this.sensitivity,
  });

  factory AuditEvidenceSlot.fromJson(Map<String, dynamic> json) =>
      AuditEvidenceSlot(
        authority: json["authority"] == null
            ? null
            : evidenceAuthorityValues.map[json["authority"]]!,
        index: json["index"],
        kind: json["kind"] == null
            ? null
            : evidenceKindValues.map[json["kind"]]!,
        sensitivity: json["sensitivity"] == null
            ? null
            : evidenceSensitivityValues.map[json["sensitivity"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "authority": evidenceAuthorityValues.reverse[authority],
    "index": index,
    "kind": evidenceKindValues.reverse[kind],
    "sensitivity": evidenceSensitivityValues.reverse[sensitivity],
  });
}

///EvidenceRef 所指证据的源码权威。
enum EvidenceAuthority {
  AGENTGATEWAY,
  BUZZ,
  CORE,
  OIDC,
  OPENMETER,
  SPICEDB,
  TEMPORAL,
}

final evidenceAuthorityValues = EnumValues({
  "AGENTGATEWAY": EvidenceAuthority.AGENTGATEWAY,
  "BUZZ": EvidenceAuthority.BUZZ,
  "CORE": EvidenceAuthority.CORE,
  "OIDC": EvidenceAuthority.OIDC,
  "OPENMETER": EvidenceAuthority.OPENMETER,
  "SPICEDB": EvidenceAuthority.SPICEDB,
  "TEMPORAL": EvidenceAuthority.TEMPORAL,
});

///存量种类不可识别时缺省
///
///AuditEvent 中 EvidenceRef 的封闭种类（.design/03 §14）。每种只承载其权威源中的稳定 ID（可带
///version），权威源、证据类型与敏感级别由种类唯一确定（Core 的固定描述表）。库中存量出现不在此列的种类时解释为不可用，不猜测含义。DD-135(8) 的 Skill
///证据：`SKILL_SLUG` 为定义 slug；`SKILL_VERSION_ASSET_ID` 为版本 Asset ID，version
///为版本序号；`SKILL_ARTIFACT_DIGEST` 为规范 artifact 的 SHA-256，version 为其字节数；`SKILL_UPLOAD_DIGEST`
///为上传字节的 SHA-256。均不含 SKILL.md 正文。
enum EvidenceKind {
  ACTION_EXECUTION_ID,
  ADMIT_ACTION_EXECUTION_ID,
  AGENTGATEWAY_USAGE_ID,
  AGENT_VERSION_ASSET_ID,
  APPLICATION_BINDING_ID,
  APPROVAL_POLICY,
  APPROVAL_WORKFLOW_ID,
  BUZZ_DELETION_INVENTORY_DIGEST,
  BUZZ_DELETION_REQUEST_ID,
  BUZZ_EVENT_ID,
  BUZZ_PUBKEY,
  DEPLOYMENT_BOOTSTRAP,
  EXPORT_PACKAGE_ASSET_ID,
  EXTERNAL_SUBJECT_SHA256,
  OPENMETER_EVENT_ID,
  ORIGINAL_ACTION_EXECUTION_ID,
  PLATFORM_SESSION_ID,
  SECRET_REF_REHOME_ID,
  SKILL_ARTIFACT_DIGEST,
  SKILL_SLUG,
  SKILL_UPLOAD_DIGEST,
  SKILL_VERSION_ASSET_ID,
  SPICEDB_RELATIONSHIP,
  SPICEDB_ZEDTOKEN,
  TEMPORAL_FIRST_RUN_ID,
  TEMPORAL_RUN_ID,
  TEMPORAL_WORKFLOW_ID,
  TENANT_DELETE_SUBPROCESS_ID,
  TENANT_INVITATION_ID,
  TENANT_LIFECYCLE_SNAPSHOT_ID,
  TENANT_MEMBERSHIP_ID,
  TRACE_ID,
  TRANSFER_FORMAT,
  TRANSFER_PACKAGE_DIGEST,
  USAGE_EVENT_ID,
  WORKSPACE_LIFECYCLE_SNAPSHOT_ID,
}

final evidenceKindValues = EnumValues({
  "ACTION_EXECUTION_ID": EvidenceKind.ACTION_EXECUTION_ID,
  "ADMIT_ACTION_EXECUTION_ID": EvidenceKind.ADMIT_ACTION_EXECUTION_ID,
  "AGENTGATEWAY_USAGE_ID": EvidenceKind.AGENTGATEWAY_USAGE_ID,
  "AGENT_VERSION_ASSET_ID": EvidenceKind.AGENT_VERSION_ASSET_ID,
  "APPLICATION_BINDING_ID": EvidenceKind.APPLICATION_BINDING_ID,
  "APPROVAL_POLICY": EvidenceKind.APPROVAL_POLICY,
  "APPROVAL_WORKFLOW_ID": EvidenceKind.APPROVAL_WORKFLOW_ID,
  "BUZZ_DELETION_INVENTORY_DIGEST": EvidenceKind.BUZZ_DELETION_INVENTORY_DIGEST,
  "BUZZ_DELETION_REQUEST_ID": EvidenceKind.BUZZ_DELETION_REQUEST_ID,
  "BUZZ_EVENT_ID": EvidenceKind.BUZZ_EVENT_ID,
  "BUZZ_PUBKEY": EvidenceKind.BUZZ_PUBKEY,
  "DEPLOYMENT_BOOTSTRAP": EvidenceKind.DEPLOYMENT_BOOTSTRAP,
  "EXPORT_PACKAGE_ASSET_ID": EvidenceKind.EXPORT_PACKAGE_ASSET_ID,
  "EXTERNAL_SUBJECT_SHA256": EvidenceKind.EXTERNAL_SUBJECT_SHA256,
  "OPENMETER_EVENT_ID": EvidenceKind.OPENMETER_EVENT_ID,
  "ORIGINAL_ACTION_EXECUTION_ID": EvidenceKind.ORIGINAL_ACTION_EXECUTION_ID,
  "PLATFORM_SESSION_ID": EvidenceKind.PLATFORM_SESSION_ID,
  "SECRET_REF_REHOME_ID": EvidenceKind.SECRET_REF_REHOME_ID,
  "SKILL_ARTIFACT_DIGEST": EvidenceKind.SKILL_ARTIFACT_DIGEST,
  "SKILL_SLUG": EvidenceKind.SKILL_SLUG,
  "SKILL_UPLOAD_DIGEST": EvidenceKind.SKILL_UPLOAD_DIGEST,
  "SKILL_VERSION_ASSET_ID": EvidenceKind.SKILL_VERSION_ASSET_ID,
  "SPICEDB_RELATIONSHIP": EvidenceKind.SPICEDB_RELATIONSHIP,
  "SPICEDB_ZEDTOKEN": EvidenceKind.SPICEDB_ZEDTOKEN,
  "TEMPORAL_FIRST_RUN_ID": EvidenceKind.TEMPORAL_FIRST_RUN_ID,
  "TEMPORAL_RUN_ID": EvidenceKind.TEMPORAL_RUN_ID,
  "TEMPORAL_WORKFLOW_ID": EvidenceKind.TEMPORAL_WORKFLOW_ID,
  "TENANT_DELETE_SUBPROCESS_ID": EvidenceKind.TENANT_DELETE_SUBPROCESS_ID,
  "TENANT_INVITATION_ID": EvidenceKind.TENANT_INVITATION_ID,
  "TENANT_LIFECYCLE_SNAPSHOT_ID": EvidenceKind.TENANT_LIFECYCLE_SNAPSHOT_ID,
  "TENANT_MEMBERSHIP_ID": EvidenceKind.TENANT_MEMBERSHIP_ID,
  "TRACE_ID": EvidenceKind.TRACE_ID,
  "TRANSFER_FORMAT": EvidenceKind.TRANSFER_FORMAT,
  "TRANSFER_PACKAGE_DIGEST": EvidenceKind.TRANSFER_PACKAGE_DIGEST,
  "USAGE_EVENT_ID": EvidenceKind.USAGE_EVENT_ID,
  "WORKSPACE_LIFECYCLE_SNAPSHOT_ID":
      EvidenceKind.WORKSPACE_LIFECYCLE_SNAPSHOT_ID,
});

///EvidenceRef 的敏感级别。SUMMARY 在当前 audit permission 下可解引用；RESTRICTED 还需 ResultExposure
///授权，在其交付前一律不可用（fail closed）。
enum EvidenceSensitivity { RESTRICTED, SUMMARY }

final evidenceSensitivityValues = EnumValues({
  "RESTRICTED": EvidenceSensitivity.RESTRICTED,
  "SUMMARY": EvidenceSensitivity.SUMMARY,
});

class AutomationDetailView {
  final AutomationView automation;

  ///当前 Resource manage；不是运行准入、额度允许或业务成功。
  final bool canManage;

  ///仅当前 ACTIVE HUMAN owner、Workspace membership 与 Resource execute，以及已启用固定版本允许显示手动运行；仍须原
  ///automation.run 的准入、Delegation、额度及步骤审批。缺省关闭，不是业务成功。
  final bool? canRun;
  final List<AutomationDelegationView> delegations;
  final int? nextDelegationOffset;
  final int? nextVersionOffset;
  final List<AutomationVersionView> versions;

  AutomationDetailView({
    required this.automation,
    required this.canManage,
    this.canRun,
    required this.delegations,
    this.nextDelegationOffset,
    this.nextVersionOffset,
    required this.versions,
  });

  factory AutomationDetailView.fromJson(Map<String, dynamic> json) =>
      AutomationDetailView(
        automation: AutomationView.fromJson(json["automation"]),
        canManage: json["canManage"],
        canRun: json["canRun"],
        delegations: List<AutomationDelegationView>.from(
          json["delegations"].map((x) => AutomationDelegationView.fromJson(x)),
        ),
        nextDelegationOffset: json["nextDelegationOffset"],
        nextVersionOffset: json["nextVersionOffset"],
        versions: List<AutomationVersionView>.from(
          json["versions"].map((x) => AutomationVersionView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "automation": automation.toJson(),
    "canManage": canManage,
    "canRun": canRun,
    "delegations": List<dynamic>.from(delegations.map((x) => x.toJson())),
    "nextDelegationOffset": nextDelegationOffset,
    "nextVersionOffset": nextVersionOffset,
    "versions": List<dynamic>.from(versions.map((x) => x.toJson())),
  });
}

class AutomationView {
  ///RFC3339，UTC，与既有管理查询时间字段一致。原 AutomationDefinition 写事务记录的真实创建时间；历史无证据时省略，不回填当前时间。
  final String? createdAt;
  final String? delegationId;
  final String executorInstallationResourceId;
  final String ownerPrincipalId;
  final String? pinnedVersionAssetId;
  final String resourceId;
  final ResourceState resourceState;
  final int resourceVersion;
  final AutomationState state;

  ///RFC3339，UTC，与既有管理查询时间字段一致。原 AutomationDefinition/Version 实际写入时间；未观察到更新的历史行省略，不从
  ///UUID、审计投递时间或浏览器时钟推测。
  final String? updatedAt;

  ///当前 WEBHOOK 密钥展示形式的末四位，仅用于辨认；密钥本身不可再取回（DD-116）。
  final String? webhookSecretHint;

  ///WEBHOOK 触发的公开投递地址（部署配置的公开基址 + /hooks/{resourceId}）；只在密钥 ACTIVE 时给出（DD-116）。
  final String? webhookUrl;
  final String workspaceId;

  AutomationView({
    this.createdAt,
    this.delegationId,
    required this.executorInstallationResourceId,
    required this.ownerPrincipalId,
    this.pinnedVersionAssetId,
    required this.resourceId,
    required this.resourceState,
    required this.resourceVersion,
    required this.state,
    this.updatedAt,
    this.webhookSecretHint,
    this.webhookUrl,
    required this.workspaceId,
  });

  factory AutomationView.fromJson(Map<String, dynamic> json) => AutomationView(
    createdAt: json["createdAt"],
    delegationId: json["delegationId"],
    executorInstallationResourceId: json["executorInstallationResourceId"],
    ownerPrincipalId: json["ownerPrincipalId"],
    pinnedVersionAssetId: json["pinnedVersionAssetId"],
    resourceId: json["resourceId"],
    resourceState: resourceStateValues.map[json["resourceState"]]!,
    resourceVersion: json["resourceVersion"],
    state: automationStateValues.map[json["state"]]!,
    updatedAt: json["updatedAt"],
    webhookSecretHint: json["webhookSecretHint"],
    webhookUrl: json["webhookUrl"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "createdAt": createdAt,
    "delegationId": delegationId,
    "executorInstallationResourceId": executorInstallationResourceId,
    "ownerPrincipalId": ownerPrincipalId,
    "pinnedVersionAssetId": pinnedVersionAssetId,
    "resourceId": resourceId,
    "resourceState": resourceStateValues.reverse[resourceState],
    "resourceVersion": resourceVersion,
    "state": automationStateValues.reverse[state],
    "updatedAt": updatedAt,
    "webhookSecretHint": webhookSecretHint,
    "webhookUrl": webhookUrl,
    "workspaceId": workspaceId,
  });
}

///03 §7、05 §2.9：AutomationDefinition 的真实管理状态，不是 Invocation 终态。
enum AutomationState { DELETED, DISABLED, DRAFT, ENABLED, PAUSED }

final automationStateValues = EnumValues({
  "DELETED": AutomationState.DELETED,
  "DISABLED": AutomationState.DISABLED,
  "DRAFT": AutomationState.DRAFT,
  "ENABLED": AutomationState.ENABLED,
  "PAUSED": AutomationState.PAUSED,
});

///实际 ACTIVE Grant 对该 Automation/run 的引用；不暴露 Secret、授予新权限或查询额度。
class AutomationDelegationView {
  final String delegationId;
  final int delegationVersion;
  final String executorInstallationResourceId;

  ///RFC3339，UTC；与现有管理查询时间字段一致。
  final String expiresAt;
  final String ownerPrincipalId;

  AutomationDelegationView({
    required this.delegationId,
    required this.delegationVersion,
    required this.executorInstallationResourceId,
    required this.expiresAt,
    required this.ownerPrincipalId,
  });

  factory AutomationDelegationView.fromJson(Map<String, dynamic> json) =>
      AutomationDelegationView(
        delegationId: json["delegationId"],
        delegationVersion: json["delegationVersion"],
        executorInstallationResourceId: json["executorInstallationResourceId"],
        expiresAt: json["expiresAt"],
        ownerPrincipalId: json["ownerPrincipalId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "delegationId": delegationId,
    "delegationVersion": delegationVersion,
    "executorInstallationResourceId": executorInstallationResourceId,
    "expiresAt": expiresAt,
    "ownerPrincipalId": ownerPrincipalId,
  });
}

///Core 自有 AutomationVersion 正文只在该 Asset fresh read 授权后返回；immutable Asset 三态复用既有版本契约。
class AutomationVersionView {
  final String assetId;
  final int assetVersion;
  final String automationResourceId;
  final String configHash;
  final AutomationVersionContent content;
  final int ordinal;
  final String ownerPrincipalId;
  final AgentVersionState state;

  AutomationVersionView({
    required this.assetId,
    required this.assetVersion,
    required this.automationResourceId,
    required this.configHash,
    required this.content,
    required this.ordinal,
    required this.ownerPrincipalId,
    required this.state,
  });

  factory AutomationVersionView.fromJson(Map<String, dynamic> json) =>
      AutomationVersionView(
        assetId: json["assetId"],
        assetVersion: json["assetVersion"],
        automationResourceId: json["automationResourceId"],
        configHash: json["configHash"],
        content: AutomationVersionContent.fromJson(json["content"]),
        ordinal: json["ordinal"],
        ownerPrincipalId: json["ownerPrincipalId"],
        state: agentVersionStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "assetId": assetId,
    "assetVersion": assetVersion,
    "automationResourceId": automationResourceId,
    "configHash": configHash,
    "content": content.toJson(),
    "ordinal": ordinal,
    "ownerPrincipalId": ownerPrincipalId,
    "state": agentVersionStateValues.reverse[state],
  });
}

///仅 automation.create / automation.publish_version：Core 自有版本内容；publish 产生新的不可变版本，不改写旧版本。
///
///REQ-23、DD-107、03 §7 的不可变自动化版本。Schedule 使用 Temporal 原生 interval/calendar，不含触发消息正文、provider
///配置或凭据。
class AutomationVersionContent {
  final AutomationVersionContentAction? action;
  final AutomationApprovalPolicyRef? approvalPolicy;

  ///固定 Buzz WorkflowDef 的可选说明；随原不可变版本和 config_hash 冻结。旧版本缺省不补写，空值与空白沿原 YAML 保留。
  final String? description;

  ///2保留历史单副作用步骤；3为有序多消息。旧单 action 格式缺省保持原摘要。
  final int? formatVersion;

  ///原工作流名称；随不可变版本冻结。旧版本缺省不补写、不重算历史摘要。
  final String? name;
  final AutomationResultTarget resultTarget;

  ///
  ///不可与旧action混用。格式3逐条发送消息并查证原生回执，支持消息间Delay及首副作用前一个原策略审批；UNKNOWN不推进。步骤审批不可同时声明版本级approvalPolicy。其余原动作仍在恢复范围。
  final List<AutomationStep>? steps;
  final AutomationVersionContentTrigger trigger;

  AutomationVersionContent({
    this.action,
    this.approvalPolicy,
    this.description,
    this.formatVersion,
    this.name,
    required this.resultTarget,
    this.steps,
    required this.trigger,
  });

  factory AutomationVersionContent.fromJson(Map<String, dynamic> json) =>
      AutomationVersionContent(
        action: json["action"] == null
            ? null
            : AutomationVersionContentAction.fromJson(json["action"]),
        approvalPolicy: json["approvalPolicy"] == null
            ? null
            : AutomationApprovalPolicyRef.fromJson(json["approvalPolicy"]),
        description: json["description"],
        formatVersion: json["formatVersion"],
        name: json["name"],
        resultTarget: automationResultTargetValues.map[json["resultTarget"]]!,
        steps: json["steps"] == null
            ? null
            : List<AutomationStep>.from(
                json["steps"]!.map((x) => AutomationStep.fromJson(x)),
              ),
        trigger: AutomationVersionContentTrigger.fromJson(json["trigger"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "action": action?.toJson(),
    "approvalPolicy": approvalPolicy?.toJson(),
    "description": description,
    "formatVersion": formatVersion,
    "name": name,
    "resultTarget": automationResultTargetValues.reverse[resultTarget],
    "steps": steps == null
        ? null
        : List<dynamic>.from(steps!.map((x) => x.toJson())),
    "trigger": trigger.toJson(),
  });
}

class AutomationVersionContentAction {
  final AutomationVersionContentActionKind kind;
  final String template;

  AutomationVersionContentAction({required this.kind, required this.template});

  factory AutomationVersionContentAction.fromJson(Map<String, dynamic> json) =>
      AutomationVersionContentAction(
        kind: automationVersionContentActionKindValues.map[json["kind"]]!,
        template: json["template"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "kind": automationVersionContentActionKindValues.reverse[kind],
    "template": template,
  });
}

enum AutomationVersionContentActionKind { AGENT_TURN, POST_MESSAGE }

final automationVersionContentActionKindValues = EnumValues({
  "AGENT_TURN": AutomationVersionContentActionKind.AGENT_TURN,
  "POST_MESSAGE": AutomationVersionContentActionKind.POST_MESSAGE,
});

///DD-107 同 Tenant automation.run 的显式已登记审批策略；版本精确冻结，不授予审批权限。
///
///request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
class AutomationApprovalPolicyRef {
  final String id;
  final int version;

  AutomationApprovalPolicyRef({required this.id, required this.version});

  factory AutomationApprovalPolicyRef.fromJson(Map<String, dynamic> json) =>
      AutomationApprovalPolicyRef(id: json["id"], version: json["version"]);

  Map<String, dynamic> toJson() => _stripNulls({"id": id, "version": version});
}

///原 Buzz 有序步骤的已接通动作；步骤执行和延时仍归 Temporal。call_webhook 需要工作区管理权限（原
///requires_elevated_authority），保存与每次运行均重新核验。其它原动作不由此宣称已实现。
class AutomationStep {
  final AutomationStepAction action;

  ///request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
  final AutomationApprovalPolicyRef? approvalPolicy;

  ///原请求体模板；不保存响应正文。
  final String? body;
  final String? duration;

  ///原 buzz-sdk build_reaction 的字符上限；目标仅为该次真实触发消息。
  final String? emoji;

  ///原附加请求头，值可含原模板变量。凭据类请求头（Authorization、Cookie，以及名称含 token/secret/password/api-key/apikey
  ///者）不得明文保存，必须改用 secretHeaders。
  final Map<String, String>? headers;
  final String id;

  ///固定 Buzz Step.if 的 evalexpr 条件，原 4096 UTF-8
  ///字节上限；为假时跳过该步骤（不失败）。只允许引用触发变量（trigger_text/author/channel_id/timestamp/emoji/message_id/is_reply），引用步骤输出在定义校验时以
  ///CAPABILITY_BLOCKED 拒绝。Kailo 在 automation.run 准入时按已验签触发事件一次求值并把跳过集合冻结进该
  ///ActionExecution；求值错误使该运行在任何副作用前失败。
  final String? automationStepIf;
  final String? message;

  ///原 HTTP 方法，缺省 POST。
  final AutomationStepMethod? method;
  final String? name;

  ///Kailo 治理：请求头密钥只以同 Tenant OpenBao SecretRef 保存，Core 仅在派发时读取 field=value
  ///注入请求，不写入版本、参数、审计或轨迹。名称不得与 headers 重复（不区分大小写）。
  final Map<String, AutomationSecretRef>? secretHeaders;
  final String? text;

  ///固定 Buzz Step.timeout_secs。Delay 由原 AgentTask 的独立 Temporal Timer
  ///执行；send_message/add_reaction/set_channel_topic/call_webhook 由 Core
  ///自本运行首次到达该步骤起计时，截止前未派发则以 STEP_TIMEOUT 失败，已派发的结果走既有对账（不明记 UNKNOWN，不重放）；call_webhook
  ///的单次请求另受原 10 秒上限。缺省保持既有版本行为，不给历史补写默认值。
  final int? timeoutSecs;

  ///原频道主题；空字符串清空主题，不改变频道名称、描述或成员。
  final String? topic;

  ///固定 Buzz ActionDef::CallWebhook.url：公网 HTTPS
  ///端点。scheme、主机与端口必须是字面值（原模板变量只可出现在路径与查询中），不得含用户信息。Core 每次派发前按 DNS 结果拒绝非全局单播地址，并只经
  ///AgentGateway 出站，不跟随重定向。
  final String? url;

  AutomationStep({
    required this.action,
    this.approvalPolicy,
    this.body,
    this.duration,
    this.emoji,
    this.headers,
    required this.id,
    this.automationStepIf,
    this.message,
    this.method,
    this.name,
    this.secretHeaders,
    this.text,
    this.timeoutSecs,
    this.topic,
    this.url,
  });

  factory AutomationStep.fromJson(Map<String, dynamic> json) => AutomationStep(
    action: automationStepActionValues.map[json["action"]]!,
    approvalPolicy: json["approvalPolicy"] == null
        ? null
        : AutomationApprovalPolicyRef.fromJson(json["approvalPolicy"]),
    body: json["body"],
    duration: json["duration"],
    emoji: json["emoji"],
    headers: json["headers"] == null
        ? null
        : Map.from(
            json["headers"]!,
          ).map((k, v) => MapEntry<String, String>(k, v)),
    id: json["id"],
    automationStepIf: json["if"],
    message: json["message"],
    method: json["method"] == null
        ? null
        : automationStepMethodValues.map[json["method"]]!,
    name: json["name"],
    secretHeaders: json["secretHeaders"] == null
        ? null
        : Map.from(json["secretHeaders"]!).map(
            (k, v) => MapEntry<String, AutomationSecretRef>(
              k,
              AutomationSecretRef.fromJson(v),
            ),
          ),
    text: json["text"],
    timeoutSecs: json["timeout_secs"],
    topic: json["topic"],
    url: json["url"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "action": automationStepActionValues.reverse[action],
    "approvalPolicy": approvalPolicy?.toJson(),
    "body": body,
    "duration": duration,
    "emoji": emoji,
    "headers": headers == null
        ? null
        : Map.from(headers!).map((k, v) => MapEntry<String, dynamic>(k, v)),
    "id": id,
    "if": automationStepIf,
    "message": message,
    "method": automationStepMethodValues.reverse[method],
    "name": name,
    "secretHeaders": secretHeaders == null
        ? null
        : Map.from(
            secretHeaders!,
          ).map((k, v) => MapEntry<String, dynamic>(k, v.toJson())),
    "text": text,
    "timeout_secs": timeoutSecs,
    "topic": topic,
    "url": url,
  });
}

enum AutomationStepAction {
  ADD_REACTION,
  CALL_WEBHOOK,
  DELAY,
  REQUEST_APPROVAL,
  SEND_MESSAGE,
  SET_CHANNEL_TOPIC,
}

final automationStepActionValues = EnumValues({
  "add_reaction": AutomationStepAction.ADD_REACTION,
  "call_webhook": AutomationStepAction.CALL_WEBHOOK,
  "delay": AutomationStepAction.DELAY,
  "request_approval": AutomationStepAction.REQUEST_APPROVAL,
  "send_message": AutomationStepAction.SEND_MESSAGE,
  "set_channel_topic": AutomationStepAction.SET_CHANNEL_TOPIC,
});

///原 HTTP 方法，缺省 POST。
enum AutomationStepMethod { DELETE, GET, PATCH, POST, PUT }

final automationStepMethodValues = EnumValues({
  "DELETE": AutomationStepMethod.DELETE,
  "GET": AutomationStepMethod.GET,
  "PATCH": AutomationStepMethod.PATCH,
  "POST": AutomationStepMethod.POST,
  "PUT": AutomationStepMethod.PUT,
});

///同 Tenant OpenBao KV v2 的精确版本引用（DD-70）；只是 locator，不含密钥正文。audience 必须是 Core 的服务身份。
class AutomationSecretRef {
  final String audience;
  final String locator;
  final int version;

  AutomationSecretRef({
    required this.audience,
    required this.locator,
    required this.version,
  });

  factory AutomationSecretRef.fromJson(Map<String, dynamic> json) =>
      AutomationSecretRef(
        audience: json["audience"],
        locator: json["locator"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "audience": audience,
    "locator": locator,
    "version": version,
  });
}

class AutomationVersionContentTrigger {
  ///固定 Buzz TriggerDef::ReactionAdded.emoji；仅 REACTION_ADDED，可选，精确匹配原回应内容。
  final String? emoji;

  ///固定 Buzz evalexpr 消息触发条件；CHANNEL_MESSAGE/MENTION/DIFF_POSTED/REACTION_ADDED（DIFF_POSTED
  ///为同频道 kind:40008，与消息触发同一组变量；REACTION_ADDED 另有 trigger_emoji 与被回应消息 trigger_message_id），原
  ///4096 UTF-8 字节上限。只匹配已验签且当前准入 HUMAN 事件；错误不匹配，不持久化触发正文。旧 textPrefix 若同时存在则均须满足。
  final String? filter;
  final AutomationTriggerKind kind;
  final String? mentionPrincipalId;
  final AutomationScheduleSpec? scheduleSpec;
  final String? textPrefix;

  AutomationVersionContentTrigger({
    this.emoji,
    this.filter,
    required this.kind,
    this.mentionPrincipalId,
    this.scheduleSpec,
    this.textPrefix,
  });

  factory AutomationVersionContentTrigger.fromJson(Map<String, dynamic> json) =>
      AutomationVersionContentTrigger(
        emoji: json["emoji"],
        filter: json["filter"],
        kind: automationTriggerKindValues.map[json["kind"]]!,
        mentionPrincipalId: json["mentionPrincipalId"],
        scheduleSpec: json["scheduleSpec"] == null
            ? null
            : AutomationScheduleSpec.fromJson(json["scheduleSpec"]),
        textPrefix: json["textPrefix"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "emoji": emoji,
    "filter": filter,
    "kind": automationTriggerKindValues.reverse[kind],
    "mentionPrincipalId": mentionPrincipalId,
    "scheduleSpec": scheduleSpec?.toJson(),
    "textPrefix": textPrefix,
  });
}

enum AutomationTriggerKind {
  CHANNEL_MESSAGE,
  DIFF_POSTED,
  MENTION,
  REACTION_ADDED,
  SCHEDULE,
  WEBHOOK,
}

final automationTriggerKindValues = EnumValues({
  "CHANNEL_MESSAGE": AutomationTriggerKind.CHANNEL_MESSAGE,
  "DIFF_POSTED": AutomationTriggerKind.DIFF_POSTED,
  "MENTION": AutomationTriggerKind.MENTION,
  "REACTION_ADDED": AutomationTriggerKind.REACTION_ADDED,
  "SCHEDULE": AutomationTriggerKind.SCHEDULE,
  "WEBHOOK": AutomationTriggerKind.WEBHOOK,
});

///Temporal 原生 Schedule：显式 interval 或 Buzz UTC cron，二者互斥。catchupWindow 不小于原生的 10 秒，Overlap
///固定 SKIP。
class AutomationScheduleSpec {
  final int catchupWindowSeconds;

  ///原 Buzz UTC cron：表单五字段，YAML 六字段包含秒、七字段增加年份；匹配由 Temporal 原生日历执行，不建立本地定时器。
  final String? cron;
  final int? everySeconds;

  ///旧 interval 缺省保持原格式及摘要；cron 必须显式 CRON。互斥及必需字段由领域消费者验证。
  final AutomationScheduleSpecKind? kind;
  final int? offsetSeconds;

  AutomationScheduleSpec({
    required this.catchupWindowSeconds,
    this.cron,
    this.everySeconds,
    this.kind,
    this.offsetSeconds,
  });

  factory AutomationScheduleSpec.fromJson(Map<String, dynamic> json) =>
      AutomationScheduleSpec(
        catchupWindowSeconds: json["catchupWindowSeconds"],
        cron: json["cron"],
        everySeconds: json["everySeconds"],
        kind: json["kind"] == null
            ? null
            : automationScheduleSpecKindValues.map[json["kind"]]!,
        offsetSeconds: json["offsetSeconds"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "catchupWindowSeconds": catchupWindowSeconds,
    "cron": cron,
    "everySeconds": everySeconds,
    "kind": automationScheduleSpecKindValues.reverse[kind],
    "offsetSeconds": offsetSeconds,
  });
}

///旧 interval 缺省保持原格式及摘要；cron 必须显式 CRON。互斥及必需字段由领域消费者验证。
enum AutomationScheduleSpecKind { CRON, INTERVAL }

final automationScheduleSpecKindValues = EnumValues({
  "CRON": AutomationScheduleSpecKind.CRON,
  "INTERVAL": AutomationScheduleSpecKind.INTERVAL,
});

class AutomationPage {
  final List<AutomationView> automations;
  final List<AutomationApprovalPolicyRef>? availableApprovalPolicies;

  ///本次 fresh Workspace create 与已暴露真实动作共同成立；写前仍重新核验。
  final bool canCreate;
  final int? nextOffset;

  AutomationPage({
    required this.automations,
    this.availableApprovalPolicies,
    required this.canCreate,
    this.nextOffset,
  });

  factory AutomationPage.fromJson(Map<String, dynamic> json) => AutomationPage(
    automations: List<AutomationView>.from(
      json["automations"].map((x) => AutomationView.fromJson(x)),
    ),
    availableApprovalPolicies: json["availableApprovalPolicies"] == null
        ? null
        : List<AutomationApprovalPolicyRef>.from(
            json["availableApprovalPolicies"]!.map(
              (x) => AutomationApprovalPolicyRef.fromJson(x),
            ),
          ),
    canCreate: json["canCreate"],
    nextOffset: json["nextOffset"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "automations": List<dynamic>.from(automations.map((x) => x.toJson())),
    "availableApprovalPolicies": availableApprovalPolicies == null
        ? null
        : List<dynamic>.from(availableApprovalPolicies!.map((x) => x.toJson())),
    "canCreate": canCreate,
    "nextOffset": nextOffset,
  });
}

///GET /api/v1/automations/{resource_id}/runs：可读 Automation 的本人运行历史。游标只作分页，不授予权限；每页重新核验。
class AutomationRunPage {
  final String automationResourceId;

  ///不透明 createdAt/id 稳定分页边界；缺省表示本次查询没有更多行。
  final String? nextCursor;
  final List<AutomationRunView> runs;

  AutomationRunPage({
    required this.automationResourceId,
    this.nextCursor,
    required this.runs,
  });

  factory AutomationRunPage.fromJson(Map<String, dynamic> json) =>
      AutomationRunPage(
        automationResourceId: json["automationResourceId"],
        nextCursor: json["nextCursor"],
        runs: List<AutomationRunView>.from(
          json["runs"].map((x) => AutomationRunView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "automationResourceId": automationResourceId,
    "nextCursor": nextCursor,
    "runs": List<dynamic>.from(runs.map((x) => x.toJson())),
  });
}

///本人发起的 automation.run；原 TaskProjection 与 UsageEvent 引用，不是新的运行权威。
class AutomationRunView {
  ///原 TaskProjection 步骤证据。旧投影缺省表示尚无步骤证据，不表示没有步骤或运行成功；不通过读取原 history 旁路回填。
  final List<AutomationStepTrace>? executionTrace;

  ///原 TaskProjection 进度；缺省不推测百分比或成功。
  final String? progress;

  ///同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
  final TaskView? stepApprovalTask;
  final TaskView task;

  ///同 Tenant/Workspace/Operation 的原 UsageEvent 引用；不代表已结算，空集合不代表零用量。
  final List<String> usageEventIds;

  AutomationRunView({
    this.executionTrace,
    this.progress,
    this.stepApprovalTask,
    required this.task,
    required this.usageEventIds,
  });

  factory AutomationRunView.fromJson(Map<String, dynamic> json) =>
      AutomationRunView(
        executionTrace: json["executionTrace"] == null
            ? null
            : List<AutomationStepTrace>.from(
                json["executionTrace"]!.map(
                  (x) => AutomationStepTrace.fromJson(x),
                ),
              ),
        progress: json["progress"],
        stepApprovalTask: json["stepApprovalTask"] == null
            ? null
            : TaskView.fromJson(json["stepApprovalTask"]),
        task: TaskView.fromJson(json["task"]),
        usageEventIds: List<String>.from(json["usageEventIds"].map((x) => x)),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "executionTrace": executionTrace == null
        ? null
        : List<dynamic>.from(executionTrace!.map((x) => x.toJson())),
    "progress": progress,
    "stepApprovalTask": stepApprovalTask?.toJson(),
    "task": task.toJson(),
    "usageEventIds": List<dynamic>.from(usageEventIds.map((x) => x)),
  });
}

///既有 TaskProjection 中固定 AutomationVersion 步骤的可核验证据；不是执行权威。不含正文、模板、密钥、任意输出或原始 Temporal
///history。时间仅来自原生事实，未知时省略。
class AutomationStepTrace {
  ///原生计时终态时间 RFC3339；不存在则省略，不由父任务完成推断。
  final String? completedAt;
  final ReasonCode? error;
  final AutomationStepTraceOutput output;

  ///原生步骤开始时间 RFC3339；不存在则省略，不用投影更新时间替代。
  final String? startedAt;
  final AutomationStepStatus status;
  final String stepId;

  AutomationStepTrace({
    this.completedAt,
    this.error,
    required this.output,
    this.startedAt,
    required this.status,
    required this.stepId,
  });

  factory AutomationStepTrace.fromJson(Map<String, dynamic> json) =>
      AutomationStepTrace(
        completedAt: json["completedAt"],
        error: json["error"] == null
            ? null
            : reasonCodeValues.map[json["error"]]!,
        output: AutomationStepTraceOutput.fromJson(json["output"]),
        startedAt: json["startedAt"],
        status: automationStepStatusValues.map[json["status"]]!,
        stepId: json["stepId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "completedAt": completedAt,
    "error": reasonCodeValues.reverse[error],
    "output": output.toJson(),
    "startedAt": startedAt,
    "status": automationStepStatusValues.reverse[status],
    "stepId": stepId,
  });
}

class AutomationStepTraceOutput {
  final String? actionExecutionId;
  final String? approvalWorkflowId;
  final String? eventId;
  final int? historyEventId;

  ///call_webhook 实际收到的 HTTP 状态码；不保存响应正文或请求头。
  final int? httpStatus;

  ///call_webhook 本次派发的稳定请求引用（随请求发送的 Kailo-Request-Id）。
  final String? requestId;
  final String? runId;
  final String? workflowId;

  AutomationStepTraceOutput({
    this.actionExecutionId,
    this.approvalWorkflowId,
    this.eventId,
    this.historyEventId,
    this.httpStatus,
    this.requestId,
    this.runId,
    this.workflowId,
  });

  factory AutomationStepTraceOutput.fromJson(Map<String, dynamic> json) =>
      AutomationStepTraceOutput(
        actionExecutionId: json["actionExecutionId"],
        approvalWorkflowId: json["approvalWorkflowId"],
        eventId: json["eventId"],
        historyEventId: json["historyEventId"],
        httpStatus: json["httpStatus"],
        requestId: json["requestId"],
        runId: json["runId"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "approvalWorkflowId": approvalWorkflowId,
    "eventId": eventId,
    "historyEventId": historyEventId,
    "httpStatus": httpStatus,
    "requestId": requestId,
    "runId": runId,
    "workflowId": workflowId,
  });
}

enum AutomationStepStatus {
  CANCELLED,
  COMPLETED,
  FAILED,
  PENDING,
  RUNNING,
  SKIPPED,
  UNKNOWN,
  WAITING_APPROVAL,
}

final automationStepStatusValues = EnumValues({
  "cancelled": AutomationStepStatus.CANCELLED,
  "completed": AutomationStepStatus.COMPLETED,
  "failed": AutomationStepStatus.FAILED,
  "pending": AutomationStepStatus.PENDING,
  "running": AutomationStepStatus.RUNNING,
  "skipped": AutomationStepStatus.SKIPPED,
  "unknown": AutomationStepStatus.UNKNOWN,
  "waiting_approval": AutomationStepStatus.WAITING_APPROVAL,
});

///同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
///
///GET /api/v1/tasks 与 /api/v1/tasks/{actionExecutionId} 的元素：调用方本人发起的一个受治理动作。observation
///非空时投影不可担保为当前（PROJECTION_DELAYED）或结果不明（EXTERNAL_RESULT_UNKNOWN），UI 不得把它渲染成成功或失败。
class TaskView {
  final String actionExecutionId;
  final String actionKey;
  final int actionVersion;
  final ApprovalStatus? approvalStatus;
  final String? approvalWorkflowId;

  ///仅任务详情且 Core 当前完成本人、权限、原 Workflow 运行事实重查后提供；提交时仍重新准入
  final String? cancelActionKey;

  ///RFC3339，UTC
  final String createdAt;
  final ActionDispatchState dispatchState;
  final ActionGateState gateState;
  final ReasonCode? observation;
  final String operationId;
  final ReasonCode? reason;

  ///仅任务详情且 Core 证明原 Workflow 已关闭、终态投影一致、原目标仍在收敛版本并完成本人和权限重查后提供；提交与派发时仍重新准入
  final String? rerunActionKey;
  final String targetId;
  final TaskStatus? taskStatus;
  final String? waitingReason;
  final String? workflowId;
  final WorkflowKind? workflowKind;
  final String? workspaceId;

  TaskView({
    required this.actionExecutionId,
    required this.actionKey,
    required this.actionVersion,
    this.approvalStatus,
    this.approvalWorkflowId,
    this.cancelActionKey,
    required this.createdAt,
    required this.dispatchState,
    required this.gateState,
    this.observation,
    required this.operationId,
    this.reason,
    this.rerunActionKey,
    required this.targetId,
    this.taskStatus,
    this.waitingReason,
    this.workflowId,
    this.workflowKind,
    this.workspaceId,
  });

  factory TaskView.fromJson(Map<String, dynamic> json) => TaskView(
    actionExecutionId: json["actionExecutionId"],
    actionKey: json["actionKey"],
    actionVersion: json["actionVersion"],
    approvalStatus: json["approvalStatus"] == null
        ? null
        : approvalStatusValues.map[json["approvalStatus"]]!,
    approvalWorkflowId: json["approvalWorkflowId"],
    cancelActionKey: json["cancelActionKey"],
    createdAt: json["createdAt"],
    dispatchState: actionDispatchStateValues.map[json["dispatchState"]]!,
    gateState: actionGateStateValues.map[json["gateState"]]!,
    observation: json["observation"] == null
        ? null
        : reasonCodeValues.map[json["observation"]]!,
    operationId: json["operationId"],
    reason: json["reason"] == null
        ? null
        : reasonCodeValues.map[json["reason"]]!,
    rerunActionKey: json["rerunActionKey"],
    targetId: json["targetId"],
    taskStatus: json["taskStatus"] == null
        ? null
        : taskStatusValues.map[json["taskStatus"]]!,
    waitingReason: json["waitingReason"],
    workflowId: json["workflowId"],
    workflowKind: json["workflowKind"] == null
        ? null
        : workflowKindValues.map[json["workflowKind"]]!,
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "actionVersion": actionVersion,
    "approvalStatus": approvalStatusValues.reverse[approvalStatus],
    "approvalWorkflowId": approvalWorkflowId,
    "cancelActionKey": cancelActionKey,
    "createdAt": createdAt,
    "dispatchState": actionDispatchStateValues.reverse[dispatchState],
    "gateState": actionGateStateValues.reverse[gateState],
    "observation": reasonCodeValues.reverse[observation],
    "operationId": operationId,
    "reason": reasonCodeValues.reverse[reason],
    "rerunActionKey": rerunActionKey,
    "targetId": targetId,
    "taskStatus": taskStatusValues.reverse[taskStatus],
    "waitingReason": waitingReason,
    "workflowId": workflowId,
    "workflowKind": workflowKindValues.reverse[workflowKind],
    "workspaceId": workspaceId,
  });
}

///ActionExecution 的派发状态（.design/03 §6）。UNKNOWN 是结果不明，既不是成功也不是失败——只有已登记的 native query/dedupe
///seam 能把它收敛，不能因无 native ID 就自动重放（DD-48）。
enum ActionDispatchState { ABORTED, DISPATCHED, NOT_DISPATCHED, UNKNOWN }

final actionDispatchStateValues = EnumValues({
  "ABORTED": ActionDispatchState.ABORTED,
  "DISPATCHED": ActionDispatchState.DISPATCHED,
  "NOT_DISPATCHED": ActionDispatchState.NOT_DISPATCHED,
  "UNKNOWN": ActionDispatchState.UNKNOWN,
});

///ActionExecution 的准入门禁状态（.design/03 §6）。它与 dispatch_state
///是两台独立状态机：门禁说的是「允许不允许」，派发说的是「副作用发生没发生」，合并后无法表达「准入通过但派发结果不明」。
enum ActionGateState { ALLOWED, DENIED, EVALUATING, EXPIRED, REVOKED, WAITING }

final actionGateStateValues = EnumValues({
  "ALLOWED": ActionGateState.ALLOWED,
  "DENIED": ActionGateState.DENIED,
  "EVALUATING": ActionGateState.EVALUATING,
  "EXPIRED": ActionGateState.EXPIRED,
  "REVOKED": ActionGateState.REVOKED,
  "WAITING": ActionGateState.WAITING,
});

///TaskProjection 的状态（.design/03 §6、.design/06 §3.1）。RUNNING 之外的值都是 Temporal 的终态，与其 close
///status 一一对应：Workflow 自己写回的只有 COMPLETED 与 FAILED，其余三个只来自兜底对账对 Temporal 的观察。任一终态都使
///WorkflowRef 进入 TERMINAL。
enum TaskStatus { CANCELED, COMPLETED, FAILED, RUNNING, TERMINATED, TIMED_OUT }

final taskStatusValues = EnumValues({
  "CANCELED": TaskStatus.CANCELED,
  "COMPLETED": TaskStatus.COMPLETED,
  "FAILED": TaskStatus.FAILED,
  "RUNNING": TaskStatus.RUNNING,
  "TERMINATED": TaskStatus.TERMINATED,
  "TIMED_OUT": TaskStatus.TIMED_OUT,
});

///ComponentTaskWorkflow 的封闭 kind 列表。权威定义见 .design/06-Temporal任务工作台.md；新增 kind
///必须同时出现在那里，否则能力注册表在构建期拒绝。本文件只含已实现的 kind。
enum WorkflowKind {
  AGENT_INSTALLATION,
  BUZZ_IDENTITY_PROJECTION,
  COMPONENT_ACTION,
  COMPONENT_BINDING,
  COMPONENT_DISABLE,
  COMPONENT_RELEASE,
  CONVERSATION_PROJECTION,
  MEMBERSHIP_PROJECTION,
  MEMBERSHIP_REVOCATION,
  PROTOCOL_SESSION_RECONCILE,
  RESOURCE_EXPORT,
  RESOURCE_IMPORT,
  RESOURCE_PROVISION,
  SECRET_REF_REHOME,
  TENANT_LIFECYCLE,
  WORKSPACE_LIFECYCLE,
}

final workflowKindValues = EnumValues({
  "AGENT_INSTALLATION": WorkflowKind.AGENT_INSTALLATION,
  "BUZZ_IDENTITY_PROJECTION": WorkflowKind.BUZZ_IDENTITY_PROJECTION,
  "COMPONENT_ACTION": WorkflowKind.COMPONENT_ACTION,
  "COMPONENT_BINDING": WorkflowKind.COMPONENT_BINDING,
  "COMPONENT_DISABLE": WorkflowKind.COMPONENT_DISABLE,
  "COMPONENT_RELEASE": WorkflowKind.COMPONENT_RELEASE,
  "CONVERSATION_PROJECTION": WorkflowKind.CONVERSATION_PROJECTION,
  "MEMBERSHIP_PROJECTION": WorkflowKind.MEMBERSHIP_PROJECTION,
  "MEMBERSHIP_REVOCATION": WorkflowKind.MEMBERSHIP_REVOCATION,
  "PROTOCOL_SESSION_RECONCILE": WorkflowKind.PROTOCOL_SESSION_RECONCILE,
  "RESOURCE_EXPORT": WorkflowKind.RESOURCE_EXPORT,
  "RESOURCE_IMPORT": WorkflowKind.RESOURCE_IMPORT,
  "RESOURCE_PROVISION": WorkflowKind.RESOURCE_PROVISION,
  "SECRET_REF_REHOME": WorkflowKind.SECRET_REF_REHOME,
  "TENANT_LIFECYCLE": WorkflowKind.TENANT_LIFECYCLE,
  "WORKSPACE_LIFECYCLE": WorkflowKind.WORKSPACE_LIFECYCLE,
});

///GET /api/v1/operations 的有界回应（.design/14 §7）：本人发起或实际执行的操作，或调用方对其持有 audit permission 的
///Tenant/Workspace 范围内的操作，每次 fresh Check；新的在前。
class BusinessOperationPage {
  ///下一页首项之前的 ActionExecution ID；缺省即已读完
  final String? nextCursor;
  final List<BusinessOperationView> operations;

  BusinessOperationPage({this.nextCursor, required this.operations});

  factory BusinessOperationPage.fromJson(Map<String, dynamic> json) =>
      BusinessOperationPage(
        nextCursor: json["nextCursor"],
        operations: List<BusinessOperationView>.from(
          json["operations"].map((x) => BusinessOperationView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nextCursor": nextCursor,
    "operations": List<dynamic>.from(operations.map((x) => x.toJson())),
  });
}

///业务操作时间线的一项：一个根 Governed Action（.design/14 §2、§7）。只含平台元数据与权威引用，不含参数、正文、prompt/response
///或原生结果；用量只来自 Core UsageEvent outbox 的冻结 quantity 与投递事实，不是余额或账单。
class BusinessOperationView {
  final String actionExecutionId;
  final String actionKey;
  final int actionVersion;
  final String actorPrincipalId;
  final ApprovalStatus? approvalStatus;

  ///RFC3339，UTC
  final String createdAt;
  final String initiatorPrincipalId;
  final String operationId;
  final BusinessOperationPhase phase;
  final ReasonCode? reason;
  final String targetId;

  ///RFC3339，UTC；只在阶段为确定终态且终态时间来自 TaskProjection 或同 operation 的审计事实时给出
  final String? terminalAt;
  final List<OperationUsageLine> usage;
  final OperationUsageState usageState;
  final WorkflowKind? workflowKind;

  ///缺省即 Tenant 级动作
  final String? workspaceId;

  BusinessOperationView({
    required this.actionExecutionId,
    required this.actionKey,
    required this.actionVersion,
    required this.actorPrincipalId,
    this.approvalStatus,
    required this.createdAt,
    required this.initiatorPrincipalId,
    required this.operationId,
    required this.phase,
    this.reason,
    required this.targetId,
    this.terminalAt,
    required this.usage,
    required this.usageState,
    this.workflowKind,
    this.workspaceId,
  });

  factory BusinessOperationView.fromJson(Map<String, dynamic> json) =>
      BusinessOperationView(
        actionExecutionId: json["actionExecutionId"],
        actionKey: json["actionKey"],
        actionVersion: json["actionVersion"],
        actorPrincipalId: json["actorPrincipalId"],
        approvalStatus: json["approvalStatus"] == null
            ? null
            : approvalStatusValues.map[json["approvalStatus"]]!,
        createdAt: json["createdAt"],
        initiatorPrincipalId: json["initiatorPrincipalId"],
        operationId: json["operationId"],
        phase: businessOperationPhaseValues.map[json["phase"]]!,
        reason: json["reason"] == null
            ? null
            : reasonCodeValues.map[json["reason"]]!,
        targetId: json["targetId"],
        terminalAt: json["terminalAt"],
        usage: List<OperationUsageLine>.from(
          json["usage"].map((x) => OperationUsageLine.fromJson(x)),
        ),
        usageState: operationUsageStateValues.map[json["usageState"]]!,
        workflowKind: json["workflowKind"] == null
            ? null
            : workflowKindValues.map[json["workflowKind"]]!,
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "actionVersion": actionVersion,
    "actorPrincipalId": actorPrincipalId,
    "approvalStatus": approvalStatusValues.reverse[approvalStatus],
    "createdAt": createdAt,
    "initiatorPrincipalId": initiatorPrincipalId,
    "operationId": operationId,
    "phase": businessOperationPhaseValues.reverse[phase],
    "reason": reasonCodeValues.reverse[reason],
    "targetId": targetId,
    "terminalAt": terminalAt,
    "usage": List<dynamic>.from(usage.map((x) => x.toJson())),
    "usageState": operationUsageStateValues.reverse[usageState],
    "workflowKind": workflowKindValues.reverse[workflowKind],
    "workspaceId": workspaceId,
  });
}

///业务操作视图的当前阶段（.design/14 §7、§8），由 Core 按 ActionExecution 准入/派发、ApprovalProjection 与
///TaskProjection 唯一推导；投影不可担保为当前时为 PROJECTION_DELAYED，外部结果不明时为 UNKNOWN，二者都不是成功或失败。APPLIED
///只用于无 Workflow 的同步动作返回结果；CANCEL_REQUESTED 只表示取消控制被接受，不表示原任务已终结。
enum BusinessOperationPhase {
  ABORTED,
  APPLIED,
  AWAITING_APPROVAL,
  CANCELED,
  CANCEL_REQUESTED,
  COMPLETED,
  DENIED,
  EVALUATING,
  EXPIRED,
  FAILED,
  NOT_STARTED,
  PROJECTION_DELAYED,
  REVOKED,
  RUNNING,
  TERMINATED,
  TIMED_OUT,
  UNKNOWN,
}

final businessOperationPhaseValues = EnumValues({
  "ABORTED": BusinessOperationPhase.ABORTED,
  "APPLIED": BusinessOperationPhase.APPLIED,
  "AWAITING_APPROVAL": BusinessOperationPhase.AWAITING_APPROVAL,
  "CANCELED": BusinessOperationPhase.CANCELED,
  "CANCEL_REQUESTED": BusinessOperationPhase.CANCEL_REQUESTED,
  "COMPLETED": BusinessOperationPhase.COMPLETED,
  "DENIED": BusinessOperationPhase.DENIED,
  "EVALUATING": BusinessOperationPhase.EVALUATING,
  "EXPIRED": BusinessOperationPhase.EXPIRED,
  "FAILED": BusinessOperationPhase.FAILED,
  "NOT_STARTED": BusinessOperationPhase.NOT_STARTED,
  "PROJECTION_DELAYED": BusinessOperationPhase.PROJECTION_DELAYED,
  "REVOKED": BusinessOperationPhase.REVOKED,
  "RUNNING": BusinessOperationPhase.RUNNING,
  "TERMINATED": BusinessOperationPhase.TERMINATED,
  "TIMED_OUT": BusinessOperationPhase.TIMED_OUT,
  "UNKNOWN": BusinessOperationPhase.UNKNOWN,
});

class OperationUsageLine {
  final String meterKey;

  ///冻结 CloudEvent 的 quantity；status 非 COMMITTED 时不表示已入账
  final int quantity;
  final UsageSettlementStatus status;

  OperationUsageLine({
    required this.meterKey,
    required this.quantity,
    required this.status,
  });

  factory OperationUsageLine.fromJson(Map<String, dynamic> json) =>
      OperationUsageLine(
        meterKey: json["meterKey"],
        quantity: json["quantity"],
        status: usageSettlementStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "meterKey": meterKey,
    "quantity": quantity,
    "status": usageSettlementStatusValues.reverse[status],
  });
}

///Core UsageEvent outbox 的投递事实（.design/11 §4 第 7 条）。PENDING_PUBLISH 尚未取得 OpenMeter
///回应；ACCEPTED 只表示 202 接收；COMMITTED 表示按 ID/source 查到 stored_at；UNKNOWN 待对账；FAILED 为确定拒绝。均不表示
///invoice 已结算。
enum UsageSettlementStatus {
  ACCEPTED,
  COMMITTED,
  FAILED,
  PENDING_PUBLISH,
  UNKNOWN,
}

final usageSettlementStatusValues = EnumValues({
  "ACCEPTED": UsageSettlementStatus.ACCEPTED,
  "COMMITTED": UsageSettlementStatus.COMMITTED,
  "FAILED": UsageSettlementStatus.FAILED,
  "PENDING_PUBLISH": UsageSettlementStatus.PENDING_PUBLISH,
  "UNKNOWN": UsageSettlementStatus.UNKNOWN,
});

///一个业务操作的用量结算状态（.design/11 §4、§6，.design/14
///§8）。NOT_METERED：动作定义没有用量来源；NOT_DISPATCHED：有计量但没有派发；BILLING_UNAVAILABLE：已派发却没有可结算的持久用量事实（不显示零）；SETTLEMENT_PENDING：用量事件待发布或
///OpenMeter 仅 202 接收；COMMITTED：全部事件已按 ID/source 查到
///stored_at；UNKNOWN：投递或查证结果不明，待对账；FAILED：投递被确定拒绝。COMMITTED 不代表账单已结算。
enum OperationUsageState {
  BILLING_UNAVAILABLE,
  COMMITTED,
  FAILED,
  NOT_DISPATCHED,
  NOT_METERED,
  SETTLEMENT_PENDING,
  UNKNOWN,
}

final operationUsageStateValues = EnumValues({
  "BILLING_UNAVAILABLE": OperationUsageState.BILLING_UNAVAILABLE,
  "COMMITTED": OperationUsageState.COMMITTED,
  "FAILED": OperationUsageState.FAILED,
  "NOT_DISPATCHED": OperationUsageState.NOT_DISPATCHED,
  "NOT_METERED": OperationUsageState.NOT_METERED,
  "SETTLEMENT_PENDING": OperationUsageState.SETTLEMENT_PENDING,
  "UNKNOWN": OperationUsageState.UNKNOWN,
});

///GET /api/v1/operations/summary：Tenant 或其中一个 Workspace 在区间内的业务聚合（.design/14 §7），调用方须对该范围持有
///audit permission，每次 fresh Check。等待审批、运行中、UNKNOWN、投影落后与撤销单列，不从分母中丢弃；平均耗时只取有确定终态时间的操作。
class BusinessOperationSummary {
  final List<BusinessOperationActionSummary> actions;

  ///RFC3339，含
  final String from;
  final List<BusinessOperationPhaseCount> phases;
  final String tenantId;

  ///RFC3339，不含
  final String to;
  final int total;
  final List<OperationUsageCount> usageStates;
  final String? workspaceId;

  BusinessOperationSummary({
    required this.actions,
    required this.from,
    required this.phases,
    required this.tenantId,
    required this.to,
    required this.total,
    required this.usageStates,
    this.workspaceId,
  });

  factory BusinessOperationSummary.fromJson(Map<String, dynamic> json) =>
      BusinessOperationSummary(
        actions: List<BusinessOperationActionSummary>.from(
          json["actions"].map(
            (x) => BusinessOperationActionSummary.fromJson(x),
          ),
        ),
        from: json["from"],
        phases: List<BusinessOperationPhaseCount>.from(
          json["phases"].map((x) => BusinessOperationPhaseCount.fromJson(x)),
        ),
        tenantId: json["tenantId"],
        to: json["to"],
        total: json["total"],
        usageStates: List<OperationUsageCount>.from(
          json["usageStates"].map((x) => OperationUsageCount.fromJson(x)),
        ),
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actions": List<dynamic>.from(actions.map((x) => x.toJson())),
    "from": from,
    "phases": List<dynamic>.from(phases.map((x) => x.toJson())),
    "tenantId": tenantId,
    "to": to,
    "total": total,
    "usageStates": List<dynamic>.from(usageStates.map((x) => x.toJson())),
    "workspaceId": workspaceId,
  });
}

class BusinessOperationActionSummary {
  final String actionKey;

  ///timedTerminalCount 为 0 时缺省
  final double? averageTerminalSeconds;
  final List<BusinessOperationPhaseCount> phases;

  ///有确定终态时间、计入平均耗时的操作数
  final int timedTerminalCount;
  final int total;

  BusinessOperationActionSummary({
    required this.actionKey,
    this.averageTerminalSeconds,
    required this.phases,
    required this.timedTerminalCount,
    required this.total,
  });

  factory BusinessOperationActionSummary.fromJson(Map<String, dynamic> json) =>
      BusinessOperationActionSummary(
        actionKey: json["actionKey"],
        averageTerminalSeconds: json["averageTerminalSeconds"]?.toDouble(),
        phases: List<BusinessOperationPhaseCount>.from(
          json["phases"].map((x) => BusinessOperationPhaseCount.fromJson(x)),
        ),
        timedTerminalCount: json["timedTerminalCount"],
        total: json["total"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "averageTerminalSeconds": averageTerminalSeconds,
    "phases": List<dynamic>.from(phases.map((x) => x.toJson())),
    "timedTerminalCount": timedTerminalCount,
    "total": total,
  });
}

///一个阶段在所选范围与区间内的根业务操作数量。只列出现过的阶段，不补零。
class BusinessOperationPhaseCount {
  final int count;
  final BusinessOperationPhase phase;

  BusinessOperationPhaseCount({required this.count, required this.phase});

  factory BusinessOperationPhaseCount.fromJson(Map<String, dynamic> json) =>
      BusinessOperationPhaseCount(
        count: json["count"],
        phase: businessOperationPhaseValues.map[json["phase"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "count": count,
    "phase": businessOperationPhaseValues.reverse[phase],
  });
}

///一个用量结算状态在所选范围与区间内的根业务操作数量。只列出现过的状态，不补零。
class OperationUsageCount {
  final int count;
  final OperationUsageState state;

  OperationUsageCount({required this.count, required this.state});

  factory OperationUsageCount.fromJson(Map<String, dynamic> json) =>
      OperationUsageCount(
        count: json["count"],
        state: operationUsageStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "count": count,
    "state": operationUsageStateValues.reverse[state],
  });
}

class CapabilityContractPage {
  final bool canRegister;
  final List<CapabilityContractView> contracts;
  final int? nextOffset;

  CapabilityContractPage({
    required this.canRegister,
    required this.contracts,
    this.nextOffset,
  });

  factory CapabilityContractPage.fromJson(Map<String, dynamic> json) =>
      CapabilityContractPage(
        canRegister: json["canRegister"],
        contracts: List<CapabilityContractView>.from(
          json["contracts"].map((x) => CapabilityContractView.fromJson(x)),
        ),
        nextOffset: json["nextOffset"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "canRegister": canRegister,
    "contracts": List<dynamic>.from(contracts.map((x) => x.toJson())),
    "nextOffset": nextOffset,
  });
}

///受权 Catalog 元数据，不复制 schema/测试向量或业务正文，不证明 release/binding 可用。
class CapabilityContractView {
  ///PLATFORM_SEED 的部署引导证据；不冒充人为登记或批准。
  final String? bootstrapActionExecutionId;
  final bool canApprove;
  final bool canDeprecate;
  final String categoryKey;
  final String conformanceSuiteDigest;
  final int contractVersion;
  final String? registeredByActionExecutionId;
  final String schemaSetDigest;
  final CapabilityContractStatus status;

  CapabilityContractView({
    this.bootstrapActionExecutionId,
    required this.canApprove,
    required this.canDeprecate,
    required this.categoryKey,
    required this.conformanceSuiteDigest,
    required this.contractVersion,
    this.registeredByActionExecutionId,
    required this.schemaSetDigest,
    required this.status,
  });

  factory CapabilityContractView.fromJson(Map<String, dynamic> json) =>
      CapabilityContractView(
        bootstrapActionExecutionId: json["bootstrapActionExecutionId"],
        canApprove: json["canApprove"],
        canDeprecate: json["canDeprecate"],
        categoryKey: json["categoryKey"],
        conformanceSuiteDigest: json["conformanceSuiteDigest"],
        contractVersion: json["contractVersion"],
        registeredByActionExecutionId: json["registeredByActionExecutionId"],
        schemaSetDigest: json["schemaSetDigest"],
        status: capabilityContractStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bootstrapActionExecutionId": bootstrapActionExecutionId,
    "canApprove": canApprove,
    "canDeprecate": canDeprecate,
    "categoryKey": categoryKey,
    "conformanceSuiteDigest": conformanceSuiteDigest,
    "contractVersion": contractVersion,
    "registeredByActionExecutionId": registeredByActionExecutionId,
    "schemaSetDigest": schemaSetDigest,
    "status": capabilityContractStatusValues.reverse[status],
  });
}

enum CapabilityContractStatus { ACTIVE, DEPRECATED, DRAFT, RETIRED }

final capabilityContractStatusValues = EnumValues({
  "ACTIVE": CapabilityContractStatus.ACTIVE,
  "DEPRECATED": CapabilityContractStatus.DEPRECATED,
  "DRAFT": CapabilityContractStatus.DRAFT,
  "RETIRED": CapabilityContractStatus.RETIRED,
});

///PUT /api/v1/user-state/channel-templates/{templateId} 的请求体（DD-125(4)、03
///CollaborationUserState.channel_templates）：新建或替换本人的原频道模板；templateId 由客户端以 UUID 生成。字段沿原
///ChannelTemplateRecord；agentResourceIds 只引用同 Tenant 的 AgentDefinition Resource（≙ 原
///persona），原 runtime/model/backend 与 team 条目不适用。canvasTemplate 不超过 64 KiB，每人至多 200
///个模板。模板不授予任何权限：应用时仍逐项提交 workspace.create、workspace.canvas.set 与
///agent.installation.create。DELETE 同一路径以 UserStateVersion 为请求体。version 不符即 409。
class ChannelTemplateRequest {
  final List<String> agentResourceIds;
  final String? canvasTemplate;
  final WorkspaceChannelCreateChannelType channelType;
  final String? description;
  final String name;
  final int version;
  final WorkspaceVisibility visibility;

  ChannelTemplateRequest({
    required this.agentResourceIds,
    this.canvasTemplate,
    required this.channelType,
    this.description,
    required this.name,
    required this.version,
    required this.visibility,
  });

  factory ChannelTemplateRequest.fromJson(Map<String, dynamic> json) =>
      ChannelTemplateRequest(
        agentResourceIds: List<String>.from(
          json["agentResourceIds"].map((x) => x),
        ),
        canvasTemplate: json["canvasTemplate"],
        channelType:
            workspaceChannelCreateChannelTypeValues.map[json["channelType"]]!,
        description: json["description"],
        name: json["name"],
        version: json["version"],
        visibility: workspaceVisibilityValues.map[json["visibility"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentResourceIds": List<dynamic>.from(agentResourceIds.map((x) => x)),
    "canvasTemplate": canvasTemplate,
    "channelType": workspaceChannelCreateChannelTypeValues.reverse[channelType],
    "description": description,
    "name": name,
    "version": version,
    "visibility": workspaceVisibilityValues.reverse[visibility],
  });
}

enum WorkspaceChannelCreateChannelType { FORUM, STREAM }

final workspaceChannelCreateChannelTypeValues = EnumValues({
  "forum": WorkspaceChannelCreateChannelType.FORUM,
  "stream": WorkspaceChannelCreateChannelType.STREAM,
});

///GET /api/v1/identity/client-keys 回应数组的元素：本人登记且未撤销的原生设备公钥（DD-77/79）。
class ClientKeyView {
  ///RFC3339
  final String createdAt;
  final String pubkey;
  final BuzzIdentityState state;

  ClientKeyView({
    required this.createdAt,
    required this.pubkey,
    required this.state,
  });

  factory ClientKeyView.fromJson(Map<String, dynamic> json) => ClientKeyView(
    createdAt: json["createdAt"],
    pubkey: json["pubkey"],
    state: buzzIdentityStateValues.map[json["state"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "createdAt": createdAt,
    "pubkey": pubkey,
    "state": buzzIdentityStateValues.reverse[state],
  });
}

///BuzzIdentityBinding 状态机。custody=CLIENT 时跳过 PENDING_SECRET，自 RECONCILING 起始。
enum BuzzIdentityState {
  ACTIVE,
  PENDING_SECRET,
  RECONCILING,
  REVOKED,
  REVOKING,
}

final buzzIdentityStateValues = EnumValues({
  "ACTIVE": BuzzIdentityState.ACTIVE,
  "PENDING_SECRET": BuzzIdentityState.PENDING_SECRET,
  "RECONCILING": BuzzIdentityState.RECONCILING,
  "REVOKED": BuzzIdentityState.REVOKED,
  "REVOKING": BuzzIdentityState.REVOKING,
});

///设备公钥登记（POST /api/v1/identity/client-keys）与撤销（DELETE
////api/v1/identity/client-keys/{pubkey}）的回应。
class ClientKeyStatus {
  final String pubkey;

  ///状态仍在收敛时，客户端再次读取设备状态前至少等待的毫秒数；确定终态时缺省
  final int? recheckAfterMillis;
  final BuzzIdentityState state;

  ///推进该状态的 Workflow；本次调用没有需要推进的状态时缺省
  final String? workflowId;

  ClientKeyStatus({
    required this.pubkey,
    this.recheckAfterMillis,
    required this.state,
    this.workflowId,
  });

  factory ClientKeyStatus.fromJson(Map<String, dynamic> json) =>
      ClientKeyStatus(
        pubkey: json["pubkey"],
        recheckAfterMillis: json["recheckAfterMillis"],
        state: buzzIdentityStateValues.map[json["state"]]!,
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "pubkey": pubkey,
    "recheckAfterMillis": recheckAfterMillis,
    "state": buzzIdentityStateValues.reverse[state],
    "workflowId": workflowId,
  });
}

///
///Core私网仅向受信Worker返回的逐次隔离探测凭据。token仅在Activity内存中使用，禁止进入Temporal输入、输出或报告。其声明绑定固定模拟上下文与完整实际参数，不授予生产binding授权。
class ComponentConformanceAuthorization {
  final String expectedResponseDigest;
  final ComponentConformanceOperation operation;
  final String requestDigest;
  final String requestJson;
  final String token;

  ComponentConformanceAuthorization({
    required this.expectedResponseDigest,
    required this.operation,
    required this.requestDigest,
    required this.requestJson,
    required this.token,
  });

  factory ComponentConformanceAuthorization.fromJson(
    Map<String, dynamic> json,
  ) => ComponentConformanceAuthorization(
    expectedResponseDigest: json["expectedResponseDigest"],
    operation: componentConformanceOperationValues.map[json["operation"]]!,
    requestDigest: json["requestDigest"],
    requestJson: json["requestJson"],
    token: json["token"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "expectedResponseDigest": expectedResponseDigest,
    "operation": componentConformanceOperationValues.reverse[operation],
    "requestDigest": requestDigest,
    "requestJson": requestJson,
    "token": token,
  });
}

///原登记套件的真实操作种类；MCP 方法不属于 AdapterProtocolOperation，也不要求原生 peer 实现 Adapter API。
enum ComponentConformanceOperation {
  CANCEL,
  EXECUTE,
  EXTRACT_USAGE,
  HANDSHAKE,
  MAP_NATIVE_STATUS_ERROR,
  MCP_CALL,
  MCP_INITIALIZE,
  MCP_LIST,
  OBSERVE,
  QUERY_REVISION,
  RECEIVER_OBSERVE,
  RECEIVER_START,
  RECONCILE,
  RESOLVE_NATIVE_SCOPE,
  VALIDATE_BINDING,
}

final componentConformanceOperationValues = EnumValues({
  "cancel": ComponentConformanceOperation.CANCEL,
  "execute": ComponentConformanceOperation.EXECUTE,
  "extract_usage": ComponentConformanceOperation.EXTRACT_USAGE,
  "handshake": ComponentConformanceOperation.HANDSHAKE,
  "map_native_status_error":
      ComponentConformanceOperation.MAP_NATIVE_STATUS_ERROR,
  "mcp_call": ComponentConformanceOperation.MCP_CALL,
  "mcp_initialize": ComponentConformanceOperation.MCP_INITIALIZE,
  "mcp_list": ComponentConformanceOperation.MCP_LIST,
  "observe": ComponentConformanceOperation.OBSERVE,
  "query_revision": ComponentConformanceOperation.QUERY_REVISION,
  "receiver_observe": ComponentConformanceOperation.RECEIVER_OBSERVE,
  "receiver_start": ComponentConformanceOperation.RECEIVER_START,
  "reconcile": ComponentConformanceOperation.RECONCILE,
  "resolve_native_scope": ComponentConformanceOperation.RESOLVE_NATIVE_SCOPE,
  "validate_binding": ComponentConformanceOperation.VALIDATE_BINDING,
});

///Core原canonical_digest对同一已授权步骤实际响应的摘要；仅规范化事实，不声明套件通过或登记成功。
class ComponentConformanceWireDigests {
  ///仅成功 validate_binding：严格解析既有 AdapterBindingObservation 并核对请求的 SecretRef 后，仅去除实际
  ///secretReads.requestId 的固定字段摘要。完整实际响应仍由 responseDigest 固定；不代替绑定激活的 OpenBao 审计核验。
  final String? bindingDigest;

  ///DD-124：仅当冻结步骤声明 captures 且实际应答为带原生状态的 SUCCEEDED 时，从 typed ContentReference 或登记的
  ///generatedRefs 输出字段取出的值。
  final List<ComponentConformanceCaptureValue>? captures;
  final ComponentNativeReceiverObservation? nativeReceiverObservation;
  final String requestDigest;
  final String responseDigest;
  final String? resultDigest;

  ComponentConformanceWireDigests({
    this.bindingDigest,
    this.captures,
    this.nativeReceiverObservation,
    required this.requestDigest,
    required this.responseDigest,
    this.resultDigest,
  });

  factory ComponentConformanceWireDigests.fromJson(Map<String, dynamic> json) =>
      ComponentConformanceWireDigests(
        bindingDigest: json["bindingDigest"],
        captures: json["captures"] == null
            ? null
            : List<ComponentConformanceCaptureValue>.from(
                json["captures"]!.map(
                  (x) => ComponentConformanceCaptureValue.fromJson(x),
                ),
              ),
        nativeReceiverObservation: json["nativeReceiverObservation"] == null
            ? null
            : ComponentNativeReceiverObservation.fromJson(
                json["nativeReceiverObservation"],
              ),
        requestDigest: json["requestDigest"],
        responseDigest: json["responseDigest"],
        resultDigest: json["resultDigest"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingDigest": bindingDigest,
    "captures": captures == null
        ? null
        : List<dynamic>.from(captures!.map((x) => x.toJson())),
    "nativeReceiverObservation": nativeReceiverObservation?.toJson(),
    "requestDigest": requestDigest,
    "responseDigest": responseDigest,
    "resultDigest": resultDigest,
  });
}

///DD-124(2): one captured value of the current suite run. Core derives it only from the
///candidate's actual wire response or typed ContentReference; it is kept only in that
///step's observation evidence and re-checked when the report is recorded. Never a fixture,
///seed or administrator value.
class ComponentConformanceCaptureValue {
  final String key;
  final String value;

  ComponentConformanceCaptureValue({required this.key, required this.value});

  factory ComponentConformanceCaptureValue.fromJson(
    Map<String, dynamic> json,
  ) => ComponentConformanceCaptureValue(key: json["key"], value: json["value"]);

  Map<String, dynamic> toJson() => _stripNulls({"key": key, "value": value});
}

///原生 SyncLog 的真实批次与同批多个原 SERVICE read Operation 元数据；completed 不能单独证明通过，Core 仍核对每个
///SOURCE/RECEIVER 回执及冻结请求。DD-124(4)：请求省略 importConfigRef 时，本观察是隔离 Core 真实 APPLICATION
///接收方动作的原生执行（nativeBatchId 为其原生任务标识，nativeStatus 为原生状态原值），每个 read Operation 锚定该动作而无
///nativeBatch；RECEIVER case 中不读取来源的步骤（如 read/export/search/delete）可无 read Operation，读取由整个
///case 承载。执行、operation 与批次标识须为隔离 Core 本次生成且不在计划或 fixture 中。
class ComponentNativeReceiverObservation {
  final bool completed;
  final String? finishedAt;
  final String nativeBatchId;
  final String nativeStatus;
  final List<ComponentNativeReadObservation> readOperations;
  final ComponentNativeReceiverRequest request;
  final String startedAt;

  ComponentNativeReceiverObservation({
    required this.completed,
    this.finishedAt,
    required this.nativeBatchId,
    required this.nativeStatus,
    required this.readOperations,
    required this.request,
    required this.startedAt,
  });

  factory ComponentNativeReceiverObservation.fromJson(
    Map<String, dynamic> json,
  ) => ComponentNativeReceiverObservation(
    completed: json["completed"],
    finishedAt: json["finishedAt"],
    nativeBatchId: json["nativeBatchId"],
    nativeStatus: json["nativeStatus"],
    readOperations: List<ComponentNativeReadObservation>.from(
      json["readOperations"].map(
        (x) => ComponentNativeReadObservation.fromJson(x),
      ),
    ),
    request: ComponentNativeReceiverRequest.fromJson(json["request"]),
    startedAt: json["startedAt"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "completed": completed,
    "finishedAt": finishedAt,
    "nativeBatchId": nativeBatchId,
    "nativeStatus": nativeStatus,
    "readOperations": List<dynamic>.from(readOperations.map((x) => x.toJson())),
    "request": request.toJson(),
    "startedAt": startedAt,
  });
}

class ComponentNativeReadObservation {
  final String actionExecutionId;

  ///原生批次读取必填且等于 readRequest.nativeBatch；锚定 APPLICATION 接收方动作的读取必须省略（readRequest 携带
  ///receiverActionExecutionId）。
  final AdapterReadGrantRequestNativeBatch? nativeBatch;
  final String operationId;
  final AdapterReadGrantRequest readRequest;
  final String receiverActionExecutionId;
  final int receiverGeneration;
  final AdapterReadReceipt receiverReceipt;
  final String sourceBindingId;
  final AdapterReadReceipt sourceReceipt;
  final String sourceResourceId;

  ComponentNativeReadObservation({
    required this.actionExecutionId,
    this.nativeBatch,
    required this.operationId,
    required this.readRequest,
    required this.receiverActionExecutionId,
    required this.receiverGeneration,
    required this.receiverReceipt,
    required this.sourceBindingId,
    required this.sourceReceipt,
    required this.sourceResourceId,
  });

  factory ComponentNativeReadObservation.fromJson(Map<String, dynamic> json) =>
      ComponentNativeReadObservation(
        actionExecutionId: json["actionExecutionId"],
        nativeBatch: json["nativeBatch"] == null
            ? null
            : AdapterReadGrantRequestNativeBatch.fromJson(json["nativeBatch"]),
        operationId: json["operationId"],
        readRequest: AdapterReadGrantRequest.fromJson(json["readRequest"]),
        receiverActionExecutionId: json["receiverActionExecutionId"],
        receiverGeneration: json["receiverGeneration"],
        receiverReceipt: AdapterReadReceipt.fromJson(json["receiverReceipt"]),
        sourceBindingId: json["sourceBindingId"],
        sourceReceipt: AdapterReadReceipt.fromJson(json["sourceReceipt"]),
        sourceResourceId: json["sourceResourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "nativeBatch": nativeBatch?.toJson(),
    "operationId": operationId,
    "readRequest": readRequest.toJson(),
    "receiverActionExecutionId": receiverActionExecutionId,
    "receiverGeneration": receiverGeneration,
    "receiverReceipt": receiverReceipt.toJson(),
    "sourceBindingId": sourceBindingId,
    "sourceReceipt": sourceReceipt.toJson(),
    "sourceResourceId": sourceResourceId,
  });
}

///Native SERVICE importer provenance instead of a HUMAN/AGENT execution. Core requires
///exactly one mode, freezes these references, and resolves the receiver from its
///authenticated binding.
///
///原生批次读取必填且等于 readRequest.nativeBatch；锚定 APPLICATION 接收方动作的读取必须省略（readRequest 携带
///receiverActionExecutionId）。
class AdapterReadGrantRequestNativeBatch {
  final String actionKey;
  final int actionVersion;
  final String batchId;
  final String importConfigRef;
  final String receiverResourceId;

  AdapterReadGrantRequestNativeBatch({
    required this.actionKey,
    required this.actionVersion,
    required this.batchId,
    required this.importConfigRef,
    required this.receiverResourceId,
  });

  factory AdapterReadGrantRequestNativeBatch.fromJson(
    Map<String, dynamic> json,
  ) => AdapterReadGrantRequestNativeBatch(
    actionKey: json["actionKey"],
    actionVersion: json["actionVersion"],
    batchId: json["batchId"],
    importConfigRef: json["importConfigRef"],
    receiverResourceId: json["receiverResourceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "actionVersion": actionVersion,
    "batchId": batchId,
    "importConfigRef": importConfigRef,
    "receiverResourceId": receiverResourceId,
  });
}

///DD-89: receiver binding authenticates as its own ServicePrincipal for one source-resource
///read batch. Input is checked against the approved source action schema; Core retains its
///digest, not the returned business content.
class AdapterReadGrantRequest {
  final String actionKey;
  final int actionVersion;
  final String idempotencyKey;
  final String inputJson;

  ///Native SERVICE importer provenance instead of a HUMAN/AGENT execution. Core requires
  ///exactly one mode, freezes these references, and resolves the receiver from its
  ///authenticated binding.
  final AdapterReadGrantRequestNativeBatch? nativeBatch;

  ///只观察已存在的同一原生 SOURCE AE；必须匹配原 key/nativeBatch（或锚定的 receiverActionExecutionId 与
  ///receiverArgumentsJson）/输入，查无或未就绪不得创建、续发 grant 或进入新准入。
  final String? observeActionExecutionId;
  final String? receiverActionExecutionId;
  final String? receiverArgumentsJson;
  final String receiverBindingId;
  final String sourceResourceId;

  AdapterReadGrantRequest({
    required this.actionKey,
    required this.actionVersion,
    required this.idempotencyKey,
    required this.inputJson,
    this.nativeBatch,
    this.observeActionExecutionId,
    this.receiverActionExecutionId,
    this.receiverArgumentsJson,
    required this.receiverBindingId,
    required this.sourceResourceId,
  });

  factory AdapterReadGrantRequest.fromJson(Map<String, dynamic> json) =>
      AdapterReadGrantRequest(
        actionKey: json["actionKey"],
        actionVersion: json["actionVersion"],
        idempotencyKey: json["idempotencyKey"],
        inputJson: json["inputJson"],
        nativeBatch: json["nativeBatch"] == null
            ? null
            : AdapterReadGrantRequestNativeBatch.fromJson(json["nativeBatch"]),
        observeActionExecutionId: json["observeActionExecutionId"],
        receiverActionExecutionId: json["receiverActionExecutionId"],
        receiverArgumentsJson: json["receiverArgumentsJson"],
        receiverBindingId: json["receiverBindingId"],
        sourceResourceId: json["sourceResourceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "actionVersion": actionVersion,
    "idempotencyKey": idempotencyKey,
    "inputJson": inputJson,
    "nativeBatch": nativeBatch?.toJson(),
    "observeActionExecutionId": observeActionExecutionId,
    "receiverActionExecutionId": receiverActionExecutionId,
    "receiverArgumentsJson": receiverArgumentsJson,
    "receiverBindingId": receiverBindingId,
    "sourceResourceId": sourceResourceId,
  });
}

///07§8A 隔离原生接收方验证的冻结请求。原生生成真实 batch ID；同键重入与观察必须保持全部字段，不是生产 execute 输入或通用 HTTP
///脚本。DD-124(4)：importConfigRef 存在时为 NATIVE_MANAGED 原生批次，由候选实现原生发起；省略时为隔离部署内的 APPLICATION
///接收方动作（如经 READ_EDGE 的 ingest），由平台维护的隔离部署以真实 APPLICATION ActionExecution
///准入与派发，原能力输入只由已登记向量与 fixture 前置值冻结。
class ComponentNativeReceiverRequest {
  final String bindingId;

  ///受控夹具固定的 RFC3339 首派期限，须受原生 SyncLog 保留策略约束；过期仍可观察同一批次，不得续期重派。
  final String expiresAt;
  final int generation;
  final String idempotencyKey;
  final String? importConfigRef;

  ComponentNativeReceiverRequest({
    required this.bindingId,
    required this.expiresAt,
    required this.generation,
    required this.idempotencyKey,
    this.importConfigRef,
  });

  factory ComponentNativeReceiverRequest.fromJson(Map<String, dynamic> json) =>
      ComponentNativeReceiverRequest(
        bindingId: json["bindingId"],
        expiresAt: json["expiresAt"],
        generation: json["generation"],
        idempotencyKey: json["idempotencyKey"],
        importConfigRef: json["importConfigRef"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "expiresAt": expiresAt,
    "generation": generation,
    "idempotencyKey": idempotencyKey,
    "importConfigRef": importConfigRef,
  });
}

///受信Worker实际HTTP响应的瞬时核验输入。正文仅在Activity与Core请求内存中存在，不得进入Temporal历史、报告、日志或数据库；不是用户上传的通过声明。
class ComponentConformanceWireObservation {
  final int httpStatus;
  final ComponentConformanceProbe probe;
  final String responseJson;

  ComponentConformanceWireObservation({
    required this.httpStatus,
    required this.probe,
    required this.responseJson,
  });

  factory ComponentConformanceWireObservation.fromJson(
    Map<String, dynamic> json,
  ) => ComponentConformanceWireObservation(
    httpStatus: json["httpStatus"],
    probe: ComponentConformanceProbe.fromJson(json["probe"]),
    responseJson: json["responseJson"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "httpStatus": httpStatus,
    "probe": probe.toJson(),
    "responseJson": responseJson,
  });
}

///原 ComponentTaskWorkflow 的单个线协议 Activity 输入。步骤来自 Core 冻结计划；调度、尝试次数与 UNKNOWN 对账只由原 Temporal
///history 承接，不建立另一执行账本。
class ComponentConformanceProbe {
  ///DD-124：本步 CAPTURE 绑定所需的值，只取同 case 更早步骤已记录观察中的 captures；Core 代入后签名，登记时再按报告重算，不能以 fixture
  ///或管理员值替代。
  final List<ComponentConformanceCaptureValue>? captures;
  final ContentReference? contentReference;
  final ComponentConformancePlan plan;

  ///只查询同一步冻结幂等键；不再发送原 execute/CREATE。
  final bool? reconcile;
  final int stepIndex;

  ComponentConformanceProbe({
    this.captures,
    this.contentReference,
    required this.plan,
    this.reconcile,
    required this.stepIndex,
  });

  factory ComponentConformanceProbe.fromJson(Map<String, dynamic> json) =>
      ComponentConformanceProbe(
        captures: json["captures"] == null
            ? null
            : List<ComponentConformanceCaptureValue>.from(
                json["captures"]!.map(
                  (x) => ComponentConformanceCaptureValue.fromJson(x),
                ),
              ),
        contentReference: json["contentReference"] == null
            ? null
            : ContentReference.fromJson(json["contentReference"]),
        plan: ComponentConformancePlan.fromJson(json["plan"]),
        reconcile: json["reconcile"],
        stepIndex: json["stepIndex"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "captures": captures == null
        ? null
        : List<dynamic>.from(captures!.map((x) => x.toJson())),
    "contentReference": contentReference?.toJson(),
    "plan": plan.toJson(),
    "reconcile": reconcile,
    "stepIndex": stepIndex,
  });
}

///受信 Worker 从 Core 取得的隔离执行输入。不是用户上传的通过声明；只含冻结引用与平台解释的数据，不含候选地址或凭据。顺序与全部内容进入 planDigest。
class ComponentConformancePlan {
  final String actionExecutionId;
  final String artifactDigest;
  final String componentReleaseId;
  final ComponentConformancePlanConnectorKind? connectorKind;
  final List<String> contractDigests;

  ///独立隔离身份投递的完整规范化摘要，不含私钥或token，不是生产policy。
  final String identityDigest;
  final String operationId;
  final String planDigest;

  ///DD-124(4)：仅含接收方向步骤的计划。Core 冻结时从已核验的隔离身份复制；登记与批准以它核对当前 Core 构建与来源类别已 APPROVED 的 release。
  final ComponentConformanceReceiverEnvironment? receiverEnvironment;

  ///Core 冻结时为空；原 ComponentTaskWorkflow 启动后写入真实 Temporal run UUID。报告的 runId 仍必须为 UUID，Core 以
  ///Describe 与同 workflow 的当前 TaskProjection 核对。
  final String runId;
  final List<ComponentConformanceStep> steps;
  final String suiteDigest;
  final String workflowId;

  ComponentConformancePlan({
    required this.actionExecutionId,
    required this.artifactDigest,
    required this.componentReleaseId,
    this.connectorKind,
    required this.contractDigests,
    required this.identityDigest,
    required this.operationId,
    required this.planDigest,
    this.receiverEnvironment,
    required this.runId,
    required this.steps,
    required this.suiteDigest,
    required this.workflowId,
  });

  factory ComponentConformancePlan.fromJson(Map<String, dynamic> json) =>
      ComponentConformancePlan(
        actionExecutionId: json["actionExecutionId"],
        artifactDigest: json["artifactDigest"],
        componentReleaseId: json["componentReleaseId"],
        connectorKind: json["connectorKind"] == null
            ? null
            : componentConformancePlanConnectorKindValues
                  .map[json["connectorKind"]]!,
        contractDigests: List<String>.from(
          json["contractDigests"].map((x) => x),
        ),
        identityDigest: json["identityDigest"],
        operationId: json["operationId"],
        planDigest: json["planDigest"],
        receiverEnvironment: json["receiverEnvironment"] == null
            ? null
            : ComponentConformanceReceiverEnvironment.fromJson(
                json["receiverEnvironment"],
              ),
        runId: json["runId"],
        steps: List<ComponentConformanceStep>.from(
          json["steps"].map((x) => ComponentConformanceStep.fromJson(x)),
        ),
        suiteDigest: json["suiteDigest"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "artifactDigest": artifactDigest,
    "componentReleaseId": componentReleaseId,
    "connectorKind":
        componentConformancePlanConnectorKindValues.reverse[connectorKind],
    "contractDigests": List<dynamic>.from(contractDigests.map((x) => x)),
    "identityDigest": identityDigest,
    "operationId": operationId,
    "planDigest": planDigest,
    "receiverEnvironment": receiverEnvironment?.toJson(),
    "runId": runId,
    "steps": List<dynamic>.from(steps.map((x) => x.toJson())),
    "suiteDigest": suiteDigest,
    "workflowId": workflowId,
  });
}

enum ComponentConformancePlanConnectorKind { PROTOCOL_PEER, REMOTE_ADAPTER }

final componentConformancePlanConnectorKindValues = EnumValues({
  "PROTOCOL_PEER": ComponentConformancePlanConnectorKind.PROTOCOL_PEER,
  "REMOTE_ADAPTER": ComponentConformancePlanConnectorKind.REMOTE_ADAPTER,
});

///DD-124(4)：仅含接收方向步骤的计划。Core 冻结时从已核验的隔离身份复制；登记与批准以它核对当前 Core 构建与来源类别已 APPROVED 的 release。
///
///DD-124(4), 07 §8A: identity of the isolated receiver deployment a plan with
///receiver_start/receiver_observe steps observes. isolatedCoreBuildId is the
///PlatformBuildInfo CORE buildId of the isolated Core/Worker and must equal the current
///production Core build. sourceReleaseId with its artifact and manifest digests names the
///production Catalog release, APPROVED and declaring read_edge SOURCE or BOTH, that the
///isolated deployment runs as the source. It is delivered with the isolated identity, fixed
///by the plan identity digest and copied into the plan; it is not evidence that any step
///passed.
///
///DD-124(4)：计划含 receiver_start/receiver_observe 步骤时必填；固定隔离接收方部署的 Core 构建与来源
///release，随身份摘要进入原计划。
class ComponentConformanceReceiverEnvironment {
  final String isolatedCoreBuildId;
  final String sourceArtifactDigest;
  final String sourceManifestDigest;
  final String sourceReleaseId;

  ComponentConformanceReceiverEnvironment({
    required this.isolatedCoreBuildId,
    required this.sourceArtifactDigest,
    required this.sourceManifestDigest,
    required this.sourceReleaseId,
  });

  factory ComponentConformanceReceiverEnvironment.fromJson(
    Map<String, dynamic> json,
  ) => ComponentConformanceReceiverEnvironment(
    isolatedCoreBuildId: json["isolatedCoreBuildId"],
    sourceArtifactDigest: json["sourceArtifactDigest"],
    sourceManifestDigest: json["sourceManifestDigest"],
    sourceReleaseId: json["sourceReleaseId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "isolatedCoreBuildId": isolatedCoreBuildId,
    "sourceArtifactDigest": sourceArtifactDigest,
    "sourceManifestDigest": sourceManifestDigest,
    "sourceReleaseId": sourceReleaseId,
  });
}

class ComponentConformanceStep {
  ///DD-124：仅 V2 契约步骤。Core 冻结时已代入 PRECONDITION 的 fixture 值，这里只保留 CAPTURE 的代入位置声明（不含值）；运行时 Core
  ///在 ActionToken 签名前代入请求、在比对前代入期望。权限拒绝重放保留同一 INPUT 声明。接收方向步骤只保留本步自身捕获的 INPUT 声明：请求不被代入，Core
  ///以它们比对隔离 Core 实际产生的接收方准入。
  final List<CapabilityVectorBinding>? bindings;

  ///DD-124：仅 V2 契约步骤。本步 SUCCEEDED 且原生终态证据完整时由 Core 从实际应答的封闭槽位取值，写入本步观察证据。
  final List<CapabilityVectorCapture>? captures;
  final String caseKey;

  ///只由 Core 从该 release implements 的 ACTIVE 契约步骤固定。存在时 expectedResponseJson 为该能力的业务结果，不是
  ///native 任务元数据。
  final String? contractKey;

  ///Adapter 为实际 HTTP 状态；MCP 原生结果固定 0，不以伪造 HTTP 状态证明协议成功。
  final int expectedHttpStatus;
  final ComponentConformanceStepExpectedMcpResultKind? expectedMcpResultKind;
  final String expectedResponseJson;
  final String idempotencyKey;

  ///仅接收方向步骤（V1 的 NATIVE_INTERNAL/NATIVE 能力步骤，或 V2 RECEIVER case 的步骤），由 Core
  ///保留已代入前置值的原能力向量输入；SOURCE AE 与 batch 必须以同批真实入站观察替换，不是预造授权。
  final String? nativeReceiverInputJson;
  final ComponentConformanceOperation operation;
  final String? referenceAssetId;
  final String? referenceFromStepKey;
  final String? referenceResourceId;
  final String requestJson;
  final String stepKey;

  ComponentConformanceStep({
    this.bindings,
    this.captures,
    required this.caseKey,
    this.contractKey,
    required this.expectedHttpStatus,
    this.expectedMcpResultKind,
    required this.expectedResponseJson,
    required this.idempotencyKey,
    this.nativeReceiverInputJson,
    required this.operation,
    this.referenceAssetId,
    this.referenceFromStepKey,
    this.referenceResourceId,
    required this.requestJson,
    required this.stepKey,
  });

  factory ComponentConformanceStep.fromJson(
    Map<String, dynamic> json,
  ) => ComponentConformanceStep(
    bindings: json["bindings"] == null
        ? null
        : List<CapabilityVectorBinding>.from(
            json["bindings"]!.map((x) => CapabilityVectorBinding.fromJson(x)),
          ),
    captures: json["captures"] == null
        ? null
        : List<CapabilityVectorCapture>.from(
            json["captures"]!.map((x) => CapabilityVectorCapture.fromJson(x)),
          ),
    caseKey: json["caseKey"],
    contractKey: json["contractKey"],
    expectedHttpStatus: json["expectedHttpStatus"],
    expectedMcpResultKind: json["expectedMcpResultKind"] == null
        ? null
        : componentConformanceStepExpectedMcpResultKindValues
              .map[json["expectedMcpResultKind"]]!,
    expectedResponseJson: json["expectedResponseJson"],
    idempotencyKey: json["idempotencyKey"],
    nativeReceiverInputJson: json["nativeReceiverInputJson"],
    operation: componentConformanceOperationValues.map[json["operation"]]!,
    referenceAssetId: json["referenceAssetId"],
    referenceFromStepKey: json["referenceFromStepKey"],
    referenceResourceId: json["referenceResourceId"],
    requestJson: json["requestJson"],
    stepKey: json["stepKey"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindings": bindings == null
        ? null
        : List<dynamic>.from(bindings!.map((x) => x.toJson())),
    "captures": captures == null
        ? null
        : List<dynamic>.from(captures!.map((x) => x.toJson())),
    "caseKey": caseKey,
    "contractKey": contractKey,
    "expectedHttpStatus": expectedHttpStatus,
    "expectedMcpResultKind": componentConformanceStepExpectedMcpResultKindValues
        .reverse[expectedMcpResultKind],
    "expectedResponseJson": expectedResponseJson,
    "idempotencyKey": idempotencyKey,
    "nativeReceiverInputJson": nativeReceiverInputJson,
    "operation": componentConformanceOperationValues.reverse[operation],
    "referenceAssetId": referenceAssetId,
    "referenceFromStepKey": referenceFromStepKey,
    "referenceResourceId": referenceResourceId,
    "requestJson": requestJson,
    "stepKey": stepKey,
  });
}

///DD-124(2): one substitution position of a V2 step. pointer is an RFC 6901 JSON Pointer
///into the step input (INPUT) or expected output (EXPECTED); the literal there must be
///exactly the reserved placeholder {{SOURCE:key}}. INPUT may bind PRECONDITION or CAPTURE;
///EXPECTED may bind CAPTURE or a PRECONDITION already sent as INPUT in this case. In a
///RECEIVER case INPUT may also bind the step's own captures: Core compares that input with
///the admission the isolated Core actually produced whenever the step's evidence has reads.
///The plan digest fixes the declaration, never the value.
class CapabilityVectorBinding {
  final String key;
  final String pointer;
  final CapabilityVectorSide side;
  final CapabilityVectorBindingSource source;

  CapabilityVectorBinding({
    required this.key,
    required this.pointer,
    required this.side,
    required this.source,
  });

  factory CapabilityVectorBinding.fromJson(Map<String, dynamic> json) =>
      CapabilityVectorBinding(
        key: json["key"],
        pointer: json["pointer"],
        side: capabilityVectorSideValues.map[json["side"]]!,
        source: capabilityVectorBindingSourceValues.map[json["source"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "key": key,
    "pointer": pointer,
    "side": capabilityVectorSideValues.reverse[side],
    "source": capabilityVectorBindingSourceValues.reverse[source],
  });
}

///DD-124(2): the vector document a JSON Pointer addresses — the step input or its expected
///output.
enum CapabilityVectorSide { EXPECTED, INPUT }

final capabilityVectorSideValues = EnumValues({
  "EXPECTED": CapabilityVectorSide.EXPECTED,
  "INPUT": CapabilityVectorSide.INPUT,
});

///DD-124(1)(2): the two non-literal value sources of a V2 conformance vector. Every other
///value is LITERAL; there is no third binding source.
enum CapabilityVectorBindingSource { CAPTURE, PRECONDITION }

final capabilityVectorBindingSourceValues = EnumValues({
  "CAPTURE": CapabilityVectorBindingSource.CAPTURE,
  "PRECONDITION": CapabilityVectorBindingSource.PRECONDITION,
});

///DD-124(1)(2): a value this step's actual SUCCEEDED observation produces for later steps
///of the same case. key is unique in the case and must be consumed at least once. pointer
///is present only for GENERATED_REF and must equal an EXPECTED generatedRefs entry of the
///step's contract key; in a RECEIVER case it equals an INPUT entry and reads the admission
///the isolated Core produced. ACTION_EXECUTION_ID and OPERATION_ID exist only in RECEIVER
///cases; a step of a RECEIVER case takes them and CONTENT_REFERENCE_* from its own read and
///the receiver's read_receipt of that admission, so a capturing step's evidence has reads.
class CapabilityVectorCapture {
  final String key;
  final String? pointer;
  final CapabilityVectorCaptureSlot slot;

  CapabilityVectorCapture({
    required this.key,
    this.pointer,
    required this.slot,
  });

  factory CapabilityVectorCapture.fromJson(Map<String, dynamic> json) =>
      CapabilityVectorCapture(
        key: json["key"],
        pointer: json["pointer"],
        slot: capabilityVectorCaptureSlotValues.map[json["slot"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "key": key,
    "pointer": pointer,
    "slot": capabilityVectorCaptureSlotValues.reverse[slot],
  });
}

///DD-124(1): the closed observation slots a CAPTURE may take. CONTENT_REFERENCE_* read the
///adapter's typed ContentReference; GENERATED_REF reads an output field listed in the
///vector document's generatedRefs; ACTION_EXECUTION_ID/OPERATION_ID are the SOURCE read
///ActionExecution and Operation the isolated Core generated for a step of a RECEIVER case
///in this run (never present in the plan or fixture).
enum CapabilityVectorCaptureSlot {
  ACTION_EXECUTION_ID,
  CONTENT_REFERENCE_NATIVE_OBJECT_REF,
  CONTENT_REFERENCE_NATIVE_REVISION,
  GENERATED_REF,
  OPERATION_ID,
}

final capabilityVectorCaptureSlotValues = EnumValues({
  "ACTION_EXECUTION_ID": CapabilityVectorCaptureSlot.ACTION_EXECUTION_ID,
  "CONTENT_REFERENCE_NATIVE_OBJECT_REF":
      CapabilityVectorCaptureSlot.CONTENT_REFERENCE_NATIVE_OBJECT_REF,
  "CONTENT_REFERENCE_NATIVE_REVISION":
      CapabilityVectorCaptureSlot.CONTENT_REFERENCE_NATIVE_REVISION,
  "GENERATED_REF": CapabilityVectorCaptureSlot.GENERATED_REF,
  "OPERATION_ID": CapabilityVectorCaptureSlot.OPERATION_ID,
});

enum ComponentConformanceStepExpectedMcpResultKind { ERROR, RESULT }

final componentConformanceStepExpectedMcpResultKindValues = EnumValues({
  "ERROR": ComponentConformanceStepExpectedMcpResultKind.ERROR,
  "RESULT": ComponentConformanceStepExpectedMcpResultKind.RESULT,
});

///Read-only member directory snapshot for an embedded component (.design/07 §4.7.4,
///DD-133(4)): every ACTIVE HUMAN member in the native page entry binding's scope with Kailo
///display name, avatar URL, Tenant role and ACTIVE Workspace memberships. A full snapshot,
///never paged: a person absent from it is removed from the component organisation.
///directoryVersion is the SHA-256 (hex) of the canonical JSON of every other field. No
///email, Buzz key, session or credential.
class ComponentMemberDirectory {
  final String bindingId;

  ///Lowercase hex SHA-256 of the canonical JSON of this snapshot without directoryVersion;
  ///unchanged content keeps the same version.
  final String directoryVersion;
  final List<ComponentDirectoryMember> members;
  final ComponentDirectoryTenant tenant;

  ///Every ACTIVE Workspace in the binding scope (only the binding's own Workspace when it has
  ///one).
  final List<ComponentDirectoryWorkspace> workspaces;

  ComponentMemberDirectory({
    required this.bindingId,
    required this.directoryVersion,
    required this.members,
    required this.tenant,
    required this.workspaces,
  });

  factory ComponentMemberDirectory.fromJson(Map<String, dynamic> json) =>
      ComponentMemberDirectory(
        bindingId: json["bindingId"],
        directoryVersion: json["directoryVersion"],
        members: List<ComponentDirectoryMember>.from(
          json["members"].map((x) => ComponentDirectoryMember.fromJson(x)),
        ),
        tenant: ComponentDirectoryTenant.fromJson(json["tenant"]),
        workspaces: List<ComponentDirectoryWorkspace>.from(
          json["workspaces"].map(
            (x) => ComponentDirectoryWorkspace.fromJson(x),
          ),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "directoryVersion": directoryVersion,
    "members": List<dynamic>.from(members.map((x) => x.toJson())),
    "tenant": tenant.toJson(),
    "workspaces": List<dynamic>.from(workspaces.map((x) => x.toJson())),
  });
}

class ComponentDirectoryMember {
  ///Kailo display name: the member's SERVER HUMAN kind:0 display_name (else name), else the
  ///HumanIdentity display name.
  final String displayName;

  ///One entry per ACTIVE external identity; the component keys its account on issuer +
  ///subject.
  final List<ComponentDirectoryIdentity> identities;
  final String principalId;
  final ComponentDirectoryRole tenantRole;
  final List<ComponentDirectoryMembership> workspaces;

  ComponentDirectoryMember({
    required this.displayName,
    required this.identities,
    required this.principalId,
    required this.tenantRole,
    required this.workspaces,
  });

  factory ComponentDirectoryMember.fromJson(Map<String, dynamic> json) =>
      ComponentDirectoryMember(
        displayName: json["displayName"],
        identities: List<ComponentDirectoryIdentity>.from(
          json["identities"].map((x) => ComponentDirectoryIdentity.fromJson(x)),
        ),
        principalId: json["principalId"],
        tenantRole: componentDirectoryRoleValues.map[json["tenantRole"]]!,
        workspaces: List<ComponentDirectoryMembership>.from(
          json["workspaces"].map(
            (x) => ComponentDirectoryMembership.fromJson(x),
          ),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "displayName": displayName,
    "identities": List<dynamic>.from(identities.map((x) => x.toJson())),
    "principalId": principalId,
    "tenantRole": componentDirectoryRoleValues.reverse[tenantRole],
    "workspaces": List<dynamic>.from(workspaces.map((x) => x.toJson())),
  });
}

class ComponentDirectoryIdentity {
  final String issuer;

  ///<PUBLIC_ORIGIN>/api/v1/identity/avatars/<subject>, the same value as the IdP picture
  ///claim.
  final String picture;
  final String subject;

  ComponentDirectoryIdentity({
    required this.issuer,
    required this.picture,
    required this.subject,
  });

  factory ComponentDirectoryIdentity.fromJson(Map<String, dynamic> json) =>
      ComponentDirectoryIdentity(
        issuer: json["issuer"],
        picture: json["picture"],
        subject: json["subject"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"issuer": issuer, "picture": picture, "subject": subject});
}

///成员目录中的 Kailo 角色（.design/07 §4.7.4、DD-133(4)）：SpiceDB 对 Tenant 或 Workspace 有 `manage` 为
///ADMIN，否则 MEMBER。只供组件派生自身角色，不授予 Kailo 侧任何权限。
enum ComponentDirectoryRole { ADMIN, MEMBER }

final componentDirectoryRoleValues = EnumValues({
  "ADMIN": ComponentDirectoryRole.ADMIN,
  "MEMBER": ComponentDirectoryRole.MEMBER,
});

class ComponentDirectoryMembership {
  final ComponentDirectoryRole role;
  final String workspaceId;

  ComponentDirectoryMembership({required this.role, required this.workspaceId});

  factory ComponentDirectoryMembership.fromJson(Map<String, dynamic> json) =>
      ComponentDirectoryMembership(
        role: componentDirectoryRoleValues.map[json["role"]]!,
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "role": componentDirectoryRoleValues.reverse[role],
    "workspaceId": workspaceId,
  });
}

class ComponentDirectoryTenant {
  final String name;
  final String tenantId;

  ComponentDirectoryTenant({required this.name, required this.tenantId});

  factory ComponentDirectoryTenant.fromJson(Map<String, dynamic> json) =>
      ComponentDirectoryTenant(name: json["name"], tenantId: json["tenantId"]);

  Map<String, dynamic> toJson() =>
      _stripNulls({"name": name, "tenantId": tenantId});
}

class ComponentDirectoryWorkspace {
  final String name;
  final String workspaceId;

  ComponentDirectoryWorkspace({required this.name, required this.workspaceId});

  factory ComponentDirectoryWorkspace.fromJson(Map<String, dynamic> json) =>
      ComponentDirectoryWorkspace(
        name: json["name"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"name": name, "workspaceId": workspaceId});
}

///DD-138(4)、07 §4.8.3：组件以其成员目录 client 的 client-credentials 令牌向 Core 服务监听面 POST
////service/v1/component-notifications/bindings/{bindingId}/notifications 投递的一条通知。不建立
///ActionExecution、不授予权限；未知字段整体拒绝。
class ComponentNotificationDelivery {
  ///触发者；须在同一目录范围内且不是接收人。
  final ComponentPersonRef? actor;
  final ComponentNotificationCategory category;

  ///1–128 个字母、数字、. _ : -，在该 binding 内唯一；同键同内容返回首次结果，同键异内容 409。
  final String idempotencyKey;

  ///事件发生时刻（RFC3339），不晚于 Core 当前时刻 5 分钟；缺省取接收时刻。
  final String? occurredAt;

  ///组件页面 origin 内的相对路径：1–1024 字符，以单个 / 开头，无反斜杠、空白与控制字符，无凭据类查询参数。
  final String path;
  final ComponentPersonRef recipient;

  ///每种语言 1–280 字符，不含控制字符。
  final ComponentText? summary;

  ///每种语言 1–120 字符，不含控制字符。
  final ComponentText title;

  ComponentNotificationDelivery({
    this.actor,
    required this.category,
    required this.idempotencyKey,
    this.occurredAt,
    required this.path,
    required this.recipient,
    this.summary,
    required this.title,
  });

  factory ComponentNotificationDelivery.fromJson(Map<String, dynamic> json) =>
      ComponentNotificationDelivery(
        actor: json["actor"] == null
            ? null
            : ComponentPersonRef.fromJson(json["actor"]),
        category: componentNotificationCategoryValues.map[json["category"]]!,
        idempotencyKey: json["idempotencyKey"],
        occurredAt: json["occurredAt"],
        path: json["path"],
        recipient: ComponentPersonRef.fromJson(json["recipient"]),
        summary: json["summary"] == null
            ? null
            : ComponentText.fromJson(json["summary"]),
        title: ComponentText.fromJson(json["title"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actor": actor?.toJson(),
    "category": componentNotificationCategoryValues.reverse[category],
    "idempotencyKey": idempotencyKey,
    "occurredAt": occurredAt,
    "path": path,
    "recipient": recipient.toJson(),
    "summary": summary?.toJson(),
    "title": title.toJson(),
  });
}

///触发者；须在同一目录范围内且不是接收人。
///
///组件以 OIDC issuer + subject 指称 Kailo 成员（与 07 §4.7.4 成员目录 identities[] 同值）；Core 只在该 binding
///当前目录范围内解析。
class ComponentPersonRef {
  final String issuer;
  final String subject;

  ComponentPersonRef({required this.issuer, required this.subject});

  factory ComponentPersonRef.fromJson(Map<String, dynamic> json) =>
      ComponentPersonRef(issuer: json["issuer"], subject: json["subject"]);

  Map<String, dynamic> toJson() =>
      _stripNulls({"issuer": issuer, "subject": subject});
}

///DD-138(4)、07 §4.8.3：组件投递到 Kailo 收件箱的通知类别（封闭枚举）。SHARED 分享给你；MENTIONED 提及你；COMMENTED
///评论了你的对象；ACCESS_REQUESTED 访问申请（进入「需要处理」）；TASK_COMPLETED 任务完成；CONTENT_UPDATED 你关注的内容有更新。
enum ComponentNotificationCategory {
  ACCESS_REQUESTED,
  COMMENTED,
  CONTENT_UPDATED,
  MENTIONED,
  SHARED,
  TASK_COMPLETED,
}

final componentNotificationCategoryValues = EnumValues({
  "ACCESS_REQUESTED": ComponentNotificationCategory.ACCESS_REQUESTED,
  "COMMENTED": ComponentNotificationCategory.COMMENTED,
  "CONTENT_UPDATED": ComponentNotificationCategory.CONTENT_UPDATED,
  "MENTIONED": ComponentNotificationCategory.MENTIONED,
  "SHARED": ComponentNotificationCategory.SHARED,
  "TASK_COMPLETED": ComponentNotificationCategory.TASK_COMPLETED,
});

///每种语言 1–280 字符，不含控制字符。
///
///组件向 Kailo 提供的中英文文案（键恰为 ZH_CN、EN）。长度与字符规则由 Core 按使用处校验。
///
///每种语言 1–120 字符，不含控制字符。
class ComponentText {
  final String en;
  final String zhCn;

  ComponentText({required this.en, required this.zhCn});

  factory ComponentText.fromJson(Map<String, dynamic> json) =>
      ComponentText(en: json["EN"], zhCn: json["ZH_CN"]);

  Map<String, dynamic> toJson() => _stripNulls({"EN": en, "ZH_CN": zhCn});
}

///DD-138(4)：GET /api/v1/inbox/component-notifications 的一页，按 receivedAt 倒序；nextCursor
///缺省表示没有更多。
class ComponentNotificationPage {
  final List<ComponentNotificationView> items;
  final String? nextCursor;

  ///当前可见范围内本人未读条目总数（不受分页影响）。
  final int unreadCount;

  ComponentNotificationPage({
    required this.items,
    this.nextCursor,
    required this.unreadCount,
  });

  factory ComponentNotificationPage.fromJson(Map<String, dynamic> json) =>
      ComponentNotificationPage(
        items: List<ComponentNotificationView>.from(
          json["items"].map((x) => ComponentNotificationView.fromJson(x)),
        ),
        nextCursor: json["nextCursor"],
        unreadCount: json["unreadCount"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "items": List<dynamic>.from(items.map((x) => x.toJson())),
    "nextCursor": nextCursor,
    "unreadCount": unreadCount,
  });
}

///DD-138(4)、03 ComponentNotification：当前会话 Principal
///收件箱中的一条组件通知。只含呈现类别，不含组件名、component_type_key 或 binding 配置；bindingId 只用于在 Kailo
///内容区打开该原生页面入口。
class ComponentNotificationView {
  final String? actorDisplayName;

  ///07 §4.7.3 Tenant 头像地址；缺省时客户端显示首字母。
  final String? actorPicture;
  final String? actorPrincipalId;
  final String bindingId;
  final ComponentNotificationCategory category;
  final NativePageCategory? nativePageCategory;
  final String notificationId;
  final String occurredAt;
  final String path;
  final String? readAt;
  final String receivedAt;
  final ComponentText? summary;
  final ComponentText title;
  final String? workspaceId;

  ComponentNotificationView({
    this.actorDisplayName,
    this.actorPicture,
    this.actorPrincipalId,
    required this.bindingId,
    required this.category,
    this.nativePageCategory,
    required this.notificationId,
    required this.occurredAt,
    required this.path,
    this.readAt,
    required this.receivedAt,
    this.summary,
    required this.title,
    this.workspaceId,
  });

  factory ComponentNotificationView.fromJson(Map<String, dynamic> json) =>
      ComponentNotificationView(
        actorDisplayName: json["actorDisplayName"],
        actorPicture: json["actorPicture"],
        actorPrincipalId: json["actorPrincipalId"],
        bindingId: json["bindingId"],
        category: componentNotificationCategoryValues.map[json["category"]]!,
        nativePageCategory: json["nativePageCategory"] == null
            ? null
            : nativePageCategoryValues.map[json["nativePageCategory"]]!,
        notificationId: json["notificationId"],
        occurredAt: json["occurredAt"],
        path: json["path"],
        readAt: json["readAt"],
        receivedAt: json["receivedAt"],
        summary: json["summary"] == null
            ? null
            : ComponentText.fromJson(json["summary"]),
        title: ComponentText.fromJson(json["title"]),
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actorDisplayName": actorDisplayName,
    "actorPicture": actorPicture,
    "actorPrincipalId": actorPrincipalId,
    "bindingId": bindingId,
    "category": componentNotificationCategoryValues.reverse[category],
    "nativePageCategory": nativePageCategoryValues.reverse[nativePageCategory],
    "notificationId": notificationId,
    "occurredAt": occurredAt,
    "path": path,
    "readAt": readAt,
    "receivedAt": receivedAt,
    "summary": summary?.toJson(),
    "title": title.toJson(),
    "workspaceId": workspaceId,
  });
}

///DD-138(4)：POST /api/v1/inbox/component-notifications/read。接收人把本人的条目标记为已读（个人状态，不建立
///ActionExecution）；1–100 个 ID，非本人或不可见的 ID 被忽略。
class ComponentNotificationReadRequest {
  final List<String> notificationIds;

  ComponentNotificationReadRequest({required this.notificationIds});

  factory ComponentNotificationReadRequest.fromJson(
    Map<String, dynamic> json,
  ) => ComponentNotificationReadRequest(
    notificationIds: List<String>.from(json["notificationIds"].map((x) => x)),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "notificationIds": List<dynamic>.from(notificationIds.map((x) => x)),
  });
}

///DD-138(4)：投递回执。新建 201、同键同内容重复 200（duplicate=true）。
class ComponentNotificationReceipt {
  final bool duplicate;
  final String notificationId;

  ComponentNotificationReceipt({
    required this.duplicate,
    required this.notificationId,
  });

  factory ComponentNotificationReceipt.fromJson(Map<String, dynamic> json) =>
      ComponentNotificationReceipt(
        duplicate: json["duplicate"],
        notificationId: json["notificationId"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"duplicate": duplicate, "notificationId": notificationId});
}

///原受信Worker在原审批后的COMPONENT_RELEASE Activity报告实际自身能力。Core自行读取自身与当前Web事实，并重新核验原release套件和审批。
class ComponentReleaseApprovalReport {
  final String runId;
  final ComponentReleaseApprovalTarget target;
  final PlatformBuildInfo workerBuild;

  ComponentReleaseApprovalReport({
    required this.runId,
    required this.target,
    required this.workerBuild,
  });

  factory ComponentReleaseApprovalReport.fromJson(Map<String, dynamic> json) =>
      ComponentReleaseApprovalReport(
        runId: json["runId"],
        target: ComponentReleaseApprovalTarget.fromJson(json["target"]),
        workerBuild: PlatformBuildInfo.fromJson(json["workerBuild"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "runId": runId,
    "target": target.toJson(),
    "workerBuild": workerBuild.toJson(),
  });
}

///原ComponentTaskWorkflow的组件批准目标，只引用原准入与不可变release，不携带用户声明的兼容结论。
class ComponentReleaseApprovalTarget {
  final String actionExecutionId;
  final String componentReleaseId;
  final String workflowId;

  ComponentReleaseApprovalTarget({
    required this.actionExecutionId,
    required this.componentReleaseId,
    required this.workflowId,
  });

  factory ComponentReleaseApprovalTarget.fromJson(Map<String, dynamic> json) =>
      ComponentReleaseApprovalTarget(
        actionExecutionId: json["actionExecutionId"],
        componentReleaseId: json["componentReleaseId"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "componentReleaseId": componentReleaseId,
    "workflowId": workflowId,
  });
}

///设计03的当前已部署主体能力事实，由原受信服务/当前Web产物观察产生，不接受管理表单声明。
class PlatformBuildInfo {
  final List<String> adapterProtocolVersions;
  final String buildId;
  final List<String>? connectorKinds;
  final List<String> driverRegistryKeys;
  final String hostApiVersion;
  final List<String>? mcpProtocolVersions;
  final List<PlatformBuildInfoPlatformPortKeysItem> platformPortKeys;
  final String reportedAt;
  final PlatformBuildInfoSubject subject;

  PlatformBuildInfo({
    required this.adapterProtocolVersions,
    required this.buildId,
    this.connectorKinds,
    required this.driverRegistryKeys,
    required this.hostApiVersion,
    this.mcpProtocolVersions,
    required this.platformPortKeys,
    required this.reportedAt,
    required this.subject,
  });

  factory PlatformBuildInfo.fromJson(Map<String, dynamic> json) =>
      PlatformBuildInfo(
        adapterProtocolVersions: List<String>.from(
          json["adapterProtocolVersions"].map((x) => x),
        ),
        buildId: json["buildId"],
        connectorKinds: json["connectorKinds"] == null
            ? null
            : List<String>.from(json["connectorKinds"]!.map((x) => x)),
        driverRegistryKeys: List<String>.from(
          json["driverRegistryKeys"].map((x) => x),
        ),
        hostApiVersion: json["hostApiVersion"],
        mcpProtocolVersions: json["mcpProtocolVersions"] == null
            ? null
            : List<String>.from(json["mcpProtocolVersions"]!.map((x) => x)),
        platformPortKeys: List<PlatformBuildInfoPlatformPortKeysItem>.from(
          json["platformPortKeys"].map(
            (x) => platformBuildInfoPlatformPortKeysItemValues.map[x]!,
          ),
        ),
        reportedAt: json["reportedAt"],
        subject: platformBuildInfoSubjectValues.map[json["subject"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "adapterProtocolVersions": List<dynamic>.from(
      adapterProtocolVersions.map((x) => x),
    ),
    "buildId": buildId,
    "connectorKinds": connectorKinds == null
        ? null
        : List<dynamic>.from(connectorKinds!.map((x) => x)),
    "driverRegistryKeys": List<dynamic>.from(driverRegistryKeys.map((x) => x)),
    "hostApiVersion": hostApiVersion,
    "mcpProtocolVersions": mcpProtocolVersions == null
        ? null
        : List<dynamic>.from(mcpProtocolVersions!.map((x) => x)),
    "platformPortKeys": List<dynamic>.from(
      platformPortKeys.map(
        (x) => platformBuildInfoPlatformPortKeysItemValues.reverse[x],
      ),
    ),
    "reportedAt": reportedAt,
    "subject": platformBuildInfoSubjectValues.reverse[subject],
  });
}

enum PlatformBuildInfoPlatformPortKeysItem {
  AI_GATEWAY,
  APPROVAL_WORKFLOW,
  AUTHORIZATION,
  COLLABORATION_RELAY,
  CORE_INTERNAL,
  IDENTITY_EDGE,
  METERING_BILLING,
  SECRET_STORE,
}

final platformBuildInfoPlatformPortKeysItemValues = EnumValues({
  "AI_GATEWAY": PlatformBuildInfoPlatformPortKeysItem.AI_GATEWAY,
  "APPROVAL_WORKFLOW": PlatformBuildInfoPlatformPortKeysItem.APPROVAL_WORKFLOW,
  "AUTHORIZATION": PlatformBuildInfoPlatformPortKeysItem.AUTHORIZATION,
  "COLLABORATION_RELAY":
      PlatformBuildInfoPlatformPortKeysItem.COLLABORATION_RELAY,
  "CORE_INTERNAL": PlatformBuildInfoPlatformPortKeysItem.CORE_INTERNAL,
  "IDENTITY_EDGE": PlatformBuildInfoPlatformPortKeysItem.IDENTITY_EDGE,
  "METERING_BILLING": PlatformBuildInfoPlatformPortKeysItem.METERING_BILLING,
  "SECRET_STORE": PlatformBuildInfoPlatformPortKeysItem.SECRET_STORE,
});

enum PlatformBuildInfoSubject { BUZZ_WEB, CORE, WORKER }

final platformBuildInfoSubjectValues = EnumValues({
  "BUZZ_WEB": PlatformBuildInfoSubject.BUZZ_WEB,
  "CORE": PlatformBuildInfoSubject.CORE,
  "WORKER": PlatformBuildInfoSubject.WORKER,
});

///受Catalog管理权限保护的已登记release元数据，正文与套件令牌不外露；REGISTERED不等于APPROVED或binding可用。
class ComponentReleasePage {
  final bool? canApprove;
  final bool canRegister;
  final int? nextOffset;
  final List<ComponentReleaseView> releases;

  ComponentReleasePage({
    this.canApprove,
    required this.canRegister,
    this.nextOffset,
    required this.releases,
  });

  factory ComponentReleasePage.fromJson(Map<String, dynamic> json) =>
      ComponentReleasePage(
        canApprove: json["canApprove"],
        canRegister: json["canRegister"],
        nextOffset: json["nextOffset"],
        releases: List<ComponentReleaseView>.from(
          json["releases"].map((x) => ComponentReleaseView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "canApprove": canApprove,
    "canRegister": canRegister,
    "nextOffset": nextOffset,
    "releases": List<dynamic>.from(releases.map((x) => x.toJson())),
  });
}

class ComponentReleaseView {
  final String? approvedByActionExecutionId;
  final String artifactDigest;
  final String componentReleaseId;
  final String componentTypeKey;
  final String manifestDigest;
  final String operationId;
  final String registeredByActionExecutionId;
  final ComponentReleaseStatus status;
  final String suiteDigest;
  final String version;
  final String workflowId;

  ComponentReleaseView({
    this.approvedByActionExecutionId,
    required this.artifactDigest,
    required this.componentReleaseId,
    required this.componentTypeKey,
    required this.manifestDigest,
    required this.operationId,
    required this.registeredByActionExecutionId,
    required this.status,
    required this.suiteDigest,
    required this.version,
    required this.workflowId,
  });

  factory ComponentReleaseView.fromJson(Map<String, dynamic> json) =>
      ComponentReleaseView(
        approvedByActionExecutionId: json["approvedByActionExecutionId"],
        artifactDigest: json["artifactDigest"],
        componentReleaseId: json["componentReleaseId"],
        componentTypeKey: json["componentTypeKey"],
        manifestDigest: json["manifestDigest"],
        operationId: json["operationId"],
        registeredByActionExecutionId: json["registeredByActionExecutionId"],
        status: componentReleaseStatusValues.map[json["status"]]!,
        suiteDigest: json["suiteDigest"],
        version: json["version"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "approvedByActionExecutionId": approvedByActionExecutionId,
    "artifactDigest": artifactDigest,
    "componentReleaseId": componentReleaseId,
    "componentTypeKey": componentTypeKey,
    "manifestDigest": manifestDigest,
    "operationId": operationId,
    "registeredByActionExecutionId": registeredByActionExecutionId,
    "status": componentReleaseStatusValues.reverse[status],
    "suiteDigest": suiteDigest,
    "version": version,
    "workflowId": workflowId,
  });
}

enum ComponentReleaseStatus { APPROVED, REGISTERED, REJECTED, REVOKED }

final componentReleaseStatusValues = EnumValues({
  "APPROVED": ComponentReleaseStatus.APPROVED,
  "REGISTERED": ComponentReleaseStatus.REGISTERED,
  "REJECTED": ComponentReleaseStatus.REJECTED,
  "REVOKED": ComponentReleaseStatus.REVOKED,
});

///原准入同事务登记后的不可变引用；不是组件激活或审批回执。
class ComponentReleaseReceipt {
  final String actionExecutionId;
  final String componentReleaseId;
  final String planDigest;
  final ComponentReleaseStatus status;

  ComponentReleaseReceipt({
    required this.actionExecutionId,
    required this.componentReleaseId,
    required this.planDigest,
    required this.status,
  });

  factory ComponentReleaseReceipt.fromJson(Map<String, dynamic> json) =>
      ComponentReleaseReceipt(
        actionExecutionId: json["actionExecutionId"],
        componentReleaseId: json["componentReleaseId"],
        planDigest: json["planDigest"],
        status: componentReleaseStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "componentReleaseId": componentReleaseId,
    "planDigest": planDigest,
    "status": componentReleaseStatusValues.reverse[status],
  });
}

///DD-138(5)、07 §4.8.4：组件内容搜索结果。每项已解析到可在 Kailo 内容区打开的原生页面入口（bindingId 为该呈现类别生效的入口，不是 adapter
///binding）；sources 列出每个呈现类别来源的状态。
class ComponentSearchPage {
  final List<ComponentSearchResult> results;
  final List<ComponentSearchSource> sources;

  ComponentSearchPage({required this.results, required this.sources});

  factory ComponentSearchPage.fromJson(Map<String, dynamic> json) =>
      ComponentSearchPage(
        results: List<ComponentSearchResult>.from(
          json["results"].map((x) => ComponentSearchResult.fromJson(x)),
        ),
        sources: List<ComponentSearchSource>.from(
          json["sources"].map((x) => ComponentSearchSource.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "results": List<dynamic>.from(results.map((x) => x.toJson())),
    "sources": List<dynamic>.from(sources.map((x) => x.toJson())),
  });
}

class ComponentSearchResult {
  final String bindingId;
  final ComponentSearchResultKind kind;
  final NativePageCategory nativePageCategory;
  final String path;
  final String? summary;
  final String title;
  final String? updatedAt;

  ComponentSearchResult({
    required this.bindingId,
    required this.kind,
    required this.nativePageCategory,
    required this.path,
    this.summary,
    required this.title,
    this.updatedAt,
  });

  factory ComponentSearchResult.fromJson(Map<String, dynamic> json) =>
      ComponentSearchResult(
        bindingId: json["bindingId"],
        kind: componentSearchResultKindValues.map[json["kind"]]!,
        nativePageCategory:
            nativePageCategoryValues.map[json["nativePageCategory"]]!,
        path: json["path"],
        summary: json["summary"],
        title: json["title"],
        updatedAt: json["updatedAt"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "kind": componentSearchResultKindValues.reverse[kind],
    "nativePageCategory": nativePageCategoryValues.reverse[nativePageCategory],
    "path": path,
    "summary": summary,
    "title": title,
    "updatedAt": updatedAt,
  });
}

class ComponentSearchSource {
  final NativePageCategory nativePageCategory;
  final ComponentSearchSourceState state;

  ComponentSearchSource({
    required this.nativePageCategory,
    required this.state,
  });

  factory ComponentSearchSource.fromJson(Map<String, dynamic> json) =>
      ComponentSearchSource(
        nativePageCategory:
            nativePageCategoryValues.map[json["nativePageCategory"]]!,
        state: componentSearchSourceStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nativePageCategory": nativePageCategoryValues.reverse[nativePageCategory],
    "state": componentSearchSourceStateValues.reverse[state],
  });
}

///DD-138(5)：一次「搜索全部」中某个组件来源的结果状态。ANSWERED 表示该来源已按合同回应（可为零条）；UNAVAILABLE
///表示该来源超时、不可达或回应不合合同，其结果整体未采信。
enum ComponentSearchSourceState { ANSWERED, UNAVAILABLE }

final componentSearchSourceStateValues = EnumValues({
  "ANSWERED": ComponentSearchSourceState.ANSWERED,
  "UNAVAILABLE": ComponentSearchSourceState.UNAVAILABLE,
});

///DD-138(5)、07 §4.8.4：POST /api/v1/search/components。q 去首尾空白后 1–200 字符；limit 为每个来源的上限
///1–20（缺省 8）；locale 为 ZH_CN 或 EN（缺省 ZH_CN）。
class ComponentSearchQuery {
  final int? limit;
  final String? locale;
  final String q;

  ComponentSearchQuery({this.limit, this.locale, required this.q});

  factory ComponentSearchQuery.fromJson(Map<String, dynamic> json) =>
      ComponentSearchQuery(
        limit: json["limit"],
        locale: json["locale"],
        q: json["q"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"limit": limit, "locale": locale, "q": q});
}

class ConversationPage {
  final List<ConversationView> items;
  final String? nextCursor;

  ConversationPage({required this.items, this.nextCursor});

  factory ConversationPage.fromJson(Map<String, dynamic> json) =>
      ConversationPage(
        items: List<ConversationView>.from(
          json["items"].map((x) => ConversationView.fromJson(x)),
        ),
        nextCursor: json["nextCursor"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "items": List<dynamic>.from(items.map((x) => x.toJson())),
    "nextCursor": nextCursor,
  });
}

///已认证参与者可见的原 Relay 私聊引用，不包含消息正文。
class ConversationView {
  final String channelId;
  final String id;
  final String operationId;
  final List<String> participantPrincipalIds;
  final ConversationViewState state;
  final int version;

  ConversationView({
    required this.channelId,
    required this.id,
    required this.operationId,
    required this.participantPrincipalIds,
    required this.state,
    required this.version,
  });

  factory ConversationView.fromJson(Map<String, dynamic> json) =>
      ConversationView(
        channelId: json["channelId"],
        id: json["id"],
        operationId: json["operationId"],
        participantPrincipalIds: List<String>.from(
          json["participantPrincipalIds"].map((x) => x),
        ),
        state: conversationViewStateValues.map[json["state"]]!,
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "channelId": channelId,
    "id": id,
    "operationId": operationId,
    "participantPrincipalIds": List<dynamic>.from(
      participantPrincipalIds.map((x) => x),
    ),
    "state": conversationViewStateValues.reverse[state],
    "version": version,
  });
}

enum ConversationViewState { ACTIVE, DISABLED, PROVISIONING, RECONCILING }

final conversationViewStateValues = EnumValues({
  "ACTIVE": ConversationViewState.ACTIVE,
  "DISABLED": ConversationViewState.DISABLED,
  "PROVISIONING": ConversationViewState.PROVISIONING,
  "RECONCILING": ConversationViewState.RECONCILING,
});

class ConversationParticipantPage {
  final List<ConversationParticipant> items;
  final int maxParticipants;
  final String? nextCursor;

  ConversationParticipantPage({
    required this.items,
    required this.maxParticipants,
    this.nextCursor,
  });

  factory ConversationParticipantPage.fromJson(Map<String, dynamic> json) =>
      ConversationParticipantPage(
        items: List<ConversationParticipant>.from(
          json["items"].map((x) => ConversationParticipant.fromJson(x)),
        ),
        maxParticipants: json["maxParticipants"],
        nextCursor: json["nextCursor"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "items": List<dynamic>.from(items.map((x) => x.toJson())),
    "maxParticipants": maxParticipants,
    "nextCursor": nextCursor,
  });
}

///同租户当前有效 HUMAN 及其已投影真实身份公钥，不伪造用户资料。
class ConversationParticipant {
  final String displayName;

  ///DD-139：同 Tenant 头像地址 <PUBLIC_ORIGIN>/api/v1/identity/avatars/<subject>（07 §4.7.3），只对有
  ///ACTIVE 外部身份的成员给出；只是地址，不含图片或资料正文，读取仍按该路由的 Tenant 准入。
  final String? picture;
  final String principalId;
  final List<String> pubkeys;

  ConversationParticipant({
    required this.displayName,
    this.picture,
    required this.principalId,
    required this.pubkeys,
  });

  factory ConversationParticipant.fromJson(Map<String, dynamic> json) =>
      ConversationParticipant(
        displayName: json["displayName"],
        picture: json["picture"],
        principalId: json["principalId"],
        pubkeys: List<String>.from(json["pubkeys"].map((x) => x)),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "displayName": displayName,
    "picture": picture,
    "principalId": principalId,
    "pubkeys": List<dynamic>.from(pubkeys.map((x) => x)),
  });
}

///PUT /api/v1/user-state/conversations/{conversationId} 的请求体（DD-40）：参与者私聊的收藏与静音，复用同一
///CollaborationUserState version CAS。隐藏状态不在此权威。
class ConversationPreferenceRequest {
  final bool muted;
  final bool starred;
  final int version;

  ConversationPreferenceRequest({
    required this.muted,
    required this.starred,
    required this.version,
  });

  factory ConversationPreferenceRequest.fromJson(Map<String, dynamic> json) =>
      ConversationPreferenceRequest(
        muted: json["muted"],
        starred: json["starred"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"muted": muted, "starred": starred, "version": version});
}

///已授权普通 Action 的 v1 平台元数据结果；不含业务正文、邀请凭证、文档或协议会话。仅 agent.invoke、automation.run 及已接入普通
///resource 动作使用；与通用 BFF ActionSubmission 的可选扩展解耦。
class DelegatedActionMetadataV1 {
  final String actionExecutionId;
  final String actionKey;
  final String? approvalWorkflowId;
  final ActionDispatchState dispatchState;
  final ActionGateState gateState;
  final String operationId;
  final ReasonCode? reason;
  final String? workflowId;

  DelegatedActionMetadataV1({
    required this.actionExecutionId,
    required this.actionKey,
    this.approvalWorkflowId,
    required this.dispatchState,
    required this.gateState,
    required this.operationId,
    this.reason,
    this.workflowId,
  });

  factory DelegatedActionMetadataV1.fromJson(Map<String, dynamic> json) =>
      DelegatedActionMetadataV1(
        actionExecutionId: json["actionExecutionId"],
        actionKey: json["actionKey"],
        approvalWorkflowId: json["approvalWorkflowId"],
        dispatchState: actionDispatchStateValues.map[json["dispatchState"]]!,
        gateState: actionGateStateValues.map[json["gateState"]]!,
        operationId: json["operationId"],
        reason: json["reason"] == null
            ? null
            : reasonCodeValues.map[json["reason"]]!,
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "approvalWorkflowId": approvalWorkflowId,
    "dispatchState": actionDispatchStateValues.reverse[dispatchState],
    "gateState": actionGateStateValues.reverse[gateState],
    "operationId": operationId,
    "reason": reasonCodeValues.reverse[reason],
    "workflowId": workflowId,
  });
}

class DiscoverableWorkspacePage {
  final List<DiscoverableWorkspace> items;
  final String? nextCursor;

  DiscoverableWorkspacePage({required this.items, this.nextCursor});

  factory DiscoverableWorkspacePage.fromJson(Map<String, dynamic> json) =>
      DiscoverableWorkspacePage(
        items: List<DiscoverableWorkspace>.from(
          json["items"].map((x) => DiscoverableWorkspace.fromJson(x)),
        ),
        nextCursor: json["nextCursor"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "items": List<dynamic>.from(items.map((x) => x.toJson())),
    "nextCursor": nextCursor,
  });
}

class DiscoverableWorkspace {
  ///与 updateActionKey 同时给出且为 true 时，Channel 是被原生 reaper 按 TTL 到期归档的，界面只提供以 workspace.update 的
  ///reopen 解档；省略或 false 时 updateActionKey 只用于修改名称、描述、TTL 与可见性。
  final bool? canReopen;
  final WebChannelView channel;
  final String createdAt;
  final String id;

  ///已通过当前 HUMAN Workspace 准入，而非只表示 join 已受理。
  final bool isMember;
  final DiscoverableWorkspaceJoinActionKey? joinActionKey;

  ///当前 Principal 持有 ACTIVE WorkspaceMembership、fresh Workspace discover
  ///检查通过且目录已开放时给出；主体固定为本人。省略即不显示退出入口。
  final DiscoverableWorkspaceLeaveActionKey? leaveActionKey;
  final int memberCount;
  final WorkspaceMembershipState? membershipState;

  ///当前 Principal 经 fresh Workspace manage 检查、目录已开放、Workspace ACTIVE 且没有未终结的 workspace.update
  ///时给出；Channel 已归档时仅在 canReopen 为 true 时给出。省略即不显示编辑入口，提交仍重新准入。
  final DiscoverableWorkspaceUpdateActionKey? updateActionKey;
  final WorkspaceVisibility visibility;

  DiscoverableWorkspace({
    this.canReopen,
    required this.channel,
    required this.createdAt,
    required this.id,
    required this.isMember,
    this.joinActionKey,
    this.leaveActionKey,
    required this.memberCount,
    this.membershipState,
    this.updateActionKey,
    required this.visibility,
  });

  factory DiscoverableWorkspace.fromJson(
    Map<String, dynamic> json,
  ) => DiscoverableWorkspace(
    canReopen: json["canReopen"],
    channel: WebChannelView.fromJson(json["channel"]),
    createdAt: json["createdAt"],
    id: json["id"],
    isMember: json["isMember"],
    joinActionKey: json["joinActionKey"] == null
        ? null
        : discoverableWorkspaceJoinActionKeyValues.map[json["joinActionKey"]]!,
    leaveActionKey: json["leaveActionKey"] == null
        ? null
        : discoverableWorkspaceLeaveActionKeyValues
              .map[json["leaveActionKey"]]!,
    memberCount: json["memberCount"],
    membershipState: json["membershipState"] == null
        ? null
        : workspaceMembershipStateValues.map[json["membershipState"]]!,
    updateActionKey: json["updateActionKey"] == null
        ? null
        : discoverableWorkspaceUpdateActionKeyValues
              .map[json["updateActionKey"]]!,
    visibility: workspaceVisibilityValues.map[json["visibility"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "canReopen": canReopen,
    "channel": channel.toJson(),
    "createdAt": createdAt,
    "id": id,
    "isMember": isMember,
    "joinActionKey":
        discoverableWorkspaceJoinActionKeyValues.reverse[joinActionKey],
    "leaveActionKey":
        discoverableWorkspaceLeaveActionKeyValues.reverse[leaveActionKey],
    "memberCount": memberCount,
    "membershipState": workspaceMembershipStateValues.reverse[membershipState],
    "updateActionKey":
        discoverableWorkspaceUpdateActionKeyValues.reverse[updateActionKey],
    "visibility": workspaceVisibilityValues.reverse[visibility],
  });
}

///Web 经 BFF 以本人身份读取已准入 Workspace 对应的原 Relay 39000 元数据；类型来自原生签名证据，不从消息列表推断，不另存业务正文。
class WebChannelView {
  final bool archived;
  final String channelId;
  final WorkspaceChannelCreateChannelType channelType;
  final String? description;
  final String name;

  ///原 39000 topic 标签；Relay 对空主题省略该标签，缺省即无主题。
  final String? topic;
  final String? ttlDeadline;
  final int? ttlSeconds;

  WebChannelView({
    required this.archived,
    required this.channelId,
    required this.channelType,
    this.description,
    required this.name,
    this.topic,
    this.ttlDeadline,
    this.ttlSeconds,
  });

  factory WebChannelView.fromJson(Map<String, dynamic> json) => WebChannelView(
    archived: json["archived"],
    channelId: json["channelId"],
    channelType:
        workspaceChannelCreateChannelTypeValues.map[json["channelType"]]!,
    description: json["description"],
    name: json["name"],
    topic: json["topic"],
    ttlDeadline: json["ttlDeadline"],
    ttlSeconds: json["ttlSeconds"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "archived": archived,
    "channelId": channelId,
    "channelType": workspaceChannelCreateChannelTypeValues.reverse[channelType],
    "description": description,
    "name": name,
    "topic": topic,
    "ttlDeadline": ttlDeadline,
    "ttlSeconds": ttlSeconds,
  });
}

enum DiscoverableWorkspaceJoinActionKey { WORKSPACE_JOIN }

final discoverableWorkspaceJoinActionKeyValues = EnumValues({
  "workspace.join": DiscoverableWorkspaceJoinActionKey.WORKSPACE_JOIN,
});

enum DiscoverableWorkspaceLeaveActionKey { WORKSPACE_LEAVE }

final discoverableWorkspaceLeaveActionKeyValues = EnumValues({
  "workspace.leave": DiscoverableWorkspaceLeaveActionKey.WORKSPACE_LEAVE,
});

///WorkspaceMembership 状态机。REVOKING 期间立即拒绝新动作；重新授权创建新 membership version，不复活旧投影。
enum WorkspaceMembershipState { ACTIVE, ERROR, PROVISIONING, REVOKED, REVOKING }

final workspaceMembershipStateValues = EnumValues({
  "ACTIVE": WorkspaceMembershipState.ACTIVE,
  "ERROR": WorkspaceMembershipState.ERROR,
  "PROVISIONING": WorkspaceMembershipState.PROVISIONING,
  "REVOKED": WorkspaceMembershipState.REVOKED,
  "REVOKING": WorkspaceMembershipState.REVOKING,
});

enum DiscoverableWorkspaceUpdateActionKey { WORKSPACE_UPDATE }

final discoverableWorkspaceUpdateActionKeyValues = EnumValues({
  "workspace.update": DiscoverableWorkspaceUpdateActionKey.WORKSPACE_UPDATE,
});

///GET /api/v1/audit/events/{id}/evidence/{index} 的回应。每次以事件 scope 的当前 audit permission fresh
///授权；每种证据另向其权威源查证原对象仍存在：明确不存在回 404（正文为 NOT_FOUND 的不可用视图），权威源不提供查证接口为 UNVERIFIABLE，权威源不可达回
///503。不可用时不回任何 ref 内容。
class EvidenceView {
  final EvidenceAuthority? authority;
  final bool available;
  final EvidenceKind? kind;
  final EvidenceSensitivity? sensitivity;

  ///权威源中的稳定 ID；仅 available 为 true 时出现
  final String? stableId;
  final EvidenceUnavailableReason? unavailableReason;

  ///该 ID 的版本；证据未登记版本时缺省
  final int? version;

  EvidenceView({
    this.authority,
    required this.available,
    this.kind,
    this.sensitivity,
    this.stableId,
    this.unavailableReason,
    this.version,
  });

  factory EvidenceView.fromJson(Map<String, dynamic> json) => EvidenceView(
    authority: json["authority"] == null
        ? null
        : evidenceAuthorityValues.map[json["authority"]]!,
    available: json["available"],
    kind: json["kind"] == null ? null : evidenceKindValues.map[json["kind"]]!,
    sensitivity: json["sensitivity"] == null
        ? null
        : evidenceSensitivityValues.map[json["sensitivity"]]!,
    stableId: json["stableId"],
    unavailableReason: json["unavailableReason"] == null
        ? null
        : evidenceUnavailableReasonValues.map[json["unavailableReason"]]!,
    version: json["version"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "authority": evidenceAuthorityValues.reverse[authority],
    "available": available,
    "kind": evidenceKindValues.reverse[kind],
    "sensitivity": evidenceSensitivityValues.reverse[sensitivity],
    "stableId": stableId,
    "unavailableReason":
        evidenceUnavailableReasonValues.reverse[unavailableReason],
    "version": version,
  });
}

///解引用只显示不可用时的原因：原证据已不存在（HTTP 404）、敏感级别未获授权、存量种类不可识别、权威源无法按该 ID 查证其仍存在。
enum EvidenceUnavailableReason {
  NOT_FOUND,
  RESTRICTED,
  UNRECOGNIZED,
  UNVERIFIABLE,
}

final evidenceUnavailableReasonValues = EnumValues({
  "NOT_FOUND": EvidenceUnavailableReason.NOT_FOUND,
  "RESTRICTED": EvidenceUnavailableReason.RESTRICTED,
  "UNRECOGNIZED": EvidenceUnavailableReason.UNRECOGNIZED,
  "UNVERIFIABLE": EvidenceUnavailableReason.UNVERIFIABLE,
});

///DD-42、06 §7.1：源 Tenant 的 ExportPackage Asset。只给当前对该 Asset 有 read 的 HUMAN；READY 后才有
///digest、大小与下载路径。字节只经下载路由返回，不进入本视图、审计或 Workflow 历史。
class ExportPackageView {
  final String actionExecutionId;
  final int? byteSize;
  final String? contentDigest;
  final String? downloadPath;

  ///原版文件名：`<显示名>.agent.json` 或 `.agent.png`；团队为 `.team.*`。
  final String? fileName;
  final String formatKey;
  final String mediaType;
  final String packageAssetId;
  final String? sourceAssetId;
  final String sourceResourceId;
  final ExportPackageState state;

  ExportPackageView({
    required this.actionExecutionId,
    this.byteSize,
    this.contentDigest,
    this.downloadPath,
    this.fileName,
    required this.formatKey,
    required this.mediaType,
    required this.packageAssetId,
    this.sourceAssetId,
    required this.sourceResourceId,
    required this.state,
  });

  factory ExportPackageView.fromJson(Map<String, dynamic> json) =>
      ExportPackageView(
        actionExecutionId: json["actionExecutionId"],
        byteSize: json["byteSize"],
        contentDigest: json["contentDigest"],
        downloadPath: json["downloadPath"],
        fileName: json["fileName"],
        formatKey: json["formatKey"],
        mediaType: json["mediaType"],
        packageAssetId: json["packageAssetId"],
        sourceAssetId: json["sourceAssetId"],
        sourceResourceId: json["sourceResourceId"],
        state: exportPackageStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "byteSize": byteSize,
    "contentDigest": contentDigest,
    "downloadPath": downloadPath,
    "fileName": fileName,
    "formatKey": formatKey,
    "mediaType": mediaType,
    "packageAssetId": packageAssetId,
    "sourceAssetId": sourceAssetId,
    "sourceResourceId": sourceResourceId,
    "state": exportPackageStateValues.reverse[state],
  });
}

///03 §3 ExportPackage 的状态：只有 READY 可下载；ERROR 是确定失败，DELETED 是 Tenant 销毁后的墓碑。
enum ExportPackageState { CREATING, DELETED, ERROR, READY, REVOKED }

final exportPackageStateValues = EnumValues({
  "CREATING": ExportPackageState.CREATING,
  "DELETED": ExportPackageState.DELETED,
  "ERROR": ExportPackageState.ERROR,
  "READY": ExportPackageState.READY,
  "REVOKED": ExportPackageState.REVOKED,
});

///PUT /api/v1/user-state/followed-principals 的请求体（DD-125(5)、03
///CollaborationUserState.followed_principals）：原 Pulse 关注/取消关注，取代逐公钥 kind 3。pubkey 是被关注者的任一
///Buzz 公钥，Core 解析为同 Tenant 的 HUMAN Principal 并按 Principal 存储；关注要求该公钥当前
///ACTIVE，取消关注也接受其已撤销的历史公钥。读取时按被关注 Principal 的全部 ACTIVE 公钥展开。version 不符即 409。
class FollowedPrincipalRequest {
  final bool followed;
  final String pubkey;
  final int version;

  FollowedPrincipalRequest({
    required this.followed,
    required this.pubkey,
    required this.version,
  });

  factory FollowedPrincipalRequest.fromJson(Map<String, dynamic> json) =>
      FollowedPrincipalRequest(
        followed: json["followed"],
        pubkey: json["pubkey"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"followed": followed, "pubkey": pubkey, "version": version});
}

///DD-134(2)：本会话在网关管理区可用的分区。只决定入口与按钮是否呈现；每个查询与动作仍在 BFF fresh 授权，前端隐藏不构成授权。
class GatewayAccess {
  ///TENANT 范围：application_binding.create 的准入预评估（Tenant manage）。
  final bool canBindMcp;

  ///llm_route.create 的准入预评估（Tenant create）。
  final bool canCreateModelRoute;

  ///PLATFORM 范围：active HUMAN 且 Catalog Tenant manage（交付目录读取、受控探测、契约与 release 登记批准）。
  final bool canManageMcp;

  ///PLATFORM 范围：Catalog Tenant audit。
  final bool canReadConfig;

  ///TENANT 范围：Tenant discover。PLATFORM 范围恒为 false（平台只在实时配置中看到 route 的 Gateway 投影）。
  final bool canReadModelRoutes;

  ///PLATFORM：Catalog Tenant audit；TENANT：Tenant audit（Workspace audit 只在选择该 Workspace 时生效）。
  final bool canReadStats;

  ///TENANT 范围：Tenant discover。PLATFORM 范围恒为 false。
  final bool canReadTools;
  final GatewayAdminScope scope;
  final String tenantId;

  GatewayAccess({
    required this.canBindMcp,
    required this.canCreateModelRoute,
    required this.canManageMcp,
    required this.canReadConfig,
    required this.canReadModelRoutes,
    required this.canReadStats,
    required this.canReadTools,
    required this.scope,
    required this.tenantId,
  });

  factory GatewayAccess.fromJson(Map<String, dynamic> json) => GatewayAccess(
    canBindMcp: json["canBindMcp"],
    canCreateModelRoute: json["canCreateModelRoute"],
    canManageMcp: json["canManageMcp"],
    canReadConfig: json["canReadConfig"],
    canReadModelRoutes: json["canReadModelRoutes"],
    canReadStats: json["canReadStats"],
    canReadTools: json["canReadTools"],
    scope: gatewayAdminScopeValues.map[json["scope"]]!,
    tenantId: json["tenantId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "canBindMcp": canBindMcp,
    "canCreateModelRoute": canCreateModelRoute,
    "canManageMcp": canManageMcp,
    "canReadConfig": canReadConfig,
    "canReadModelRoutes": canReadModelRoutes,
    "canReadStats": canReadStats,
    "canReadTools": canReadTools,
    "scope": gatewayAdminScopeValues.reverse[scope],
    "tenantId": tenantId,
  });
}

///DD-134(2)：网关管理区的范围取会话 Tenant。PLATFORM：Platform Catalog Tenant 会话，只见 Gateway 原生事实与 Tenant
///归属 ID；TENANT：业务 Tenant 会话，按 Tenant/Workspace audit 下钻本 Tenant 的业务关联。
enum GatewayAdminScope { PLATFORM, TENANT }

final gatewayAdminScopeValues = EnumValues({
  "PLATFORM": GatewayAdminScope.PLATFORM,
  "TENANT": GatewayAdminScope.TENANT,
});

///DD-134(3)⑤：单次调用下钻。TENANT 范围关联 ActionExecution 与同 operation 的 AuditEvent；PLATFORM 范围只有
///call。
class GatewayCallDetail {
  final List<GatewayCallAuditEvent> auditEvents;
  final GatewayCallView call;
  final GatewayCallExecution? execution;

  GatewayCallDetail({
    required this.auditEvents,
    required this.call,
    this.execution,
  });

  factory GatewayCallDetail.fromJson(Map<String, dynamic> json) =>
      GatewayCallDetail(
        auditEvents: List<GatewayCallAuditEvent>.from(
          json["auditEvents"].map((x) => GatewayCallAuditEvent.fromJson(x)),
        ),
        call: GatewayCallView.fromJson(json["call"]),
        execution: json["execution"] == null
            ? null
            : GatewayCallExecution.fromJson(json["execution"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "auditEvents": List<dynamic>.from(auditEvents.map((x) => x.toJson())),
    "call": call.toJson(),
    "execution": execution?.toJson(),
  });
}

class GatewayCallAuditEvent {
  final String? actionExecutionId;
  final String actionKey;
  final String decision;
  final String eventId;
  final AuditEventType eventType;
  final String occurredAt;
  final String resultCode;

  GatewayCallAuditEvent({
    this.actionExecutionId,
    required this.actionKey,
    required this.decision,
    required this.eventId,
    required this.eventType,
    required this.occurredAt,
    required this.resultCode,
  });

  factory GatewayCallAuditEvent.fromJson(Map<String, dynamic> json) =>
      GatewayCallAuditEvent(
        actionExecutionId: json["actionExecutionId"],
        actionKey: json["actionKey"],
        decision: json["decision"],
        eventId: json["eventId"],
        eventType: auditEventTypeValues.map[json["eventType"]]!,
        occurredAt: json["occurredAt"],
        resultCode: json["resultCode"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "decision": decision,
    "eventId": eventId,
    "eventType": auditEventTypeValues.reverse[eventType],
    "occurredAt": occurredAt,
    "resultCode": resultCode,
  });
}

///DD-134(3)⑤：一次模型或工具调用的元数据。不含 prompt 预览、turn、payload、工具参数或结果正文。PLATFORM 范围只填 Gateway 原生字段与
///tenantId。
class GatewayCallView {
  final String? actionExecutionId;
  final String? agentInstallationResourceId;
  final String? agentName;
  final String? applicationBindingId;

  ///MODEL 为 request log ID 前缀 model:，TOOL 为 ActionExecution ID 前缀 tool:。
  final String callId;
  final String? completedAt;
  final int? durationMs;
  final int? httpStatus;
  final int? inputTokens;
  final GatewayCallKind kind;
  final String? model;

  ///Gateway 上的模型路由名（request log 的请求模型）。
  final String? modelRouteKey;
  final String? modelRouteResourceId;
  final String? operationId;
  final GatewayCallOutcome outcome;
  final int? outputTokens;
  final String? provider;
  final ReasonCode? reasonCode;
  final String? requestLogId;
  final String startedAt;
  final String? tenantId;
  final String? toolName;
  final String? toolResourceId;
  final AgentInstallationToolSource? toolSource;
  final int? totalTokens;
  final String? traceId;
  final OperationUsageState? usageState;
  final String? workspaceId;

  GatewayCallView({
    this.actionExecutionId,
    this.agentInstallationResourceId,
    this.agentName,
    this.applicationBindingId,
    required this.callId,
    this.completedAt,
    this.durationMs,
    this.httpStatus,
    this.inputTokens,
    required this.kind,
    this.model,
    this.modelRouteKey,
    this.modelRouteResourceId,
    this.operationId,
    required this.outcome,
    this.outputTokens,
    this.provider,
    this.reasonCode,
    this.requestLogId,
    required this.startedAt,
    this.tenantId,
    this.toolName,
    this.toolResourceId,
    this.toolSource,
    this.totalTokens,
    this.traceId,
    this.usageState,
    this.workspaceId,
  });

  factory GatewayCallView.fromJson(Map<String, dynamic> json) =>
      GatewayCallView(
        actionExecutionId: json["actionExecutionId"],
        agentInstallationResourceId: json["agentInstallationResourceId"],
        agentName: json["agentName"],
        applicationBindingId: json["applicationBindingId"],
        callId: json["callId"],
        completedAt: json["completedAt"],
        durationMs: json["durationMs"],
        httpStatus: json["httpStatus"],
        inputTokens: json["inputTokens"],
        kind: gatewayCallKindValues.map[json["kind"]]!,
        model: json["model"],
        modelRouteKey: json["modelRouteKey"],
        modelRouteResourceId: json["modelRouteResourceId"],
        operationId: json["operationId"],
        outcome: gatewayCallOutcomeValues.map[json["outcome"]]!,
        outputTokens: json["outputTokens"],
        provider: json["provider"],
        reasonCode: json["reasonCode"] == null
            ? null
            : reasonCodeValues.map[json["reasonCode"]]!,
        requestLogId: json["requestLogId"],
        startedAt: json["startedAt"],
        tenantId: json["tenantId"],
        toolName: json["toolName"],
        toolResourceId: json["toolResourceId"],
        toolSource: json["toolSource"] == null
            ? null
            : agentInstallationToolSourceValues.map[json["toolSource"]]!,
        totalTokens: json["totalTokens"],
        traceId: json["traceId"],
        usageState: json["usageState"] == null
            ? null
            : operationUsageStateValues.map[json["usageState"]]!,
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "agentInstallationResourceId": agentInstallationResourceId,
    "agentName": agentName,
    "applicationBindingId": applicationBindingId,
    "callId": callId,
    "completedAt": completedAt,
    "durationMs": durationMs,
    "httpStatus": httpStatus,
    "inputTokens": inputTokens,
    "kind": gatewayCallKindValues.reverse[kind],
    "model": model,
    "modelRouteKey": modelRouteKey,
    "modelRouteResourceId": modelRouteResourceId,
    "operationId": operationId,
    "outcome": gatewayCallOutcomeValues.reverse[outcome],
    "outputTokens": outputTokens,
    "provider": provider,
    "reasonCode": reasonCodeValues.reverse[reasonCode],
    "requestLogId": requestLogId,
    "startedAt": startedAt,
    "tenantId": tenantId,
    "toolName": toolName,
    "toolResourceId": toolResourceId,
    "toolSource": agentInstallationToolSourceValues.reverse[toolSource],
    "totalTokens": totalTokens,
    "traceId": traceId,
    "usageState": operationUsageStateValues.reverse[usageState],
    "workspaceId": workspaceId,
  });
}

///DD-134(3)：MODEL 取 Gateway request log（时延为 Gateway durationMs）；TOOL 取 Core 工具子
///ActionExecution 与审计（时延为 Core 观测的 INTENT 到 OUTCOME 间隔）。两者时延不混算。
enum GatewayCallKind { MODEL, TOOL }

final gatewayCallKindValues = EnumValues({
  "MODEL": GatewayCallKind.MODEL,
  "TOOL": GatewayCallKind.TOOL,
});

///DD-134(3)：一次调用的呈现状态。DENIED 是准入拒绝（含 PEP 拒绝）；UNKNOWN 是结果不明、待原 operation 对账；RUNNING 是已准入未终结。
enum GatewayCallOutcome { DENIED, FAILED, RUNNING, SUCCEEDED, UNKNOWN }

final gatewayCallOutcomeValues = EnumValues({
  "DENIED": GatewayCallOutcome.DENIED,
  "FAILED": GatewayCallOutcome.FAILED,
  "RUNNING": GatewayCallOutcome.RUNNING,
  "SUCCEEDED": GatewayCallOutcome.SUCCEEDED,
  "UNKNOWN": GatewayCallOutcome.UNKNOWN,
});

class GatewayCallExecution {
  final String actionExecutionId;
  final String actionKey;
  final int actionVersion;
  final String createdAt;
  final ActionDispatchState dispatchState;
  final ActionGateState gateState;
  final String operationId;
  final String? parentActionExecutionId;
  final ReasonCode? reasonCode;
  final String? updatedAt;

  GatewayCallExecution({
    required this.actionExecutionId,
    required this.actionKey,
    required this.actionVersion,
    required this.createdAt,
    required this.dispatchState,
    required this.gateState,
    required this.operationId,
    this.parentActionExecutionId,
    this.reasonCode,
    this.updatedAt,
  });

  factory GatewayCallExecution.fromJson(Map<String, dynamic> json) =>
      GatewayCallExecution(
        actionExecutionId: json["actionExecutionId"],
        actionKey: json["actionKey"],
        actionVersion: json["actionVersion"],
        createdAt: json["createdAt"],
        dispatchState: actionDispatchStateValues.map[json["dispatchState"]]!,
        gateState: actionGateStateValues.map[json["gateState"]]!,
        operationId: json["operationId"],
        parentActionExecutionId: json["parentActionExecutionId"],
        reasonCode: json["reasonCode"] == null
            ? null
            : reasonCodeValues.map[json["reasonCode"]]!,
        updatedAt: json["updatedAt"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "actionVersion": actionVersion,
    "createdAt": createdAt,
    "dispatchState": actionDispatchStateValues.reverse[dispatchState],
    "gateState": actionGateStateValues.reverse[gateState],
    "operationId": operationId,
    "parentActionExecutionId": parentActionExecutionId,
    "reasonCode": reasonCodeValues.reverse[reasonCode],
    "updatedAt": updatedAt,
  });
}

///DD-134(3)：时间窗内的调用列表，按开始时间倒序；nextCursor 只在同一查询条件内继续。
class GatewayCallPage {
  final List<GatewayCallView> calls;
  final bool modelLogAvailable;
  final String? nextCursor;
  final GatewayAdminScope scope;
  final bool truncated;

  GatewayCallPage({
    required this.calls,
    required this.modelLogAvailable,
    this.nextCursor,
    required this.scope,
    required this.truncated,
  });

  factory GatewayCallPage.fromJson(Map<String, dynamic> json) =>
      GatewayCallPage(
        calls: List<GatewayCallView>.from(
          json["calls"].map((x) => GatewayCallView.fromJson(x)),
        ),
        modelLogAvailable: json["modelLogAvailable"],
        nextCursor: json["nextCursor"],
        scope: gatewayAdminScopeValues.map[json["scope"]]!,
        truncated: json["truncated"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "calls": List<dynamic>.from(calls.map((x) => x.toJson())),
    "modelLogAvailable": modelLogAvailable,
    "nextCursor": nextCursor,
    "scope": gatewayAdminScopeValues.reverse[scope],
    "truncated": truncated,
  });
}

///DD-134(3)⑥：一个 ConfigResource 的 Core 写入证据（打码后的值）与相邻已记录 revision 之间的差异；当前 revision 没有证据时
///currentSource=UNRECORDED。
class GatewayConfigHistory {
  final int? currentRevision;
  final GatewayConfigRevisionSource currentSource;
  final String id;
  final String kind;
  final List<GatewayConfigRevisionView> revisions;

  GatewayConfigHistory({
    this.currentRevision,
    required this.currentSource,
    required this.id,
    required this.kind,
    required this.revisions,
  });

  factory GatewayConfigHistory.fromJson(Map<String, dynamic> json) =>
      GatewayConfigHistory(
        currentRevision: json["currentRevision"],
        currentSource:
            gatewayConfigRevisionSourceValues.map[json["currentSource"]]!,
        id: json["id"],
        kind: json["kind"],
        revisions: List<GatewayConfigRevisionView>.from(
          json["revisions"].map((x) => GatewayConfigRevisionView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "currentRevision": currentRevision,
    "currentSource": gatewayConfigRevisionSourceValues.reverse[currentSource],
    "id": id,
    "kind": kind,
    "revisions": List<dynamic>.from(revisions.map((x) => x.toJson())),
  });
}

///DD-134(3)⑥：CORE_RECORDED 表示 Core 写入并回读确认时保存了该 revision 的写入证据；UNRECORDED 表示外部写入或早于写入证据，按
///17 §9 作为投影不一致信号，不反向导入。
enum GatewayConfigRevisionSource { CORE_RECORDED, UNRECORDED }

final gatewayConfigRevisionSourceValues = EnumValues({
  "CORE_RECORDED": GatewayConfigRevisionSource.CORE_RECORDED,
  "UNRECORDED": GatewayConfigRevisionSource.UNRECORDED,
});

class GatewayConfigRevisionView {
  final String? actionExecutionId;
  final String? actionKey;
  final List<GatewayConfigChange> changes;
  final bool deleted;
  final String? operationId;
  final String recordedAt;
  final int revision;
  final String valueDigest;
  final String valueJson;

  GatewayConfigRevisionView({
    this.actionExecutionId,
    this.actionKey,
    required this.changes,
    required this.deleted,
    this.operationId,
    required this.recordedAt,
    required this.revision,
    required this.valueDigest,
    required this.valueJson,
  });

  factory GatewayConfigRevisionView.fromJson(Map<String, dynamic> json) =>
      GatewayConfigRevisionView(
        actionExecutionId: json["actionExecutionId"],
        actionKey: json["actionKey"],
        changes: List<GatewayConfigChange>.from(
          json["changes"].map((x) => GatewayConfigChange.fromJson(x)),
        ),
        deleted: json["deleted"],
        operationId: json["operationId"],
        recordedAt: json["recordedAt"],
        revision: json["revision"],
        valueDigest: json["valueDigest"],
        valueJson: json["valueJson"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "changes": List<dynamic>.from(changes.map((x) => x.toJson())),
    "deleted": deleted,
    "operationId": operationId,
    "recordedAt": recordedAt,
    "revision": revision,
    "valueDigest": valueDigest,
    "valueJson": valueJson,
  });
}

class GatewayConfigChange {
  final String? afterJson;
  final String? beforeJson;
  final GatewayConfigChangeKind change;

  ///RFC 6901 JSON pointer。
  final String path;

  GatewayConfigChange({
    this.afterJson,
    this.beforeJson,
    required this.change,
    required this.path,
  });

  factory GatewayConfigChange.fromJson(Map<String, dynamic> json) =>
      GatewayConfigChange(
        afterJson: json["afterJson"],
        beforeJson: json["beforeJson"],
        change: gatewayConfigChangeKindValues.map[json["change"]]!,
        path: json["path"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "afterJson": afterJson,
    "beforeJson": beforeJson,
    "change": gatewayConfigChangeKindValues.reverse[change],
    "path": path,
  });
}

///DD-134(3)⑥：打码后的值在相邻两个已记录 revision 之间按 JSON 路径的差异。
enum GatewayConfigChangeKind { ADDED, CHANGED, REMOVED }

final gatewayConfigChangeKindValues = EnumValues({
  "ADDED": GatewayConfigChangeKind.ADDED,
  "CHANGED": GatewayConfigChangeKind.CHANGED,
  "REMOVED": GatewayConfigChangeKind.REMOVED,
});

///DD-134(3)⑥(4)：Gateway effective config 与 ConfigResource 当前值，均已在 Core 打码；只读。
class GatewayConfigView {
  final String effectiveConfigJson;
  final String readAt;
  final List<GatewayConfigResourceView> resources;

  GatewayConfigView({
    required this.effectiveConfigJson,
    required this.readAt,
    required this.resources,
  });

  factory GatewayConfigView.fromJson(Map<String, dynamic> json) =>
      GatewayConfigView(
        effectiveConfigJson: json["effectiveConfigJson"],
        readAt: json["readAt"],
        resources: List<GatewayConfigResourceView>.from(
          json["resources"].map((x) => GatewayConfigResourceView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "effectiveConfigJson": effectiveConfigJson,
    "readAt": readAt,
    "resources": List<dynamic>.from(resources.map((x) => x.toJson())),
  });
}

class GatewayConfigResourceView {
  final String? actionExecutionId;
  final String? actionKey;
  final String id;
  final String kind;
  final String? operationId;
  final int revision;
  final GatewayConfigRevisionSource source;
  final String? updatedAt;
  final String valueJson;

  GatewayConfigResourceView({
    this.actionExecutionId,
    this.actionKey,
    required this.id,
    required this.kind,
    this.operationId,
    required this.revision,
    required this.source,
    this.updatedAt,
    required this.valueJson,
  });

  factory GatewayConfigResourceView.fromJson(Map<String, dynamic> json) =>
      GatewayConfigResourceView(
        actionExecutionId: json["actionExecutionId"],
        actionKey: json["actionKey"],
        id: json["id"],
        kind: json["kind"],
        operationId: json["operationId"],
        revision: json["revision"],
        source: gatewayConfigRevisionSourceValues.map[json["source"]]!,
        updatedAt: json["updatedAt"],
        valueJson: json["valueJson"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "id": id,
    "kind": kind,
    "operationId": operationId,
    "revision": revision,
    "source": gatewayConfigRevisionSourceValues.reverse[source],
    "updatedAt": updatedAt,
    "valueJson": valueJson,
  });
}

///DD-134(5)⑥：需由运维加入交付目录 protocolPeers[].bindings 的条目（不含 secret）；Core 回读到同 bindingId 的条目后才放行
///application_binding.create。
class GatewayMcpBindingDraft {
  final String adapterServiceRef;
  final String bindingId;
  final String configDigest;
  final String directoryEntryJson;
  final String servicePrincipalId;

  GatewayMcpBindingDraft({
    required this.adapterServiceRef,
    required this.bindingId,
    required this.configDigest,
    required this.directoryEntryJson,
    required this.servicePrincipalId,
  });

  factory GatewayMcpBindingDraft.fromJson(Map<String, dynamic> json) =>
      GatewayMcpBindingDraft(
        adapterServiceRef: json["adapterServiceRef"],
        bindingId: json["bindingId"],
        configDigest: json["configDigest"],
        directoryEntryJson: json["directoryEntryJson"],
        servicePrincipalId: json["servicePrincipalId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "adapterServiceRef": adapterServiceRef,
    "bindingId": bindingId,
    "configDigest": configDigest,
    "directoryEntryJson": directoryEntryJson,
    "servicePrincipalId": servicePrincipalId,
  });
}

///DD-134(5)⑥：为尚无交付归属事实的连接生成目录条目草稿；纯计算，不写任何状态。
class GatewayMcpBindingDraftRequest {
  final String componentReleaseId;
  final ApplicationIsolationMode isolationMode;
  final String nativeScopeRef;
  final String normalizedConfigJson;
  final String? workspaceId;

  GatewayMcpBindingDraftRequest({
    required this.componentReleaseId,
    required this.isolationMode,
    required this.nativeScopeRef,
    required this.normalizedConfigJson,
    this.workspaceId,
  });

  factory GatewayMcpBindingDraftRequest.fromJson(Map<String, dynamic> json) =>
      GatewayMcpBindingDraftRequest(
        componentReleaseId: json["componentReleaseId"],
        isolationMode:
            applicationIsolationModeValues.map[json["isolationMode"]]!,
        nativeScopeRef: json["nativeScopeRef"],
        normalizedConfigJson: json["normalizedConfigJson"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "componentReleaseId": componentReleaseId,
    "isolationMode": applicationIsolationModeValues.reverse[isolationMode],
    "nativeScopeRef": nativeScopeRef,
    "normalizedConfigJson": normalizedConfigJson,
    "workspaceId": workspaceId,
  });
}

///DD-134(5)①：部署交付目录的 protocolPeers 与一致性环境（只读，Catalog manage）。URL 已去掉 userinfo、query 与
///fragment。
class GatewayMcpPeerPage {
  final String? conformanceArtifactDigest;
  final bool directoryAvailable;
  final List<GatewayMcpPeerView> peers;

  GatewayMcpPeerPage({
    this.conformanceArtifactDigest,
    required this.directoryAvailable,
    required this.peers,
  });

  factory GatewayMcpPeerPage.fromJson(Map<String, dynamic> json) =>
      GatewayMcpPeerPage(
        conformanceArtifactDigest: json["conformanceArtifactDigest"],
        directoryAvailable: json["directoryAvailable"],
        peers: List<GatewayMcpPeerView>.from(
          json["peers"].map((x) => GatewayMcpPeerView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "conformanceArtifactDigest": conformanceArtifactDigest,
    "directoryAvailable": directoryAvailable,
    "peers": List<dynamic>.from(peers.map((x) => x.toJson())),
  });
}

class GatewayMcpPeerView {
  final String adapterServiceRef;
  final String artifactDigest;
  final List<GatewayMcpBindingFact> bindingFacts;

  ///部署一致性环境存在且其 artifactDigest 等于本条目。
  final bool conformanceReady;
  final int maxResponseBytes;
  final String mcpUrl;
  final String nativeInstanceRef;
  final int timeoutSeconds;

  GatewayMcpPeerView({
    required this.adapterServiceRef,
    required this.artifactDigest,
    required this.bindingFacts,
    required this.conformanceReady,
    required this.maxResponseBytes,
    required this.mcpUrl,
    required this.nativeInstanceRef,
    required this.timeoutSeconds,
  });

  factory GatewayMcpPeerView.fromJson(Map<String, dynamic> json) =>
      GatewayMcpPeerView(
        adapterServiceRef: json["adapterServiceRef"],
        artifactDigest: json["artifactDigest"],
        bindingFacts: List<GatewayMcpBindingFact>.from(
          json["bindingFacts"].map((x) => GatewayMcpBindingFact.fromJson(x)),
        ),
        conformanceReady: json["conformanceReady"],
        maxResponseBytes: json["maxResponseBytes"],
        mcpUrl: json["mcpUrl"],
        nativeInstanceRef: json["nativeInstanceRef"],
        timeoutSeconds: json["timeoutSeconds"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "adapterServiceRef": adapterServiceRef,
    "artifactDigest": artifactDigest,
    "bindingFacts": List<dynamic>.from(bindingFacts.map((x) => x.toJson())),
    "conformanceReady": conformanceReady,
    "maxResponseBytes": maxResponseBytes,
    "mcpUrl": mcpUrl,
    "nativeInstanceRef": nativeInstanceRef,
    "timeoutSeconds": timeoutSeconds,
  });
}

///DD-98/134(5)⑥：交付目录中一条 binding 归属事实（运维域），不是授权；不含 secret。
class GatewayMcpBindingFact {
  final String bindingId;

  ///已有同 ID 的 ApplicationBinding。
  final bool bound;
  final String configDigest;
  final List<String> credentialKeys;
  final ApplicationIsolationMode isolationMode;
  final String nativeScopeRef;
  final String servicePrincipalId;
  final String tenantId;
  final String? workspaceId;

  GatewayMcpBindingFact({
    required this.bindingId,
    required this.bound,
    required this.configDigest,
    required this.credentialKeys,
    required this.isolationMode,
    required this.nativeScopeRef,
    required this.servicePrincipalId,
    required this.tenantId,
    this.workspaceId,
  });

  factory GatewayMcpBindingFact.fromJson(Map<String, dynamic> json) =>
      GatewayMcpBindingFact(
        bindingId: json["bindingId"],
        bound: json["bound"],
        configDigest: json["configDigest"],
        credentialKeys: List<String>.from(json["credentialKeys"].map((x) => x)),
        isolationMode:
            applicationIsolationModeValues.map[json["isolationMode"]]!,
        nativeScopeRef: json["nativeScopeRef"],
        servicePrincipalId: json["servicePrincipalId"],
        tenantId: json["tenantId"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "bound": bound,
    "configDigest": configDigest,
    "credentialKeys": List<dynamic>.from(credentialKeys.map((x) => x)),
    "isolationMode": applicationIsolationModeValues.reverse[isolationMode],
    "nativeScopeRef": nativeScopeRef,
    "servicePrincipalId": servicePrincipalId,
    "tenantId": tenantId,
    "workspaceId": workspaceId,
  });
}

///DD-134(5)②：受控探测只接受交付目录条目引用，不接受 URL。
class GatewayMcpProbeRequest {
  final String adapterServiceRef;

  GatewayMcpProbeRequest({required this.adapterServiceRef});

  factory GatewayMcpProbeRequest.fromJson(Map<String, dynamic> json) =>
      GatewayMcpProbeRequest(adapterServiceRef: json["adapterServiceRef"]);

  Map<String, dynamic> toJson() =>
      _stripNulls({"adapterServiceRef": adapterServiceRef});
}

///DD-134(5)②：经 Gateway 临时验证 route 的 initialize 与 tools/list 结果（route
///已删除并回读不存在）。matchingContracts 为输入 schema 摘要一致的 ACTIVE 契约 TOOL 键，并带该契约生成 PROTOCOL_PEER
///release 草稿所需的 Catalog 元数据（DD-134(5)③④），不含 schema 正文。
class GatewayMcpProbeResult {
  final String adapterServiceRef;
  final String probedAt;
  final String probeId;
  final String? protocolVersion;
  final String? serverName;
  final String? serverVersion;
  final List<GatewayMcpProbedTool> tools;
  final String toolSchemaDigest;

  GatewayMcpProbeResult({
    required this.adapterServiceRef,
    required this.probedAt,
    required this.probeId,
    this.protocolVersion,
    this.serverName,
    this.serverVersion,
    required this.tools,
    required this.toolSchemaDigest,
  });

  factory GatewayMcpProbeResult.fromJson(Map<String, dynamic> json) =>
      GatewayMcpProbeResult(
        adapterServiceRef: json["adapterServiceRef"],
        probedAt: json["probedAt"],
        probeId: json["probeId"],
        protocolVersion: json["protocolVersion"],
        serverName: json["serverName"],
        serverVersion: json["serverVersion"],
        tools: List<GatewayMcpProbedTool>.from(
          json["tools"].map((x) => GatewayMcpProbedTool.fromJson(x)),
        ),
        toolSchemaDigest: json["toolSchemaDigest"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "adapterServiceRef": adapterServiceRef,
    "probedAt": probedAt,
    "probeId": probeId,
    "protocolVersion": protocolVersion,
    "serverName": serverName,
    "serverVersion": serverVersion,
    "tools": List<dynamic>.from(tools.map((x) => x.toJson())),
    "toolSchemaDigest": toolSchemaDigest,
  });
}

class GatewayMcpProbedTool {
  final String? description;
  final String? displayTitle;
  final String inputSchemaDigest;
  final String inputSchemaJson;
  final List<GatewayMcpContractMatch> matchingContracts;
  final String name;
  final String? outputSchemaDigest;
  final String? outputSchemaJson;
  final bool? readOnlyHint;

  GatewayMcpProbedTool({
    this.description,
    this.displayTitle,
    required this.inputSchemaDigest,
    required this.inputSchemaJson,
    required this.matchingContracts,
    required this.name,
    this.outputSchemaDigest,
    this.outputSchemaJson,
    this.readOnlyHint,
  });

  factory GatewayMcpProbedTool.fromJson(Map<String, dynamic> json) =>
      GatewayMcpProbedTool(
        description: json["description"],
        displayTitle: json["displayTitle"],
        inputSchemaDigest: json["inputSchemaDigest"],
        inputSchemaJson: json["inputSchemaJson"],
        matchingContracts: List<GatewayMcpContractMatch>.from(
          json["matchingContracts"].map(
            (x) => GatewayMcpContractMatch.fromJson(x),
          ),
        ),
        name: json["name"],
        outputSchemaDigest: json["outputSchemaDigest"],
        outputSchemaJson: json["outputSchemaJson"],
        readOnlyHint: json["readOnlyHint"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "description": description,
    "displayTitle": displayTitle,
    "inputSchemaDigest": inputSchemaDigest,
    "inputSchemaJson": inputSchemaJson,
    "matchingContracts": List<dynamic>.from(
      matchingContracts.map((x) => x.toJson()),
    ),
    "name": name,
    "outputSchemaDigest": outputSchemaDigest,
    "outputSchemaJson": outputSchemaJson,
    "readOnlyHint": readOnlyHint,
  });
}

class GatewayMcpContractMatch {
  final String categoryKey;
  final String contractKey;
  final int contractVersion;

  ///该 ACTIVE 契约的全部 operation 契约键；release 须为每个键登记动作与工具。
  final List<String> operationContractKeys;

  ///该 TOOL 契约键在 ACTIVE 契约中的输出 schema 摘要；release 的动作与工具逐字采用。
  final String outputSchemaDigest;
  final CapabilityPermission permission;

  ///该 ACTIVE 契约 resourceTypeFamily 的全部 typeKey；release 须逐一登记。
  final List<String> resourceTypeKeys;

  ///该 TOOL 契约键在 ACTIVE 契约中的 targetType。
  final String targetType;

  GatewayMcpContractMatch({
    required this.categoryKey,
    required this.contractKey,
    required this.contractVersion,
    required this.operationContractKeys,
    required this.outputSchemaDigest,
    required this.permission,
    required this.resourceTypeKeys,
    required this.targetType,
  });

  factory GatewayMcpContractMatch.fromJson(Map<String, dynamic> json) =>
      GatewayMcpContractMatch(
        categoryKey: json["categoryKey"],
        contractKey: json["contractKey"],
        contractVersion: json["contractVersion"],
        operationContractKeys: List<String>.from(
          json["operationContractKeys"].map((x) => x),
        ),
        outputSchemaDigest: json["outputSchemaDigest"],
        permission: capabilityPermissionValues.map[json["permission"]]!,
        resourceTypeKeys: List<String>.from(
          json["resourceTypeKeys"].map((x) => x),
        ),
        targetType: json["targetType"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "categoryKey": categoryKey,
    "contractKey": contractKey,
    "contractVersion": contractVersion,
    "operationContractKeys": List<dynamic>.from(
      operationContractKeys.map((x) => x),
    ),
    "outputSchemaDigest": outputSchemaDigest,
    "permission": capabilityPermissionValues.reverse[permission],
    "resourceTypeKeys": List<dynamic>.from(resourceTypeKeys.map((x) => x)),
    "targetType": targetType,
  });
}

enum CapabilityPermission {
  APPROVE,
  AUDIT,
  CONSUME,
  CREATE,
  DELEGATE,
  DELETE,
  DISCOVER,
  EXECUTE,
  EXPORT,
  MANAGE,
  READ,
  SHARE,
  TRANSFER_OWNER,
  UPDATE,
}

final capabilityPermissionValues = EnumValues({
  "approve": CapabilityPermission.APPROVE,
  "audit": CapabilityPermission.AUDIT,
  "consume": CapabilityPermission.CONSUME,
  "create": CapabilityPermission.CREATE,
  "delegate": CapabilityPermission.DELEGATE,
  "delete": CapabilityPermission.DELETE,
  "discover": CapabilityPermission.DISCOVER,
  "execute": CapabilityPermission.EXECUTE,
  "export": CapabilityPermission.EXPORT,
  "manage": CapabilityPermission.MANAGE,
  "read": CapabilityPermission.READ,
  "share": CapabilityPermission.SHARE,
  "transfer_owner": CapabilityPermission.TRANSFER_OWNER,
  "update": CapabilityPermission.UPDATE,
});

///DD-134(5)⑥：业务 Tenant 可建立连接的已批准 PROTOCOL_PEER release 与本 Tenant 的交付归属事实（Tenant manage）。
class GatewayMcpReleasePage {
  final List<GatewayMcpReleaseView> releases;

  GatewayMcpReleasePage({required this.releases});

  factory GatewayMcpReleasePage.fromJson(Map<String, dynamic> json) =>
      GatewayMcpReleasePage(
        releases: List<GatewayMcpReleaseView>.from(
          json["releases"].map((x) => GatewayMcpReleaseView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "releases": List<dynamic>.from(releases.map((x) => x.toJson())),
  });
}

class GatewayMcpReleaseView {
  final String adapterBuildRef;

  ///交付目录中 artifactDigest 等于 adapterBuildRef 的 peer；没有时省略。
  final String? adapterServiceRef;
  final List<ApplicationModelCallMode> allowedModelCallModes;
  final String? bindingConfigSchemaJson;
  final List<String> bindingIds;
  final List<GatewayMcpReleaseCategory> capabilityCategories;
  final String componentReleaseId;
  final String componentTypeKey;
  final List<GatewayMcpBindingFact> deliveryFacts;
  final String? nativeInstanceRef;

  ///DD-155(3)：release 所选能力类别任一声明 tenantDelete=RETAIN_ON_TENANT_DELETE 即为
  ///true；建立连接的保留选项取此值，Core 要求一致。
  final bool? retainOnTenantDelete;
  final List<String> secretKeys;
  final ComponentReleaseStatus status;
  final List<GatewayMcpReleaseTool> tools;
  final String version;

  GatewayMcpReleaseView({
    required this.adapterBuildRef,
    this.adapterServiceRef,
    required this.allowedModelCallModes,
    this.bindingConfigSchemaJson,
    required this.bindingIds,
    required this.capabilityCategories,
    required this.componentReleaseId,
    required this.componentTypeKey,
    required this.deliveryFacts,
    this.nativeInstanceRef,
    this.retainOnTenantDelete,
    required this.secretKeys,
    required this.status,
    required this.tools,
    required this.version,
  });

  factory GatewayMcpReleaseView.fromJson(Map<String, dynamic> json) =>
      GatewayMcpReleaseView(
        adapterBuildRef: json["adapterBuildRef"],
        adapterServiceRef: json["adapterServiceRef"],
        allowedModelCallModes: List<ApplicationModelCallMode>.from(
          json["allowedModelCallModes"].map(
            (x) => applicationModelCallModeValues.map[x]!,
          ),
        ),
        bindingConfigSchemaJson: json["bindingConfigSchemaJson"],
        bindingIds: List<String>.from(json["bindingIds"].map((x) => x)),
        capabilityCategories: List<GatewayMcpReleaseCategory>.from(
          json["capabilityCategories"].map(
            (x) => GatewayMcpReleaseCategory.fromJson(x),
          ),
        ),
        componentReleaseId: json["componentReleaseId"],
        componentTypeKey: json["componentTypeKey"],
        deliveryFacts: List<GatewayMcpBindingFact>.from(
          json["deliveryFacts"].map((x) => GatewayMcpBindingFact.fromJson(x)),
        ),
        nativeInstanceRef: json["nativeInstanceRef"],
        retainOnTenantDelete: json["retainOnTenantDelete"],
        secretKeys: List<String>.from(json["secretKeys"].map((x) => x)),
        status: componentReleaseStatusValues.map[json["status"]]!,
        tools: List<GatewayMcpReleaseTool>.from(
          json["tools"].map((x) => GatewayMcpReleaseTool.fromJson(x)),
        ),
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "adapterBuildRef": adapterBuildRef,
    "adapterServiceRef": adapterServiceRef,
    "allowedModelCallModes": List<dynamic>.from(
      allowedModelCallModes.map(
        (x) => applicationModelCallModeValues.reverse[x],
      ),
    ),
    "bindingConfigSchemaJson": bindingConfigSchemaJson,
    "bindingIds": List<dynamic>.from(bindingIds.map((x) => x)),
    "capabilityCategories": List<dynamic>.from(
      capabilityCategories.map((x) => x.toJson()),
    ),
    "componentReleaseId": componentReleaseId,
    "componentTypeKey": componentTypeKey,
    "deliveryFacts": List<dynamic>.from(deliveryFacts.map((x) => x.toJson())),
    "nativeInstanceRef": nativeInstanceRef,
    "retainOnTenantDelete": retainOnTenantDelete,
    "secretKeys": List<dynamic>.from(secretKeys.map((x) => x)),
    "status": componentReleaseStatusValues.reverse[status],
    "tools": List<dynamic>.from(tools.map((x) => x.toJson())),
    "version": version,
  });
}

enum ApplicationModelCallMode { NONE, PLATFORM_LLM_ROUTE, SELF_MANAGED_MODEL }

final applicationModelCallModeValues = EnumValues({
  "NONE": ApplicationModelCallMode.NONE,
  "PLATFORM_LLM_ROUTE": ApplicationModelCallMode.PLATFORM_LLM_ROUTE,
  "SELF_MANAGED_MODEL": ApplicationModelCallMode.SELF_MANAGED_MODEL,
});

class GatewayMcpReleaseCategory {
  final String category;
  final int version;

  GatewayMcpReleaseCategory({required this.category, required this.version});

  factory GatewayMcpReleaseCategory.fromJson(Map<String, dynamic> json) =>
      GatewayMcpReleaseCategory(
        category: json["category"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"category": category, "version": version});
}

class GatewayMcpReleaseTool {
  final String actionKey;
  final String capabilityContractKey;
  final String name;

  GatewayMcpReleaseTool({
    required this.actionKey,
    required this.capabilityContractKey,
    required this.name,
  });

  factory GatewayMcpReleaseTool.fromJson(Map<String, dynamic> json) =>
      GatewayMcpReleaseTool(
        actionKey: json["actionKey"],
        capabilityContractKey: json["capabilityContractKey"],
        name: json["name"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "capabilityContractKey": capabilityContractKey,
    "name": name,
  });
}

///DD-134(7)：本 Tenant 的 llm_route Resource（按 discover 过滤）与时间窗用量；新建沿 llm_route.create，停用沿
///llm_route.disable。
class GatewayModelRoutePage {
  final bool canCreate;
  final String from;
  final int? nextOffset;
  final List<GatewayModelRouteView> routes;
  final String to;

  GatewayModelRoutePage({
    required this.canCreate,
    required this.from,
    this.nextOffset,
    required this.routes,
    required this.to,
  });

  factory GatewayModelRoutePage.fromJson(Map<String, dynamic> json) =>
      GatewayModelRoutePage(
        canCreate: json["canCreate"],
        from: json["from"],
        nextOffset: json["nextOffset"],
        routes: List<GatewayModelRouteView>.from(
          json["routes"].map((x) => GatewayModelRouteView.fromJson(x)),
        ),
        to: json["to"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "canCreate": canCreate,
    "from": from,
    "nextOffset": nextOffset,
    "routes": List<dynamic>.from(routes.map((x) => x.toJson())),
    "to": to,
  });
}

class GatewayModelRouteView {
  final int bindingCount;
  final bool canDisable;
  final int? failed;
  final String? homeWorkspaceId;
  final int installationCount;
  final String? model;
  final int? modelP95Ms;
  final String nativeId;
  final String ownerPrincipalId;
  final String? provider;
  final int? requests;
  final String resourceId;
  final ResourceState resourceState;
  final int resourceVersion;
  final int? totalTokens;

  GatewayModelRouteView({
    required this.bindingCount,
    required this.canDisable,
    this.failed,
    this.homeWorkspaceId,
    required this.installationCount,
    this.model,
    this.modelP95Ms,
    required this.nativeId,
    required this.ownerPrincipalId,
    this.provider,
    this.requests,
    required this.resourceId,
    required this.resourceState,
    required this.resourceVersion,
    this.totalTokens,
  });

  factory GatewayModelRouteView.fromJson(Map<String, dynamic> json) =>
      GatewayModelRouteView(
        bindingCount: json["bindingCount"],
        canDisable: json["canDisable"],
        failed: json["failed"],
        homeWorkspaceId: json["homeWorkspaceId"],
        installationCount: json["installationCount"],
        model: json["model"],
        modelP95Ms: json["modelP95Ms"],
        nativeId: json["nativeId"],
        ownerPrincipalId: json["ownerPrincipalId"],
        provider: json["provider"],
        requests: json["requests"],
        resourceId: json["resourceId"],
        resourceState: resourceStateValues.map[json["resourceState"]]!,
        resourceVersion: json["resourceVersion"],
        totalTokens: json["totalTokens"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingCount": bindingCount,
    "canDisable": canDisable,
    "failed": failed,
    "homeWorkspaceId": homeWorkspaceId,
    "installationCount": installationCount,
    "model": model,
    "modelP95Ms": modelP95Ms,
    "nativeId": nativeId,
    "ownerPrincipalId": ownerPrincipalId,
    "provider": provider,
    "requests": requests,
    "resourceId": resourceId,
    "resourceState": resourceStateValues.reverse[resourceState],
    "resourceVersion": resourceVersion,
    "totalTokens": totalTokens,
  });
}

///DD-134(7)：Gateway 中已存在、尚未被 llm_route 引用的原生 provider 与 model ConfigResource（打码），供
///llm_route.create 选择；revision 与 sha256 为 Core 回读值。
class GatewayModelSourcePage {
  final List<GatewayModelSource> sources;

  GatewayModelSourcePage({required this.sources});

  factory GatewayModelSourcePage.fromJson(Map<String, dynamic> json) =>
      GatewayModelSourcePage(
        sources: List<GatewayModelSource>.from(
          json["sources"].map((x) => GatewayModelSource.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "sources": List<dynamic>.from(sources.map((x) => x.toJson())),
  });
}

class GatewayModelSource {
  final bool? credentialRequired;
  final ModelClass model;
  final String modelName;
  final ProviderClass provider;
  final String providerType;

  GatewayModelSource({
    this.credentialRequired,
    required this.model,
    required this.modelName,
    required this.provider,
    required this.providerType,
  });

  factory GatewayModelSource.fromJson(Map<String, dynamic> json) =>
      GatewayModelSource(
        credentialRequired: json["credentialRequired"],
        model: ModelClass.fromJson(json["model"]),
        modelName: json["modelName"],
        provider: ProviderClass.fromJson(json["provider"]),
        providerType: json["providerType"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "credentialRequired": credentialRequired,
    "model": model.toJson(),
    "modelName": modelName,
    "provider": provider.toJson(),
    "providerType": providerType,
  });
}

class ModelClass {
  final String id;
  final int revision;
  final String sha256;

  ModelClass({required this.id, required this.revision, required this.sha256});

  factory ModelClass.fromJson(Map<String, dynamic> json) => ModelClass(
    id: json["id"],
    revision: json["revision"],
    sha256: json["sha256"],
  );

  Map<String, dynamic> toJson() =>
      _stripNulls({"id": id, "revision": revision, "sha256": sha256});
}

class ProviderClass {
  final String id;
  final int revision;
  final String sha256;

  ProviderClass({
    required this.id,
    required this.revision,
    required this.sha256,
  });

  factory ProviderClass.fromJson(Map<String, dynamic> json) => ProviderClass(
    id: json["id"],
    revision: json["revision"],
    sha256: json["sha256"],
  );

  Map<String, dynamic> toJson() =>
      _stripNulls({"id": id, "revision": revision, "sha256": sha256});
}

///DD-134(3)：时间窗内按一个维度的聚合与时间桶。每次请求实时计算；扫描原始记录超出上限时 truncated=true，结果只基于已扫描部分。
class GatewayStats {
  final List<GatewayStatsBucket> buckets;
  final int bucketSeconds;
  final GatewayStatsDimension dimension;
  final String from;

  ///Gateway request log 是否可读；false 时模型调用计数缺失，不显示为零。
  final bool modelLogAvailable;
  final List<GatewayStatsRow> rows;
  final GatewayAdminScope scope;
  final String to;
  final GatewayStatsCounters totals;
  final bool truncated;
  final String? workspaceId;

  GatewayStats({
    required this.buckets,
    required this.bucketSeconds,
    required this.dimension,
    required this.from,
    required this.modelLogAvailable,
    required this.rows,
    required this.scope,
    required this.to,
    required this.totals,
    required this.truncated,
    this.workspaceId,
  });

  factory GatewayStats.fromJson(Map<String, dynamic> json) => GatewayStats(
    buckets: List<GatewayStatsBucket>.from(
      json["buckets"].map((x) => GatewayStatsBucket.fromJson(x)),
    ),
    bucketSeconds: json["bucketSeconds"],
    dimension: gatewayStatsDimensionValues.map[json["dimension"]]!,
    from: json["from"],
    modelLogAvailable: json["modelLogAvailable"],
    rows: List<GatewayStatsRow>.from(
      json["rows"].map((x) => GatewayStatsRow.fromJson(x)),
    ),
    scope: gatewayAdminScopeValues.map[json["scope"]]!,
    to: json["to"],
    totals: GatewayStatsCounters.fromJson(json["totals"]),
    truncated: json["truncated"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "buckets": List<dynamic>.from(buckets.map((x) => x.toJson())),
    "bucketSeconds": bucketSeconds,
    "dimension": gatewayStatsDimensionValues.reverse[dimension],
    "from": from,
    "modelLogAvailable": modelLogAvailable,
    "rows": List<dynamic>.from(rows.map((x) => x.toJson())),
    "scope": gatewayAdminScopeValues.reverse[scope],
    "to": to,
    "totals": totals.toJson(),
    "truncated": truncated,
    "workspaceId": workspaceId,
  });
}

class GatewayStatsBucket {
  final int denied;
  final int failed;
  final int requests;
  final String start;
  final int totalTokens;

  GatewayStatsBucket({
    required this.denied,
    required this.failed,
    required this.requests,
    required this.start,
    required this.totalTokens,
  });

  factory GatewayStatsBucket.fromJson(Map<String, dynamic> json) =>
      GatewayStatsBucket(
        denied: json["denied"],
        failed: json["failed"],
        requests: json["requests"],
        start: json["start"],
        totalTokens: json["totalTokens"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "denied": denied,
    "failed": failed,
    "requests": requests,
    "start": start,
    "totalTokens": totalTokens,
  });
}

///DD-134(3)④：聚合维度。TOOL、AGENT、BINDING 只在 TENANT 范围可用；TENANT 只在 PLATFORM 范围可用。
enum GatewayStatsDimension { AGENT, BINDING, MODEL_ROUTE, TENANT, TOOL }

final gatewayStatsDimensionValues = EnumValues({
  "AGENT": GatewayStatsDimension.AGENT,
  "BINDING": GatewayStatsDimension.BINDING,
  "MODEL_ROUTE": GatewayStatsDimension.MODEL_ROUTE,
  "TENANT": GatewayStatsDimension.TENANT,
  "TOOL": GatewayStatsDimension.TOOL,
});

class GatewayStatsRow {
  final GatewayStatsCounters counters;

  ///维度键：llm_route Resource ID 或 Gateway route 名、Tool Resource ID、Installation Resource
  ///ID、binding ID 或 Tenant ID；UNATTRIBUTED 为无法归属的记录。
  final String key;
  final GatewayCallKind? kind;

  ///受权的展示名（工具名、Agent 名、模型名）；平台范围不含业务名称。
  final String? label;

  GatewayStatsRow({
    required this.counters,
    required this.key,
    this.kind,
    this.label,
  });

  factory GatewayStatsRow.fromJson(Map<String, dynamic> json) =>
      GatewayStatsRow(
        counters: GatewayStatsCounters.fromJson(json["counters"]),
        key: json["key"],
        kind: json["kind"] == null
            ? null
            : gatewayCallKindValues.map[json["kind"]]!,
        label: json["label"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "counters": counters.toJson(),
    "key": key,
    "kind": gatewayCallKindValues.reverse[kind],
    "label": label,
  });
}

///DD-134(3)④：计数与分位数。错误率由呈现层按 failed/requests 计算；模型与工具时延分列，不混算。
class GatewayStatsCounters {
  ///模型调用：Gateway 日志已有而没有 durable UsageEvent 或已记 BILLING_UNAVAILABLE 审计的次数（14 §8）。
  final int billingUnavailable;
  final int denied;
  final int failed;
  final int inputTokens;

  ///模型调用 Gateway durationMs 的 P50；没有模型调用时省略。
  final int? modelP50Ms;
  final int? modelP95Ms;
  final int outputTokens;
  final int requests;
  final int running;
  final int succeeded;

  ///工具调用 Core 观测时延（INTENT 到 OUTCOME）的 P50；没有已终结工具调用时省略。
  final int? toolP50Ms;
  final int? toolP95Ms;
  final int totalTokens;
  final int unknown;

  GatewayStatsCounters({
    required this.billingUnavailable,
    required this.denied,
    required this.failed,
    required this.inputTokens,
    this.modelP50Ms,
    this.modelP95Ms,
    required this.outputTokens,
    required this.requests,
    required this.running,
    required this.succeeded,
    this.toolP50Ms,
    this.toolP95Ms,
    required this.totalTokens,
    required this.unknown,
  });

  factory GatewayStatsCounters.fromJson(Map<String, dynamic> json) =>
      GatewayStatsCounters(
        billingUnavailable: json["billingUnavailable"],
        denied: json["denied"],
        failed: json["failed"],
        inputTokens: json["inputTokens"],
        modelP50Ms: json["modelP50Ms"],
        modelP95Ms: json["modelP95Ms"],
        outputTokens: json["outputTokens"],
        requests: json["requests"],
        running: json["running"],
        succeeded: json["succeeded"],
        toolP50Ms: json["toolP50Ms"],
        toolP95Ms: json["toolP95Ms"],
        totalTokens: json["totalTokens"],
        unknown: json["unknown"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "billingUnavailable": billingUnavailable,
    "denied": denied,
    "failed": failed,
    "inputTokens": inputTokens,
    "modelP50Ms": modelP50Ms,
    "modelP95Ms": modelP95Ms,
    "outputTokens": outputTokens,
    "requests": requests,
    "running": running,
    "succeeded": succeeded,
    "toolP50Ms": toolP50Ms,
    "toolP95Ms": toolP95Ms,
    "totalTokens": totalTokens,
    "unknown": unknown,
  });
}

///DD-134(6)：本 Tenant 的 PLATFORM_NATIVE 与 APPLICATION 工具（按 Tool Resource discover
///过滤），附时间窗内调用统计。停用只作用于所属连接；PLATFORM_NATIVE 无启停入口。
class GatewayToolPage {
  final String from;
  final int? nextOffset;
  final String to;
  final List<GatewayToolView> tools;

  GatewayToolPage({
    required this.from,
    this.nextOffset,
    required this.to,
    required this.tools,
  });

  factory GatewayToolPage.fromJson(Map<String, dynamic> json) =>
      GatewayToolPage(
        from: json["from"],
        nextOffset: json["nextOffset"],
        to: json["to"],
        tools: List<GatewayToolView>.from(
          json["tools"].map((x) => GatewayToolView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "from": from,
    "nextOffset": nextOffset,
    "to": to,
    "tools": List<dynamic>.from(tools.map((x) => x.toJson())),
  });
}

class GatewayToolView {
  final String actionKey;
  final String? applicationBindingId;
  final int? applicationBindingVersion;
  final ApplicationBindingState? bindingState;
  final String? bindingWorkspaceId;
  final bool canDisableBinding;

  ///契约 permission 为 discover、consume 或 read，且存在本人可作用的 ACTIVE 目标 Resource 与有效结果策略；最终准入仍在提交时
  ///fresh 重做。
  final bool canTestCall;
  final String? capabilityContractKey;
  final String? componentReleaseId;
  final String? componentTypeKey;
  final CapabilityPermission? contractPermission;
  final int denied;
  final int failed;

  ///仅 USER_REGISTERED_EXTERNAL（DD-149）：所属连接器
  final String? mcpConnectionId;

  ///仅 USER_REGISTERED_EXTERNAL：连接器显示名
  final String? mcpConnectionName;
  final String name;
  final String? releaseVersion;
  final int requests;
  final String resourceId;
  final ResourceState resourceState;
  final int resourceVersion;
  final AgentInstallationToolSource source;
  final GatewayToolTestCall? testCall;
  final int? toolP95Ms;

  GatewayToolView({
    required this.actionKey,
    this.applicationBindingId,
    this.applicationBindingVersion,
    this.bindingState,
    this.bindingWorkspaceId,
    required this.canDisableBinding,
    required this.canTestCall,
    this.capabilityContractKey,
    this.componentReleaseId,
    this.componentTypeKey,
    this.contractPermission,
    required this.denied,
    required this.failed,
    this.mcpConnectionId,
    this.mcpConnectionName,
    required this.name,
    this.releaseVersion,
    required this.requests,
    required this.resourceId,
    required this.resourceState,
    required this.resourceVersion,
    required this.source,
    this.testCall,
    this.toolP95Ms,
  });

  factory GatewayToolView.fromJson(Map<String, dynamic> json) =>
      GatewayToolView(
        actionKey: json["actionKey"],
        applicationBindingId: json["applicationBindingId"],
        applicationBindingVersion: json["applicationBindingVersion"],
        bindingState: json["bindingState"] == null
            ? null
            : applicationBindingStateValues.map[json["bindingState"]]!,
        bindingWorkspaceId: json["bindingWorkspaceId"],
        canDisableBinding: json["canDisableBinding"],
        canTestCall: json["canTestCall"],
        capabilityContractKey: json["capabilityContractKey"],
        componentReleaseId: json["componentReleaseId"],
        componentTypeKey: json["componentTypeKey"],
        contractPermission: json["contractPermission"] == null
            ? null
            : capabilityPermissionValues.map[json["contractPermission"]]!,
        denied: json["denied"],
        failed: json["failed"],
        mcpConnectionId: json["mcpConnectionId"],
        mcpConnectionName: json["mcpConnectionName"],
        name: json["name"],
        releaseVersion: json["releaseVersion"],
        requests: json["requests"],
        resourceId: json["resourceId"],
        resourceState: resourceStateValues.map[json["resourceState"]]!,
        resourceVersion: json["resourceVersion"],
        source: agentInstallationToolSourceValues.map[json["source"]]!,
        testCall: json["testCall"] == null
            ? null
            : GatewayToolTestCall.fromJson(json["testCall"]),
        toolP95Ms: json["toolP95Ms"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "applicationBindingId": applicationBindingId,
    "applicationBindingVersion": applicationBindingVersion,
    "bindingState": applicationBindingStateValues.reverse[bindingState],
    "bindingWorkspaceId": bindingWorkspaceId,
    "canDisableBinding": canDisableBinding,
    "canTestCall": canTestCall,
    "capabilityContractKey": capabilityContractKey,
    "componentReleaseId": componentReleaseId,
    "componentTypeKey": componentTypeKey,
    "contractPermission":
        capabilityPermissionValues.reverse[contractPermission],
    "denied": denied,
    "failed": failed,
    "mcpConnectionId": mcpConnectionId,
    "mcpConnectionName": mcpConnectionName,
    "name": name,
    "releaseVersion": releaseVersion,
    "requests": requests,
    "resourceId": resourceId,
    "resourceState": resourceStateValues.reverse[resourceState],
    "resourceVersion": resourceVersion,
    "source": agentInstallationToolSourceValues.reverse[source],
    "testCall": testCall?.toJson(),
    "toolP95Ms": toolP95Ms,
  });
}

class GatewayToolTestCall {
  final String actionKey;
  final int actionVersion;

  ///契约固定的输入 schema（canonical JSON）。
  final String inputSchemaJson;
  final String resultExposurePolicyId;
  final int resultExposurePolicyVersion;
  final List<GatewayToolTestTarget> targets;

  GatewayToolTestCall({
    required this.actionKey,
    required this.actionVersion,
    required this.inputSchemaJson,
    required this.resultExposurePolicyId,
    required this.resultExposurePolicyVersion,
    required this.targets,
  });

  factory GatewayToolTestCall.fromJson(Map<String, dynamic> json) =>
      GatewayToolTestCall(
        actionKey: json["actionKey"],
        actionVersion: json["actionVersion"],
        inputSchemaJson: json["inputSchemaJson"],
        resultExposurePolicyId: json["resultExposurePolicyId"],
        resultExposurePolicyVersion: json["resultExposurePolicyVersion"],
        targets: List<GatewayToolTestTarget>.from(
          json["targets"].map((x) => GatewayToolTestTarget.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "actionVersion": actionVersion,
    "inputSchemaJson": inputSchemaJson,
    "resultExposurePolicyId": resultExposurePolicyId,
    "resultExposurePolicyVersion": resultExposurePolicyVersion,
    "targets": List<dynamic>.from(targets.map((x) => x.toJson())),
  });
}

class GatewayToolTestTarget {
  final String displayName;
  final String resourceId;
  final int resourceVersion;
  final String? workspaceId;

  GatewayToolTestTarget({
    required this.displayName,
    required this.resourceId,
    required this.resourceVersion,
    this.workspaceId,
  });

  factory GatewayToolTestTarget.fromJson(Map<String, dynamic> json) =>
      GatewayToolTestTarget(
        displayName: json["displayName"],
        resourceId: json["resourceId"],
        resourceVersion: json["resourceVersion"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "displayName": displayName,
    "resourceId": resourceId,
    "resourceVersion": resourceVersion,
    "workspaceId": workspaceId,
  });
}

///DD-134(6)：网关管理区测试调用的同请求回应。submission 是该工具 ActionDefinition 的准入与派发结论；resultJson
///只在本次调用已确定成功时出现，是经 ExtMcp 按冻结 ResultExposurePolicy 与输出 schema 过滤后的 canonical
///JSON，只回给发起人本人且 Core 不保存；toolError 为真表示原生工具返回了错误结果（不含正文）。结果不明时两者都缺省，ActionExecution 停在
///UNKNOWN，不重放。
class GatewayToolTestCallResult {
  final String? resultJson;
  final ActionSubmission submission;
  final bool? toolError;

  GatewayToolTestCallResult({
    this.resultJson,
    required this.submission,
    this.toolError,
  });

  factory GatewayToolTestCallResult.fromJson(Map<String, dynamic> json) =>
      GatewayToolTestCallResult(
        resultJson: json["resultJson"],
        submission: ActionSubmission.fromJson(json["submission"]),
        toolError: json["toolError"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "resultJson": resultJson,
    "submission": submission.toJson(),
    "toolError": toolError,
  });
}

///POST /api/v1/actions 的回应：本次 operation 的门禁与调度状态。gateState=WAITING 时 approvalWorkflowId
///必有；DENIED 时 reason 必有。invitation 只在 tenant.member.invite
///的首次回应中出现，同一幂等键的重放不再给出（DD-83）。webhookSecret 同理，只在生成或轮换 WEBHOOK 密钥的 automation.enable /
///automation.rotate_webhook_secret 首次回应中出现（DD-116）。
class ActionSubmission {
  final String actionExecutionId;
  final String actionKey;
  final String? approvalWorkflowId;
  final ActionDispatchState dispatchState;
  final DocumentLaunchDescriptor? documentLaunch;
  final ActionGateState gateState;

  ///仅 huddle.start（DD-125(3)）：Core 预分配的 HuddleBuzzBinding；同一幂等键的重放给出同一值
  final String? huddleId;
  final IssuedInvitation? invitation;
  final String operationId;
  final String? protocolSessionId;
  final ReasonCode? reason;
  final AutomationWebhookSecret? webhookSecret;
  final String? workflowId;

  ActionSubmission({
    required this.actionExecutionId,
    required this.actionKey,
    this.approvalWorkflowId,
    required this.dispatchState,
    this.documentLaunch,
    required this.gateState,
    this.huddleId,
    this.invitation,
    required this.operationId,
    this.protocolSessionId,
    this.reason,
    this.webhookSecret,
    this.workflowId,
  });

  factory ActionSubmission.fromJson(Map<String, dynamic> json) =>
      ActionSubmission(
        actionExecutionId: json["actionExecutionId"],
        actionKey: json["actionKey"],
        approvalWorkflowId: json["approvalWorkflowId"],
        dispatchState: actionDispatchStateValues.map[json["dispatchState"]]!,
        documentLaunch: json["documentLaunch"] == null
            ? null
            : DocumentLaunchDescriptor.fromJson(json["documentLaunch"]),
        gateState: actionGateStateValues.map[json["gateState"]]!,
        huddleId: json["huddleId"],
        invitation: json["invitation"] == null
            ? null
            : IssuedInvitation.fromJson(json["invitation"]),
        operationId: json["operationId"],
        protocolSessionId: json["protocolSessionId"],
        reason: json["reason"] == null
            ? null
            : reasonCodeValues.map[json["reason"]]!,
        webhookSecret: json["webhookSecret"] == null
            ? null
            : AutomationWebhookSecret.fromJson(json["webhookSecret"]),
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "approvalWorkflowId": approvalWorkflowId,
    "dispatchState": actionDispatchStateValues.reverse[dispatchState],
    "documentLaunch": documentLaunch?.toJson(),
    "gateState": actionGateStateValues.reverse[gateState],
    "huddleId": huddleId,
    "invitation": invitation?.toJson(),
    "operationId": operationId,
    "protocolSessionId": protocolSessionId,
    "reason": reasonCodeValues.reverse[reason],
    "webhookSecret": webhookSecret?.toJson(),
    "workflowId": workflowId,
  });
}

///tenant.member.invite 首次回应里一次性出现的邀请（DD-83）。link 含明文凭据（在 URL fragment
///里），服务端只存其摘要，之后任何回应都不再给出；丢失即撤回重发。
class IssuedInvitation {
  ///RFC3339，UTC
  final String expiresAt;
  final String invitationId;

  ///部署登记的链接基址 + '#' + 一次性凭据
  final String link;

  IssuedInvitation({
    required this.expiresAt,
    required this.invitationId,
    required this.link,
  });

  factory IssuedInvitation.fromJson(Map<String, dynamic> json) =>
      IssuedInvitation(
        expiresAt: json["expiresAt"],
        invitationId: json["invitationId"],
        link: json["link"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "expiresAt": expiresAt,
    "invitationId": invitationId,
    "link": link,
  });
}

///DD-116：WEBHOOK 触发密钥的唯一一次明文交付。只出现在生成或轮换该密钥的那次 ActionSubmission 中；之后只给出
///AutomationView.webhookSecretHint。投递方用它按 Standard Webhooks 对
///`{webhook-id}.{webhook-timestamp}.{正文}` 计算 HMAC-SHA256。
class AutomationWebhookSecret {
  final String automationResourceId;
  final String hint;

  ///32 字节随机密钥的 base64 展示形式。
  final String secret;

  ///公开投递地址；部署未配置公开基址时省略。
  final String? url;

  AutomationWebhookSecret({
    required this.automationResourceId,
    required this.hint,
    required this.secret,
    this.url,
  });

  factory AutomationWebhookSecret.fromJson(Map<String, dynamic> json) =>
      AutomationWebhookSecret(
        automationResourceId: json["automationResourceId"],
        hint: json["hint"],
        secret: json["secret"],
        url: json["url"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "automationResourceId": automationResourceId,
    "hint": hint,
    "secret": secret,
    "url": url,
  });
}

///POST /api/v1/huddles/{huddleId}/announcement（仅 Web 创建者，DD-125(3)）：BFF 以本人 SERVER 身份为
///ACTIVE 的 Huddle 各签一次 48106（临时频道，原 voice_mode_guidelines 正文）与 48100（父频道，content 为
///ephemeral_channel_id），签名事件随绑定持久化，重试只重投同一事件、不重签（DD-81）。48106 按原版尽力发布，48100 是必需的发现链接。
class HuddleAnnouncementView {
  ///48106 事件 ID；尽力发布
  final String? guidelinesEventId;

  ///Relay 已接受或回读到 48100
  final bool startedDelivered;

  ///48100 事件 ID
  final String startedEventId;

  HuddleAnnouncementView({
    this.guidelinesEventId,
    required this.startedDelivered,
    required this.startedEventId,
  });

  factory HuddleAnnouncementView.fromJson(Map<String, dynamic> json) =>
      HuddleAnnouncementView(
        guidelinesEventId: json["guidelinesEventId"],
        startedDelivered: json["startedDelivered"],
        startedEventId: json["startedEventId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "guidelinesEventId": guidelinesEventId,
    "startedDelivered": startedDelivered,
    "startedEventId": startedEventId,
  });
}

///GET /api/v1/huddles/{huddleId}/lifecycle：该 Huddle 在父频道中的生命周期事件（按 created_at 升序）与 Relay
///合成的存活（48104，房间非空才为 true），供原 huddlePresence 重建参与者与卡片状态。
class HuddleLifecyclePage {
  final List<HuddleLifecycleEvent> events;

  ///Relay 48104 存活查询是否返回该会话
  final bool live;

  HuddleLifecyclePage({required this.events, required this.live});

  factory HuddleLifecyclePage.fromJson(Map<String, dynamic> json) =>
      HuddleLifecyclePage(
        events: List<HuddleLifecycleEvent>.from(
          json["events"].map((x) => HuddleLifecycleEvent.fromJson(x)),
        ),
        live: json["live"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "events": List<dynamic>.from(events.map((x) => x.toJson())),
    "live": live,
  });
}

///父频道中一条原版 Huddle 生命周期事件（kind 48100–48103，SF-BUZ-53），由 BFF 以本人身份读取并校验签名：48100
///只取临时频道创建者签名，48101/48102 只取 Relay 签名，48103 取创建者或 Relay 签名。content 按原 JSON 解析为下列字段，未知字段丢弃。
class HuddleLifecycleEvent {
  final String? admissionId;

  ///事件 created_at（Unix 秒）
  final int createdAt;
  final String ephemeralChannelId;
  final String eventId;
  final String? generation;
  final int kind;

  ///48101/48102 的 p 标签
  final String? participantPubkey;

  ///签名者公钥
  final String pubkey;
  final int? rosterRevision;

  HuddleLifecycleEvent({
    this.admissionId,
    required this.createdAt,
    required this.ephemeralChannelId,
    required this.eventId,
    this.generation,
    required this.kind,
    this.participantPubkey,
    required this.pubkey,
    this.rosterRevision,
  });

  factory HuddleLifecycleEvent.fromJson(Map<String, dynamic> json) =>
      HuddleLifecycleEvent(
        admissionId: json["admissionId"],
        createdAt: json["createdAt"],
        ephemeralChannelId: json["ephemeralChannelId"],
        eventId: json["eventId"],
        generation: json["generation"],
        kind: json["kind"],
        participantPubkey: json["participantPubkey"],
        pubkey: json["pubkey"],
        rosterRevision: json["rosterRevision"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "admissionId": admissionId,
    "createdAt": createdAt,
    "ephemeralChannelId": ephemeralChannelId,
    "eventId": eventId,
    "generation": generation,
    "kind": kind,
    "participantPubkey": participantPubkey,
    "pubkey": pubkey,
    "rosterRevision": rosterRevision,
  });
}

///GET /api/v1/huddles：一个父 Workspace 或父私聊中本人可见、尚未结束的 Huddle（PROVISIONING 或 ACTIVE），按创建时间倒序。
class HuddlePage {
  final List<HuddleView> items;

  HuddlePage({required this.items});

  factory HuddlePage.fromJson(Map<String, dynamic> json) => HuddlePage(
    items: List<HuddleView>.from(
      json["items"].map((x) => HuddleView.fromJson(x)),
    ),
  );

  Map<String, dynamic> toJson() =>
      _stripNulls({"items": List<dynamic>.from(items.map((x) => x.toJson()))});
}

///本人可见的一个原版 Huddle 临时频道投影（HuddleBuzzBinding，DD-125(3)）。只含平台引用与状态，不含音频、参与者音频状态或消息正文；参与者与存活由
///Relay 的 48101–48104 呈现。
class HuddleView {
  final List<String> agentInstallationResourceIds;

  ///Core 预分配的临时 Channel UUID（原 ephemeral_channel_id）
  final String channelId;
  final String channelName;
  final String createdAt;

  ///临时频道 created_by：本人发起会话的 HUMAN 公钥
  final String creatorPubkey;
  final String? endedAt;
  final String huddleId;
  final String initiatorPrincipalId;

  ///发起该 Huddle 的 huddle.start operation
  final String operationId;
  final String parentChannelId;
  final String? parentConversationId;
  final String? parentWorkspaceId;
  final HuddleState state;
  final int version;

  HuddleView({
    required this.agentInstallationResourceIds,
    required this.channelId,
    required this.channelName,
    required this.createdAt,
    required this.creatorPubkey,
    this.endedAt,
    required this.huddleId,
    required this.initiatorPrincipalId,
    required this.operationId,
    required this.parentChannelId,
    this.parentConversationId,
    this.parentWorkspaceId,
    required this.state,
    required this.version,
  });

  factory HuddleView.fromJson(Map<String, dynamic> json) => HuddleView(
    agentInstallationResourceIds: List<String>.from(
      json["agentInstallationResourceIds"].map((x) => x),
    ),
    channelId: json["channelId"],
    channelName: json["channelName"],
    createdAt: json["createdAt"],
    creatorPubkey: json["creatorPubkey"],
    endedAt: json["endedAt"],
    huddleId: json["huddleId"],
    initiatorPrincipalId: json["initiatorPrincipalId"],
    operationId: json["operationId"],
    parentChannelId: json["parentChannelId"],
    parentConversationId: json["parentConversationId"],
    parentWorkspaceId: json["parentWorkspaceId"],
    state: huddleStateValues.map[json["state"]]!,
    version: json["version"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentInstallationResourceIds": List<dynamic>.from(
      agentInstallationResourceIds.map((x) => x),
    ),
    "channelId": channelId,
    "channelName": channelName,
    "createdAt": createdAt,
    "creatorPubkey": creatorPubkey,
    "endedAt": endedAt,
    "huddleId": huddleId,
    "initiatorPrincipalId": initiatorPrincipalId,
    "operationId": operationId,
    "parentChannelId": parentChannelId,
    "parentConversationId": parentConversationId,
    "parentWorkspaceId": parentWorkspaceId,
    "state": huddleStateValues.reverse[state],
    "version": version,
  });
}

///HuddleBuzzBinding 状态（03 §2、DD-125(3)）：PROVISIONING 为 CONTROL 9007/9000 投影尚未回读一致（结果不明保留并按
///Channel UUID 对账）；ACTIVE 为投影回读一致；ENDED 为观察到 48103 或临时频道已归档，终态、不复用；ERROR 为 Relay
///确定拒绝投影，不再签发。
enum HuddleState { ACTIVE, ENDED, ERROR, PROVISIONING }

final huddleStateValues = EnumValues({
  "ACTIVE": HuddleState.ACTIVE,
  "ENDED": HuddleState.ENDED,
  "ERROR": HuddleState.ERROR,
  "PROVISIONING": HuddleState.PROVISIONING,
});

///GET /api/v1/huddles/voice：Web Huddle
///的转写与朗读是否可用（DD-125(3)、V-SCN-160）。不可用时通话、加入、发言、收听与离开不受影响。
class HuddleVoiceView {
  final HuddleVoiceAvailability speech;
  final HuddleVoiceAvailability transcription;

  HuddleVoiceView({required this.speech, required this.transcription});

  factory HuddleVoiceView.fromJson(Map<String, dynamic> json) =>
      HuddleVoiceView(
        speech: huddleVoiceAvailabilityValues.map[json["speech"]]!,
        transcription:
            huddleVoiceAvailabilityValues.map[json["transcription"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "speech": huddleVoiceAvailabilityValues.reverse[speech],
    "transcription": huddleVoiceAvailabilityValues.reverse[transcription],
  });
}

///Web Huddle 转写或朗读的可用性（DD-125(3)、V-SCN-160）：UNAVAILABLE 为 Huddle
///语音推理服务未部署、超出部署登记的并发上界或不可用，此时按原版“仅语音模式”显示不可用而通话照常。
enum HuddleVoiceAvailability { AVAILABLE, UNAVAILABLE }

final huddleVoiceAvailabilityValues = EnumValues({
  "AVAILABLE": HuddleVoiceAvailability.AVAILABLE,
  "UNAVAILABLE": HuddleVoiceAvailability.UNAVAILABLE,
});

///POST /api/v1/invitations/redeem 的回应与 GET /api/v1/invitations/redemptions
///的元素：兑换者自己看到的进度（DD-83）。membershipState=INVITED 且 admissionGateState=WAITING 表示等待 Tenant
///admin 确认；ACTIVE 即可登录该 Tenant；REVOKED 即本次邀请已终结，reason 给出原因。
class InvitationRedemptionView {
  final ActionGateState admissionGateState;
  final String invitationId;
  final TenantMembershipState membershipState;
  final ReasonCode? reason;

  ///RFC3339，UTC
  final String redeemedAt;
  final String tenantId;
  final String tenantName;

  InvitationRedemptionView({
    required this.admissionGateState,
    required this.invitationId,
    required this.membershipState,
    this.reason,
    required this.redeemedAt,
    required this.tenantId,
    required this.tenantName,
  });

  factory InvitationRedemptionView.fromJson(
    Map<String, dynamic> json,
  ) => InvitationRedemptionView(
    admissionGateState: actionGateStateValues.map[json["admissionGateState"]]!,
    invitationId: json["invitationId"],
    membershipState: tenantMembershipStateValues.map[json["membershipState"]]!,
    reason: json["reason"] == null
        ? null
        : reasonCodeValues.map[json["reason"]]!,
    redeemedAt: json["redeemedAt"],
    tenantId: json["tenantId"],
    tenantName: json["tenantName"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "admissionGateState": actionGateStateValues.reverse[admissionGateState],
    "invitationId": invitationId,
    "membershipState": tenantMembershipStateValues.reverse[membershipState],
    "reason": reasonCodeValues.reverse[reason],
    "redeemedAt": redeemedAt,
    "tenantId": tenantId,
    "tenantName": tenantName,
  });
}

///TenantMembership 状态机。REVOKING 期间必须立即拒绝新动作，对账完成后才进 REVOKED（.design/10 §4）。
enum TenantMembershipState {
  ACTIVE,
  ERROR,
  INVITED,
  PROVISIONING,
  REVOKED,
  REVOKING,
}

final tenantMembershipStateValues = EnumValues({
  "ACTIVE": TenantMembershipState.ACTIVE,
  "ERROR": TenantMembershipState.ERROR,
  "INVITED": TenantMembershipState.INVITED,
  "PROVISIONING": TenantMembershipState.PROVISIONING,
  "REVOKED": TenantMembershipState.REVOKED,
  "REVOKING": TenantMembershipState.REVOKING,
});

///POST /api/v1/invitations/redeem 的请求体（DD-83）。兑换者身份只取网关投影的 issuer/subject，不接受请求体自报。
class InvitationRedemptionRequest {
  ///邀请链接 fragment 里的一次性凭据
  final String credential;

  ///兑换者自报的显示名：只作展示，审批人据此与被邀请人对照，不参与任何判定
  final String displayName;

  InvitationRedemptionRequest({
    required this.credential,
    required this.displayName,
  });

  factory InvitationRedemptionRequest.fromJson(Map<String, dynamic> json) =>
      InvitationRedemptionRequest(
        credential: json["credential"],
        displayName: json["displayName"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"credential": credential, "displayName": displayName});
}

///GET /api/v1/identity/legacy-secret-refs 的有界视图。只列当前 Tenant 中可发起 DD-85 归位的 SERVER
///binding，不暴露 locator、版本或私钥。
class LegacySecretRefPage {
  final List<LegacySecretRefBinding> bindings;
  final String? nextCursor;

  LegacySecretRefPage({required this.bindings, this.nextCursor});

  factory LegacySecretRefPage.fromJson(Map<String, dynamic> json) =>
      LegacySecretRefPage(
        bindings: List<LegacySecretRefBinding>.from(
          json["bindings"].map((x) => LegacySecretRefBinding.fromJson(x)),
        ),
        nextCursor: json["nextCursor"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindings": List<dynamic>.from(bindings.map((x) => x.toJson())),
    "nextCursor": nextCursor,
  });
}

///业务 Tenant 的旧 SERVER 身份引用；仅给有 tenant manage 权限的人展示。
class LegacySecretRefBinding {
  final LegacySecretRefBindingKind kind;
  final String principalId;
  final String pubkey;

  LegacySecretRefBinding({
    required this.kind,
    required this.principalId,
    required this.pubkey,
  });

  factory LegacySecretRefBinding.fromJson(Map<String, dynamic> json) =>
      LegacySecretRefBinding(
        kind: legacySecretRefBindingKindValues.map[json["kind"]]!,
        principalId: json["principalId"],
        pubkey: json["pubkey"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "kind": legacySecretRefBindingKindValues.reverse[kind],
    "principalId": principalId,
    "pubkey": pubkey,
  });
}

enum LegacySecretRefBindingKind { CONTROL, HUMAN }

final legacySecretRefBindingKindValues = EnumValues({
  "CONTROL": LegacySecretRefBindingKind.CONTROL,
  "HUMAN": LegacySecretRefBindingKind.HUMAN,
});

///DD-149(10)：本人可发现的连接器与登记能力。
class McpConnectionPage {
  final bool canRegisterPersonal;
  final bool canRegisterTenant;
  final List<McpConnectionView> connections;
  final McpConnectionPolicyView policy;
  final List<String> registrableWorkspaceIds;

  McpConnectionPage({
    required this.canRegisterPersonal,
    required this.canRegisterTenant,
    required this.connections,
    required this.policy,
    required this.registrableWorkspaceIds,
  });

  factory McpConnectionPage.fromJson(Map<String, dynamic> json) =>
      McpConnectionPage(
        canRegisterPersonal: json["canRegisterPersonal"],
        canRegisterTenant: json["canRegisterTenant"],
        connections: List<McpConnectionView>.from(
          json["connections"].map((x) => McpConnectionView.fromJson(x)),
        ),
        policy: McpConnectionPolicyView.fromJson(json["policy"]),
        registrableWorkspaceIds: List<String>.from(
          json["registrableWorkspaceIds"].map((x) => x),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "canRegisterPersonal": canRegisterPersonal,
    "canRegisterTenant": canRegisterTenant,
    "connections": List<dynamic>.from(connections.map((x) => x.toJson())),
    "policy": policy.toJson(),
    "registrableWorkspaceIds": List<dynamic>.from(
      registrableWorkspaceIds.map((x) => x),
    ),
  });
}

///DD-149(10)：连接器详情；凭据只以 credentialSet 表示，从不回显。
class McpConnectionView {
  final String? apiKeyHeader;
  final McpConnectionAuthMode authMode;
  final bool canManage;
  final String? createdAt;
  final bool credentialSet;
  final String? credentialUpdatedAt;
  final String displayName;

  ///最近一次探测的清单摘要与已确认的不同
  final bool drift;
  final String endpointHost;
  final String endpointUrl;
  final int generation;
  final McpConnectionHealth health;
  final String? healthCheckedAt;
  final String id;
  final String? observedToolsDigest;
  final String? ownerDisplayName;
  final String ownerPrincipalId;
  final String? serverName;
  final String? serverVersion;
  final String slug;
  final McpConnectionState state;
  final List<McpConnectionToolView> tools;
  final String toolsDigest;
  final McpConnectionTransport transport;
  final int version;
  final McpConnectionVisibility visibility;
  final String? workspaceId;

  McpConnectionView({
    this.apiKeyHeader,
    required this.authMode,
    required this.canManage,
    this.createdAt,
    required this.credentialSet,
    this.credentialUpdatedAt,
    required this.displayName,
    required this.drift,
    required this.endpointHost,
    required this.endpointUrl,
    required this.generation,
    required this.health,
    this.healthCheckedAt,
    required this.id,
    this.observedToolsDigest,
    this.ownerDisplayName,
    required this.ownerPrincipalId,
    this.serverName,
    this.serverVersion,
    required this.slug,
    required this.state,
    required this.tools,
    required this.toolsDigest,
    required this.transport,
    required this.version,
    required this.visibility,
    this.workspaceId,
  });

  factory McpConnectionView.fromJson(Map<String, dynamic> json) =>
      McpConnectionView(
        apiKeyHeader: json["apiKeyHeader"],
        authMode: mcpConnectionAuthModeValues.map[json["authMode"]]!,
        canManage: json["canManage"],
        createdAt: json["createdAt"],
        credentialSet: json["credentialSet"],
        credentialUpdatedAt: json["credentialUpdatedAt"],
        displayName: json["displayName"],
        drift: json["drift"],
        endpointHost: json["endpointHost"],
        endpointUrl: json["endpointUrl"],
        generation: json["generation"],
        health: mcpConnectionHealthValues.map[json["health"]]!,
        healthCheckedAt: json["healthCheckedAt"],
        id: json["id"],
        observedToolsDigest: json["observedToolsDigest"],
        ownerDisplayName: json["ownerDisplayName"],
        ownerPrincipalId: json["ownerPrincipalId"],
        serverName: json["serverName"],
        serverVersion: json["serverVersion"],
        slug: json["slug"],
        state: mcpConnectionStateValues.map[json["state"]]!,
        tools: List<McpConnectionToolView>.from(
          json["tools"].map((x) => McpConnectionToolView.fromJson(x)),
        ),
        toolsDigest: json["toolsDigest"],
        transport: mcpConnectionTransportValues.map[json["transport"]]!,
        version: json["version"],
        visibility: mcpConnectionVisibilityValues.map[json["visibility"]]!,
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "apiKeyHeader": apiKeyHeader,
    "authMode": mcpConnectionAuthModeValues.reverse[authMode],
    "canManage": canManage,
    "createdAt": createdAt,
    "credentialSet": credentialSet,
    "credentialUpdatedAt": credentialUpdatedAt,
    "displayName": displayName,
    "drift": drift,
    "endpointHost": endpointHost,
    "endpointUrl": endpointUrl,
    "generation": generation,
    "health": mcpConnectionHealthValues.reverse[health],
    "healthCheckedAt": healthCheckedAt,
    "id": id,
    "observedToolsDigest": observedToolsDigest,
    "ownerDisplayName": ownerDisplayName,
    "ownerPrincipalId": ownerPrincipalId,
    "serverName": serverName,
    "serverVersion": serverVersion,
    "slug": slug,
    "state": mcpConnectionStateValues.reverse[state],
    "tools": List<dynamic>.from(tools.map((x) => x.toJson())),
    "toolsDigest": toolsDigest,
    "transport": mcpConnectionTransportValues.reverse[transport],
    "version": version,
    "visibility": mcpConnectionVisibilityValues.reverse[visibility],
    "workspaceId": workspaceId,
  });
}

///DD-149(5)(6)：连接器认证方式。
enum McpConnectionAuthMode { API_KEY, BEARER, NONE, OAUTH }

final mcpConnectionAuthModeValues = EnumValues({
  "API_KEY": McpConnectionAuthMode.API_KEY,
  "BEARER": McpConnectionAuthMode.BEARER,
  "NONE": McpConnectionAuthMode.NONE,
  "OAUTH": McpConnectionAuthMode.OAUTH,
});

///DD-149(10)：最近一次探测观测；不是授权或状态权威。
enum McpConnectionHealth {
  AUTH_FAILED,
  EGRESS_DENIED,
  OK,
  PROTOCOL_ERROR,
  REAUTHORIZATION_REQUIRED,
  UNCHECKED,
  UNREACHABLE,
}

final mcpConnectionHealthValues = EnumValues({
  "AUTH_FAILED": McpConnectionHealth.AUTH_FAILED,
  "EGRESS_DENIED": McpConnectionHealth.EGRESS_DENIED,
  "OK": McpConnectionHealth.OK,
  "PROTOCOL_ERROR": McpConnectionHealth.PROTOCOL_ERROR,
  "REAUTHORIZATION_REQUIRED": McpConnectionHealth.REAUTHORIZATION_REQUIRED,
  "UNCHECKED": McpConnectionHealth.UNCHECKED,
  "UNREACHABLE": McpConnectionHealth.UNREACHABLE,
});

///DD-149(3)：连接器状态；DELETED 是墓碑。
enum McpConnectionState { ACTIVE, DELETED, DISABLED }

final mcpConnectionStateValues = EnumValues({
  "ACTIVE": McpConnectionState.ACTIVE,
  "DELETED": McpConnectionState.DELETED,
  "DISABLED": McpConnectionState.DISABLED,
});

class McpConnectionToolView {
  final McpToolCallPolicy callPolicy;
  final String? description;
  final bool? destructiveHint;
  final String inputSchemaJson;

  ///Agent 看到的工具名 <slug>__<上游名>
  final String name;
  final bool? readOnlyHint;
  final McpToolRisk risk;
  final bool riskDeclared;
  final String? title;
  final String toolResourceId;
  final String upstreamName;

  McpConnectionToolView({
    required this.callPolicy,
    this.description,
    this.destructiveHint,
    required this.inputSchemaJson,
    required this.name,
    this.readOnlyHint,
    required this.risk,
    required this.riskDeclared,
    this.title,
    required this.toolResourceId,
    required this.upstreamName,
  });

  factory McpConnectionToolView.fromJson(Map<String, dynamic> json) =>
      McpConnectionToolView(
        callPolicy: mcpToolCallPolicyValues.map[json["callPolicy"]]!,
        description: json["description"],
        destructiveHint: json["destructiveHint"],
        inputSchemaJson: json["inputSchemaJson"],
        name: json["name"],
        readOnlyHint: json["readOnlyHint"],
        risk: mcpToolRiskValues.map[json["risk"]]!,
        riskDeclared: json["riskDeclared"],
        title: json["title"],
        toolResourceId: json["toolResourceId"],
        upstreamName: json["upstreamName"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "callPolicy": mcpToolCallPolicyValues.reverse[callPolicy],
    "description": description,
    "destructiveHint": destructiveHint,
    "inputSchemaJson": inputSchemaJson,
    "name": name,
    "readOnlyHint": readOnlyHint,
    "risk": mcpToolRiskValues.reverse[risk],
    "riskDeclared": riskDeclared,
    "title": title,
    "toolResourceId": toolResourceId,
    "upstreamName": upstreamName,
  });
}

///DD-149(7)：工具调用策略。AUTO 只允许 READ_ONLY；CONFIRM 由 Agent 负责人逐次确认；APPROVAL 由 Tenant 管理员逐次批准。
enum McpToolCallPolicy { APPROVAL, AUTO, CONFIRM }

final mcpToolCallPolicyValues = EnumValues({
  "APPROVAL": McpToolCallPolicy.APPROVAL,
  "AUTO": McpToolCallPolicy.AUTO,
  "CONFIRM": McpToolCallPolicy.CONFIRM,
});

///DD-149(7)：工具风险等级（annotations 只是提示，最终为管理员确认值）。
enum McpToolRisk { DESTRUCTIVE, READ_ONLY, WRITE }

final mcpToolRiskValues = EnumValues({
  "DESTRUCTIVE": McpToolRisk.DESTRUCTIVE,
  "READ_ONLY": McpToolRisk.READ_ONLY,
  "WRITE": McpToolRisk.WRITE,
});

///DD-149(7)：连接器端点的 MCP 传输。STREAMABLE_HTTP 为现行 Streamable HTTP；SSE 为旧版 HTTP+SSE。
enum McpConnectionTransport { SSE, STREAMABLE_HTTP }

final mcpConnectionTransportValues = EnumValues({
  "SSE": McpConnectionTransport.SSE,
  "STREAMABLE_HTTP": McpConnectionTransport.STREAMABLE_HTTP,
});

///DD-149(4)：连接器与其工具的可见范围。
enum McpConnectionVisibility { PERSONAL, TENANT, WORKSPACE }

final mcpConnectionVisibilityValues = EnumValues({
  "PERSONAL": McpConnectionVisibility.PERSONAL,
  "TENANT": McpConnectionVisibility.TENANT,
  "WORKSPACE": McpConnectionVisibility.WORKSPACE,
});

///DD-149(4)(5)：Tenant 连接器策略与部署出站上限。
class McpConnectionPolicyView {
  final bool canManage;
  final List<String> egressHostSuffixes;
  final McpMemberRegistration memberRegistration;
  final bool platformAnyPublicHost;
  final List<String> platformHostSuffixes;
  final int version;

  McpConnectionPolicyView({
    required this.canManage,
    required this.egressHostSuffixes,
    required this.memberRegistration,
    required this.platformAnyPublicHost,
    required this.platformHostSuffixes,
    required this.version,
  });

  factory McpConnectionPolicyView.fromJson(Map<String, dynamic> json) =>
      McpConnectionPolicyView(
        canManage: json["canManage"],
        egressHostSuffixes: List<String>.from(
          json["egressHostSuffixes"].map((x) => x),
        ),
        memberRegistration:
            mcpMemberRegistrationValues.map[json["memberRegistration"]]!,
        platformAnyPublicHost: json["platformAnyPublicHost"],
        platformHostSuffixes: List<String>.from(
          json["platformHostSuffixes"].map((x) => x),
        ),
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "canManage": canManage,
    "egressHostSuffixes": List<dynamic>.from(egressHostSuffixes.map((x) => x)),
    "memberRegistration":
        mcpMemberRegistrationValues.reverse[memberRegistration],
    "platformAnyPublicHost": platformAnyPublicHost,
    "platformHostSuffixes": List<dynamic>.from(
      platformHostSuffixes.map((x) => x),
    ),
    "version": version,
  });
}

///DD-149(4)：Tenant 连接器策略中普通成员的登记权限。
enum McpMemberRegistration { DISABLED, PERSONAL_ONLY }

final mcpMemberRegistrationValues = EnumValues({
  "DISABLED": McpMemberRegistration.DISABLED,
  "PERSONAL_ONLY": McpMemberRegistration.PERSONAL_ONLY,
});

///DD-149(7)：添加连接器前的只读探测。
class McpConnectionProbeRequest {
  final String? apiKeyHeader;
  final McpConnectionAuthMode authMode;
  final McpConnectionCredentialInput? credential;
  final String endpointUrl;
  final String? oauthAttemptId;
  final McpConnectionTransport transport;

  McpConnectionProbeRequest({
    this.apiKeyHeader,
    required this.authMode,
    this.credential,
    required this.endpointUrl,
    this.oauthAttemptId,
    required this.transport,
  });

  factory McpConnectionProbeRequest.fromJson(Map<String, dynamic> json) =>
      McpConnectionProbeRequest(
        apiKeyHeader: json["apiKeyHeader"],
        authMode: mcpConnectionAuthModeValues.map[json["authMode"]]!,
        credential: json["credential"] == null
            ? null
            : McpConnectionCredentialInput.fromJson(json["credential"]),
        endpointUrl: json["endpointUrl"],
        oauthAttemptId: json["oauthAttemptId"],
        transport: mcpConnectionTransportValues.map[json["transport"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "apiKeyHeader": apiKeyHeader,
    "authMode": mcpConnectionAuthModeValues.reverse[authMode],
    "credential": credential?.toJson(),
    "endpointUrl": endpointUrl,
    "oauthAttemptId": oauthAttemptId,
    "transport": mcpConnectionTransportValues.reverse[transport],
  });
}

///DD-149(5)：仅 mcp_connection.create 与 mcp_connection.rotate_credential 的瞬态凭据（API_KEY 或
///BEARER）；Core 写入该 Tenant 的 OpenBao 后只保存 SecretRef，值不进入
///parameters、ActionExecution、日志、审计或回应。其他命令禁止携带。
///
///DD-149(5)：API Key 或 Bearer 的一次性输入，只随
///mcp_connection.create、mcp_connection.rotate_credential 与探测请求；Core 写入 OpenBao 后只保存
///SecretRef，从不回显、记录或进入 parameters。
class McpConnectionCredentialInput {
  final String value;

  McpConnectionCredentialInput({required this.value});

  factory McpConnectionCredentialInput.fromJson(Map<String, dynamic> json) =>
      McpConnectionCredentialInput(value: json["value"]);

  Map<String, dynamic> toJson() => _stripNulls({"value": value});
}

///DD-149(10)：以已保存凭据重新探测；变化需经 mcp_connection.update 重新确认。
class McpConnectionRefreshResult {
  final List<String> addedTools;
  final List<String> changedTools;
  final String checkedAt;
  final bool drift;
  final McpConnectionHealth health;
  final McpConnectionProbeResult? probe;
  final List<String> removedTools;

  McpConnectionRefreshResult({
    required this.addedTools,
    required this.changedTools,
    required this.checkedAt,
    required this.drift,
    required this.health,
    this.probe,
    required this.removedTools,
  });

  factory McpConnectionRefreshResult.fromJson(Map<String, dynamic> json) =>
      McpConnectionRefreshResult(
        addedTools: List<String>.from(json["addedTools"].map((x) => x)),
        changedTools: List<String>.from(json["changedTools"].map((x) => x)),
        checkedAt: json["checkedAt"],
        drift: json["drift"],
        health: mcpConnectionHealthValues.map[json["health"]]!,
        probe: json["probe"] == null
            ? null
            : McpConnectionProbeResult.fromJson(json["probe"]),
        removedTools: List<String>.from(json["removedTools"].map((x) => x)),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "addedTools": List<dynamic>.from(addedTools.map((x) => x)),
    "changedTools": List<dynamic>.from(changedTools.map((x) => x)),
    "checkedAt": checkedAt,
    "drift": drift,
    "health": mcpConnectionHealthValues.reverse[health],
    "probe": probe?.toJson(),
    "removedTools": List<dynamic>.from(removedTools.map((x) => x)),
  });
}

///DD-149(7)：探测结果。toolsDigest 是规范化清单摘要，登记与更新以它比对 fresh 探测。
class McpConnectionProbeResult {
  final String endpointHost;

  ///上游 instructions（不可信内容，截断至 2000 字符）
  final String? instructions;
  final String protocolVersion;
  final String? serverName;
  final String? serverVersion;
  final List<McpProbedTool> tools;
  final String toolsDigest;

  McpConnectionProbeResult({
    required this.endpointHost,
    this.instructions,
    required this.protocolVersion,
    this.serverName,
    this.serverVersion,
    required this.tools,
    required this.toolsDigest,
  });

  factory McpConnectionProbeResult.fromJson(Map<String, dynamic> json) =>
      McpConnectionProbeResult(
        endpointHost: json["endpointHost"],
        instructions: json["instructions"],
        protocolVersion: json["protocolVersion"],
        serverName: json["serverName"],
        serverVersion: json["serverVersion"],
        tools: List<McpProbedTool>.from(
          json["tools"].map((x) => McpProbedTool.fromJson(x)),
        ),
        toolsDigest: json["toolsDigest"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "endpointHost": endpointHost,
    "instructions": instructions,
    "protocolVersion": protocolVersion,
    "serverName": serverName,
    "serverVersion": serverVersion,
    "tools": List<dynamic>.from(tools.map((x) => x.toJson())),
    "toolsDigest": toolsDigest,
  });
}

class McpProbedTool {
  ///上游描述（不可信内容，界面以纯文本显示）
  final String? description;
  final bool? destructiveHint;
  final bool? idempotentHint;
  final String inputSchemaJson;
  final bool? openWorldHint;
  final String? outputSchemaJson;
  final bool? readOnlyHint;
  final McpToolCallPolicy suggestedCallPolicy;
  final McpToolRisk suggestedRisk;
  final String? title;
  final String upstreamName;

  McpProbedTool({
    this.description,
    this.destructiveHint,
    this.idempotentHint,
    required this.inputSchemaJson,
    this.openWorldHint,
    this.outputSchemaJson,
    this.readOnlyHint,
    required this.suggestedCallPolicy,
    required this.suggestedRisk,
    this.title,
    required this.upstreamName,
  });

  factory McpProbedTool.fromJson(Map<String, dynamic> json) => McpProbedTool(
    description: json["description"],
    destructiveHint: json["destructiveHint"],
    idempotentHint: json["idempotentHint"],
    inputSchemaJson: json["inputSchemaJson"],
    openWorldHint: json["openWorldHint"],
    outputSchemaJson: json["outputSchemaJson"],
    readOnlyHint: json["readOnlyHint"],
    suggestedCallPolicy:
        mcpToolCallPolicyValues.map[json["suggestedCallPolicy"]]!,
    suggestedRisk: mcpToolRiskValues.map[json["suggestedRisk"]]!,
    title: json["title"],
    upstreamName: json["upstreamName"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "description": description,
    "destructiveHint": destructiveHint,
    "idempotentHint": idempotentHint,
    "inputSchemaJson": inputSchemaJson,
    "openWorldHint": openWorldHint,
    "outputSchemaJson": outputSchemaJson,
    "readOnlyHint": readOnlyHint,
    "suggestedCallPolicy": mcpToolCallPolicyValues.reverse[suggestedCallPolicy],
    "suggestedRisk": mcpToolRiskValues.reverse[suggestedRisk],
    "title": title,
    "upstreamName": upstreamName,
  });
}

///DD-149(6)：OAuth 授权尝试的状态；从不包含令牌。
class McpOauthAttemptView {
  final String attemptId;
  final String? authorizationServer;
  final String? authorizationUrl;
  final String expiresAt;

  ///固定原因码
  final String? failure;
  final McpOauthAttemptState state;

  McpOauthAttemptView({
    required this.attemptId,
    this.authorizationServer,
    this.authorizationUrl,
    required this.expiresAt,
    this.failure,
    required this.state,
  });

  factory McpOauthAttemptView.fromJson(Map<String, dynamic> json) =>
      McpOauthAttemptView(
        attemptId: json["attemptId"],
        authorizationServer: json["authorizationServer"],
        authorizationUrl: json["authorizationUrl"],
        expiresAt: json["expiresAt"],
        failure: json["failure"],
        state: mcpOauthAttemptStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "attemptId": attemptId,
    "authorizationServer": authorizationServer,
    "authorizationUrl": authorizationUrl,
    "expiresAt": expiresAt,
    "failure": failure,
    "state": mcpOauthAttemptStateValues.reverse[state],
  });
}

///DD-149(6)：一次 OAuth 授权尝试的状态。
enum McpOauthAttemptState { COMPLETED, CONSUMED, EXPIRED, FAILED, PENDING }

final mcpOauthAttemptStateValues = EnumValues({
  "COMPLETED": McpOauthAttemptState.COMPLETED,
  "CONSUMED": McpOauthAttemptState.CONSUMED,
  "EXPIRED": McpOauthAttemptState.EXPIRED,
  "FAILED": McpOauthAttemptState.FAILED,
  "PENDING": McpOauthAttemptState.PENDING,
});

///DD-149(6)：发起一次 OAuth 授权尝试。forConnectionId 只用于轮换已存在连接器的授权。
class McpOauthStartRequest {
  ///未提供注册端点时的预注册 client ID
  final String? clientId;

  ///可选预注册 client 密钥，一次性输入，写入 OpenBao
  final String? clientSecret;
  final String endpointUrl;
  final String? forConnectionId;
  final McpConnectionTransport transport;

  McpOauthStartRequest({
    this.clientId,
    this.clientSecret,
    required this.endpointUrl,
    this.forConnectionId,
    required this.transport,
  });

  factory McpOauthStartRequest.fromJson(Map<String, dynamic> json) =>
      McpOauthStartRequest(
        clientId: json["clientId"],
        clientSecret: json["clientSecret"],
        endpointUrl: json["endpointUrl"],
        forConnectionId: json["forConnectionId"],
        transport: mcpConnectionTransportValues.map[json["transport"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "clientId": clientId,
    "clientSecret": clientSecret,
    "endpointUrl": endpointUrl,
    "forConnectionId": forConnectionId,
    "transport": mcpConnectionTransportValues.reverse[transport],
  });
}

///GET /api/v1/moderation/access（DD-125(2)）：原版只对 Community owner/admin 显示的审核入口在 Kailo 对应
///Tenant manage。canModerate 是与 moderation.ban 准入同一条 fresh 判定（目录开放、非 Platform Catalog、scope
///guard 与 tenant manage）的提示，不是授权票据，提交时仍完整重新准入；它不读取任何限制或队列事实。
class ModerationAccessView {
  final bool canModerate;

  ModerationAccessView({required this.canModerate});

  factory ModerationAccessView.fromJson(Map<String, dynamic> json) =>
      ModerationAccessView(canModerate: json["canModerate"]);

  Map<String, dynamic> toJson() => _stripNulls({"canModerate": canModerate});
}

///GET /api/v1/moderation/audit（DD-125(2)）：Relay moderation_actions（审核日志）是唯一权威，Core 以 Tenant
///CONTROL 经 NIP-98 读取 /moderation/audit，只回给 fresh Tenant manage 的请求者，每次读取写 ACCESS
///审计，不复制。单次至多 500 行，按时间倒序。CONTROL 签发的执法行其 actorPubkey 是 CONTROL；发起人与准入记录在 Core 的
///ActionExecution 与 AuditEvent。
class ModerationAuditPage {
  final List<ModerationAuditView> items;

  ///Relay 返回已达单次读取上界（500 行）
  final bool truncated;

  ModerationAuditPage({required this.items, required this.truncated});

  factory ModerationAuditPage.fromJson(Map<String, dynamic> json) =>
      ModerationAuditPage(
        items: List<ModerationAuditView>.from(
          json["items"].map((x) => ModerationAuditView.fromJson(x)),
        ),
        truncated: json["truncated"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "items": List<dynamic>.from(items.map((x) => x.toJson())),
    "truncated": truncated,
  });
}

class ModerationAuditView {
  ///Relay 审核日志词表（ban、unban、timeout、untimeout、resolve:<action>、dismiss_report、escalate 等），原样呈现
  final String action;
  final String actorPubkey;
  final String? channelId;

  ///RFC3339
  final String createdAt;
  final String id;
  final String? publicReason;
  final String? targetEventId;
  final String? targetPubkey;

  ModerationAuditView({
    required this.action,
    required this.actorPubkey,
    this.channelId,
    required this.createdAt,
    required this.id,
    this.publicReason,
    this.targetEventId,
    this.targetPubkey,
  });

  factory ModerationAuditView.fromJson(Map<String, dynamic> json) =>
      ModerationAuditView(
        action: json["action"],
        actorPubkey: json["actorPubkey"],
        channelId: json["channelId"],
        createdAt: json["createdAt"],
        id: json["id"],
        publicReason: json["publicReason"],
        targetEventId: json["targetEventId"],
        targetPubkey: json["targetPubkey"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "action": action,
    "actorPubkey": actorPubkey,
    "channelId": channelId,
    "createdAt": createdAt,
    "id": id,
    "publicReason": publicReason,
    "targetEventId": targetEventId,
    "targetPubkey": targetPubkey,
  });
}

///GET /api/v1/moderation/reports[?status=open]（DD-125(2)、V-SCN-130）：Relay
///moderation_reports 是唯一权威，Core 以 Tenant CONTROL 经 NIP-98 读取 /moderation/reports，只回给 fresh
///Tenant manage 的请求者，每次读取写 ACCESS 审计，Core 不复制。单次至多 500 行（Relay 上界），按创建时间倒序。reporterPubkey
///只出现在此审核面，不得进入被举报人可见的任何视图。
class ModerationReportPage {
  final List<ModerationReportView> items;

  ///Relay 返回已达单次读取上界（500 行），更早的行未包含
  final bool truncated;

  ModerationReportPage({required this.items, required this.truncated});

  factory ModerationReportPage.fromJson(Map<String, dynamic> json) =>
      ModerationReportPage(
        items: List<ModerationReportView>.from(
          json["items"].map((x) => ModerationReportView.fromJson(x)),
        ),
        truncated: json["truncated"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "items": List<dynamic>.from(items.map((x) => x.toJson())),
    "truncated": truncated,
  });
}

class ModerationReportView {
  ///事件目标所在 Relay Channel；其余目标缺省
  final String? channelId;

  ///RFC3339
  final String createdAt;

  ///Relay 举报行 ID
  final String id;
  final String? note;
  final String reporterPubkey;

  ///签名的 kind 1984 事件 ID；9044 以它定位举报
  final String reportEventId;
  final ModerationReportType reportType;

  ///RFC3339
  final String? resolvedAt;
  final String? resolvedByPubkey;
  final ModerationReportStatus status;

  ///事件 ID、公钥或附件 SHA-256（十六进制）
  final String target;

  ///事件目标由 CONTROL 回读得到的签名者；pubkey 目标即其本身；不可读时缺省
  final String? targetAuthorPubkey;
  final ModerationReportTargetKind targetKind;

  ///targetAuthorPubkey 属于本 Tenant 某 HUMAN Principal 时给出；AGENT 或未知公钥缺省（不提供封禁与踢出）
  final String? targetPrincipalId;

  ///channelId 对应本 Tenant 的 Workspace 时给出，供 moderation.message.delete 与
  ///workspace.member.revoke 定位
  final String? workspaceId;

  ModerationReportView({
    this.channelId,
    required this.createdAt,
    required this.id,
    this.note,
    required this.reporterPubkey,
    required this.reportEventId,
    required this.reportType,
    this.resolvedAt,
    this.resolvedByPubkey,
    required this.status,
    required this.target,
    this.targetAuthorPubkey,
    required this.targetKind,
    this.targetPrincipalId,
    this.workspaceId,
  });

  factory ModerationReportView.fromJson(Map<String, dynamic> json) =>
      ModerationReportView(
        channelId: json["channelId"],
        createdAt: json["createdAt"],
        id: json["id"],
        note: json["note"],
        reporterPubkey: json["reporterPubkey"],
        reportEventId: json["reportEventId"],
        reportType: moderationReportTypeValues.map[json["reportType"]]!,
        resolvedAt: json["resolvedAt"],
        resolvedByPubkey: json["resolvedByPubkey"],
        status: moderationReportStatusValues.map[json["status"]]!,
        target: json["target"],
        targetAuthorPubkey: json["targetAuthorPubkey"],
        targetKind: moderationReportTargetKindValues.map[json["targetKind"]]!,
        targetPrincipalId: json["targetPrincipalId"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "channelId": channelId,
    "createdAt": createdAt,
    "id": id,
    "note": note,
    "reporterPubkey": reporterPubkey,
    "reportEventId": reportEventId,
    "reportType": moderationReportTypeValues.reverse[reportType],
    "resolvedAt": resolvedAt,
    "resolvedByPubkey": resolvedByPubkey,
    "status": moderationReportStatusValues.reverse[status],
    "target": target,
    "targetAuthorPubkey": targetAuthorPubkey,
    "targetKind": moderationReportTargetKindValues.reverse[targetKind],
    "targetPrincipalId": targetPrincipalId,
    "workspaceId": workspaceId,
  });
}

///原 Buzz NIP-56 举报类型（buzz-relay handlers/report.rs::REPORT_TYPES，SF-BUZ-52）。线格式即 kind 1984
///目标标签第三元素，Relay 只接受这七个值（DD-125(2)）。
enum ModerationReportType {
  ILLEGAL,
  IMPERSONATION,
  MALWARE,
  NUDITY,
  OTHER,
  PROFANITY,
  SPAM,
}

final moderationReportTypeValues = EnumValues({
  "illegal": ModerationReportType.ILLEGAL,
  "impersonation": ModerationReportType.IMPERSONATION,
  "malware": ModerationReportType.MALWARE,
  "nudity": ModerationReportType.NUDITY,
  "other": ModerationReportType.OTHER,
  "profanity": ModerationReportType.PROFANITY,
  "spam": ModerationReportType.SPAM,
});

///Relay moderation_reports.status（buzz migrations/0006_moderation.sql 的 CHECK
///词表，SF-BUZ-52）。open 是唯一可处理状态；Relay 举报表是唯一权威，Core 不复制（DD-125(2)）。
enum ModerationReportStatus { DISMISSED, ESCALATED, OPEN, RESOLVED }

final moderationReportStatusValues = EnumValues({
  "dismissed": ModerationReportStatus.DISMISSED,
  "escalated": ModerationReportStatus.ESCALATED,
  "open": ModerationReportStatus.OPEN,
  "resolved": ModerationReportStatus.RESOLVED,
});

///举报目标类别（Relay report_json.target_kind）：event 为消息事件、pubkey 为成员、blob 为附件（SF-BUZ-52）。
enum ModerationReportTargetKind { BLOB, EVENT, PUBKEY }

final moderationReportTargetKindValues = EnumValues({
  "blob": ModerationReportTargetKind.BLOB,
  "event": ModerationReportTargetKind.EVENT,
  "pubkey": ModerationReportTargetKind.PUBKEY,
});

///GET /api/v1/moderation/restricted（DD-125(2)、V-SCN-127）：Relay community_bans
///中当前有效的封禁与禁言，是唯一权威；Core 以 Tenant CONTROL 经 NIP-98 读取 /moderation/restricted，只回给 fresh
///Tenant manage 的请求者，每次读取写 ACCESS 审计，不复制。成员与原版一样读不到自己的限制。
class ModerationRestrictionPage {
  final List<ModerationRestrictionView> items;

  ModerationRestrictionPage({required this.items});

  factory ModerationRestrictionPage.fromJson(Map<String, dynamic> json) =>
      ModerationRestrictionPage(
        items: List<ModerationRestrictionView>.from(
          json["items"].map((x) => ModerationRestrictionView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"items": List<dynamic>.from(items.map((x) => x.toJson()))});
}

class ModerationRestrictionView {
  ///RFC3339；永久封禁缺省
  final String? banExpiresAt;
  final bool banned;

  ///RFC3339；未禁言缺省
  final String? mutedUntil;

  ///该公钥属于本 Tenant 某 HUMAN Principal 时给出
  final String? principalId;
  final String pubkey;

  ///RFC3339
  final String updatedAt;

  ModerationRestrictionView({
    this.banExpiresAt,
    required this.banned,
    this.mutedUntil,
    this.principalId,
    required this.pubkey,
    required this.updatedAt,
  });

  factory ModerationRestrictionView.fromJson(Map<String, dynamic> json) =>
      ModerationRestrictionView(
        banExpiresAt: json["banExpiresAt"],
        banned: json["banned"],
        mutedUntil: json["mutedUntil"],
        principalId: json["principalId"],
        pubkey: json["pubkey"],
        updatedAt: json["updatedAt"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "banExpiresAt": banExpiresAt,
    "banned": banned,
    "mutedUntil": mutedUntil,
    "principalId": principalId,
    "pubkey": pubkey,
    "updatedAt": updatedAt,
  });
}

///GET /api/v1/native/community 的回应，只对原生入口开放（DD-75/78）。relayUrl 的 authority 就是
///communityHost：Relay 按连接的 Host 绑定 Community，非默认端口属于 host（SF-BUZ-32、SF-BUZ-41）。
class NativeCommunityFacts {
  ///该 Tenant 的 Community host，可能带非默认端口
  final String communityHost;

  ///当前固定 Relay NIP-11 的 max_limit；旧客户端忽略，新 Pulse 消费者缺失时不猜测上限。
  final int? relayQueryLimit;

  ///原生端直连的 Relay 地址
  final String relayUrl;

  NativeCommunityFacts({
    required this.communityHost,
    this.relayQueryLimit,
    required this.relayUrl,
  });

  factory NativeCommunityFacts.fromJson(Map<String, dynamic> json) =>
      NativeCommunityFacts(
        communityHost: json["communityHost"],
        relayQueryLimit: json["relayQueryLimit"],
        relayUrl: json["relayUrl"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "communityHost": communityHost,
    "relayQueryLimit": relayQueryLimit,
    "relayUrl": relayUrl,
  });
}

///Binding SERVICE transport. Command, observation and scope/resource access additionally
///require the independently verified native HUMAN token. readReceipt is SERVICE-only
///incurred-usage metadata for the already admitted original HUMAN SYNC operation; it never
///authorizes content disclosure. Tokens stay in transport, not this document.
class NativeHumanActionRequest {
  ///Native metadata access uses existing tenant/workspace permissions. Scope and identity
  ///come exclusively from the authenticated binding and HUMAN token, never from
  ///client-selected IDs. This is not Action admission or a reusable ticket.
  final NativeHumanScopeQuery? authorizeScope;
  final String bindingId;
  final ActionCommand? command;
  final String? idempotencyKey;

  ///Same-request writer admission for the original dispatched AE/EE and native intent, never
  ///another execute. Both the binding SERVICE and independent current HUMAN credentials are
  ///required.
  final NativeHumanActionRequestNativeExecutionAdmission?
  nativeExecutionAdmission;
  final NativeHumanReadReceipt? readReceipt;

  ///Read the already-registered exact native object for the verified HUMAN and action. This
  ///never creates a Resource or native object.
  final NativeHumanResourceQuery? resolveResource;
  final List<AdapterSourceResource>? sourceResources;

  NativeHumanActionRequest({
    this.authorizeScope,
    required this.bindingId,
    this.command,
    this.idempotencyKey,
    this.nativeExecutionAdmission,
    this.readReceipt,
    this.resolveResource,
    this.sourceResources,
  });

  factory NativeHumanActionRequest.fromJson(Map<String, dynamic> json) =>
      NativeHumanActionRequest(
        authorizeScope: json["authorizeScope"] == null
            ? null
            : NativeHumanScopeQuery.fromJson(json["authorizeScope"]),
        bindingId: json["bindingId"],
        command: json["command"] == null
            ? null
            : ActionCommand.fromJson(json["command"]),
        idempotencyKey: json["idempotencyKey"],
        nativeExecutionAdmission: json["nativeExecutionAdmission"] == null
            ? null
            : NativeHumanActionRequestNativeExecutionAdmission.fromJson(
                json["nativeExecutionAdmission"],
              ),
        readReceipt: json["readReceipt"] == null
            ? null
            : NativeHumanReadReceipt.fromJson(json["readReceipt"]),
        resolveResource: json["resolveResource"] == null
            ? null
            : NativeHumanResourceQuery.fromJson(json["resolveResource"]),
        sourceResources: json["sourceResources"] == null
            ? null
            : List<AdapterSourceResource>.from(
                json["sourceResources"]!.map(
                  (x) => AdapterSourceResource.fromJson(x),
                ),
              ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "authorizeScope": authorizeScope?.toJson(),
    "bindingId": bindingId,
    "command": command?.toJson(),
    "idempotencyKey": idempotencyKey,
    "nativeExecutionAdmission": nativeExecutionAdmission?.toJson(),
    "readReceipt": readReceipt?.toJson(),
    "resolveResource": resolveResource?.toJson(),
    "sourceResources": sourceResources == null
        ? null
        : List<dynamic>.from(sourceResources!.map((x) => x.toJson())),
  });
}

///Native metadata access uses existing tenant/workspace permissions. Scope and identity
///come exclusively from the authenticated binding and HUMAN token, never from
///client-selected IDs. This is not Action admission or a reusable ticket.
class NativeHumanScopeQuery {
  final NativeHumanScopeQueryPermission permission;

  NativeHumanScopeQuery({required this.permission});

  factory NativeHumanScopeQuery.fromJson(Map<String, dynamic> json) =>
      NativeHumanScopeQuery(
        permission:
            nativeHumanScopeQueryPermissionValues.map[json["permission"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "permission": nativeHumanScopeQueryPermissionValues.reverse[permission],
  });
}

enum NativeHumanScopeQueryPermission { DISCOVER, MANAGE }

final nativeHumanScopeQueryPermissionValues = EnumValues({
  "discover": NativeHumanScopeQueryPermission.DISCOVER,
  "manage": NativeHumanScopeQueryPermission.MANAGE,
});

///POST /api/v1/actions 的语义命令。actionKey 由 Core 的 ActionDefinition 目录解析，未登记即 BLOCKED；各动作所需参数按
///actionKey 解释，多出或缺少的参数以 INVALID_PARAMETERS 拒绝。
class ActionCommand {
  final String actionKey;

  ///仅 agent.definition.export（DD-131(2)、05 §2.12）：目标 Definition 的一个 PUBLISHED AgentVersion
  ///与包媒体类型；其他动作携带即拒绝。
  final AgentDefinitionExportInput? agentDefinitionExport;

  ///仅 agent.definition.import（DD-131(2)、05 §2.12）：本会话上传的快照包引用、包 digest 与本 Tenant
  ///重选的运行配置；其他动作携带即拒绝。
  final AgentDefinitionImportInput? agentDefinitionImport;

  ///仅 agent.team.create / agent.team.update 且必带（DD-131(1)、05 §2.12）；其他动作携带即拒绝。
  final AgentTeamInput? agentTeam;

  ///仅 agent.team.export（DD-131(3)、05 §2.12）：团队快照包媒体类型；其他动作携带即拒绝。
  final AgentTeamExportInput? agentTeamExport;

  ///仅 agent.team.import（DD-131(3)、05 §2.12）：本会话上传的团队快照包引用与包 digest；其他动作携带即拒绝。
  final AgentTeamImportInput? agentTeamImport;

  ///仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
  final AgentVersionContent? agentVersionContent;
  final ApplicationBindingCreate? applicationBindingCreate;
  final String? applicationBindingId;
  final int? applicationBindingVersion;

  ///AgentVersion 管理动作的目标 Asset；Core 核对父 Resource、Tenant、owner、版本与投影。
  final String? assetId;

  ///调用方实际读取的 Asset 版本；旧版本不能改写新的草稿或发布事实。
  final int? assetVersion;

  ///仅 automation.create / automation.publish_version：Core 自有版本内容；publish 产生新的不可变版本，不改写旧版本。
  final AutomationVersionContent? automationVersionContent;

  ///仅 application_binding.create 的瞬态输入（03 §9、DD-70）：按已批准 release 的 secretSchema 逐项提交 secret
  ///值，每个 secretKey 恰好一项。Core 在同一 Governed Action 的准入通过后写入该 Tenant 的 OpenBao namespace，只把版本号记成
  ///SecretRef；值不进入 Params、ActionExecution、日志、Workflow history、AuditEvent 或回应。其他命令禁止携带。
  final List<ApplicationBindingSecretValue>? bindingSecretValues;

  ///仅 capability_contract.approve/deprecate：固定已登记版本。
  final CapabilityContractRef? capabilityContractRef;

  ///仅 capability_contract.register：真实 schema 与测试向量内容。
  final CapabilityContractRegistration? capabilityContractRegistration;
  final ComponentActionInput? componentAction;

  ///仅组件批准：已登记的不可变ComponentRelease标识。
  final String? componentReleaseId;
  final ComponentReleaseRegistration? componentReleaseRegistration;
  final ConversationOpenRequest? conversationOpen;

  ///仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
  final DelegationGrantParameters? delegationGrant;

  ///显式 Delegation 管理的稳定 Grant ID；授予者提供新 ID，撤销引用实际已有 ID。
  final String? delegationId;

  ///仅 revoke：调用方实际读取的 Grant 版本。
  final int? delegationVersion;

  ///仅 automation.create：同一 Workspace 的确切 AgentInstallation Resource，不从名称或当前默认配置推断。
  final String? executorInstallationResourceId;

  ///EXPLICIT 动作或 HUMAN owner 的一次手动 automation.run，由用户在当前目标详情上确认后设为 true；其他动作不得携带。手动运行只提交
  ///resourceId/resourceVersion/workspaceId 与同一幂等键，不选择 Grant、Agent、来源或结果位置。
  final bool? explicitConfirmation;

  ///仅 resource.grant_read/revoke_read：授予或收回的 permission，省略即 read。AGENT 接收者按其工具契约所需 permission
  ///授予（DD-122）；HUMAN 与 SERVICE 接收者只接受 read
  final ResourceGrantPermission? grantPermission;
  final HuddleAgentInput? huddleAgent;

  ///仅 huddle.agent.add / huddle.agent.remove / huddle.end 且必带（DD-125(3)）：目标
  ///HuddleBuzzBinding；父 Workspace 的 Huddle 另须 workspaceId 等于其父 Workspace。
  final String? huddleId;
  final HuddleStartInput? huddleStart;

  ///调用方幂等键。同一发起者以同一键重发时回答原 operation；参数不同即 IDEMPOTENCY_KEY_REUSED
  final String idempotencyKey;

  ///tenant.member.invite.revoke 的目标邀请
  final String? invitationId;

  ///仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
  final LlmRouteCreateInput? llmRouteCreate;

  ///仅 mcp_connection.create（DD-149、05 §2.15）且必带；其他动作携带即拒绝。
  final McpConnectionCreate? mcpConnectionCreate;

  ///DD-149(5)：仅 mcp_connection.create 与 mcp_connection.rotate_credential 的瞬态凭据（API_KEY 或
  ///BEARER）；Core 写入该 Tenant 的 OpenBao 后只保存 SecretRef，值不进入
  ///parameters、ActionExecution、日志、审计或回应。其他命令禁止携带。
  final McpConnectionCredentialInput? mcpConnectionCredential;

  ///仅 mcp_connection.policy.update 且必带。
  final McpConnectionPolicyUpdate? mcpConnectionPolicyUpdate;

  ///仅 mcp_connection.update 且必带；目标连接器由 resourceId 与 resourceVersion 给出。
  final McpConnectionUpdate? mcpConnectionUpdate;

  ///DD-149(6)：仅 OAUTH 连接器的 mcp_connection.rotate_credential：本人本会话已完成且未使用的授权尝试。
  final String? mcpOauthAttemptId;

  ///仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
  ///输入；其他命令禁止携带。
  final AgentMemoryWriteInput? memoryWrite;

  ///仅 moderation.message.delete 且必带（DD-125(2)）：workspaceId 所指 Workspace Channel 中一条消息的 Relay
  ///事件 ID；Core 以 CONTROL 回读确认属于该 Channel 后签 9005，按 DD-81 以 9005 事件 ID 对账。
  final String? moderationEventId;

  ///仅 moderation.ban / unban / timeout / untimeout 且必带（DD-125(2)）。targetPubkey
  ///是消息签名者或成员栏所列公钥，Core 解析为同 Tenant 非本人、非有效 Tenant admin 的 HUMAN Principal，并对其全部非 REVOKED 公钥由
  ///CONTROL 签 9040–9043；AGENT 公钥以 PERMISSION_DENIED 拒绝（停用走
  ///agent.installation.disable）。timeoutDuration 只随 moderation.timeout 且必带，到期时刻在准入时冻结。
  final ModerationMemberTarget? moderationMember;

  ///仅 moderation.report.submit（DD-125(2)、05 §2.11）且必带：原举报对话框的一条消息举报。Core 在 workspaceId 或
  ///conversationId（恰好一个）给出的本人当前可读范围内以本人身份回读 eventId，以其签名者为 p 目标（HUMAN 目标须同 Tenant），再以本人身份签
  ///kind 1984（e 标签带 reportType）；note 去首尾空白后作为正文，空即省略。
  final ModerationReportSubmit? moderationReport;

  ///仅 moderation.report.resolve 且必带（DD-125(2)）：同一目标的一组未结举报（1–100 条 kind 1984 事件
  ///ID，不重复），CONTROL 逐条签 9044 并按举报状态回读；只记决定、不执法。dismiss 与 dismissed 配对，其余与 resolved 配对。
  final ModerationReportResolution? moderationResolution;

  ///workspace.create 或 AgentDefinition 创建/更新的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
  final String? name;

  ///任务控制只接收原 ActionExecution ID；原 Workflow、target 与 scope 由 Core 解析。Agent
  ///回合中断（task.cancel.agent.invoke.v1）的发起人可以是原发起人或该 Installation manage 持有人（DD-125(6) 扩展
  ///DD-84），其余规则不变
  final String? originalActionExecutionId;

  ///成员动作的目标 Principal；resource.transfer_owner 的新 owner；resource.grant_read/revoke_read 的同
  ///Tenant 接收者，Core 核对真实 HUMAN 成员、原 AGENT Installation 或 receiverResource 所属 SERVICE
  final String? principalId;

  ///Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
  ///identity; no Agent or caller-selected native credentials.
  final ProtocolSessionOpenInput? protocolSessionOpen;

  ///仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
  ///核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略时，原 AGENT Installation 仍只接受自身 AGENT；组件
  ///Resource 接收者必须是同 Tenant 的 HUMAN，授予时重新核对有效成员与目标 scope。
  final ActionCommandReceiverResource? receiverResource;
  final ResourceCreate? resourceCreate;

  ///Resource 管理动作的目标；Core 重新核对同 Tenant、scope、owner 和投影。agent.installation.disable /
  ///agent.installation.enable（DD-125(6)、05 §2.11）只带 resourceId、resourceVersion 与
  ///explicitConfirmation=true：目标 Workspace 由 Installation 的 home Workspace
  ///解析（TARGET_HOME_WORKSPACE），不接受 workspaceId、assetId 或其他参数；原“重启”是 assetId 等于固定 Version 的
  ///agent.installation.upgrade
  final String? resourceId;

  ///调用方实际读取的 Resource 版本；与当前事实不同即 CONFLICT
  final int? resourceVersion;

  ///仅 skill.version.create（DD-135(3)）：本会话一次性上传引用与能力需求；其他动作携带即拒绝。
  final SkillVersionUploadInput? skillVersionUpload;

  ///workspace.create 或 agent.definition.create 的稳定 slug
  final String? slug;

  ///仅 agent.invoke 人工分派：本人在该 Workspace Channel 已持久发布的消息 ID；Core 回读验签并与普通 mention 共用源事件幂等。
  final String? sourceEventId;

  ///tenant.suspend / tenant.restore 的目标业务 Tenant；执行 Tenant 仍是会话 Tenant（Platform Catalog）
  final String? tenantId;

  ///仅 tenant.quota.set（DD-123）
  final TenantQuotaSetting? tenantQuotaSetting;

  ///仅 workspace.canvas.set 且必带（DD-125(4)）：目标 Workspace 由 workspaceId 给出，须带
  ///explicitConfirmation=true；正文是瞬态输入，只冻结摘要。其他命令禁止携带。
  final WorkspaceCanvasSetInput? workspaceCanvas;
  final WorkspaceChannelCreate? workspaceChannel;

  ///Workspace 内动作的执行 Workspace
  final String? workspaceId;

  ///仅 workspace.update 使用且必带，目标 Workspace 由 workspaceId 给出；该动作不接受顶层 name、workspaceVisibility
  ///或 workspaceChannel。workspace.leave 只带 workspaceId，主体固定为发起人，不接受 principalId。
  final WorkspaceUpdate? workspaceUpdate;

  ///仅 workspace.create 使用；省略保持旧命令的 private 可见性。
  final WorkspaceVisibility? workspaceVisibility;

  ActionCommand({
    required this.actionKey,
    this.agentDefinitionExport,
    this.agentDefinitionImport,
    this.agentTeam,
    this.agentTeamExport,
    this.agentTeamImport,
    this.agentVersionContent,
    this.applicationBindingCreate,
    this.applicationBindingId,
    this.applicationBindingVersion,
    this.assetId,
    this.assetVersion,
    this.automationVersionContent,
    this.bindingSecretValues,
    this.capabilityContractRef,
    this.capabilityContractRegistration,
    this.componentAction,
    this.componentReleaseId,
    this.componentReleaseRegistration,
    this.conversationOpen,
    this.delegationGrant,
    this.delegationId,
    this.delegationVersion,
    this.executorInstallationResourceId,
    this.explicitConfirmation,
    this.grantPermission,
    this.huddleAgent,
    this.huddleId,
    this.huddleStart,
    required this.idempotencyKey,
    this.invitationId,
    this.llmRouteCreate,
    this.mcpConnectionCreate,
    this.mcpConnectionCredential,
    this.mcpConnectionPolicyUpdate,
    this.mcpConnectionUpdate,
    this.mcpOauthAttemptId,
    this.memoryWrite,
    this.moderationEventId,
    this.moderationMember,
    this.moderationReport,
    this.moderationResolution,
    this.name,
    this.originalActionExecutionId,
    this.principalId,
    this.protocolSessionOpen,
    this.receiverResource,
    this.resourceCreate,
    this.resourceId,
    this.resourceVersion,
    this.skillVersionUpload,
    this.slug,
    this.sourceEventId,
    this.tenantId,
    this.tenantQuotaSetting,
    this.workspaceCanvas,
    this.workspaceChannel,
    this.workspaceId,
    this.workspaceUpdate,
    this.workspaceVisibility,
  });

  factory ActionCommand.fromJson(Map<String, dynamic> json) => ActionCommand(
    actionKey: json["actionKey"],
    agentDefinitionExport: json["agentDefinitionExport"] == null
        ? null
        : AgentDefinitionExportInput.fromJson(json["agentDefinitionExport"]),
    agentDefinitionImport: json["agentDefinitionImport"] == null
        ? null
        : AgentDefinitionImportInput.fromJson(json["agentDefinitionImport"]),
    agentTeam: json["agentTeam"] == null
        ? null
        : AgentTeamInput.fromJson(json["agentTeam"]),
    agentTeamExport: json["agentTeamExport"] == null
        ? null
        : AgentTeamExportInput.fromJson(json["agentTeamExport"]),
    agentTeamImport: json["agentTeamImport"] == null
        ? null
        : AgentTeamImportInput.fromJson(json["agentTeamImport"]),
    agentVersionContent: json["agentVersionContent"] == null
        ? null
        : AgentVersionContent.fromJson(json["agentVersionContent"]),
    applicationBindingCreate: json["applicationBindingCreate"] == null
        ? null
        : ApplicationBindingCreate.fromJson(json["applicationBindingCreate"]),
    applicationBindingId: json["applicationBindingId"],
    applicationBindingVersion: json["applicationBindingVersion"],
    assetId: json["assetId"],
    assetVersion: json["assetVersion"],
    automationVersionContent: json["automationVersionContent"] == null
        ? null
        : AutomationVersionContent.fromJson(json["automationVersionContent"]),
    bindingSecretValues: json["bindingSecretValues"] == null
        ? null
        : List<ApplicationBindingSecretValue>.from(
            json["bindingSecretValues"]!.map(
              (x) => ApplicationBindingSecretValue.fromJson(x),
            ),
          ),
    capabilityContractRef: json["capabilityContractRef"] == null
        ? null
        : CapabilityContractRef.fromJson(json["capabilityContractRef"]),
    capabilityContractRegistration:
        json["capabilityContractRegistration"] == null
        ? null
        : CapabilityContractRegistration.fromJson(
            json["capabilityContractRegistration"],
          ),
    componentAction: json["componentAction"] == null
        ? null
        : ComponentActionInput.fromJson(json["componentAction"]),
    componentReleaseId: json["componentReleaseId"],
    componentReleaseRegistration: json["componentReleaseRegistration"] == null
        ? null
        : ComponentReleaseRegistration.fromJson(
            json["componentReleaseRegistration"],
          ),
    conversationOpen: json["conversationOpen"] == null
        ? null
        : ConversationOpenRequest.fromJson(json["conversationOpen"]),
    delegationGrant: json["delegationGrant"] == null
        ? null
        : DelegationGrantParameters.fromJson(json["delegationGrant"]),
    delegationId: json["delegationId"],
    delegationVersion: json["delegationVersion"],
    executorInstallationResourceId: json["executorInstallationResourceId"],
    explicitConfirmation: json["explicitConfirmation"],
    grantPermission: json["grantPermission"] == null
        ? null
        : resourceGrantPermissionValues.map[json["grantPermission"]]!,
    huddleAgent: json["huddleAgent"] == null
        ? null
        : HuddleAgentInput.fromJson(json["huddleAgent"]),
    huddleId: json["huddleId"],
    huddleStart: json["huddleStart"] == null
        ? null
        : HuddleStartInput.fromJson(json["huddleStart"]),
    idempotencyKey: json["idempotencyKey"],
    invitationId: json["invitationId"],
    llmRouteCreate: json["llmRouteCreate"] == null
        ? null
        : LlmRouteCreateInput.fromJson(json["llmRouteCreate"]),
    mcpConnectionCreate: json["mcpConnectionCreate"] == null
        ? null
        : McpConnectionCreate.fromJson(json["mcpConnectionCreate"]),
    mcpConnectionCredential: json["mcpConnectionCredential"] == null
        ? null
        : McpConnectionCredentialInput.fromJson(
            json["mcpConnectionCredential"],
          ),
    mcpConnectionPolicyUpdate: json["mcpConnectionPolicyUpdate"] == null
        ? null
        : McpConnectionPolicyUpdate.fromJson(json["mcpConnectionPolicyUpdate"]),
    mcpConnectionUpdate: json["mcpConnectionUpdate"] == null
        ? null
        : McpConnectionUpdate.fromJson(json["mcpConnectionUpdate"]),
    mcpOauthAttemptId: json["mcpOauthAttemptId"],
    memoryWrite: json["memoryWrite"] == null
        ? null
        : AgentMemoryWriteInput.fromJson(json["memoryWrite"]),
    moderationEventId: json["moderationEventId"],
    moderationMember: json["moderationMember"] == null
        ? null
        : ModerationMemberTarget.fromJson(json["moderationMember"]),
    moderationReport: json["moderationReport"] == null
        ? null
        : ModerationReportSubmit.fromJson(json["moderationReport"]),
    moderationResolution: json["moderationResolution"] == null
        ? null
        : ModerationReportResolution.fromJson(json["moderationResolution"]),
    name: json["name"],
    originalActionExecutionId: json["originalActionExecutionId"],
    principalId: json["principalId"],
    protocolSessionOpen: json["protocolSessionOpen"] == null
        ? null
        : ProtocolSessionOpenInput.fromJson(json["protocolSessionOpen"]),
    receiverResource: json["receiverResource"] == null
        ? null
        : ActionCommandReceiverResource.fromJson(json["receiverResource"]),
    resourceCreate: json["resourceCreate"] == null
        ? null
        : ResourceCreate.fromJson(json["resourceCreate"]),
    resourceId: json["resourceId"],
    resourceVersion: json["resourceVersion"],
    skillVersionUpload: json["skillVersionUpload"] == null
        ? null
        : SkillVersionUploadInput.fromJson(json["skillVersionUpload"]),
    slug: json["slug"],
    sourceEventId: json["sourceEventId"],
    tenantId: json["tenantId"],
    tenantQuotaSetting: json["tenantQuotaSetting"] == null
        ? null
        : TenantQuotaSetting.fromJson(json["tenantQuotaSetting"]),
    workspaceCanvas: json["workspaceCanvas"] == null
        ? null
        : WorkspaceCanvasSetInput.fromJson(json["workspaceCanvas"]),
    workspaceChannel: json["workspaceChannel"] == null
        ? null
        : WorkspaceChannelCreate.fromJson(json["workspaceChannel"]),
    workspaceId: json["workspaceId"],
    workspaceUpdate: json["workspaceUpdate"] == null
        ? null
        : WorkspaceUpdate.fromJson(json["workspaceUpdate"]),
    workspaceVisibility: json["workspaceVisibility"] == null
        ? null
        : workspaceVisibilityValues.map[json["workspaceVisibility"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "agentDefinitionExport": agentDefinitionExport?.toJson(),
    "agentDefinitionImport": agentDefinitionImport?.toJson(),
    "agentTeam": agentTeam?.toJson(),
    "agentTeamExport": agentTeamExport?.toJson(),
    "agentTeamImport": agentTeamImport?.toJson(),
    "agentVersionContent": agentVersionContent?.toJson(),
    "applicationBindingCreate": applicationBindingCreate?.toJson(),
    "applicationBindingId": applicationBindingId,
    "applicationBindingVersion": applicationBindingVersion,
    "assetId": assetId,
    "assetVersion": assetVersion,
    "automationVersionContent": automationVersionContent?.toJson(),
    "bindingSecretValues": bindingSecretValues == null
        ? null
        : List<dynamic>.from(bindingSecretValues!.map((x) => x.toJson())),
    "capabilityContractRef": capabilityContractRef?.toJson(),
    "capabilityContractRegistration": capabilityContractRegistration?.toJson(),
    "componentAction": componentAction?.toJson(),
    "componentReleaseId": componentReleaseId,
    "componentReleaseRegistration": componentReleaseRegistration?.toJson(),
    "conversationOpen": conversationOpen?.toJson(),
    "delegationGrant": delegationGrant?.toJson(),
    "delegationId": delegationId,
    "delegationVersion": delegationVersion,
    "executorInstallationResourceId": executorInstallationResourceId,
    "explicitConfirmation": explicitConfirmation,
    "grantPermission": resourceGrantPermissionValues.reverse[grantPermission],
    "huddleAgent": huddleAgent?.toJson(),
    "huddleId": huddleId,
    "huddleStart": huddleStart?.toJson(),
    "idempotencyKey": idempotencyKey,
    "invitationId": invitationId,
    "llmRouteCreate": llmRouteCreate?.toJson(),
    "mcpConnectionCreate": mcpConnectionCreate?.toJson(),
    "mcpConnectionCredential": mcpConnectionCredential?.toJson(),
    "mcpConnectionPolicyUpdate": mcpConnectionPolicyUpdate?.toJson(),
    "mcpConnectionUpdate": mcpConnectionUpdate?.toJson(),
    "mcpOauthAttemptId": mcpOauthAttemptId,
    "memoryWrite": memoryWrite?.toJson(),
    "moderationEventId": moderationEventId,
    "moderationMember": moderationMember?.toJson(),
    "moderationReport": moderationReport?.toJson(),
    "moderationResolution": moderationResolution?.toJson(),
    "name": name,
    "originalActionExecutionId": originalActionExecutionId,
    "principalId": principalId,
    "protocolSessionOpen": protocolSessionOpen?.toJson(),
    "receiverResource": receiverResource?.toJson(),
    "resourceCreate": resourceCreate?.toJson(),
    "resourceId": resourceId,
    "resourceVersion": resourceVersion,
    "skillVersionUpload": skillVersionUpload?.toJson(),
    "slug": slug,
    "sourceEventId": sourceEventId,
    "tenantId": tenantId,
    "tenantQuotaSetting": tenantQuotaSetting?.toJson(),
    "workspaceCanvas": workspaceCanvas?.toJson(),
    "workspaceChannel": workspaceChannel?.toJson(),
    "workspaceId": workspaceId,
    "workspaceUpdate": workspaceUpdate?.toJson(),
    "workspaceVisibility":
        workspaceVisibilityValues.reverse[workspaceVisibility],
  });
}

///仅 agent.definition.export（DD-131(2)、05 §2.12）：目标 Definition 的一个 PUBLISHED AgentVersion
///与包媒体类型；其他动作携带即拒绝。
///
///仅 agent.definition.export（DD-131(2)、05 §2.12）：命令的 Resource 目标是 AgentDefinition，这里冻结其一个
///PUBLISHED AgentVersion 与包的媒体类型。包只含可移植字段，不含
///owner、公钥、Installation、绑定、llm_route、RuntimeProfile、Delegation、记忆或任何 SecretRef。
class AgentDefinitionExportInput {
  final AgentSnapshotMediaType mediaType;
  final String versionAssetId;

  AgentDefinitionExportInput({
    required this.mediaType,
    required this.versionAssetId,
  });

  factory AgentDefinitionExportInput.fromJson(Map<String, dynamic> json) =>
      AgentDefinitionExportInput(
        mediaType: agentSnapshotMediaTypeValues.map[json["mediaType"]]!,
        versionAssetId: json["versionAssetId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "mediaType": agentSnapshotMediaTypeValues.reverse[mediaType],
    "versionAssetId": versionAssetId,
  });
}

///仅 agent.definition.import（DD-131(2)、05 §2.12）：本会话上传的快照包引用、包 digest 与本 Tenant
///重选的运行配置；其他动作携带即拒绝。
///
///仅 agent.definition.import（DD-131(2)、05 §2.12）：引用本 PlatformSession、本人的一次性快照上传与其包字节
///SHA-256；包不携带运行时与模型路由（DD-26）。导入时不强制选择：所给的 Profile 与 Route 在准入与 Workflow 内各自重验，缺省的由 owner
///发布前在版本编辑器补齐（DD-131(2)）。
class AgentDefinitionImportInput {
  final String? modelRouteResourceId;

  ///上传返回的包字节 SHA-256；准入与 Workflow 读取包时重算比对。
  final String packageDigest;
  final String? runtimeProfileKey;
  final String uploadId;

  AgentDefinitionImportInput({
    this.modelRouteResourceId,
    required this.packageDigest,
    this.runtimeProfileKey,
    required this.uploadId,
  });

  factory AgentDefinitionImportInput.fromJson(Map<String, dynamic> json) =>
      AgentDefinitionImportInput(
        modelRouteResourceId: json["modelRouteResourceId"],
        packageDigest: json["packageDigest"],
        runtimeProfileKey: json["runtimeProfileKey"],
        uploadId: json["uploadId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "modelRouteResourceId": modelRouteResourceId,
    "packageDigest": packageDigest,
    "runtimeProfileKey": runtimeProfileKey,
    "uploadId": uploadId,
  });
}

///仅 agent.team.create / agent.team.update 且必带（DD-131(1)、05 §2.12）；其他动作携带即拒绝。
///
///仅 agent.team.create / agent.team.update 且必带（DD-131(1)、05 §2.12）：Tenant 级 Agent
///团队的名称、说明与有序成员。成员是同 Tenant、发起人当前可 read 的 AgentDefinition Resource，按给出次序保存、不重复、至多 64
///个（沿原团队目录上限）；不含原版团队级 instructions、内置 welcome 团队或任何运行配置。update 另带 resourceId 与读到的
///resourceVersion 做 CAS。
class AgentTeamInput {
  ///可选说明，至多 2000 字符；去首尾空白后为空即省略
  final String? description;
  final List<String> memberAgentResourceIds;

  ///去首尾空白后非空，至多 200 字符
  final String name;

  AgentTeamInput({
    this.description,
    required this.memberAgentResourceIds,
    required this.name,
  });

  factory AgentTeamInput.fromJson(Map<String, dynamic> json) => AgentTeamInput(
    description: json["description"],
    memberAgentResourceIds: List<String>.from(
      json["memberAgentResourceIds"].map((x) => x),
    ),
    name: json["name"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "description": description,
    "memberAgentResourceIds": List<dynamic>.from(
      memberAgentResourceIds.map((x) => x),
    ),
    "name": name,
  });
}

///仅 agent.team.export（DD-131(3)、05 §2.12）：团队快照包媒体类型；其他动作携带即拒绝。
///
///仅 agent.team.export（DD-131(3)、05 §2.12）：命令的 Resource 目标是
///agent_team，这里只冻结包媒体类型。各成员取审批开始时冻结的当前已发布版本；包是团队信息加各成员的 DD-131(2) 清单，不含团队
///instructions、owner、公钥、Installation、绑定、llm_route、RuntimeProfile、记忆或任何 SecretRef。
class AgentTeamExportInput {
  final AgentSnapshotMediaType mediaType;

  AgentTeamExportInput({required this.mediaType});

  factory AgentTeamExportInput.fromJson(Map<String, dynamic> json) =>
      AgentTeamExportInput(
        mediaType: agentSnapshotMediaTypeValues.map[json["mediaType"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "mediaType": agentSnapshotMediaTypeValues.reverse[mediaType],
  });
}

///仅 agent.team.import（DD-131(3)、05 §2.12）：本会话上传的团队快照包引用与包 digest；其他动作携带即拒绝。
///
///仅 agent.team.import（DD-131(3)、05 §2.12）：本会话、本人上传的 buzz-team-snapshot@1 包引用与包
///digest。agent_team 没有 slug；各成员 Definition 的 slug 由 Core 按成员显示名规范化生成并在本 Tenant 内加序号去重。成员
///DRAFT 不带运行配置，由 owner 发布前补齐。
class AgentTeamImportInput {
  final String packageDigest;
  final String uploadId;

  AgentTeamImportInput({required this.packageDigest, required this.uploadId});

  factory AgentTeamImportInput.fromJson(Map<String, dynamic> json) =>
      AgentTeamImportInput(
        packageDigest: json["packageDigest"],
        uploadId: json["uploadId"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"packageDigest": packageDigest, "uploadId": uploadId});
}

///DD-88/94：pin 已批准 release 的业务绑定选择。不接受密钥正文、调用方自选 SecretRef 或运行端点 URL；secret 值只经同一
///ActionCommand 的瞬态 bindingSecretValues 提交（03 §9）。Workspace 取原 ActionCommand。
class ApplicationBindingCreate {
  final String adapterServiceRef;
  final String bindingId;
  final ApplicationCallIdentityMode callIdentityMode;
  final List<ApplicationCapabilitySelection> capabilityCategories;
  final String componentReleaseId;
  final ApplicationIsolationMode isolationMode;
  final ApplicationModelCallMode modelCallMode;
  final String nativeInstanceRef;
  final String? nativeScopeRef;
  final String normalizedConfigJson;
  final bool retainOnTenantDelete;

  ///必须为空数组。binding 的 SecretRef 只由 Core 在本动作内把 bindingSecretValues 写入该 Tenant OpenBao
  ///namespace 的 application-binding/<bindingId>/<secretKey> 后按返回版本生成；调用方提供的 locator/version
  ///一律拒绝（03 §9，不以运维旁路写入的 KV 冒充受治理写入）。
  final List<ApplicationBindingSecretRef> secretRefs;
  final String servicePrincipalId;

  ApplicationBindingCreate({
    required this.adapterServiceRef,
    required this.bindingId,
    required this.callIdentityMode,
    required this.capabilityCategories,
    required this.componentReleaseId,
    required this.isolationMode,
    required this.modelCallMode,
    required this.nativeInstanceRef,
    this.nativeScopeRef,
    required this.normalizedConfigJson,
    required this.retainOnTenantDelete,
    required this.secretRefs,
    required this.servicePrincipalId,
  });

  factory ApplicationBindingCreate.fromJson(
    Map<String, dynamic> json,
  ) => ApplicationBindingCreate(
    adapterServiceRef: json["adapterServiceRef"],
    bindingId: json["bindingId"],
    callIdentityMode:
        applicationCallIdentityModeValues.map[json["callIdentityMode"]]!,
    capabilityCategories: List<ApplicationCapabilitySelection>.from(
      json["capabilityCategories"].map(
        (x) => ApplicationCapabilitySelection.fromJson(x),
      ),
    ),
    componentReleaseId: json["componentReleaseId"],
    isolationMode: applicationIsolationModeValues.map[json["isolationMode"]]!,
    modelCallMode: applicationModelCallModeValues.map[json["modelCallMode"]]!,
    nativeInstanceRef: json["nativeInstanceRef"],
    nativeScopeRef: json["nativeScopeRef"],
    normalizedConfigJson: json["normalizedConfigJson"],
    retainOnTenantDelete: json["retainOnTenantDelete"],
    secretRefs: List<ApplicationBindingSecretRef>.from(
      json["secretRefs"].map((x) => ApplicationBindingSecretRef.fromJson(x)),
    ),
    servicePrincipalId: json["servicePrincipalId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "adapterServiceRef": adapterServiceRef,
    "bindingId": bindingId,
    "callIdentityMode":
        applicationCallIdentityModeValues.reverse[callIdentityMode],
    "capabilityCategories": List<dynamic>.from(
      capabilityCategories.map((x) => x.toJson()),
    ),
    "componentReleaseId": componentReleaseId,
    "isolationMode": applicationIsolationModeValues.reverse[isolationMode],
    "modelCallMode": applicationModelCallModeValues.reverse[modelCallMode],
    "nativeInstanceRef": nativeInstanceRef,
    "nativeScopeRef": nativeScopeRef,
    "normalizedConfigJson": normalizedConfigJson,
    "retainOnTenantDelete": retainOnTenantDelete,
    "secretRefs": List<dynamic>.from(secretRefs.map((x) => x.toJson())),
    "servicePrincipalId": servicePrincipalId,
  });
}

enum ApplicationCallIdentityMode {
  END_USER_TOKEN,
  INSTANCE_SERVICE,
  TENANT_SERVICE,
}

final applicationCallIdentityModeValues = EnumValues({
  "END_USER_TOKEN": ApplicationCallIdentityMode.END_USER_TOKEN,
  "INSTANCE_SERVICE": ApplicationCallIdentityMode.INSTANCE_SERVICE,
  "TENANT_SERVICE": ApplicationCallIdentityMode.TENANT_SERVICE,
});

class ApplicationCapabilitySelection {
  final String category;
  final int version;

  ApplicationCapabilitySelection({
    required this.category,
    required this.version,
  });

  factory ApplicationCapabilitySelection.fromJson(Map<String, dynamic> json) =>
      ApplicationCapabilitySelection(
        category: json["category"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"category": category, "version": version});
}

class ApplicationBindingSecretRef {
  final String audience;
  final String locator;
  final String secretKey;
  final int version;

  ApplicationBindingSecretRef({
    required this.audience,
    required this.locator,
    required this.secretKey,
    required this.version,
  });

  factory ApplicationBindingSecretRef.fromJson(Map<String, dynamic> json) =>
      ApplicationBindingSecretRef(
        audience: json["audience"],
        locator: json["locator"],
        secretKey: json["secretKey"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "audience": audience,
    "locator": locator,
    "secretKey": secretKey,
    "version": version,
  });
}

class ApplicationBindingSecretValue {
  final String secretKey;
  final String value;

  ApplicationBindingSecretValue({required this.secretKey, required this.value});

  factory ApplicationBindingSecretValue.fromJson(Map<String, dynamic> json) =>
      ApplicationBindingSecretValue(
        secretKey: json["secretKey"],
        value: json["value"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"secretKey": secretKey, "value": value});
}

///仅 capability_contract.approve/deprecate：固定已登记版本。
///
///固定 Catalog 自然键，不授予业务能力 consume 权限。
class CapabilityContractRef {
  final String categoryKey;
  final int contractVersion;

  CapabilityContractRef({
    required this.categoryKey,
    required this.contractVersion,
  });

  factory CapabilityContractRef.fromJson(Map<String, dynamic> json) =>
      CapabilityContractRef(
        categoryKey: json["categoryKey"],
        contractVersion: json["contractVersion"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "categoryKey": categoryKey,
    "contractVersion": contractVersion,
  });
}

///仅 capability_contract.register：真实 schema 与测试向量内容。
///
///DD-102：平台管理员登记实际 schema 与一致性测试向量。Core 按实际 canonical JSON 计算摘要并固定原内容；不接受只填摘要。
class CapabilityContractRegistration {
  final String categoryKey;
  final CapabilityContractRegistrationContentReferenceSemantics
  contentReferenceSemantics;
  final int contractVersion;
  final List<CapabilityContractRegistrationOperationContractsItem>
  operationContracts;
  final List<String> protocolSessionKinds;
  final List<CapabilityRequiredDeclaration> requiredDeclarations;
  final List<CapabilityContractRegistrationResourceTypeFamilyItem>
  resourceTypeFamily;
  final List<String> schemaDocuments;

  ///CapabilityConformanceVectors 的 JSON 编码，formatVersion 固定格式；任意自然语言对象数组不构成可执行向量。Core
  ///校验所有步骤参数/结果符合契约 schema，覆盖所有 operationContracts，然后固定 canonical digest。
  final String testVectorsJson;

  CapabilityContractRegistration({
    required this.categoryKey,
    required this.contentReferenceSemantics,
    required this.contractVersion,
    required this.operationContracts,
    required this.protocolSessionKinds,
    required this.requiredDeclarations,
    required this.resourceTypeFamily,
    required this.schemaDocuments,
    required this.testVectorsJson,
  });

  factory CapabilityContractRegistration.fromJson(
    Map<String, dynamic> json,
  ) => CapabilityContractRegistration(
    categoryKey: json["categoryKey"],
    contentReferenceSemantics:
        CapabilityContractRegistrationContentReferenceSemantics.fromJson(
          json["contentReferenceSemantics"],
        ),
    contractVersion: json["contractVersion"],
    operationContracts:
        List<CapabilityContractRegistrationOperationContractsItem>.from(
          json["operationContracts"].map(
            (x) =>
                CapabilityContractRegistrationOperationContractsItem.fromJson(
                  x,
                ),
          ),
        ),
    protocolSessionKinds: List<String>.from(
      json["protocolSessionKinds"].map((x) => x),
    ),
    requiredDeclarations: List<CapabilityRequiredDeclaration>.from(
      json["requiredDeclarations"].map(
        (x) => capabilityRequiredDeclarationValues.map[x]!,
      ),
    ),
    resourceTypeFamily:
        List<CapabilityContractRegistrationResourceTypeFamilyItem>.from(
          json["resourceTypeFamily"].map(
            (x) =>
                CapabilityContractRegistrationResourceTypeFamilyItem.fromJson(
                  x,
                ),
          ),
        ),
    schemaDocuments: List<String>.from(json["schemaDocuments"].map((x) => x)),
    testVectorsJson: json["testVectorsJson"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "categoryKey": categoryKey,
    "contentReferenceSemantics": contentReferenceSemantics.toJson(),
    "contractVersion": contractVersion,
    "operationContracts": List<dynamic>.from(
      operationContracts.map((x) => x.toJson()),
    ),
    "protocolSessionKinds": List<dynamic>.from(
      protocolSessionKinds.map((x) => x),
    ),
    "requiredDeclarations": List<dynamic>.from(
      requiredDeclarations.map(
        (x) => capabilityRequiredDeclarationValues.reverse[x],
      ),
    ),
    "resourceTypeFamily": List<dynamic>.from(
      resourceTypeFamily.map((x) => x.toJson()),
    ),
    "schemaDocuments": List<dynamic>.from(schemaDocuments.map((x) => x)),
    "testVectorsJson": testVectorsJson,
  });
}

class CapabilityContractRegistrationContentReferenceSemantics {
  final String authorizationTargetRule;
  final String nativeObjectRefRule;
  final String nativeRevisionRule;

  CapabilityContractRegistrationContentReferenceSemantics({
    required this.authorizationTargetRule,
    required this.nativeObjectRefRule,
    required this.nativeRevisionRule,
  });

  factory CapabilityContractRegistrationContentReferenceSemantics.fromJson(
    Map<String, dynamic> json,
  ) => CapabilityContractRegistrationContentReferenceSemantics(
    authorizationTargetRule: json["authorizationTargetRule"],
    nativeObjectRefRule: json["nativeObjectRefRule"],
    nativeRevisionRule: json["nativeRevisionRule"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "authorizationTargetRule": authorizationTargetRule,
    "nativeObjectRefRule": nativeObjectRefRule,
    "nativeRevisionRule": nativeRevisionRule,
  });
}

class CapabilityContractRegistrationOperationContractsItem {
  final String contractKey;
  final String inputSchemaDigest;
  final String outputSchemaDigest;
  final CapabilityPermission permission;
  final CapabilitySurface surface;
  final String targetType;

  CapabilityContractRegistrationOperationContractsItem({
    required this.contractKey,
    required this.inputSchemaDigest,
    required this.outputSchemaDigest,
    required this.permission,
    required this.surface,
    required this.targetType,
  });

  factory CapabilityContractRegistrationOperationContractsItem.fromJson(
    Map<String, dynamic> json,
  ) => CapabilityContractRegistrationOperationContractsItem(
    contractKey: json["contractKey"],
    inputSchemaDigest: json["inputSchemaDigest"],
    outputSchemaDigest: json["outputSchemaDigest"],
    permission: capabilityPermissionValues.map[json["permission"]]!,
    surface: capabilitySurfaceValues.map[json["surface"]]!,
    targetType: json["targetType"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "contractKey": contractKey,
    "inputSchemaDigest": inputSchemaDigest,
    "outputSchemaDigest": outputSchemaDigest,
    "permission": capabilityPermissionValues.reverse[permission],
    "surface": capabilitySurfaceValues.reverse[surface],
    "targetType": targetType,
  });
}

enum CapabilitySurface { ACTION, TOOL }

final capabilitySurfaceValues = EnumValues({
  "ACTION": CapabilitySurface.ACTION,
  "TOOL": CapabilitySurface.TOOL,
});

enum CapabilityRequiredDeclaration {
  CANCEL,
  METER,
  OBSERVE,
  ONLINE_EDITING,
  READ_EDGE,
  REVISION_QUERY,
  TENANT_DELETE,
  VERSIONED_MODEL,
}

final capabilityRequiredDeclarationValues = EnumValues({
  "CANCEL": CapabilityRequiredDeclaration.CANCEL,
  "METER": CapabilityRequiredDeclaration.METER,
  "OBSERVE": CapabilityRequiredDeclaration.OBSERVE,
  "ONLINE_EDITING": CapabilityRequiredDeclaration.ONLINE_EDITING,
  "READ_EDGE": CapabilityRequiredDeclaration.READ_EDGE,
  "REVISION_QUERY": CapabilityRequiredDeclaration.REVISION_QUERY,
  "TENANT_DELETE": CapabilityRequiredDeclaration.TENANT_DELETE,
  "VERSIONED_MODEL": CapabilityRequiredDeclaration.VERSIONED_MODEL,
});

class CapabilityContractRegistrationResourceTypeFamilyItem {
  final String kind;
  final String typeKey;

  CapabilityContractRegistrationResourceTypeFamilyItem({
    required this.kind,
    required this.typeKey,
  });

  factory CapabilityContractRegistrationResourceTypeFamilyItem.fromJson(
    Map<String, dynamic> json,
  ) => CapabilityContractRegistrationResourceTypeFamilyItem(
    kind: json["kind"],
    typeKey: json["typeKey"],
  );

  Map<String, dynamic> toJson() =>
      _stripNulls({"kind": kind, "typeKey": typeKey});
}

///Kailo HUMAN 通过原 ActionCommand 调用确切 APPLICATION 能力动作。inputReference 或 inputJson 恰一：前者保持持久
///ContentReference，后者是原登记能力 inputSchema 的规范化元数据参数，不把 SQL、提示或结果正文写入 Core/Temporal。Core
///仍校验原目标、能力 schema、审批和用量。
class ComponentActionInput {
  final int actionVersion;

  ///Canonical JSON for the existing registered capability input schema; mutually exclusive
  ///with inputReference, validated before AE admission.
  final String? inputJson;
  final ContentReference? inputReference;
  final String resultExposurePolicyId;
  final int resultExposurePolicyVersion;

  ComponentActionInput({
    required this.actionVersion,
    this.inputJson,
    this.inputReference,
    required this.resultExposurePolicyId,
    required this.resultExposurePolicyVersion,
  });

  factory ComponentActionInput.fromJson(Map<String, dynamic> json) =>
      ComponentActionInput(
        actionVersion: json["actionVersion"],
        inputJson: json["inputJson"],
        inputReference: json["inputReference"] == null
            ? null
            : ContentReference.fromJson(json["inputReference"]),
        resultExposurePolicyId: json["resultExposurePolicyId"],
        resultExposurePolicyVersion: json["resultExposurePolicyVersion"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionVersion": actionVersion,
    "inputJson": inputJson,
    "inputReference": inputReference?.toJson(),
    "resultExposurePolicyId": resultExposurePolicyId,
    "resultExposurePolicyVersion": resultExposurePolicyVersion,
  });
}

///组件登记只提交实际 manifest、包清单与 binding config schema；不接收 suite 通过声明、报告或候选执行地址。Core 解析并冻结内容，原
///Worker 独立执行隔离套件。
class ComponentReleaseRegistration {
  final String bindingConfigSchemaJson;
  final String manifestJson;
  final String packageJson;

  ComponentReleaseRegistration({
    required this.bindingConfigSchemaJson,
    required this.manifestJson,
    required this.packageJson,
  });

  factory ComponentReleaseRegistration.fromJson(Map<String, dynamic> json) =>
      ComponentReleaseRegistration(
        bindingConfigSchemaJson: json["bindingConfigSchemaJson"],
        manifestJson: json["manifestJson"],
        packageJson: json["packageJson"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingConfigSchemaJson": bindingConfigSchemaJson,
    "manifestJson": manifestJson,
    "packageJson": packageJson,
  });
}

///原生私聊的完整 HUMAN Principal 参与者集合，必须包含当前 HUMAN；不接受设备公钥、CONTROL 身份或 Workspace 冒名。
class ConversationOpenRequest {
  final List<String> participantPrincipalIds;

  ConversationOpenRequest({required this.participantPrincipalIds});

  factory ConversationOpenRequest.fromJson(Map<String, dynamic> json) =>
      ConversationOpenRequest(
        participantPrincipalIds: List<String>.from(
          json["participantPrincipalIds"].map((x) => x),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "participantPrincipalIds": List<dynamic>.from(
      participantPrincipalIds.map((x) => x),
    ),
  });
}

///仅 resource.grant_read/revoke_read：授予或收回的 permission，省略即 read。AGENT 接收者按其工具契约所需 permission
///授予（DD-122）；HUMAN 与 SERVICE 接收者只接受 read
enum ResourceGrantPermission { CONSUME, DISCOVER, EXECUTE, READ }

final resourceGrantPermissionValues = EnumValues({
  "consume": ResourceGrantPermission.CONSUME,
  "discover": ResourceGrantPermission.DISCOVER,
  "execute": ResourceGrantPermission.EXECUTE,
  "read": ResourceGrantPermission.READ,
});

///仅 huddle.agent.add / huddle.agent.remove（DD-125(3)）且必带，目标 Huddle 由 ActionCommand.huddleId
///给出。加入要求父 Workspace 中 ACTIVE、有 ChannelAgentBinding 且本人有 execute 的 Installation，Tenant
///CONTROL 以 9000 role=bot 投影并回读；移除另接受父 Workspace manage，CONTROL 以 9001 移出并回读。私聊父的 Huddle 没有
///Agent。
class HuddleAgentInput {
  final String agentInstallationResourceId;

  HuddleAgentInput({required this.agentInstallationResourceId});

  factory HuddleAgentInput.fromJson(Map<String, dynamic> json) =>
      HuddleAgentInput(
        agentInstallationResourceId: json["agentInstallationResourceId"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"agentInstallationResourceId": agentInstallationResourceId});
}

///仅 huddle.start（DD-125(3)、05 §2.11）且必带：在父 Workspace 或父私聊中发起原版 Huddle。parentWorkspaceId 与
///parentConversationId 恰有一个：前者要求执行 Workspace 即该 Workspace（discover），后者要求本人是该私聊当前参与者。Core
///预分配 HuddleBuzzBinding 与临时 Channel UUID，由 Tenant CONTROL 以带 creator 的
///9007（private、stream、ttl=3600）投影临时频道，并以 9000 role=bot 加入所选 Agent；私聊父不接受
///Agent。creatorPubkey 是本人发起会话的 ACTIVE HUMAN 公钥（原生端为该设备 CLIENT 公钥），省略即本人 SERVER
///公钥（Web）；它是临时频道的 created_by，也是唯一可签 48100/48106 的公钥。
class HuddleStartInput {
  ///原 Add agents 所选 Agent（至多 20 个，沿原 MAX_HUDDLE_AGENTS）：父 Workspace 中 ACTIVE、有
  ///ChannelAgentBinding 且本人有 execute 的 Installation
  final List<String>? agentInstallationResourceIds;

  ///原 buildHuddleChannelName 生成的临时频道名
  final String channelName;

  ///64 位小写十六进制 Nostr 公钥；省略即本人 SERVER 公钥
  final String? creatorPubkey;

  ///父私聊（ConversationBuzzBinding id）
  final String? parentConversationId;

  ///父 Workspace；须等于 ActionCommand.workspaceId
  final String? parentWorkspaceId;

  HuddleStartInput({
    this.agentInstallationResourceIds,
    required this.channelName,
    this.creatorPubkey,
    this.parentConversationId,
    this.parentWorkspaceId,
  });

  factory HuddleStartInput.fromJson(Map<String, dynamic> json) =>
      HuddleStartInput(
        agentInstallationResourceIds:
            json["agentInstallationResourceIds"] == null
            ? null
            : List<String>.from(
                json["agentInstallationResourceIds"]!.map((x) => x),
              ),
        channelName: json["channelName"],
        creatorPubkey: json["creatorPubkey"],
        parentConversationId: json["parentConversationId"],
        parentWorkspaceId: json["parentWorkspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentInstallationResourceIds": agentInstallationResourceIds == null
        ? null
        : List<dynamic>.from(agentInstallationResourceIds!.map((x) => x)),
    "channelName": channelName,
    "creatorPubkey": creatorPubkey,
    "parentConversationId": parentConversationId,
    "parentWorkspaceId": parentWorkspaceId,
  });
}

///仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
///
///受治理 Route 创建只传原生配置与同 Tenant OpenBao 凭据的确切引用。providerCredentialMode 必须明确提供：NONE
///仅表示固定原生提供方配置不使用认证；SECRET_REF 必须有确切引用。端点、模型正文与 key 不进入 Core 参数。
class LlmRouteCreateInput {
  final LlmRouteCreateInputNativeSource model;
  final LlmRouteCreateInputNativeSource provider;
  final LlmProviderCredentialMode providerCredentialMode;
  final LlmRouteCreateInputProviderSecretRef? providerSecretRef;

  LlmRouteCreateInput({
    required this.model,
    required this.provider,
    required this.providerCredentialMode,
    this.providerSecretRef,
  });

  factory LlmRouteCreateInput.fromJson(Map<String, dynamic> json) =>
      LlmRouteCreateInput(
        model: LlmRouteCreateInputNativeSource.fromJson(json["model"]),
        provider: LlmRouteCreateInputNativeSource.fromJson(json["provider"]),
        providerCredentialMode: llmProviderCredentialModeValues
            .map[json["providerCredentialMode"]]!,
        providerSecretRef: json["providerSecretRef"] == null
            ? null
            : LlmRouteCreateInputProviderSecretRef.fromJson(
                json["providerSecretRef"],
              ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "model": model.toJson(),
    "provider": provider.toJson(),
    "providerCredentialMode":
        llmProviderCredentialModeValues.reverse[providerCredentialMode],
    "providerSecretRef": providerSecretRef?.toJson(),
  });
}

class LlmRouteCreateInputNativeSource {
  final String id;
  final int revision;
  final String sha256;

  LlmRouteCreateInputNativeSource({
    required this.id,
    required this.revision,
    required this.sha256,
  });

  factory LlmRouteCreateInputNativeSource.fromJson(Map<String, dynamic> json) =>
      LlmRouteCreateInputNativeSource(
        id: json["id"],
        revision: json["revision"],
        sha256: json["sha256"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"id": id, "revision": revision, "sha256": sha256});
}

///提供方认证的显式封闭选择；NONE 不豁免 Gateway 调用者认证或业务授权。
enum LlmProviderCredentialMode { NONE, SECRET_REF }

final llmProviderCredentialModeValues = EnumValues({
  "NONE": LlmProviderCredentialMode.NONE,
  "SECRET_REF": LlmProviderCredentialMode.SECRET_REF,
});

class LlmRouteCreateInputProviderSecretRef {
  final String audience;
  final String locator;
  final int version;

  LlmRouteCreateInputProviderSecretRef({
    required this.audience,
    required this.locator,
    required this.version,
  });

  factory LlmRouteCreateInputProviderSecretRef.fromJson(
    Map<String, dynamic> json,
  ) => LlmRouteCreateInputProviderSecretRef(
    audience: json["audience"],
    locator: json["locator"],
    version: json["version"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "audience": audience,
    "locator": locator,
    "version": version,
  });
}

///仅 mcp_connection.create（DD-149、05 §2.15）且必带；其他动作携带即拒绝。
///
///仅 mcp_connection.create（DD-149、05 §2.15）：端点、认证方式、可见范围与确认的工具清单。凭据值只经
///ActionCommand.mcpConnectionCredential 一次性提交；OAuth 只引用本人本会话已完成的授权尝试。
class McpConnectionCreate {
  ///仅 API_KEY：小写 header 名
  final String? apiKeyHeader;
  final McpConnectionAuthMode authMode;

  ///连接器显示名，1–80 字符
  final String displayName;

  ///https 端点；不含 userinfo、query 与 fragment
  final String endpointUrl;

  ///仅 OAUTH：本人本会话已完成且未使用的授权尝试
  final String? oauthAttemptId;

  ///OAUTH 且可见范围不是 PERSONAL 时必须为 true：同意其他人的 Agent 以本人授权调用
  final bool? sharedAuthorizationConsent;
  final List<McpToolSelection> tools;

  ///确认时探测结果的清单摘要；提交时 Core 重新探测比对
  final String toolsDigest;
  final McpConnectionTransport transport;
  final McpConnectionVisibility visibility;

  ///仅 WORKSPACE 可见范围：所属 Workspace
  final String? workspaceId;

  McpConnectionCreate({
    this.apiKeyHeader,
    required this.authMode,
    required this.displayName,
    required this.endpointUrl,
    this.oauthAttemptId,
    this.sharedAuthorizationConsent,
    required this.tools,
    required this.toolsDigest,
    required this.transport,
    required this.visibility,
    this.workspaceId,
  });

  factory McpConnectionCreate.fromJson(Map<String, dynamic> json) =>
      McpConnectionCreate(
        apiKeyHeader: json["apiKeyHeader"],
        authMode: mcpConnectionAuthModeValues.map[json["authMode"]]!,
        displayName: json["displayName"],
        endpointUrl: json["endpointUrl"],
        oauthAttemptId: json["oauthAttemptId"],
        sharedAuthorizationConsent: json["sharedAuthorizationConsent"],
        tools: List<McpToolSelection>.from(
          json["tools"].map((x) => McpToolSelection.fromJson(x)),
        ),
        toolsDigest: json["toolsDigest"],
        transport: mcpConnectionTransportValues.map[json["transport"]]!,
        visibility: mcpConnectionVisibilityValues.map[json["visibility"]]!,
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "apiKeyHeader": apiKeyHeader,
    "authMode": mcpConnectionAuthModeValues.reverse[authMode],
    "displayName": displayName,
    "endpointUrl": endpointUrl,
    "oauthAttemptId": oauthAttemptId,
    "sharedAuthorizationConsent": sharedAuthorizationConsent,
    "tools": List<dynamic>.from(tools.map((x) => x.toJson())),
    "toolsDigest": toolsDigest,
    "transport": mcpConnectionTransportValues.reverse[transport],
    "visibility": mcpConnectionVisibilityValues.reverse[visibility],
    "workspaceId": workspaceId,
  });
}

///DD-149(7)：确认清单中的一个上游工具。未列出的上游工具即不启用。
class McpToolSelection {
  final McpToolCallPolicy callPolicy;
  final bool enabled;
  final McpToolRisk risk;

  ///风险等级低于 annotations 建议时必须为 true，作为管理员声明冻结进审计
  final bool? riskDeclared;

  ///上游 tools/list 中的工具名，原样
  final String upstreamName;

  McpToolSelection({
    required this.callPolicy,
    required this.enabled,
    required this.risk,
    this.riskDeclared,
    required this.upstreamName,
  });

  factory McpToolSelection.fromJson(Map<String, dynamic> json) =>
      McpToolSelection(
        callPolicy: mcpToolCallPolicyValues.map[json["callPolicy"]]!,
        enabled: json["enabled"],
        risk: mcpToolRiskValues.map[json["risk"]]!,
        riskDeclared: json["riskDeclared"],
        upstreamName: json["upstreamName"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "callPolicy": mcpToolCallPolicyValues.reverse[callPolicy],
    "enabled": enabled,
    "risk": mcpToolRiskValues.reverse[risk],
    "riskDeclared": riskDeclared,
    "upstreamName": upstreamName,
  });
}

///仅 mcp_connection.policy.update 且必带。
///
///仅 mcp_connection.policy.update：Tenant 连接器策略；白名单条目须落在部署声明的出站上限内。
class McpConnectionPolicyUpdate {
  ///小写主机名后缀；空表示只受部署上限约束
  final List<String> egressHostSuffixes;
  final McpMemberRegistration memberRegistration;

  McpConnectionPolicyUpdate({
    required this.egressHostSuffixes,
    required this.memberRegistration,
  });

  factory McpConnectionPolicyUpdate.fromJson(Map<String, dynamic> json) =>
      McpConnectionPolicyUpdate(
        egressHostSuffixes: List<String>.from(
          json["egressHostSuffixes"].map((x) => x),
        ),
        memberRegistration:
            mcpMemberRegistrationValues.map[json["memberRegistration"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "egressHostSuffixes": List<dynamic>.from(egressHostSuffixes.map((x) => x)),
    "memberRegistration":
        mcpMemberRegistrationValues.reverse[memberRegistration],
  });
}

///仅 mcp_connection.update 且必带；目标连接器由 resourceId 与 resourceVersion 给出。
///
///仅 mcp_connection.update：以新探测结果重新确认工具清单、风险、策略与可见范围，形成新 generation。
class McpConnectionUpdate {
  final bool? sharedAuthorizationConsent;
  final List<McpToolSelection> tools;
  final String toolsDigest;
  final McpConnectionVisibility visibility;

  ///仅 WORKSPACE 可见范围
  final String? workspaceId;

  McpConnectionUpdate({
    this.sharedAuthorizationConsent,
    required this.tools,
    required this.toolsDigest,
    required this.visibility,
    this.workspaceId,
  });

  factory McpConnectionUpdate.fromJson(Map<String, dynamic> json) =>
      McpConnectionUpdate(
        sharedAuthorizationConsent: json["sharedAuthorizationConsent"],
        tools: List<McpToolSelection>.from(
          json["tools"].map((x) => McpToolSelection.fromJson(x)),
        ),
        toolsDigest: json["toolsDigest"],
        visibility: mcpConnectionVisibilityValues.map[json["visibility"]]!,
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "sharedAuthorizationConsent": sharedAuthorizationConsent,
    "tools": List<dynamic>.from(tools.map((x) => x.toJson())),
    "toolsDigest": toolsDigest,
    "visibility": mcpConnectionVisibilityValues.reverse[visibility],
    "workspaceId": workspaceId,
  });
}

///仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
///输入；其他命令禁止携带。
///
///HUMAN Memory Action 本次瞬态输入；正文仅用于原生 NIP-AE 构造，不进入 ActionExecution、审计、outbox 或 history。
class AgentMemoryWriteInput {
  ///entry.patch 当前原生 value 的 SHA-256。
  final String? baseHash;

  ///调用方实际读取的 head；null 只表示原生确认不存在。
  final String? expectedHeadEventId;

  ///原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
  final AgentMemoryWriteInputExpectedHeadState expectedHeadState;

  ///entry.patch 的原生严格 unified diff，不支持 fuzz、offset 或多文件。
  final String? patch;
  final String slug;

  ///core.replace 的 profile 或 entry.set 的 value；完整序列化 JSON body 必须满足原生 NIP-44 上界。
  final String? value;

  AgentMemoryWriteInput({
    this.baseHash,
    this.expectedHeadEventId,
    required this.expectedHeadState,
    this.patch,
    required this.slug,
    this.value,
  });

  factory AgentMemoryWriteInput.fromJson(Map<String, dynamic> json) =>
      AgentMemoryWriteInput(
        baseHash: json["baseHash"],
        expectedHeadEventId: json["expectedHeadEventId"],
        expectedHeadState: agentMemoryWriteInputExpectedHeadStateValues
            .map[json["expectedHeadState"]]!,
        patch: json["patch"],
        slug: json["slug"],
        value: json["value"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "baseHash": baseHash,
    "expectedHeadEventId": expectedHeadEventId,
    "expectedHeadState":
        agentMemoryWriteInputExpectedHeadStateValues.reverse[expectedHeadState],
    "patch": patch,
    "slug": slug,
    "value": value,
  });
}

///原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
enum AgentMemoryWriteInputExpectedHeadState { ABSENT, FOUND }

final agentMemoryWriteInputExpectedHeadStateValues = EnumValues({
  "ABSENT": AgentMemoryWriteInputExpectedHeadState.ABSENT,
  "FOUND": AgentMemoryWriteInputExpectedHeadState.FOUND,
});

///仅 moderation.ban / unban / timeout / untimeout 且必带（DD-125(2)）。targetPubkey
///是消息签名者或成员栏所列公钥，Core 解析为同 Tenant 非本人、非有效 Tenant admin 的 HUMAN Principal，并对其全部非 REVOKED 公钥由
///CONTROL 签 9040–9043；AGENT 公钥以 PERMISSION_DENIED 拒绝（停用走
///agent.installation.disable）。timeoutDuration 只随 moderation.timeout 且必带，到期时刻在准入时冻结。
class ModerationMemberTarget {
  ///64 位小写十六进制 Nostr 公钥
  final String targetPubkey;
  final ModerationTimeoutDuration? timeoutDuration;

  ModerationMemberTarget({required this.targetPubkey, this.timeoutDuration});

  factory ModerationMemberTarget.fromJson(Map<String, dynamic> json) =>
      ModerationMemberTarget(
        targetPubkey: json["targetPubkey"],
        timeoutDuration: json["timeoutDuration"] == null
            ? null
            : moderationTimeoutDurationValues.map[json["timeoutDuration"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "targetPubkey": targetPubkey,
    "timeoutDuration": moderationTimeoutDurationValues.reverse[timeoutDuration],
  });
}

///原禁言时长预设（moderation/lib/timeout.ts::TIMEOUT_PRESETS：1 小时、24 小时、7 天）。到期时刻由 Core
///在准入时以数据库时钟冻结，不接受调用方给出的绝对时刻（DD-125(2)）。
enum ModerationTimeoutDuration { ONE_DAY, ONE_HOUR, SEVEN_DAYS }

final moderationTimeoutDurationValues = EnumValues({
  "ONE_DAY": ModerationTimeoutDuration.ONE_DAY,
  "ONE_HOUR": ModerationTimeoutDuration.ONE_HOUR,
  "SEVEN_DAYS": ModerationTimeoutDuration.SEVEN_DAYS,
});

///仅 moderation.report.submit（DD-125(2)、05 §2.11）且必带：原举报对话框的一条消息举报。Core 在 workspaceId 或
///conversationId（恰好一个）给出的本人当前可读范围内以本人身份回读 eventId，以其签名者为 p 目标（HUMAN 目标须同 Tenant），再以本人身份签
///kind 1984（e 标签带 reportType）；note 去首尾空白后作为正文，空即省略。
class ModerationReportSubmit {
  ///消息所在私聊；本人须为其当前参与者
  final String? conversationId;

  ///被举报消息的 Relay 事件 ID（64 位小写十六进制）
  final String eventId;

  ///原“补充说明（可选）”，至多 1000 字符
  final String? note;
  final ModerationReportType reportType;

  ///消息所在 Workspace Channel；本人须为其当前成员
  final String? workspaceId;

  ModerationReportSubmit({
    this.conversationId,
    required this.eventId,
    this.note,
    required this.reportType,
    this.workspaceId,
  });

  factory ModerationReportSubmit.fromJson(Map<String, dynamic> json) =>
      ModerationReportSubmit(
        conversationId: json["conversationId"],
        eventId: json["eventId"],
        note: json["note"],
        reportType: moderationReportTypeValues.map[json["reportType"]]!,
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "conversationId": conversationId,
    "eventId": eventId,
    "note": note,
    "reportType": moderationReportTypeValues.reverse[reportType],
    "workspaceId": workspaceId,
  });
}

///仅 moderation.report.resolve 且必带（DD-125(2)）：同一目标的一组未结举报（1–100 条 kind 1984 事件
///ID，不重复），CONTROL 逐条签 9044 并按举报状态回读；只记决定、不执法。dismiss 与 dismissed 配对，其余与 resolved 配对。
class ModerationReportResolution {
  final List<String> reportEventIds;
  final ModerationResolutionAction resolutionAction;
  final ModerationResolutionStatus status;

  ModerationReportResolution({
    required this.reportEventIds,
    required this.resolutionAction,
    required this.status,
  });

  factory ModerationReportResolution.fromJson(Map<String, dynamic> json) =>
      ModerationReportResolution(
        reportEventIds: List<String>.from(json["reportEventIds"].map((x) => x)),
        resolutionAction:
            moderationResolutionActionValues.map[json["resolutionAction"]]!,
        status: moderationResolutionStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "reportEventIds": List<dynamic>.from(reportEventIds.map((x) => x)),
    "resolutionAction":
        moderationResolutionActionValues.reverse[resolutionAction],
    "status": moderationResolutionStatusValues.reverse[status],
  });
}

///审核队列可提交的 kind 9044 action 标签（原 settings/lib/moderationQueue.ts::resolvableActions）。9044
///只记决定、不执法；delete/kick/ban 须先经各自受治理动作执法（DD-125(2)）。原队列不提供禁言，因此不含 timeout。
enum ModerationResolutionAction { BAN, DELETE, DISMISS, ESCALATE, KICK }

final moderationResolutionActionValues = EnumValues({
  "ban": ModerationResolutionAction.BAN,
  "delete": ModerationResolutionAction.DELETE,
  "dismiss": ModerationResolutionAction.DISMISS,
  "escalate": ModerationResolutionAction.ESCALATE,
  "kick": ModerationResolutionAction.KICK,
});

///kind 9044 的 status 标签（moderation_commands.rs，SF-BUZ-52）：dismiss 只与 dismissed 配对，其余处理一律
///resolved。
enum ModerationResolutionStatus { DISMISSED, RESOLVED }

final moderationResolutionStatusValues = EnumValues({
  "dismissed": ModerationResolutionStatus.DISMISSED,
  "resolved": ModerationResolutionStatus.RESOLVED,
});

///Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
///identity; no Agent or caller-selected native credentials.
///
///03/07/18: the original HUMAN file protocol action, not an arbitrary editor or native URL.
///Revision and presentation are frozen once; session expiry comes from controlled Core
///delivery.
class ProtocolSessionOpenInput {
  final int actionVersion;

  ///The selected native source binding; must equal the target's real binding, not an
  ///authorization claim.
  final String applicationBindingId;
  final ProtocolSessionLocale locale;

  ///Exact approved projection selected by the native menu; never latest.
  final int projectionGeneration;
  final ContentReference reference;
  final ProtocolSessionTheme theme;

  ProtocolSessionOpenInput({
    required this.actionVersion,
    required this.applicationBindingId,
    required this.locale,
    required this.projectionGeneration,
    required this.reference,
    required this.theme,
  });

  factory ProtocolSessionOpenInput.fromJson(Map<String, dynamic> json) =>
      ProtocolSessionOpenInput(
        actionVersion: json["actionVersion"],
        applicationBindingId: json["applicationBindingId"],
        locale: protocolSessionLocaleValues.map[json["locale"]]!,
        projectionGeneration: json["projectionGeneration"],
        reference: ContentReference.fromJson(json["reference"]),
        theme: protocolSessionThemeValues.map[json["theme"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionVersion": actionVersion,
    "applicationBindingId": applicationBindingId,
    "locale": protocolSessionLocaleValues.reverse[locale],
    "projectionGeneration": projectionGeneration,
    "reference": reference.toJson(),
    "theme": protocolSessionThemeValues.reverse[theme],
  });
}

///仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
///核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略时，原 AGENT Installation 仍只接受自身 AGENT；组件
///Resource 接收者必须是同 Tenant 的 HUMAN，授予时重新核对有效成员与目标 scope。
class ActionCommandReceiverResource {
  final String id;
  final int version;

  ActionCommandReceiverResource({required this.id, required this.version});

  factory ActionCommandReceiverResource.fromJson(Map<String, dynamic> json) =>
      ActionCommandReceiverResource(id: json["id"], version: json["version"]);

  Map<String, dynamic> toJson() => _stripNulls({"id": id, "version": version});
}

class ResourceCreate {
  final String evidenceDigest;
  final String evidenceRef;
  final String nativeRef;
  final String nativeType;
  final String typeKey;

  ResourceCreate({
    required this.evidenceDigest,
    required this.evidenceRef,
    required this.nativeRef,
    required this.nativeType,
    required this.typeKey,
  });

  factory ResourceCreate.fromJson(Map<String, dynamic> json) => ResourceCreate(
    evidenceDigest: json["evidenceDigest"],
    evidenceRef: json["evidenceRef"],
    nativeRef: json["nativeRef"],
    nativeType: json["nativeType"],
    typeKey: json["typeKey"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "evidenceDigest": evidenceDigest,
    "evidenceRef": evidenceRef,
    "nativeRef": nativeRef,
    "nativeType": nativeType,
    "typeKey": typeKey,
  });
}

///仅 skill.version.create（DD-135(3)）：本会话一次性上传引用与能力需求；其他动作携带即拒绝。
///
///仅 skill.version.create（DD-135(3)）：引用本 PlatformSession、本人、目标定义的一次性上传及其规范 artifact
///digest；能力需求只声明契约键与版本，不授予工具。
class SkillVersionUploadInput {
  ///上传返回的规范 SKILL.md SHA-256（64 位小写十六进制）；准入事务内重算比对。
  final String artifactDigest;

  ///contract_key@version，去重；须是引用它的 AgentVersion 能力需求的子集。
  final List<String> capabilityRequirements;
  final String uploadId;

  SkillVersionUploadInput({
    required this.artifactDigest,
    required this.capabilityRequirements,
    required this.uploadId,
  });

  factory SkillVersionUploadInput.fromJson(Map<String, dynamic> json) =>
      SkillVersionUploadInput(
        artifactDigest: json["artifactDigest"],
        capabilityRequirements: List<String>.from(
          json["capabilityRequirements"].map((x) => x),
        ),
        uploadId: json["uploadId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "artifactDigest": artifactDigest,
    "capabilityRequirements": List<dynamic>.from(
      capabilityRequirements.map((x) => x),
    ),
    "uploadId": uploadId,
  });
}

///仅 tenant.quota.set（DD-123）
///
///DD-123: tenant.quota.set parameters. Writes only the Tenant Customer's hard-limit
///OpenMeter entitlement for the platform feature, resetting monthly.
class TenantQuotaSetting {
  final TenantQuotaFeature feature;
  final int limitPerPeriod;

  TenantQuotaSetting({required this.feature, required this.limitPerPeriod});

  factory TenantQuotaSetting.fromJson(Map<String, dynamic> json) =>
      TenantQuotaSetting(
        feature: tenantQuotaFeatureValues.map[json["feature"]]!,
        limitPerPeriod: json["limitPerPeriod"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "feature": tenantQuotaFeatureValues.reverse[feature],
    "limitPerPeriod": limitPerPeriod,
  });
}

enum TenantQuotaFeature { AGENT_MEMORY_WRITES, AGENT_TOKENS, AUTOMATION_RUNS }

final tenantQuotaFeatureValues = EnumValues({
  "agent_memory_writes": TenantQuotaFeature.AGENT_MEMORY_WRITES,
  "agent_tokens": TenantQuotaFeature.AGENT_TOKENS,
  "automation_runs": TenantQuotaFeature.AUTOMATION_RUNS,
});

///仅 workspace.canvas.set 且必带（DD-125(4)）：目标 Workspace 由 workspaceId 给出，须带
///explicitConfirmation=true；正文是瞬态输入，只冻结摘要。其他命令禁止携带。
///
///仅 workspace.canvas.set（DD-125(4)、05 §2.11）的瞬态输入：原频道 Canvas 的 Markdown 正文（SF-BUZ-54，UTF-8
///不超过 64 KiB，空串即原“清空”）。Core 只用它签 Tenant CONTROL 的 kind 40100 并按 DD-81 对账；正文不进入
///Params、ActionExecution、审计、日志或 Workflow history，只冻结其 SHA-256 与字节数，同一幂等键重发须携带同一正文。
class WorkspaceCanvasSetInput {
  final String content;

  WorkspaceCanvasSetInput({required this.content});

  factory WorkspaceCanvasSetInput.fromJson(Map<String, dynamic> json) =>
      WorkspaceCanvasSetInput(content: json["content"]);

  Map<String, dynamic> toJson() => _stripNulls({"content": content});
}

///workspace.create 的 Buzz 原生频道元数据。只用于创建时向 Relay 物化，不建立第二份频道内容权威。缺省保留旧命令的 stream 行为。
class WorkspaceChannelCreate {
  final WorkspaceChannelCreateChannelType channelType;
  final String? description;

  ///原 Buzz 临时频道的不活跃期限（秒）。省略为长期频道；Relay 原生消息活动续期，原生 reaper 到期归档，不表示 Workspace 暂停或删除。
  final int? ttlSeconds;

  WorkspaceChannelCreate({
    required this.channelType,
    this.description,
    this.ttlSeconds,
  });

  factory WorkspaceChannelCreate.fromJson(Map<String, dynamic> json) =>
      WorkspaceChannelCreate(
        channelType:
            workspaceChannelCreateChannelTypeValues.map[json["channelType"]]!,
        description: json["description"],
        ttlSeconds: json["ttlSeconds"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "channelType": workspaceChannelCreateChannelTypeValues.reverse[channelType],
    "description": description,
    "ttlSeconds": ttlSeconds,
  });
}

///仅 workspace.update 使用且必带，目标 Workspace 由 workspaceId 给出；该动作不接受顶层 name、workspaceVisibility
///或 workspaceChannel。workspace.leave 只带 workspaceId，主体固定为发起人，不接受 principalId。
///
///workspace.update 的冻结目标状态（DD-119）。至少给出 name、description、ttlSeconds/clearTtl、visibility
///之一，或只给 reopen=true；省略的字段保持不变。Core 在 Admission 校验组合，空集、ttlSeconds 与 clearTtl 同时出现、reopen
///与其他字段混用或取 false 均以 INVALID_PARAMETERS 拒绝。stream/forum 类型只在创建时设定，不可编辑；slug 不变。
class WorkspaceUpdate {
  ///只能为 true：清除 TTL 改为长期频道（原 9002 空 ttl 标签）；与 ttlSeconds 互斥。
  final bool? clearTtl;

  ///原 9002 about；空字符串清空描述。
  final String? description;

  ///新的频道与 Workspace 显示名；CONTROL 9002 回读 39000 一致后才在同一事务提交 Core 的 Workspace 名称。
  final String? name;

  ///只能为 true 且单独出现：解档被原生 reaper 按 TTL 到期归档的 Channel。要求 Workspace ACTIVE、回读 archived=true 且设有
  ///TTL，CONTROL 发 archived=false 后回读确认；主动归档仍用 workspace.suspend/restore。
  final bool? reopen;

  ///设置原 Buzz 临时频道的不活跃期限（秒）。
  final int? ttlSeconds;

  ///只在准入事务内改写 Core 的 Workspace 可见性；已有成员不变，不写 SpiceDB，Relay 投影保持 private、不发送 visibility 标签。
  final WorkspaceVisibility? visibility;

  WorkspaceUpdate({
    this.clearTtl,
    this.description,
    this.name,
    this.reopen,
    this.ttlSeconds,
    this.visibility,
  });

  factory WorkspaceUpdate.fromJson(Map<String, dynamic> json) =>
      WorkspaceUpdate(
        clearTtl: json["clearTtl"],
        description: json["description"],
        name: json["name"],
        reopen: json["reopen"],
        ttlSeconds: json["ttlSeconds"],
        visibility: json["visibility"] == null
            ? null
            : workspaceVisibilityValues.map[json["visibility"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "clearTtl": clearTtl,
    "description": description,
    "name": name,
    "reopen": reopen,
    "ttlSeconds": ttlSeconds,
    "visibility": workspaceVisibilityValues.reverse[visibility],
  });
}

///Same-request writer admission for the original dispatched AE/EE and native intent, never
///another execute. Both the binding SERVICE and independent current HUMAN credentials are
///required.
class NativeHumanActionRequestNativeExecutionAdmission {
  final String actionExecutionId;
  final String externalExecutionId;
  final String nativeIntentId;

  NativeHumanActionRequestNativeExecutionAdmission({
    required this.actionExecutionId,
    required this.externalExecutionId,
    required this.nativeIntentId,
  });

  factory NativeHumanActionRequestNativeExecutionAdmission.fromJson(
    Map<String, dynamic> json,
  ) => NativeHumanActionRequestNativeExecutionAdmission(
    actionExecutionId: json["actionExecutionId"],
    externalExecutionId: json["externalExecutionId"],
    nativeIntentId: json["nativeIntentId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "externalExecutionId": externalExecutionId,
    "nativeIntentId": nativeIntentId,
  });
}

///Original HUMAN synchronous application read completion, authenticated by its binding
///SERVICE. Metadata only; no body, replacement identity, native Task or ExternalExecution.
class NativeHumanReadReceipt {
  final String completedAt;
  final int contentBytes;
  final String contentSha256;
  final String idempotencyKey;
  final List<NativeHumanReadReceiptMeasurementsItem> measurements;
  final String nativeObjectRef;
  final String nativeRevision;
  final String operationId;
  final String startedAt;

  NativeHumanReadReceipt({
    required this.completedAt,
    required this.contentBytes,
    required this.contentSha256,
    required this.idempotencyKey,
    required this.measurements,
    required this.nativeObjectRef,
    required this.nativeRevision,
    required this.operationId,
    required this.startedAt,
  });

  factory NativeHumanReadReceipt.fromJson(Map<String, dynamic> json) =>
      NativeHumanReadReceipt(
        completedAt: json["completedAt"],
        contentBytes: json["contentBytes"],
        contentSha256: json["contentSha256"],
        idempotencyKey: json["idempotencyKey"],
        measurements: List<NativeHumanReadReceiptMeasurementsItem>.from(
          json["measurements"].map(
            (x) => NativeHumanReadReceiptMeasurementsItem.fromJson(x),
          ),
        ),
        nativeObjectRef: json["nativeObjectRef"],
        nativeRevision: json["nativeRevision"],
        operationId: json["operationId"],
        startedAt: json["startedAt"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "completedAt": completedAt,
    "contentBytes": contentBytes,
    "contentSha256": contentSha256,
    "idempotencyKey": idempotencyKey,
    "measurements": List<dynamic>.from(measurements.map((x) => x.toJson())),
    "nativeObjectRef": nativeObjectRef,
    "nativeRevision": nativeRevision,
    "operationId": operationId,
    "startedAt": startedAt,
  });
}

class NativeHumanReadReceiptMeasurementsItem {
  final String meterKey;
  final int quantity;

  NativeHumanReadReceiptMeasurementsItem({
    required this.meterKey,
    required this.quantity,
  });

  factory NativeHumanReadReceiptMeasurementsItem.fromJson(
    Map<String, dynamic> json,
  ) => NativeHumanReadReceiptMeasurementsItem(
    meterKey: json["meterKey"],
    quantity: json["quantity"],
  );

  Map<String, dynamic> toJson() =>
      _stripNulls({"meterKey": meterKey, "quantity": quantity});
}

///Read the already-registered exact native object for the verified HUMAN and action. This
///never creates a Resource or native object.
class NativeHumanResourceQuery {
  final String actionKey;
  final int actionVersion;
  final String nativeRef;
  final String nativeType;
  final String? workspaceId;

  NativeHumanResourceQuery({
    required this.actionKey,
    required this.actionVersion,
    required this.nativeRef,
    required this.nativeType,
    this.workspaceId,
  });

  factory NativeHumanResourceQuery.fromJson(Map<String, dynamic> json) =>
      NativeHumanResourceQuery(
        actionKey: json["actionKey"],
        actionVersion: json["actionVersion"],
        nativeRef: json["nativeRef"],
        nativeType: json["nativeType"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "actionVersion": actionVersion,
    "nativeRef": nativeRef,
    "nativeType": nativeType,
    "workspaceId": workspaceId,
  });
}

///Reference-only observation of the original HUMAN AE. Component terminal status comes from
///original component-action audit after native/usage reconciliation. Native-origin platform
///resource permission actions use their exact permission-outcome audit; that outcome does
///not assert completion of a component's native sharing RPCs. Never infer a terminal result
///from HTTP acceptance.
class NativeHumanActionResult {
  ///Original admitted canonical capability metadata input; exactly one input form, never a
  ///result body or a new execution authority.
  final String? inputJson;
  final ContentReference? inputReference;

  ///Original dispatched native-writer reference only. Neither existence nor RUNNING proves
  ///byte completion; no bearer is exposed by observation.
  final NativeHumanActionResultNativeExecution? nativeExecution;

  ///Transient same-request writer bearer for the exact original AE/EE. The native task must
  ///atomically claim the byte step before using it; never persisted or exposed to the browser.
  final NativeHumanActionResultNativeExecutionAdmission?
  nativeExecutionAdmission;
  final String? nativeId;
  final String? nativeType;

  ///First native same-request read only. Never returned by idempotency observation or retried
  ///admission; the bearer is not persisted.
  final NativeHumanActionResultReadAdmission? readAdmission;
  final ActionSubmission submission;
  final TaskStatus? terminalStatus;

  NativeHumanActionResult({
    this.inputJson,
    this.inputReference,
    this.nativeExecution,
    this.nativeExecutionAdmission,
    this.nativeId,
    this.nativeType,
    this.readAdmission,
    required this.submission,
    this.terminalStatus,
  });

  factory NativeHumanActionResult.fromJson(Map<String, dynamic> json) =>
      NativeHumanActionResult(
        inputJson: json["inputJson"],
        inputReference: json["inputReference"] == null
            ? null
            : ContentReference.fromJson(json["inputReference"]),
        nativeExecution: json["nativeExecution"] == null
            ? null
            : NativeHumanActionResultNativeExecution.fromJson(
                json["nativeExecution"],
              ),
        nativeExecutionAdmission: json["nativeExecutionAdmission"] == null
            ? null
            : NativeHumanActionResultNativeExecutionAdmission.fromJson(
                json["nativeExecutionAdmission"],
              ),
        nativeId: json["nativeId"],
        nativeType: json["nativeType"],
        readAdmission: json["readAdmission"] == null
            ? null
            : NativeHumanActionResultReadAdmission.fromJson(
                json["readAdmission"],
              ),
        submission: ActionSubmission.fromJson(json["submission"]),
        terminalStatus: json["terminalStatus"] == null
            ? null
            : taskStatusValues.map[json["terminalStatus"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "inputJson": inputJson,
    "inputReference": inputReference?.toJson(),
    "nativeExecution": nativeExecution?.toJson(),
    "nativeExecutionAdmission": nativeExecutionAdmission?.toJson(),
    "nativeId": nativeId,
    "nativeType": nativeType,
    "readAdmission": readAdmission?.toJson(),
    "submission": submission.toJson(),
    "terminalStatus": taskStatusValues.reverse[terminalStatus],
  });
}

///Original dispatched native-writer reference only. Neither existence nor RUNNING proves
///byte completion; no bearer is exposed by observation.
class NativeHumanActionResultNativeExecution {
  final int bindingGeneration;
  final String externalExecutionId;
  final String idempotencyKey;
  final String nativeIntentId;

  NativeHumanActionResultNativeExecution({
    required this.bindingGeneration,
    required this.externalExecutionId,
    required this.idempotencyKey,
    required this.nativeIntentId,
  });

  factory NativeHumanActionResultNativeExecution.fromJson(
    Map<String, dynamic> json,
  ) => NativeHumanActionResultNativeExecution(
    bindingGeneration: json["bindingGeneration"],
    externalExecutionId: json["externalExecutionId"],
    idempotencyKey: json["idempotencyKey"],
    nativeIntentId: json["nativeIntentId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingGeneration": bindingGeneration,
    "externalExecutionId": externalExecutionId,
    "idempotencyKey": idempotencyKey,
    "nativeIntentId": nativeIntentId,
  });
}

///Transient same-request writer bearer for the exact original AE/EE. The native task must
///atomically claim the byte step before using it; never persisted or exposed to the browser.
class NativeHumanActionResultNativeExecutionAdmission {
  final String actionToken;
  final String argumentsJson;

  ///RFC3339 admission expiry, preserved verbatim across language bindings and validated by
  ///the native writer before every byte step.
  final String expiresAt;

  NativeHumanActionResultNativeExecutionAdmission({
    required this.actionToken,
    required this.argumentsJson,
    required this.expiresAt,
  });

  factory NativeHumanActionResultNativeExecutionAdmission.fromJson(
    Map<String, dynamic> json,
  ) => NativeHumanActionResultNativeExecutionAdmission(
    actionToken: json["actionToken"],
    argumentsJson: json["argumentsJson"],
    expiresAt: json["expiresAt"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionToken": actionToken,
    "argumentsJson": argumentsJson,
    "expiresAt": expiresAt,
  });
}

///First native same-request read only. Never returned by idempotency observation or retried
///admission; the bearer is not persisted.
class NativeHumanActionResultReadAdmission {
  final String actionToken;
  final String argumentsJson;
  final int expiresAt;

  NativeHumanActionResultReadAdmission({
    required this.actionToken,
    required this.argumentsJson,
    required this.expiresAt,
  });

  factory NativeHumanActionResultReadAdmission.fromJson(
    Map<String, dynamic> json,
  ) => NativeHumanActionResultReadAdmission(
    actionToken: json["actionToken"],
    argumentsJson: json["argumentsJson"],
    expiresAt: json["expiresAt"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionToken": actionToken,
    "argumentsJson": argumentsJson,
    "expiresAt": expiresAt,
  });
}

///Current already-registered native Resource selected under the original HUMAN action
///permission. Metadata only, not an admission ticket; submission rechecks version, binding
///and permission.
class NativeHumanResourceResult {
  final NativeHumanResourceSelection resource;

  NativeHumanResourceResult({required this.resource});

  factory NativeHumanResourceResult.fromJson(Map<String, dynamic> json) =>
      NativeHumanResourceResult(
        resource: NativeHumanResourceSelection.fromJson(json["resource"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({"resource": resource.toJson()});
}

class NativeHumanResourceSelection {
  final String nativeInstanceRef;
  final String nativeRef;
  final String nativeScopeRef;
  final String nativeType;
  final String resourceId;
  final int resourceVersion;

  NativeHumanResourceSelection({
    required this.nativeInstanceRef,
    required this.nativeRef,
    required this.nativeScopeRef,
    required this.nativeType,
    required this.resourceId,
    required this.resourceVersion,
  });

  factory NativeHumanResourceSelection.fromJson(Map<String, dynamic> json) =>
      NativeHumanResourceSelection(
        nativeInstanceRef: json["nativeInstanceRef"],
        nativeRef: json["nativeRef"],
        nativeScopeRef: json["nativeScopeRef"],
        nativeType: json["nativeType"],
        resourceId: json["resourceId"],
        resourceVersion: json["resourceVersion"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nativeInstanceRef": nativeInstanceRef,
    "nativeRef": nativeRef,
    "nativeScopeRef": nativeScopeRef,
    "nativeType": nativeType,
    "resourceId": resourceId,
    "resourceVersion": resourceVersion,
  });
}

///Fresh permission check for native metadata in the authenticated binding's existing
///tenant/workspace scope. Not an ActionExecution, permission cache, or execution ticket;
///native Resource bodies still require their own current read permission.
class NativeHumanScopeResult {
  final NativeHumanScopeSelection scope;

  NativeHumanScopeResult({required this.scope});

  factory NativeHumanScopeResult.fromJson(Map<String, dynamic> json) =>
      NativeHumanScopeResult(
        scope: NativeHumanScopeSelection.fromJson(json["scope"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({"scope": scope.toJson()});
}

class NativeHumanScopeSelection {
  final String bindingId;
  final String checkedRevision;
  final int generation;
  final String nativeInstanceRef;
  final String nativeScopeRef;
  final NativeHumanScopeQueryPermission permission;
  final String tenantId;
  final String? workspaceId;

  NativeHumanScopeSelection({
    required this.bindingId,
    required this.checkedRevision,
    required this.generation,
    required this.nativeInstanceRef,
    required this.nativeScopeRef,
    required this.permission,
    required this.tenantId,
    this.workspaceId,
  });

  factory NativeHumanScopeSelection.fromJson(Map<String, dynamic> json) =>
      NativeHumanScopeSelection(
        bindingId: json["bindingId"],
        checkedRevision: json["checkedRevision"],
        generation: json["generation"],
        nativeInstanceRef: json["nativeInstanceRef"],
        nativeScopeRef: json["nativeScopeRef"],
        permission:
            nativeHumanScopeQueryPermissionValues.map[json["permission"]]!,
        tenantId: json["tenantId"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "checkedRevision": checkedRevision,
    "generation": generation,
    "nativeInstanceRef": nativeInstanceRef,
    "nativeScopeRef": nativeScopeRef,
    "permission": nativeHumanScopeQueryPermissionValues.reverse[permission],
    "tenantId": tenantId,
    "workspaceId": workspaceId,
  });
}

///GET /api/v1/audit 回应数组的元素：调用方本人在当前 Tenant 内的动作（.design/03 §14 的最小集合）。
class OwnAuditEntry {
  final String actionKey;
  final String decision;
  final AuditEventType eventType;

  ///RFC3339
  final String occurredAt;
  final String resultCode;

  ///动作所在的 Workspace；Tenant 级动作（设备公钥登记、认证等）缺省
  final String? workspaceId;

  OwnAuditEntry({
    required this.actionKey,
    required this.decision,
    required this.eventType,
    required this.occurredAt,
    required this.resultCode,
    this.workspaceId,
  });

  factory OwnAuditEntry.fromJson(Map<String, dynamic> json) => OwnAuditEntry(
    actionKey: json["actionKey"],
    decision: json["decision"],
    eventType: auditEventTypeValues.map[json["eventType"]]!,
    occurredAt: json["occurredAt"],
    resultCode: json["resultCode"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": actionKey,
    "decision": decision,
    "eventType": auditEventTypeValues.reverse[eventType],
    "occurredAt": occurredAt,
    "resultCode": resultCode,
    "workspaceId": workspaceId,
  });
}

///GET /api/v1/platform-info 的回应（DD-111）：只含公开展示字段，不依赖 PlatformSession
///与身份解析，仍在网关入口的认证之后。displayName 取自部署配置 PLATFORM_DISPLAY_NAME，是界面上产品名的唯一来源。
class PlatformInfo {
  ///部署的显示名，去除首尾空白后非空
  final String displayName;

  PlatformInfo({required this.displayName});

  factory PlatformInfo.fromJson(Map<String, dynamic> json) =>
      PlatformInfo(displayName: json["displayName"]);

  Map<String, dynamic> toJson() => _stripNulls({"displayName": displayName});
}

///GET /api/v1/platform/tenants 的有界回应：只对 Platform Catalog Tenant 中持有 fresh Catalog manage
///的会话开放，列出业务 Tenant 及其当前状态与可发起的暂停/恢复动作提示（DD-96）。动作提交仍由 Core 重新准入。
class PlatformTenantPage {
  ///下一页的 Core 索引偏移，缺省即读完
  final int? nextOffset;
  final List<PlatformTenantView> tenants;

  PlatformTenantPage({this.nextOffset, required this.tenants});

  factory PlatformTenantPage.fromJson(Map<String, dynamic> json) =>
      PlatformTenantPage(
        nextOffset: json["nextOffset"],
        tenants: List<PlatformTenantView>.from(
          json["tenants"].map((x) => PlatformTenantView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nextOffset": nextOffset,
    "tenants": List<dynamic>.from(tenants.map((x) => x.toJson())),
  });
}

class PlatformTenantView {
  final String id;

  ///按该 Tenant 当前状态可发起的暂停（ACTIVE，或协作面 binding 为 ACTIVE 的 ERROR）或恢复（SUSPENDED）动作
  ///key；目录未开放、处于收敛中或本页提示判定失败时省略
  final TenantLifecycleActionKey? lifecycleActionKey;
  final String name;
  final String slug;
  final TenantState state;

  PlatformTenantView({
    required this.id,
    this.lifecycleActionKey,
    required this.name,
    required this.slug,
    required this.state,
  });

  factory PlatformTenantView.fromJson(Map<String, dynamic> json) =>
      PlatformTenantView(
        id: json["id"],
        lifecycleActionKey: json["lifecycleActionKey"] == null
            ? null
            : tenantLifecycleActionKeyValues.map[json["lifecycleActionKey"]]!,
        name: json["name"],
        slug: json["slug"],
        state: tenantStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "id": id,
    "lifecycleActionKey":
        tenantLifecycleActionKeyValues.reverse[lifecycleActionKey],
    "name": name,
    "slug": slug,
    "state": tenantStateValues.reverse[state],
  });
}

///按该 Tenant 当前状态可发起的暂停（ACTIVE，或协作面 binding 为 ACTIVE 的 ERROR）或恢复（SUSPENDED）动作
///key；目录未开放、处于收敛中或本页提示判定失败时省略
///
///业务 Tenant 暂停与恢复的 ActionDefinition key（DD-96）。两者都由 Platform Catalog Tenant 的
///platform-admin 发起；Tenant delete 随 Stage 3 注册，不在此列。
enum TenantLifecycleActionKey { TENANT_RESTORE, TENANT_SUSPEND }

final tenantLifecycleActionKeyValues = EnumValues({
  "tenant.restore": TenantLifecycleActionKey.TENANT_RESTORE,
  "tenant.suspend": TenantLifecycleActionKey.TENANT_SUSPEND,
});

///Tenant 状态机。权威定义见 .design/03-领域模型与权限模型.md。DELETING/DELETED 因 GAP-LCM-01
///开放而不注册入口，但状态本身保留以承载已有记录。
enum TenantState {
  ACTIVE,
  DELETED,
  DELETING,
  ERROR,
  PROVISIONING,
  RESTORING,
  SUSPENDED,
  SUSPENDING,
}

final tenantStateValues = EnumValues({
  "ACTIVE": TenantState.ACTIVE,
  "DELETED": TenantState.DELETED,
  "DELETING": TenantState.DELETING,
  "ERROR": TenantState.ERROR,
  "PROVISIONING": TenantState.PROVISIONING,
  "RESTORING": TenantState.RESTORING,
  "SUSPENDED": TenantState.SUSPENDED,
  "SUSPENDING": TenantState.SUSPENDING,
});

class PlatformToolPage {
  final int? nextOffset;
  final List<PlatformToolView> tools;

  PlatformToolPage({this.nextOffset, required this.tools});

  factory PlatformToolPage.fromJson(Map<String, dynamic> json) =>
      PlatformToolPage(
        nextOffset: json["nextOffset"],
        tools: List<PlatformToolView>.from(
          json["tools"].map((x) => PlatformToolView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nextOffset": nextOffset,
    "tools": List<dynamic>.from(tools.map((x) => x.toJson())),
  });
}

class PlatformToolView {
  ///DD-140 (1)：平台原生工具名到动作键的封闭映射；记忆工具即其自身，project_channel_request 为
  ///workspace.create。DD-149：连接器工具为其调用策略对应的子动作键。
  final PlatformToolViewActionKey actionKey;
  final bool canConsume;

  ///仅 USER_REGISTERED_EXTERNAL（DD-149）：所属连接器与冻结的工具元数据。描述是上游提供的不可信文本。
  final PlatformToolConnector? connector;
  final String inputSchemaHash;

  ///PLATFORM_NATIVE
  ///为固定原生工具名（agent.memory.entry.list、agent.memory.entry.read、project_channel_request）；USER_REGISTERED_EXTERNAL
  ///为 <连接器标识>__<上游工具名>（DD-149(3)）。
  final String name;
  final String outputSchemaHash;
  final String ownerPrincipalId;
  final String resourceId;
  final ResourceState resourceState;
  final int resourceVersion;
  final PlatformToolViewSource source;
  final PlatformToolViewStatus status;

  PlatformToolView({
    required this.actionKey,
    required this.canConsume,
    this.connector,
    required this.inputSchemaHash,
    required this.name,
    required this.outputSchemaHash,
    required this.ownerPrincipalId,
    required this.resourceId,
    required this.resourceState,
    required this.resourceVersion,
    required this.source,
    required this.status,
  });

  factory PlatformToolView.fromJson(Map<String, dynamic> json) =>
      PlatformToolView(
        actionKey: platformToolViewActionKeyValues.map[json["actionKey"]]!,
        canConsume: json["canConsume"],
        connector: json["connector"] == null
            ? null
            : PlatformToolConnector.fromJson(json["connector"]),
        inputSchemaHash: json["inputSchemaHash"],
        name: json["name"],
        outputSchemaHash: json["outputSchemaHash"],
        ownerPrincipalId: json["ownerPrincipalId"],
        resourceId: json["resourceId"],
        resourceState: resourceStateValues.map[json["resourceState"]]!,
        resourceVersion: json["resourceVersion"],
        source: platformToolViewSourceValues.map[json["source"]]!,
        status: platformToolViewStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": platformToolViewActionKeyValues.reverse[actionKey],
    "canConsume": canConsume,
    "connector": connector?.toJson(),
    "inputSchemaHash": inputSchemaHash,
    "name": name,
    "outputSchemaHash": outputSchemaHash,
    "ownerPrincipalId": ownerPrincipalId,
    "resourceId": resourceId,
    "resourceState": resourceStateValues.reverse[resourceState],
    "resourceVersion": resourceVersion,
    "source": platformToolViewSourceValues.reverse[source],
    "status": platformToolViewStatusValues.reverse[status],
  });
}

///DD-140 (1)：平台原生工具名到动作键的封闭映射；记忆工具即其自身，project_channel_request 为
///workspace.create。DD-149：连接器工具为其调用策略对应的子动作键。
enum PlatformToolViewActionKey {
  AGENT_MEMORY_ENTRY_LIST,
  AGENT_MEMORY_ENTRY_READ,
  MCP_CONNECTION_TOOL_INVOKE,
  MCP_CONNECTION_TOOL_INVOKE_APPROVED,
  MCP_CONNECTION_TOOL_INVOKE_CONFIRMED,
  WORKSPACE_CREATE,
}

final platformToolViewActionKeyValues = EnumValues({
  "agent.memory.entry.list": PlatformToolViewActionKey.AGENT_MEMORY_ENTRY_LIST,
  "agent.memory.entry.read": PlatformToolViewActionKey.AGENT_MEMORY_ENTRY_READ,
  "mcp_connection.tool.invoke":
      PlatformToolViewActionKey.MCP_CONNECTION_TOOL_INVOKE,
  "mcp_connection.tool.invoke_approved":
      PlatformToolViewActionKey.MCP_CONNECTION_TOOL_INVOKE_APPROVED,
  "mcp_connection.tool.invoke_confirmed":
      PlatformToolViewActionKey.MCP_CONNECTION_TOOL_INVOKE_CONFIRMED,
  "workspace.create": PlatformToolViewActionKey.WORKSPACE_CREATE,
});

///仅 USER_REGISTERED_EXTERNAL（DD-149）：所属连接器与冻结的工具元数据。描述是上游提供的不可信文本。
class PlatformToolConnector {
  final McpToolCallPolicy callPolicy;
  final String connectionId;
  final String connectionName;
  final McpConnectionState connectionState;
  final String? description;
  final McpToolRisk risk;
  final String? title;
  final String upstreamName;
  final McpConnectionVisibility visibility;
  final String? workspaceId;

  PlatformToolConnector({
    required this.callPolicy,
    required this.connectionId,
    required this.connectionName,
    required this.connectionState,
    this.description,
    required this.risk,
    this.title,
    required this.upstreamName,
    required this.visibility,
    this.workspaceId,
  });

  factory PlatformToolConnector.fromJson(Map<String, dynamic> json) =>
      PlatformToolConnector(
        callPolicy: mcpToolCallPolicyValues.map[json["callPolicy"]]!,
        connectionId: json["connectionId"],
        connectionName: json["connectionName"],
        connectionState: mcpConnectionStateValues.map[json["connectionState"]]!,
        description: json["description"],
        risk: mcpToolRiskValues.map[json["risk"]]!,
        title: json["title"],
        upstreamName: json["upstreamName"],
        visibility: mcpConnectionVisibilityValues.map[json["visibility"]]!,
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "callPolicy": mcpToolCallPolicyValues.reverse[callPolicy],
    "connectionId": connectionId,
    "connectionName": connectionName,
    "connectionState": mcpConnectionStateValues.reverse[connectionState],
    "description": description,
    "risk": mcpToolRiskValues.reverse[risk],
    "title": title,
    "upstreamName": upstreamName,
    "visibility": mcpConnectionVisibilityValues.reverse[visibility],
    "workspaceId": workspaceId,
  });
}

enum PlatformToolViewSource { PLATFORM_NATIVE, USER_REGISTERED_EXTERNAL }

final platformToolViewSourceValues = EnumValues({
  "PLATFORM_NATIVE": PlatformToolViewSource.PLATFORM_NATIVE,
  "USER_REGISTERED_EXTERNAL": PlatformToolViewSource.USER_REGISTERED_EXTERNAL,
});

enum PlatformToolViewStatus { ACTIVE, PROVISIONING }

final platformToolViewStatusValues = EnumValues({
  "ACTIVE": PlatformToolViewStatus.ACTIVE,
  "PROVISIONING": PlatformToolViewStatus.PROVISIONING,
});

///DD-40 original Projects Added/remove preference. Native coordinate only, not membership
///or content permission. Uses the same CollaborationUserState version CAS.
class ProjectPreferenceRequest {
  final String projectAddress;
  final bool selected;
  final int version;

  ProjectPreferenceRequest({
    required this.projectAddress,
    required this.selected,
    required this.version,
  });

  factory ProjectPreferenceRequest.fromJson(Map<String, dynamic> json) =>
      ProjectPreferenceRequest(
        projectAddress: json["projectAddress"],
        selected: json["selected"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "projectAddress": projectAddress,
    "selected": selected,
    "version": version,
  });
}

///DD-118: the original Buzz Desktop merge_project_pull_request through BFF. Only when the
///person's own SERVER key is the repository coordinate owner: Core merges the review's
///source branch into the target branch in a temporary clone, pushes as that owner (Relay
///pre-receive policy decides), then publishes the owner-signed original kind 1631 merged
///status through the existing publication chain. Carries the Idempotency-Key header; the
///push is keyed by (repository, target ref, old->new) and reconciled from info/refs; 1631
///follows DD-81.
class ProjectsGitMergeRequest {
  ///Original expected source head; a moved source branch is a conflict, never a silent merge
  ///of other commits.
  final String expectedCommit;

  ///The original 1618 review being merged.
  final String pullRequestEventId;
  final String repository;
  final String sourceBranch;
  final String targetBranch;

  ProjectsGitMergeRequest({
    required this.expectedCommit,
    required this.pullRequestEventId,
    required this.repository,
    required this.sourceBranch,
    required this.targetBranch,
  });

  factory ProjectsGitMergeRequest.fromJson(Map<String, dynamic> json) =>
      ProjectsGitMergeRequest(
        expectedCommit: json["expectedCommit"],
        pullRequestEventId: json["pullRequestEventId"],
        repository: json["repository"],
        sourceBranch: json["sourceBranch"],
        targetBranch: json["targetBranch"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "expectedCommit": expectedCommit,
    "pullRequestEventId": pullRequestEventId,
    "repository": repository,
    "sourceBranch": sourceBranch,
    "targetBranch": targetBranch,
  });
}

///DD-118: the original ProjectRepoMergeResult without its English message. statusEventId is
///the owner-signed 1631 merged status; it is present once that publication is accepted.
class ProjectsGitMergeResponse {
  final String mergeCommit;
  final String? statusEventId;

  ProjectsGitMergeResponse({required this.mergeCommit, this.statusEventId});

  factory ProjectsGitMergeResponse.fromJson(Map<String, dynamic> json) =>
      ProjectsGitMergeResponse(
        mergeCommit: json["mergeCommit"],
        statusEventId: json["statusEventId"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"mergeCommit": mergeCommit, "statusEventId": statusEventId});
}

///DD-118: the original Buzz Desktop remote repository reads
///(get_project_repo_snapshot/get_project_repo_file_content/get_project_repo_diff) through
///BFF. The repository is named by its 30617 coordinate, never by a clone URL; Relay
///authorize_git_read decides access with the person's own SERVER identity.
class ProjectsGitQueryRequest {
  final String? baseBranch;
  final String? defaultBranch;

  ///FILE_CONTENT only.
  final String? path;
  final String repository;
  final String? targetCommit;
  final String? targetRef;
  final ProjectsGitQueryRequestView view;

  ProjectsGitQueryRequest({
    this.baseBranch,
    this.defaultBranch,
    this.path,
    required this.repository,
    this.targetCommit,
    this.targetRef,
    required this.view,
  });

  factory ProjectsGitQueryRequest.fromJson(Map<String, dynamic> json) =>
      ProjectsGitQueryRequest(
        baseBranch: json["baseBranch"],
        defaultBranch: json["defaultBranch"],
        path: json["path"],
        repository: json["repository"],
        targetCommit: json["targetCommit"],
        targetRef: json["targetRef"],
        view: projectsGitQueryRequestViewValues.map[json["view"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "baseBranch": baseBranch,
    "defaultBranch": defaultBranch,
    "path": path,
    "repository": repository,
    "targetCommit": targetCommit,
    "targetRef": targetRef,
    "view": projectsGitQueryRequestViewValues.reverse[view],
  });
}

enum ProjectsGitQueryRequestView { DIFF, FILE_CONTENT, SNAPSHOT }

final projectsGitQueryRequestViewValues = EnumValues({
  "DIFF": ProjectsGitQueryRequestView.DIFF,
  "FILE_CONTENT": ProjectsGitQueryRequestView.FILE_CONTENT,
  "SNAPSHOT": ProjectsGitQueryRequestView.SNAPSHOT,
});

///DD-118: exactly one of snapshot/content/diff matches the requested view, in the original
///Buzz Desktop shapes (ProjectRepoSnapshot, file preview, ProjectRepoDiff) with the
///original 64 KiB, 2000-line and 250-file bounds.
class ProjectsGitQueryResponse {
  ///FILE_CONTENT preview; null when the file is binary or over the original preview bound.
  final String? content;
  final ProjectRepoDiff? diff;
  final ProjectRepoSnapshot? snapshot;
  final ProjectsGitQueryRequestView view;

  ProjectsGitQueryResponse({
    this.content,
    this.diff,
    this.snapshot,
    required this.view,
  });

  factory ProjectsGitQueryResponse.fromJson(Map<String, dynamic> json) =>
      ProjectsGitQueryResponse(
        content: json["content"],
        diff: json["diff"] == null
            ? null
            : ProjectRepoDiff.fromJson(json["diff"]),
        snapshot: json["snapshot"] == null
            ? null
            : ProjectRepoSnapshot.fromJson(json["snapshot"]),
        view: projectsGitQueryRequestViewValues.map[json["view"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "content": content,
    "diff": diff?.toJson(),
    "snapshot": snapshot?.toJson(),
    "view": projectsGitQueryRequestViewValues.reverse[view],
  });
}

class ProjectRepoDiff {
  final int additions;
  final String? commitBody;
  final int deletions;
  final List<ProjectRepoDiffFile> files;

  ProjectRepoDiff({
    required this.additions,
    required this.commitBody,
    required this.deletions,
    required this.files,
  });

  factory ProjectRepoDiff.fromJson(Map<String, dynamic> json) =>
      ProjectRepoDiff(
        additions: json["additions"],
        commitBody: json["commitBody"],
        deletions: json["deletions"],
        files: List<ProjectRepoDiffFile>.from(
          json["files"].map((x) => ProjectRepoDiffFile.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "additions": additions,
    "commitBody": commitBody,
    "deletions": deletions,
    "files": List<dynamic>.from(files.map((x) => x.toJson())),
  });
}

class ProjectRepoDiffFile {
  final int additions;
  final int deletions;
  final String patch;
  final String path;
  final bool truncated;

  ProjectRepoDiffFile({
    required this.additions,
    required this.deletions,
    required this.patch,
    required this.path,
    required this.truncated,
  });

  factory ProjectRepoDiffFile.fromJson(Map<String, dynamic> json) =>
      ProjectRepoDiffFile(
        additions: json["additions"],
        deletions: json["deletions"],
        patch: json["patch"],
        path: json["path"],
        truncated: json["truncated"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "additions": additions,
    "deletions": deletions,
    "patch": patch,
    "path": path,
    "truncated": truncated,
  });
}

class ProjectRepoSnapshot {
  final List<ProjectRepoCommit> commits;
  final List<ProjectRepoContributor> contributors;
  final List<ProjectRepoFile> files;

  ///Absent when the original value is null.
  final ProjectRepoCommit? latestCommit;

  ProjectRepoSnapshot({
    required this.commits,
    required this.contributors,
    required this.files,
    this.latestCommit,
  });

  factory ProjectRepoSnapshot.fromJson(Map<String, dynamic> json) =>
      ProjectRepoSnapshot(
        commits: List<ProjectRepoCommit>.from(
          json["commits"].map((x) => ProjectRepoCommit.fromJson(x)),
        ),
        contributors: List<ProjectRepoContributor>.from(
          json["contributors"].map((x) => ProjectRepoContributor.fromJson(x)),
        ),
        files: List<ProjectRepoFile>.from(
          json["files"].map((x) => ProjectRepoFile.fromJson(x)),
        ),
        latestCommit: json["latestCommit"] == null
            ? null
            : ProjectRepoCommit.fromJson(json["latestCommit"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "commits": List<dynamic>.from(commits.map((x) => x.toJson())),
    "contributors": List<dynamic>.from(contributors.map((x) => x.toJson())),
    "files": List<dynamic>.from(files.map((x) => x.toJson())),
    "latestCommit": latestCommit?.toJson(),
  });
}

///Absent when the original value is null.
class ProjectRepoCommit {
  final String authorEmail;
  final String authorName;
  final String hash;
  final String shortHash;
  final String subject;
  final int timestamp;

  ProjectRepoCommit({
    required this.authorEmail,
    required this.authorName,
    required this.hash,
    required this.shortHash,
    required this.subject,
    required this.timestamp,
  });

  factory ProjectRepoCommit.fromJson(Map<String, dynamic> json) =>
      ProjectRepoCommit(
        authorEmail: json["authorEmail"],
        authorName: json["authorName"],
        hash: json["hash"],
        shortHash: json["shortHash"],
        subject: json["subject"],
        timestamp: json["timestamp"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "authorEmail": authorEmail,
    "authorName": authorName,
    "hash": hash,
    "shortHash": shortHash,
    "subject": subject,
    "timestamp": timestamp,
  });
}

class ProjectRepoContributor {
  final int commitCount;
  final String email;
  final int lastCommitAt;
  final String name;

  ProjectRepoContributor({
    required this.commitCount,
    required this.email,
    required this.lastCommitAt,
    required this.name,
  });

  factory ProjectRepoContributor.fromJson(Map<String, dynamic> json) =>
      ProjectRepoContributor(
        commitCount: json["commitCount"],
        email: json["email"],
        lastCommitAt: json["lastCommitAt"],
        name: json["name"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "commitCount": commitCount,
    "email": email,
    "lastCommitAt": lastCommitAt,
    "name": name,
  });
}

class ProjectRepoFile {
  final String kind;
  final int? lastChangedAt;

  ///Absent when the original value is null.
  final ProjectRepoCommit? latestCommit;
  final String path;
  final String? previewContent;
  final int? size;

  ProjectRepoFile({
    required this.kind,
    required this.lastChangedAt,
    this.latestCommit,
    required this.path,
    required this.previewContent,
    required this.size,
  });

  factory ProjectRepoFile.fromJson(Map<String, dynamic> json) =>
      ProjectRepoFile(
        kind: json["kind"],
        lastChangedAt: json["lastChangedAt"],
        latestCommit: json["latestCommit"] == null
            ? null
            : ProjectRepoCommit.fromJson(json["latestCommit"]),
        path: json["path"],
        previewContent: json["previewContent"],
        size: json["size"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "kind": kind,
    "lastChangedAt": lastChangedAt,
    "latestCommit": latestCommit?.toJson(),
    "path": path,
    "previewContent": previewContent,
    "size": size,
  });
}

///DD-118: the original Buzz Desktop
///create_project_remote_branch/delete_project_remote_branch through BFF. The person's own
///SERVER identity pushes to the Relay repository named by its 30617 coordinate; Relay
///pre-receive policy decides. The request carries the Idempotency-Key header; the push is
///keyed by (repository, ref, old->new) and reconciled from info/refs.
class ProjectsGitRefRequest {
  ///CREATE_BRANCH: the new branch. DELETE_BRANCH: the branch to delete.
  final String branch;

  ///CREATE_BRANCH: the source branch head the new branch starts at. DELETE_BRANCH: the branch
  ///head being deleted.
  final String expectedCommit;
  final ProjectGitRefOperation operation;
  final String repository;

  ///CREATE_BRANCH only: the original source branch.
  final String? sourceBranch;

  ProjectsGitRefRequest({
    required this.branch,
    required this.expectedCommit,
    required this.operation,
    required this.repository,
    this.sourceBranch,
  });

  factory ProjectsGitRefRequest.fromJson(Map<String, dynamic> json) =>
      ProjectsGitRefRequest(
        branch: json["branch"],
        expectedCommit: json["expectedCommit"],
        operation: projectGitRefOperationValues.map[json["operation"]]!,
        repository: json["repository"],
        sourceBranch: json["sourceBranch"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "branch": branch,
    "expectedCommit": expectedCommit,
    "operation": projectGitRefOperationValues.reverse[operation],
    "repository": repository,
    "sourceBranch": sourceBranch,
  });
}

enum ProjectGitRefOperation { CREATE_BRANCH, DELETE_BRANCH }

final projectGitRefOperationValues = EnumValues({
  "CREATE_BRANCH": ProjectGitRefOperation.CREATE_BRANCH,
  "DELETE_BRANCH": ProjectGitRefOperation.DELETE_BRANCH,
});

///DD-118: the original ProjectRepoBranchResult without its English message; the branch and
///the commit the ref now points at (DELETE_BRANCH: the deleted head).
class ProjectsGitRefResponse {
  final String branch;
  final String commit;

  ProjectsGitRefResponse({required this.branch, required this.commit});

  factory ProjectsGitRefResponse.fromJson(Map<String, dynamic> json) =>
      ProjectsGitRefResponse(branch: json["branch"], commit: json["commit"]);

  Map<String, dynamic> toJson() =>
      _stripNulls({"branch": branch, "commit": commit});
}

///Typed original Community announcement mutation. Actor is the authenticated SERVER or
///CLIENT signer, never supplied by this request. Creation resolves the home Channel from an
///admitted Workspace; metadata is transient and remains Relay-owned. DELETE selects a real
///signed current announcement; it does not delete its channel or repositories.
///CREATE_PULL_REQUEST publishes the original NIP-34 1618 review for a branch already on the
///repository (DD-118); the push itself is not part of this request. APPROVE_PULL_REQUEST
///and the request-changes / inline-line variants of CREATE_PULL_REQUEST_COMMENT publish the
///original labeled kind-1 review comments (desktop
///pullRequestReviews.ts::submitProjectPullRequestReview,
///hooks.ts::createProjectPullRequestComment) against the named review head; they introduce
///no new Nostr kind (DD-118(5)). ATTACH_REPOSITORY (original useAttachProjectRepository /
///useAddProjectRepository) republishes the signer's current 30621 head named by
///targetEventId with one more member `a` coordinate; every other tag and the content are
///kept. BIND_REPOSITORY_CHANNEL (original useBindProjectRepositoryChannel) republishes the
///signer's current 30617 head with `buzz-channel` replaced by the admitted Workspace's
///Channel. ADD_PROJECT_CHANNEL (original useAddProjectChannel) appends that Channel as a
///`buzz-related-channel` tag to the signer's current 30621 head; the Channel itself is
///created by the existing workspace.create action, never by this request. None of them
///grants Git, Channel or project authority (REQ-24, DD-80, DD-118).
class ProjectsPublishRequest {
  ///Original inline diff anchor `line`: a 1-based line on the given side of the review diff.
  final int? anchorLine;

  ///Original inline diff anchor `file` (normalizeProjectPullRequestCommentAnchor):
  ///repository-relative, no leading slash, backslash, NUL, empty, `.` or `..` segment; at
  ///most 4096 UTF-16 code units. Only on CREATE_PULL_REQUEST_COMMENT, together with
  ///anchorSide, anchorLine and commit.
  final String? anchorPath;

  ///Original inline diff anchor `side`.
  final ProjectPullRequestCommentSide? anchorSide;

  ///Original transient display label, trimmed and limited to 128 Unicode characters by the
  ///consumer. Never an identity or authorization claim.
  final String? assigneeLabel;

  ///Other HUMAN recipient of an original issue-author/repository-owner assignment. Resolved
  ///against the admitted Tenant's existing HUMAN identity directory; never a signing
  ///identity. Self operations do not accept this field.
  final String? assigneePubkey;
  final List<WebMessageAttachment>? attachments;

  ///Original complete markdown including attachment markdown. Issues may be empty; comments
  ///must be nonempty after trim. Current Relay NIP-11 and body admission limits are enforced
  ///before signing.
  final String? body;

  ///Original 1618 `branch-name`: the compare branch, already present on the Relay repository.
  final String? branchName;
  final ProjectIssueCategory? category;

  ///CREATE_REPOSITORY only: the original optional `clone` tag of a new repository
  ///announcement (AddProjectRepositoryDialog Clone URL). Only metadata: Kailo reads
  ///repository content through the 30617 coordinate (DD-118) and never fetches this URL.
  final String? cloneUrl;

  ///Original `c`. CREATE_PULL_REQUEST: compare branch head read from the trusted repository
  ///state. APPROVE_PULL_REQUEST and CREATE_PULL_REQUEST_COMMENT with reviewDecision or an
  ///anchor: the review head the reviewer looked at; the consumer refuses with
  ///TARGET_STATE_CONFLICT unless it is still the review's current trusted head. Required by
  ///those review comments and refused on ordinary comments.
  final String? commit;
  final String? description;
  final List<String>? mentions;

  ///Original 1618 `merge-base`, when known.
  final String? mergeBase;
  final String? name;
  final ProjectPublicationOperation operation;

  ///Optional immutable original per-self assignment operation head. Same publication intent
  ///retains it across UNKNOWN observation; never an authorization grant.
  final String? priorEventId;

  ///Original pullRequestReviews.ts lifecycle states the UI may publish (NIP-34
  ///1630/1633/1632). Merged (1631) happens through git and is never accepted here. Only the
  ///review author or repository owner signs it.
  final ProjectPullRequestLifecycleStatus? pullRequestStatus;

  ///ATTACH_REPOSITORY only: the original NIP-34 repository coordinate added as a member `a`
  ///tag. A coordinate, never a clone URL or an access grant; the repository head may not
  ///exist yet when it is the first step of the original add-repository sequence.
  final String? repositoryAddress;

  ///Original hooks.ts ProjectPullRequestCommentDecision on CREATE_PULL_REQUEST_COMMENT only:
  ///adds the `changes-requested` label. Only a requested reviewer or the repository owner,
  ///never the review author, may request changes on an open or draft review; readers trust
  ///nothing else (projectPullRequests.mjs).
  final ProjectPullRequestCommentDecision? reviewDecision;

  ///Original requested reviewers (p tags beside the repository owner). Never a signing
  ///identity or grant.
  final List<String>? reviewers;

  ///Original 1618 `target-branch`: the base branch.
  final String? targetBranch;
  final String? targetEventId;

  ///Original trimmed issue subject; the consumer additionally enforces the original
  ///JavaScript 256 UTF-16 code-unit limit.
  final String? title;
  final ProjectListingVisibility? visibility;
  final String? workspaceId;

  ProjectsPublishRequest({
    this.anchorLine,
    this.anchorPath,
    this.anchorSide,
    this.assigneeLabel,
    this.assigneePubkey,
    this.attachments,
    this.body,
    this.branchName,
    this.category,
    this.cloneUrl,
    this.commit,
    this.description,
    this.mentions,
    this.mergeBase,
    this.name,
    required this.operation,
    this.priorEventId,
    this.pullRequestStatus,
    this.repositoryAddress,
    this.reviewDecision,
    this.reviewers,
    this.targetBranch,
    this.targetEventId,
    this.title,
    this.visibility,
    this.workspaceId,
  });

  factory ProjectsPublishRequest.fromJson(
    Map<String, dynamic> json,
  ) => ProjectsPublishRequest(
    anchorLine: json["anchorLine"],
    anchorPath: json["anchorPath"],
    anchorSide: json["anchorSide"] == null
        ? null
        : projectPullRequestCommentSideValues.map[json["anchorSide"]]!,
    assigneeLabel: json["assigneeLabel"],
    assigneePubkey: json["assigneePubkey"],
    attachments: json["attachments"] == null
        ? null
        : List<WebMessageAttachment>.from(
            json["attachments"]!.map((x) => WebMessageAttachment.fromJson(x)),
          ),
    body: json["body"],
    branchName: json["branchName"],
    category: json["category"] == null
        ? null
        : projectIssueCategoryValues.map[json["category"]]!,
    cloneUrl: json["cloneUrl"],
    commit: json["commit"],
    description: json["description"],
    mentions: json["mentions"] == null
        ? null
        : List<String>.from(json["mentions"]!.map((x) => x)),
    mergeBase: json["mergeBase"],
    name: json["name"],
    operation: projectPublicationOperationValues.map[json["operation"]]!,
    priorEventId: json["priorEventId"],
    pullRequestStatus: json["pullRequestStatus"] == null
        ? null
        : projectPullRequestLifecycleStatusValues
              .map[json["pullRequestStatus"]]!,
    repositoryAddress: json["repositoryAddress"],
    reviewDecision: json["reviewDecision"] == null
        ? null
        : projectPullRequestCommentDecisionValues.map[json["reviewDecision"]]!,
    reviewers: json["reviewers"] == null
        ? null
        : List<String>.from(json["reviewers"]!.map((x) => x)),
    targetBranch: json["targetBranch"],
    targetEventId: json["targetEventId"],
    title: json["title"],
    visibility: json["visibility"] == null
        ? null
        : projectListingVisibilityValues.map[json["visibility"]]!,
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "anchorLine": anchorLine,
    "anchorPath": anchorPath,
    "anchorSide": projectPullRequestCommentSideValues.reverse[anchorSide],
    "assigneeLabel": assigneeLabel,
    "assigneePubkey": assigneePubkey,
    "attachments": attachments == null
        ? null
        : List<dynamic>.from(attachments!.map((x) => x.toJson())),
    "body": body,
    "branchName": branchName,
    "category": projectIssueCategoryValues.reverse[category],
    "cloneUrl": cloneUrl,
    "commit": commit,
    "description": description,
    "mentions": mentions == null
        ? null
        : List<dynamic>.from(mentions!.map((x) => x)),
    "mergeBase": mergeBase,
    "name": name,
    "operation": projectPublicationOperationValues.reverse[operation],
    "priorEventId": priorEventId,
    "pullRequestStatus":
        projectPullRequestLifecycleStatusValues.reverse[pullRequestStatus],
    "repositoryAddress": repositoryAddress,
    "reviewDecision":
        projectPullRequestCommentDecisionValues.reverse[reviewDecision],
    "reviewers": reviewers == null
        ? null
        : List<dynamic>.from(reviewers!.map((x) => x)),
    "targetBranch": targetBranch,
    "targetEventId": targetEventId,
    "title": title,
    "visibility": projectListingVisibilityValues.reverse[visibility],
    "workspaceId": workspaceId,
  });
}

///Original inline diff anchor `side`.
enum ProjectPullRequestCommentSide { NEW, OLD }

final projectPullRequestCommentSideValues = EnumValues({
  "new": ProjectPullRequestCommentSide.NEW,
  "old": ProjectPullRequestCommentSide.OLD,
});

class WebMessageAttachment {
  ///原 Buzz imeta 模糊预览编码。
  final String? blurhash;

  ///原 Buzz imeta 媒体尺寸显示元数据。
  final String? dim;

  ///原附件 Markdown 链接显示名称；与 filename 分离，只写入消息正文，不生成 imeta 字段。
  final String? displayLabel;

  ///原 video/mp4 时长（秒），须为正有限数；Relay 校验原 sidecar。
  final double? duration;

  ///原 Buzz imeta filename；仅为显示及下载名称，不参与媒体存储寻址。
  final String? filename;

  ///原 video/mp4 独立 poster 图片引用；只允许当前 Community 的媒体路径，Relay 校验原图片 sidecar。
  final String? image;
  final String sha256;
  final int size;

  ///沿原 Buzz Markdown 隐藏图片或视频；普通文件仍为文件链接。
  final bool? spoiler;

  ///当前 Community 内与附件 hash 相同的原 .thumb.jpg 引用；Relay 验证实际缩略图存在。
  final String? thumb;
  final String type;
  final String url;

  WebMessageAttachment({
    this.blurhash,
    this.dim,
    this.displayLabel,
    this.duration,
    this.filename,
    this.image,
    required this.sha256,
    required this.size,
    this.spoiler,
    this.thumb,
    required this.type,
    required this.url,
  });

  factory WebMessageAttachment.fromJson(Map<String, dynamic> json) =>
      WebMessageAttachment(
        blurhash: json["blurhash"],
        dim: json["dim"],
        displayLabel: json["displayLabel"],
        duration: json["duration"]?.toDouble(),
        filename: json["filename"],
        image: json["image"],
        sha256: json["sha256"],
        size: json["size"],
        spoiler: json["spoiler"],
        thumb: json["thumb"],
        type: json["type"],
        url: json["url"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "blurhash": blurhash,
    "dim": dim,
    "displayLabel": displayLabel,
    "duration": duration,
    "filename": filename,
    "image": image,
    "sha256": sha256,
    "size": size,
    "spoiler": spoiler,
    "thumb": thumb,
    "type": type,
    "url": url,
  });
}

enum ProjectIssueCategory { CHANGE_REQUEST, IMPROVEMENT, ISSUE }

final projectIssueCategoryValues = EnumValues({
  "change-request": ProjectIssueCategory.CHANGE_REQUEST,
  "improvement": ProjectIssueCategory.IMPROVEMENT,
  "issue": ProjectIssueCategory.ISSUE,
});

enum ProjectPublicationOperation {
  ADD_PROJECT_CHANNEL,
  APPROVE_PULL_REQUEST,
  ASSIGN_ISSUE,
  ATTACH_REPOSITORY,
  BIND_REPOSITORY_CHANNEL,
  CREATE_ISSUE,
  CREATE_ISSUE_COMMENT,
  CREATE_PROJECT,
  CREATE_PULL_REQUEST,
  CREATE_PULL_REQUEST_COMMENT,
  CREATE_REPOSITORY,
  DELETE,
  SELF_ASSIGN_ISSUE,
  SELF_UNASSIGN_ISSUE,
  SET_PULL_REQUEST_STATUS,
  UNASSIGN_ISSUE,
}

final projectPublicationOperationValues = EnumValues({
  "ADD_PROJECT_CHANNEL": ProjectPublicationOperation.ADD_PROJECT_CHANNEL,
  "APPROVE_PULL_REQUEST": ProjectPublicationOperation.APPROVE_PULL_REQUEST,
  "ASSIGN_ISSUE": ProjectPublicationOperation.ASSIGN_ISSUE,
  "ATTACH_REPOSITORY": ProjectPublicationOperation.ATTACH_REPOSITORY,
  "BIND_REPOSITORY_CHANNEL":
      ProjectPublicationOperation.BIND_REPOSITORY_CHANNEL,
  "CREATE_ISSUE": ProjectPublicationOperation.CREATE_ISSUE,
  "CREATE_ISSUE_COMMENT": ProjectPublicationOperation.CREATE_ISSUE_COMMENT,
  "CREATE_PROJECT": ProjectPublicationOperation.CREATE_PROJECT,
  "CREATE_PULL_REQUEST": ProjectPublicationOperation.CREATE_PULL_REQUEST,
  "CREATE_PULL_REQUEST_COMMENT":
      ProjectPublicationOperation.CREATE_PULL_REQUEST_COMMENT,
  "CREATE_REPOSITORY": ProjectPublicationOperation.CREATE_REPOSITORY,
  "DELETE": ProjectPublicationOperation.DELETE,
  "SELF_ASSIGN_ISSUE": ProjectPublicationOperation.SELF_ASSIGN_ISSUE,
  "SELF_UNASSIGN_ISSUE": ProjectPublicationOperation.SELF_UNASSIGN_ISSUE,
  "SET_PULL_REQUEST_STATUS":
      ProjectPublicationOperation.SET_PULL_REQUEST_STATUS,
  "UNASSIGN_ISSUE": ProjectPublicationOperation.UNASSIGN_ISSUE,
});

///Original pullRequestReviews.ts lifecycle states the UI may publish (NIP-34
///1630/1633/1632). Merged (1631) happens through git and is never accepted here. Only the
///review author or repository owner signs it.
enum ProjectPullRequestLifecycleStatus { CLOSED, DRAFT, OPEN }

final projectPullRequestLifecycleStatusValues = EnumValues({
  "closed": ProjectPullRequestLifecycleStatus.CLOSED,
  "draft": ProjectPullRequestLifecycleStatus.DRAFT,
  "open": ProjectPullRequestLifecycleStatus.OPEN,
});

///Original hooks.ts ProjectPullRequestCommentDecision on CREATE_PULL_REQUEST_COMMENT only:
///adds the `changes-requested` label. Only a requested reviewer or the repository owner,
///never the review author, may request changes on an open or draft review; readers trust
///nothing else (projectPullRequests.mjs).
enum ProjectPullRequestCommentDecision { REQUEST_CHANGES }

final projectPullRequestCommentDecisionValues = EnumValues({
  "request-changes": ProjectPullRequestCommentDecision.REQUEST_CHANGES,
});

enum ProjectListingVisibility { LISTED, UNLISTED }

final projectListingVisibilityValues = EnumValues({
  "listed": ProjectListingVisibility.LISTED,
  "unlisted": ProjectListingVisibility.UNLISTED,
});

///Original Buzz Community project/repository announcements, coordinate-scoped work-item
///events and tombstones. Reads do not authorize Git transport or mutations.
///REPOSITORY_STATES returns the original trusted 30618 repository state (signed by the
///coordinate owner or the Relay itself) for the requested 30617 coordinates.
class ProjectsQueryRequest {
  final List<String>? coordinates;
  final int? since;
  final int? until;
  final ProjectsQueryRequestView view;

  ProjectsQueryRequest({
    this.coordinates,
    this.since,
    this.until,
    required this.view,
  });

  factory ProjectsQueryRequest.fromJson(Map<String, dynamic> json) =>
      ProjectsQueryRequest(
        coordinates: json["coordinates"] == null
            ? null
            : List<String>.from(json["coordinates"]!.map((x) => x)),
        since: json["since"],
        until: json["until"],
        view: projectsQueryRequestViewValues.map[json["view"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "coordinates": coordinates == null
        ? null
        : List<dynamic>.from(coordinates!.map((x) => x)),
    "since": since,
    "until": until,
    "view": projectsQueryRequestViewValues.reverse[view],
  });
}

enum ProjectsQueryRequestView {
  DELETIONS,
  PROJECTS,
  REPOSITORIES,
  REPOSITORY_STATES,
  WORK_ITEMS,
  WORK_ITEM_ACTIVITY,
}

final projectsQueryRequestViewValues = EnumValues({
  "DELETIONS": ProjectsQueryRequestView.DELETIONS,
  "PROJECTS": ProjectsQueryRequestView.PROJECTS,
  "REPOSITORIES": ProjectsQueryRequestView.REPOSITORIES,
  "REPOSITORY_STATES": ProjectsQueryRequestView.REPOSITORY_STATES,
  "WORK_ITEMS": ProjectsQueryRequestView.WORK_ITEMS,
  "WORK_ITEM_ACTIVITY": ProjectsQueryRequestView.WORK_ITEM_ACTIVITY,
});

///03/18: only the initiating HUMAN's fresh-authorized original Session facts. No PAT,
///launch credential, native body or replacement revision is recoverable from this reader.
class ProtocolSessionView {
  final String actionExecutionId;
  final ProtocolSessionMode admittedMode;
  final String applicationBindingId;
  final String baseRevision;
  final List<String> effectiveEditorOrigins;
  final String expiresAt;
  final ProtocolSessionLocale launchLocale;
  final ProtocolSessionTheme launchTheme;
  final String protocolSessionId;
  final ContentReference reference;
  final String? resultRevision;
  final ProtocolSessionReconcileRoundState state;
  final String tenantId;
  final int version;
  final String? workspaceId;

  ProtocolSessionView({
    required this.actionExecutionId,
    required this.admittedMode,
    required this.applicationBindingId,
    required this.baseRevision,
    required this.effectiveEditorOrigins,
    required this.expiresAt,
    required this.launchLocale,
    required this.launchTheme,
    required this.protocolSessionId,
    required this.reference,
    this.resultRevision,
    required this.state,
    required this.tenantId,
    required this.version,
    this.workspaceId,
  });

  factory ProtocolSessionView.fromJson(Map<String, dynamic> json) =>
      ProtocolSessionView(
        actionExecutionId: json["actionExecutionId"],
        admittedMode: protocolSessionModeValues.map[json["admittedMode"]]!,
        applicationBindingId: json["applicationBindingId"],
        baseRevision: json["baseRevision"],
        effectiveEditorOrigins: List<String>.from(
          json["effectiveEditorOrigins"].map((x) => x),
        ),
        expiresAt: json["expiresAt"],
        launchLocale: protocolSessionLocaleValues.map[json["launchLocale"]]!,
        launchTheme: protocolSessionThemeValues.map[json["launchTheme"]]!,
        protocolSessionId: json["protocolSessionId"],
        reference: ContentReference.fromJson(json["reference"]),
        resultRevision: json["resultRevision"],
        state: protocolSessionReconcileRoundStateValues.map[json["state"]]!,
        tenantId: json["tenantId"],
        version: json["version"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "admittedMode": protocolSessionModeValues.reverse[admittedMode],
    "applicationBindingId": applicationBindingId,
    "baseRevision": baseRevision,
    "effectiveEditorOrigins": List<dynamic>.from(
      effectiveEditorOrigins.map((x) => x),
    ),
    "expiresAt": expiresAt,
    "launchLocale": protocolSessionLocaleValues.reverse[launchLocale],
    "launchTheme": protocolSessionThemeValues.reverse[launchTheme],
    "protocolSessionId": protocolSessionId,
    "reference": reference.toJson(),
    "resultRevision": resultRevision,
    "state": protocolSessionReconcileRoundStateValues.reverse[state],
    "tenantId": tenantId,
    "version": version,
    "workspaceId": workspaceId,
  });
}

enum ProtocolSessionReconcileRoundState {
  ADMITTED,
  CLOSED,
  CONFLICT,
  DIRTY,
  EXPIRED,
  FAILED,
  OPEN,
  OPENING,
  READ_ONLY,
  REVOKED,
  SAVED,
  UNKNOWN,
}

final protocolSessionReconcileRoundStateValues = EnumValues({
  "ADMITTED": ProtocolSessionReconcileRoundState.ADMITTED,
  "CLOSED": ProtocolSessionReconcileRoundState.CLOSED,
  "CONFLICT": ProtocolSessionReconcileRoundState.CONFLICT,
  "DIRTY": ProtocolSessionReconcileRoundState.DIRTY,
  "EXPIRED": ProtocolSessionReconcileRoundState.EXPIRED,
  "FAILED": ProtocolSessionReconcileRoundState.FAILED,
  "OPEN": ProtocolSessionReconcileRoundState.OPEN,
  "OPENING": ProtocolSessionReconcileRoundState.OPENING,
  "READ_ONLY": ProtocolSessionReconcileRoundState.READ_ONLY,
  "REVOKED": ProtocolSessionReconcileRoundState.REVOKED,
  "SAVED": ProtocolSessionReconcileRoundState.SAVED,
  "UNKNOWN": ProtocolSessionReconcileRoundState.UNKNOWN,
});

class PulsePublishRequest {
  final List<WebMessageAttachment>? attachments;
  final String content;
  final List<String>? mentions;
  final PulsePublishRequestOperation operation;
  final String? targetEventId;

  PulsePublishRequest({
    this.attachments,
    required this.content,
    this.mentions,
    required this.operation,
    this.targetEventId,
  });

  factory PulsePublishRequest.fromJson(Map<String, dynamic> json) =>
      PulsePublishRequest(
        attachments: json["attachments"] == null
            ? null
            : List<WebMessageAttachment>.from(
                json["attachments"]!.map(
                  (x) => WebMessageAttachment.fromJson(x),
                ),
              ),
        content: json["content"],
        mentions: json["mentions"] == null
            ? null
            : List<String>.from(json["mentions"]!.map((x) => x)),
        operation: pulsePublishRequestOperationValues.map[json["operation"]]!,
        targetEventId: json["targetEventId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "attachments": attachments == null
        ? null
        : List<dynamic>.from(attachments!.map((x) => x.toJson())),
    "content": content,
    "mentions": mentions == null
        ? null
        : List<dynamic>.from(mentions!.map((x) => x)),
    "operation": pulsePublishRequestOperationValues.reverse[operation],
    "targetEventId": targetEventId,
  });
}

enum PulsePublishRequestOperation { LIKE, NOTE, UNLIKE }

final pulsePublishRequestOperationValues = EnumValues({
  "LIKE": PulsePublishRequestOperation.LIKE,
  "NOTE": PulsePublishRequestOperation.NOTE,
  "UNLIKE": PulsePublishRequestOperation.UNLIKE,
});

class PulseQueryRequest {
  final List<String>? authors;
  final int? before;
  final List<String>? eventIds;
  final PulseQueryRequestView view;

  PulseQueryRequest({
    this.authors,
    this.before,
    this.eventIds,
    required this.view,
  });

  factory PulseQueryRequest.fromJson(Map<String, dynamic> json) =>
      PulseQueryRequest(
        authors: json["authors"] == null
            ? null
            : List<String>.from(json["authors"]!.map((x) => x)),
        before: json["before"],
        eventIds: json["eventIds"] == null
            ? null
            : List<String>.from(json["eventIds"]!.map((x) => x)),
        view: pulseQueryRequestViewValues.map[json["view"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "authors": authors == null
        ? null
        : List<dynamic>.from(authors!.map((x) => x)),
    "before": before,
    "eventIds": eventIds == null
        ? null
        : List<dynamic>.from(eventIds!.map((x) => x)),
    "view": pulseQueryRequestViewValues.reverse[view],
  });
}

enum PulseQueryRequestView {
  AGENTS,
  CONTACTS,
  LIKED,
  NOTES,
  PROFILES,
  REACTIONS,
}

final pulseQueryRequestViewValues = EnumValues({
  "AGENTS": PulseQueryRequestView.AGENTS,
  "CONTACTS": PulseQueryRequestView.CONTACTS,
  "LIKED": PulseQueryRequestView.LIKED,
  "NOTES": PulseQueryRequestView.NOTES,
  "PROFILES": PulseQueryRequestView.PROFILES,
  "REACTIONS": PulseQueryRequestView.REACTIONS,
});

///PUT /api/v1/user-state/read 的请求体（DD-40、03 §2）。contextKey 只接受调用方可读 Workspace 内的 Channel
///ID、msg:<Buzz event id> 或 thread:<Buzz root event id>；version 是读到的 CollaborationUserState
///版本，不符即 409。
class ReadMarkRequest {
  final String contextKey;

  ///RFC3339，Core 统一存成 UTC
  final String lastReadAt;
  final int version;

  ReadMarkRequest({
    required this.contextKey,
    required this.lastReadAt,
    required this.version,
  });

  factory ReadMarkRequest.fromJson(Map<String, dynamic> json) =>
      ReadMarkRequest(
        contextKey: json["contextKey"],
        lastReadAt: json["lastReadAt"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "contextKey": contextKey,
    "lastReadAt": lastReadAt,
    "version": version,
  });
}

///Original reminder create/complete/snooze/cancel. Identity comes only from the
///authenticated host; mutations select the actual current signed 30300 head. Source
///messages are freshly authorized and read by the host; no caller-supplied preview, author,
///kind, ciphertext or key is trusted.
class ReminderPublishRequest {
  final String? channelId;
  final String? eventId;
  final int? notBefore;
  final String? note;
  final ReminderOperation operation;
  final String? sourceEventId;

  ReminderPublishRequest({
    this.channelId,
    this.eventId,
    this.notBefore,
    this.note,
    required this.operation,
    this.sourceEventId,
  });

  factory ReminderPublishRequest.fromJson(Map<String, dynamic> json) =>
      ReminderPublishRequest(
        channelId: json["channelId"],
        eventId: json["eventId"],
        notBefore: json["notBefore"],
        note: json["note"],
        operation: reminderOperationValues.map[json["operation"]]!,
        sourceEventId: json["sourceEventId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "channelId": channelId,
    "eventId": eventId,
    "notBefore": notBefore,
    "note": note,
    "operation": reminderOperationValues.reverse[operation],
    "sourceEventId": sourceEventId,
  });
}

enum ReminderOperation { CANCEL, COMPLETE, CREATE, SNOOZE }

final reminderOperationValues = EnumValues({
  "CANCEL": ReminderOperation.CANCEL,
  "COMPLETE": ReminderOperation.COMPLETE,
  "CREATE": ReminderOperation.CREATE,
  "SNOOZE": ReminderOperation.SNOOZE,
});

///原 Reminder 目标引用重新读取；字段只是查找键，必须重做当前用户、channel scope 与事件签名/归属检查，不能以已解密提醒或目录缓存授予正文读取。
class ReminderSourceRequest {
  final String channelId;
  final String eventId;

  ReminderSourceRequest({required this.channelId, required this.eventId});

  factory ReminderSourceRequest.fromJson(Map<String, dynamic> json) =>
      ReminderSourceRequest(
        channelId: json["channelId"],
        eventId: json["eventId"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"channelId": channelId, "eventId": eventId});
}

///Original Buzz 30300 author-only encrypted reminder, decrypted only by its own SERVER or
///local CLIENT identity. A transient Relay read, never a Core body record. Embedded target
///metadata is a historical preview, not current authorization.
class ReminderView {
  final ReminderContent content;
  final int createdAt;
  final String eventId;
  final String id;
  final int? notBefore;

  ReminderView({
    required this.content,
    required this.createdAt,
    required this.eventId,
    required this.id,
    this.notBefore,
  });

  factory ReminderView.fromJson(Map<String, dynamic> json) => ReminderView(
    content: ReminderContent.fromJson(json["content"]),
    createdAt: json["createdAt"],
    eventId: json["eventId"],
    id: json["id"],
    notBefore: json["notBefore"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "content": content.toJson(),
    "createdAt": createdAt,
    "eventId": eventId,
    "id": id,
    "notBefore": notBefore,
  });
}

class ReminderContent {
  final String? note;
  final ReminderStatus status;
  final ReminderTarget? target;

  ReminderContent({this.note, required this.status, this.target});

  factory ReminderContent.fromJson(Map<String, dynamic> json) =>
      ReminderContent(
        note: json["note"],
        status: reminderStatusValues.map[json["status"]]!,
        target: json["target"] == null
            ? null
            : ReminderTarget.fromJson(json["target"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "note": note,
    "status": reminderStatusValues.reverse[status],
    "target": target?.toJson(),
  });
}

enum ReminderStatus { CANCELLED, DONE, PENDING }

final reminderStatusValues = EnumValues({
  "cancelled": ReminderStatus.CANCELLED,
  "done": ReminderStatus.DONE,
  "pending": ReminderStatus.PENDING,
});

class ReminderTarget {
  final String authorPubkey;
  final String channelId;
  final String eventId;
  final String preview;

  ReminderTarget({
    required this.authorPubkey,
    required this.channelId,
    required this.eventId,
    required this.preview,
  });

  factory ReminderTarget.fromJson(Map<String, dynamic> json) => ReminderTarget(
    authorPubkey: json["authorPubkey"],
    channelId: json["channelId"],
    eventId: json["eventId"],
    preview: json["preview"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "authorPubkey": authorPubkey,
    "channelId": channelId,
    "eventId": eventId,
    "preview": preview,
  });
}

///GET /api/v1/role-members 的有界回应。只列当前 Tenant 的 ACTIVE HUMAN 成员；角色从 SpiceDB fresh
///读取，动作可用性只作界面提示，提交时仍重新准入（DD-82）。
class RoleMemberPage {
  final List<RoleMemberView> members;

  ///下一页首项之前的 Principal ID；缺省即已经读完
  final String? nextCursor;

  RoleMemberPage({required this.members, this.nextCursor});

  factory RoleMemberPage.fromJson(Map<String, dynamic> json) => RoleMemberPage(
    members: List<RoleMemberView>.from(
      json["members"].map((x) => RoleMemberView.fromJson(x)),
    ),
    nextCursor: json["nextCursor"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "members": List<dynamic>.from(members.map((x) => x.toJson())),
    "nextCursor": nextCursor,
  });
}

class RoleMemberView {
  ///当前 Workspace manage 与 workspace.member.add 目录均有效且已开放，目标在该 Workspace 没有未撤销的
  ///WorkspaceMembership（不存在或 REVOKED）；省略或 false 不显示添加动作，提交仍重新准入。
  final bool? canAddToWorkspace;
  final bool canGrantTenantAdmin;
  final bool canGrantWorkspaceAdmin;

  ///当前 Tenant manage 与 tenant.member.revoke 目录均有效，且不是最后有效 Tenant admin；提交仍走原审批与重新准入，省略或 false
  ///不显示动作。
  final bool? canRemoveFromTenant;

  ///当前 Workspace manage 与 workspace.member.revoke 目录均有效，目标存在可撤 WorkspaceMembership；省略或 false
  ///不显示动作，提交仍重新准入。
  final bool? canRemoveFromWorkspace;
  final bool canRevokeTenantAdmin;
  final bool canRevokeWorkspaceAdmin;

  ///RFC3339，TenantMembership 的原始创建时间，用于原版 Added 日期；不是审批通过、激活或最近重新加入时间。只向具有 Tenant manage
  ///的查看者提供，旧服务或仅 Workspace manage 时省略，客户端不编造日期。
  final String? createdAt;
  final String displayName;

  ///有效 Tenant admin 仅剩此人；该人的撤销按钮禁用，服务端最终准入仍重查
  final bool lastTenantAdmin;

  ///DD-139：同 Tenant 头像地址 <PUBLIC_ORIGIN>/api/v1/identity/avatars/<subject>（07 §4.7.3），只对有
  ///ACTIVE 外部身份的成员给出；只是地址，不含图片或资料正文，读取仍按该路由的 Tenant 准入。
  final String? picture;
  final String principalId;

  ///同一 Tenant、同一 HUMAN Principal 当前 ACTIVE 的 Buzz 身份公钥，按公钥排序；仅向具有 Tenant manage
  ///的查看者提供非空列表，无有效绑定、旧服务或仅 Workspace manage 时省略。缺省不提供可读取资料的身份凭据，不以当前查看者或其他 Workspace 身份替代。
  final List<String>? pubkeys;
  final bool tenantAdmin;

  ///没有 workspaceId 时恒为 false
  final bool workspaceAdmin;

  RoleMemberView({
    this.canAddToWorkspace,
    required this.canGrantTenantAdmin,
    required this.canGrantWorkspaceAdmin,
    this.canRemoveFromTenant,
    this.canRemoveFromWorkspace,
    required this.canRevokeTenantAdmin,
    required this.canRevokeWorkspaceAdmin,
    this.createdAt,
    required this.displayName,
    required this.lastTenantAdmin,
    this.picture,
    required this.principalId,
    this.pubkeys,
    required this.tenantAdmin,
    required this.workspaceAdmin,
  });

  factory RoleMemberView.fromJson(Map<String, dynamic> json) => RoleMemberView(
    canAddToWorkspace: json["canAddToWorkspace"],
    canGrantTenantAdmin: json["canGrantTenantAdmin"],
    canGrantWorkspaceAdmin: json["canGrantWorkspaceAdmin"],
    canRemoveFromTenant: json["canRemoveFromTenant"],
    canRemoveFromWorkspace: json["canRemoveFromWorkspace"],
    canRevokeTenantAdmin: json["canRevokeTenantAdmin"],
    canRevokeWorkspaceAdmin: json["canRevokeWorkspaceAdmin"],
    createdAt: json["createdAt"],
    displayName: json["displayName"],
    lastTenantAdmin: json["lastTenantAdmin"],
    picture: json["picture"],
    principalId: json["principalId"],
    pubkeys: json["pubkeys"] == null
        ? null
        : List<String>.from(json["pubkeys"]!.map((x) => x)),
    tenantAdmin: json["tenantAdmin"],
    workspaceAdmin: json["workspaceAdmin"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "canAddToWorkspace": canAddToWorkspace,
    "canGrantTenantAdmin": canGrantTenantAdmin,
    "canGrantWorkspaceAdmin": canGrantWorkspaceAdmin,
    "canRemoveFromTenant": canRemoveFromTenant,
    "canRemoveFromWorkspace": canRemoveFromWorkspace,
    "canRevokeTenantAdmin": canRevokeTenantAdmin,
    "canRevokeWorkspaceAdmin": canRevokeWorkspaceAdmin,
    "createdAt": createdAt,
    "displayName": displayName,
    "lastTenantAdmin": lastTenantAdmin,
    "picture": picture,
    "principalId": principalId,
    "pubkeys": pubkeys == null
        ? null
        : List<dynamic>.from(pubkeys!.map((x) => x)),
    "tenantAdmin": tenantAdmin,
    "workspaceAdmin": workspaceAdmin,
  });
}

///GET /api/v1/role-workspaces 的有界回应：当前 Principal 对哪些 Workspace 持有 fresh manage
///permission（ACTIVE、暂停中、已暂停、恢复中、删除中，以及已有协作面 binding 的 ERROR，各带当前状态），并附当前可用的 Workspace
///创建、暂停、恢复与删除动作提示。动作提交仍由 Core 重新准入，不等于可进入频道。
class RoleWorkspacePage {
  ///当前 Principal 经 fresh Tenant create 检查可见的动作 key；目录未开放或无权时省略
  final RoleWorkspacePageCreateActionKey? createActionKey;

  ///下一页的 Core 索引偏移；不暴露无权 Workspace 的 ID，缺省即读完
  final int? nextOffset;
  final List<RoleWorkspaceView> workspaces;

  RoleWorkspacePage({
    this.createActionKey,
    this.nextOffset,
    required this.workspaces,
  });

  factory RoleWorkspacePage.fromJson(
    Map<String, dynamic> json,
  ) => RoleWorkspacePage(
    createActionKey: json["createActionKey"] == null
        ? null
        : roleWorkspacePageCreateActionKeyValues.map[json["createActionKey"]]!,
    nextOffset: json["nextOffset"],
    workspaces: List<RoleWorkspaceView>.from(
      json["workspaces"].map((x) => RoleWorkspaceView.fromJson(x)),
    ),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "createActionKey":
        roleWorkspacePageCreateActionKeyValues.reverse[createActionKey],
    "nextOffset": nextOffset,
    "workspaces": List<dynamic>.from(workspaces.map((x) => x.toJson())),
  });
}

enum RoleWorkspacePageCreateActionKey { WORKSPACE_CREATE }

final roleWorkspacePageCreateActionKeyValues = EnumValues({
  "workspace.create": RoleWorkspacePageCreateActionKey.WORKSPACE_CREATE,
});

class RoleWorkspaceView {
  ///DD-150：当前 Principal 经 fresh Workspace manage 检查、目录已开放、Workspace 为 ACTIVE 或 SUSPENDED
  ///且没有未终结的生命周期动作（编辑、暂停、恢复、删除）时给出；省略即不显示删除入口，提交仍由 Core 重新准入。删除进行中的 Workspace 以 state=DELETING
  ///出现，直到删除链全部回读确认后从本页消失
  final RoleWorkspaceViewDeleteActionKey? deleteActionKey;
  final String id;

  ///当前 Principal 经 fresh Tenant manage 检查、按该 Workspace 当前状态可发起的暂停（ACTIVE 或
  ///ERROR）或恢复（SUSPENDED）动作 key；目录未开放、无权、处于收敛中或本页提示判定失败时省略
  final WorkspaceLifecycleActionKey? lifecycleActionKey;
  final String name;
  final WorkspaceState state;

  RoleWorkspaceView({
    this.deleteActionKey,
    required this.id,
    this.lifecycleActionKey,
    required this.name,
    required this.state,
  });

  factory RoleWorkspaceView.fromJson(
    Map<String, dynamic> json,
  ) => RoleWorkspaceView(
    deleteActionKey: json["deleteActionKey"] == null
        ? null
        : roleWorkspaceViewDeleteActionKeyValues.map[json["deleteActionKey"]]!,
    id: json["id"],
    lifecycleActionKey: json["lifecycleActionKey"] == null
        ? null
        : workspaceLifecycleActionKeyValues.map[json["lifecycleActionKey"]]!,
    name: json["name"],
    state: workspaceStateValues.map[json["state"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "deleteActionKey":
        roleWorkspaceViewDeleteActionKeyValues.reverse[deleteActionKey],
    "id": id,
    "lifecycleActionKey":
        workspaceLifecycleActionKeyValues.reverse[lifecycleActionKey],
    "name": name,
    "state": workspaceStateValues.reverse[state],
  });
}

enum RoleWorkspaceViewDeleteActionKey { WORKSPACE_DELETE }

final roleWorkspaceViewDeleteActionKeyValues = EnumValues({
  "workspace.delete": RoleWorkspaceViewDeleteActionKey.WORKSPACE_DELETE,
});

///当前 Principal 经 fresh Tenant manage 检查、按该 Workspace 当前状态可发起的暂停（ACTIVE 或
///ERROR）或恢复（SUSPENDED）动作 key；目录未开放、无权、处于收敛中或本页提示判定失败时省略
///
///Workspace 暂停与恢复的 ActionDefinition key（.design/06 §7.3）。两者都从 Tenant scope
///发起。删除（DD-150）不在本枚举：它不是可逆生命周期，经 RoleWorkspaceView.deleteActionKey 单独提示。
enum WorkspaceLifecycleActionKey { WORKSPACE_RESTORE, WORKSPACE_SUSPEND }

final workspaceLifecycleActionKeyValues = EnumValues({
  "workspace.restore": WorkspaceLifecycleActionKey.WORKSPACE_RESTORE,
  "workspace.suspend": WorkspaceLifecycleActionKey.WORKSPACE_SUSPEND,
});

///Workspace 状态机中对外可见的状态。权威定义见 .design/03-领域模型与权限模型.md。DD-150 的 DELETED 是 Core
///内的墓碑，不出现在任何对外视图中（列表与提示都不返回已删除的 Workspace），因此不在本枚举。
enum WorkspaceState {
  ACTIVE,
  DELETING,
  ERROR,
  PROVISIONING,
  RESTORING,
  SUSPENDED,
  SUSPENDING,
}

final workspaceStateValues = EnumValues({
  "ACTIVE": WorkspaceState.ACTIVE,
  "DELETING": WorkspaceState.DELETING,
  "ERROR": WorkspaceState.ERROR,
  "PROVISIONING": WorkspaceState.PROVISIONING,
  "RESTORING": WorkspaceState.RESTORING,
  "SUSPENDED": WorkspaceState.SUSPENDED,
  "SUSPENDING": WorkspaceState.SUSPENDING,
});

///GET /api/v1/session 的回应：已解析的执行身份与本次 PlatformSession。原生端以 platformSessionId
///绑定设备持钥证明（DD-79）。
class PlatformSessionView {
  final PlatformSessionAccessMode accessMode;

  ///当前选定的 Workspace；未选定时缺省
  final String? currentWorkspaceId;

  ///HumanIdentity 的显示名，只用于界面上认出本人，不参与任何判定
  final String displayName;
  final String humanIdentityId;
  final String platformSessionId;
  final String tenantId;
  final String tenantMembershipId;

  ///当前 Tenant 的显示名，也就是其绑定 Community 的名称（01 §2：一个 Tenant 绑定一个
  ///Community），只用于界面上认出本人所在社区，不参与任何判定；读不到时缺省
  final String? tenantName;
  final String tenantPrincipalId;

  PlatformSessionView({
    required this.accessMode,
    this.currentWorkspaceId,
    required this.displayName,
    required this.humanIdentityId,
    required this.platformSessionId,
    required this.tenantId,
    required this.tenantMembershipId,
    this.tenantName,
    required this.tenantPrincipalId,
  });

  factory PlatformSessionView.fromJson(Map<String, dynamic> json) =>
      PlatformSessionView(
        accessMode: platformSessionAccessModeValues.map[json["accessMode"]]!,
        currentWorkspaceId: json["currentWorkspaceId"],
        displayName: json["displayName"],
        humanIdentityId: json["humanIdentityId"],
        platformSessionId: json["platformSessionId"],
        tenantId: json["tenantId"],
        tenantMembershipId: json["tenantMembershipId"],
        tenantName: json["tenantName"],
        tenantPrincipalId: json["tenantPrincipalId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "accessMode": platformSessionAccessModeValues.reverse[accessMode],
    "currentWorkspaceId": currentWorkspaceId,
    "displayName": displayName,
    "humanIdentityId": humanIdentityId,
    "platformSessionId": platformSessionId,
    "tenantId": tenantId,
    "tenantMembershipId": tenantMembershipId,
    "tenantName": tenantName,
    "tenantPrincipalId": tenantPrincipalId,
  });
}

///PlatformSession.access_mode（.design/03 §2）；受限会话不授予普通管理面或协作面准入。
enum PlatformSessionAccessMode { FULL, LIFECYCLE_RESTRICTED }

final platformSessionAccessModeValues = EnumValues({
  "FULL": PlatformSessionAccessMode.FULL,
  "LIFECYCLE_RESTRICTED": PlatformSessionAccessMode.LIFECYCLE_RESTRICTED,
});

///PUT /api/v1/user-state/sidebar-assignments 的请求体（DD-125(5)）：原
///assignChannel/unassignChannel。channelKey 是原生 Buzz Channel ID，必须属于本人当前是成员的 Workspace
///或参与中的私聊；sectionId 缺省即移出分区，给出时必须是现有分区。每人至多 1000 个归属（原
///MAX_CHANNEL_SECTION_ASSIGNMENTS）。失去资格的归属保留但不呈现。version 不符即 409。
class SidebarAssignmentRequest {
  final String channelKey;
  final String? sectionId;
  final int version;

  SidebarAssignmentRequest({
    required this.channelKey,
    this.sectionId,
    required this.version,
  });

  factory SidebarAssignmentRequest.fromJson(Map<String, dynamic> json) =>
      SidebarAssignmentRequest(
        channelKey: json["channelKey"],
        sectionId: json["sectionId"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "channelKey": channelKey,
    "sectionId": sectionId,
    "version": version,
  });
}

///PUT /api/v1/user-state/sidebar-sections/{sectionId} 的请求体（DD-125(5)、03
///CollaborationUserState.sidebar_sections）：新建或改名原自定义频道分区；sectionId 由客户端以 UUID 生成。name
///去首尾空白后非空，icon 缺省即无图标，order 是原分区顺序。每人至多 100 个分区（原 MAX_CHANNEL_SECTIONS）。version 不符即
///409。DELETE 同一路径以 UserStateVersion 为请求体，同时清除指向该分区的归属与该分区的排序分组。
class SidebarSectionRequest {
  final String? icon;
  final String name;
  final int order;
  final int version;

  SidebarSectionRequest({
    this.icon,
    required this.name,
    required this.order,
    required this.version,
  });

  factory SidebarSectionRequest.fromJson(Map<String, dynamic> json) =>
      SidebarSectionRequest(
        icon: json["icon"],
        name: json["name"],
        order: json["order"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "icon": icon,
    "name": name,
    "order": order,
    "version": version,
  });
}

///PUT /api/v1/user-state/sidebar-section-order 的请求体（DD-125(5)）：原
///reorderSections/moveSectionUp/moveSectionDown 的结果顺序。sectionIds 必须恰为当前全部分区 ID 的一个排列，Core
///按下标写回 order。version 不符即 409。
class SidebarSectionOrderRequest {
  final List<String> sectionIds;
  final int version;

  SidebarSectionOrderRequest({required this.sectionIds, required this.version});

  factory SidebarSectionOrderRequest.fromJson(Map<String, dynamic> json) =>
      SidebarSectionOrderRequest(
        sectionIds: List<String>.from(json["sectionIds"].map((x) => x)),
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "sectionIds": List<dynamic>.from(sectionIds.map((x) => x)),
    "version": version,
  });
}

///PUT /api/v1/user-state/sidebar-sort 的请求体（DD-125(5)、03
///CollaborationUserState.sidebar_sort）：原分组排序。groupKey 只接受原固定分组 starred/channels/forums/dms
///或 section:<现有分区 ID>；每人至多 104 个分组（原 MAX_CHANNEL_SORT_GROUPS）。version 不符即 409。
class SidebarSortRequest {
  final String groupKey;
  final SidebarSortMode mode;
  final int version;

  SidebarSortRequest({
    required this.groupKey,
    required this.mode,
    required this.version,
  });

  factory SidebarSortRequest.fromJson(Map<String, dynamic> json) =>
      SidebarSortRequest(
        groupKey: json["groupKey"],
        mode: sidebarSortModeValues.map[json["mode"]]!,
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "groupKey": groupKey,
    "mode": sidebarSortModeValues.reverse[mode],
    "version": version,
  });
}

///原 Buzz 侧栏分组排序（channelSortPreference.ts::ChannelSortMode）：alpha 按名称，recent
///按最近消息（DD-125(5)）。
enum SidebarSortMode { ALPHA, RECENT }

final sidebarSortModeValues = EnumValues({
  "alpha": SidebarSortMode.ALPHA,
  "recent": SidebarSortMode.RECENT,
});

///DD-135(2)(3)：一次 Skill 上传的原始字节（标准 base64，两端同一 JSON 传输）。解码后不超过 1 MiB；编码只接受 SKILL.md、tar 或
///tar.gz，由 Core 判定。
class SkillArtifactUploadRequest {
  final String contentBase64;

  SkillArtifactUploadRequest({required this.contentBase64});

  factory SkillArtifactUploadRequest.fromJson(Map<String, dynamic> json) =>
      SkillArtifactUploadRequest(contentBase64: json["contentBase64"]);

  Map<String, dynamic> toJson() =>
      _stripNulls({"contentBase64": contentBase64});
}

///DD-135(2)(3)：上传校验结果。accepted 时给出一次性 uploadId、规范 artifact digest 与 frontmatter
///元数据；否则只给逐项违规，不暂存字节。
class SkillArtifactUploadView {
  final bool accepted;
  final int? artifactByteSize;
  final String? artifactDigest;
  final String? description;
  final SkillArtifactEncoding? encoding;
  final String? expiresAt;
  final String? shortDescription;
  final String? skillName;
  final String skillResourceId;

  ///上传字节数。缺省条件同 uploadDigest。
  final int? uploadByteSize;

  ///上传字节的 SHA-256。请求体超过上限、上传未被完整读取时缺省（UPLOAD_TOO_LARGE）。
  final String? uploadDigest;
  final String? uploadId;
  final List<SkillArtifactViolation> violations;

  SkillArtifactUploadView({
    required this.accepted,
    this.artifactByteSize,
    this.artifactDigest,
    this.description,
    this.encoding,
    this.expiresAt,
    this.shortDescription,
    this.skillName,
    required this.skillResourceId,
    this.uploadByteSize,
    this.uploadDigest,
    this.uploadId,
    required this.violations,
  });

  factory SkillArtifactUploadView.fromJson(Map<String, dynamic> json) =>
      SkillArtifactUploadView(
        accepted: json["accepted"],
        artifactByteSize: json["artifactByteSize"],
        artifactDigest: json["artifactDigest"],
        description: json["description"],
        encoding: json["encoding"] == null
            ? null
            : skillArtifactEncodingValues.map[json["encoding"]]!,
        expiresAt: json["expiresAt"],
        shortDescription: json["shortDescription"],
        skillName: json["skillName"],
        skillResourceId: json["skillResourceId"],
        uploadByteSize: json["uploadByteSize"],
        uploadDigest: json["uploadDigest"],
        uploadId: json["uploadId"],
        violations: List<SkillArtifactViolation>.from(
          json["violations"].map((x) => SkillArtifactViolation.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "accepted": accepted,
    "artifactByteSize": artifactByteSize,
    "artifactDigest": artifactDigest,
    "description": description,
    "encoding": skillArtifactEncodingValues.reverse[encoding],
    "expiresAt": expiresAt,
    "shortDescription": shortDescription,
    "skillName": skillName,
    "skillResourceId": skillResourceId,
    "uploadByteSize": uploadByteSize,
    "uploadDigest": uploadDigest,
    "uploadId": uploadId,
    "violations": List<dynamic>.from(violations.map((x) => x.toJson())),
  });
}

///DD-135(2)：上传字节的编码。规范 artifact 恒为一个 SKILL.md，与上传编码无关。
enum SkillArtifactEncoding { SKILL_MD, TAR, TAR_GZIP }

final skillArtifactEncodingValues = EnumValues({
  "SKILL_MD": SkillArtifactEncoding.SKILL_MD,
  "TAR": SkillArtifactEncoding.TAR,
  "TAR_GZIP": SkillArtifactEncoding.TAR_GZIP,
});

class SkillArtifactViolation {
  final SkillArtifactViolationCode code;

  ///违规条目在上传包内的路径（不含正文）；与整体相关的违规省略。
  final String? path;

  SkillArtifactViolation({required this.code, this.path});

  factory SkillArtifactViolation.fromJson(Map<String, dynamic> json) =>
      SkillArtifactViolation(
        code: skillArtifactViolationCodeValues.map[json["code"]]!,
        path: json["path"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "code": skillArtifactViolationCodeValues.reverse[code],
    "path": path,
  });
}

///DD-135(2)(9)：上传校验的封闭违规码；与路径一起逐项返回，不含文件正文。
enum SkillArtifactViolationCode {
  ARCHIVE_INVALID,
  CONTROL_CHARACTER,
  DESCRIPTION_TOO_LONG,
  DUPLICATE_SKILL_MD,
  ENTRY_LIMIT_EXCEEDED,
  EXECUTABLE_ENTRY,
  EXPANDED_TOO_LARGE,
  EXTRA_ENTRY,
  INVALID_FRONTMATTER,
  LINK_ENTRY,
  MISSING_DESCRIPTION,
  MISSING_FRONTMATTER,
  MISSING_SKILL_MD,
  NAME_MISMATCH,
  NOT_UTF8,
  SKILL_MD_TOO_LARGE,
  SPECIAL_ENTRY,
  UNSAFE_PATH,
  UNSUPPORTED_ENCODING,
  UNSUPPORTED_FRONTMATTER_KEY,
  UPLOAD_TOO_LARGE,
}

final skillArtifactViolationCodeValues = EnumValues({
  "ARCHIVE_INVALID": SkillArtifactViolationCode.ARCHIVE_INVALID,
  "CONTROL_CHARACTER": SkillArtifactViolationCode.CONTROL_CHARACTER,
  "DESCRIPTION_TOO_LONG": SkillArtifactViolationCode.DESCRIPTION_TOO_LONG,
  "DUPLICATE_SKILL_MD": SkillArtifactViolationCode.DUPLICATE_SKILL_MD,
  "ENTRY_LIMIT_EXCEEDED": SkillArtifactViolationCode.ENTRY_LIMIT_EXCEEDED,
  "EXECUTABLE_ENTRY": SkillArtifactViolationCode.EXECUTABLE_ENTRY,
  "EXPANDED_TOO_LARGE": SkillArtifactViolationCode.EXPANDED_TOO_LARGE,
  "EXTRA_ENTRY": SkillArtifactViolationCode.EXTRA_ENTRY,
  "INVALID_FRONTMATTER": SkillArtifactViolationCode.INVALID_FRONTMATTER,
  "LINK_ENTRY": SkillArtifactViolationCode.LINK_ENTRY,
  "MISSING_DESCRIPTION": SkillArtifactViolationCode.MISSING_DESCRIPTION,
  "MISSING_FRONTMATTER": SkillArtifactViolationCode.MISSING_FRONTMATTER,
  "MISSING_SKILL_MD": SkillArtifactViolationCode.MISSING_SKILL_MD,
  "NAME_MISMATCH": SkillArtifactViolationCode.NAME_MISMATCH,
  "NOT_UTF8": SkillArtifactViolationCode.NOT_UTF8,
  "SKILL_MD_TOO_LARGE": SkillArtifactViolationCode.SKILL_MD_TOO_LARGE,
  "SPECIAL_ENTRY": SkillArtifactViolationCode.SPECIAL_ENTRY,
  "UNSAFE_PATH": SkillArtifactViolationCode.UNSAFE_PATH,
  "UNSUPPORTED_ENCODING": SkillArtifactViolationCode.UNSUPPORTED_ENCODING,
  "UNSUPPORTED_FRONTMATTER_KEY":
      SkillArtifactViolationCode.UNSUPPORTED_FRONTMATTER_KEY,
  "UPLOAD_TOO_LARGE": SkillArtifactViolationCode.UPLOAD_TOO_LARGE,
});

///同 Tenant 且当前 discover 允许的 Skill 定义页；nextOffset 续读同一排序。
class SkillDefinitionPage {
  final List<SkillDefinitionView> definitions;
  final int? nextOffset;

  SkillDefinitionPage({required this.definitions, this.nextOffset});

  factory SkillDefinitionPage.fromJson(Map<String, dynamic> json) =>
      SkillDefinitionPage(
        definitions: List<SkillDefinitionView>.from(
          json["definitions"].map((x) => SkillDefinitionView.fromJson(x)),
        ),
        nextOffset: json["nextOffset"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "definitions": List<dynamic>.from(definitions.map((x) => x.toJson())),
    "nextOffset": nextOffset,
  });
}

///DD-135(1)(4)：Tenant 级 Skill 定义与 Resource 事实；can* 只是当前 HUMAN 的 fresh 入口提示，提交时仍重验。
class SkillDefinitionView {
  final bool? canDisable;
  final bool? canShare;
  final bool? canUpload;

  ///本 Tenant 成员同时持有该定义的 discoverer 与 reader（DD-131(6)）。
  final bool catalogShared;
  final String? currentPublishedVersionAssetId;
  final String displayName;
  final String ownerPrincipalId;
  final String resourceId;
  final int resourceVersion;
  final String stableSlug;
  final SkillDefinitionStatus status;

  SkillDefinitionView({
    this.canDisable,
    this.canShare,
    this.canUpload,
    required this.catalogShared,
    this.currentPublishedVersionAssetId,
    required this.displayName,
    required this.ownerPrincipalId,
    required this.resourceId,
    required this.resourceVersion,
    required this.stableSlug,
    required this.status,
  });

  factory SkillDefinitionView.fromJson(Map<String, dynamic> json) =>
      SkillDefinitionView(
        canDisable: json["canDisable"],
        canShare: json["canShare"],
        canUpload: json["canUpload"],
        catalogShared: json["catalogShared"],
        currentPublishedVersionAssetId: json["currentPublishedVersionAssetId"],
        displayName: json["displayName"],
        ownerPrincipalId: json["ownerPrincipalId"],
        resourceId: json["resourceId"],
        resourceVersion: json["resourceVersion"],
        stableSlug: json["stableSlug"],
        status: skillDefinitionStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "canDisable": canDisable,
    "canShare": canShare,
    "canUpload": canUpload,
    "catalogShared": catalogShared,
    "currentPublishedVersionAssetId": currentPublishedVersionAssetId,
    "displayName": displayName,
    "ownerPrincipalId": ownerPrincipalId,
    "resourceId": resourceId,
    "resourceVersion": resourceVersion,
    "stableSlug": stableSlug,
    "status": skillDefinitionStatusValues.reverse[status],
  });
}

///DD-135(1)、03 §7：SkillDefinition 状态。DISABLED 不可逆，DELETED 是 Tenant 销毁墓碑。
enum SkillDefinitionStatus { ACTIVE, DELETED, DISABLED, PROVISIONING }

final skillDefinitionStatusValues = EnumValues({
  "ACTIVE": SkillDefinitionStatus.ACTIVE,
  "DELETED": SkillDefinitionStatus.DELETED,
  "DISABLED": SkillDefinitionStatus.DISABLED,
  "PROVISIONING": SkillDefinitionStatus.PROVISIONING,
});

///DD-135(4)：AgentVersion 编辑器可选的 Skill 版本目录——当前 HUMAN fresh 可 read 的 ACTIVE 定义下的 PUBLISHED
///版本；不授予任何 Installation permission。
class SkillReferencePage {
  final int? nextOffset;
  final List<SkillVersionView> versions;

  SkillReferencePage({this.nextOffset, required this.versions});

  factory SkillReferencePage.fromJson(Map<String, dynamic> json) =>
      SkillReferencePage(
        nextOffset: json["nextOffset"],
        versions: List<SkillVersionView>.from(
          json["versions"].map((x) => SkillVersionView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nextOffset": nextOffset,
    "versions": List<dynamic>.from(versions.map((x) => x.toJson())),
  });
}

///DD-135(1)(2)：不可变 SkillVersion 的元数据；正文只经内容读取端点返回。state 与 AgentVersion 共用同一生命周期枚举。
class SkillVersionView {
  final int artifactByteSize;
  final String artifactDigest;
  final String artifactFormat;
  final String assetId;
  final int assetVersion;
  final bool? canPublish;
  final bool? canRetire;
  final List<String> capabilityRequirements;

  ///是所属定义当前的发布指针。
  final bool? current;
  final String description;
  final String metadataHash;
  final int ordinal;
  final String ownerPrincipalId;
  final String? shortDescription;
  final String skillName;
  final String skillResourceId;
  final String stableSlug;
  final AgentVersionState state;

  SkillVersionView({
    required this.artifactByteSize,
    required this.artifactDigest,
    required this.artifactFormat,
    required this.assetId,
    required this.assetVersion,
    this.canPublish,
    this.canRetire,
    required this.capabilityRequirements,
    this.current,
    required this.description,
    required this.metadataHash,
    required this.ordinal,
    required this.ownerPrincipalId,
    this.shortDescription,
    required this.skillName,
    required this.skillResourceId,
    required this.stableSlug,
    required this.state,
  });

  factory SkillVersionView.fromJson(Map<String, dynamic> json) =>
      SkillVersionView(
        artifactByteSize: json["artifactByteSize"],
        artifactDigest: json["artifactDigest"],
        artifactFormat: json["artifactFormat"],
        assetId: json["assetId"],
        assetVersion: json["assetVersion"],
        canPublish: json["canPublish"],
        canRetire: json["canRetire"],
        capabilityRequirements: List<String>.from(
          json["capabilityRequirements"].map((x) => x),
        ),
        current: json["current"],
        description: json["description"],
        metadataHash: json["metadataHash"],
        ordinal: json["ordinal"],
        ownerPrincipalId: json["ownerPrincipalId"],
        shortDescription: json["shortDescription"],
        skillName: json["skillName"],
        skillResourceId: json["skillResourceId"],
        stableSlug: json["stableSlug"],
        state: agentVersionStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "artifactByteSize": artifactByteSize,
    "artifactDigest": artifactDigest,
    "artifactFormat": artifactFormat,
    "assetId": assetId,
    "assetVersion": assetVersion,
    "canPublish": canPublish,
    "canRetire": canRetire,
    "capabilityRequirements": List<dynamic>.from(
      capabilityRequirements.map((x) => x),
    ),
    "current": current,
    "description": description,
    "metadataHash": metadataHash,
    "ordinal": ordinal,
    "ownerPrincipalId": ownerPrincipalId,
    "shortDescription": shortDescription,
    "skillName": skillName,
    "skillResourceId": skillResourceId,
    "stableSlug": stableSlug,
    "state": agentVersionStateValues.reverse[state],
  });
}

///DD-135(4)(8)：一个可读版本的规范 SKILL.md 正文；读取即对该版本的 read，返回前以 digest 重算。不进入审计或日志。
class SkillVersionContentView {
  final String artifactDigest;
  final String assetId;
  final String content;

  SkillVersionContentView({
    required this.artifactDigest,
    required this.assetId,
    required this.content,
  });

  factory SkillVersionContentView.fromJson(Map<String, dynamic> json) =>
      SkillVersionContentView(
        artifactDigest: json["artifactDigest"],
        assetId: json["assetId"],
        content: json["content"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "artifactDigest": artifactDigest,
    "assetId": assetId,
    "content": content,
  });
}

///一个 Skill 定义的版本页（ordinal 降序）；DRAFT 只对版本 Asset read 持有者列出。
class SkillVersionPage {
  final int? nextOffset;
  final int resourceVersion;
  final String skillResourceId;
  final List<SkillVersionView> versions;

  SkillVersionPage({
    this.nextOffset,
    required this.resourceVersion,
    required this.skillResourceId,
    required this.versions,
  });

  factory SkillVersionPage.fromJson(Map<String, dynamic> json) =>
      SkillVersionPage(
        nextOffset: json["nextOffset"],
        resourceVersion: json["resourceVersion"],
        skillResourceId: json["skillResourceId"],
        versions: List<SkillVersionView>.from(
          json["versions"].map((x) => SkillVersionView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nextOffset": nextOffset,
    "resourceVersion": resourceVersion,
    "skillResourceId": skillResourceId,
    "versions": List<dynamic>.from(versions.map((x) => x.toJson())),
  });
}

///GET /api/v1/invitations 回应数组的元素：本 Tenant 的邀请，只对持有 Tenant manage
///的人可见（DD-83）。不含凭据或其摘要。兑换后的确认经 approvalWorkflowId 走既有的审批决定端点。
class TenantInvitationView {
  final String? admitActionExecutionId;
  final ApprovalStatus? approvalStatus;
  final String? approvalWorkflowId;

  ///RFC3339，UTC
  final String createdAt;

  ///RFC3339，UTC
  final String expiresAt;
  final String invitationId;

  ///邀请人写给审批人看的称呼，不参与寻址与判定
  final String inviteeLabel;
  final String inviterPrincipalId;
  final String? membershipId;
  final TenantMembershipState? membershipState;

  ///RFC3339，UTC；只在 REDEEMED 时出现
  final String? redeemedAt;

  ///兑换者自报的显示名，只作展示
  final String? redeemerDisplayName;
  final TenantInvitationStatus status;

  TenantInvitationView({
    this.admitActionExecutionId,
    this.approvalStatus,
    this.approvalWorkflowId,
    required this.createdAt,
    required this.expiresAt,
    required this.invitationId,
    required this.inviteeLabel,
    required this.inviterPrincipalId,
    this.membershipId,
    this.membershipState,
    this.redeemedAt,
    this.redeemerDisplayName,
    required this.status,
  });

  factory TenantInvitationView.fromJson(Map<String, dynamic> json) =>
      TenantInvitationView(
        admitActionExecutionId: json["admitActionExecutionId"],
        approvalStatus: json["approvalStatus"] == null
            ? null
            : approvalStatusValues.map[json["approvalStatus"]]!,
        approvalWorkflowId: json["approvalWorkflowId"],
        createdAt: json["createdAt"],
        expiresAt: json["expiresAt"],
        invitationId: json["invitationId"],
        inviteeLabel: json["inviteeLabel"],
        inviterPrincipalId: json["inviterPrincipalId"],
        membershipId: json["membershipId"],
        membershipState: json["membershipState"] == null
            ? null
            : tenantMembershipStateValues.map[json["membershipState"]]!,
        redeemedAt: json["redeemedAt"],
        redeemerDisplayName: json["redeemerDisplayName"],
        status: tenantInvitationStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "admitActionExecutionId": admitActionExecutionId,
    "approvalStatus": approvalStatusValues.reverse[approvalStatus],
    "approvalWorkflowId": approvalWorkflowId,
    "createdAt": createdAt,
    "expiresAt": expiresAt,
    "invitationId": invitationId,
    "inviteeLabel": inviteeLabel,
    "inviterPrincipalId": inviterPrincipalId,
    "membershipId": membershipId,
    "membershipState": tenantMembershipStateValues.reverse[membershipState],
    "redeemedAt": redeemedAt,
    "redeemerDisplayName": redeemerDisplayName,
    "status": tenantInvitationStatusValues.reverse[status],
  });
}

///TenantInvitation 在视图中的状态（DD-83）。库里只存 ISSUED/REDEEMED/REVOKED；EXPIRED 是查询时判定：expires_at
///已过的 ISSUED 邀请即 EXPIRED，没有回收作业去写它。
enum TenantInvitationStatus { EXPIRED, ISSUED, REDEEMED, REVOKED }

final tenantInvitationStatusValues = EnumValues({
  "EXPIRED": TenantInvitationStatus.EXPIRED,
  "ISSUED": TenantInvitationStatus.ISSUED,
  "REDEEMED": TenantInvitationStatus.REDEEMED,
  "REVOKED": TenantInvitationStatus.REVOKED,
});

///GET /api/v1/tenant-member-joins 的有界回应（DD-125(9)）。每次请求 fresh 校验 Tenant manage，否则
///PERMISSION_DENIED；不建立 ActionExecution、不写访问审计。不带 after 时 items 为空，只给当前游标供建账；带 after
///时按（进入时刻，membership）升序返回其后进入 ACTIVE 的其他成员，单页有上界。
class TenantMemberJoinPage {
  ///不透明位置，下一次作为 after 原样回传；空串表示起点（本 Tenant 尚无记下进入时刻的成员）。客户端不得解析或构造；格式非法时服务端回 400。
  final String cursor;

  ///游标之后仍有未扫描的成员事实，应立即以新 cursor 续读；为 true 时本页 items 可能为空。
  final bool hasMore;
  final List<TenantMemberJoinView> items;

  TenantMemberJoinPage({
    required this.cursor,
    required this.hasMore,
    required this.items,
  });

  factory TenantMemberJoinPage.fromJson(Map<String, dynamic> json) =>
      TenantMemberJoinPage(
        cursor: json["cursor"],
        hasMore: json["hasMore"],
        items: List<TenantMemberJoinView>.from(
          json["items"].map((x) => TenantMemberJoinView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "cursor": cursor,
    "hasMore": hasMore,
    "items": List<dynamic>.from(items.map((x) => x.toJson())),
  });
}

///一名在游标之后进入 ACTIVE 的同 Tenant 其他 HUMAN 成员（DD-125(9)）。只含 Principal ID、显示名与进入时刻，不含公钥、IdP
///身份或邀请凭据；按 HUMAN Principal 计，新设备公钥（DD-77）不产生条目。
class TenantMemberJoinView {
  final String displayName;

  ///TenantMembership 最近一次转入 ACTIVE 的时刻（重新加入覆盖），RFC3339 UTC；不是邀请或创建时间。
  final String joinedAt;
  final String principalId;

  TenantMemberJoinView({
    required this.displayName,
    required this.joinedAt,
    required this.principalId,
  });

  factory TenantMemberJoinView.fromJson(Map<String, dynamic> json) =>
      TenantMemberJoinView(
        displayName: json["displayName"],
        joinedAt: json["joinedAt"],
        principalId: json["principalId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "displayName": displayName,
    "joinedAt": joinedAt,
    "principalId": principalId,
  });
}

///DD-123: platform quota items of the Tenant read from OpenMeter (the only authority).
///Tenant admin and auditor only.
class TenantQuotaPage {
  final List<TenantQuotaView> quotas;

  ///Present only when the caller may set quotas now (Tenant manage); auditors read without it.
  final TenantQuotaPageSetActionKey? setActionKey;

  TenantQuotaPage({required this.quotas, this.setActionKey});

  factory TenantQuotaPage.fromJson(Map<String, dynamic> json) =>
      TenantQuotaPage(
        quotas: List<TenantQuotaView>.from(
          json["quotas"].map((x) => TenantQuotaView.fromJson(x)),
        ),
        setActionKey: json["setActionKey"] == null
            ? null
            : tenantQuotaPageSetActionKeyValues.map[json["setActionKey"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "quotas": List<dynamic>.from(quotas.map((x) => x.toJson())),
    "setActionKey": tenantQuotaPageSetActionKeyValues.reverse[setActionKey],
  });
}

class TenantQuotaView {
  final TenantQuotaFeature feature;
  final bool hardLimit;
  final bool hasAccess;
  final int? limitPerPeriod;
  final String? periodResetAt;
  final double? usage;

  TenantQuotaView({
    required this.feature,
    required this.hardLimit,
    required this.hasAccess,
    this.limitPerPeriod,
    this.periodResetAt,
    this.usage,
  });

  factory TenantQuotaView.fromJson(Map<String, dynamic> json) =>
      TenantQuotaView(
        feature: tenantQuotaFeatureValues.map[json["feature"]]!,
        hardLimit: json["hardLimit"],
        hasAccess: json["hasAccess"],
        limitPerPeriod: json["limitPerPeriod"],
        periodResetAt: json["periodResetAt"],
        usage: json["usage"]?.toDouble(),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "feature": tenantQuotaFeatureValues.reverse[feature],
    "hardLimit": hardLimit,
    "hasAccess": hasAccess,
    "limitPerPeriod": limitPerPeriod,
    "periodResetAt": periodResetAt,
    "usage": usage,
  });
}

enum TenantQuotaPageSetActionKey { TENANT_QUOTA_SET }

final tenantQuotaPageSetActionKeyValues = EnumValues({
  "tenant.quota.set": TenantQuotaPageSetActionKey.TENANT_QUOTA_SET,
});

///PUT /api/v1/user-state/threads 的请求体（DD-40、DD-125(1)、03
///CollaborationUserState.thread_preferences）。threadKey 为 thread:<Buzz root event id>，Core
///以本人 SERVER 身份回读根事件并核验当前 Workspace 成员或私聊参与资格。保留原联动：followed=true 记 FOLLOWED（关注即解除静音），false
///记 MUTED（取消关注即静音）；每人至多 500 条，超出淘汰最早写入的关注。version 是读到的 CollaborationUserState 版本，不符即 409。不是
///Governed Action。
class ThreadPreferenceRequest {
  final bool followed;
  final String threadKey;
  final int version;

  ThreadPreferenceRequest({
    required this.followed,
    required this.threadKey,
    required this.version,
  });

  factory ThreadPreferenceRequest.fromJson(Map<String, dynamic> json) =>
      ThreadPreferenceRequest(
        followed: json["followed"],
        threadKey: json["threadKey"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "followed": followed,
    "threadKey": threadKey,
    "version": version,
  });
}

///GET /api/v1/usage-billing：Tenant 或其中一个 Workspace 在区间内的用量与账单视图（.design/11 §6–7、.design/14
///§7–8），调用方须对该范围持有 audit permission，每次 fresh Check。committed usage、额度与账单直接读 OpenMeter，Core
///不复制或聚合成账本；投递计数只来自 Core UsageEvent outbox。缺口用确定状态表达，不显示零或已结算。
class UsageBillingView {
  final UsageSectionState billingState;
  final UsageCustomerState customerState;
  final List<UsageDeliveryCount> delivery;
  final List<UsageEntitlementView> entitlements;
  final UsageSectionState entitlementState;

  ///RFC3339，含
  final String from;
  final List<UsageInvoiceView> invoices;
  final List<UsageMeterView> meters;
  final List<OperationUsageCount> operationUsage;
  final String tenantId;

  ///RFC3339，不含
  final String to;
  final String? workspaceId;

  UsageBillingView({
    required this.billingState,
    required this.customerState,
    required this.delivery,
    required this.entitlements,
    required this.entitlementState,
    required this.from,
    required this.invoices,
    required this.meters,
    required this.operationUsage,
    required this.tenantId,
    required this.to,
    this.workspaceId,
  });

  factory UsageBillingView.fromJson(Map<String, dynamic> json) =>
      UsageBillingView(
        billingState: usageSectionStateValues.map[json["billingState"]]!,
        customerState: usageCustomerStateValues.map[json["customerState"]]!,
        delivery: List<UsageDeliveryCount>.from(
          json["delivery"].map((x) => UsageDeliveryCount.fromJson(x)),
        ),
        entitlements: List<UsageEntitlementView>.from(
          json["entitlements"].map((x) => UsageEntitlementView.fromJson(x)),
        ),
        entitlementState:
            usageSectionStateValues.map[json["entitlementState"]]!,
        from: json["from"],
        invoices: List<UsageInvoiceView>.from(
          json["invoices"].map((x) => UsageInvoiceView.fromJson(x)),
        ),
        meters: List<UsageMeterView>.from(
          json["meters"].map((x) => UsageMeterView.fromJson(x)),
        ),
        operationUsage: List<OperationUsageCount>.from(
          json["operationUsage"].map((x) => OperationUsageCount.fromJson(x)),
        ),
        tenantId: json["tenantId"],
        to: json["to"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "billingState": usageSectionStateValues.reverse[billingState],
    "customerState": usageCustomerStateValues.reverse[customerState],
    "delivery": List<dynamic>.from(delivery.map((x) => x.toJson())),
    "entitlements": List<dynamic>.from(entitlements.map((x) => x.toJson())),
    "entitlementState": usageSectionStateValues.reverse[entitlementState],
    "from": from,
    "invoices": List<dynamic>.from(invoices.map((x) => x.toJson())),
    "meters": List<dynamic>.from(meters.map((x) => x.toJson())),
    "operationUsage": List<dynamic>.from(operationUsage.map((x) => x.toJson())),
    "tenantId": tenantId,
    "to": to,
    "workspaceId": workspaceId,
  });
}

///用量与账单页中额度、账单两类 Customer
///级事实的读取结论。AVAILABLE：原生查询成功（列表可以为空）；UNAVAILABLE：原生查询失败或结果不可查证；TENANT_SCOPE_ONLY：所选
///Workspace 视图不展示 Customer 级事实；NOT_PROVISIONED：Tenant 没有有效 Customer 映射。
enum UsageSectionState {
  AVAILABLE,
  NOT_PROVISIONED,
  TENANT_SCOPE_ONLY,
  UNAVAILABLE,
}

final usageSectionStateValues = EnumValues({
  "AVAILABLE": UsageSectionState.AVAILABLE,
  "NOT_PROVISIONED": UsageSectionState.NOT_PROVISIONED,
  "TENANT_SCOPE_ONLY": UsageSectionState.TENANT_SCOPE_ONLY,
  "UNAVAILABLE": UsageSectionState.UNAVAILABLE,
});

///当前 Tenant 的 OpenMeter Customer 映射（DD-38、.design/11 §3）。ACTIVE：Core binding 有效且原生 Customer
///读回同 Tenant 且未删除；NOT_PROVISIONED：没有 binding；REVOKED：binding 已撤销；UNAVAILABLE：原生事实不可读或与
///binding 不一致，结果不明。
enum UsageCustomerState { ACTIVE, NOT_PROVISIONED, REVOKED, UNAVAILABLE }

final usageCustomerStateValues = EnumValues({
  "ACTIVE": UsageCustomerState.ACTIVE,
  "NOT_PROVISIONED": UsageCustomerState.NOT_PROVISIONED,
  "REVOKED": UsageCustomerState.REVOKED,
  "UNAVAILABLE": UsageCustomerState.UNAVAILABLE,
});

class UsageDeliveryCount {
  final int count;
  final UsageSettlementStatus status;

  UsageDeliveryCount({required this.count, required this.status});

  factory UsageDeliveryCount.fromJson(Map<String, dynamic> json) =>
      UsageDeliveryCount(
        count: json["count"],
        status: usageSettlementStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "count": count,
    "status": usageSettlementStatusValues.reverse[status],
  });
}

class UsageEntitlementView {
  ///仅 metered；OpenMeter 十进制原文
  final String? balance;

  ///原生 entitlement 类型原文
  final String entitlementType;
  final String featureKey;
  final bool hasAccess;

  ///仅 metered
  final String? overage;

  ///仅 metered；当前用量周期内的原生 usage
  final String? usage;

  UsageEntitlementView({
    this.balance,
    required this.entitlementType,
    required this.featureKey,
    required this.hasAccess,
    this.overage,
    this.usage,
  });

  factory UsageEntitlementView.fromJson(Map<String, dynamic> json) =>
      UsageEntitlementView(
        balance: json["balance"],
        entitlementType: json["entitlementType"],
        featureKey: json["featureKey"],
        hasAccess: json["hasAccess"],
        overage: json["overage"],
        usage: json["usage"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "balance": balance,
    "entitlementType": entitlementType,
    "featureKey": featureKey,
    "hasAccess": hasAccess,
    "overage": overage,
    "usage": usage,
  });
}

class UsageInvoiceView {
  final String? currency;
  final String id;
  final String? issuedAt;
  final String? number;
  final String? servicePeriodFrom;
  final String? servicePeriodTo;

  ///原生 invoice status 原文；只有原生终态才可称为已结算
  final String status;

  ///原生 totals.total 十进制原文
  final String? total;

  UsageInvoiceView({
    this.currency,
    required this.id,
    this.issuedAt,
    this.number,
    this.servicePeriodFrom,
    this.servicePeriodTo,
    required this.status,
    this.total,
  });

  factory UsageInvoiceView.fromJson(Map<String, dynamic> json) =>
      UsageInvoiceView(
        currency: json["currency"],
        id: json["id"],
        issuedAt: json["issuedAt"],
        number: json["number"],
        servicePeriodFrom: json["servicePeriodFrom"],
        servicePeriodTo: json["servicePeriodTo"],
        status: json["status"],
        total: json["total"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "currency": currency,
    "id": id,
    "issuedAt": issuedAt,
    "number": number,
    "servicePeriodFrom": servicePeriodFrom,
    "servicePeriodTo": servicePeriodTo,
    "status": status,
    "total": total,
  });
}

class UsageMeterView {
  ///原生 meter 的聚合方式原文
  final String? aggregation;

  ///ActionDefinition 登记的平台 meter 选择键
  final String meterKey;

  ///仅 COMMITTED 时给出；OpenMeter 返回的十进制原文
  final String? quantity;
  final MeterUsageState state;

  UsageMeterView({
    this.aggregation,
    required this.meterKey,
    this.quantity,
    required this.state,
  });

  factory UsageMeterView.fromJson(Map<String, dynamic> json) => UsageMeterView(
    aggregation: json["aggregation"],
    meterKey: json["meterKey"],
    quantity: json["quantity"],
    state: meterUsageStateValues.map[json["state"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "aggregation": aggregation,
    "meterKey": meterKey,
    "quantity": quantity,
    "state": meterUsageStateValues.reverse[state],
  });
}

///一个已登记 meter 在所选区间内的 OpenMeter committed usage 查询结论（.design/11 §7）。COMMITTED：原生查询返回该
///Customer 的聚合值；NO_COMMITTED_USAGE：原生查询成功且区间内没有已存储事件；WORKSPACE_DIMENSION_UNAVAILABLE：原生
///meter 未声明 workspace_id 维度，不能按 Workspace 归因；METER_NOT_REGISTERED：动作登记的 meter 在 OpenMeter
///中不存在或不唯一；UNAVAILABLE：查询失败或结果不可查证。后三者都不显示数值。
enum MeterUsageState {
  COMMITTED,
  METER_NOT_REGISTERED,
  NO_COMMITTED_USAGE,
  UNAVAILABLE,
  WORKSPACE_DIMENSION_UNAVAILABLE,
}

final meterUsageStateValues = EnumValues({
  "COMMITTED": MeterUsageState.COMMITTED,
  "METER_NOT_REGISTERED": MeterUsageState.METER_NOT_REGISTERED,
  "NO_COMMITTED_USAGE": MeterUsageState.NO_COMMITTED_USAGE,
  "UNAVAILABLE": MeterUsageState.UNAVAILABLE,
  "WORKSPACE_DIMENSION_UNAVAILABLE":
      MeterUsageState.WORKSPACE_DIMENSION_UNAVAILABLE,
});

///CollaborationUserState 写入成功后的新版本（/api/v1/user-state/* 各 PUT/DELETE 的 200 回应）。DD-125 的
///DELETE /api/v1/user-state/sidebar-sections/{sectionId} 与 DELETE
////api/v1/user-state/channel-templates/{templateId} 也以它为请求体：version 是读到的版本，不符即 409。
class UserStateVersion {
  final int version;

  UserStateVersion({required this.version});

  factory UserStateVersion.fromJson(Map<String, dynamic> json) =>
      UserStateVersion(version: json["version"]);

  Map<String, dynamic> toJson() => _stripNulls({"version": version});
}

///GET /api/v1/workspaces/{workspaceId}/canvas（DD-125(4)、V-SCN-135）：BFF 以本人身份在已准入 Workspace
///的 Channel 下按 #h 读取 kind 40100，只采纳作者为该 Tenant CONTROL 的最新一条并验签；其他作者的 40100 一律忽略。正文原样透传，不进
///Core 存储。没有采纳的事件时 content、eventId、createdAt 都省略（原“No canvas set”）。
class WebChannelCanvasView {
  ///原 Markdown 正文；空串表示管理者已清空。
  final String? content;

  ///被采纳事件的 created_at，RFC3339。
  final String? createdAt;

  ///被采纳的 CONTROL 40100 事件 ID。
  final String? eventId;

  ///固定为 workspace.canvas.set：目录已开放、Workspace ACTIVE 且本人经 fresh Workspace manage 检查时给出（≙ 原
  ///canEditNarrative）。省略即不显示编辑入口；提交仍重新准入。
  final String? setActionKey;
  final String workspaceId;

  WebChannelCanvasView({
    this.content,
    this.createdAt,
    this.eventId,
    this.setActionKey,
    required this.workspaceId,
  });

  factory WebChannelCanvasView.fromJson(Map<String, dynamic> json) =>
      WebChannelCanvasView(
        content: json["content"],
        createdAt: json["createdAt"],
        eventId: json["eventId"],
        setActionKey: json["setActionKey"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "content": content,
    "createdAt": createdAt,
    "eventId": eventId,
    "setActionKey": setActionKey,
    "workspaceId": workspaceId,
  });
}

///Own NIP-30 set mutation. The admitted host derives the signer and community; omitted
///imageUrl removes only the caller's entry.
class WebCustomEmojiMutation {
  final String expectedPubkey;
  final String idempotencyKey;
  final String? imageUrl;
  final String shortcode;

  WebCustomEmojiMutation({
    required this.expectedPubkey,
    required this.idempotencyKey,
    this.imageUrl,
    required this.shortcode,
  });

  factory WebCustomEmojiMutation.fromJson(Map<String, dynamic> json) =>
      WebCustomEmojiMutation(
        expectedPubkey: json["expectedPubkey"],
        idempotencyKey: json["idempotencyKey"],
        imageUrl: json["imageUrl"],
        shortcode: json["shortcode"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "expectedPubkey": expectedPubkey,
    "idempotencyKey": idempotencyKey,
    "imageUrl": imageUrl,
    "shortcode": shortcode,
  });
}

///Verified original per-author kind:30030 snapshots, not a Core-owned emoji directory.
///Clients apply the original deterministic community union.
class WebCustomEmojiView {
  final List<Map<String, dynamic>> events;
  final Map<String, String> mediaPaths;
  final String pubkey;

  WebCustomEmojiView({
    required this.events,
    required this.mediaPaths,
    required this.pubkey,
  });

  factory WebCustomEmojiView.fromJson(Map<String, dynamic> json) =>
      WebCustomEmojiView(
        events: List<Map<String, dynamic>>.from(
          json["events"].map(
            (x) => Map.from(x).map((k, v) => MapEntry<String, dynamic>(k, v)),
          ),
        ),
        mediaPaths: Map.from(
          json["mediaPaths"],
        ).map((k, v) => MapEntry<String, String>(k, v)),
        pubkey: json["pubkey"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "events": List<dynamic>.from(
      events.map(
        (x) => Map.from(x).map((k, v) => MapEntry<String, dynamic>(k, v)),
      ),
    ),
    "mediaPaths": Map.from(
      mediaPaths,
    ).map((k, v) => MapEntry<String, dynamic>(k, v)),
    "pubkey": pubkey,
  });
}

///GET /api/v1/gifs（DD-125(5)、09 §3、V-SCN-140）：原 GIF 选择器是否出现。available 仅在本 Tenant ACTIVE
///TenantBuzzBinding 的 NIP-11 快照与运行期文档一致且广告 buzz-gif/gif（provider klipy，原 /gifs/search 与
////gifs/share）、并且部署登记了至少一个 GIF 图片来源时为 true；否则按原版不出现。imageOrigins 是部署登记的 https 来源（与 Web 静态
///CSP img-src 追加项同一份），Web 只对这些来源内联渲染无 imeta 的 GIF；KLIPY 密钥只在 Relay 部署环境。
class WebGifCapabilityView {
  final bool available;
  final List<String> imageOrigins;

  WebGifCapabilityView({required this.available, required this.imageOrigins});

  factory WebGifCapabilityView.fromJson(Map<String, dynamic> json) =>
      WebGifCapabilityView(
        available: json["available"],
        imageOrigins: List<String>.from(json["imageOrigins"].map((x) => x)),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "available": available,
    "imageOrigins": List<dynamic>.from(imageOrigins.map((x) => x)),
  });
}

///POST /api/v1/gifs/search：BFF 以本人身份经 NIP-98 转发 Relay 原 /gifs/search（成员门与 GIF 限速由 Relay
///执行，超额以 LIMIT 类回应）。query 为空即原 trending，至多 200 字符；locale 为浏览器语言（1–32 字符）。原 KLIPY
///customer_id 由 BFF 按 Tenant 与本人 Principal 派生为稳定匿名标识，Browser 不提供。
class WebGifSearchRequest {
  final String locale;
  final String query;

  WebGifSearchRequest({required this.locale, required this.query});

  factory WebGifSearchRequest.fromJson(Map<String, dynamic> json) =>
      WebGifSearchRequest(locale: json["locale"], query: json["query"]);

  Map<String, dynamic> toJson() =>
      _stripNulls({"locale": locale, "query": query});
}

///POST /api/v1/gifs/search 的回应：原 Relay 固定一页（24 项）结果，按提供方顺序。
class WebGifSearchView {
  final List<WebGifItem> gifs;

  WebGifSearchView({required this.gifs});

  factory WebGifSearchView.fromJson(Map<String, dynamic> json) =>
      WebGifSearchView(
        gifs: List<WebGifItem>.from(
          json["gifs"].map((x) => WebGifItem.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"gifs": List<dynamic>.from(gifs.map((x) => x.toJson()))});
}

///原 normalizeKlipyGifs 的一项（BFF 归一化，Browser 不接收提供方原始 JSON）：original 取 md/hd/sm/xs 的首个完整
///gif，preview 取 sm.webp/sm.gif/xs.webp/xs.gif/md.webp 或 original，poster 取首个完整 jpg。所有地址都是
///https 且来源在部署登记的 GIF 图片来源之内，否则该项不返回。发送时原版把 url 以 ![image](url) 追加到正文，不带 imeta。
class WebGifItem {
  final int height;
  final String? posterUrl;
  final int previewHeight;
  final String previewUrl;
  final int previewWidth;
  final int size;
  final String slug;
  final String title;
  final String url;
  final int width;

  WebGifItem({
    required this.height,
    this.posterUrl,
    required this.previewHeight,
    required this.previewUrl,
    required this.previewWidth,
    required this.size,
    required this.slug,
    required this.title,
    required this.url,
    required this.width,
  });

  factory WebGifItem.fromJson(Map<String, dynamic> json) => WebGifItem(
    height: json["height"],
    posterUrl: json["posterUrl"],
    previewHeight: json["previewHeight"],
    previewUrl: json["previewUrl"],
    previewWidth: json["previewWidth"],
    size: json["size"],
    slug: json["slug"],
    title: json["title"],
    url: json["url"],
    width: json["width"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "height": height,
    "posterUrl": posterUrl,
    "previewHeight": previewHeight,
    "previewUrl": previewUrl,
    "previewWidth": previewWidth,
    "size": size,
    "slug": slug,
    "title": title,
    "url": url,
    "width": width,
  });
}

///POST /api/v1/gifs/share（原选择时的分享上报，尽力而为）：BFF 以本人身份经 NIP-98 转发 Relay 原 /gifs/share，成功回
///204。slug 为 1–200 字符。
class WebGifShareRequest {
  final String slug;

  WebGifShareRequest({required this.slug});

  factory WebGifShareRequest.fromJson(Map<String, dynamic> json) =>
      WebGifShareRequest(slug: json["slug"]);

  Map<String, dynamic> toJson() => _stripNulls({"slug": slug});
}

///DD-39/72/75：本人原 Relay mentions feed。Core 逐项核验当前资源准入、签名和频道线程归属；不接受身份、scope 或任意 Relay
///filter。
class WebInboxQuery {
  final int? limit;
  final int? since;

  WebInboxQuery({this.limit, this.since});

  factory WebInboxQuery.fromJson(Map<String, dynamic> json) =>
      WebInboxQuery(limit: json["limit"], since: json["since"]);

  Map<String, dynamic> toJson() =>
      _stripNulls({"limit": limit, "since": since});
}

///POST /api/v1/workspaces/{workspaceId}/link-previews 与
////api/v1/conversations/{conversationId}/link-previews（DD-125(5)、09 §3、V-SCN-139）：Web 原
///composer 的链接预览抓取由 BFF 代为执行。只接受 http/https 与默认端口；BFF 每一跳在 DNS 解析后拒绝回环、私网、链路本地、CGNAT、组播、ULA
///与部署登记的内部网段，只连接已校验地址，至多 3 次跳转、256 KB，不带 cookie 与凭据；按 Principal 限速，超额以 LIMIT
///类拒绝；预览图以本人身份上传为 Relay 媒体。审计只记主机与 URL 摘要。
class WebLinkPreviewRequest {
  ///原 extractSupportedLinkPreviews 识别出的链接（http/https）。
  final String url;

  WebLinkPreviewRequest({required this.url});

  factory WebLinkPreviewRequest.fromJson(Map<String, dynamic> json) =>
      WebLinkPreviewRequest(url: json["url"]);

  Map<String, dynamic> toJson() => _stripNulls({"url": url});
}

///BFF 为本人短期持有的一份链接预览快照（DD-125(5)）。字段即原 11 元素 link-preview snapshot 标签的内容（版本 1）：canonicalUrl
///为 https、无凭据与片段；title 不超过 300 字节、siteName 100 字节、description 1000 字节；imageUrl/faviconUrl
///是本人上传的 Relay 媒体地址，缺省即无图。发布请求只能以 snapshotId 引用本人未过期的快照（linkPreviewSnapshotIds），Browser
///不提交原始标签。
class WebLinkPreviewSnapshotView {
  final String canonicalUrl;
  final String description;

  ///快照失效时刻，RFC3339；之后发布引用它以 TARGET_NOT_FOUND 拒绝。
  final String expiresAt;
  final String? faviconUrl;
  final String? imageUrl;
  final String siteName;
  final String snapshotId;
  final String title;

  ///请求的链接，原样回显，供 composer 与正文中的链接对应。
  final String url;

  WebLinkPreviewSnapshotView({
    required this.canonicalUrl,
    required this.description,
    required this.expiresAt,
    this.faviconUrl,
    this.imageUrl,
    required this.siteName,
    required this.snapshotId,
    required this.title,
    required this.url,
  });

  factory WebLinkPreviewSnapshotView.fromJson(Map<String, dynamic> json) =>
      WebLinkPreviewSnapshotView(
        canonicalUrl: json["canonicalUrl"],
        description: json["description"],
        expiresAt: json["expiresAt"],
        faviconUrl: json["faviconUrl"],
        imageUrl: json["imageUrl"],
        siteName: json["siteName"],
        snapshotId: json["snapshotId"],
        title: json["title"],
        url: json["url"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "canonicalUrl": canonicalUrl,
    "description": description,
    "expiresAt": expiresAt,
    "faviconUrl": faviconUrl,
    "imageUrl": imageUrl,
    "siteName": siteName,
    "snapshotId": snapshotId,
    "title": title,
    "url": url,
  });
}

///Typed read of authors proven by signed events in one currently admitted channel or
///private conversation. No caller-selected pubkey or Relay filter; Core partitions Relay
///reads by its existing page/NIP-11 limits.
class WebMessageAuthorQuery {
  final List<String> eventIds;

  WebMessageAuthorQuery({required this.eventIds});

  factory WebMessageAuthorQuery.fromJson(Map<String, dynamic> json) =>
      WebMessageAuthorQuery(
        eventIds: List<String>.from(json["eventIds"].map((x) => x)),
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"eventIds": List<dynamic>.from(eventIds.map((x) => x))});
}

///Exact event-id keyed profiles from one fresh admitted read. Every requested message must
///be verified; a missing kind:0 is an empty profile, while missing message proof fails the
///whole read. No profile body is persisted by Core.
class WebMessageAuthorView {
  final Map<String, WebProfileView> profiles;

  WebMessageAuthorView({required this.profiles});

  factory WebMessageAuthorView.fromJson(Map<String, dynamic> json) =>
      WebMessageAuthorView(
        profiles: Map.from(json["profiles"]).map(
          (k, v) =>
              MapEntry<String, WebProfileView>(k, WebProfileView.fromJson(v)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "profiles": Map.from(
      profiles,
    ).map((k, v) => MapEntry<String, dynamic>(k, v.toJson())),
  });
}

///Profile read from Buzz for the current identity or an author proven by a currently
///admitted channel/private-conversation message, never a Core profile copy. An absent
///kind:0 is an empty profile, not a fabricated event.
class WebProfileView {
  final String? about;

  ///Same-origin BFF paths for exact media URLs on the current community. A read projection,
  ///never an upload or remote proxy authority.
  final Map<String, String> avatarMediaPaths;
  final String? avatarUrl;
  final String? displayName;
  final String? eventId;
  final String? nip05Handle;
  final String pubkey;

  WebProfileView({
    this.about,
    required this.avatarMediaPaths,
    this.avatarUrl,
    this.displayName,
    this.eventId,
    this.nip05Handle,
    required this.pubkey,
  });

  factory WebProfileView.fromJson(Map<String, dynamic> json) => WebProfileView(
    about: json["about"],
    avatarMediaPaths: Map.from(
      json["avatarMediaPaths"],
    ).map((k, v) => MapEntry<String, String>(k, v)),
    avatarUrl: json["avatarUrl"],
    displayName: json["displayName"],
    eventId: json["eventId"],
    nip05Handle: json["nip05Handle"],
    pubkey: json["pubkey"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "about": about,
    "avatarMediaPaths": Map.from(
      avatarMediaPaths,
    ).map((k, v) => MapEntry<String, dynamic>(k, v)),
    "avatarUrl": avatarUrl,
    "displayName": displayName,
    "eventId": eventId,
    "nip05Handle": nip05Handle,
    "pubkey": pubkey,
  });
}

///原 Buzz 线程分页的复合游标；下一请求以 before=createdAt、beforeId=eventId 原样提交，避免同秒回复丢失。
class WebMessageCursor {
  final int createdAt;
  final String eventId;

  WebMessageCursor({required this.createdAt, required this.eventId});

  factory WebMessageCursor.fromJson(Map<String, dynamic> json) =>
      WebMessageCursor(createdAt: json["createdAt"], eventId: json["eventId"]);

  Map<String, dynamic> toJson() =>
      _stripNulls({"createdAt": createdAt, "eventId": eventId});
}

///同一已准入 Channel 的原生消息分页或线程读取。before/beforeId 必须成对，频道窗口向前翻历史，线程沿原 Relay
///协议向后读回复；上界来自运行时配置与原协议上界，不接受任意 Relay filter。
class WebMessageQuery {
  ///原 Inbox Agents：仅 Workspace 内读取本人拥有且 ACTIVE 的既有安装作者消息；Core fresh read 解析其公开签名身份，不接受任意
  ///author。不得与线程读取或其他消息类型组合。
  final String? agentInstallationId;

  ///原 Inbox item 冷定位：仅在路径指定并 freshly admitted 的 Workspace/Conversation 内验证精确 Stream/Forum
  ///消息及线程祖先。不能与其他 messageType、parentEventId、agentInstallationId 或分页游标组合；不是全局 event
  ///读取或权限证明。缺省保持原窗口/线程语义。
  final String? anchorEventId;
  final int? before;
  final String? beforeId;
  final WebMessageType? messageType;
  final String? parentEventId;

  WebMessageQuery({
    this.agentInstallationId,
    this.anchorEventId,
    this.before,
    this.beforeId,
    this.messageType,
    this.parentEventId,
  });

  factory WebMessageQuery.fromJson(Map<String, dynamic> json) =>
      WebMessageQuery(
        agentInstallationId: json["agentInstallationId"],
        anchorEventId: json["anchorEventId"],
        before: json["before"],
        beforeId: json["beforeId"],
        messageType: json["messageType"] == null
            ? null
            : webMessageTypeValues.map[json["messageType"]]!,
        parentEventId: json["parentEventId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentInstallationId": agentInstallationId,
    "anchorEventId": anchorEventId,
    "before": before,
    "beforeId": beforeId,
    "messageType": webMessageTypeValues.reverse[messageType],
    "parentEventId": parentEventId,
  });
}

///原 Buzz 频道消息语义。缺省 STREAM 保持旧请求；不允许调用者提交任意事件 kind。
enum WebMessageType { FORUM_COMMENT, FORUM_POST, STREAM }

final webMessageTypeValues = EnumValues({
  "FORUM_COMMENT": WebMessageType.FORUM_COMMENT,
  "FORUM_POST": WebMessageType.FORUM_POST,
  "STREAM": WebMessageType.STREAM,
});

///DD-120: only snapshot events signed by the Relay itself whose single p tag is a requested
///pubkey bound in this Tenant. A pubkey without a fact is absent, never reported offline.
class WebPresencePage {
  final List<WebPresenceView> presences;

  WebPresencePage({required this.presences});

  factory WebPresencePage.fromJson(Map<String, dynamic> json) =>
      WebPresencePage(
        presences: List<WebPresenceView>.from(
          json["presences"].map((x) => WebPresenceView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "presences": List<dynamic>.from(presences.map((x) => x.toJson())),
  });
}

class WebPresenceView {
  final int? observedAt;
  final String pubkey;
  final WebPresenceStatus status;

  WebPresenceView({
    this.observedAt,
    required this.pubkey,
    required this.status,
  });

  factory WebPresenceView.fromJson(Map<String, dynamic> json) =>
      WebPresenceView(
        observedAt: json["observedAt"],
        pubkey: json["pubkey"],
        status: webPresenceStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "observedAt": observedAt,
    "pubkey": pubkey,
    "status": webPresenceStatusValues.reverse[status],
  });
}

enum WebPresenceStatus { AWAY, OFFLINE, ONLINE }

final webPresenceStatusValues = EnumValues({
  "away": WebPresenceStatus.AWAY,
  "offline": WebPresenceStatus.OFFLINE,
  "online": WebPresenceStatus.ONLINE,
});

///DD-120: presence for the requested pubkeys from the Relay-signed 20001 snapshot.
class WebPresenceQueryRequest {
  final List<String> pubkeys;

  WebPresenceQueryRequest({required this.pubkeys});

  factory WebPresenceQueryRequest.fromJson(Map<String, dynamic> json) =>
      WebPresenceQueryRequest(
        pubkeys: List<String>.from(json["pubkeys"].map((x) => x)),
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"pubkeys": List<dynamic>.from(pubkeys.map((x) => x))});
}

///DD-120: the person's own presence heartbeat or manual choice. Core signs the original
///kind 20001 with the person's SERVER key over the existing NIP-42 session connection;
///latest wins, not stored, never reconciled by event ID. offline releases the presence
///lease.
class WebPresenceUpdateRequest {
  final WebPresenceStatus status;

  WebPresenceUpdateRequest({required this.status});

  factory WebPresenceUpdateRequest.fromJson(Map<String, dynamic> json) =>
      WebPresenceUpdateRequest(
        status: webPresenceStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"status": webPresenceStatusValues.reverse[status]});
}

///Own Buzz kind:0 metadata. The authenticated host chooses the signer and Tenant; no raw
///event, author, relay URL or management tags are accepted. Omitted fields are preserved;
///empty strings explicitly clear a field.
class WebProfileUpdateRequest {
  final String? about;
  final String? avatarUrl;
  final String? displayName;

  ///Read snapshot guard only. Core derives the signer from the active identity; a mismatch
  ///rejects without publication.
  final String expectedPubkey;
  final String idempotencyKey;
  final String? nip05Handle;

  WebProfileUpdateRequest({
    this.about,
    this.avatarUrl,
    this.displayName,
    required this.expectedPubkey,
    required this.idempotencyKey,
    this.nip05Handle,
  });

  factory WebProfileUpdateRequest.fromJson(Map<String, dynamic> json) =>
      WebProfileUpdateRequest(
        about: json["about"],
        avatarUrl: json["avatarUrl"],
        displayName: json["displayName"],
        expectedPubkey: json["expectedPubkey"],
        idempotencyKey: json["idempotencyKey"],
        nip05Handle: json["nip05Handle"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "about": about,
    "avatarUrl": avatarUrl,
    "displayName": displayName,
    "expectedPubkey": expectedPubkey,
    "idempotencyKey": idempotencyKey,
    "nip05Handle": nip05Handle,
  });
}

///Web HUMAN 的原 Buzz 消息语义输入；身份、Channel、回复祖先与 mention 公钥均由 BFF 在原 scope 中解析，不接受 raw tags 或
///signed event。
class WebPublishMessageRequest {
  ///DD-148 原 Agent 收件人栏：须为同一请求 mentionInstallationIds 的子集（否则 SCOPE_GUARD_FAILED 前的 400）；BFF
  ///排序去重并冻结于同一发布意图（幂等重放逐项比较），对其中经准入并实际投递的 Installation 的 AGENT 公钥签原版 ["mention", <pubkey>,
  ///"agent-address"] 标签，与 p 并存，只作呈现元数据，不改变通知或 agent.invoke 准入；与
  ///editEventId、deleteEventId、sendToChannelSourceEventId 互斥，私聊目标拒绝。缺省为空。
  final List<String>? addressedInstallationIds;
  final List<WebMessageAttachment>? attachments;
  final String content;

  ///删除本人原 Buzz 消息；BFF 回读当前 Channel 原事件核对本人签名身份，发原 kind 5。与
  ///editEventId、parentEventId、非空正文、附件及提及互斥；不授予 kind 9005 管理员删除权限。
  final String? deleteEventId;

  ///编辑原 Buzz 消息；BFF 回读同 Channel 原事件并核对本人签名身份，发原 kind 40003。与 parentEventId 互斥，缺省保持原新消息语义。
  final String? editEventId;

  ///DD-125(5) 原 composer 链接预览：本人经 BFF 抓取得到、尚未过期的快照 ID（至多 8 个，去重保序）。只用于新的 STREAM
  ///消息（kind:9，含线程回复）：BFF 只接受本人的快照，按原 11 元素 link-preview snapshot 标签随该消息发布并把 ID
  ///冻结在发布幂等记录；canonicalUrl 不在正文中的快照按原接收规则不签入（正文照常发布）；引用他人或已过期的快照以 TARGET_NOT_FOUND 拒绝。与
  ///suppressLinkPreviews、editEventId（原编辑不带快照）、deleteEventId、sendToChannelSourceEventId 互斥；不接受
  ///Browser 提交的原始 link-preview 标签。
  final List<String>? linkPreviewSnapshotIds;

  ///用户明确选中的本 Workspace Installation；缺省为空，BFF 排序去重并冻结于原发布幂等记录。
  final List<String>? mentionInstallationIds;

  ///原 Buzz HUMAN 提及的精确公钥；缺省为空。BFF 核对当前 Tenant、消息目的地成员及 ACTIVE 身份，排序去重冻结在原发布幂等记录；不接受 Agent
  ///公钥绕过 Installation 准入。
  final List<String>? mentionPubkeys;
  final WebMessageType? messageType;

  ///原 Relay 消息引用；BFF 在当前 Channel 回读验签并解析 NIP-10 祖先。
  final String? parentEventId;

  ///DD-125(8) 原“不邀请直接发送 / 仍然发送”：被提及但不是该 Workspace ACTIVE 成员、且本次不邀请的 HUMAN 公钥；缺省为空。只用于
  ///Workspace 的新消息（含线程回复），与 mentionPubkeys 不相交，与
  ///editEventId、deleteEventId、sendToChannelSourceEventId 互斥，私聊目标拒绝。BFF 校验每个公钥都是同 Tenant
  ///ACTIVE HUMAN Principal（TenantMembership ACTIVE）的 ACTIVE 公钥（不要求目的地成员资格，否则
  ///PERMISSION_DENIED），签原版 ["mention", <pubkey>] 引用标签，排序去重后冻结进同一发布意图（幂等重放逐项比较）；不发 p、不通知、不进入
  ///Inbox，也不授予读取或成员资格，接收方只用它解析 @名字 的显示。
  final List<String>? referenceMentionPubkeys;

  ///DD-125(1) 原“发送到频道”：当前 Channel 中一条线程回复的 Relay 事件 ID。BFF 回读该回复，要求作者为本人或本人是其 Installation
  ///owner，按原 getSendToChannelSemantics 只复制正文与 emoji/imeta/link-preview/mention
  ///标签、重算提及并排除源作者，由线程根按原截断规则生成 buzz:sent-from-thread，以本人身份发一条新的顶层 kind:9，沿 DD-81 幂等与对账。与
  ///parentEventId、editEventId、deleteEventId 互斥；content 须为空且不带附件、提及或 Installation
  ///提及——正文与标签只取自回读的源事件，不接受 Browser 提交的原始标签。
  final String? sendToChannelSourceEventId;

  ///DD-125(5) 原 link-preview none：为 true 时签发唯一的 ["link-preview", "none"] 标签，接收方不显示预览。与
  ///editEventId 同用即原“对所有人移除预览”（本人消息的 40003 编辑）。省略或 false 不加该标签。
  final bool? suppressLinkPreviews;

  WebPublishMessageRequest({
    this.addressedInstallationIds,
    this.attachments,
    required this.content,
    this.deleteEventId,
    this.editEventId,
    this.linkPreviewSnapshotIds,
    this.mentionInstallationIds,
    this.mentionPubkeys,
    this.messageType,
    this.parentEventId,
    this.referenceMentionPubkeys,
    this.sendToChannelSourceEventId,
    this.suppressLinkPreviews,
  });

  factory WebPublishMessageRequest.fromJson(
    Map<String, dynamic> json,
  ) => WebPublishMessageRequest(
    addressedInstallationIds: json["addressedInstallationIds"] == null
        ? null
        : List<String>.from(json["addressedInstallationIds"]!.map((x) => x)),
    attachments: json["attachments"] == null
        ? null
        : List<WebMessageAttachment>.from(
            json["attachments"]!.map((x) => WebMessageAttachment.fromJson(x)),
          ),
    content: json["content"],
    deleteEventId: json["deleteEventId"],
    editEventId: json["editEventId"],
    linkPreviewSnapshotIds: json["linkPreviewSnapshotIds"] == null
        ? null
        : List<String>.from(json["linkPreviewSnapshotIds"]!.map((x) => x)),
    mentionInstallationIds: json["mentionInstallationIds"] == null
        ? null
        : List<String>.from(json["mentionInstallationIds"]!.map((x) => x)),
    mentionPubkeys: json["mentionPubkeys"] == null
        ? null
        : List<String>.from(json["mentionPubkeys"]!.map((x) => x)),
    messageType: json["messageType"] == null
        ? null
        : webMessageTypeValues.map[json["messageType"]]!,
    parentEventId: json["parentEventId"],
    referenceMentionPubkeys: json["referenceMentionPubkeys"] == null
        ? null
        : List<String>.from(json["referenceMentionPubkeys"]!.map((x) => x)),
    sendToChannelSourceEventId: json["sendToChannelSourceEventId"],
    suppressLinkPreviews: json["suppressLinkPreviews"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "addressedInstallationIds": addressedInstallationIds == null
        ? null
        : List<dynamic>.from(addressedInstallationIds!.map((x) => x)),
    "attachments": attachments == null
        ? null
        : List<dynamic>.from(attachments!.map((x) => x.toJson())),
    "content": content,
    "deleteEventId": deleteEventId,
    "editEventId": editEventId,
    "linkPreviewSnapshotIds": linkPreviewSnapshotIds == null
        ? null
        : List<dynamic>.from(linkPreviewSnapshotIds!.map((x) => x)),
    "mentionInstallationIds": mentionInstallationIds == null
        ? null
        : List<dynamic>.from(mentionInstallationIds!.map((x) => x)),
    "mentionPubkeys": mentionPubkeys == null
        ? null
        : List<dynamic>.from(mentionPubkeys!.map((x) => x)),
    "messageType": webMessageTypeValues.reverse[messageType],
    "parentEventId": parentEventId,
    "referenceMentionPubkeys": referenceMentionPubkeys == null
        ? null
        : List<dynamic>.from(referenceMentionPubkeys!.map((x) => x)),
    "sendToChannelSourceEventId": sendToChannelSourceEventId,
    "suppressLinkPreviews": suppressLinkPreviews,
  });
}

///Web HUMAN 修改已准入 Workspace 对应 Channel 的原主题（DD-119、09 §3）。BFF 以本人 SERVER 身份按 DD-81 签发严格
///h+topic 两标签的 kind 9002，幂等键沿原发布的 Idempotency-Key 请求头；不接受 raw tags、signed event
///或任何管理标签。结果不明只对账不重签；已归档 Channel 不接受。
class WebPublishTopicRequest {
  ///原频道主题；空字符串清空主题，不改变频道名称、描述、TTL 或成员。
  final String topic;

  WebPublishTopicRequest({required this.topic});

  factory WebPublishTopicRequest.fromJson(Map<String, dynamic> json) =>
      WebPublishTopicRequest(topic: json["topic"]);

  Map<String, dynamic> toJson() => _stripNulls({"topic": topic});
}

///DD-39 / REQ-24：原 Buzz TopbarSearch 的语义查询。Core 以本人 SERVER 身份向原 Relay FTS 查询，只在当前已准入
///Channel/DM 范围内读取；不接受任意 Relay filter、租户或身份。页与 frame 上界来自已核验 NIP-11 和既有 BFF 配置。
class WebSearchQuery {
  final List<String>? authors;
  final String? channelId;
  final int? limit;
  final String q;
  final int? since;
  final int? until;

  WebSearchQuery({
    this.authors,
    this.channelId,
    this.limit,
    required this.q,
    this.since,
    this.until,
  });

  factory WebSearchQuery.fromJson(Map<String, dynamic> json) => WebSearchQuery(
    authors: json["authors"] == null
        ? null
        : List<String>.from(json["authors"]!.map((x) => x)),
    channelId: json["channelId"],
    limit: json["limit"],
    q: json["q"],
    since: json["since"],
    until: json["until"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "authors": authors == null
        ? null
        : List<dynamic>.from(authors!.map((x) => x)),
    "channelId": channelId,
    "limit": limit,
    "q": q,
    "since": since,
    "until": until,
  });
}

///DD-120(1)：线程内输入中提示的类型化线程引用，POST /api/v1/workspaces/{workspace_id}/typing 与
////api/v1/conversations/{conversation_id}/typing 的可选请求体；缺省请求体即主频道输入。Core 以本人 SERVER 身份签发原版
///kind 20002：唯一 h 标签取自已准入的 scope，按原 buildThreadReferenceTags 追加 e root/reply 标签；不接受 raw
///tags、频道或身份。瞬时事件最新者为准，超时不报成功也不重签。
class WebTypingRequest {
  ///原 typingParentEventId：线程面板的 thread head 事件 ID（64 位小写十六进制），成为 e reply 标签
  final String parentEventId;

  ///原 typingRootEventId：thread head 所在线程的根事件 ID；缺省或等于 parentEventId 时只发 e reply 标签
  final String? rootEventId;

  WebTypingRequest({required this.parentEventId, this.rootEventId});

  factory WebTypingRequest.fromJson(Map<String, dynamic> json) =>
      WebTypingRequest(
        parentEventId: json["parentEventId"],
        rootEventId: json["rootEventId"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"parentEventId": parentEventId, "rootEventId": rootEventId});
}

///DD-120: the latest verified 30315 per requested pubkey; empty content means cleared and
///is omitted.
class WebUserStatusPage {
  final List<WebUserStatusView> statuses;

  WebUserStatusPage({required this.statuses});

  factory WebUserStatusPage.fromJson(Map<String, dynamic> json) =>
      WebUserStatusPage(
        statuses: List<WebUserStatusView>.from(
          json["statuses"].map((x) => WebUserStatusView.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "statuses": List<dynamic>.from(statuses.map((x) => x.toJson())),
  });
}

class WebUserStatusView {
  final int createdAt;
  final String? emoji;
  final String eventId;
  final int? expiresAt;
  final String pubkey;
  final String text;

  WebUserStatusView({
    required this.createdAt,
    this.emoji,
    required this.eventId,
    this.expiresAt,
    required this.pubkey,
    required this.text,
  });

  factory WebUserStatusView.fromJson(Map<String, dynamic> json) =>
      WebUserStatusView(
        createdAt: json["createdAt"],
        emoji: json["emoji"],
        eventId: json["eventId"],
        expiresAt: json["expiresAt"],
        pubkey: json["pubkey"],
        text: json["text"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "createdAt": createdAt,
    "emoji": emoji,
    "eventId": eventId,
    "expiresAt": expiresAt,
    "pubkey": pubkey,
    "text": text,
  });
}

///DD-120: the original NIP-38 kind 30315 `d=general` statuses for the requested pubkeys.
class WebUserStatusQueryRequest {
  final List<String> pubkeys;

  WebUserStatusQueryRequest({required this.pubkeys});

  factory WebUserStatusQueryRequest.fromJson(Map<String, dynamic> json) =>
      WebUserStatusQueryRequest(
        pubkeys: List<String>.from(json["pubkeys"].map((x) => x)),
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"pubkeys": List<dynamic>.from(pubkeys.map((x) => x))});
}

///DD-120: the person's own original NIP-38 30315 (`d=general`, optional `emoji` and
///`expiration` tags), published by Core with the SERVER key under DD-81 (Idempotency-Key
///header). Empty text clears the status.
class WebUserStatusUpdateRequest {
  final String? emoji;
  final int? expiresAt;
  final String text;

  WebUserStatusUpdateRequest({this.emoji, this.expiresAt, required this.text});

  factory WebUserStatusUpdateRequest.fromJson(Map<String, dynamic> json) =>
      WebUserStatusUpdateRequest(
        emoji: json["emoji"],
        expiresAt: json["expiresAt"],
        text: json["text"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"emoji": emoji, "expiresAt": expiresAt, "text": text});
}

///POST /api/v1/workspace-activity 的回应：按请求顺序给出每个 Workspace 的原生 Channel ID 与经签名、scope
///与窗口边界核验的首页事件，语义与单个 GET /workspaces/{id}/messages 首页相同。任一项准入或核验失败即整次失败，不返回部分结果。
class WebWorkspaceActivityPage {
  final List<WebWorkspaceActivity> items;

  WebWorkspaceActivityPage({required this.items});

  factory WebWorkspaceActivityPage.fromJson(Map<String, dynamic> json) =>
      WebWorkspaceActivityPage(
        items: List<WebWorkspaceActivity>.from(
          json["items"].map((x) => WebWorkspaceActivity.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"items": List<dynamic>.from(items.map((x) => x.toJson()))});
}

class WebWorkspaceActivity {
  final String channelId;
  final List<Map<String, dynamic>> events;
  final String workspaceId;

  WebWorkspaceActivity({
    required this.channelId,
    required this.events,
    required this.workspaceId,
  });

  factory WebWorkspaceActivity.fromJson(Map<String, dynamic> json) =>
      WebWorkspaceActivity(
        channelId: json["channelId"],
        events: List<Map<String, dynamic>>.from(
          json["events"].map(
            (x) => Map.from(x).map((k, v) => MapEntry<String, dynamic>(k, v)),
          ),
        ),
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "channelId": channelId,
    "events": List<dynamic>.from(
      events.map(
        (x) => Map.from(x).map((k, v) => MapEntry<String, dynamic>(k, v)),
      ),
    ),
    "workspaceId": workspaceId,
  });
}

///POST /api/v1/workspace-activity：一次读取调用方多个已加入 Workspace 的原版频道窗口首页（侧栏最近活动与未读、Inbox
///原兴趣规则的输入），对应固定 Buzz desktop/src-tauri/src/commands/channels/fetch.rs 的批量 last-message
///查询。每项仍单独做 HUMAN 协作准入；同一请求内 Workspace 不得重复。messageType 只接受频道窗口的 STREAM 或 FORUM_POST。
class WebWorkspaceActivityQuery {
  final List<WebWorkspaceActivityTarget> items;

  WebWorkspaceActivityQuery({required this.items});

  factory WebWorkspaceActivityQuery.fromJson(Map<String, dynamic> json) =>
      WebWorkspaceActivityQuery(
        items: List<WebWorkspaceActivityTarget>.from(
          json["items"].map((x) => WebWorkspaceActivityTarget.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"items": List<dynamic>.from(items.map((x) => x.toJson()))});
}

class WebWorkspaceActivityTarget {
  final WebMessageType messageType;
  final String workspaceId;

  WebWorkspaceActivityTarget({
    required this.messageType,
    required this.workspaceId,
  });

  factory WebWorkspaceActivityTarget.fromJson(Map<String, dynamic> json) =>
      WebWorkspaceActivityTarget(
        messageType: webMessageTypeValues.map[json["messageType"]]!,
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "messageType": webMessageTypeValues.reverse[messageType],
    "workspaceId": workspaceId,
  });
}

///GET /api/v1/workspaces 回应数组的元素：调用方有 ACTIVE WorkspaceMembership 或 fresh manage 管理资格，且两侧
///binding 都 ACTIVE 的 Workspace。管理可见不代表可读取协作消息；isMember 投影真实成员事实。Workspace id 同时是其 Channel
///id（DD-80）。
class WorkspaceView {
  final String id;

  ///调用方是否有 ACTIVE WorkspaceMembership；管理资格不使该值为真。旧回应缺省表示未知，不得当作已加入频道。
  final bool? isMember;
  final String name;
  final String slug;

  ///Core 产品可见性，不从 Relay private 投影推断；旧回应可能省略。
  final WorkspaceVisibility? visibility;

  WorkspaceView({
    required this.id,
    this.isMember,
    required this.name,
    required this.slug,
    this.visibility,
  });

  factory WorkspaceView.fromJson(Map<String, dynamic> json) => WorkspaceView(
    id: json["id"],
    isMember: json["isMember"],
    name: json["name"],
    slug: json["slug"],
    visibility: json["visibility"] == null
        ? null
        : workspaceVisibilityValues.map[json["visibility"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "id": id,
    "isMember": isMember,
    "name": name,
    "slug": slug,
    "visibility": workspaceVisibilityValues.reverse[visibility],
  });
}

///GET /api/v1/workspaces/{workspaceId}/members 回应数组的元素，按人聚合（DD-77）。
class WorkspaceMemberView {
  final String displayName;
  final String principalId;

  ///此人全部 ACTIVE 的 Buzz 协议公钥：Web 一把，另加每台原生设备一把
  final List<String> pubkeys;
  final WorkspaceMembershipState state;

  WorkspaceMemberView({
    required this.displayName,
    required this.principalId,
    required this.pubkeys,
    required this.state,
  });

  factory WorkspaceMemberView.fromJson(Map<String, dynamic> json) =>
      WorkspaceMemberView(
        displayName: json["displayName"],
        principalId: json["principalId"],
        pubkeys: List<String>.from(json["pubkeys"].map((x) => x)),
        state: workspaceMembershipStateValues.map[json["state"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "displayName": displayName,
    "principalId": principalId,
    "pubkeys": List<dynamic>.from(pubkeys.map((x) => x)),
    "state": workspaceMembershipStateValues.reverse[state],
  });
}

///PUT /api/v1/user-state/workspaces/{workspaceId} 的请求体（DD-40）：该 Workspace 的收藏与静音。version
///是读到的 CollaborationUserState 版本，不符即 409；updatedAt 由 Core 用库时钟补写，不取调用方的值。
class WorkspacePreferenceRequest {
  final bool muted;
  final bool starred;
  final int version;

  WorkspacePreferenceRequest({
    required this.muted,
    required this.starred,
    required this.version,
  });

  factory WorkspacePreferenceRequest.fromJson(Map<String, dynamic> json) =>
      WorkspacePreferenceRequest(
        muted: json["muted"],
        starred: json["starred"],
        version: json["version"],
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"muted": muted, "starred": starred, "version": version});
}

///DD-49/70/71/94：Core-only签发投递。只有版本化OpenBao引用及Agent已发布JWKS文件引用，不含私钥正文。
class ActionTokenSigningDelivery {
  final String issuer;
  final String jwksFile;
  final String privateKeyField;
  final String secretAudience;
  final String secretLocator;
  final int secretVersion;
  final int tokenSeconds;

  ActionTokenSigningDelivery({
    required this.issuer,
    required this.jwksFile,
    required this.privateKeyField,
    required this.secretAudience,
    required this.secretLocator,
    required this.secretVersion,
    required this.tokenSeconds,
  });

  factory ActionTokenSigningDelivery.fromJson(Map<String, dynamic> json) =>
      ActionTokenSigningDelivery(
        issuer: json["issuer"],
        jwksFile: json["jwksFile"],
        privateKeyField: json["privateKeyField"],
        secretAudience: json["secretAudience"],
        secretLocator: json["secretLocator"],
        secretVersion: json["secretVersion"],
        tokenSeconds: json["tokenSeconds"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "issuer": issuer,
    "jwksFile": jwksFile,
    "privateKeyField": privateKeyField,
    "secretAudience": secretAudience,
    "secretLocator": secretLocator,
    "secretVersion": secretVersion,
    "tokenSeconds": tokenSeconds,
  });
}

///Installation 只取自受验签的 Invocation Session，不接受调用方目标覆盖。
class AgentMemoryEntryListInput {
  AgentMemoryEntryListInput();

  factory AgentMemoryEntryListInput.fromJson(Map<String, dynamic> json) =>
      AgentMemoryEntryListInput();

  Map<String, dynamic> toJson() => _stripNulls({});
}

///只读当前 Invocation Installation 的 cold mem entry，不接受 core 或其他 Installation。
class AgentMemoryEntryReadInput {
  final String slug;

  AgentMemoryEntryReadInput({required this.slug});

  factory AgentMemoryEntryReadInput.fromJson(Map<String, dynamic> json) =>
      AgentMemoryEntryReadInput(slug: json["slug"]);

  Map<String, dynamic> toJson() => _stripNulls({"slug": slug});
}

///DD-94部署投递面：adapter服务引用解析到固定部署产物/原生实例与受限传输。不是Catalog或业务授权。
class ApplicationAdapterDirectory {
  final List<ApplicationAdapterDelivery> adapters;

  ///受控部署事实，不是 Tool 注册表或业务授权；原生 MCP peer 不接收 ActionToken。
  final List<ApplicationProtocolPeerDelivery>? protocolPeers;

  ApplicationAdapterDirectory({required this.adapters, this.protocolPeers});

  factory ApplicationAdapterDirectory.fromJson(Map<String, dynamic> json) =>
      ApplicationAdapterDirectory(
        adapters: List<ApplicationAdapterDelivery>.from(
          json["adapters"].map((x) => ApplicationAdapterDelivery.fromJson(x)),
        ),
        protocolPeers: json["protocolPeers"] == null
            ? null
            : List<ApplicationProtocolPeerDelivery>.from(
                json["protocolPeers"]!.map(
                  (x) => ApplicationProtocolPeerDelivery.fromJson(x),
                ),
              ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "adapters": List<dynamic>.from(adapters.map((x) => x.toJson())),
    "protocolPeers": protocolPeers == null
        ? null
        : List<dynamic>.from(protocolPeers!.map((x) => x.toJson())),
  });
}

class ApplicationAdapterDelivery {
  final String actionTokenAudience;
  final String adapterServiceRef;
  final String artifactDigest;
  final String baseUrl;

  ///可选的既有原生对象受控归属证据；复用同一绑定事实结构，仅供既有resource.create核验，不授予权限或创建原生对象。无登记证据时省略，不投递空数组。
  final List<ApplicationProtocolPeerBindingDelivery>? bindings;
  final int maxResponseBytes;
  final String? mcpUrl;
  final List<ApplicationModelCredentialDelivery>? modelCredentialDeliveries;

  ///受控原生浏览器认证信任投递；IdP只认证HUMAN，不承载实例业务许可。绑定、ACTIVE成员与SpiceDB实时检查决定权限；不由请求提供issuer/subject/key
  ///URL。
  final List<ApplicationNativeHumanIdentity>? nativeHumanIdentities;
  final String nativeInstanceRef;
  final List<ApplicationSecretReader> secretReaders;
  final int timeoutSeconds;

  ApplicationAdapterDelivery({
    required this.actionTokenAudience,
    required this.adapterServiceRef,
    required this.artifactDigest,
    required this.baseUrl,
    this.bindings,
    required this.maxResponseBytes,
    this.mcpUrl,
    this.modelCredentialDeliveries,
    this.nativeHumanIdentities,
    required this.nativeInstanceRef,
    required this.secretReaders,
    required this.timeoutSeconds,
  });

  factory ApplicationAdapterDelivery.fromJson(Map<String, dynamic> json) =>
      ApplicationAdapterDelivery(
        actionTokenAudience: json["actionTokenAudience"],
        adapterServiceRef: json["adapterServiceRef"],
        artifactDigest: json["artifactDigest"],
        baseUrl: json["baseUrl"],
        bindings: json["bindings"] == null
            ? null
            : List<ApplicationProtocolPeerBindingDelivery>.from(
                json["bindings"]!.map(
                  (x) => ApplicationProtocolPeerBindingDelivery.fromJson(x),
                ),
              ),
        maxResponseBytes: json["maxResponseBytes"],
        mcpUrl: json["mcpUrl"],
        modelCredentialDeliveries: json["modelCredentialDeliveries"] == null
            ? null
            : List<ApplicationModelCredentialDelivery>.from(
                json["modelCredentialDeliveries"]!.map(
                  (x) => ApplicationModelCredentialDelivery.fromJson(x),
                ),
              ),
        nativeHumanIdentities: json["nativeHumanIdentities"] == null
            ? null
            : List<ApplicationNativeHumanIdentity>.from(
                json["nativeHumanIdentities"]!.map(
                  (x) => ApplicationNativeHumanIdentity.fromJson(x),
                ),
              ),
        nativeInstanceRef: json["nativeInstanceRef"],
        secretReaders: List<ApplicationSecretReader>.from(
          json["secretReaders"].map((x) => ApplicationSecretReader.fromJson(x)),
        ),
        timeoutSeconds: json["timeoutSeconds"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionTokenAudience": actionTokenAudience,
    "adapterServiceRef": adapterServiceRef,
    "artifactDigest": artifactDigest,
    "baseUrl": baseUrl,
    "bindings": bindings == null
        ? null
        : List<dynamic>.from(bindings!.map((x) => x.toJson())),
    "maxResponseBytes": maxResponseBytes,
    "mcpUrl": mcpUrl,
    "modelCredentialDeliveries": modelCredentialDeliveries == null
        ? null
        : List<dynamic>.from(modelCredentialDeliveries!.map((x) => x.toJson())),
    "nativeHumanIdentities": nativeHumanIdentities == null
        ? null
        : List<dynamic>.from(nativeHumanIdentities!.map((x) => x.toJson())),
    "nativeInstanceRef": nativeInstanceRef,
    "secretReaders": List<dynamic>.from(secretReaders.map((x) => x.toJson())),
    "timeoutSeconds": timeoutSeconds,
  });
}

class ApplicationProtocolPeerBindingDelivery {
  final String bindingId;
  final String configDigest;
  final int? credentialGeneration;
  final String isolationMode;

  ///原受控投递映射：无secret值；精确版本由Core以原audience读取并向Gateway独占文件投递。
  final List<ApplicationPeerCredentialDelivery>? nativeCredentials;

  ///绑定已有原生对象的受控投递事实，不创建对象或授予权限；父项唯一固定实例与作用域。
  final List<ApplicationNativeResourceDelivery>? nativeResources;
  final String nativeScopeRef;
  final String servicePrincipalId;
  final String tenantId;
  final String? workspaceId;

  ApplicationProtocolPeerBindingDelivery({
    required this.bindingId,
    required this.configDigest,
    this.credentialGeneration,
    required this.isolationMode,
    this.nativeCredentials,
    this.nativeResources,
    required this.nativeScopeRef,
    required this.servicePrincipalId,
    required this.tenantId,
    this.workspaceId,
  });

  factory ApplicationProtocolPeerBindingDelivery.fromJson(
    Map<String, dynamic> json,
  ) => ApplicationProtocolPeerBindingDelivery(
    bindingId: json["bindingId"],
    configDigest: json["configDigest"],
    credentialGeneration: json["credentialGeneration"],
    isolationMode: json["isolationMode"],
    nativeCredentials: json["nativeCredentials"] == null
        ? null
        : List<ApplicationPeerCredentialDelivery>.from(
            json["nativeCredentials"]!.map(
              (x) => ApplicationPeerCredentialDelivery.fromJson(x),
            ),
          ),
    nativeResources: json["nativeResources"] == null
        ? null
        : List<ApplicationNativeResourceDelivery>.from(
            json["nativeResources"]!.map(
              (x) => ApplicationNativeResourceDelivery.fromJson(x),
            ),
          ),
    nativeScopeRef: json["nativeScopeRef"],
    servicePrincipalId: json["servicePrincipalId"],
    tenantId: json["tenantId"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "configDigest": configDigest,
    "credentialGeneration": credentialGeneration,
    "isolationMode": isolationMode,
    "nativeCredentials": nativeCredentials == null
        ? null
        : List<dynamic>.from(nativeCredentials!.map((x) => x.toJson())),
    "nativeResources": nativeResources == null
        ? null
        : List<dynamic>.from(nativeResources!.map((x) => x.toJson())),
    "nativeScopeRef": nativeScopeRef,
    "servicePrincipalId": servicePrincipalId,
    "tenantId": tenantId,
    "workspaceId": workspaceId,
  });
}

class ApplicationPeerCredentialDelivery {
  final String audience;
  final String header;
  final String locator;
  final String prefix;
  final String secretKey;
  final int version;

  ApplicationPeerCredentialDelivery({
    required this.audience,
    required this.header,
    required this.locator,
    required this.prefix,
    required this.secretKey,
    required this.version,
  });

  factory ApplicationPeerCredentialDelivery.fromJson(
    Map<String, dynamic> json,
  ) => ApplicationPeerCredentialDelivery(
    audience: json["audience"],
    header: json["header"],
    locator: json["locator"],
    prefix: json["prefix"],
    secretKey: json["secretKey"],
    version: json["version"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "audience": audience,
    "header": header,
    "locator": locator,
    "prefix": prefix,
    "secretKey": secretKey,
    "version": version,
  });
}

class ApplicationNativeResourceDelivery {
  final String evidenceDigest;
  final String evidenceRef;
  final String nativeRef;
  final String nativeType;
  final String typeKey;

  ApplicationNativeResourceDelivery({
    required this.evidenceDigest,
    required this.evidenceRef,
    required this.nativeRef,
    required this.nativeType,
    required this.typeKey,
  });

  factory ApplicationNativeResourceDelivery.fromJson(
    Map<String, dynamic> json,
  ) => ApplicationNativeResourceDelivery(
    evidenceDigest: json["evidenceDigest"],
    evidenceRef: json["evidenceRef"],
    nativeRef: json["nativeRef"],
    nativeType: json["nativeType"],
    typeKey: json["typeKey"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "evidenceDigest": evidenceDigest,
    "evidenceRef": evidenceRef,
    "nativeRef": nativeRef,
    "nativeType": nativeType,
    "typeKey": typeKey,
  });
}

///受控原生模型凭据交接回执；无密钥值，不创建模型，不替代OpenBao审计或binding准入。
class ApplicationModelCredentialDelivery {
  final String bindingId;
  final String configDigest;
  final int generation;
  final String nativeModelRef;
  final String nativeProof;
  final String nativeScopeRef;
  final String requestId;
  final String routeResourceId;
  final ApplicationModelServiceSecretRef secretRef;
  final String servicePrincipalId;
  final String verificationNonce;

  ApplicationModelCredentialDelivery({
    required this.bindingId,
    required this.configDigest,
    required this.generation,
    required this.nativeModelRef,
    required this.nativeProof,
    required this.nativeScopeRef,
    required this.requestId,
    required this.routeResourceId,
    required this.secretRef,
    required this.servicePrincipalId,
    required this.verificationNonce,
  });

  factory ApplicationModelCredentialDelivery.fromJson(
    Map<String, dynamic> json,
  ) => ApplicationModelCredentialDelivery(
    bindingId: json["bindingId"],
    configDigest: json["configDigest"],
    generation: json["generation"],
    nativeModelRef: json["nativeModelRef"],
    nativeProof: json["nativeProof"],
    nativeScopeRef: json["nativeScopeRef"],
    requestId: json["requestId"],
    routeResourceId: json["routeResourceId"],
    secretRef: ApplicationModelServiceSecretRef.fromJson(json["secretRef"]),
    servicePrincipalId: json["servicePrincipalId"],
    verificationNonce: json["verificationNonce"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "configDigest": configDigest,
    "generation": generation,
    "nativeModelRef": nativeModelRef,
    "nativeProof": nativeProof,
    "nativeScopeRef": nativeScopeRef,
    "requestId": requestId,
    "routeResourceId": routeResourceId,
    "secretRef": secretRef.toJson(),
    "servicePrincipalId": servicePrincipalId,
    "verificationNonce": verificationNonce,
  });
}

class ApplicationModelServiceSecretRef {
  final String audience;
  final String locator;
  final int version;

  ApplicationModelServiceSecretRef({
    required this.audience,
    required this.locator,
    required this.version,
  });

  factory ApplicationModelServiceSecretRef.fromJson(
    Map<String, dynamic> json,
  ) => ApplicationModelServiceSecretRef(
    audience: json["audience"],
    locator: json["locator"],
    version: json["version"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "audience": audience,
    "locator": locator,
    "version": version,
  });
}

class ApplicationNativeHumanIdentity {
  final String audience;
  final String bindingId;
  final String configDigest;
  final int generation;
  final String identityProviderId;
  final String jwksFile;

  ApplicationNativeHumanIdentity({
    required this.audience,
    required this.bindingId,
    required this.configDigest,
    required this.generation,
    required this.identityProviderId,
    required this.jwksFile,
  });

  factory ApplicationNativeHumanIdentity.fromJson(Map<String, dynamic> json) =>
      ApplicationNativeHumanIdentity(
        audience: json["audience"],
        bindingId: json["bindingId"],
        configDigest: json["configDigest"],
        generation: json["generation"],
        identityProviderId: json["identityProviderId"],
        jwksFile: json["jwksFile"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "audience": audience,
    "bindingId": bindingId,
    "configDigest": configDigest,
    "generation": generation,
    "identityProviderId": identityProviderId,
    "jwksFile": jwksFile,
  });
}

class ApplicationSecretReader {
  final String audience;
  final String roleName;
  final String servicePrincipalId;

  ApplicationSecretReader({
    required this.audience,
    required this.roleName,
    required this.servicePrincipalId,
  });

  factory ApplicationSecretReader.fromJson(Map<String, dynamic> json) =>
      ApplicationSecretReader(
        audience: json["audience"],
        roleName: json["roleName"],
        servicePrincipalId: json["servicePrincipalId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "audience": audience,
    "roleName": roleName,
    "servicePrincipalId": servicePrincipalId,
  });
}

class ApplicationProtocolPeerDelivery {
  final String adapterServiceRef;
  final String artifactDigest;
  final List<ApplicationProtocolPeerBindingDelivery> bindings;
  final int maxResponseBytes;
  final String mcpUrl;
  final List<ApplicationModelCredentialDelivery>? modelCredentialDeliveries;
  final String nativeInstanceRef;
  final List<ApplicationSecretReader>? secretReaders;
  final int timeoutSeconds;

  ApplicationProtocolPeerDelivery({
    required this.adapterServiceRef,
    required this.artifactDigest,
    required this.bindings,
    required this.maxResponseBytes,
    required this.mcpUrl,
    this.modelCredentialDeliveries,
    required this.nativeInstanceRef,
    this.secretReaders,
    required this.timeoutSeconds,
  });

  factory ApplicationProtocolPeerDelivery.fromJson(Map<String, dynamic> json) =>
      ApplicationProtocolPeerDelivery(
        adapterServiceRef: json["adapterServiceRef"],
        artifactDigest: json["artifactDigest"],
        bindings: List<ApplicationProtocolPeerBindingDelivery>.from(
          json["bindings"].map(
            (x) => ApplicationProtocolPeerBindingDelivery.fromJson(x),
          ),
        ),
        maxResponseBytes: json["maxResponseBytes"],
        mcpUrl: json["mcpUrl"],
        modelCredentialDeliveries: json["modelCredentialDeliveries"] == null
            ? null
            : List<ApplicationModelCredentialDelivery>.from(
                json["modelCredentialDeliveries"]!.map(
                  (x) => ApplicationModelCredentialDelivery.fromJson(x),
                ),
              ),
        nativeInstanceRef: json["nativeInstanceRef"],
        secretReaders: json["secretReaders"] == null
            ? null
            : List<ApplicationSecretReader>.from(
                json["secretReaders"]!.map(
                  (x) => ApplicationSecretReader.fromJson(x),
                ),
              ),
        timeoutSeconds: json["timeoutSeconds"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "adapterServiceRef": adapterServiceRef,
    "artifactDigest": artifactDigest,
    "bindings": List<dynamic>.from(bindings.map((x) => x.toJson())),
    "maxResponseBytes": maxResponseBytes,
    "mcpUrl": mcpUrl,
    "modelCredentialDeliveries": modelCredentialDeliveries == null
        ? null
        : List<dynamic>.from(modelCredentialDeliveries!.map((x) => x.toJson())),
    "nativeInstanceRef": nativeInstanceRef,
    "secretReaders": secretReaders == null
        ? null
        : List<dynamic>.from(secretReaders!.map((x) => x.toJson())),
    "timeoutSeconds": timeoutSeconds,
  });
}

///DD-92: modelGateway within the approved binding config. Only existing route and meter
///references; no provider configuration, credential value or native model row.
class ApplicationModelGatewayConfig {
  final List<String> meterKeys;
  final List<String> routeResourceIds;

  ApplicationModelGatewayConfig({
    required this.meterKeys,
    required this.routeResourceIds,
  });

  factory ApplicationModelGatewayConfig.fromJson(Map<String, dynamic> json) =>
      ApplicationModelGatewayConfig(
        meterKeys: List<String>.from(json["meterKeys"].map((x) => x)),
        routeResourceIds: List<String>.from(
          json["routeResourceIds"].map((x) => x),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "meterKeys": List<dynamic>.from(meterKeys.map((x) => x)),
    "routeResourceIds": List<dynamic>.from(routeResourceIds.map((x) => x)),
  });
}

///DD-102 / ADR-12：能力契约固定的机器向量。每个 case 按 steps 顺序执行契约操作，参数与预期结果是实际
///JSON，不执行文本代码。格式有效不表示组件套件通过；线协议性质、真实执行与 release 证据关联另行核验。DD-124：V2 的每个值只来自
///LITERAL、PRECONDITION 或 CAPTURE；generatedRefs、preconditionKinds、preconditions、bindings 与
///captures 只属于 V2，V1 仍按原规则执行。
class CapabilityConformanceVectors {
  final List<CapabilityConformanceVectorsCasesItem> cases;
  final CapabilityVectorFormat formatVersion;

  ///V2 only. Contract fields whose values the implementation generates (opaque non-empty
  ///strings). nativeRevision is always implementation-generated and need not be listed. A
  ///listed position present in a step document may never be LITERAL; EXPECTED entries are the
  ///only output fields a GENERATED_REF capture of a FORWARD step may read. A step of a
  ///RECEIVER case is not sent by the production Core: its input is the admission the isolated
  ///Core produced, so a GENERATED_REF capture of that step reads an INPUT entry of its own
  ///contract key.
  final List<CapabilityVectorGeneratedRef>? generatedRefs;

  ///V2 only. Closed list of native object kinds a case may declare as preconditions and the
  ///properties each must verify by a literal expectation.
  final List<CapabilityVectorPreconditionKind>? preconditionKinds;

  CapabilityConformanceVectors({
    required this.cases,
    required this.formatVersion,
    this.generatedRefs,
    this.preconditionKinds,
  });

  factory CapabilityConformanceVectors.fromJson(Map<String, dynamic> json) =>
      CapabilityConformanceVectors(
        cases: List<CapabilityConformanceVectorsCasesItem>.from(
          json["cases"].map(
            (x) => CapabilityConformanceVectorsCasesItem.fromJson(x),
          ),
        ),
        formatVersion: capabilityVectorFormatValues.map[json["formatVersion"]]!,
        generatedRefs: json["generatedRefs"] == null
            ? null
            : List<CapabilityVectorGeneratedRef>.from(
                json["generatedRefs"]!.map(
                  (x) => CapabilityVectorGeneratedRef.fromJson(x),
                ),
              ),
        preconditionKinds: json["preconditionKinds"] == null
            ? null
            : List<CapabilityVectorPreconditionKind>.from(
                json["preconditionKinds"]!.map(
                  (x) => CapabilityVectorPreconditionKind.fromJson(x),
                ),
              ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "cases": List<dynamic>.from(cases.map((x) => x.toJson())),
    "formatVersion": capabilityVectorFormatValues.reverse[formatVersion],
    "generatedRefs": generatedRefs == null
        ? null
        : List<dynamic>.from(generatedRefs!.map((x) => x.toJson())),
    "preconditionKinds": preconditionKinds == null
        ? null
        : List<dynamic>.from(preconditionKinds!.map((x) => x.toJson())),
  });
}

class CapabilityConformanceVectorsCasesItem {
  final String caseKey;

  ///V2 only; absent means FORWARD. A RECEIVER case (DD-124(3)(4)) runs entirely in the
  ///isolated deployment; the production plan observes each of its steps only through
  ///receiver_start/receiver_observe and accepts the isolated Core's execution and operation
  ///ids, both read_receipts, native batch or execution and native terminal evidence, never
  ///business results: every step names the receiver Resource by referenceResourceKey and
  ///expects {}. Every platform Resource id of the case, typed or a
  ///resourceId/sourceResourceId/assetId member of a step document, is a PRECONDITION. A step
  ///input is the admission the isolated Core performs: it may bind the step's own
  ///ACTION_EXECUTION_ID, OPERATION_ID or GENERATED_REF captures and earlier steps' captures,
  ///which the isolated deployment supplies from its own run. The case as a whole carries the
  ///source reads; Core compares a step's input with the admission whenever its evidence has
  ///reads.
  final CapabilityVectorCaseDirection? direction;

  ///V2 only. Native objects the isolated fixture creates through the candidate's own native
  ///entry before the run; the fixture supplies only their actual identifiers. Every
  ///registered property of the kind is declared with its literal value and verified by a
  ///later literal expectation of this case; in a RECEIVER case, whose expectations are {}, by
  ///a literal member of a later step input, which Core compares with the isolated admission.
  final List<CapabilityVectorPrecondition>? preconditions;
  final List<CapabilityConformanceVectorsCasesItemStepsItem> steps;

  CapabilityConformanceVectorsCasesItem({
    required this.caseKey,
    this.direction,
    this.preconditions,
    required this.steps,
  });

  factory CapabilityConformanceVectorsCasesItem.fromJson(
    Map<String, dynamic> json,
  ) => CapabilityConformanceVectorsCasesItem(
    caseKey: json["caseKey"],
    direction: json["direction"] == null
        ? null
        : capabilityVectorCaseDirectionValues.map[json["direction"]]!,
    preconditions: json["preconditions"] == null
        ? null
        : List<CapabilityVectorPrecondition>.from(
            json["preconditions"]!.map(
              (x) => CapabilityVectorPrecondition.fromJson(x),
            ),
          ),
    steps: List<CapabilityConformanceVectorsCasesItemStepsItem>.from(
      json["steps"].map(
        (x) => CapabilityConformanceVectorsCasesItemStepsItem.fromJson(x),
      ),
    ),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "caseKey": caseKey,
    "direction": capabilityVectorCaseDirectionValues.reverse[direction],
    "preconditions": preconditions == null
        ? null
        : List<dynamic>.from(preconditions!.map((x) => x.toJson())),
    "steps": List<dynamic>.from(steps.map((x) => x.toJson())),
  });
}

///V2 only; absent means FORWARD. A RECEIVER case (DD-124(3)(4)) runs entirely in the
///isolated deployment; the production plan observes each of its steps only through
///receiver_start/receiver_observe and accepts the isolated Core's execution and operation
///ids, both read_receipts, native batch or execution and native terminal evidence, never
///business results: every step names the receiver Resource by referenceResourceKey and
///expects {}. Every platform Resource id of the case, typed or a
///resourceId/sourceResourceId/assetId member of a step document, is a PRECONDITION. A step
///input is the admission the isolated Core performs: it may bind the step's own
///ACTION_EXECUTION_ID, OPERATION_ID or GENERATED_REF captures and earlier steps' captures,
///which the isolated deployment supplies from its own run. The case as a whole carries the
///source reads; Core compares a step's input with the admission whenever its evidence has
///reads.
///
///DD-124(3)(4): the direction of a whole V2 case. FORWARD cases are driven by the
///production Core probe execute. RECEIVER marks a case that depends on the service read
///edge (an ingest consuming a source through READ_EDGE, a NATIVE_MANAGED receiver key):
///every step of it runs in the isolated deployment of 07 §8A and the production plan only
///observes each step through receiver_start/receiver_observe; steps are never split between
///the directions.
enum CapabilityVectorCaseDirection { FORWARD, RECEIVER }

final capabilityVectorCaseDirectionValues = EnumValues({
  "FORWARD": CapabilityVectorCaseDirection.FORWARD,
  "RECEIVER": CapabilityVectorCaseDirection.RECEIVER,
});

class CapabilityVectorPrecondition {
  final String key;
  final String kind;
  final List<CapabilityVectorPreconditionProperty> properties;

  CapabilityVectorPrecondition({
    required this.key,
    required this.kind,
    required this.properties,
  });

  factory CapabilityVectorPrecondition.fromJson(Map<String, dynamic> json) =>
      CapabilityVectorPrecondition(
        key: json["key"],
        kind: json["kind"],
        properties: List<CapabilityVectorPreconditionProperty>.from(
          json["properties"].map(
            (x) => CapabilityVectorPreconditionProperty.fromJson(x),
          ),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "key": key,
    "kind": kind,
    "properties": List<dynamic>.from(properties.map((x) => x.toJson())),
  });
}

class CapabilityVectorPreconditionProperty {
  final String name;
  final String valueJson;

  CapabilityVectorPreconditionProperty({
    required this.name,
    required this.valueJson,
  });

  factory CapabilityVectorPreconditionProperty.fromJson(
    Map<String, dynamic> json,
  ) => CapabilityVectorPreconditionProperty(
    name: json["name"],
    valueJson: json["valueJson"],
  );

  Map<String, dynamic> toJson() =>
      _stripNulls({"name": name, "valueJson": valueJson});
}

class CapabilityConformanceVectorsCasesItemStepsItem {
  ///V2 only. Every reserved placeholder in inputJson/expectedOutputJson is declared here
  ///exactly once.
  final List<CapabilityVectorBinding>? bindings;

  ///V2 only. Values this step's SUCCEEDED observation with complete native terminal evidence
  ///provides to later steps.
  final List<CapabilityVectorCapture>? captures;
  final String contractKey;
  final String expectedOutputJson;
  final String inputJson;
  final String? referenceAssetId;

  ///V1 only. 只引用同 case 已成功的更早 stepKey 的唯一 typed ContentReference；不得指定 JSON 路径或表达式。与固定
  ///Resource/Asset 目标一起进入规范化参数 hash。
  final String? referenceFromStepKey;

  ///Literal platform Resource id of the step target. DD-124(4): a RECEIVER case never names a
  ///platform Resource by literal; it uses referenceResourceKey.
  final String? referenceResourceId;

  ///V2 only. Key of a PRECONDITION of this case whose fixture value is the step's reference
  ///Resource id; Core freezes that value into the plan step's referenceResourceId. DD-124(4):
  ///in a receiver-direction case it is the id the isolated Core's real resource.create (DD-98
  ///existing native reference) returned. Mutually exclusive with referenceResourceId,
  ///referenceAssetId and referenceFromStepKey; it counts as this step sending that
  ///precondition.
  final String? referenceResourceKey;
  final String stepKey;

  CapabilityConformanceVectorsCasesItemStepsItem({
    this.bindings,
    this.captures,
    required this.contractKey,
    required this.expectedOutputJson,
    required this.inputJson,
    this.referenceAssetId,
    this.referenceFromStepKey,
    this.referenceResourceId,
    this.referenceResourceKey,
    required this.stepKey,
  });

  factory CapabilityConformanceVectorsCasesItemStepsItem.fromJson(
    Map<String, dynamic> json,
  ) => CapabilityConformanceVectorsCasesItemStepsItem(
    bindings: json["bindings"] == null
        ? null
        : List<CapabilityVectorBinding>.from(
            json["bindings"]!.map((x) => CapabilityVectorBinding.fromJson(x)),
          ),
    captures: json["captures"] == null
        ? null
        : List<CapabilityVectorCapture>.from(
            json["captures"]!.map((x) => CapabilityVectorCapture.fromJson(x)),
          ),
    contractKey: json["contractKey"],
    expectedOutputJson: json["expectedOutputJson"],
    inputJson: json["inputJson"],
    referenceAssetId: json["referenceAssetId"],
    referenceFromStepKey: json["referenceFromStepKey"],
    referenceResourceId: json["referenceResourceId"],
    referenceResourceKey: json["referenceResourceKey"],
    stepKey: json["stepKey"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindings": bindings == null
        ? null
        : List<dynamic>.from(bindings!.map((x) => x.toJson())),
    "captures": captures == null
        ? null
        : List<dynamic>.from(captures!.map((x) => x.toJson())),
    "contractKey": contractKey,
    "expectedOutputJson": expectedOutputJson,
    "inputJson": inputJson,
    "referenceAssetId": referenceAssetId,
    "referenceFromStepKey": referenceFromStepKey,
    "referenceResourceId": referenceResourceId,
    "referenceResourceKey": referenceResourceKey,
    "stepKey": stepKey,
  });
}

enum CapabilityVectorFormat { V1, V2 }

final capabilityVectorFormatValues = EnumValues({
  "V1": CapabilityVectorFormat.V1,
  "V2": CapabilityVectorFormat.V2,
});

class CapabilityVectorGeneratedRef {
  final String contractKey;
  final String pointer;
  final CapabilityVectorSide side;

  CapabilityVectorGeneratedRef({
    required this.contractKey,
    required this.pointer,
    required this.side,
  });

  factory CapabilityVectorGeneratedRef.fromJson(Map<String, dynamic> json) =>
      CapabilityVectorGeneratedRef(
        contractKey: json["contractKey"],
        pointer: json["pointer"],
        side: capabilityVectorSideValues.map[json["side"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "contractKey": contractKey,
    "pointer": pointer,
    "side": capabilityVectorSideValues.reverse[side],
  });
}

class CapabilityVectorPreconditionKind {
  final String description;
  final String kind;
  final List<String> properties;

  CapabilityVectorPreconditionKind({
    required this.description,
    required this.kind,
    required this.properties,
  });

  factory CapabilityVectorPreconditionKind.fromJson(
    Map<String, dynamic> json,
  ) => CapabilityVectorPreconditionKind(
    description: json["description"],
    kind: json["kind"],
    properties: List<String>.from(json["properties"].map((x) => x)),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "description": description,
    "kind": kind,
    "properties": List<dynamic>.from(properties.map((x) => x)),
  });
}

///07§8A 的隔离环境投递配置，不是 Catalog/binding 权威。由运维配置精确绑定已装载候选 artifact；逐次短期模拟 token 仅由 Core
///对实际请求签发，不接受静态凭据文件或用户 action 自报地址。
class ComponentConformanceEnvironment {
  final String adapterBaseUrl;
  final String artifactDigest;
  final int maxResponseBytes;
  final int maxSteps;

  ///仅隔离原生接收方套件：原 receiver ServicePrincipal 的受控 OIDC 投递，逐 binding/generation 选择；不是生产绑定注册表，不转发
  ///Worker 的平台 bearer。
  final List<ComponentNativeReadAuthority>? nativeReadAuthorities;

  ///DD-124(4)：仅隔离部署内 APPLICATION 接收方动作（省略 importConfigRef 的
  ///receiver_start/receiver_observe）。平台维护的隔离部署入口 origin，不是候选 adapter；它以隔离 HUMAN 经隔离 Core 原
  ///Action Admission 准入与派发并观察该动作。
  final String? receiverActionBaseUrl;

  ComponentConformanceEnvironment({
    required this.adapterBaseUrl,
    required this.artifactDigest,
    required this.maxResponseBytes,
    required this.maxSteps,
    this.nativeReadAuthorities,
    this.receiverActionBaseUrl,
  });

  factory ComponentConformanceEnvironment.fromJson(Map<String, dynamic> json) =>
      ComponentConformanceEnvironment(
        adapterBaseUrl: json["adapterBaseUrl"],
        artifactDigest: json["artifactDigest"],
        maxResponseBytes: json["maxResponseBytes"],
        maxSteps: json["maxSteps"],
        nativeReadAuthorities: json["nativeReadAuthorities"] == null
            ? null
            : List<ComponentNativeReadAuthority>.from(
                json["nativeReadAuthorities"]!.map(
                  (x) => ComponentNativeReadAuthority.fromJson(x),
                ),
              ),
        receiverActionBaseUrl: json["receiverActionBaseUrl"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "adapterBaseUrl": adapterBaseUrl,
    "artifactDigest": artifactDigest,
    "maxResponseBytes": maxResponseBytes,
    "maxSteps": maxSteps,
    "nativeReadAuthorities": nativeReadAuthorities == null
        ? null
        : List<dynamic>.from(nativeReadAuthorities!.map((x) => x.toJson())),
    "receiverActionBaseUrl": receiverActionBaseUrl,
  });
}

class ComponentNativeReadAuthority {
  final String bindingId;
  final String coreBaseUrl;
  final int generation;
  final String oidcClientId;
  final String oidcClientSecretFile;
  final String oidcTokenUrl;

  ComponentNativeReadAuthority({
    required this.bindingId,
    required this.coreBaseUrl,
    required this.generation,
    required this.oidcClientId,
    required this.oidcClientSecretFile,
    required this.oidcTokenUrl,
  });

  factory ComponentNativeReadAuthority.fromJson(Map<String, dynamic> json) =>
      ComponentNativeReadAuthority(
        bindingId: json["bindingId"],
        coreBaseUrl: json["coreBaseUrl"],
        generation: json["generation"],
        oidcClientId: json["oidcClientId"],
        oidcClientSecretFile: json["oidcClientSecretFile"],
        oidcTokenUrl: json["oidcTokenUrl"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "coreBaseUrl": coreBaseUrl,
    "generation": generation,
    "oidcClientId": oidcClientId,
    "oidcClientSecretFile": oidcClientSecretFile,
    "oidcTokenUrl": oidcTokenUrl,
  });
}

///隔离开发环境受控投递的协议夹具数据，不来自登记请求。Core 只采用固定协议用例并核对全部必需覆盖；没有脚本、条件、路径表达式或通过声明。
class ComponentConformanceFixture {
  final String artifactDigest;

  ///接收方向步骤（V1 NATIVE_INTERNAL/NATIVE 契约步骤，V2 direction=RECEIVER case 的每个步骤）各恰一项的冻结接收方请求；Core
  ///以计划步骤幂等键替换 idempotencyKey。DD-124(4)：NATIVE_MANAGED 键的请求携带与已代入向量输入一致的
  ///importConfigRef；APPLICATION 接收方动作省略它。请求只是隔离部署内的启动/观察引用，不含任何执行、operation 或批次标识。
  final List<ComponentNativeReceiverFixture>? nativeReceivers;

  ///DD-124(1)：V2 契约 case 声明的前置原生对象取值。只能是候选实现原生入口创建时实际返回的标识（接收方向 case 的平台 Resource 前置值为隔离 Core
  ///经真实 resource.create 登记既有原生引用后返回的 Resource ID，DD-124(4)）；Core
  ///在冻结计划时代入，并核对每个声明恰有一个取值。不是期望值来源。
  final List<ComponentConformancePreconditionValue>? preconditions;
  final List<ComponentConformanceStep> steps;

  ComponentConformanceFixture({
    required this.artifactDigest,
    this.nativeReceivers,
    this.preconditions,
    required this.steps,
  });

  factory ComponentConformanceFixture.fromJson(Map<String, dynamic> json) =>
      ComponentConformanceFixture(
        artifactDigest: json["artifactDigest"],
        nativeReceivers: json["nativeReceivers"] == null
            ? null
            : List<ComponentNativeReceiverFixture>.from(
                json["nativeReceivers"]!.map(
                  (x) => ComponentNativeReceiverFixture.fromJson(x),
                ),
              ),
        preconditions: json["preconditions"] == null
            ? null
            : List<ComponentConformancePreconditionValue>.from(
                json["preconditions"]!.map(
                  (x) => ComponentConformancePreconditionValue.fromJson(x),
                ),
              ),
        steps: List<ComponentConformanceStep>.from(
          json["steps"].map((x) => ComponentConformanceStep.fromJson(x)),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "artifactDigest": artifactDigest,
    "nativeReceivers": nativeReceivers == null
        ? null
        : List<dynamic>.from(nativeReceivers!.map((x) => x.toJson())),
    "preconditions": preconditions == null
        ? null
        : List<dynamic>.from(preconditions!.map((x) => x.toJson())),
    "steps": List<dynamic>.from(steps.map((x) => x.toJson())),
  });
}

class ComponentNativeReceiverFixture {
  final String caseKey;
  final String contractKey;
  final ComponentNativeReceiverRequest request;
  final String stepKey;

  ComponentNativeReceiverFixture({
    required this.caseKey,
    required this.contractKey,
    required this.request,
    required this.stepKey,
  });

  factory ComponentNativeReceiverFixture.fromJson(Map<String, dynamic> json) =>
      ComponentNativeReceiverFixture(
        caseKey: json["caseKey"],
        contractKey: json["contractKey"],
        request: ComponentNativeReceiverRequest.fromJson(json["request"]),
        stepKey: json["stepKey"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "caseKey": caseKey,
    "contractKey": contractKey,
    "request": request.toJson(),
    "stepKey": stepKey,
  });
}

class ComponentConformancePreconditionValue {
  ///计划内 case 键 <categoryKey>:<contractVersion>:<caseKey>。
  final String caseKey;
  final String key;
  final String value;

  ComponentConformancePreconditionValue({
    required this.caseKey,
    required this.key,
    required this.value,
  });

  factory ComponentConformancePreconditionValue.fromJson(
    Map<String, dynamic> json,
  ) => ComponentConformancePreconditionValue(
    caseKey: json["caseKey"],
    key: json["key"],
    value: json["value"],
  );

  Map<String, dynamic> toJson() =>
      _stripNulls({"caseKey": caseKey, "key": key, "value": value});
}

///仅用于07§8A隔离套件的模拟上下文投递。不是生产 Catalog、Delegation 或
///ResultExposurePolicy。独立密钥/issuer/audience；其完整摘要固定在原登记计划。
class ComponentConformanceIdentity {
  final String artifactDigest;
  final String audience;
  final List<ComponentConformanceIdentityContext> contexts;
  final String issuer;
  final String jwksFile;
  final String privateKeyField;

  ///DD-124(4)：计划含 receiver_start/receiver_observe 步骤时必填；固定隔离接收方部署的 Core 构建与来源
  ///release，随身份摘要进入原计划。
  final ComponentConformanceReceiverEnvironment? receiverEnvironment;
  final String secretAudience;
  final String secretLocator;
  final int secretVersion;
  final int tokenSeconds;

  ComponentConformanceIdentity({
    required this.artifactDigest,
    required this.audience,
    required this.contexts,
    required this.issuer,
    required this.jwksFile,
    required this.privateKeyField,
    this.receiverEnvironment,
    required this.secretAudience,
    required this.secretLocator,
    required this.secretVersion,
    required this.tokenSeconds,
  });

  factory ComponentConformanceIdentity.fromJson(Map<String, dynamic> json) =>
      ComponentConformanceIdentity(
        artifactDigest: json["artifactDigest"],
        audience: json["audience"],
        contexts: List<ComponentConformanceIdentityContext>.from(
          json["contexts"].map(
            (x) => ComponentConformanceIdentityContext.fromJson(x),
          ),
        ),
        issuer: json["issuer"],
        jwksFile: json["jwksFile"],
        privateKeyField: json["privateKeyField"],
        receiverEnvironment: json["receiverEnvironment"] == null
            ? null
            : ComponentConformanceReceiverEnvironment.fromJson(
                json["receiverEnvironment"],
              ),
        secretAudience: json["secretAudience"],
        secretLocator: json["secretLocator"],
        secretVersion: json["secretVersion"],
        tokenSeconds: json["tokenSeconds"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "artifactDigest": artifactDigest,
    "audience": audience,
    "contexts": List<dynamic>.from(contexts.map((x) => x.toJson())),
    "issuer": issuer,
    "jwksFile": jwksFile,
    "privateKeyField": privateKeyField,
    "receiverEnvironment": receiverEnvironment?.toJson(),
    "secretAudience": secretAudience,
    "secretLocator": secretLocator,
    "secretVersion": secretVersion,
    "tokenSeconds": tokenSeconds,
  });
}

class ComponentConformanceIdentityContext {
  final int actionDefinitionVersion;
  final String actionKey;
  final String actorPrincipalId;

  ///隔离环境PEP的实际模拟授权revision，不得指向生产SpiceDB事实。
  final String authorizationMinZedToken;
  final String caseKey;

  ///execute场景必填的隔离native执行引用；不在生产库创建ExternalExecution。
  final String? externalExecutionId;
  final ComponentConformanceOperation operation;

  ///业务上下文必填并与版本成对；确切 application_binding.create 的 handshake/validate_binding
  ///管理上下文必须省略两字段，不授业务内容访问。
  final String? resultExposurePolicyId;

  ///业务上下文必填；结果为 NONE 的确切绑定管理上下文必须与策略 ID 一起省略。
  final int? resultExposurePolicyVersion;
  final String stepKey;
  final String? targetId;
  final String targetType;
  final String tenantId;
  final String? workspaceId;

  ComponentConformanceIdentityContext({
    required this.actionDefinitionVersion,
    required this.actionKey,
    required this.actorPrincipalId,
    required this.authorizationMinZedToken,
    required this.caseKey,
    this.externalExecutionId,
    required this.operation,
    this.resultExposurePolicyId,
    this.resultExposurePolicyVersion,
    required this.stepKey,
    this.targetId,
    required this.targetType,
    required this.tenantId,
    this.workspaceId,
  });

  factory ComponentConformanceIdentityContext.fromJson(
    Map<String, dynamic> json,
  ) => ComponentConformanceIdentityContext(
    actionDefinitionVersion: json["actionDefinitionVersion"],
    actionKey: json["actionKey"],
    actorPrincipalId: json["actorPrincipalId"],
    authorizationMinZedToken: json["authorizationMinZedToken"],
    caseKey: json["caseKey"],
    externalExecutionId: json["externalExecutionId"],
    operation: componentConformanceOperationValues.map[json["operation"]]!,
    resultExposurePolicyId: json["resultExposurePolicyId"],
    resultExposurePolicyVersion: json["resultExposurePolicyVersion"],
    stepKey: json["stepKey"],
    targetId: json["targetId"],
    targetType: json["targetType"],
    tenantId: json["tenantId"],
    workspaceId: json["workspaceId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionDefinitionVersion": actionDefinitionVersion,
    "actionKey": actionKey,
    "actorPrincipalId": actorPrincipalId,
    "authorizationMinZedToken": authorizationMinZedToken,
    "caseKey": caseKey,
    "externalExecutionId": externalExecutionId,
    "operation": componentConformanceOperationValues.reverse[operation],
    "resultExposurePolicyId": resultExposurePolicyId,
    "resultExposurePolicyVersion": resultExposurePolicyVersion,
    "stepKey": stepKey,
    "targetId": targetId,
    "targetType": targetType,
    "tenantId": tenantId,
    "workspaceId": workspaceId,
  });
}

///原 COMPONENT_CONFORMANCE_ENVIRONMENT_FILE 的 PROTOCOL_PEER 分支，仅隔离套件运行事实；readOnlyTools
///固定隔离实例实际上可安全执行的只读探针，不授予生产业务权限。
class ComponentProtocolPeerEnvironment {
  final String artifactDigest;
  final String initializeResultJson;
  final String listResultJson;
  final int maxResponseBytes;
  final int maxSteps;
  final String mcpUrl;

  ///隔离原生MCP的既有版本化SecretRef与header映射；经原Core/OpenBao审计和Gateway文件投递，不含凭据值，不借用生产binding身份。
  final List<ApplicationPeerCredentialDelivery>? nativeCredentials;
  final List<String> readOnlyTools;
  final int timeoutSeconds;

  ComponentProtocolPeerEnvironment({
    required this.artifactDigest,
    required this.initializeResultJson,
    required this.listResultJson,
    required this.maxResponseBytes,
    required this.maxSteps,
    required this.mcpUrl,
    this.nativeCredentials,
    required this.readOnlyTools,
    required this.timeoutSeconds,
  });

  factory ComponentProtocolPeerEnvironment.fromJson(
    Map<String, dynamic> json,
  ) => ComponentProtocolPeerEnvironment(
    artifactDigest: json["artifactDigest"],
    initializeResultJson: json["initializeResultJson"],
    listResultJson: json["listResultJson"],
    maxResponseBytes: json["maxResponseBytes"],
    maxSteps: json["maxSteps"],
    mcpUrl: json["mcpUrl"],
    nativeCredentials: json["nativeCredentials"] == null
        ? null
        : List<ApplicationPeerCredentialDelivery>.from(
            json["nativeCredentials"]!.map(
              (x) => ApplicationPeerCredentialDelivery.fromJson(x),
            ),
          ),
    readOnlyTools: List<String>.from(json["readOnlyTools"].map((x) => x)),
    timeoutSeconds: json["timeoutSeconds"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "artifactDigest": artifactDigest,
    "initializeResultJson": initializeResultJson,
    "listResultJson": listResultJson,
    "maxResponseBytes": maxResponseBytes,
    "maxSteps": maxSteps,
    "mcpUrl": mcpUrl,
    "nativeCredentials": nativeCredentials == null
        ? null
        : List<dynamic>.from(nativeCredentials!.map((x) => x.toJson())),
    "readOnlyTools": List<dynamic>.from(readOnlyTools.map((x) => x)),
    "timeoutSeconds": timeoutSeconds,
  });
}

///统一错误体（apps/06-工程基线规范.md 第 4 节）。不携带业务正文、secret、原始 SQL、文件内容或完整 prompt/response。
class ErrorBody {
  final ErrorClass errorBodyClass;

  ///贯穿 Core、Worker、adapter 与组件的关联键
  final String? operationId;
  final ReasonCode reason;

  ///仅随 PUBLISH_REJECTED：Relay 以社区禁言或封禁拒绝本人内容写入时的结构化原因，供原禁言横幅倒计时（DD-125(2)、V-SCN-129）。只来自
  ///Relay 对本人这次写入的拒绝文本，不是限制列表读取；其他拒绝缺省。
  final PublishRestriction? restriction;

  ErrorBody({
    required this.errorBodyClass,
    this.operationId,
    required this.reason,
    this.restriction,
  });

  factory ErrorBody.fromJson(Map<String, dynamic> json) => ErrorBody(
    errorBodyClass: errorClassValues.map[json["class"]]!,
    operationId: json["operationId"],
    reason: reasonCodeValues.map[json["reason"]]!,
    restriction: json["restriction"] == null
        ? null
        : PublishRestriction.fromJson(json["restriction"]),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "class": errorClassValues.reverse[errorBodyClass],
    "operationId": operationId,
    "reason": reasonCodeValues.reverse[reason],
    "restriction": restriction?.toJson(),
  });
}

///仅随 PUBLISH_REJECTED：Relay 以社区禁言或封禁拒绝本人内容写入时的结构化原因，供原禁言横幅倒计时（DD-125(2)、V-SCN-129）。只来自
///Relay 对本人这次写入的拒绝文本，不是限制列表读取；其他拒绝缺省。
class PublishRestriction {
  final PublishRestrictionKind kind;

  ///TIMED_OUT 的到期时刻（RFC3339，取自 Relay 拒绝文本的 unix 秒）；BANNED 或拒绝文本未给出可解析时刻时缺省
  final String? until;

  PublishRestriction({required this.kind, this.until});

  factory PublishRestriction.fromJson(Map<String, dynamic> json) =>
      PublishRestriction(
        kind: publishRestrictionKindValues.map[json["kind"]]!,
        until: json["until"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "kind": publishRestrictionKindValues.reverse[kind],
    "until": until,
  });
}

///Relay 以社区限制拒绝本人内容写入的类别（DD-125(2)）：TIMED_OUT 对应 `restricted: you are timed out until
///<ts>`，BANNED 对应 `blocked: you are banned from this community`。
enum PublishRestrictionKind { BANNED, TIMED_OUT }

final publishRestrictionKindValues = EnumValues({
  "BANNED": PublishRestrictionKind.BANNED,
  "TIMED_OUT": PublishRestrictionKind.TIMED_OUT,
});

///BFF 从内网身份 header 解析出的执行身份（.design/09）。它只由已验证的 issuer/subject 推导，不接受调用方自报的任何字段。
class ResolvedIdentity {
  ///当前选定的 Workspace；未选定时缺省
  final String? currentWorkspaceId;
  final String humanIdentityId;
  final String tenantId;
  final String tenantMembershipId;
  final String tenantPrincipalId;

  ResolvedIdentity({
    this.currentWorkspaceId,
    required this.humanIdentityId,
    required this.tenantId,
    required this.tenantMembershipId,
    required this.tenantPrincipalId,
  });

  factory ResolvedIdentity.fromJson(Map<String, dynamic> json) =>
      ResolvedIdentity(
        currentWorkspaceId: json["currentWorkspaceId"],
        humanIdentityId: json["humanIdentityId"],
        tenantId: json["tenantId"],
        tenantMembershipId: json["tenantMembershipId"],
        tenantPrincipalId: json["tenantPrincipalId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "currentWorkspaceId": currentWorkspaceId,
    "humanIdentityId": humanIdentityId,
    "tenantId": tenantId,
    "tenantMembershipId": tenantMembershipId,
    "tenantPrincipalId": tenantPrincipalId,
  });
}

///18: native authenticated file-menu metadata from the Adapter typed reference producer.
///This is NOT Action admission; the normal Kailo HUMAN session must independently
///fresh-admit the frozen target and version. No ticket or content bytes.
class NativeDocumentSelection {
  final NativeDocumentSelectionActionKey actionKey;
  final int actionVersion;
  final String bindingId;
  final int generation;
  final ContentReference reference;
  final int resourceVersion;
  final String workspaceId;

  NativeDocumentSelection({
    required this.actionKey,
    required this.actionVersion,
    required this.bindingId,
    required this.generation,
    required this.reference,
    required this.resourceVersion,
    required this.workspaceId,
  });

  factory NativeDocumentSelection.fromJson(Map<String, dynamic> json) =>
      NativeDocumentSelection(
        actionKey:
            nativeDocumentSelectionActionKeyValues.map[json["actionKey"]]!,
        actionVersion: json["actionVersion"],
        bindingId: json["bindingId"],
        generation: json["generation"],
        reference: ContentReference.fromJson(json["reference"]),
        resourceVersion: json["resourceVersion"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionKey": nativeDocumentSelectionActionKeyValues.reverse[actionKey],
    "actionVersion": actionVersion,
    "bindingId": bindingId,
    "generation": generation,
    "reference": reference.toJson(),
    "resourceVersion": resourceVersion,
    "workspaceId": workspaceId,
  });
}

enum NativeDocumentSelectionActionKey {
  FILE_STORAGE_OPEN_EDIT_V1,
  FILE_STORAGE_OPEN_VIEW_V1,
}

final nativeDocumentSelectionActionKeyValues = EnumValues({
  "file_storage.open_edit@v1":
      NativeDocumentSelectionActionKey.FILE_STORAGE_OPEN_EDIT_V1,
  "file_storage.open_view@v1":
      NativeDocumentSelectionActionKey.FILE_STORAGE_OPEN_VIEW_V1,
});

///03 §7 的平台发布 Catalog 投递，不是用户 Resource 或 Agent 注册表。部署没有提供实际合同、凭据链与 runtime 对账证据时不得填 ACTIVE。
class RuntimeProfileDirectory {
  final List<RuntimeProfileDirectoryProfilesItem> profiles;

  RuntimeProfileDirectory({required this.profiles});

  factory RuntimeProfileDirectory.fromJson(Map<String, dynamic> json) =>
      RuntimeProfileDirectory(
        profiles: List<RuntimeProfileDirectoryProfilesItem>.from(
          json["profiles"].map(
            (x) => RuntimeProfileDirectoryProfilesItem.fromJson(x),
          ),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "profiles": List<dynamic>.from(profiles.map((x) => x.toJson())),
  });
}

///Workflow 经 ProjectTaskState Activity 写回 Core 的一次状态跃迁（.design/06 §3.1）。Core 按 workflowId
///单调 upsert，eventId 不大于已有值的报告按幂等成功忽略。
class TaskStateReport {
  ///AgentTask 的 ProjectAgentTaskState Activity 原生执行 ID，仅由 ActivityInfo 投递。Core
  ///校验同固定执行链的已调度载荷后生成步骤投影；旧 writer/修复报告缺省时保留原轨迹，不推测或清空。
  final String? activityId;

  ///报告时的 history 长度；同一 workflow 内单调，重放时取到同一值
  final int eventId;
  final String? progress;
  final String runId;
  final TaskStatus status;
  final String? waitingReason;

  ///固定格式的业务 workflow ID
  final String workflowId;

  TaskStateReport({
    this.activityId,
    required this.eventId,
    this.progress,
    required this.runId,
    required this.status,
    this.waitingReason,
    required this.workflowId,
  });

  factory TaskStateReport.fromJson(Map<String, dynamic> json) =>
      TaskStateReport(
        activityId: json["activityId"],
        eventId: json["eventId"],
        progress: json["progress"],
        runId: json["runId"],
        status: taskStatusValues.map[json["status"]]!,
        waitingReason: json["waitingReason"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "activityId": activityId,
    "eventId": eventId,
    "progress": progress,
    "runId": runId,
    "status": taskStatusValues.reverse[status],
    "waitingReason": waitingReason,
    "workflowId": workflowId,
  });
}

///Core 在 Temporal Start 之前持久化的唯一引用（.design/06）。workflowId 一律取
///platform:<kind>:<tenantId>:<primaryEntityId>:<entityVersion>（前缀是协议常量，不随部署显示名变化；ADR-17
///迁移窗口内的存量引用仍为旧前缀），使「不分配第二个业务 workflow ID」可被机械校验。
class WorkflowRef {
  ///RFC3339；Describe 返回 NotFound 时用它判断是否仍在 retention 窗口内
  final String createdAt;
  final int entityVersion;
  final WorkflowKind kind;
  final String primaryEntityId;

  ///Start 成功后回填；未知时缺省
  final String? runId;
  final String tenantId;

  ///固定格式的业务 workflow ID
  final String workflowId;

  WorkflowRef({
    required this.createdAt,
    required this.entityVersion,
    required this.kind,
    required this.primaryEntityId,
    this.runId,
    required this.tenantId,
    required this.workflowId,
  });

  factory WorkflowRef.fromJson(Map<String, dynamic> json) => WorkflowRef(
    createdAt: json["createdAt"],
    entityVersion: json["entityVersion"],
    kind: workflowKindValues.map[json["kind"]]!,
    primaryEntityId: json["primaryEntityId"],
    runId: json["runId"],
    tenantId: json["tenantId"],
    workflowId: json["workflowId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "createdAt": createdAt,
    "entityVersion": entityVersion,
    "kind": workflowKindValues.reverse[kind],
    "primaryEntityId": primaryEntityId,
    "runId": runId,
    "tenantId": tenantId,
    "workflowId": workflowId,
  });
}

///唯一安装 Workflow 推进同一 ActionExecution/version/generation；取消接收不是原生清理终态。
class AgentInstallationAdvanceRequest {
  final String actionExecutionId;
  final String agentVersionAssetId;
  final bool cancelRequested;
  final String installationId;
  final int projectionGeneration;
  final String runId;
  final String workflowId;

  AgentInstallationAdvanceRequest({
    required this.actionExecutionId,
    required this.agentVersionAssetId,
    required this.cancelRequested,
    required this.installationId,
    required this.projectionGeneration,
    required this.runId,
    required this.workflowId,
  });

  factory AgentInstallationAdvanceRequest.fromJson(Map<String, dynamic> json) =>
      AgentInstallationAdvanceRequest(
        actionExecutionId: json["actionExecutionId"],
        agentVersionAssetId: json["agentVersionAssetId"],
        cancelRequested: json["cancelRequested"],
        installationId: json["installationId"],
        projectionGeneration: json["projectionGeneration"],
        runId: json["runId"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "agentVersionAssetId": agentVersionAssetId,
    "cancelRequested": cancelRequested,
    "installationId": installationId,
    "projectionGeneration": projectionGeneration,
    "runId": runId,
    "workflowId": workflowId,
  });
}

///Core 查证后的安装生命周期状态；身份/模型/记忆/runtime 未闭合只返回 RUNNING/UNKNOWN，不把 spawn 当 ACTIVE。
class AgentInstallationAdvanceResult {
  final String installationId;
  final TaskStatus status;
  final String waitingReason;

  AgentInstallationAdvanceResult({
    required this.installationId,
    required this.status,
    required this.waitingReason,
  });

  factory AgentInstallationAdvanceResult.fromJson(Map<String, dynamic> json) =>
      AgentInstallationAdvanceResult(
        installationId: json["installationId"],
        status: taskStatusValues.map[json["status"]]!,
        waitingReason: json["waitingReason"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "installationId": installationId,
    "status": taskStatusValues.reverse[status],
    "waitingReason": waitingReason,
  });
}

///DD-25/48：既有 ComponentTaskWorkflow 的 AGENT_INSTALLATION 冻结目标；不含凭据或 Version 正文。
class AgentInstallationWorkflowTarget {
  final String actionExecutionId;
  final String agentVersionAssetId;
  final String installationId;
  final int projectionGeneration;

  AgentInstallationWorkflowTarget({
    required this.actionExecutionId,
    required this.agentVersionAssetId,
    required this.installationId,
    required this.projectionGeneration,
  });

  factory AgentInstallationWorkflowTarget.fromJson(Map<String, dynamic> json) =>
      AgentInstallationWorkflowTarget(
        actionExecutionId: json["actionExecutionId"],
        agentVersionAssetId: json["agentVersionAssetId"],
        installationId: json["installationId"],
        projectionGeneration: json["projectionGeneration"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "agentVersionAssetId": agentVersionAssetId,
    "installationId": installationId,
    "projectionGeneration": projectionGeneration,
  });
}

///Worker 推进已冻结 Invocation；未知原生结果只观察，不再次 turn/start。
class AgentTaskAdvanceRequest {
  final String activityId;
  final String agentVersionAssetId;
  final int attempt;
  final bool cancelRequested;
  final int heartbeatIntervalSeconds;
  final String installationId;
  final String invocationId;
  final int observationIntervalSeconds;
  final int projectionGeneration;
  final String runId;
  final String workflowId;

  AgentTaskAdvanceRequest({
    required this.activityId,
    required this.agentVersionAssetId,
    required this.attempt,
    required this.cancelRequested,
    required this.heartbeatIntervalSeconds,
    required this.installationId,
    required this.invocationId,
    required this.observationIntervalSeconds,
    required this.projectionGeneration,
    required this.runId,
    required this.workflowId,
  });

  factory AgentTaskAdvanceRequest.fromJson(Map<String, dynamic> json) =>
      AgentTaskAdvanceRequest(
        activityId: json["activityId"],
        agentVersionAssetId: json["agentVersionAssetId"],
        attempt: json["attempt"],
        cancelRequested: json["cancelRequested"],
        heartbeatIntervalSeconds: json["heartbeatIntervalSeconds"],
        installationId: json["installationId"],
        invocationId: json["invocationId"],
        observationIntervalSeconds: json["observationIntervalSeconds"],
        projectionGeneration: json["projectionGeneration"],
        runId: json["runId"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "activityId": activityId,
    "agentVersionAssetId": agentVersionAssetId,
    "attempt": attempt,
    "cancelRequested": cancelRequested,
    "heartbeatIntervalSeconds": heartbeatIntervalSeconds,
    "installationId": installationId,
    "invocationId": invocationId,
    "observationIntervalSeconds": observationIntervalSeconds,
    "projectionGeneration": projectionGeneration,
    "runId": runId,
    "workflowId": workflowId,
  });
}

///Core 查证的引用与状态；native completed 缺 reply/usage 证据仍 RUNNING。
class AgentTaskAdvanceResult {
  final ApprovalWorkflowInput? approvalInput;
  final String? approvalWorkflowId;

  ///同不可变自动化版本的下一 Delay；Core 须读回原 execution chain 的 TimerFired 才允许后续副作用。
  final AgentTaskAdvanceResultDelayStep? delayStep;

  ///已查证安全停止此 Activity；不等于 Invocation 成功或 Capacity 已释放。
  final bool finishActivity;
  final String invocationId;
  final TaskStatus status;
  final String waitingReason;

  AgentTaskAdvanceResult({
    this.approvalInput,
    this.approvalWorkflowId,
    this.delayStep,
    required this.finishActivity,
    required this.invocationId,
    required this.status,
    required this.waitingReason,
  });

  factory AgentTaskAdvanceResult.fromJson(Map<String, dynamic> json) =>
      AgentTaskAdvanceResult(
        approvalInput: json["approvalInput"] == null
            ? null
            : ApprovalWorkflowInput.fromJson(json["approvalInput"]),
        approvalWorkflowId: json["approvalWorkflowId"],
        delayStep: json["delayStep"] == null
            ? null
            : AgentTaskAdvanceResultDelayStep.fromJson(json["delayStep"]),
        finishActivity: json["finishActivity"],
        invocationId: json["invocationId"],
        status: taskStatusValues.map[json["status"]]!,
        waitingReason: json["waitingReason"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "approvalInput": approvalInput?.toJson(),
    "approvalWorkflowId": approvalWorkflowId,
    "delayStep": delayStep?.toJson(),
    "finishActivity": finishActivity,
    "invocationId": invocationId,
    "status": taskStatusValues.reverse[status],
    "waitingReason": waitingReason,
  });
}

///ApprovalWorkflow 的冻结输入（.design/06 §4）。运行中不得更换 Tenant、Workspace、target、参数摘要或策略版本；意图改变时建立新
///ActionExecution。
class ApprovalWorkflowInput {
  final int actionDefinitionVersion;
  final String actionExecutionId;
  final String actionKey;
  final List<AffectedOwnerRef> affectedOwnerRefs;

  ///APPROVED 之后等待 consume 的上界；超时自动 INVALIDATED
  final int consumeWindowSeconds;

  ///RFC3339，UTC。Core 按 ApprovalPolicy.expires_in 在请求时冻结；Workflow 以 workflow.Now() 与之比较
  final String expiresAt;
  final String initiatorPrincipalId;
  final String operationId;
  final ApprovalOwnerRequirement ownerRequirement;
  final String parameterHash;
  final String policyId;
  final int policyVersion;
  final ApprovalResume? resume;
  final List<ApprovalRoleRequirement> roleRequirements;
  final ApprovalSelfApproval selfApproval;
  final String targetId;
  final String targetType;
  final String tenantId;

  ///TENANT_ONLY 动作缺省
  final String? workspaceId;

  ApprovalWorkflowInput({
    required this.actionDefinitionVersion,
    required this.actionExecutionId,
    required this.actionKey,
    required this.affectedOwnerRefs,
    required this.consumeWindowSeconds,
    required this.expiresAt,
    required this.initiatorPrincipalId,
    required this.operationId,
    required this.ownerRequirement,
    required this.parameterHash,
    required this.policyId,
    required this.policyVersion,
    this.resume,
    required this.roleRequirements,
    required this.selfApproval,
    required this.targetId,
    required this.targetType,
    required this.tenantId,
    this.workspaceId,
  });

  factory ApprovalWorkflowInput.fromJson(Map<String, dynamic> json) =>
      ApprovalWorkflowInput(
        actionDefinitionVersion: json["actionDefinitionVersion"],
        actionExecutionId: json["actionExecutionId"],
        actionKey: json["actionKey"],
        affectedOwnerRefs: List<AffectedOwnerRef>.from(
          json["affectedOwnerRefs"].map((x) => AffectedOwnerRef.fromJson(x)),
        ),
        consumeWindowSeconds: json["consumeWindowSeconds"],
        expiresAt: json["expiresAt"],
        initiatorPrincipalId: json["initiatorPrincipalId"],
        operationId: json["operationId"],
        ownerRequirement:
            approvalOwnerRequirementValues.map[json["ownerRequirement"]]!,
        parameterHash: json["parameterHash"],
        policyId: json["policyId"],
        policyVersion: json["policyVersion"],
        resume: json["resume"] == null
            ? null
            : ApprovalResume.fromJson(json["resume"]),
        roleRequirements: List<ApprovalRoleRequirement>.from(
          json["roleRequirements"].map(
            (x) => ApprovalRoleRequirement.fromJson(x),
          ),
        ),
        selfApproval: approvalSelfApprovalValues.map[json["selfApproval"]]!,
        targetId: json["targetId"],
        targetType: json["targetType"],
        tenantId: json["tenantId"],
        workspaceId: json["workspaceId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionDefinitionVersion": actionDefinitionVersion,
    "actionExecutionId": actionExecutionId,
    "actionKey": actionKey,
    "affectedOwnerRefs": List<dynamic>.from(
      affectedOwnerRefs.map((x) => x.toJson()),
    ),
    "consumeWindowSeconds": consumeWindowSeconds,
    "expiresAt": expiresAt,
    "initiatorPrincipalId": initiatorPrincipalId,
    "operationId": operationId,
    "ownerRequirement":
        approvalOwnerRequirementValues.reverse[ownerRequirement],
    "parameterHash": parameterHash,
    "policyId": policyId,
    "policyVersion": policyVersion,
    "resume": resume?.toJson(),
    "roleRequirements": List<dynamic>.from(
      roleRequirements.map((x) => x.toJson()),
    ),
    "selfApproval": approvalSelfApprovalValues.reverse[selfApproval],
    "targetId": targetId,
    "targetType": targetType,
    "tenantId": tenantId,
    "workspaceId": workspaceId,
  });
}

///请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
class AffectedOwnerRef {
  final String ownerPrincipalId;
  final String targetId;
  final String targetType;
  final int targetVersion;

  AffectedOwnerRef({
    required this.ownerPrincipalId,
    required this.targetId,
    required this.targetType,
    required this.targetVersion,
  });

  factory AffectedOwnerRef.fromJson(Map<String, dynamic> json) =>
      AffectedOwnerRef(
        ownerPrincipalId: json["ownerPrincipalId"],
        targetId: json["targetId"],
        targetType: json["targetType"],
        targetVersion: json["targetVersion"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "ownerPrincipalId": ownerPrincipalId,
    "targetId": targetId,
    "targetType": targetType,
    "targetVersion": targetVersion,
  });
}

///ApprovalPolicy.owner_requirement（.design/03 §4）。
enum ApprovalOwnerRequirement { ALL_AFFECTED_OWNERS, NONE, TARGET_OWNER }

final approvalOwnerRequirementValues = EnumValues({
  "ALL_AFFECTED_OWNERS": ApprovalOwnerRequirement.ALL_AFFECTED_OWNERS,
  "NONE": ApprovalOwnerRequirement.NONE,
  "TARGET_OWNER": ApprovalOwnerRequirement.TARGET_OWNER,
});

///ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
///才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
class ApprovalResume {
  ///RFC3339，UTC
  final String? consumedAt;

  ///RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
  final String? consumeDeadline;
  final List<ApprovalDecisionRecord> decisions;

  ///此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
  ///从零数起，不加上它续跑后的投影会被当成旧事件丢掉
  final int eventBase;
  final ReasonCode? reason;
  final List<ApprovalRefusal> refusals;
  final ApprovalStatus status;

  ApprovalResume({
    this.consumedAt,
    this.consumeDeadline,
    required this.decisions,
    required this.eventBase,
    this.reason,
    required this.refusals,
    required this.status,
  });

  factory ApprovalResume.fromJson(Map<String, dynamic> json) => ApprovalResume(
    consumedAt: json["consumedAt"],
    consumeDeadline: json["consumeDeadline"],
    decisions: List<ApprovalDecisionRecord>.from(
      json["decisions"].map((x) => ApprovalDecisionRecord.fromJson(x)),
    ),
    eventBase: json["eventBase"],
    reason: json["reason"] == null
        ? null
        : reasonCodeValues.map[json["reason"]]!,
    refusals: List<ApprovalRefusal>.from(
      json["refusals"].map((x) => ApprovalRefusal.fromJson(x)),
    ),
    status: approvalStatusValues.map[json["status"]]!,
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "consumedAt": consumedAt,
    "consumeDeadline": consumeDeadline,
    "decisions": List<dynamic>.from(decisions.map((x) => x.toJson())),
    "eventBase": eventBase,
    "reason": reasonCodeValues.reverse[reason],
    "refusals": List<dynamic>.from(refusals.map((x) => x.toJson())),
    "status": approvalStatusValues.reverse[status],
  });
}

///一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
///§4）。
class ApprovalRefusal {
  final String approverPrincipalId;
  final ReasonCode reason;

  ApprovalRefusal({required this.approverPrincipalId, required this.reason});

  factory ApprovalRefusal.fromJson(Map<String, dynamic> json) =>
      ApprovalRefusal(
        approverPrincipalId: json["approverPrincipalId"],
        reason: reasonCodeValues.map[json["reason"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "approverPrincipalId": approverPrincipalId,
    "reason": reasonCodeValues.reverse[reason],
  });
}

///ApprovalPolicy.self_approval：发起者能否批准自己的请求（职责分离）。
enum ApprovalSelfApproval { ALLOW, DENY }

final approvalSelfApprovalValues = EnumValues({
  "ALLOW": ApprovalSelfApproval.ALLOW,
  "DENY": ApprovalSelfApproval.DENY,
});

///同不可变自动化版本的下一 Delay；Core 须读回原 execution chain 的 TimerFired 才允许后续副作用。
class AgentTaskAdvanceResultDelayStep {
  final String id;
  final int seconds;

  ///显式 Delay 步骤时限；独立原生 Timer，不替换 seconds。缺省走原 history 分支。
  final int? timeoutSeconds;

  AgentTaskAdvanceResultDelayStep({
    required this.id,
    required this.seconds,
    this.timeoutSeconds,
  });

  factory AgentTaskAdvanceResultDelayStep.fromJson(Map<String, dynamic> json) =>
      AgentTaskAdvanceResultDelayStep(
        id: json["id"],
        seconds: json["seconds"],
        timeoutSeconds: json["timeoutSeconds"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "id": id,
    "seconds": seconds,
    "timeoutSeconds": timeoutSeconds,
  });
}

class ApplicationBindingAdvanceRequest {
  final bool cancelRequested;
  final String runId;
  final ApplicationBindingTarget target;

  ApplicationBindingAdvanceRequest({
    required this.cancelRequested,
    required this.runId,
    required this.target,
  });

  factory ApplicationBindingAdvanceRequest.fromJson(
    Map<String, dynamic> json,
  ) => ApplicationBindingAdvanceRequest(
    cancelRequested: json["cancelRequested"],
    runId: json["runId"],
    target: ApplicationBindingTarget.fromJson(json["target"]),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "cancelRequested": cancelRequested,
    "runId": runId,
    "target": target.toJson(),
  });
}

class ApplicationBindingTarget {
  final String actionExecutionId;
  final String bindingId;
  final int bindingVersion;
  final String workflowId;

  ApplicationBindingTarget({
    required this.actionExecutionId,
    required this.bindingId,
    required this.bindingVersion,
    required this.workflowId,
  });

  factory ApplicationBindingTarget.fromJson(Map<String, dynamic> json) =>
      ApplicationBindingTarget(
        actionExecutionId: json["actionExecutionId"],
        bindingId: json["bindingId"],
        bindingVersion: json["bindingVersion"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "bindingId": bindingId,
    "bindingVersion": bindingVersion,
    "workflowId": workflowId,
  });
}

class ApplicationBindingAdvanceResult {
  final String bindingId;
  final TaskStatus status;
  final String waitingReason;

  ApplicationBindingAdvanceResult({
    required this.bindingId,
    required this.status,
    required this.waitingReason,
  });

  factory ApplicationBindingAdvanceResult.fromJson(Map<String, dynamic> json) =>
      ApplicationBindingAdvanceResult(
        bindingId: json["bindingId"],
        status: taskStatusValues.map[json["status"]]!,
        waitingReason: json["waitingReason"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingId": bindingId,
    "status": taskStatusValues.reverse[status],
    "waitingReason": waitingReason,
  });
}

///consume、invalidate、withdraw 三个 Update 的结果：执行后的 Approval 状态。
class ApprovalControlOutcome {
  final ApprovalStatus status;

  ApprovalControlOutcome({required this.status});

  factory ApprovalControlOutcome.fromJson(Map<String, dynamic> json) =>
      ApprovalControlOutcome(status: approvalStatusValues.map[json["status"]]!);

  Map<String, dynamic> toJson() =>
      _stripNulls({"status": approvalStatusValues.reverse[status]});
}

///decide Update 的结果。admitted=false 表示 FreshApprovalAdmission 未通过，这次 Update 没有形成决定；decision
///是该 approver 已记录的决定（重复同值时即原决定）。
class ApprovalDecisionOutcome {
  final bool admitted;
  final String approverPrincipalId;

  ///已形成的决定；admitted=false 时缺省
  final ApprovalDecision? decision;

  ///admitted=false 时的拒绝原因
  final ReasonCode? reason;
  final ApprovalStatus status;

  ApprovalDecisionOutcome({
    required this.admitted,
    required this.approverPrincipalId,
    this.decision,
    this.reason,
    required this.status,
  });

  factory ApprovalDecisionOutcome.fromJson(Map<String, dynamic> json) =>
      ApprovalDecisionOutcome(
        admitted: json["admitted"],
        approverPrincipalId: json["approverPrincipalId"],
        decision: json["decision"] == null
            ? null
            : approvalDecisionValues.map[json["decision"]]!,
        reason: json["reason"] == null
            ? null
            : reasonCodeValues.map[json["reason"]]!,
        status: approvalStatusValues.map[json["status"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "admitted": admitted,
    "approverPrincipalId": approverPrincipalId,
    "decision": approvalDecisionValues.reverse[decision],
    "reason": reasonCodeValues.reverse[reason],
    "status": approvalStatusValues.reverse[status],
  });
}

///decide Update 的参数。Update ID 固定为 <approval_workflow_id>:<approver_principal_id>，由 Server
///侧去重；approverPrincipalId 由 Core 从 PlatformSession 取得，不接受 Browser 自报。
class ApprovalDecisionUpdate {
  final String approverPrincipalId;
  final ApprovalDecision decision;

  ApprovalDecisionUpdate({
    required this.approverPrincipalId,
    required this.decision,
  });

  factory ApprovalDecisionUpdate.fromJson(Map<String, dynamic> json) =>
      ApprovalDecisionUpdate(
        approverPrincipalId: json["approverPrincipalId"],
        decision: approvalDecisionValues.map[json["decision"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "approverPrincipalId": approverPrincipalId,
    "decision": approvalDecisionValues.reverse[decision],
  });
}

///invalidate Update 的参数：Core 在批准后重新准入不通过时发出（.design/06 §4）。Update ID 固定为
///<action_execution_id>:invalidate。
class ApprovalInvalidateUpdate {
  final ReasonCode reason;

  ApprovalInvalidateUpdate({required this.reason});

  factory ApprovalInvalidateUpdate.fromJson(Map<String, dynamic> json) =>
      ApprovalInvalidateUpdate(reason: reasonCodeValues.map[json["reason"]]!);

  Map<String, dynamic> toJson() =>
      _stripNulls({"reason": reasonCodeValues.reverse[reason]});
}

///ApprovalWorkflow 经 ProjectApprovalState Activity 写回 Core 的一次状态跃迁。Core 按 workflowId 与
///eventId 单调 upsert；ApprovalProjection 只接受这一条写入路径（DD-47）。
class ApprovalStateReport {
  ///RFC3339，UTC；进入 CONSUMED 时的 workflow.Now()
  final String? consumedAt;

  ///RFC3339，UTC；进入 APPROVED 时由 workflow.Now() 加 consumeWindowSeconds 得出
  final String? consumeDeadline;
  final List<ApprovalDecisionRecord> decisions;

  ///报告时跨 run 累计的 history 长度
  final int eventId;

  ///RFC3339，UTC
  final String expiresAt;

  ///INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
  final ReasonCode? reason;
  final String runId;
  final ApprovalStatus status;
  final String workflowId;

  ApprovalStateReport({
    this.consumedAt,
    this.consumeDeadline,
    required this.decisions,
    required this.eventId,
    required this.expiresAt,
    this.reason,
    required this.runId,
    required this.status,
    required this.workflowId,
  });

  factory ApprovalStateReport.fromJson(Map<String, dynamic> json) =>
      ApprovalStateReport(
        consumedAt: json["consumedAt"],
        consumeDeadline: json["consumeDeadline"],
        decisions: List<ApprovalDecisionRecord>.from(
          json["decisions"].map((x) => ApprovalDecisionRecord.fromJson(x)),
        ),
        eventId: json["eventId"],
        expiresAt: json["expiresAt"],
        reason: json["reason"] == null
            ? null
            : reasonCodeValues.map[json["reason"]]!,
        runId: json["runId"],
        status: approvalStatusValues.map[json["status"]]!,
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "consumedAt": consumedAt,
    "consumeDeadline": consumeDeadline,
    "decisions": List<dynamic>.from(decisions.map((x) => x.toJson())),
    "eventId": eventId,
    "expiresAt": expiresAt,
    "reason": reasonCodeValues.reverse[reason],
    "runId": runId,
    "status": approvalStatusValues.reverse[status],
    "workflowId": workflowId,
  });
}

class AutomationScheduleAdmitRequest {
  final AutomationScheduleTaskInput input;
  final String runId;
  final String workflowId;

  AutomationScheduleAdmitRequest({
    required this.input,
    required this.runId,
    required this.workflowId,
  });

  factory AutomationScheduleAdmitRequest.fromJson(Map<String, dynamic> json) =>
      AutomationScheduleAdmitRequest(
        input: AutomationScheduleTaskInput.fromJson(json["input"]),
        runId: json["runId"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "input": input.toJson(),
    "runId": runId,
    "workflowId": workflowId,
  });
}

///DD-107 Schedule 原生启动 AgentTaskWorkflow 的输入。计划时间仅取 native history，不由调用方提供。
class AutomationScheduleTaskInput {
  final String automationResourceId;
  final String automationVersionAssetId;

  ///原 Workflow continue-as-new 仅携 true 保留已观察取消；首 native Schedule input 缺省。
  final bool? cancelPending;
  final String scheduleId;
  final AutomationScheduleSource sourceKind;

  AutomationScheduleTaskInput({
    required this.automationResourceId,
    required this.automationVersionAssetId,
    this.cancelPending,
    required this.scheduleId,
    required this.sourceKind,
  });

  factory AutomationScheduleTaskInput.fromJson(Map<String, dynamic> json) =>
      AutomationScheduleTaskInput(
        automationResourceId: json["automationResourceId"],
        automationVersionAssetId: json["automationVersionAssetId"],
        cancelPending: json["cancelPending"],
        scheduleId: json["scheduleId"],
        sourceKind: automationScheduleSourceValues.map[json["sourceKind"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "automationResourceId": automationResourceId,
    "automationVersionAssetId": automationVersionAssetId,
    "cancelPending": cancelPending,
    "scheduleId": scheduleId,
    "sourceKind": automationScheduleSourceValues.reverse[sourceKind],
  });
}

enum AutomationScheduleSource { SCHEDULE }

final automationScheduleSourceValues = EnumValues({
  "SCHEDULE": AutomationScheduleSource.SCHEDULE,
});

class AutomationScheduleAdmitResult {
  final bool admitted;
  final String reasonCode;
  final AgentTaskWorkflowInput? taskInput;

  AutomationScheduleAdmitResult({
    required this.admitted,
    required this.reasonCode,
    this.taskInput,
  });

  factory AutomationScheduleAdmitResult.fromJson(Map<String, dynamic> json) =>
      AutomationScheduleAdmitResult(
        admitted: json["admitted"],
        reasonCode: json["reasonCode"],
        taskInput: json["taskInput"] == null
            ? null
            : AgentTaskWorkflowInput.fromJson(json["taskInput"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "admitted": admitted,
    "reasonCode": reasonCode,
    "taskInput": taskInput?.toJson(),
  });
}

///DD-47/48：固定 AgentInvocation 与版本/投影引用；不携带 prompt、token 或原生正文。
class AgentTaskWorkflowInput {
  final String agentVersionAssetId;
  final bool cancelPending;
  final int eventBase;
  final int heartbeatIntervalSeconds;
  final int heartbeatTimeoutSeconds;
  final String installationId;
  final String invocationId;
  final int observationIntervalSeconds;
  final int projectionGeneration;

  AgentTaskWorkflowInput({
    required this.agentVersionAssetId,
    required this.cancelPending,
    required this.eventBase,
    required this.heartbeatIntervalSeconds,
    required this.heartbeatTimeoutSeconds,
    required this.installationId,
    required this.invocationId,
    required this.observationIntervalSeconds,
    required this.projectionGeneration,
  });

  factory AgentTaskWorkflowInput.fromJson(Map<String, dynamic> json) =>
      AgentTaskWorkflowInput(
        agentVersionAssetId: json["agentVersionAssetId"],
        cancelPending: json["cancelPending"],
        eventBase: json["eventBase"],
        heartbeatIntervalSeconds: json["heartbeatIntervalSeconds"],
        heartbeatTimeoutSeconds: json["heartbeatTimeoutSeconds"],
        installationId: json["installationId"],
        invocationId: json["invocationId"],
        observationIntervalSeconds: json["observationIntervalSeconds"],
        projectionGeneration: json["projectionGeneration"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "agentVersionAssetId": agentVersionAssetId,
    "cancelPending": cancelPending,
    "eventBase": eventBase,
    "heartbeatIntervalSeconds": heartbeatIntervalSeconds,
    "heartbeatTimeoutSeconds": heartbeatTimeoutSeconds,
    "installationId": installationId,
    "invocationId": invocationId,
    "observationIntervalSeconds": observationIntervalSeconds,
    "projectionGeneration": projectionGeneration,
  });
}

class ComponentActionAdvanceRequest {
  final bool cancelRequested;
  final String runId;
  final ComponentActionTarget target;

  ComponentActionAdvanceRequest({
    required this.cancelRequested,
    required this.runId,
    required this.target,
  });

  factory ComponentActionAdvanceRequest.fromJson(Map<String, dynamic> json) =>
      ComponentActionAdvanceRequest(
        cancelRequested: json["cancelRequested"],
        runId: json["runId"],
        target: ComponentActionTarget.fromJson(json["target"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "cancelRequested": cancelRequested,
    "runId": runId,
    "target": target.toJson(),
  });
}

///原 ComponentTaskWorkflow(kind=COMPONENT_ACTION) 的冻结引用；全部业务参数仍从原 AE 的引用/hash读取。
class ComponentActionTarget {
  final String actionExecutionId;
  final String bindingId;
  final int bindingVersion;
  final String componentReleaseId;
  final int projectionGeneration;
  final String workflowId;

  ComponentActionTarget({
    required this.actionExecutionId,
    required this.bindingId,
    required this.bindingVersion,
    required this.componentReleaseId,
    required this.projectionGeneration,
    required this.workflowId,
  });

  factory ComponentActionTarget.fromJson(Map<String, dynamic> json) =>
      ComponentActionTarget(
        actionExecutionId: json["actionExecutionId"],
        bindingId: json["bindingId"],
        bindingVersion: json["bindingVersion"],
        componentReleaseId: json["componentReleaseId"],
        projectionGeneration: json["projectionGeneration"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "bindingId": bindingId,
    "bindingVersion": bindingVersion,
    "componentReleaseId": componentReleaseId,
    "projectionGeneration": projectionGeneration,
    "workflowId": workflowId,
  });
}

class ComponentActionAdvanceResult {
  final String actionExecutionId;
  final TaskStatus status;
  final String waitingReason;

  ComponentActionAdvanceResult({
    required this.actionExecutionId,
    required this.status,
    required this.waitingReason,
  });

  factory ComponentActionAdvanceResult.fromJson(Map<String, dynamic> json) =>
      ComponentActionAdvanceResult(
        actionExecutionId: json["actionExecutionId"],
        status: taskStatusValues.map[json["status"]]!,
        waitingReason: json["waitingReason"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "status": taskStatusValues.reverse[status],
    "waitingReason": waitingReason,
  });
}

///受信 Worker 的一次实际线协议观察，附着冻结 ActionExecution。Core 以自身 plan 逐项匹配，不接收 pass 布尔值；UNKNOWN
///不表示套件失败或成功。响应正文与测试凭据不进入报告。
class ComponentConformanceObservation {
  final String actionExecutionId;
  final String artifactDigest;
  final String componentReleaseId;
  final List<String> contractDigests;
  final List<ComponentConformanceStepObservation> observations;
  final String operationId;
  final String planDigest;
  final String runId;
  final String suiteDigest;
  final String workflowId;

  ComponentConformanceObservation({
    required this.actionExecutionId,
    required this.artifactDigest,
    required this.componentReleaseId,
    required this.contractDigests,
    required this.observations,
    required this.operationId,
    required this.planDigest,
    required this.runId,
    required this.suiteDigest,
    required this.workflowId,
  });

  factory ComponentConformanceObservation.fromJson(Map<String, dynamic> json) =>
      ComponentConformanceObservation(
        actionExecutionId: json["actionExecutionId"],
        artifactDigest: json["artifactDigest"],
        componentReleaseId: json["componentReleaseId"],
        contractDigests: List<String>.from(
          json["contractDigests"].map((x) => x),
        ),
        observations: List<ComponentConformanceStepObservation>.from(
          json["observations"].map(
            (x) => ComponentConformanceStepObservation.fromJson(x),
          ),
        ),
        operationId: json["operationId"],
        planDigest: json["planDigest"],
        runId: json["runId"],
        suiteDigest: json["suiteDigest"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "artifactDigest": artifactDigest,
    "componentReleaseId": componentReleaseId,
    "contractDigests": List<dynamic>.from(contractDigests.map((x) => x)),
    "observations": List<dynamic>.from(observations.map((x) => x.toJson())),
    "operationId": operationId,
    "planDigest": planDigest,
    "runId": runId,
    "suiteDigest": suiteDigest,
    "workflowId": workflowId,
  });
}

class ComponentConformanceStepObservation {
  ///成功 validate_binding 的固定字段摘要，由 Core 从真实回执按 component_conformance_wire_digests 计算；其他操作不得携带。
  final String? bindingDigest;

  ///DD-124：本步声明的捕获值，只由 Core 从本次实际应答的封闭槽位取得；仅随该步观察证据保存。
  final List<ComponentConformanceCaptureValue>? captures;
  final String caseKey;
  final ContentReference? contentReference;
  final ErrorClass? errorClass;
  final int httpStatus;
  final ComponentConformanceStepExpectedMcpResultKind? mcpResultKind;
  final AdapterExecutionObservation? nativeObservation;
  final ComponentNativeReceiverObservation? nativeReceiverObservation;
  final AdapterScopeObservation? nativeScopeObservation;
  final ComponentConformanceOperation operation;
  final String requestDigest;
  final String responseDigest;

  ///实际返回的能力结果摘要；原结果正文不进入报告或 Core。
  final String? resultDigest;
  final String stepKey;

  ComponentConformanceStepObservation({
    this.bindingDigest,
    this.captures,
    required this.caseKey,
    this.contentReference,
    this.errorClass,
    required this.httpStatus,
    this.mcpResultKind,
    this.nativeObservation,
    this.nativeReceiverObservation,
    this.nativeScopeObservation,
    required this.operation,
    required this.requestDigest,
    required this.responseDigest,
    this.resultDigest,
    required this.stepKey,
  });

  factory ComponentConformanceStepObservation.fromJson(
    Map<String, dynamic> json,
  ) => ComponentConformanceStepObservation(
    bindingDigest: json["bindingDigest"],
    captures: json["captures"] == null
        ? null
        : List<ComponentConformanceCaptureValue>.from(
            json["captures"]!.map(
              (x) => ComponentConformanceCaptureValue.fromJson(x),
            ),
          ),
    caseKey: json["caseKey"],
    contentReference: json["contentReference"] == null
        ? null
        : ContentReference.fromJson(json["contentReference"]),
    errorClass: json["errorClass"] == null
        ? null
        : errorClassValues.map[json["errorClass"]]!,
    httpStatus: json["httpStatus"],
    mcpResultKind: json["mcpResultKind"] == null
        ? null
        : componentConformanceStepExpectedMcpResultKindValues
              .map[json["mcpResultKind"]]!,
    nativeObservation: json["nativeObservation"] == null
        ? null
        : AdapterExecutionObservation.fromJson(json["nativeObservation"]),
    nativeReceiverObservation: json["nativeReceiverObservation"] == null
        ? null
        : ComponentNativeReceiverObservation.fromJson(
            json["nativeReceiverObservation"],
          ),
    nativeScopeObservation: json["nativeScopeObservation"] == null
        ? null
        : AdapterScopeObservation.fromJson(json["nativeScopeObservation"]),
    operation: componentConformanceOperationValues.map[json["operation"]]!,
    requestDigest: json["requestDigest"],
    responseDigest: json["responseDigest"],
    resultDigest: json["resultDigest"],
    stepKey: json["stepKey"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "bindingDigest": bindingDigest,
    "captures": captures == null
        ? null
        : List<dynamic>.from(captures!.map((x) => x.toJson())),
    "caseKey": caseKey,
    "contentReference": contentReference?.toJson(),
    "errorClass": errorClassValues.reverse[errorClass],
    "httpStatus": httpStatus,
    "mcpResultKind": componentConformanceStepExpectedMcpResultKindValues
        .reverse[mcpResultKind],
    "nativeObservation": nativeObservation?.toJson(),
    "nativeReceiverObservation": nativeReceiverObservation?.toJson(),
    "nativeScopeObservation": nativeScopeObservation?.toJson(),
    "operation": componentConformanceOperationValues.reverse[operation],
    "requestDigest": requestDigest,
    "responseDigest": responseDigest,
    "resultDigest": resultDigest,
    "stepKey": stepKey,
  });
}

///DD-98：按同一 platform Resource ref CREATE/LOOKUP；FOUND 保留上游实际引用，不由套件预测或生成 native ID。
class AdapterScopeObservation {
  final String? nativeRef;
  final String? nativeType;
  final String platformResourceRef;
  final NativeScopeResult result;

  AdapterScopeObservation({
    this.nativeRef,
    this.nativeType,
    required this.platformResourceRef,
    required this.result,
  });

  factory AdapterScopeObservation.fromJson(Map<String, dynamic> json) =>
      AdapterScopeObservation(
        nativeRef: json["nativeRef"],
        nativeType: json["nativeType"],
        platformResourceRef: json["platformResourceRef"],
        result: nativeScopeResultValues.map[json["result"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "nativeRef": nativeRef,
    "nativeType": nativeType,
    "platformResourceRef": platformResourceRef,
    "result": nativeScopeResultValues.reverse[result],
  });
}

enum NativeScopeResult { ABSENT_FENCED, FOUND, REFUSED }

final nativeScopeResultValues = EnumValues({
  "ABSENT_FENCED": NativeScopeResult.ABSENT_FENCED,
  "FOUND": NativeScopeResult.FOUND,
  "REFUSED": NativeScopeResult.REFUSED,
});

class ConversationProjectionRequest {
  final String runId;
  final ConversationProjectionTarget target;

  ConversationProjectionRequest({required this.runId, required this.target});

  factory ConversationProjectionRequest.fromJson(Map<String, dynamic> json) =>
      ConversationProjectionRequest(
        runId: json["runId"],
        target: ConversationProjectionTarget.fromJson(json["target"]),
      );

  Map<String, dynamic> toJson() =>
      _stripNulls({"runId": runId, "target": target.toJson()});
}

class ConversationProjectionTarget {
  final String actionExecutionId;
  final String conversationId;
  final String workflowId;

  ConversationProjectionTarget({
    required this.actionExecutionId,
    required this.conversationId,
    required this.workflowId,
  });

  factory ConversationProjectionTarget.fromJson(Map<String, dynamic> json) =>
      ConversationProjectionTarget(
        actionExecutionId: json["actionExecutionId"],
        conversationId: json["conversationId"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "conversationId": conversationId,
    "workflowId": workflowId,
  });
}

class ConversationProjectionResult {
  final String conversationId;
  final TaskStatus status;
  final String waitingReason;

  ConversationProjectionResult({
    required this.conversationId,
    required this.status,
    required this.waitingReason,
  });

  factory ConversationProjectionResult.fromJson(Map<String, dynamic> json) =>
      ConversationProjectionResult(
        conversationId: json["conversationId"],
        status: taskStatusValues.map[json["status"]]!,
        waitingReason: json["waitingReason"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "conversationId": conversationId,
    "status": taskStatusValues.reverse[status],
    "waitingReason": waitingReason,
  });
}

///FreshApprovalAdmission Activity 发往 Core service API 的请求（.design/06 §4）：active HUMAN、fresh
///选择器 permission、owner 对账与职责分离由 Core 判定。
class FreshApprovalAdmissionRequest {
  final String approvalWorkflowId;
  final String approverPrincipalId;
  final ApprovalDecision decision;

  FreshApprovalAdmissionRequest({
    required this.approvalWorkflowId,
    required this.approverPrincipalId,
    required this.decision,
  });

  factory FreshApprovalAdmissionRequest.fromJson(Map<String, dynamic> json) =>
      FreshApprovalAdmissionRequest(
        approvalWorkflowId: json["approvalWorkflowId"],
        approverPrincipalId: json["approverPrincipalId"],
        decision: approvalDecisionValues.map[json["decision"]]!,
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "approvalWorkflowId": approvalWorkflowId,
    "approverPrincipalId": approverPrincipalId,
    "decision": approvalDecisionValues.reverse[decision],
  });
}

///FreshApprovalAdmission 的结论。admitted=false 时 reason 必有；该结论作为一条被拒决定进入 history，而不是
///pre-history 拒绝。
class FreshApprovalAdmissionResult {
  final bool admitted;
  final ReasonCode? reason;
  final List<ApprovalSelector> satisfiedSelectors;

  FreshApprovalAdmissionResult({
    required this.admitted,
    this.reason,
    required this.satisfiedSelectors,
  });

  factory FreshApprovalAdmissionResult.fromJson(Map<String, dynamic> json) =>
      FreshApprovalAdmissionResult(
        admitted: json["admitted"],
        reason: json["reason"] == null
            ? null
            : reasonCodeValues.map[json["reason"]]!,
        satisfiedSelectors: List<ApprovalSelector>.from(
          json["satisfiedSelectors"].map((x) => approvalSelectorValues.map[x]!),
        ),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "admitted": admitted,
    "reason": reasonCodeValues.reverse[reason],
    "satisfiedSelectors": List<dynamic>.from(
      satisfiedSelectors.map((x) => approvalSelectorValues.reverse[x]),
    ),
  });
}

class ProtocolSessionReconcileRequest {
  final bool cancelRequested;
  final ProtocolSessionReconcileRound? round;
  final String runId;
  final ProtocolSessionReconcileTarget target;

  ProtocolSessionReconcileRequest({
    required this.cancelRequested,
    this.round,
    required this.runId,
    required this.target,
  });

  factory ProtocolSessionReconcileRequest.fromJson(Map<String, dynamic> json) =>
      ProtocolSessionReconcileRequest(
        cancelRequested: json["cancelRequested"],
        round: json["round"] == null
            ? null
            : ProtocolSessionReconcileRound.fromJson(json["round"]),
        runId: json["runId"],
        target: ProtocolSessionReconcileTarget.fromJson(json["target"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "cancelRequested": cancelRequested,
    "round": round?.toJson(),
    "runId": runId,
    "target": target.toJson(),
  });
}

///Actual original Session snapshot. The Activity result freezes this query round into
///history, not into a new authority.
class ProtocolSessionReconcileRound {
  final int sessionVersion;
  final ProtocolSessionReconcileRoundState state;
  final ProtocolWriteObservation? writeObservation;

  ProtocolSessionReconcileRound({
    required this.sessionVersion,
    required this.state,
    this.writeObservation,
  });

  factory ProtocolSessionReconcileRound.fromJson(Map<String, dynamic> json) =>
      ProtocolSessionReconcileRound(
        sessionVersion: json["sessionVersion"],
        state: protocolSessionReconcileRoundStateValues.map[json["state"]]!,
        writeObservation: json["writeObservation"] == null
            ? null
            : ProtocolWriteObservation.fromJson(json["writeObservation"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "sessionVersion": sessionVersion,
    "state": protocolSessionReconcileRoundStateValues.reverse[state],
    "writeObservation": writeObservation?.toJson(),
  });
}

///DD-90: immutable first UNKNOWN input for the original Session's one Workflow.
class ProtocolSessionReconcileTarget {
  final String actionDefinitionId;
  final String actionExecutionId;
  final String baseRevision;
  final String bindingId;
  final String correlationRef;
  final String nativeObjectRef;
  final int projectionGeneration;
  final String protocolSessionId;
  final String releaseId;
  final int sessionVersion;
  final String workflowId;

  ProtocolSessionReconcileTarget({
    required this.actionDefinitionId,
    required this.actionExecutionId,
    required this.baseRevision,
    required this.bindingId,
    required this.correlationRef,
    required this.nativeObjectRef,
    required this.projectionGeneration,
    required this.protocolSessionId,
    required this.releaseId,
    required this.sessionVersion,
    required this.workflowId,
  });

  factory ProtocolSessionReconcileTarget.fromJson(Map<String, dynamic> json) =>
      ProtocolSessionReconcileTarget(
        actionDefinitionId: json["actionDefinitionId"],
        actionExecutionId: json["actionExecutionId"],
        baseRevision: json["baseRevision"],
        bindingId: json["bindingId"],
        correlationRef: json["correlationRef"],
        nativeObjectRef: json["nativeObjectRef"],
        projectionGeneration: json["projectionGeneration"],
        protocolSessionId: json["protocolSessionId"],
        releaseId: json["releaseId"],
        sessionVersion: json["sessionVersion"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionDefinitionId": actionDefinitionId,
    "actionExecutionId": actionExecutionId,
    "baseRevision": baseRevision,
    "bindingId": bindingId,
    "correlationRef": correlationRef,
    "nativeObjectRef": nativeObjectRef,
    "projectionGeneration": projectionGeneration,
    "protocolSessionId": protocolSessionId,
    "releaseId": releaseId,
    "sessionVersion": sessionVersion,
    "workflowId": workflowId,
  });
}

class ProtocolSessionReconcileResult {
  final String protocolSessionId;
  final ProtocolSessionReconcileRound round;
  final TaskStatus status;
  final String waitingReason;

  ProtocolSessionReconcileResult({
    required this.protocolSessionId,
    required this.round,
    required this.status,
    required this.waitingReason,
  });

  factory ProtocolSessionReconcileResult.fromJson(Map<String, dynamic> json) =>
      ProtocolSessionReconcileResult(
        protocolSessionId: json["protocolSessionId"],
        round: ProtocolSessionReconcileRound.fromJson(json["round"]),
        status: taskStatusValues.map[json["status"]]!,
        waitingReason: json["waitingReason"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "protocolSessionId": protocolSessionId,
    "round": round.toJson(),
    "status": taskStatusValues.reverse[status],
    "waitingReason": waitingReason,
  });
}

class ResourceExportAdvanceRequest {
  final bool cancelRequested;
  final String runId;
  final ResourceExportTarget target;

  ResourceExportAdvanceRequest({
    required this.cancelRequested,
    required this.runId,
    required this.target,
  });

  factory ResourceExportAdvanceRequest.fromJson(Map<String, dynamic> json) =>
      ResourceExportAdvanceRequest(
        cancelRequested: json["cancelRequested"],
        runId: json["runId"],
        target: ResourceExportTarget.fromJson(json["target"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "cancelRequested": cancelRequested,
    "runId": runId,
    "target": target.toJson(),
  });
}

///06 §7.1、DD-42：源 Tenant 的 RESOURCE_EXPORT 冻结目标。只引用本 Tenant 的 ActionExecution、来源
///Resource、准入时预写的 ExportPackage Asset 与 TransferFormat；不携带包字节或任何来源内容。
class ResourceExportTarget {
  final String actionExecutionId;
  final String formatKey;
  final String packageAssetId;
  final String sourceResourceId;
  final String workflowId;

  ResourceExportTarget({
    required this.actionExecutionId,
    required this.formatKey,
    required this.packageAssetId,
    required this.sourceResourceId,
    required this.workflowId,
  });

  factory ResourceExportTarget.fromJson(Map<String, dynamic> json) =>
      ResourceExportTarget(
        actionExecutionId: json["actionExecutionId"],
        formatKey: json["formatKey"],
        packageAssetId: json["packageAssetId"],
        sourceResourceId: json["sourceResourceId"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "formatKey": formatKey,
    "packageAssetId": packageAssetId,
    "sourceResourceId": sourceResourceId,
    "workflowId": workflowId,
  });
}

class ResourceExportAdvanceResult {
  final String packageAssetId;
  final TaskStatus status;
  final String waitingReason;

  ResourceExportAdvanceResult({
    required this.packageAssetId,
    required this.status,
    required this.waitingReason,
  });

  factory ResourceExportAdvanceResult.fromJson(Map<String, dynamic> json) =>
      ResourceExportAdvanceResult(
        packageAssetId: json["packageAssetId"],
        status: taskStatusValues.map[json["status"]]!,
        waitingReason: json["waitingReason"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "packageAssetId": packageAssetId,
    "status": taskStatusValues.reverse[status],
    "waitingReason": waitingReason,
  });
}

class ResourceImportAdvanceRequest {
  final bool cancelRequested;
  final String runId;
  final ResourceImportTarget target;

  ResourceImportAdvanceRequest({
    required this.cancelRequested,
    required this.runId,
    required this.target,
  });

  factory ResourceImportAdvanceRequest.fromJson(Map<String, dynamic> json) =>
      ResourceImportAdvanceRequest(
        cancelRequested: json["cancelRequested"],
        runId: json["runId"],
        target: ResourceImportTarget.fromJson(json["target"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "cancelRequested": cancelRequested,
    "runId": runId,
    "target": target.toJson(),
  });
}

///06 §7.1、DD-42：目标 Tenant 的 RESOURCE_IMPORT 冻结目标。只引用本 Tenant 的 ActionExecution、新建
///Resource/Asset 与包 format/digest；不携带包字节、来源 Tenant 或来源 ID。
class ResourceImportTarget {
  final String actionExecutionId;
  final String formatKey;
  final String packageDigest;
  final String resourceId;
  final String versionAssetId;
  final String workflowId;

  ResourceImportTarget({
    required this.actionExecutionId,
    required this.formatKey,
    required this.packageDigest,
    required this.resourceId,
    required this.versionAssetId,
    required this.workflowId,
  });

  factory ResourceImportTarget.fromJson(Map<String, dynamic> json) =>
      ResourceImportTarget(
        actionExecutionId: json["actionExecutionId"],
        formatKey: json["formatKey"],
        packageDigest: json["packageDigest"],
        resourceId: json["resourceId"],
        versionAssetId: json["versionAssetId"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "formatKey": formatKey,
    "packageDigest": packageDigest,
    "resourceId": resourceId,
    "versionAssetId": versionAssetId,
    "workflowId": workflowId,
  });
}

class ResourceImportAdvanceResult {
  final String resourceId;
  final TaskStatus status;
  final String waitingReason;

  ResourceImportAdvanceResult({
    required this.resourceId,
    required this.status,
    required this.waitingReason,
  });

  factory ResourceImportAdvanceResult.fromJson(Map<String, dynamic> json) =>
      ResourceImportAdvanceResult(
        resourceId: json["resourceId"],
        status: taskStatusValues.map[json["status"]]!,
        waitingReason: json["waitingReason"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "resourceId": resourceId,
    "status": taskStatusValues.reverse[status],
    "waitingReason": waitingReason,
  });
}

class ResourceProvisionAdvanceRequest {
  final bool cancelRequested;
  final String runId;
  final ResourceProvisionTarget target;

  ResourceProvisionAdvanceRequest({
    required this.cancelRequested,
    required this.runId,
    required this.target,
  });

  factory ResourceProvisionAdvanceRequest.fromJson(Map<String, dynamic> json) =>
      ResourceProvisionAdvanceRequest(
        cancelRequested: json["cancelRequested"],
        runId: json["runId"],
        target: ResourceProvisionTarget.fromJson(json["target"]),
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "cancelRequested": cancelRequested,
    "runId": runId,
    "target": target.toJson(),
  });
}

class ResourceProvisionTarget {
  final String actionExecutionId;
  final String bindingId;
  final int bindingVersion;
  final String componentReleaseId;
  final String nativeInstanceRef;
  final String nativeScopeRef;
  final int projectionGeneration;
  final ResourceCreate reference;
  final String resourceId;
  final int resourceVersion;
  final String workflowId;

  ResourceProvisionTarget({
    required this.actionExecutionId,
    required this.bindingId,
    required this.bindingVersion,
    required this.componentReleaseId,
    required this.nativeInstanceRef,
    required this.nativeScopeRef,
    required this.projectionGeneration,
    required this.reference,
    required this.resourceId,
    required this.resourceVersion,
    required this.workflowId,
  });

  factory ResourceProvisionTarget.fromJson(Map<String, dynamic> json) =>
      ResourceProvisionTarget(
        actionExecutionId: json["actionExecutionId"],
        bindingId: json["bindingId"],
        bindingVersion: json["bindingVersion"],
        componentReleaseId: json["componentReleaseId"],
        nativeInstanceRef: json["nativeInstanceRef"],
        nativeScopeRef: json["nativeScopeRef"],
        projectionGeneration: json["projectionGeneration"],
        reference: ResourceCreate.fromJson(json["reference"]),
        resourceId: json["resourceId"],
        resourceVersion: json["resourceVersion"],
        workflowId: json["workflowId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "actionExecutionId": actionExecutionId,
    "bindingId": bindingId,
    "bindingVersion": bindingVersion,
    "componentReleaseId": componentReleaseId,
    "nativeInstanceRef": nativeInstanceRef,
    "nativeScopeRef": nativeScopeRef,
    "projectionGeneration": projectionGeneration,
    "reference": reference.toJson(),
    "resourceId": resourceId,
    "resourceVersion": resourceVersion,
    "workflowId": workflowId,
  });
}

class ResourceProvisionAdvanceResult {
  final String resourceId;
  final TaskStatus status;
  final String waitingReason;

  ResourceProvisionAdvanceResult({
    required this.resourceId,
    required this.status,
    required this.waitingReason,
  });

  factory ResourceProvisionAdvanceResult.fromJson(Map<String, dynamic> json) =>
      ResourceProvisionAdvanceResult(
        resourceId: json["resourceId"],
        status: taskStatusValues.map[json["status"]]!,
        waitingReason: json["waitingReason"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "resourceId": resourceId,
    "status": taskStatusValues.reverse[status],
    "waitingReason": waitingReason,
  });
}

///TENANT_LIFECYCLE DELETE Activity 只推进已准入且已冻结的 Tenant 删除，不重新解析绑定或建立新快照。
class TenantDeleteAdvanceRequest {
  final bool cancelRequested;
  final String snapshotId;
  final String tenantId;
  final int tenantVersion;

  TenantDeleteAdvanceRequest({
    required this.cancelRequested,
    required this.snapshotId,
    required this.tenantId,
    required this.tenantVersion,
  });

  factory TenantDeleteAdvanceRequest.fromJson(Map<String, dynamic> json) =>
      TenantDeleteAdvanceRequest(
        cancelRequested: json["cancelRequested"],
        snapshotId: json["snapshotId"],
        tenantId: json["tenantId"],
        tenantVersion: json["tenantVersion"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "cancelRequested": cancelRequested,
    "snapshotId": snapshotId,
    "tenantId": tenantId,
    "tenantVersion": tenantVersion,
  });
}

///Core 返回已经持久化的删除推进事实；UNKNOWN 由错误分类表达，不伪装为 completed 或 canceled。原生证据只保留引用。
class TenantDeleteAdvanceResult {
  final bool canceled;
  final bool completed;
  final bool irreversibleDispatchStarted;
  final String? nativeInventoryDigest;
  final String? nativeRequestId;
  final String snapshotId;
  final String subprocessId;

  TenantDeleteAdvanceResult({
    required this.canceled,
    required this.completed,
    required this.irreversibleDispatchStarted,
    this.nativeInventoryDigest,
    this.nativeRequestId,
    required this.snapshotId,
    required this.subprocessId,
  });

  factory TenantDeleteAdvanceResult.fromJson(Map<String, dynamic> json) =>
      TenantDeleteAdvanceResult(
        canceled: json["canceled"],
        completed: json["completed"],
        irreversibleDispatchStarted: json["irreversibleDispatchStarted"],
        nativeInventoryDigest: json["nativeInventoryDigest"],
        nativeRequestId: json["nativeRequestId"],
        snapshotId: json["snapshotId"],
        subprocessId: json["subprocessId"],
      );

  Map<String, dynamic> toJson() => _stripNulls({
    "canceled": canceled,
    "completed": completed,
    "irreversibleDispatchStarted": irreversibleDispatchStarted,
    "nativeInventoryDigest": nativeInventoryDigest,
    "nativeRequestId": nativeRequestId,
    "snapshotId": snapshotId,
    "subprocessId": subprocessId,
  });
}

class EnumValues<T> {
  Map<String, T> map;
  late Map<T, String> reverseMap;

  EnumValues(this.map);

  Map<T, String> get reverse {
    reverseMap = map.map((k, v) => MapEntry(v, k));
    return reverseMap;
  }
}

/// 去掉值为 null 的键。缺省的可选字段必须在线格式中省略而不是写成 null——
/// schema 未把 null 列入这些字段的类型，且可用子集禁止联合类型。
/// 由 tools/gen.sh 在生成后注入，不手工编辑。
Map<String, dynamic> _stripNulls(Map<String, dynamic> m) =>
    Map<String, dynamic>.fromEntries(m.entries.where((e) => e.value != null));
