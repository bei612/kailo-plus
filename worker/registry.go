package main

import "apps/worker/activities"

// activityRegistrar is the part of the Temporal worker that registers Activities.
type activityRegistrar interface {
	RegisterActivity(a interface{})
}

// registerActivities registers every Activity the Workflows schedule. Workflows
// reference the same method values as (*T).Method, so the two sides must match;
// registry_test.go derives the expected set from workflows/ and fails on any
// missing or extra registration (a missing one only surfaces at run time as an
// endless "unable to find activityType" retry).
func registerActivities(w activityRegistrar, spicedb *activities.SpiceDB, core *activities.CoreAPI) {
	w.RegisterActivity(spicedb.Converge)
	w.RegisterActivity(spicedb.RevokeSubject)
	w.RegisterActivity(core.ProjectTaskState)
	w.RegisterActivity(core.ProjectBuzzRoster)
	w.RegisterActivity(core.ProjectBuzzIdentity)
	w.RegisterActivity(core.ProjectConversation)
	w.RegisterActivity(core.TransitionMembership)
	w.RegisterActivity(core.ProvisionTenantBuzz)
	w.RegisterActivity(core.VerifyTenantBuzz)
	w.RegisterActivity(core.ProvisionWorkspaceBuzz)
	w.RegisterActivity(core.ConvergeWorkspaceChannelArchive)
	w.RegisterActivity(core.ConvergeWorkspaceChannelMetadata)
	w.RegisterActivity(core.ConvergeWorkspaceChannelRoster)
	w.RegisterActivity(core.ConvergeTenantCommunityArchive)
	w.RegisterActivity(core.ReconcileTenantRestore)
	w.RegisterActivity(core.AdvanceTenantDelete)
	w.RegisterActivity(core.TransitionScope)
	w.RegisterActivity(core.ProjectApprovalState)
	w.RegisterActivity(core.FreshApprovalAdmission)
	w.RegisterActivity(core.AdvanceSecretRefRehome)
	w.RegisterActivity(core.AdvanceAgentTask)
	w.RegisterActivity(core.AdmitAutomationSchedule)
	w.RegisterActivity(core.AdvanceAgentInstallation)
	w.RegisterActivity(core.AdvanceApplicationBinding)
	w.RegisterActivity(core.AdvanceResourceProvision)
	w.RegisterActivity(core.AdvanceResourceTransfer)
	w.RegisterActivity(core.AdvanceComponentAction)
	w.RegisterActivity(core.AdvanceProtocolSession)
	w.RegisterActivity(core.RunComponentConformanceStep)
	w.RegisterActivity(core.RecordComponentConformance)
	w.RegisterActivity(core.ProjectAgentTaskState)
	w.RegisterActivity(core.ApproveComponentRelease)
}
