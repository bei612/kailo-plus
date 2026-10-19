package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/spf13/cobra"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/utils/std"
)

var (
	dsEnsureName   string
	dsEnsurePolicy string

	// Same rule as the original REST handler (PutDataSource), bounded like
	// the index table prefix derived from it.
	dsEnsureNamePattern   = regexp.MustCompile(`^[a-z0-9]{1,33}$`)
	dsEnsurePolicyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
)

var dsEnsureCmd = &cobra.Command{
	Use:   "ensure",
	Short: "Create a LOCAL flat datasource beside the existing local datasources, before start",
	Long: `
DESCRIPTION

  Create, in the configuration, a LOCAL flat datasource served by the existing
  local object service, in a new folder beside the existing local datasources,
  with the given versioning policy. Nothing is changed when the datasource
  already exists with this layout and policy; any other existing datasource of
  that name is refused (a versioning policy is changed in the Cells console,
  which also versions the existing files).

  Run it before 'cells start', like the install does for the default
  datasources: the running server holds the configuration and the vault in
  memory and rewrites both files whole on its next save, so a datasource must
  not be created through the configuration of a running server by another
  process, and the datasource is served from this start without a restart.
  The datasource refers to the vault entry of its object service; no secret
  is read or printed. Run 'cells admin datasource keys' afterwards.

EXAMPLES

  $ ` + os.Args[0] + ` admin datasource ensure --name kailobinding --versioning-policy keep-all
`,
	RunE: func(cmd *cobra.Command, args []string) error {
		ctx := cmd.Context()
		sources := config.ListSourcesFromConfig(ctx)
		// skipSecret: ApiSecret stays the vault reference.
		minios := config.ListMinioConfigsFromConfig(ctx, true)
		allowed := config.Get(ctx, "services", common.ServiceGrpcNamespace_+common.ServiceDataObjects, "allowedLocalDsFolder").String()
		ds, err := localDatasource(dsEnsureName, dsEnsurePolicy, sources, minios, allowed)
		if err != nil {
			return err
		}
		if ds == nil {
			cmd.Printf("datasource %s already exists as requested\n", dsEnsureName)
			return nil
		}
		if err := os.MkdirAll(ds.StorageConfiguration[object.StorageKeyFolder], 0o755); err != nil {
			return fmt.Errorf("datasource %s: its folder cannot be created", ds.Name)
		}
		if err := config.Set(ctx, ds, "services", syncConfigPath(ds.Name)); err != nil {
			return err
		}
		for _, service := range []string{common.ServiceDataSync, common.ServiceDataIndex} {
			value := config.Get(ctx, "services", common.ServiceGrpcNamespace_+service, "sources")
			if err := value.Set(std.Unique(append(value.StringArray(), ds.Name))); err != nil {
				return err
			}
		}
		if err := config.Save(ctx, "cli", "Create datasource "+ds.Name); err != nil {
			return errors.New("datasource could not be persisted")
		}
		stored, err := config.GetSourceInfoByName(ctx, ds.Name)
		served := false
		for _, name := range config.SourceNamesForDataServices(ctx, common.ServiceDataIndex) {
			served = served || name == ds.Name
		}
		if err != nil || !served || stored.ObjectsServiceName != ds.ObjectsServiceName || stored.VersioningPolicyName != dsEnsurePolicy || stored.ApiSecret != ds.ApiSecret {
			return fmt.Errorf("datasource %s read-back differs", ds.Name)
		}
		cmd.Printf("datasource %s created on object service %s with versioning policy %s; served from this start\n", ds.Name, ds.ObjectsServiceName, ds.VersioningPolicyName)
		return nil
	},
}

// localDatasource returns the LOCAL flat datasource to create beside the
// existing local datasources, or nil when it already exists as requested.
// minios hold vault references (ListMinioConfigsFromConfig skipSecret), which
// the new datasource shares with its object service.
func localDatasource(name, policy string, sources map[string]*object.DataSource, minios map[string]*object.MinioConfig, allowedPrefix string) (*object.DataSource, error) {
	if !dsEnsureNamePattern.MatchString(name) {
		return nil, errors.New("datasource name must be 1-33 lowercase letters or digits")
	}
	if !dsEnsurePolicyPattern.MatchString(policy) {
		return nil, errors.New("a versioning policy id is required")
	}
	if current := sources[name]; current != nil {
		switch {
		case current.StorageType != object.StorageType_LOCAL || !current.FlatStorage:
			return nil, fmt.Errorf("datasource %s exists and is not a LOCAL flat datasource", name)
		case current.Disabled:
			return nil, fmt.Errorf("datasource %s exists and is disabled", name)
		case current.VersioningPolicyName != policy:
			return nil, fmt.Errorf("datasource %s exists with another versioning policy; change it in the Cells console (Data sources), which also versions its existing files", name)
		}
		return nil, nil
	}
	var names []string
	for n := range sources {
		names = append(names, n)
	}
	sort.Strings(names)
	parents := map[string]bool{}
	for _, n := range names {
		ds := sources[n]
		if ds == nil || ds.StorageType != object.StorageType_LOCAL || ds.PeerAddress != "" {
			continue
		}
		parents[filepath.Dir(strings.TrimRight(ds.StorageConfiguration[object.StorageKeyFolder], "/"))] = true
	}
	if len(parents) != 1 {
		return nil, errors.New("cannot place a new LOCAL datasource: the existing local datasources do not share one parent folder")
	}
	var parent string
	for p := range parents {
		parent = p
	}
	if !filepath.IsAbs(parent) {
		return nil, errors.New("cannot place a new LOCAL datasource: the existing local datasources have no absolute parent folder")
	}
	folder := filepath.Join(parent, name)
	if allowedPrefix != "" && !strings.HasPrefix(folder, allowedPrefix) {
		return nil, fmt.Errorf("datasource %s: its folder is outside the allowed local datasource folder", name)
	}
	for _, n := range names {
		if ds := sources[n]; ds != nil && ds.StorageType == object.StorageType_LOCAL && strings.TrimRight(ds.StorageConfiguration[object.StorageKeyFolder], "/") == folder {
			return nil, fmt.Errorf("datasource %s already uses the folder of %s", n, name)
		}
	}
	ds := &object.DataSource{
		Name:           name,
		StorageType:    object.StorageType_LOCAL,
		EncryptionMode: object.EncryptionMode_CLEAR,
		FlatStorage:    true,
		StorageConfiguration: map[string]string{
			object.StorageKeyFolder:         folder,
			object.StorageKeyNormalize:      "false",
			object.StorageKeyFolderCreate:   "true",
			object.StorageKeyHashingVersion: object.CurrentHashingVersion,
		},
		VersioningPolicyName: policy,
	}
	mc, err := config.FactorizeMinioServers(context.Background(), minios, ds, false)
	if err != nil {
		return nil, err
	}
	if known := minios[mc.Name]; known == nil || known != mc {
		return nil, errors.New("no existing local object service serves the parent folder; a new object service is not created here")
	}
	if ds.ApiKey == "" || ds.ApiSecret == "" {
		return nil, fmt.Errorf("object service %s has no stored keys", mc.Name)
	}
	return ds, nil
}

func init() {
	dsEnsureCmd.Flags().StringVar(&dsEnsureName, "name", "", "Datasource name (lowercase letters and digits)")
	dsEnsureCmd.Flags().StringVar(&dsEnsurePolicy, "versioning-policy", "", "Versioning policy id of the datasource")
	DataSourceCmd.AddCommand(dsEnsureCmd)
}
