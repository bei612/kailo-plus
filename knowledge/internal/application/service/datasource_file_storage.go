package service

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"strconv"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/datasource"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/google/uuid"
)

// This connector is the native DataSource/SyncLog consumer (design13 §4.4).
// It owns no scheduler, platform resource registry or alternate work queue.
const fileStorageConnectorType = "file_storage"

type fileStorageRun struct {
	dataSourceID, syncLogID, knowledgeBaseID string
	tenantID                                 uint64
	syncDeletions                            bool
}
type fileStorageRunKey struct{}

type fileStorageGroup struct {
	KnowledgeID string                       `json:"knowledgeId"`
	Revision    string                       `json:"revision"`
	References  []map[string]json.RawMessage `json:"references"`
}

type fileStorageRetirement struct {
	Group            fileStorageGroup `json:"group"`
	SourceResourceID string           `json:"sourceResourceId"`
	BatchID          string           `json:"batchId"`
	Key              string           `json:"key"`
	Digest           string           `json:"digest"`
	Bytes            int64            `json:"bytes"`
}

type fileStorageCursor struct {
	Groups   map[string]fileStorageGroup      `json:"groups"`
	Retiring map[string]fileStorageRetirement `json:"retiring"`
	// Discovery receipts acknowledge a persisted native observation, not a
	// prematurely replaced desired set. Groups stays the previous baseline
	// until every required receiver receipt has been accepted.
	Discovery map[string]fileStorageSavedListing `json:"discovery,omitempty"`
}

type fileStorageSavedListing struct {
	Key       string `json:"key"`
	ItemsJSON string `json:"itemsJson"`
	Digest    string `json:"digest"`
	Bytes     int64  `json:"bytes"`
}

type fileStorageConnector struct {
	transport *fileStorageTransport
	knowledge interfaces.KnowledgeService
}

func NewFileStorageConnector(cfg *config.FileStorageSyncConfig, knowledge interfaces.KnowledgeService) (datasource.Connector, error) {
	transport, err := newFileStorageTransport(cfg)
	if err != nil {
		return nil, err
	}
	if knowledge == nil {
		return nil, fmt.Errorf("native knowledge consumer is unavailable")
	}
	return &fileStorageConnector{transport: transport, knowledge: knowledge}, nil
}

func (*fileStorageConnector) Type() string { return fileStorageConnectorType }

func (c *fileStorageConnector) Validate(_ context.Context, cfg *types.DataSourceConfig) error {
	if cfg == nil || len(cfg.Credentials) != 0 || len(cfg.Settings) != 0 || len(cfg.ResourceIDs) == 0 {
		return fmt.Errorf("file-storage imports require source Resource references, not native credentials or URLs")
	}
	seen := map[string]bool{}
	for _, id := range cfg.ResourceIDs {
		if !fileStorageUUID(id) || seen[id] {
			return fmt.Errorf("invalid or duplicate source Resource reference")
		}
		seen[id] = true
	}
	return nil
}

// Resource selection remains the existing governed Resource binding surface;
// the native picker can display those references but cannot discover a second
// ungoverned native directory using a tenant credential.
func (c *fileStorageConnector) ListResources(ctx context.Context, cfg *types.DataSourceConfig, parent string) ([]types.Resource, error) {
	if err := c.Validate(ctx, cfg); err != nil {
		return nil, err
	}
	items := []types.Resource{}
	if parent != "" {
		return items, nil
	}
	for _, id := range cfg.ResourceIDs {
		items = append(items, types.Resource{ExternalID: id, Name: id})
	}
	return items, nil
}

func (c *fileStorageConnector) ResolveResourceAncestors(ctx context.Context, cfg *types.DataSourceConfig, ids []string) ([]string, error) {
	if err := c.Validate(ctx, cfg); err != nil {
		return nil, err
	}
	for _, id := range ids {
		found := false
		for _, allowed := range cfg.ResourceIDs {
			if id == allowed {
				found = true
			}
		}
		if !found {
			return nil, fmt.Errorf("source Resource is not part of this import configuration")
		}
	}
	return []string{}, nil
}

// The existing service always selects StreamingConnector for this concrete
// implementation. Reject direct batch invocation rather than returning bytes
// that could be applied after their separate receiver authorization expired.
func (*fileStorageConnector) FetchAll(context.Context, *types.DataSourceConfig, []string) ([]types.FetchedItem, error) {
	return nil, fmt.Errorf("file-storage imports require the native streaming consumer")
}
func (*fileStorageConnector) FetchIncremental(context.Context, *types.DataSourceConfig, *types.SyncCursor) ([]types.FetchedItem, *types.SyncCursor, error) {
	return nil, nil, fmt.Errorf("file-storage imports require the native streaming consumer")
}
func (c *fileStorageConnector) FetchFullStream(ctx context.Context, cfg *types.DataSourceConfig, cursor *types.SyncCursor, h datasource.StreamHandler) (*types.SyncCursor, error) {
	return c.FetchStream(ctx, cfg, cursor, h)
}

func fileStorageKey(parts ...string) string {
	raw, _ := json.Marshal(parts)
	return uuid.NewSHA1(uuid.NameSpaceOID, raw).String()
}

func fileStorageState(cursor *types.SyncCursor) (fileStorageCursor, error) {
	state := fileStorageCursor{Groups: map[string]fileStorageGroup{}, Retiring: map[string]fileStorageRetirement{}}
	if cursor == nil || len(cursor.ConnectorCursor) == 0 {
		return state, nil
	}
	raw, err := json.Marshal(cursor.ConnectorCursor)
	if err != nil {
		return state, err
	}
	if err = json.Unmarshal(raw, &state); err != nil || state.Groups == nil || state.Retiring == nil {
		return state, fmt.Errorf("native file-storage cursor is invalid")
	}
	for key, group := range state.Groups {
		if key == "" || !fileStorageUUID(group.KnowledgeID) || group.Revision == "" || len(group.References) == 0 {
			return state, fmt.Errorf("native file-storage target provenance is unavailable")
		}
	}
	return state, nil
}

func fileStorageCheckpoint(ctx context.Context, h datasource.StreamHandler, state fileStorageCursor, at time.Time) (*types.SyncCursor, error) {
	raw, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	var fields map[string]interface{}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	cursor := &types.SyncCursor{LastSyncTime: at, ConnectorCursor: fields}
	if err := h.Checkpoint(ctx, cursor); err != nil {
		return nil, err
	}
	return cursor, nil
}

type fileStorageListing struct {
	grant     *fileStorageGrant
	items     []map[string]json.RawMessage
	digest    string
	bytes     int64
	itemsJSON string
}

func (c *fileStorageConnector) listing(ctx context.Context, run fileStorageRun, source, key, action string, version int64, saved fileStorageSavedListing) (*fileStorageListing, error) {
	grant, err := c.transport.grant(ctx, run, source, "file_storage.list@v1", c.transport.config.ListActionVersion,
		key, action, version, map[string]string{"resourceId": source})
	if err != nil {
		return nil, err
	}
	if fileStorageText(grant.value, "outcome") == "COMPLETED" {
		var items []map[string]json.RawMessage
		if saved.Key != key || saved.Bytes != int64(len(saved.ItemsJSON)) || saved.Digest != fileStorageDigest([]byte(saved.ItemsJSON)) ||
			json.Unmarshal([]byte(saved.ItemsJSON), &items) != nil || items == nil {
			return nil, fmt.Errorf("completed discovery lacks its native cursor snapshot")
		}
		if err := c.transport.receipt(ctx, grant, run.dataSourceID, saved.Digest, saved.Digest, saved.Bytes, time.Now().UTC()); err != nil {
			return nil, err
		}
		return &fileStorageListing{grant: grant, items: items, digest: saved.Digest, bytes: saved.Bytes, itemsJSON: saved.ItemsJSON}, nil
	}
	raw, headers, err := c.transport.source(ctx, grant)
	if err != nil {
		return nil, err
	}
	var output map[string]json.RawMessage
	var request, args map[string]json.RawMessage
	if json.Unmarshal([]byte(fileStorageText(grant.value, "argumentsJson")), &request) != nil || json.Unmarshal(request["arguments"], &args) != nil {
		return nil, fmt.Errorf("source listing scope evidence is unavailable")
	}
	if !startsJSON(headers) || json.Unmarshal(raw, &output) != nil ||
		fileStorageText(output, "resourceId") != source ||
		fileStorageText(output, "nativeObjectRef") != fileStorageText(args, "authorizationTargetNativeRef") ||
		fileStorageText(output, "operationId") != fileStorageText(grant.value, "operationId") ||
		fileStorageText(output, "listingDigest") != fileStorageDigest(output["items"]) ||
		fileStorageText(output, "nativeRevision") != fileStorageText(output, "listingDigest") {
		return nil, fmt.Errorf("source listing evidence is invalid")
	}
	var items []map[string]json.RawMessage
	if json.Unmarshal(output["items"], &items) != nil || items == nil {
		return nil, fmt.Errorf("source listing is incomplete")
	}
	seen := map[string]bool{}
	for _, item := range items {
		id := fileStorageText(item, "nativeObjectRef")
		if !fileStorageUUID(id) || fileStorageText(item, "resourceId") != source || seen[id] ||
			fileStorageText(item, "nativeRevision") == "" || fileStorageText(item, "displayName") == "" ||
			fileStorageText(item, "mediaType") == "" {
			return nil, fmt.Errorf("source listing reference is invalid")
		}
		seen[id] = true
	}
	return &fileStorageListing{grant: grant, items: items, digest: fileStorageText(output, "listingDigest"), bytes: int64(len(output["items"])), itemsJSON: string(output["items"])}, nil
}

func startsJSON(headers http.Header) bool {
	return len(headers.Get("Content-Type")) >= len("application/json") && headers.Get("Content-Type")[:len("application/json")] == "application/json"
}

func (c *fileStorageConnector) read(ctx context.Context, grant *fileStorageGrant, ref map[string]json.RawMessage) ([]byte, string, error) {
	body, headers, err := c.transport.source(ctx, grant)
	if err != nil {
		return nil, "", err
	}
	digest := fileStorageDigest(body)
	if headers.Get("Content-Type") != "application/octet-stream" || headers.Get("Content-Range") != "" ||
		headers.Get("Content-Length") != strconv.Itoa(len(body)) || headers.Get("X-Kailo-Content-Sha256") != digest ||
		headers.Get("X-Kailo-Native-Object-Ref") != fileStorageText(ref, "nativeObjectRef") ||
		headers.Get("X-Kailo-Native-Revision") != fileStorageText(ref, "nativeRevision") ||
		headers.Get("X-Kailo-Operation-Id") != fileStorageText(grant.value, "operationId") {
		return nil, "", fmt.Errorf("source file version or streamed digest is unconfirmed")
	}
	return body, digest, nil
}

type fileStorageFetched struct {
	ref    map[string]json.RawMessage
	grant  *fileStorageGrant
	digest string
	size   int64
}

func (c *fileStorageConnector) completedNative(ctx context.Context, run fileStorageRun, grant *fileStorageGrant) (*types.Knowledge, map[string]json.RawMessage, error) {
	var receipt map[string]json.RawMessage
	if json.Unmarshal(grant.value["receiverReceipt"], &receipt) != nil {
		return nil, nil, fmt.Errorf("completed native receipt is invalid")
	}
	native, err := c.knowledge.GetKnowledgeByID(ctx, fileStorageText(receipt, "nativeObjectRef"))
	if err != nil || native == nil || native.TenantID != run.tenantID || native.KnowledgeBaseID != run.knowledgeBaseID ||
		native.DeletedAt.Valid || native.ParseStatus != types.ParseStatusCompleted ||
		native.UpdatedAt.UTC().Format(time.RFC3339Nano) != fileStorageText(receipt, "nativeRevision") ||
		native.GetMetadata()["datasource_id"] != run.dataSourceID || native.FileHash == "" || native.FileType == "" ||
		native.FileSize != fileStorageNumber(receipt, "contentBytes") ||
		native.GetMetadata()["source_content_sha256"] != fileStorageText(receipt, "contentSha256") {
		return nil, nil, fmt.Errorf("completed native read target requires reconciliation")
	}
	return native, receipt, nil
}

func (c *fileStorageConnector) FetchStream(ctx context.Context, cfg *types.DataSourceConfig, previous *types.SyncCursor, h datasource.StreamHandler) (*types.SyncCursor, error) {
	if err := c.Validate(ctx, cfg); err != nil {
		return nil, err
	}
	run, ok := ctx.Value(fileStorageRunKey{}).(fileStorageRun)
	if !ok || !fileStorageUUID(run.dataSourceID) || !fileStorageUUID(run.syncLogID) ||
		run.tenantID != c.transport.config.NativeTenantID || run.knowledgeBaseID != c.transport.config.NativeKnowledgeBaseID {
		return nil, fmt.Errorf("native import execution does not match its controlled binding")
	}
	state, err := fileStorageState(previous)
	if err != nil {
		return nil, err
	}
	oldTime := time.Time{}
	if previous != nil {
		oldTime = previous.LastSyncTime
	}
	listings := map[string]*fileStorageListing{}
	// Finish every source enumeration before applying any missing-item set.
	for _, source := range cfg.ResourceIDs {
		listing, err := c.listing(ctx, run, source, fileStorageKey(run.syncLogID, source, "discover"), c.transport.config.ApplyActionKey, c.transport.config.ApplyActionVersion, state.Discovery[source])
		if err != nil {
			return nil, err
		}
		listings[source] = listing
	}
	groups := map[string][]fileStorageFetched{}
	for _, source := range cfg.ResourceIDs {
		for _, ref := range listings[source].items {
			key := fileStorageKey(run.syncLogID, source, fileStorageText(ref, "nativeObjectRef"), fileStorageText(ref, "nativeRevision"))
			grant, err := c.transport.grant(ctx, run, source, "file_storage.read@v1", c.transport.config.ReadActionVersion,
				key, c.transport.config.ApplyActionKey, c.transport.config.ApplyActionVersion, ref)
			if err != nil {
				return nil, err
			}
			var group, digest string
			var size int64
			if fileStorageText(grant.value, "outcome") == "COMPLETED" {
				native, receipt, err := c.completedNative(ctx, run, grant)
				if err != nil {
					return nil, err
				}
				group = native.FileHash + ":" + native.FileType
				digest = fileStorageText(receipt, "contentSha256")
				size = fileStorageNumber(receipt, "contentBytes")
			} else {
				body, observed, err := c.read(ctx, grant, ref)
				if err != nil {
					return nil, err
				}
				// Match the original native dedupe tuple, not filename/mtime/node ID.
				hash := md5.Sum(body)
				group = hex.EncodeToString(hash[:]) + ":" + getFileType(fileStorageText(ref, "displayName"))
				digest = observed
				size = int64(len(body))
			}
			if existing := groups[group]; len(existing) > 0 && existing[0].digest != digest {
				return nil, fmt.Errorf("native dedupe tuple has conflicting streamed content")
			}
			groups[group] = append(groups[group], fileStorageFetched{ref: ref, grant: grant, digest: digest, size: size})
		}
	}
	desired := map[string]fileStorageGroup{}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		files := groups[key]
		refs := make([]map[string]json.RawMessage, 0, len(files))
		for _, file := range files {
			refs = append(refs, file.ref)
		}
		refBytes, err := json.Marshal(refs)
		if err != nil {
			return nil, err
		}
		first := files[0]
		completedGroup := false
		for _, file := range files {
			if fileStorageText(file.grant.value, "outcome") == "COMPLETED" {
				completedGroup = true
			}
		}
		for _, file := range files {
			if fileStorageText(file.grant.value, "outcome") != "COMPLETED" {
				if err := c.transport.pep(ctx, file.grant); err != nil {
					return nil, err
				}
			}
		}
		if !completedGroup {
			body, digest, err := c.read(ctx, first.grant, first.ref)
			if err != nil || digest != first.digest {
				return nil, fmt.Errorf("pinned source group changed before native ingestion")
			}
			// Reading again can take time: renew receiver authorization immediately
			// before the original native write, not only before source I/O.
			for _, file := range files {
				if err := c.transport.pep(ctx, file.grant); err != nil {
					return nil, err
				}
			}
			metadata := map[string]string{"import_config_ref": run.dataSourceID, "source_references": string(refBytes),
				"source_resource_id": fileStorageText(first.ref, "resourceId"), "source_native_object_ref": fileStorageText(first.ref, "nativeObjectRef"),
				"source_native_revision": fileStorageText(first.ref, "nativeRevision"), "source_content_sha256": digest,
				"source_content_bytes": strconv.Itoa(len(body))}
			if asset := fileStorageText(first.ref, "assetId"); asset != "" {
				metadata["source_asset_id"] = asset
			}
			creationID := fileStorageKey(run.syncLogID, run.dataSourceID, key, "create")
			item := types.FetchedItem{ExternalID: key, Title: fileStorageText(first.ref, "displayName"), FileName: fileStorageText(first.ref, "displayName"),
				ContentType: fileStorageText(first.ref, "mediaType"), Content: body, SourceResourceID: fileStorageText(first.ref, "resourceId"),
				Metadata: metadata, NativeCreationID: creationID}
			if err := h.Emit(ctx, item); err != nil {
				return nil, err
			}
		}
		// Read the native service's own dedupe result, including an existing ID.
		native, err := c.knowledge.GetRepository().FindByDataSourceExternalID(ctx, run.tenantID, run.knowledgeBaseID, run.dataSourceID, key)
		if err != nil || native == nil || native.ParseStatus != types.ParseStatusCompleted || native.UpdatedAt.IsZero() || native.DeletedAt.Valid {
			return nil, fmt.Errorf("native file group is not ready")
		}
		if completedGroup && native.GetMetadata()["source_references"] != string(refBytes) {
			return nil, fmt.Errorf("completed native group reference set requires reconciliation")
		}
		revision := native.UpdatedAt.UTC().Format(time.RFC3339Nano)
		desired[key] = fileStorageGroup{KnowledgeID: native.ID, Revision: revision, References: refs}
		for _, file := range files {
			if err := c.transport.receipt(ctx, file.grant, native.ID, revision, file.digest, file.size, time.Now().UTC()); err != nil {
				return nil, err
			}
		}
	}
	// Only ready new groups reach retirement. The original cursor also retains
	// the native task intent before enqueue, so lost ACK never issues a new task.
	for key, old := range state.Groups {
		if _, kept := desired[key]; kept {
			continue
		}
		if !run.syncDeletions {
			desired[key] = old
			continue
		}
		if err := c.retire(ctx, run, key, old, listings, &state, h, oldTime); err != nil {
			return nil, err
		}
	}
	for _, listing := range listings {
		if fileStorageText(listing.grant.value, "outcome") != "COMPLETED" {
			if err := c.transport.pep(ctx, listing.grant); err != nil {
				return nil, err
			}
		}
	}
	completed := time.Now().UTC()
	state.Discovery = map[string]fileStorageSavedListing{}
	for source, listing := range listings {
		state.Discovery[source] = fileStorageSavedListing{Key: listing.grant.key, ItemsJSON: listing.itemsJSON, Digest: listing.digest, Bytes: listing.bytes}
	}
	_, err = fileStorageCheckpoint(ctx, h, state, oldTime)
	if err != nil {
		return nil, err
	}
	for _, listing := range listings {
		if err := c.transport.receipt(ctx, listing.grant, run.dataSourceID, listing.digest, listing.digest, listing.bytes, completed); err != nil {
			return nil, err
		}
	}
	state.Groups = desired
	state.Retiring = map[string]fileStorageRetirement{}
	return fileStorageCheckpoint(ctx, h, state, completed)
}

// Existing native import metadata is changed only inside the native consumer,
// with the same ownership/readiness/transfer CAS used by source replacement.
// No imported body or per-file group state is sent to Core.
func (s *DataSourceService) finishFileStorageIngest(ctx context.Context, ds *types.DataSource, item *types.FetchedItem, current *types.Knowledge) error {
	if current == nil || !fileStorageUUID(current.ID) || current.TenantID != ds.TenantID || current.KnowledgeBaseID != ds.KnowledgeBaseID ||
		current.DeletedAt.Valid || current.UpdatedAt.IsZero() || current.ParseStatus != types.ParseStatusCompleted ||
		current.FileHash+":"+current.FileType != item.ExternalID {
		return fmt.Errorf("native file-storage target is not ready or does not match its content group")
	}
	metadata := current.GetMetadata()
	if metadata["datasource_id"] != ds.ID || metadata["external_id"] != item.ExternalID ||
		metadata["source_content_sha256"] != item.Metadata["source_content_sha256"] {
		return fmt.Errorf("native file-storage target ownership or content evidence conflicts")
	}
	before := current.GetMetadata()
	for _, name := range []string{"import_config_ref", "source_references", "source_resource_id", "source_native_object_ref",
		"source_native_revision", "source_content_sha256", "source_content_bytes"} {
		metadata[name] = item.Metadata[name]
	}
	delete(metadata, "source_asset_id")
	if asset := item.Metadata["source_asset_id"]; asset != "" {
		metadata["source_asset_id"] = asset
	}
	if reflect.DeepEqual(before, metadata) {
		return nil
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	next := *current
	next.Metadata = types.JSON(raw)
	if err := s.knowledgeService.GetRepository().UpdateKnowledgeForTransfer(ctx, current, &next); err != nil {
		return err
	}
	return nil
}

func (c *fileStorageConnector) retire(ctx context.Context, run fileStorageRun, key string, old fileStorageGroup, listings map[string]*fileStorageListing,
	state *fileStorageCursor, h datasource.StreamHandler, oldTime time.Time) error {
	intent, started := state.Retiring[key]
	var grant *fileStorageGrant
	var err error
	if started {
		if intent.Group.KnowledgeID != old.KnowledgeID || intent.Group.Revision != old.Revision || !fileStorageUUID(intent.Key) || !fileStorageUUID(intent.BatchID) {
			return fmt.Errorf("native retirement intent does not match its original target")
		}
		priorRun := run
		priorRun.syncLogID = intent.BatchID
		grant, err = c.transport.grant(ctx, priorRun, intent.SourceResourceID, "file_storage.list@v1", c.transport.config.ListActionVersion,
			intent.Key, c.transport.config.RetireActionKey, c.transport.config.RetireActionVersion, map[string]string{"resourceId": intent.SourceResourceID})
	} else {
		source := fileStorageText(old.References[0], "resourceId")
		current, ok := listings[source]
		if !ok {
			return fmt.Errorf("retirement requires a complete authorized listing of the previous source")
		}
		intent = fileStorageRetirement{Group: old, SourceResourceID: source, BatchID: run.syncLogID,
			Key: fileStorageKey(run.syncLogID, run.dataSourceID, key, old.KnowledgeID, old.Revision, "retire")}
		listing, listErr := c.listing(ctx, run, source, intent.Key, c.transport.config.RetireActionKey, c.transport.config.RetireActionVersion, fileStorageSavedListing{})
		if listErr != nil {
			return listErr
		}
		if listing.digest != current.digest {
			return fmt.Errorf("source desired set changed before retirement")
		}
		grant = listing.grant
		intent.Digest = listing.digest
		intent.Bytes = listing.bytes
	}
	if err != nil {
		return err
	}
	if fileStorageText(grant.value, "outcome") == "COMPLETED" {
		return c.transport.receipt(ctx, grant, old.KnowledgeID, old.Revision, intent.Digest, intent.Bytes, time.Now().UTC())
	}
	var result map[string]any
	if started {
		// Reading the saved task is not a new delete. In particular an
		// expired grant must not prevent submitting genuine late evidence.
		result, err = c.knowledge.ObserveKnowledgeDeleteTask(ctx, run.knowledgeBaseID, old.KnowledgeID, old.Revision, intent.Key)
	} else {
		if err := c.transport.pep(ctx, grant); err != nil {
			return err
		}
		native, readErr := c.knowledge.GetKnowledgeByID(ctx, old.KnowledgeID)
		if readErr != nil || native == nil || native.TenantID != run.tenantID || native.KnowledgeBaseID != run.knowledgeBaseID ||
			native.GetMetadata()["datasource_id"] != run.dataSourceID || native.GetMetadata()["external_id"] != key ||
			native.UpdatedAt.UTC().Format(time.RFC3339Nano) != old.Revision {
			return fmt.Errorf("native retirement target ownership or revision is unconfirmed")
		}
		state.Retiring[key] = intent
		if _, err := fileStorageCheckpoint(ctx, h, *state, oldTime); err != nil {
			return err
		}
		result, err = c.knowledge.StartKnowledgeDeleteTask(ctx, run.knowledgeBaseID, old.KnowledgeID, old.Revision, intent.Key)
	}
	if err != nil {
		return fmt.Errorf("native retirement remains unconfirmed: %w", err)
	}
	completed, _ := result["completed_at"].(string)
	at, parseErr := time.Parse(time.RFC3339Nano, completed)
	if result["state"] != "SUCCEEDED" || result["task_id"] != intent.Key || result["knowledge_id"] != old.KnowledgeID ||
		result["knowledge_base_id"] != run.knowledgeBaseID || result["native_revision"] != old.Revision || parseErr != nil {
		return fmt.Errorf("native retirement terminal evidence is unavailable")
	}
	return c.transport.receipt(ctx, grant, old.KnowledgeID, old.Revision, intent.Digest, intent.Bytes, at)
}
