package objects

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/minio/minio/pkg/auth"
	"github.com/minio/minio/pkg/madmin"
)

// Test-only placeholders, not credentials of any deployment.
const (
	testAccessOld = "OldAccessKey0001"
	testSecretOld = "old-secret-placeholder-000000"
	testAccessNew = "NewAccessKey0002"
	testSecretNew = "new-secret-placeholder-000000"
)

func testCred(t *testing.T, access, secret string) auth.Credentials {
	cred, err := auth.CreateCredentials(access, secret)
	if err != nil {
		t.Fatal(err)
	}
	return cred
}

// writeBackend lays out the embedded MinIO FS backend files the rotation
// inspects: .minio.sys/backend-encrypted and .minio.sys/config/config.json.
func writeBackend(t *testing.T, marker string, config []byte) string {
	root := t.TempDir()
	sys := filepath.Join(root, ".minio.sys")
	if err := os.MkdirAll(filepath.Join(sys, "config"), 0700); err != nil {
		t.Fatal(err)
	}
	if marker != "" {
		if err := os.WriteFile(filepath.Join(sys, "backend-encrypted"), []byte(marker), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if config != nil {
		if err := os.WriteFile(filepath.Join(sys, "config", "config.json"), config, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func TestPreviousCredentialRoundTrip(t *testing.T) {
	value, err := EncodePreviousCredential(testAccessOld, testSecretOld)
	if err != nil {
		t.Fatal(err)
	}
	cred, pending, err := ParsePreviousCredential(value)
	if err != nil || !pending || !cred.Equal(testCred(t, testAccessOld, testSecretOld)) {
		t.Fatalf("round trip failed: pending=%v err=%v", pending, err)
	}
	if _, pending, err := ParsePreviousCredential(""); err != nil || pending {
		t.Fatal("empty vault value must mean no pending rotation")
	}
	for _, bad := range []string{"{", `{"accessKey":"ab","secretKey":"short"}`} {
		if _, _, err := ParsePreviousCredential(bad); err == nil {
			t.Fatal("invalid previous credential accepted")
		}
	}
	if _, err := EncodePreviousCredential("ab", testSecretOld); err == nil {
		t.Fatal("invalid previous credential encoded")
	}
}

func TestValidDeliveredCredential(t *testing.T) {
	if err := ValidDeliveredCredential(testAccessNew, testSecretNew); err != nil {
		t.Fatal(err)
	}
	for name, pair := range map[string][2]string{
		"short key":     {"Short1", testSecretNew},
		"key symbols":   {"NewAccessKey-0002", testSecretNew},
		"short secret":  {testAccessNew, "tooShort"},
		"secret space":  {testAccessNew, "new secret placeholder 0000"},
		"secret quote":  {testAccessNew, `new"secret"placeholder0000`},
		"secret == key": {"SameValue0123456789ABCDEFG", "SameValue0123456789ABCDEFG"},
	} {
		if err := ValidDeliveredCredential(pair[0], pair[1]); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}

func TestPreviousCredentialNeeded(t *testing.T) {
	current := testCred(t, testAccessNew, testSecretNew)
	old := testCred(t, testAccessOld, testSecretOld)
	plain := []byte(`{"version":"33"}`)
	withCurrent, err := madmin.EncryptData(current.String(), plain)
	if err != nil {
		t.Fatal(err)
	}
	withOld, err := madmin.EncryptData(old.String(), plain)
	if err != nil {
		t.Fatal(err)
	}
	for name, c := range map[string]struct {
		marker string
		config []byte
		needed bool
	}{
		"never encrypted":         {"", nil, false},
		"migrated to current":     {"encrypted", withCurrent, false},
		"still on old credential": {"encrypted", withOld, true},
		"incomplete migration":    {"incomplete", withCurrent, true},
		"plaintext config":        {"encrypted", plain, true},
		"config missing":          {"encrypted", nil, true},
	} {
		needed, _ := PreviousCredentialNeeded(writeBackend(t, c.marker, c.config), current)
		if needed != c.needed {
			t.Fatalf("%s: needed=%v, want %v", name, needed, c.needed)
		}
	}
}
