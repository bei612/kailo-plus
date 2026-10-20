// Package prefixes moves a Cells SQL database that was installed with a manual
// DSN lacking the upstream per-service table template to the tables every
// service owns when the template is present.
//
// Upstream appends "prefix={{.Meta.prefix}}&policies={{.Meta.policies}}&
// singular={{.Meta.singular}}" to every SQL DSN it builds
// (discovery/install/lib/database.go dsnFromInstallConfig, config migration
// 4.9.90) and its docker examples carry it in their manual DSN. Each service
// storage then receives its own table prefix, policies table and naming from
// the bootstrap (assets/start.yaml), e.g. data_meta for the node metadata of
// pydio.grpc.meta and idm_usr_meta for the user metadata of
// pydio.grpc.user-meta. A manual DSN without the template is used verbatim
// (dsnFromInstallConfig "manual"), every storage then gets an empty prefix and
// services whose models share a table name write one table: meta (node and
// user metadata), resource_policies (roles, users, workspaces, user metadata)
// and idx_trees (the index of every datasource).
//
// The move is computed from the same GORM models and naming the services use,
// runs in one transaction and never guesses: a row is placed only where an
// explicit rule puts it, anything else is reported and refuses the move.
//
// A datasource index creates its table and root only in the storage migration
// of its service (data/source/index/service: FirstRunOrChange, recorded under
// versions/pydio.grpc.data.index.<datasource>), i.e. on the first start of
// that datasource index or on a version change; nothing creates them on
// access. On an installed database every index version is recorded, so the
// move creates the table and root of each datasource index the split leaves
// without entries with the index DAO's own Migrate, and completes any
// datasource index whose table is missing while its version is recorded.
package prefixes

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"sync"
	"text/template"

	"github.com/glebarez/sqlite"
	"gopkg.in/yaml.v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"

	"github.com/pydio/cells/v5/common/proto/encryption"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/service/frontend/sessions/sqlsessions"
	storagesql "github.com/pydio/cells/v5/common/storage/sql"
	datakeysql "github.com/pydio/cells/v5/data/key/dao/sql"
	datametasql "github.com/pydio/cells/v5/data/meta/dao/sql"
	indexsql "github.com/pydio/cells/v5/data/source/index/dao/sql"
	syncsql "github.com/pydio/cells/v5/data/source/sync/dao/sql"
	aclsql "github.com/pydio/cells/v5/idm/acl/dao/sql"
	userkeysql "github.com/pydio/cells/v5/idm/key/dao/sql"
	usermetasql "github.com/pydio/cells/v5/idm/meta/dao/sql"
	oauthsql "github.com/pydio/cells/v5/idm/oauth/dao/sql"
	usermodel "github.com/pydio/cells/v5/idm/user/dao/sql/model"
)

// DSNTemplate is the query upstream appends to every SQL DSN.
const DSNTemplate = "prefix={{.Meta.prefix}}&policies={{.Meta.policies}}&singular={{.Meta.singular}}"

var templateVars = []string{"prefix", "policies", "singular"}

// ErrRefused is returned by Apply when the plan reports problems.
var ErrRefused = errors.New("table move refused")

// Templated reports whether a stored SQL DSN carries the upstream template.
// A DSN carrying only part of it, or other values for these keys, is refused.
// Errors never quote the DSN.
func Templated(dsn string) (bool, error) {
	_, query, _ := strings.Cut(dsn, "?")
	values, err := url.ParseQuery(query)
	if err != nil {
		return false, errors.New("stored SQL DSN query cannot be parsed")
	}
	found := 0
	for _, key := range templateVars {
		if v, ok := values[key]; ok {
			if len(v) != 1 || v[0] != "{{.Meta."+key+"}}" {
				return false, fmt.Errorf("stored SQL DSN sets %s to something other than the upstream template", key)
			}
			found++
		}
	}
	switch found {
	case 0:
		return false, nil
	case len(templateVars):
		return true, nil
	}
	return false, errors.New("stored SQL DSN carries only part of the upstream template")
}

// WithTemplate appends the upstream template to a DSN, as config migration
// 4.9.90 appendQueryPart does.
func WithTemplate(dsn string) string {
	switch {
	case strings.HasSuffix(dsn, "?"):
		return dsn + DSNTemplate
	case strings.Contains(dsn, "?"):
		return dsn + "&" + DSNTemplate
	}
	return dsn + "?" + DSNTemplate
}

// Storage is the SQL storage of one service as the bootstrap declares it.
type Storage struct {
	Service    string
	Datasource string
	Prefix     string
	Policies   string
	Singular   bool
}

// Namer is the table naming this storage gets from a templated DSN.
func (s Storage) Namer() schema.Namer {
	return storagesql.NewNamingStrategy(s.Prefix, s.Policies, s.Singular)
}

const (
	indexService = "pydio.grpc.data.index"
	syncService  = "pydio.grpc.data.sync"
)

// legacyNamer is the naming of every storage opened with a DSN without the template.
var legacyNamer = storagesql.NewNamingStrategy("", "", false)

// serviceModels lists the GORM models each service's SQL DAO migrates (the
// AutoMigrate/WithModels calls of the DAOs and the join models they set up).
func serviceModels(name string) []any {
	switch name {
	case "pydio.grpc.oauth", "pydio.web.oauth":
		return []any{&oauthsql.Flow{}, &oauthsql.OAuth2RequestSQLOIDC{}, &oauthsql.OAuth2RequestSQLAccess{},
			&oauthsql.OAuth2RequestSQLRefresh{}, &oauthsql.OAuth2RequestSQLCode{}, &oauthsql.OAuth2RequestSQLPKCE{}, &oauthsql.SqlJWK{}}
	case "pydio.grpc.token":
		return []any{&oauthsql.PersonalToken{}}
	case "pydio.rest.frontend":
		return []any{&sqlsessions.SessionRow{}}
	case "pydio.grpc.data-key":
		return []any{&encryption.Node{}, &encryption.NodeKey{}, &encryption.RangedBlock{}, &datakeysql.RangedBlockLegacy{}}
	case "pydio.grpc.role":
		return []any{&idm.Role{}, &service.ResourcePolicy{}}
	case "pydio.grpc.acl":
		return []any{&aclsql.ACL{}, &aclsql.Role{}, &aclsql.Workspace{}, &aclsql.Node{}}
	case "pydio.grpc.user":
		return []any{&usermodel.User{}, &usermodel.UserRole{}, &usermodel.UserAttribute{}, &service.ResourcePolicy{}}
	case "pydio.grpc.user-key":
		return []any{&userkeysql.UserKey{}}
	case "pydio.grpc.workspace":
		return []any{&idm.Workspace{}, &service.ResourcePolicy{}}
	case "pydio.grpc.meta":
		return []any{&datametasql.Meta{}}
	case "pydio.grpc.policy":
		return []any{&idm.PolicyAction{}, &idm.PolicyResource{}, &idm.PolicySubject{}, &idm.Policy{}, &idm.PolicyGroup{},
			&idm.PolicyRel{}, &idm.PolicyActionRel{}, &idm.PolicyResourceRel{}, &idm.PolicySubjectRel{}}
	case "pydio.grpc.user-meta":
		return []any{&usermetasql.Meta{}, &usermetasql.MetaNamespace{}, &usermetasql.Entities{}, &usermetasql.EntityValues{},
			&usermetasql.MetaValuesRel{}, &service.ResourcePolicy{}}
	case indexService:
		return []any{&tree.TreeNode{}}
	case syncService:
		return []any{&syncsql.Checksum{}}
	}
	return nil
}

// withoutSQLDAO are bootstrap services declaring an SQL storage that no DAO of
// this release opens.
var withoutSQLDAO = map[string]bool{"pydio.grpc.key": true}

func modelsOf(s Storage) []any {
	if s.Datasource != "" {
		return serviceModels(strings.TrimSuffix(s.Service, "."+s.Datasource))
	}
	return serviceModels(s.Service)
}

// Storages returns the SQL storages the bootstrap declares, the per-datasource
// ones expanded for the given datasource names.
func Storages(bootstrapYAML string, datasources []string) ([]Storage, error) {
	var doc struct {
		Services map[string]struct {
			Storages map[string][]map[string]any `yaml:"storages"`
		} `yaml:"services"`
	}
	if err := yaml.Unmarshal([]byte(bootstrapYAML), &doc); err != nil {
		return nil, fmt.Errorf("bootstrap cannot be parsed: %w", err)
	}
	var names []string
	for name := range doc.Services {
		names = append(names, name)
	}
	sort.Strings(names)
	var out []Storage
	declared := map[string]bool{}
	for _, name := range names {
		def, found, err := sqlStorage(doc.Services[name].Storages)
		if err != nil {
			return nil, fmt.Errorf("bootstrap service %s: %w", name, err)
		}
		if !found {
			continue
		}
		declared[name] = true
		switch {
		case name == indexService || name == syncService:
			for _, ds := range datasources {
				prefix, err := expandDatasource(def["prefix"], ds)
				if err != nil {
					return nil, fmt.Errorf("bootstrap service %s: %w", name, err)
				}
				out = append(out, Storage{Service: name + "." + ds, Datasource: ds, Prefix: prefix, Policies: def["policies"], Singular: def["singular"] == "true"})
			}
		case serviceModels(name) != nil:
			if strings.Contains(def["prefix"]+def["policies"], "{{") {
				return nil, fmt.Errorf("bootstrap service %s: unexpected template in its SQL storage", name)
			}
			out = append(out, Storage{Service: name, Prefix: def["prefix"], Policies: def["policies"], Singular: def["singular"] == "true"})
		case withoutSQLDAO[name]:
		default:
			return nil, fmt.Errorf("bootstrap service %s declares an SQL storage whose models this move does not know", name)
		}
	}
	for _, name := range []string{"pydio.grpc.oauth", "pydio.web.oauth", "pydio.grpc.token", "pydio.rest.frontend", "pydio.grpc.data-key",
		"pydio.grpc.role", "pydio.grpc.acl", "pydio.grpc.user", "pydio.grpc.user-key", "pydio.grpc.workspace", "pydio.grpc.meta",
		"pydio.grpc.policy", "pydio.grpc.user-meta", indexService, syncService} {
		if !declared[name] {
			return nil, fmt.Errorf("bootstrap declares no SQL storage for %s", name)
		}
	}
	return out, nil
}

func sqlStorage(storages map[string][]map[string]any) (map[string]string, bool, error) {
	var found map[string]string
	for _, list := range storages {
		for _, entry := range list {
			if fmt.Sprint(entry["type"]) != "sql" {
				continue
			}
			if found != nil {
				return nil, false, errors.New("several SQL storages")
			}
			found = map[string]string{}
			for k, v := range entry {
				found[k] = fmt.Sprint(v)
			}
		}
	}
	return found, found != nil, nil
}

func expandDatasource(prefix, datasource string) (string, error) {
	t, err := template.New("prefix").Option("missingkey=error").Parse(prefix)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	if err := t.Execute(&b, map[string]string{"DataSource": datasource}); err != nil {
		return "", err
	}
	return b.String(), nil
}

// target is one table a legacy table must become.
type target struct {
	storage Storage
	model   any
	table   string
}

// mapTables maps every legacy (unprefixed) table name to the tables the
// storages own under their own naming.
func mapTables(storages []Storage) (map[string][]target, error) {
	legacyCache := &sync.Map{}
	out := map[string][]target{}
	for _, st := range storages {
		cache := &sync.Map{}
		for _, model := range modelsOf(st) {
			src, err := schema.Parse(model, legacyCache, legacyNamer)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", st.Service, err)
			}
			dst, err := schema.Parse(model, cache, st.Namer())
			if err != nil {
				return nil, fmt.Errorf("%s: %w", st.Service, err)
			}
			duplicate := false
			for _, t := range out[src.Table] {
				duplicate = duplicate || t.table == dst.Table
			}
			if !duplicate {
				out[src.Table] = append(out[src.Table], target{storage: st, model: model, table: dst.Table})
			}
		}
	}
	return out, nil
}

// Source is the object layout of one datasource, from the configuration.
type Source struct {
	Local      bool
	Flat       bool
	Folder     string
	BaseFolder string
}

// Options are the explicit operator decisions the index split needs.
type Options struct {
	// IndexAssign maps a datasource to the top-level index entries it owns.
	IndexAssign map[string][]string
	// IndexUserFolders is the datasource owning the top-level folders named
	// after a user login (the personal folders of the my-files template).
	IndexUserFolders string
	// IndexDropUnbacked drops index leaves whose object is not in the
	// storage of the datasource they are assigned to.
	IndexDropUnbacked bool
	// Sources is the object layout of every datasource.
	Sources map[string]Source
	// IndexMigrated holds the datasources whose index service has recorded
	// its storage migration (versions/pydio.grpc.data.index.<datasource>):
	// it does not create a missing table or root again.
	IndexMigrated map[string]bool
}

type rename struct {
	from string
	to   target
}

type policyTarget struct {
	target
	where string
	rows  int64
}

type policySplit struct {
	from    string
	targets []*policyTarget
	shared  int64
}

type indexEntry struct {
	UUID  string `gorm:"column:uuid"`
	Name  string `gorm:"column:name"`
	Leaf  int    `gorm:"column:leaf"`
	MPath string `gorm:"column:mpath"`
}

type indexTarget struct {
	target
	entries  []indexEntry
	nodes    int64
	unbacked []string
	dropIDs  []string
}

type indexSplit struct {
	from    string
	targets []*indexTarget
}

type columnTarget struct {
	target
	legacy  *schema.Schema
	where   string
	rows    int64
	primary bool
}

type columnSplit struct {
	from        string
	targets     []*columnTarget
	dropColumns []string
	dropIndexes []string
}

// Plan is what a move does on the current database.
type Plan struct {
	// Pending is true while legacy tables remain.
	Pending  bool
	Problems []string
	Notes    []string
	renames  []rename
	policies []*policySplit
	indexes  []*indexSplit
	columns  []*columnSplit
	// roots are the datasource indexes whose table and root no service will
	// create: they are created as the index service's own migration does.
	roots []target
}

// Changes is true while legacy tables remain or a datasource index lacks its
// table and root.
func (p *Plan) Changes() bool {
	return p.Pending || len(p.roots) > 0
}

// IndexRoots are the tables of the datasource indexes the move creates with
// their root.
func (p *Plan) IndexRoots() []string {
	var out []string
	for _, t := range p.roots {
		out = append(out, t.table)
	}
	return out
}

func (p *Plan) problem(format string, args ...any) {
	p.Problems = append(p.Problems, fmt.Sprintf(format, args...))
}

func (p *Plan) note(format string, args ...any) {
	p.Notes = append(p.Notes, fmt.Sprintf(format, args...))
}

// Report writes the plan; only table, datasource and index entry names and
// counts are written.
func (p *Plan) Report(w io.Writer) {
	if !p.Pending {
		fmt.Fprintln(w, "No legacy unprefixed table remains")
	}
	for _, r := range p.renames {
		fmt.Fprintf(w, "rename %s -> %s (%s)\n", r.from, r.to.table, r.to.storage.Service)
	}
	for _, s := range p.policies {
		fmt.Fprintf(w, "split %s by the owner of each policy resource:\n", s.from)
		for _, t := range s.targets {
			fmt.Fprintf(w, "  %d row(s) -> %s (%s)\n", t.rows, t.table, t.storage.Service)
		}
		if s.shared > 0 {
			fmt.Fprintf(w, "  %d row(s) whose resource several services own (a user and its own role share one UUID) are copied to each, as each service reads them today\n", s.shared)
		}
	}
	for _, s := range p.indexes {
		fmt.Fprintf(w, "split %s by datasource:\n", s.from)
		for _, t := range s.targets {
			if len(t.entries) == 0 {
				fmt.Fprintf(w, "  %s: no entry (created below with its root)\n", t.table)
				continue
			}
			var names []string
			for _, e := range t.entries {
				names = append(names, fmt.Sprintf("%q", e.Name))
			}
			fmt.Fprintf(w, "  %s <- root + %s (%d node(s))\n", t.table, strings.Join(names, ", "), t.nodes)
			for _, u := range t.unbacked {
				fmt.Fprintf(w, "    leaf without its object in %s: %s\n", t.storage.Datasource, u)
			}
		}
	}
	for _, s := range p.columns {
		fmt.Fprintf(w, "split %s by the primary key each row carries:\n", s.from)
		for _, t := range s.targets {
			role := "created"
			if t.primary {
				role = "renamed, keeps the table"
			}
			fmt.Fprintf(w, "  %d row(s) -> %s (%s, %s)\n", t.rows, t.table, t.storage.Service, role)
		}
		if len(s.dropColumns) > 0 {
			fmt.Fprintf(w, "  columns of the other owner removed from the kept table: %s\n", strings.Join(s.dropColumns, ", "))
		}
	}
	for _, t := range p.roots {
		fmt.Fprintf(w, "create %s with its root (%s): its index service only creates them in its first-run or version-change migration\n", t.table, t.storage.Service)
	}
	for _, n := range p.Notes {
		fmt.Fprintf(w, "note: %s\n", n)
	}
	for _, problem := range p.Problems {
		fmt.Fprintf(w, "REFUSED: %s\n", problem)
	}
}

// Open returns a GORM handle with the naming of a DSN without the template.
// Only drivers with transactional DDL are accepted.
func Open(driver string, conn gorm.ConnPool) (*gorm.DB, error) {
	return openWith(driver, conn, legacyNamer)
}

func openWith(driver string, conn gorm.ConnPool, namer schema.Namer) (*gorm.DB, error) {
	var dialector gorm.Dialector
	switch driver {
	case storagesql.PostgreDriver:
		dialector = postgres.New(postgres.Config{Conn: conn})
	case storagesql.SqliteDriver:
		dialector = &sqlite.Dialector{Conn: conn}
	default:
		return nil, fmt.Errorf("SQL driver %s is not supported: the move needs transactional DDL (PostgreSQL or SQLite)", driver)
	}
	return gorm.Open(dialector, &gorm.Config{
		NamingStrategy:         namer,
		SkipDefaultTransaction: true,
		DisableAutomaticPing:   true,
		Logger:                 logger.Default.LogMode(logger.Silent),
	})
}

type run struct {
	ctx         context.Context
	driver      string
	storages    []Storage
	tx          *gorm.DB
	opts        Options
	mapping     map[string][]target
	tables      map[string]bool
	legacyCache *sync.Map
	savepoints  int
}

// Inspect computes the move in a transaction that is rolled back.
func Inspect(ctx context.Context, db *gorm.DB, driver string, storages []Storage, opts Options) (*Plan, error) {
	var plan *Plan
	err := within(ctx, db, driver, storages, opts, false, func(r *run) error {
		var err error
		plan, err = r.plan()
		return err
	})
	return plan, err
}

// Apply computes the move and executes it in one transaction; nothing is
// changed when the plan reports a problem (ErrRefused).
func Apply(ctx context.Context, db *gorm.DB, driver string, storages []Storage, opts Options) (*Plan, error) {
	var plan *Plan
	err := within(ctx, db, driver, storages, opts, true, func(r *run) error {
		var err error
		if plan, err = r.plan(); err != nil {
			return err
		}
		if len(plan.Problems) > 0 {
			return ErrRefused
		}
		return r.apply(plan)
	})
	return plan, err
}

func within(ctx context.Context, db *gorm.DB, driver string, storages []Storage, opts Options, commit bool, f func(*run) error) error {
	mapping, err := mapTables(storages)
	if err != nil {
		return err
	}
	tx := db.WithContext(ctx).Begin()
	if tx.Error != nil {
		return tx.Error
	}
	r := &run{ctx: ctx, driver: driver, storages: storages, tx: tx, opts: opts, mapping: mapping, legacyCache: &sync.Map{}}
	if err := f(r); err != nil {
		tx.Rollback()
		return err
	}
	if !commit {
		return tx.Rollback().Error
	}
	return tx.Commit().Error
}

// view is a handle on the same transaction with another storage naming.
func (r *run) view(namer schema.Namer) (*gorm.DB, error) {
	return openWith(r.driver, r.tx.Statement.ConnPool, namer)
}

func (r *run) q(name string) string {
	return r.tx.Statement.Quote(name)
}

func (r *run) legacySchema(model any) (*schema.Schema, error) {
	return schema.Parse(model, r.legacyCache, legacyNamer)
}

func (r *run) count(table, where string, args ...any) (int64, error) {
	var n int64
	err := r.tx.Raw("SELECT COUNT(*) FROM "+r.q(table)+" WHERE "+where, args...).Scan(&n).Error
	return n, err
}

func (r *run) plan() (*Plan, error) {
	names, err := r.tx.Migrator().GetTables()
	if err != nil {
		return nil, err
	}
	r.tables = map[string]bool{}
	for _, name := range names {
		if !strings.HasPrefix(name, "sqlite_") {
			r.tables[name] = true
		}
	}
	targets := map[string]bool{}
	for _, ts := range r.mapping {
		for _, t := range ts {
			targets[t.table] = true
		}
	}
	var present []string
	for legacy := range r.mapping {
		if r.tables[legacy] {
			present = append(present, legacy)
		}
	}
	sort.Strings(present)
	p := &Plan{Pending: len(present) > 0}
	if p.Pending {
		if err := r.planMove(p, present, targets); err != nil {
			return nil, err
		}
	}
	if err := r.planRoots(p); err != nil {
		return nil, err
	}
	return p, nil
}

func (r *run) planMove(p *Plan, present []string, targets map[string]bool) error {
	var unknown []string
	for name := range r.tables {
		if _, legacy := r.mapping[name]; !legacy && !targets[name] {
			unknown = append(unknown, name)
		}
	}
	sort.Strings(unknown)
	for _, name := range unknown {
		p.problem("table %s belongs to no service storage known to this release; it would be left without its prefix", name)
	}
	for _, from := range present {
		ts := r.mapping[from]
		for _, t := range ts {
			if r.tables[t.table] {
				p.problem("table %s already exists while legacy table %s remains (did a service start with the template before the move?)", t.table, from)
			}
		}
		if len(ts) == 1 {
			p.renames = append(p.renames, rename{from: from, to: ts[0]})
			continue
		}
		switch splitKind(ts) {
		case kindPolicies:
			s, err := r.planPolicies(p, from, ts)
			if err != nil {
				return err
			}
			p.policies = append(p.policies, s)
		case kindIndex:
			s, err := r.planIndex(p, from, ts)
			if err != nil {
				return err
			}
			p.indexes = append(p.indexes, s)
		case kindColumns:
			s, err := r.planColumns(p, from, ts)
			if err != nil {
				return err
			}
			p.columns = append(p.columns, s)
		default:
			var owners []string
			for _, t := range ts {
				owners = append(owners, t.storage.Service)
			}
			p.problem("legacy table %s is shared by %s and no rule splits it", from, strings.Join(owners, ", "))
		}
	}
	return nil
}

// planRoots lists the datasource indexes whose table neither exists nor comes
// out of the move while their service will not create it: during a move (the
// index service already ran on the shared table) or once the service has
// recorded its migration. A datasource index without a recorded migration
// creates its own table and root on its first start.
func (r *run) planRoots(p *Plan) error {
	produced := map[string]bool{}
	for _, rn := range p.renames {
		produced[rn.to.table] = true
	}
	for _, s := range p.indexes {
		for _, t := range s.targets {
			if len(t.entries) > 0 {
				produced[t.table] = true
			}
		}
	}
	for _, st := range r.storages {
		if st.Datasource == "" || st.Service != indexService+"."+st.Datasource {
			continue
		}
		if !p.Pending && !r.opts.IndexMigrated[st.Datasource] {
			continue
		}
		model := &tree.TreeNode{}
		sch, err := schema.Parse(model, &sync.Map{}, st.Namer())
		if err != nil {
			return fmt.Errorf("%s: %w", st.Service, err)
		}
		if r.tables[sch.Table] || produced[sch.Table] {
			continue
		}
		p.roots = append(p.roots, target{storage: st, model: model, table: sch.Table})
	}
	return nil
}

const (
	kindPolicies = "policies"
	kindIndex    = "index"
	kindColumns  = "columns"
)

func splitKind(ts []target) string {
	first := reflect.TypeOf(ts[0].model)
	same := true
	for _, t := range ts[1:] {
		same = same && reflect.TypeOf(t.model) == first
	}
	if same {
		switch ts[0].model.(type) {
		case *service.ResourcePolicy:
			return kindPolicies
		case *tree.TreeNode:
			return kindIndex
		}
		return ""
	}
	seen := map[reflect.Type]bool{}
	for _, t := range ts {
		if seen[reflect.TypeOf(t.model)] {
			return ""
		}
		seen[reflect.TypeOf(t.model)] = true
	}
	return kindColumns
}

type ownerColumn struct {
	model  any
	column string
}

// policyOwners are the entities whose identifiers are the resources of the
// policies each service stores (AddPolicies(resourceId) of their DAOs).
func policyOwners(name string) []ownerColumn {
	switch name {
	case "pydio.grpc.role":
		return []ownerColumn{{&idm.Role{}, "uuid"}}
	case "pydio.grpc.user":
		return []ownerColumn{{&usermodel.User{}, "uuid"}}
	case "pydio.grpc.workspace":
		return []ownerColumn{{&idm.Workspace{}, "uuid"}}
	case "pydio.grpc.user-meta":
		return []ownerColumn{{&usermetasql.Meta{}, "uuid"}, {&usermetasql.MetaNamespace{}, "namespace"}}
	}
	return nil
}

func (r *run) planPolicies(p *Plan, from string, ts []target) (*policySplit, error) {
	s := &policySplit{from: from}
	resource := r.q("resource")
	var all []string
	var sum int64
	for _, t := range ts {
		owners := policyOwners(t.storage.Service)
		if len(owners) == 0 {
			p.problem("%s stores policies in %s but no rule tells which resources it owns", t.storage.Service, from)
			continue
		}
		var conds []string
		for _, o := range owners {
			sch, err := r.legacySchema(o.model)
			if err != nil {
				return nil, err
			}
			if !r.tables[sch.Table] {
				continue
			}
			col := r.q(o.column)
			conds = append(conds, fmt.Sprintf("%s IN (SELECT %s FROM %s WHERE %s IS NOT NULL AND %s <> '')", resource, col, r.q(sch.Table), col, col))
		}
		where := "1 = 0"
		if len(conds) > 0 {
			where = "(" + strings.Join(conds, " OR ") + ")"
		}
		n, err := r.count(from, where)
		if err != nil {
			return nil, err
		}
		s.targets = append(s.targets, &policyTarget{target: t, where: where, rows: n})
		all = append(all, where)
		sum += n
	}
	owned := "1 = 0"
	if len(all) > 0 {
		owned = strings.Join(all, " OR ")
	}
	orphans, err := r.count(from, resource+" IS NULL OR NOT ("+owned+")")
	if err != nil {
		return nil, err
	}
	total, err := r.count(from, "1 = 1")
	if err != nil {
		return nil, err
	}
	s.shared = sum - (total - orphans)
	if orphans > 0 {
		p.problem("%d row(s) of %s protect a resource no service owns; they are not moved silently", orphans, from)
	}
	return s, nil
}

const mpathConcat = "mpath1 || mpath2 || mpath3 || mpath4"

var nodeUUID = regexp.MustCompile(`^[A-Za-z0-9-]{1,128}$`)

// subtree selects the given top-level entries and everything under them.
func subtree(entries []indexEntry) (string, []any) {
	var conds []string
	var args []any
	for _, e := range entries {
		conds = append(conds, "(("+mpathConcat+") = ? OR ("+mpathConcat+") LIKE ?)")
		args = append(args, e.MPath, e.MPath+".%")
	}
	return "(" + strings.Join(conds, " OR ") + ")", args
}

func backed(src Source, uuid string) bool {
	if !src.Local || !src.Flat || src.Folder == "" || !nodeUUID.MatchString(uuid) {
		return false
	}
	info, err := os.Stat(filepath.Join(src.Folder, src.BaseFolder, uuid))
	return err == nil && info.Mode().IsRegular()
}

func (r *run) locate(uuid string) string {
	var names []string
	for name := range r.opts.Sources {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if backed(r.opts.Sources[name], uuid) {
			return "object found in datasource " + name
		}
	}
	return "object found in no local flat datasource"
}

func (r *run) planIndex(p *Plan, from string, ts []target) (*indexSplit, error) {
	s := &indexSplit{from: from}
	byDatasource := map[string]*indexTarget{}
	for _, t := range ts {
		it := &indexTarget{target: t}
		byDatasource[t.storage.Datasource] = it
		s.targets = append(s.targets, it)
	}
	var entries []indexEntry
	if err := r.tx.Raw("SELECT uuid, name, leaf, " + mpathConcat + " AS mpath FROM " + r.q(from) + " WHERE level = 2 ORDER BY name").Scan(&entries).Error; err != nil {
		return nil, err
	}
	users := map[string]bool{}
	if ds := r.opts.IndexUserFolders; ds != "" {
		if byDatasource[ds] == nil {
			p.problem("datasource %s, given for the user folders, has no index storage", ds)
		}
		sch, err := r.legacySchema(&usermodel.User{})
		if err != nil {
			return nil, err
		}
		if r.tables[sch.Table] {
			var logins []string
			if err := r.tx.Raw("SELECT name FROM " + r.q(sch.Table) + " WHERE leaf = 1").Scan(&logins).Error; err != nil {
				return nil, err
			}
			for _, login := range logins {
				users[login] = true
			}
		}
	}
	assigned := map[string]string{}
	var datasources []string
	for ds := range r.opts.IndexAssign {
		datasources = append(datasources, ds)
	}
	sort.Strings(datasources)
	for _, ds := range datasources {
		if byDatasource[ds] == nil {
			p.problem("datasource %s, given for top-level index entries, has no index storage", ds)
		}
		for _, name := range r.opts.IndexAssign[ds] {
			if previous, ok := assigned[name]; ok && previous != ds {
				p.problem("top-level index entry %q is assigned to both %s and %s", name, previous, ds)
			}
			assigned[name] = ds
		}
	}
	found := map[string]bool{}
	for _, e := range entries {
		found[e.Name] = true
		ds, ok := assigned[e.Name]
		if !ok && r.opts.IndexUserFolders != "" && e.Leaf != 1 && users[e.Name] {
			ds, ok = r.opts.IndexUserFolders, true
		}
		if !ok {
			p.problem("top-level index entry %q (%s) is assigned to no datasource", e.Name, e.UUID)
			continue
		}
		if it := byDatasource[ds]; it != nil {
			it.entries = append(it.entries, e)
		}
	}
	var names []string
	for name := range assigned {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if !found[name] {
			p.problem("top-level index entry %q assigned to %s does not exist in %s", name, assigned[name], from)
		}
	}
	for _, it := range s.targets {
		if len(it.entries) == 0 {
			continue
		}
		ds := it.storage.Datasource
		src, ok := r.opts.Sources[ds]
		if !ok || !src.Local || !src.Flat || src.Folder == "" {
			p.problem("datasource %s is not a LOCAL flat datasource: its index leaves cannot be checked against their objects", ds)
		}
		where, args := subtree(it.entries)
		n, err := r.count(from, where, args...)
		if err != nil {
			return nil, err
		}
		it.nodes = n
		var leaves []indexEntry
		if err := r.tx.Raw("SELECT uuid, name FROM "+r.q(from)+" WHERE leaf = 1 AND "+where, args...).Scan(&leaves).Error; err != nil {
			return nil, err
		}
		for _, leaf := range leaves {
			if ok && backed(src, leaf.UUID) {
				continue
			}
			it.unbacked = append(it.unbacked, fmt.Sprintf("%s %q (%s)", leaf.UUID, leaf.Name, r.locate(leaf.UUID)))
			it.dropIDs = append(it.dropIDs, leaf.UUID)
		}
		if len(it.unbacked) > 0 {
			if r.opts.IndexDropUnbacked {
				p.note("%d index leaf/leaves of %s without their object are not moved (stray objects stay where they are)", len(it.unbacked), ds)
			} else {
				p.problem("%d index leaf/leaves assigned to %s have no object in its storage; decide explicitly (drop them) or restore the objects first", len(it.unbacked), ds)
			}
		}
	}
	return s, nil
}

func (r *run) planColumns(p *Plan, from string, ts []target) (*columnSplit, error) {
	columns, err := r.tx.Migrator().ColumnTypes(from)
	if err != nil {
		return nil, err
	}
	have := map[string]bool{}
	pk := map[string]bool{}
	for _, c := range columns {
		have[c.Name()] = true
		if isKey, ok := c.PrimaryKey(); ok && isKey {
			pk[c.Name()] = true
		}
	}
	s := &columnSplit{from: from}
	var primary *columnTarget
	var wheres []string
	for _, t := range ts {
		sch, err := r.legacySchema(t.model)
		if err != nil {
			return nil, err
		}
		ct := &columnTarget{target: t, legacy: sch}
		var conds []string
		samePK := len(sch.PrimaryFields) == len(pk)
		for _, f := range sch.PrimaryFields {
			col := r.q(f.DBName)
			cond := col + " IS NOT NULL"
			// GORMDataType: DataType holds the column type tag (varchar(255)).
			if f.GORMDataType == schema.String {
				cond += " AND " + col + " <> ''"
			}
			conds = append(conds, cond)
			samePK = samePK && pk[f.DBName]
		}
		for _, f := range sch.Fields {
			if f.DBName != "" && !f.IgnoreMigration && !have[f.DBName] {
				p.problem("%s has no column %s of %s", from, f.DBName, t.storage.Service)
			}
		}
		if len(conds) == 0 {
			p.problem("%s: the model of %s has no primary key to recognise its rows", from, t.storage.Service)
			conds = []string{"1 = 0"}
		}
		ct.where = "(" + strings.Join(conds, " AND ") + ")"
		if ct.rows, err = r.count(from, ct.where); err != nil {
			return nil, err
		}
		if samePK {
			if primary != nil {
				p.problem("%s: the primary key of several owners matches the table", from)
			}
			primary = ct
			ct.primary = true
		}
		s.targets = append(s.targets, ct)
		wheres = append(wheres, ct.where)
	}
	if primary == nil {
		p.problem("%s: no owner's primary key matches the table; cannot tell which service created it", from)
		return s, nil
	}
	for i := range s.targets {
		for j := i + 1; j < len(s.targets); j++ {
			n, err := r.count(from, s.targets[i].where+" AND "+s.targets[j].where)
			if err != nil {
				return nil, err
			}
			if n > 0 {
				p.problem("%d row(s) of %s carry the keys of both %s and %s", n, from, s.targets[i].storage.Service, s.targets[j].storage.Service)
			}
		}
	}
	unclassified, err := r.count(from, "NOT ("+strings.Join(wheres, " OR ")+")")
	if err != nil {
		return nil, err
	}
	if unclassified > 0 {
		p.problem("%d row(s) of %s carry the key of no owner", unclassified, from)
	}
	own := map[string]bool{}
	for _, f := range primary.legacy.Fields {
		own[f.DBName] = true
	}
	var extra []string
	for name := range have {
		if !own[name] {
			extra = append(extra, name)
		}
	}
	sort.Strings(extra)
	s.dropColumns = extra
	ownIndexes := map[string]bool{}
	for _, idx := range primary.legacy.ParseIndexes() {
		ownIndexes[idx.Name] = true
	}
	for _, t := range s.targets {
		if t.primary {
			continue
		}
		for _, idx := range t.legacy.ParseIndexes() {
			if !ownIndexes[idx.Name] {
				ownIndexes[idx.Name] = true
				s.dropIndexes = append(s.dropIndexes, idx.Name)
			}
		}
	}
	return s, nil
}

func (r *run) apply(p *Plan) error {
	for _, s := range p.policies {
		for _, t := range s.targets {
			if err := r.fill(t.target, s.from, t.where); err != nil {
				return err
			}
		}
		if err := r.drop(s.from); err != nil {
			return err
		}
	}
	for _, s := range p.indexes {
		for _, t := range s.targets {
			if len(t.entries) == 0 {
				continue
			}
			where, args := subtree(t.entries)
			if err := r.fill(t.target, s.from, "level = 1 OR "+where, args...); err != nil {
				return err
			}
			if len(t.dropIDs) > 0 && r.opts.IndexDropUnbacked {
				if err := r.tx.Exec("DELETE FROM "+r.q(t.table)+" WHERE uuid IN ?", t.dropIDs).Error; err != nil {
					return fmt.Errorf("%s: %w", t.table, err)
				}
			}
			if err := r.refreshFolderSizes(t.table); err != nil {
				return fmt.Errorf("%s: %w", t.table, err)
			}
		}
		if err := r.drop(s.from); err != nil {
			return err
		}
	}
	for _, s := range p.columns {
		var primary *columnTarget
		for _, t := range s.targets {
			if t.primary {
				primary = t
				continue
			}
			if err := r.fill(t.target, s.from, t.where); err != nil {
				return err
			}
		}
		if err := r.tx.Exec("DELETE FROM " + r.q(s.from) + " WHERE NOT " + primary.where).Error; err != nil {
			return fmt.Errorf("%s: %w", s.from, err)
		}
		for _, idx := range s.dropIndexes {
			if r.tx.Migrator().HasIndex(s.from, idx) {
				if err := r.tx.Exec("DROP INDEX " + r.q(idx)).Error; err != nil {
					return fmt.Errorf("%s: %w", s.from, err)
				}
			}
		}
		for _, col := range s.dropColumns {
			if err := r.tx.Exec("ALTER TABLE " + r.q(s.from) + " DROP COLUMN " + r.q(col)).Error; err != nil {
				return fmt.Errorf("%s: %w", s.from, err)
			}
		}
		if err := r.tx.Migrator().RenameTable(s.from, primary.table); err != nil {
			return fmt.Errorf("rename %s: %w", s.from, err)
		}
		p.renames = append(p.renames, rename{from: s.from, to: primary.target})
	}
	for _, rn := range p.renames {
		if rn.to.table == "" || r.tx.Migrator().HasTable(rn.to.table) {
			continue
		}
		if err := r.tx.Migrator().RenameTable(rn.from, rn.to.table); err != nil {
			return fmt.Errorf("rename %s: %w", rn.from, err)
		}
	}
	if r.driver == storagesql.PostgreDriver {
		for _, rn := range p.renames {
			if err := r.tidy(p, rn); err != nil {
				return err
			}
		}
	}
	for _, t := range p.roots {
		if err := r.createIndex(t); err != nil {
			return err
		}
	}
	return nil
}

// createIndex creates the table and root of a datasource index with the
// Migrate of the index DAO, as the storage migration of its service does
// (data/source/index/dao/sql: AutoMigrate, then the ROOT node at "/").
func (r *run) createIndex(t target) error {
	view, err := r.view(t.storage.Namer())
	if err != nil {
		return err
	}
	if err := indexsql.NewDAO(view).Migrate(r.ctx); err != nil {
		return fmt.Errorf("create %s with its root: %w", t.table, err)
	}
	if !r.tx.Migrator().HasTable(t.table) {
		return fmt.Errorf("the index DAO did not create %s", t.table)
	}
	return nil
}

// drop removes a legacy table once its rows are in their owners' tables;
// without CASCADE, an unexpected dependency fails the move.
func (r *run) drop(table string) error {
	if err := r.tx.Exec("DROP TABLE " + r.q(table)).Error; err != nil {
		return fmt.Errorf("drop %s: %w", table, err)
	}
	return nil
}

// fill creates a target table with its owner's naming and copies the
// selected legacy rows into it.
func (r *run) fill(t target, from, where string, args ...any) error {
	view, err := r.view(t.storage.Namer())
	if err != nil {
		return err
	}
	if err := view.AutoMigrate(t.model); err != nil {
		return fmt.Errorf("create %s: %w", t.table, err)
	}
	dst, err := r.tx.Migrator().ColumnTypes(t.table)
	if err != nil {
		return err
	}
	src, err := r.tx.Migrator().ColumnTypes(from)
	if err != nil {
		return err
	}
	have := map[string]bool{}
	for _, c := range src {
		have[c.Name()] = true
	}
	var cols []string
	for _, c := range dst {
		if have[c.Name()] {
			cols = append(cols, r.q(c.Name()))
		}
	}
	if len(cols) == 0 {
		return fmt.Errorf("%s shares no column with %s", t.table, from)
	}
	list := strings.Join(cols, ", ")
	if err := r.tx.Exec("INSERT INTO "+r.q(t.table)+" ("+list+") SELECT "+list+" FROM "+r.q(from)+" WHERE "+where, args...).Error; err != nil {
		return fmt.Errorf("copy %s -> %s: %w", from, t.table, err)
	}
	if r.driver != storagesql.PostgreDriver {
		return nil
	}
	sch, err := schema.Parse(t.model, &sync.Map{}, t.storage.Namer())
	if err != nil {
		return err
	}
	for _, f := range sch.PrimaryFields {
		if !f.AutoIncrement {
			continue
		}
		// Copied identifiers keep their values: the next one follows them.
		next := "SELECT setval(pg_get_serial_sequence(?, ?), COALESCE((SELECT MAX(" + r.q(f.DBName) + ") FROM " + r.q(t.table) + "), 0) + 1, false)"
		if err := r.tx.Exec(next, t.table, f.DBName).Error; err != nil {
			return fmt.Errorf("%s sequence: %w", t.table, err)
		}
	}
	return nil
}

// refreshFolderSizes sets every folder size to the size of the leaves now
// under it in this datasource only.
func (r *run) refreshFolderSizes(table string) error {
	t := r.q(table)
	inner := "c.mpath1 || c.mpath2 || c.mpath3 || c.mpath4"
	outer := t + ".mpath1 || " + t + ".mpath2 || " + t + ".mpath3 || " + t + ".mpath4"
	return r.tx.Exec("UPDATE " + t + " SET size = (SELECT COALESCE(SUM(c.size), 0) FROM " + t + " c WHERE c.leaf = 1 AND (" + inner + ") LIKE (" + outer + ") || '.%') WHERE leaf <> 1").Error
}

// tidy gives a renamed PostgreSQL table the index and constraint names a
// fresh install creates, so that the owner's AutoMigrate finds them instead
// of adding duplicates. Each rename runs in its own savepoint; one that
// cannot be applied keeps its name and is reported.
func (r *run) tidy(p *Plan, rn rename) error {
	legacy, err := r.legacySchema(rn.to.model)
	if err != nil {
		return err
	}
	current, err := schema.Parse(rn.to.model, &sync.Map{}, rn.to.storage.Namer())
	if err != nil {
		return err
	}
	table := rn.to.table
	if r.tx.Migrator().HasConstraint(table, rn.from+"_pkey") {
		r.attempt(p, "ALTER TABLE "+r.q(table)+" RENAME CONSTRAINT "+r.q(rn.from+"_pkey")+" TO "+r.q(table+"_pkey"))
	}
	oldIndexes, newIndexes := legacy.ParseIndexes(), current.ParseIndexes()
	for i := range oldIndexes {
		if i < len(newIndexes) && oldIndexes[i].Name != newIndexes[i].Name && r.tx.Migrator().HasIndex(table, oldIndexes[i].Name) {
			r.attempt(p, "ALTER INDEX "+r.q(oldIndexes[i].Name)+" RENAME TO "+r.q(newIndexes[i].Name))
		}
	}
	newUniques := map[string]string{}
	for name, u := range current.ParseUniqueConstraints() {
		newUniques[u.Field.DBName] = name
	}
	for name, u := range legacy.ParseUniqueConstraints() {
		if to := newUniques[u.Field.DBName]; to != "" && to != name && r.tx.Migrator().HasConstraint(table, name) {
			r.attempt(p, "ALTER TABLE "+r.q(table)+" RENAME CONSTRAINT "+r.q(name)+" TO "+r.q(to))
		}
	}
	for relName, rel := range legacy.Relationships.Relations {
		next := current.Relationships.Relations[relName]
		if rel.JoinTable != nil || next == nil {
			continue
		}
		oldC, newC := rel.ParseConstraint(), next.ParseConstraint()
		if oldC == nil || newC == nil || oldC.Name == newC.Name || newC.Schema == nil {
			continue
		}
		holder := newC.Schema.Table
		if r.tx.Migrator().HasConstraint(holder, oldC.Name) {
			r.attempt(p, "ALTER TABLE "+r.q(holder)+" RENAME CONSTRAINT "+r.q(oldC.Name)+" TO "+r.q(newC.Name))
		}
	}
	return nil
}

func (r *run) attempt(p *Plan, statement string) {
	r.savepoints++
	name := fmt.Sprintf("tidy_%d", r.savepoints)
	if err := r.tx.SavePoint(name).Error; err != nil {
		p.note("kept a legacy name (%s): %v", statement, err)
		return
	}
	if err := r.tx.Exec(statement).Error; err != nil {
		r.tx.RollbackTo(name)
		p.note("kept a legacy name (%s): %v", statement, err)
	}
}
