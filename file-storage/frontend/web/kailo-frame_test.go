package web

import (
	"net/http/httptest"
	"testing"
)

func TestNativeFrameHeadersPreserveNativeProtection(t *testing.T) {
	t.Setenv("KAILO_FRAME_ANCESTORS", "https://kailo.example.invalid tauri://localhost")
	w := httptest.NewRecorder()
	err := nativeSecureHeaders(w, map[string]string{
		"Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
		"X-Frame-Options":         "DENY",
		"X-Content-Type-Options":  "nosniff",
	})
	if err != nil || w.Header().Get("Content-Security-Policy") != "default-src 'self'; object-src 'none'; frame-ancestors 'self' https://kailo.example.invalid tauri://localhost" || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("X-Frame-Options") != "" {
		t.Fatal("explicit frame allowlist must preserve all other native directives")
	}
}

func TestNativeFrameHeadersDefaultAndInvalid(t *testing.T) {
	for _, raw := range []string{"", "  \t "} {
		t.Setenv("KAILO_FRAME_ANCESTORS", raw)
		w := httptest.NewRecorder()
		policy := "default-src 'self'; frame-ancestors 'none'; object-src 'none'"
		if err := nativeSecureHeaders(w, map[string]string{"Content-Security-Policy": policy, "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff"}); err != nil || w.Header().Get("Content-Security-Policy") != policy || w.Header().Get("X-Frame-Options") != "DENY" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal("missing deployment allowlist must preserve the original native policy byte-for-byte")
		}
		withoutCSP := httptest.NewRecorder()
		if err := nativeSecureHeaders(withoutCSP, map[string]string{"X-Frame-Options": "SAMEORIGIN"}); err != nil || withoutCSP.Header().Get("Content-Security-Policy") != "" || withoutCSP.Header().Get("X-Frame-Options") != "SAMEORIGIN" {
			t.Fatal("missing deployment allowlist must not replace the original header policy")
		}
	}
	for _, raw := range []string{"*", "https://*.example.invalid", "https://host.invalid/path", "https://user@host.invalid", "https://host.invalid?query", "https://host.invalid#fragment", "https://host.invalid;default-src *", "data:text/html,test", "https://host.invalid:0", "https://host.invalid:65536", "tauri://localhost:", "tauri://"} {
		if _, err := nativeFrameAncestors(raw); err == nil {
			t.Errorf("unsafe frame ancestor was accepted: %q", raw)
		}
	}
}
