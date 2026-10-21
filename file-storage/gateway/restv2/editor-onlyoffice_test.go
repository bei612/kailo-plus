package restv2

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/configx"
)

const ooOrigin = "http://ds.example:58096"

// The placeholder tail DocumentServer's discovery writes (wopiClient.js), in the
// entity-escaped attribute form the XML parser hands over.
const ooTail = "&amp;lt;rs=DC_LLCC&amp;amp;&amp;gt;&amp;lt;dchat=DISABLE_CHAT&amp;amp;&amp;gt;&amp;lt;embed=EMBEDDED&amp;amp;&amp;gt;" +
	"&amp;lt;fs=FULLSCREEN&amp;amp;&amp;gt;&amp;lt;hid=HOST_SESSION_ID&amp;amp;&amp;gt;&amp;lt;rec=RECORDING&amp;amp;&amp;gt;" +
	"&amp;lt;sc=SESSION_CONTEXT&amp;amp;&amp;gt;&amp;lt;thm=THEME_ID&amp;amp;&amp;gt;&amp;lt;ui=UI_LLCC&amp;amp;&amp;gt;" +
	"&amp;lt;wopisrc=WOPI_SOURCE&amp;amp;&amp;gt;&amp;amp;"

func ooDiscoveryXML(origin string) string {
	action := func(name, ext, kind, mode string) string {
		return `<action name="` + name + `" ext="` + ext + `" urlsrc="` + origin + `/hosting/wopi/` + kind + `/` + mode + `?` + ooTail + `"/>`
	}
	return `<?xml version="1.0" encoding="utf-8"?><wopi-discovery><net-zone name="external-http">` +
		`<app name="Word" favIconUrl="` + origin + `/x.ico">` + action("view", "docx", "word", "view") + action("embedview", "docx", "word", "view") +
		action("edit", "docx", "word", "edit") + `</app>` +
		`<app name="Pdf">` + action("view", "pdf", "pdf", "view") + `</app>` +
		`</net-zone></wopi-discovery>`
}

func ooProvider(t *testing.T, xml string) *OnlyofficeProvider {
	t.Helper()
	discovery, err := ParseOnlyofficeDiscovery(strings.NewReader(xml))
	if err != nil {
		t.Fatalf("discovery: %v", err)
	}
	return &OnlyofficeProvider{
		Settings: &OnlyofficeSettings{PublicOrigin: ooOrigin, WopiSourceOrigin: "http://cells.example:58092", Extensions: []string{"docx", "pdf", "xlsx"}},
		Locale:   "zh-CN",
		Discovery: func(_ context.Context, origin string) (*OnlyofficeDiscovery, error) {
			if origin != ooOrigin {
				return nil, errors.New("unexpected origin")
			}
			return discovery, nil
		},
	}
}

func TestOnlyofficeSettingsFromConfig(t *testing.T) {
	conf := func(values map[string]interface{}) *OnlyofficeSettings {
		c := configx.New()
		for k, v := range values {
			if err := c.Val(k).Set(v); err != nil {
				t.Fatal(err)
			}
		}
		s, ok := OnlyofficeSettingsFromConfig(c)
		if ok != (s != nil) {
			t.Fatal("ok and settings disagree")
		}
		return s
	}
	valid := map[string]interface{}{
		config.KeyFrontPluginEnabled:    true,
		"ONLYOFFICE_PUBLIC_ORIGIN":      ooOrigin,
		"ONLYOFFICE_WOPI_SOURCE_ORIGIN": "http://cells.example:58092",
		"ONLYOFFICE_EXTENSIONS":         "docx, xlsx,pptx",
	}
	s := conf(valid)
	if s == nil || s.PublicOrigin != ooOrigin || strings.Join(s.Extensions, ",") != "docx,xlsx,pptx" {
		t.Fatalf("valid settings refused or misread: %+v", s)
	}
	for name, change := range map[string]map[string]interface{}{
		"disabled":         {config.KeyFrontPluginEnabled: false},
		"governed binding": {"KAILO_DOCUMENT_BINDING": `{"bindingId":"x"}`},
		"origin with path": {"ONLYOFFICE_PUBLIC_ORIGIN": ooOrigin + "/"},
		"wildcard origin":  {"ONLYOFFICE_WOPI_SOURCE_ORIGIN": "*"},
		"no extensions":    {"ONLYOFFICE_EXTENSIONS": ""},
		"bad extension":    {"ONLYOFFICE_EXTENSIONS": "docx,../x"},
		"duplicate":        {"ONLYOFFICE_EXTENSIONS": "docx,docx"},
	} {
		values := map[string]interface{}{}
		for k, v := range valid {
			values[k] = v
		}
		for k, v := range change {
			values[k] = v
		}
		if conf(values) != nil {
			t.Errorf("%s: settings accepted", name)
		}
	}
	if s, ok := OnlyofficeSettingsFromConfig(nil); ok || s != nil {
		t.Error("missing configuration accepted")
	}
}

func TestOnlyofficeProviderSelectsDiscoveryAction(t *testing.T) {
	p := ooProvider(t, ooDiscoveryXML(ooOrigin))
	writable := &tree.Node{Uuid: "11111111-2222-3333-4444-555555555555", Path: "ws/folder/Report.DOCX"}
	got, err := p.Get(context.Background(), writable)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(got.Url)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if u.Scheme+"://"+u.Host != ooOrigin || u.Path != "/hosting/wopi/word/edit" ||
		q.Get("wopisrc") != "http://cells.example:58092/wopi/files/11111111-2222-3333-4444-555555555555" ||
		q.Get("dchat") != "1" || q.Get("ui") != "zh-CN" || q.Get("lang") != "zh-CN" || len(q) != 4 {
		t.Fatalf("unexpected action %s", got.Url)
	}
	if strings.Contains(got.Url, "access_token") {
		t.Fatal("the action URL must never carry a token")
	}

	readonly := &tree.Node{Uuid: writable.Uuid, Path: writable.Path, MetaStore: map[string]string{common.MetaFlagReadonly: "true"}}
	if got, err := p.Get(context.Background(), readonly); err != nil || !strings.Contains(got.Url, "/hosting/wopi/word/view?") {
		t.Fatalf("read-only node must open the view action: %v %v", got, err)
	}
	pdf := &tree.Node{Uuid: writable.Uuid, Path: "ws/a.pdf"}
	if got, err := p.Get(context.Background(), pdf); err != nil || !strings.Contains(got.Url, "/hosting/wopi/pdf/view?") {
		t.Fatalf("view-only extension must open the view action: %v %v", got, err)
	}
	for _, path := range []string{"ws/a.xlsx", "ws/a.odt", "ws/noext"} {
		if _, err := p.Get(context.Background(), &tree.Node{Uuid: writable.Uuid, Path: path}); err == nil {
			t.Errorf("%s: action without an enabled discovery entry", path)
		}
	}
	if !p.Provides(".docx") || !p.Provides(".pdf") || p.Provides(".xlsx") || p.Provides(".odt") || p.Provides("") {
		t.Error("Provides must follow the enabled extensions that discovery serves")
	}
}

func TestOnlyofficeProviderRefusesForeignTemplates(t *testing.T) {
	for name, xml := range map[string]string{
		"other origin":        ooDiscoveryXML("http://evil.example"),
		"unknown placeholder": strings.Replace(ooDiscoveryXML(ooOrigin), "&amp;lt;rs=DC_LLCC", "&amp;lt;src=URL", -1),
		"extra parameter":     strings.Replace(ooDiscoveryXML(ooOrigin), "/hosting/wopi/word/edit?", "/hosting/wopi/word/edit?next=x&amp;", 1),
		"other path":          strings.Replace(ooDiscoveryXML(ooOrigin), "/hosting/wopi/word/edit?", "/hosting/other/edit?", 1),
	} {
		p := ooProvider(t, xml)
		if _, err := p.Get(context.Background(), &tree.Node{Uuid: "u", Path: "a.docx"}); err == nil {
			t.Errorf("%s: action accepted", name)
		}
	}
}

func TestParseOnlyofficeDiscoveryForms(t *testing.T) {
	// Single-escaped attributes decode to the same template.
	single := strings.NewReplacer("&amp;lt;", "&lt;", "&amp;gt;", "&gt;", "&amp;amp;", "&amp;").Replace(ooDiscoveryXML(ooOrigin))
	p := ooProvider(t, single)
	if got, err := p.Get(context.Background(), &tree.Node{Uuid: "u", Path: "a.docx"}); err != nil || !strings.Contains(got.Url, "/hosting/wopi/word/edit?") {
		t.Fatalf("single-escaped discovery: %v %v", got, err)
	}
	for name, xml := range map[string]string{
		"not discovery": `<html/>`,
		"no actions":    `<wopi-discovery><net-zone/></wopi-discovery>`,
		"conflict": `<wopi-discovery><net-zone><app><action name="view" ext="docx" urlsrc="a"/>` +
			`<action name="view" ext="docx" urlsrc="b"/></app></net-zone></wopi-discovery>`,
	} {
		if _, err := ParseOnlyofficeDiscovery(strings.NewReader(xml)); err == nil {
			t.Errorf("%s: parsed", name)
		}
	}
}

func TestOnlyofficeDiscoveryCache(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/hosting/discovery" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(ooDiscoveryXML("http://" + r.Host)))
	}))
	defer server.Close()
	cache := &onlyofficeDiscoveryCache{entries: map[string]*onlyofficeDiscoveryEntry{}, client: server.Client()}
	for i := 0; i < 3; i++ {
		d, err := cache.get(context.Background(), server.URL)
		if err != nil || d.Actions["docx/edit"] == "" {
			t.Fatalf("discovery: %v", err)
		}
	}
	if calls != 1 {
		t.Fatalf("discovery fetched %d times, want 1 within the TTL", calls)
	}
	if _, err := cache.get(context.Background(), "http://127.0.0.1:1"); err == nil {
		t.Fatal("unreachable discovery accepted")
	}
}

func TestOnlyofficeUILocale(t *testing.T) {
	for in, want := range map[string]string{"zh-CN": "zh-CN", "zh-cn": "zh-CN", "en": "en", "en-US": "en-US", "fr_FR": "fr-FR", "": "en-US", "x!": "en-US"} {
		if got := onlyofficeUILocale(in); got != want {
			t.Errorf("%q: got %q want %q", in, got, want)
		}
	}
}
