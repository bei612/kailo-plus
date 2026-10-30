package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"

	"github.com/Tencent/WeKnora/internal/application/service"
	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/errors"
	"github.com/Tencent/WeKnora/internal/handler/dto"
	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	secutils "github.com/Tencent/WeKnora/internal/utils"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ModelCredentialsHandler handles secret credentials for models via the
// dedicated /models/:id/credentials subresource. See mcp_credentials.go for
// the rationale; this handler mirrors that contract for Model resources.
//
// Recognized fields: "api_key" (every provider), "app_secret" (WeKnora Cloud).
type ModelCredentialsHandler struct {
	svc interfaces.ModelService
	// kailoMode: models come from Kailo model routing (DD-128, DD-138(6));
	// only the delivery of a Kailo-routed model's credential may write.
	kailoMode bool
}

func NewModelCredentialsHandler(svc interfaces.ModelService, cfg *config.Config) *ModelCredentialsHandler {
	return &ModelCredentialsHandler{svc: svc, kailoMode: cfg.KailoEnabled()}
}

// kailoRoutedModel is the managed_by value of models Kailo model routing projects.
const kailoRoutedModel = "kailo-model-route"

type modelCredentialsPutRequest struct {
	APIKey    *string `json:"api_key,omitempty"`
	AppSecret *string `json:"app_secret,omitempty"`
	// Optional read-back challenge, not another credential or write operation.
	VerificationNonce *string `json:"verification_nonce,omitempty"`
}

type modelCredentialsResponse struct {
	dto.CredentialsResponse
	VerificationNonce string `json:"verification_nonce,omitempty"`
	APIKeyProof       string `json:"api_key_proof,omitempty"`
	ManagedBy         string `json:"managed_by,omitempty"`
}

func modelCredentialResponse(model *types.Model, nonce *string) modelCredentialsResponse {
	response := modelCredentialsResponse{CredentialsResponse: dto.CredentialsResponse{
		Fields: map[string]dto.CredentialFieldMetadata{
			"api_key":    {Configured: model.Parameters.APIKey != ""},
			"app_secret": {Configured: model.Parameters.AppSecret != ""},
		},
	}}
	if nonce != nil {
		response.VerificationNonce = *nonce
		response.ManagedBy = model.ManagedBy
	}
	if nonce != nil && model.Parameters.APIKey != "" {
		// A fresh challenge proves the value loaded from this native row, without
		// returning the value or a reusable credential fingerprint.
		// Managed models use the KB scope verified by the original repository.
		// Independent native models keep their original tenant-scoped proof.
		scope := strconv.FormatUint(model.TenantID, 10)
		if model.ManagedBy == "kailo-model-route" {
			scope = model.PlatformScopeRef
		}
		mac := hmac.New(sha256.New, []byte(model.Parameters.APIKey))
		_, _ = mac.Write([]byte("application-model-key:v1\x00" + scope +
			"\x00" + model.ID + "\x00" + *nonce))
		response.APIKeyProof = hex.EncodeToString(mac.Sum(nil))
	}
	return response
}

func (h *ModelCredentialsHandler) Put(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	tenantID := c.GetUint64(types.TenantIDContextKey.String())
	if tenantID == 0 {
		c.Error(errors.NewBadRequestError("Workspace ID cannot be empty"))
		return
	}

	var req modelCredentialsPutRequest
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		c.Error(errors.NewBadRequestError("invalid model credential request"))
		return
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		c.Error(errors.NewBadRequestError("invalid model credential request"))
		return
	}
	if req.VerificationNonce != nil {
		decoded, err := hex.DecodeString(*req.VerificationNonce)
		if err != nil || len(decoded) != 32 || hex.EncodeToString(decoded) != *req.VerificationNonce ||
			req.APIKey != nil || req.AppSecret != nil {
			c.Error(errors.NewBadRequestError("verification requires an exact nonce and no credential write"))
			return
		}
	}
	if req.APIKey == nil && req.AppSecret == nil {
		m, err := h.svc.GetModelByID(ctx, id)
		if err != nil || m == nil {
			c.Error(errors.NewNotFoundError("Model not found"))
			return
		}
		if req.VerificationNonce != nil && (m.ID != id || m.TenantID != tenantID || m.IsBuiltin) {
			c.Error(errors.NewNotFoundError("Model not found"))
			return
		}
		if req.VerificationNonce != nil && m.ManagedBy == "kailo-model-route" {
			scope, err := uuid.Parse(m.PlatformScopeRef)
			if err != nil || scope == uuid.Nil || scope.String() != m.PlatformScopeRef {
				c.Error(errors.NewNotFoundError("Model scope unavailable"))
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": modelCredentialResponse(m, req.VerificationNonce)})
		return
	}

	// DD-138(6): in Kailo mode the model registry is read-only (the `models.catalog`
	// admin surface). The one remaining credential write is the DD-128 delivery of a
	// Kailo-routed model's gateway key (fork/deploy/provision.py); every other
	// model's credentials are refused before the service is called.
	if h.kailoMode {
		m, err := h.svc.GetModelByID(ctx, id)
		if err != nil || m == nil || m.ID != id || m.TenantID != tenantID {
			c.Error(errors.NewNotFoundError("Model not found"))
			return
		}
		if m.ManagedBy != kailoRoutedModel {
			c.JSON(http.StatusForbidden, gin.H{"error": "Managed by Kailo", "code": "KAILO_MANAGED"})
			c.Abort()
			return
		}
	}

	updated, err := h.svc.UpdateModelCredentials(ctx, id, req.APIKey, req.AppSecret)
	if err != nil {
		if err == service.ErrModelNotFound {
			c.Error(errors.NewNotFoundError("Model not found"))
			return
		}
		if appErr, ok := errors.IsAppError(err); ok {
			c.Error(appErr)
			return
		}
		logger.ErrorWithFields(ctx, err, map[string]interface{}{"model_id": secutils.SanitizeForLog(id)})
		c.Error(errors.NewInternalServerError("failed to update credentials: " + err.Error()))
		return
	}

	resp := modelCredentialResponse(updated, nil)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": resp})
}

func (h *ModelCredentialsHandler) DeleteField(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")
	field := c.Param("field")
	tenantID := c.GetUint64(types.TenantIDContextKey.String())
	if tenantID == 0 {
		c.Error(errors.NewBadRequestError("Workspace ID cannot be empty"))
		return
	}
	if field != "api_key" && field != "app_secret" {
		c.Error(errors.NewBadRequestError("unknown credential field: " + secutils.SanitizeForLog(field)))
		return
	}
	if err := h.svc.ClearModelCredential(ctx, id, field); err != nil {
		if err == service.ErrModelNotFound {
			c.Error(errors.NewNotFoundError("Model not found"))
			return
		}
		if appErr, ok := errors.IsAppError(err); ok {
			c.Error(appErr)
			return
		}
		logger.ErrorWithFields(ctx, err, map[string]interface{}{
			"model_id": secutils.SanitizeForLog(id),
			"field":    field,
		})
		c.Error(errors.NewInternalServerError("failed to clear credential: " + err.Error()))
		return
	}
	c.Status(http.StatusNoContent)
}
