package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	minio "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/minio/minio/pkg/auth"
	"github.com/spf13/cobra"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/data/source/objects"
)

var (
	dsKeysAccessFile string
	dsKeysSecretFile string
	dsKeysVerify     bool
)

// Largest delivered key file read; the validated values are far shorter.
const deliveredKeyMaxBytes = 4096

var dsKeysCmd = &cobra.Command{
	Use:   "keys",
	Short: "Apply operator-delivered access keys to local object services",
	Long: `
DESCRIPTION

  Set the access key and secret key of every LOCAL object service (the
  embedded MinIO root credential, services/pydio.grpc.data.objects.<name>) and
  of every datasource it serves (services/pydio.grpc.data.sync.<ds>) from two
  owner-only files. The secret is held in the vault. Values are never printed
  and never passed as command arguments.

  Run it before 'cells start'. When the credential changes, the credential the
  encrypted object backend was written with is kept in the vault only until a
  start has re-encrypted that backend with the delivered credential; the old
  values stop authenticating as soon as the object services start with the
  new ones.

  With --verify, run it against the started instance: each local object
  service must accept the delivered credential and refuse a pending previous
  one; once the backend is re-encrypted the pending previous credential is
  removed from the vault.

EXAMPLES

  $ ` + os.Args[0] + ` admin datasource keys --access-key-file /run/secrets/cells_datasource_key --secret-key-file /run/secrets/cells_datasource_secret
  $ ` + os.Args[0] + ` admin datasource keys --access-key-file /run/secrets/cells_datasource_key --secret-key-file /run/secrets/cells_datasource_secret --verify
`,
	RunE: func(cmd *cobra.Command, args []string) error {
		access, err := readDeliveredKey(dsKeysAccessFile)
		if err != nil {
			return err
		}
		secret, err := readDeliveredKey(dsKeysSecretFile)
		if err != nil {
			return err
		}
		if err := objects.ValidDeliveredCredential(access, secret); err != nil {
			return err
		}
		if dsKeysVerify {
			return verifyDatasourceKeys(cmd, access, secret)
		}
		return applyDatasourceKeys(cmd, access, secret)
	},
}

// readDeliveredKey reads one owner-only key file; a single trailing newline is
// dropped. Errors name the path, never the content.
func readDeliveredKey(path string) (string, error) {
	refused := fmt.Errorf("datasource key file %s must be an absolute, owner-only, nonempty regular file", path)
	if !filepath.IsAbs(path) {
		return "", refused
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 || info.Size() == 0 || info.Size() > deliveredKeyMaxBytes {
		return "", refused
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return "", refused
	}
	return strings.TrimSuffix(string(content), "\n"), nil
}

func objectsConfigPath(name string) string {
	return common.ServiceGrpcNamespace_ + common.ServiceDataObjects_ + name
}

func syncConfigPath(name string) string {
	return common.ServiceGrpcNamespace_ + common.ServiceDataSync_ + name
}

// localObjectServices lists the LOCAL object services (embedded MinIO); remote
// S3/Azure/GCS credentials belong to their providers and are not touched.
func localObjectServices(ctx context.Context) ([]string, map[string]*object.MinioConfig, error) {
	minios := config.ListMinioConfigsFromConfig(ctx, true)
	var local []string
	for name, mc := range minios {
		if mc != nil && mc.StorageType == object.StorageType_LOCAL {
			local = append(local, name)
		}
	}
	if len(local) == 0 {
		return nil, nil, errors.New("no local object service is configured")
	}
	sort.Strings(local)
	return local, minios, nil
}

func applyDatasourceKeys(cmd *cobra.Command, access, secret string) error {
	ctx := cmd.Context()
	local, minios, err := localObjectServices(ctx)
	if err != nil {
		return err
	}
	sources := config.ListSourcesFromConfig(ctx)
	changed := false
	for _, name := range local {
		mc := minios[name]
		ref := mc.ApiSecret
		current := config.GetSecret(ctx, ref).String()
		if current == "" {
			// Not a vault reference: a raw secret left in the config store.
			current, ref = mc.ApiSecret, ""
		}
		previousKey := objects.PreviousCredentialSecret(name)
		_, pending, err := objects.ParsePreviousCredential(config.GetSecret(ctx, previousKey).String())
		if err != nil {
			return fmt.Errorf("objects service %s: %w", name, err)
		}
		rotated := mc.ApiKey != access || current != secret
		if rotated {
			// The backend still written with an earlier pending credential
			// keeps that one; otherwise it is written with the current one.
			keep := false
			if pending {
				keep = true
				if cred, er := auth.CreateCredentials(mc.ApiKey, current); er == nil {
					if needed, er := objects.PreviousCredentialNeeded(mc.LocalFolder, cred); er == nil {
						keep = needed
					}
				}
			}
			if !keep {
				value, er := objects.EncodePreviousCredential(mc.ApiKey, current)
				if er != nil {
					return fmt.Errorf("objects service %s: current credential is not a valid object service credential", name)
				}
				if er := config.SetSecret(ctx, previousKey, value); er != nil {
					return fmt.Errorf("objects service %s: cannot keep the previous credential for backend re-encryption", name)
				}
			}
		}
		if rotated || ref == "" {
			if ref == "" {
				ref = config.NewKeyForSecret()
			}
			if er := config.SetSecret(ctx, ref, secret); er != nil {
				return fmt.Errorf("objects service %s: cannot store the delivered secret in the vault", name)
			}
			if er := config.Set(ctx, access, "services", objectsConfigPath(name), "ApiKey"); er != nil {
				return er
			}
			if er := config.Set(ctx, ref, "services", objectsConfigPath(name), "ApiSecret"); er != nil {
				return er
			}
			changed = true
		}
		for dsName, ds := range sources {
			if ds == nil || ds.ObjectsServiceName != name || (ds.ApiKey == access && ds.ApiSecret == ref) {
				continue
			}
			if er := config.Set(ctx, access, "services", syncConfigPath(dsName), "ApiKey"); er != nil {
				return er
			}
			if er := config.Set(ctx, ref, "services", syncConfigPath(dsName), "ApiSecret"); er != nil {
				return er
			}
			changed = true
		}
	}
	if changed {
		if err := config.Save(ctx, "cli", "Apply delivered datasource keys"); err != nil {
			return errors.New("datasource keys could not be persisted")
		}
	}
	if err := checkDatasourceKeys(ctx, local, access, secret); err != nil {
		return err
	}
	if changed {
		cmd.Printf("Delivered datasource keys applied to %d local object service(s) and their datasources; restart pending\n", len(local))
	} else {
		cmd.Printf("Delivered datasource keys already in effect on %d local object service(s)\n", len(local))
	}
	return nil
}

// checkDatasourceKeys reads the stored configuration back.
func checkDatasourceKeys(ctx context.Context, local []string, access, secret string) error {
	sources := config.ListSourcesFromConfig(ctx)
	for _, name := range local {
		stored := config.GetMinioConfigForName(ctx, name, true)
		resolved := config.GetMinioConfigForName(ctx, name, false)
		if stored == nil || resolved == nil || resolved.ApiKey != access || resolved.ApiSecret != secret ||
			config.GetSecret(ctx, stored.ApiSecret).String() != secret {
			return fmt.Errorf("objects service %s: stored keys differ from the delivered keys", name)
		}
		for dsName, ds := range sources {
			if ds != nil && ds.ObjectsServiceName == name && (ds.ApiKey != access || ds.ApiSecret != stored.ApiSecret) {
				return fmt.Errorf("datasource %s: stored keys differ from its object service", dsName)
			}
		}
	}
	return nil
}

func verifyDatasourceKeys(cmd *cobra.Command, access, secret string) error {
	ctx := cmd.Context()
	local, minios, err := localObjectServices(ctx)
	if err != nil {
		return err
	}
	if err := checkDatasourceKeys(ctx, local, access, secret); err != nil {
		return err
	}
	current, err := auth.CreateCredentials(access, secret)
	if err != nil {
		return errors.New("delivered datasource keys are not a valid object service credential")
	}
	for _, name := range local {
		mc := minios[name]
		endpoint := fmt.Sprintf("127.0.0.1:%d", mc.RunningPort)
		if err := probeObjectService(ctx, endpoint, access, secret); err != nil {
			return fmt.Errorf("objects service %s does not accept the delivered credential", name)
		}
		previousKey := objects.PreviousCredentialSecret(name)
		previous, pending, err := objects.ParsePreviousCredential(config.GetSecret(ctx, previousKey).String())
		if err != nil {
			return fmt.Errorf("objects service %s: %w", name, err)
		}
		if !pending {
			cmd.Printf("objects service %s: delivered credential accepted; no rotation pending\n", name)
			continue
		}
		if previous.Equal(current) {
			return fmt.Errorf("objects service %s: pending previous credential equals the delivered one", name)
		}
		if !refusedCredential(probeObjectService(ctx, endpoint, previous.AccessKey, previous.SecretKey)) {
			return fmt.Errorf("objects service %s does not refuse the previous credential", name)
		}
		if needed, err := objects.PreviousCredentialNeeded(mc.LocalFolder, current); err != nil || needed {
			cmd.Printf("objects service %s: delivered credential accepted, previous refused; backend re-encryption not yet observed, previous kept for the next start\n", name)
			continue
		}
		if err := config.DelSecret(ctx, previousKey); err != nil {
			return fmt.Errorf("objects service %s: cannot remove the previous credential", name)
		}
		cmd.Printf("objects service %s: delivered credential accepted, previous refused, backend re-encrypted; previous credential removed\n", name)
	}
	return nil
}

func probeObjectService(ctx context.Context, endpoint, access, secret string) error {
	client, err := minio.New(endpoint, &minio.Options{Creds: credentials.NewStaticV4(access, secret, ""), Secure: false})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_, err = client.ListBuckets(ctx)
	return err
}

// refusedCredential is true only for an explicit S3 authentication refusal,
// never for a transport error that would prove nothing.
func refusedCredential(err error) bool {
	if err == nil {
		return false
	}
	switch minio.ToErrorResponse(err).Code {
	case "InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied":
		return true
	}
	return false
}

func init() {
	dsKeysCmd.Flags().StringVar(&dsKeysAccessFile, "access-key-file", "", "Owner-only file holding the datasource access key")
	dsKeysCmd.Flags().StringVar(&dsKeysSecretFile, "secret-key-file", "", "Owner-only file holding the datasource secret key")
	dsKeysCmd.Flags().BoolVar(&dsKeysVerify, "verify", false, "Verify the delivered keys against the running object services and clear a completed rotation")
	DataSourceCmd.AddCommand(dsKeysCmd)
}
