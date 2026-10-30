package auth

// Kailo unified metering (DD-163, .design/07 §4.8.8). In Kailo mode this
// instance reports its stored user content as an hourly `file_storage_bytes`
// snapshot:
//
//	POST {KAILO_DIRECTORY_CORE_URL}/service/v1/component-usage/bindings/{KAILO_DIRECTORY_BINDING_ID}/reports
//
// with the member directory client's client-credentials token (07 §4.7.4;
// same configuration and all-or-none rule as the directory read and the
// notification delivery). A snapshot is a full restatement: its key is the
// UTC hour, so a retry within the hour is a duplicate for Core and a missed
// hour is never back-filled. This file holds the transport and the pure
// rules; the native byte count lives in frontend/web/service
// (kailo-usage.go). Logs carry the binding, the meter and the HTTP status,
// never a token.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// NativeOIDCStorageMeter is the platform meter of a storage snapshot.
const NativeOIDCStorageMeter = "file_storage_bytes"

// nativeOIDCStorageMax is Core's upper bound of one snapshot (10^15 bytes).
const nativeOIDCStorageMax = int64(1_000_000_000_000_000)

// NativeOIDCUsageReport is one ComponentUsageReport body.
type NativeOIDCUsageReport struct {
	IdempotencyKey string            `json:"idempotencyKey"`
	MeterKey       string            `json:"meterKey"`
	Quantity       int64             `json:"quantity"`
	OccurredAt     string            `json:"occurredAt"`
	Member         *NativeOIDCPerson `json:"member,omitempty"`
}

// NativeOIDCStorageSnapshot is the report of the stored bytes at one moment;
// the key is the UTC hour of that moment.
func NativeOIDCStorageSnapshot(size int64, at time.Time) (NativeOIDCUsageReport, error) {
	if size < 0 || size > nativeOIDCStorageMax {
		return NativeOIDCUsageReport{}, errors.New("storage snapshot out of contract")
	}
	at = at.UTC().Truncate(time.Second)
	return NativeOIDCUsageReport{
		IdempotencyKey: "cells.storage." + at.Format("2006010215"),
		MeterKey:       NativeOIDCStorageMeter,
		Quantity:       size,
		OccurredAt:     at.Format(time.RFC3339),
	}, nil
}

// NativeOIDCUsageReporter posts usage reports to Core with the directory
// client's token (cached, refreshed once on 401/403).
type NativeOIDCUsageReporter struct {
	config *NativeOIDCDirectoryConfig
	Now    func() time.Time

	tokenMu     sync.Mutex
	bearer      string
	bearerUntil time.Time
}

// NewNativeOIDCUsageReporter builds a reporter on a validated directory config.
func NewNativeOIDCUsageReporter(c *NativeOIDCDirectoryConfig) *NativeOIDCUsageReporter {
	return &NativeOIDCUsageReporter{config: c, Now: time.Now}
}

// BindingID is the binding the reports are attributed to.
func (r *NativeOIDCUsageReporter) BindingID() string {
	return r.config.BindingID
}

func (r *NativeOIDCUsageReporter) token(ctx context.Context, refresh bool) (string, error) {
	r.tokenMu.Lock()
	defer r.tokenMu.Unlock()
	if !refresh && r.bearer != "" && r.Now().Before(r.bearerUntil) {
		return r.bearer, nil
	}
	r.bearer = ""
	bearer, lifetime, err := r.config.clientCredentials(ctx)
	if err != nil {
		return "", err
	}
	if lifetime > notifyTokenMargin {
		r.bearer, r.bearerUntil = bearer, r.Now().Add(lifetime-notifyTokenMargin)
	}
	return bearer, nil
}

// Report makes one delivery attempt: Done on 200/201, Retry on 429/5xx or no
// answer; 400, 403 (after one token refresh) and 409 are final.
func (r *NativeOIDCUsageReporter) Report(ctx context.Context, report NativeOIDCUsageReport) NativeOIDCDelivery {
	body, err := json.Marshal(report)
	if err != nil {
		return NativeOIDCDelivery{}
	}
	target := strings.TrimSuffix(r.config.CoreURL, "/") + "/service/v1/component-usage/bindings/" +
		url.PathEscape(r.config.BindingID) + "/reports"
	for refreshed := false; ; refreshed = true {
		bearer, err := r.token(ctx, refreshed)
		if err != nil {
			return NativeOIDCDelivery{Retry: true}
		}
		status, err := r.post(ctx, target, bearer, body)
		if err != nil {
			return NativeOIDCDelivery{Retry: true}
		}
		switch {
		case status == http.StatusOK || status == http.StatusCreated:
			return NativeOIDCDelivery{Status: status, Done: true}
		case (status == http.StatusUnauthorized || status == http.StatusForbidden) && !refreshed:
			continue
		case status == http.StatusTooManyRequests || status >= 500:
			return NativeOIDCDelivery{Status: status, Retry: true}
		default:
			return NativeOIDCDelivery{Status: status}
		}
	}
}

func (r *NativeOIDCUsageReporter) post(ctx context.Context, target, bearer string, body []byte) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+bearer)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := r.config.client().Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, notifyBodyMax))
	return resp.StatusCode, nil
}

// StartNativeOIDCUsageReporter returns the reporter, or nil (no error) when
// not in Kailo mode or when the directory client is not delivered.
func StartNativeOIDCUsageReporter() (*NativeOIDCUsageReporter, error) {
	if !NativeKailoMode() {
		return nil, nil
	}
	cfg, err := NativeOIDCDirectoryConfigFromEnv()
	if err != nil || cfg == nil {
		return nil, err
	}
	return NewNativeOIDCUsageReporter(cfg), nil
}
