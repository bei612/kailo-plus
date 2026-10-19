package cmd

import (
	"strings"
	"testing"

	"github.com/pydio/cells/v5/common/proto/object"
)

// Configuration as an install leaves it: local datasources under one parent,
// served by local1 whose ApiSecret is a vault reference (not a secret).
func ensureFixture() (map[string]*object.DataSource, map[string]*object.MinioConfig) {
	local := func(name string) *object.DataSource {
		return &object.DataSource{
			Name:                 name,
			StorageType:          object.StorageType_LOCAL,
			FlatStorage:          true,
			StorageConfiguration: map[string]string{object.StorageKeyFolder: "/var/cells/data/" + name},
			ObjectsServiceName:   "local1",
			ApiKey:               "PlaceholderKey0001",
			ApiSecret:            "vault-ref-local1",
		}
	}
	sources := map[string]*object.DataSource{"pydiods1": local("pydiods1"), "personal": local("personal"), "cellsdata": local("cellsdata")}
	minios := map[string]*object.MinioConfig{"local1": {
		Name:        "local1",
		StorageType: object.StorageType_LOCAL,
		ApiKey:      "PlaceholderKey0001",
		ApiSecret:   "vault-ref-local1",
		LocalFolder: "/var/cells/data",
	}}
	return sources, minios
}

func TestEnsureCreatesTheDatasourceOnTheExistingObjectService(t *testing.T) {
	sources, minios := ensureFixture()
	ds, err := localDatasource("kailobinding", "keep-all", sources, minios, "")
	if err != nil || ds == nil {
		t.Fatalf("datasource not planned: %v", err)
	}
	if ds.ObjectsServiceName != "local1" || ds.ObjectsBucket != "kailobinding" || !ds.FlatStorage || ds.StorageType != object.StorageType_LOCAL {
		t.Fatalf("not a LOCAL flat datasource of local1: %+v", ds)
	}
	if ds.StorageConfiguration[object.StorageKeyFolder] != "/var/cells/data/kailobinding" || ds.StorageConfiguration[object.StorageKeyHashingVersion] != object.CurrentHashingVersion {
		t.Fatalf("unexpected storage configuration %v", ds.StorageConfiguration)
	}
	// The vault reference of its object service, never a resolved secret or a
	// new vault entry (the REST handler's new entry desynchronised the sync
	// datasources from local1).
	if ds.ApiKey != "PlaceholderKey0001" || ds.ApiSecret != "vault-ref-local1" || ds.VersioningPolicyName != "keep-all" {
		t.Fatal("datasource does not share its object service keys reference and policy")
	}
	if len(minios) != 1 {
		t.Fatal("a new object service was planned")
	}
}

func TestEnsureIsANoOpOrARefusalForAnExistingDatasource(t *testing.T) {
	sources, minios := ensureFixture()
	created, err := localDatasource("kailobinding", "keep-all", sources, minios, "")
	if err != nil {
		t.Fatal(err)
	}
	sources["kailobinding"] = created
	if again, err := localDatasource("kailobinding", "keep-all", sources, minios, ""); err != nil || again != nil {
		t.Fatalf("existing datasource not left as is: %v", err)
	}
	if _, err := localDatasource("kailobinding", "keep-last", sources, minios, ""); err == nil || !strings.Contains(err.Error(), "versioning policy") {
		t.Fatalf("policy change accepted: %v", err)
	}
	sources["kailobinding"].Disabled = true
	if _, err := localDatasource("kailobinding", "keep-all", sources, minios, ""); err == nil {
		t.Fatal("disabled datasource accepted")
	}
}

func TestEnsureRefusesAnUnsafePlacement(t *testing.T) {
	sources, minios := ensureFixture()
	for name, policy := range map[string]string{"Kailo": "keep-all", "kailobinding": "", "a/b": "keep-all"} {
		if _, err := localDatasource(name, policy, sources, minios, ""); err == nil {
			t.Fatalf("%q/%q accepted", name, policy)
		}
	}
	if _, err := localDatasource("kailobinding", "keep-all", sources, minios, "/srv/allowed"); err == nil {
		t.Fatal("folder outside allowedLocalDsFolder accepted")
	}
	sources["cellsdata"].StorageConfiguration[object.StorageKeyFolder] = "/elsewhere/cellsdata"
	if _, err := localDatasource("kailobinding", "keep-all", sources, minios, ""); err == nil {
		t.Fatal("datasources without one parent folder accepted")
	}
}
