package grpc

import (
	"context"
	"github.com/pborman/uuid"
	"strings"

	"github.com/pydio/cells/v5/common"
	commonauth "github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/auth/protocol"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/proto/auth"
	"github.com/pydio/cells/v5/common/proto/tree"
)

// This check is at the actual native PAT write, not only the REST front door.
// RevocationKey on a DOCUMENT token selects the designed platform Session path;
// other native PAT types and the standalone document producer are unchanged.
func validatePlatformDocumentToken(ctx context.Context, request *auth.PatGenerateRequest) error {
	id := uuid.Parse(request.RevocationKey)
	if id == nil || id.String() != request.RevocationKey || request.CacheKey != request.RevocationKey ||
		request.AutoRefreshWindow != 0 || request.GenerateSecretPair || len(request.Scopes) != 1 {
		return errors.WithMessage(errors.InvalidParameters, "invalid platform document token intent")
	}
	scope := strings.Split(request.Scopes[0], ":")
	if len(scope) != 3 || scope[0] != "node" || (scope[2] != "r" && scope[2] != "rw") ||
		uuid.Parse(scope[1]) == nil || uuid.Parse(scope[1]).String() != scope[1] {
		return errors.WithMessage(errors.InvalidParameters, "invalid platform document token scope")
	}
	delivery, err := protocol.Load(ctx)
	claims, ok := claim.FromContext(ctx)
	if err != nil || !ok || claims.Subject != delivery.InstanceServiceUUID {
		return errors.WithMessage(errors.StatusForbidden, "document token instance identity denied")
	}
	facts, err := delivery.Resolve(ctx, request.RevocationKey, scope[1], "OPEN")
	if err != nil {
		return errors.WithMessage(errors.StatusForbidden, "document token admission unavailable")
	}
	user, err := commonauth.ResolveNativeOIDCUser(ctx, facts.OIDCIssuer, facts.OIDCSubject)
	if err != nil || user.Uuid != request.UserUuid || user.Login != request.UserLogin ||
		facts.ExpiresAt.Unix() != request.ExpiresAt ||
		(scope[2] == "rw") != (facts.AdmittedMode == "EDIT") {
		return errors.WithMessage(errors.StatusForbidden, "document token differs from original admission")
	}
	humanCtx := commonauth.WithImpersonate(ctx, user)
	read, err := compose.UuidClient().ReadNode(humanCtx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: scope[1]}})
	if err != nil {
		return err
	}
	node := read.GetNode()
	if node == nil || node.Uuid != scope[1] || node.Type != tree.NodeType_LEAF ||
		(scope[2] == "rw" && node.GetStringMeta(common.MetaFlagReadonly) != "") {
		return errors.WithMessage(errors.StatusForbidden, "native document ACL is not writable")
	}
	answer, err := tree.NewNodeVersionerClient(grpc.ResolveConn(ctx, common.ServiceVersionsGRPC)).HeadVersion(humanCtx,
		&tree.HeadVersionRequest{NodeUuid: node.Uuid, VersionId: facts.BaseRevision})
	if err != nil {
		return err
	}
	version := answer.GetVersion()
	if version == nil || version.VersionId != facts.BaseRevision || version.Size < 0 || version.MTime <= 0 ||
		(version.Draft && version.OwnerUuid != user.Uuid) || (scope[2] == "rw" && (!version.IsHead || !version.MatchesCurrentNode(node))) {
		return errors.WithMessage(errors.StatusForbidden, "native document version is not the admitted version")
	}
	return nil
}
