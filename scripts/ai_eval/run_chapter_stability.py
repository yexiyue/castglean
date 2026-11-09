#!/usr/bin/env python3
"""Frozen new-chapter C7 stability matrix; no gold and no product writes."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import statistics
import time

import run_unlimited_chapter_comparison as common
import run_private_tool_smoke as smoke
import verify_unlimited_chapter_comparison as gate
import chapter_quality_audit as audit

ROUTES = ('json', 'classic', 'ecs')


def validate_fixture(snapshot, prepared, book):
    text = snapshot['text']; raw = text.encode()
    if hashlib.sha256(raw).hexdigest() != snapshot['chapterHash']:
        raise ValueError('chapter_hash_mismatch')
    a, b = snapshot['sourceStart'], snapshot['sourceEnd']
    if not 0 <= a < b <= len(book) or book[a:b] != raw:
        raise ValueError('book_binding_mismatch')
    if len(prepared['plans']) != 1 or prepared['plans'][0]['owned'] != {'start': 0, 'end': len(raw)}:
        raise ValueError('whole_chapter_plan_required')
    cursor = 0
    for anchor in prepared['plans'][0]['anchors']:
        encoded = anchor['text'].encode()
        if anchor['start'] != cursor or raw[cursor:cursor + len(encoded)] != encoded:
            raise ValueError('anchor_source_mismatch')
        cursor += len(encoded)
    if cursor != len(raw):
        raise ValueError('anchor_source_incomplete')


def prepare_json_request(protocol, snapshot, prepared):
    try:
        if not isinstance(prepared['payloads'],list) or len(prepared['payloads'])!=1 or not isinstance(prepared['payloads'][0],dict) or not isinstance(prepared['preamble'],str):
            raise ValueError('json_request_inputs_invalid')
        system,user,schema,lookup=protocol.request_for('precut_compact_low',prepared['plans'][0],prepared['payloads'][0],prepared['preamble'],[],snapshot['text'])
        if not isinstance(system,str) or not system or not isinstance(user,dict) or not isinstance(schema,dict) or not isinstance(lookup,dict):
            raise ValueError('json_request_shape_invalid')
        if ''.join(row['text'] for row in user['targets'])!=snapshot['text'] or user['targetIds']!=list(lookup):
            raise ValueError('json_request_source_incomplete')
        return {'system':system,'user':json.dumps(user,ensure_ascii=False,separators=(',',':')),'schema':schema}
    except (KeyError,TypeError,IndexError) as exc:
        raise ValueError('json_request_inputs_invalid') from exc


def preflight(manifest, config, protocol):
    if not all(config.get(k) is True for k in ['unlimitedTokens', 'unlimitedTime', 'compactTools']):
        raise ValueError('explicit_c7_unlimited_profile_required')
    if config.get('reasoningEffort') != 'low' or config.get('controlledHelper') is not False:
        raise ValueError('live_low_profile_required')
    cases = manifest['cases']; ids = [c['caseId'] for c in cases]
    if len(cases) != 3 or len(set(ids)) != 3 or manifest.get('plannedSlots') != 9:
        raise ValueError('three_distinct_chapters_nine_slots_required')
    if [c['ordinal'] for c in cases] != [2, 10, 50] or manifest.get('goldAvailable') is not False:
        raise ValueError('declared_holdout_ordinals_required')
    book = Path(manifest['sourceBook']).read_bytes()
    if hashlib.sha256(book).hexdigest() != manifest['sourceBookHash']:
        raise ValueError('source_book_hash_mismatch')
    expected = [list(ROUTES), ['classic', 'ecs', 'json'], ['ecs', 'json', 'classic']]
    loaded = []
    for item, order in zip(cases, expected):
        if item['orders'] != [order]:
            raise ValueError('balanced_sequential_order_required')
        snapshot = common.read(item['snapshot']); prepared = common.read(item['prepared'])
        if snapshot.get('chapterOrdinal') != item['ordinal'] or snapshot.get('sourceHash') != manifest['sourceBookHash']:
            raise ValueError('snapshot_binding_mismatch')
        validate_fixture(snapshot, prepared, book)
        samples = audit.make_samples(snapshot['text'], protocol.partition(snapshot['text']), count=8)
        if len(samples) != 8:
            raise ValueError('eight_source_samples_required')
        request=prepare_json_request(protocol,snapshot,prepared)
        loaded.append((dict(item,preparedJsonRequest=request), snapshot, prepared, samples))
    return loaded


def agent_trial(case, binary, config_path, config, identity, route, directory):
    raw = smoke.run_route(case, binary, config_path, route, identity, timeout=None,
                          audit_path=directory/'live-tool-audit.jsonl')
    common.write(directory/'raw-result.json', raw)
    requests = [s for s in raw.get('trace', []) if s.get('isRequest')]
    normalized = common.normalize_draft(raw)
    analysis = common.analysis_seconds(raw)
    workflow = next((s for s in raw.get('trace', []) if s.get('stage') == 'workflow'), {})
    effects = [e for group in raw.get('runtimeObservations', []) for e in group.get('effects', [])]
    return {'route': route, 'status': raw['status'], 'error': raw.get('error') or raw.get('failureKind'),
            'analysisFinished': normalized is not None, 'analysisSeconds': analysis,
            'elapsedSeconds': raw['elapsedMs']/1000, 'modelRequestsObserved': len(requests),
            'requestsByStage': {stage: sum(s.get('stage') == stage for s in requests) for stage in ['analysis', 'review']},
            'usage': raw.get('observedUsage'), 'costUnknown': raw.get('costUnknown', True),
            'unlimitedProfileVerified': common.verify_unlimited(raw),
            'timeProfileVerified': common.verify_time_profile(raw, True),
            'generatedReviewSeconds': None if analysis is None else max(0, workflow.get('elapsedMs', 0)/1000-analysis),
            'businessRejections': dict(Counter(x['error'] for x in raw.get('toolAudit', []) if x['status'] == 'rejected')),
            'runtimePreToolFailures': sum(e.get('family') == 'tool' and e.get('ok') is False and e.get('startedMs') is None for e in effects),
            'normalized': normalized}


def known_count(value):
    return type(value) is int and value >= 0


def summarize(manifest, rows):
    result = {'plannedSlots': manifest['plannedSlots'], 'observedSlots': len(rows), 'routes': {},
              'semanticAccuracy': None, 'scope': 'Three new chapters, one execution per route; no human gold or repeat-run probability.'}
    for route in ROUTES:
        part = [r for r in rows if r['route'] == route]
        seconds = [r['elapsedSeconds'] for r in part]
        known = [r for r in part if common.usage_complete(r.get('usage'))]
        result['routes'][route] = {
            'planned': len(manifest['cases']), 'observed': len(part),
            'delivered': sum(r['status'] == 'completed' for r in part),
            'mainDraftsFinished': sum(r['analysisFinished'] for r in part),
            'missingSlots': len(manifest['cases'])-len(part),
            'secondsAllObserved': {'min': min(seconds), 'median': statistics.median(seconds), 'max': max(seconds)} if seconds else None,
            'modelRequestsObserved': sum(r['modelRequestsObserved'] for r in part),
            'knownInputTokens': sum(r['usage']['input_tokens'] for r in part if known_count((r.get('usage') or {}).get('input_tokens'))),
            'inputUsageUnknownSlots': sum(not known_count((r.get('usage') or {}).get('input_tokens')) for r in part),
            'knownOutputTokens': sum(r['usage']['output_tokens'] for r in part if known_count((r.get('usage') or {}).get('output_tokens'))),
            'outputUsageUnknownSlots': sum(not known_count((r.get('usage') or {}).get('output_tokens')) for r in part),
            'knownCachedInputTokens': sum(r['usage']['cached_input_tokens'] for r in part if known_count((r.get('usage') or {}).get('cached_input_tokens'))),
            'cachedInputUnknownSlots': sum(not known_count((r.get('usage') or {}).get('cached_input_tokens')) for r in part),
            'usageUnknownSlots': len(part)-len(known),
            'costUnknownSlots': sum(r['costUnknown'] for r in part),
            'runtimePreToolFailures': sum(r.get('runtimePreToolFailures', 0) for r in part),
            'businessRejections': dict(sum((Counter(r.get('businessRejections', {})) for r in part), Counter())),
        }
    return result


def completion_flags(primary_passed, observed_slots, planned_slots, audit_rows, planned_audits):
    primary = primary_passed and observed_slots == planned_slots
    audit_complete = len(audit_rows) == planned_audits and all(r['status']=='completed' for r in audit_rows)
    return {'primaryComparable':primary,'auditComplete':audit_complete,'comparable':primary and audit_complete}


def check_frozen(files, hashes):
    if any(common.digest(path) != hashes[name] for name, path in files.items()):
        raise ValueError('frozen_file_changed')


def run_audit(directory, samples, config, outputs, aliases, expected_model):
    started = time.monotonic()
    common.write(directory/'aliases.json', aliases)
    payload = audit.make_audit_input(samples, outputs, aliases)
    common.write(directory/'request-context.json', json.loads(payload))
    result = {'status': 'failed', 'costUnknown': True, 'modelRequestsObserved': 0, 'dispatchAttempted': True, 'sampleCount':len(samples), 'requestContextHash':hashlib.sha256(payload.encode()).hexdigest()}
    try:
        response = common.helper(Path(config['bridgeBinary']), directory, {
            'op': 'call', 'configPath': config['configPath'], 'selection': config['selection'],
            'system': audit.AUDIT_SYSTEM, 'user': payload,
            'schema': audit.AUDIT_SCHEMA, 'low': True, 'reasoningEffort': 'low',
            'unlimitedTokens': True, 'unlimitedTime': True}, timeout=None)
        common.write(directory/'response.json', response)
        result.update(modelRequestsObserved=1, usage=response.get('usage'), model=response.get('model'), wireFacts=response.get('wireFacts'),finishReason=response.get('finishReason'))
        req = (response.get('wireFacts') or {}).get('request') or {}
        if response.get('model') != expected_model or response.get('wallMs',1) is not None or not response.get('ok') or req.get('reasoningEffort') != 'low' or any(k not in req or req[k] is not None for k in ['maxTokens', 'maxCompletionTokens']):
            raise ValueError('audit_wire_or_provider_failure')
        value = json.loads(response['text']); audit.validate_audit(value, samples, aliases)
        common.write(directory/'validated.json', value)
        result.update(status='completed', costUnknown=not common.usage_complete(response.get('usage')),
                      signal=audit.summarize_audit(value, aliases), semanticAccuracy=None)
    except KeyboardInterrupt:
        result.update(error='interrupted',requestCountUnknown=True)
    except (ValueError, KeyError, TypeError, RuntimeError, OSError):
        result['error'] = 'audit_response_or_validation_failed'
    result['elapsedSeconds'] = time.monotonic()-started
    common.write(directory/'result.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['manifest', 'binary', 'config', 'protocol', 'output']:
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args(); config = common.read(args.config); manifest = common.read(args.manifest)
    if 'target' not in args.output.resolve().parts:
        raise ValueError('private_output_requires_target')
    spec = importlib.util.spec_from_file_location('stability_protocol', args.protocol)
    protocol = importlib.util.module_from_spec(spec); spec.loader.exec_module(protocol)
    loaded = preflight(manifest, config, protocol)
    args.output.mkdir(parents=True, exist_ok=False)
    shared = {'manifest': args.manifest.resolve(), 'sourceBook': Path(manifest['sourceBook']),
              'binary': args.binary.resolve(), 'config': args.config.resolve(), 'protocol': args.protocol.resolve(),
              'helper': Path(config['bridgeBinary']), 'connection': Path(config['configPath']),
              'runner': Path(__file__).resolve(), 'trialLibrary': Path(common.__file__).resolve(),
              'smoke': Path(smoke.__file__).resolve(), 'verifier': Path(gate.__file__).resolve(), 'auditor': Path(audit.__file__).resolve()}
    for item, _, _, samples in loaded:
        directory = args.output/item['caseId']; directory.mkdir()
        common.write(directory/'samples.json', samples)
        common.write(directory/'json-request-template.json',item['preparedJsonRequest'])
        shared[item['caseId']+'-requestTemplate']=directory/'json-request-template.json'
        for name in ['snapshot', 'prepared']:
            shared[item['caseId']+'-'+name] = Path(item[name])
        shared[item['caseId']+'-samples'] = directory/'samples.json'
    frozen = {k: common.digest(v) for k, v in shared.items()}
    common.write(args.output/'plan.json', {'manifest': manifest, 'frozen': frozen, 'humanConfirmed': False,
                 'goldAvailable': False, 'auditRubricHash': hashlib.sha256((audit.AUDIT_SYSTEM+json.dumps(audit.AUDIT_SCHEMA,sort_keys=True)).encode()).hexdigest()})
    identity = smoke.identities(args.binary, args.config); all_rows = []; audit_rows = []; passed = True
    try:
        for item, snapshot, prepared, samples in loaded:
            directory = args.output/item['caseId']; paths = dict(shared, snapshot=Path(item['snapshot']), prepared=Path(item['prepared']))
            case_frozen = {k: common.digest(v) for k, v in paths.items()}
            common.write(directory/'plan.json', {'sourceHash': snapshot['chapterHash'], 'frozen': case_frozen,
                         'orders': item['orders'], 'reasoningEffort': 'low', 'wallMs': None, 'goldAvailable': False})
            rows = []; case = {'version':1, 'caseId':item['caseId'], 'evaluationTask':'analysis',
                              'source':{'text':snapshot['text'], 'sha256':snapshot['chapterHash']}, 'characters':[]}
            for route in item['orders'][0]:
                check_frozen(shared, frozen); trial = directory/f'r1-{route}'; trial.mkdir()
                if route == 'json':
                    if prepare_json_request(protocol,snapshot,prepared)!=common.read(directory/'json-request-template.json'):
                        raise ValueError('prepared_json_request_changed')
                    trial_started = time.monotonic()
                    try:
                        row = common.json_trial(protocol, config, prepared, snapshot, trial)
                    except KeyboardInterrupt:
                        row = {'route':route,'status':'failed','error':'interrupted','analysisFinished':False,'analysisSeconds':None,'elapsedSeconds':time.monotonic()-trial_started,'modelRequestsObserved':0,'requestCountUnknown':True,'dispatchAttempted':(trial/'request.json').exists(),'usage':None,'costUnknown':True,'unlimitedProfileVerified':None,'timeProfileVerified':None}
                else:
                    row = agent_trial(case, args.binary, args.config, config, identity, route, trial)
                normalized = row.pop('normalized', None)
                if normalized is not None:
                    common.write(trial/'normalized.json', {'segments':normalized})
                row.update(caseId=item['caseId'], repetition=1, unicodeScalars=len(snapshot['text']), semanticAccuracy=None)
                common.write(trial/'result.json', row); rows.append(row); all_rows.append(row)
                common.write(directory/'results.json', rows); common.write(args.output/'results.json', all_rows)
                common.write(args.output/'summary.json', summarize(manifest, all_rows))
                check_frozen(shared, frozen)
                print(json.dumps({k:row.get(k) for k in ['caseId','route','status','analysisSeconds','elapsedSeconds','modelRequestsObserved','requestsByStage','businessRejections','runtimePreToolFailures']},ensure_ascii=False),flush=True)
                if row.get('error') == 'interrupted':
                    raise KeyboardInterrupt
            verification = gate.verify(directory, paths, config); common.write(directory/'verification.json', verification)
            if not verification['passed']:
                passed = False; break
        if passed:
            for i, (item, _, _, samples) in enumerate(loaded):
                check_frozen(shared, frozen); directory = args.output/item['caseId']; outputs = {}
                for route in ROUTES:
                    path = directory/f'r1-{route}'/'normalized.json'
                    if path.exists(): outputs[route] = common.read(path)['segments']
                if len(outputs) != 3:
                    skipped={'caseId':item['caseId'],'status':'skipped','reason':'not_all_main_drafts_available','semanticAccuracy':None,'dispatchAttempted':False,'modelRequestsObserved':0,'costUnknown':False,'elapsedSeconds':0}
                    common.write(directory/'audit-skipped.json',skipped);audit_rows.append(skipped);common.write(args.output/'audit-results.json',audit_rows);continue
                order = list(ROUTES[i:])+list(ROUTES[:i]); aliases = dict(zip(['A','B','C'], order))
                review_dir = directory/'independent-audit'; review_dir.mkdir()
                expected_model = common.read(directory/'verification.json')['models'][0]
                result = run_audit(review_dir, samples, config, outputs, aliases, expected_model)
                audit_rows.append(dict(result,caseId=item['caseId']))
                common.write(args.output/'audit-results.json',audit_rows)
                check_frozen(shared, frozen)
                print(json.dumps({'caseId':item['caseId'],'independentAudit':result['status']}),flush=True)
                if result.get('error')=='interrupted': raise KeyboardInterrupt
        check_frozen(shared, frozen)
    except KeyboardInterrupt:
        passed = False; common.write(args.output/'interruption.json', {'reason':'operator_interrupted','remainingSlotsNotExecuted':True})
    except (ValueError, KeyError, TypeError, RuntimeError, OSError) as exc:
        passed = False; common.write(args.output/'rejection.json', {'reason':'frozen_or_execution_contract_failure','errorType':type(exc).__name__,'remainingSlotsMayBeUnexecuted':True})
    summary = summarize(manifest, all_rows)
    summary['independentAudit'] = {'planned':len(loaded),'observed':len(audit_rows),'completed':sum(r['status']=='completed' for r in audit_rows),'modelRequestsObserved':sum(r['modelRequestsObserved'] for r in audit_rows),'knownInputTokens':sum((r.get('usage') or {}).get('input_tokens') or 0 for r in audit_rows),'knownOutputTokens':sum((r.get('usage') or {}).get('output_tokens') or 0 for r in audit_rows),'usageUnknownTasks':sum(r.get('dispatchAttempted',False) and not common.usage_complete(r.get('usage')) for r in audit_rows),'costUnknownTasks':sum(r['costUnknown'] for r in audit_rows),'secondsObserved':sum(r['elapsedSeconds'] for r in audit_rows),'semanticAccuracy':None}
    summary.update(completion_flags(passed,len(all_rows),manifest['plannedSlots'],audit_rows,len(loaded)))
    common.write(args.output/'summary.json', summary)
    return 0 if summary['comparable'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
