package auth

// Kailo notification delivery (DD-138(4), .design/07 §4.8.3). In Kailo mode
// the events that used to reach the native bell, activity inbox or e-mail
// (shared with you, mentioned, comments, background task completion, content
// changes of followed folders) are delivered one by one to Core:
//
//	POST {KAILO_DIRECTORY_CORE_URL}/service/v1/component-notifications/bindings/{KAILO_DIRECTORY_BINDING_ID}/notifications
//
// with the member directory client's client-credentials token (07 §4.7.4;
// same configuration and all-or-none rule). Delivery never blocks the user's
// request: a bounded in-memory queue (oldest dropped and counted when full)
// is drained by one background worker; 429/503/5xx and transport failures
// are retried with the same idempotency key and exponential backoff, 400,
// 403 (after one token refresh) and 409 are not. Logs carry only binding,
// category and HTTP status, never a title, summary, path or token. This file
// holds the transport and the pure rules (path, key, mention, aggregation,
// texts); the native event sources live in frontend/web/service
// (kailo-notify.go), which may import the node routers.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"go.uber.org/zap"

	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/telemetry/log"
)

// NativeKailoMode is the server side of Kailo mode (07 §4.8.1, DD-138): this
// fork's index page always renders startParameters.KAILO_EMBED (web
// index-handler.go asks this same function), which is the frontend's
// KailoCells.kailoMode() condition. Kailo-mode-only server behaviour (no
// native notification e-mail, Kailo notification delivery) uses it too.
var NativeKailoMode = func() bool { return true }

// Notification categories of contracts/enums/component_notification_category.
const (
	NativeOIDCNotifyShared        = "SHARED"
	NativeOIDCNotifyMentioned     = "MENTIONED"
	NativeOIDCNotifyCommented     = "COMMENTED"
	NativeOIDCNotifyTaskCompleted = "TASK_COMPLETED"
	NativeOIDCNotifyUpdated       = "CONTENT_UPDATED"
)

const (
	notifyTitleMax    = 120
	notifySummaryMax  = 280
	notifyPathMax     = 1024
	notifyBodyMax     = 64 << 10
	notifyQueueSize   = 1024
	notifyAttempts    = 5
	notifyTokenMargin = 30 * time.Second
)

var (
	notifyKeyPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

	notifyCategories = []string{NativeOIDCNotifyShared, NativeOIDCNotifyMentioned, NativeOIDCNotifyCommented,
		"ACCESS_REQUESTED", NativeOIDCNotifyTaskCompleted, NativeOIDCNotifyUpdated}

	notifyCredentialQuery = []string{"token", "access_token", "id_token", "refresh_token", "code", "secret",
		"password", "api_key", "key", "signature", "sig"}

	// "@login" preceded by start or a non-login character (so an e-mail
	// address in the text is not a mention); same alphabet as native logins.
	notifyMention = regexp.MustCompile(`(?:^|[^A-Za-z0-9._@-])@([A-Za-z0-9][A-Za-z0-9._@-]{0,63})`)
)

// NativeOIDCPerson is a ComponentPersonRef: the OIDC iss/sub of a person.
type NativeOIDCPerson struct {
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
}

// NativeOIDCText is a ComponentText (both languages).
type NativeOIDCText struct {
	ZH string `json:"ZH_CN"`
	EN string `json:"EN"`
}

// NativeOIDCNotification is one ComponentNotificationDelivery body.
type NativeOIDCNotification struct {
	IdempotencyKey string            `json:"idempotencyKey"`
	Recipient      NativeOIDCPerson  `json:"recipient"`
	Actor          *NativeOIDCPerson `json:"actor,omitempty"`
	Category       string            `json:"category"`
	Title          NativeOIDCText    `json:"title"`
	Summary        *NativeOIDCText   `json:"summary,omitempty"`
	Path           string            `json:"path"`
	OccurredAt     string            `json:"occurredAt,omitempty"`
}

func notifyClip(value string, max int) string {
	value = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, value))
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	return strings.TrimSpace(string([]rune(value)[:max-1])) + "…"
}

// Normalize applies the contract to a notification before it is queued:
// texts are cleaned and clipped, an actor equal to the recipient is dropped,
// a future occurredAt becomes now. It refuses what Core would reject.
func (n *NativeOIDCNotification) Normalize(now time.Time) error {
	if !notifyKeyPattern.MatchString(n.IdempotencyKey) || !slices.Contains(notifyCategories, n.Category) {
		return errors.New("notification key or category out of contract")
	}
	if n.Recipient.Issuer == "" || n.Recipient.Subject == "" {
		return errors.New("notification recipient unknown")
	}
	if n.Actor != nil && (n.Actor.Issuer == "" || n.Actor.Subject == "" || *n.Actor == n.Recipient) {
		n.Actor = nil
	}
	n.Title = NativeOIDCText{ZH: notifyClip(n.Title.ZH, notifyTitleMax), EN: notifyClip(n.Title.EN, notifyTitleMax)}
	if n.Title.ZH == "" || n.Title.EN == "" {
		return errors.New("notification title empty")
	}
	if n.Summary != nil {
		s := NativeOIDCText{ZH: notifyClip(n.Summary.ZH, notifySummaryMax), EN: notifyClip(n.Summary.EN, notifySummaryMax)}
		n.Summary = &s
		if s.ZH == "" || s.EN == "" {
			n.Summary = nil
		}
	}
	if !NativeOIDCNotifyPathValid(n.Path) {
		return errors.New("notification path out of contract")
	}
	if n.OccurredAt != "" {
		at, err := time.Parse(time.RFC3339, n.OccurredAt)
		if err != nil {
			return errors.New("notification time out of contract")
		}
		if at.After(now) {
			at = now
		}
		n.OccurredAt = at.UTC().Format(time.RFC3339)
	}
	return nil
}

// NativeOIDCNotifyPathValid is Core's relative path rule (07 §4.8.3): one
// leading "/", at most 1024 bytes, no backslash, whitespace or control
// character, stays on the page origin, no credential-like query name.
func NativeOIDCNotifyPathValid(p string) bool {
	if p == "" || len(p) > notifyPathMax || !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || !utf8.ValidString(p) {
		return false
	}
	for _, r := range p {
		if r == '\\' || unicode.IsSpace(r) || unicode.IsControl(r) {
			return false
		}
	}
	u, err := url.Parse(p)
	if err != nil || u.Scheme != "" || u.Host != "" || u.User != nil || u.Opaque != "" {
		return false
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return false
	}
	for name := range query {
		if slices.Contains(notifyCredentialQuery, strings.ToLower(name)) {
			return false
		}
	}
	return true
}

// NativeCellsPagePath is the Cells web route that opens a workspace (or Cell)
// node for a user: /ws-<slug>[/<segment>...] (gui.ajax MainRouter.js and
// WorkspaceRouter.js), every segment escaped. relative is the path inside
// that workspace as the user sees it (tree.WorkspaceRelativePath.Path).
func NativeCellsPagePath(slug, relative string) (string, bool) {
	if slug == "" || strings.ContainsAny(slug, "/\\") {
		return "", false
	}
	var b strings.Builder
	b.WriteString("/ws-")
	b.WriteString(url.PathEscape(slug))
	for _, segment := range strings.Split(strings.Trim(relative, "/"), "/") {
		switch segment {
		case "":
			continue
		case ".", "..":
			return "", false
		}
		b.WriteString("/")
		b.WriteString(url.PathEscape(segment))
	}
	out := b.String()
	return out, NativeOIDCNotifyPathValid(out)
}

// NativeOIDCNotifyKey is a deterministic idempotency key for one (event,
// recipient): retries and replays of the same native event de-duplicate.
func NativeOIDCNotifyKey(kind string, parts ...string) string {
	h := sha256.New()
	for _, part := range parts {
		h.Write([]byte(part))
		h.Write([]byte{0})
	}
	return "cells." + kind + "." + hex.EncodeToString(h.Sum(nil))[:40]
}

// NativeOIDCMentions returns the distinct native logins mentioned as
// "@login" in a comment (at most 20, in order of appearance).
func NativeOIDCMentions(text string) []string {
	var out []string
	for _, m := range notifyMention.FindAllStringSubmatch(text, -1) {
		login := strings.TrimRight(m[1], ".-@")
		if login == "" || slices.Contains(out, login) {
			continue
		}
		out = append(out, login)
		if len(out) == 20 {
			break
		}
	}
	return out
}

// NativeOIDCUserIdentity is the OIDC iss/sub of a native user: the identity
// recorded on a provisioned account, else the connector's explicit link.
// ok is false for any other account (it is never notified or named).
func NativeOIDCUserIdentity(ctx context.Context, user *idm.User) (NativeOIDCPerson, bool) {
	if user == nil || user.IsGroup || user.Uuid == "" {
		return NativeOIDCPerson{}, false
	}
	attributes := user.GetAttributes()
	if iss, sub := attributes[NativeOIDCIssuerAttribute], attributes[NativeOIDCSubjectAttribute]; iss != "" && sub != "" {
		return NativeOIDCPerson{Issuer: iss, Subject: sub}, true
	}
	if c, err := loadNativeOIDCConnector(ctx); err == nil {
		for _, link := range c.Users {
			if link.UserUUID == user.Uuid && strings.TrimSpace(link.Subject) != "" {
				return NativeOIDCPerson{Issuer: c.Issuer, Subject: link.Subject}, true
			}
		}
	}
	return NativeOIDCPerson{}, false
}

// ---- texts --------------------------------------------------------------------

// NativeOIDCNotifyTitle is the short human title of an event; actor is a
// display name ("" when unknown), object a file/folder/workspace name, count
// the number of changed items of an aggregated folder update.
func NativeOIDCNotifyTitle(event, actor, object string, count int) NativeOIDCText {
	zhWho, enWho := actor, actor
	if actor == "" {
		zhWho, enWho = "有人", "Someone"
	}
	zhObj, enObj := "「"+object+"」", "“"+object+"”"
	n := strconv.Itoa(count)
	switch event {
	case "shared":
		return NativeOIDCText{ZH: zhWho + " 与你共享了" + zhObj, EN: enWho + " shared " + enObj + " with you"}
	case "commented":
		return NativeOIDCText{ZH: zhWho + " 评论了" + zhObj, EN: enWho + " commented on " + enObj}
	case "mentioned":
		return NativeOIDCText{ZH: zhWho + " 在" + zhObj + "的评论中提到了你", EN: enWho + " mentioned you in a comment on " + enObj}
	case "created":
		return NativeOIDCText{ZH: zhWho + " 上传了" + zhObj, EN: enWho + " uploaded " + enObj}
	case "deleted":
		return NativeOIDCText{ZH: zhWho + " 删除了" + zhObj, EN: enWho + " deleted " + enObj}
	case "moved":
		return NativeOIDCText{ZH: zhWho + " 移动了" + zhObj, EN: enWho + " moved " + enObj}
	case "updated":
		return NativeOIDCText{ZH: zhWho + " 更新了" + zhObj, EN: enWho + " updated " + enObj}
	case "changes":
		return NativeOIDCText{ZH: zhObj + "中有 " + n + " 项内容更新", EN: n + " items changed in " + enObj}
	case "compress":
		return NativeOIDCText{ZH: "压缩已完成：" + zhObj, EN: "Archive ready: " + enObj}
	case "extract":
		return NativeOIDCText{ZH: "解压已完成：" + zhObj, EN: "Extraction finished: " + enObj}
	case "copy":
		return NativeOIDCText{ZH: "复制到" + zhObj + "已完成", EN: "Copy to " + enObj + " finished"}
	case "move":
		return NativeOIDCText{ZH: "移动到" + zhObj + "已完成", EN: "Move to " + enObj + " finished"}
	}
	return NativeOIDCText{ZH: zhObj + "有更新", EN: enObj + " changed"}
}

// ---- aggregation ----------------------------------------------------------------

// NativeOIDCNotifyChange is one content change seen by one recipient in one
// folder (activity inbox of a follower).
type NativeOIDCNotifyChange struct {
	Recipient, Folder string // aggregation key: native login, parent folder
	Node, Name, Actor string // node UUID, base name, author login
	Event             string // created | updated | deleted | moved
	At                time.Time
}

// NativeOIDCNotifyBatch is the aggregated changes of one (recipient, folder)
// window: one notification instead of one per file of an upload.
type NativeOIDCNotifyBatch struct {
	Recipient, Folder string
	First             time.Time
	Changes           []NativeOIDCNotifyChange // one per node, in order of first change
}

// Key is deterministic for the same set of native changes.
func (b *NativeOIDCNotifyBatch) Key() string {
	parts := []string{b.Recipient, b.Folder}
	for _, c := range b.Changes {
		parts = append(parts, c.Node+"@"+strconv.FormatInt(c.At.Unix(), 10)+":"+c.Event)
	}
	slices.Sort(parts[2:])
	return NativeOIDCNotifyKey("updated", parts...)
}

// Actor is the single author of all changes, "" when several.
func (b *NativeOIDCNotifyBatch) Actor() string {
	actor := ""
	for i, c := range b.Changes {
		if i > 0 && c.Actor != actor {
			return ""
		}
		actor = c.Actor
	}
	return actor
}

// NativeOIDCNotifyAggregator groups changes per (recipient, folder) for
// Window after the first one. It is bounded: beyond maxBatches open groups
// or maxChanges nodes per group, further changes only refresh nothing.
type NativeOIDCNotifyAggregator struct {
	Window time.Duration
	mu     sync.Mutex
	open   map[string]*NativeOIDCNotifyBatch
}

const (
	notifyMaxBatches = 4096
	notifyMaxChanges = 1000
)

// Add records one change.
func (a *NativeOIDCNotifyAggregator) Add(c NativeOIDCNotifyChange) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.open == nil {
		a.open = map[string]*NativeOIDCNotifyBatch{}
	}
	key := c.Recipient + "\x00" + c.Folder
	b := a.open[key]
	if b == nil {
		if len(a.open) >= notifyMaxBatches {
			return
		}
		b = &NativeOIDCNotifyBatch{Recipient: c.Recipient, Folder: c.Folder, First: c.At}
		a.open[key] = b
	}
	for i := range b.Changes {
		if b.Changes[i].Node == c.Node {
			// An upload is "created" even if later updated in the window.
			if b.Changes[i].Event == "created" && c.Event == "updated" {
				c.Event = "created"
			}
			b.Changes[i] = c
			return
		}
	}
	if len(b.Changes) < notifyMaxChanges {
		b.Changes = append(b.Changes, c)
	}
}

// Due removes and returns the groups whose window has elapsed at now.
func (a *NativeOIDCNotifyAggregator) Due(now time.Time) []*NativeOIDCNotifyBatch {
	a.mu.Lock()
	defer a.mu.Unlock()
	var out []*NativeOIDCNotifyBatch
	for key, b := range a.open {
		if !b.First.Add(a.Window).After(now) {
			out = append(out, b)
			delete(a.open, key)
		}
	}
	slices.SortFunc(out, func(x, y *NativeOIDCNotifyBatch) int { return x.First.Compare(y.First) })
	return out
}

// ---- delivery ---------------------------------------------------------------------

// NativeOIDCDelivery is the outcome of one delivery attempt.
type NativeOIDCDelivery struct {
	Status     int  // HTTP status, 0 for transport/token failure
	Done       bool // 200/201
	Retry      bool // retriable with the same key
	RetryAfter time.Duration
}

type notifyQueued struct {
	n       NativeOIDCNotification
	attempt int
}

// NativeOIDCNotifier delivers notifications to Core in the background.
type NativeOIDCNotifier struct {
	config *NativeOIDCDirectoryConfig

	// Capacity of the queue, Attempts per notification and the wait before
	// attempt n+1 (tests shorten them).
	Capacity int
	Attempts int
	Backoff  func(attempt int) time.Duration
	Now      func() time.Time

	mu       sync.Mutex
	queue    []notifyQueued
	wake     chan struct{}
	dropped  int
	lastDrop time.Time

	tokenMu     sync.Mutex
	bearer      string
	bearerUntil time.Time
}

// NewNativeOIDCNotifier builds a notifier on a validated directory config.
func NewNativeOIDCNotifier(c *NativeOIDCDirectoryConfig) *NativeOIDCNotifier {
	n := &NativeOIDCNotifier{config: c, Capacity: notifyQueueSize, Attempts: notifyAttempts, Now: time.Now, wake: make(chan struct{}, 1)}
	// 20 s, 40 s, 80 s, 160 s: five attempts over about five minutes.
	n.Backoff = func(attempt int) time.Duration { return (20 * time.Second) << (attempt - 1) }
	return n
}

// Dropped is the number of notifications dropped because the queue was full.
func (n *NativeOIDCNotifier) Dropped() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.dropped
}

// Pending is the number of queued notifications.
func (n *NativeOIDCNotifier) Pending() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return len(n.queue)
}

// Enqueue normalizes and queues one notification; it never blocks. It
// returns false when the notification is out of contract (not queued).
func (n *NativeOIDCNotifier) Enqueue(ctx context.Context, item NativeOIDCNotification) bool {
	if err := item.Normalize(n.Now()); err != nil {
		log.Logger(ctx).Debug("Kailo notification skipped", zap.String("binding", n.config.BindingID), zap.String("category", item.Category))
		return false
	}
	n.push(ctx, notifyQueued{n: item, attempt: 1})
	return true
}

func (n *NativeOIDCNotifier) push(ctx context.Context, q notifyQueued) {
	n.mu.Lock()
	if len(n.queue) >= n.Capacity {
		n.queue = n.queue[1:]
		n.dropped++
		if now := n.Now(); now.Sub(n.lastDrop) > time.Minute {
			n.lastDrop = now
			log.Logger(ctx).Warn("Kailo notification queue full; oldest dropped",
				zap.String("binding", n.config.BindingID), zap.Int("dropped", n.dropped))
		}
	}
	n.queue = append(n.queue, q)
	n.mu.Unlock()
	select {
	case n.wake <- struct{}{}:
	default:
	}
}

func (n *NativeOIDCNotifier) pop() (notifyQueued, bool) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if len(n.queue) == 0 {
		return notifyQueued{}, false
	}
	q := n.queue[0]
	n.queue = n.queue[1:]
	return q, true
}

// Run drains the queue until ctx ends.
func (n *NativeOIDCNotifier) Run(ctx context.Context) {
	for {
		q, ok := n.pop()
		if !ok {
			select {
			case <-ctx.Done():
				return
			case <-n.wake:
				continue
			}
		}
		result := n.Deliver(ctx, q.n)
		fields := []zap.Field{zap.String("binding", n.config.BindingID), zap.String("category", q.n.Category), zap.Int("status", result.Status)}
		switch {
		case result.Done:
			log.Logger(ctx).Debug("Kailo notification delivered", fields...)
		case result.Retry && q.attempt < n.Attempts:
			wait := n.Backoff(q.attempt)
			if result.RetryAfter > wait {
				wait = min(result.RetryAfter, 5*time.Minute)
			}
			log.Logger(ctx).Info("Kailo notification delivery deferred", append(fields, zap.Int("attempt", q.attempt))...)
			next := notifyQueued{n: q.n, attempt: q.attempt + 1}
			time.AfterFunc(wait, func() {
				if ctx.Err() == nil {
					n.push(ctx, next)
				}
			})
		default:
			log.Logger(ctx).Warn("Kailo notification not delivered", fields...)
		}
	}
}

func (n *NativeOIDCNotifier) token(ctx context.Context, refresh bool) (string, error) {
	n.tokenMu.Lock()
	defer n.tokenMu.Unlock()
	if !refresh && n.bearer != "" && n.Now().Before(n.bearerUntil) {
		return n.bearer, nil
	}
	n.bearer = ""
	bearer, lifetime, err := n.config.clientCredentials(ctx)
	if err != nil {
		return "", err
	}
	if lifetime > notifyTokenMargin {
		n.bearer, n.bearerUntil = bearer, n.Now().Add(lifetime-notifyTokenMargin)
	}
	return bearer, nil
}

// Deliver makes one delivery attempt (with one token refresh on 401/403).
func (n *NativeOIDCNotifier) Deliver(ctx context.Context, item NativeOIDCNotification) NativeOIDCDelivery {
	body, err := json.Marshal(item)
	if err != nil {
		return NativeOIDCDelivery{}
	}
	target := strings.TrimSuffix(n.config.CoreURL, "/") + "/service/v1/component-notifications/bindings/" +
		url.PathEscape(n.config.BindingID) + "/notifications"
	for refreshed := false; ; refreshed = true {
		bearer, err := n.token(ctx, refreshed)
		if err != nil {
			var unavailable *NativeOIDCDirectoryUnavailable
			status := 0
			if errors.As(err, &unavailable) {
				status = unavailable.Status
			}
			return NativeOIDCDelivery{Status: status, Retry: true}
		}
		status, retryAfter, err := n.post(ctx, target, bearer, body)
		if err != nil {
			return NativeOIDCDelivery{Retry: true}
		}
		switch {
		case status == http.StatusOK || status == http.StatusCreated:
			return NativeOIDCDelivery{Status: status, Done: true}
		case (status == http.StatusUnauthorized || status == http.StatusForbidden) && !refreshed:
			continue
		case status == http.StatusTooManyRequests || status >= 500:
			return NativeOIDCDelivery{Status: status, Retry: true, RetryAfter: retryAfter}
		default:
			// 400 invalid, 403 refused, 409 conflicting key: never retried.
			return NativeOIDCDelivery{Status: status}
		}
	}
}

func (n *NativeOIDCNotifier) post(ctx context.Context, target, bearer string, body []byte) (int, time.Duration, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := n.config.client().Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, notifyBodyMax))
	var retryAfter time.Duration
	if seconds, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && seconds > 0 {
		retryAfter = time.Duration(seconds) * time.Second
	}
	return resp.StatusCode, retryAfter, nil
}

var (
	nativeOIDCNotifierOnce sync.Once
	nativeOIDCNotifier     *NativeOIDCNotifier
)

// StartNativeOIDCNotifier starts the delivery worker once and returns it; nil
// (no error) when not in Kailo mode or when the directory client is not
// delivered, so the native events then simply produce no Kailo delivery. A
// partial delivery is reported by the directory sync itself.
func StartNativeOIDCNotifier(ctx context.Context) (*NativeOIDCNotifier, error) {
	if !NativeKailoMode() {
		return nil, nil
	}
	cfg, err := NativeOIDCDirectoryConfigFromEnv()
	if err != nil || cfg == nil {
		return nil, err
	}
	nativeOIDCNotifierOnce.Do(func() {
		nativeOIDCNotifier = NewNativeOIDCNotifier(cfg)
		go nativeOIDCNotifier.Run(ctx)
	})
	return nativeOIDCNotifier, nil
}
