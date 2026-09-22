package activities

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
)

// 对运行中的 SpiceDB 执行。没有配置时跳过——这不是可选实现，是本机拓扑没起来。
func client(t *testing.T) *SpiceDB {
	t.Helper()
	if os.Getenv("SPICEDB_ENDPOINT") == "" {
		t.Skip("未提供 SPICEDB_ENDPOINT，跳过")
	}
	s, err := NewSpiceDBFromEnv()
	if err != nil {
		t.Fatalf("构造客户端: %v", err)
	}
	return s
}

func ctx(t *testing.T) context.Context {
	c, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	return c
}

// 成员投影的两个方向，各重复执行两次。
//
// 重复是必须验的：Activity 会重试、Worker 会崩溃重放，同一次投影必然被执行
// 多次。TOUCH 与 DELETE 本身幂等，但「幂等」这件事必须由实测证明，不是假设。
func TestMembershipRelationshipConverges(t *testing.T) {
	s := client(t)
	c := ctx(t)
	principal := fmt.Sprintf("p-%d", time.Now().UnixNano())

	// DD-45：Tenant 成员投到 tenant#member，Workspace 成员投到 workspace#member
	for _, rel := range []Relationship{
		{ResourceType: "tenant", ResourceID: "t-conv", Relation: "member",
			SubjectType: "principal", SubjectID: principal},
		{ResourceType: "workspace", ResourceID: "w-conv", Relation: "member",
			SubjectType: "principal", SubjectID: principal},
	} {
		// 用例失败会在断言处中止，撤销那一半就跑不到——不登记清理就会在
		// 授权权威里留下测试残留。杜绝脏数据不分测试与生产。
		t.Cleanup(func() { _ = s.Converge(context.Background(), rel, Absent) })
		for round := 1; round <= 2; round++ {
			if err := s.Converge(c, rel, Present); err != nil {
				t.Fatalf("第 %d 次建立 %s: %v", round, rel, err)
			}
		}
		present, err := s.exists(c, rel)
		if err != nil || !present {
			t.Fatalf("建立后查证 %s 应为真，得到 %v %v", rel, present, err)
		}

		for round := 1; round <= 2; round++ {
			if err := s.Converge(c, rel, Absent); err != nil {
				t.Fatalf("第 %d 次撤销 %s: %v", round, rel, err)
			}
		}
		present, err = s.exists(c, rel)
		if err != nil || present {
			t.Fatalf("撤销后查证 %s 应为假，得到 %v %v", rel, present, err)
		}
	}
}

// 反向：schema 里不存在的 relation 必须当场失败，不能静默成功。
//
// 这条守的是「第二份权威」：.design/03 §5 的 schema 是固定的，组件注册不新增
// object type 也不新增 relation。投影代码若能写出 schema 之外的关系，授权面就
// 会长出设计没有的边。
func TestRelationOutsideFixedSchemaFails(t *testing.T) {
	s := client(t)
	err := s.Converge(ctx(t), Relationship{
		ResourceType: "tenant", ResourceID: "t-conv", Relation: "not_in_schema",
		SubjectType: "principal", SubjectID: "p-x",
	}, Present)
	if err == nil {
		t.Fatal("schema 之外的 relation 必须失败")
	}
}

// 反向：查证读的是刚写入的那个 revision。
//
// 写成功后立刻读，若读到的是较旧的 revision 就会把「刚写入」读成「不存在」，
// Converge 必须因此失败而不是报成功（SF-SPZ-02 的 FullyConsistent 分支）。
// 这里直接断言写后即读为真——它跑不通就说明一致性档位选错了。
//
// 已实测有效：把 Converge 的一致性档位改成默认的 MinimizeLatency，本用例与
// TestMembershipRelationshipConverges 都会失败（读到旧 revision，查证为 false）。
// 一致性档位不是防御性写法，是这个拓扑上实际会踩的坑。
//
// 覆盖缺口（有意留下并写明）：把查证整段删掉，三个用例仍然通过——写入本身
// 是成功的。要让它有牙就得注入「写成功但关系不可见」的故障，那需要一套
// 故障注入设施，与当前阶段要成立的门禁无关。这一条由代码评审守，不由测试守。
func TestVerificationReadsTheWrittenRevision(t *testing.T) {
	s := client(t)
	c := ctx(t)
	rel := Relationship{
		ResourceType: "tenant", ResourceID: fmt.Sprintf("t-%d", time.Now().UnixNano()),
		Relation: "member", SubjectType: "principal", SubjectID: "p-fresh",
	}
	t.Cleanup(func() { _ = s.Converge(context.Background(), rel, Absent) })

	if err := s.Converge(c, rel, Present); err != nil {
		t.Fatalf("写后即读应当读到刚写入的 revision: %v", err)
	}
}
