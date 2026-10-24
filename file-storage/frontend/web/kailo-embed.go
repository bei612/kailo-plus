package web

// Kailo presentation of the native frontend (DD-133 §1, §2, §4): brand assets,
// theme tokens and the embedding bridge are static files of this artifact
// (frontend/assets/kailo.embed, copied from client-kit/web-client at build
// time); the server only adds their tags, the public embedding parameters and
// the two OIDC pages that must not render the native application.
import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"os"
	"strings"
	"unicode"
)

const (
	kailoEmbedRoot = "plug/kailo.embed"
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

// kailoEmbedFeatures are the DD-157 page-shell features this build implements
// (07 §4.8.7): Kailo draws the page header, toasts and destructive confirmations
// and owns the global chords. Read by kailo-embed.js, so it precedes the runtime.
const kailoEmbedFeatures = "page toast confirm shortcuts"

// kailoHead places, before the native styles and boot script (07 §4.7.1):
// the Kailo web origin (KAILO_FRAME_ANCESTORS, the frame-ancestors fact), the
// DD-157 feature declaration, the platform token sheet and runtime
// (kailo-embed.js), the Cells overlay and the Cells bridge, so the first paint
// already uses the Kailo theme.
// The paths are root-absolute: this head precedes the page's <base>, so a
// relative path resolved against the request path (/login/callback loaded
// /login/plug/... as HTML and the runtime never started after SSO).
func kailoHead(version string) template.HTML {
	v := url.QueryEscape(version)
	root := "/" + kailoEmbedRoot
	var b strings.Builder
	fmt.Fprintf(&b, `<meta name="kailo-web-origin" content="%s">`+"\n", template.HTMLEscapeString(strings.Join(kailoWebOrigins(), " ")))
	fmt.Fprintf(&b, `<meta name="kailo-embed-features" content="%s">`+"\n", kailoEmbedFeatures)
	fmt.Fprintf(&b, `<link rel="stylesheet" type="text/css" href="%s/kailo-theme-tokens.css?v=%s">`+"\n", root, v)
	fmt.Fprintf(&b, `<link rel="stylesheet" type="text/css" href="%s/kailo-overlay.css?v=%s">`+"\n", root, v)
	fmt.Fprintf(&b, `<script type="text/javascript" src="%s/kailo-embed.js?v=%s"></script>`+"\n", root, v)
	fmt.Fprintf(&b, `<script type="text/javascript" src="%s/kailo-cells.js?v=%s"></script>`+"\n", root, v)
	return template.HTML(b.String())
}

// kailoWebOrigins are the HTTP(S) Kailo origins of kailoHostOrigins.
func kailoWebOrigins() []string {
	out := []string{}
	for _, o := range kailoHostOrigins() {
		if strings.HasPrefix(o, "http://") || strings.HasPrefix(o, "https://") {
			out = append(out, o)
		}
	}
	return out
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
<meta name="kailo-web-origin" content="{{.Origins}}">
<link rel="stylesheet" type="text/css" href="/{{.Root}}/kailo-theme-tokens.css">
<link rel="stylesheet" type="text/css" href="/{{.Root}}/kailo-overlay.css">
<script nonce="{{.Nonce}}" src="/{{.Root}}/kailo-embed.js"></script>
</head>
<body class="kailo-minimal-page">
{{if .Message}}<main class="kailo-minimal-message"><img src="/{{.Favicon}}" alt="" width="40" height="40"><p>{{.Message}}</p><p lang="en">{{.MessageEn}}</p></main>{{end}}
<script nonce="{{.Nonce}}">{{.Script}}</script>
</body>
</html>
`))

type kailoMinimalPageData struct {
	Title, Favicon, Root, Origins, Message, MessageEn, Nonce string
	Script                                                   template.JS
}

func writeKailoMinimalPage(w http.ResponseWriter, status int, ancestors []string, data kailoMinimalPageData) {
	nonce, err := kailoNonce()
	if err != nil {
		http.Error(w, "Native page is unavailable", http.StatusServiceUnavailable)
		return
	}
	data.Nonce, data.Favicon, data.Root = nonce, KailoFavicon, kailoEmbedRoot
	data.Origins = strings.Join(kailoWebOrigins(), " ")
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
// IdP session: through the platform runtime (wire v1 "auth-required") the
// Kailo host signs in again at top level. No login form, button or popup is
// rendered inside the frame; a top-level visit restarts the Kailo login.
func serveKailoAuthRequired(w http.ResponseWriter) {
	script := `(function(){var e=window.KailoEmbed;` +
		`if(window.parent!==window){if(e){e.requestTopLevelSignIn();}}` +
		`else{window.location.replace("/");}})();`
	writeKailoMinimalPage(w, http.StatusOK, kailoWebOrigins(), kailoMinimalPageData{
		Message:   "Kailo 登录状态已失效，请在 Kailo 中重新登录后再打开云盘。",
		MessageEn: "Your Kailo sign-in has expired. Sign in to Kailo again to open Files.",
		Script:    template.JS(script),
	})
}

// silentLoginRequired reports a prompt=none answer meaning "no IdP session".
func silentLoginRequired(code string) bool {
	return code != "" && strings.Contains(" "+kailoSilentLoginRequired+" ", " "+code+" ")
}
