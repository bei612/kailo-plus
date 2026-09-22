package workflows

import (
	"fmt"

	"github.com/kailo/apps/worker/internal/contracts/generated"
)

// WorkflowID 生成 .design/06 固定的业务 workflow ID：
//
//	kailo:<kind>:<tenant_id>:<primary_entity_id>:<entity_version>
//
// 格式固定的目的是让「不分配第二个业务 workflow ID」可被机械校验——
// 同一实体同一版本只可能算出同一个 ID。
func WorkflowID(kind generated.WorkflowKind, tenantID, primaryEntityID string, entityVersion int) string {
	return fmt.Sprintf("kailo:%s:%s:%s:%d", kind, tenantID, primaryEntityID, entityVersion)
}
