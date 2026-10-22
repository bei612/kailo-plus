package auth_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pydio/cells/v5/common/auth"
)

func useSessionStore(t *testing.T) string {
	t.Helper()
	store := filepath.Join(t.TempDir(), "kailo", "oidc-sessions.json")
	previous := auth.NativeOIDCSessionStorePath
	auth.NativeOIDCSessionStorePath = func() string { return store }
	t.Cleanup(func() { auth.NativeOIDCSessionStorePath = previous })
	return store
}

// 07 §4.7.5 session bookkeeping: sid first, iss+sub without sid, jti replay,
// maximum age, owner-only persistence.
func TestNativeOIDCSessionRegistry(t *testing.T) {
	store := useSessionStore(t)
	ctx := context.Background()
	const iss = "https://idp.example.invalid/realms/kailo"
	for _, s := range []struct{ native, sub, sid string }{{"n1", "alice", "sid-a"}, {"n2", "alice", "sid-b"}, {"n3", "bob", "sid-c"}} {
		if err := auth.RecordNativeOIDCSession(s.native, iss, s.sub, s.sid, "uuid-"+s.sub, time.Hour); err != nil {
			t.Fatal(err)
		}
	}
	if info, err := os.Stat(store); err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("store not owner-only: %v", err)
	}
	if n, err := auth.EndNativeOIDCSessions(ctx, iss, "alice", "sid-a", "jti-1", time.Now().Add(time.Minute)); err != nil || n != 1 {
		t.Fatalf("sid logout: %d %v", n, err)
	}
	if !auth.NativeOIDCSessionEnded("n1") || auth.NativeOIDCSessionEnded("n2") || auth.NativeOIDCSessionEnded("n3") || auth.NativeOIDCSessionEnded("unknown") {
		t.Fatal("sid logout ended the wrong sessions")
	}
	if _, err := auth.EndNativeOIDCSessions(ctx, iss, "alice", "sid-a", "jti-1", time.Now().Add(time.Minute)); !errors.Is(err, auth.ErrNativeOIDCLogoutReplay) {
		t.Fatalf("replay: %v", err)
	}
	if n, err := auth.EndNativeOIDCSessions(ctx, "https://other-idp.example.invalid", "bob", "", "jti-2", time.Now().Add(time.Minute)); err != nil || n != 0 {
		t.Fatalf("foreign issuer ended sessions: %d %v", n, err)
	}
	if n, err := auth.EndNativeOIDCSessions(ctx, iss, "bob", "", "jti-3", time.Now().Add(time.Minute)); err != nil || n != 1 || !auth.NativeOIDCSessionEnded("n3") {
		t.Fatalf("sub logout: %d %v", n, err)
	}
	if _, err := auth.EndNativeOIDCSessions(ctx, iss, "", "", "jti-4", time.Now().Add(time.Minute)); err == nil {
		t.Fatal("logout naming nothing accepted")
	}
	// Another process start reads the same decisions back.
	auth.NativeOIDCSessionStorePath = func() string { return store + ".other" }
	if auth.NativeOIDCSessionEnded("n1") {
		t.Fatal("unrelated store reported ended")
	}
	auth.NativeOIDCSessionStorePath = func() string { return store }
	if !auth.NativeOIDCSessionEnded("n1") || auth.NativeOIDCSessionEnded("n2") {
		t.Fatal("persisted decisions lost")
	}
	// Maximum age: a session older than its bound is ended.
	if err := auth.RecordNativeOIDCSession("n4", iss, "carol", "sid-d", "uuid-carol", time.Second); err != nil {
		t.Fatal(err)
	}
	time.Sleep(2100 * time.Millisecond)
	if !auth.NativeOIDCSessionEnded("n4") {
		t.Fatal("expired session still valid")
	}
	if auth.RecordNativeOIDCSession("", iss, "carol", "", "uuid-carol", time.Hour) == nil {
		t.Fatal("untracked session recorded")
	}
}
