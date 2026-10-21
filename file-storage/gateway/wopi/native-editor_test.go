package wopi

import (
	"testing"

	"github.com/pydio/cells/v5/common/auth/claim"
)

func TestApplyNativeEditorFacts(t *testing.T) {
	scoped := func(scope string) claim.Claims {
		return claim.Claims{ProvidesScopes: true, Scopes: []string{scope}}
	}
	for name, c := range map[string]struct {
		claims       claim.Claims
		writableNode bool
		site         string
		write        bool
		origin       string
	}{
		"rw PAT on a writable node":   {scoped("node:n:rw"), true, "http://192.168.0.193:58092", true, "http://192.168.0.193:58092"},
		"r PAT on a writable node":    {scoped("node:n:r"), true, "http://192.168.0.193:58092/", false, "http://192.168.0.193:58092"},
		"rw PAT on a read-only node":  {scoped("node:n:rw"), false, "https://cells.example/sub", false, "https://cells.example"},
	} {
		f := &FileInfo{UserCanWrite: c.writableNode}
		if err := applyNativeEditorFacts(f, c.claims, c.site); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if f.UserCanWrite != c.write || f.PostMessageOrigin != c.origin {
			t.Errorf("%s: write=%v origin=%q", name, f.UserCanWrite, f.PostMessageOrigin)
		}
	}
	for name, c := range map[string]struct {
		claims claim.Claims
		site   string
	}{
		"no site URL":     {scoped("node:n:rw"), ""},
		"relative site":   {scoped("node:n:rw"), "/cells"},
		"other scheme":    {scoped("node:n:rw"), "ftp://cells.example"},
		"no scope":        {claim.Claims{}, "http://cells.example"},
		"two scopes":      {claim.Claims{ProvidesScopes: true, Scopes: []string{"node:a:rw", "node:b:rw"}}, "http://cells.example"},
	} {
		f := &FileInfo{UserCanWrite: true}
		if err := applyNativeEditorFacts(f, c.claims, c.site); err == nil {
			t.Errorf("%s: accepted", name)
		}
		if f.PostMessageOrigin != "" {
			t.Errorf("%s: origin set on refusal", name)
		}
	}
}
