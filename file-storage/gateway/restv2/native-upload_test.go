package restv2

import (
	"testing"

	"github.com/pydio/cells/v5/common/proto/tree"
)

const (
	testUploadRoot     = "6a1f5c0e-2b3d-4c5e-8f90-1a2b3c4d5e6f"
	testUploadScope    = "0f9e8d7c-6b5a-4433-8211-00ffeeddccbb"
	testUploadResource = "3c2b1a09-8f7e-4d6c-9b5a-493827160504"
)

// A production delivery: write.nativeType is the type of the file node a
// governed promote resolves (deploy/components/file-storage-native-action
// template, isolated-plan writeNativeType), not the binding root Resource type.
func testUploadDelivery() nativeWriteDelivery {
	var delivery nativeWriteDelivery
	delivery.NativeInstanceRef = "cells-native"
	delivery.NativeScopeRef = testUploadScope
	delivery.NativeRootRef = testUploadRoot
	delivery.Write.ActionVersion = 1
	delivery.Write.NativeType = "LEAF"
	return delivery
}

func testUploadRootNode() *tree.Node {
	return &tree.Node{Uuid: testUploadRoot, Path: "kailobinding/kailo-binding", Type: tree.NodeType_COLLECTION}
}

func testResolvedUploadRoot(nativeType string) map[string]interface{} {
	return map[string]interface{}{"resource": map[string]interface{}{
		"resourceId": testUploadResource, "resourceVersion": float64(3), "nativeType": nativeType,
		"nativeRef": testUploadRoot, "nativeInstanceRef": "cells-native", "nativeScopeRef": testUploadScope,
	}}
}

func TestNativeUploadRootSelectorUsesRootNodeType(t *testing.T) {
	delivery := testUploadDelivery()
	selector, ok := nativeUploadRootSelector(delivery, testUploadRootNode())
	if !ok {
		t.Fatal("binding root COLLECTION refused")
	}
	if selector["nativeType"] != "COLLECTION" {
		t.Fatalf("root Resource selector must carry the root node type, got %v", selector["nativeType"])
	}
	if selector["nativeType"] == delivery.Write.NativeType {
		t.Fatal("root Resource selector must not reuse the written file node type")
	}
	if selector["nativeRef"] != testUploadRoot || selector["actionKey"] != "file_storage.write@v2" || selector["actionVersion"] != int64(1) {
		t.Fatalf("unexpected selector %v", selector)
	}
	if _, present := selector["workspaceId"]; present {
		t.Fatal("workspaceId only when delivered")
	}
	delivery.WorkspaceID = testUploadResource
	if selector, _ = nativeUploadRootSelector(delivery, testUploadRootNode()); selector["workspaceId"] != testUploadResource {
		t.Fatal("delivered workspaceId must be forwarded")
	}
}

func TestNativeUploadRootSelectorRefusesNonRoot(t *testing.T) {
	delivery := testUploadDelivery()
	for name, node := range map[string]*tree.Node{
		"missing": nil,
		"other":   {Uuid: testUploadResource, Path: "kailobinding/kailo-binding", Type: tree.NodeType_COLLECTION},
		"leaf":    {Uuid: testUploadRoot, Path: "kailobinding/kailo-binding", Type: tree.NodeType_LEAF},
		"no path": {Uuid: testUploadRoot, Type: tree.NodeType_COLLECTION},
	} {
		if _, ok := nativeUploadRootSelector(delivery, node); ok {
			t.Fatalf("%s root accepted", name)
		}
	}
}

func TestNativeUploadRootResourceMatchesSelector(t *testing.T) {
	delivery := testUploadDelivery()
	selector, _ := nativeUploadRootSelector(delivery, testUploadRootNode())
	resource, ok := nativeUploadRootResource(delivery, selector, testResolvedUploadRoot("COLLECTION"))
	if !ok || resource["resourceId"] != testUploadResource || resource["resourceVersion"] != float64(3) {
		t.Fatalf("root Resource refused: %v %v", resource, ok)
	}
	// The pre-fix lookup asked for write.nativeType, which no binding root is.
	if _, ok := nativeUploadRootResource(delivery, selector, testResolvedUploadRoot("LEAF")); ok {
		t.Fatal("Resource with the file node type accepted as binding root")
	}
	other := testResolvedUploadRoot("COLLECTION")
	other["resource"].(map[string]interface{})["nativeScopeRef"] = testUploadResource
	if _, ok := nativeUploadRootResource(delivery, selector, other); ok {
		t.Fatal("Resource of another native scope accepted")
	}
	if _, ok := nativeUploadRootResource(delivery, selector, map[string]interface{}{}); ok {
		t.Fatal("resolve answer without a Resource accepted")
	}
}
