package middleware

import (
	"net/http"
	"testing"
)

// Kailo DD-164(4): knowledge base shares are written only by the directory
// sync in Kailo mode; the native share writes are closed, reading stays open.
func TestKailoModeClosesKnowledgeBaseShareWrites(t *testing.T) {
	for _, c := range []struct {
		method, path string
		closed       bool
	}{
		{http.MethodPost, "/api/v1/knowledge-bases/kb-1/shares", true},
		{http.MethodPut, "/api/v1/knowledge-bases/kb-1/shares/s-1", true},
		{http.MethodDelete, "/api/v1/knowledge-bases/kb-1/shares/s-1", true},
		{http.MethodGet, "/api/v1/knowledge-bases/kb-1/shares", false},
		{http.MethodPost, "/api/v1/kailo/share-intents", false},
	} {
		if got := IsKailoClosedRoute(c.method, c.path); got != c.closed {
			t.Fatalf("%s %s closed=%v", c.method, c.path, got)
		}
	}
}
