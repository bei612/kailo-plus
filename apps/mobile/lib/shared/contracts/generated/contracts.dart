// To parse this JSON data, do
//
//     final canary = canaryFromJson(jsonString);
//     final workflowRef = workflowRefFromJson(jsonString);

import 'dart:convert';

Canary canaryFromJson(String str) => Canary.fromJson(json.decode(str));

String canaryToJson(Canary data) => json.encode(data.toJson());

WorkflowRef workflowRefFromJson(String str) =>
    WorkflowRef.fromJson(json.decode(str));

String workflowRefToJson(WorkflowRef data) => json.encode(data.toJson());

///可用 JSON Schema 子集的可执行定义。它穷举 contracts/README.md 第 1
///节允许的每一种构造；四侧生成器必须全部生成成功并通过双向序列化。新增构造先加进本文件并四侧验证通过，才允许在其他 schema 中使用。
class Canary {
  ///可选的枚举引用
  final CapabilityState? capabilityState;

  ///基础 integer
  final int count;

  ///基础 boolean
  final bool enabled;

  ///跨文件 $ref 引用封闭枚举
  final ErrorClass errorClass;

  ///format: uuid
  final String id;

  ///基础 string
  final String name;

  ///内联对象，同样显式关闭 additionalProperties
  final Nested nested;

  ///RFC3339 时间戳，按普通 string 传输。format: date-time 不在可用子集内——Dart 的 toIso8601String()
  ///强制补毫秒，四侧线格式不等价。取值合法性由 Core 在 Admission 校验，不由 schema 承担。
  final String? occurredAt;

  ///基础 number
  final double ratio;

  ///同构数组
  final List<String> tags;

  ///变体类型的平坦表达：封闭枚举 tag 加各变体字段全部可选，替代被禁用的 oneOf
  final List<Variant>? variants;

  Canary({
    this.capabilityState,
    required this.count,
    required this.enabled,
    required this.errorClass,
    required this.id,
    required this.name,
    required this.nested,
    this.occurredAt,
    required this.ratio,
    required this.tags,
    this.variants,
  });

  factory Canary.fromJson(Map<String, dynamic> json) => Canary(
    capabilityState: capabilityStateValues.map[json["capabilityState"]]!,
    count: json["count"],
    enabled: json["enabled"],
    errorClass: errorClassValues.map[json["errorClass"]]!,
    id: json["id"],
    name: json["name"],
    nested: Nested.fromJson(json["nested"]),
    occurredAt: json["occurredAt"],
    ratio: json["ratio"]?.toDouble(),
    tags: List<String>.from(json["tags"].map((x) => x)),
    variants: json["variants"] == null
        ? []
        : List<Variant>.from(json["variants"]!.map((x) => Variant.fromJson(x))),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "capabilityState": capabilityStateValues.reverse[capabilityState],
    "count": count,
    "enabled": enabled,
    "errorClass": errorClassValues.reverse[errorClass],
    "id": id,
    "name": name,
    "nested": nested.toJson(),
    "occurredAt": occurredAt,
    "ratio": ratio,
    "tags": List<dynamic>.from(tags.map((x) => x)),
    "variants": variants == null
        ? []
        : List<dynamic>.from(variants!.map((x) => x.toJson())),
  });
}

///可选的枚举引用
///
///能力状态。权威定义见 .design/02-源码证据与设计决策.md。BLOCKED 的能力不得生成任何入口、路由、动作、工具或开关。
enum CapabilityState {
  ADAPTER_REQUIRED,
  BLOCKED,
  DESIGN_DEFINED,
  EXCLUDED,
  UPSTREAM_SUPPORTED,
}

final capabilityStateValues = EnumValues({
  "ADAPTER_REQUIRED": CapabilityState.ADAPTER_REQUIRED,
  "BLOCKED": CapabilityState.BLOCKED,
  "DESIGN_DEFINED": CapabilityState.DESIGN_DEFINED,
  "EXCLUDED": CapabilityState.EXCLUDED,
  "UPSTREAM_SUPPORTED": CapabilityState.UPSTREAM_SUPPORTED,
});

///跨文件 $ref 引用封闭枚举
///
///错误分类。每个 API 错误、Workflow 失败与 UI 状态必须落在其中之一。权威定义见 apps/06-工程基线规范.md 第 4 节。UNKNOWN
///表示外部副作用结果不明，等待对账，禁止渲染成成功或失败，也禁止盲目重放。
enum ErrorClass { BLOCKED, CONFLICT, DENIED, LIMIT, PRECONDITION, UNKNOWN }

final errorClassValues = EnumValues({
  "BLOCKED": ErrorClass.BLOCKED,
  "CONFLICT": ErrorClass.CONFLICT,
  "DENIED": ErrorClass.DENIED,
  "LIMIT": ErrorClass.LIMIT,
  "PRECONDITION": ErrorClass.PRECONDITION,
  "UNKNOWN": ErrorClass.UNKNOWN,
});

///内联对象，同样显式关闭 additionalProperties
class Nested {
  final String label;
  final List<double>? weights;

  Nested({required this.label, this.weights});

  factory Nested.fromJson(Map<String, dynamic> json) => Nested(
    label: json["label"],
    weights: json["weights"] == null
        ? []
        : List<double>.from(json["weights"]!.map((x) => x?.toDouble())),
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "label": label,
    "weights": weights == null
        ? []
        : List<dynamic>.from(weights!.map((x) => x)),
  });
}

class Variant {
  final String? fileDigest;
  final Kind kind;
  final String? messageBody;
  final int? taskAttempt;

  Variant({
    this.fileDigest,
    required this.kind,
    this.messageBody,
    this.taskAttempt,
  });

  factory Variant.fromJson(Map<String, dynamic> json) => Variant(
    fileDigest: json["fileDigest"],
    kind: kindValues.map[json["kind"]]!,
    messageBody: json["messageBody"],
    taskAttempt: json["taskAttempt"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "fileDigest": fileDigest,
    "kind": kindValues.reverse[kind],
    "messageBody": messageBody,
    "taskAttempt": taskAttempt,
  });
}

enum Kind { FILE, MESSAGE, TASK }

final kindValues = EnumValues({
  "FILE": Kind.FILE,
  "MESSAGE": Kind.MESSAGE,
  "TASK": Kind.TASK,
});

///Core 在 Temporal Start 之前持久化的唯一引用（.design/06）。workflowId 一律取
///kailo:<kind>:<tenantId>:<primaryEntityId>:<entityVersion>，使「不分配第二个业务 workflow ID」可被机械校验。
class WorkflowRef {
  ///RFC3339；Describe 返回 NotFound 时用它判断是否仍在 retention 窗口内
  final String createdAt;
  final int entityVersion;
  final WorkflowKind kind;
  final String primaryEntityId;

  ///Start 成功后回填；未知时缺省
  final String? runId;
  final String tenantId;

  ///固定格式的业务 workflow ID
  final String workflowId;

  WorkflowRef({
    required this.createdAt,
    required this.entityVersion,
    required this.kind,
    required this.primaryEntityId,
    this.runId,
    required this.tenantId,
    required this.workflowId,
  });

  factory WorkflowRef.fromJson(Map<String, dynamic> json) => WorkflowRef(
    createdAt: json["createdAt"],
    entityVersion: json["entityVersion"],
    kind: workflowKindValues.map[json["kind"]]!,
    primaryEntityId: json["primaryEntityId"],
    runId: json["runId"],
    tenantId: json["tenantId"],
    workflowId: json["workflowId"],
  );

  Map<String, dynamic> toJson() => _stripNulls({
    "createdAt": createdAt,
    "entityVersion": entityVersion,
    "kind": workflowKindValues.reverse[kind],
    "primaryEntityId": primaryEntityId,
    "runId": runId,
    "tenantId": tenantId,
    "workflowId": workflowId,
  });
}

///ComponentTaskWorkflow 的封闭 kind 列表。权威定义见 .design/06-Temporal任务工作台.md；新增 kind
///必须同时出现在那里，否则能力注册表在构建期拒绝。本文件当前只含 Stage 1 已实现的四个。
enum WorkflowKind {
  MEMBERSHIP_PROJECTION,
  MEMBERSHIP_REVOCATION,
  TENANT_LIFECYCLE,
  WORKSPACE_LIFECYCLE,
}

final workflowKindValues = EnumValues({
  "MEMBERSHIP_PROJECTION": WorkflowKind.MEMBERSHIP_PROJECTION,
  "MEMBERSHIP_REVOCATION": WorkflowKind.MEMBERSHIP_REVOCATION,
  "TENANT_LIFECYCLE": WorkflowKind.TENANT_LIFECYCLE,
  "WORKSPACE_LIFECYCLE": WorkflowKind.WORKSPACE_LIFECYCLE,
});

class EnumValues<T> {
  Map<String, T> map;
  late Map<T, String> reverseMap;

  EnumValues(this.map);

  Map<T, String> get reverse {
    reverseMap = map.map((k, v) => MapEntry(v, k));
    return reverseMap;
  }
}

/// 去掉值为 null 的键。缺省的可选字段必须在线格式中省略而不是写成 null——
/// schema 未把 null 列入这些字段的类型，且可用子集禁止联合类型。
/// 由 tools/gen.sh 在生成后注入，不手工编辑。
Map<String, dynamic> _stripNulls(Map<String, dynamic> m) =>
    Map<String, dynamic>.fromEntries(m.entries.where((e) => e.value != null));
