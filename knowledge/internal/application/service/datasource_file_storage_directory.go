package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Tencent/WeKnora/internal/datasource"
	"github.com/Tencent/WeKnora/internal/types"
)

// ListFileStorageSources supplies the existing native connector picker. The
// receiver service identity stays on the backend; selecting metadata does not
// mint a read grant or turn the native tenant into a platform identity.
func (s *DataSourceService) ListFileStorageSources(ctx context.Context, kbID string) ([]types.Resource, error) {
	tenantID, present := types.TenantIDFromContext(ctx)
	if !present || tenantID == 0 || !fileStorageUUID(kbID) || s.connectorRegistry == nil {
		return nil, datasource.ErrInvalidConfig
	}
	connector, err := s.connectorRegistry.Get(fileStorageConnectorType)
	if err == datasource.ErrConnectorNotFound {
		return []types.Resource{}, nil
	}
	if err != nil {
		return nil, err
	}
	native, ok := connector.(*fileStorageConnector)
	if !ok || native.transport == nil || native.transport.config == nil {
		return nil, datasource.ErrInvalidConfig
	}
	if err := native.bindingScope(tenantID, kbID); err != nil {
		// A receiver configured for another native KB is not a connector for
		// this KB. Existing credential connectors remain independently usable.
		return []types.Resource{}, nil
	}
	return native.transport.sourceResources(ctx)
}

func (t *fileStorageTransport) sourceResources(ctx context.Context) ([]types.Resource, error) {
	if t == nil || t.config == nil || t.core == nil || t.http == nil {
		return nil, datasource.ErrInvalidConfig
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(t.config.TimeoutMS)*time.Millisecond)
	defer cancel()
	items := []types.Resource{}
	seen := map[string]bool{}
	var offset, usedBytes int64
	var tenantID, principalID, workspaceID string
	var bindingVersion int64
	for {
		page, err := t.coreRequest(ctx, http.MethodGet, &url.URL{
			Path:     "/service/v1/adapter/bindings/" + t.config.BindingID + "/read-resources",
			RawQuery: url.Values{"direction": {"SOURCE"}, "categoryKey": {"FILE_STORAGE"}, "offset": {strconv.FormatInt(offset, 10)}}.Encode(),
		}, nil)
		if err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(page)
		if err != nil || int64(len(encoded)) > t.config.MaxBodyBytes-usedBytes {
			return nil, fmt.Errorf("authorized source directory exceeds its delivered bound")
		}
		usedBytes += int64(len(encoded))
		workspace := fileStorageText(page, "workspaceId")
		_, hasWorkspace := page["workspaceId"]
		if fileStorageText(page, "bindingId") != t.config.BindingID || fileStorageText(page, "direction") != "SOURCE" ||
			!fileStorageUUID(fileStorageText(page, "tenantId")) || !fileStorageUUID(fileStorageText(page, "servicePrincipalId")) ||
			fileStorageNumber(page, "bindingVersion") <= 0 || (hasWorkspace && !fileStorageUUID(workspace)) {
			return nil, fmt.Errorf("authorized source directory identity is invalid")
		}
		if offset == 0 {
			tenantID, principalID, workspaceID = fileStorageText(page, "tenantId"), fileStorageText(page, "servicePrincipalId"), workspace
			bindingVersion = fileStorageNumber(page, "bindingVersion")
		} else if fileStorageText(page, "tenantId") != tenantID || fileStorageText(page, "servicePrincipalId") != principalID ||
			workspace != workspaceID || fileStorageNumber(page, "bindingVersion") != bindingVersion {
			return nil, fmt.Errorf("authorized source directory changed during discovery")
		}
		var resources []map[string]json.RawMessage
		if json.Unmarshal(page["resources"], &resources) != nil || resources == nil {
			return nil, fmt.Errorf("authorized source directory resources are invalid")
		}
		for _, resource := range resources {
			id, resourceWorkspace := fileStorageText(resource, "resourceId"), fileStorageText(resource, "workspaceId")
			_, hasResourceWorkspace := resource["workspaceId"]
			nativeRef, typeKey := fileStorageText(resource, "nativeRef"), fileStorageText(resource, "typeKey")
			if !fileStorageUUID(id) || seen[id] || !fileStorageUUID(fileStorageText(resource, "bindingId")) ||
				fileStorageNumber(resource, "version") <= 0 || strings.TrimSpace(nativeRef) == "" || strings.TrimSpace(typeKey) == "" ||
				(hasResourceWorkspace && (!fileStorageUUID(resourceWorkspace) || (workspaceID != "" && resourceWorkspace != workspaceID))) {
				return nil, fmt.Errorf("authorized source directory resource is invalid")
			}
			seen[id] = true
			items = append(items, types.Resource{ExternalID: id, Name: nativeRef, Type: typeKey})
		}
		if _, exists := page["nextOffset"]; !exists {
			return items, nil
		}
		next := fileStorageNumber(page, "nextOffset")
		if next <= offset {
			return nil, fmt.Errorf("authorized source directory pagination is invalid")
		}
		offset = next
	}
}
