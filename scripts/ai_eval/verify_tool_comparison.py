#!/usr/bin/env python3
"""Offline, fail-closed Plan C comparison gate; never executes adapters or models.

CLI: --run-dir RUN --dataset DATASET --config NATIVE_CONFIG --evaluator EVALUATE_PY
     --binary BINARY [--driver DRIVER] [--output VERIFIED_JSON]

Gold annotations are never consulted. Dataset manifest and positive-allowlisted
source snapshots bind coverage. Original plans, reports and results stay intact.
Input hashes bind only the declaration that actually survived in the raw result;
independent seeded-review input identity must be retained as reviewExperimentIdentity
or request metadata.inputHash. Missing evidence is unknown, never an inferred match.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sys

ROUTES = ('classic', 'ecs')
HASH_FIELDS = ('inputHash', 'promptHash', 'toolsHash', 'configurationHash')
META_FIELDS = ('model', 'promptVersion', 'protocolVersion', 'codeRevision',
               'promptHash', 'toolsHash', 'configurationHash', 'offeredToolsHash',
               'offeredToolCount', 'actualSystemHash', 'sourceHash')
DATA_FIELDS = ('version', 'datasetVersion', 'caseIds', 'datasetHash', 'goldHash',
               'split', 'selectionHash')
TOKEN_FIELDS = ('inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens')
STAGES = (('analysis', 'analysis'), ('analysis', 'review'), ('review', 'review'))
OBSERVED_FIELDS = ('inputHash', 'adapterInputHash', 'configurationSnapshotHash', 'evaluationTask')
C2_FILES = {'binary', 'nativeConfig', 'nativeHelper', 'driver', 'adapter',
            'connectionConfig', 'evaluator', 'manifest', 'cases'}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate_json_key')
            result[key] = value
        return result
    return json.loads(Path(path).read_bytes(), object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite_json')))


def read_jsonl(path):
    # Reuse the strict parser without writing temporary files.
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate_json_key')
            result[key] = value
        return result
    return [json.loads(line, object_pairs_hook=pairs,
                       parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite_json')))
            for line in Path(path).read_bytes().splitlines() if line.strip()]


def is_hash(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)


def present(value):
    return isinstance(value, str) and bool(value.strip())


class Gate:
    def __init__(self):
        self.issues = []

    def add(self, code, *, state='mismatch', **context):
        self.issues.append(dict(code=code, state=state, **context))

    def equal(self, left, right, code, **context):
        if left is None or right is None:
            self.add(code, state='unknown', **context)
        elif left != right:
            self.add(code, **context)


def source_index(dataset, plan, gate):
    manifest = read_json(dataset / 'manifest.json')
    for field in ('version', 'datasetVersion', 'datasetHash', 'goldHash'):
        gate.equal(plan['dataset'].get(field), manifest.get(field), 'manifest_identity', field=field)
    # Read no gold/reviewGold fields; use only public identity/source snapshots.
    sources = {}
    selected = []
    for record in read_jsonl(dataset / 'cases.jsonl'):
        if plan['dataset'].get('split') not in ('all', record.get('split')):
            continue
        cid, source = record['caseId'], record['source']
        if cid in sources:
            gate.add('duplicate_dataset_case', caseId=cid)
        actual = hashlib.sha256(source['text'].encode('utf-8')).hexdigest()
        gate.equal(source.get('sha256'), actual, 'dataset_source_hash', caseId=cid)
        sources[cid] = actual
        selected.append(cid)
    gate.equal(plan['dataset'].get('caseIds'), selected, 'planned_case_selection')
    gate.equal(plan['dataset'].get('selectionHash'), digest(selected), 'selection_hash')
    if not selected:
        gate.add('empty_case_selection', state='unknown')
    return sources


def terminal_attestation(run, plan, reports, paths, gate):
    attestation = read_json(run / 'configuration-attestation.json')
    plan_ns = (run / 'plan.json').stat().st_mtime_ns
    captured = datetime.fromisoformat(attestation['capturedAt'].replace('Z', '+00:00'))
    if captured.tzinfo is None:
        gate.add('attestation_capture_timezone', state='unknown')
        captured_ns = None
    else:
        captured_ns = int(captured.timestamp() * 1_000_000_000)
    evidence = {'capturedAt': attestation['capturedAt'],
                'captureTiming': 'after-start' if captured_ns and captured_ns >= plan_ns else 'before-plan',
                'initialContentHashProven': False,
                'limitation': 'Hashes were captured after startup. Old mtimes and per-request Binding verification do not prove initial content hashes.',
                'files': {}}
    for label, path in paths.items():
        if label == 'evaluator':
            continue
        gate.equal(plan.get('frozen', {}).get(label), file_hash(path), 'frozen_file_changed', file=label)
    cfg = read_json(paths['nativeConfig'])
    extras = {'connectionConfig': Path(cfg['configPath']), 'evaluator': paths['evaluator']}
    # evaluator is supplemental, not one of the driver's original frozen files.
    for label, path in extras.items():
        saved = attestation.get('files', {}).get(label, {})
        stat = path.stat()
        actual_hash = file_hash(path)
        gate.equal(saved.get('sha256'), actual_hash, 'attested_file_hash_changed', file=label)
        gate.equal(saved.get('mtimeNs'), stat.st_mtime_ns, 'attested_file_mtime_changed', file=label)
        if stat.st_mtime_ns > plan_ns or saved.get('modifiedBeforePlan') is not True:
            gate.add('attested_file_not_predating_plan', file=label)
        if captured_ns is not None and captured_ns < stat.st_mtime_ns:
            gate.add('attestation_before_file_mtime', file=label)
        evidence['files'][label] = {'sha256': actual_hash, 'mtimeNs': stat.st_mtime_ns,
                                    'unchangedSinceSupplementalCapture': saved.get('sha256') == actual_hash and saved.get('mtimeNs') == stat.st_mtime_ns}
    for route, report in reports.items():
        saved = attestation.get('files', {}).get('evaluator', {}).get('sha256')
        gate.equal(report.get('program', {}).get('scriptHashes', {}).get('evaluate.py'),
                   saved, 'report_evaluator_identity', route=route)
    return evidence


def terminal_freeze(run, dataset, plan, reports, paths, gate):
    """C2 binds every file to its pre-run plan; C1 retains supplemental limits."""
    paths = dict(paths)
    cfg = read_json(paths['nativeConfig'])
    paths.setdefault('connectionConfig', Path(cfg['configPath']))
    paths.setdefault('adapter', Path(__file__).with_name('tool_agent_adapter.py'))
    paths.setdefault('manifest', dataset / 'manifest.json')
    paths.setdefault('cases', dataset / 'cases.jsonl')
    paths.setdefault('verifier', Path(__file__))
    paths.setdefault('verifierTests', Path(__file__).with_name('test_verify_tool_comparison.py'))
    frozen = plan.get('frozen', {})
    # Any new key indicates the C2 contract; partial C2 freezes cannot fall back.
    c2 = bool(set(frozen) & {'adapter', 'connectionConfig', 'evaluator', 'manifest', 'cases', 'verifier'})
    if not c2:
        legacy = {k: paths[k] for k in ('binary', 'nativeConfig', 'nativeHelper', 'driver', 'evaluator')}
        return terminal_attestation(run, plan, reports, legacy, gate), False
    for key in C2_FILES - set(frozen):
        gate.add('missing_pre_run_frozen_file', state='unknown', file=key)
    files = {}
    plan_ns = (run / 'plan.json').stat().st_mtime_ns
    for key, expected in frozen.items():
        path = paths.get(key)
        if path is None:
            gate.add('unresolved_frozen_file', state='unknown', file=key)
            continue
        actual = file_hash(path)
        gate.equal(expected, actual, 'frozen_file_changed', file=key)
        stat = path.stat()
        if stat.st_mtime_ns > plan_ns:
            gate.add('frozen_file_modified_after_plan', file=key)
        files[key] = {'sha256': actual, 'mtimeNs': stat.st_mtime_ns,
                      'matchesPreRunPlan': actual == expected}
    for route, report in reports.items():
        gate.equal(report.get('program', {}).get('scriptHashes', {}).get('evaluate.py'),
                   frozen.get('evaluator'), 'report_evaluator_identity', route=route)
    return {'captureTiming': 'pre-run-plan', 'initialContentHashProven': None,
            'hashesRecordedInPreRunPlan': True,
            'limitation': 'Terminal hashes match the pre-run plan; this is not continuous filesystem monitoring. C2 repeats the unchanged dataset after logging/gate fixes, not a fresh blind holdout.',
            'files': files}, True


def expected_adapter_inputs(dataset, plan):
    """Validate observations against public whitelist bytes, never infer inputHash."""
    expected = {}
    for record in read_jsonl(dataset / 'cases.jsonl'):
        if record.get('caseId') not in plan['dataset']['caseIds']:
            continue
        base = {k: record[k] for k in ('version', 'caseId', 'split', 'source', 'characters')}
        expected[record['caseId']] = {}
        for task in ('analysis', 'review'):
            wire = dict(base, evaluationTask=task)
            if task == 'review' and 'reviewInput' in record:
                wire['reviewInput'] = record['reviewInput']
            expected[record['caseId']][task] = digest(wire)
    return expected


def effective_configuration(config_path, budgets):
    """Recompute the frozen Rust Binding's public configuration identity."""
    config = read_json(config_path)
    document = read_json(config['configPath'])
    selection = config['selection']
    connection = next(c['connection'] for c in document['connections']
                      if c['connection']['id'] == selection['connectionId'])
    model = next(m for m in connection['models'] if m['id'] == selection['modelId'])
    native = digest({'configuration': {'selection': selection, 'revision': connection['revision']},
                     'capacity': [model.get('contextWindow'), model.get('maxOutputTokens')],
                     'model': model['modelId'], 'reasoning': 'low'})
    return digest({'nativeConfiguration': native, 'budgets': budgets, 'identityScope': 'known-only'})


def inspect_task(cid, route, task, spans, expected_source, declaration, gate,
                 observation=None, allow_missing_generated_review=False):
    groups = {}
    seen = set()
    requests = []
    tool_checks = []
    for span in spans:
        if not isinstance(span, dict):
            gate.add('invalid_span', caseId=cid, route=route, evaluationTask=task)
            continue
        if span.get('route') != route:
            gate.add('trace_route', caseId=cid, route=route, evaluationTask=task)
        if span.get('stage') == 'tool' and span.get('toolName') in ('check_draft', 'finish_analysis') and span.get('status') == 'failed':
            tool_checks.append(span)
        if span.get('isRequest') is not True:
            continue
        requests.append(span)
        stage = span.get('stage')
        context = dict(caseId=cid, route=route, evaluationTask=task, stage=stage)
        if (task, stage) not in STAGES:
            gate.add('unexpected_request_stage', **context)
        key = (span.get('runId'), span.get('requestId', span.get('spanId')))
        if not all(present(v) for v in key) or key in seen:
            gate.add('request_identity', **context)
        seen.add(key)
        m = span.get('metadata') or {}
        for field in META_FIELDS:
            value = m.get(field)
            valid = type(value) is int and value == 5 if field == 'offeredToolCount' else (is_hash(value) if field.endswith('Hash') else present(value) and value != 'unknown')
            if not valid:
                gate.add('request_metadata', state='unknown' if value is None or value == 'unknown' else 'mismatch', field=field, **context)
        for field in ('promptHash', 'toolsHash', 'configurationHash'):
            gate.equal(m.get(field), declaration.get(field), 'request_declaration', field=field, **context)
        gate.equal(m.get('actualSystemHash'), declaration.get('promptHash'), 'actual_system_not_declared_prompt', **context)
        gate.equal(m.get('sourceHash'), expected_source, 'request_source_hash', **context)
        if observation is not None:
            for field in OBSERVED_FIELDS:
                value = m.get(field)
                if not (present(value) if field == 'evaluationTask' else is_hash(value)):
                    gate.add('observed_task_metadata_missing', state='unknown', field=field, **context)
            gate.equal(m.get('evaluationTask'), task, 'observed_task_label', **context)
            gate.equal(m.get('adapterInputHash'), observation.get('adapterInputHash'), 'observed_adapter_input', **context)
            gate.equal(m.get('configurationSnapshotHash'), observation.get('configurationSnapshotHash'), 'observed_configuration_snapshot', **context)
            if observation.get('characterContextHash') is not None:
                gate.equal(m.get('characterContextHash'),observation['characterContextHash'],'character_context_fidelity',**context)
            if task == 'analysis':
                gate.equal(m.get('inputHash'), declaration.get('inputHash'), 'observed_native_input_declaration', **context)
        elapsed = span.get('elapsedMs')
        if type(elapsed) not in (int, float) or not math.isfinite(elapsed) or elapsed < 0:
            gate.add('request_elapsed_unknown', state='unknown', **context)
        groups.setdefault(stage, []).append(m)
    stage_evidence = {}
    for expected_task, stage in STAGES:
        if task != expected_task:
            continue
        values = groups.get(stage, [])
        context = dict(caseId=cid, route=route, evaluationTask=task, stage=stage)
        if not values:
            if not (task == 'analysis' and stage == 'review' and allow_missing_generated_review):
                gate.add('stage_not_observed', state='unknown', **context)
            stage_evidence[stage] = {'state': 'not-observed', 'requestCount': 0}
            continue
        fields = META_FIELDS + (OBSERVED_FIELDS if observation is not None else ())
        signature = {field: values[0].get(field) for field in fields}
        for m in values[1:]:
            for field in fields:
                gate.equal(m.get(field), signature[field], 'within_stage_identity_changed', field=field, **context)
        stage_evidence[stage] = {'state': 'observed', 'requestCount': len(values), 'identity': signature}
    usage = {}
    for field in TOKEN_FIELDS:
        values = [(s.get('usage') or {}).get(field) for s in requests]
        valid = [v for v in values if type(v) is int and v >= 0]
        usage[field] = {'knownTotal': sum(valid), 'knownRequests': len(valid), 'unknownRequests': len(values) - len(valid)}
    return stage_evidence, {'requestCount': len(requests), 'usage': usage,
                            'failedValidationToolSpans': len(tool_checks)}


def verify(run, dataset, paths):
    gate = Gate()
    plan = read_json(run / 'plan.json')
    sources = source_index(dataset, plan, gate)
    case_ids = plan['dataset']['caseIds']
    if len(set(case_ids)) != len(case_ids):
        gate.add('duplicate_planned_case')
    if not isinstance(plan.get('budgets'), dict) or not plan['budgets']:
        gate.add('missing_common_budgets', state='unknown')
    reports, rows = {}, {}
    for route in ROUTES:
        reports[route] = read_json(run / f'{route}-report.json')
        raw = read_jsonl(run / f'{route}-results.jsonl')
        ids = [r.get('caseId') for r in raw]
        if ids != case_ids:
            gate.add('result_case_coverage', route=route)
        rows[route] = {r.get('caseId'): r for r in raw}
        report = reports[route]
        for field in DATA_FIELDS:
            gate.equal(report.get('dataset', {}).get(field), plan['dataset'].get(field), 'report_dataset_identity', route=route, field=field)
        gate.equal(report.get('sourceHashes'), sources, 'report_source_hashes', route=route)
        gate.equal(report.get('execution', {}).get('frozenFiles'), plan.get('frozen'), 'report_frozen_files', route=route)
        report_ids = [r.get('caseId') for r in report.get('cases', [])]
        gate.equal(report_ids, case_ids, 'report_case_coverage', route=route)
        gate.equal(report.get('mode'), plan.get('mode'), 'report_mode', route=route)
    attestation, c2 = terminal_freeze(run, dataset, plan, reports, paths, gate)
    adapter_inputs = expected_adapter_inputs(dataset, plan) if c2 else {}
    expected_configuration = effective_configuration(paths['nativeConfig'], plan['budgets'])
    character_hashes={case['caseId']:digest([{k:v for k,v in c.items() if v is not None} for c in case['characters']]) for case in read_jsonl(dataset/'cases.jsonl')}
    evidence, costs = {}, {}
    stage_execution_differences = []
    common_request_identity = None
    for cid in case_ids:
        evidence[cid], costs[cid] = {}, {}
        declarations = {}
        for route in ROUTES:
            row = rows[route].get(cid)
            if row is None:
                gate.add('missing_result', state='unknown', route=route, caseId=cid)
                continue
            if row.get('route') != route:
                gate.add('result_route', route=route, caseId=cid)
            gate.equal(row.get('mode'), plan.get('mode'), 'result_mode', route=route, caseId=cid)
            declaration = row.get('experimentIdentity') or {}
            declarations[route] = declaration
            for field in HASH_FIELDS:
                if not is_hash(declaration.get(field)):
                    gate.add('declaration_hash', state='unknown', caseId=cid, route=route, field=field)
            gate.equal(declaration.get('budgets'), plan.get('budgets'), 'common_budgets', route=route, caseId=cid)
            gate.equal(declaration.get('configurationHash'), expected_configuration, 'effective_configuration', route=route, caseId=cid)
            if plan.get('characterContextRequired') is True:
                gate.equal(declaration.get('characterContextHash'),character_hashes[cid],'declared_character_context',route=route,caseId=cid)
            if declaration.get('humanConfirmed') is not False or declaration.get('identityDiscoveryEvaluated') is not False:
                gate.add('identity_scope', route=route, caseId=cid)
            evidence[cid][route], costs[cid][route] = {}, {}
            for task, key in (('analysis', 'trace'), ('review', 'reviewTrace')):
                observation = {'adapterInputHash': adapter_inputs.get(cid, {}).get(task),
                               'configurationSnapshotHash': plan['frozen'].get('connectionConfig'), 'characterContextHash':character_hashes[cid] if plan.get('characterContextRequired') is True else None} if c2 else None
                stages, cost = inspect_task(cid, route, task, row.get(key, []), sources.get(cid), declaration, gate,
                                            observation=observation,
                                            allow_missing_generated_review=row.get('status') in ('failed', 'cancelled', 'interrupted'))
                evidence[cid][route][task] = stages
                costs[cid][route][task] = cost
                for stage, observed in stages.items():
                    if observed['state'] != 'observed':
                        continue
                    common = {k: value for k, value in observed['identity'].items()
                              if k not in ('sourceHash', 'inputHash', 'adapterInputHash', 'evaluationTask')}
                    if common_request_identity is None:
                        common_request_identity = common
                    else:
                        for field in common:
                            gate.equal(common[field], common_request_identity[field], 'common_request_identity',
                                       caseId=cid, route=route, evaluationTask=task, stage=stage, field=field)
            # The original evaluator discards seeded review experimentIdentity.
            # Do not promote the analysis inputHash into proof of that input.
            seeded = row.get('reviewExperimentIdentity') or {}
            input_hashes = {s.get('metadata', {}).get('inputHash') for s in row.get('reviewTrace', []) if s.get('isRequest') is True}
            input_hashes.discard(None)
            seeded_hash = seeded.get('inputHash')
            if not seeded_hash and len(input_hashes) == 1:
                seeded_hash = next(iter(input_hashes))
            if len(input_hashes) > 1 or (seeded_hash and any(h != seeded_hash for h in input_hashes)):
                gate.add('seeded_review_input_hash_changed', caseId=cid, route=route)
            evidence[cid][route]['seededReviewInputHash'] = seeded_hash
            if not is_hash(seeded_hash):
                gate.add('seeded_review_input_hash_not_retained', state='unknown', caseId=cid, route=route)
            audit = row.get('toolAudit', [])
            costs[cid][route]['analysisRepairRoundsReported'] = row.get('repairRounds')
            costs[cid][route]['analysisAndGeneratedReviewFailedValidationTools'] = sum(x.get('tool') in ('check_draft', 'finish_analysis') and x.get('status') == 'rejected' for x in audit)
        if set(declarations) == set(ROUTES):
            for field in HASH_FIELDS + ('budgets',):
                gate.equal(declarations['classic'].get(field), declarations['ecs'].get(field), 'paired_declaration', caseId=cid, field=field)
        if set(evidence[cid]) == set(ROUTES):
            gate.equal(evidence[cid]['classic'].get('seededReviewInputHash'), evidence[cid]['ecs'].get('seededReviewInputHash'), 'paired_seeded_review_input', caseId=cid)
            for task, stage in STAGES:
                a = evidence[cid]['classic'][task].get(stage, {})
                b = evidence[cid]['ecs'][task].get(stage, {})
                if a.get('state') != b.get('state'):
                    stage_execution_differences.append(dict(caseId=cid, evaluationTask=task, stage=stage,
                                                           classic=a.get('state'), ecs=b.get('state'),
                                                           reason='Observed execution difference; absent successor stages after failure are runtime outcomes, not invented identity evidence.'))
                if a.get('state') == b.get('state') == 'observed':
                    for field in META_FIELDS + (OBSERVED_FIELDS if c2 else ()):
                        gate.equal(a['identity'].get(field), b['identity'].get(field), 'paired_stage_identity', caseId=cid, evaluationTask=task, stage=stage, field=field)
    for route in ROUTES:
        task_costs = [costs[cid][route][task] for cid in costs if route in costs[cid]
                      for task in ('analysis', 'review')]
        observed = reports[route].get('observability', {})
        gate.equal(observed.get('requestCountKnown'), sum(c['requestCount'] for c in task_costs),
                   'report_request_accounting', route=route)
        for field in TOKEN_FIELDS:
            for metric in ('knownTotal', 'knownRequests', 'unknownRequests'):
                gate.equal(observed.get('usage', {}).get(field, {}).get(metric),
                           sum(c['usage'][field][metric] for c in task_costs),
                           'report_usage_accounting', route=route, field=field, metric=metric)
    return {'version': 1, 'comparable': not gate.issues, 'verificationKind': 'offline-only',
            'verifiedAt': datetime.now(timezone.utc).isoformat(), 'issues': gate.issues,
            'dataset': plan['dataset'], 'stageEvidence': evidence, 'requestAccounting': costs,
            'stageExecutionDifferences': stage_execution_differences,
            'configurationAttestation': attestation,
            'repairRoundsDefinition': 'analysisRepairRoundsReported is the original analysis draft counter only. Failed validation tool audits combine analysis/generated review; seeded review failures are counted separately from reviewTrace. These counts are not total repair rounds.',
            'inputBindingScope': 'C2 requires per-request adapter-observed native inputHash, adapterInputHash, configurationSnapshotHash and evaluationTask. inputHash is the initial input of that native process, including its generated-review stage; it does not claim generated-review input equality. Missing seeded-review observations are never reconstructed.',
            'originalReportsPreserved': True,
            'verifierSha256': file_hash(Path(__file__))}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('run-dir', 'dataset', 'config', 'evaluator', 'binary'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--driver', type=Path, default=Path(__file__).with_name('run_tool_comparison.py'))
    parser.add_argument('--adapter', type=Path, default=Path(__file__).with_name('tool_agent_adapter.py'))
    parser.add_argument('--output', type=Path)
    args = parser.parse_args(argv)
    output = args.output or args.run_dir / 'verified-comparison.json'
    # Never overwrite a source artifact, even via a caller-supplied output path.
    allowed = (args.run_dir / 'verified-comparison.json').resolve()
    if output.resolve() != allowed:
        parser.error('output must be RUN/verified-comparison.json')
    try:
        config = read_json(args.config)
        paths = {'binary': args.binary, 'nativeConfig': args.config,
                 'driver': args.driver, 'adapter': args.adapter,
                 'nativeHelper': Path(config['bridgeBinary']), 'evaluator': args.evaluator}
        result = verify(args.run_dir, args.dataset, paths)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError, StopIteration) as exc:
        # No config values, credentials, source text or exception text in output.
        result = {'version': 1, 'comparable': False, 'verificationKind': 'offline-only',
                  'issues': [{'code': 'verification_input_unavailable_or_invalid', 'state': 'unknown', 'exceptionType': type(exc).__name__}]}
    output.write_bytes(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8') + b'\n')
    print(json.dumps({'comparable': result['comparable'], 'issueCount': len(result['issues']), 'output': str(output)}, ensure_ascii=False))
    return 0 if result['comparable'] else 2


if __name__ == '__main__':
    sys.exit(main())
