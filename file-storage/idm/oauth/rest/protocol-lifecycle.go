package rest

import (
	"context"
	"fmt"
	"time"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/auth/protocol"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/auth"
	"github.com/pydio/cells/v5/common/service"
)

func init() {
	// The original TokenHandler/WithWeb registration retains native JWT and
	// policy middleware. These routes expose only original PAT metadata and
	// revocation, never a second store or a replacement launch secret.
	service.RegisterSwaggerJSON(`{"swagger":"2.0","paths":{
	  "/auth/token/document/{SessionID}/{NodeID}":{
	    "parameters":[{"name":"SessionID","in":"path","required":true,"type":"string"},{"name":"NodeID","in":"path","required":true,"type":"string"}],
	    "get":{"tags":["TokenService"],"operationId":"ObserveProtocolDocument","responses":{"200":{"description":"Original document PAT metadata"}}},
	    "delete":{"tags":["TokenService"],"operationId":"RevokeProtocolDocument","responses":{"200":{"description":"Original document PAT absence confirmed"}}}
	  }
	}}`)
}

type protocolPATObservation struct {
	ProtocolSessionID string     `json:"protocolSessionId"`
	NativeObjectRef   string     `json:"nativeObjectRef"`
	NativeState       string     `json:"nativeState"`
	NativeSessionRef  string     `json:"nativeSessionRef,omitempty"`
	ExpiresAt         *time.Time `json:"expiresAt,omitempty"`
}

func documentLifecycle(ctx context.Context, sessionID, nodeID, operation string) (*protocol.LifecycleFacts, error) {
	delivery, err := protocol.Load(ctx)
	claims, ok := claim.FromContext(ctx)
	if err != nil || !ok || claims.Subject != delivery.InstanceServiceUUID {
		return nil, errors.WithMessage(errors.StatusForbidden, "document token instance identity denied")
	}
	facts, err := delivery.Lifecycle(ctx, sessionID, nodeID, operation)
	if err != nil {
		return nil, errors.WithMessage(errors.StatusForbidden, "document token lifecycle admission unavailable")
	}
	return facts, nil
}

func originalDocumentPAT(ctx context.Context, facts *protocol.LifecycleFacts) (*protocolPATObservation, error) {
	answer, err := auth.NewPersonalAccessTokenServiceClient(grpc.ResolveConn(ctx, common.ServiceTokenGRPC)).List(ctx,
		&auth.PatListRequest{Type: auth.PatType_DOCUMENT})
	if err != nil {
		return nil, err // Unavailable is not an absent PAT.
	}
	if answer == nil {
		return nil, errors.WithStack(errors.StatusInternalServerError)
	}
	observation := &protocolPATObservation{ProtocolSessionID: facts.ProtocolSessionID,
		NativeObjectRef: facts.NativeObjectRef, NativeState: "ABSENT"}
	var found bool
	for _, token := range answer.Tokens {
		if token == nil || token.Uuid != facts.ProtocolSessionID {
			continue
		}
		permission := "r"
		if facts.RequestedMode == "EDIT" {
			permission = "rw"
		}
		if found || token.Type != auth.PatType_DOCUMENT || token.RevocationKey != facts.ProtocolSessionID ||
			token.CacheKey != facts.ProtocolSessionID || token.AutoRefreshWindow != 0 || token.UserUuid == "" ||
			token.ExpiresAt != facts.ExpiresAt.Unix() || len(token.Scopes) != 1 ||
			token.Scopes[0] != fmt.Sprintf("node:%s:%s", facts.NativeObjectRef, permission) {
			return nil, errors.WithMessage(errors.StatusForbidden, "original document token reference differs")
		}
		found = true
		expires := time.Unix(token.ExpiresAt, 0).UTC()
		observation.NativeSessionRef = token.Uuid
		observation.ExpiresAt = &expires
		observation.NativeState = "ACTIVE"
		if !expires.After(time.Now()) {
			observation.NativeState = "EXPIRED"
		}
	}
	return observation, nil
}

func (a *TokenHandler) ObserveProtocolDocument(req *restful.Request, resp *restful.Response) error {
	ctx := req.Request.Context()
	facts, err := documentLifecycle(ctx, req.PathParameter("SessionID"), req.PathParameter("NodeID"), "TOKEN_OBSERVE")
	if err != nil {
		return err
	}
	observation, err := originalDocumentPAT(ctx, facts)
	if err != nil {
		return err
	}
	resp.Header().Set("Cache-Control", "no-store")
	return resp.WriteEntity(observation)
}

func (a *TokenHandler) RevokeProtocolDocument(req *restful.Request, resp *restful.Response) error {
	ctx := req.Request.Context()
	facts, err := documentLifecycle(ctx, req.PathParameter("SessionID"), req.PathParameter("NodeID"), "TOKEN_REVOKE")
	if err != nil {
		return err
	}
	observation, err := originalDocumentPAT(ctx, facts)
	if err != nil {
		return err
	}
	if observation.NativeState != "ABSENT" {
		answer, err := auth.NewPersonalAccessTokenServiceClient(grpc.ResolveConn(ctx, common.ServiceTokenGRPC)).Revoke(ctx,
			&auth.PatRevokeRequest{Uuid: facts.ProtocolSessionID, ByRevocationKey: facts.ProtocolSessionID})
		if err != nil {
			return err
		}
		if answer == nil || !answer.Success {
			return errors.WithStack(errors.StatusInternalServerError)
		}
	}
	// Native absence is the terminal evidence. A lost DELETE ACK can re-check
	// this same original record; it never repeats a file write or mints a PAT.
	observation, err = originalDocumentPAT(ctx, facts)
	if err != nil || observation == nil || observation.NativeState != "ABSENT" {
		return errors.WithMessage(errors.StatusInternalServerError, "document token revocation requires reconciliation")
	}
	resp.Header().Set("Cache-Control", "no-store")
	return resp.WriteEntity(observation)
}
