package auth

// Kailo member directory sync (DD-133(4), .design/07 §4.7.4). The instance
// reads the read-only member directory of its native page entry binding from
// the Core service listener with its own directory client (client-credentials,
// azp = binding normalizedConfig.directoryClientId) and converges the native
// organisation to the full snapshot:
//
//   - Tenant → the native group of the Tenant (NativeOIDCTenantGroupPath),
//     labelled with the directory Tenant name; every member identity of the
//     connector issuer has a provisioned account there (pre-provisioned in
//     the same shape as a first browser login when it has none yet).
//   - tenantRole ADMIN → native profile admin (the native ADMINS role
//     auto-applies), MEMBER → standard.
//   - Workspace → native workspace slug kailo-ws-<id> (ADMIN scope, label =
//     Workspace name) rooted on the folder <binding datasource>/<Tenant
//     root>/<id> (KAILO_DIRECTORY_WORKSPACE_ROOT is <datasource>/<Tenant
//     root>), and the native role of the same id holding read and write ACLs
//     on that root. Members of the Workspace carry that role; a Workspace
//     ADMIN is also granted the workspace resource WRITE policy (MEMBER: the
//     read/write ACLs only). Created and read back when the Workspace first
//     appears; when it leaves the snapshot the role's ACLs are revoked and
//     the workspace leaves the members' view, its folder and files stay.
//     workspaces[].role does not raise the native profile.
//   - A provisioned account of this issuer absent from the snapshot loses
//     its admin profile and Workspace roles, is locked (native "logout" lock) and
//     its recorded native sessions are ended; it is unlocked when it appears
//     again. Accounts and files are never deleted.
//
// The snapshot is applied only when its directoryVersion differs from the
// last fully applied one, and that version is recorded only after the whole
// snapshot converged; any failure (Core 503, token, transport, contract,
// another binding or Tenant) changes nothing and is retried next period.
// Once a snapshot was applied, browser logins follow it: identities not in it
// are refused and the profile/Workspace roles come from it, also after a restart
// (the snapshot is kept in the native working directory). Explicitly linked
// connector accounts are outside the directory and keep their own profile.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/client/commons/idmc"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/runtime"
	"github.com/pydio/cells/v5/common/telemetry/log"
)

// NativeOIDCWorkspaceRolePrefix starts the slug of the native workspace of a
// Kailo Workspace and the id of its native role (07 §4.7.4: kailo-ws-<id>).
const NativeOIDCWorkspaceRolePrefix = "kailo-ws-"

// NativeOIDCDirectoryLockAttribute marks an account locked by the directory
// (only those are unlocked again by it; a lock set in the console stays).
const NativeOIDCDirectoryLockAttribute = idm.UserAttrPrivatePrefix + "kailo_directory_locked"

const (
	directoryRoleAdmin   = "ADMIN"
	directoryRoleMember  = "MEMBER"
	directorySecretMax   = 4 << 10
	directoryTokenMax    = 1 << 20
	directoryBodyMax     = 16 << 20
	directoryLocksAttr   = "locks"
	directoryLogoutLock  = "logout"
	directoryDefaultTick = 60
)

// ErrNativeOIDCNotMember: a member directory was delivered and this identity
// is not in it.
var ErrNativeOIDCNotMember = errors.New("OIDC identity is not a member of this Kailo organisation")

var (
	directoryUUID     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	directoryVersion  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	directoryClientID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,255}$`)
	// <binding datasource>/<Tenant root folder>, the same names reconcile.py
	// accepts for CELLS_BINDING_DATASOURCE and CELLS_BINDING_ROOT_FOLDER.
	directoryWorkspaceRoot = regexp.MustCompile(`^[a-z0-9]{1,33}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
)

// NativeOIDCDirectoryStorePath locates the applied snapshot (replaced by tests).
var NativeOIDCDirectoryStorePath = func() string {
	return filepath.Join(runtime.ApplicationWorkingDir(), "kailo", "member-directory.json")
}

// ---- configuration --------------------------------------------------------

// NativeOIDCDirectoryConfig is the deployment delivery of the directory read.
type NativeOIDCDirectoryConfig struct {
	BindingID        string
	ClientID         string
	ClientSecretFile string
	TokenURL         string
	CoreURL          string
	// WorkspaceRoot is <binding datasource>/<Tenant root>: Kailo Workspaces
	// are rooted on <WorkspaceRoot>/<Workspace id>.
	WorkspaceRoot string
	Interval      time.Duration
	// HTTP is the transport (tests); redirects are never followed.
	HTTP *http.Client
}

var directoryEnv = []string{"KAILO_DIRECTORY_BINDING_ID", "KAILO_DIRECTORY_CLIENT_ID", "KAILO_DIRECTORY_CLIENT_SECRET_FILE",
	"KAILO_DIRECTORY_TOKEN_URL", "KAILO_DIRECTORY_CORE_URL", "KAILO_DIRECTORY_WORKSPACE_ROOT"}

// NativeOIDCDirectoryConfigFromEnv returns nil when the directory read is not
// delivered (all keys empty) and refuses a partial or invalid delivery.
func NativeOIDCDirectoryConfigFromEnv() (*NativeOIDCDirectoryConfig, error) {
	values := map[string]string{}
	for _, k := range directoryEnv {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			values[k] = v
		}
	}
	if len(values) == 0 {
		return nil, nil
	}
	if len(values) != len(directoryEnv) {
		return nil, errors.New("member directory delivery is partial: all KAILO_DIRECTORY_* keys or none")
	}
	interval := directoryDefaultTick
	if raw := strings.TrimSpace(os.Getenv("KAILO_DIRECTORY_INTERVAL_SECONDS")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return nil, errors.New("KAILO_DIRECTORY_INTERVAL_SECONDS must be an integer")
		}
		interval = n
	}
	c := &NativeOIDCDirectoryConfig{BindingID: values["KAILO_DIRECTORY_BINDING_ID"], ClientID: values["KAILO_DIRECTORY_CLIENT_ID"],
		ClientSecretFile: values["KAILO_DIRECTORY_CLIENT_SECRET_FILE"], TokenURL: values["KAILO_DIRECTORY_TOKEN_URL"],
		CoreURL: values["KAILO_DIRECTORY_CORE_URL"], WorkspaceRoot: values["KAILO_DIRECTORY_WORKSPACE_ROOT"],
		Interval: time.Duration(interval) * time.Second}
	return c, c.Validate()
}

// Validate refuses anything but one binding UUID, one client id segment, an
// absolute secret file, and plain HTTP(S) token and Core service addresses.
func (c *NativeOIDCDirectoryConfig) Validate() error {
	plain := func(raw string, root bool) bool {
		u, err := url.Parse(raw)
		return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil &&
			u.RawQuery == "" && u.Fragment == "" && (!root || u.Path == "" || u.Path == "/")
	}
	switch {
	case !directoryUUID.MatchString(c.BindingID):
		return errors.New("member directory binding must be a UUID")
	case !directoryClientID.MatchString(c.ClientID):
		return errors.New("member directory client must be one IdP client id")
	case !filepath.IsAbs(c.ClientSecretFile):
		return errors.New("member directory client secret must be an absolute file")
	case !plain(c.TokenURL, false) || !plain(c.CoreURL, true):
		return errors.New("member directory token and Core addresses must be plain HTTP(S) URLs")
	case !directoryWorkspaceRoot.MatchString(c.WorkspaceRoot):
		return errors.New("member directory Workspace root must be <binding datasource>/<Tenant root folder>")
	case c.Interval < 10*time.Second || c.Interval > time.Hour:
		return errors.New("member directory interval must be 10..3600 seconds")
	}
	return nil
}

func (c *NativeOIDCDirectoryConfig) client() *http.Client {
	base := c.HTTP
	if base == nil {
		base = &http.Client{}
	}
	copied := *base
	copied.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &copied
}

// NativeOIDCDirectoryUnavailable reports a read that gave no usable snapshot;
// it carries only the HTTP status or a category, never a token or body.
type NativeOIDCDirectoryUnavailable struct {
	Stage  string
	Status int
}

func (e *NativeOIDCDirectoryUnavailable) Error() string {
	if e.Status != 0 {
		return fmt.Sprintf("member directory %s unavailable (HTTP %d)", e.Stage, e.Status)
	}
	return "member directory " + e.Stage + " unavailable"
}

func (c *NativeOIDCDirectoryConfig) token(ctx context.Context) (string, error) {
	file, err := os.Open(c.ClientSecretFile)
	if err != nil {
		return "", &NativeOIDCDirectoryUnavailable{Stage: "client secret"}
	}
	raw, err := io.ReadAll(io.LimitReader(file, directorySecretMax+1))
	_ = file.Close()
	secret := strings.TrimRight(string(raw), "\r\n")
	if err != nil || len(raw) > directorySecretMax || secret == "" || strings.ContainsAny(secret, "\r\n") {
		return "", &NativeOIDCDirectoryUnavailable{Stage: "client secret"}
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	form := url.Values{"grant_type": {"client_credentials"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", &NativeOIDCDirectoryUnavailable{Stage: "token"}
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.SetBasicAuth(url.QueryEscape(c.ClientID), url.QueryEscape(secret))
	resp, err := c.client().Do(req)
	if err != nil {
		return "", &NativeOIDCDirectoryUnavailable{Stage: "token"}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", &NativeOIDCDirectoryUnavailable{Stage: "token", Status: resp.StatusCode}
	}
	var answer struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, directoryTokenMax+1))
	if err != nil || len(body) > directoryTokenMax || json.Unmarshal(body, &answer) != nil ||
		answer.AccessToken == "" || !strings.EqualFold(answer.TokenType, "bearer") || strings.ContainsAny(answer.AccessToken, " \r\n") {
		return "", &NativeOIDCDirectoryUnavailable{Stage: "token"}
	}
	return answer.AccessToken, nil
}

// Fetch reads one full snapshot and checks it against the contract
// (contracts/api/component_member_directory.schema.json) and this binding.
func (c *NativeOIDCDirectoryConfig) Fetch(ctx context.Context) (*NativeOIDCDirectorySnapshot, error) {
	bearer, err := c.token(ctx)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	target := strings.TrimSuffix(c.CoreURL, "/") + "/service/v1/component-directory/bindings/" + url.PathEscape(c.BindingID) + "/members"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "read"}
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Accept", "application/json")
	resp, err := c.client().Do(req)
	if err != nil {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "read"}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "read", Status: resp.StatusCode}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, directoryBodyMax+1))
	if err != nil || len(body) > directoryBodyMax {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "read"}
	}
	snapshot, err := ParseNativeOIDCDirectory(body)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(snapshot.BindingID, c.BindingID) {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "binding"}
	}
	return snapshot, nil
}

// ---- contract ---------------------------------------------------------------

// NativeOIDCDirectorySnapshot is the checked member directory answer.
type NativeOIDCDirectorySnapshot struct {
	BindingID  string
	Version    string
	TenantID   string
	TenantName string
	Workspaces map[string]string // workspaceId → name
	Members    []NativeOIDCDirectoryMember
}

// NativeOIDCDirectoryMember is one person of the snapshot.
type NativeOIDCDirectoryMember struct {
	PrincipalID string
	DisplayName string
	Admin       bool
	Identities  []NativeOIDCDirectoryIdentity
	Workspaces  []string
	// WorkspaceAdmins lists the Workspaces where the member is ADMIN.
	WorkspaceAdmins []string
}

// NativeOIDCDirectoryIdentity is one external identity of a member.
type NativeOIDCDirectoryIdentity struct {
	Issuer, Subject, Picture string
}

func strictDecode(raw []byte, into any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(into); err != nil {
		return err
	}
	if d.More() {
		return errors.New("trailing data")
	}
	return nil
}

func directoryRole(value *string) (bool, bool) {
	if value == nil {
		return false, false
	}
	switch *value {
	case directoryRoleAdmin:
		return true, true
	case directoryRoleMember:
		return false, true
	}
	return false, false
}

// ParseNativeOIDCDirectory decodes a snapshot strictly: unknown or missing
// fields, other role values, unknown Workspaces, repeated people or
// identities shared by two people refuse the whole snapshot.
func ParseNativeOIDCDirectory(body []byte) (*NativeOIDCDirectorySnapshot, error) {
	invalid := &NativeOIDCDirectoryUnavailable{Stage: "contract"}
	var wire struct {
		BindingID        *string `json:"bindingId"`
		DirectoryVersion *string `json:"directoryVersion"`
		Tenant           *struct {
			TenantID *string `json:"tenantId"`
			Name     *string `json:"name"`
		} `json:"tenant"`
		Workspaces *[]struct {
			WorkspaceID *string `json:"workspaceId"`
			Name        *string `json:"name"`
		} `json:"workspaces"`
		Members *[]struct {
			PrincipalID *string `json:"principalId"`
			DisplayName *string `json:"displayName"`
			TenantRole  *string `json:"tenantRole"`
			Identities  *[]struct {
				Issuer  *string `json:"issuer"`
				Subject *string `json:"subject"`
				Picture *string `json:"picture"`
			} `json:"identities"`
			Workspaces *[]struct {
				WorkspaceID *string `json:"workspaceId"`
				Role        *string `json:"role"`
			} `json:"workspaces"`
		} `json:"members"`
	}
	if strictDecode(body, &wire) != nil || wire.BindingID == nil || wire.DirectoryVersion == nil || wire.Tenant == nil ||
		wire.Tenant.TenantID == nil || wire.Tenant.Name == nil || wire.Workspaces == nil || wire.Members == nil ||
		!directoryUUID.MatchString(*wire.BindingID) || !directoryVersion.MatchString(*wire.DirectoryVersion) ||
		!directoryUUID.MatchString(*wire.Tenant.TenantID) {
		return nil, invalid
	}
	s := &NativeOIDCDirectorySnapshot{BindingID: *wire.BindingID, Version: *wire.DirectoryVersion,
		TenantID: strings.ToLower(*wire.Tenant.TenantID), TenantName: *wire.Tenant.Name, Workspaces: map[string]string{}}
	for _, w := range *wire.Workspaces {
		if w.WorkspaceID == nil || w.Name == nil || !directoryUUID.MatchString(*w.WorkspaceID) {
			return nil, invalid
		}
		id := strings.ToLower(*w.WorkspaceID)
		if _, seen := s.Workspaces[id]; seen {
			return nil, invalid
		}
		s.Workspaces[id] = *w.Name
	}
	principals, identities := map[string]bool{}, map[string]bool{}
	for _, m := range *wire.Members {
		admin, ok := directoryRole(m.TenantRole)
		if m.PrincipalID == nil || m.DisplayName == nil || m.Identities == nil || m.Workspaces == nil || !ok ||
			!directoryUUID.MatchString(*m.PrincipalID) || principals[strings.ToLower(*m.PrincipalID)] {
			return nil, invalid
		}
		principals[strings.ToLower(*m.PrincipalID)] = true
		member := NativeOIDCDirectoryMember{PrincipalID: strings.ToLower(*m.PrincipalID), DisplayName: strings.TrimSpace(*m.DisplayName), Admin: admin}
		for _, id := range *m.Identities {
			if id.Issuer == nil || id.Subject == nil || id.Picture == nil || *id.Issuer == "" || strings.TrimSpace(*id.Subject) == "" {
				return nil, invalid
			}
			key := *id.Issuer + "\x00" + *id.Subject
			if identities[key] {
				return nil, invalid
			}
			identities[key] = true
			member.Identities = append(member.Identities, NativeOIDCDirectoryIdentity{Issuer: *id.Issuer, Subject: *id.Subject, Picture: *id.Picture})
		}
		seen := map[string]bool{}
		for _, w := range *m.Workspaces {
			if w.WorkspaceID == nil || !directoryUUID.MatchString(*w.WorkspaceID) {
				return nil, invalid
			}
			wsAdmin, ok := directoryRole(w.Role)
			if !ok {
				return nil, invalid
			}
			id := strings.ToLower(*w.WorkspaceID)
			if _, known := s.Workspaces[id]; !known || seen[id] {
				return nil, invalid
			}
			seen[id] = true
			member.Workspaces = append(member.Workspaces, id)
			if wsAdmin {
				member.WorkspaceAdmins = append(member.WorkspaceAdmins, id)
			}
		}
		slices.Sort(member.Workspaces)
		slices.Sort(member.WorkspaceAdmins)
		s.Members = append(s.Members, member)
	}
	return s, nil
}

// ---- applied snapshot (persisted) -----------------------------------------------

type nativeOIDCDirectoryEntry struct {
	Issuer      string   `json:"iss"`
	Subject     string   `json:"sub"`
	Principal   string   `json:"principal"`
	DisplayName string   `json:"name,omitempty"`
	Picture     string   `json:"picture,omitempty"`
	Admin       bool     `json:"admin,omitempty"`
	Workspaces  []string `json:"workspaces,omitempty"`
	// WorkspaceAdmins: Workspaces where this member is ADMIN.
	WorkspaceAdmins []string `json:"workspaceAdmins,omitempty"`
}

type nativeOIDCDirectoryState struct {
	Version    string                     `json:"version"`
	BindingID  string                     `json:"bindingId"`
	TenantID   string                     `json:"tenantId"`
	TenantName string                     `json:"tenantName"`
	Workspaces map[string]string          `json:"workspaces"`
	Members    []nativeOIDCDirectoryEntry `json:"members"`
	Applied    int64                      `json:"applied"`
	index      map[string]*nativeOIDCDirectoryEntry
}

func (s *nativeOIDCDirectoryState) member(issuer, subject string) (*nativeOIDCDirectoryEntry, bool) {
	if s.index == nil {
		s.index = map[string]*nativeOIDCDirectoryEntry{}
		for i := range s.Members {
			s.index[s.Members[i].Issuer+"\x00"+s.Members[i].Subject] = &s.Members[i]
		}
	}
	e, ok := s.index[issuer+"\x00"+subject]
	return e, ok
}

var nativeOIDCDirectory struct {
	sync.Mutex
	path   string
	state  *nativeOIDCDirectoryState
	loaded bool
}

// loadNativeOIDCDirectoryState returns nil, nil while no snapshot was ever
// applied. An unreadable store fails closed (logins refused) rather than
// silently falling back to the pre-directory behaviour.
func loadNativeOIDCDirectoryState() (*nativeOIDCDirectoryState, error) {
	nativeOIDCDirectory.Lock()
	defer nativeOIDCDirectory.Unlock()
	p := NativeOIDCDirectoryStorePath()
	if nativeOIDCDirectory.loaded && nativeOIDCDirectory.path == p {
		return nativeOIDCDirectory.state, nil
	}
	raw, err := os.ReadFile(p)
	if errors.Is(err, os.ErrNotExist) {
		nativeOIDCDirectory.path, nativeOIDCDirectory.state, nativeOIDCDirectory.loaded = p, nil, true
		return nil, nil
	}
	if err != nil {
		return nil, errors.New("member directory store is unreadable")
	}
	state := &nativeOIDCDirectoryState{}
	if json.Unmarshal(raw, state) != nil || !directoryVersion.MatchString(state.Version) {
		return nil, errors.New("member directory store is unreadable")
	}
	nativeOIDCDirectory.path, nativeOIDCDirectory.state, nativeOIDCDirectory.loaded = p, state, true
	return state, nil
}

func saveNativeOIDCDirectoryState(state *nativeOIDCDirectoryState) error {
	nativeOIDCDirectory.Lock()
	defer nativeOIDCDirectory.Unlock()
	p := NativeOIDCDirectoryStorePath()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".member-directory-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp.Name(), p); err != nil {
		return err
	}
	nativeOIDCDirectory.path, nativeOIDCDirectory.state, nativeOIDCDirectory.loaded = p, state, true
	return nil
}

// nativeOIDCMembership is what the applied directory says about one account.
type nativeOIDCMembership struct {
	admin      bool
	workspaces []string // native Workspace role ids
	tenantName string
	member     bool // listed (false = revoke)
}

func (e *nativeOIDCDirectoryEntry) membership(state *nativeOIDCDirectoryState) *nativeOIDCMembership {
	m := &nativeOIDCMembership{admin: e.Admin, tenantName: state.TenantName, member: true}
	for _, w := range e.Workspaces {
		m.workspaces = append(m.workspaces, NativeOIDCWorkspaceRoleID(w))
	}
	return m
}

// NativeOIDCWorkspaceRoleID is the slug of the native workspace of a Kailo
// Workspace and the id of the native role holding its root ACLs.
func NativeOIDCWorkspaceRoleID(workspaceID string) string {
	return NativeOIDCWorkspaceRolePrefix + strings.ToLower(workspaceID)
}

// validTenantName applies the connector rule to a directory Tenant name.
func validTenantName(name string) bool {
	return strings.TrimSpace(name) == name && name != "" && len(name) <= 128 &&
		strings.IndexFunc(name, func(r rune) bool { return !unicode.IsPrint(r) }) < 0
}

// ---- convergence ----------------------------------------------------------------

// NativeOIDCWorkspaceFolder ensures the folder <datasource>/<...> exists in
// the admin tree and returns its node UUID. It is installed by the frontend
// service (the node router cannot be imported here); a directory with
// Workspaces is not applied while it is missing.
var NativeOIDCWorkspaceFolder func(ctx context.Context, path string) (string, error)

var nativeOIDCWorkspaceNamespace = uuid.MustParse("5c1d7b0e-0f39-4f61-9a6f-2b8f0c7d4e21")

// nativeOIDCWorkspaceUUID is the stable UUID of the native workspace of a slug.
func nativeOIDCWorkspaceUUID(slug string) string {
	return uuid.NewSHA1(nativeOIDCWorkspaceNamespace, []byte(slug)).String()
}

func nativeOIDCWorkspaceAdminOnly() []*service.ResourcePolicy {
	return permissions.NewResourcePoliciesBuilder().WithProfileRead(common.PydioProfileAdmin).WithProfileWrite(common.PydioProfileAdmin).Policies()
}

// nativeOIDCWorkspacePolicies: the workspace is visible to its role; native
// admins and the Workspace ADMINs (by account UUID) may edit it.
func nativeOIDCWorkspacePolicies(roleID string, admins []string) []*service.ResourcePolicy {
	b := permissions.NewResourcePoliciesBuilder().
		WithResourcePolicy(&service.ResourcePolicy{Action: service.ResourcePolicyAction_READ, Effect: service.ResourcePolicy_allow,
			Subject: permissions.PolicySubjectRolePrefix + roleID}).
		WithProfileRead(common.PydioProfileAdmin).
		WithProfileWrite(common.PydioProfileAdmin)
	for _, id := range admins {
		b = b.WithSubjectWrite(id)
	}
	return b.Policies()
}

func searchNativeWorkspaces(ctx context.Context, q *idm.WorkspaceSingleQuery) ([]*idm.Workspace, error) {
	query, _ := anypb.New(q)
	stream, err := idmc.WorkspaceServiceClient(ctx).SearchWorkspace(ctx, &idm.SearchWorkspaceRequest{Query: &service.Query{SubQueries: []*anypb.Any{query}}})
	if err != nil {
		return nil, err
	}
	var out []*idm.Workspace
	for {
		r, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		out = append(out, r.GetWorkspace())
	}
}

func searchNativeACLs(ctx context.Context, q *idm.ACLSingleQuery) ([]*idm.ACL, error) {
	query, _ := anypb.New(q)
	stream, err := idmc.ACLServiceClient(ctx).SearchACL(ctx, &idm.SearchACLRequest{Query: &service.Query{SubQueries: []*anypb.Any{query}}})
	if err != nil {
		return nil, err
	}
	var out []*idm.ACL
	for {
		r, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		out = append(out, r.GetACL())
	}
}

// ensureNativeOIDCWorkspaceRole creates or refreshes the role holding the
// root ACLs of one Kailo Workspace (readable by the Tenant group).
func ensureNativeOIDCWorkspaceRole(ctx context.Context, id, label, groupUUID string) error {
	wanted := nativeOIDCTenantGroupPolicies(groupUUID)
	query, _ := anypb.New(&idm.RoleSingleQuery{Uuid: []string{id}})
	stream, err := idmc.RoleServiceClient(ctx).SearchRole(ctx, &idm.SearchRoleRequest{Query: &service.Query{SubQueries: []*anypb.Any{query}}})
	if err != nil {
		return err
	}
	var current *idm.Role
	for {
		response, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		if response.GetRole().GetUuid() == id {
			current = response.GetRole()
		}
	}
	if current != nil && current.GetLabel() == label && !current.GetIsTeam() && !current.GetUserRole() && !current.GetGroupRole() &&
		len(current.GetAutoApplies()) == 0 && samePolicies(current.GetPolicies(), wanted) {
		return nil
	}
	_, err = idmc.RoleServiceClient(ctx).CreateRole(ctx, &idm.CreateRoleRequest{Role: &idm.Role{Uuid: id, Label: label, Policies: wanted}})
	if err == nil && current == nil {
		log.Auditer(ctx).Info(fmt.Sprintf("Created role [%s] for a Kailo Workspace", id), log.GetAuditId(common.AuditRoleCreate))
	}
	return err
}

// ensureNativeOIDCWorkspace converges one Kailo Workspace present in the
// snapshot: role, root folder, native workspace (never re-rooted), root and
// role read/write ACLs, and the WRITE policy of its ADMINs; then reads it back.
func ensureNativeOIDCWorkspace(ctx context.Context, root, workspaceID, name, groupUUID string, admins []string) error {
	id := NativeOIDCWorkspaceRoleID(workspaceID)
	label := strings.TrimSpace(name)
	if label == "" {
		label = id
	}
	if err := ensureNativeOIDCWorkspaceRole(ctx, id, label, groupUUID); err != nil {
		return err
	}
	if NativeOIDCWorkspaceFolder == nil {
		return errors.New("member directory Workspace folders are unavailable in this process")
	}
	folderPath := root + "/" + strings.ToLower(workspaceID)
	folder, err := NativeOIDCWorkspaceFolder(ctx, folderPath)
	if err != nil {
		return err
	}
	if folder == "" {
		return errors.New("member directory Workspace folder has no node UUID")
	}
	wsUUID := nativeOIDCWorkspaceUUID(id)
	wanted := nativeOIDCWorkspacePolicies(id, admins)
	found, err := searchNativeWorkspaces(ctx, &idm.WorkspaceSingleQuery{Slug: id})
	if err != nil {
		return err
	}
	var current *idm.Workspace
	for _, w := range found {
		if w.GetSlug() == id {
			current = w
		}
	}
	if current != nil && current.GetUUID() != wsUUID {
		return errors.New("a native workspace holds a Kailo Workspace slug; it is never taken over")
	}
	// Roots: exactly this folder, and no other workspace rooted on it.
	rooted, err := searchNativeACLs(ctx, &idm.ACLSingleQuery{NodeIDs: []string{folder}, Actions: []*idm.ACLAction{{Name: permissions.AclWsrootActionName}}})
	if err != nil {
		return err
	}
	for _, a := range rooted {
		if a.GetWorkspaceID() != wsUUID {
			return errors.New("another native workspace is rooted on a Kailo Workspace folder")
		}
	}
	if current == nil || current.GetLabel() != label || current.GetScope() != idm.WorkspaceScope_ADMIN || !samePolicies(current.GetPolicies(), wanted) {
		ws := &idm.Workspace{UUID: wsUUID, Slug: id, Label: label, Description: "Kailo Workspace", Scope: idm.WorkspaceScope_ADMIN,
			Attributes: `{"DEFAULT_RIGHTS":"","QUOTA":"0"}`, Policies: wanted}
		if current != nil {
			ws.Attributes, ws.Description = current.GetAttributes(), current.GetDescription()
		}
		if _, err := idmc.WorkspaceServiceClient(ctx).CreateWorkspace(ctx, &idm.CreateWorkspaceRequest{Workspace: ws}); err != nil {
			return err
		}
	}
	roots, err := searchNativeACLs(ctx, &idm.ACLSingleQuery{WorkspaceIDs: []string{wsUUID}, Actions: []*idm.ACLAction{{Name: permissions.AclWsrootActionName}}})
	if err != nil {
		return err
	}
	for _, a := range roots {
		if a.GetNodeID() != folder {
			return errors.New("Kailo Workspace exists with another root; it is never re-rooted automatically")
		}
	}
	grants := []*idm.ACL{}
	if len(roots) == 0 {
		grants = append(grants,
			&idm.ACL{NodeID: folder, WorkspaceID: wsUUID, Action: &idm.ACLAction{Name: permissions.AclWsrootActionName, Value: folderPath}},
			&idm.ACL{NodeID: folder, WorkspaceID: wsUUID, Action: permissions.AclRecycleRoot})
	}
	held, err := searchNativeACLs(ctx, &idm.ACLSingleQuery{WorkspaceIDs: []string{wsUUID}, NodeIDs: []string{folder}, RoleIDs: []string{id},
		Actions: []*idm.ACLAction{{Name: permissions.AclRead.Name}, {Name: permissions.AclWrite.Name}}})
	if err != nil {
		return err
	}
	for _, action := range []*idm.ACLAction{permissions.AclRead, permissions.AclWrite} {
		if !slices.ContainsFunc(held, func(a *idm.ACL) bool { return a.GetAction().GetName() == action.Name }) {
			grants = append(grants, &idm.ACL{NodeID: folder, WorkspaceID: wsUUID, RoleID: id, Action: &idm.ACLAction{Name: action.Name, Value: action.Value}})
		}
	}
	for _, acl := range grants {
		if _, err := idmc.ACLServiceClient(ctx).CreateACL(ctx, &idm.CreateACLRequest{ACL: acl}); err != nil {
			return err
		}
	}
	// Read back.
	found, err = searchNativeWorkspaces(ctx, &idm.WorkspaceSingleQuery{Slug: id})
	if err != nil {
		return err
	}
	if len(found) != 1 || found[0].GetUUID() != wsUUID || found[0].GetLabel() != label {
		return errors.New("Kailo Workspace could not be read back")
	}
	held, err = searchNativeACLs(ctx, &idm.ACLSingleQuery{WorkspaceIDs: []string{wsUUID}, NodeIDs: []string{folder}, RoleIDs: []string{id},
		Actions: []*idm.ACLAction{{Name: permissions.AclRead.Name}, {Name: permissions.AclWrite.Name}}})
	if err != nil {
		return err
	}
	if len(held) < 2 {
		return errors.New("Kailo Workspace root grants could not be read back")
	}
	if len(grants) > 0 || current == nil {
		log.Auditer(ctx).Info(fmt.Sprintf("Kailo Workspace [%s] converged", id), log.GetAuditId(common.AuditWsUpdate))
	}
	return nil
}

// retireNativeOIDCWorkspaces handles Kailo Workspaces absent from the
// snapshot: their role loses its ACLs and the workspace leaves the members'
// view (admin-only policies). The workspace, its root and files remain.
func retireNativeOIDCWorkspaces(ctx context.Context, active map[string]string) error {
	all, err := searchNativeWorkspaces(ctx, &idm.WorkspaceSingleQuery{Scope: idm.WorkspaceScope_ADMIN})
	if err != nil {
		return err
	}
	for _, ws := range all {
		slug := ws.GetSlug()
		if !strings.HasPrefix(slug, NativeOIDCWorkspaceRolePrefix) || ws.GetUUID() != nativeOIDCWorkspaceUUID(slug) {
			continue
		}
		if _, ok := active[strings.TrimPrefix(slug, NativeOIDCWorkspaceRolePrefix)]; ok {
			continue
		}
		q, _ := anypb.New(&idm.ACLSingleQuery{WorkspaceIDs: []string{ws.GetUUID()}, RoleIDs: []string{slug},
			Actions: []*idm.ACLAction{{Name: permissions.AclRead.Name}, {Name: permissions.AclWrite.Name}}})
		if _, err := idmc.ACLServiceClient(ctx).DeleteACL(ctx, &idm.DeleteACLRequest{Query: &service.Query{SubQueries: []*anypb.Any{q}}}); err != nil {
			return err
		}
		if !samePolicies(ws.GetPolicies(), nativeOIDCWorkspaceAdminOnly()) {
			ws.Policies = nativeOIDCWorkspaceAdminOnly()
			if _, err := idmc.WorkspaceServiceClient(ctx).CreateWorkspace(ctx, &idm.CreateWorkspaceRequest{Workspace: ws}); err != nil {
				return err
			}
			log.Auditer(ctx).Info(fmt.Sprintf("Kailo Workspace [%s] left the directory; grants revoked, files kept", slug),
				log.GetAuditId(common.AuditWsUpdate))
		}
	}
	return nil
}

// explicitRoles keeps the roles stored on the account itself: not its user
// role, not inherited group roles, not profile auto-applied roles, and not the
// Kailo Workspace roles (those follow the directory).
func explicitRoles(roles []*idm.Role, keepWorkspaces bool) []string {
	var out []string
	for _, r := range roles {
		if r.GetUserRole() || r.GetGroupRole() || len(r.GetAutoApplies()) > 0 || r.GetUuid() == "" ||
			(!keepWorkspaces && strings.HasPrefix(r.GetUuid(), NativeOIDCWorkspaceRolePrefix)) || slices.Contains(out, r.GetUuid()) {
			continue
		}
		out = append(out, r.GetUuid())
	}
	return out
}

func readLocks(attributes map[string]string) []string {
	var locks []string
	if raw := attributes[directoryLocksAttr]; raw != "" {
		_ = json.Unmarshal([]byte(raw), &locks)
	}
	return locks
}

func writeLocks(attributes map[string]string, locks []string) {
	if len(locks) == 0 {
		delete(attributes, directoryLocksAttr)
		return
	}
	raw, _ := json.Marshal(locks)
	attributes[directoryLocksAttr] = string(raw)
}

// convergeNativeOIDCAccount writes the Kailo profile data, Tenant group,
// profile, Workspace roles and directory lock of one account when any of them
// differs. member is nil before a directory was applied (standard profile, no
// Workspace roles) and for explicitly linked accounts (profile data only).
func convergeNativeOIDCAccount(ctx context.Context, c NativeOIDCConnector, user *idm.User, profile nativeOIDCProfile, provisioned bool, member *nativeOIDCMembership) error {
	attributes := map[string]string{}
	for k, v := range user.GetAttributes() {
		attributes[k] = v
	}
	if profile.displayName != "" {
		attributes[idm.UserAttrDisplayName] = profile.displayName
	}
	if profile.email != "" {
		attributes[idm.UserAttrEmail] = profile.email
	}
	if profile.picture != "" {
		attributes[idm.UserAttrAvatar] = profile.picture
	} else if IsNativeOIDCPicture(attributes[idm.UserAttrAvatar]) {
		// Kailo no longer publishes a picture: drop the stale copy only.
		delete(attributes, idm.UserAttrAvatar)
	}
	current := explicitRoles(user.GetRoles(), true)
	roles := current
	groupPath, policies := user.GetGroupPath(), user.GetPolicies()
	if provisioned && c.Organization != nil {
		tenant := c.Organization.Tenant
		if member != nil && validTenantName(member.tenantName) {
			tenant.Name = member.tenantName
		}
		group, err := ensureNativeOIDCTenantGroup(ctx, tenant)
		if err != nil {
			return err
		}
		groupPath = NativeOIDCTenantGroupPath(tenant.ID)
		policies = nativeOIDCTenantUserPolicies(user.GetUuid(), group.GetUuid())
		// Roles come from Kailo only (07 §4.7.4): the member directory, and
		// until it is delivered a standard member, also when a native
		// administrator raised the account in the console.
		attributes[idm.UserAttrProfile] = common.PydioProfileStandard
		roles = explicitRoles(user.GetRoles(), false)
		if member != nil && member.member {
			if member.admin {
				attributes[idm.UserAttrProfile] = common.PydioProfileAdmin
			}
			roles = append(roles, member.workspaces...)
			if attributes[NativeOIDCDirectoryLockAttribute] != "" {
				writeLocks(attributes, slices.DeleteFunc(readLocks(attributes), func(l string) bool { return l == directoryLogoutLock }))
				delete(attributes, NativeOIDCDirectoryLockAttribute)
			}
		} else if member != nil {
			locks := readLocks(attributes)
			if !slices.Contains(locks, directoryLogoutLock) {
				attributes[NativeOIDCDirectoryLockAttribute] = "true"
				writeLocks(attributes, append(locks, directoryLogoutLock))
			}
		}
	}
	changed := strings.TrimSuffix(groupPath, "/") != strings.TrimSuffix(user.GetGroupPath(), "/") || !samePolicies(policies, user.GetPolicies()) ||
		len(attributes) != len(user.GetAttributes()) || !slices.Equal(roles, current)
	for k, v := range attributes {
		if user.GetAttributes()[k] != v {
			changed = true
		}
	}
	if !changed {
		return nil
	}
	update := &idm.User{Uuid: user.GetUuid(), Login: user.GetLogin(), GroupPath: groupPath, Attributes: attributes, Policies: policies}
	for _, r := range roles {
		update.Roles = append(update.Roles, &idm.Role{Uuid: r, Label: r})
	}
	updated, err := idmc.UserServiceClient(ctx).CreateUser(ctx, &idm.CreateUserRequest{User: update})
	if err != nil {
		return err
	}
	if updated.GetUser().GetUuid() != user.GetUuid() || updated.GetUser().GetLogin() != user.GetLogin() {
		return errors.New("native OIDC account update changed the account identity")
	}
	return nil
}

// directoryAccount reads the account derived for issuer+subject without the
// lock verifier (a revoked account is locked); nil when the UUID is free.
func directoryAccount(ctx context.Context, id, issuer, subject string) (*idm.User, error) {
	found, err := searchNativeUsers(ctx, &idm.UserSingleQuery{Uuid: id})
	if err != nil || len(found) == 0 {
		return nil, err
	}
	u := found[0]
	if len(found) != 1 || u.GetIsGroup() || u.GetUuid() != id ||
		u.GetAttributes()[NativeOIDCIssuerAttribute] != issuer || u.GetAttributes()[NativeOIDCSubjectAttribute] != subject {
		return nil, errors.New("derived native OIDC account is held by another identity")
	}
	return u, nil
}

func directoryPicture(raw string) string {
	return nativeOIDCProfileFromClaims(map[string]any{"picture": raw}).picture
}

// ApplyNativeOIDCDirectory converges the native organisation to one checked
// snapshot and records it. It holds the provisioning lock for the whole run.
func ApplyNativeOIDCDirectory(ctx context.Context, snapshot *NativeOIDCDirectorySnapshot, workspaceRoot string) error {
	nativeOIDCProvisioning.Lock()
	defer nativeOIDCProvisioning.Unlock()
	c, err := loadNativeOIDCConnector(ctx)
	if err != nil {
		return err
	}
	if !c.ProvisionUsers || c.Organization == nil {
		return errors.New("member directory needs the provisioning connector of a dedicated Tenant")
	}
	if !strings.EqualFold(snapshot.TenantID, c.Organization.Tenant.ID) {
		return &NativeOIDCDirectoryUnavailable{Stage: "tenant"}
	}
	state := &nativeOIDCDirectoryState{Version: snapshot.Version, BindingID: strings.ToLower(snapshot.BindingID),
		TenantID: c.Organization.Tenant.ID, TenantName: c.Organization.Tenant.Name, Workspaces: snapshot.Workspaces}
	if validTenantName(snapshot.TenantName) {
		state.TenantName = snapshot.TenantName
	}
	group, err := ensureNativeOIDCTenantGroup(ctx, NativeOIDCTenant{ID: c.Organization.Tenant.ID, Name: state.TenantName})
	if err != nil {
		return err
	}
	if len(snapshot.Workspaces) > 0 && !directoryWorkspaceRoot.MatchString(workspaceRoot) {
		return errors.New("member directory Workspace root is not configured")
	}
	linked := map[string]bool{}
	for _, l := range c.Users {
		linked[l.Subject] = true
	}
	for _, m := range snapshot.Members {
		for _, id := range m.Identities {
			// Other issuers cannot sign in here; explicit links keep their account.
			if id.Issuer != c.Issuer || linked[id.Subject] {
				continue
			}
			state.Members = append(state.Members, nativeOIDCDirectoryEntry{Issuer: id.Issuer, Subject: id.Subject, Principal: m.PrincipalID,
				DisplayName: m.DisplayName, Picture: directoryPicture(id.Picture), Admin: m.Admin, Workspaces: m.Workspaces,
				WorkspaceAdmins: m.WorkspaceAdmins})
		}
	}
	// Workspaces first (roles must exist before accounts carry them); their
	// ADMINs are the derived accounts of the members marked ADMIN there.
	workspaceIDs := make([]string, 0, len(snapshot.Workspaces))
	for id := range snapshot.Workspaces {
		workspaceIDs = append(workspaceIDs, id)
	}
	slices.Sort(workspaceIDs)
	for _, id := range workspaceIDs {
		var admins []string
		for _, e := range state.Members {
			if slices.Contains(e.WorkspaceAdmins, id) {
				admins = append(admins, nativeOIDCUserUUID(e.Issuer, e.Subject))
			}
		}
		if err := ensureNativeOIDCWorkspace(ctx, workspaceRoot, id, snapshot.Workspaces[id], group.GetUuid(), admins); err != nil {
			return err
		}
	}
	for i := range state.Members {
		e := &state.Members[i]
		uuid := nativeOIDCUserUUID(e.Issuer, e.Subject)
		account, err := directoryAccount(ctx, uuid, e.Issuer, e.Subject)
		if err != nil {
			return err
		}
		profile := nativeOIDCProfile{displayName: e.DisplayName, picture: e.Picture}
		if account == nil {
			// Pre-provisioning: the directory has no preferred_username, the
			// login comes from the display name (else the digest fallback).
			preferred := strings.Join(strings.Fields(strings.ToLower(e.DisplayName)), ".")
			if err := createNativeOIDCAccount(ctx, c, uuid, e.Issuer, e.Subject, preferred, profile, "from the Kailo member directory"); err != nil {
				return err
			}
			if account, err = directoryAccount(ctx, uuid, e.Issuer, e.Subject); err != nil || account == nil {
				return errors.New("pre-provisioned native OIDC account is unavailable")
			}
		}
		if err := convergeNativeOIDCAccount(ctx, c, account, profile, true, e.membership(state)); err != nil {
			return err
		}
	}
	// Revocation: provisioned accounts of this issuer that the snapshot no
	// longer lists (a person who left the Tenant or the binding scope).
	accounts, err := searchNativeUsers(ctx, &idm.UserSingleQuery{AttributeName: NativeOIDCIssuerAttribute, AttributeValue: c.Issuer})
	if err != nil {
		return err
	}
	for _, account := range accounts {
		subject := account.GetAttributes()[NativeOIDCSubjectAttribute]
		if account.GetIsGroup() || subject == "" || linked[subject] || account.GetAttributes()[NativeOIDCIssuerAttribute] != c.Issuer ||
			account.GetUuid() != nativeOIDCUserUUID(c.Issuer, subject) {
			continue
		}
		if _, listed := state.member(c.Issuer, subject); listed {
			continue
		}
		// End the recorded native sessions first: a lost user write is
		// retried next period, ending again is idempotent.
		jti := "kailo-directory:" + snapshot.Version + ":" + account.GetUuid()
		bounded, cancel := context.WithTimeout(ctx, 5*time.Second) // only the best-effort native logout uses it
		_, err := EndNativeOIDCSessions(bounded, c.Issuer, subject, "", jti, time.Now().Add(24*time.Hour))
		cancel()
		if err != nil && !errors.Is(err, ErrNativeOIDCLogoutReplay) {
			return err
		}
		if err := convergeNativeOIDCAccount(ctx, c, account, nativeOIDCProfile{}, true, &nativeOIDCMembership{tenantName: state.TenantName}); err != nil {
			return err
		}
	}
	if err := retireNativeOIDCWorkspaces(ctx, snapshot.Workspaces); err != nil {
		return err
	}
	state.Applied = time.Now().Unix()
	return saveNativeOIDCDirectoryState(state)
}

// SyncNativeOIDCDirectory performs one period: read, compare the version with
// the applied one, and converge when it changed. It reports whether a new
// snapshot was applied; on any error nothing was recorded.
func SyncNativeOIDCDirectory(ctx context.Context, cfg *NativeOIDCDirectoryConfig) (bool, error) {
	snapshot, err := cfg.Fetch(ctx)
	if err != nil {
		return false, err
	}
	applied, err := loadNativeOIDCDirectoryState()
	if err != nil {
		return false, err
	}
	if applied != nil && applied.Version == snapshot.Version && applied.BindingID == strings.ToLower(snapshot.BindingID) {
		return false, nil
	}
	if err := ApplyNativeOIDCDirectory(ctx, snapshot, cfg.WorkspaceRoot); err != nil {
		return false, err
	}
	return true, nil
}

var nativeOIDCDirectoryStarted sync.Once

// StartNativeOIDCDirectorySync runs the periodic read in this process (once):
// nothing when the delivery is absent, an error when it is partial or invalid.
func StartNativeOIDCDirectorySync(ctx context.Context) error {
	cfg, err := NativeOIDCDirectoryConfigFromEnv()
	if err != nil {
		log.Logger(ctx).Error("Kailo member directory delivery refused", zap.Error(err))
		return err
	}
	if cfg == nil {
		log.Logger(ctx).Info("Kailo member directory not delivered; accounts stay standard members")
		return nil
	}
	nativeOIDCDirectoryStarted.Do(func() {
		go func() {
			period := func() {
				applied, err := SyncNativeOIDCDirectory(ctx, cfg)
				switch {
				case err != nil:
					// Status or category only; the snapshot already applied stays.
					log.Logger(ctx).Warn("Kailo member directory not applied; keeping the current organisation", zap.Error(err))
				case applied:
					log.Logger(ctx).Info("Kailo member directory applied")
				}
			}
			period()
			ticker := time.NewTicker(cfg.Interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					period()
				}
			}
		}()
	})
	return nil
}
