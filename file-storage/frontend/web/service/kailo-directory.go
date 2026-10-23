package service

import (
	"context"
	"strings"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/proto/tree"
)

// DD-133(4), .design/07 §4.7.4: the root folder of a Kailo Workspace,
// <binding datasource>/<Tenant root>/<Workspace id>, is ensured through the
// original admin router, exactly like `cells admin file mkdir` ensures the
// binding root (reconcile.py), as the system user like the datasource
// maintenance commands: an existing folder is left untouched, a file
// at that path is refused, and the node UUID is read back.
func init() {
	auth.NativeOIDCWorkspaceFolder = ensureKailoWorkspaceFolder
}

func ensureKailoWorkspaceFolder(ctx context.Context, path string) (string, error) {
	parts := strings.Split(path, "/")
	if len(parts) != 3 {
		return "", errors.New("Kailo Workspace folder must be <datasource>/<Tenant root>/<Workspace id>")
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\\\x00\r\n") {
			return "", errors.New("invalid Kailo Workspace folder")
		}
	}
	// The system user, as the native datasource maintenance commands do.
	ctx = context.WithValue(ctx, common.PydioContextUserKey, common.PydioSystemUsername)
	router := compose.PathClientAdmin()
	read := func() (*tree.Node, error) {
		r, err := router.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Path: path}})
		if err != nil {
			return nil, err
		}
		return r.GetNode(), nil
	}
	node, err := read()
	if err != nil {
		if !errors.Is(err, errors.NodeNotFound) && !errors.Is(err, errors.StatusNotFound) {
			return "", err
		}
		if _, err = router.CreateNode(ctx, &tree.CreateNodeRequest{Node: &tree.Node{
			Path: path, Type: tree.NodeType_COLLECTION, MTime: time.Now().Unix(),
		}}); err != nil {
			return "", err
		}
		if node, err = read(); err != nil {
			return "", err
		}
	}
	if node.GetType() != tree.NodeType_COLLECTION || node.GetUuid() == "" {
		return "", errors.New("Kailo Workspace folder path exists and is not a folder")
	}
	return node.GetUuid(), nil
}
