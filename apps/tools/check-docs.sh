#!/usr/bin/env bash
# 实施文档门禁。对应 03-验证发布与验收门禁.md §5 的"只修改文档时"最低检查集，
# 以及 05-设计覆盖矩阵.md §1 的三项计数。
# 用法：tools/check-docs.sh [设计目录]   默认 ../.design
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
DESIGN="${1:-../.design}"
FAIL=0

say()  { printf '%s\n' "$*"; }
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAIL=1; }

if [ ! -d "$DESIGN" ]; then
  say "找不到设计目录：$DESIGN"; exit 2
fi

# 纳入检查的文档集：顶层实施合同 + docs/ 下的 ADR 与 runbook
DOCS=(./*.md)
while IFS= read -r f; do DOCS+=("$f"); done < <(find docs -name '*.md' 2>/dev/null | sort)

say "== 1. 禁用词 =="
HITS=$(grep -nE '\bTODO\b|\bTBD\b|待实现|待 PoC|视情况' "${DOCS[@]}" 2>/dev/null; \
       grep -nE '可能' "${DOCS[@]}" 2>/dev/null | grep -vE '不可能|可能性|可能的')
if [ -z "$HITS" ]; then pass "无禁用词"; else fail "发现禁用词"; printf '%s\n' "$HITS"; fi

say "== 2. 相对链接 =="
python3 - <<'PY' || FAIL=1
import re, os, glob, sys
bad = []
for f in sorted(glob.glob('*.md')) + sorted(glob.glob('docs/**/*.md', recursive=True)):
    base = os.path.dirname(f) or '.'
    for m in re.finditer(r'\]\(([^)#][^)]*)\)', open(f, encoding='utf-8').read()):
        p = m.group(1)
        if not p.startswith('http') and not os.path.exists(os.path.join(base, p)):
            bad.append(f"{f} -> {p}")
if bad:
    print("  \033[31mFAIL\033[0m 断链:"); [print("   ", b) for b in bad]; sys.exit(1)
print("  \033[32mPASS\033[0m 全部可达")
PY

say "== 3. 设计 ID 闭合 =="
DESIGN="$DESIGN" python3 - <<'PY' || FAIL=1
import re, glob, os, sys
d = os.environ['DESIGN']
t02 = open(glob.glob(f'{d}/02-*.md')[0], encoding='utf-8').read()
t16 = open(glob.glob(f'{d}/16-*.md')[0], encoding='utf-8').read()
known = set(re.findall(r'^\| ((?:SF|SS)-[A-Z]+-[A-Z0-9-]+|DD-\d+|GAP-[A-Z]+-\d+) \|', t02, re.M))
known |= set(re.findall(r'^\| (V-(?:SCN|REQ|SRC)-\d+) \|', t16, re.M))
apps = ''.join(open(f, encoding='utf-8').read()
               for f in sorted(glob.glob('*.md')) + sorted(glob.glob('docs/**/*.md', recursive=True)))
used = set()
for p in (r'\b(?:SF|SS)-[A-Z]+-[A-Z0-9][A-Z0-9-]*', r'\bDD-\d+',
          r'\bGAP-[A-Z]+-\d+', r'\bV-(?:SCN|REQ)-\d+'):
    used |= set(re.findall(p, apps))
miss = sorted(x for x in used if x not in known)
if miss:
    print(f"  \033[31mFAIL\033[0m 悬空引用: {miss}"); sys.exit(1)
print(f"  \033[32mPASS\033[0m {len(used)} 个引用全部闭合")
PY

say "== 4. 覆盖矩阵三项计数 =="
DESIGN="$DESIGN" python3 - <<'PY' || FAIL=1
import re, glob, os, sys
d = os.environ['DESIGN']
t02 = open(glob.glob(f'{d}/02-*.md')[0], encoding='utf-8').read()
t03 = open(glob.glob(f'{d}/03-*.md')[0], encoding='utf-8').read()
cov = open(glob.glob('05-*.md')[0], encoding='utf-8').read()

def rows(sec):
    return [l for l in sec.split('\n')
            if l.startswith('| ') and not l.startswith('|---') and '| Stage |' not in l]

ent = set()
for l in rows(cov.split('## 2.')[1].split('## 3.')[0]):
    ent |= set(re.findall(r'`([A-Z][A-Za-z]+)`', l))
ss = set()
for l in rows(cov.split('## 4.')[1].split('## 5.')[0]):
    ss |= set(re.findall(r'`(SS-[A-Z0-9-]+)`', l))
dd = set(re.findall(r'`(DD-\d+)`', cov.split('## 3.')[1].split('## 4.')[0]))

checks = [
    ('实体', set(re.findall(r'^([A-Z][A-Za-z]+)\(', t03, re.M)), ent),
    ('DD',   set(re.findall(r'^\| (DD-\d+) \|', t02, re.M)), dd),
    ('SS',   set(re.findall(r'^\| (SS-[A-Z]+-[A-Z0-9-]+) \|', t02, re.M)), ss),
]
bad = False
for name, want, got in checks:
    if want == got:
        print(f"  \033[32mPASS\033[0m {name}: {len(want)} 全部归属")
    else:
        bad = True
        print(f"  \033[31mFAIL\033[0m {name}: 缺 {sorted(want-got)} 多 {sorted(got-want)}")
sys.exit(1 if bad else 0)
PY

say "== 5. V-SCN 覆盖 =="
DESIGN="$DESIGN" python3 - <<'PY' || FAIL=1
import re, glob, os, sys
d = os.environ['DESIGN']
route = open(glob.glob('02-*.md')[0], encoding='utf-8').read()
t16 = open(glob.glob(f'{d}/16-*.md')[0], encoding='utf-8').read()
allv = sorted(int(n) for n in re.findall(r'^\| V-SCN-(\d+) \|', t16, re.M))
rng = r'`(?:V-SCN-)?(\d+)`\s*[–\-−—]\s*`(?:V-SCN-)?(\d+)`'
cov = set()
for b in re.findall(r'### 验收映射\s*\n+(.+?)(?:\n\n|\Z)', route, re.S):
    for a, z in re.findall(rng, b):
        cov.update(range(int(a), int(z) + 1))
    for n in re.findall(r'`(?:V-SCN-)?(\d+)`', re.sub(rng, '', b)):
        cov.add(int(n))
excl = set(int(n) for n in re.findall(r'V-SCN-(\d+)', route.split('## 11.')[1]))
miss = [n for n in allv if n not in cov and n not in excl]
if miss:
    print(f"  \033[31mFAIL\033[0m 未处理的场景: {miss}"); sys.exit(1)
print(f"  \033[32mPASS\033[0m {len(allv)} 个场景：{len(cov)} 已映射，{len(excl)} 明确排除")
PY

say "== 6. markdownlint =="
if command -v npx >/dev/null 2>&1; then
  if npx --yes markdownlint-cli2 "*.md" "docs/**/*.md" >/tmp/mdl.$$ 2>&1; then
    pass "0 issues"
  else
    fail "markdownlint 报错"; tail -20 /tmp/mdl.$$
  fi
  rm -f /tmp/mdl.$$
else
  say "  跳过：未找到 npx"
fi

say "== 7. 设计语料自检 =="
DESIGN="$DESIGN" python3 - <<'PY' || FAIL=1
import re, os, glob, sys
d = os.environ['DESIGN']
bad = []
files = sorted(glob.glob(f'{d}/*.md'))
BAN = re.compile(r'\bTODO\b|\bTBD\b|待补充|待完善|待实现|待 PoC')
for f in files:
    txt = open(f, encoding='utf-8').read()
    if os.path.basename(f) != 'AGENTS.md':
        for n, line in enumerate(txt.split('\n'), 1):
            if BAN.search(line):
                bad.append(f"禁用词 {os.path.basename(f)}:{n}")
    for m in re.finditer(r'\]\(([^)#][^)]*)\)', txt):
        q = m.group(1)
        if not q.startswith('http') and not os.path.exists(os.path.join(d, q)):
            bad.append(f"断链 {os.path.basename(f)} -> {q}")
if bad:
    print("  \033[31mFAIL\033[0m"); [print("   ", x) for x in bad]; sys.exit(1)
print(f"  \033[32mPASS\033[0m {len(files)} 篇：无禁用词、相对链接全部可达")
PY

if command -v npx >/dev/null 2>&1; then
  if (cd "$DESIGN" && npx --yes markdownlint-cli2 "*.md" >/tmp/mdd.$$ 2>&1); then
    pass "设计语料 markdownlint 0 issues"
  else
    fail "设计语料 markdownlint 报错"; tail -20 /tmp/mdd.$$
  fi
  rm -f /tmp/mdd.$$
fi

say ""
if [ "$FAIL" -eq 0 ]; then
  say "全部通过。"
else
  say "存在失败项，见上。"
fi
exit "$FAIL"
