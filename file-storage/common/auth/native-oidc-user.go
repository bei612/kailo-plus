package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strings"
	"sync"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/client/commons/idmc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/telemetry/log"
)

// Private (pydio:) attributes recording the external identity of an account
// created on first native OIDC login (DD-127(9)). Only this file writes them.
const (
	NativeOIDCIssuerAttribute  = idm.UserAttrPrivatePrefix + "kailo_oidc_issuer"
	NativeOIDCSubjectAttribute = idm.UserAttrPrivatePrefix + "kailo_oidc_subject"
)

// ErrNativeOIDCNotLinked: the identity has neither an explicit link nor a
// provisioned account, and this call may not provision one.
var ErrNativeOIDCNotLinked = errors.New("OIDC identity is not linked to a native user")

var (
	// Namespace of the UUIDs derived from issuer+subject for provisioned accounts.
	nativeOIDCUserNamespace = uuid.MustParse("ea26a77c-2ecd-45ee-a46e-9c1f968c908c")
	nativeOIDCLoginPattern  = regexp.MustCompile(`^[a-z0-9][a-z0-9._@-]{0,63}$`)
	// First-login provisioning is serialized in the single native Cells process.
	nativeOIDCProvisioning sync.Mutex
)

// NativeOIDCUser is the existing native connector's explicit user link. It is
// neither an account producer nor a platform role/permission projection.
type NativeOIDCUser struct {
	Subject  string `json:"subject"`
	UserUUID string `json:"userUuid"`
}

// NativeOIDCConnector is the identity part of the single kailo-oidc connector
// in the native services/pydio.web.oauth/connectors configuration.
type NativeOIDCConnector struct {
	Issuer           string           `json:"issuer"`
	ClientID         string           `json:"clientId"`
	Users            []NativeOIDCUser `json:"users"`
	ProvisionUsers   bool             `json:"provisionUsers"`
	ProvisionProfile string           `json:"provisionProfile"`
	// Kailo Tenant of this dedicated instance → native group (07 §4.7.4);
	// nil keeps the DD-127(9) root-group accounts.
	Organization *NativeOIDCOrganization `json:"organization,omitempty"`
}

// Validate refuses ambiguous links and any provisioning profile other than an
// explicitly enabled standard one; a disabled switch carries no profile.
func (c NativeOIDCConnector) Validate() error {
	if strings.TrimSpace(c.Issuer) == "" || strings.TrimSpace(c.ClientID) == "" {
		return errors.New("incomplete native OIDC connector")
	}
	subjects, users := map[string]bool{}, map[string]bool{}
	for _, link := range c.Users {
		if strings.TrimSpace(link.Subject) == "" || strings.TrimSpace(link.UserUUID) == "" || subjects[link.Subject] || users[link.UserUUID] {
			return errors.New("ambiguous or empty native OIDC user link")
		}
		subjects[link.Subject], users[link.UserUUID] = true, true
	}
	if c.ProvisionUsers != (c.ProvisionProfile != "") || (c.ProvisionUsers && c.ProvisionProfile != common.PydioProfileStandard) {
		return errors.New("native OIDC provisioning must be explicitly enabled with the standard profile")
	}
	return c.Organization.Validate()
}

func loadNativeOIDCConnector(ctx context.Context) (NativeOIDCConnector, error) {
	var entries []struct {
		Type   string              `json:"type"`
		Config NativeOIDCConnector `json:"config"`
	}
	if err := config.Get(ctx, "services", "pydio.web.oauth", "connectors").Scan(&entries); err != nil {
		return NativeOIDCConnector{}, err
	}
	var selected *NativeOIDCConnector
	for i := range entries {
		if entries[i].Type != "kailo-oidc" {
			continue
		}
		if selected != nil {
			return NativeOIDCConnector{}, errors.New("ambiguous native OIDC connector")
		}
		selected = &entries[i].Config
	}
	if selected == nil {
		return NativeOIDCConnector{}, errors.New("native OIDC connector is not configured")
	}
	return *selected, selected.Validate()
}

// ResolveOrProvisionNativeOIDCUser is the only path from an external OIDC
// identity to a native user, shared by the browser callback, document PAT
// issuance, WOPI sessions and native action credentials. Order: explicit
// connector link, then the account provisioned for issuer+subject, then (only
// with the connector switch on and an ID token the callback verified for the
// connector's own client) a new standard account. Email, display name and
// groups never select or create an account. With that ID token (browser
// login only) the account is refreshed from Kailo (07 §4.7.3, DD-133):
// profile data always, the Tenant group for provisioned accounts. Callers keep their own native
// policy checks; the returned user already passed ResolveNativeUser.
func ResolveOrProvisionNativeOIDCUser(ctx context.Context, issuer, subject string, login *oidc.IDToken) (*idm.User, error) {
	c, err := loadNativeOIDCConnector(ctx)
	if err != nil {
		return nil, err
	}
	if issuer != c.Issuer || strings.TrimSpace(subject) == "" {
		return nil, errors.New("unrecognized native OIDC identity")
	}
	if login != nil && (login.Issuer != issuer || login.Subject != subject || !slices.Contains(login.Audience, c.ClientID)) {
		return nil, errors.New("native OIDC login requires an ID token of the connector client")
	}
	for _, link := range c.Users {
		if link.Subject == subject {
			user, err := ResolveNativeUser(ctx, link.UserUUID)
			if err != nil || login == nil {
				return user, err
			}
			return refreshNativeOIDCUser(ctx, c, user, login, false)
		}
	}
	id := nativeOIDCUserUUID(issuer, subject)
	user, err := provisionedNativeOIDCUser(ctx, id, issuer, subject)
	if err != nil {
		return nil, err
	}
	if user == nil {
		if !c.ProvisionUsers || login == nil {
			return nil, ErrNativeOIDCNotLinked
		}
		if user, err = provisionNativeOIDCUser(ctx, c, id, login); err != nil {
			return nil, err
		}
	}
	if login == nil {
		return user, nil
	}
	return refreshNativeOIDCUser(ctx, c, user, login, true)
}

// refreshNativeOIDCUser serializes the refresh with first-login provisioning.
func refreshNativeOIDCUser(ctx context.Context, c NativeOIDCConnector, user *idm.User, login *oidc.IDToken, provisioned bool) (*idm.User, error) {
	nativeOIDCProvisioning.Lock()
	defer nativeOIDCProvisioning.Unlock()
	return syncNativeOIDCUser(ctx, c, user, login, provisioned)
}

func nativeOIDCUserUUID(issuer, subject string) string {
	return uuid.NewSHA1(nativeOIDCUserNamespace, []byte(issuer+"\x00"+subject)).String()
}

// provisionedNativeOIDCUser returns nil, nil when the derived UUID is free. An
// account there must carry exactly this identity: an attribute alone (writable
// on another UUID) or a UUID alone never links.
func provisionedNativeOIDCUser(ctx context.Context, id, issuer, subject string) (*idm.User, error) {
	found, err := searchNativeUsers(ctx, &idm.UserSingleQuery{Uuid: id})
	if err != nil || len(found) == 0 {
		return nil, err
	}
	u := found[0]
	if len(found) != 1 || u.GetIsGroup() || u.GetUuid() != id ||
		u.GetAttributes()[NativeOIDCIssuerAttribute] != issuer || u.GetAttributes()[NativeOIDCSubjectAttribute] != subject {
		return nil, errors.New("derived native OIDC account is held by another identity")
	}
	return ResolveNativeUser(ctx, id)
}

func provisionNativeOIDCUser(ctx context.Context, c NativeOIDCConnector, id string, login *oidc.IDToken) (*idm.User, error) {
	nativeOIDCProvisioning.Lock()
	defer nativeOIDCProvisioning.Unlock()
	// Query again under the lock: a concurrent first login may have finished.
	if user, err := provisionedNativeOIDCUser(ctx, id, login.Issuer, login.Subject); err != nil || user != nil {
		return user, err
	}
	var claims map[string]any
	if err := login.Claims(&claims); err != nil {
		return nil, err
	}
	text := func(key string) string {
		value, _ := claims[key].(string)
		return strings.TrimSpace(value)
	}
	name, err := availableNativeOIDCLogin(ctx, text("preferred_username"), login.Issuer, login.Subject)
	if err != nil {
		return nil, err
	}
	// Profile data only; never used to link (refreshed on every browser login).
	attributes := map[string]string{
		idm.UserAttrProfile:        c.ProvisionProfile,
		NativeOIDCIssuerAttribute:  login.Issuer,
		NativeOIDCSubjectAttribute: login.Subject,
	}
	// The same Kailo profile rules as the refresh of every later login.
	profile := nativeOIDCProfileFromClaims(claims)
	if profile.displayName != "" {
		attributes[idm.UserAttrDisplayName] = profile.displayName
	}
	if profile.email != "" {
		attributes[idm.UserAttrEmail] = profile.email
	}
	if profile.picture != "" {
		attributes[idm.UserAttrAvatar] = profile.picture
	}
	// The role first: a failed user write leaves no account without its role,
	// and the next login repeats both idempotent writes.
	if _, err = idmc.RoleServiceClient(ctx).CreateRole(ctx, &idm.CreateRoleRequest{Role: &idm.Role{
		Uuid: id, UserRole: true, Label: "User " + name, Policies: nativeOIDCUserPolicies(id)}}); err != nil {
		return nil, err
	}
	created, err := idmc.UserServiceClient(ctx).CreateUser(ctx, &idm.CreateUserRequest{User: &idm.User{
		Uuid: id, Login: name, GroupPath: "/", Attributes: attributes, Policies: nativeOIDCUserPolicies(id)}})
	if err != nil {
		return nil, err
	}
	if created.GetUser().GetUuid() != id || created.GetUser().GetLogin() != name {
		return nil, errors.New("native OIDC provisioning did not create the derived account")
	}
	log.Auditer(ctx).Info(fmt.Sprintf("Created user [/%s] on first native OIDC login", name),
		log.GetAuditId(common.AuditUserCreate), zap.String(common.KeyUserUuid, id))
	// Read back: only the derived account carrying this identity is accepted.
	user, err := provisionedNativeOIDCUser(ctx, id, login.Issuer, login.Subject)
	if err != nil {
		return nil, err
	}
	if user == nil || user.GetLogin() != name {
		return nil, errors.New("provisioned native OIDC account is unavailable")
	}
	return user, nil
}

// The resource policies of the native admin creation (idm/user/rest PutUser)
// for both the account and its personal user role. No workspace, role or ACL
// is granted: access comes only from the profile's native auto-applied roles.
func nativeOIDCUserPolicies(id string) []*service.ResourcePolicy {
	return permissions.NewResourcePoliciesBuilder().
		WithProfileRead(common.PydioProfileStandard).
		WithSubjectWrite(id).
		WithProfileWrite(common.PydioProfileAdmin).
		Policies()
}

// nativeOIDCLoginCandidates: the normalized preferred_username, then a single
// deterministic fallback with an issuer+subject digest suffix ("oidc-<digest>"
// when the preferred name is missing or invalid). Nothing else is tried.
func nativeOIDCLoginCandidates(preferred, issuer, subject string) []string {
	digest := sha256.Sum256([]byte(issuer + "\x00" + subject))
	suffix := "-" + hex.EncodeToString(digest[:])[:12]
	base := strings.ToLower(strings.TrimSpace(preferred))
	if !nativeOIDCLoginPattern.MatchString(base) {
		return []string{"oidc" + suffix}
	}
	return []string{base, base[:min(len(base), 64-len(suffix))] + suffix}
}

// A login is taken when any user or group node carries that name.
func availableNativeOIDCLogin(ctx context.Context, preferred, issuer, subject string) (string, error) {
	for _, candidate := range nativeOIDCLoginCandidates(preferred, issuer, subject) {
		taken, err := searchNativeUsers(ctx, &idm.UserSingleQuery{Login: candidate})
		if err != nil {
			return "", err
		}
		if len(taken) == 0 {
			return candidate, nil
		}
	}
	return "", errors.New("no native login name is available for this OIDC identity")
}

func searchNativeUsers(ctx context.Context, single *idm.UserSingleQuery) ([]*idm.User, error) {
	query, err := anypb.New(single)
	if err != nil {
		return nil, err
	}
	stream, err := idmc.UserServiceClient(ctx).SearchUser(ctx, &idm.SearchUserRequest{Query: &service.Query{
		SubQueries: []*anypb.Any{query}, Operation: service.OperationType_AND}})
	if err != nil {
		return nil, err
	}
	var users []*idm.User
	for {
		response, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return users, nil
		}
		if err != nil {
			return nil, err
		}
		users = append(users, response.GetUser())
	}
}

// WithoutNativeOIDCLink drops caller-supplied link attributes from a native
// REST user write; that handler then restores the stored values of an
// existing user, so the link is written only by first-login provisioning.
func WithoutNativeOIDCLink(attributes map[string]string) {
	delete(attributes, NativeOIDCIssuerAttribute)
	delete(attributes, NativeOIDCSubjectAttribute)
}

// ResolveNativeUser consumes an explicit existing UUID, never an email/name
// fallback. Both browser OIDC and governed native actions use the same native
// user and lock verifiers before constructing its original ACL context.
func ResolveNativeUser(ctx context.Context, nativeUUID string) (*idm.User, error) {
	query, err := anypb.New(&idm.UserSingleQuery{Uuid: nativeUUID, NodeType: idm.NodeType_USER})
	if err != nil {
		return nil, err
	}
	response, err := idmc.UserServiceClient(ctx).SearchOne(ctx, &idm.SearchUserRequest{Query: &service.Query{
		SubQueries: []*anypb.Any{query}, Operation: service.OperationType_AND}})
	if err != nil {
		return nil, err
	}
	user := response.GetUser()
	if user == nil || user.Uuid != nativeUUID || user.Login == "" || user.IsGroup || user.IsHidden() {
		return nil, errors.New("native user projection is unavailable")
	}
	if err = VerifyContext(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}
