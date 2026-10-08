package restv2

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/config/routing"
	"github.com/pydio/cells/v5/common/middleware/authorizations"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/tree"
	. "github.com/smartystreets/goconvey/convey"
)

func TestNativeActorUsesExactControlledUser(t *testing.T) {
	const tenant = "00000000-0000-4000-8000-000000000001"
	const human = "00000000-0000-4000-8000-000000000002"
	const agent = "00000000-0000-4000-8000-000000000003"
	const humanUser = "00000000-0000-4000-8000-000000000004"
	const agentUser = "00000000-0000-4000-8000-000000000005"
	const service = "00000000-0000-4000-8000-000000000006"
	var delivery nativeActorDelivery
	if err := json.Unmarshal([]byte(`{"tenantId":"`+tenant+`","bindingId":"`+service+`","instanceServiceUuid":"`+service+`",
		"nativeInstanceRef":"fixture-instance","nativeScopeRef":"`+human+`","nativeRootRef":"`+agent+`",
		"actors":[{"principalId":"`+human+`","kind":"HUMAN","userUuid":"`+humanUser+`"},
		{"principalId":"`+agent+`","kind":"AGENT","userUuid":"`+agentUser+`"}]}`), &delivery); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"human", "agent", "foreign-tenant", "wrong-kind", "initiating-human", "shared-native-user", "duplicate-principal", "service-user", "unknown-kind", "missing-user", "missing-scope"} {
		t.Run(scenario, func(t *testing.T) {
			// Deep-copy the private delivery, not a second identity registry.
			data, _ := json.Marshal(delivery)
			var current nativeActorDelivery
			_ = json.Unmarshal(data, &current)
			tenantID, principal, kind, expected := tenant, agent, "AGENT", agentUser
			switch scenario {
			case "human":
				principal, kind, expected = human, "HUMAN", humanUser
			case "foreign-tenant":
				tenantID = service
			case "wrong-kind":
				kind = "HUMAN"
			case "initiating-human":
				principal = human
			case "shared-native-user":
				current.Actors[1].UserUUID = humanUser
			case "duplicate-principal":
				current.Actors[1].PrincipalID = human
			case "service-user":
				current.Actors[1].UserUUID = service
			case "unknown-kind":
				current.Actors[1].Kind = "SERVICE"
			case "missing-user":
				current.Actors[1].UserUUID = ""
			case "missing-scope":
				current.NativeScopeRef = ""
			}
			user, err := current.user(tenantID, principal, kind)
			if scenario == "human" || scenario == "agent" {
				if err != nil || user != expected {
					t.Fatalf("exact actor mapping refused: %v", err)
				}
			} else if err == nil || user != "" {
				t.Fatalf("ambiguous/foreign actor mapped to native user %q", user)
			}
		})
	}
}

func TestNativeIndependentReadDoesNotImpersonate(t *testing.T) {
	request := httptest.NewRequest("GET", "/n/node/native", nil)
	response := httptest.NewRecorder()
	ctx := request.Context()
	if err := (&Handler{}).nativeActor(restful.NewRequest(request), restful.NewResponse(response), "native", "node"); err != nil {
		t.Fatal(err)
	}
	if request.Context() != ctx || response.Header().Get("X-Kailo-Native-Actor") != "" {
		t.Fatal("independent native request acquired a platform identity")
	}
}

func TestNativeActorPolicyDoesNotBorrowTransportProfile(t *testing.T) {
	serviceCtx := claim.ToContext(context.Background(), claim.Claims{Subject: "transport-service", Name: "transport-service",
		Roles: "transport-role", Profile: common.PydioProfileAdmin})
	nativeUser := &idm.User{Uuid: "existing-native-actor", Login: "native-actor", Roles: []*idm.Role{{Uuid: "native-role"}},
		Attributes: map[string]string{idm.UserAttrProfile: common.PydioProfileStandard}}
	request := httptest.NewRequest("GET", "/n/node/existing-native-node", nil)
	request = request.WithContext(auth.WithImpersonate(serviceCtx, nativeUser))
	// The original route registrar supplies the resolved URI consumed by native
	// policy production; bypassing it would not model an actual native request.
	if _, exists := routing.RouteById(common.RouteApiRESTv2); !exists {
		routing.RegisterRoute(common.RouteApiRESTv2, "REST API v2 Endpoint", common.DefaultRouteRESTv2)
	}
	registrar := routing.NewRouteRegistrar()
	registrar.Route(common.RouteApiRESTv2).Handle("/n/", http.HandlerFunc(func(_ http.ResponseWriter, actual *http.Request) {
		policy := authorizations.HTTPPolicyRequest(actual)
		if !reflect.DeepEqual(policy.Subjects, []string{permissions.PolicySubjectLoginPrefix + nativeUser.Login,
			permissions.PolicySubjectUuidPrefix + nativeUser.Uuid, permissions.PolicySubjectProfilePrefix + common.PydioProfileStandard,
			permissions.PolicySubjectRolePrefix + "native-role"}) || policy.Action != "GET" || policy.Resource != "rest:"+actual.RequestURI {
			t.Fatalf("native API policy reused transport claims: %v", policy)
		}
	}))
	registrar.IteratePatterns(request.Context(), func(_ string, handler http.Handler) {
		handler.ServeHTTP(httptest.NewRecorder(), request)
	})
}

func TestTreeNodeToNode_WithEditorURLs(t *testing.T) {
	Convey("Test TreeNodeToNode with EditorURL options", t, func() {
		ctx := context.Background()
		h := &Handler{}

		testNode := &tree.Node{
			Uuid: "test-uuid-123",
			Path: "test/document.docx",
			Type: tree.NodeType_LEAF,
			Size: 1024,
		}

		mockProvider := &mockEditorProvider{
			supportedExt: []string{"docx"},
			shouldError:  false,
		}

		Convey("Without EditorURLGenerate flag", func() {
			opts := []TNOption{
				WithEditorProvider("test-editor", mockProvider),
			}

			rn := h.TreeNodeToNode(ctx, testNode, opts...)
			So(rn, ShouldNotBeNil)
			So(rn.Uuid, ShouldEqual, "test-uuid-123")
			So(rn.EditorURLsKeys, ShouldNotBeNil)
			So(len(rn.EditorURLsKeys), ShouldEqual, 1)
			So(rn.EditorURLsKeys[0], ShouldEqual, "test-editor")
			// URLs should not be generated
			So(rn.EditorURLs, ShouldNotBeNil)
			So(len(rn.EditorURLs), ShouldEqual, 0)
		})

		Convey("With EditorURLGenerate flag", func() {
			opts := []TNOption{
				WithEditorProvider("test-editor", mockProvider),
				WithEditorURLGenerate(),
			}

			rn := h.TreeNodeToNode(ctx, testNode, opts...)
			So(rn, ShouldNotBeNil)
			So(rn.Uuid, ShouldEqual, "test-uuid-123")
			So(rn.EditorURLsKeys, ShouldNotBeNil)
			So(len(rn.EditorURLsKeys), ShouldEqual, 1)
			So(rn.EditorURLsKeys[0], ShouldEqual, "test-editor")
			// URLs should be generated
			So(rn.EditorURLs, ShouldNotBeNil)
			So(len(rn.EditorURLs), ShouldEqual, 1)
			So(rn.EditorURLs["test-editor"], ShouldNotBeNil)
			So(rn.EditorURLs["test-editor"].Url, ShouldContainSubstring, "test-uuid-123")
		})

		Convey("With unsupported file extension", func() {
			pdfNode := &tree.Node{
				Uuid: "test-uuid-456",
				Path: "test/document.pdf",
				Type: tree.NodeType_LEAF,
			}

			opts := []TNOption{
				WithEditorProvider("test-editor", mockProvider),
				WithEditorURLGenerate(),
			}

			rn := h.TreeNodeToNode(ctx, pdfNode, opts...)
			So(rn, ShouldNotBeNil)
			So(len(rn.EditorURLsKeys), ShouldEqual, 0)
			So(len(rn.EditorURLs), ShouldEqual, 0)
		})

		Convey("With multiple editor providers", func() {
			mockProvider2 := &mockEditorProvider{
				supportedExt: []string{"xlsx"},
				shouldError:  false,
			}

			xlsxNode := &tree.Node{
				Uuid: "test-uuid-789",
				Path: "test/spreadsheet.xlsx",
				Type: tree.NodeType_LEAF,
			}

			opts := []TNOption{
				WithEditorProvider("editor1", mockProvider),
				WithEditorProvider("editor2", mockProvider2),
				WithEditorURLGenerate(),
			}

			rn := h.TreeNodeToNode(ctx, xlsxNode, opts...)
			So(rn, ShouldNotBeNil)
			So(len(rn.EditorURLsKeys), ShouldEqual, 1)
			So(rn.EditorURLsKeys[0], ShouldEqual, "editor2")
			So(len(rn.EditorURLs), ShouldEqual, 1)
			So(rn.EditorURLs["editor2"], ShouldNotBeNil)
		})

		Convey("With provider that errors on Get", func() {
			errorProvider := &mockEditorProvider{
				supportedExt: []string{"docx"},
				shouldError:  true,
			}

			opts := []TNOption{
				WithEditorProvider("error-editor", errorProvider),
				WithEditorURLGenerate(),
			}

			rn := h.TreeNodeToNode(ctx, testNode, opts...)
			So(rn, ShouldNotBeNil)
			So(len(rn.EditorURLsKeys), ShouldEqual, 1)
			So(rn.EditorURLsKeys[0], ShouldEqual, "error-editor")
			// URL should not be added due to error
			So(len(rn.EditorURLs), ShouldEqual, 0)
		})

		Convey("With case-insensitive extension matching", func() {
			upperCaseNode := &tree.Node{
				Uuid: "test-uuid-case",
				Path: "test/document.DOCX",
				Type: tree.NodeType_LEAF,
			}

			opts := []TNOption{
				WithEditorProvider("test-editor", mockProvider),
				WithEditorURLGenerate(),
			}

			rn := h.TreeNodeToNode(ctx, upperCaseNode, opts...)
			So(rn, ShouldNotBeNil)
			// TreeNodeToNode uses strings.ToLower(path.Ext(n.Path)) so .DOCX should match
			So(len(rn.EditorURLsKeys), ShouldEqual, 1)
		})

		Convey("With both PreSigner and EditorURL options", func() {
			mockSigner := &mockPreSigner{}
			opts := []TNOption{
				WithPreSigner(mockSigner),
				WithEditorProvider("test-editor", mockProvider),
				WithEditorURLGenerate(),
			}

			rn := h.TreeNodeToNode(ctx, testNode, opts...)
			So(rn, ShouldNotBeNil)
			So(rn.PreSignedGET, ShouldNotBeNil)
			So(len(rn.EditorURLsKeys), ShouldEqual, 1)
			So(len(rn.EditorURLs), ShouldEqual, 1)
		})
	})
}
