package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// Kailo notification delivery (DD-138(4), 07 §4.8.3): in Kailo mode this
// instance tells Core about events a person should hear of, and Core shows
// them in the one Kailo notification centre. Delivery is
//
//	POST {core_url}/service/v1/component-notifications/bindings/{binding}/notifications
//
// with a token of the member directory client (kailo_service_token.go). It is
// enabled exactly when the member directory is (Kailo mode and the complete
// directory configuration); otherwise every Notify* call is a no-op.
//
// Delivery never blocks or fails the business request that caused it: events
// go into a bounded in-memory queue (oldest dropped when full) and a
// background worker resolves recipients and posts them. Logs carry only the
// binding, the category and the HTTP status — never titles, summaries,
// paths, identities or tokens.

// Notification categories used by this component (contract
// enums/component_notification_category).
const (
	KailoNotifyCategoryShared        = "SHARED"
	KailoNotifyCategoryTaskCompleted = "TASK_COMPLETED"
)

const (
	kailoNotifyQueueCapacity    = 4096
	kailoNotifyConcurrency      = 4
	kailoNotifyMaxRecipients    = 2000
	kailoNotifyRequestTimeout   = 15 * time.Second
	kailoNotifyResolveTimeout   = 30 * time.Second
	kailoNotifyResponseMaxBytes = 64 << 10
	kailoNotifyTitleMaxRunes    = 120
	kailoNotifySummaryMaxRunes  = 280
	kailoNotifyNameMaxRunes     = 60
	kailoNotifyActorMaxRunes    = 40
	kailoNotifyExcerptMaxRunes  = 60
)

// kailoNotifyBackoff: 429/503/network failures are retried with the same
// key four more times over about four minutes.
var kailoNotifyBackoff = []time.Duration{10 * time.Second, 30 * time.Second, 60 * time.Second, 120 * time.Second}

type kailoNotifyPerson struct {
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
}

type kailoNotifyText struct {
	ZH string `json:"ZH_CN"`
	EN string `json:"EN"`
}

// kailoNotificationDelivery is the ComponentNotificationDelivery contract body.
type kailoNotificationDelivery struct {
	IdempotencyKey string             `json:"idempotencyKey"`
	Recipient      kailoNotifyPerson  `json:"recipient"`
	Actor          *kailoNotifyPerson `json:"actor,omitempty"`
	Category       string             `json:"category"`
	Title          kailoNotifyText    `json:"title"`
	Summary        *kailoNotifyText   `json:"summary,omitempty"`
	Path           string             `json:"path"`
	OccurredAt     string             `json:"occurredAt,omitempty"`
}

// kailoNotifyTask turns one business event into deliveries, off the request
// path (recipient and name lookups happen in the worker).
type kailoNotifyTask func(ctx context.Context) []kailoNotificationDelivery

// KailoNotifier delivers this instance's notifications to Kailo Core.
type KailoNotifier struct {
	bindingID  string
	endpoint   string
	tokens     *kailoServiceTokenSource
	http       *http.Client
	longAnswer time.Duration
	backoff    []time.Duration

	users   interfaces.UserRepository
	orgs    interfaces.OrganizationRepository
	members interfaces.TenantMemberRepository
	kbs     interfaces.KnowledgeBaseRepository
	agents  interfaces.CustomAgentRepository

	mu       sync.Mutex
	queue    []kailoNotifyTask
	capacity int
	dropped  int
	wake     chan struct{}

	startOnce sync.Once
	stopOnce  sync.Once
	ctx       context.Context
	cancel    context.CancelFunc
	wg        sync.WaitGroup
	slots     chan struct{}
}

// NewKailoNotifier constructs the notifier from the configuration; it is
// disabled unless Kailo mode and the member directory are configured.
func NewKailoNotifier(
	cfg *config.Config,
	users interfaces.UserRepository,
	orgs interfaces.OrganizationRepository,
	members interfaces.TenantMemberRepository,
	kbs interfaces.KnowledgeBaseRepository,
	agents interfaces.CustomAgentRepository,
) *KailoNotifier {
	n := &KailoNotifier{
		users:    users,
		orgs:     orgs,
		members:  members,
		kbs:      kbs,
		agents:   agents,
		backoff:  kailoNotifyBackoff,
		capacity: kailoNotifyQueueCapacity,
		wake:     make(chan struct{}, 1),
		slots:    make(chan struct{}, kailoNotifyConcurrency),
	}
	n.longAnswer = cfg.KailoLongAnswerNotifyAfter()
	d := cfg.KailoDirectory()
	if d == nil || users == nil {
		return n
	}
	client := newKailoServiceHTTPClient(kailoNotifyRequestTimeout)
	n.http = client
	n.tokens = newKailoServiceTokenSource(*d, client)
	n.bindingID = d.BindingID
	n.endpoint = strings.TrimRight(d.CoreURL, "/") + "/service/v1/component-notifications/bindings/" +
		url.PathEscape(d.BindingID) + "/notifications"
	return n
}

// Enabled reports whether notifications are delivered at all.
func (n *KailoNotifier) Enabled() bool {
	return n != nil && n.endpoint != ""
}

// Start launches the background worker (no-op when disabled).
func (n *KailoNotifier) Start(ctx context.Context) {
	if !n.Enabled() {
		return
	}
	n.startOnce.Do(func() {
		n.mu.Lock()
		n.ctx, n.cancel = context.WithCancel(ctx)
		n.mu.Unlock()
		n.wg.Add(1)
		go n.run()
	})
}

// Stop ends the worker, cancels pending retries and waits for them.
func (n *KailoNotifier) Stop() {
	if n == nil {
		return
	}
	n.stopOnce.Do(func() {
		n.mu.Lock()
		cancel := n.cancel
		n.mu.Unlock()
		if cancel != nil {
			cancel()
		}
		n.wg.Wait()
	})
}

// enqueue adds a task, dropping the oldest one when the queue is full.
func (n *KailoNotifier) enqueue(task kailoNotifyTask) {
	if !n.Enabled() || task == nil {
		return
	}
	n.mu.Lock()
	if len(n.queue) >= n.capacity {
		n.queue = n.queue[1:]
		n.dropped++
		if n.dropped == 1 || n.dropped%100 == 0 {
			logger.Warnf(context.Background(), "[kailo] notification queue full: binding=%s dropped=%d", n.bindingID, n.dropped)
		}
	}
	n.queue = append(n.queue, task)
	n.mu.Unlock()
	select {
	case n.wake <- struct{}{}:
	default:
	}
}

func (n *KailoNotifier) next() kailoNotifyTask {
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.queue) == 0 {
		return nil
	}
	task := n.queue[0]
	n.queue[0] = nil
	n.queue = n.queue[1:]
	return task
}

func (n *KailoNotifier) run() {
	defer n.wg.Done()
	for {
		task := n.next()
		if task == nil {
			select {
			case <-n.ctx.Done():
				return
			case <-n.wake:
				continue
			}
		}
		for _, delivery := range n.resolve(task) {
			select {
			case <-n.ctx.Done():
				return
			case n.slots <- struct{}{}:
			}
			n.wg.Add(1)
			go func(d kailoNotificationDelivery) {
				defer n.wg.Done()
				defer func() { <-n.slots }()
				n.deliver(n.ctx, d)
			}(delivery)
		}
	}
}

// resolve runs one task; a failing lookup never takes the worker down.
func (n *KailoNotifier) resolve(task kailoNotifyTask) (out []kailoNotificationDelivery) {
	ctx, cancel := context.WithTimeout(n.ctx, kailoNotifyResolveTimeout)
	defer cancel()
	defer func() {
		if recover() != nil {
			logger.Warnf(ctx, "[kailo] notification recipients unavailable: binding=%s", n.bindingID)
			out = nil
		}
	}()
	return task(ctx)
}

// deliver posts one notification: 201/200 done; 401/403 refetch the token
// once; 429, 5xx and network failures retry with the same key and body; any
// other answer (400, 403 after refetch, 404, 409) is final.
func (n *KailoNotifier) deliver(ctx context.Context, d kailoNotificationDelivery) {
	body, err := json.Marshal(d)
	if err != nil {
		return
	}
	retries := 0
	reauthorized := false
	for {
		status := n.post(ctx, body)
		switch {
		case status == http.StatusCreated || status == http.StatusOK:
			logger.Infof(ctx, "[kailo] notification delivered: binding=%s category=%s status=%d", n.bindingID, d.Category, status)
			return
		case (status == http.StatusUnauthorized || status == http.StatusForbidden) && !reauthorized:
			reauthorized = true
			n.tokens.Invalidate()
			continue
		case status == 0 || status == http.StatusTooManyRequests || status >= http.StatusInternalServerError:
			if retries >= len(n.backoff) {
				logger.Warnf(ctx, "[kailo] notification not delivered after retries: binding=%s category=%s status=%d", n.bindingID, d.Category, status)
				return
			}
			timer := time.NewTimer(n.backoff[retries])
			retries++
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		default:
			logger.Warnf(ctx, "[kailo] notification refused: binding=%s category=%s status=%d", n.bindingID, d.Category, status)
			return
		}
	}
}

// post returns Core's HTTP status, or 0 when no answer was obtained.
func (n *KailoNotifier) post(ctx context.Context, body []byte) int {
	token, err := n.tokens.Token(ctx)
	if err != nil {
		return 0
	}
	ctx, cancel := context.WithTimeout(ctx, kailoNotifyRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.endpoint, bytes.NewReader(body))
	if err != nil {
		return 0
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := n.http.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, kailoNotifyResponseMaxBytes))
	return resp.StatusCode
}

// ---- events ----

// NotifyKnowledgeBaseShared tells the people who gained access through a new
// knowledge base share (SHARED).
func (n *KailoNotifier) NotifyKnowledgeBaseShared(share *types.KnowledgeBaseShare) {
	if !n.Enabled() || share == nil {
		return
	}
	s := *share
	occurred := time.Now()
	n.enqueue(func(ctx context.Context) []kailoNotificationDelivery {
		name := ""
		if n.kbs != nil {
			if kb, err := n.kbs.GetKnowledgeBaseByID(ctx, s.KnowledgeBaseID); err == nil && kb != nil {
				name = kb.Name
			}
		}
		path := "/platform/knowledge-bases/" + url.PathEscape(s.KnowledgeBaseID)
		return n.shareDeliveries(ctx, "weknora.kbshare", s.ID, s.OrganizationID, s.SourceTenantID,
			s.SharedByUserID, occurred, path, func(actor kailoNotifyText) (kailoNotifyText, kailoNotifyText) {
				summary := kailoNotifyText{ZH: "你现在可以打开并使用它。", EN: "You can now open and use it."}
				object := kailoNotifyClean(name, kailoNotifyNameMaxRunes)
				if object == "" {
					return kailoNotifyText{ZH: actor.ZH + " 共享了一个知识库", EN: actor.EN + " shared a knowledge base"}, summary
				}
				return kailoNotifyText{ZH: actor.ZH + " 共享了知识库「" + object + "」",
					EN: actor.EN + " shared the knowledge base “" + object + "”"}, summary
			})
	})
}

// NotifyAgentShared tells the people who gained access through a new agent
// share (SHARED).
func (n *KailoNotifier) NotifyAgentShared(share *types.AgentShare) {
	if !n.Enabled() || share == nil {
		return
	}
	s := *share
	s.Agent, s.Organization = nil, nil
	occurred := time.Now()
	n.enqueue(func(ctx context.Context) []kailoNotificationDelivery {
		name := ""
		if n.agents != nil {
			if agent, err := n.agents.GetAgentByID(ctx, s.AgentID, s.SourceTenantID); err == nil && agent != nil {
				name = agent.Name
			}
		}
		// The agent list shows shared agents; there is no per-agent page.
		return n.shareDeliveries(ctx, "weknora.agentshare", s.ID, s.OrganizationID, s.SourceTenantID,
			s.SharedByUserID, occurred, "/platform/agents", func(actor kailoNotifyText) (kailoNotifyText, kailoNotifyText) {
				summary := kailoNotifyText{ZH: "你现在可以在智能体列表中使用它。", EN: "You can now use it from the agent list."}
				object := kailoNotifyClean(name, kailoNotifyNameMaxRunes)
				if object == "" {
					return kailoNotifyText{ZH: actor.ZH + " 共享了一个智能体", EN: actor.EN + " shared an agent"}, summary
				}
				return kailoNotifyText{ZH: actor.ZH + " 共享了智能体「" + object + "」",
					EN: actor.EN + " shared the agent “" + object + "”"}, summary
			})
	})
}

// NotifyAnswerCompleted tells the person who asked that a long-running
// answer is ready (TASK_COMPLETED). Answers faster than the configured
// threshold are not announced: the asker is most likely still watching.
func (n *KailoNotifier) NotifyAnswerCompleted(userID, sessionID, messageID, question string, started, finished time.Time) {
	if !n.Enabled() || userID == "" || sessionID == "" || messageID == "" || started.IsZero() ||
		finished.Sub(started) < n.longAnswer {
		return
	}
	excerpt := kailoNotifyClean(question, kailoNotifyExcerptMaxRunes)
	occurred := finished
	n.enqueue(func(ctx context.Context) []kailoNotificationDelivery {
		people := n.identities(ctx, []string{userID})
		recipient, ok := people[userID]
		if !ok {
			return nil
		}
		d := kailoNotificationDelivery{
			IdempotencyKey: kailoNotifyKey("weknora.answer", messageID, recipient.person.Issuer, recipient.person.Subject),
			Recipient:      recipient.person,
			Category:       KailoNotifyCategoryTaskCompleted,
			Title:          kailoNotifyText{ZH: "知识库问答已完成", EN: "Your knowledge answer is ready"},
			Path:           "/platform/chat/" + url.PathEscape(sessionID),
			OccurredAt:     kailoNotifyTime(occurred),
		}
		if excerpt != "" {
			d.Summary = &kailoNotifyText{ZH: "你的提问「" + excerpt + "」已有回答。", EN: "Your question “" + excerpt + "” has been answered."}
		}
		if !kailoNotificationValid(d) {
			return nil
		}
		return []kailoNotificationDelivery{d}
	})
}

// shareDeliveries resolves the recipients of a share to an organisation: the
// active members of its member spaces, except the sharer and the members of
// the source space (they could already use the object).
func (n *KailoNotifier) shareDeliveries(
	ctx context.Context, prefix, shareID, orgID string, sourceTenantID uint64, actorID string,
	occurred time.Time, path string, texts func(actor kailoNotifyText) (kailoNotifyText, kailoNotifyText),
) []kailoNotificationDelivery {
	recipients := n.shareRecipients(ctx, orgID, sourceTenantID, actorID)
	if len(recipients) == 0 {
		return nil
	}
	people := n.identities(ctx, append(append([]string{}, recipients...), actorID))
	// Without a known display name the texts name "a colleague".
	actorName := kailoNotifyText{ZH: "同事", EN: "A colleague"}
	var actor *kailoNotifyPerson
	if p, ok := people[actorID]; ok {
		if name := kailoNotifyClean(p.name, kailoNotifyActorMaxRunes); name != "" {
			actorName = kailoNotifyText{ZH: name, EN: name}
		}
		person := p.person
		actor = &person
	}
	title, summary := texts(actorName)
	out := make([]kailoNotificationDelivery, 0, len(recipients))
	for _, id := range recipients {
		p, ok := people[id]
		if !ok {
			continue
		}
		d := kailoNotificationDelivery{
			IdempotencyKey: kailoNotifyKey(prefix, shareID, p.person.Issuer, p.person.Subject),
			Recipient:      p.person,
			Category:       KailoNotifyCategoryShared,
			Title:          title,
			Summary:        &kailoNotifyText{ZH: summary.ZH, EN: summary.EN},
			Path:           path,
			OccurredAt:     kailoNotifyTime(occurred),
		}
		if actor != nil && *actor != p.person {
			a := *actor
			d.Actor = &a
		}
		if kailoNotificationValid(d) {
			out = append(out, d)
		}
	}
	return out
}

func (n *KailoNotifier) shareRecipients(ctx context.Context, orgID string, sourceTenantID uint64, actorID string) []string {
	if n.orgs == nil || n.members == nil {
		return nil
	}
	spaces, err := n.orgs.ListTenantMembers(ctx, orgID)
	if err != nil {
		logger.Warnf(ctx, "[kailo] notification recipients unavailable: binding=%s category=%s", n.bindingID, KailoNotifyCategoryShared)
		return nil
	}
	skip := map[string]bool{actorID: true}
	if source, err := n.members.ListByTenant(ctx, sourceTenantID); err == nil {
		for _, m := range source {
			skip[m.UserID] = true
		}
	} else {
		return nil
	}
	var out []string
	for _, space := range spaces {
		if space == nil || space.TenantID == sourceTenantID {
			continue
		}
		members, err := n.members.ListByTenant(ctx, space.TenantID)
		if err != nil {
			continue
		}
		for _, m := range members {
			if m == nil || skip[m.UserID] || (m.Status != "" && m.Status != types.TenantMemberStatusActive) {
				continue
			}
			skip[m.UserID] = true
			out = append(out, m.UserID)
			if len(out) >= kailoNotifyMaxRecipients {
				return out
			}
		}
	}
	return out
}

// kailoNotifyResolved is one person with a verified OIDC identity.
type kailoNotifyResolved struct {
	person kailoNotifyPerson
	name   string
}

// identities maps native user ids to their verified OIDC iss/sub (the values
// Core's directory carries). Users without an OIDC identity, or inactive
// ones, are absent: nobody is notified under a guessed identity.
func (n *KailoNotifier) identities(ctx context.Context, ids []string) map[string]kailoNotifyResolved {
	out := map[string]kailoNotifyResolved{}
	if n.users == nil || len(ids) == 0 {
		return out
	}
	users, err := n.users.GetUsersByIDs(ctx, ids)
	if err != nil {
		return out
	}
	for id, u := range users {
		if u == nil || !u.IsActive || u.OIDCIssuer == nil || u.OIDCSubject == nil ||
			strings.TrimSpace(*u.OIDCIssuer) == "" || strings.TrimSpace(*u.OIDCSubject) == "" {
			continue
		}
		person := kailoNotifyPerson{Issuer: *u.OIDCIssuer, Subject: *u.OIDCSubject}
		out[id] = kailoNotifyResolved{person: person, name: u.Username}
	}
	return out
}

// ---- contract helpers ----

// kailoNotifyKey is deterministic per (event, recipient), so a retry or a
// replayed event is de-duplicated by Core.
func kailoNotifyKey(prefix string, parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return prefix + "." + hex.EncodeToString(sum[:])[:40]
}

func kailoNotifyTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// kailoNotifyClean makes free text safe for a title or summary: control
// characters become spaces, whitespace collapses and the text is cut to
// limit runes (with an ellipsis).
func kailoNotifyClean(value string, limit int) string {
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == utf8.RuneError {
			return ' '
		}
		return r
	}, value)
	value = strings.Join(strings.Fields(value), " ")
	if utf8.RuneCountInString(value) > limit {
		value = strings.TrimSpace(string([]rune(value)[:limit-1])) + "…"
	}
	return value
}

var kailoNotifyCredentialQuery = map[string]bool{
	"token": true, "access_token": true, "id_token": true, "refresh_token": true, "code": true,
	"secret": true, "password": true, "api_key": true, "key": true, "signature": true, "sig": true,
}

// kailoNotifyPathValid applies the contract's relative path rule.
func kailoNotifyPathValid(path string) bool {
	if len(path) < 1 || len(path) > 1024 || !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") ||
		strings.ContainsRune(path, '\\') {
		return false
	}
	for _, r := range path {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return false
		}
	}
	u, err := url.Parse(path)
	if err != nil || u.Scheme != "" || u.Host != "" {
		return false
	}
	for name := range u.Query() {
		if kailoNotifyCredentialQuery[strings.ToLower(name)] {
			return false
		}
	}
	return true
}

func kailoNotifyTextValid(text kailoNotifyText, limit int) bool {
	for _, value := range []string{text.ZH, text.EN} {
		count := utf8.RuneCountInString(value)
		if count < 1 || count > limit || strings.IndexFunc(value, unicode.IsControl) >= 0 {
			return false
		}
	}
	return true
}

// kailoNotifyKeyInvalidRune reports a rune outside [A-Za-z0-9._:-].
func kailoNotifyKeyInvalidRune(r rune) bool {
	return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' ||
		r == '.' || r == '_' || r == ':' || r == '-')
}

// kailoNotificationValid checks a delivery against the contract before it is
// queued; an invalid one would only be refused by Core with 400.
func kailoNotificationValid(d kailoNotificationDelivery) bool {
	if len(d.IdempotencyKey) < 1 || len(d.IdempotencyKey) > 128 ||
		strings.IndexFunc(d.IdempotencyKey, kailoNotifyKeyInvalidRune) >= 0 ||
		d.Recipient.Issuer == "" || d.Recipient.Subject == "" ||
		(d.Actor != nil && *d.Actor == d.Recipient) ||
		!kailoNotifyTextValid(d.Title, kailoNotifyTitleMaxRunes) || !kailoNotifyPathValid(d.Path) {
		return false
	}
	return d.Summary == nil || kailoNotifyTextValid(*d.Summary, kailoNotifySummaryMaxRunes)
}
