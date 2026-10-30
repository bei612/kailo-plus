package service

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/Tencent/WeKnora/internal/types"
)

const (
	shareKB       = "kb-shared-0001"
	shareKBNative = "kb-native-0002"
	shareRes      = "5a5a5a5a-0000-4000-8000-000000000001"
	shareResGone  = "5a5a5a5a-0000-4000-8000-000000000002"
	shareResOther = "5a5a5a5a-0000-4000-8000-000000000003"
)

func grant(kind, id, access string) map[string]interface{} {
	subject := map[string]interface{}{"kind": kind}
	switch kind {
	case "PRINCIPAL":
		subject["principalId"] = id
	case "WORKSPACE":
		subject["workspaceId"] = id
	}
	return map[string]interface{}{"subject": subject, "access": access}
}

func (f *kailoFixture) kbShares(t *testing.T, kb string) map[string]types.KnowledgeBaseShare {
	t.Helper()
	var rows []types.KnowledgeBaseShare
	if err := f.db.Where("knowledge_base_id = ?", kb).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	out := map[string]types.KnowledgeBaseShare{}
	for _, row := range rows {
		out[row.OrganizationID] = row
	}
	return out
}

func (f *kailoFixture) orgID(t *testing.T, column, ref string) string {
	t.Helper()
	var org types.Organization
	if err := f.db.Select("id").Where(column+" = ?", ref).First(&org).Error; err != nil {
		t.Fatalf("organisation %s=%s: %v", column, ref, err)
	}
	return org.ID
}

// DD-164(4): shares[] of knowledge bases converge to Kailo-managed native
// shares; everything else into a Kailo organisation is retired.
func TestKailoDirectoryProjectsKnowledgeBaseShares(t *testing.T) {
	f, core, runner := newDirectoryFixture(t)
	core.answer(http.StatusOK, firstSnapshot(t))
	if !runner.SyncOnce(context.Background()) {
		t.Fatal("first snapshot not applied")
	}
	tenant := f.space(t, "tenant:"+dirTenant)
	wsA := f.space(t, "workspace:"+dirWsA)
	ada := f.userBySubject(t, "ada")
	for _, kb := range []struct {
		id    string
		space uint64
	}{{shareKB, wsA.ID}, {shareKBNative, tenant.ID}} {
		if err := f.db.Exec("INSERT INTO knowledge_bases (id, name, tenant_id, creator_id) VALUES (?, ?, ?, ?)",
			kb.id, kb.id, kb.space, ada.ID).Error; err != nil {
			t.Fatal(err)
		}
	}
	tenantOrg := f.orgID(t, "kailo_tenant_ref", dirTenant)
	// A native share into the Kailo Tenant organisation made before Kailo
	// owned sharing: adopted as a Kailo share, never deleted (DD-164(4)⑧).
	if err := f.db.Exec("INSERT INTO kb_shares (id, knowledge_base_id, organization_id, shared_by_user_id, "+
		"source_tenant_id, permission) VALUES ('native-1', ?, ?, ?, ?, 'editor')",
		shareKBNative, tenantOrg, ada.ID, tenant.ID).Error; err != nil {
		t.Fatal(err)
	}

	members := []dirMember{
		{principal: dirAda, sub: "ada", name: "Ada Lovelace", role: "ADMIN", ws: map[string]string{dirWsA: "MEMBER"}},
		{principal: dirBob, sub: "bob", name: "Bob", role: "MEMBER", ws: map[string]string{dirWsA: "ADMIN"}},
	}
	shares := []map[string]interface{}{
		{"resourceId": shareRes, "nativeType": "knowledge_base", "nativeId": shareKB, "ownerPrincipalId": dirAda,
			"grants": []map[string]interface{}{grant("PRINCIPAL", dirAda, "WRITE"), grant("PRINCIPAL", dirBob, "READ"),
				grant("TENANT", "", "WRITE"), grant("WORKSPACE", dirWsB, "WRITE")}},
		{"resourceId": shareResGone, "nativeType": "knowledge_base", "nativeId": "kb-deleted", "ownerPrincipalId": dirAda,
			"grants": []map[string]interface{}{grant("PRINCIPAL", dirAda, "WRITE")}},
		{"resourceId": shareResOther, "nativeType": "folder", "nativeId": "cells-node", "ownerPrincipalId": dirAda,
			"grants": []map[string]interface{}{grant("PRINCIPAL", dirAda, "WRITE")}},
	}
	core.answer(http.StatusOK, directoryJSONWithShares(t, "shares", dirBinding, dirTenant,
		map[string]string{dirWsA: "Alpha", dirWsB: "Beta"}, shares, members...))
	if !runner.SyncOnce(context.Background()) {
		t.Fatal("share snapshot not applied")
	}
	wsBOrg := f.orgID(t, "kailo_share_ref", "workspace:"+dirWsB)
	got := f.kbShares(t, shareKB)
	// DD-164(4)③: TENANT WRITE is editor on the Tenant organisation.
	if len(got) != 2 || got[tenantOrg].Permission != types.OrgRoleEditor || got[wsBOrg].Permission != types.OrgRoleEditor {
		t.Fatalf("projected shares = %+v", got)
	}
	for _, row := range got {
		if row.KailoResourceRef == nil || *row.KailoResourceRef != shareRes || row.SourceTenantID != wsA.ID ||
			row.SharedByUserID != ada.ID {
			t.Fatalf("projected row = %+v", row)
		}
	}
	var spaces []types.OrganizationTenantMember
	f.db.Where("organization_id = ?", wsBOrg).Find(&spaces)
	if wsB := f.space(t, "workspace:"+dirWsB); len(spaces) != 1 || spaces[0].TenantID != wsB.ID {
		t.Fatalf("workspace share organisation spaces = %+v", spaces)
	}
	adoptedRes := adoptedResourceID(shareKBNative)
	if rows := f.kbShares(t, shareKBNative); len(rows) != 1 || rows[tenantOrg].KailoResourceRef == nil ||
		*rows[tenantOrg].KailoResourceRef != adoptedRes || rows[tenantOrg].Permission != types.OrgRoleEditor {
		t.Fatalf("the native share must be adopted and kept: %+v", rows)
	}
	if len(core.adoptions) != 1 {
		t.Fatalf("adoptions = %v", core.adoptions)
	}
	asked := core.adoptions[0]
	owner, _ := asked["owner"].(map[string]interface{})
	grants, _ := asked["grants"].([]interface{})
	if asked["nativeType"] != "knowledge_base" || asked["nativeId"] != shareKBNative || owner["subject"] != "ada" ||
		len(grants) != 1 || grants[0].(map[string]interface{})["access"] != "WRITE" ||
		grants[0].(map[string]interface{})["subject"].(map[string]interface{})["kind"] != "TENANT" {
		t.Fatalf("adoption request = %v", asked)
	}
	adoptedShare := map[string]interface{}{"resourceId": adoptedRes, "nativeType": "knowledge_base",
		"nativeId": shareKBNative, "ownerPrincipalId": dirAda,
		"grants": []map[string]interface{}{grant("PRINCIPAL", dirAda, "WRITE"), grant("TENANT", "", "WRITE")}}
	receipt := core.lastReceipt()
	if receipt == nil || receipt["outcome"] != "APPLIED" || receipt["schema"] != float64(2) {
		t.Fatalf("receipt = %v", receipt)
	}
	failures, _ := receipt["failures"].([]interface{})
	reasons := map[string]string{}
	for _, item := range failures {
		m := item.(map[string]interface{})
		if m["kind"] != "SHARE" {
			t.Fatalf("failure item = %v", m)
		}
		reasons[m["ref"].(string)] = m["reasonCode"].(string)
	}
	if len(reasons) != 2 || reasons[shareRes] != "SUBJECT_NOT_SUPPORTED" || reasons[shareResGone] != "NATIVE_OBJECT_MISSING" {
		t.Fatalf("receipt failures = %v", failures)
	}

	// The same version is not applied again and the same receipt is not resent.
	sent := len(core.receipts)
	if runner.SyncOnce(context.Background()) || len(core.receipts) != sent {
		t.Fatal("an unchanged snapshot must neither apply nor report again")
	}

	// Revoking every grant of a Kailo share in Kailo removes its projection;
	// the adopted share, now in shares[], is kept and not adopted again.
	core.answer(http.StatusOK, directoryJSONWithShares(t, "unshared", dirBinding, dirTenant,
		map[string]string{dirWsA: "Alpha", dirWsB: "Beta"}, []map[string]interface{}{adoptedShare}, members...))
	if !runner.SyncOnce(context.Background()) {
		t.Fatal("unshare snapshot not applied")
	}
	if rows := f.kbShares(t, shareKB); len(rows) != 0 {
		t.Fatalf("revoked shares survived: %+v", rows)
	}
	if rows := f.kbShares(t, shareKBNative); len(rows) != 1 || rows[tenantOrg].Permission != types.OrgRoleEditor {
		t.Fatalf("the adopted share must survive convergence: %+v", rows)
	}
	if len(core.adoptions) != 1 {
		t.Fatal("an adopted share is not adopted again")
	}
}

// Schema 1 is never read as schema 2 (DD-164(2)): nothing is applied and no
// receipt claims it was.
func TestKailoDirectoryRefusesSchemaOne(t *testing.T) {
	f, core, runner := newDirectoryFixture(t)
	core.answer(http.StatusOK, firstSnapshot(t))
	runner.SyncOnce(context.Background())
	before, sent := f.recordedVersion(t), len(core.receipts)
	legacy := []byte(`{"bindingId":"` + dirBinding + `","directoryVersion":"` +
		strings.Repeat("a", 64) +
		`","tenant":{"tenantId":"` + dirTenant + `","name":"Acme"},"workspaces":[],"members":[]}`)
	core.answer(http.StatusOK, legacy)
	if runner.SyncOnce(context.Background()) || f.recordedVersion(t) != before || len(core.receipts) != sent {
		t.Fatal("a schema 1 answer must change nothing")
	}
	// A snapshot recorded before the upgrade keeps its schema 1 meaning.
	recorded, err := types.ParseRecordedKailoMemberDirectory([]byte(`{"bindingId":"` + dirBinding +
		`","directoryVersion":"` + strings.Repeat("a", 64) + `",` +
		`"tenant":{"tenantId":"` + dirTenant + `","name":"Acme"},"workspaces":[],"members":[{"principalId":"` + dirBob +
		`","displayName":"Bob","tenantRole":"MEMBER","identities":[],"workspaces":[]}]}`))
	if err != nil || recorded.Schema != 1 || !recorded.Members[0].TenantCreate {
		t.Fatalf("recorded schema 1 = %+v, %v", recorded, err)
	}
	if role := recorded.Membership(&recorded.Members[0], "Acme").Tenant.NativeRole(); role != types.TenantRoleContributor {
		t.Fatalf("schema 1 member role = %q", role)
	}
}

// DD-164(9): the Kailo display name wins over the IdP name, also at login.
func TestKailoDirectoryDisplayNameWins(t *testing.T) {
	f, core, runner := newDirectoryFixture(t)
	core.answer(http.StatusOK, firstSnapshot(t))
	runner.SyncOnce(context.Background())
	f.claims = kailoClaims("bob", "bob@example.com", "bob-from-idp", "sid-bob")
	if user := f.login(t).User; user.Username != "Bob" {
		t.Fatalf("login replaced the Kailo display name with %q", user.Username)
	}
	core.answer(http.StatusOK, directoryJSON(t, "renamed", dirBinding, dirTenant, map[string]string{dirWsA: "Alpha"},
		dirMember{principal: dirAda, sub: "ada", name: "Ada Lovelace", role: "ADMIN"},
		dirMember{principal: dirBob, sub: "bob", name: "Robert", role: "MEMBER", create: true}))
	runner.SyncOnce(context.Background())
	bob := f.userBySubject(t, "bob")
	if bob.Username != "Robert" || f.role(t, bob.ID, f.space(t, "tenant:"+dirTenant).ID) != types.TenantRoleContributor {
		t.Fatalf("after rename: %q, role %q", bob.Username, f.role(t, bob.ID, f.space(t, "tenant:"+dirTenant).ID))
	}
}

// DD-164(4)②: the share entry names the knowledge base to Kailo only for a
// person who may share it natively, with the Workspace it lives in.
func TestKailoShareIntentNamesTheKnowledgeBaseToKailo(t *testing.T) {
	f, core, runner := newDirectoryFixture(t)
	core.answer(http.StatusOK, firstSnapshot(t))
	runner.SyncOnce(context.Background())
	wsA := f.space(t, "workspace:"+dirWsA)
	ada, bob := f.userBySubject(t, "ada"), f.userBySubject(t, "bob")
	if err := f.db.Exec("INSERT INTO knowledge_bases (id, name, tenant_id, creator_id) VALUES (?, ?, ?, ?)",
		shareKB, "  Sales   handbook ", wsA.ID, bob.ID).Error; err != nil {
		t.Fatal(err)
	}
	svc := NewKailoShareIntentService(f.svc.config, f.db)
	ctx := context.Background()

	intent, err := svc.Request(ctx, types.Caller{TenantID: wsA.ID, UserID: ada.ID, Role: types.TenantRoleAdmin}, shareKB)
	if err != nil || intent.IntentID != "9e1f0000-0000-4000-8000-0000000000c1" {
		t.Fatalf("admin intent = %+v, %v", intent, err)
	}
	sent := core.intents[len(core.intents)-1]
	initiator, _ := sent["initiator"].(map[string]interface{})
	if sent["nativeType"] != "knowledge_base" || sent["nativeId"] != shareKB || sent["name"] != "Sales handbook" ||
		sent["workspaceId"] != dirWsA || initiator["issuer"] != kailoTestIssuer || initiator["subject"] != "ada" {
		t.Fatalf("intent request = %v", sent)
	}
	// The owner shares their own knowledge base whatever their space role
	// (DD-164(3)); another member without admin does not.
	for _, role := range []types.TenantRole{types.TenantRoleContributor, types.TenantRoleViewer} {
		if _, err := svc.Request(ctx, types.Caller{TenantID: wsA.ID, UserID: bob.ID, Role: role}, shareKB); err != nil {
			t.Fatalf("owner intent as %s: %v", role, err)
		}
	}
	asked := len(core.intents)
	for name, caller := range map[string]types.Caller{
		"other contributor": {TenantID: wsA.ID, UserID: ada.ID, Role: types.TenantRoleContributor},
		"other viewer":      {TenantID: wsA.ID, UserID: ada.ID, Role: types.TenantRoleViewer},
	} {
		if _, err := svc.Request(ctx, caller, shareKB); err != ErrKailoShareForbidden {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if _, err := svc.Request(ctx, types.Caller{TenantID: wsA.ID + 1000, UserID: ada.ID, Role: types.TenantRoleAdmin}, shareKB); err != ErrKailoShareNotFound {
		t.Fatalf("another space: %v", err)
	}
	if len(core.intents) != asked {
		t.Fatal("a refused share must not reach Kailo")
	}
}

// Production 2026-10-30: the acceptance knowledge base "r-accept-星河兰花温室"
// of qa-1 is shared natively to the Kailo Tenant organisation (view only).
// Switching to schema 2 must keep it (DD-164(4)⑧).
func TestKailoDirectoryKeepsTheAcceptanceKnowledgeBaseShare(t *testing.T) {
	f, core, runner := newDirectoryFixture(t)
	core.answer(http.StatusOK, firstSnapshot(t))
	runner.SyncOnce(context.Background())
	tenant := f.space(t, "tenant:"+dirTenant)
	ada := f.userBySubject(t, "ada")
	const kb = "kb-r-accept"
	if err := f.db.Exec("INSERT INTO knowledge_bases (id, name, tenant_id, creator_id) VALUES (?, ?, ?, ?)",
		kb, "r-accept-星河兰花温室", tenant.ID, ada.ID).Error; err != nil {
		t.Fatal(err)
	}
	tenantOrg := f.orgID(t, "kailo_tenant_ref", dirTenant)
	other := "other-org-0001"
	if err := f.db.Exec("INSERT INTO organizations (id, name, owner_id, owner_tenant_id, invite_code) VALUES (?, 'native', ?, ?, 'code-1')",
		other, ada.ID, tenant.ID).Error; err != nil {
		t.Fatal(err)
	}
	for _, row := range []struct{ id, org, permission string }{{"accept-1", tenantOrg, "viewer"}, {"accept-2", other, "editor"}} {
		if err := f.db.Exec("INSERT INTO kb_shares (id, knowledge_base_id, organization_id, shared_by_user_id, "+
			"source_tenant_id, permission) VALUES (?, ?, ?, ?, ?, ?)", row.id, kb, row.org, ada.ID, tenant.ID, row.permission).Error; err != nil {
			t.Fatal(err)
		}
	}
	members := []dirMember{
		{principal: dirAda, sub: "ada", name: "Ada Lovelace", role: "ADMIN"},
		{principal: dirBob, sub: "bob", name: "Bob", role: "MEMBER", create: true},
	}
	wsNames := map[string]string{dirWsA: "Alpha"}

	// Core answers indefinitely: nothing is converged or recorded.
	core.adopt = func(map[string]interface{}) (int, interface{}) {
		return http.StatusServiceUnavailable, map[string]string{}
	}
	core.answer(http.StatusOK, directoryJSON(t, "schema2-first", dirBinding, dirTenant, wsNames, members...))
	before := f.recordedVersion(t)
	if runner.SyncOnce(context.Background()) || f.recordedVersion(t) != before {
		t.Fatal("an indefinite adoption must stop the convergence")
	}
	if r := core.lastReceipt(); r == nil || r["outcome"] != "FAILED" {
		t.Fatalf("receipt after an indefinite adoption = %v", r)
	}

	// A definite answer adopts the Tenant share; the share into a native
	// organisation is not Kailo-mapped and stays untouched.
	core.adopt = nil
	if !runner.SyncOnce(context.Background()) {
		t.Fatal("snapshot not applied after the adoption")
	}
	rows := f.kbShares(t, kb)
	res := adoptedResourceID(kb)
	if len(rows) != 2 || rows[tenantOrg].KailoResourceRef == nil || *rows[tenantOrg].KailoResourceRef != res ||
		rows[tenantOrg].Permission != types.OrgRoleViewer || rows[other].KailoResourceRef != nil ||
		rows[other].Permission != types.OrgRoleEditor {
		t.Fatalf("shares after adoption = %+v", rows)
	}
	last := core.adoptions[len(core.adoptions)-1]
	if grants := last["grants"].([]interface{}); len(grants) != 1 ||
		grants[0].(map[string]interface{})["access"] != "READ" || last["name"] != "r-accept-星河兰花温室" {
		t.Fatalf("adoption request = %v", last)
	}

	// Core's next snapshot carries the adopted Resource: the share survives.
	core.answer(http.StatusOK, directoryJSONWithShares(t, "schema2-adopted", dirBinding, dirTenant, wsNames,
		[]map[string]interface{}{{"resourceId": res, "nativeType": "knowledge_base", "nativeId": kb,
			"ownerPrincipalId": dirAda, "grants": []map[string]interface{}{grant("PRINCIPAL", dirAda, "WRITE"),
				grant("TENANT", "", "READ")}}}, members...))
	if !runner.SyncOnce(context.Background()) {
		t.Fatal("adopted snapshot not applied")
	}
	if rows := f.kbShares(t, kb); len(rows) != 2 || rows[tenantOrg].Permission != types.OrgRoleViewer ||
		rows[other].Permission != types.OrgRoleEditor {
		t.Fatalf("the acceptance share did not survive: %+v", rows)
	}
}

// A refused adoption or an owner outside the directory leaves the native
// share untouched and is reported (DD-164(4)⑧).
func TestKailoDirectoryRefusedAdoptionKeepsTheNativeShare(t *testing.T) {
	f, core, runner := newDirectoryFixture(t)
	core.answer(http.StatusOK, firstSnapshot(t))
	runner.SyncOnce(context.Background())
	tenant := f.space(t, "tenant:"+dirTenant)
	ada := f.userBySubject(t, "ada")
	tenantOrg := f.orgID(t, "kailo_tenant_ref", dirTenant)
	for _, kb := range []struct{ id, creator string }{{"kb-refused", ada.ID}, {"kb-orphan", "gone-user"}} {
		if err := f.db.Exec("INSERT INTO knowledge_bases (id, name, tenant_id, creator_id) VALUES (?, ?, ?, ?)",
			kb.id, kb.id, tenant.ID, kb.creator).Error; err != nil {
			t.Fatal(err)
		}
		if err := f.db.Exec("INSERT INTO kb_shares (id, knowledge_base_id, organization_id, shared_by_user_id, "+
			"source_tenant_id, permission) VALUES (?, ?, ?, ?, ?, 'viewer')", "s-"+kb.id, kb.id, tenantOrg, kb.creator, tenant.ID).Error; err != nil {
			t.Fatal(err)
		}
	}
	core.adopt = func(map[string]interface{}) (int, interface{}) { return http.StatusForbidden, map[string]string{} }
	core.answer(http.StatusOK, directoryJSON(t, "refused", dirBinding, dirTenant, map[string]string{},
		dirMember{principal: dirAda, sub: "ada", name: "Ada Lovelace", role: "ADMIN"}))
	if !runner.SyncOnce(context.Background()) {
		t.Fatal("a definite refusal does not stop the snapshot")
	}
	for _, kb := range []string{"kb-refused", "kb-orphan"} {
		if rows := f.kbShares(t, kb); len(rows) != 1 || rows[tenantOrg].KailoResourceRef != nil {
			t.Fatalf("%s: native share changed: %+v", kb, rows)
		}
	}
	if len(core.adoptions) != 1 {
		t.Fatalf("an owner outside the directory must not be adopted: %v", core.adoptions)
	}
	reasons := map[string]string{}
	for _, item := range core.lastReceipt()["failures"].([]interface{}) {
		m := item.(map[string]interface{})
		reasons[m["ref"].(string)] = m["reasonCode"].(string)
	}
	if reasons["kb-refused"] != "ADOPTION_REFUSED" || reasons["kb-orphan"] != "OWNER_NOT_MEMBER" {
		t.Fatalf("receipt failures = %v", reasons)
	}
}
