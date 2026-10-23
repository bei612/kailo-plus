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
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/client/commons/idmc"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/common/utils/i18n/languages"
)

// Kailo user system in Cells (07 §4.7.3/§4.7.4, DD-133, extends DD-127(9)):
// every browser login refreshes the provisioned account from the verified ID
// token of the connector client. The instance serves one Kailo Tenant
// (DEDICATED_INSTANCE); its provisioned accounts live in that Tenant's native
// group and are visible only to its members. Roles are never derived from
// the IdP: until the platform member directory is delivered, accounts are
// standard members and no native admin is granted; afterwards profile and
// Workspace roles follow the directory (native-oidc-directory.go). Explicitly
// linked legacy accounts only receive the profile data refresh.

// NativeOIDCTenantGroupPrefix starts the native group path of a Kailo Tenant.
const NativeOIDCTenantGroupPrefix = "kailo-"

var (
	nativeOIDCTenantID   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	nativeOIDCPictureMax = 2048
)

// NativeOIDCTenant is the Kailo Tenant this instance is bound to.
type NativeOIDCTenant struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// NativeOIDCOrganization declares the Tenant of this dedicated instance.
type NativeOIDCOrganization struct {
	Tenant NativeOIDCTenant `json:"tenant"`
}

// Validate refuses a missing or unsafe Tenant declaration.
func (o *NativeOIDCOrganization) Validate() error {
	if o == nil {
		return nil
	}
	name := strings.TrimSpace(o.Tenant.Name)
	if !nativeOIDCTenantID.MatchString(o.Tenant.ID) || name == "" || name != o.Tenant.Name || len(name) > 128 ||
		strings.IndexFunc(name, func(r rune) bool { return !unicode.IsPrint(r) }) >= 0 {
		return errors.New("native OIDC organization needs the bound Tenant id and printable name")
	}
	return nil
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

// IsNativeOIDCPicture recognizes an avatar that holds a Kailo picture URL
// rather than a native binary id.
func IsNativeOIDCPicture(avatar string) bool {
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
// account, its Tenant group, profile and Workspace roles) from the verified
// ID token and, once delivered, the member directory, then reads the account
// back through ResolveNativeUser. With a directory the Kailo display name and
// picture are the directory ones (07 §4.7.4), email and locale stay from the
// token.
func syncNativeOIDCUser(ctx context.Context, c NativeOIDCConnector, user *idm.User, login *oidc.IDToken, provisioned bool,
	member *nativeOIDCMembership, listed *nativeOIDCDirectoryEntry) (*idm.User, error) {
	var claims map[string]any
	if err := login.Claims(&claims); err != nil {
		return nil, err
	}
	profile := nativeOIDCProfileFromClaims(claims)
	if listed != nil {
		if listed.DisplayName != "" {
			profile.displayName = listed.DisplayName
		}
		profile.picture = listed.Picture
	}
	if err := convergeNativeOIDCAccount(ctx, c, user, profile, provisioned, member); err != nil {
		return nil, err
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
