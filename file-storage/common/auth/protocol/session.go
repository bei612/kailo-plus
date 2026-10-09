// Package protocol authenticates the original binding callback to Core. It
// stores neither platform users nor protocol sessions in the native service.
package protocol

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pborman/uuid"
	"github.com/pydio/cells/v5/common/config"
)

type Delivery struct {
	BindingID            string `json:"bindingId"`
	CorePEPURL           string `json:"corePepUrl"`
	OIDCTokenURL         string `json:"oidcTokenUrl"`
	ClientID             string `json:"clientId"`
	ClientSecretFile     string `json:"clientSecretFile"`
	InstanceServiceUUID  string `json:"instanceServiceUuid"`
	RequestTimeout       string `json:"requestTimeout"`
	MaxResponseBytes     int64  `json:"maxResponseBytes"`
	ClientSecretMaxBytes int64  `json:"clientSecretMaxBytes"`
}

// These bounds come from the native config store's controlled delivery. No
// defaults, response-selected endpoints or browser-selected binding are used.
func Load(ctx context.Context) (Delivery, error) {
	var delivery Delivery
	if err := config.Get(ctx, "services", "wopi", "platform").Scan(&delivery); err != nil {
		return Delivery{}, err
	}
	if err := delivery.validate(); err != nil {
		return Delivery{}, err
	}
	return delivery, nil
}

func canonicalUUID(value string) bool {
	id := uuid.Parse(value)
	return id != nil && id.String() == value && value != "00000000-0000-0000-0000-000000000000"
}

func endpoint(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("invalid controlled protocol endpoint")
	}
	return u, nil
}

func (d Delivery) validate() error {
	pep, err := endpoint(d.CorePEPURL)
	if err != nil || pep.Path != "/service/v1/adapter/pep_check" {
		return errors.New("invalid Core protocol PEP endpoint")
	}
	if _, err = endpoint(d.OIDCTokenURL); err != nil {
		return err
	}
	timeout, err := time.ParseDuration(d.RequestTimeout)
	if err != nil || timeout <= 0 || d.MaxResponseBytes <= 0 || d.MaxResponseBytes >= math.MaxInt64 ||
		d.ClientSecretMaxBytes <= 0 || d.ClientSecretMaxBytes >= math.MaxInt64 ||
		!canonicalUUID(d.BindingID) || !canonicalUUID(d.InstanceServiceUUID) || d.ClientID == "" ||
		!filepath.IsAbs(d.ClientSecretFile) {
		return errors.New("incomplete native protocol delivery")
	}
	return nil
}

// Facts is the closed machine encoding of the original ProtocolSession fields.
// BaseRevision is not proof that a native version exists; the WOPI consumer must
// still read Cells' exact ContentRevision and use GetObject(VersionId).
type Facts struct {
	Decision          string    `json:"decision"`
	PlatformHumanID   string    `json:"platformHumanId"`
	OIDCIssuer        string    `json:"oidcIssuer"`
	OIDCSubject       string    `json:"oidcSubject"`
	DisplayName       string    `json:"displayName"`
	AdmittedMode      string    `json:"admittedMode"`
	MinZedToken       string    `json:"minZedToken"`
	BaseRevision      string    `json:"baseRevision"`
	ExpiresAt         time.Time `json:"expiresAt"`
	ExportAllowed     bool      `json:"exportAllowed"`
	PostMessageOrigin string    `json:"postMessageOrigin"`
	NativeSessionRef  string    `json:"nativeSessionRef,omitempty"`
}

func decode(response *http.Response, limit int64, destination interface{}) error {
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errors.New("protocol authority refused or unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || int64(len(data)) > limit {
		return errors.New("protocol response unavailable or oversized")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(destination); err != nil {
		return err
	}
	if decoder.Decode(new(interface{})) != io.EOF {
		return errors.New("trailing protocol response")
	}
	return nil
}

// Resolve performs fresh original PEP on every operation. Neither an unavailable
// PEP nor a previously allowed PAT can fall back to cached authorization.
func (d Delivery) Resolve(ctx context.Context, sessionID, nodeID, operation string) (*Facts, error) {
	if !canonicalUUID(sessionID) || !canonicalUUID(nodeID) || (operation != "OPEN" && operation != "READ" && operation != "WRITE") {
		return nil, errors.New("invalid native protocol intent")
	}
	var facts Facts
	if err := d.request(ctx, map[string]interface{}{"protocolSessionId": sessionID, "nativeObjectRef": nodeID,
		"nativeOperation": operation, "bindingId": d.BindingID}, &facts); err != nil {
		return nil, err
	}
	if facts.Decision != "ALLOW" || !canonicalUUID(facts.PlatformHumanID) || facts.DisplayName == "" ||
		facts.OIDCIssuer == "" || facts.OIDCSubject == "" ||
		(facts.AdmittedMode != "VIEW" && facts.AdmittedMode != "EDIT") || facts.MinZedToken == "" ||
		facts.BaseRevision == "" || strings.TrimSpace(facts.BaseRevision) != facts.BaseRevision || !facts.ExpiresAt.After(time.Now()) ||
		(operation == "WRITE" && facts.AdmittedMode != "EDIT") {
		return nil, errors.New("invalid original protocol session facts")
	}
	origin, err := endpoint(facts.PostMessageOrigin)
	if err != nil || origin.Path != "" || origin.String() != origin.Scheme+"://"+origin.Host {
		return nil, errors.New("invalid original protocol host origin")
	}
	return &facts, nil
}

// request is the one binding-authenticated callback transport. A native write
// receipt has a different closed response from an authorization decision and
// cannot be mistaken for permission to continue reading or writing.
func (d Delivery) request(ctx context.Context, payload map[string]interface{}, destination interface{}) error {
	_, err := d.callback(ctx, d.CorePEPURL, "", payload, destination)
	return err
}

// callback is shared by the existing PEP and native HUMAN ActionCommand
// consumers. The endpoint is selected by these methods, never by the browser.
func (d Delivery) callback(ctx context.Context, target, humanToken string, payload map[string]interface{}, destination interface{}) (int, error) {
	if err := d.validate(); err != nil {
		return 0, err
	}
	timeout, _ := time.ParseDuration(d.RequestTimeout)
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	file, err := os.Open(d.ClientSecretFile)
	if err != nil {
		return 0, errors.New("protocol service credential delivery unavailable")
	}
	secret, err := io.ReadAll(io.LimitReader(file, d.ClientSecretMaxBytes+1))
	file.Close()
	if err != nil || int64(len(secret)) > d.ClientSecretMaxBytes || len(strings.TrimSpace(string(secret))) == 0 {
		return 0, errors.New("invalid protocol service credential delivery")
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("protocol redirect refused") }}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, d.OIDCTokenURL, strings.NewReader("grant_type=client_credentials"))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.SetBasicAuth(d.ClientID, strings.TrimSpace(string(secret)))
	response, err := client.Do(request)
	if err != nil {
		return 0, errors.New("protocol service identity unavailable")
	}
	var token struct {
		AccessToken      string `json:"access_token"`
		TokenType        string `json:"token_type"`
		ExpiresIn        int64  `json:"expires_in"`
		Scope            string `json:"scope,omitempty"`
		RefreshExpiresIn int64  `json:"refresh_expires_in,omitempty"`
		NotBeforePolicy  int64  `json:"not-before-policy,omitempty"`
	}
	if err = decode(response, d.MaxResponseBytes, &token); err != nil {
		return 0, err
	}
	if token.AccessToken == "" || !strings.EqualFold(token.TokenType, "Bearer") || token.ExpiresIn <= 0 {
		return 0, errors.New("invalid protocol service identity")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	if int64(len(data)) > d.MaxResponseBytes {
		return 0, errors.New("protocol request exceeds controlled bound")
	}
	request, err = http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(data))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token.AccessToken)
	if humanToken != "" {
		request.Header.Set("X-Kailo-Native-Human-Token", humanToken)
	}
	response, err = client.Do(request)
	if err != nil {
		return 0, errors.New("protocol authority unavailable")
	}
	status := response.StatusCode
	return status, decode(response, d.MaxResponseBytes, destination)
}
