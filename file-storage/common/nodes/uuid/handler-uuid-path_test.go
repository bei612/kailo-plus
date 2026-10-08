package uuid

import (
	"context"
	"testing"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/proto/tree"
)

func TestExternalPathCarriesSelectedNativeWorkspace(t *testing.T) {
	input := &tree.Node{Uuid: "native-node", Path: "internal/node", AppearsIn: []*tree.WorkspaceRelativePath{
		{WsUuid: "workspace-one", WsSlug: "workspace-one-slug", Path: "folder/file.txt"},
		{WsUuid: "workspace-two", WsSlug: "workspace-two-slug", Path: "different/file.txt"},
	}}
	input.MustSetMeta(common.MetaFlagWorkspaceUuid, "stale-workspace")
	input.MustSetMeta(common.MetaFlagWorkspaceRepoId, "stale-repository")
	input.MustSetMeta(common.MetaFlagWorkspaceSlug, "stale-slug")
	_, output, err := newExternalPathHandler().updateOutputBranch(context.Background(), input, "")
	if err != nil {
		t.Fatal(err)
	}
	if output.Path != "workspace-one-slug/folder/file.txt" ||
		output.GetStringMeta(common.MetaFlagWorkspaceUuid) != "workspace-one" ||
		output.HasMetaKey(common.MetaFlagWorkspaceRepoId) ||
		output.GetStringMeta(common.MetaFlagWorkspaceSlug) != "workspace-one-slug" {
		t.Fatalf("external path and native Workspace identity diverged: %v", output)
	}
	if input.Path != "internal/node" || input.GetStringMeta(common.MetaFlagWorkspaceUuid) != "stale-workspace" ||
		input.GetStringMeta(common.MetaFlagWorkspaceRepoId) != "stale-repository" ||
		input.GetStringMeta(common.MetaFlagWorkspaceSlug) != "stale-slug" {
		t.Fatal("external projection modified the source node")
	}
}

func TestExternalPathDoesNotChooseAnotherWorkspaceForMissingIdentity(t *testing.T) {
	input := &tree.Node{Uuid: "native-node", Path: "internal/node", AppearsIn: []*tree.WorkspaceRelativePath{
		{WsSlug: "workspace-one-slug", Path: "folder"},
		{WsUuid: "workspace-two", WsSlug: "workspace-two-slug", Path: "folder"},
	}}
	_, output, err := newExternalPathHandler().updateOutputBranch(context.Background(), input, "")
	if err != nil {
		t.Fatal(err)
	}
	if output.Path != "workspace-one-slug/folder" || output.GetStringMeta(common.MetaFlagWorkspaceUuid) != "" {
		t.Fatal("missing selected Workspace identity was replaced by another Workspace")
	}
}

func TestExternalPathWithoutAccessibleWorkspaceRemainsEmpty(t *testing.T) {
	input := &tree.Node{Uuid: "native-node", Path: "internal/node"}
	input.MustSetMeta(common.MetaFlagWorkspaceUuid, "stale-workspace")
	input.MustSetMeta(common.MetaFlagWorkspaceRepoId, "stale-repository")
	input.MustSetMeta(common.MetaFlagWorkspaceSlug, "stale-slug")
	_, output, err := newExternalPathHandler().updateOutputBranch(context.Background(), input, "")
	if err != nil {
		t.Fatal(err)
	}
	if output.Path != "" || output.GetStringMeta(common.MetaFlagWorkspaceUuid) != "" ||
		output.HasMetaKey(common.MetaFlagWorkspaceRepoId) ||
		output.GetStringMeta(common.MetaFlagWorkspaceSlug) != "" {
		t.Fatal("an inaccessible node acquired an external Workspace projection")
	}
	if input.GetStringMeta(common.MetaFlagWorkspaceUuid) != "stale-workspace" ||
		input.GetStringMeta(common.MetaFlagWorkspaceRepoId) != "stale-repository" ||
		input.GetStringMeta(common.MetaFlagWorkspaceSlug) != "stale-slug" {
		t.Fatal("clearing the external projection modified the source node")
	}
}
