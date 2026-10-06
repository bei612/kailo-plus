package auth

import (
	"context"
	"errors"
	"strings"

	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common/client/commons/idmc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
)

// NativeOIDCUser is the existing native connector's explicit user link. It is
// neither an account producer nor a platform role/permission projection.
type NativeOIDCUser struct {
	Subject  string `json:"subject"`
	UserUUID string `json:"userUuid"`
}

// NativeOIDCUserUUID is shared by native browser login and document PAT
// issuance. Never match an email, display name or an unconfigured subject.
func NativeOIDCUserUUID(configuredIssuer string, links []NativeOIDCUser, issuer, subject string) (string, error) {
	if configuredIssuer == "" || issuer != configuredIssuer || strings.TrimSpace(subject) == "" {
		return "", errors.New("unrecognized native OIDC identity")
	}
	subjects, users := map[string]bool{}, map[string]bool{}
	selected := ""
	for _, link := range links {
		if strings.TrimSpace(link.Subject) == "" || strings.TrimSpace(link.UserUUID) == "" || subjects[link.Subject] || users[link.UserUUID] {
			return "", errors.New("ambiguous native OIDC user projection")
		}
		subjects[link.Subject], users[link.UserUUID] = true, true
		if link.Subject == subject {
			selected = link.UserUUID
		}
	}
	if selected == "" {
		return "", errors.New("OIDC identity is not linked to a native user")
	}
	return selected, nil
}

// ResolveNativeOIDCUser consumes the same controlled native connector as the
// original frontend. The actual UUID lookup and native context verifiers remain
// mandatory; there is no account creation, email fallback or service ACL swap.
func ResolveNativeOIDCUser(ctx context.Context, issuer, subject string) (*idm.User, error) {
	var connectors []struct {
		Type   string `json:"type"`
		Config struct {
			Issuer string           `json:"issuer"`
			Users  []NativeOIDCUser `json:"users"`
		} `json:"config"`
	}
	if err := config.Get(ctx, "services", "pydio.web.oauth", "connectors").Scan(&connectors); err != nil {
		return nil, err
	}
	nativeUUID := ""
	matched := false
	for _, connector := range connectors {
		if connector.Type != "kailo-oidc" {
			continue
		}
		if matched {
			return nil, errors.New("ambiguous native OIDC connector")
		}
		matched = true
		var err error
		nativeUUID, err = NativeOIDCUserUUID(connector.Config.Issuer, connector.Config.Users, issuer, subject)
		if err != nil {
			return nil, err
		}
	}
	if !matched {
		return nil, errors.New("native OIDC connector is not configured")
	}
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
		return nil, errors.New("native human projection is unavailable")
	}
	if err = VerifyContext(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}
