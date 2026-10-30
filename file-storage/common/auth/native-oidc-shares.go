package auth

// Kailo Resource-level share projection and convergence receipts (DD-164(4),
// .design/07 §4.7.4 schema 2). Kailo is the only authority over who may read
// or write a shared folder: the member directory (schema 2) lists every
// ACTIVE component.shared_object Resource of this binding with its complete
// grants, and this instance converges one Kailo-managed native shared
// workspace per Resource:
//
//   - slug kailo-share-<resourceId>, ROOM scope (the native "cell"
//     mechanism), a stable UUID derived from the slug, rooted on the shared
//     folder node (uuid:<nativeId>), never re-rooted;
//   - one read (READ) or read and write (WRITE) ACL per grantee role on that
//     root: PRINCIPAL → the member's native account role (the account UUID
//     derived from issuer+subject, or the explicitly linked account),
//     WORKSPACE → both native roles of that Kailo Workspace (kailo-ws-<id>
//     and kailo-wsr-<id>: a share is for every member of the Workspace),
//     TENANT → the native Tenant group role (READ or WRITE, DD-164(4)③ as
//     amended at design 1c803580);
//   - visible (READ policy) to exactly those roles; only native admins may
//     edit it natively, and the native share endpoints refuse users in Kailo
//     mode (idm/share/rest): grants change only through Kailo.
//
// A Kailo-managed shared workspace whose Resource left the snapshot is
// removed (its ACLs and the workspace; the folder and files stay). A shared
// folder that no longer exists natively is skipped and reported as a failure
// item; the rest of the snapshot still converges.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"

	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/client/commons/idmc"
	"github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/permissions"
	pauth "github.com/pydio/cells/v5/common/proto/auth"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/telemetry/log"
)

// NativeOIDCSharePrefix starts the slug of a Kailo-managed shared workspace.
const NativeOIDCSharePrefix = "kailo-share-"

// Shareable native types (contracts/enums/component_shared_native_type).
const (
	NativeOIDCShareFolder        = "folder"
	nativeOIDCShareKnowledgeBase = "knowledge_base"
)

// Share subjects and access (contracts/enums/component_share_*).
const (
	NativeOIDCSharePrincipal = "PRINCIPAL"
	NativeOIDCShareWorkspace = "WORKSPACE"
	NativeOIDCShareTenant    = "TENANT"
	nativeOIDCShareRead      = "READ"
	nativeOIDCShareWrite     = "WRITE"
)

// Receipt failure reason codes reported by this instance.
const (
	NativeOIDCReasonObjectMissing   = "NATIVE_OBJECT_MISSING"
	NativeOIDCReasonObjectNotFolder = "NATIVE_OBJECT_NOT_FOLDER"
	NativeOIDCReasonTypeUnsupported = "NATIVE_TYPE_UNSUPPORTED"
	NativeOIDCReasonSlugTaken       = "NATIVE_SLUG_TAKEN"
	NativeOIDCReasonRootChanged     = "NATIVE_ROOT_CHANGED"
	nativeOIDCReasonTenantMismatch  = "TENANT_MISMATCH"
	nativeOIDCReasonApplyFailed     = "APPLY_FAILED"
	nativeOIDCReceiptFailuresMax    = 100
)

// NativeOIDCDirectoryShare is one shared object of the snapshot.
type NativeOIDCDirectoryShare struct {
	ResourceID string
	NativeType string
	NativeID   string
	Owner      string
	Grants     []NativeOIDCShareGrant
}

// NativeOIDCShareGrant is one grant of a shared object; PrincipalID or
// WorkspaceID according to Kind (none for TENANT).
type NativeOIDCShareGrant struct {
	Kind        string
	PrincipalID string
	WorkspaceID string
	Write       bool
}

type directoryShareWire struct {
	ResourceID       *string `json:"resourceId"`
	NativeType       *string `json:"nativeType"`
	NativeID         *string `json:"nativeId"`
	OwnerPrincipalID *string `json:"ownerPrincipalId"`
	Grants           *[]struct {
		Subject *struct {
			Kind        *string `json:"kind"`
			PrincipalID *string `json:"principalId"`
			WorkspaceID *string `json:"workspaceId"`
		} `json:"subject"`
		Access *string `json:"access"`
	} `json:"grants"`
}

func validNativeShareID(id string) bool {
	return id != "" && len(id) <= 255 && strings.IndexFunc(id, func(r rune) bool { return !unicode.IsPrint(r) || unicode.IsSpace(r) }) < 0
}

// parseDirectoryShares checks shares[] strictly: unique Resources, known
// native types, grantees present in this snapshot, no
// repeated subject. Any violation refuses the whole snapshot.
func parseDirectoryShares(wire []directoryShareWire, principals map[string]bool, workspaces map[string]string) ([]NativeOIDCDirectoryShare, bool) {
	out := []NativeOIDCDirectoryShare{}
	seen := map[string]bool{}
	for _, w := range wire {
		if w.ResourceID == nil || w.NativeType == nil || w.NativeID == nil || w.OwnerPrincipalID == nil || w.Grants == nil ||
			!directoryUUID.MatchString(*w.ResourceID) || !directoryUUID.MatchString(*w.OwnerPrincipalID) || !validNativeShareID(*w.NativeID) ||
			(*w.NativeType != NativeOIDCShareFolder && *w.NativeType != nativeOIDCShareKnowledgeBase) || seen[strings.ToLower(*w.ResourceID)] {
			return nil, false
		}
		share := NativeOIDCDirectoryShare{ResourceID: strings.ToLower(*w.ResourceID), NativeType: *w.NativeType, NativeID: *w.NativeID,
			Owner: strings.ToLower(*w.OwnerPrincipalID)}
		seen[share.ResourceID] = true
		subjects := map[string]bool{}
		for _, g := range *w.Grants {
			if g.Subject == nil || g.Subject.Kind == nil || g.Access == nil || (*g.Access != nativeOIDCShareRead && *g.Access != nativeOIDCShareWrite) {
				return nil, false
			}
			grant := NativeOIDCShareGrant{Kind: *g.Subject.Kind, Write: *g.Access == nativeOIDCShareWrite}
			switch grant.Kind {
			case NativeOIDCSharePrincipal:
				if g.Subject.PrincipalID == nil || g.Subject.WorkspaceID != nil || !directoryUUID.MatchString(*g.Subject.PrincipalID) ||
					!principals[strings.ToLower(*g.Subject.PrincipalID)] {
					return nil, false
				}
				grant.PrincipalID = strings.ToLower(*g.Subject.PrincipalID)
			case NativeOIDCShareWorkspace:
				if g.Subject.WorkspaceID == nil || g.Subject.PrincipalID != nil || !directoryUUID.MatchString(*g.Subject.WorkspaceID) {
					return nil, false
				}
				grant.WorkspaceID = strings.ToLower(*g.Subject.WorkspaceID)
				if _, ok := workspaces[grant.WorkspaceID]; !ok {
					return nil, false
				}
			case NativeOIDCShareTenant:
				if g.Subject.PrincipalID != nil || g.Subject.WorkspaceID != nil {
					return nil, false
				}
			default:
				return nil, false
			}
			key := grant.Kind + ":" + grant.PrincipalID + grant.WorkspaceID
			if subjects[key] {
				return nil, false
			}
			subjects[key] = true
			share.Grants = append(share.Grants, grant)
		}
		out = append(out, share)
	}
	return out, true
}

// NativeOIDCNode is what the admin tree says about one node.
type NativeOIDCNode struct {
	Exists, Folder bool
	Label          string
	// Path is the datasource path <datasource>/<...> (admin view).
	Path string
}

// NativeOIDCShareNode reads a node by UUID in the admin tree. It is installed
// by the frontend service (the node router cannot be imported here).
var NativeOIDCShareNode func(ctx context.Context, nodeUUID string) (NativeOIDCNode, error)

// NativeOIDCShareSlug is the slug of the Kailo-managed shared workspace of a Resource.
func NativeOIDCShareSlug(resourceID string) string {
	return NativeOIDCSharePrefix + strings.ToLower(resourceID)
}

// IsNativeOIDCShareWorkspace tells whether a workspace is Kailo-managed (its
// slug and derived UUID both match).
func IsNativeOIDCShareWorkspace(ws *idm.Workspace) bool {
	return ws != nil && strings.HasPrefix(ws.GetSlug(), NativeOIDCSharePrefix) && ws.GetUUID() == nativeOIDCWorkspaceUUID(ws.GetSlug())
}

// nativeOIDCShareRoles maps the grants of one share to native role ids, write
// winning over read when a role is reached twice.
func nativeOIDCShareRoles(share NativeOIDCDirectoryShare, accounts map[string][]string, tenantGroupRole string) map[string]bool {
	roles := map[string]bool{}
	add := func(role string, write bool) {
		if role != "" {
			roles[role] = roles[role] || write
		}
	}
	for _, g := range share.Grants {
		switch g.Kind {
		case NativeOIDCSharePrincipal:
			for _, account := range accounts[g.PrincipalID] {
				add(account, g.Write)
			}
		case NativeOIDCShareWorkspace:
			add(NativeOIDCWorkspaceRoleID(g.WorkspaceID), g.Write)
			add(NativeOIDCWorkspaceReaderRoleID(g.WorkspaceID), g.Write)
		case NativeOIDCShareTenant:
			add(tenantGroupRole, g.Write)
		}
	}
	return roles
}

// nativeOIDCShareACLs is the target role grant set on the root: "<role>:read"
// and "<role>:write" entries.
func nativeOIDCShareACLs(roles map[string]bool) []string {
	var out []string
	for role, write := range roles {
		out = append(out, role+":"+permissions.AclRead.Name)
		if write {
			out = append(out, role+":"+permissions.AclWrite.Name)
		}
	}
	slices.Sort(out)
	return out
}

func nativeOIDCSharePolicies(roles map[string]bool) []*service.ResourcePolicy {
	ids := make([]string, 0, len(roles))
	for role := range roles {
		ids = append(ids, role)
	}
	slices.Sort(ids)
	b := permissions.NewResourcePoliciesBuilder().WithProfileRead(common.PydioProfileAdmin).WithProfileWrite(common.PydioProfileAdmin)
	for _, role := range ids {
		b = b.WithResourcePolicy(&service.ResourcePolicy{Action: service.ResourcePolicyAction_READ, Effect: service.ResourcePolicy_allow,
			Subject: permissions.PolicySubjectRolePrefix + role})
	}
	return b.Policies()
}

// convergeNativeOIDCShares converges every share of the snapshot and removes
// the Kailo-managed shared workspaces that left it.
func convergeNativeOIDCShares(ctx context.Context, c NativeOIDCConnector, snapshot *NativeOIDCDirectorySnapshot, tenantGroupRole string) ([]NativeOIDCReceiptFailure, error) {
	linked := map[string]string{}
	for _, l := range c.Users {
		linked[l.Subject] = l.UserUUID
	}
	accounts := map[string][]string{}
	for _, m := range snapshot.Members {
		for _, id := range m.Identities {
			if id.Issuer != c.Issuer {
				continue
			}
			account := linked[id.Subject]
			if account == "" {
				account = nativeOIDCUserUUID(id.Issuer, id.Subject)
			}
			accounts[m.PrincipalID] = append(accounts[m.PrincipalID], account)
		}
	}
	var failures []NativeOIDCReceiptFailure
	active := map[string]bool{}
	for _, share := range snapshot.Shares {
		if share.NativeType != NativeOIDCShareFolder {
			failures = append(failures, NativeOIDCReceiptFailure{Kind: "SHARE", Ref: share.ResourceID, ReasonCode: NativeOIDCReasonTypeUnsupported})
			continue
		}
		active[NativeOIDCShareSlug(share.ResourceID)] = true
		reason, err := ensureNativeOIDCShare(ctx, share, nativeOIDCShareRoles(share, accounts, tenantGroupRole))
		if err != nil {
			return nil, err
		}
		if reason != "" {
			failures = append(failures, NativeOIDCReceiptFailure{Kind: "SHARE", Ref: share.ResourceID, ReasonCode: reason})
		}
	}
	if err := retireNativeOIDCShares(ctx, active); err != nil {
		return nil, err
	}
	return failures, nil
}

// ensureNativeOIDCShare converges one shared workspace; it returns a reason
// code instead of an error when the item cannot converge natively.
func ensureNativeOIDCShare(ctx context.Context, share NativeOIDCDirectoryShare, roles map[string]bool) (string, error) {
	if NativeOIDCShareNode == nil {
		return "", errors.New("member directory shared folders are unavailable in this process")
	}
	node, err := NativeOIDCShareNode(ctx, share.NativeID)
	if err != nil {
		return "", err
	}
	if !node.Exists {
		return NativeOIDCReasonObjectMissing, nil
	}
	if !node.Folder {
		return NativeOIDCReasonObjectNotFolder, nil
	}
	label := node.Label
	slug := NativeOIDCShareSlug(share.ResourceID)
	wsUUID := nativeOIDCWorkspaceUUID(slug)
	if label = strings.TrimSpace(label); label == "" {
		label = slug
	}
	found, err := searchNativeWorkspaces(ctx, &idm.WorkspaceSingleQuery{Slug: slug})
	if err != nil {
		return "", err
	}
	var current *idm.Workspace
	for _, w := range found {
		if w.GetSlug() == slug {
			current = w
		}
	}
	if current != nil && current.GetUUID() != wsUUID {
		return NativeOIDCReasonSlugTaken, nil
	}
	rootValue := "uuid:" + share.NativeID
	acls, err := searchNativeACLs(ctx, &idm.ACLSingleQuery{WorkspaceIDs: []string{wsUUID}})
	if err != nil {
		return "", err
	}
	for _, a := range acls {
		if a.GetAction().GetName() == permissions.AclWsrootActionName && (a.GetNodeID() != share.NativeID || a.GetAction().GetValue() != rootValue) {
			return NativeOIDCReasonRootChanged, nil
		}
	}
	wanted := nativeOIDCSharePolicies(roles)
	if current == nil || current.GetLabel() != label || current.GetScope() != idm.WorkspaceScope_ROOM || !samePolicies(current.GetPolicies(), wanted) {
		ws := &idm.Workspace{UUID: wsUUID, Slug: slug, Label: label, Description: "Kailo share", Scope: idm.WorkspaceScope_ROOM, Policies: wanted}
		if current != nil {
			ws.Attributes = current.GetAttributes()
		}
		if _, err := idmc.WorkspaceServiceClient(ctx).CreateWorkspace(ctx, &idm.CreateWorkspaceRequest{Workspace: ws}); err != nil {
			return "", err
		}
	}
	target := nativeOIDCShareACLs(roles)
	hasRoot := false
	held := map[string]bool{}
	for _, a := range acls {
		name := a.GetAction().GetName()
		if name == permissions.AclWsrootActionName {
			hasRoot = true
			continue
		}
		if a.GetRoleID() == "" || (name != permissions.AclRead.Name && name != permissions.AclWrite.Name) {
			continue
		}
		key := a.GetRoleID() + ":" + name
		if a.GetNodeID() == share.NativeID && slices.Contains(target, key) && !held[key] {
			held[key] = true
			continue
		}
		q, _ := anypb.New(&idm.ACLSingleQuery{WorkspaceIDs: []string{wsUUID}, NodeIDs: []string{a.GetNodeID()}, RoleIDs: []string{a.GetRoleID()},
			Actions: []*idm.ACLAction{{Name: name}}})
		if _, err := idmc.ACLServiceClient(ctx).DeleteACL(ctx, &idm.DeleteACLRequest{Query: &service.Query{SubQueries: []*anypb.Any{q}}}); err != nil {
			return "", err
		}
	}
	if !hasRoot {
		if _, err := idmc.ACLServiceClient(ctx).CreateACL(ctx, &idm.CreateACLRequest{ACL: &idm.ACL{NodeID: share.NativeID, WorkspaceID: wsUUID,
			Action: &idm.ACLAction{Name: permissions.AclWsrootActionName, Value: rootValue}}}); err != nil {
			return "", err
		}
	}
	for _, key := range target {
		if held[key] {
			continue
		}
		role, name, _ := strings.Cut(key, ":")
		action := permissions.AclRead
		if name == permissions.AclWrite.Name {
			action = permissions.AclWrite
		}
		if _, err := idmc.ACLServiceClient(ctx).CreateACL(ctx, &idm.CreateACLRequest{ACL: &idm.ACL{NodeID: share.NativeID, WorkspaceID: wsUUID, RoleID: role,
			Action: &idm.ACLAction{Name: action.Name, Value: action.Value}}}); err != nil {
			return "", err
		}
	}
	// Read back: exactly the target role grants and one root.
	acls, err = searchNativeACLs(ctx, &idm.ACLSingleQuery{WorkspaceIDs: []string{wsUUID}})
	if err != nil {
		return "", err
	}
	var got []string
	roots := 0
	for _, a := range acls {
		switch name := a.GetAction().GetName(); {
		case name == permissions.AclWsrootActionName:
			roots++
		case a.GetRoleID() != "" && (name == permissions.AclRead.Name || name == permissions.AclWrite.Name):
			got = append(got, a.GetRoleID()+":"+name)
		}
	}
	slices.Sort(got)
	if roots != 1 || !slices.Equal(got, target) {
		return "", errors.New("Kailo share grants could not be read back")
	}
	if len(held) != len(target) || current == nil {
		log.Auditer(ctx).Info(fmt.Sprintf("Kailo share [%s] converged", slug), log.GetAuditId(common.AuditWsUpdate))
	}
	return "", nil
}

// retireNativeOIDCShares removes the Kailo-managed shared workspaces whose
// Resource is no longer in the snapshot (unshared or Resource gone). The
// shared folder and its files are untouched.
func retireNativeOIDCShares(ctx context.Context, active map[string]bool) error {
	all, err := searchNativeWorkspaces(ctx, &idm.WorkspaceSingleQuery{Scope: idm.WorkspaceScope_ROOM})
	if err != nil {
		return err
	}
	for _, ws := range all {
		if !IsNativeOIDCShareWorkspace(ws) || active[ws.GetSlug()] {
			continue
		}
		q, _ := anypb.New(&idm.ACLSingleQuery{WorkspaceIDs: []string{ws.GetUUID()}})
		if _, err := idmc.ACLServiceClient(ctx).DeleteACL(ctx, &idm.DeleteACLRequest{Query: &service.Query{SubQueries: []*anypb.Any{q}}}); err != nil {
			return err
		}
		wq, _ := anypb.New(&idm.WorkspaceSingleQuery{Uuid: ws.GetUUID()})
		if _, err := idmc.WorkspaceServiceClient(ctx).DeleteWorkspace(ctx, &idm.DeleteWorkspaceRequest{Query: &service.Query{SubQueries: []*anypb.Any{wq}}}); err != nil {
			return err
		}
		log.Auditer(ctx).Info(fmt.Sprintf("Kailo share [%s] left the directory; grants revoked, files kept", ws.GetSlug()),
			log.GetAuditId(common.AuditWsUpdate))
	}
	return nil
}

// NativeOIDCRevokeAccountTokens revokes every personal and document access
// token of a login (07 §4.7.4 撤员时的原生令牌). Replaced by tests.
var NativeOIDCRevokeAccountTokens = func(ctx context.Context, login string) error {
	if strings.TrimSpace(login) == "" {
		return errors.New("refusing to revoke tokens without a login")
	}
	cli := pauth.NewPersonalAccessTokenServiceClient(grpc.ResolveConn(ctx, common.ServiceTokenGRPC))
	listed, err := cli.List(ctx, &pauth.PatListRequest{Type: pauth.PatType_ANY, ByUserLogin: login})
	if err != nil {
		return err
	}
	for _, token := range listed.GetTokens() {
		if token.GetUserLogin() != login || token.GetUuid() == "" {
			continue
		}
		if _, err := cli.Revoke(ctx, &pauth.PatRevokeRequest{Uuid: token.GetUuid()}); err != nil {
			return err
		}
		log.Auditer(ctx).Info(fmt.Sprintf("Revoked an access token of [%s] removed from the Kailo member directory", login),
			log.GetAuditId(common.AuditUserUpdate))
	}
	return nil
}

// ---- receipts ---------------------------------------------------------------------

// NativeOIDCReceiptFailure is one failure item of a receipt.
type NativeOIDCReceiptFailure struct {
	Kind       string `json:"kind"`
	Ref        string `json:"ref"`
	ReasonCode string `json:"reasonCode"`
}

// NativeOIDCReceipt is contracts/api/component_directory_receipt_request.
type NativeOIDCReceipt struct {
	Schema           int                        `json:"schema"`
	DirectoryVersion string                     `json:"directoryVersion"`
	AppliedAt        string                     `json:"appliedAt"`
	Outcome          string                     `json:"outcome"`
	Failures         []NativeOIDCReceiptFailure `json:"failures"`
}

func nativeOIDCReceipt(snapshot *NativeOIDCDirectorySnapshot, outcome string, failures []NativeOIDCReceiptFailure) *NativeOIDCReceipt {
	if len(failures) > nativeOIDCReceiptFailuresMax {
		failures = failures[:nativeOIDCReceiptFailuresMax]
	}
	if failures == nil {
		failures = []NativeOIDCReceiptFailure{}
	}
	return &NativeOIDCReceipt{Schema: NativeOIDCDirectorySchema, DirectoryVersion: snapshot.Version,
		AppliedAt: time.Now().UTC().Format(time.RFC3339), Outcome: outcome, Failures: failures}
}

func nativeOIDCAppliedReceipt(snapshot *NativeOIDCDirectorySnapshot, failures []NativeOIDCReceiptFailure) *NativeOIDCReceipt {
	return nativeOIDCReceipt(snapshot, "APPLIED", failures)
}

// nativeOIDCFailedReceipt carries one Tenant-level item with a category, never
// the error text.
func nativeOIDCFailedReceipt(snapshot *NativeOIDCDirectorySnapshot, err error) *NativeOIDCReceipt {
	reason := nativeOIDCReasonApplyFailed
	var unavailable *NativeOIDCDirectoryUnavailable
	if errors.As(err, &unavailable) && unavailable.Stage == "tenant" {
		reason = nativeOIDCReasonTenantMismatch
	}
	return nativeOIDCReceipt(snapshot, "FAILED", []NativeOIDCReceiptFailure{{Kind: "TENANT", Ref: snapshot.TenantID, ReasonCode: reason}})
}

var nativeOIDCPendingReceipt struct {
	sync.Mutex
	receipt *NativeOIDCReceipt
}

func (c *NativeOIDCDirectoryConfig) queueReceipt(r *NativeOIDCReceipt) {
	nativeOIDCPendingReceipt.Lock()
	defer nativeOIDCPendingReceipt.Unlock()
	nativeOIDCPendingReceipt.receipt = r
}

// deliverPendingReceipt reports the latest receipt once; a failed delivery
// keeps it for the next period and never affects the directory itself.
func (c *NativeOIDCDirectoryConfig) deliverPendingReceipt(ctx context.Context) {
	nativeOIDCPendingReceipt.Lock()
	r := nativeOIDCPendingReceipt.receipt
	nativeOIDCPendingReceipt.Unlock()
	if r == nil {
		return
	}
	if err := c.SendReceipt(ctx, r); err != nil {
		log.Logger(ctx).Warn("Kailo member directory receipt not delivered; retried next period", zap.Error(err))
		return
	}
	nativeOIDCPendingReceipt.Lock()
	if nativeOIDCPendingReceipt.receipt == r {
		nativeOIDCPendingReceipt.receipt = nil
	}
	nativeOIDCPendingReceipt.Unlock()
}

// SendReceipt PUTs one receipt to Core with the directory client token.
func (c *NativeOIDCDirectoryConfig) SendReceipt(ctx context.Context, r *NativeOIDCReceipt) error {
	bearer, err := c.token(ctx)
	if err != nil {
		return err
	}
	body, err := json.Marshal(r)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	target := strings.TrimSuffix(c.CoreURL, "/") + "/service/v1/component-directory/bindings/" + url.PathEscape(c.BindingID) + "/receipt"
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, target, bytes.NewReader(body))
	if err != nil {
		return &NativeOIDCDirectoryUnavailable{Stage: "receipt"}
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.client().Do(req)
	if err != nil {
		return &NativeOIDCDirectoryUnavailable{Stage: "receipt"}
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return &NativeOIDCDirectoryUnavailable{Stage: "receipt", Status: resp.StatusCode}
	}
	return nil
}

// ---- share intents (DD-164(4)②) ---------------------------------------------------

// NativeOIDCShareIntent is the ComponentShareIntentRequest of one folder.
type NativeOIDCShareIntent struct {
	NodeUUID    string
	Name        string
	Issuer      string
	Subject     string
	WorkspaceID string // "" for Tenant-level folders
}

// NativeOIDCShareIntentCreated is the ComponentShareIntentCreated answer.
type NativeOIDCShareIntentCreated struct {
	IntentID  string `json:"intentId"`
	ExpiresAt string `json:"expiresAt"`
}

// NativeOIDCShareIntentDirectory returns the directory delivery used for
// share intents (nil when the directory is not delivered). Replaced by tests.
var NativeOIDCShareIntentDirectory = func() (*NativeOIDCDirectoryConfig, error) {
	return NativeOIDCDirectoryConfigFromEnv()
}

// ErrNativeOIDCShareUnavailable: no member directory delivery, so Kailo
// sharing is not available on this instance.
var ErrNativeOIDCShareUnavailable = errors.New("Kailo sharing is not delivered on this instance")

// CreateNativeOIDCShareIntent asks Core for a share intent of one folder. The
// caller already checked that the user may share the folder natively.
func CreateNativeOIDCShareIntent(ctx context.Context, in NativeOIDCShareIntent) (*NativeOIDCShareIntentCreated, error) {
	cfg, err := NativeOIDCShareIntentDirectory()
	if err != nil || cfg == nil {
		return nil, ErrNativeOIDCShareUnavailable
	}
	name := strings.TrimSpace(in.Name)
	if r := []rune(name); len(r) > 200 {
		name = string(r[:200])
	}
	if !directoryUUID.MatchString(in.NodeUUID) || name == "" || in.Issuer == "" || strings.TrimSpace(in.Subject) == "" ||
		(in.WorkspaceID != "" && !directoryUUID.MatchString(in.WorkspaceID)) {
		return nil, errors.New("invalid share intent")
	}
	request := map[string]any{"nativeType": NativeOIDCShareFolder, "nativeId": strings.ToLower(in.NodeUUID), "name": name,
		"initiator": map[string]string{"issuer": in.Issuer, "subject": in.Subject}}
	if in.WorkspaceID != "" {
		request["workspaceId"] = strings.ToLower(in.WorkspaceID)
	}
	body, _ := json.Marshal(request)
	bearer, err := cfg.token(ctx)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	target := strings.TrimSuffix(cfg.CoreURL, "/") + "/service/v1/component-directory/bindings/" + url.PathEscape(cfg.BindingID) + "/share-intents"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "share intent"}
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := cfg.client().Do(req)
	if err != nil {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "share intent"}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "share intent", Status: resp.StatusCode}
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "share intent"}
	}
	var created NativeOIDCShareIntentCreated
	var wire struct {
		IntentID  *string `json:"intentId"`
		ExpiresAt *string `json:"expiresAt"`
	}
	if strictDecode(raw, &wire) != nil || wire.IntentID == nil || wire.ExpiresAt == nil || !directoryUUID.MatchString(*wire.IntentID) {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "share intent contract"}
	}
	if _, err := time.Parse(time.RFC3339, *wire.ExpiresAt); err != nil {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "share intent contract"}
	}
	created.IntentID, created.ExpiresAt = strings.ToLower(*wire.IntentID), *wire.ExpiresAt
	return &created, nil
}

// NativeOIDCWorkspaceOfSlug returns the Kailo Workspace id of a native
// workspace slug kailo-ws-<id>, or "".
func NativeOIDCWorkspaceOfSlug(slug string) string {
	id := strings.TrimPrefix(slug, NativeOIDCWorkspaceRolePrefix)
	if id == slug || !directoryUUID.MatchString(id) {
		return ""
	}
	return strings.ToLower(id)
}
