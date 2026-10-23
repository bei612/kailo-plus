package service

import (
	"context"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// DD-138(4), 07 §4.8.3: a new knowledge base or agent share is announced to
// the people who gained access through it (Kailo notification category
// SHARED). The upstream share services stay unchanged; these decorators only
// observe a successful new share. A permission change of an existing share
// (the same call on an existing share) is not announced again.

type kailoNotifyingKBShareService struct {
	interfaces.KBShareService
	shares   interfaces.KBShareRepository
	notifier *KailoNotifier
}

// DecorateKBShareServiceForKailo wraps the KB share service when Kailo
// notifications are enabled; otherwise it returns the service unchanged.
func DecorateKBShareServiceForKailo(
	inner interfaces.KBShareService, shares interfaces.KBShareRepository, notifier *KailoNotifier,
) interfaces.KBShareService {
	if !notifier.Enabled() || inner == nil || shares == nil {
		return inner
	}
	return &kailoNotifyingKBShareService{KBShareService: inner, shares: shares, notifier: notifier}
}

func (s *kailoNotifyingKBShareService) ShareKnowledgeBase(
	ctx context.Context, kbID string, orgID string, userID string, tenantID uint64, permission types.OrgMemberRole,
) (*types.KnowledgeBaseShare, error) {
	existing, lookupErr := s.shares.GetByKBAndOrg(ctx, kbID, orgID)
	existed := lookupErr == nil && existing != nil
	share, err := s.KBShareService.ShareKnowledgeBase(ctx, kbID, orgID, userID, tenantID, permission)
	if err == nil && share != nil && !existed {
		s.notifier.NotifyKnowledgeBaseShared(share)
	}
	return share, err
}

type kailoNotifyingAgentShareService struct {
	interfaces.AgentShareService
	shares   interfaces.AgentShareRepository
	notifier *KailoNotifier
}

// DecorateAgentShareServiceForKailo wraps the agent share service when Kailo
// notifications are enabled; otherwise it returns the service unchanged.
func DecorateAgentShareServiceForKailo(
	inner interfaces.AgentShareService, shares interfaces.AgentShareRepository, notifier *KailoNotifier,
) interfaces.AgentShareService {
	if !notifier.Enabled() || inner == nil || shares == nil {
		return inner
	}
	return &kailoNotifyingAgentShareService{AgentShareService: inner, shares: shares, notifier: notifier}
}

func (s *kailoNotifyingAgentShareService) ShareAgent(
	ctx context.Context, agentID string, orgID string, userID string, tenantID uint64, permission types.OrgMemberRole,
) (*types.AgentShare, error) {
	existing, lookupErr := s.shares.GetByAgentAndOrg(ctx, agentID, orgID)
	existed := lookupErr == nil && existing != nil
	share, err := s.AgentShareService.ShareAgent(ctx, agentID, orgID, userID, tenantID, permission)
	if err == nil && share != nil && !existed {
		s.notifier.NotifyAgentShared(share)
	}
	return share, err
}
