package web

// Kailo presentation of the native frontend (DD-133 §1, §2, §4): brand assets,
// theme tokens and the embedding bridge are static files of this artifact
// (frontend/assets/kailo.embed, copied from client-kit/web-client at build
// time); the server only adds their tags, the public embedding parameters and
// the two OIDC pages that must not render the native application.
import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"os"
	"strings"
	"unicode"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/service/frontend"
	"github.com/pydio/cells/v5/common/service/frontend/sessions"
)

const (
	// KailoOIDCLogoutPath receives the IdP front-channel logout of the Kailo
	// session (GET, in an IdP frame) and the cookie clearing step (POST).
	KailoOIDCLogoutPath = "/auth/kailo/logout"
	kailoEmbedRoot      = "plug/kailo.embed"
	// KailoFavicon is the Kailo application icon copied from the web-client
	// build at image build time (one asset for favicon, loader and logos).
	KailoFavicon = kailoEmbedRoot + "/brand/app-icon.png"
	// Silent OIDC errors that mean "no IdP session": the page asks the Kailo
	// host to sign in again at top level instead of rendering a login form.
	kailoSilentLoginRequired = "login_required interaction_required consent_required account_selection_required"
)

// kailoPlatformName is the deployment display name (platform .env
// PLATFORM_DISPLAY_NAME passed to the container); empty when not delivered.
func kailoPlatformName() string {
	name := strings.TrimSpace(os.Getenv("PLATFORM_DISPLAY_NAME"))
	if name == "" || len(name) > 64 || strings.IndexFunc(name, func(r rune) bool { return !unicode.IsPrint(r) }) >= 0 {
		return ""
	}
	return name
}

// kailoHostOrigins are the HTTP(S) Kailo origins allowed to embed this page
// (KAILO_FRAME_ANCESTORS); the bridge accepts postMessage only from them and
// sends only to them. Tauri origins frame the page too but carry no web host.
func kailoHostOrigins() []string {
	raw := os.Getenv("KAILO_FRAME_ANCESTORS")
	if _, err := nativeFrameAncestors(raw); err != nil {
		return []string{}
	}
	origins := []string{}
	for _, origin := range strings.Fields(raw) {
		if strings.HasPrefix(origin, "http://") || strings.HasPrefix(origin, "https://") || strings.HasPrefix(origin, "tauri://") {
			origins = append(origins, origin)
		}
	}
	return origins
}

// nativeKailoEmbedParameters are the public presentation parameters of the
// native page; no connector, link, credential or user data is included.
func nativeKailoEmbedParameters(r *http.Request) map[string]any {
	name := kailoPlatformName()
	titles := map[string]string{"zh-cn": "云盘", "en-us": "Files"}
	if name != "" {
		titles = map[string]string{"zh-cn": name + " 云盘", "en-us": name + " Files"}
	}
	params := map[string]any{
		"displayName": name,
		"titles":      titles,
		"origins":     kailoHostOrigins(),
		"component":   "file_storage",
		"sso":         false,
	}
	if c, err := loadKailoOIDC(r.Context()); err == nil {
		params["sso"] = true
		if c.Config.PlatformLogoutURL != "" {
			params["logoutUrl"] = c.Config.PlatformLogoutURL
		}
	}
	return params
}

// kailoPlatformLogoutURL accepts only an absolute HTTP(S) Kailo address.
func kailoPlatformLogoutURL(raw string) error {
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || len(raw) > 2048 {
		return fmt.Errorf("platform logout URL must be an absolute HTTP(S) address")
	}
	return nil
}

func kailoEmbedFileExists(name string) bool {
	f, err := frontend.GetPluginsFS().Open(strings.TrimPrefix(kailoEmbedRoot, "plug/") + "/" + name)
	if err != nil {
		return false
	}
	_ = f.Close()
	return true
}

// kailoHead links the Kailo tokens, the native overlay and the bridge before
// the native boot script, so the first paint already uses Kailo colors.
func kailoHead(version string) template.HTML {
	v := url.QueryEscape(version)
	var b strings.Builder
	fmt.Fprintf(&b, `<link rel="stylesheet" type="text/css" href="%s/kailo-theme-tokens.css?v=%s">`+"\n", kailoEmbedRoot, v)
	fmt.Fprintf(&b, `<link rel="stylesheet" type="text/css" href="%s/kailo-overlay.css?v=%s">`+"\n", kailoEmbedRoot, v)
	if kailoEmbedFileExists("kailo-embed.js") {
		// Platform-delivered embedding client (client-kit), when present.
		fmt.Fprintf(&b, `<script type="text/javascript" src="%s/kailo-embed.js?v=%s"></script>`+"\n", kailoEmbedRoot, v)
	}
	fmt.Fprintf(&b, `<script type="text/javascript" src="%s/kailo-cells.js?v=%s"></script>`+"\n", kailoEmbedRoot, v)
	return template.HTML(b.String())
}

func kailoNonce() (string, error) {
	b := make([]byte, 18)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(b), nil
}

// kailoPageOrigin is the scheme://host of an absolute URL, "" otherwise.
func kailoPageOrigin(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

var kailoMinimalPage = template.Must(template.New("kailo-minimal").Parse(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title>
<link rel="icon" type="image/png" href="/{{.Favicon}}">
<link rel="stylesheet" type="text/css" href="/{{.Root}}/kailo-theme-tokens.css">
<link rel="stylesheet" type="text/css" href="/{{.Root}}/kailo-overlay.css">
</head>
<body class="kailo-minimal-page">
{{if .Message}}<main class="kailo-minimal-message"><img src="/{{.Favicon}}" alt="" width="40" height="40"><p>{{.Message}}</p><p lang="en">{{.MessageEn}}</p></main>{{end}}
<script nonce="{{.Nonce}}">{{.Script}}</script>
</body>
</html>
`))

type kailoMinimalPageData struct {
	Title, Favicon, Root, Message, MessageEn, Nonce string
	Script                                          template.JS
}

func writeKailoMinimalPage(w http.ResponseWriter, status int, ancestors []string, data kailoMinimalPageData) {
	nonce, err := kailoNonce()
	if err != nil {
		http.Error(w, "Native page is unavailable", http.StatusServiceUnavailable)
		return
	}
	data.Nonce, data.Favicon, data.Root = nonce, KailoFavicon, kailoEmbedRoot
	if data.Title == "" {
		data.Title = nativeKailoEmbedTitle()
	}
	frame := "'self'"
	for _, a := range ancestors {
		if a != "" {
			frame += " " + a
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'self'; connect-src 'self'; script-src 'nonce-"+nonce+"'; base-uri 'none'; form-action 'none'; frame-ancestors "+frame)
	w.WriteHeader(status)
	_ = kailoMinimalPage.Execute(w, data)
}

func nativeKailoEmbedTitle() string {
	if name := kailoPlatformName(); name != "" {
		return name + " 云盘"
	}
	return "云盘"
}

// serveKailoAuthRequired answers a silent (prompt=none) login that found no
// IdP session: the Kailo host is asked to sign in again at top level. No
// login form, button or popup is rendered inside the frame.
func serveKailoAuthRequired(w http.ResponseWriter) {
	origins := kailoHostOrigins()
	script := `(function(){var o=` + jsStringArray(origins) + `;var m={type:"kailo.native.auth-required",component:"file_storage"};` +
		`if(window.parent&&window.parent!==window){for(var i=0;i<o.length;i++){try{window.parent.postMessage(m,o[i]);}catch(e){}}}` +
		`else{window.location.replace("/");}})();`
	writeKailoMinimalPage(w, http.StatusOK, origins, kailoMinimalPageData{
		Message:   "Kailo 登录状态已失效，请在 Kailo 中重新登录后再打开云盘。",
		MessageEn: "Your Kailo sign-in has expired. Sign in to Kailo again to open Files.",
		Script:    template.JS(script),
	})
}

// jsStringArray: JSON (with <, >, & escaped) is a safe script literal.
func jsStringArray(values []string) string {
	data, err := json.Marshal(values)
	if err != nil {
		return "[]"
	}
	return string(data)
}

// NativeKailoOIDCLogout is the OIDC front-channel logout receiver of the
// connector client (GET in an IdP frame, with optional iss/sid) and the
// cookie clearing step its page posts back. The native session is ended the
// native way first (POST /a/frontend/session logout revokes its tokens), then
// both native cookies are expired; open native pages of this browser are told
// to reload through a same-origin BroadcastChannel.
func NativeKailoOIDCLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	c, err := loadKailoOIDC(r.Context())
	if err != nil {
		http.Error(w, "Native OIDC is unavailable", http.StatusServiceUnavailable)
		return
	}
	if cb, _ := url.Parse(c.Config.RedirectURI); cb == nil || r.Host != cb.Host {
		http.Error(w, "Invalid native frontend origin", http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodPost:
		// Only expires this browser's native cookies; nothing else is changed.
		opts := sessions.SessionOptionsFromConfig(r.Context())
		secure := strings.HasPrefix(c.Config.RedirectURI, "https://")
		// The native cookie session (common/service/frontend/sessions/utils.SessionName).
		http.SetCookie(w, &http.Cookie{Name: "pydio", Value: "", Path: opts.Path, MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: opts.SameSite})
		if err := auth.ClearNativeHumanToken(r, w); err != nil {
			http.Error(w, "Native session could not be cleared", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodGet:
		query, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil || len(query["iss"]) > 1 || len(query["sid"]) > 1 || (query.Has("iss") && query.Get("iss") != c.Config.Issuer) {
			http.Error(w, "Not a logout of the configured identity provider", http.StatusBadRequest)
			return
		}
		_ = auth.ClearNativeHumanToken(r, w)
		script := `(function(){function done(){try{new BroadcastChannel("kailo-cells").postMessage({type:"kailo.native.logged-out"});}catch(e){}}` +
			`var h={"Content-Type":"application/json"};` +
			`fetch("/a/frontend/session",{method:"POST",credentials:"same-origin",headers:h,body:JSON.stringify({AuthInfo:{type:"logout"}})})` +
			`.catch(function(){}).then(function(){return fetch("` + KailoOIDCLogoutPath + `",{method:"POST",credentials:"same-origin"});})` +
			`.catch(function(){}).then(done);})();`
		ancestors := append([]string{kailoPageOrigin(c.Config.Issuer)}, kailoHostOrigins()...)
		writeKailoMinimalPage(w, http.StatusOK, ancestors, kailoMinimalPageData{Script: template.JS(script)})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// silentLoginRequired reports a prompt=none answer meaning "no IdP session".
func silentLoginRequired(code string) bool {
	return code != "" && strings.Contains(" "+kailoSilentLoginRequired+" ", " "+code+" ")
}
