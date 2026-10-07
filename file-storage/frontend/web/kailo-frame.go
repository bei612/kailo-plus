package web

import (
	"errors"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// The native frontend retains its existing security directives. Only the
// embedding ancestor list is supplied by the service's controlled deployment;
// it grants neither a Cells session nor permission to read a workspace.
func nativeFrameAncestors(raw string) (string, error) {
	ancestors := []string{"'self'"}
	for _, origin := range strings.Fields(raw) {
		u, err := url.Parse(origin)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "tauri") || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || strings.ContainsAny(origin, "*;'\"\\") || u.Scheme+"://"+u.Host != origin {
			return "", errors.New("invalid configured native frame ancestor")
		}
		if strings.HasSuffix(u.Host, ":") || u.Hostname() == "" {
			return "", errors.New("invalid configured native frame host")
		}
		if u.Port() != "" {
			port, err := strconv.ParseUint(u.Port(), 10, 16)
			if err != nil || port == 0 {
				return "", errors.New("invalid configured native frame port")
			}
		}
		ancestors = append(ancestors, origin)
	}
	return "frame-ancestors " + strings.Join(ancestors, " "), nil
}

func nativeSecureHeaders(w http.ResponseWriter, configured map[string]string) error {
	raw := os.Getenv("KAILO_FRAME_ANCESTORS")
	for name, value := range configured {
		w.Header().Set(name, value)
	}
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	ancestors, err := nativeFrameAncestors(raw)
	if err != nil {
		return err
	}
	directives := []string{}
	for _, directive := range strings.Split(w.Header().Get("Content-Security-Policy"), ";") {
		fields := strings.Fields(directive)
		if len(fields) > 0 && !strings.EqualFold(fields[0], "frame-ancestors") {
			directives = append(directives, strings.TrimSpace(directive))
		}
	}
	directives = append(directives, ancestors)
	w.Header().Set("Content-Security-Policy", strings.Join(directives, "; "))
	// XFO cannot express a finite cross-origin allowlist. The more precise
	// CSP above replaces this one directive, not the other native headers.
	w.Header().Del("X-Frame-Options")
	return nil
}
