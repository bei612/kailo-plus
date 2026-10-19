package cmd

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	minio "github.com/minio/minio-go/v7"
	"github.com/minio/minio/pkg/auth"
	"github.com/spf13/cobra"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common"
	clientgrpc "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/proto/object"
	"github.com/pydio/cells/v5/common/utils/propagator"
	"github.com/pydio/cells/v5/data/source/objects"
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
	if !transportError(errors.New("dial tcp: connection refused")) || !transportError(context.DeadlineExceeded) {
		t.Fatal("a missing S3 answer is not a transport error")
	}
	for _, err := range []error{nil, minio.ErrorResponse{Code: "InvalidAccessKeyId"}, minio.ErrorResponse{Code: "InternalError"}} {
		if transportError(err) {
			t.Fatalf("%v treated as a transport error", err)
		}
	}
}

// Test-only placeholders, not credentials of any deployment.
const (
	verifyFixtureAccess          = "PlaceholderAccess0001"
	verifyFixtureSecret          = "placeholder-secret-fixture-0001"
	verifyFixturePreviousAccess  = "PlaceholderPrevious0001"
	verifyFixturePreviousSecret  = "placeholder-previous-fixture-0001"
	verifyFixtureGetMinioConfig  = "/object.ObjectsEndpoint/GetMinioConfig"
	verifyFixtureCredentialField = "Credential="
)

// fakeS3 answers ListBuckets for the accepted access key and refuses any
// other with InvalidAccessKeyId; it records every presented access key.
type fakeS3 struct {
	*httptest.Server
	port      int32
	accepted  string
	mu        sync.Mutex
	presented []string
}

func newFakeS3(t *testing.T, accepted string) *fakeS3 {
	f := &fakeS3{accepted: accepted}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		access := presentedAccessKey(r.Header.Get("Authorization"))
		f.mu.Lock()
		f.presented = append(f.presented, access)
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/xml")
		if r.Method != http.MethodGet || r.URL.Path != "/" || access != f.accepted {
			w.WriteHeader(http.StatusForbidden)
			_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidAccessKeyId</Code><Message>The Access Key Id you provided does not exist in our records.</Message></Error>`)
			return
		}
		_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>fixture</ID><DisplayName>fixture</DisplayName></Owner><Buckets></Buckets></ListAllMyBucketsResult>`)
	}))
	t.Cleanup(f.Close)
	u, err := url.Parse(f.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatal(err)
	}
	f.port = int32(port)
	return f
}

func (f *fakeS3) presentedKeys() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.presented...)
}

// presentedAccessKey extracts the access key of a SigV4 Authorization header.
func presentedAccessKey(header string) string {
	i := strings.Index(header, verifyFixtureCredentialField)
	if i < 0 {
		return ""
	}
	access, _, _ := strings.Cut(header[i+len(verifyFixtureCredentialField):], "/")
	return access
}

// fakeObjectsEndpoint stands in for the running objects service reached
// through the registry (pydio.grpc.data.objects.<name>).
type fakeObjectsEndpoint struct {
	running *object.MinioConfig
	err     error
	lookups int
}

func (f *fakeObjectsEndpoint) Invoke(_ context.Context, method string, _ any, reply any, _ ...grpc.CallOption) error {
	if method != verifyFixtureGetMinioConfig {
		return status.Error(codes.Unimplemented, method)
	}
	f.lookups++
	if f.err != nil {
		return f.err
	}
	proto.Merge(reply.(*object.GetMinioConfigResponse), &object.GetMinioConfigResponse{MinioConfig: f.running})
	return nil
}

func (f *fakeObjectsEndpoint) NewStream(context.Context, *grpc.StreamDesc, string, ...grpc.CallOption) (grpc.ClientStream, error) {
	return nil, status.Error(codes.Unimplemented, "no stream")
}

type verifyFixture struct {
	ctx      context.Context
	cmd      *cobra.Command
	out      *bytes.Buffer
	current  auth.Credentials
	previous auth.Credentials
	stale    *fakeS3
	stored   *object.MinioConfig
}

// newVerifyFixture stores a pending rotation in a vault and a configuration
// whose RunningPort is a listener that must never be probed: the objects
// service listens on another port, chosen at its start.
func newVerifyFixture(t *testing.T, name string) *verifyFixture {
	current, err := auth.CreateCredentials(verifyFixtureAccess, verifyFixtureSecret)
	if err != nil {
		t.Fatal(err)
	}
	previous, err := auth.CreateCredentials(verifyFixturePreviousAccess, verifyFixturePreviousSecret)
	if err != nil {
		t.Fatal(err)
	}
	ctx := propagator.With[config.Store](context.Background(), config.VaultKey, config.NewStore())
	encoded, err := objects.EncodePreviousCredential(previous.AccessKey, previous.SecretKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := config.SetSecret(ctx, objects.PreviousCredentialSecret(name), encoded); err != nil {
		t.Fatal(err)
	}
	f := &verifyFixture{ctx: ctx, cmd: &cobra.Command{}, out: &bytes.Buffer{}, current: current, previous: previous}
	f.cmd.SetContext(ctx)
	f.cmd.SetOut(f.out)
	f.stale = newFakeS3(t, current.AccessKey)
	f.stored = &object.MinioConfig{Name: name, StorageType: object.StorageType_LOCAL, RunningHost: "127.0.0.1", RunningPort: f.stale.port, LocalFolder: t.TempDir()}
	return f
}

// runningAt registers the running objects service reporting the given S3 port.
func (f *verifyFixture) runningAt(port int32) *fakeObjectsEndpoint {
	running := proto.Clone(f.stored).(*object.MinioConfig)
	running.RunningPort = port
	lookup := &fakeObjectsEndpoint{running: running}
	clientgrpc.RegisterMock(common.ServiceDataObjectsGRPC_+f.stored.Name, lookup)
	return lookup
}

func (f *verifyFixture) previousPending() bool {
	return config.GetSecret(f.ctx, objects.PreviousCredentialSecret(f.stored.Name)).String() != ""
}

func TestVerifyProbesTheRunningObjectServiceEndpoint(t *testing.T) {
	f := newVerifyFixture(t, "verify-running-endpoint")
	s3 := newFakeS3(t, f.current.AccessKey)
	if s3.port == f.stored.RunningPort {
		t.Fatal("fixture ports collide")
	}
	lookup := f.runningAt(s3.port)

	if err := verifyObjectService(f.cmd, f.stored.Name, f.stored, f.current); err != nil {
		t.Fatalf("verification against the running endpoint failed: %v", err)
	}
	if lookup.lookups != 1 {
		t.Fatalf("running endpoint looked up %d times", lookup.lookups)
	}
	if len(f.stale.presentedKeys()) != 0 {
		t.Fatal("the stored RunningPort was probed")
	}
	presented := s3.presentedKeys()
	var sawCurrent, sawPrevious bool
	for _, access := range presented {
		switch access {
		case f.current.AccessKey:
			sawCurrent = true
		case f.previous.AccessKey:
			sawPrevious = true
		default:
			t.Fatal("an unexpected credential was presented")
		}
	}
	if len(presented) == 0 || presented[0] != f.current.AccessKey || !sawCurrent || !sawPrevious {
		t.Fatal("running endpoint did not check the delivered then the previous credential")
	}
	if f.previousPending() {
		t.Fatal("previous credential kept although the backend needs no re-encryption")
	}
	if !strings.Contains(f.out.String(), "previous refused, backend re-encrypted; previous credential removed") {
		t.Fatalf("unexpected verification report: %q", f.out.String())
	}
}

func TestVerifyReportsAMissingRunningEndpointAsTransport(t *testing.T) {
	f := newVerifyFixture(t, "verify-missing-endpoint")
	for _, lookup := range []*fakeObjectsEndpoint{
		{err: status.Error(codes.Unavailable, "objects service not registered")},
		{running: &object.MinioConfig{Name: f.stored.Name, StorageType: object.StorageType_LOCAL}},
		{running: &object.MinioConfig{Name: f.stored.Name, StorageType: object.StorageType_S3, RunningPort: f.stale.port}},
	} {
		clientgrpc.RegisterMock(common.ServiceDataObjectsGRPC_+f.stored.Name, lookup)
		err := verifyObjectService(f.cmd, f.stored.Name, f.stored, f.current)
		if err == nil || !strings.Contains(err.Error(), "running S3 endpoint not found") || strings.Contains(err.Error(), "credential") {
			t.Fatalf("missing running endpoint not reported as such: %v", err)
		}
	}
	if len(f.stale.presentedKeys()) != 0 {
		t.Fatal("the stored RunningPort was probed")
	}
	if !f.previousPending() || f.out.Len() != 0 {
		t.Fatal("a failed lookup changed the vault or reported progress")
	}
}

func TestVerifyReportsAnUnreachableRunningEndpointAsTransport(t *testing.T) {
	f := newVerifyFixture(t, "verify-unreachable-endpoint")
	closed := newFakeS3(t, f.current.AccessKey)
	closed.Close()
	f.runningAt(closed.port)
	err := verifyObjectService(f.cmd, f.stored.Name, f.stored, f.current)
	if err == nil || !strings.Contains(err.Error(), "unreachable") || strings.Contains(err.Error(), "does not accept") {
		t.Fatalf("unreachable running endpoint not reported as such: %v", err)
	}
	if len(f.stale.presentedKeys()) != 0 {
		t.Fatal("the stored RunningPort was probed")
	}
	if !f.previousPending() {
		t.Fatal("an unreachable endpoint removed the previous credential")
	}
}

func TestVerifyRefusalKeepsThePreviousCredential(t *testing.T) {
	f := newVerifyFixture(t, "verify-refused-credential")
	s3 := newFakeS3(t, "PlaceholderOtherKey0001")
	f.runningAt(s3.port)
	err := verifyObjectService(f.cmd, f.stored.Name, f.stored, f.current)
	if err == nil || !strings.Contains(err.Error(), "does not accept the delivered credential") {
		t.Fatalf("refused delivered credential not reported: %v", err)
	}
	if len(f.stale.presentedKeys()) != 0 {
		t.Fatal("the stored RunningPort was probed")
	}
	if !f.previousPending() {
		t.Fatal("a refused delivered credential removed the previous credential")
	}
}
