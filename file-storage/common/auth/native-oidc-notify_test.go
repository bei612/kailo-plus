package auth_test

// DD-138(4), .design/07 §4.8.3: Kailo notification delivery rules and client.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/pydio/cells/v5/common/auth"
)

const notifyBinding = "0b7a6d52-5d0e-4c3b-9a49-3f1f3e3c2a01"

func TestNativeCellsPagePath(t *testing.T) {
	cases := []struct {
		slug, relative, want string
		ok                   bool
	}{
		{"kailo-ws-11111111-2222-4333-8444-555555555501", "", "/ws-kailo-ws-11111111-2222-4333-8444-555555555501", true},
		{"my-cell", "/Q3 Plan/预算 #1?.docx", "/ws-my-cell/Q3%20Plan/" + url.PathEscape("预算 #1?.docx"), true},
		{"ws", "rootkey/a;b,c", "/ws-ws/rootkey/a%3Bb%2Cc", true},
		{"ws", "/a/../b", "", false},
		{"", "/a", "", false},
		{"a/b", "/a", "", false},
		{"ws", "/" + strings.Repeat("x", 1100), "", false},
	}
	for _, c := range cases {
		got, ok := auth.NativeCellsPagePath(c.slug, c.relative)
		if ok != c.ok || (ok && got != c.want) {
			t.Fatalf("NativeCellsPagePath(%q, %q) = %q, %v; want %q, %v", c.slug, c.relative, got, ok, c.want, c.ok)
		}
		if ok && !auth.NativeOIDCNotifyPathValid(got) {
			t.Fatalf("built path %q is not a valid notification path", got)
		}
	}
}

func TestNativeOIDCNotifyPathValid(t *testing.T) {
	for _, p := range []string{"/", "/ws-a/b%20c", "/ws-a/b?x=1&page=2", "/ws-a/%E9%A2%84"} {
		if !auth.NativeOIDCNotifyPathValid(p) {
			t.Fatalf("%q should be valid", p)
		}
	}
	for _, p := range []string{"", "ws-a", "//evil.example/x", "https://evil.example/", "/a b", "/a\\b", "/a\tb", "/a\x01",
		"/a?token=1", "/a?Access_Token=x", "/a?sig=1", "/a?x=1&KEY=2", "/a?%zz", "/" + strings.Repeat("a", 1024)} {
		if auth.NativeOIDCNotifyPathValid(p) {
			t.Fatalf("%q should be refused", p)
		}
	}
}

func TestNativeOIDCNotifyKey(t *testing.T) {
	pattern := regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
	a := auth.NativeOIDCNotifyKey("shared", "ws-uuid", "alice", "bob", "1760000000")
	if a != auth.NativeOIDCNotifyKey("shared", "ws-uuid", "alice", "bob", "1760000000") {
		t.Fatal("key must be deterministic")
	}
	if !pattern.MatchString(a) || !strings.HasPrefix(a, "cells.shared.") || len(a) != len("cells.shared.")+40 {
		t.Fatalf("key %q out of contract", a)
	}
	for _, other := range []string{
		auth.NativeOIDCNotifyKey("shared", "ws-uuid", "carol", "bob", "1760000000"),
		auth.NativeOIDCNotifyKey("shared", "ws-uuidalice", "", "bob", "1760000000"),
		auth.NativeOIDCNotifyKey("commented", "ws-uuid", "alice", "bob", "1760000000"),
	} {
		if other == a {
			t.Fatal("different event or recipient must give a different key")
		}
	}
}

func TestNativeOIDCMentions(t *testing.T) {
	got := auth.NativeOIDCMentions(`"@alice please check, cc @Bob.Smith. mail x@example.com (@carol) @dave- @alice @ @-x"`)
	want := []string{"alice", "Bob.Smith", "carol", "dave"}
	if !slices.Equal(got, want) {
		t.Fatalf("mentions = %v, want %v", got, want)
	}
	if len(auth.NativeOIDCMentions("no mention, only a@b.c")) != 0 {
		t.Fatal("an e-mail address is not a mention")
	}
	many := ""
	for i := 0; i < 30; i++ {
		many += " @user" + string(rune('a'+i%26)) + string(rune('a'+i/26))
	}
	if n := len(auth.NativeOIDCMentions(many)); n != 20 {
		t.Fatalf("mentions must be capped at 20, got %d", n)
	}
}

func TestNativeOIDCNotifyAggregator(t *testing.T) {
	agg := &auth.NativeOIDCNotifyAggregator{Window: time.Minute}
	t0 := time.Unix(1760000000, 0)
	add := func(recipient, folder, node, actor, event string, at time.Time) {
		agg.Add(auth.NativeOIDCNotifyChange{Recipient: recipient, Folder: folder, Node: node, Name: node + ".txt", Actor: actor, Event: event, At: at})
	}
	// An upload of 3 files (one written twice) seen by alice in one folder,
	// one change in another folder, and a change for bob.
	add("alice", "ds/folder", "n1", "carol", "created", t0)
	add("alice", "ds/folder", "n2", "carol", "created", t0.Add(time.Second))
	add("alice", "ds/folder", "n1", "carol", "updated", t0.Add(2*time.Second))
	add("alice", "ds/folder", "n3", "carol", "created", t0.Add(3*time.Second))
	add("alice", "ds/other", "n4", "dave", "deleted", t0.Add(4*time.Second))
	add("bob", "ds/folder", "n1", "carol", "created", t0)
	if due := agg.Due(t0.Add(59 * time.Second)); len(due) != 0 {
		t.Fatalf("nothing is due inside the window, got %d", len(due))
	}
	due := agg.Due(t0.Add(time.Minute))
	if len(due) != 2 {
		t.Fatalf("two (recipient, folder) groups opened at t0 are due, got %d", len(due))
	}
	var alice *auth.NativeOIDCNotifyBatch
	for _, b := range due {
		if b.Recipient == "alice" {
			alice = b
		}
	}
	if alice == nil || alice.Folder != "ds/folder" || len(alice.Changes) != 3 || alice.Changes[0].Event != "created" || alice.Actor() != "carol" {
		t.Fatalf("aggregated batch = %+v", alice)
	}
	key := alice.Key()
	reordered := &auth.NativeOIDCNotifyBatch{Recipient: "alice", Folder: "ds/folder", First: alice.First,
		Changes: []auth.NativeOIDCNotifyChange{alice.Changes[2], alice.Changes[0], alice.Changes[1]}}
	if reordered.Key() != key || !strings.HasPrefix(key, "cells.updated.") {
		t.Fatalf("batch key must not depend on order: %q vs %q", reordered.Key(), key)
	}
	rest := agg.Due(t0.Add(2 * time.Minute))
	if len(rest) != 1 || rest[0].Folder != "ds/other" || len(rest[0].Changes) != 1 {
		t.Fatalf("remaining group = %+v", rest)
	}
	mixed := &auth.NativeOIDCNotifyBatch{Changes: []auth.NativeOIDCNotifyChange{{Actor: "a"}, {Actor: "b"}}}
	if mixed.Actor() != "" {
		t.Fatal("several authors have no single actor")
	}
}

func TestNativeOIDCNotificationNormalize(t *testing.T) {
	now := time.Unix(1760000000, 0)
	alice := auth.NativeOIDCPerson{Issuer: "https://idp.example/realms/k", Subject: "alice"}
	n := auth.NativeOIDCNotification{
		IdempotencyKey: "cells.shared.abc",
		Recipient:      alice,
		Actor:          &alice,
		Category:       auth.NativeOIDCNotifyShared,
		Title:          auth.NativeOIDCText{ZH: strings.Repeat("长", 200), EN: "a\x00b\nc"},
		Summary:        &auth.NativeOIDCText{ZH: " ", EN: "x"},
		Path:           "/ws-a",
		OccurredAt:     now.Add(time.Hour).Format(time.RFC3339),
	}
	if err := n.Normalize(now); err != nil {
		t.Fatal(err)
	}
	if n.Actor != nil || n.Summary != nil || utf8.RuneCountInString(n.Title.ZH) != 120 || !strings.HasSuffix(n.Title.ZH, "…") ||
		n.Title.EN != "a b c" || n.OccurredAt != now.UTC().Format(time.RFC3339) {
		t.Fatalf("normalized = %+v", n)
	}
	for _, bad := range []auth.NativeOIDCNotification{
		{IdempotencyKey: "bad key", Recipient: alice, Category: "SHARED", Title: auth.NativeOIDCText{ZH: "x", EN: "x"}, Path: "/a"},
		{IdempotencyKey: "k", Recipient: alice, Category: "OTHER", Title: auth.NativeOIDCText{ZH: "x", EN: "x"}, Path: "/a"},
		{IdempotencyKey: "k", Category: "SHARED", Title: auth.NativeOIDCText{ZH: "x", EN: "x"}, Path: "/a"},
		{IdempotencyKey: "k", Recipient: alice, Category: "SHARED", Title: auth.NativeOIDCText{ZH: "", EN: "x"}, Path: "/a"},
		{IdempotencyKey: "k", Recipient: alice, Category: "SHARED", Title: auth.NativeOIDCText{ZH: "x", EN: "x"}, Path: "/a?code=1"},
	} {
		if bad.Normalize(now) == nil {
			t.Fatalf("%+v should be refused", bad)
		}
	}
	title := auth.NativeOIDCNotifyTitle("changes", "", "Q3", 5)
	if title.ZH != "「Q3」中有 5 项内容更新" || title.EN != "5 items changed in “Q3”" {
		t.Fatalf("title = %+v", title)
	}
}

type notifyCore struct {
	mu       sync.Mutex
	statuses []int
	tokens   int
	bodies   []map[string]any
	bearers  []string
}

func (c *notifyCore) server(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		defer c.mu.Unlock()
		switch r.URL.Path {
		case "/token":
			c.tokens++
			if user, pass, ok := r.BasicAuth(); !ok || user != "kailo-cells-directory" || pass != "directory-secret-value" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "tok-" + string(rune('0'+c.tokens)), "token_type": "Bearer", "expires_in": 300})
		case "/service/v1/component-notifications/bindings/" + notifyBinding + "/notifications":
			var body map[string]any
			if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" || json.NewDecoder(r.Body).Decode(&body) != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			c.bodies = append(c.bodies, body)
			c.bearers = append(c.bearers, r.Header.Get("Authorization"))
			status := http.StatusCreated
			if len(c.statuses) > 0 {
				status, c.statuses = c.statuses[0], c.statuses[1:]
			}
			if status == http.StatusTooManyRequests {
				w.Header().Set("Retry-After", "7")
			}
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"notificationId":"00000000-0000-4000-8000-000000000001","duplicate":false}`))
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func notifyConfig(t *testing.T, srv *httptest.Server) *auth.NativeOIDCDirectoryConfig {
	secret := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(secret, []byte("directory-secret-value\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return &auth.NativeOIDCDirectoryConfig{BindingID: notifyBinding, ClientID: "kailo-cells-directory", ClientSecretFile: secret,
		TokenURL: srv.URL + "/token", CoreURL: srv.URL, WorkspaceRoot: "kailobinding/kailo-binding", Interval: time.Minute, HTTP: srv.Client()}
}

func notifySample(key string) auth.NativeOIDCNotification {
	return auth.NativeOIDCNotification{
		IdempotencyKey: key,
		Recipient:      auth.NativeOIDCPerson{Issuer: "https://idp.example/realms/k", Subject: "alice"},
		Actor:          &auth.NativeOIDCPerson{Issuer: "https://idp.example/realms/k", Subject: "bob"},
		Category:       auth.NativeOIDCNotifyShared,
		Title:          auth.NativeOIDCText{ZH: "bob 与你共享了「Q3」", EN: "bob shared “Q3” with you"},
		Path:           "/ws-q3",
		OccurredAt:     "2026-10-23T08:00:00Z",
	}
}

func TestNativeOIDCNotifierDeliver(t *testing.T) {
	cases := []struct {
		name     string
		statuses []int
		done     bool
		retry    bool
		posts    int
		tokens   int
	}{
		{"created", []int{201}, true, false, 1, 1},
		{"duplicate", []int{200}, true, false, 1, 1},
		{"conflict not retried", []int{409}, false, false, 1, 1},
		{"invalid not retried", []int{400}, false, false, 1, 1},
		{"rate limited retried", []int{429}, false, true, 1, 1},
		{"unavailable retried", []int{503}, false, true, 1, 1},
		{"403 refreshes the token once", []int{403, 201}, true, false, 2, 2},
		{"401 refreshes the token once", []int{401, 200}, true, false, 2, 2},
		{"403 twice is refused", []int{403, 403}, false, false, 2, 2},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			core := &notifyCore{statuses: c.statuses}
			srv := core.server(t)
			defer srv.Close()
			n := auth.NewNativeOIDCNotifier(notifyConfig(t, srv))
			result := n.Deliver(context.Background(), notifySample("cells.shared.k1"))
			if result.Done != c.done || result.Retry != c.retry || len(core.bodies) != c.posts || core.tokens != c.tokens {
				t.Fatalf("result %+v posts %d tokens %d", result, len(core.bodies), core.tokens)
			}
			if c.statuses[0] == 429 && result.RetryAfter != 7*time.Second {
				t.Fatalf("Retry-After not honoured: %v", result.RetryAfter)
			}
			body := core.bodies[0]
			keys := make([]string, 0, len(body))
			for k := range body {
				keys = append(keys, k)
			}
			slices.Sort(keys)
			if !slices.Equal(keys, []string{"actor", "category", "idempotencyKey", "occurredAt", "path", "recipient", "title"}) {
				t.Fatalf("body keys %v", keys)
			}
			if title := body["title"].(map[string]any); title["ZH_CN"] == nil || title["EN"] == nil || core.bearers[0] != "Bearer tok-1" {
				t.Fatalf("body %v bearer %q", body, core.bearers[0])
			}
		})
	}
	// The token is cached for its lifetime across deliveries.
	core := &notifyCore{}
	srv := core.server(t)
	defer srv.Close()
	n := auth.NewNativeOIDCNotifier(notifyConfig(t, srv))
	for i := 0; i < 3; i++ {
		if !n.Deliver(context.Background(), notifySample("cells.shared.k2")).Done {
			t.Fatal("delivery failed")
		}
	}
	if core.tokens != 1 {
		t.Fatalf("token fetched %d times, want 1", core.tokens)
	}
	// A transport failure is retriable.
	srv.Close()
	if r := n.Deliver(context.Background(), notifySample("cells.shared.k3")); r.Done || !r.Retry {
		t.Fatalf("transport failure = %+v", r)
	}
}

func TestNativeOIDCNotifierQueue(t *testing.T) {
	// retried: 503 then 201 after backoff; refused: 403, token refresh, 403.
	core := &notifyCore{statuses: []int{503, 403, 403, 201}}
	srv := core.server(t)
	defer srv.Close()
	n := auth.NewNativeOIDCNotifier(notifyConfig(t, srv))
	n.Backoff = func(int) time.Duration { return 20 * time.Millisecond }
	n.Capacity = 2
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// Out of contract: never queued.
	bad := notifySample("cells.shared.bad")
	bad.Path = "/a?token=x"
	if n.Enqueue(ctx, bad) {
		t.Fatal("an invalid notification must not be queued")
	}
	// Bounded queue: the oldest is dropped and counted.
	for _, key := range []string{"cells.shared.dropped", "cells.shared.retried", "cells.shared.refused"} {
		n.Enqueue(ctx, notifySample(key))
	}
	if n.Dropped() != 1 || n.Pending() != 2 {
		t.Fatalf("dropped %d pending %d", n.Dropped(), n.Pending())
	}
	go n.Run(ctx)
	deadline := time.Now().Add(5 * time.Second)
	for {
		core.mu.Lock()
		posts := len(core.bodies)
		core.mu.Unlock()
		if posts >= 4 || time.Now().After(deadline) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond)
	core.mu.Lock()
	defer core.mu.Unlock()
	var keys []string
	for _, b := range core.bodies {
		keys = append(keys, b["idempotencyKey"].(string))
	}
	want := []string{"cells.shared.retried", "cells.shared.refused", "cells.shared.refused", "cells.shared.retried"}
	if !slices.Equal(keys, want) || core.tokens != 2 || core.bearers[3] != "Bearer tok-2" {
		t.Fatalf("posts %v tokens %d bearers %v", keys, core.tokens, core.bearers)
	}
}
