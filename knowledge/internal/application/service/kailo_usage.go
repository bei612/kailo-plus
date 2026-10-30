package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// Kailo unified metering (DD-165, 07 §4.8.9). In Kailo mode a knowledge
// answer is a Kailo quota item: before a member starts a question the
// instance asks Core for admission, and when an answer has been completed it
// reports one `knowledge_answer_count` usage. Both calls use the member
// directory client (kailo_service_token.go) — the same configuration and
// all-or-none rule as the directory read and the notification delivery.
//
//	POST {core_url}/service/v1/component-usage/bindings/{binding}/admission
//	POST {core_url}/service/v1/component-usage/bindings/{binding}/reports
//
// Admission is CHECK: an exhausted Tenant quota, a reached per-member limit,
// an unavailable Core or an unverifiable identity all refuse the new question
// before anything is retrieved or a model is called. An ALLOWED answer is
// cached for at most a minute per member. Reports never block the business
// request: a bounded in-memory queue drained by one worker, the same key on
// every retry (429/503/network), no retry on 400/403/409. A report lost with
// the process only under-counts; it never counts twice (Core de-duplicates
// by binding + key). Logs carry the binding, the meter and the HTTP status,
// never identities, questions or tokens.

const (
	kailoUsageMeterKnowledgeAnswer = "knowledge_answer_count"
	kailoUsageQueueCapacity        = 4096
	kailoUsageRequestTimeout       = 10 * time.Second
	kailoUsageAllowedTTL           = 60 * time.Second
	kailoUsageResponseMaxBytes     = 16 << 10
)

// Admission outcomes (contract enums/component_usage_decision).
const (
	KailoUsageAllowed               = "ALLOWED"
	KailoUsageTenantQuotaExhausted  = "TENANT_QUOTA_EXHAUSTED"
	KailoUsageMemberQuotaExhausted  = "MEMBER_QUOTA_EXHAUSTED"
	// KailoUsageQuotaNotConfigured: Core has not aligned this quota item yet
	// (DD-165(5)), or an older Core has no usage contract at all (404).
	KailoUsageQuotaNotConfigured = "QUOTA_NOT_CONFIGURED"
	KailoUsageDependencyUnavailable = "DEPENDENCY_UNAVAILABLE"
)

var kailoUsageBackoff = []time.Duration{10 * time.Second, 30 * time.Second, 60 * time.Second, 120 * time.Second, 300 * time.Second}

// kailoUsageReport is the ComponentUsageReport contract body.
type kailoUsageReport struct {
	IdempotencyKey string             `json:"idempotencyKey"`
	MeterKey       string             `json:"meterKey"`
	Quantity       int64              `json:"quantity"`
	OccurredAt     string             `json:"occurredAt"`
	Member         *kailoNotifyPerson `json:"member,omitempty"`
}

type kailoUsageAdmissionRequest struct {
	MeterKey string             `json:"meterKey"`
	Member   *kailoNotifyPerson `json:"member,omitempty"`
}

type kailoUsageAdmission struct {
	Decision string `json:"decision"`
}

// KailoUsage is this instance's Kailo metering client.
type KailoUsage struct {
	bindingID string
	base      string
	tokens    *kailoServiceTokenSource
	http      *http.Client
	users     interfaces.UserRepository
	backoff   []time.Duration
	now       func() time.Time

	mu      sync.Mutex
	queue   []kailoUsageReport
	dropped int
	allowed map[string]time.Time
	wake    chan struct{}

	startOnce sync.Once
	stopOnce  sync.Once
	ctx       context.Context
	cancel    context.CancelFunc
	wg        sync.WaitGroup
}

// NewKailoUsage is enabled exactly when the member directory is configured.
func NewKailoUsage(cfg *config.Config, users interfaces.UserRepository) *KailoUsage {
	u := &KailoUsage{
		users:   users,
		backoff: kailoUsageBackoff,
		now:     time.Now,
		allowed: map[string]time.Time{},
		wake:    make(chan struct{}, 1),
	}
	d := cfg.KailoDirectory()
	if d == nil || users == nil {
		return u
	}
	client := newKailoServiceHTTPClient(kailoUsageRequestTimeout)
	u.http = client
	u.tokens = newKailoServiceTokenSource(*d, client)
	u.bindingID = d.BindingID
	u.base = strings.TrimRight(d.CoreURL, "/") + "/service/v1/component-usage/bindings/" + url.PathEscape(d.BindingID)
	return u
}

// Enabled reports whether Kailo metering applies to this instance.
func (u *KailoUsage) Enabled() bool {
	return u != nil && u.base != ""
}

// Start launches the report worker (no-op when disabled).
func (u *KailoUsage) Start(ctx context.Context) {
	if !u.Enabled() {
		return
	}
	u.startOnce.Do(func() {
		u.mu.Lock()
		u.ctx, u.cancel = context.WithCancel(ctx)
		u.mu.Unlock()
		u.wg.Add(1)
		go u.run()
	})
}

// Stop ends the worker and waits for it.
func (u *KailoUsage) Stop() {
	if u == nil {
		return
	}
	u.stopOnce.Do(func() {
		u.mu.Lock()
		cancel := u.cancel
		u.mu.Unlock()
		if cancel != nil {
			cancel()
		}
		u.wg.Wait()
	})
}

// AdmitKnowledgeAnswer asks Core whether the member may start a new
// knowledge answer. Anything but ALLOWED refuses (fail closed).
func (u *KailoUsage) AdmitKnowledgeAnswer(ctx context.Context, userID string) string {
	if !u.Enabled() {
		return KailoUsageAllowed
	}
	person, ok := u.person(ctx, userID)
	if !ok {
		// Without a verified OIDC identity nobody can be metered: refuse.
		return KailoUsageDependencyUnavailable
	}
	cacheKey := kailoUsageMeterKnowledgeAnswer + "\x00" + person.Issuer + "\x00" + person.Subject
	u.mu.Lock()
	until, cached := u.allowed[cacheKey]
	u.mu.Unlock()
	if cached && u.now().Before(until) {
		return KailoUsageAllowed
	}
	body, err := json.Marshal(kailoUsageAdmissionRequest{MeterKey: kailoUsageMeterKnowledgeAnswer, Member: &person})
	if err != nil {
		return KailoUsageDependencyUnavailable
	}
	decision := u.admission(ctx, body)
	if decision == KailoUsageAllowed {
		u.mu.Lock()
		u.allowed[cacheKey] = u.now().Add(kailoUsageAllowedTTL)
		u.mu.Unlock()
	}
	logger.Infof(ctx, "[kailo] usage admission: binding=%s meter=%s decision=%s", u.bindingID, kailoUsageMeterKnowledgeAnswer, decision)
	return decision
}

func (u *KailoUsage) admission(ctx context.Context, body []byte) string {
	for attempt := 0; attempt < 2; attempt++ {
		status, raw := u.post(ctx, u.base+"/admission", body)
		switch {
		case status == http.StatusOK:
			var answer kailoUsageAdmission
			if json.Unmarshal(raw, &answer) != nil {
				return KailoUsageDependencyUnavailable
			}
			switch answer.Decision {
			case KailoUsageAllowed, KailoUsageTenantQuotaExhausted, KailoUsageMemberQuotaExhausted,
				KailoUsageQuotaNotConfigured:
				return answer.Decision
			}
			return KailoUsageDependencyUnavailable
		case status == http.StatusNotFound:
			// The Core this instance talks to has no component usage contract yet.
			return KailoUsageQuotaNotConfigured
		case (status == http.StatusUnauthorized || status == http.StatusForbidden) && attempt == 0:
			u.tokens.Invalidate()
			continue
		default:
			return KailoUsageDependencyUnavailable
		}
	}
	return KailoUsageDependencyUnavailable
}

// ReportKnowledgeAnswer queues one completed answer of the member. The key
// derives from the native assistant message ID, so a replay is de-duplicated.
func (u *KailoUsage) ReportKnowledgeAnswer(ctx context.Context, userID, messageID string, finished time.Time) {
	if !u.Enabled() || userID == "" || messageID == "" {
		return
	}
	person, ok := u.person(ctx, userID)
	if !ok {
		logger.Warnf(ctx, "[kailo] usage not reported: binding=%s meter=%s (no verified identity)", u.bindingID, kailoUsageMeterKnowledgeAnswer)
		return
	}
	if finished.IsZero() {
		finished = u.now()
	}
	report := kailoUsageReport{
		IdempotencyKey: kailoNotifyKey("weknora.answer", messageID),
		MeterKey:       kailoUsageMeterKnowledgeAnswer,
		Quantity:       1,
		OccurredAt:     finished.UTC().Format(time.RFC3339),
		Member:         &person,
	}
	u.mu.Lock()
	if len(u.queue) >= kailoUsageQueueCapacity {
		u.queue = u.queue[1:]
		u.dropped++
		logger.Warnf(ctx, "[kailo] usage queue full: binding=%s dropped=%d", u.bindingID, u.dropped)
	}
	u.queue = append(u.queue, report)
	u.mu.Unlock()
	select {
	case u.wake <- struct{}{}:
	default:
	}
}

func (u *KailoUsage) person(ctx context.Context, userID string) (kailoNotifyPerson, bool) {
	if u.users == nil || userID == "" {
		return kailoNotifyPerson{}, false
	}
	users, err := u.users.GetUsersByIDs(ctx, []string{userID})
	if err != nil {
		return kailoNotifyPerson{}, false
	}
	user := users[userID]
	if user == nil || !user.IsActive || user.OIDCIssuer == nil || user.OIDCSubject == nil ||
		strings.TrimSpace(*user.OIDCIssuer) == "" || strings.TrimSpace(*user.OIDCSubject) == "" {
		return kailoNotifyPerson{}, false
	}
	return kailoNotifyPerson{Issuer: *user.OIDCIssuer, Subject: *user.OIDCSubject}, true
}

func (u *KailoUsage) next() (kailoUsageReport, bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	if len(u.queue) == 0 {
		return kailoUsageReport{}, false
	}
	report := u.queue[0]
	u.queue = u.queue[1:]
	return report, true
}

func (u *KailoUsage) run() {
	defer u.wg.Done()
	for {
		report, ok := u.next()
		if !ok {
			select {
			case <-u.ctx.Done():
				return
			case <-u.wake:
				continue
			}
		}
		u.deliver(u.ctx, report)
	}
}

// deliver posts one report: 201/200 done; 401/403 refetch the token once;
// 429, 5xx and network failures retry with the same key and body; any other
// answer (400, 403 after refetch, 404, 409) is final.
func (u *KailoUsage) deliver(ctx context.Context, report kailoUsageReport) {
	body, err := json.Marshal(report)
	if err != nil {
		return
	}
	retries := 0
	reauthorized := false
	for {
		status, _ := u.post(ctx, u.base+"/reports", body)
		switch {
		case status == http.StatusCreated || status == http.StatusOK:
			logger.Infof(ctx, "[kailo] usage reported: binding=%s meter=%s status=%d", u.bindingID, report.MeterKey, status)
			return
		case (status == http.StatusUnauthorized || status == http.StatusForbidden) && !reauthorized:
			reauthorized = true
			u.tokens.Invalidate()
			continue
		case status == 0 || status == http.StatusTooManyRequests || status >= http.StatusInternalServerError:
			if retries >= len(u.backoff) {
				logger.Warnf(ctx, "[kailo] usage not reported after retries: binding=%s meter=%s status=%d", u.bindingID, report.MeterKey, status)
				return
			}
			timer := time.NewTimer(u.backoff[retries])
			retries++
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		case status == http.StatusNotFound:
			logger.Warnf(ctx, "[kailo] usage report not accepted: binding=%s meter=%s — Kailo Core has no component usage contract yet (deploy Core with DD-165 first)", u.bindingID, report.MeterKey)
			return
		default:
			logger.Warnf(ctx, "[kailo] usage report refused: binding=%s meter=%s status=%d", u.bindingID, report.MeterKey, status)
			return
		}
	}
}

// post returns Core's HTTP status and bounded body, or 0 without an answer.
func (u *KailoUsage) post(ctx context.Context, target string, body []byte) (int, []byte) {
	token, err := u.tokens.Token(ctx)
	if err != nil {
		return 0, nil
	}
	ctx, cancel := context.WithTimeout(ctx, kailoUsageRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return 0, nil
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := u.http.Do(req)
	if err != nil {
		return 0, nil
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, kailoUsageResponseMaxBytes))
	return resp.StatusCode, raw
}

// KailoUsageRefusalText is the Kailo wording shown in place of a refused
// question (07 §4.8.9 component behaviour), in the requested language.
func KailoUsageRefusalText(decision, acceptLanguage string) string {
	english := strings.HasPrefix(strings.ToLower(strings.TrimSpace(acceptLanguage)), "en")
	switch decision {
	case KailoUsageTenantQuotaExhausted:
		if english {
			return "Your organization's Knowledge Engineering answer quota for this month is used up. Contact an admin."
		}
		return "组织本月的知识工程问答额度已用完，请联系管理员。"
	case KailoUsageMemberQuotaExhausted:
		if english {
			return "Your Knowledge Engineering answer quota for this month is used up."
		}
		return "你本月的知识工程问答额度已用完。"
	case KailoUsageQuotaNotConfigured:
		if english {
			return "Your organization's usage quota is not yet set up in Kailo, so questions cannot be asked yet. Contact an admin."
		}
		return "本组织的用量额度尚未在 Kailo 中完成登记，暂不能提问，请联系管理员。"
	default:
		if english {
			return "The usage service is unavailable right now. Please try again later."
		}
		return "用量服务暂不可用，请稍后再试。"
	}
}
