#!/usr/bin/env python3
"""Frozen chapter evaluation; stdlib only. No model/judge defines the gold."""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET = ROOT / 'evaluations/chapter-analysis-v1'
KINDS = {'narration', 'speech', 'thought'}
TOKENS = ('inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens')
META = ('model', 'configurationHash', 'promptVersion', 'promptHash', 'protocolVersion', 'sourceHash')


class Invalid(ValueError):
    """A safe, content-free validation code."""


def require(condition, code):
    if not condition:
        raise Invalid(code)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def text_hash(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def parse_json(value):
    def unique_pairs(pairs):
        result = {}
        for key, item in pairs:
            require(key not in result, 'duplicate_json_key')
            result[key] = item
        return result

    def reject_constant(_):
        raise Invalid('nonfinite_json_number')

    return json.loads(value, object_pairs_hook=unique_pairs, parse_constant=reject_constant)


def read_json(path):
    return parse_json(Path(path).read_bytes())


def read_jsonl(path):
    # Reading bytes avoids universal-newline normalization inside source snapshots.
    return [parse_json(line) for line in Path(path).read_bytes().splitlines() if line.strip()]


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8') + b'\n')


def identifier(value):
    return isinstance(value, str) and bool(value.strip())


def integer(value):
    return type(value) is int


def boundaries(text):
    result, pos = {0}, 0
    for char in text:
        pos += len(char.encode('utf-8'))
        result.add(pos)
    return result


def check_range(value, valid):
    require(isinstance(value, dict), 'coordinates')
    a, b = value.get('start'), value.get('end')
    require(integer(a) and integer(b) and a < b and a in valid and b in valid, 'coordinates')


def attribution(kind, speakers, known):
    require(kind in KINDS, 'kind')
    require(isinstance(speakers, list) and bool(speakers), 'identity')
    require(all(isinstance(s, str) and s in known | {'narrator', 'unknown'} for s in speakers), 'identity')
    require(len(set(speakers)) == len(speakers), 'identity')
    require((kind == 'narration' and speakers == ['narrator']) or
            (kind != 'narration' and 'narrator' not in speakers), 'attribution')
    require(len(speakers) == 1 or 'unknown' not in speakers, 'identity')


def segment_speakers(segment):
    speaker = segment.get('speaker')
    candidates = segment.get('candidates', [])
    require(isinstance(candidates, list), 'identity')
    if candidates:
        require(speaker == 'unknown' and len(candidates) >= 2, 'identity')
        return candidates
    return [speaker]


def validate_segments(case, segments):
    require(isinstance(segments, list) and bool(segments), 'coverage')
    valid = boundaries(case['source']['text'])
    known = {c['id'] for c in case['characters']}
    cursor = 0
    for segment in segments:
        check_range(segment, valid)
        require(segment['start'] == cursor, 'coverage')
        cursor = segment['end']
        attribution(segment.get('kind'), segment_speakers(segment), known)
        evidence = segment.get('evidence')
        require(isinstance(evidence, list) and bool(evidence), 'evidence')
        for item in evidence:
            try:
                check_range(item, valid)
            except Invalid as exc:
                raise Invalid('evidence') from exc
    require(cursor == len(case['source']['text'].encode('utf-8')), 'coverage')


def validate_cases(cases):
    require(isinstance(cases, list) and bool(cases), 'empty_dataset')
    ids = set()
    for case in cases:
        require(case.get('version') == 1 and identifier(case.get('caseId')), 'case_version_or_id')
        require(case['caseId'] not in ids, 'duplicate_case')
        ids.add(case['caseId'])
        require(case.get('split') in {'development', 'holdout'}, 'split')
        source = case.get('source', {})
        require(isinstance(source.get('text'), str) and bool(source['text']), 'source')
        require(source.get('sha256') == text_hash(source['text']), 'source_hash')
        require(isinstance(case.get('characters'), list), 'characters')
        known = set()
        for character in case['characters']:
            cid = character.get('id')
            require(identifier(cid) and cid not in known | {'narrator', 'unknown'}, 'character_id')
            require(identifier(character.get('name')), 'character_name')
            known.add(cid)
        provenance = case.get('annotation', {})
        require(identifier(provenance.get('origin')) and identifier(provenance.get('reviewStatus')), 'annotation_provenance')
        valid, cursor, unit_ids = boundaries(source['text']), 0, set()
        require(isinstance(case.get('gold'), list) and bool(case['gold']), 'gold')
        for unit in case['gold']:
            check_range(unit, valid)
            require(unit['start'] == cursor, 'gold_coverage')
            cursor = unit['end']
            require(identifier(unit.get('id')) and unit['id'] not in unit_ids, 'unit_id')
            unit_ids.add(unit['id'])
            attribution(unit.get('kind'), unit.get('speakers'), known)
        require(cursor == len(source['text'].encode('utf-8')), 'gold_coverage')
        if 'reviewGold' in case:
            validate_segments(case, case.get('reviewInput', {}).get('segments'))
            expected = case['reviewGold'].get('issues')
            require(isinstance(expected, list), 'review_gold')
            positions = set()
            for issue in expected:
                check_range(issue, valid)
                key = (issue['start'], issue['end'])
                require(key not in positions, 'duplicate_review_gold')
                positions.add(key)
                attribution(issue.get('kind'), issue.get('speakers'), known)
                unit = next((u for u in case['gold'] if (u['start'], u['end']) == key), None)
                require(unit and unit['kind'] == issue['kind'] and set(unit['speakers']) == set(issue['speakers']), 'review_gold_not_gold')
            # Gold must describe exactly the deliberately corrupted fixed units.
            actual = set()
            for unit in case['gold']:
                overlaps = [s for s in case['reviewInput']['segments'] if s['start'] < unit['end'] and s['end'] > unit['start']]
                if any(s['kind'] != unit['kind'] or set(segment_speakers(s)) != set(unit['speakers']) for s in overlaps):
                    actual.add((unit['start'], unit['end']))
            require(actual == positions, 'review_gold_injection_mismatch')
    return cases


def dataset_identity(cases, version):
    return {'version': 1, 'datasetVersion': version, 'caseIds': [c['caseId'] for c in cases],
            'datasetHash': digest(cases),
            'goldHash': digest([{'caseId': c['caseId'], 'gold': c['gold'], 'reviewGold': c.get('reviewGold')} for c in cases])}


def load_dataset(directory=DEFAULT_DATASET, split='all'):
    directory = Path(directory)
    cases = validate_cases(read_jsonl(directory / 'cases.jsonl'))
    manifest = read_json(directory / 'manifest.json')
    expected = dataset_identity(cases, manifest['datasetVersion'])
    require(manifest == expected, 'frozen_dataset_mismatch')
    selected = [c for c in cases if split == 'all' or c['split'] == split]
    require(bool(selected), 'empty_selection')
    identity = dict(manifest, caseIds=[c['caseId'] for c in selected], split=split,
                    selectionHash=digest([c['caseId'] for c in selected]))
    return selected, identity


def adapter_input(case, task='analysis'):
    # Positive allowlist, never copy arbitrary case metadata or gold.
    value = {k: case[k] for k in ('version', 'caseId', 'split', 'source', 'characters')}
    require(task in {'analysis', 'review'}, 'evaluation_task')
    value['evaluationTask'] = task
    if task == 'review' and 'reviewInput' in case:
        value['reviewInput'] = case['reviewInput']
    return value


def timestamp(value):
    require(isinstance(value, str), 'trace_time')
    try:
        result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(result.tzinfo is not None, 'trace_time')
        return result.timestamp() * 1000
    except ValueError as exc:
        raise Invalid('trace_time') from exc


def finite_nonnegative(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def validate_trace(case, result):
    spans = result.get('trace')
    if isinstance(spans, dict):
        spans = spans.get('spans')
    require(isinstance(spans, list) and bool(spans), 'trace_missing')
    ids = set()
    runs = set()
    for span in spans:
        require(all(key in span for key in ('runId', 'spanId', 'parentSpanId', 'stage', 'route', 'attempt', 'status', 'startedAt', 'elapsedMs')), 'trace_fields')
        require(identifier(span['runId']) and identifier(span['spanId']) and identifier(span['stage']), 'trace_fields')
        require(span['spanId'] not in ids, 'trace_duplicate')
        ids.add(span['spanId'])
        runs.add(span['runId'])
        require(span['route'] == result['route'], 'trace_route')
        require(integer(span['attempt']) and span['attempt'] >= 1, 'trace_attempt')
        require(span['status'] in {'completed', 'failed', 'cancelled', 'interrupted', 'timeout'}, 'trace_status')
        require(finite_nonnegative(span['elapsedMs']), 'trace_time')
        timestamp(span['startedAt'])
        require(type(span.get('isRequest', False)) is bool, 'trace_request')
        if is_request(span):
            metadata = span.get('metadata', {})
            require(all(identifier(metadata.get(k)) for k in META), 'request_metadata')
            require(metadata['sourceHash'] == case['source']['sha256'], 'request_source_hash')
            usage = span.get('usage') or {}
            require(isinstance(usage, dict), 'usage')
            for field in TOKENS:
                token = usage.get(field)
                require(token is None or (integer(token) and token >= 0), 'usage')
            if usage.get('inputTokens') is not None and usage.get('cachedInputTokens') is not None:
                require(usage['cachedInputTokens'] <= usage['inputTokens'], 'usage_cache')
    require(len(runs) == 1, 'trace_run')
    by_id = {s['spanId']: s for s in spans}
    for span in spans:
        parent = span['parentSpanId']
        require(parent is None or parent in ids, 'trace_parent')
        seen = {span['spanId']}
        while parent is not None:
            require(parent not in seen, 'trace_cycle')
            seen.add(parent)
            parent = by_id[parent]['parentSpanId']
    return spans


def is_request(span):
    if 'isRequest' in span:
        return span['isRequest']
    return 'model' in span.get('metadata', {})


def review_score(case, result):
    if 'reviewGold' not in case:
        return None
    expected = {(i['start'], i['end']): i for i in case['reviewGold']['issues']}
    review = (result or {}).get('review') or {}
    if not isinstance(review, dict):
        review = {}
    issues = review.get('issues')
    completed = review.get('status') == 'completed' and isinstance(issues, list)
    if not isinstance(issues, list):
        issues = []
    hits, fp, suggestions, invalid = set(), 0, 0, 0
    for issue in issues if completed else []:
        try:
            check_range(issue, boundaries(case['source']['text']))
            key = (issue['start'], issue['end'])
        except (Invalid, TypeError, AttributeError):
            invalid += 1
            fp += 1
            continue
        if key not in expected or key in hits:
            fp += 1
            continue
        hits.add(key)
        suggestion = issue.get('suggestion', {})
        gold = expected[key]
        try:
            speakers = segment_speakers(suggestion)
            attribution(suggestion.get('kind'), speakers, {c['id'] for c in case['characters']})
            suggestions += int(suggestion['kind'] == gold['kind'] and set(speakers) == set(gold['speakers']))
        except (Invalid, TypeError, AttributeError):
            pass
    return {'expected': len(expected), 'detected': len(hits), 'missed': len(expected) - len(hits),
            'falsePositives': fp, 'validSuggestions': suggestions, 'invalidIssueRanges': invalid,
            'completed': int(completed), 'cases': 1}


def case_score(case, result):
    row = {'caseId': case['caseId'], 'split': case['split'], 'valid': False,
           'unitsTotal': len(case['gold']), 'unitsCorrect': 0,
           'bytesTotal': len(case['source']['text'].encode('utf-8')), 'bytesCorrect': 0,
           'review': review_score(case, None)}
    spans = []
    if result is None:
        row['failure'] = 'missing'
        return row, spans
    try:
        require(result.get('version') == 1, 'result_version')
        require(identifier(result.get('route')), 'route')
        spans = [dict(span, evaluationTask=('review' if span['stage'] == 'review' else 'analysis'))
                 for span in validate_trace(case, result)]
        if 'reviewTrace' in result:
            spans = [dict(span, evaluationTask='analysis') for span in spans]
        row['analysisRequestUnknown'] = not any(is_request(s) for s in spans)
        if 'reviewTrace' in result:
            try:
                review_trace = [dict(span, evaluationTask='review') for span in
                                validate_trace(case, dict(result, trace=result['reviewTrace']))]
                spans += review_trace
                row['review'] = review_score(case, result)
                row['reviewRequestUnknown'] = not any(is_request(s) for s in review_trace)
            except (Invalid, TypeError, KeyError, AttributeError):
                row['reviewTraceFailure'] = True
        else:
            row['review'] = review_score(case, result)
        require(result.get('status') in {'completed', 'failed', 'cancelled', 'interrupted'}, 'result_status')
        if result['status'] != 'completed':
            failure = result.get('failureKind')
            row['failure'] = failure if failure in {'timeout', 'parse', 'adapter_exit', 'adapter_start'} else result['status']
            return row, spans
        validate_segments(case, result.get('segments'))
        row['valid'] = True
        for unit in case['gold']:
            correct = 0
            for segment in result['segments']:
                overlap = max(0, min(unit['end'], segment['end']) - max(unit['start'], segment['start']))
                if segment['kind'] == unit['kind'] and set(segment_speakers(segment)) == set(unit['speakers']):
                    correct += overlap
            row['bytesCorrect'] += correct
            row['unitsCorrect'] += int(correct == unit['end'] - unit['start'])
    except (Invalid, TypeError, KeyError, AttributeError) as exc:
        row['failure'] = str(exc) if isinstance(exc, Invalid) else 'parse'
    return row, spans


def summarize(rows):
    result = {k: sum(row[k] for row in rows) for k in ('unitsTotal', 'unitsCorrect', 'bytesTotal', 'bytesCorrect')}
    result.update(cases=len(rows), validCases=sum(row['valid'] for row in rows))
    for name, numerator, denominator in [('deliveryRate', 'validCases', 'cases'), ('unitAccuracy', 'unitsCorrect', 'unitsTotal'), ('byteAccuracy', 'bytesCorrect', 'bytesTotal')]:
        result[name] = result[numerator] / result[denominator] if result[denominator] else None
    failures = {}
    for row in rows:
        if not row['valid']:
            code = row['failure']
            failures[code] = failures.get(code, 0) + 1
    result['failures'] = failures
    reviews = [row['review'] for row in rows if row['review'] is not None]
    result['review'] = {k: sum(r[k] for r in reviews) for k in ('expected', 'detected', 'missed', 'falsePositives', 'validSuggestions', 'invalidIssueRanges', 'completed', 'cases')}
    r = result['review']
    r['precision'] = r['detected'] / (r['detected'] + r['falsePositives']) if r['detected'] + r['falsePositives'] else None
    r['recall'] = r['detected'] / r['expected'] if r['expected'] else None
    return result


def observability(all_spans, rows):
    requests, stages, points, metadata = [], {}, [], []
    case_times = []
    seen_requests = set()
    for case_id, spans in all_spans:
        intervals = []
        for span in spans:
            start, elapsed = timestamp(span['startedAt']), span['elapsedMs']
            intervals.append((start, start + elapsed))
            stages.setdefault(span['stage'], []).append(elapsed)
            if is_request(span):
                key = (span['runId'], span.get('requestId', span['spanId']))
                require(key not in seen_requests, 'duplicate_request')
                seen_requests.add(key)
                requests.append(span)
                if elapsed:
                    points.extend([(start, 1), (start + elapsed, -1)])
                metadata.append({k: span['metadata'][k] for k in META + ('codeRevision', 'codeHash', 'datasetHash') if k in span['metadata']})
        if intervals:
            case_times.append({'caseId': case_id, 'elapsedMs': max(b for a, b in intervals) - min(a for a, b in intervals)})
    active = peak = 0
    for _, delta in sorted(points):
        active += delta
        peak = max(peak, active)
    tokens = {}
    for field in TOKENS:
        values = [(s.get('usage') or {}).get(field) for s in requests]
        tokens[field] = {'knownTotal': sum(v for v in values if v is not None),
                         'knownRequests': sum(v is not None for v in values),
                         'unknownRequests': sum(v is None for v in values)}
    with_request = {cid for cid, spans in all_spans if any(is_request(s) for s in spans)}
    unknown_cases = [r['caseId'] for r in rows if r['caseId'] not in with_request or r.get('analysisRequestUnknown')]
    trace_fields = ('runId', 'spanId', 'parentSpanId', 'stage', 'route', 'attempt', 'status', 'startedAt', 'elapsedMs', 'isRequest', 'requestId', 'evaluationTask')
    traces = []
    for case_id, spans in all_spans:
        sanitized = []
        for span in spans:
            item = {key: span[key] for key in trace_fields if key in span}
            if is_request(span):
                item['metadata'] = {k: span['metadata'][k] for k in META + ('codeRevision', 'codeHash', 'datasetHash') if k in span['metadata']}
                item['usage'] = {k: (span.get('usage') or {}).get(k) for k in TOKENS}
            sanitized.append(item)
        traces.append({'caseId': case_id, 'spans': sanitized})
    return {'traces': traces, 'requestCountKnown': len(requests), 'requestCountComplete': not unknown_cases and not any(r.get('reviewTraceFailure') or r.get('reviewRequestUnknown') for r in rows),
            'requestAccountingUnknownCases': unknown_cases,
            'reviewRequestAccountingUnknownCases': [r['caseId'] for r in rows if r.get('reviewTraceFailure') or r.get('reviewRequestUnknown')],
            'peakConcurrencyObserved': peak if requests else None,
            'usage': tokens, 'usageComplete': not unknown_cases and not any(r.get('reviewTraceFailure') or r.get('reviewRequestUnknown') for r in rows) and all(t['unknownRequests'] == 0 for t in tokens.values()),
            'stages': {k: {'spanCount': len(v), 'sumElapsedMs': sum(v), 'maxElapsedMs': max(v)} for k, v in stages.items()},
            'endToEndByCase': case_times, 'requestMetadata': list({digest(m): m for m in metadata}.values())}



BINDING_METADATA = ('model', 'promptVersion', 'promptHash', 'protocolVersion')


def configuration_bindings(cases, all_spans):
    """Bind observed request identities, independent of fan-out/request counts."""
    traces = dict(all_spans)
    bindings = {}
    for case in cases:
        tasks = ['analysis', 'review'] if 'reviewGold' in case else ['analysis']
        case_bindings = {}
        for task in tasks:
            requests = [s for s in traces.get(case['caseId'], [])
                        if is_request(s) and s['evaluationTask'] == task]
            by_stage = {}
            for span in requests:
                metadata = {k: span['metadata'][k] for k in BINDING_METADATA}
                by_stage.setdefault(span['stage'], {})[digest(metadata)] = metadata
            case_bindings[task] = {
                'configurationHashes': sorted({s['metadata']['configurationHash'] for s in requests}),
                'observed': bool(requests),
                'metadataByStage': {stage: sorted(values.values(), key=canonical)
                                    for stage, values in sorted(by_stage.items())},
            }
        bindings[case['caseId']] = case_bindings
    return bindings



def report_bindings(report):
    if report.get('comparisonBindingVersion') == 1:
        return report['configurationBindings'], 'case-task-v1'
    require('comparisonBindingVersion' not in report, 'incomparable_task_binding_version')
    # Old reports lost the subprocess task label. Only a uniform observed
    # configuration in every case allows safe stage-based reconstruction.
    rows = {row['caseId']: row for row in report.get('cases', [])}
    traces = report.get('observability', {}).get('traces', [])
    by_case = {}
    for trace in traces:
        require(trace['caseId'] not in by_case, 'incomparable_legacy_duplicate_case_trace')
        by_case[trace['caseId']] = trace['spans']
    cases, all_spans = [], []
    for case_id in report['dataset']['caseIds']:
        requests = [s for s in by_case.get(case_id, []) if is_request(s)]
        configs = {s.get('metadata', {}).get('configurationHash') for s in requests}
        require(len(configs) == 1 and all(identifier(c) for c in configs),
                'incomparable_legacy_configuration_evidence')
        require(case_id in rows, 'incomparable_legacy_case_evidence')
        task_case = {'caseId': case_id}
        if rows[case_id].get('review') is not None:
            task_case['reviewGold'] = {}
        annotated = []
        for span in requests:
            metadata = span.get('metadata', {})
            require(all(identifier(metadata.get(k)) for k in META), 'incomparable_legacy_request_metadata')
            require(metadata['sourceHash'] == report.get('sourceHashes', {}).get(case_id),
                    'incomparable_legacy_source_evidence')
            annotated.append(dict(span, evaluationTask='review' if span['stage'] == 'review' else 'analysis'))
        cases.append(task_case)
        all_spans.append((case_id, annotated))
    bindings = configuration_bindings(cases, all_spans)
    require(all(task['observed'] for tasks in bindings.values() for task in tasks.values()),
            'incomparable_legacy_task_evidence')
    return bindings, 'legacy-uniform-case-trace'


def compare_bindings(left, right):
    a, a_source = report_bindings(left)
    b, b_source = report_bindings(right)
    case_ids = left['dataset']['caseIds']
    require(set(a) == set(b) == set(case_ids), 'incomparable_task_binding_cases')
    unknown, differences = [], []
    explicit = (left.get('configurationIdentitySource') == right.get('configurationIdentitySource') == 'explicit')
    for case_id in case_ids:
        require(set(a[case_id]) == set(b[case_id]), 'incomparable_task_binding_tasks')
        for task in sorted(a[case_id]):
            x, y = a[case_id][task], b[case_id][task]
            x_configs, y_configs = x['configurationHashes'], y['configurationHashes']
            require(x['observed'] == bool(x_configs) and y['observed'] == bool(y_configs),
                    'incomparable_task_binding_evidence')
            if x_configs and y_configs:
                require(x_configs == y_configs, 'incomparable_case_task_configuration')
            else:
                # A declaration permits comparison, never invents an observed configuration.
                require(explicit, 'incomparable_case_task_configuration_unknown')
                unknown.append({'caseId': case_id, 'task': task,
                                'leftObserved': bool(x_configs), 'rightObserved': bool(y_configs)})
            x_stages, y_stages = x['metadataByStage'], y['metadataByStage']
            for stage in sorted(set(x_stages) | set(y_stages)):
                changes = {}
                for field in BINDING_METADATA:
                    x_values = sorted({m[field] for m in x_stages.get(stage, [])})
                    y_values = sorted({m[field] for m in y_stages.get(stage, [])})
                    if x_values != y_values:
                        changes[field] = {'left': x_values, 'right': y_values}
                if changes:
                    differences.append({'caseId': case_id, 'task': task, 'stage': stage,
                                        'differences': changes})
    return unknown, differences, {'left': a_source, 'right': b_source}


def _capture_code_identity():
    files = sorted(Path(__file__).parent.glob('*.py'))
    hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    return {'scriptHashes': hashes, 'codeHash': digest(hashes), 'pythonVersion': sys.version.split()[0]}


# Capture before any adapter/model execution or replay file loading. Reports from
# a running process must not claim scripts edited on disk after this point.
_LOADED_PROGRAM_IDENTITY = _capture_code_identity()


def code_identity():
    return parse_json(canonical(_LOADED_PROGRAM_IDENTITY))


def score(cases, identity, results, mode='replay', configuration_identity=None, execution=None):
    require(mode in {'mock', 'replay', 'live'}, 'mode')
    validate_cases(cases)
    require(identity.get('caseIds') == [c['caseId'] for c in cases], 'planned_case_identity')
    by_id, planned = {}, {c['caseId'] for c in cases}
    for result in results:
        require(isinstance(result, dict) and result.get('caseId') in planned, 'unplanned_case')
        if mode == 'live':
            require(result.get('mode') not in {'mock', 'replay'} and result.get('route') != 'controlled-mock', 'mock_or_replay_cannot_be_live')
        cid = result['caseId']
        require(cid not in by_id, 'duplicate_case')
        by_id[cid] = result
    rows, spans = [], []
    for case in cases:
        row, trace = case_score(case, by_id.get(case['caseId']))
        rows.append(row)
        spans.append((case['caseId'], trace))
    obs = observability(spans, rows)
    configs = sorted({m['configurationHash'] for m in obs['requestMetadata']})
    identity_source = 'explicit' if configuration_identity is not None else 'observed'
    if configuration_identity is None:
        configuration_identity = configs or None
    report = {'version': 1, 'mode': mode, 'identityDiscoveryEvaluated': False, 'reviewIsHumanConfirmation': False, 'qualityEvidence': 'live-adapter-reported' if mode == 'live' else 'offline-only',
              'dataset': identity, 'configurationIdentity': configuration_identity,
              'configurationIdentitySource': identity_source, 'comparisonBindingVersion': 1,
              'configurationBindings': configuration_bindings(cases, spans), 'program': code_identity(),
              'sourceHashes': {c['caseId']: c['source']['sha256'] for c in cases},
              'routes': sorted({r['route'] for r in results if identifier(r.get('route'))}),
              'summary': summarize(rows), 'splits': {s: summarize([r for r in rows if r['split'] == s]) for s in ('development', 'holdout')},
              'cases': rows, 'observability': obs, 'execution': execution}
    return report


def compare(left, right):
    for key in ('datasetHash', 'goldHash', 'caseIds', 'selectionHash', 'datasetVersion', 'split'):
        require(left['dataset'].get(key) == right['dataset'].get(key), 'incomparable_dataset_' + key)
    require(left.get('configurationIdentity') is not None and left.get('configurationIdentity') == right.get('configurationIdentity'), 'incomparable_configuration')
    unknown, stage_differences, binding_evidence = compare_bindings(left, right)
    differences = {}
    if stage_differences:
        differences['caseStageMetadata'] = stage_differences
    for key in ('routes', 'mode', 'program'):
        if left.get(key) != right.get(key):
            differences[key] = {'left': left.get(key), 'right': right.get(key)}
    for key in ('model', 'promptVersion', 'promptHash', 'protocolVersion', 'configurationHash'):
        a = sorted({m[key] for m in left['observability']['requestMetadata']})
        b = sorted({m[key] for m in right['observability']['requestMetadata']})
        if a != b:
            differences[key] = {'left': a, 'right': b}
    return {'version': 1, 'comparable': True, 'differences': differences,
            'configurationEvidenceComplete': not unknown, 'configurationUnknownBindings': unknown,
            'configurationBindingEvidence': binding_evidence,
            'qualityComparisonIsLive': left['mode'] == right['mode'] == 'live',
            'delta': {k: right['summary'][k] - left['summary'][k] for k in ('deliveryRate', 'unitAccuracy', 'byteAccuracy')}}


def run_adapter(cases, argv, timeout=600, workers=1):
    require(isinstance(argv, list) and bool(argv) and all(isinstance(a, str) for a in argv), 'adapter_argv')
    require(finite_nonnegative(timeout) and timeout > 0 and integer(workers) and workers >= 1, 'runner_options')
    run_id = str(uuid.uuid4())
    adapter_hashes = {}
    for n, arg in enumerate(argv):
        try:
            if Path(arg).is_file():
                adapter_hashes[str(n)] = hashlib.sha256(Path(arg).read_bytes()).hexdigest()
        except OSError:
            pass

    def invoke_task(case, task):
        started_at = dt.datetime.now(dt.timezone.utc).isoformat()
        begin = time.monotonic()
        reason = None
        try:
            # No shell. Stderr is private and deliberately never persisted or printed.
            completed = subprocess.run(argv, input=canonical(adapter_input(case, task)) + b'\n', stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, timeout=timeout, check=False)
            if completed.returncode:
                reason = 'adapter_exit'
            else:
                try:
                    lines = [parse_json(line) for line in completed.stdout.splitlines() if line.strip()]
                    require(len(lines) == 1 and lines[0].get('caseId') == case['caseId'], 'adapter_output')
                    result = lines[0]
                except (Invalid, ValueError, AttributeError, TypeError):
                    reason = 'parse'
        except subprocess.TimeoutExpired:
            reason = 'timeout'
        except OSError:
            reason = 'adapter_start'
        elapsed = (time.monotonic() - begin) * 1000
        if reason:
            result = {'version': 1, 'caseId': case['caseId'], 'route': 'adapter-unavailable', 'status': 'failed',
                      'failureKind': reason, 'segments': [], 'review': {'status': 'failed', 'issues': []},
                      'trace': [{'runId': run_id, 'spanId': case['caseId'] + '-' + task, 'parentSpanId': None,
                                 'stage': 'adapter', 'route': 'adapter-unavailable', 'attempt': 1,
                                 'status': 'timeout' if reason == 'timeout' else 'failed',
                                 'startedAt': started_at, 'elapsedMs': elapsed}]}
        return result, {'caseId': case['caseId'], 'task': task, 'elapsedMs': elapsed, 'failureKind': reason}
    def invoke(case):
        result, analysis_execution = invoke_task(case, 'analysis')
        # Do not trust analysis-run review fields for the independently seeded task.
        result['review'] = {'status': 'not_requested', 'issues': []}
        executions = [analysis_execution]
        if 'reviewGold' in case:
            review_result, review_execution = invoke_task(case, 'review')
            executions.append(review_execution)
            result['review'] = (review_result.get('review', {'status': 'failed', 'issues': []})
                                if review_result.get('version') == 1 and review_result.get('status') == 'completed'
                                else {'status': 'failed', 'issues': []})
            review_trace = review_result.get('trace', [])
            # Keep task traces separate: independent processes may have different runIds.
            result['reviewTrace'] = review_trace
        return result, executions

    start = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        pairs = list(pool.map(invoke, cases))
    return [p[0] for p in pairs], {'runId': run_id, 'elapsedMs': (time.monotonic() - start) * 1000,
                                 'inputIsolation': 'separate-analysis-and-seeded-review-processes',
                                 'workerLimit': workers, 'adapterArgvHash': digest(argv), 'adapterFileHashesByArgIndex': adapter_hashes, 'cases': [item for p in pairs for item in p[1]]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('validate', 'freeze', 'score', 'run'):
        p = sub.add_parser(name)
        p.add_argument('--dataset', type=Path, default=DEFAULT_DATASET)
        if name in ('score', 'run'):
            p.add_argument('--split', choices=['all', 'development', 'holdout'], default='all')
            p.add_argument('--mode', choices=['mock', 'replay', 'live'], default='replay' if name == 'score' else None, required=name == 'run')
            p.add_argument('--configuration-identity', help='Stable explicit identity when requests are unavailable')
            p.add_argument('--output', type=Path, required=True)
        if name == 'freeze':
            p.add_argument('--dataset-version', required=True)
        if name == 'score':
            p.add_argument('--results', type=Path, required=True)
        if name == 'run':
            p.add_argument('--timeout', type=float, default=600)
            p.add_argument('--workers', type=int, default=1)
            p.add_argument('--results-output', type=Path, help='Explicit opt-in adapter JSONL for offline rescoring')
            p.add_argument('--adapter', nargs=argparse.REMAINDER, required=True)
    p = sub.add_parser('compare')
    p.add_argument('left', type=Path)
    p.add_argument('right', type=Path)
    p.add_argument('--output', type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == 'freeze':
            cases = validate_cases(read_jsonl(args.dataset / 'cases.jsonl'))
            path = args.dataset / 'manifest.json'
            identity = dataset_identity(cases, args.dataset_version)
            if path.exists():
                old = read_json(path)
                require(old == identity or old['datasetVersion'] != args.dataset_version, 'changed_gold_requires_new_dataset_version')
            write_json(path, identity)
            report = identity
        elif args.command == 'compare':
            report = compare(read_json(args.left), read_json(args.right))
            if args.output:
                write_json(args.output, report)
        else:
            cases, identity = load_dataset(args.dataset, getattr(args, 'split', 'all'))
            if args.command == 'validate':
                report = identity
            else:
                execution = None
                if args.command == 'run':
                    if args.results_output:
                        require(args.results_output.resolve() != args.output.resolve(), 'results_and_report_paths_must_differ')
                    results, execution = run_adapter(cases, args.adapter, args.timeout, args.workers)
                    if args.results_output:
                        raw = b''.join(canonical(result) + b'\n' for result in results)
                        args.results_output.parent.mkdir(parents=True, exist_ok=True)
                        args.results_output.write_bytes(raw)
                        execution['resultsHash'] = hashlib.sha256(raw).hexdigest()
                else:
                    results = read_jsonl(args.results)
                    execution = {'resultsHash': hashlib.sha256(args.results.read_bytes()).hexdigest()}
                report = score(cases, identity, results, args.mode, args.configuration_identity, execution)
                write_json(args.output, report)
        print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (Invalid, ValueError, KeyError, TypeError, OSError) as exc:
        code = str(exc) if isinstance(exc, Invalid) else type(exc).__name__
        print(json.dumps({'error': code}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
