package rest

import (
	"context"
	"fmt"
	"github.com/pborman/uuid"
	"time"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common"
	commonauth "github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/auth/protocol"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/proto/auth"
	"github.com/pydio/cells/v5/common/proto/rest"
	"github.com/pydio/cells/v5/common/proto/tree"
)

// ClientID is the existing native document API's Session slot. Standalone Cells
// callers omit it and retain their native user/ACL path; a platform caller must
// be the configured instance service, not a browser claiming another identity.
func (a *TokenHandler) generatePlatformDocumentToken(ctx context.Context, sessionID string, node *tree.Node,
	claims claim.Claims, req *restful.Request, resp *restful.Response) error {
	id := uuid.Parse(sessionID)
	if id == nil || id.String() != sessionID || node == nil || node.Type != tree.NodeType_LEAF || node.GetUuid() == "" {
		return errors.WithMessage(errors.InvalidParameters, "invalid native document session target")
	}
	delivery, err := protocol.Load(ctx)
	if err != nil || claims.Subject != delivery.InstanceServiceUUID {
		return errors.WithMessage(errors.StatusForbidden, "document session instance identity denied")
	}
	facts, err := delivery.Resolve(ctx, sessionID, node.GetUuid(), "OPEN")
	if err != nil {
		return errors.WithMessage(errors.StatusForbidden, "document session admission unavailable")
	}
	user, err := commonauth.ResolveNativeOIDCUser(ctx, facts.OIDCIssuer, facts.OIDCSubject)
	if err != nil {
		return errors.WithMessage(errors.StatusForbidden, "native HUMAN projection unavailable")
	}
	// The authenticated instance only asks for token creation. Native document
	// ACL and draft access use the explicitly linked, verified HUMAN's actual
	// current native roles; no service roles or caller-supplied claims are copied.
	humanCtx := commonauth.WithImpersonate(ctx, user)
	read, err := compose.UuidClient().ReadNode(humanCtx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: node.GetUuid()}})
	if err != nil {
		return err
	}
	node = read.GetNode()
	if node == nil || node.Type != tree.NodeType_LEAF || node.GetUuid() == "" {
		return errors.WithMessage(errors.StatusForbidden, "native HUMAN document read denied")
	}
	versioner := tree.NewNodeVersionerClient(grpc.ResolveConn(ctx, common.ServiceVersionsGRPC))
	answer, err := versioner.HeadVersion(humanCtx, &tree.HeadVersionRequest{NodeUuid: node.GetUuid(), VersionId: facts.BaseRevision})
	if err != nil {
		return err
	}
	version := answer.GetVersion()
	// Existence is proven by the native version service, never by a Core head
	// query. The projected HUMAN's original native draft visibility is retained.
	if version == nil || version.VersionId != facts.BaseRevision || version.Size < 0 || version.MTime <= 0 ||
		(version.Draft && version.OwnerUuid != user.Uuid) ||
		(facts.AdmittedMode == "EDIT" && (!version.IsHead || !version.MatchesCurrentNode(node) ||
			node.GetStringMeta(common.MetaFlagReadonly) != "")) {
		return errors.WithMessage(errors.StatusForbidden, "exact native document revision is not available in the admitted mode")
	}
	permission := "r"
	if facts.AdmittedMode == "EDIT" {
		permission = "rw"
	}
	// The native PAT owns the secret and revocation. UUID uniqueness fences a
	// repeated creation for this Session. Lost ACKs must observe that original
	// record, not generate another PAT or recover the secret from a second store.
	generated, err := auth.NewPersonalAccessTokenServiceClient(grpc.ResolveConn(ctx, common.ServiceTokenGRPC)).Generate(ctx,
		&auth.PatGenerateRequest{Type: auth.PatType_DOCUMENT, UserUuid: user.Uuid,
			UserLogin: user.Login, Label: "Platform document session " + sessionID,
			AutoRefreshWindow: 0, ExpiresAt: facts.ExpiresAt.Unix(), RevocationKey: sessionID, CacheKey: sessionID,
			Scopes: []string{fmt.Sprintf("node:%s:%s", node.GetUuid(), permission)}})
	if err != nil {
		return err
	}
	if generated.TokenUuid != sessionID || generated.AccessToken == "" || !facts.ExpiresAt.After(time.Now()) {
		return errors.WithMessage(errors.StatusInternalServerError, "native document token outcome requires reconciliation")
	}
	// This header exposes only the confirmed original PAT reference; the secret
	// remains solely in the existing response's access token for the launch POST.
	resp.Header().Set("X-Kailo-Native-Session-Ref", generated.TokenUuid)
	return resp.WriteEntity(&rest.DocumentAccessTokenResponse{AccessToken: generated.AccessToken})
}
