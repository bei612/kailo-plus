package mc

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	minio "github.com/minio/minio-go/v7"
	"github.com/pydio/cells/v5/common/nodes/models"
)

func TestNativeMultipartPartsPreserveStorageResponse(t *testing.T) {
	for _, scenario := range []string{"parts", "empty", "denied"} {
		t.Run(scenario, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/native-bucket/object.bin" || r.URL.Query().Get("uploadId") != "native-upload" {
					t.Errorf("wrong original parts request: %s %s", r.Method, r.URL)
				}
				w.Header().Set("Content-Type", "application/xml")
				if scenario == "denied" {
					w.WriteHeader(http.StatusForbidden)
					fmt.Fprint(w, `<Error><Code>AccessDenied</Code><Message>denied</Message></Error>`)
					return
				}
				parts := ""
				if scenario == "parts" {
					parts = `<Part><PartNumber>2</PartNumber><LastModified>2026-10-10T00:00:00Z</LastModified><ETag>"part-two"</ETag><Size>7</Size></Part><Part><PartNumber>3</PartNumber><LastModified>2026-10-10T00:00:01Z</LastModified><ETag>"part-three"</ETag><Size>0</Size></Part>`
				}
				fmt.Fprintf(w, `<ListPartsResult><Bucket>native-bucket</Bucket><Key>object.bin</Key><UploadId>native-upload</UploadId><PartNumberMarker>1</PartNumberMarker><NextPartNumberMarker>3</NextPartNumberMarker><MaxParts>2</MaxParts><IsTruncated>true</IsTruncated>%s</ListPartsResult>`, parts)
			}))
			defer server.Close()
			core, err := minio.NewCore(strings.TrimPrefix(server.URL, "http://"), &minio.Options{Region: "us-east-1"})
			if err != nil {
				t.Fatal(err)
			}
			result, err := (&Client{mc: core}).ListObjectParts(context.Background(), "native-bucket", "object.bin", "native-upload", 1, 2)
			if scenario == "denied" {
				if err == nil || len(result.ObjectParts) != 0 {
					t.Fatal("denied enumeration became an empty success")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if result.UploadID != "native-upload" || result.Key != "object.bin" || result.NextPartNumberMarker != 3 || result.PartNumberMarker != 1 || result.MaxParts != 2 || !result.IsTruncated {
				t.Fatalf("pagination evidence changed: %+v", result)
			}
			if scenario == "empty" {
				if len(result.ObjectParts) != 0 {
					t.Fatal("empty listing invented parts")
				}
				return
			}
			if len(result.ObjectParts) != 2 {
				t.Fatalf("original uploaded parts lost: %+v", result.ObjectParts)
			}
			for i, part := range result.ObjectParts {
				wantTag := []string{`"part-two"`, `"part-three"`}[i]
				wantSize := []int64{7, 0}[i]
				if part.PartNumber != i+2 || part.ETag != wantTag || part.Size != wantSize || part.LastModified.Unix() != time.Date(2026, 10, 10, 0, 0, i, 0, time.UTC).Unix() {
					t.Fatalf("native part changed: %+v", part)
				}
			}
		})
	}
}

func TestNativeMultipartCompletionAndStatUseSDKETags(t *testing.T) {
	const etag = "native-multipart-2"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/native-bucket/object.bin" {
			t.Errorf("unexpected object: %s", r.URL)
		}
		switch r.Method {
		case http.MethodPost:
			var complete struct {
				Parts []struct {
					PartNumber int
					ETag       string
				} `xml:"Part"`
			}
			if r.URL.Query().Get("uploadId") != "native-upload" || xml.NewDecoder(r.Body).Decode(&complete) != nil || len(complete.Parts) != 1 || complete.Parts[0].PartNumber != 1 || strings.Trim(complete.Parts[0].ETag, "\"") != "part-etag" {
				t.Error("original multipart completion was not preserved")
			}
			w.Header().Set("Content-Type", "application/xml")
			fmt.Fprintf(w, `<CompleteMultipartUploadResult><Bucket>native-bucket</Bucket><Key>object.bin</Key><ETag>"%s"</ETag></CompleteMultipartUploadResult>`, etag)
		case http.MethodHead:
			w.Header().Set("ETag", `"`+etag+`"`)
			w.Header().Set("Content-Length", "0")
			w.Header().Set("Last-Modified", "Sat, 10 Oct 2026 00:00:00 GMT")
		default:
			t.Errorf("unexpected method: %s", r.Method)
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer server.Close()
	core, err := minio.NewCore(strings.TrimPrefix(server.URL, "http://"), &minio.Options{Region: "us-east-1"})
	if err != nil {
		t.Fatal(err)
	}
	client := &Client{mc: core}
	completed, err := client.CompleteMultipartUpload(context.Background(), "native-bucket", "object.bin", "native-upload", []models.MultipartObjectPart{{PartNumber: 1, ETag: "part-etag"}})
	if err != nil {
		t.Fatal(err)
	}
	stat, err := client.StatObject(context.Background(), "native-bucket", "object.bin", nil)
	if err != nil || completed != etag || stat.ETag != completed || stat.Key != "object.bin" || stat.Size != 0 {
		t.Fatalf("SDK multipart/HEAD normalization differs: %s %+v %v", completed, stat, err)
	}
}
