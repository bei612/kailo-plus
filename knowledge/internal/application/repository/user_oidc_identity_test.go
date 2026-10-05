package repository

import (
	"context"
	"os"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// Only native identity DDL/constraints are under test, not platform admission.
func TestKailoNativeOIDCIdentityMigration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:native_oidc_migration?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.Exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, deleted_at DATETIME)").Error; err != nil {
		t.Fatal(err)
	}
	up, err := os.ReadFile("../../../migrations/sqlite/000024_oidc_identity.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	down, err := os.ReadFile("../../../migrations/sqlite/000024_oidc_identity.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range [][]byte{up, down, up} {
		if err := db.Exec(string(migration)).Error; err != nil {
			t.Fatalf("empty native up/down/up: %v", err)
		}
	}
	if err := db.Exec("INSERT INTO users(id,email,oidc_issuer,oidc_subject) VALUES ('one','one@example.com','https://idp.example','subject')").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO users(id,email,oidc_issuer,oidc_subject) VALUES ('two','two@example.com','https://idp.example','subject')").Error; err == nil {
		t.Fatal("two native users acquired the same authenticated identity")
	}
	if err := db.Exec("INSERT INTO users(id,oidc_issuer) VALUES ('partial','https://idp.example')").Error; err == nil {
		t.Fatal("partial native identity was accepted")
	}
	if err := db.Exec("UPDATE users SET oidc_subject='other' WHERE id='one'").Error; err == nil {
		t.Fatal("native identity was rebound")
	}
	if err := db.Exec("UPDATE users SET email='changed@example.com' WHERE id='one'").Error; err != nil {
		t.Fatal(err)
	}
	user, err := NewUserRepository(db).GetUserByOIDCIdentity(context.Background(), "https://idp.example", "subject")
	if err != nil || user.ID != "one" || user.Email != "changed@example.com" {
		t.Fatalf("actual repository lost identity after native profile change: user=%+v err=%v", user, err)
	}
	if err := db.Exec("UPDATE users SET deleted_at=CURRENT_TIMESTAMP WHERE id='one'").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO users(id,oidc_issuer,oidc_subject) VALUES ('reused','https://idp.example','subject')").Error; err == nil {
		t.Fatal("a deleted native identity was reassigned")
	}
	if err := db.Exec(string(down)).Error; err == nil {
		t.Fatal("rollback discarded a bound native identity")
	}
}
