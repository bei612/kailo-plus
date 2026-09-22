// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse and unparse this JSON data, add this code to your project and do:
//
//    canary, err := UnmarshalCanary(bytes)
//    bytes, err = canary.Marshal()

package generated

import "encoding/json"

func UnmarshalCanary(data []byte) (Canary, error) {
	var r Canary
	err := json.Unmarshal(data, &r)
	return r, err
}

func (r *Canary) Marshal() ([]byte, error) {
	return json.Marshal(r)
}

// 可用 JSON Schema 子集的可执行定义。它穷举 contracts/README.md 第 1
// 节允许的每一种构造；四侧生成器必须全部生成成功并通过双向序列化。新增构造先加进本文件并四侧验证通过，才允许在其他 schema 中使用。
type Canary struct {
	// 可选的枚举引用
	CapabilityState *CapabilityState `json:"capabilityState,omitempty"`
	// 基础 integer
	Count int64 `json:"count"`
	// 基础 boolean
	Enabled bool `json:"enabled"`
	// 跨文件 $ref 引用封闭枚举
	ErrorClass ErrorClass `json:"errorClass"`
	// format: uuid
	ID string `json:"id"`
	// 基础 string
	Name string `json:"name"`
	// 内联对象，同样显式关闭 additionalProperties
	Nested Nested `json:"nested"`
	// RFC3339 时间戳，按普通 string 传输。format: date-time 不在可用子集内——Dart 的 toIso8601String()
	// 强制补毫秒，四侧线格式不等价。取值合法性由 Core 在 Admission 校验，不由 schema 承担。
	OccurredAt *string `json:"occurredAt,omitempty"`
	// 基础 number
	Ratio float64 `json:"ratio"`
	// 同构数组
	Tags []string `json:"tags"`
	// 变体类型的平坦表达：封闭枚举 tag 加各变体字段全部可选，替代被禁用的 oneOf
	Variants []Variant `json:"variants,omitempty"`
}

// 内联对象，同样显式关闭 additionalProperties
type Nested struct {
	Label   string    `json:"label"`
	Weights []float64 `json:"weights,omitempty"`
}

type Variant struct {
	FileDigest  *string `json:"fileDigest,omitempty"`
	Kind        Kind    `json:"kind"`
	MessageBody *string `json:"messageBody,omitempty"`
	TaskAttempt *int64  `json:"taskAttempt,omitempty"`
}

// 可选的枚举引用
//
// 能力状态。权威定义见 .design/02-源码证据与设计决策.md。BLOCKED 的能力不得生成任何入口、路由、动作、工具或开关。
type CapabilityState string

const (
	AdapterRequired        CapabilityState = "ADAPTER_REQUIRED"
	CapabilityStateBLOCKED CapabilityState = "BLOCKED"
	DesignDefined          CapabilityState = "DESIGN_DEFINED"
	Excluded               CapabilityState = "EXCLUDED"
	UpstreamSupported      CapabilityState = "UPSTREAM_SUPPORTED"
)

// 跨文件 $ref 引用封闭枚举
//
// 错误分类。每个 API 错误、Workflow 失败与 UI 状态必须落在其中之一。权威定义见 apps/06-工程基线规范.md 第 4 节。UNKNOWN
// 表示外部副作用结果不明，等待对账，禁止渲染成成功或失败，也禁止盲目重放。
type ErrorClass string

const (
	Conflict          ErrorClass = "CONFLICT"
	Denied            ErrorClass = "DENIED"
	ErrorClassBLOCKED ErrorClass = "BLOCKED"
	Limit             ErrorClass = "LIMIT"
	Precondition      ErrorClass = "PRECONDITION"
	Unknown           ErrorClass = "UNKNOWN"
)

type Kind string

const (
	File    Kind = "FILE"
	Message Kind = "MESSAGE"
	Task    Kind = "TASK"
)
