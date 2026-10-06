package wopi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/protocol"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/nodes/models"
	"github.com/pydio/cells/v5/common/proto/tree"
)

// Both original COOL and fixed ONLYOFFICE LOOL markers are compared at the
// actual current head's native second granularity. This is not an atomic CAS.
func timestampConflict(r *http.Request, current time.Time) (bool, error) {
	var marker *time.Time
	for _, name := range []string{"X-COOL-WOPI-Timestamp", "X-LOOL-WOPI-Timestamp"} {
		values := r.Header.Values(name)
		if len(values) > 1 {
			return false, errors.New("ambiguous native modified marker")
		}
		if len(values) == 0 || values[0] == "" {
			continue
		}
		stamp, err := time.Parse(time.RFC3339, values[0])
		if err != nil {
			return false, err
		}
		stamp = stamp.UTC().Truncate(time.Second)
		if marker != nil && !marker.Equal(stamp) {
			return false, errors.New("different native modified markers")
		}
		marker = &stamp
	}
	return marker != nil && !marker.Equal(current.UTC().Truncate(time.Second)), nil
}

func beginSessionWrite(r *http.Request, node *tree.Node) (*protocol.WriteObservation, error) {
	facts := sessionFacts(r.Context())
	if facts == nil {
		return nil, nil
	}
	correlation := r.Header.Values("X-WOPI-CorrelationId")
	editors := r.Header.Values("X-WOPI-Editors")
	if facts.AdmittedMode != "EDIT" || len(correlation) != 1 || correlation[0] == "" ||
		strings.ContainsAny(correlation[0], "\r\n") || len(editors) > 1 {
		return nil, errors.New("incomplete original native write evidence")
	}
	evidence := &protocol.WriteObservation{Phase: "STARTED", CorrelationRef: correlation[0],
		BaseModifiedAt: node.GetModTime().UTC().Truncate(time.Second).Format(time.RFC3339)}
	if len(editors) == 1 {
		evidence.Editors = editors[0]
	}
	delivery, err := protocol.Load(r.Context())
	if err != nil {
		return nil, err
	}
	if _, err = delivery.Report(r.Context(), r.Header.Get("X-WOPI-SessionId"), node.Uuid, *evidence); err != nil {
		return nil, err
	}
	return evidence, nil
}

func finishSessionWrite(r *http.Request, node *tree.Node, evidence *protocol.WriteObservation) (string, error) {
	if evidence == nil {
		return "", nil
	}
	// Cancellation cannot erase an already attempted writer. Only the bounded
	// metadata receipt uses this context; no further file write is permitted.
	ctx := context.WithoutCancel(r.Context())
	delivery, err := protocol.Load(ctx)
	if err != nil {
		return "", err
	}
	return delivery.Report(ctx, r.Header.Get("X-WOPI-SessionId"), node.Uuid, *evidence)
}

// The original writer's accepted ETag/size and native VersionId must agree.
// Neither a changed head nor LastModifiedTime proves this write's revision.
func writtenRevision(ctx context.Context, node *tree.Node, written models.ObjectInfo) (string, error) {
	if written.ETag == "" || written.Size < 0 {
		return "", errors.New("native writer content evidence is absent")
	}
	versioner := tree.NewNodeVersionerClient(grpc.ResolveConn(ctx, common.ServiceVersionsGRPC))
	read, err := client.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: node.Uuid}})
	if err != nil {
		return "", err
	}
	current := read.GetNode()
	if current == nil || current.Uuid != node.Uuid || current.Etag != written.ETag || current.Size != written.Size {
		return "", errors.New("native current content differs from accepted writer")
	}
	stream, err := versioner.ListVersions(ctx, &tree.ListVersionsRequest{Node: current,
		Filters: map[string]string{"draftStatus": "\"published\""}})
	if err != nil {
		return "", err
	}
	var head *tree.ContentRevision
	for {
		answer, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
		version := answer.GetVersion()
		if version == nil {
			return "", errors.New("native version result is absent")
		}
		if !version.IsHead {
			continue
		}
		// CreateVersion deliberately deduplicates same-content writes. The
		// current writer's accepted ETag/size can therefore match a real stored
		// revision created by another HUMAN; that owner is not this write's actor.
		if head != nil || !version.MatchesCurrentNode(current) {
			return "", errors.New("native version does not prove the accepted writer")
		}
		head = version
	}
	if head == nil {
		return "", errors.New("native accepted version is not yet observable")
	}
	return head.VersionId, nil
}
