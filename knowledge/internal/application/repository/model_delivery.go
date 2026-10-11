package repository

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const platformModelManagedBy = "kailo-model-route"

var errPlatformModelDelivery = errors.New("platform model mapping is unavailable or its execution configuration differs")

// This is the native provisioner's existing local mapping, not a second route
// registry or an authorization decision. Gateway remains the fresh binding,
// generation, route, permission and quota authority for every model request.
type deliveredNativeModel struct {
	tenantID uint64
	name     string
	baseURL  string
}

func (r *modelRepository) modelDelivery() (map[string]deliveredNativeModel, error) {
	if r.modelDeliveryInputFile == "" {
		return nil, nil
	}
	path := r.modelDeliveryInputFile
	info, err := os.Lstat(path)
	if !filepath.IsAbs(path) || err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0007 != 0 {
		return nil, errPlatformModelDelivery
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, errPlatformModelDelivery
	}
	var input struct {
		Projection struct {
			BindingID          string   `json:"bindingId"`
			GatewayPrincipalID string   `json:"gatewayPrincipalId"`
			Generation         int64    `json:"generation"`
			ConfigDigest       string   `json:"configDigest"`
			NativeScopeRef     string   `json:"nativeScopeRef"`
			RouteResourceIDs   []string `json:"routeResourceIds"`
			Routes             []struct {
				ResourceID string `json:"resourceId"`
				NativeID   string `json:"nativeId"`
			} `json:"routes"`
		} `json:"projection"`
		Models []struct {
			RouteResourceID string `json:"routeResourceId"`
			NativeModelRef  string `json:"nativeModelRef"`
			BaseURL         string `json:"baseUrl"`
		} `json:"models"`
	}
	if json.Unmarshal(raw, &input) != nil {
		return nil, errPlatformModelDelivery
	}
	p := input.Projection
	tenantID, err := strconv.ParseUint(p.NativeScopeRef, 10, 64)
	digest, digestErr := hex.DecodeString(p.ConfigDigest)
	validID := func(value string) bool {
		id, err := uuid.Parse(value)
		return err == nil && id != uuid.Nil && id.String() == value
	}
	if err != nil || tenantID == 0 || strconv.FormatUint(tenantID, 10) != p.NativeScopeRef ||
		!validID(p.BindingID) || !validID(p.GatewayPrincipalID) || p.Generation < 1 ||
		digestErr != nil || len(digest) != 32 || hex.EncodeToString(digest) != p.ConfigDigest ||
		len(input.Models) == 0 || len(input.Models) != len(p.Routes) || len(p.Routes) != len(p.RouteResourceIDs) {
		return nil, errPlatformModelDelivery
	}
	routes := make(map[string]string, len(p.Routes))
	for _, route := range p.Routes {
		if !validID(route.ResourceID) || strings.TrimSpace(route.NativeID) == "" || routes[route.ResourceID] != "" {
			return nil, errPlatformModelDelivery
		}
		routes[route.ResourceID] = route.NativeID
	}
	seenRoutes := make(map[string]bool, len(p.RouteResourceIDs))
	for _, id := range p.RouteResourceIDs {
		if routes[id] == "" || seenRoutes[id] {
			return nil, errPlatformModelDelivery
		}
		seenRoutes[id] = true
	}
	models := make(map[string]deliveredNativeModel, len(input.Models))
	for _, model := range input.Models {
		u, err := url.Parse(model.BaseURL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" ||
			u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "/v1" ||
			!validID(model.NativeModelRef) || models[model.NativeModelRef].tenantID != 0 || !seenRoutes[model.RouteResourceID] {
			return nil, errPlatformModelDelivery
		}
		delete(seenRoutes, model.RouteResourceID)
		models[model.NativeModelRef] = deliveredNativeModel{tenantID: tenantID, name: routes[model.RouteResourceID], baseURL: model.BaseURL}
	}
	return models, nil
}

func (mapping deliveredNativeModel) matches(m *types.Model) bool {
	// Generic/OpenAI are the native OpenAI-compatible clients used by the
	// existing Gateway route. Provider-specific headers/config and cloud
	// fallback credentials must not redirect the platform's service key.
	p := m.Parameters
	return mapping.tenantID == m.TenantID && !m.IsBuiltin && mapping.name == m.Name && mapping.baseURL == p.BaseURL &&
		m.Source == types.ModelSourceRemote &&
		(m.Type == types.ModelTypeEmbedding || m.Type == types.ModelTypeKnowledgeQA || m.Type == types.ModelTypeRerank) &&
		(p.Provider == "generic" || p.Provider == "openai") && len(p.ExtraConfig) == 0 && len(p.CustomHeaders) == 0 &&
		p.AppID == "" && p.AppSecret == ""
}

func (r *modelRepository) initializeModelDelivery(ctx context.Context) error {
	models, err := r.modelDelivery()
	if err != nil || len(models) == 0 {
		return err
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for id, mapping := range models {
			var current types.Model
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND tenant_id = ?", id, mapping.tenantID).
				Take(&current).Error; err != nil {
				return errPlatformModelDelivery
			}
			if (current.ManagedBy != "" && current.ManagedBy != platformModelManagedBy) || !mapping.matches(&current) {
				return errPlatformModelDelivery
			}
			if err := tx.Model(&current).UpdateColumn("managed_by", platformModelManagedBy).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// All service Get*Model methods resolve through GetByID before constructing
// their real client, including explicit-tenant background embedding/chat.
func (r *modelRepository) validateModelDelivery(m *types.Model) error {
	if m.ManagedBy != platformModelManagedBy {
		return nil
	}
	models, err := r.modelDelivery()
	if err != nil || !models[m.ID].matches(m) {
		return errPlatformModelDelivery
	}
	return nil
}
