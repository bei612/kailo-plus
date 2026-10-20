package sql_test

import (
	"testing"

	ssql "github.com/pydio/cells/v5/common/storage/sql"
)

// Tools opening a storage outside the pool get the helper the DAOs assert.
func TestNewDialectorCarriesTheSQLHelper(t *testing.T) {
	for _, driver := range []string{ssql.MySQLDriver, ssql.PostgreDriver, ssql.SqliteDriver} {
		d, err := ssql.NewDialector(driver, nil)
		if err != nil {
			t.Fatalf("%s: %v", driver, err)
		}
		if _, ok := d.(ssql.Helper); !ok {
			t.Errorf("%s dialector has no SQL helper", driver)
		}
	}
	if _, err := ssql.NewDialector("oracle", nil); err == nil {
		t.Error("unknown driver accepted")
	}
}
