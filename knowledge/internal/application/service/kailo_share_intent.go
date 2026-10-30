package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/types"
)

// Kailo share entry for knowledge bases (DD-164(4)②, 07 §4.7.2 `share`,
// §4.7.4 share intents). In Kailo mode a knowledge base is shared only in the
// Kailo share dialog: this instance names the knowledge base to Core with its
// directory client identity, only when the signed-in person may share it
// natively, and hands the returned intent to the Kailo host (wire v1
// {type: "share", intentId}). The intent grants nothing; who the knowledge
// base is shared with comes back as directory shares[].

// ErrKailoShareUnavailable: Kailo mode or the member directory is not
// configured, so there is no Kailo share entry on this instance.
var ErrKailoShareUnavailable = errors.New("kailo share is not configured")

// ErrKailoShareForbidden: the caller may not share this knowledge base.
var ErrKailoShareForbidden = errors.New("kailo share forbidden")

// ErrKailoShareNotFound: no such knowledge base in the caller's space.
var ErrKailoShareNotFound = errors.New("kailo share knowledge base not found")

const kailoShareNameMaxRunes = 200

var kailoIntentID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// KailoShareIntent is what the frontend passes to window.KailoEmbed.requestShare.
type KailoShareIntent struct {
	IntentID  string `json:"intentId"`
	ExpiresAt string `json:"expiresAt"`
}

// KailoShareIntentService requests share intents from Core.
type KailoShareIntentService struct {
	cfg  *config.Config
	db   *gorm.DB
	http *http.Client
}

// NewKailoShareIntentService constructs the share entry.
func NewKailoShareIntentService(cfg *config.Config, db *gorm.DB) *KailoShareIntentService {
	return &KailoShareIntentService{cfg: cfg, db: db, http: newKailoServiceHTTPClient(kailoDirectoryReadTimeout)}
}

// CanShare reports whether caller may share kb natively: the knowledge base
// lives in the caller's current space and the caller administers that space
// or created the knowledge base while still holding write access there
// (contributor+), the same rule as the native share route (OwnedKBOrAdmin).
func CanShareKnowledgeBase(caller types.Caller, kb types.KnowledgeBase) bool {
	if kb.TenantID == 0 || kb.TenantID != caller.TenantID {
		return false
	}
	if caller.Role.HasPermission(types.TenantRoleAdmin) {
		return true
	}
	return kb.CreatorID != "" && kb.CreatorID == caller.UserID && caller.Role.HasPermission(types.TenantRoleContributor)
}

// Request asks Core for a share intent naming knowledge base kbID.
func (s *KailoShareIntentService) Request(ctx context.Context, caller types.Caller, kbID string) (*KailoShareIntent, error) {
	directory := s.cfg.KailoDirectory()
	if !s.cfg.KailoEnabled() || directory == nil {
		return nil, ErrKailoShareUnavailable
	}
	db := s.db.WithContext(ctx)
	var kb types.KnowledgeBase
	if err := db.Select("id", "tenant_id", "creator_id", "name").Where("id = ?", kbID).First(&kb).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrKailoShareNotFound
		}
		return nil, err
	}
	if kb.TenantID != caller.TenantID {
		return nil, ErrKailoShareNotFound
	}
	if !CanShareKnowledgeBase(caller, kb) {
		return nil, ErrKailoShareForbidden
	}
	var user types.User
	if err := db.Select("id", "oidc_issuer", "oidc_subject").Where("id = ?", caller.UserID).First(&user).Error; err != nil ||
		user.OIDCIssuer == nil || user.OIDCSubject == nil {
		// Only a Kailo identity can be named to Kailo.
		return nil, ErrKailoShareForbidden
	}
	var space types.Tenant
	if err := db.Select("id", "kailo_scope_ref").Where("id = ?", kb.TenantID).First(&space).Error; err != nil {
		return nil, err
	}
	if space.KailoScopeRef == nil {
		// A knowledge base outside the Kailo-mapped spaces has no Kailo scope.
		return nil, ErrKailoShareForbidden
	}
	request := map[string]interface{}{
		"nativeType": types.KailoSharedKnowledgeBase,
		"nativeId":   kb.ID,
		"name":       kailoShareName(kb.Name, kb.ID),
		"initiator":  map[string]string{"issuer": *user.OIDCIssuer, "subject": *user.OIDCSubject},
	}
	if ref := *space.KailoScopeRef; strings.HasPrefix(ref, types.KailoScopeRefWorkspacePrefix) {
		request["workspaceId"] = strings.TrimPrefix(ref, types.KailoScopeRefWorkspacePrefix)
	}
	body, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	token, _, err := requestKailoServiceToken(ctx, s.http, *directory)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, kailoDirectoryReadTimeout)
	defer cancel()
	endpoint := strings.TrimRight(directory.CoreURL, "/") + "/service/v1/component-directory/bindings/" +
		url.PathEscape(directory.BindingID) + "/share-intents"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, directoryReadError("Core unreachable")
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return nil, directoryReadError("share intent response")
	}
	switch {
	case resp.StatusCode == http.StatusForbidden:
		// Core refuses uniformly (not a member, binding not active, …).
		return nil, ErrKailoShareForbidden
	case resp.StatusCode < 200 || resp.StatusCode > 299:
		return nil, directoryReadError("Core status %d", resp.StatusCode)
	}
	var created KailoShareIntent
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&created); err != nil || !kailoIntentID.MatchString(created.IntentID) {
		return nil, directoryReadError("share intent response does not match the contract")
	}
	if _, err := time.Parse(time.RFC3339, created.ExpiresAt); err != nil {
		return nil, directoryReadError("share intent response does not match the contract")
	}
	created.IntentID = strings.ToLower(created.IntentID)
	logger.Infof(ctx, "[kailo] share intent requested for knowledge base %s", kb.ID)
	return &created, nil
}

func kailoShareName(name, fallback string) string {
	name = strings.Join(strings.Fields(name), " ")
	if name == "" {
		name = fallback
	}
	return truncateRunes(name, kailoShareNameMaxRunes)
}
