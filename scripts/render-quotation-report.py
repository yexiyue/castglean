"""Render complete, separate original-v2 and literary mode comparisons."""
import argparse
from collections import Counter
from pathlib import Path

from evaluation.suite import load


def percent(value):
    return "—" if value is None else f"{value*100:.1f}%"


def bounds(group):
    lower, upper = group["joint_accuracy_lower"], group["joint_accuracy_upper"]
    return percent(lower) if lower == upper else f"{percent(lower)}–{percent(upper)}"


def mode(report):
    return "引文" if report["evidence_mode"] == "verified-quotes" else "片段 ID"


def render(reports):
    expected = {(suite, backend, evidence) for suite in ("attribution-v2", "literary-v1")
                for backend in ("local", "minimax") for evidence in ("segment-ids", "verified-quotes")}
    actual = {(r["evaluation_version"], r["backend"], r["evidence_mode"]) for r in reports}
    if len(reports) != 8 or actual != expected:
        raise ValueError("comparison_matrix_incomplete")
    for report in reports:
        group = report["summary"]["overall"]
        if (not report.get("finished_at") or group["states"].get("not_attempted", 0)
                or report["actual_order"] != list(range(group["planned"]))):
            raise ValueError("comparison_not_complete")
        count = 80 if report["evaluation_version"] == "attribution-v2" else 6
        if group["planned"] != count:
            raise ValueError("unexpected_planned_count")
    ordered = sorted(reports, key=lambda r: (r["evaluation_version"], r["backend"], r["evidence_mode"]))
    lines = ["# 原文引文证据：v2 与真实小说对照", "",
             "本轮共 344 次章节运行：原创 v2 每后端每模式 40 例各两次，真实小说组每后端每模式六例各一次。金标和原文均在调用前冻结，没有按输出调整答案。v1 历史分数未改写。", "",
             "原文引文模式以提示词版本 6、引文 Schema 和来源校验共同构成一个实验条件；结果不能单独归因于提示词、Schema 或修复。片段模式为版本 5。引文存在不证明语义归属。", "",
             "预算保持：窗口 1000 字符 / 8 片段，每章 8 请求，每窗口一次修复，请求 / 章节时限 120 / 600 秒，本地 / MiniMax 输出 2048 / 8192 token。每后端串行，无自动网络重试和后端回退。", ""]
    for version, title in [("attribution-v2", "原创 v2：开发与留出"), ("literary-v1", "真实小说：独立补充组")]:
        lines += [f"## {title}", "", "| 后端 | 模式 | 分组 | 交付 / 计划 | 联合正确 / 表达 | 联合准确率区间 | 类型字节准确率 | resolved 准确率 / 覆盖率 | 角色精确率 / 召回率 | 额外 / 遗漏 |",
                  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
        for report in ordered:
            if report["evaluation_version"] != version:
                continue
            for split, g in [("整体", report["summary"]["overall"]), *report["summary"]["split"].items()]:
                lines.append(f"| {report['backend']} | {mode(report)} | {split} | {g['states'].get('delivered',0)} / {g['planned']} | {g['correct_lower']} / {g['units']} | {bounds(g)} | {percent(g['expression_type_byte_accuracy'])} | {percent(g['resolved_accuracy_lower'])} / {percent(g['resolved_coverage'])} | {percent(g['character_precision'])} / {percent(g['character_recall'])} | {g['extra_characters']} / {g['missing_characters']} |")
        lines.append("")
    lines += ["## 交付、修复、失败与身份对齐", "", "| 套件 | 后端 | 模式 | 已交付中的联合正确 / 表达 | 未使用修复交付 / 使用修复交付 | 已交付中的修复调用 / 修复成功窗口 | 身份匹配分布 |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for report in ordered:
        delivered = [a for a in report["attempts"] if a["state"] == "delivered"]
        correct = sum(a["metrics"]["correct_lower"] for a in delivered)
        units = sum(a["metrics"]["units"] for a in delivered)
        repaired = sum(a["usage"]["repair_requests"] > 0 for a in delivered)
        calls = sum(a["usage"]["repair_requests"] for a in delivered)
        windows = sum(a["usage"]["repaired_windows"] for a in delivered)
        align = report["summary"]["overall"]["identity_alignment"]
        lines.append(f"| {report['evaluation_version']} | {report['backend']} | {mode(report)} | {correct} / {units} | {len(delivered)-repaired} / {repaired} | {calls} / {windows} | {', '.join(f'{k}: {v}' for k,v in sorted(align.items()))} |")
    for report in ordered:
        failures = Counter(a.get("error", "unknown") for a in report["attempts"] if a["state"] != "delivered")
        lines += ["", f"### {report['evaluation_version']} / {report['backend']} / {mode(report)}", "",
                  "| 安全错误 | 次数 |", "| --- | --- |"]
        lines += [f"| {key.replace('|','/')} | {count} |" for key, count in sorted(failures.items())]
        if not failures:
            lines.append("| 无 | 0 |")
    lines += ["", "## 用量与延迟", "", "| 套件 | 后端 | 模式 | 已观察请求 | 已观察输入 / 输出 token | 已知用量章节 / 计划 | 全部输入 / 输出 token | 总章节秒 / 平均章节秒 |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for report in ordered:
        g = report["summary"]["overall"]
        lines.append(f"| {report['evaluation_version']} | {report['backend']} | {mode(report)} | {g['observed_requests']} | {g['observed_input_tokens']} / {g['observed_output_tokens']} | {g['input_tokens_known_attempts']} / {g['planned']} | {g['input_tokens']} / {g['output_tokens']} | {g['wall_ms']/1000:.3f} / {g['mean_attempt_wall_ms']/1000:.3f} |")
    lines += ["", "## 执行环境与复核", "", "| 套件 | 后端 | 模式 | 模型 | 平台 / Python | 开始 / 结束（UTC） | 金标冻结摘要 |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for report in ordered:
        env = report["environment"]
        lines.append(f"| {report['evaluation_version']} | {report['backend']} | {mode(report)} | {report['configuration']['model']} | {env['platform']} / {env['python']} | {report['started_at']} / {report['finished_at']} | {report['freeze_sha256']} |")
    lines += ["", "v2 片段基线使用保存的旧二进制与旧源码快照。旧运行器在收尾时因工作目录源码改变而拒绝完成；独立收尾工具逐项验证执行二进制、保存的源码、冻结金标及全部尝试后完成报告，记录 completion_verification。它没有重跑调用或补填未执行项。新版默认模式另用离线服务比对确认请求、Schema、提示词和文档字节一致。", "",
              "同一后端串行，两个后端独立并行；基线期间同时发生编译和实现工作，墙钟延迟受本机负载影响，不能视为纯模型性能基准。本地配置名称 default 是服务别名，observed_configurations 记录客户端有效配置而非权重身份证明。本轮核对容器参数为 mistral.rs 0.9.4、Qwen3-14B Q4_K_M、4096 上下文、单并发、服务种子 42；权重摘要与部署说明见 [本地部署记录](qwen3-14b-local-test.md)。服务日志确认部分失败为 CUDA 显存压力导致 503；本轮未重启、未调整参数。"]
    lines += ["", "None/null 表示全部调用成本未知；已观察 token 和修复次数来自已交付章节，只是下限，失败调用不能按零计。所有失败仍进入交付率、表达与角色分母。章节耗时含修复与失败，不含离线评分。身份匹配使用允许称呼与证据覆盖，同名多解取下界；匹配拒绝不自动等同幻觉。", "",
              "真实小说来源与标注边界见 [语料说明](literary-evaluation.md)，来源校验见 [引文模式](quotation-evidence.md)。经典作品可能已在训练语料中，六例补充组不是泛化留出集。逐次配置、状态矩阵、执行顺序和摘要见 docs/evaluations/quotation-*.json。", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(render([load(path) for path in args.reports]), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
