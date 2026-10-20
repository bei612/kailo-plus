package cmd

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/spf13/cobra"

	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/proto/object"
	storagesql "github.com/pydio/cells/v5/common/storage/sql"
	"github.com/pydio/cells/v5/discovery/install/prefixes"
)

// Exit codes of the check: 0 the per-service tables are in effect (or nothing
// is installed yet), 3 a move is pending and can be applied, 2 refused, 4 only
// datasource indexes lack their table and root (created by --apply, additive).
const (
	dbPrefixesExitPending    = 3
	dbPrefixesExitRefused    = 2
	dbPrefixesExitIndexRoots = 4
)

var (
	dbPrefixesApply        bool
	dbPrefixesAssign       []string
	dbPrefixesUserFolders  string
	dbPrefixesDropUnbacked bool
)

var configDatabasePrefixesCmd = &cobra.Command{
	Use:   "prefixes",
	Short: "Move a database installed without the per-service table template to the upstream per-service tables",
	Long: `
DESCRIPTION

  Upstream builds every SQL DSN with the query
  ` + prefixes.DSNTemplate + `
  so that each service storage gets the table prefix, policies table and
  naming the bootstrap declares (data_meta for pydio.grpc.meta, idm_usr_meta
  for pydio.grpc.user-meta, data_index_<datasource>_idx_tree for each
  datasource index...). A manual install DSN without it gives every service
  the same unprefixed names: node and user metadata share "meta", roles,
  users, workspaces and user metadata share "resource_policies" and every
  datasource index shares "idx_trees".

  A datasource index creates its table and root only in the storage
  migration of its service, on the first start of that datasource index or on
  a version change (versions/pydio.grpc.data.index.<datasource>); nothing
  creates them on access. The move therefore creates, with the index DAO's own
  migration, the table and root of every datasource index the split leaves
  without entries, and of every datasource index whose table is missing while
  its migration is recorded.

  Without --apply the command only reads: it prints the move and exits 0 when
  the per-service tables and the stored DSN template are already in effect,
  3 when a move is pending and applicable, 2 when it is refused, 4 when only
  datasource indexes lack their table and root.

  With --apply, Cells must be stopped (the database running). In one
  transaction every legacy table becomes its owner's table (renamed, or
  split: metadata rows by the primary key they carry, policies by the owner
  of their resource, index nodes by the datasource each top-level entry is
  assigned to); then the stored DSN receives the upstream template. Nothing is
  changed when anything is refused. Back the database and the configuration
  up first.

  The index split never guesses: every top-level entry of the shared index
  must be assigned (--index-assign, --index-assign-user-folders), and a leaf
  whose object is not in the storage of its datasource refuses the move unless
  --index-drop-unbacked is given.

EXAMPLES

  $ ` + os.Args[0] + ` admin config db prefixes --index-assign-user-folders personal --index-assign kailobinding=kailo-binding
  $ ` + os.Args[0] + ` admin config db prefixes --index-assign-user-folders personal --index-assign kailobinding=kailo-binding --apply
`,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := cmd.Context()
		opts := prefixes.Options{
			IndexAssign:       map[string][]string{},
			IndexUserFolders:  dbPrefixesUserFolders,
			IndexDropUnbacked: dbPrefixesDropUnbacked,
			Sources:           map[string]prefixes.Source{},
		}
		for _, assignment := range dbPrefixesAssign {
			ds, list, ok := strings.Cut(assignment, "=")
			if !ok || ds == "" || list == "" {
				return errors.New("--index-assign expects <datasource>=<entry>[,<entry>...]")
			}
			for _, name := range strings.Split(list, ",") {
				if name == "" {
					return errors.New("--index-assign expects <datasource>=<entry>[,<entry>...]")
				}
				opts.IndexAssign[ds] = append(opts.IndexAssign[ds], name)
			}
		}

		id, dsn, found, err := configuredSQLDatabase(config.Get(ctx, "databases").Map())
		if err != nil {
			return err
		}
		if !found {
			cmd.Println("No SQL database is configured yet: a new install receives the per-service template from its install DSN; nothing to move")
			return nil
		}
		templated, err := prefixes.Templated(dsn)
		if err != nil {
			return err
		}
		var datasources []string
		opts.IndexMigrated = map[string]bool{}
		for name, ds := range config.ListSourcesFromConfig(ctx) {
			datasources = append(datasources, name)
			// The key and value UpdateServiceVersion records for the index of this datasource.
			if v := strings.TrimSpace(config.Get(ctx, "versions", "pydio.grpc.data.index."+name).String()); v != "" && v != "0.0.0" {
				opts.IndexMigrated[name] = true
			}
			if ds == nil {
				continue
			}
			opts.Sources[name] = prefixes.Source{
				Local:      ds.StorageType == object.StorageType_LOCAL,
				Flat:       ds.FlatStorage,
				Folder:     ds.StorageConfiguration[object.StorageKeyFolder],
				BaseFolder: ds.ObjectsBaseFolder,
			}
		}
		sort.Strings(datasources)
		storages, err := prefixes.Storages(DefaultBootstrapYAML, datasources)
		if err != nil {
			return err
		}

		// Parser and connection errors may quote the DSN: they are not printed.
		storageDSN, err := storagesql.NewStorageDSN(dsn)
		if err != nil {
			return errors.New("the stored SQL DSN cannot be parsed")
		}
		conns, err := storageDSN.OpenDB(ctx)
		if err != nil || len(conns) == 0 {
			return errors.New("cannot connect to the configured SQL database")
		}
		defer func() {
			for _, c := range conns {
				_ = c.Close()
			}
		}()
		driver := storageDSN.Driver()
		db, err := prefixes.Open(driver, conns[0])
		if err != nil {
			return err
		}

		plan, err := prefixes.Inspect(ctx, db, driver, storages, opts)
		if err != nil {
			return err
		}
		if !plan.Changes() && templated {
			cmd.Println("Per-service tables and the upstream DSN template are in effect; nothing to move")
			return nil
		}
		plan.Report(cmd.OutOrStdout())
		if templated {
			cmd.Println("Stored DSN: carries the upstream template")
		} else {
			cmd.Println("Stored DSN: lacks the upstream template; it is appended after the tables are moved")
		}
		if len(plan.Problems) > 0 {
			cmd.Println("Move refused; nothing was changed")
			os.Exit(dbPrefixesExitRefused)
		}
		if !dbPrefixesApply {
			if !plan.Pending && templated {
				cmd.Println("Check only: nothing was changed (stop Cells, then re-run with --apply to create the missing datasource index tables and roots)")
				os.Exit(dbPrefixesExitIndexRoots)
			}
			cmd.Println("Check only: nothing was changed (stop Cells, back up the database and the configuration, then re-run with --apply)")
			os.Exit(dbPrefixesExitPending)
		}

		if plan.Changes() {
			applied, err := prefixes.Apply(ctx, db, driver, storages, opts)
			if errors.Is(err, prefixes.ErrRefused) {
				applied.Report(cmd.OutOrStdout())
				cmd.Println("Move refused; nothing was changed")
				os.Exit(dbPrefixesExitRefused)
			} else if err != nil {
				return fmt.Errorf("table move rolled back: %w", err)
			}
			for _, note := range applied.Notes {
				cmd.Printf("note: %s\n", note)
			}
			if applied.Pending {
				cmd.Println("Tables moved to their per-service names")
			}
			if roots := applied.IndexRoots(); len(roots) > 0 {
				cmd.Printf("Datasource index tables created with their root: %s\n", strings.Join(roots, ", "))
			}
		}
		if !templated {
			if err := config.Set(ctx, prefixes.WithTemplate(dsn), "databases", id, "dsn"); err != nil {
				return errors.New("tables moved but the stored DSN could not be updated; re-run this command")
			}
			if err := config.Save(ctx, "cli", "Adopt the upstream per-service SQL table template"); err != nil {
				return errors.New("tables moved but the configuration could not be saved; re-run this command")
			}
			cmd.Println("Stored DSN now carries the upstream per-service template")
		}

		// Read both back.
		_, stored, _, err := configuredSQLDatabase(config.Get(ctx, "databases").Map())
		if err != nil {
			return err
		}
		if ok, err := prefixes.Templated(stored); err != nil || !ok {
			return errors.New("stored DSN read-back lacks the upstream template")
		}
		after, err := prefixes.Inspect(ctx, db, driver, storages, opts)
		if err != nil {
			return err
		}
		if after.Pending {
			return errors.New("legacy tables remain after the move")
		}
		if after.Changes() {
			return errors.New("datasource index tables are still missing after the move")
		}
		cmd.Println("Per-service tables in effect and every datasource index has its table and root; start Cells")
		return nil
	},
}

// configuredSQLDatabase returns the single SQL database of the configuration.
func configuredSQLDatabase(databases map[string]interface{}) (id, dsn string, found bool, err error) {
	var ids []string
	for key := range databases {
		ids = append(ids, key)
	}
	sort.Strings(ids)
	for _, key := range ids {
		entry, ok := databases[key].(map[string]interface{})
		if !ok || entry["driver"] != "sql" {
			continue
		}
		value, ok := entry["dsn"].(string)
		if !ok || value == "" {
			continue
		}
		if found {
			return "", "", false, errors.New("several SQL databases are configured; this command moves the tables of a single default SQL database")
		}
		id, dsn, found = key, value, true
	}
	return id, dsn, found, nil
}

func init() {
	configDatabasePrefixesCmd.Flags().BoolVar(&dbPrefixesApply, "apply", false, "Move the tables and store the DSN template (Cells stopped); without it only check")
	configDatabasePrefixesCmd.Flags().StringArrayVar(&dbPrefixesAssign, "index-assign", nil, "Assign top-level entries of the shared index to a datasource: <datasource>=<entry>[,<entry>...] (repeatable)")
	configDatabasePrefixesCmd.Flags().StringVar(&dbPrefixesUserFolders, "index-assign-user-folders", "", "Datasource owning the top-level folders named after a user login (personal folders)")
	configDatabasePrefixesCmd.Flags().BoolVar(&dbPrefixesDropUnbacked, "index-drop-unbacked", false, "Do not move index leaves whose object is not in their datasource storage")
	configDatabaseCmd.AddCommand(configDatabasePrefixesCmd)
}
