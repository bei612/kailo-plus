package objects

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"unicode/utf8"

	"github.com/minio/minio/pkg/auth"
	"github.com/minio/minio/pkg/madmin"
)

// Local object service credentials (ApiKey / vault-held ApiSecret of
// services/pydio.grpc.data.objects.<name>) are the root credential of the
// embedded MinIO FS backend. That backend keeps .minio.sys/config encrypted
// with the root credential (cmd/config-encrypted.go of the embedded MinIO), so a
// rotation must hand the credential the backend was written with to the next
// start as MinIO's OldCred. It is kept in the vault, never in pydio.json, only
// while the backend still needs it.

var (
	// Same alphabet as the install-time std.Randkey(16), bounded.
	deliveredAccessKey = regexp.MustCompile(`^[A-Za-z0-9]{16,64}$`)
	// Printable ASCII without whitespace or quotes, bounded.
	deliveredSecretKey = regexp.MustCompile(`^[!#-&(-~]{24,128}$`)
	errInvalidPrevious = errors.New("invalid previous object service credential")
)

// PreviousCredentialSecret is the vault key of a local object service's
// pending previous credential.
func PreviousCredentialSecret(objectsService string) string {
	return "objects-previous-credential-" + objectsService
}

// PreviousCredential is the vault value stored under PreviousCredentialSecret.
type PreviousCredential struct {
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"secretKey"`
}

// EncodePreviousCredential serializes the vault value.
func EncodePreviousCredential(accessKey, secretKey string) (string, error) {
	if _, err := auth.CreateCredentials(accessKey, secretKey); err != nil {
		return "", errInvalidPrevious
	}
	b, err := json.Marshal(PreviousCredential{AccessKey: accessKey, SecretKey: secretKey})
	return string(b), err
}

// ParsePreviousCredential decodes the vault value; an empty value means no
// rotation is pending.
func ParsePreviousCredential(value string) (auth.Credentials, bool, error) {
	if value == "" {
		return auth.Credentials{}, false, nil
	}
	var p PreviousCredential
	if err := json.Unmarshal([]byte(value), &p); err != nil {
		return auth.Credentials{}, false, errInvalidPrevious
	}
	cred, err := auth.CreateCredentials(p.AccessKey, p.SecretKey)
	if err != nil {
		return auth.Credentials{}, false, errInvalidPrevious
	}
	return cred, true, nil
}

// ValidDeliveredCredential checks operator-delivered datasource keys before any
// configuration is touched. Values are never part of the returned error.
func ValidDeliveredCredential(accessKey, secretKey string) error {
	if !deliveredAccessKey.MatchString(accessKey) {
		return errors.New("delivered datasource access key must be 16-64 ASCII letters or digits")
	}
	if !deliveredSecretKey.MatchString(secretKey) {
		return errors.New("delivered datasource secret key must be 24-128 printable ASCII characters without whitespace or quotes")
	}
	if accessKey == secretKey {
		return errors.New("delivered datasource access and secret keys must differ")
	}
	return nil
}

// PreviousCredentialNeeded reports whether the FS backend under localFolder may
// still hold configuration encrypted with an earlier root credential, i.e. it
// is not a completed encrypted backend readable with current.
func PreviousCredentialNeeded(localFolder string, current auth.Credentials) (bool, error) {
	sys := filepath.Join(localFolder, ".minio.sys")
	marker, err := os.ReadFile(filepath.Join(sys, "backend-encrypted"))
	if os.IsNotExist(err) {
		// Never encrypted: the next start encrypts with the active credential.
		return false, nil
	} else if err != nil {
		return true, err
	}
	if !bytes.Equal(marker, []byte("encrypted")) {
		return true, nil
	}
	data, err := os.ReadFile(filepath.Join(sys, "config", "config.json"))
	if err != nil || utf8.Valid(data) {
		return true, err
	}
	if _, err := madmin.DecryptData(current.String(), bytes.NewReader(data)); err != nil {
		if errors.Is(err, madmin.ErrMaliciousData) {
			return true, nil
		}
		return true, err
	}
	return false, nil
}
