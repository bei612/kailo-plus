"""07 §6 的必备 runbook 逐项核对（由 tools/check.sh docs 调用）。

清单以 07 §6 的编号列表为权威：有几项就必须有几份，编号一一对应，文件名为
docs/runbooks/RB-NN-<slug>.md。每份必须有规定的七个二级标题，演练记录里必须
有日期——没演练过的 runbook 在事故里第一次跑，等于没有。
"""

import glob
import os
import re
import sys

REQUIRED = ["适用范围", "触发信号", "判定依据", "可执行步骤", "不可执行的动作", "完成判据", "演练记录"]

t07 = open(glob.glob("07-*.md")[0], encoding="utf-8").read()
section = t07.split("## 6. 必备 Runbook", 1)[1].split("\n## ", 1)[0]
want = [int(n) for n in re.findall(r"^(\d+)\. ", section, re.M)]

bad = []
found = {}
for f in sorted(glob.glob("docs/runbooks/*.md")):
    m = re.match(r"RB-(\d{2})-[a-z0-9-]+\.md$", os.path.basename(f))
    if not m:
        bad.append(f"{f}: 文件名须为 RB-NN-<slug>.md")
        continue
    found.setdefault(int(m.group(1)), []).append(f)

for n in want:
    if n not in found:
        bad.append(f"缺少 07 §6 第 {n} 项的 runbook（docs/runbooks/RB-{n:02d}-*.md）")
for n, files in sorted(found.items()):
    if n not in want:
        bad.append(f"{files}: 07 §6 没有第 {n} 项")
    if len(files) > 1:
        bad.append(f"第 {n} 项有多份：{files}")
    for f in files:
        text = open(f, encoding="utf-8").read()
        heads = re.findall(r"^## (.+?)\s*$", text, re.M)
        for h in REQUIRED:
            if h not in heads:
                bad.append(f"{f}: 缺少「## {h}」")
        drill = text.split("## 演练记录", 1)[1] if "## 演练记录" in text else ""
        if not re.search(r"\b20\d\d-\d\d-\d\d\b", drill):
            bad.append(f"{f}: 演练记录没有日期")

if bad:
    for b in bad:
        print("   ", b)
    sys.exit(1)
