#!/usr/bin/env python3
"""把 contracts/ 整理成 quicktype 的确定性输入（ADR-21）。

contracts/ 仍是唯一权威；本脚本只在临时目录写出派生副本，不改源文件。

1. 删除每个文件根部的 `$id`。quicktype 以命令行给出的文件路径加载顶层
   schema，却以 `$id` 为基准解析 `$ref`；二者不一致时，同一份 schema 经顶层
   与经 `$ref` 到达被当成两个位置，生成同形不同名的第二个类型（例如
   `HuddlePageItem` 与 `HuddleView`）。去掉 `$id` 后 `$ref` 一律按文件路径
   解析，每份 schema 只对应一个类型。
2. 给没有 `title` 的内联 object、字符串 enum 与字符串 const 补上确定的
   `title`：`<所属类型名><属性名>`，数组元素再加 `Item`，`$defs`/`definitions`
   用键名，`oneOf`/`anyOf`/`allOf` 分支沿用所属类型名。否则 quicktype 按属性名
   推断类型名，新增任一 schema 都可能让既有类型改名或加上
   `Purple`/`Fluffy`/`Element`/`Class`/`Enum` 之类的区分前后缀，且四门语言的
   冲突处理不同，名字随语言分叉。
3. quicktype 把取值集合相同的枚举合并成一个类型，并拼接各处的名字（例如
   `ProjectsGitQueryReView`）。这里先把同值枚举统一为一个名字：有作者显式
   命名的取作者的名字；否则取路径序第一处的生成名。两个不同的作者命名落在
   同一取值集合上时拒绝，由 schema 作者合并为 enums/ 下的一个枚举或改变取值。
4. 校验其余 `title` 唯一：同名只允许出现在形状相同的 schema 上（同一类型在
   多处内联），同名不同形会被 quicktype 静默改名，直接拒绝。

用法：contracts-prepare.py <contracts 目录> <输出目录>
输出目录写出参与生成的 *.schema.json（与源目录同构），标准输出逐行打印
生成器的顶层输入（相对输出目录），顺序固定。
"""
import json
import os
import re
import sys

# 顶层输入：canary 定义可用子集；其余目录是业务、BFF、Workflow 与 Adapter 契约。
# enums/ 不作为顶层输入，由 $ref 引入。
TOP_DIRS = ("domain", "api", "workflow", "adapter")
# compatibility/ 是已发布合同的原字节归档，samples/ 是往返样例，均不参与生成。
SKIP_DIRS = ("compatibility", "samples")
UNIONS = ("oneOf", "anyOf", "allOf")


def pascal(name):
    words = [w for w in re.split(r"[^0-9A-Za-z]+|(?<=[a-z0-9])(?=[A-Z])", name) if w]
    return "".join(w[:1].upper() + w[1:] for w in words)


def enum_cases(node):
    """quicktype 生成枚举的 schema 的取值集合；不是枚举时返回 None。"""
    if not isinstance(node, dict) or "$ref" in node:
        return None
    if "enum" in node:
        return tuple(sorted(str(v) for v in node["enum"]))
    if isinstance(node.get("const"), str):
        return (node["const"],)
    return None


def is_named_type(node):
    """quicktype 会为其生成具名类型的 schema：带属性的 object 与字符串枚举。"""
    if not isinstance(node, dict) or "$ref" in node:
        return False
    if enum_cases(node) is not None:
        return True
    return "properties" in node and node.get("type", "object") == "object"


class Namer:
    def __init__(self):
        # 每个具名 schema：(路径, 节点, 是否作者命名, 是否在联合分支内)
        self.named = []

    def members(self, node, owner, path, in_union):
        """node 是名为 owner 的类型；为其成员命名。"""
        for key, child in (node.get("properties") or {}).items():
            self.visit(child, owner + pascal(key), "%s/properties/%s" % (path, key), in_union)
        for defs in ("$defs", "definitions"):
            for key, child in (node.get(defs) or {}).items():
                self.visit(child, owner + pascal(key), "%s/%s/%s" % (path, defs, key), in_union)
        # 联合的各分支与所属类型是同一个类型（quicktype 合并为一个类），沿用 owner。
        for kind in UNIONS:
            for i, branch in enumerate(node.get(kind) or []):
                if isinstance(branch, dict):
                    self.members(branch, owner, "%s/%s/%d" % (path, kind, i), True)

    def visit(self, node, name, path, in_union):
        if not isinstance(node, dict) or "$ref" in node:
            return
        if node.get("type") == "array" and isinstance(node.get("items"), dict):
            self.visit(node["items"], name + "Item", path + "/items", in_union)
            return
        if not is_named_type(node):
            return
        authored = "title" in node
        node.setdefault("title", name)
        self.named.append((path, node, authored, in_union))
        self.members(node, node["title"], path, in_union)


def shape(node):
    """去掉说明文字后的规范 JSON，用来判断同名的两处是否同一个类型。"""
    if isinstance(node, dict):
        return {k: shape(v) for k, v in node.items() if k != "description"}
    if isinstance(node, list):
        return [shape(v) for v in node]
    return node


def collect_refs(node, out):
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and not ref.startswith("#"):
            out.append(ref.split("#", 1)[0])
        for v in node.values():
            collect_refs(v, out)
    elif isinstance(node, list):
        for v in node:
            collect_refs(v, out)


def load(src):
    docs = {}
    for root, dirs, files in os.walk(src):
        rel_root = os.path.relpath(root, src)
        if rel_root.split(os.sep)[0] in SKIP_DIRS:
            dirs[:] = []
            continue
        dirs.sort()
        for f in sorted(files):
            if f.endswith(".schema.json"):
                rel = os.path.normpath(os.path.join(rel_root, f))
                with open(os.path.join(src, rel), encoding="utf-8") as fh:
                    docs[rel] = json.load(fh)
    return docs


def reachable(docs, inputs):
    """顶层输入与其 $ref 闭包；只有它们参与生成与校验。"""
    reach, todo = set(), list(inputs)
    while todo:
        p = todo.pop()
        if p in reach:
            continue
        if p not in docs:
            sys.exit("contracts-prepare: 缺少 %s" % p)
        reach.add(p)
        refs = []
        collect_refs(docs[p], refs)
        for r in refs:
            target = os.path.normpath(os.path.join(os.path.dirname(p), r))
            if target not in docs:
                sys.exit("contracts-prepare: %s 引用了不存在的 %s" % (p, r))
            todo.append(target)
    return sorted(reach)


def unify_enums(named):
    groups = {}
    for path, node, authored, in_union in named:
        cases = enum_cases(node)
        # 联合分支内的 const 由 quicktype 与同名的兄弟分支合并成一个枚举，不单独归组。
        if cases is not None and not in_union:
            groups.setdefault(cases, []).append((path, node, authored))
    errors = []
    for cases, members in sorted(groups.items()):
        authored = sorted({n["title"] for _, n, a in members if a})
        if len(authored) > 1:
            errors.append("  取值 %s 被命名为 %s：%s" % (
                "/".join(cases), "、".join(authored),
                ", ".join(p for p, _, _ in members)))
            continue
        name = authored[0] if authored else min(members, key=lambda m: m[0])[1]["title"]
        for _, node, _ in members:
            node["title"] = name
    if errors:
        sys.exit("contracts-prepare: 同值枚举有多个作者命名，合并到 enums/ 或区分取值：\n"
                 + "\n".join(errors))


def check_unique(named):
    seen = {}
    for path, node, _, in_union in named:
        if in_union:
            continue
        cases = enum_cases(node)
        form = shape(node) if cases is None else {"enum": cases}
        seen.setdefault(node["title"], []).append((path, json.dumps(form, sort_keys=True)))
    dup = {t: w for t, w in seen.items() if len({form for _, form in w}) > 1}
    if dup:
        lines = ["  %s: %s" % (t, ", ".join(p for p, _ in w)) for t, w in sorted(dup.items())]
        sys.exit("contracts-prepare: 类型名必须唯一，以下 title 用在不同形状上：\n" + "\n".join(lines))


def main(src, dst):
    docs = load(src)
    inputs = ["canary.schema.json"] + sorted(p for p in docs if p.split(os.sep)[0] in TOP_DIRS)
    files = reachable(docs, inputs)

    namer = Namer()
    for p in files:
        doc = docs[p]
        doc.pop("$id", None)
        if not isinstance(doc.get("title"), str):
            sys.exit("contracts-prepare: %s 缺少根 title" % p)
        namer.visit(doc, doc["title"], p + "#", False)
    unify_enums(namer.named)
    check_unique(namer.named)

    for p in files:
        out = os.path.join(dst, p)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(docs[p], fh, ensure_ascii=False, indent=2)
            fh.write("\n")
    print("\n".join(inputs))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
