package auth

// Adoption of the native shares that exist before Kailo's share projection,
// and owner rights of content creators (DD-164(3)(4)⑧ as amended at design
// 1c803580: never delete user data, plain members must not regress).
//
// Adoption. Before shares[] is converged, every native Cell (ROOM workspace
// that is not a Kailo-managed kailo-share-*) rooted on one folder whose owner
// and grantees are Kailo-mapped — a Kailo account (PRINCIPAL), a Kailo
// Workspace role kailo-ws-<id>/kailo-wsr-<id> (WORKSPACE) or the Tenant group
// role (TENANT) — is registered in Kailo with POST .../share-adoptions
// (read → READ, read+write → WRITE, the owner implicit). Core creates the
// component.shared_object Resource only when none exists and answers the
// authoritative Resource; an adopted answer is read back against the request.
// Until every mappable Cell has a definite answer (adopted, already a Resource,
// or refused by Core) shares[] is not converged and nothing native is
// removed. Afterwards a native Cell is retired (its ACLs and workspace; never
// the folder or files) only once kailo-share-<resourceId> converged for the
// current snapshot with ACLs covering every native ACL of the Cell. Cells
// that cannot be mapped (other roles, accounts outside Kailo, several roots,
// policy ACLs) and public links stay as they are and are reported in the
// receipt.
//
// Owner rights. Cells has no node owner metadata. The creator of a folder or
// file under a Kailo Workspace root is recorded at creation as a read+write
// node ACL of the creator's own account role (no workspace id, so it is a
// node mask, not a workspace root). Cells resolves the deepest node holding a
// mask first, so the creator keeps editing, deleting and sharing that node
// and its subtree even with the read-only Workspace role; nobody else gains
// anything. Content created before this recorder ran has no record.

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
	"time"

	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/client/commons/idmc"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/telemetry/log"
)

// Adoption receipt reason codes.
const (
	NativeOIDCReasonShareUnmappable  = "NATIVE_SHARE_UNMAPPABLE"
	NativeOIDCReasonLinkUnmappable   = "NATIVE_LINK_UNMAPPABLE"
	NativeOIDCReasonOwnerUnmappable  = "NATIVE_OWNER_UNMAPPABLE"
	NativeOIDCReasonAdoptionRefused  = "ADOPTION_REFUSED"
	NativeOIDCReasonAdoptionPending  = "ADOPTION_PENDING"
	NativeOIDCReasonRetirePending    = "NATIVE_SHARE_NOT_RETIRED"
	nativeOIDCAclRecycleRootName     = "recycle_root"
	nativeOIDCAdoptionRequestTimeout = 15 * time.Second
)

// nativeOIDCAdoption records which Kailo Resource is authoritative for one
// native Cell (persisted with the applied snapshot until the Cell is retired).
type nativeOIDCAdoption struct {
	Resource string `json:"resource"`
	Root     string `json:"root"`
}

// NativeOIDCShareAdoption is contracts/api/component_share_adoption_request.
type NativeOIDCShareAdoption struct {
	NativeType  string                    `json:"nativeType"`
	NativeID    string                    `json:"nativeId"`
	Name        string                    `json:"name"`
	Owner       NativeOIDCPerson          `json:"owner"`
	WorkspaceID string                    `json:"workspaceId,omitempty"`
	Grants      []NativeOIDCShareWireItem `json:"grants"`
}

// NativeOIDCShareWireItem is one ComponentShareGrant on the wire.
type NativeOIDCShareWireItem struct {
	Subject struct {
		Kind        string `json:"kind"`
		PrincipalID string `json:"principalId,omitempty"`
		WorkspaceID string `json:"workspaceId,omitempty"`
	} `json:"subject"`
	Access string `json:"access"`
}

func shareWireItem(g NativeOIDCShareGrant) NativeOIDCShareWireItem {
	var w NativeOIDCShareWireItem
	w.Subject.Kind, w.Subject.PrincipalID, w.Subject.WorkspaceID = g.Kind, g.PrincipalID, g.WorkspaceID
	w.Access = nativeOIDCShareRead
	if g.Write {
		w.Access = nativeOIDCShareWrite
	}
	return w
}

func shareGrantKeys(items []NativeOIDCShareWireItem) []string {
	var out []string
	for _, i := range items {
		out = append(out, i.Subject.Kind+":"+strings.ToLower(i.Subject.PrincipalID+i.Subject.WorkspaceID)+":"+i.Access)
	}
	slices.Sort(out)
	return out
}

// NativeOIDCShareAdoptionResult is contracts/api/component_share_adoption_result.
type NativeOIDCShareAdoptionResult struct {
	ResourceID       string                    `json:"resourceId"`
	OwnerPrincipalID string                    `json:"ownerPrincipalId"`
	Adopted          bool                      `json:"adopted"`
	Grants           []NativeOIDCShareWireItem `json:"grants"`
}

// NativeOIDCShareAdopter registers one native share in Kailo.
type NativeOIDCShareAdopter func(ctx context.Context, in NativeOIDCShareAdoption) (*NativeOIDCShareAdoptionResult, error)

// AdoptShare calls Core POST .../share-adoptions with the directory client.
// A 4xx answer is a definite refusal (NativeOIDCDirectoryUnavailable with that
// status); transport, 5xx and contract errors are not definite.
func (c *NativeOIDCDirectoryConfig) AdoptShare(ctx context.Context, in NativeOIDCShareAdoption) (*NativeOIDCShareAdoptionResult, error) {
	bearer, err := c.token(ctx)
	if err != nil {
		return nil, err
	}
	if in.Grants == nil {
		in.Grants = []NativeOIDCShareWireItem{}
	}
	body, err := json.Marshal(in)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, nativeOIDCAdoptionRequestTimeout)
	defer cancel()
	target := strings.TrimSuffix(c.CoreURL, "/") + "/service/v1/component-directory/bindings/" + url.PathEscape(c.BindingID) + "/share-adoptions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "share adoption"}
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := c.client().Do(req)
	if err != nil {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "share adoption"}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "share adoption", Status: resp.StatusCode}
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
	if err != nil {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "share adoption"}
	}
	var out NativeOIDCShareAdoptionResult
	if strictDecode(raw, &out) != nil || !directoryUUID.MatchString(out.ResourceID) || !directoryUUID.MatchString(out.OwnerPrincipalID) {
		return nil, &NativeOIDCDirectoryUnavailable{Stage: "share adoption contract"}
	}
	out.ResourceID, out.OwnerPrincipalID = strings.ToLower(out.ResourceID), strings.ToLower(out.OwnerPrincipalID)
	return &out, nil
}

// definiteAdoptionRefusal: Core answered and refused (4xx).
func definiteAdoptionRefusal(err error) bool {
	var u *NativeOIDCDirectoryUnavailable
	return errors.As(err, &u) && u.Status >= 400 && u.Status < 500
}

// nativeOIDCPeople maps native accounts of the snapshot to Kailo.
type nativeOIDCPeople struct {
	principalOf map[string]string           // account UUID → principalId
	identityOf  map[string]NativeOIDCPerson // account UUID → issuer/subject
	accounts    map[string][]string         // principalId → account UUIDs
}

func nativeOIDCPeopleOf(c NativeOIDCConnector, snapshot *NativeOIDCDirectorySnapshot) nativeOIDCPeople {
	linked := map[string]string{}
	for _, l := range c.Users {
		linked[l.Subject] = l.UserUUID
	}
	p := nativeOIDCPeople{principalOf: map[string]string{}, identityOf: map[string]NativeOIDCPerson{}, accounts: map[string][]string{}}
	for _, m := range snapshot.Members {
		for _, id := range m.Identities {
			if id.Issuer != c.Issuer {
				continue
			}
			account := linked[id.Subject]
			if account == "" {
				account = nativeOIDCUserUUID(id.Issuer, id.Subject)
			}
			p.principalOf[account] = m.PrincipalID
			p.identityOf[account] = NativeOIDCPerson{Issuer: id.Issuer, Subject: id.Subject}
			p.accounts[m.PrincipalID] = append(p.accounts[m.PrincipalID], account)
		}
	}
	return p
}

// nativeOIDCWorkspaceOfPath returns the Kailo Workspace whose root folder
// <workspaceRoot>/<id> contains the datasource path (strictly below when
// strict), or "".
func nativeOIDCWorkspaceOfPath(p, workspaceRoot string, workspaces map[string]string, strict bool) string {
	p = strings.Trim(p, "/")
	prefix := strings.Trim(workspaceRoot, "/") + "/"
	if workspaceRoot == "" || !strings.HasPrefix(p, prefix) {
		return ""
	}
	rest := strings.TrimPrefix(p, prefix)
	id, below, _ := strings.Cut(rest, "/")
	id = strings.ToLower(id)
	if _, ok := workspaces[id]; !ok || (strict && below == "") {
		return ""
	}
	return id
}

// nativeCellRoleACLs reads the role grants of a workspace: role → actions,
// the root nodes, and whether anything else (non read/write actions, ACLs on
// other nodes) is present.
func nativeCellRoleACLs(ctx context.Context, wsUUID string) (map[string]map[string]bool, []string, bool, error) {
	acls, err := searchNativeACLs(ctx, &idm.ACLSingleQuery{WorkspaceIDs: []string{wsUUID}})
	if err != nil {
		return nil, nil, false, err
	}
	roles := map[string]map[string]bool{}
	var roots []string
	other := false
	for _, a := range acls {
		switch name := a.GetAction().GetName(); {
		case name == permissions.AclWsrootActionName:
			if a.GetAction().GetValue() != "uuid:"+a.GetNodeID() {
				other = true
			}
			roots = append(roots, a.GetNodeID())
		case name == nativeOIDCAclRecycleRootName:
		case a.GetRoleID() != "" && (name == permissions.AclRead.Name || name == permissions.AclWrite.Name):
			if roles[a.GetRoleID()] == nil {
				roles[a.GetRoleID()] = map[string]bool{}
			}
			roles[a.GetRoleID()][name+"@"+a.GetNodeID()] = true
		default:
			other = true
		}
	}
	return roles, roots, other, nil
}

// mapNativeCell maps one native Cell to an adoption request, or gives the
// reason it cannot be mapped.
func mapNativeCell(ctx context.Context, ws *idm.Workspace, people nativeOIDCPeople, groupRole string, snapshot *NativeOIDCDirectorySnapshot,
	workspaceRoot string) (*NativeOIDCShareAdoption, string, error) {
	roles, roots, other, err := nativeCellRoleACLs(ctx, ws.GetUUID())
	if err != nil {
		return nil, "", err
	}
	if other || len(roots) != 1 {
		return nil, NativeOIDCReasonShareUnmappable, nil
	}
	root := roots[0]
	owner := ""
	for _, p := range ws.GetPolicies() {
		if p.GetAction() == service.ResourcePolicyAction_OWNER && p.GetEffect() == service.ResourcePolicy_allow {
			if owner != "" && owner != p.GetSubject() {
				return nil, NativeOIDCReasonOwnerUnmappable, nil
			}
			owner = p.GetSubject()
		}
	}
	ownerIdentity, ok := people.identityOf[owner]
	if !ok {
		return nil, NativeOIDCReasonOwnerUnmappable, nil
	}
	ownerPrincipal := people.principalOf[owner]
	if NativeOIDCShareNode == nil {
		return nil, "", errors.New("member directory shared folders are unavailable in this process")
	}
	node, err := NativeOIDCShareNode(ctx, root)
	if err != nil {
		return nil, "", err
	}
	if !node.Exists {
		return nil, NativeOIDCReasonObjectMissing, nil
	}
	if !node.Folder || !directoryUUID.MatchString(root) {
		return nil, NativeOIDCReasonShareUnmappable, nil
	}
	write := map[string]bool{} // subject key → write
	subject := map[string]NativeOIDCShareGrant{}
	add := func(g NativeOIDCShareGrant, w bool) {
		key := g.Kind + ":" + g.PrincipalID + g.WorkspaceID
		if _, ok := subject[key]; !ok {
			subject[key] = g
		}
		write[key] = write[key] || w
	}
	for role, actions := range roles {
		read, w := actions[permissions.AclRead.Name+"@"+root], actions[permissions.AclWrite.Name+"@"+root]
		if len(actions) != boolCount(read, w) || !read {
			return nil, NativeOIDCReasonShareUnmappable, nil
		}
		switch {
		case role == groupRole:
			add(NativeOIDCShareGrant{Kind: NativeOIDCShareTenant}, w)
		case strings.HasPrefix(role, NativeOIDCWorkspaceRolePrefix) || strings.HasPrefix(role, NativeOIDCWorkspaceReaderRolePrefix):
			id := strings.TrimPrefix(strings.TrimPrefix(role, NativeOIDCWorkspaceRolePrefix), NativeOIDCWorkspaceReaderRolePrefix)
			if _, known := snapshot.Workspaces[strings.ToLower(id)]; !known {
				return nil, NativeOIDCReasonShareUnmappable, nil
			}
			add(NativeOIDCShareGrant{Kind: NativeOIDCShareWorkspace, WorkspaceID: strings.ToLower(id)}, w)
		default:
			principal, known := people.principalOf[role]
			if !known {
				return nil, NativeOIDCReasonShareUnmappable, nil
			}
			if principal == ownerPrincipal {
				continue // the owner is implicit
			}
			add(NativeOIDCShareGrant{Kind: NativeOIDCSharePrincipal, PrincipalID: principal}, w)
		}
	}
	keys := make([]string, 0, len(subject))
	for k := range subject {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	req := &NativeOIDCShareAdoption{NativeType: NativeOIDCShareFolder, NativeID: strings.ToLower(root), Owner: ownerIdentity,
		WorkspaceID: nativeOIDCWorkspaceOfPath(node.Path, workspaceRoot, snapshot.Workspaces, false), Grants: []NativeOIDCShareWireItem{}}
	name := strings.TrimSpace(ws.GetLabel())
	if name == "" || name == "{{RefLabel}}" {
		name = node.Label
	}
	if r := []rune(name); len(r) > 200 {
		name = string(r[:200])
	}
	req.Name = name
	for _, k := range keys {
		g := subject[k]
		g.Write = write[k]
		req.Grants = append(req.Grants, shareWireItem(g))
	}
	return req, "", nil
}

func boolCount(values ...bool) int {
	n := 0
	for _, v := range values {
		if v {
			n++
		}
	}
	return n
}

// adoptNativeOIDCShares runs the adoption pass. definite is false while any
// mappable Cell has no definite answer; then shares[] must not converge.
func adoptNativeOIDCShares(ctx context.Context, adopt NativeOIDCShareAdopter, c NativeOIDCConnector, snapshot *NativeOIDCDirectorySnapshot,
	workspaceRoot, groupRole string, previous map[string]nativeOIDCAdoption) (map[string]nativeOIDCAdoption, []NativeOIDCReceiptFailure, bool, error) {
	adopted := map[string]nativeOIDCAdoption{}
	var failures []NativeOIDCReceiptFailure
	definite := true
	links, err := searchNativeWorkspaces(ctx, &idm.WorkspaceSingleQuery{Scope: idm.WorkspaceScope_LINK})
	if err != nil {
		return nil, nil, false, err
	}
	for _, l := range links {
		failures = append(failures, NativeOIDCReceiptFailure{Kind: "SHARE", Ref: l.GetUUID(), ReasonCode: NativeOIDCReasonLinkUnmappable})
	}
	rooms, err := searchNativeWorkspaces(ctx, &idm.WorkspaceSingleQuery{Scope: idm.WorkspaceScope_ROOM})
	if err != nil {
		return nil, nil, false, err
	}
	people := nativeOIDCPeopleOf(c, snapshot)
	for _, ws := range rooms {
		if IsNativeOIDCShareWorkspace(ws) {
			continue
		}
		if a, ok := previous[ws.GetUUID()]; ok {
			adopted[ws.GetUUID()] = a
			continue
		}
		req, reason, err := mapNativeCell(ctx, ws, people, groupRole, snapshot, workspaceRoot)
		if err != nil {
			return nil, nil, false, err
		}
		if reason != "" {
			failures = append(failures, NativeOIDCReceiptFailure{Kind: "SHARE", Ref: ws.GetUUID(), ReasonCode: reason})
			continue
		}
		if adopt == nil {
			definite = false
			failures = append(failures, NativeOIDCReceiptFailure{Kind: "SHARE", Ref: ws.GetUUID(), ReasonCode: NativeOIDCReasonAdoptionPending})
			continue
		}
		res, err := adopt(ctx, *req)
		switch {
		case err != nil && definiteAdoptionRefusal(err):
			failures = append(failures, NativeOIDCReceiptFailure{Kind: "SHARE", Ref: ws.GetUUID(), ReasonCode: NativeOIDCReasonAdoptionRefused})
			continue
		case err != nil:
			definite = false
			failures = append(failures, NativeOIDCReceiptFailure{Kind: "SHARE", Ref: ws.GetUUID(), ReasonCode: NativeOIDCReasonAdoptionPending})
			continue
		}
		// Read back: an adopted answer carries exactly what was asked.
		if res.Adopted && (res.OwnerPrincipalID != people.principalOf[ownerAccount(people, req.Owner)] ||
			!slices.Equal(shareGrantKeys(res.Grants), shareGrantKeys(req.Grants))) {
			definite = false
			failures = append(failures, NativeOIDCReceiptFailure{Kind: "SHARE", Ref: ws.GetUUID(), ReasonCode: NativeOIDCReasonAdoptionPending})
			continue
		}
		adopted[ws.GetUUID()] = nativeOIDCAdoption{Resource: res.ResourceID, Root: req.NativeID}
		log.Auditer(ctx).Info(fmt.Sprintf("Native Cell [%s] adopted as Kailo share [%s]", ws.GetUUID(), res.ResourceID),
			log.GetAuditId(common.AuditWsUpdate))
	}
	return adopted, failures, definite, nil
}

func ownerAccount(p nativeOIDCPeople, who NativeOIDCPerson) string {
	for account, id := range p.identityOf {
		if id == who {
			return account
		}
	}
	return ""
}

// retireAdoptedNativeCells retires an adopted native Cell once the Kailo
// share of its Resource converged for this snapshot and covers every native
// grant of the Cell. The folder and files are never touched.
func retireAdoptedNativeCells(ctx context.Context, adopted map[string]nativeOIDCAdoption, snapshot *NativeOIDCDirectorySnapshot,
	failed map[string]bool) ([]NativeOIDCReceiptFailure, error) {
	inSnapshot := map[string]bool{}
	for _, s := range snapshot.Shares {
		inSnapshot[s.ResourceID] = true
	}
	var failures []NativeOIDCReceiptFailure
	ids := make([]string, 0, len(adopted))
	for id := range adopted {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, cell := range ids {
		a := adopted[cell]
		if !inSnapshot[a.Resource] || failed[a.Resource] {
			failures = append(failures, NativeOIDCReceiptFailure{Kind: "SHARE", Ref: a.Resource, ReasonCode: NativeOIDCReasonRetirePending})
			continue
		}
		native, _, _, err := nativeCellRoleACLs(ctx, cell)
		if err != nil {
			return nil, err
		}
		kailo, _, _, err := nativeCellRoleACLs(ctx, nativeOIDCWorkspaceUUID(NativeOIDCShareSlug(a.Resource)))
		if err != nil {
			return nil, err
		}
		covered := true
		for role, actions := range native {
			for action := range actions {
				if !kailo[role][action] {
					covered = false
				}
			}
		}
		if !covered {
			failures = append(failures, NativeOIDCReceiptFailure{Kind: "SHARE", Ref: a.Resource, ReasonCode: NativeOIDCReasonRetirePending})
			continue
		}
		q, _ := anypb.New(&idm.ACLSingleQuery{WorkspaceIDs: []string{cell}})
		if _, err := idmc.ACLServiceClient(ctx).DeleteACL(ctx, &idm.DeleteACLRequest{Query: &service.Query{SubQueries: []*anypb.Any{q}}}); err != nil {
			return nil, err
		}
		wq, _ := anypb.New(&idm.WorkspaceSingleQuery{Uuid: cell})
		if _, err := idmc.WorkspaceServiceClient(ctx).DeleteWorkspace(ctx, &idm.DeleteWorkspaceRequest{Query: &service.Query{SubQueries: []*anypb.Any{wq}}}); err != nil {
			return nil, err
		}
		delete(adopted, cell)
		log.Auditer(ctx).Info(fmt.Sprintf("Native Cell [%s] retired; Kailo share [%s] serves its grants, files kept", cell, a.Resource),
			log.GetAuditId(common.AuditWsUpdate))
	}
	return failures, nil
}

// ---- owner rights ----------------------------------------------------------------

// NativeOIDCOwnerTarget returns the Kailo Workspace a newly created node
// belongs to (strictly below a Kailo Workspace root of the applied directory),
// or "" when the creator needs no owner record.
func NativeOIDCOwnerTarget(nodePath string) string {
	cfg, err := NativeOIDCShareIntentDirectory()
	if err != nil || cfg == nil {
		return ""
	}
	state, err := loadNativeOIDCDirectoryState()
	if err != nil || state == nil {
		return ""
	}
	return nativeOIDCWorkspaceOfPath(nodePath, cfg.WorkspaceRoot, state.Workspaces, true)
}

// RecordNativeOIDCOwner gives the Kailo account that created a node under a
// Kailo Workspace root read and write on that node (a node mask of its own
// account role). Idempotent; other accounts and roles are untouched.
func RecordNativeOIDCOwner(ctx context.Context, creator *idm.User, nodeUUID string) error {
	if creator == nil || creator.GetIsGroup() || creator.GetUuid() == "" || !directoryUUID.MatchString(nodeUUID) {
		return nil
	}
	if _, kailo := NativeOIDCUserIdentity(ctx, creator); !kailo {
		return nil
	}
	held, err := searchNativeACLs(ctx, &idm.ACLSingleQuery{NodeIDs: []string{nodeUUID}, RoleIDs: []string{creator.GetUuid()},
		Actions: []*idm.ACLAction{{Name: permissions.AclRead.Name}, {Name: permissions.AclWrite.Name}}})
	if err != nil {
		return err
	}
	for _, action := range []*idm.ACLAction{permissions.AclRead, permissions.AclWrite} {
		if slices.ContainsFunc(held, func(a *idm.ACL) bool { return a.GetAction().GetName() == action.Name && a.GetWorkspaceID() == "" }) {
			continue
		}
		if _, err := idmc.ACLServiceClient(ctx).CreateACL(ctx, &idm.CreateACLRequest{ACL: &idm.ACL{NodeID: nodeUUID, RoleID: creator.GetUuid(),
			Action: &idm.ACLAction{Name: action.Name, Value: action.Value}}}); err != nil {
			return err
		}
	}
	return nil
}
