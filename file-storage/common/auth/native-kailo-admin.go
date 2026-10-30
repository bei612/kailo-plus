package auth

import (
	"context"

	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/permissions"
)

// DD-138(6), design 07 §4.8.5 系统级设置归属: in Kailo mode the storage of this
// instance (data sources, their buckets and encryption keys) is declared by the
// deployment and shown read-only in the Kailo admin area (admin surface
// storage.dataSources, READ_ONLY). The component server refuses the native
// writes itself, not only the page:
//
//   - a person Kailo manages (an OIDC-linked native account: provisioned with
//     the kailo_oidc issuer/subject attributes or explicitly linked by the
//     connector; every human signs in this way in Kailo mode) is refused with
//     403, whatever native admin profile the member directory derived;
//   - the deployment's own local accounts keep the native path: that is the
//     deployment declaration itself (deploy/reconcile.py writes the declared
//     versioning policy of the content datasources with the install admin's
//     short-lived token; the image entrypoint creates the binding datasource
//     with `cells admin datasource ensure` before start, no REST involved).
//
// A request whose caller cannot be resolved is refused (fails closed).

// NativeKailoManagedSetting is the refusal message of a deployment-declared setting.
const NativeKailoManagedSetting = "this setting is declared by the Kailo deployment and is read-only here"

// NativeKailoPersonRequest reports whether the request's caller is a person
// Kailo manages (OIDC-linked native account). Replaceable in tests.
var NativeKailoPersonRequest = func(ctx context.Context) (bool, error) {
	claims, ok := claim.FromContext(ctx)
	if !ok || claims.Name == "" {
		return false, errors.New("request carries no native identity")
	}
	user, err := permissions.SearchUniqueUser(ctx, claims.Name, "")
	if err != nil {
		return false, err
	}
	_, linked := NativeOIDCUserIdentity(ctx, user)
	return linked, nil
}

// NativeKailoRefuseManagedWrite returns a 403 error for a write to a
// deployment-declared setting by a person Kailo manages (Kailo mode only).
func NativeKailoRefuseManagedWrite(ctx context.Context) error {
	if !NativeKailoMode() {
		return nil
	}
	person, err := NativeKailoPersonRequest(ctx)
	if err != nil || person {
		return errors.WithMessage(errors.StatusForbidden, NativeKailoManagedSetting)
	}
	return nil
}
