#!/usr/bin/env python3
"""Author the original public synthetic v1 corpus; never called by run/score.

Regeneration deliberately does not update manifest.json: validate will detect drift.
Answers authored with this corpus have not received independent human review.
"""
from pathlib import Path
import json
from evaluate import text_hash, validate_cases


def make(case_id, split, characters, pieces, errors=()):
    text = ''.join(p[0] for p in pieces)
    gold, segments, pos = [], [], 0
    for n, (fragment, kind, speaker) in enumerate(pieces):
        end = pos + len(fragment.encode('utf-8'))
        gold.append({'id': f'u{n + 1}', 'start': pos, 'end': end, 'kind': kind, 'speakers': [speaker]})
        segments.append({'start': pos, 'end': end, 'kind': kind, 'speaker': speaker,
                         'evidence': [{'start': pos, 'end': end}]})
        pos = end
    issues = []
    for index, kind, speaker in errors:
        unit = gold[index]
        segments[index] = dict(segments[index], kind=kind, speaker=speaker)
        issues.append({'id': f'planted-{index + 1}', 'start': unit['start'], 'end': unit['end'],
                       'kind': unit['kind'], 'speakers': unit['speakers']})
    return {'version': 1, 'caseId': case_id, 'split': split,
            'source': {'text': text, 'sha256': text_hash(text)},
            'characters': [{'id': cid, 'name': name} for cid, name in characters],
            'annotation': {'origin': 'original-synthetic-author-labels-2026-11-08',
                           'reviewStatus': 'author-checked-not-independent-human-review'},
            'gold': gold, 'reviewInput': {'segments': segments}, 'reviewGold': {'issues': issues}}


def corpus():
    return [
        make('dev-explicit', 'development', [('c-lan', '岚')], [
            ('岚放下灯，说：', 'narration', 'narrator'), ('“明早出发。”', 'speech', 'c-lan'),
            ('\n灯芯轻响。', 'narration', 'narrator')], [(1, 'speech', 'unknown')]),
        make('dev-unknown', 'development', [], [
            ('雾里传来一个从未见过的人的声音：', 'narration', 'narrator'),
            ('“请等一等！”', 'speech', 'unknown')], [(1, 'narration', 'narrator')]),
        make('dev-same-name', 'development', [('c-qiao-doctor', '乔宁'), ('c-qiao-pilot', '乔宁')], [
            ('医生乔宁先开口：', 'narration', 'narrator'), ('“我留在诊所。”', 'speech', 'c-qiao-doctor'),
            ('飞行员乔宁答道：', 'narration', 'narrator'), ('“我去机场。”', 'speech', 'c-qiao-pilot')],
             [(3, 'speech', 'c-qiao-doctor')]),
        make('dev-thought', 'development', [('c-mu', '木禾')], [
            ('木禾没有出声，心想：', 'narration', 'narrator'), ('绝不能让门再关上。', 'thought', 'c-mu'),
            ('他伸手挡住门。', 'narration', 'narrator')], [(1, 'speech', 'c-mu')]),
        make('dev-nested-title', 'development', [('c-lan', '岚')], [
            ('岚说：', 'narration', 'narrator'), ('“他们叫我‘小船长’，我可没答应。”', 'speech', 'c-lan'),
            ('她笑了。', 'narration', 'narrator')], [(1, 'narration', 'narrator')]),
        make('dev-quoted-object', 'development', [], [
            ('招牌写着“今日停航”。\n机器亮起“READY”字样，没有发声。', 'narration', 'narrator')]),
        make('dev-unicode-newlines', 'development', [('c-yi', '伊')], [
            ('\ufeff雨停了🙂。\r\n伊说：', 'narration', 'narrator'), ('“Cafe\u0301，见！”', 'speech', 'c-yi'),
            ('\r她收起伞。\n\u3000', 'narration', 'narrator')], [(1, 'speech', 'unknown')]),
        make('holdout-nested-quotation', 'holdout', [('c-qin', '秦遥')], [
            ('秦遥对空房间说：', 'narration', 'narrator'), ('“纸上那句‘请勿靠近’只是提示，‘守门人’也只是称号。”', 'speech', 'c-qin'),
            ('墙上的“出口”二字没有回应。', 'narration', 'narrator')], [(1, 'narration', 'narrator')]),
        make('holdout-identities', 'holdout', [('c-shen-teacher', '沈星'), ('c-shen-student', '沈星')], [
            ('老师沈星心里盘算：', 'narration', 'narrator'), ('先等学生回答。', 'thought', 'c-shen-teacher'),
            ('学生沈星说：', 'narration', 'narrator'), ('“我还没想好。”', 'speech', 'c-shen-student'),
            ('门外陌生人喊：', 'narration', 'narrator'), ('“有人吗？”', 'speech', 'unknown')],
             [(1, 'thought', 'c-shen-student'), (5, 'narration', 'narrator')]),
        make('holdout-unicode-silent', 'holdout', [('c-lei', '蕾')], [
            ('🌒\r\n屏幕显示「音量 0」，没有声音。\r蕾心想：', 'narration', 'narrator'),
            ('e\u0301 和 é 看着相近。', 'thought', 'c-lei'), ('\n\u3000她合上笔记。', 'narration', 'narrator')])
    ]


if __name__ == '__main__':
    cases = validate_cases(corpus())
    destination = Path(__file__).resolve().parents[2] / 'evaluations/chapter-analysis-v1/cases.jsonl'
    destination.write_bytes(b''.join(json.dumps(c, ensure_ascii=False, separators=(',', ':')).encode('utf-8') + b'\n' for c in cases))
    print(f'Wrote {len(cases)} public synthetic cases. Freeze separately with a new dataset version when changed.')
