package auth_test

// DD-165, .design/07 §4.8.9: the hourly Kailo storage snapshot report.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/pydio/cells/v5/common/auth"
)

type usageCore struct {
	mu       sync.Mutex
	statuses []int
	bodies   []map[string]any
	tokens   int
}

func (c *usageCore) server(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		defer c.mu.Unlock()
		switch r.URL.Path {
		case "/token":
			c.tokens++
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "tok", "token_type": "Bearer", "expires_in": 300})
		case "/service/v1/component-usage/bindings/" + notifyBinding + "/reports":
			var body map[string]any
			if r.Method != http.MethodPost || json.NewDecoder(r.Body).Decode(&body) != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			c.bodies = append(c.bodies, body)
			status := http.StatusCreated
			if len(c.statuses) > 0 {
				status, c.statuses = c.statuses[0], c.statuses[1:]
			}
			w.WriteHeader(status)
		default:
			t.Errorf("unexpected request %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func TestNativeOIDCStorageSnapshot(t *testing.T) {
	at := time.Date(2026, 10, 30, 9, 41, 12, 500, time.FixedZone("CST", 8*3600))
	report, err := auth.NativeOIDCStorageSnapshot(1234, at)
	if err != nil {
		t.Fatal(err)
	}
	if report.IdempotencyKey != "cells.storage.2026103001" || report.MeterKey != "file_storage_bytes" ||
		report.Quantity != 1234 || report.OccurredAt != "2026-10-30T01:41:12Z" || report.Member != nil {
		t.Fatalf("snapshot %+v", report)
	}
	// The same UTC hour is the same key: a retry within the hour is a duplicate.
	again, _ := auth.NativeOIDCStorageSnapshot(1300, at.Add(10*time.Minute))
	if again.IdempotencyKey != report.IdempotencyKey {
		t.Fatalf("same hour, different key %q", again.IdempotencyKey)
	}
	for _, bad := range []int64{-1, 1_000_000_000_000_001} {
		if _, err := auth.NativeOIDCStorageSnapshot(bad, at); err == nil {
			t.Fatalf("size %d must be refused", bad)
		}
	}
	raw, _ := json.Marshal(report)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	if _, ok := body["member"]; ok || len(body) != 4 {
		t.Fatalf("a storage snapshot has no member: %s", raw)
	}
}

func TestNativeOIDCUsageReporter(t *testing.T) {
	cases := []struct {
		name     string
		statuses []int
		done     bool
		retry    bool
		posts    int
	}{
		{"created", []int{201}, true, false, 1},
		{"duplicate", []int{200}, true, false, 1},
		{"conflict final", []int{409}, false, false, 1},
		{"unavailable retried", []int{503}, false, true, 1},
		{"rate limited retried", []int{429}, false, true, 1},
		{"403 refreshes once", []int{403, 201}, true, false, 2},
	}
	report, _ := auth.NativeOIDCStorageSnapshot(42, time.Date(2026, 10, 30, 1, 0, 0, 0, time.UTC))
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			core := &usageCore{statuses: c.statuses}
			srv := core.server(t)
			defer srv.Close()
			r := auth.NewNativeOIDCUsageReporter(notifyConfig(t, srv))
			result := r.Report(context.Background(), report)
			if result.Done != c.done || result.Retry != c.retry || len(core.bodies) != c.posts {
				t.Fatalf("result %+v posts %d", result, len(core.bodies))
			}
			if core.bodies[0]["meterKey"] != "file_storage_bytes" || core.bodies[0]["quantity"] != float64(42) {
				t.Fatalf("body %v", core.bodies[0])
			}
		})
	}
}
