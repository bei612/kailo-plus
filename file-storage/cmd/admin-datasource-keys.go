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
	"github.com/pydio/cells/v5/common/client/grpc"
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
  service, probed at the S3 endpoint it reports through the registry (its
  port is chosen at each start), must accept the delivered credential and
  refuse a pending previous one; once the backend is re-encrypted the pending
  previous credential is removed from the vault.

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
		if err := verifyObjectService(cmd, name, minios[name], current); err != nil {
			return err
		}
	}
	return nil
}

// verifyObjectService checks one running local object service at the S3
// endpoint it serves and clears a completed rotation. stored is the stored
// configuration: its RunningPort is not where MinIO listens.
func verifyObjectService(cmd *cobra.Command, name string, stored *object.MinioConfig, current auth.Credentials) error {
	ctx := cmd.Context()
	endpoint, secure, err := runningObjectEndpoint(ctx, name)
	if err != nil {
		return err
	}
	if err := probeObjectService(ctx, endpoint, secure, current.AccessKey, current.SecretKey); err != nil {
		if transportError(err) {
			return fmt.Errorf("objects service %s: S3 endpoint %s unreachable: %v", name, endpoint, err)
		}
		return fmt.Errorf("objects service %s does not accept the delivered credential", name)
	}
	previousKey := objects.PreviousCredentialSecret(name)
	previous, pending, err := objects.ParsePreviousCredential(config.GetSecret(ctx, previousKey).String())
	if err != nil {
		return fmt.Errorf("objects service %s: %w", name, err)
	}
	if !pending {
		cmd.Printf("objects service %s: delivered credential accepted; no rotation pending\n", name)
		return nil
	}
	if previous.Equal(current) {
		return fmt.Errorf("objects service %s: pending previous credential equals the delivered one", name)
	}
	err = probeObjectService(ctx, endpoint, secure, previous.AccessKey, previous.SecretKey)
	if transportError(err) {
		return fmt.Errorf("objects service %s: S3 endpoint %s unreachable: %v", name, endpoint, err)
	}
	if !refusedCredential(err) {
		return fmt.Errorf("objects service %s does not refuse the previous credential", name)
	}
	if needed, err := objects.PreviousCredentialNeeded(stored.LocalFolder, current); err != nil || needed {
		cmd.Printf("objects service %s: delivered credential accepted, previous refused; backend re-encryption not yet observed, previous kept for the next start\n", name)
		return nil
	}
	if err := config.DelSecret(ctx, previousKey); err != nil {
		return fmt.Errorf("objects service %s: cannot remove the previous credential", name)
	}
	cmd.Printf("objects service %s: delivered credential accepted, previous refused, backend re-encrypted; previous credential removed\n", name)
	return nil
}

// Bound on the registry lookup of a running object service.
const objectLookupTimeout = 30 * time.Second

// runningObjectEndpoint asks the running objects service, through the Cells
// registry, for the S3 endpoint it serves, as the datasource sync services do
// (data/source/sync/clients.CheckSubServices). The service picks a free port at
// each start (data/source/objects/grpc.InitMinioConfig) and never persists it,
// so the stored RunningPort is stale.
func runningObjectEndpoint(ctx context.Context, name string) (string, bool, error) {
	cli := object.NewObjectsEndpointClient(grpc.ResolveConn(ctx, common.ServiceDataObjectsGRPC_+name, grpc.WithCallTimeout(objectLookupTimeout)))
	ctx, cancel := context.WithTimeout(ctx, objectLookupTimeout)
	defer cancel()
	resp, err := cli.GetMinioConfig(ctx, &object.GetMinioConfigRequest{})
	if err != nil {
		return "", false, fmt.Errorf("objects service %s: running S3 endpoint not found: %v", name, err)
	}
	running := resp.GetMinioConfig()
	if running == nil || running.StorageType != object.StorageType_LOCAL || running.RunningPort <= 0 {
		return "", false, fmt.Errorf("objects service %s: running S3 endpoint not found: the service reports no local S3 port", name)
	}
	return running.BuildUrl(), running.RunningSecure, nil
}

func probeObjectService(ctx context.Context, endpoint string, secure bool, access, secret string) error {
	client, err := minio.New(endpoint, &minio.Options{Creds: credentials.NewStaticV4(access, secret, ""), Secure: secure})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	_, err = client.ListBuckets(ctx)
	return err
}

// transportError is true when no S3 answer was received at all (connection,
// TLS or timeout failure): the credential was neither accepted nor refused.
func transportError(err error) bool {
	return err != nil && minio.ToErrorResponse(err).Code == ""
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
