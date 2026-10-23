package restv2

// ONLYOFFICE DocumentServer editing inside the native Cells page (DD-132(2),
// SS-CEL-EDITOR). The provider only selects the DocumentServer WOPI action for a
// node from that instance's discovery; it never issues or embeds a token. The
// page takes the native document PAT (/a/auth/token/document, r/rw by the
// user's ACL) and opens the action by a standard WOPI form POST, so the PAT
// only travels in the form body. Configured KAILO_DOCUMENT_BINDING switches the
// plugin to governed editing (DD-132(4)): no native action is offered then.

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	restful "github.com/emicklei/go-restful/v3"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/utils/i18n/languages"
	"github.com/pydio/cells/v5/common/utils/kv"
)

const (
	onlyofficePluginPath   = "frontend/plugin/editor.onlyoffice"
	onlyofficeDiscoveryTTL = 5 * time.Minute
	// A failed discovery is retried after this delay, so listings do not wait
	// on an unavailable editor for every node.
	onlyofficeDiscoveryRetry = 30 * time.Second
	onlyofficeDiscoveryLimit = 2 << 20
)

var (
	// Placeholders DocumentServer's own discovery writes into every urlsrc
	// (server wopiClient.js::discovery); any other template is refused, the
	// same rule as the governed adapter (adapter/src/document-launch.mjs).
	onlyofficePlaceholders = map[string]bool{
		"rs=DC_LLCC&": true, "dchat=DISABLE_CHAT&": true, "embed=EMBEDDED&": true,
		"fs=FULLSCREEN&": true, "hid=HOST_SESSION_ID&": true, "rec=RECORDING&": true,
		"sc=SESSION_CONTEXT&": true, "thm=THEME_ID&": true, "ui=UI_LLCC&": true,
		"wopisrc=WOPI_SOURCE&": true,
	}
	onlyofficePlaceholder = regexp.MustCompile(`<([^<>]*)>`)
	onlyofficeActionPath  = regexp.MustCompile(`^/hosting/wopi/(word|cell|slide|pdf|diagram)/(view|edit)$`)
	onlyofficeExtension   = regexp.MustCompile(`^[a-z0-9]{1,10}$`)
	onlyofficeLocale      = regexp.MustCompile(`^[a-z]{2,3}(-[A-Z]{2})?$`)

	onlyofficeDiscoveries = &onlyofficeDiscoveryCache{entries: map[string]*onlyofficeDiscoveryEntry{}}
)

func init() {
	RegisterEditorProviderFactory("onlyoffice", GetOnlyofficeProvider)
}

// OnlyofficeSettings is the declarative plugin configuration written and read
// back by file-storage/deploy/reconcile.py.
type OnlyofficeSettings struct {
	// DocumentServer public origin; equals its wopi.host, so every discovery
	// urlsrc carries it.
	PublicOrigin string
	// Origin DocumentServer uses for wopisrc: the Cells origin its outbound
	// allow-list admits (<origin>/wopi/files/).
	WopiSourceOrigin string
	Extensions       []string
}

// OnlyofficeSettingsFromConfig reads the plugin parameters. It refuses (ok=false)
// when the plugin is disabled, governed editing is configured or a value is
// not an explicit origin / extension list; nothing falls back to a default.
func OnlyofficeSettingsFromConfig(conf kv.Values) (*OnlyofficeSettings, bool) {
	if conf == nil || !conf.Val(config.KeyFrontPluginEnabled).Default(false).Bool() {
		return nil, false
	}
	if strings.TrimSpace(conf.Val("KAILO_DOCUMENT_BINDING").Default("").String()) != "" {
		return nil, false
	}
	public, err := explicitOrigin(conf.Val("ONLYOFFICE_PUBLIC_ORIGIN").Default("").String())
	if err != nil {
		return nil, false
	}
	source, err := explicitOrigin(conf.Val("ONLYOFFICE_WOPI_SOURCE_ORIGIN").Default("").String())
	if err != nil {
		return nil, false
	}
	var extensions []string
	for _, e := range strings.Split(conf.Val("ONLYOFFICE_EXTENSIONS").Default("").String(), ",") {
		e = strings.TrimSpace(e)
		if !onlyofficeExtension.MatchString(e) || slices.Contains(extensions, e) {
			return nil, false
		}
		extensions = append(extensions, e)
	}
	return &OnlyofficeSettings{PublicOrigin: public, WopiSourceOrigin: source, Extensions: extensions}, true
}

func explicitOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil ||
		u.Path != "" || u.RawQuery != "" || u.Fragment != "" || raw != u.Scheme+"://"+u.Host {
		return "", errors.New("explicit scheme://host[:port] origin required")
	}
	return raw, nil
}

// OnlyofficeProvider selects DocumentServer WOPI actions for one request.
type OnlyofficeProvider struct {
	Settings  *OnlyofficeSettings
	Locale    string
	Discovery func(ctx context.Context, origin string) (*OnlyofficeDiscovery, error)
}

// GetOnlyofficeProvider creates the provider from the plugin configuration.
func GetOnlyofficeProvider(ctx context.Context, req *restful.Request) (EditorProvider, bool) {
	settings, ok := OnlyofficeSettingsFromConfig(config.Get(ctx, onlyofficePluginPath))
	if !ok {
		return nil, false
	}
	_, ui := languages.DetectLocale(req.Request)
	return &OnlyofficeProvider{Settings: settings, Locale: onlyofficeUILocale(ui), Discovery: onlyofficeDiscoveries.get}, true
}

func onlyofficeUILocale(tag string) string {
	parts := strings.SplitN(strings.ReplaceAll(tag, "_", "-"), "-", 3)
	locale := strings.ToLower(parts[0])
	if len(parts) > 1 && len(parts[1]) == 2 {
		locale += "-" + strings.ToUpper(parts[1])
	}
	if !onlyofficeLocale.MatchString(locale) {
		return "en-US"
	}
	return locale
}

func (p *OnlyofficeProvider) Provides(ext string) bool {
	if len(ext) < 2 || ext[0] != '.' || !slices.Contains(p.Settings.Extensions, ext[1:]) {
		return false
	}
	discovery, err := p.Discovery(context.Background(), p.Settings.PublicOrigin)
	return err == nil && (discovery.Actions[ext[1:]+"/view"] != "" || discovery.Actions[ext[1:]+"/edit"] != "")
}

// Get returns the DocumentServer action for this node: edit when the node is
// writable for the requesting user and the extension has an edit action,
// otherwise view. The URL carries no token; the PAT is posted by the page.
func (p *OnlyofficeProvider) Get(ctx context.Context, node *tree.Node) (*rest.PreSignedURL, error) {
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(node.GetPath())), ".")
	if !slices.Contains(p.Settings.Extensions, ext) || !onlyofficeExtension.MatchString(ext) || node.GetUuid() == "" {
		return nil, errors.New("extension not enabled for the document editor")
	}
	discovery, err := p.Discovery(ctx, p.Settings.PublicOrigin)
	if err != nil {
		return nil, err
	}
	mode := "view"
	if _, readonly := node.MetaStore[common.MetaFlagReadonly]; !readonly && discovery.Actions[ext+"/edit"] != "" {
		mode = "edit"
	}
	template := discovery.Actions[ext+"/"+mode]
	if template == "" {
		return nil, errors.New("no document editor action for this extension")
	}
	action, err := onlyofficeAction(template, p.Settings.PublicOrigin, mode)
	if err != nil {
		return nil, err
	}
	query := action.Query()
	query.Set("wopisrc", p.Settings.WopiSourceOrigin+"/wopi/files/"+node.GetUuid())
	query.Set("ui", p.Locale)
	query.Set("lang", p.Locale)
	// DD-132(3): ONLYOFFICE chat is closed for every launch.
	query.Set("dchat", "1")
	action.RawQuery = query.Encode()
	return &rest.PreSignedURL{Url: action.String()}, nil
}

// onlyofficeAction resolves a discovery urlsrc template into a fixed action URL
// of the configured instance, refusing any other template grammar or origin.
func onlyofficeAction(template, publicOrigin, mode string) (*url.URL, error) {
	// DocumentServer writes the placeholders entity-escaped into the attribute
	// (wopiClient.js::discovery); decode that representation only.
	decoded := strings.NewReplacer("&lt;", "<", "&gt;", ">", "&amp;", "&").Replace(template)
	var refused error
	resolved := onlyofficePlaceholder.ReplaceAllStringFunc(decoded, func(m string) string {
		if !onlyofficePlaceholders[m[1:len(m)-1]] {
			refused = errors.New("unknown discovery placeholder")
		}
		return ""
	})
	if refused != nil || strings.ContainsAny(resolved, "<>") {
		return nil, errors.New("unexpected discovery urlsrc")
	}
	action, err := url.Parse(resolved)
	if err != nil || action.Scheme+"://"+action.Host != publicOrigin || action.User != nil || action.Fragment != "" {
		return nil, errors.New("discovery action is not on the configured document editor origin")
	}
	match := onlyofficeActionPath.FindStringSubmatch(action.Path)
	if match == nil || match[2] != mode {
		return nil, errors.New("discovery action is not a WOPI view/edit action")
	}
	for key := range action.Query() {
		switch strings.ToLower(key) {
		case "ui", "lang", "thm", "dchat", "wopisrc", "usid":
		default:
			return nil, errors.New("discovery action carries an unexpected parameter")
		}
	}
	return action, nil
}

// OnlyofficeDiscovery holds urlsrc templates keyed by "<ext>/<view|edit>".
type OnlyofficeDiscovery struct {
	Actions map[string]string
}

// ParseOnlyofficeDiscovery reads DocumentServer's WOPI discovery XML. Only the
// view and edit actions are kept; a duplicate ext/action pair is refused.
func ParseOnlyofficeDiscovery(r io.Reader) (*OnlyofficeDiscovery, error) {
	var document struct {
		XMLName xml.Name `xml:"wopi-discovery"`
		Zones   []struct {
			Apps []struct {
				Actions []struct {
					Name   string `xml:"name,attr"`
					Ext    string `xml:"ext,attr"`
					URLSrc string `xml:"urlsrc,attr"`
				} `xml:"action"`
			} `xml:"app"`
		} `xml:"net-zone"`
	}
	decoder := xml.NewDecoder(io.LimitReader(r, onlyofficeDiscoveryLimit))
	decoder.Strict = true
	if err := decoder.Decode(&document); err != nil {
		return nil, fmt.Errorf("unreadable discovery: %w", err)
	}
	discovery := &OnlyofficeDiscovery{Actions: map[string]string{}}
	for _, zone := range document.Zones {
		for _, app := range zone.Apps {
			for _, action := range app.Actions {
				if action.Name != "view" && action.Name != "edit" {
					continue
				}
				key := action.Ext + "/" + action.Name
				if !onlyofficeExtension.MatchString(action.Ext) || action.URLSrc == "" {
					continue
				}
				if previous, seen := discovery.Actions[key]; seen && previous != action.URLSrc {
					return nil, errors.New("discovery declares " + key + " twice")
				}
				discovery.Actions[key] = action.URLSrc
			}
		}
	}
	if len(discovery.Actions) == 0 {
		return nil, errors.New("discovery has no view or edit action")
	}
	return discovery, nil
}

type onlyofficeDiscoveryEntry struct {
	discovery *OnlyofficeDiscovery
	err       error
	until     time.Time
}

type onlyofficeDiscoveryCache struct {
	mu      sync.Mutex
	entries map[string]*onlyofficeDiscoveryEntry
	client  *http.Client
}

func (c *onlyofficeDiscoveryCache) get(ctx context.Context, origin string) (*OnlyofficeDiscovery, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if entry := c.entries[origin]; entry != nil && time.Now().Before(entry.until) {
		return entry.discovery, entry.err
	}
	discovery, err := c.fetch(ctx, origin)
	ttl := onlyofficeDiscoveryTTL
	if err != nil {
		ttl = onlyofficeDiscoveryRetry
	}
	c.entries[origin] = &onlyofficeDiscoveryEntry{discovery: discovery, err: err, until: time.Now().Add(ttl)}
	return discovery, err
}

func (c *onlyofficeDiscoveryCache) fetch(ctx context.Context, origin string) (*OnlyofficeDiscovery, error) {
	client := c.client
	if client == nil {
		client = &http.Client{
			Timeout: 5 * time.Second,
			// The discovery is read from the configured origin only.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		}
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/hosting/discovery", nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("discovery answered HTTP %d", resp.StatusCode)
	}
	return ParseOnlyofficeDiscovery(resp.Body)
}
