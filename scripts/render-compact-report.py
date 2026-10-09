"""Render this fixed development/supplemental experiment after all runs finish."""
from collections import Counter
from pathlib import Path
from evaluation.suite import load

ROOT=Path(__file__).resolve().parent.parent

def percent(value):return '—' if value is None else f'{value*100:.1f}%'
def render():
    rows=[];count=0
    for backend in ['local','minimax','glm']:
        for group in ['development','literary']:
            for mode in ['segment-ids','verified-quotes']:
                new=load(ROOT/f'docs/evaluations/compact-{backend}-{group}-{mode}.json')
                expected=20 if group=='development' else 6
                if (not new.get('finished_at') or new['actual_order']!=list(range(expected))
                    or new['summary']['overall']['planned']!=expected
                    or new['summary']['overall']['states'].get('not_attempted',0)):
                    raise ValueError('comparison_not_complete')
                if (new['split']!=('development' if group=='development' else 'all')
                    or new['repeats']!=1 or new['evidence_mode']!=mode
                    or new['prompt_version']!=(7 if mode=='segment-ids' else 8)):
                    raise ValueError('unexpected_run_condition')
                filename=(f'quotation-v2-{backend}-'+('baseline' if mode=='segment-ids' else 'quotes')+'.json') if group=='development' else f'quotation-literary-{backend}-{mode}.json'
                if backend=='glm':
                    filename=f'compact-glm-legacy-{group}-{mode}.json'
                old=load(ROOT/'docs/evaluations'/filename)
                if backend=='glm' and (not old.get('finished_at') or old['actual_order']!=list(range(expected)) or not old.get('protocol_reference') or old['summary']['overall']['planned']!=expected or old['evidence_mode']!=mode or old['prompt_version']!=(5 if mode=='segment-ids' else 6)):
                    raise ValueError('historical_glm_not_complete')
                if old['freeze_sha256']!=new['freeze_sha256'] or old['limits']!=new['limits']:
                    raise ValueError('comparison_conditions_changed')
                baseline=old['summary']['split']['development'] if group=='development' and backend!='glm' else old['summary']['overall']
                rows.append((backend,group,mode,old,baseline,new,new['summary']['overall']))
                count+=expected * (2 if backend=='glm' else 1)
    if count!=208:
        raise ValueError('unexpected_comparison_count')
    lines=['# 短引用协议开发集与小说对照','',
       '本轮共 208 次：Qwen 和 MiniMax 各 52 次新协议；GLM 旧、新协议各 52 次。每套均为两证据模式 ×（20 个开发场景 + 六个小说片段），每例一次。留出集未执行、金标未调整。Qwen/MiniMax 历史开发集每例两次，历史小说每例一次；GLM 对照双方均为本轮每例一次；按各自完整计划计算指标，重复次数、执行顺序和环境差异限制因果解释。本轮没有证明留出泛化。GLM 新默认开发组存在一个同名场景的身份匹配多解：严格正确下界 24/26，上界 26/26，不把这两句直接计作已确认语义错误。','',
       '默认版本从 5 到 7，引文从 6 到 8。变化为请求内短引用及相应说明，Schema 字段、最终格式和接受条件保持；同一后端串行，后端独立并行。窗口 1000 字符/8 片段，每章 8 请求，每窗一次修复，请求/章节 120/600 秒，本地/线上输出 2048/8192 token，无网络重试或自动回退。','',
       '| 后端 | 分组 | 证据模式 | 版本 | 交付/计划 | 联合正确下界–上界/表达 | 联合准确率 | 类型字节正确率 | 角色精确率/召回率 | 额外/遗漏 |','| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    for backend,group,mode,old,baseline,new,current in rows:
        for version,g in [(old['prompt_version'],baseline),(new['prompt_version'],current)]:
            lines.append(f"| {backend} | {group} | {mode} | {version} | {g['states'].get('delivered',0)}/{g['planned']} | {g['correct_lower']}–{g['correct_upper']}/{g['units']} | {percent(g['joint_accuracy_lower'])} | {percent(g['expression_type_byte_accuracy'])} | {percent(g['character_precision'])}/{percent(g['character_recall'])} | {g['extra_characters']}/{g['missing_characters']} |")
    lines+=['','## 用量与延迟','',
      '| 后端 | 分组 | 模式 | 版本 | 已观察请求 | 已观察输入/输出 token | 输入/输出已知章节 | 全部输入/输出 | 平均章节秒 |','| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    for backend,group,mode,old,baseline,new,current in rows:
        for version,g in [(old['prompt_version'],baseline),(new['prompt_version'],current)]:
            lines.append(f"| {backend} | {group} | {mode} | {version} | {g['observed_requests']} | {g['observed_input_tokens']}/{g['observed_output_tokens']} | {g['input_tokens_known_attempts']}/{g['output_tokens_known_attempts']} | {g['input_tokens']}/{g['output_tokens']} | {g['mean_attempt_wall_ms']/1000:.3f} |")
    lines+=['','None/null 表示成本未知，已观察用量只是已交付章节的下限；失败成本不能按零计，历史开发组总量对应四十次，本轮二十次（GLM 两方均二十次），不能直接用总量比值宣称节省百分比。平均耗时包含失败与修复，受本机负载及服务影响。','', '## 本轮失败、修复与身份对齐','']
    for backend,group,mode,old,baseline,new,g in rows:
        delivered=[a for a in new['attempts'] if a['state']=='delivered']
        failures=Counter(a.get('error','unknown') for a in new['attempts'] if a['state']!='delivered')
        lines += [f'### {backend} / {group} / {mode}','',f"身份对齐：{g['identity_alignment']}。已交付章节修复调用 {sum(a['usage']['repair_requests'] for a in delivered)}、修复成功窗口 {sum(a['usage']['repaired_windows'] for a in delivered)}。失败与未对齐均保留，不只评分成功例。",'', '| 安全错误 | 次数 |','| --- | --- |']
        lines += [f"| {message.replace('|','/')} | {n} |" for message,n in sorted(failures.items())] or ['| 无 | 0 |']
    lines += ['', '## 结论与后续','',
        '短引用已通过还原与兼容验证，但真实收益依后端而异。GLM 默认小说组从 5/6 交付、8/12 联合正确，变为 6/6、12/12，平均章节耗时 19.66→8.16 秒；开发默认严格正确范围为 24–26/26，引文为 26/26，两者全部交付。开发完整输出用量分别 8463→2688、11941→3739 token，约减少 68.2% 和 68.7%；这不代表失败章节成本为零。','',
        'GLM 引文小说交付反而 6/6→5/6，联合正确 11/12→10/12。MiniMax 默认小说交付 5/6→6/6，联合正确 8/12→7/12，引文 1/6→0/6。Qwen 默认小说 1/6→0/6，引文结果见上表；它仍受截断、服务和引用错误影响。本轮不能宣称短引用或引文保证提高归属准确率。','',
        '保留隔离在 core 的短引用传输，继续默认片段证据模式，引文显式启用。后续可进入跨章身份与人工修正的确定性最小闭环；本地输出预算及窗口配置校准另行实验，不引入通用 Agent，不因本轮结果修改冻结答案或扩大预算。小说金标仍待独立人工复核。','']
    lines += ['', '## 复核与边界','',
        '离线服务比对新旧程序，默认及引文 Schema 与最终三个文档逐字节一致；示例 user JSON 从 278 字节到 129 字节，仅说明该输入的协议压缩。自定义模型须回传请求提供的 ID，映射及完整验证见 [实现说明](compact-window-references.md)。字符、片段和引文均恢复正式引用后校验，当前模式仍不提供语义证明。','',
        '本地仍为原 mistral.rs 0.9.4 / Qwen3-14B Q4_K_M / 4096 上下文 / 单并发，未重启或调整部署；MiniMax 为国内 MiniMax-M2.5；GLM 使用既有国内 Coding Plan GLM-5.3-Flash，low/json；实际配置见 observed_configurations。评测预览曾错误显示缺省普通接口，已依据 CLI 实际运行统计修正，未调整请求或结果。GLM 旧协议绑定上一轮固定二进制及其匹配历史报告中的源码摘要，明确记录 protocol_reference，不将当前源码误记为旧程序源码。冻结摘要、二进制及源码摘要、真实配置、时间、执行顺序和逐次指标保存在 docs/evaluations/compact-*.json。完整产物保存在忽略目录 runs/compact-protocol。小说金标尚未经用户独立复核，只有同一作者三篇作品的六个短片段，结果不能概括为长篇小说质量。','']
    return '\n'.join(lines)
if __name__=='__main__':
    (ROOT/'docs/compact-protocol-evaluation.md').write_text(render(),encoding='utf-8',newline='\n')
