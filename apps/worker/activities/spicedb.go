// Package activities 保存 Workflow 调用的 Activity 实现。
//
// 边界见 01-工程结构与模块边界.md §4：Worker 不直写 Core 数据库、不复制 Core
// authorization。本包只做两类事——经 Core service API 完成状态投影与审计写入，
// 经 adapter 执行 native dispatch、observe 与对账。
package activities

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/authzed/authzed-go/proto/authzed/api/v1"
	"github.com/authzed/authzed-go/v1"
	"github.com/authzed/grpcutil"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// Presence 是投影的目标终态。只有这两个值，没有「尽力而为」。
type Presence int

const (
	Present Presence = iota
	Absent
)

func (p Presence) String() string {
	if p == Present {
		return "Present"
	}
	return "Absent"
}

// Relationship 是一条 SpiceDB 关系。字段与 .design/03 §5 的固定 schema 对应：
// 平台 schema 只含 principal/tenant/workspace/resource/asset，组件注册不新增
// object type，因此这里不提供任意 object type 的通道。
type Relationship struct {
	ResourceType string
	ResourceID   string
	Relation     string
	SubjectType  string
	SubjectID    string
}

func (r Relationship) String() string {
	return fmt.Sprintf("%s:%s#%s@%s:%s",
		r.ResourceType, r.ResourceID, r.Relation, r.SubjectType, r.SubjectID)
}

func (r Relationship) proto() *v1.Relationship {
	return &v1.Relationship{
		Resource: &v1.ObjectReference{ObjectType: r.ResourceType, ObjectId: r.ResourceID},
		Relation: r.Relation,
		Subject: &v1.SubjectReference{
			Object: &v1.ObjectReference{ObjectType: r.SubjectType, ObjectId: r.SubjectID},
		},
	}
}

// SpiceDB 是关系授权投影的执行端。
type SpiceDB struct {
	c *authzed.Client
}

// NewSpiceDBFromEnv 按部署投递的配置构造客户端。
//
// 端点与 token 都不接受默认值：缺任一项就说明部署没把授权权威接上，此时
// 静默退回某个本地地址会让投影写进一个不是权威的实例。token 只经环境变量
// 投递，不作为命令行 flag——flag 在启用 tracing 时随 OTel resource 导出
// （SF-SPZ-04、07 §1）。
func NewSpiceDBFromEnv() (*SpiceDB, error) {
	endpoint := os.Getenv("SPICEDB_ENDPOINT")
	token := os.Getenv("SPICEDB_GRPC_PRESHARED_KEY")
	if endpoint == "" || token == "" {
		return nil, fmt.Errorf("SPICEDB_ENDPOINT 与 SPICEDB_GRPC_PRESHARED_KEY 必须同时提供")
	}
	// 传输安全由部署拓扑决定：SpiceDB 只在 component 网络内可达，本地拓扑
	// 不签证书。这个选择必须显式给出，不能让客户端按端点形状猜。
	var transport grpc.DialOption
	if os.Getenv("SPICEDB_INSECURE") == "true" {
		transport = grpc.WithTransportCredentials(insecure.NewCredentials())
	} else {
		return nil, fmt.Errorf("SPICEDB_INSECURE 目前只支持 true：本地拓扑不签证书，TLS 配置随部署描述一并引入")
	}
	c, err := authzed.NewClient(endpoint, grpcutil.WithInsecureBearerToken(token), transport)
	if err != nil {
		return nil, fmt.Errorf("连接 SpiceDB: %w", err)
	}
	return &SpiceDB{c: c}, nil
}

// Converge 把一条关系收敛到 want，并以 FullyConsistent 读回查证。
//
// 与 Buzz roster 不同，这里的写入是线性一致的：TOUCH 对已存在的关系是幂等的，
// DELETE 对不存在的关系也不报错，因此重试与重放天然安全。但仍然要读回——
// .design/09 要求「只发出 admin event 而未查证不得 active」，对 SpiceDB 同理：
// 写入返回成功而关系不可见，说明读到的不是刚写入的那个 revision，此时把成员
// 置为 active 就是在一个尚未生效的授权面上放行。
func (s *SpiceDB) Converge(ctx context.Context, rel Relationship, want Presence) error {
	op := v1.RelationshipUpdate_OPERATION_TOUCH
	if want == Absent {
		op = v1.RelationshipUpdate_OPERATION_DELETE
	}
	if _, err := s.c.WriteRelationships(ctx, &v1.WriteRelationshipsRequest{
		Updates: []*v1.RelationshipUpdate{{Operation: op, Relationship: rel.proto()}},
	}); err != nil {
		return fmt.Errorf("写 %s 到 %s: %w", rel, want, err)
	}

	present, err := s.exists(ctx, rel)
	if err != nil {
		return fmt.Errorf("查证 %s: %w", rel, err)
	}
	if present != (want == Present) {
		return fmt.Errorf("%s 写入后查证为 %v，与目标 %s 不符", rel, present, want)
	}
	return nil
}

// exists 以 FullyConsistent 判断一条关系是否存在。
//
// 用 FullyConsistent 而不是默认的 MinimizeLatency：默认值允许返回一个较旧的
// revision，那正好会把「刚写入还没可见」读成「不存在」（SF-SPZ-02）。
func (s *SpiceDB) exists(ctx context.Context, rel Relationship) (bool, error) {
	stream, err := s.c.ReadRelationships(ctx, &v1.ReadRelationshipsRequest{
		Consistency: &v1.Consistency{
			Requirement: &v1.Consistency_FullyConsistent{FullyConsistent: true},
		},
		RelationshipFilter: &v1.RelationshipFilter{
			ResourceType:       rel.ResourceType,
			OptionalResourceId: rel.ResourceID,
			OptionalRelation:   rel.Relation,
			OptionalSubjectFilter: &v1.SubjectFilter{
				SubjectType:       rel.SubjectType,
				OptionalSubjectId: rel.SubjectID,
			},
		},
	})
	if err != nil {
		return false, err
	}
	for {
		resp, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			// 流正常结束且没读到任何一行，就是「不存在」。
			return false, nil
		}
		if err != nil {
			return false, err
		}
		if resp.GetRelationship() != nil {
			return true, nil
		}
	}
}
