package prefixes

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"

	_ "github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"

	"github.com/pydio/cells/v5/assets"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/proto/tree"
	storagesql "github.com/pydio/cells/v5/common/storage/sql"
	"github.com/pydio/cells/v5/common/utils/uuid"
	datametasql "github.com/pydio/cells/v5/data/meta/dao/sql"
	indexsql "github.com/pydio/cells/v5/data/source/index/dao/sql"
	usermetasql "github.com/pydio/cells/v5/idm/meta/dao/sql"
	usermodel "github.com/pydio/cells/v5/idm/user/dao/sql/model"
)

// Tables of the production and isolated Cells databases installed with a
// manual DSN without the template (read 2026-10-19, names only).
var observedLegacyTables = []string{
	"accesses", "acl_nodes", "acl_roles", "acl_workspaces", "acls", "codes", "flows", "idx_trees", "jwks", "legacy_nodes",
	"meta", "meta_entities", "meta_entity_values", "meta_ns", "meta_values_rel", "node_blocks", "node_keys", "nodes", "oidcs",
	"personal_tokens", "pkces", "policies", "policy_action_rels", "policy_actions", "policy_groups", "policy_rels",
	"policy_resource_rels", "policy_resources", "policy_subject_rels", "policy_subjects", "refreshes", "resource_policies",
	"roles", "sessions", "user_attributes", "user_idx_tree", "user_keys", "user_roles", "workspaces",
}

func bootstrapStorages(t *testing.T, datasources ...string) []Storage {
	t.Helper()
	storages, err := Storages(assets.BootstrapYAML, datasources)
	if err != nil {
		t.Fatal(err)
	}
	return storages
}

func storageOf(t *testing.T, storages []Storage, name string) Storage {
	t.Helper()
	for _, s := range storages {
		if s.Service == name {
			return s
		}
	}
	t.Fatalf("bootstrap declares no SQL storage for %s", name)
	return Storage{}
}

func tablesOf(ts []target) []string {
	var out []string
	for _, t := range ts {
		out = append(out, t.table)
	}
	sort.Strings(out)
	return out
}

func sameStrings(a, b []string) bool {
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

func TestWithoutTheTemplateNodeAndUserMetaShareOneTable(t *testing.T) {
	user, err := schema.Parse(&usermetasql.Meta{}, &sync.Map{}, legacyNamer)
	if err != nil {
		t.Fatal(err)
	}
	node, err := schema.Parse(&datametasql.Meta{}, &sync.Map{}, legacyNamer)
	if err != nil {
		t.Fatal(err)
	}
	if user.Table != "meta" || node.Table != "meta" {
		t.Fatalf("legacy naming gives %q and %q", user.Table, node.Table)
	}
}

func TestBootstrapGivesEachServiceItsOwnTables(t *testing.T) {
	mapping, err := mapTables(bootstrapStorages(t, "personal", "kailobinding"))
	if err != nil {
		t.Fatal(err)
	}
	for legacy, want := range map[string][]string{
		"meta":              {"data_meta", "idm_usr_meta"},
		"resource_policies": {"idm_role_policies", "idm_user_policies", "idm_usr_meta_policies", "idm_workspace_policies"},
		"idx_trees":         {"data_index_kailobinding_idx_tree", "data_index_personal_idx_tree"},
		"oidcs":             {"oauth2_oidc"},
		"personal_tokens":   {"idm_personal_tokens"},
		"sessions":          {"idm_sessions"},
		"user_idx_tree":     {"idm_user_idx_tree"},
		"policies":          {"idm_ladon_policy"},
		"policy_rels":       {"idm_ladon_policy_rel"},
		"meta_values_rel":   {"idm_usr_meta_values_rel"},
		"nodes":             {"enc_nodes"},
	} {
		if got := tablesOf(mapping[legacy]); !sameStrings(got, want) {
			t.Errorf("%s -> %v, want %v", legacy, got, want)
		}
	}
	for _, legacy := range observedLegacyTables {
		if len(mapping[legacy]) == 0 {
			t.Errorf("observed legacy table %s has no owner", legacy)
		}
	}
}

func TestDSNTemplate(t *testing.T) {
	base := "postgres://u@cells-db:5432/cells"
	for _, c := range []struct {
		dsn  string
		want bool
	}{
		{base + "?sslmode=disable", false},
		{base + "?sslmode=disable&" + DSNTemplate, true},
		{WithTemplate(base + "?sslmode=disable"), true},
		{WithTemplate(base), true},
		{WithTemplate(base + "?"), true},
	} {
		got, err := Templated(c.dsn)
		if err != nil || got != c.want {
			t.Errorf("Templated(%q) = %v, %v; want %v", c.dsn, got, err, c.want)
		}
	}
	if WithTemplate(base+"?sslmode=disable") != base+"?sslmode=disable&"+DSNTemplate {
		t.Error("template not appended as config migration 4.9.90 does")
	}
	for _, dsn := range []string{
		base + "?prefix={{.Meta.prefix}}",
		base + "?prefix=x_&policies={{.Meta.policies}}&singular={{.Meta.singular}}",
	} {
		if _, err := Templated(dsn); err == nil {
			t.Errorf("Templated(%q) accepted", dsn)
		}
	}
}

func openSQLite(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := sql.Open(storagesql.SqliteDriver, "file:prefixes_"+uuid.New()[:8]+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func named(t *testing.T, conn *sql.DB, s Storage) *gorm.DB {
	t.Helper()
	db, err := openWith(storagesql.SqliteDriver, conn, s.Namer())
	if err != nil {
		t.Fatal(err)
	}
	return db
}

// served opens a storage as the service gets it from the pool (with the SQL
// helper the index DAO asserts).
func served(t *testing.T, conn *sql.DB, s Storage) *gorm.DB {
	t.Helper()
	db, err := openService(storagesql.SqliteDriver, conn, s.Namer())
	if err != nil {
		t.Fatal(err)
	}
	return db
}

type migrator interface {
	Migrate(context.Context) error
}

func migrate(t *testing.T, dao any) {
	t.Helper()
	m, ok := dao.(migrator)
	if !ok {
		t.Fatalf("%T has no Migrate", dao)
	}
	if err := m.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
}

var ownerPolicy = []*service.ResourcePolicy{{Subject: "user:alice", Action: service.ResourcePolicyAction_OWNER, Effect: service.ResourcePolicy_allow}}

// upsertBoth writes and overwrites one user meta and one node meta through
// the original DAOs, then reads both back.
func upsertBoth(t *testing.T, conn *sql.DB, storages []Storage, node string) {
	t.Helper()
	ctx := context.Background()
	userDB := named(t, conn, storageOf(t, storages, "pydio.grpc.user-meta"))
	nodeDB := named(t, conn, storageOf(t, storages, "pydio.grpc.meta"))
	userDAO := usermetasql.NewDAO(userDB)
	nodeDAO := datametasql.NewMetaDAO(nodeDB)
	migrate(t, userDAO)
	migrate(t, nodeDAO)

	for _, value := range []string{"true", "false"} {
		if _, _, err := userDAO.Set(ctx, &idm.UserMeta{NodeUuid: node, Namespace: "usermeta-draft", JsonValue: value, Policies: ownerPolicy}); err != nil {
			t.Fatalf("user meta upsert: %v", err)
		}
	}
	var rows []struct {
		Data []byte `gorm:"column:data"`
	}
	if err := userDB.Raw("SELECT data FROM idm_usr_meta WHERE node_uuid = ? AND namespace = ? AND owner = ?", node, "usermeta-draft", "user:alice").Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || string(rows[0].Data) != "false" {
		t.Fatalf("user meta upsert left %d row(s)", len(rows))
	}

	for _, value := range []string{`"a"`, `"b"`} {
		if err := nodeDAO.SetMetadata(ctx, node, "bob", map[string]string{"ns-node": value}); err != nil {
			t.Fatalf("node meta upsert: %v", err)
		}
	}
	got, err := nodeDAO.GetMetadata(ctx, node)
	if err != nil || got["ns-node"] != `"b"` {
		t.Fatalf("node meta read-back %v, %v", got, err)
	}

	m := userDB.Migrator()
	if !m.HasTable("idm_usr_meta") || !m.HasTable("data_meta") || m.HasTable("meta") {
		t.Fatal("node and user metadata do not live in their own tables")
	}
}

func TestBootstrapPrefixesKeepUserAndNodeMetaUpsertsApart(t *testing.T) {
	upsertBoth(t, openSQLite(t), bootstrapStorages(t), "node-1")
}

// legacyFixture reproduces a database installed without the template: the
// DAOs created their tables with empty prefixes, node metadata added its
// columns and indexes to the user metadata table, every index and every
// policy owner wrote one table.
func legacyFixture(t *testing.T, conn *sql.DB) {
	t.Helper()
	db := named(t, conn, Storage{})
	exec := func(statement string, args ...any) {
		t.Helper()
		if err := db.Exec(statement, args...).Error; err != nil {
			t.Fatalf("%s: %v", statement, err)
		}
	}
	migrate(t, usermetasql.NewDAO(db))
	exec("ALTER TABLE meta ADD COLUMN node_id varchar(255) NOT NULL DEFAULT ''")
	exec("ALTER TABLE meta ADD COLUMN author varchar(255)")
	for _, idx := range []string{"CREATE INDEX idx_meta_node_id ON meta(node_id)", "CREATE INDEX idx_meta_auth ON meta(author)",
		"CREATE INDEX idx_meta_ts ON meta(timestamp)", "CREATE INDEX idx_meta_fmt ON meta(format)"} {
		exec(idx)
	}
	if err := db.AutoMigrate(&idm.Role{}, &idm.Workspace{}, &usermodel.User{}, &usermodel.UserRole{}, &usermodel.UserAttribute{}, &tree.TreeNode{}); err != nil {
		t.Fatal(err)
	}
	exec("INSERT INTO meta (uuid, node_uuid, namespace, owner, timestamp, format, data) VALUES ('um-1', 'node-1', 'usermeta-draft', 'user:alice', 1, 'json', 'true')")
	exec("INSERT INTO meta (uuid, node_uuid, namespace, owner, timestamp, format, data, node_id, author) VALUES ('', '', 'ns-node', '', 1, 'json', '\"x\"', 'node-2', 'bob')")
	for _, row := range []any{
		&idm.Role{Uuid: "role-1", Label: "role"},
		&idm.Role{Uuid: "user-1", Label: "alice"},
		&idm.Workspace{UUID: "ws-1", Slug: "ws", Label: "ws"},
		&usermetasql.MetaNamespace{Namespace: "usermeta-draft", Label: "Draft"},
		&service.ResourcePolicy{Resource: "role-1", Action: service.ResourcePolicyAction_READ, Subject: "*"},
		&service.ResourcePolicy{Resource: "user-1", Action: service.ResourcePolicyAction_WRITE, Subject: "user:alice"},
		&service.ResourcePolicy{Resource: "ws-1", Action: service.ResourcePolicyAction_READ, Subject: "*"},
		&service.ResourcePolicy{Resource: "usermeta-draft", Action: service.ResourcePolicyAction_WRITE, Subject: "*"},
		&service.ResourcePolicy{Resource: "um-1", Action: service.ResourcePolicyAction_OWNER, Subject: "user:alice"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	node := func(table, id, name string, leaf, level int, mpath string, size int64) {
		exec("INSERT INTO "+table+" (uuid, leaf, size, mtime, mode, etag, name, level, mpath1, mpath2, mpath3, mpath4, hash, hash2) VALUES (?, ?, ?, 0, '', '', ?, ?, ?, '', '', '', ?, ?)",
			id, leaf, size, name, level, mpath, "h-"+id, "h2-"+id)
	}
	node("user_idx_tree", "user-1", "alice", 1, 2, "1.1", 0)
	node("idx_trees", "ROOT", "", 2, 1, "1", 999)
	node("idx_trees", "f-alice", "alice", 2, 2, "1.1", 999)
	node("idx_trees", "11111111-1111-1111-1111-111111111111", "a.txt", 1, 3, "1.1.1", 10)
	node("idx_trees", "f-bind", "bind", 2, 2, "1.2", 999)
	node("idx_trees", "22222222-2222-2222-2222-222222222222", "kept.txt", 1, 3, "1.2.1", 7)
	node("idx_trees", "33333333-3333-3333-3333-333333333333", "stray.txt", 1, 3, "1.2.2", 13)
	node("idx_trees", "f-zed", "zed", 2, 2, "1.10", 999)
	node("idx_trees", "44444444-4444-4444-4444-444444444444", "z.txt", 1, 3, "1.10.1", 5)
}

// objects places flat LOCAL objects (named by node UUID) in each datasource folder.
func objects(t *testing.T, placed map[string][]string) map[string]Source {
	t.Helper()
	root := t.TempDir()
	sources := map[string]Source{}
	for _, ds := range []string{"personal", "kailobinding", "pydiods1"} {
		folder := filepath.Join(root, ds)
		if err := os.MkdirAll(folder, 0o700); err != nil {
			t.Fatal(err)
		}
		for _, id := range placed[ds] {
			if err := os.WriteFile(filepath.Join(folder, id), []byte("content"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		sources[ds] = Source{Local: true, Flat: true, Folder: folder}
	}
	return sources
}

func rowCount(t *testing.T, db *gorm.DB, table, where string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := db.Raw("SELECT COUNT(*) FROM "+table+" WHERE "+where, args...).Scan(&n).Error; err != nil {
		t.Fatalf("%s: %v", table, err)
	}
	return n
}

func TestMoveSplitsALegacyDatabaseIntoTheOwnersTables(t *testing.T) {
	ctx := context.Background()
	conn := openSQLite(t)
	legacyFixture(t, conn)
	storages := bootstrapStorages(t, "kailobinding", "personal", "pydiods1")
	db, err := Open(storagesql.SqliteDriver, conn)
	if err != nil {
		t.Fatal(err)
	}
	opts := Options{
		IndexAssign:      map[string][]string{"kailobinding": {"bind"}},
		IndexUserFolders: "personal",
		Sources: objects(t, map[string][]string{
			"personal":     {"11111111-1111-1111-1111-111111111111"},
			"kailobinding": {"22222222-2222-2222-2222-222222222222"},
			// stray.txt was written through another datasource.
			"pydiods1": {"33333333-3333-3333-3333-333333333333", "44444444-4444-4444-4444-444444444444"},
		}),
	}

	// zed is assigned to nobody and stray.txt has no object in kailobinding:
	// refused, nothing changed.
	if _, err := Apply(ctx, db, storagesql.SqliteDriver, storages, opts); !errors.Is(err, ErrRefused) {
		t.Fatalf("incomplete decisions not refused: %v", err)
	}
	plan, err := Inspect(ctx, db, storagesql.SqliteDriver, storages, opts)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.Pending || len(plan.Problems) != 2 || !db.Migrator().HasTable("meta") || !db.Migrator().HasTable("idx_trees") {
		t.Fatalf("refusal changed the database or missed a problem: %v", plan.Problems)
	}

	opts.IndexAssign["pydiods1"] = []string{"zed"}
	opts.IndexDropUnbacked = true
	plan, err = Apply(ctx, db, storagesql.SqliteDriver, storages, opts)
	if err != nil {
		t.Fatalf("move failed: %v (%v)", err, plan)
	}

	m := db.Migrator()
	for _, legacy := range []string{"meta", "resource_policies", "idx_trees", "roles", "workspaces", "user_idx_tree", "meta_ns"} {
		if m.HasTable(legacy) {
			t.Errorf("legacy table %s remains", legacy)
		}
	}
	for table, want := range map[string]int64{
		"idm_usr_meta":                     1,
		"data_meta":                        1,
		"idm_role_policies":                2, // role-1 and the role of user-1
		"idm_user_policies":                1, // user-1, read by both services today
		"idm_workspace_policies":           1,
		"idm_usr_meta_policies":            4, // bookmark (2), usermeta-draft, um-1
		"data_index_personal_idx_tree":     3, // root, alice, a.txt
		"data_index_kailobinding_idx_tree": 3, // root, bind, kept.txt (stray.txt dropped)
		"data_index_pydiods1_idx_tree":     3, // root, zed (1.10, not under alice 1.1), z.txt
		"idm_roles":                        2,
		"idm_workspaces":                   1,
		"idm_user_idx_tree":                1,
		"idm_usr_meta_ns":                  2, // bookmark (seeded by the DAO), usermeta-draft
	} {
		if got := rowCount(t, db, table, "1 = 1"); got != want {
			t.Errorf("%s has %d row(s), want %d", table, got, want)
		}
	}
	if rowCount(t, db, "data_meta", "node_id = ? AND author = ?", "node-2", "bob") != 1 {
		t.Error("node meta row not moved with its columns")
	}
	if m.HasColumn("idm_usr_meta", "node_id") || m.HasColumn("idm_usr_meta", "author") {
		t.Error("node meta columns left on the user meta table")
	}
	if rowCount(t, db, "data_index_kailobinding_idx_tree", "uuid = ?", "33333333-3333-3333-3333-333333333333") != 0 {
		t.Error("unbacked leaf moved")
	}
	for table, size := range map[string]int64{"data_index_personal_idx_tree": 10, "data_index_kailobinding_idx_tree": 7, "data_index_pydiods1_idx_tree": 5} {
		if rowCount(t, db, table, "uuid = ? AND size = ?", "ROOT", size) != 1 {
			t.Errorf("%s root size not recomputed from its own leaves", table)
		}
	}

	after, err := Inspect(ctx, db, storagesql.SqliteDriver, storages, opts)
	if err != nil || after.Pending {
		t.Fatalf("move not complete: %v %v", err, after)
	}
	// Both upsert paths now work on the moved tables.
	upsertBoth(t, conn, storages, "node-1")
	if rowCount(t, db, "idm_usr_meta", "uuid = ?", "um-1") != 1 {
		t.Error("existing user meta row was not kept")
	}
}

// hasIndexRoot checks a datasource index table holds exactly the root its
// service creates (data/source/index/dao/sql Migrate) and that the index DAO
// resolves "/" to it.
func hasIndexRoot(t *testing.T, conn *sql.DB, st Storage, table string, nodes int64) {
	t.Helper()
	db := served(t, conn, st)
	if !db.Migrator().HasTable(table) {
		t.Fatalf("%s was not created", table)
	}
	if got := rowCount(t, db, table, "1 = 1"); got != nodes {
		t.Fatalf("%s has %d row(s), want %d", table, got, nodes)
	}
	if rowCount(t, db, table, "uuid = ? AND level = 1 AND mpath1 = ?", "ROOT", "1") != 1 {
		t.Fatalf("%s has no ROOT at mpath 1", table)
	}
	root, err := indexsql.NewDAO(db).GetNodeByPath(context.Background(), "/")
	if err != nil || root.GetNode().GetUuid() != "ROOT" {
		t.Fatalf("%s: the index DAO does not resolve its root: %v", table, err)
	}
}

// A datasource without any top-level entry in the shared index (production
// pydiods1, cellsdata, thumbnails, versions) gets its table and root from the
// move: its index service, whose migration is already recorded, never
// creates them.
func TestMoveCreatesTheIndexOfADatasourceWithoutEntries(t *testing.T) {
	ctx := context.Background()
	conn := openSQLite(t)
	legacyFixture(t, conn)
	storages := bootstrapStorages(t, "cellsdata", "kailobinding", "personal", "pydiods1")
	db, err := Open(storagesql.SqliteDriver, conn)
	if err != nil {
		t.Fatal(err)
	}
	opts := Options{
		IndexAssign:       map[string][]string{"kailobinding": {"bind"}, "pydiods1": {"zed"}},
		IndexUserFolders:  "personal",
		IndexDropUnbacked: true,
		Sources: objects(t, map[string][]string{
			"personal":     {"11111111-1111-1111-1111-111111111111"},
			"kailobinding": {"22222222-2222-2222-2222-222222222222"},
			"pydiods1":     {"44444444-4444-4444-4444-444444444444"},
		}),
	}
	opts.Sources["cellsdata"] = Source{Local: true, Flat: true, Folder: t.TempDir()}

	plan, err := Inspect(ctx, db, storagesql.SqliteDriver, storages, opts)
	if err != nil || len(plan.Problems) > 0 {
		t.Fatalf("plan: %v %v", err, plan)
	}
	if got := plan.IndexRoots(); !sameStrings(got, []string{"data_index_cellsdata_idx_tree"}) {
		t.Fatalf("index roots to create: %v", got)
	}
	if _, err := Apply(ctx, db, storagesql.SqliteDriver, storages, opts); err != nil {
		t.Fatalf("move failed: %v", err)
	}
	hasIndexRoot(t, conn, storageOf(t, storages, "pydio.grpc.data.index.cellsdata"), "data_index_cellsdata_idx_tree", 1)
	if rowCount(t, db, "data_index_pydiods1_idx_tree", "1 = 1") != 3 {
		t.Error("the split index of pydiods1 changed")
	}

	after, err := Inspect(ctx, db, storagesql.SqliteDriver, storages, opts)
	if err != nil || after.Changes() {
		t.Fatalf("move not complete: %v %v", err, after)
	}
}

// A database already moved by a release that left the indexes without entries
// uncreated: the indexes whose migration is recorded are completed (additive,
// the existing index untouched); an index whose migration is not recorded is
// left to its service's first start.
func TestCompletesTheIndexesAMoveLeftWithoutTable(t *testing.T) {
	ctx := context.Background()
	conn := openSQLite(t)
	storages := bootstrapStorages(t, "cellsdata", "kailobinding", "pydiods1")
	binding := storageOf(t, storages, "pydio.grpc.data.index.kailobinding")
	migrate(t, indexsql.NewDAO(served(t, conn, binding)))
	if _, _, err := indexsql.NewDAO(served(t, conn, binding)).GetOrCreateNodeByPath(ctx, "/kailo-binding", &tree.Node{Uuid: "f-bind", Type: tree.NodeType_COLLECTION}); err != nil {
		t.Fatal(err)
	}
	db, err := Open(storagesql.SqliteDriver, conn)
	if err != nil {
		t.Fatal(err)
	}
	opts := Options{IndexMigrated: map[string]bool{"kailobinding": true, "pydiods1": true}}

	plan, err := Inspect(ctx, db, storagesql.SqliteDriver, storages, opts)
	if err != nil || plan.Pending || len(plan.Problems) > 0 {
		t.Fatalf("plan: %v %v", err, plan)
	}
	if got := plan.IndexRoots(); !sameStrings(got, []string{"data_index_pydiods1_idx_tree"}) {
		t.Fatalf("index roots to create: %v", got)
	}
	if _, err := Apply(ctx, db, storagesql.SqliteDriver, storages, opts); err != nil {
		t.Fatalf("completion failed: %v", err)
	}
	hasIndexRoot(t, conn, storageOf(t, storages, "pydio.grpc.data.index.pydiods1"), "data_index_pydiods1_idx_tree", 1)
	hasIndexRoot(t, conn, binding, "data_index_kailobinding_idx_tree", 2)
	if db.Migrator().HasTable("data_index_cellsdata_idx_tree") {
		t.Error("index without a recorded migration created ahead of its service")
	}

	after, err := Inspect(ctx, db, storagesql.SqliteDriver, storages, opts)
	if err != nil || after.Changes() {
		t.Fatalf("completion not idempotent: %v %v", err, after)
	}
	// The service's own migration on the completed table changes nothing.
	migrate(t, indexsql.NewDAO(served(t, conn, storageOf(t, storages, "pydio.grpc.data.index.pydiods1"))))
	hasIndexRoot(t, conn, storageOf(t, storages, "pydio.grpc.data.index.pydiods1"), "data_index_pydiods1_idx_tree", 1)
}
