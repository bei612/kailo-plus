package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// DD-138(4), 07 §4.8.3: notification delivery to Kailo Core.

const (
	notifyIssuer = "https://kailo-idp.example/realms/kailo"
	notifyPath   = "/service/v1/component-notifications/bindings/" + dirBinding + "/notifications"
)

type notifyPost struct {
	auth string
	body []byte
}

// notifyCore stands in for the IdP token endpoint and Core's notification
// listener. statuses is the answer sequence of the notification endpoint;
// its last entry repeats.
type notifyCore struct {
	mu       sync.Mutex
	statuses []int
	posts    []notifyPost
	tokens   int
	server   *httptest.Server
}

func newNotifyCore(t *testing.T, statuses ...int) *notifyCore {
	t.Helper()
	c := &notifyCore{statuses: statuses}
	c.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		defer c.mu.Unlock()
		switch r.URL.Path {
		case "/token":
			id, secret, ok := r.BasicAuth()
			if !ok || id != dirClient || secret != dirSecret || r.FormValue("grant_type") != "client_credentials" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			c.tokens++
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"access_token": fmt.Sprintf("notify-token-%d", c.tokens), "token_type": "Bearer", "expires_in": 300,
			})
		case notifyPath:
			body, _ := io.ReadAll(r.Body)
			if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			c.posts = append(c.posts, notifyPost{auth: r.Header.Get("Authorization"), body: body})
			status := http.StatusCreated
			if len(c.statuses) > 0 {
				status = c.statuses[0]
				if len(c.statuses) > 1 {
					c.statuses = c.statuses[1:]
				}
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			if status == http.StatusCreated || status == http.StatusOK {
				_, _ = w.Write([]byte(`{"notificationId":"n-1","duplicate":false}`))
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(c.server.Close)
	return c
}

func (c *notifyCore) snapshot() ([]notifyPost, int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]notifyPost(nil), c.posts...), c.tokens
}

func (c *notifyCore) waitPosts(t *testing.T, n int) []notifyPost {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if posts, _ := c.snapshot(); len(posts) >= n {
			return posts
		}
		time.Sleep(10 * time.Millisecond)
	}
	posts, _ := c.snapshot()
	t.Fatalf("expected %d notification posts, got %d", n, len(posts))
	return nil
}

// ---- fakes (only the methods the notifier uses) ----

type fakeNotifyUsers struct {
	interfaces.UserRepository
	users map[string]*types.User
}

func (f *fakeNotifyUsers) GetUsersByIDs(_ context.Context, ids []string) (map[string]*types.User, error) {
	out := map[string]*types.User{}
	for _, id := range ids {
		if u, ok := f.users[id]; ok {
			out[id] = u
		}
	}
	return out, nil
}

type fakeNotifyOrgs struct {
	interfaces.OrganizationRepository
	spaces []*types.OrganizationTenantMember
}

func (f *fakeNotifyOrgs) ListTenantMembers(context.Context, string) ([]*types.OrganizationTenantMember, error) {
	return f.spaces, nil
}

type fakeNotifyMembers struct {
	interfaces.TenantMemberRepository
	byTenant map[uint64][]*types.TenantMember
}

func (f *fakeNotifyMembers) ListByTenant(_ context.Context, tenantID uint64) ([]*types.TenantMember, error) {
	return f.byTenant[tenantID], nil
}

type fakeNotifyKBs struct {
	interfaces.KnowledgeBaseRepository
}

func (f *fakeNotifyKBs) GetKnowledgeBaseByID(_ context.Context, id string) (*types.KnowledgeBase, error) {
	return &types.KnowledgeBase{ID: id, Name: "Handbook"}, nil
}

func oidcUser(id, sub, name string) *types.User {
	issuer, subject := notifyIssuer, sub
	return &types.User{ID: id, Username: name, IsActive: true, OIDCIssuer: &issuer, OIDCSubject: &subject}
}

// Spaces: 1 = source space (ada, bob), 2 = workspace space (bob, carol,
// dave, erin, frank), 3 = another space (carol, gina).
func notifyDirectory() (*fakeNotifyUsers, *fakeNotifyOrgs, *fakeNotifyMembers) {
	users := &fakeNotifyUsers{users: map[string]*types.User{
		"ada":   oidcUser("ada", "sub-ada", "Ada Lovelace"),
		"bob":   oidcUser("bob", "sub-bob", "Bob"),
		"carol": oidcUser("carol", "sub-carol", "Carol"),
		"dave":  {ID: "dave", Username: "Dave", IsActive: true}, // local account: no OIDC identity
		"erin":  oidcUser("erin", "sub-erin", "Erin"),
		"gina":  oidcUser("gina", "sub-gina", "Gina"),
	}}
	users.users["erin"].IsActive = false
	orgs := &fakeNotifyOrgs{spaces: []*types.OrganizationTenantMember{{TenantID: 1}, {TenantID: 2}, {TenantID: 3}}}
	members := &fakeNotifyMembers{byTenant: map[uint64][]*types.TenantMember{
		1: {{UserID: "ada", TenantID: 1}, {UserID: "bob", TenantID: 1}},
		2: {{UserID: "bob", TenantID: 2}, {UserID: "carol", TenantID: 2}, {UserID: "dave", TenantID: 2},
			{UserID: "erin", TenantID: 2}, {UserID: "frank", TenantID: 2, Status: types.TenantMemberStatusSuspended}},
		3: {{UserID: "carol", TenantID: 3}, {UserID: "gina", TenantID: 3}},
	}}
	return users, orgs, members
}

func notifyConfig(t *testing.T, core *notifyCore) *config.Config {
	t.Helper()
	secret := filepath.Join(t.TempDir(), "client_secret")
	if err := os.WriteFile(secret, []byte(dirSecret+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return &config.Config{Kailo: &config.KailoIntegrationConfig{Enable: true, TenantID: dirTenant,
		Directory: &config.KailoDirectoryConfig{BindingID: dirBinding, ClientID: dirClient, ClientSecretFile: secret,
			TokenURL: core.server.URL + "/token", CoreURL: core.server.URL}}}
}

func newTestNotifier(t *testing.T, core *notifyCore) *KailoNotifier {
	t.Helper()
	users, orgs, members := notifyDirectory()
	n := NewKailoNotifier(notifyConfig(t, core), users, orgs, members, &fakeNotifyKBs{}, nil)
	if !n.Enabled() {
		t.Fatal("notifier must be enabled with Kailo mode and the directory configured")
	}
	n.backoff = []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond, time.Millisecond}
	return n
}

func sampleDelivery() kailoNotificationDelivery {
	return kailoNotificationDelivery{
		IdempotencyKey: kailoNotifyKey("weknora.answer", "message-1", notifyIssuer, "sub-ada"),
		Recipient:      kailoNotifyPerson{Issuer: notifyIssuer, Subject: "sub-ada"},
		Category:       KailoNotifyCategoryTaskCompleted,
		Title:          kailoNotifyText{ZH: "知识库问答已完成", EN: "Your knowledge answer is ready"},
		Path:           "/platform/chat/session-1",
	}
}

func TestKailoNotifyDeliveryStatuses(t *testing.T) {
	cases := []struct {
		name     string
		statuses []int
		posts    int
		tokens   int
	}{
		{"created", []int{http.StatusCreated}, 1, 1},
		{"duplicate", []int{http.StatusOK}, 1, 1},
		{"conflict is final", []int{http.StatusConflict}, 1, 1},
		{"invalid is final", []int{http.StatusBadRequest}, 1, 1},
		{"forbidden refetches the token once, then is final", []int{http.StatusForbidden}, 2, 2},
		{"unauthorized then created after refetch", []int{http.StatusUnauthorized, http.StatusCreated}, 2, 2},
		{"rate limited is retried with the same key", []int{http.StatusTooManyRequests, http.StatusTooManyRequests, http.StatusCreated}, 3, 1},
		{"unavailable gives up after five attempts", []int{http.StatusServiceUnavailable}, 5, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			core := newNotifyCore(t, tc.statuses...)
			n := newTestNotifier(t, core)
			n.deliver(context.Background(), sampleDelivery())
			posts, tokens := core.snapshot()
			if len(posts) != tc.posts || tokens != tc.tokens {
				t.Fatalf("posts=%d tokens=%d, want posts=%d tokens=%d", len(posts), tokens, tc.posts, tc.tokens)
			}
			for _, post := range posts {
				if string(post.body) != string(posts[0].body) {
					t.Fatal("a retry must resend the identical body")
				}
				if !strings.HasPrefix(post.auth, "Bearer notify-token-") {
					t.Fatalf("unexpected authorization %q", post.auth)
				}
			}
		})
	}
}

func TestKailoNotifyBodyFollowsTheContract(t *testing.T) {
	core := newNotifyCore(t, http.StatusCreated)
	n := newTestNotifier(t, core)
	n.deliver(context.Background(), sampleDelivery())
	posts, _ := core.snapshot()
	var body map[string]json.RawMessage
	if err := json.Unmarshal(posts[0].body, &body); err != nil {
		t.Fatal(err)
	}
	for key := range body {
		switch key {
		case "idempotencyKey", "recipient", "category", "title", "path":
		default:
			t.Fatalf("unexpected key %q (empty optional fields must be omitted)", key)
		}
	}
	var title map[string]string
	_ = json.Unmarshal(body["title"], &title)
	if len(title) != 2 || title["ZH_CN"] == "" || title["EN"] == "" {
		t.Fatalf("title must carry ZH_CN and EN: %s", body["title"])
	}
}

func TestKailoNotifyCachesTheTokenAcrossDeliveries(t *testing.T) {
	core := newNotifyCore(t, http.StatusCreated)
	n := newTestNotifier(t, core)
	n.deliver(context.Background(), sampleDelivery())
	n.deliver(context.Background(), sampleDelivery())
	if posts, tokens := core.snapshot(); len(posts) != 2 || tokens != 1 {
		t.Fatalf("posts=%d tokens=%d, want one cached token for two posts", len(posts), tokens)
	}
}

func TestKailoNotifyShareRecipients(t *testing.T) {
	core := newNotifyCore(t, http.StatusCreated)
	n := newTestNotifier(t, core)
	n.Start(context.Background())
	t.Cleanup(n.Stop)
	n.NotifyKnowledgeBaseShared(&types.KnowledgeBaseShare{ID: "share-1", KnowledgeBaseID: "kb-1",
		OrganizationID: "org-1", SharedByUserID: "ada", SourceTenantID: 1})
	posts := core.waitPosts(t, 2)
	time.Sleep(50 * time.Millisecond)
	if again, _ := core.snapshot(); len(again) != 2 {
		t.Fatalf("got %d posts; only carol and gina gained access with an OIDC identity", len(again))
	}
	got := map[string]kailoNotificationDelivery{}
	for _, post := range posts {
		var d kailoNotificationDelivery
		if err := json.Unmarshal(post.body, &d); err != nil {
			t.Fatal(err)
		}
		got[d.Recipient.Subject] = d
	}
	for _, sub := range []string{"sub-carol", "sub-gina"} {
		d, ok := got[sub]
		if !ok {
			t.Fatalf("missing recipient %s (got %v)", sub, got)
		}
		if d.Category != KailoNotifyCategoryShared || d.Path != "/platform/knowledge-bases/kb-1" ||
			d.Actor == nil || d.Actor.Subject != "sub-ada" || d.Actor.Issuer != notifyIssuer ||
			!strings.Contains(d.Title.ZH, "Ada Lovelace") || !strings.Contains(d.Title.EN, "Handbook") ||
			d.IdempotencyKey != kailoNotifyKey("weknora.kbshare", "share-1", notifyIssuer, sub) {
			t.Fatalf("unexpected delivery for %s: %+v", sub, d)
		}
	}
}

func TestKailoNotifyLongAnswerThreshold(t *testing.T) {
	core := newNotifyCore(t, http.StatusCreated)
	n := newTestNotifier(t, core)
	if n.longAnswer != config.DefaultKailoLongAnswerNotifyAfter {
		t.Fatalf("default threshold %v", n.longAnswer)
	}
	start := time.Now().Add(-time.Minute)
	n.NotifyAnswerCompleted("ada", "session-1", "message-1", "quick", start, start.Add(5*time.Second))
	n.NotifyAnswerCompleted("unknown", "session-1", "message-2", "who", start, start.Add(time.Minute))
	n.NotifyAnswerCompleted("ada", "session-1", "message-3", "What changed\nin the 2026 travel policy?", start, start.Add(45*time.Second))
	n.Start(context.Background())
	t.Cleanup(n.Stop)
	posts := core.waitPosts(t, 1)
	time.Sleep(50 * time.Millisecond)
	if again, _ := core.snapshot(); len(again) != 1 {
		t.Fatalf("only the long answer of a known person is announced, got %d posts", len(again))
	}
	var d kailoNotificationDelivery
	if err := json.Unmarshal(posts[0].body, &d); err != nil {
		t.Fatal(err)
	}
	if d.Category != KailoNotifyCategoryTaskCompleted || d.Path != "/platform/chat/session-1" || d.Actor != nil ||
		d.Recipient.Subject != "sub-ada" || d.Summary == nil || strings.ContainsAny(d.Summary.ZH, "\n\r") ||
		d.IdempotencyKey != kailoNotifyKey("weknora.answer", "message-3", notifyIssuer, "sub-ada") {
		t.Fatalf("unexpected delivery %+v", d)
	}
}

func TestKailoNotifyDisabledOutsideKailoMode(t *testing.T) {
	core := newNotifyCore(t)
	cfg := notifyConfig(t, core)
	cfg.Kailo.Enable = false
	users, orgs, members := notifyDirectory()
	n := NewKailoNotifier(cfg, users, orgs, members, nil, nil)
	if n.Enabled() {
		t.Fatal("notifier must be disabled outside Kailo mode")
	}
	n.Start(context.Background())
	n.NotifyAnswerCompleted("ada", "s", "m", "q", time.Now().Add(-time.Hour), time.Now())
	n.Stop()
	if posts, tokens := core.snapshot(); len(posts) != 0 || tokens != 0 {
		t.Fatal("a disabled notifier must not contact Core")
	}
	var nilNotifier *KailoNotifier
	nilNotifier.NotifyKnowledgeBaseShared(&types.KnowledgeBaseShare{})
	nilNotifier.Stop()
}

func TestKailoNotifyQueueDropsOldest(t *testing.T) {
	core := newNotifyCore(t)
	n := newTestNotifier(t, core)
	n.capacity = 2
	marks := []string{}
	for _, mark := range []string{"a", "b", "c"} {
		mark := mark
		n.enqueue(func(context.Context) []kailoNotificationDelivery {
			marks = append(marks, mark)
			return nil
		})
	}
	for task := n.next(); task != nil; task = n.next() {
		task(context.Background())
	}
	if strings.Join(marks, "") != "bc" || n.dropped != 1 {
		t.Fatalf("marks=%v dropped=%d", marks, n.dropped)
	}
}

func TestKailoNotifyContractHelpers(t *testing.T) {
	for _, tc := range []struct {
		path string
		ok   bool
	}{
		{"/platform/chat/abc", true},
		{"/platform/knowledge-bases/x?knowledge_id=1", true},
		{"", false},
		{"platform", false},
		{"//evil.example/x", false},
		{"/a\\b", false},
		{"/a b", false},
		{"/a?token=x", false},
		{"/a?Access_Token=x", false},
		{"/a?sig=x", false},
	} {
		if kailoNotifyPathValid(tc.path) != tc.ok {
			t.Errorf("path %q: want %v", tc.path, tc.ok)
		}
	}
	if got := kailoNotifyClean(" a\tb\x00c \n", 10); got != "a b c" {
		t.Errorf("clean: %q", got)
	}
	if got := kailoNotifyClean(strings.Repeat("问", 70), 60); len([]rune(got)) != 60 || !strings.HasSuffix(got, "…") {
		t.Errorf("truncate: %q", got)
	}
	key := kailoNotifyKey("weknora.kbshare", "s", notifyIssuer, "sub")
	if key != kailoNotifyKey("weknora.kbshare", "s", notifyIssuer, "sub") || len(key) > 128 ||
		strings.IndexFunc(key, kailoNotifyKeyInvalidRune) >= 0 {
		t.Errorf("key %q must be deterministic and in the contract alphabet", key)
	}
	d := sampleDelivery()
	if !kailoNotificationValid(d) {
		t.Fatal("sample delivery must be valid")
	}
	d.Actor = &kailoNotifyPerson{Issuer: notifyIssuer, Subject: "sub-ada"}
	if kailoNotificationValid(d) {
		t.Fatal("the actor must never be notified about their own action")
	}
}

// ---- share decorator ----

type fakeKBShares struct {
	interfaces.KBShareRepository
	existing *types.KnowledgeBaseShare
}

func (f *fakeKBShares) GetByKBAndOrg(context.Context, string, string) (*types.KnowledgeBaseShare, error) {
	if f.existing == nil {
		return nil, fmt.Errorf("not found")
	}
	return f.existing, nil
}

type notifyKBShareService struct {
	interfaces.KBShareService
}

func (notifyKBShareService) ShareKnowledgeBase(_ context.Context, kbID, orgID, userID string, tenantID uint64,
	permission types.OrgMemberRole,
) (*types.KnowledgeBaseShare, error) {
	return &types.KnowledgeBaseShare{ID: "share-1", KnowledgeBaseID: kbID, OrganizationID: orgID,
		SharedByUserID: userID, SourceTenantID: tenantID, Permission: permission}, nil
}

func TestKailoShareDecoratorAnnouncesOnlyNewShares(t *testing.T) {
	core := newNotifyCore(t)
	n := newTestNotifier(t, core)
	repo := &fakeKBShares{existing: &types.KnowledgeBaseShare{ID: "share-1"}}
	svc := DecorateKBShareServiceForKailo(notifyKBShareService{}, repo, n)
	if _, err := svc.ShareKnowledgeBase(context.Background(), "kb-1", "org-1", "ada", 1, types.OrgRoleViewer); err != nil {
		t.Fatal(err)
	}
	if len(n.queue) != 0 {
		t.Fatal("a permission change of an existing share is not announced")
	}
	repo.existing = nil
	if _, err := svc.ShareKnowledgeBase(context.Background(), "kb-1", "org-1", "ada", 1, types.OrgRoleViewer); err != nil {
		t.Fatal(err)
	}
	if len(n.queue) != 1 {
		t.Fatal("a new share is announced")
	}
	disabled := DecorateKBShareServiceForKailo(notifyKBShareService{}, repo, nil)
	if _, ok := disabled.(notifyKBShareService); !ok {
		t.Fatal("without notifications the service is returned unchanged")
	}
}
