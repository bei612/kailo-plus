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
	"sync"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
)

// DD-165, 07 §4.8.9: Kailo usage admission and reports of knowledge answers.

const usageBase = "/service/v1/component-usage/bindings/" + dirBinding

type usageCore struct {
	mu        sync.Mutex
	decisions []string // admission answers; "503" answers 503; last repeats
	reports   []int    // report statuses; last repeats
	admits    [][]byte
	posts     [][]byte
	server    *httptest.Server
}

func newUsageCore(t *testing.T) *usageCore {
	t.Helper()
	c := &usageCore{decisions: []string{KailoUsageAllowed}, reports: []int{http.StatusCreated}}
	tokens := 0
	c.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		defer c.mu.Unlock()
		body, _ := io.ReadAll(r.Body)
		switch r.URL.Path {
		case "/token":
			tokens++
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"access_token": fmt.Sprintf("usage-token-%d", tokens), "token_type": "Bearer", "expires_in": 300,
			})
		case usageBase + "/admission":
			c.admits = append(c.admits, body)
			decision := c.decisions[0]
			if len(c.decisions) > 1 {
				c.decisions = c.decisions[1:]
			}
			if decision == "503" {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			if decision == "404" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"decision": decision})
		case usageBase + "/reports":
			c.posts = append(c.posts, body)
			status := c.reports[0]
			if len(c.reports) > 1 {
				c.reports = c.reports[1:]
			}
			w.WriteHeader(status)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(c.server.Close)
	return c
}

func (c *usageCore) counts() (int, int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.admits), len(c.posts)
}

func usageConfig(t *testing.T, core *usageCore) *config.Config {
	t.Helper()
	secret := filepath.Join(t.TempDir(), "client_secret")
	if err := os.WriteFile(secret, []byte(dirSecret+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return &config.Config{Kailo: &config.KailoIntegrationConfig{Enable: true, TenantID: dirTenant,
		Directory: &config.KailoDirectoryConfig{BindingID: dirBinding, ClientID: dirClient, ClientSecretFile: secret,
			TokenURL: core.server.URL + "/token", CoreURL: core.server.URL}}}
}

func newTestUsage(t *testing.T, core *usageCore) *KailoUsage {
	t.Helper()
	users, _, _ := notifyDirectory()
	u := NewKailoUsage(usageConfig(t, core), users)
	if !u.Enabled() {
		t.Fatal("usage must be enabled with Kailo mode and the directory configured")
	}
	u.backoff = []time.Duration{time.Millisecond, time.Millisecond}
	return u
}

func TestKailoUsageDisabledOutsideKailoMode(t *testing.T) {
	users, _, _ := notifyDirectory()
	u := NewKailoUsage(&config.Config{}, users)
	if u.Enabled() {
		t.Fatal("disabled without Kailo mode")
	}
	if got := u.AdmitKnowledgeAnswer(context.Background(), "ada"); got != KailoUsageAllowed {
		t.Fatalf("native mode is not metered by Kailo, got %s", got)
	}
}

func TestKailoUsageAdmissionDecisions(t *testing.T) {
	core := newUsageCore(t)
	u := newTestUsage(t, core)
	ctx := context.Background()
	core.decisions = []string{KailoUsageMemberQuotaExhausted, KailoUsageTenantQuotaExhausted, "503", "SOMETHING_ELSE",
		KailoUsageQuotaNotConfigured, "404", KailoUsageAllowed}
	for _, want := range []string{KailoUsageMemberQuotaExhausted, KailoUsageTenantQuotaExhausted,
		KailoUsageDependencyUnavailable, KailoUsageDependencyUnavailable, KailoUsageQuotaNotConfigured,
		KailoUsageQuotaNotConfigured, KailoUsageAllowed} {
		if got := u.AdmitKnowledgeAnswer(ctx, "ada"); got != want {
			t.Fatalf("decision: want %s, got %s", want, got)
		}
	}
	admits, _ := core.counts()
	// ALLOWED is cached: the next question within a minute does not ask again.
	if got := u.AdmitKnowledgeAnswer(ctx, "ada"); got != KailoUsageAllowed {
		t.Fatalf("cached allowed, got %s", got)
	}
	if again, _ := core.counts(); again != admits {
		t.Fatalf("an allowed member is cached, admissions %d -> %d", admits, again)
	}
	var sent kailoUsageAdmissionRequest
	if err := json.Unmarshal(core.admits[0], &sent); err != nil {
		t.Fatal(err)
	}
	if sent.MeterKey != kailoUsageMeterKnowledgeAnswer || sent.Member == nil || sent.Member.Subject != "sub-ada" ||
		sent.Member.Issuer != notifyIssuer {
		t.Fatalf("admission names the meter and the member's verified identity: %+v", sent)
	}
	// A local account without a verified OIDC identity cannot be metered: refused.
	if got := u.AdmitKnowledgeAnswer(ctx, "dave"); got != KailoUsageDependencyUnavailable {
		t.Fatalf("no verified identity must refuse, got %s", got)
	}
}

func TestKailoUsageReportIsIdempotentAndRetried(t *testing.T) {
	core := newUsageCore(t)
	core.reports = []int{http.StatusServiceUnavailable, http.StatusCreated}
	u := newTestUsage(t, core)
	u.Start(context.Background())
	t.Cleanup(u.Stop)
	finished := time.Date(2026, 10, 30, 8, 0, 0, 0, time.UTC)
	u.ReportKnowledgeAnswer(context.Background(), "ada", "message-1", finished)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, posts := core.counts(); posts >= 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	core.mu.Lock()
	posts := append([][]byte(nil), core.posts...)
	core.mu.Unlock()
	if len(posts) != 2 || string(posts[0]) != string(posts[1]) {
		t.Fatalf("a 503 is retried with the same body, got %d posts", len(posts))
	}
	var report kailoUsageReport
	if err := json.Unmarshal(posts[0], &report); err != nil {
		t.Fatal(err)
	}
	if report.IdempotencyKey != kailoNotifyKey("weknora.answer", "message-1") || report.MeterKey != kailoUsageMeterKnowledgeAnswer ||
		report.Quantity != 1 || report.OccurredAt != "2026-10-30T08:00:00Z" || report.Member == nil || report.Member.Subject != "sub-ada" {
		t.Fatalf("report shape: %+v", report)
	}
	// Unknown users and empty message IDs are not reported.
	u.ReportKnowledgeAnswer(context.Background(), "dave", "message-2", finished)
	u.ReportKnowledgeAnswer(context.Background(), "ada", "", finished)
	time.Sleep(50 * time.Millisecond)
	if _, n := core.counts(); n != 2 {
		t.Fatalf("nothing else is reported, got %d posts", n)
	}
}

func TestKailoUsageRefusalTextFollowsLanguage(t *testing.T) {
	if got := KailoUsageRefusalText(KailoUsageTenantQuotaExhausted, "zh-CN,zh;q=0.9"); got != "组织本月的知识库问答额度已用完，请联系管理员。" {
		t.Fatalf("zh tenant: %s", got)
	}
	if got := KailoUsageRefusalText(KailoUsageMemberQuotaExhausted, "en-US"); got != "Your knowledge answer quota for this month is used up." {
		t.Fatalf("en member: %s", got)
	}
	if got := KailoUsageRefusalText(KailoUsageDependencyUnavailable, ""); got != "用量服务暂不可用，请稍后再试。" {
		t.Fatalf("default unavailable: %s", got)
	}
	if got := KailoUsageRefusalText(KailoUsageQuotaNotConfigured, "zh"); got != "本组织的用量额度尚未在 Kailo 中完成登记，暂不能提问，请联系管理员。" {
		t.Fatalf("not configured: %s", got)
	}
}
