package userspace

import (
	"context"
	"path"
	"strings"
	"testing"

	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/tree"
)

// workspaceFilters models the path chain of one personal workspace (slug personal-files,
// root personal/kailo-qa-1 in datasource personal): input maps a workspace path to the
// datasource path and records the branch, output does the reverse but only for a branch
// that input already resolved — like WorkspaceRootResolver, which refuses an unresolved one.
func workspaceFilters(slug, root string) (in, out func(context.Context, *tree.Node, string) (context.Context, *tree.Node, error)) {
	type branchKey string
	in = func(ctx context.Context, n *tree.Node, id string) (context.Context, *tree.Node, error) {
		p := strings.Trim(n.GetPath(), "/")
		if p != slug && !strings.HasPrefix(p, slug+"/") {
			return ctx, n, errors.WithMessage(errors.NodeNotFound, "unknown workspace")
		}
		return context.WithValue(ctx, branchKey(id), true), &tree.Node{Path: path.Join(root, strings.TrimPrefix(p, slug))}, nil
	}
	out = func(ctx context.Context, n *tree.Node, id string) (context.Context, *tree.Node, error) {
		if ctx.Value(branchKey(id)) == nil {
			return ctx, n, errors.WithMessage(errors.BranchInfoRootMissing, id)
		}
		return ctx, &tree.Node{Path: path.Join(slug, strings.TrimPrefix(strings.Trim(n.GetPath(), "/"), root))}, nil
	}
	return
}

func TestRecycleTargetResolvesTheSourceWorkspaceRecycleBin(t *testing.T) {
	in, out := workspaceFilters("personal-files", "personal/kailo-qa-1")
	ctx, _, err := in(context.Background(), &tree.Node{Path: "personal-files/report.docx"}, "in")
	if err != nil {
		t.Fatal(err)
	}
	recycle := &tree.Node{Path: "personal/kailo-qa-1/recycle_bin"}
	// The production failure: converting through the unresolved "to" branch.
	if _, _, err := out(ctx, recycle, "to"); !errors.Is(err, errors.BranchInfoRootMissing) {
		t.Fatalf("expected the unresolved to-branch to be refused, got %v", err)
	}
	_, target, err := recycleTarget(ctx, in, out, recycle)
	if err != nil {
		t.Fatalf("recycleTarget: %v", err)
	}
	if target.GetPath() != "personal/kailo-qa-1/recycle_bin" {
		t.Fatalf("target %q", target.GetPath())
	}
}

func TestRecycleTargetRefusesARecycleBinOutsideTheSourceWorkspace(t *testing.T) {
	in, out := workspaceFilters("personal-files", "personal/kailo-qa-1")
	ctx, _, err := in(context.Background(), &tree.Node{Path: "personal-files/report.docx"}, "in")
	if err != nil {
		t.Fatal(err)
	}
	// A recycle bin above the workspace root does not round-trip: refused, not checked elsewhere.
	if _, _, err := recycleTarget(ctx, in, out, &tree.Node{Path: "personal/recycle_bin"}); !errors.Is(err, errors.RecycleNotFound) {
		t.Fatalf("expected RecycleNotFound, got %v", err)
	}
}
