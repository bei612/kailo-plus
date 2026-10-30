package service

// DD-164(3) owner semantics (design 1c803580): the creator of a folder or
// file under a Kailo Workspace root keeps editing, deleting and sharing it
// even with the read-only Workspace role. Cells has no node owner metadata,
// so the creation is recorded here, from the native tree events, as a
// read+write node ACL of the creator's own account role
// (auth.RecordNativeOIDCOwner). Only Kailo accounts and nodes strictly below
// a Workspace root of the applied member directory are recorded.

import (
	"context"

	"go.uber.org/zap"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/broker"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/telemetry/log"
	"github.com/pydio/cells/v5/common/utils/propagator"
)

const kailoOwnerBacklog = 1024

// kailoOwnerCreation is what one native create event says, or ok=false.
func kailoOwnerCreation(ctx context.Context, event *tree.NodeChangeEvent) (login, nodeUUID, nodePath string, ok bool) {
	t := event.GetTarget()
	if event.GetType() != tree.NodeChangeEvent_CREATE || t == nil || t.GetUuid() == "" || t.HasMetaKey(common.MetaNamespaceDatasourceInternal) {
		return "", "", "", false
	}
	login, found := propagator.CanonicalMeta(ctx, common.PydioContextUserKey)
	if !found || login == "" || login == common.PydioSystemUsername {
		return "", "", "", false
	}
	return login, t.GetUuid(), t.GetPath(), true
}

// startKailoOwners subscribes the native tree changes when the member
// directory is delivered (Kailo Workspaces exist only then).
func startKailoOwners(ctx context.Context) error {
	if cfg, err := auth.NativeOIDCShareIntentDirectory(); err != nil || cfg == nil {
		return nil
	}
	work := make(chan func(context.Context), kailoOwnerBacklog)
	err := broker.SubscribeCancellable(ctx, common.TopicTreeChanges, func(ctx context.Context, msg broker.Message) error {
		event := &tree.NodeChangeEvent{}
		ctx, err := msg.Unmarshal(ctx, event)
		if err != nil {
			return nil
		}
		login, nodeUUID, nodePath, ok := kailoOwnerCreation(ctx, event)
		if !ok || auth.NativeOIDCOwnerTarget(nodePath) == "" {
			return nil
		}
		select {
		case work <- func(ctx context.Context) { recordKailoOwner(ctx, login, nodeUUID) }:
		default:
			log.Logger(ctx).Warn("Kailo owner records backlog full; a creation was not recorded")
		}
		return nil
	}, broker.WithCounterName("kailo-owner"))
	if err != nil {
		log.Logger(ctx).Warn("Kailo owner records unavailable", zap.Error(err))
		return nil
	}
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case f := <-work:
				f(ctx)
			}
		}
	}()
	return nil
}

func recordKailoOwner(ctx context.Context, login, nodeUUID string) {
	user, err := permissions.SearchUniqueUser(ctx, login, "")
	if err != nil || user == nil {
		return
	}
	if err := auth.RecordNativeOIDCOwner(ctx, user, nodeUUID); err != nil {
		log.Logger(ctx).Warn("Kailo owner record not written", zap.Error(err))
	}
}
