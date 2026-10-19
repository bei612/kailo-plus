package rest

import (
	"testing"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/proto/tree"
)

const (
	testDeleteRoot     = "6a1f5c0e-2b3d-4c5e-8f90-1a2b3c4d5e6f"
	testDeleteScope    = "0f9e8d7c-6b5a-4433-8211-00ffeeddccbb"
	testDeleteResource = "3c2b1a09-8f7e-4d6c-9b5a-493827160504"
)

// A production delivery: delete.nativeType is the native task type of the
// delete ExternalExecution (deploy/components/file-storage-native-action
// template, conformance nativeTaskTypes), not the binding root Resource type.
func testDeleteDelivery() auth.NativeDeleteDelivery {
	var delivery auth.NativeDeleteDelivery
	delivery.NativeInstanceRef = "cells-native"
	delivery.NativeScopeRef = testDeleteScope
	delivery.NativeRootRef = testDeleteRoot
	delivery.Delete.ActionVersion = 1
	delivery.Delete.NativeType = "job"
	return delivery
}

func testDeleteRootNode() *tree.Node {
	return &tree.Node{Uuid: testDeleteRoot, Path: "kailobinding/kailo-binding", Type: tree.NodeType_COLLECTION}
}

func testResolvedRoot(nativeType string) map[string]interface{} {
	return map[string]interface{}{"resource": map[string]interface{}{
		"resourceId": testDeleteResource, "resourceVersion": float64(3), "nativeType": nativeType,
		"nativeRef": testDeleteRoot, "nativeInstanceRef": "cells-native", "nativeScopeRef": testDeleteScope,
	}}
}

func TestNativeDeleteRootSelectorUsesRootNodeType(t *testing.T) {
	delivery := testDeleteDelivery()
	selector, ok := nativeDeleteRootSelector(delivery, testDeleteRootNode())
	if !ok {
		t.Fatal("binding root COLLECTION refused")
	}
	if selector["nativeType"] != "COLLECTION" {
		t.Fatalf("root Resource selector must carry the root node type, got %v", selector["nativeType"])
	}
	if selector["nativeType"] == delivery.Delete.NativeType {
		t.Fatal("root Resource selector must not reuse the delete task native type")
	}
	if selector["nativeRef"] != testDeleteRoot || selector["actionKey"] != "file_storage.delete@v2" || selector["actionVersion"] != int64(1) {
		t.Fatalf("unexpected selector %v", selector)
	}
	if _, present := selector["workspaceId"]; present {
		t.Fatal("workspaceId only when delivered")
	}
	delivery.WorkspaceID = testDeleteResource
	if selector, _ = nativeDeleteRootSelector(delivery, testDeleteRootNode()); selector["workspaceId"] != testDeleteResource {
		t.Fatal("delivered workspaceId must be forwarded")
	}
}

func TestNativeDeleteRootSelectorRefusesNonRoot(t *testing.T) {
	delivery := testDeleteDelivery()
	for name, node := range map[string]*tree.Node{
		"missing": nil,
		"other":   {Uuid: testDeleteResource, Path: "kailobinding/kailo-binding", Type: tree.NodeType_COLLECTION},
		"leaf":    {Uuid: testDeleteRoot, Path: "kailobinding/kailo-binding", Type: tree.NodeType_LEAF},
		"no path": {Uuid: testDeleteRoot, Type: tree.NodeType_COLLECTION},
	} {
		if _, ok := nativeDeleteRootSelector(delivery, node); ok {
			t.Fatalf("%s root accepted", name)
		}
	}
}

func TestNativeDeleteRootResourceMatchesSelector(t *testing.T) {
	delivery := testDeleteDelivery()
	selector, _ := nativeDeleteRootSelector(delivery, testDeleteRootNode())
	id, version, ok := nativeDeleteRootResource(delivery, selector, testResolvedRoot("COLLECTION"))
	if !ok || id != testDeleteResource || version != 3 {
		t.Fatalf("root Resource refused: %v %v %v", id, version, ok)
	}
	// The pre-fix comparison against delete.nativeType accepted only a
	// Resource typed "job", which no binding root is.
	if _, _, ok := nativeDeleteRootResource(delivery, selector, testResolvedRoot("job")); ok {
		t.Fatal("Resource with the task native type accepted as binding root")
	}
	other := testResolvedRoot("COLLECTION")
	other["resource"].(map[string]interface{})["nativeScopeRef"] = testDeleteResource
	if _, _, ok := nativeDeleteRootResource(delivery, selector, other); ok {
		t.Fatal("Resource of another native scope accepted")
	}
	extra := testResolvedRoot("COLLECTION")
	extra["other"] = true
	if _, _, ok := nativeDeleteRootResource(delivery, selector, extra); ok {
		t.Fatal("resolve answer with extra members accepted")
	}
	fractional := testResolvedRoot("COLLECTION")
	fractional["resource"].(map[string]interface{})["resourceVersion"] = 1.5
	if _, _, ok := nativeDeleteRootResource(delivery, selector, fractional); ok {
		t.Fatal("non-integral Resource version accepted")
	}
}
