package service

// DD-164(4)② (.design/07 §4.7.2 `share`, §4.7.4 分享意图): in Kailo mode the
// Cells "share" action is Kailo's. The page posts the folder UUID here with
// the user's Cells session token; the folder is read through the user's own
// UUID router (native ACLs), and only a folder the user can read and write
// is offered (the first Kailo sharer becomes the Resource owner). The
// instance then asks Core for a share intent with its directory client and
// returns {intentId}; the page hands it to the Kailo host with
// KailoEmbed.requestShare. The intent grants nothing: grants are written in
// Kailo (component.share.set) and come back through the member directory.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path"
	"strings"

	"go.uber.org/zap"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	cerrors "github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/telemetry/log"
)

// KailoShareIntentPath is the Cells endpoint of the Kailo share action.
const KailoShareIntentPath = "/auth/kailo/share-intent"

func init() {
	auth.NativeOIDCShareNode = readKailoShareNode
}

// readKailoShareNode reads a node by UUID in the admin tree as the system
// user (like the Workspace folders): existence, type and display name only.
func readKailoShareNode(ctx context.Context, nodeUUID string) (bool, bool, string, error) {
	ctx = context.WithValue(ctx, common.PydioContextUserKey, common.PydioSystemUsername)
	r, err := compose.UuidClient(nodes.AsAdmin()).ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Uuid: nodeUUID}})
	if err != nil {
		if cerrors.Is(err, cerrors.NodeNotFound) || cerrors.Is(err, cerrors.StatusNotFound) {
			return false, false, "", nil
		}
		return false, false, "", err
	}
	n := r.GetNode()
	if n == nil || n.GetUuid() != nodeUUID {
		return false, false, "", nil
	}
	return true, n.GetType() == tree.NodeType_COLLECTION, path.Base(strings.Trim(n.GetPath(), "/")), nil
}

// kailoShareTarget is what the user's own view says about the folder.
type kailoShareTarget struct {
	name        string
	workspaceID string
}

// kailoShareable decides from the node read through the user's router: a
// folder the user can read and write. The Kailo Workspace is the one whose
// native workspace (kailo-ws-<id>) shows it, if any.
func kailoShareable(n *tree.Node) (kailoShareTarget, bool) {
	if n == nil || n.GetType() != tree.NodeType_COLLECTION || n.GetUuid() == "" ||
		n.GetStringMeta(common.MetaFlagReadonly) != "" || n.GetStringMeta(common.MetaFlagWriteOnly) != "" {
		return kailoShareTarget{}, false
	}
	t := kailoShareTarget{}
	for _, in := range n.GetAppearsIn() {
		if in.GetWsScope() == idm.WorkspaceScope_ROOM.String() && strings.HasPrefix(in.GetWsSlug(), auth.NativeOIDCSharePrefix) {
			// Re-sharing a Kailo share root is still the same folder; it never
			// decides the Workspace.
			continue
		}
		if id := auth.NativeOIDCWorkspaceOfSlug(in.GetWsSlug()); id != "" && t.workspaceID == "" {
			t.workspaceID = id
		}
		if t.name == "" {
			if rel := strings.Trim(in.GetPath(), "/"); rel != "" {
				t.name = path.Base(rel)
			} else {
				t.name = in.GetWsLabel()
			}
		}
	}
	if t.name == "" {
		t.name = path.Base(strings.Trim(n.GetPath(), "/"))
	}
	return t, strings.TrimSpace(t.name) != ""
}

func kailoShareError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}

// kailoShareIntent serves POST /auth/kailo/share-intent {"nodeUuid": "..."}.
func kailoShareIntent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if r.Method != http.MethodPost {
		kailoShareError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED")
		return
	}
	claims, ok := claim.FromContext(ctx)
	if !ok || claims.Subject == "" {
		kailoShareError(w, http.StatusUnauthorized, "UNAUTHENTICATED")
		return
	}
	var input struct {
		NodeUUID string `json:"nodeUuid"`
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 4<<10))
	if err != nil || json.Unmarshal(raw, &input) != nil || input.NodeUUID == "" {
		kailoShareError(w, http.StatusBadRequest, "INVALID_PARAMETERS")
		return
	}
	user, err := permissions.SearchUniqueUser(ctx, "", claims.Subject)
	if err != nil || user == nil || user.IsGroup {
		kailoShareError(w, http.StatusUnauthorized, "UNAUTHENTICATED")
		return
	}
	person, ok := auth.NativeOIDCUserIdentity(ctx, user)
	if !ok {
		// Only Kailo accounts can share in Kailo; a local native account cannot.
		kailoShareError(w, http.StatusForbidden, "NOT_A_KAILO_ACCOUNT")
		return
	}
	resp, err := compose.UuidClient().ReadNode(auth.WithImpersonate(ctx, user), &tree.ReadNodeRequest{Node: &tree.Node{Uuid: input.NodeUUID}})
	if err != nil || resp.GetNode() == nil {
		kailoShareError(w, http.StatusNotFound, "NOT_FOUND")
		return
	}
	target, ok := kailoShareable(resp.GetNode())
	if !ok {
		kailoShareError(w, http.StatusForbidden, "SHARE_NOT_ALLOWED")
		return
	}
	created, err := auth.CreateNativeOIDCShareIntent(ctx, auth.NativeOIDCShareIntent{NodeUUID: resp.GetNode().GetUuid(), Name: target.name,
		Issuer: person.Issuer, Subject: person.Subject, WorkspaceID: target.workspaceID})
	if err != nil {
		status, code := http.StatusServiceUnavailable, "UNAVAILABLE"
		var unavailable *auth.NativeOIDCDirectoryUnavailable
		if errors.As(err, &unavailable) && unavailable.Status == http.StatusForbidden {
			status, code = http.StatusForbidden, "SHARE_NOT_ALLOWED"
		}
		log.Logger(ctx).Warn("Kailo share intent not created", zap.Error(err))
		kailoShareError(w, status, code)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]string{"intentId": created.IntentID})
}
