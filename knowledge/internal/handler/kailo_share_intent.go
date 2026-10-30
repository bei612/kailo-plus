package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/Tencent/WeKnora/internal/application/service"
	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/types"
)

// KailoShareIntentHandler serves POST /api/v1/kailo/share-intents (Kailo
// DD-164(4)②): the knowledge base page asks for a share intent and hands it
// to the Kailo host, which opens the Kailo share dialog.
type KailoShareIntentHandler struct {
	svc *service.KailoShareIntentService
}

// NewKailoShareIntentHandler constructs the handler.
func NewKailoShareIntentHandler(svc *service.KailoShareIntentService) *KailoShareIntentHandler {
	return &KailoShareIntentHandler{svc: svc}
}

type kailoShareIntentRequest struct {
	KnowledgeBaseID string `json:"knowledgeBaseId" binding:"required"`
}

// Create requests the intent for the caller's knowledge base.
func (h *KailoShareIntentHandler) Create(c *gin.Context) {
	var req kailoShareIntentRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.KnowledgeBaseID == "" || len(req.KnowledgeBaseID) > 255 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "knowledgeBaseId is required"})
		return
	}
	ctx := c.Request.Context()
	caller := types.CallerFromContext(ctx).Normalize()
	intent, err := h.svc.Request(ctx, caller, req.KnowledgeBaseID)
	switch {
	case err == nil:
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, intent)
	case errors.Is(err, service.ErrKailoShareUnavailable), errors.Is(err, service.ErrKailoShareNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
	case errors.Is(err, service.ErrKailoShareForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden", "code": "KAILO_SHARE_FORBIDDEN"})
	default:
		logger.Warnf(ctx, "[kailo] share intent unavailable: %v", err)
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Kailo share is unavailable"})
	}
}
