package auth

import (
	"strings"

	"github.com/pydio/cells/v5/common/proto/tree"
)

// NativeAdmittedNode is the single containment rule for a platform-admitted
// Resource (07 §8A, 18): the admitted node is the binding root or lies beneath
// it, and a requested node is the admitted node itself or lies beneath an
// admitted collection. Callers resolve all three nodes through one native
// reader so their paths are comparable; it is not an ACL decision.
func NativeAdmittedNode(root, admitted, node *tree.Node) bool {
	if root.GetUuid() == "" || root.GetPath() == "" || root.GetType() != tree.NodeType_COLLECTION ||
		admitted.GetUuid() == "" || admitted.GetPath() == "" || node.GetUuid() == "" || node.GetPath() == "" {
		return false
	}
	if admitted.GetUuid() != root.GetUuid() && !strings.HasPrefix(admitted.GetPath(), root.GetPath()+"/") {
		return false
	}
	return node.GetUuid() == admitted.GetUuid() ||
		(admitted.GetType() == tree.NodeType_COLLECTION && strings.HasPrefix(node.GetPath(), admitted.GetPath()+"/"))
}
