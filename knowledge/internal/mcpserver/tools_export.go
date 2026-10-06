package mcpserver

import (
	"context"
	"encoding/base64"
	"io"
	"time"

	"github.com/Tencent/WeKnora/internal/application/access"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/utils"
	"github.com/mark3labs/mcp-go/mcp"
)

func exportDocumentTool() mcp.Tool {
	return mcp.NewTool(types.MCPEndpointToolExportDocument,
		mcp.WithDescription("Export the original document bytes. Requires explicit endpoint enablement and the same Editor access as file download. Manual pages are exported as Markdown."),
		mcp.WithString("knowledge_id", mcp.Required(), mcp.Description("Document id")),
		mcp.WithReadOnlyHintAnnotation(true),
	)
}

func (s *Server) handleExportDocument(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ep, err := endpointFromContext(ctx)
	if err != nil {
		return mcp.NewToolResultError("unauthorized"), nil
	}
	id, err := req.RequireString("knowledge_id")
	if err != nil {
		return mcp.NewToolResultError("knowledge_id is required"), nil
	}
	document, kb, err := s.knowledgeInScope(ctx, ep, id)
	if err != nil || document.UpdatedAt.IsZero() {
		return mcp.NewToolResultError("document is not available in this endpoint scope"), nil
	}
	ctx, err = s.scopedKBContext(ctx, kb, types.OrgRoleEditor)
	if err != nil || access.RequireKBWrite(ctx, kb) != nil {
		return mcp.NewToolResultError("document export requires Editor access"), nil
	}
	file, filename, err := s.knowledgeService.GetKnowledgeFile(ctx, document.ID)
	if err != nil || file == nil {
		return mcp.NewToolResultError("original document is unavailable"), nil
	}
	defer file.Close()
	// Reuse the native deployment's actual file-size policy; no test-only cap.
	limit := utils.GetMaxFileSize()
	if limit <= 0 {
		return mcp.NewToolResultError("native file policy unavailable"), nil
	}
	body, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(body)) > limit {
		return mcp.NewToolResultError("original document could not be exported under the native file policy"), nil
	}
	// A concurrent edit or scope revocation cannot produce bytes certified with
	// an earlier document revision. Resolve the original scope again before output.
	current, currentKB, err := s.knowledgeInScope(ctx, ep, id)
	if err != nil || current.ID != document.ID || currentKB.ID != kb.ID || !current.UpdatedAt.Equal(document.UpdatedAt) {
		return mcp.NewToolResultError("document changed while being exported"), nil
	}
	currentCtx, err := s.scopedKBContext(ctx, currentKB, types.OrgRoleEditor)
	if err != nil || access.RequireKBWrite(currentCtx, currentKB) != nil {
		return mcp.NewToolResultError("document export access changed"), nil
	}
	mediaType := "application/octet-stream"
	if document.IsManual() {
		mediaType = "text/markdown"
	}
	return jsonResult(map[string]any{
		"knowledge_id": document.ID, "knowledge_base_id": kb.ID,
		"native_revision": document.UpdatedAt.UTC().Format(time.RFC3339Nano),
		"content_base64":  base64.StdEncoding.EncodeToString(body),
		"media_type":      mediaType, "filename": filename,
	})
}
