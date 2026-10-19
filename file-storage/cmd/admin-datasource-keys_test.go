package cmd

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	minio "github.com/minio/minio-go/v7"
)

func TestReadDeliveredKeyRequiresOwnerOnlyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "key")
	// Test-only placeholder, not a credential of any deployment.
	if err := os.WriteFile(path, []byte("PlaceholderKey0001\n"), 0600); err != nil {
		t.Fatal(err)
	}
	value, err := readDeliveredKey(path)
	if err != nil || value != "PlaceholderKey0001" {
		t.Fatalf("owner-only key file refused or not trimmed: %v", err)
	}
	if err := os.Chmod(path, 0640); err != nil {
		t.Fatal(err)
	}
	if _, err := readDeliveredKey(path); err == nil {
		t.Fatal("group-readable key file accepted")
	} else if strings.Contains(err.Error(), "PlaceholderKey0001") {
		t.Fatal("refusal discloses the file content")
	}
	empty := filepath.Join(dir, "empty")
	if err := os.WriteFile(empty, nil, 0600); err != nil {
		t.Fatal(err)
	}
	for _, refused := range []string{"", "relative/key", empty, dir, filepath.Join(dir, "missing")} {
		if _, err := readDeliveredKey(refused); err == nil {
			t.Fatalf("%q accepted", refused)
		}
	}
}

func TestRefusedCredentialOnlyForAuthenticationRefusals(t *testing.T) {
	for _, code := range []string{"InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied"} {
		if !refusedCredential(minio.ErrorResponse{Code: code}) {
			t.Fatalf("%s not treated as a refusal", code)
		}
	}
	for _, err := range []error{nil, errors.New("dial tcp: connection refused"), minio.ErrorResponse{Code: "InternalError"}} {
		if refusedCredential(err) {
			t.Fatalf("%v treated as a refusal", err)
		}
	}
}
