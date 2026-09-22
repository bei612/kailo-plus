// 四侧 round-trip 的 Go 一侧（ADR-03）。
//
// 反序列化再序列化必须与样例语义相等。它验证生成类型没有丢字段、
// 没有把可选当必填、没有把缺省字段写成 null。
package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/kailo/apps/worker/internal/contracts/generated"
)

func TestCanaryRoundtripPreservesEveryField(t *testing.T) {
	// 相对本包定位样例，不依赖调用时的工作目录
	path := filepath.Join("..", "..", "..", "contracts", "samples", "canary.sample.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取样例: %v", err)
	}

	var original map[string]any
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatalf("样例不是合法 JSON: %v", err)
	}

	var typed generated.Canary
	if err := json.Unmarshal(raw, &typed); err != nil {
		t.Fatalf("反序列化为生成类型: %v", err)
	}

	encoded, err := json.Marshal(typed)
	if err != nil {
		t.Fatalf("再序列化: %v", err)
	}

	var back map[string]any
	if err := json.Unmarshal(encoded, &back); err != nil {
		t.Fatalf("再序列化结果不是合法 JSON: %v", err)
	}

	if !reflect.DeepEqual(original, back) {
		t.Fatalf("round-trip 后与样例不等，说明生成类型丢了信息\n样例: %s\n结果: %s", raw, encoded)
	}
}
