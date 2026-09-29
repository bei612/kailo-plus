/// `contracts/` 的 Dart 绑定，仅 Buzz Mobile 使用。
///
/// `generated/` 由 tools/gen.sh 从 contracts/**/*.schema.json 写出，不手工编辑。
/// 本库只再导出生成物，自身不定义任何类型——手写类型即违反 ADR-02。
library;

export 'generated/contracts.dart';
