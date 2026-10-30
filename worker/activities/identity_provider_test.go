package activities

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeIdP serves the client-credentials token endpoint and the user logout endpoint.
type fakeIdP struct {
	mu          sync.Mutex
	tokens      int
	logouts     []string
	statuses    map[string][]int // subject -> successive logout statuses
}

func (f *fakeIdP) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		switch {
		case r.URL.Path == "/realms/kailo/protocol/openid-connect/token":
			if err := r.ParseForm(); err != nil || r.PostForm.Get("grant_type") != "client_credentials" ||
				r.PostForm.Get("client_id") != "kailo-session-termination" || r.PostForm.Get("client_secret") != "s3cret" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			f.tokens++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":300}`))
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/admin/realms/kailo/users/") &&
			strings.HasSuffix(r.URL.Path, "/logout"):
			if r.Header.Get("Authorization") != "Bearer tok" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			subject := strings.TrimSuffix(strings.TrimPrefix(r.URL.EscapedPath(), "/admin/realms/kailo/users/"), "/logout")
			f.logouts = append(f.logouts, subject)
			status := http.StatusNoContent
			if queue := f.statuses[subject]; len(queue) > 0 {
				status, f.statuses[subject] = queue[0], queue[1:]
			}
			w.WriteHeader(status)
		default:
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusTeapot)
		}
	})
}

func newTestIdP(t *testing.T, f *fakeIdP) (*IdentityProvider, string) {
	t.Helper()
	srv := httptest.NewServer(f.handler(t))
	t.Cleanup(srv.Close)
	issuer := srv.URL + "/realms/kailo"
	p, err := NewIdentityProvider(issuer, issuer+"/protocol/openid-connect/token", "kailo-session-termination", "s3cret")
	if err != nil {
		t.Fatal(err)
	}
	return p, issuer
}

func TestEndSessionsCallsLogoutForDeploymentIssuerOnly(t *testing.T) {
	f := &fakeIdP{statuses: map[string][]int{"gone": {http.StatusNotFound}}}
	p, issuer := newTestIdP(t, f)
	out, err := p.EndSessions(context.Background(), EndSessionsInput{Subjects: []IdentityProviderSubject{
		{Issuer: issuer, Subject: "a37a0187-0312-490d-abb4-6b848ac62825"},
		{Issuer: issuer, Subject: "gone"},
		{Issuer: "https://other.invalid/realms/x", Subject: "foreign"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if out != (EndSessionsOutput{Ended: 1, Absent: 1, Foreign: 1}) {
		t.Fatalf("unexpected result %+v", out)
	}
	if strings.Join(f.logouts, ",") != "a37a0187-0312-490d-abb4-6b848ac62825,gone" {
		t.Fatalf("unexpected logout calls %v", f.logouts)
	}
}

func TestEndSessionsEscapesSubjectAndRefreshesTokenOnce(t *testing.T) {
	f := &fakeIdP{statuses: map[string][]int{"a%2Fb": {http.StatusUnauthorized, http.StatusNoContent}}}
	p, issuer := newTestIdP(t, f)
	out, err := p.EndSessions(context.Background(), EndSessionsInput{Subjects: []IdentityProviderSubject{
		{Issuer: issuer, Subject: "a/b"},
	}})
	if err != nil || out.Ended != 1 {
		t.Fatalf("out=%+v err=%v", out, err)
	}
	if f.tokens != 2 {
		t.Fatalf("token should be re-fetched once after 401, got %d", f.tokens)
	}
}

func TestEndSessionsFailureIsRetryableAndHidesSubject(t *testing.T) {
	f := &fakeIdP{statuses: map[string][]int{"secret-subject": {http.StatusInternalServerError}}}
	p, issuer := newTestIdP(t, f)
	_, err := p.EndSessions(context.Background(), EndSessionsInput{Subjects: []IdentityProviderSubject{
		{Issuer: issuer, Subject: "secret-subject"},
	}})
	if err == nil {
		t.Fatal("5xx must fail the activity so the workflow retries")
	}
	if IsDeterministicFailure(err) {
		t.Fatal("IdP failure must stay retryable: revocation has to close")
	}
	if strings.Contains(err.Error(), "secret-subject") {
		t.Fatal("subject must not reach the error message / history")
	}
}

func TestIdentityProviderRejectsIssuerWithoutRealm(t *testing.T) {
	for _, issuer := range []string{"", "ftp://idp/realms/k", "https://idp/", "https://idp/realms/", "https://u:p@idp/realms/k"} {
		if _, err := NewIdentityProvider(issuer, "https://idp/realms/k/protocol/openid-connect/token", "c", "s"); err == nil {
			t.Fatalf("issuer %q must be refused", issuer)
		}
	}
	if base, err := adminBase("http://192.168.0.193:8080/realms/kailo"); err != nil ||
		base != "http://192.168.0.193:8080/admin/realms/kailo" {
		t.Fatalf("base=%q err=%v", base, err)
	}
}

func TestNewIdentityProviderFromEnvRequiresDelivery(t *testing.T) {
	t.Setenv("IDP_SESSION_TERMINATION_ISSUER", "http://idp/realms/kailo")
	t.Setenv("IDP_SESSION_TERMINATION_CLIENT_ID", "kailo-session-termination")
	t.Setenv("IDP_SESSION_TERMINATION_CLIENT_SECRET", "")
	t.Setenv("OIDC_TOKEN_URL", "http://idp/realms/kailo/protocol/openid-connect/token")
	if _, err := NewIdentityProviderFromEnv(); err == nil {
		t.Fatal("missing secret must refuse worker start")
	}
	t.Setenv("IDP_SESSION_TERMINATION_CLIENT_SECRET", "s")
	if _, err := NewIdentityProviderFromEnv(); err != nil {
		t.Fatal(err)
	}
}
