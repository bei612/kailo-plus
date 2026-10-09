/*
 * Copyright (c) 2019-2021. Abstrium SAS <team (at) pydio.com>
 * This file is part of Pydio Cells.
 *
 * Pydio Cells is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Pydio Cells is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Pydio Cells.  If not, see <http://www.gnu.org/licenses/>.
 *
 * The latest code can be found at <https://pydio.com>.
 */

package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kylelemons/godebug/pretty"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cache_helper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"gopkg.in/yaml.v2"
)

type nativeActorUserRead struct {
	idm.UnimplementedUserServiceServer
	user *idm.User
	err  error
	t    *testing.T
}

func (s *nativeActorUserRead) SearchOne(_ context.Context, request *idm.SearchUserRequest) (*idm.SearchUserResponse, error) {
	if len(request.GetQuery().GetSubQueries()) != 1 {
		s.t.Fatal("native user lookup is not exact")
	}
	query := new(idm.UserSingleQuery)
	if err := request.Query.SubQueries[0].UnmarshalTo(query); err != nil || query.Uuid != "00000000-0000-4000-8000-000000000001" ||
		query.NodeType != idm.NodeType_USER || query.Login != "" {
		s.t.Fatalf("native user lookup used a fallback: %v %v", query, err)
	}
	return &idm.SearchUserResponse{User: s.user}, s.err
}

func TestResolveNativeActorUserRejectsMissingChangedAndLockedUsers(t *testing.T) {
	const id = "00000000-0000-4000-8000-000000000001"
	for _, scenario := range []string{"missing", "wrong-uuid", "missing-login", "group", "hidden", "locked", "rpc-unavailable"} {
		t.Run(scenario, func(t *testing.T) {
			s := &nativeActorUserRead{t: t, user: &idm.User{Uuid: id, Login: "native-user"}}
			switch scenario {
			case "missing":
				s.user = nil
			case "wrong-uuid":
				s.user.Uuid = "another-user"
			case "missing-login":
				s.user.Login = ""
			case "group":
				s.user.IsGroup = true
			case "hidden":
				s.user.Attributes = map[string]string{idm.UserAttrHidden: "true"}
			case "locked":
				s.user.Attributes = map[string]string{"locks": `["logout"]`}
			case "rpc-unavailable":
				s.err = errors.New("native user service unavailable")
			}
			grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: s})
			user, err := ResolveNativeUser(context.Background(), id)
			if err == nil || user != nil {
				t.Fatalf("unconfirmed/locked native actor was resolved: %v", user)
			}
		})
	}
}

type nativeReadOIDCPolicy struct {
	idm.UnimplementedPolicyEngineServiceServer
}

func (*nativeReadOIDCPolicy) StreamPolicyGroups(_ *idm.ListPolicyGroupsRequest, stream idm.PolicyEngineService_StreamPolicyGroupsServer) error {
	return stream.Send(&idm.PolicyGroup{Policies: []*idm.Policy{{ID: "native-read-login", Subjects: []string{"subject:00000000-0000-4000-8000-000000000001"}, Resources: []string{"oidc"}, Actions: []string{"login"}, Effect: idm.PolicyEffect_allow}}})
}

func TestNativeReadAuthorityConsumesExactActorAndOriginalOperation(t *testing.T) {
	cache_helper.SetStaticResolver("pm://", &gocache.URLOpener{})
	nativeUser := "00000000-0000-4000-8000-000000000001"
	serviceUser := "00000000-0000-4000-8000-000000000002"
	principal := "00000000-0000-4000-8000-000000000003"
	targetID := "00000000-0000-4000-8000-000000000004"
	nodeID := "00000000-0000-4000-8000-000000000005"
	key := "00000000-0000-4000-8000-000000000006"
	ee := "00000000-0000-4000-8000-000000000007"
	for _, scenario := range []string{"HUMAN", "AGENT", "service-observe", "service-extract", "missing-job", "missing-meter-map", "locked", "unavailable", "foreign-native-user", "SERVICE-as-GET", "HUMAN-as-observer", "wrong-key", "wrong-version", "range", "unsigned-EE", "wrong-actor", "wrong-tenant", "wrong-native-scope", "PEP-denied"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := config.WithStubStore(context.Background())
			user := &nativeActorUserRead{t: t, user: &idm.User{Uuid: nativeUser, Login: "native-user"}}
			if scenario == "locked" {
				user.user.Attributes = map[string]string{"locks": `["logout"]`}
			}
			if scenario == "unavailable" {
				user.err = errors.New("native user unavailable")
			}
			grpcclient.RegisterMock(common.ServiceUserGRPC, &idm.UserServiceStub{UserServiceServer: user})
			grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &nativeReadOIDCPolicy{}})
			claims := map[string]interface{}{"tenant_id": targetID, "actor_principal_id": principal, "initiating_human_principal_id": principal, "action_key": "file_storage.read@v1", "target_type": "RESOURCE", "target_id": targetID, "operation_id": key, "action_execution_id": ee, "result_exposure_policy_id": key, "external_execution_id": ee, "idempotency_key": key}
			kind := "HUMAN"
			if scenario == "AGENT" {
				kind = "AGENT"
				claims["agent_principal_id"] = principal
				claims["initiating_human_principal_id"] = targetID
				claims["delegation_id"] = key
				claims["delegation_version"] = float64(1)
			}
			if scenario == "wrong-actor" {
				claims["actor_principal_id"] = serviceUser
			}
			if scenario == "wrong-tenant" {
				claims["tenant_id"] = serviceUser
			}
			if scenario == "unsigned-EE" {
				delete(claims, "external_execution_id")
			}
			target := map[string]interface{}{"resourceId": targetID, "nativeType": "folder", "nativeRef": targetID, "nativeInstanceRef": "native-instance", "nativeScopeRef": nodeID}
			if scenario == "wrong-native-scope" {
				target["nativeScopeRef"] = serviceUser
			}
			pep := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "native-test-service", "token_type": "Bearer", "expires_in": 60})
					return
				}
				if scenario == "PEP-denied" {
					w.WriteHeader(403)
					return
				}
				if r.URL.Path != "/service/v1/adapter/pep_check" || r.Header.Get("Authorization") != "Bearer native-test-service" {
					t.Error("original binding PEP callback not consumed")
					w.WriteHeader(403)
					return
				}
				value := map[string]interface{}{"actionExecutionId": ee, "operationId": key, "authorizationMinZedToken": "fresh"}
				if scenario != "service-observe" && scenario != "service-extract" && scenario != "HUMAN-as-observer" {
					value["targetResource"] = target
				}
				json.NewEncoder(w).Encode(value)
			}))
			defer pep.Close()
			secret := filepath.Join(t.TempDir(), "native-secret")
			if err := os.WriteFile(secret, []byte("controlled-test-secret"), 0600); err != nil {
				t.Fatal(err)
			}
			delivery := map[string]interface{}{"bindingId": key, "tenantId": targetID, "nativeInstanceRef": "native-instance", "nativeScopeRef": nodeID, "nativeRootRef": targetID,
				"instanceServiceUuid": serviceUser, "corePepUrl": pep.URL + "/service/v1/adapter/pep_check", "oidcTokenUrl": pep.URL + "/token", "clientId": "native-binding", "clientSecretFile": secret, "clientSecretMaxBytes": 256, "maxResponseBytes": 65536, "requestTimeout": "2s",
				"actors": []map[string]interface{}{{"principalId": principal, "kind": kind, "userUuid": nativeUser}}, "read": map[string]interface{}{"nativeJobId": "existing-read-job", "usageMeasurements": []interface{}{}}}
			if scenario == "missing-job" {
				delivery["read"].(map[string]interface{})["nativeJobId"] = ""
			}
			if scenario == "missing-meter-map" {
				delete(delivery["read"].(map[string]interface{}), "usageMeasurements")
			}
			if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
				t.Fatal(err)
			}
			service := scenario == "service-observe" || scenario == "service-extract" || scenario == "HUMAN-as-observer"
			operation := "execute"
			if service {
				operation = "observe"
			}
			if scenario == "service-extract" {
				operation = "extract_usage"
			}
			subject := nativeUser
			if service && scenario != "HUMAN-as-observer" || scenario == "SERVICE-as-GET" {
				subject = serviceUser
			}
			if scenario == "foreign-native-user" {
				subject = principal
			}
			ctx = claim.ToContext(ctx, claim.Claims{Subject: subject, Name: "native-user"})
			args := map[string]interface{}{"target": map[string]interface{}{"resourceId": targetID}, "input": map[string]interface{}{"resourceId": targetID, "nativeObjectRef": nodeID, "nativeRevision": "original-version", "displayName": "file.txt", "mediaType": "text/plain"}}
			if service {
				args = map[string]interface{}{"nativeType": "node", "idempotencyKey": key, "externalExecutionId": ee}
			}
			payload, _ := json.Marshal(claims)
			arguments, _ := json.Marshal(args)
			encoded, _ := json.Marshal(map[string]interface{}{"actionToken": "header." + base64.RawURLEncoding.EncodeToString(payload) + ".signed-by-authority", "argumentsJson": string(arguments)})
			request := httptest.NewRequest(http.MethodGet, "http://native.invalid/file?versionId=original-version", nil).WithContext(ctx)
			request.Header.Set("Idempotency-Key", key)
			if scenario == "wrong-key" {
				request.Header.Set("Idempotency-Key", nodeID)
			}
			if scenario == "wrong-version" {
				request.URL.RawQuery = "versionId=other-version"
			}
			if scenario == "range" {
				request.Header.Set("Range", "bytes=0-1")
			}
			read, err := NativeReadAuthority(request, base64.RawURLEncoding.EncodeToString(encoded), operation, service)
			allowed := scenario == "HUMAN" || scenario == "AGENT" || scenario == "service-observe" || scenario == "service-extract"
			if (err == nil) != allowed {
				if allowed {
					var actual NativeActorDelivery
					if scanErr := config.Get(ctx, "services", common.ServiceRestNamespace_+"n", "platform").Scan(&actual); scanErr != nil {
						t.Fatal("original controlled config could not be decoded", scanErr)
					}
					if actual.Read == nil || actual.Read.UsageMeasurements == nil {
						t.Fatal("original controlled config lost its explicit native read meter mapping")
					}
					if _, _, authorityErr := actual.AuthorizeOperation(ctx, "header."+base64.RawURLEncoding.EncodeToString(payload)+".signed-by-authority", string(arguments), operation); authorityErr != nil {
						t.Fatal("original binding authority did not verify the fixture", authorityErr)
					}
					if _, userErr := ResolveNativeUser(ctx, nativeUser); userErr != nil {
						t.Fatal("original mapped user/policy fixture was not admissible", userErr)
					}
				}
				t.Fatalf("original native actor/operation boundary mismatch: %v", err)
			}
			if allowed {
				native, _ := claim.FromContext(request.Context())
				if read.ExternalExecutionID != ee || native.Subject != nativeUser || (!service && NativeReadFromContext(request.Context()) != read) {
					t.Fatal("verified actor/operation did not reach original GET context")
				}
			}
		})
	}
}

func TestUnmarshalMappingRuleConfig(t *testing.T) {
	rawConfig := []byte(`
RuleName: first
RightAttribute : displayName
RuleString:

`)
	want := &MappingRule{
		RuleName:       "first",
		RightAttribute: "displayName",
		RuleString:     "",
	}

	var m MappingRule
	if err := yaml.Unmarshal(rawConfig, &m); err != nil {
		t.Fatalf("failed to decode config: %v", err)
	}
	if diff := pretty.Compare(m, want); diff != "" {
		t.Errorf("got!=want: %s", diff)
	}
}

func getMappingRuleConfig() *MappingRule {
	m := new(MappingRule)
	m.RuleName = "first"
	m.RightAttribute = "displayName"
	m.LeftAttribute = ""
	m.RuleString = ""
	return m
}

func TestMappingRule_SanitizeValues(t *testing.T) {
	m := getMappingRuleConfig()
	rightValues := []string{"teacher ", " student", " researcher"}
	leftValues := m.SanitizeValues(rightValues)
	correctLeftValues := []string{"teacher", "student", "researcher"}
	if !testEq(correctLeftValues, leftValues) {
		t.Errorf("Error")
	}
}

func TestMappingRule_AddPrefix(t *testing.T) {
	m := getMappingRuleConfig()
	rightValues := []string{"teacher ", " student", " researcher"}
	leftValues := m.SanitizeValues(rightValues)
	leftValues = m.AddPrefix("ldap_", leftValues)
	correctLeftValues := []string{"ldap_teacher", "ldap_student", "ldap_researcher"}
	if !testEq(correctLeftValues, leftValues) {
		t.Errorf("Error")
	}
}

func TestMappingRule_FilterList(t *testing.T) {
	m := getMappingRuleConfig()
	m.RuleString = "teacher,abc, def"

	rightValues := []string{"teacher ", " student", " researcher", "abcd", "def"}
	leftValues := m.SanitizeValues(rightValues)
	list := strings.Split(m.RuleString, ",")
	list = m.SanitizeValues(list)
	leftValues = m.FilterList(list, leftValues)
	correctLeftValues := []string{"teacher", "def"}
	if !testEq(correctLeftValues, leftValues) {
		t.Errorf("Error")
	}
}

func TestMappingRule_ConvertDNtoName(t *testing.T) {
	m := getMappingRuleConfig()
	dns := []string{"cn=testName,dc=vpydio,dc=fr", "cn=testName2,dc=vpydio,dc=fr", "cn=testName3,dc=vpydio,dc=fr", "cn=testName4,dc=vpydio,dc=fr"}
	name := m.ConvertDNtoName(dns)
	correctLeftValues := []string{"testName", "testName2", "testName3", "testName4"}
	if !testEq(correctLeftValues, name) {
		t.Errorf("Error")
	}
}

func TestMappingRule_FilterPreg(t *testing.T) {
	m := getMappingRuleConfig()
	m.RuleString = "preg:^teac*"
	rightValues := []string{"teacher ", " student", " researcher", "abcd", "def", " teachiiing"}
	rightValues = m.SanitizeValues(rightValues)
	rightValues = m.FilterPreg(m.RuleString, rightValues)
	correctLeftValues := []string{"teacher", "teachiiing"}
	if !testEq(correctLeftValues, rightValues) {
		t.Errorf("Error")
	}
}

func TestMappingRule_IsDnFormat(t *testing.T) {
	m := getMappingRuleConfig()
	DN := "cn=test,cn=abc,dc=com,dc=test"
	wrongDN := "cn=test,cn=abc,dc=com,dc=test,abc"

	if m.IsDnFormat(wrongDN) {
		t.Errorf("")
	}
	if !m.IsDnFormat(DN) {
		t.Errorf("")
	}
}

// Test equelity of two []string
func testEq(a, b []string) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
