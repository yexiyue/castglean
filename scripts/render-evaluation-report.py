"""Render numerical tables from recomputed public baseline reports."""
import argparse
from collections import Counter
from pathlib import Path

from evaluation.suite import load

CATEGORIES = {"explicit": "明确说话", "pronoun": "可靠指代", "continuation": "持续发言", "candidates": "有限候选",
              "unowned": "无主声音", "anonymous": "匿名身份", "same_name": "同名人物", "alias": "别名",
              "thought": "心理活动", "quoted": "非对白引用"}


def percent(value):
    return "—" if value is None else f"{value:.1%}"


def interval(group):
    lo, hi = group["joint_accuracy_lower"], group["joint_accuracy_upper"]
    return percent(lo) if lo == hi else f"{percent(lo)}–{percent(hi)}"


def render(reports):
    lines = ["# 独立归属基线数值报告", "", "版本 attribution-v1；两后端各 40 场景 × 2 轮。失败仍计入计划与表达分母，严格联合分数取章内身份匹配下界。", "",
             "规则及指标定义见 [评测用法](attribution-evaluation.md)。完整机器可读记录包含类别、划分、状态矩阵、执行顺序及逐次摘要。", "",
             "## 按划分与整体", "", "| 后端 | 划分 | 交付 / 计划 | 联合归属正确 / 表达 | 联合准确率区间 | 类型字节准确率 | resolved 准确率（下界） | resolved 覆盖率 | 角色精确率 / 召回率 | 额外 / 遗漏人物 |",
             "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for report in reports:
        for split, group in [("整体", report["summary"]["overall"]), *report["summary"]["split"].items()]:
            lines.append(f"| {report['backend']} | {split} | {group['states'].get('delivered', 0)} / {group['planned']} | "
                         f"{group['correct_lower']} / {group['units']} | {interval(group)} | {percent(group['expression_type_byte_accuracy'])} | "
                         f"{percent(group['resolved_accuracy_lower'])} | {percent(group['resolved_coverage'])} | "
                         f"{percent(group['character_precision'])} / {percent(group['character_recall'])} | {group['extra_characters']} / {group['missing_characters']} |")
    lines += ["", "## 按类别", "", "| 类别 | 后端 | 交付 / 计划 | 联合正确 / 表达 | 准确率区间 | 类型字节 | 角色精确率 / 召回率 | 额外 / 遗漏 |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for category, title in CATEGORIES.items():
        for report in reports:
            g = report["summary"]["category"][category]
            lines.append(f"| {title} | {report['backend']} | {g['states'].get('delivered', 0)} / {g['planned']} | {g['correct_lower']} / {g['units']} | "
                         f"{interval(g)} | {percent(g['expression_type_byte_accuracy'])} | {percent(g['character_precision'])} / {percent(g['character_recall'])} | {g['extra_characters']} / {g['missing_characters']} |")
    for report in reports:
        lines += ["", f"## {report['backend']} 状态矩阵", "", "| 金标 → 预测 | 表达数 |", "| --- | --- |"]
        lines += [f"| {key} | {value} |" for key, value in sorted(report["summary"]["overall"]["status_confusion"].items())]
        lines += ["", f"## {report['backend']} 失败与匹配", "", "| 状态 | 章节次数 |", "| --- | --- |"]
        lines += [f"| {key} | {value} |" for key, value in sorted(report["summary"]["overall"]["states"].items())]
        lines += [f"| 身份：{key} | {value} |" for key, value in sorted(report["summary"]["overall"]["identity_alignment"].items())]
        failures = Counter(a.get("error", "unknown") for a in report["attempts"] if a["state"] != "delivered")
        lines += ["", "| 安全错误 | 次数 |", "| --- | --- |"]
        lines += [f"| {key.replace('|', '/')} | {value} |" for key, value in sorted(failures.items())]
    lines += ["", "## 用量与延迟", "", "| 后端 | 已观察请求 | 已观察输入 / 输出 token | 用量已知章节 / 计划 | 全部输入 / 输出 token | 总章节耗时秒 | 平均章节秒 |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for report in reports:
        g = report["summary"]["overall"]
        lines.append(f"| {report['backend']} | {g['observed_requests']} | {g['observed_input_tokens']} / {g['observed_output_tokens']} | "
                     f"{g['input_tokens_known_attempts']} / {g['planned']} | {g['input_tokens']} / {g['output_tokens']} | "
                     f"{g['wall_ms'] / 1000:.3f} | {g['mean_attempt_wall_ms'] / 1000:.3f} |")
    lines += ["", "null/None 表示全部调用用量未知；已观察值仅是下限，不能作为失败成本为零的证据。章节耗时含失败、修复及本地冷启动影响，不含离线校验与评分。非对白引用类可以没有 speech/thought，联合准确率分母为零时显示 —，但类型和角色指标仍计入整体。", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    reports = [load(path) for path in args.reports]
    if any(not r.get("finished_at") or r["summary"]["overall"]["states"].get("not_attempted", 0) for r in reports):
        raise ValueError("baseline_not_complete")
    args.output.write_text(render(reports), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
