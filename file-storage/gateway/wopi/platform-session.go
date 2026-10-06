package wopi

import (
	"context"
	"errors"
	"net/http"

	"github.com/pydio/cells/v5/common"
	commonauth "github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/auth/protocol"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/proto/tree"
)

type protocolFactsKey struct{}

// Native standalone editor PATs keep their original user/ACL path. Only a PAT
// cryptographically marked by the DOCUMENT producer belongs to Core Session PEP.
func platformSession(r *http.Request, claims claim.Claims, nodeID string) (*http.Request, error) {
	if claims.ProtocolSessionID == "" {
		return r, nil
	}
	ids := r.Header.Values("X-WOPI-SessionId")
	if len(ids) != 1 || ids[0] != claims.ProtocolSessionID || claims.NativeProtocolTokenRef == "" {
		return nil, errors.New("native PAT and protocol session differ")
	}
	delivery, err := protocol.Load(r.Context())
	if err != nil {
		return nil, errors.New("invalid protocol instance delivery")
	}
	operation := "READ"
	if r.Method == http.MethodPost {
		operation = "WRITE"
	}
	facts, err := delivery.Resolve(r.Context(), ids[0], nodeID, operation)
	if err != nil {
		return nil, err
	}
	user, err := commonauth.ResolveNativeOIDCUser(r.Context(), facts.OIDCIssuer, facts.OIDCSubject)
	if err != nil {
		return nil, err
	}
	if claims.Subject != user.Uuid || claims.Name != user.Login ||
		facts.NativeSessionRef == "" || claims.NativeProtocolTokenRef != facts.NativeSessionRef {
		return nil, errors.New("native PAT differs from the admitted human or original token reference")
	}
	return r.WithContext(context.WithValue(r.Context(), protocolFactsKey{}, facts)), nil
}

func sessionFacts(ctx context.Context) *protocol.Facts {
	facts, _ := ctx.Value(protocolFactsKey{}).(*protocol.Facts)
	return facts
}

// Version existence and metadata come from Cells, never a Core query-current
// response, timestamp or a user-controlled query/header. Native draft visibility
// is preserved. A missing version cannot silently fall back to the current file.
func sessionRevision(ctx context.Context, n *tree.Node) (*tree.ContentRevision, error) {
	facts := sessionFacts(ctx)
	if facts == nil {
		return nil, nil
	}
	client := tree.NewNodeVersionerClient(grpc.ResolveConn(ctx, common.ServiceVersionsGRPC))
	answer, err := client.HeadVersion(ctx, &tree.HeadVersionRequest{NodeUuid: n.Uuid, VersionId: facts.BaseRevision})
	if err != nil {
		return nil, err
	}
	version := answer.GetVersion()
	claims, ok := claim.FromContext(ctx)
	if !ok || version == nil || version.VersionId != facts.BaseRevision || version.Size < 0 || version.MTime <= 0 ||
		(version.Draft && version.OwnerUuid != claims.Subject) {
		return nil, errors.New("exact native revision is not readable")
	}
	return version, nil
}
