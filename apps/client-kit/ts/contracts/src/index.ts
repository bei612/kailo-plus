// `contracts/` 的 TypeScript 绑定，Buzz Web 与 Buzz Desktop 共用。
//
// `generated/` 由 tools/gen.sh 从 contracts/**/*.schema.json 写出，不手工编辑。
// 本包只再导出生成物，自身不定义任何类型——手写类型即违反 ADR-02。
export * from "./generated/contracts.js";
