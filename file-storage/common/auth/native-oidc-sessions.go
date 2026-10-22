package auth

// Native sessions opened by the Kailo OIDC login and their end on an IdP
// back-channel logout (07 §4.7.5, DD-133). At login the callback records the
// native (Hydra) session ID with the IdP iss/sub/sid; a verified logout_token
// marks the matching records ended. JWTVerifier.Verify refuses every token of
// an ended or expired recorded session, refreshed ones included (they keep
// the session ID), so the next request re-runs the silent OIDC login. The
// store is a small owner-only file in the native working directory, written
// only by this process; sessions it never recorded (native password logins,
// personal access tokens) are not affected.
import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/pydio/cells/v5/common/auth/hydra"
	"github.com/pydio/cells/v5/common/runtime"
)

// ErrNativeOIDCLogoutReplay: the logout_token jti was already processed.
var ErrNativeOIDCLogoutReplay = errors.New("logout token already processed")

// NativeOIDCSessionStorePath locates the store (replaced by tests).
var NativeOIDCSessionStorePath = func() string {
	return filepath.Join(runtime.ApplicationWorkingDir(), "kailo", "oidc-sessions.json")
}

type nativeOIDCSessionRecord struct {
	Issuer     string `json:"iss"`
	Subject    string `json:"sub"`
	IdPSession string `json:"sid,omitempty"`
	User       string `json:"user"`
	Created    int64  `json:"created"`
	Expires    int64  `json:"expires"`
	Ended      bool   `json:"ended,omitempty"`
}

type nativeOIDCSessionData struct {
	Sessions     map[string]*nativeOIDCSessionRecord `json:"sessions"`
	LogoutTokens map[string]int64                    `json:"logoutTokens"`
}

var nativeOIDCSessions struct {
	sync.Mutex
	path string
	data *nativeOIDCSessionData
}

// load returns the in-memory store for the current path; caller holds the lock.
func nativeOIDCSessionStore() (*nativeOIDCSessionData, string, error) {
	p := NativeOIDCSessionStorePath()
	if nativeOIDCSessions.data != nil && nativeOIDCSessions.path == p {
		return nativeOIDCSessions.data, p, nil
	}
	data := &nativeOIDCSessionData{}
	raw, err := os.ReadFile(p)
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, p, err
	default:
		if err := json.Unmarshal(raw, data); err != nil {
			return nil, p, errors.New("native OIDC session store is unreadable")
		}
	}
	if data.Sessions == nil {
		data.Sessions = map[string]*nativeOIDCSessionRecord{}
	}
	if data.LogoutTokens == nil {
		data.LogoutTokens = map[string]int64{}
	}
	nativeOIDCSessions.path, nativeOIDCSessions.data = p, data
	return data, p, nil
}

// save prunes expired entries and replaces the file atomically (0600).
func (d *nativeOIDCSessionData) save(p string, now time.Time) error {
	for id, s := range d.Sessions {
		if s.Expires < now.Unix() {
			delete(d.Sessions, id)
		}
	}
	for jti, exp := range d.LogoutTokens {
		if exp < now.Unix() {
			delete(d.LogoutTokens, jti)
		}
	}
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	raw, err := json.Marshal(d)
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, raw, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// RecordNativeOIDCSession remembers the native session of a Kailo login for
// at most maxAge (not longer than the IdP SSO session).
func RecordNativeOIDCSession(nativeSession, issuer, subject, idpSession, userUUID string, maxAge time.Duration) error {
	if nativeSession == "" || issuer == "" || subject == "" || userUUID == "" || maxAge <= 0 {
		return errors.New("native OIDC session cannot be recorded")
	}
	nativeOIDCSessions.Lock()
	defer nativeOIDCSessions.Unlock()
	data, p, err := nativeOIDCSessionStore()
	if err != nil {
		return err
	}
	now := time.Now()
	data.Sessions[nativeSession] = &nativeOIDCSessionRecord{Issuer: issuer, Subject: subject, IdPSession: idpSession, User: userUUID,
		Created: now.Unix(), Expires: now.Add(maxAge).Unix()}
	return data.save(p, now)
}

// NativeOIDCSessionEnded reports a recorded native session that a
// back-channel logout ended or that outlived its maximum age. An unreadable
// store (written atomically, so only by outside damage) fails closed.
func NativeOIDCSessionEnded(nativeSession string) bool {
	if nativeSession == "" {
		return false
	}
	nativeOIDCSessions.Lock()
	defer nativeOIDCSessions.Unlock()
	data, _, err := nativeOIDCSessionStore()
	if err != nil {
		return true
	}
	s, ok := data.Sessions[nativeSession]
	return ok && (s.Ended || s.Expires < time.Now().Unix())
}

// EndNativeOIDCSessions ends the recorded native sessions of a verified
// logout_token: those of its IdP sid, or of its iss+sub when it has no sid.
// The jti is remembered until jtiExpires; a repeated jti is refused. The
// native login sessions are also logged out of the native OAuth service
// (best effort: the record already refuses their tokens).
func EndNativeOIDCSessions(ctx context.Context, issuer, subject, idpSession, jti string, jtiExpires time.Time) (int, error) {
	if issuer == "" || jti == "" || (idpSession == "" && subject == "") {
		return 0, errors.New("incomplete logout token")
	}
	nativeOIDCSessions.Lock()
	data, p, err := nativeOIDCSessionStore()
	if err != nil {
		nativeOIDCSessions.Unlock()
		return 0, err
	}
	now := time.Now()
	if exp, seen := data.LogoutTokens[jti]; seen && exp >= now.Unix() {
		nativeOIDCSessions.Unlock()
		return 0, ErrNativeOIDCLogoutReplay
	}
	type ended struct{ id, user string }
	var list []ended
	for id, s := range data.Sessions {
		if s.Issuer != issuer || s.Ended {
			continue
		}
		if idpSession != "" {
			if s.IdPSession != idpSession || (subject != "" && s.Subject != subject) {
				continue
			}
		} else if s.Subject != subject {
			continue
		}
		s.Ended = true
		list = append(list, ended{id, s.User})
	}
	data.LogoutTokens[jti] = jtiExpires.Unix()
	err = data.save(p, now)
	nativeOIDCSessions.Unlock()
	if err != nil {
		return 0, err
	}
	for _, e := range list {
		if logout, err := hydra.CreateLogout(ctx, "", e.user, e.id); err == nil && logout != nil {
			_ = hydra.AcceptLogout(ctx, logout.GetChallenge(), "", "")
		}
	}
	return len(list), nil
}
