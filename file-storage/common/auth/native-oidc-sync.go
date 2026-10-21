package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/coreos/go-oidc/v3/oidc"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/client/commons/idmc"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/common/utils/i18n/languages"
)

// Kailo user system in Cells (DD-133 §3, extends DD-127(9)): every browser
// login refreshes the provisioned account from the verified ID token of the
// connector client. The Kailo Tenant of the identity selects one native group
// (the "organization"); account visibility is limited to that group, and the
// optional Tenant-admin claim derives the native profile. Explicitly linked
// legacy accounts only receive the profile data refresh: their group and
// profile stay with the native administrator.

// ErrNativeOIDCTenantRefused: the identity is not a member of a Kailo Tenant
// bound to this native instance. Nothing is created or changed.
var ErrNativeOIDCTenantRefused = errors.New("OIDC identity is not a member of a Tenant bound to this instance")

// NativeOIDCTenantGroupPrefix starts the native group path of a Kailo Tenant.
const NativeOIDCTenantGroupPrefix = "kailo-"

var (
	nativeOIDCTenantID   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	nativeOIDCClaimName  = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$`)
	nativeOIDCPictureMax = 2048
)

// NativeOIDCTenant is one Kailo Tenant whose members may use this instance.
type NativeOIDCTenant struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// NativeOIDCOrganization maps the Kailo Tenant of a verified identity onto a
// native group. Without TenantClaim the instance is dedicated to its single
// declared Tenant. TenantAdminClaim derives the native admin profile; the
// native admin profile is instance-wide, so it is accepted only for an
// instance dedicated to exactly one Tenant.
type NativeOIDCOrganization struct {
	Tenants          []NativeOIDCTenant `json:"tenants"`
	TenantClaim      string             `json:"tenantClaim,omitempty"`
	TenantAdminClaim string             `json:"tenantAdminClaim,omitempty"`
}

// Validate refuses an ambiguous or unsafe organization mapping.
func (o *NativeOIDCOrganization) Validate() error {
	if o == nil {
		return nil
	}
	if len(o.Tenants) == 0 {
		return errors.New("native OIDC organization must declare the Tenants bound to this instance")
	}
	seen := map[string]bool{}
	for _, t := range o.Tenants {
		name := strings.TrimSpace(t.Name)
		if !nativeOIDCTenantID.MatchString(t.ID) || seen[strings.ToLower(t.ID)] || name == "" || name != t.Name || len(name) > 128 ||
			strings.IndexFunc(name, func(r rune) bool { return !unicode.IsPrint(r) }) >= 0 {
			return errors.New("native OIDC organization Tenants need unique ids and printable names")
		}
		seen[strings.ToLower(t.ID)] = true
	}
	for _, claimName := range []string{o.TenantClaim, o.TenantAdminClaim} {
		if claimName != "" && !nativeOIDCClaimName.MatchString(claimName) {
			return errors.New("invalid native OIDC organization claim name")
		}
	}
	if o.TenantClaim == "" && len(o.Tenants) != 1 {
		return errors.New("several Tenants require the Tenant claim of the identity")
	}
	if o.TenantAdminClaim != "" && len(o.Tenants) != 1 {
		return errors.New("the instance-wide native admin profile is derived only for an instance dedicated to one Tenant")
	}
	return nil
}

// tenant selects the Tenant of a verified identity among the declared ones.
func (o *NativeOIDCOrganization) tenant(claims map[string]any) (NativeOIDCTenant, error) {
	if o.TenantClaim == "" {
		return o.Tenants[0], nil
	}
	var values []string
	switch v := claims[o.TenantClaim].(type) {
	case string:
		values = []string{v}
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok {
				values = append(values, s)
			}
		}
	}
	var matches []NativeOIDCTenant
	for _, t := range o.Tenants {
		if slices.ContainsFunc(values, func(v string) bool { return strings.EqualFold(strings.TrimSpace(v), t.ID) }) {
			matches = append(matches, t)
		}
	}
	if len(matches) != 1 {
		return NativeOIDCTenant{}, ErrNativeOIDCTenantRefused
	}
	return matches[0], nil
}

// tenantAdmin reads the optional boolean Tenant-admin claim.
func (o *NativeOIDCOrganization) tenantAdmin(claims map[string]any) bool {
	if o.TenantAdminClaim == "" {
		return false
	}
	switch v := claims[o.TenantAdminClaim].(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "true")
	}
	return false
}

// NativeOIDCTenantGroupPath is the native group of a Tenant: lowercase ids are
// kept readable, anything else is replaced by a digest.
func NativeOIDCTenantGroupPath(tenantID string) string {
	key := strings.ToLower(tenantID)
	if strings.Trim(key, "abcdefghijklmnopqrstuvwxyz0123456789-") != "" {
		digest := sha256.Sum256([]byte(tenantID))
		key = hex.EncodeToString(digest[:])[:24]
	}
	return "/" + NativeOIDCTenantGroupPrefix + key
}

// nativeOIDCProfile is the profile data copied from Kailo on every login.
type nativeOIDCProfile struct {
	displayName string
	email       string
	picture     string
	language    string
}

func nativeOIDCProfileFromClaims(claims map[string]any) nativeOIDCProfile {
	text := func(key string) string {
		value, _ := claims[key].(string)
		return strings.TrimSpace(value)
	}
	p := nativeOIDCProfile{displayName: text("name")}
	if p.displayName == "" {
		p.displayName = text("preferred_username")
	}
	if verified, _ := claims["email_verified"].(bool); verified {
		p.email = text("email")
	}
	if picture := text("picture"); len(picture) <= nativeOIDCPictureMax {
		if u, err := url.Parse(picture); err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil {
			p.picture = u.String()
		}
	}
	p.language = NativeOIDCLanguage(text("locale"))
	return p
}

// NativeOIDCLanguage maps a BCP 47 locale (Kailo: zh-CN, en) onto a native
// Cells language; unknown locales give "" and leave the language unchanged.
func NativeOIDCLanguage(locale string) string {
	l := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(locale), "_", "-"))
	if l == "" {
		return ""
	}
	if _, ok := languages.AvailableLanguages[l]; ok {
		return l
	}
	switch {
	case l == "zh" || strings.HasPrefix(l, "zh-cn") || strings.HasPrefix(l, "zh-hans") || strings.HasPrefix(l, "zh-sg"):
		return "zh-cn"
	case strings.HasPrefix(l, "zh-"):
		if _, ok := languages.AvailableLanguages["zh-tw"]; ok {
			return "zh-tw"
		}
		return "zh-cn"
	case l == "en" || strings.HasPrefix(l, "en-"):
		return "en-us"
	}
	return ""
}

// isNativeOIDCPicture recognizes an avatar that holds a Kailo picture URL
// rather than a native binary id.
func isNativeOIDCPicture(avatar string) bool {
	return strings.HasPrefix(avatar, "https://") || strings.HasPrefix(avatar, "http://")
}

// nativeOIDCTenantUserPolicies: readable by the members of its Tenant group,
// by itself and by native admins; writable by itself and native admins only.
func nativeOIDCTenantUserPolicies(id, groupUUID string) []*service.ResourcePolicy {
	return permissions.NewResourcePoliciesBuilder().
		WithResourcePolicy(&service.ResourcePolicy{Action: service.ResourcePolicyAction_READ, Effect: service.ResourcePolicy_allow,
			Subject: permissions.PolicySubjectRolePrefix + groupUUID}).
		WithSubjectRead(id).
		WithProfileRead(common.PydioProfileAdmin).
		WithSubjectWrite(id).
		WithProfileWrite(common.PydioProfileAdmin).
		Policies()
}

func nativeOIDCTenantGroupPolicies(groupUUID string) []*service.ResourcePolicy {
	return permissions.NewResourcePoliciesBuilder().
		WithResourcePolicy(&service.ResourcePolicy{Action: service.ResourcePolicyAction_READ, Effect: service.ResourcePolicy_allow,
			Subject: permissions.PolicySubjectRolePrefix + groupUUID}).
		WithProfileRead(common.PydioProfileAdmin).
		WithProfileWrite(common.PydioProfileAdmin).
		Policies()
}

// ensureNativeOIDCTenantGroup creates or reads back the native group (and its
// group role) of a Tenant; its label follows the declared Tenant name.
func ensureNativeOIDCTenantGroup(ctx context.Context, t NativeOIDCTenant) (*idm.User, error) {
	groupPath := NativeOIDCTenantGroupPath(t.ID)
	label := strings.TrimPrefix(groupPath, "/")
	find := func() (*idm.User, error) {
		found, err := searchNativeUsers(ctx, &idm.UserSingleQuery{FullPath: groupPath})
		if err != nil {
			return nil, err
		}
		for _, g := range found {
			if g.GetIsGroup() && path.Join("/", g.GetGroupPath(), g.GetGroupLabel()) == groupPath {
				return g, nil
			}
		}
		return nil, nil
	}
	group, err := find()
	if err != nil {
		return nil, err
	}
	created := group == nil
	if created {
		if _, err := idmc.UserServiceClient(ctx).CreateUser(ctx, &idm.CreateUserRequest{User: &idm.User{
			IsGroup: true, GroupPath: groupPath, GroupLabel: label,
			Attributes: map[string]string{idm.UserAttrDisplayName: t.Name},
			Policies:   permissions.NewResourcePoliciesBuilder().WithProfileRead(common.PydioProfileAdmin).WithProfileWrite(common.PydioProfileAdmin).Policies(),
		}}); err != nil {
			return nil, err
		}
		if group, err = find(); err != nil {
			return nil, err
		}
		if group == nil || group.GetUuid() == "" {
			return nil, errors.New("native Tenant group was not created")
		}
		if _, err := idmc.RoleServiceClient(ctx).CreateRole(ctx, &idm.CreateRoleRequest{Role: &idm.Role{
			Uuid: group.GetUuid(), GroupRole: true, Label: "Group " + label}}); err != nil {
			return nil, err
		}
		log.Auditer(ctx).Info(fmt.Sprintf("Created group [%s] for a Kailo Tenant", groupPath),
			log.GetAuditId(common.AuditGroupCreate), group.ZapUuid())
	}
	wantPolicies := nativeOIDCTenantGroupPolicies(group.GetUuid())
	if created || group.GetAttributes()[idm.UserAttrDisplayName] != t.Name || !samePolicies(group.GetPolicies(), wantPolicies) {
		attributes := map[string]string{}
		for k, v := range group.GetAttributes() {
			attributes[k] = v
		}
		attributes[idm.UserAttrDisplayName] = t.Name
		if _, err := idmc.UserServiceClient(ctx).CreateUser(ctx, &idm.CreateUserRequest{User: &idm.User{
			Uuid: group.GetUuid(), IsGroup: true, GroupPath: groupPath, GroupLabel: label,
			Attributes: attributes, Policies: wantPolicies}}); err != nil {
			return nil, err
		}
		group.Attributes = attributes
		group.Policies = wantPolicies
	}
	return group, nil
}

func samePolicies(a, b []*service.ResourcePolicy) bool {
	key := func(p *service.ResourcePolicy) string {
		return p.GetAction().String() + "\x00" + p.GetEffect().String() + "\x00" + p.GetSubject()
	}
	set := func(list []*service.ResourcePolicy) []string {
		out := make([]string, 0, len(list))
		for _, p := range list {
			out = append(out, key(p))
		}
		slices.Sort(out)
		return slices.Compact(out)
	}
	return slices.Equal(set(a), set(b))
}

// syncNativeOIDCUser applies the Kailo profile (and, for a provisioned
// account, its Tenant group and profile) from the verified ID token, then
// reads the account back through ResolveNativeUser.
func syncNativeOIDCUser(ctx context.Context, c NativeOIDCConnector, user *idm.User, login *oidc.IDToken, provisioned bool) (*idm.User, error) {
	var claims map[string]any
	if err := login.Claims(&claims); err != nil {
		return nil, err
	}
	profile := nativeOIDCProfileFromClaims(claims)
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
	} else if isNativeOIDCPicture(attributes[idm.UserAttrAvatar]) {
		// Kailo no longer publishes a picture: drop the stale copy only.
		delete(attributes, idm.UserAttrAvatar)
	}
	groupPath, policies := user.GetGroupPath(), user.GetPolicies()
	if provisioned && c.Organization != nil {
		tenant, err := c.Organization.tenant(claims)
		if err != nil {
			return nil, err
		}
		group, err := ensureNativeOIDCTenantGroup(ctx, tenant)
		if err != nil {
			return nil, err
		}
		groupPath = NativeOIDCTenantGroupPath(tenant.ID)
		policies = nativeOIDCTenantUserPolicies(user.GetUuid(), group.GetUuid())
		if c.Organization.TenantAdminClaim != "" {
			if c.Organization.tenantAdmin(claims) {
				attributes[idm.UserAttrProfile] = common.PydioProfileAdmin
			} else {
				attributes[idm.UserAttrProfile] = common.PydioProfileStandard
			}
		}
	}
	changed := strings.TrimSuffix(groupPath, "/") != strings.TrimSuffix(user.GetGroupPath(), "/") || !samePolicies(policies, user.GetPolicies()) ||
		len(attributes) != len(user.GetAttributes())
	for k, v := range attributes {
		if user.GetAttributes()[k] != v {
			changed = true
		}
	}
	if changed {
		before := user.GetAttributes()[idm.UserAttrProfile]
		update := &idm.User{Uuid: user.GetUuid(), Login: user.GetLogin(), GroupPath: groupPath, Attributes: attributes, Policies: policies}
		updated, err := idmc.UserServiceClient(ctx).CreateUser(ctx, &idm.CreateUserRequest{User: update})
		if err != nil {
			return nil, err
		}
		if updated.GetUser().GetUuid() != user.GetUuid() || updated.GetUser().GetLogin() != user.GetLogin() {
			return nil, errors.New("native OIDC profile refresh changed the account identity")
		}
		if after := attributes[idm.UserAttrProfile]; after != before {
			log.Auditer(ctx).Info(fmt.Sprintf("Profile of [%s] derived from the Kailo Tenant role: %s", user.GetLogin(), after),
				log.GetAuditId(common.AuditUserUpdate), zap.String(common.KeyUserUuid, user.GetUuid()))
		}
	}
	if profile.language != "" {
		if err := setNativeUserLanguage(ctx, user.GetUuid(), profile.language); err != nil {
			return nil, err
		}
	}
	return ResolveNativeUser(ctx, user.GetUuid())
}

// setNativeUserLanguage writes the personal language parameter exactly like
// the native login language option (frontend/rest/modifiers): one value on the
// user role for all workspaces.
func setNativeUserLanguage(ctx context.Context, userUUID, lang string) error {
	const action = "parameter:core.conf:lang"
	aclClient := idmc.ACLServiceClient(ctx)
	query, _ := anypb.New(&idm.ACLSingleQuery{RoleIDs: []string{userUUID}, Actions: []*idm.ACLAction{{Name: action}},
		WorkspaceIDs: []string{permissions.FrontWsScopeAll}})
	stream, err := aclClient.SearchACL(ctx, &idm.SearchACLRequest{Query: &service.Query{SubQueries: []*anypb.Any{query}}})
	if err != nil {
		return err
	}
	var current []string
	for {
		response, err := stream.Recv()
		if err != nil {
			break
		}
		current = append(current, response.GetACL().GetAction().GetValue())
	}
	if len(current) == 1 && strings.Trim(current[0], `"`) == lang {
		return nil
	}
	deadline, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if len(current) > 0 {
		if _, err := aclClient.DeleteACL(deadline, &idm.DeleteACLRequest{Query: &service.Query{SubQueries: []*anypb.Any{query}}}); err != nil {
			return err
		}
	}
	_, err = aclClient.CreateACL(deadline, &idm.CreateACLRequest{ACL: &idm.ACL{RoleID: userUUID, WorkspaceID: permissions.FrontWsScopeAll,
		Action: &idm.ACLAction{Name: action, Value: lang}}})
	return err
}
