package tree

// MatchesCurrentNode binds a real stored revision to the node read by native
// ACL. ETag/size prove content equality, not which VersionId is newest: callers
// must separately require the original native version store's head reference.
// MTime is deliberately not an identity substitute (same-content writes are
// deduplicated by the original CreateVersion producer).
func (cr *ContentRevision) MatchesCurrentNode(node *Node) bool {
	return cr != nil && node != nil && node.Type == NodeType_LEAF && cr.VersionId != "" && !cr.Draft &&
		cr.ETag != "" && cr.ETag == node.Etag && cr.Size >= 0 && cr.Size == node.Size
}
