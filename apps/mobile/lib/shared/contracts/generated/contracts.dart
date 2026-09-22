
///可用 JSON Schema 子集的可执行定义。它穷举 contracts/README.md 第 1
///节允许的每一种构造；四侧生成器必须全部生成成功并通过双向序列化。新增构造先加进本文件并四侧验证通过，才允许在其他 schema 中使用。
class Contracts {
    
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
    
    ///format: date-time，且为可选字段
    final DateTime? occurredAt;
    
    ///基础 number
    final double ratio;
    
    ///同构数组
    final List<String> tags;
    
    ///变体类型的平坦表达：封闭枚举 tag 加各变体字段全部可选，替代被禁用的 oneOf
    final List<Variant>? variants;

    Contracts({
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

}


///可选的枚举引用
///
///能力状态。权威定义见 .design/02-源码证据与设计决策.md。BLOCKED 的能力不得生成任何入口、路由、动作、工具或开关。
enum CapabilityState {
    ADAPTER_REQUIRED,
    BLOCKED,
    DESIGN_DEFINED,
    EXCLUDED,
    UPSTREAM_SUPPORTED
}


///跨文件 $ref 引用封闭枚举
///
///错误分类。每个 API 错误、Workflow 失败与 UI 状态必须落在其中之一。权威定义见 apps/06-工程基线规范.md 第 4 节。UNKNOWN
///表示外部副作用结果不明，等待对账，禁止渲染成成功或失败，也禁止盲目重放。
enum ErrorClass {
    BLOCKED,
    CONFLICT,
    DENIED,
    LIMIT,
    PRECONDITION,
    UNKNOWN
}


///内联对象，同样显式关闭 additionalProperties
class Nested {
    final String label;
    final List<double>? weights;

    Nested({
        required this.label,
        this.weights,
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

}

enum Kind {
    FILE,
    MESSAGE,
    TASK
}
