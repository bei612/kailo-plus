package mcpserver

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Tencent/WeKnora/internal/application/access"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/mark3labs/mcp-go/mcp"
)

func addDocumentTool() mcp.Tool {
	return mcp.NewTool(types.MCPEndpointToolAddDocument,
		mcp.WithDescription("Add a document to a knowledge base from Markdown text, original file bytes, or a URL. "+
			"Text documents are editable Markdown pages; files and URLs use the native asynchronous parser. "+
			"An idempotency key freezes text/file creation; observe_only reads that native creation without repeating it."),
		mcp.WithString("knowledge_base_id", mcp.Required(), mcp.Description("Knowledge base id or exact name")),
		mcp.WithString("title", mcp.Description("Document title; required when creating")),
		mcp.WithString("content", mcp.Description("Markdown content; required unless url is given")),
		mcp.WithString("url", mcp.Description("Web page or file URL to import instead of content")),
		mcp.WithString("file_base64", mcp.Description("Original file bytes; requires filename and idempotency_key, mutually exclusive with content/url")),
		mcp.WithString("filename", mcp.Description("Original file name including extension")),
		mcp.WithString("source_reference_json", mcp.Description("ContentReference of the governed source file; citation metadata only")),
		mcp.WithString("read_operation_id", mcp.Description("Core-issued SERVICE read batch Operation for source file provenance; required with source_reference_json")),
		mcp.WithString("idempotency_key", mcp.Description("UUID for an exact text or file creation retry; cannot be used with URL import")),
		mcp.WithBoolean("observe_only", mcp.Description("Read the original idempotency_key creation without uploading or enqueuing again")),
		mcp.WithBoolean("publish", mcp.Description("For text documents: publish immediately (default true) or keep "+
			"as draft")),
		mcp.WithReadOnlyHintAnnotation(false),
		mcp.WithDestructiveHintAnnotation(true),
	)
}

func updateDocumentTool() mcp.Tool {
	return mcp.NewTool(types.MCPEndpointToolUpdateDocument,
		mcp.WithDescription("Replace the content (and optionally the title) of a Markdown document created from "+
			"text. The document is re-indexed asynchronously."),
		mcp.WithString("knowledge_id", mcp.Required(), mcp.Description("Document id")),
		mcp.WithString("content", mcp.Required(), mcp.Description("New Markdown content")),
		mcp.WithString("title", mcp.Description("New title; keeps the current title when omitted")),
		mcp.WithBoolean("publish", mcp.Description("Publish (default true) or keep as draft")),
		mcp.WithDestructiveHintAnnotation(true),
	)
}

func deleteDocumentTool() mcp.Tool {
	return mcp.NewTool(types.MCPEndpointToolDeleteDocument,
		mcp.WithDescription("Delete a document and its index data. An idempotency key selects durable conditional deletion using the native cleanup task; observe_only reads that same task without submitting another deletion. Acknowledgements and missing terminal evidence do not prove cleanup completed."),
		mcp.WithString("knowledge_id", mcp.Description("Document id; required when starting deletion")),
		mcp.WithString("expected_revision", mcp.Description("When provided, delete only this exact native_revision returned by read_document; concurrent edits refuse the deletion.")),
		mcp.WithString("idempotency_key", mcp.Description("Canonical UUID for a retained native conditional deletion task; requires expected_revision and knowledge_base_id.")),
		mcp.WithString("knowledge_base_id", mcp.Description("Exact admitted knowledge base for durable deletion or observation.")),
		mcp.WithBoolean("observe_only", mcp.Description("Read only the existing idempotency_key task; never starts or repeats deletion.")),
		mcp.WithDestructiveHintAnnotation(true),
	)
}

func manualStatus(publish bool) string {
	if publish {
		return types.ManualKnowledgeStatusPublish
	}
	return types.ManualKnowledgeStatusDraft
}

func (s *Server) handleAddDocument(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ep, err := endpointFromContext(ctx)
	if err != nil {
		return mcp.NewToolResultError("unauthorized"), nil
	}
	selector, err := req.RequireString("knowledge_base_id")
	if err != nil {
		return mcp.NewToolResultError("knowledge_base_id is required"), nil
	}
	observe := false
	if value, exists := req.GetArguments()["observe_only"]; exists {
		var ok bool
		observe, ok = value.(bool)
		if !ok {
			return mcp.NewToolResultError("observe_only must be boolean"), nil
		}
	}
	title := strings.TrimSpace(req.GetString("title", ""))
	if title == "" && !observe {
		return mcp.NewToolResultError("title is required"), nil
	}
	content := req.GetString("content", "")
	url := strings.TrimSpace(req.GetString("url", ""))
	fileBase64 := req.GetString("file_base64", "")
	filename := req.GetString("filename", "")
	if fileBase64 != "" && (content != "" || url != "" || filename == "" || req.GetString("idempotency_key", "") == "") {
		return mcp.NewToolResultError("file import requires filename and idempotency_key and cannot include content or url"), nil
	}
	creationID := ""
	if key := req.GetString("idempotency_key", ""); key != "" {
		parsed, parseErr := uuid.Parse(key)
		if parseErr != nil || parsed == uuid.Nil || parsed.String() != key || url != "" {
			return mcp.NewToolResultError("idempotency_key must be a nonzero canonical UUID and is supported for text or file documents"), nil
		}
		creationID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(fmt.Sprintf("mcp-document:%d:%s:%s", ep.TenantID, ep.ID, key))).String()
	}
	if observe && (creationID == "" || content != "" || url != "" || fileBase64 != "") {
		return mcp.NewToolResultError("observation requires the original idempotency_key and cannot contain content"), nil
	}
	if !observe && strings.TrimSpace(content) == "" && url == "" && fileBase64 == "" {
		return mcp.NewToolResultError("content, url, or file_base64 is required"), nil
	}
	kbs, err := s.selectKnowledgeBases(ctx, ep, []string{selector})
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	kb := kbs[0]
	ctx, err = s.scopedKBContext(ctx, kb, types.OrgRoleEditor)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if err := access.RequireKBWrite(ctx, kb); err != nil {
		return mcp.NewToolResultError("this endpoint is not allowed to write to knowledge base " + kb.ID), nil
	}

	var created *types.Knowledge
	if observe {
		created, err = s.knowledgeService.GetKnowledgeByID(ctx, creationID)
		if err != nil || created == nil || created.TenantID != kb.TenantID || created.KnowledgeBaseID != kb.ID {
			return mcp.NewToolResultError("native creation evidence unavailable"), nil
		}
	} else if fileBase64 != "" {
		data, decodeErr := base64.StdEncoding.DecodeString(fileBase64)
		if decodeErr != nil || base64.StdEncoding.EncodeToString(data) != fileBase64 {
			return mcp.NewToolResultError("file_base64 must be canonical base64"), nil
		}
		metadata := map[string]string{}
		if reference := req.GetString("source_reference_json", ""); reference != "" {
			operation := req.GetString("read_operation_id", "")
			parsed, parseErr := uuid.Parse(operation)
			if parseErr != nil || parsed == uuid.Nil || parsed.String() != operation {
				return mcp.NewToolResultError("source file requires its canonical read_operation_id"), nil
			}
			var fields map[string]string
			if json.Unmarshal([]byte(reference), &fields) != nil {
				return mcp.NewToolResultError("invalid source reference"), nil
			}
			for _, required := range []string{"resourceId", "nativeObjectRef", "nativeRevision", "displayName", "mediaType"} {
				if fields[required] == "" {
					return mcp.NewToolResultError("incomplete source reference"), nil
				}
			}
			metadata["source_resource_id"] = fields["resourceId"]
			metadata["source_read_operation_id"] = operation
			metadata["source_native_object_ref"] = fields["nativeObjectRef"]
			metadata["source_native_revision"] = fields["nativeRevision"]
			metadata["source_media_type"] = fields["mediaType"]
			metadata["source_content_sha256"] = fmt.Sprintf("%x", sha256.Sum256(data))
			if fields["assetId"] != "" {
				metadata["source_asset_id"] = fields["assetId"]
			}
		}
		created, err = s.knowledgeService.CreateKnowledgeFromFileAtID(ctx, kb.ID, filename, data, metadata, creationID, nil, "mcp")
	} else if url != "" {
		created, err = s.knowledgeService.CreateKnowledgeFromURL(
			ctx, kb.ID, url, "", "", nil, title, nil, askChannel, nil,
		)
	} else {
		created, err = s.knowledgeService.CreateKnowledgeFromManual(ctx, kb.ID, &types.ManualKnowledgePayload{
			CreationID: creationID,
			Title:      title,
			Content:    content,
			Status:     manualStatus(req.GetBool("publish", true)),
			Channel:    askChannel,
		}, askChannel)
	}
	if err != nil {
		return mcp.NewToolResultErrorFromErr("failed to add document", err), nil
	}
	result := map[string]any{
		"knowledge_base_id": kb.ID,
		"document":          summarizeKnowledge(created),
		"note": "Indexing runs asynchronously; the document becomes searchable once parse_status is " +
			"completed.",
	}
	if metadata, metadataErr := created.Metadata.Map(); metadataErr == nil {
		if operation, ok := metadata["source_read_operation_id"].(string); ok && operation != "" {
			result["read_operation_id"] = operation
		}
		if mediaType, ok := metadata["source_media_type"].(string); ok && mediaType != "" {
			result["media_type"] = mediaType
		}
		if digest, ok := metadata["source_content_sha256"].(string); ok && digest != "" {
			result["source_content_sha256"] = digest
			result["source_content_bytes"] = created.FileSize
		}
	}
	return jsonResult(result)
}

func (s *Server) handleUpdateDocument(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ep, err := endpointFromContext(ctx)
	if err != nil {
		return mcp.NewToolResultError("unauthorized"), nil
	}
	knowledgeID, err := req.RequireString("knowledge_id")
	if err != nil {
		return mcp.NewToolResultError("knowledge_id is required"), nil
	}
	content := req.GetString("content", "")
	if strings.TrimSpace(content) == "" {
		return mcp.NewToolResultError("content is required"), nil
	}
	existing, kb, err := s.knowledgeInScope(ctx, ep, knowledgeID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	ctx, err = s.scopedKBContext(ctx, kb, types.OrgRoleEditor)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	title := strings.TrimSpace(req.GetString("title", ""))
	if title == "" {
		title = existing.Title
	}
	updated, err := s.knowledgeService.UpdateManualKnowledge(ctx, existing.ID, &types.ManualKnowledgePayload{
		Title:   title,
		Content: content,
		Status:  manualStatus(req.GetBool("publish", true)),
		Channel: askChannel,
	})
	if err != nil {
		return mcp.NewToolResultErrorFromErr("failed to update document", err), nil
	}
	return jsonResult(map[string]any{
		"document": summarizeKnowledge(updated),
		"note":     "Re-indexing runs asynchronously.",
	})
}

func (s *Server) handleDeleteDocument(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	ep, err := endpointFromContext(ctx)
	if err != nil {
		return mcp.NewToolResultError("unauthorized"), nil
	}
	knowledgeID := req.GetString("knowledge_id", "")
	if _, supplied := req.GetArguments()["idempotency_key"]; supplied {
		observe := false
		if value, exists := req.GetArguments()["observe_only"]; exists {
			var ok bool
			observe, ok = value.(bool)
			if !ok {
				return mcp.NewToolResultError("observe_only must be boolean"), nil
			}
		}
		key, err := req.RequireString("idempotency_key")
		parsed, parseErr := uuid.Parse(key)
		revision := req.GetString("expected_revision", "")
		kbID, kbErr := req.RequireString("knowledge_base_id")
		if err != nil || parseErr != nil || parsed == uuid.Nil || parsed.String() != key || (!observe && (revision == "" || knowledgeID == "")) || kbErr != nil {
			return mcp.NewToolResultError("durable deletion requires exact key, base and revision"), nil
		}
		kbs, err := s.selectKnowledgeBases(ctx, ep, []string{kbID})
		if err != nil || len(kbs) != 1 || kbs[0].ID != kbID {
			return mcp.NewToolResultError("knowledge base is outside this endpoint"), nil
		}
		ctx, err = s.scopedKBContext(ctx, kbs[0], types.OrgRoleEditor)
		if err != nil {
			return mcp.NewToolResultError("knowledge base write scope unavailable"), nil
		}
		if err := access.RequireKBWrite(ctx, kbs[0]); err != nil {
			return mcp.NewToolResultError("knowledge base write denied"), nil
		}
		taskID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(fmt.Sprintf("mcp-delete:%d:%s:%s", ep.TenantID, ep.ID, key))).String()
		var result map[string]any
		if observe {
			result, err = s.knowledgeService.ObserveKnowledgeDeleteTask(ctx, kbID, knowledgeID, revision, taskID)
		} else {
			result, err = s.knowledgeService.StartKnowledgeDeleteTask(ctx, kbID, knowledgeID, revision, taskID)
		}
		if err != nil {
			return mcp.NewToolResultError("native deletion state is unavailable"), nil
		}
		return jsonResult(result)
	}
	if _, supplied := req.GetArguments()["observe_only"]; supplied {
		return mcp.NewToolResultError("observe_only requires idempotency_key"), nil
	}
	if knowledgeID == "" {
		return mcp.NewToolResultError("knowledge_id is required"), nil
	}
	existing, kb, err := s.knowledgeInScope(ctx, ep, knowledgeID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	ctx, err = s.scopedKBContext(ctx, kb, types.OrgRoleEditor)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if revision, supplied := req.GetArguments()["expected_revision"]; supplied {
		value, ok := revision.(string)
		if !ok || value == "" {
			return mcp.NewToolResultError("expected_revision must be a nonempty native revision"), nil
		}
		err = s.knowledgeService.DeleteKnowledgeAtRevision(ctx, existing.ID, value)
	} else {
		err = s.knowledgeService.DeleteKnowledge(ctx, existing.ID)
	}
	if err != nil {
		return mcp.NewToolResultErrorFromErr("failed to delete document", err), nil
	}
	return jsonResult(map[string]any{
		"deleted":      true,
		"knowledge_id": existing.ID,
		"title":        existing.Title,
	})
}
