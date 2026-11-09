#!/usr/bin/env python3
"""Paired native task-efficiency experiments; isolated projects, never production adoption."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

BRIDGE = 'ai::efficiency::bridge::task_efficiency_bridge'
PROFILES = ['baseline', 'handoff', 'atomic', 'batch']

def program_group(profile):
    return 'legacy' if profile in ('baseline', 'handoff') else 'current'

def is_hash(value):
    return isinstance(value, str) and len(value) == 64 and all(c in '0123456789abcdef' for c in value)

def validate_programs(expected, binaries):
    """Manifest identities must come from the explicit freeze, never the first run."""
    if not isinstance(expected, dict):
        raise ValueError('program_identities_missing_or_invalid')
    for group, binary in binaries.items():
        program = expected.get(group, {})
        if not isinstance(program, dict) or not all(
                is_hash(program.get(key)) for key in ('binarySha256', 'implementationHash')):
            raise ValueError(f'{group}_program_identity_missing_or_invalid')
        if digest(binary) != program['binarySha256']:
            raise ValueError(f'{group}_binary_mismatch')
    if any(expected['legacy'][key] == expected['current'][key]
           for key in ('binarySha256', 'implementationHash')):
        raise ValueError('legacy_current_programs_must_differ')

def result_gate(result, case_id, profile, expected, inputs, model_identity):
    issues = []
    if result.get('profile') != profile or result.get('caseId') != case_id:
        issues.append('result_route_identity_mismatch')
    actual = result.get('implementationHash')
    if not is_hash(actual):
        issues.append('implementation_identity_missing_or_invalid')
    elif actual != expected[program_group(profile)]['implementationHash']:
        issues.append('implementation_mismatch')
    configuration = result.get('configuration')
    current = configuration.get('configurationSnapshotHash') if isinstance(configuration, dict) else None
    if not is_hash(current):
        issues.append('configuration_identity_missing_or_invalid')
    elif model_identity is not None and current != model_identity:
        issues.append('model_configuration_mismatch')
    actual_input = result.get('inputHash')
    if not is_hash(actual_input):
        issues.append('input_identity_missing_or_invalid')
    elif case_id in inputs and inputs[case_id] != actual_input:
        issues.append('case_input_mismatch')
    return issues

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def save(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.chmod(0o600)
    temporary.replace(path)

def preflight(cases):
    seen = set()
    for case in cases:
        if not case['caseId'] or case['caseId'] in seen:
            raise ValueError('duplicate_case')
        seen.add(case['caseId'])
        text = case['source']['text']
        if not text or '\0' in text or hashlib.sha256(text.encode()).hexdigest() != case['source']['sha256']:
            raise ValueError('source_identity')
        if not case['request'].strip():
            raise ValueError('empty_request')
        for line in case.get('goldHeadings', case.get('referenceHeadings', [])):
            if type(line) is not int or not 0 <= line < len(text.splitlines()):
                raise ValueError('heading_range')
    if not cases:
        raise ValueError('empty_cases')
    return cases

def score(case, result):
    delivered = result.get('ok') is True
    expected = case.get('goldHeadings', case.get('referenceHeadings'))
    actual = result.get('headings')
    exact = delivered and expected is not None and sorted(actual or []) == sorted(expected)
    return {'delivered': delivered, 'boundaryExact': exact if expected is not None else None,
            'comparisonRequired': case.get('requiresComparison', False),
            'comparisonObserved': result.get('distinctRuleTrials', 0) >= 2,
            'taskFulfilled': delivered and (not case.get('requiresComparison', False) or result.get('distinctRuleTrials', 0) >= 2),
            'referenceOrigin': case.get('referenceOrigin', 'unmeasured'),
            'semanticQuality': 'unmeasured' if not case.get('goldHeadings') else 'public-AI-authored-not-human-truth'}

def totals(results):
    def measured(key, usage_key=None):
        values, known, unknown_requests = [], 0, 0
        unknown_request_count_known = True
        for result in results:
            meter = result.get('meter', {})
            if usage_key is not None and isinstance(meter.get('requests'), list):
                requests = meter['requests']
                observed = [(request.get('usage') or {}).get(usage_key) for request in requests]
                # An unrepresented request cannot silently become a measured zero.
                count = meter.get('requestCount')
                if type(count) is int and count > len(requests):
                    observed.extend([None] * (count - len(requests)))
                values.append(sum(observed) if all(v is not None for v in observed) else None)
                known += sum(v for v in observed if v is not None)
                unknown_requests += sum(v is None for v in observed)
            else:
                value = meter.get(key)
                values.append(value)
                known += value if value is not None else 0
                if usage_key is not None and value is None:
                    # Legacy aggregate-only meters cannot identify which requests
                    # have unknown usage. Preserve that uncertainty explicitly.
                    unknown_request_count_known = False
        return {'total': sum(values) if all(v is not None for v in values) else None,
                'knownSubtotal': known,
                'unknownCases': sum(v is None for v in values),
                **({'unknownRequests': unknown_requests if unknown_request_count_known else None}
                   if usage_key is not None else {})}
    return {'attempted': len(results), 'delivered': sum(r['score']['delivered'] for r in results),
            'boundaryExact': sum(r['score']['boundaryExact'] is True for r in results),
            'taskFulfilled': sum(r['score'].get('taskFulfilled', False) for r in results),
            'inputTokens': measured('inputTokens', 'input_tokens'),
            'outputTokens': measured('outputTokens', 'output_tokens'),
            'cachedInputTokens': measured('cachedInputTokens', 'cached_input_tokens'),
            'requests': measured('requestCount'),
            'wallMs': sum(r['wallMs'] for r in results),
            'continuations': sum(len(r.get('meter', {}).get('continuations', [])) for r in results)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--baseline-binary', type=Path, required=True)
    parser.add_argument('--identity-manifest', type=Path, required=True,
                        help='Frozen JSON: legacy/current each require binarySha256 and implementationHash')
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--cases', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--profiles', nargs='+', choices=PROFILES, default=PROFILES)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    if subprocess.run(['git', 'check-ignore', '-q', str(output)], cwd=root).returncode:
        parser.error('output must be ignored by Git')
    cases = preflight([json.loads(line) for line in args.cases.read_text().splitlines() if line.strip()])
    config = json.loads(args.config.read_text())
    native = Path(config['configPath'])
    expected = json.loads(args.identity_manifest.read_text())
    binaries = {'legacy': args.baseline_binary, 'current': args.binary}
    try:
        validate_programs(expected, binaries)
    except ValueError as error:
        parser.error(str(error))
    frozen = {'baselineBinary': digest(args.baseline_binary), 'binary': digest(args.binary), 'driver': digest(__file__), 'cases': digest(args.cases),
              'wrapper': digest(args.config), 'nativeConfig': digest(native), 'identityManifest': digest(args.identity_manifest)}
    def identity():
        return {'baselineBinary': digest(args.baseline_binary), 'binary': digest(args.binary), 'driver': digest(__file__), 'cases': digest(args.cases),
                'wrapper': digest(args.config), 'nativeConfig': digest(native), 'identityManifest': digest(args.identity_manifest)}
    output.mkdir(parents=True, exist_ok=False)
    save(output / 'plan.json', {'formatVersion': 1, 'frozen': frozen, 'expectedPrograms': expected, 'profiles': args.profiles,
          'cases': [c['caseId'] for c in cases], 'scope': 'production-task-native-agent-temporary-project',
          'limits': 'existing task/transport protection and common 24-model-request experimental guard; no token quota'})
    results = []
    implementations = {}
    inputs = {}
    model_identity = None
    for index, case in enumerate(cases):
        offset = index % len(args.profiles)
        profiles = args.profiles[offset:] + args.profiles[:offset]
        for profile in profiles:
            if identity() != frozen:
                raise RuntimeError('frozen_identity_changed')
            job = dict(config, profile=profile, caseId=case['caseId'], text=case['source']['text'],
                       sourceHash=case['source']['sha256'], request=case['request'], corrections=case.get('corrections', []))
            path = output / f'{index:03d}-{profile}-job.json'
            save(path, job)
            started = time.monotonic()
            with path.with_suffix('.log').open('wb') as log:
                binary = binaries[program_group(profile)]
                process = subprocess.run([str(binary.resolve()), '--exact', BRIDGE, '--ignored', '--nocapture'],
                     env=dict(os.environ, CASTGLEAN_EFFICIENCY_JOB=str(path)), stdin=subprocess.DEVNULL,
                     stdout=log, stderr=subprocess.STDOUT)
            result_path = path.with_suffix('.result.json')
            if process.returncode or not result_path.exists():
                trace = path.with_suffix('.trace.json')
                result = {'ok': False, 'error': 'bridge_exit', 'meter': json.loads(trace.read_text()) if trace.exists() else {}}
            else:
                result = json.loads(result_path.read_text())
            issues = result_gate(result, case['caseId'], profile, expected, inputs, model_identity)
            result.update(caseId=case['caseId'], profile=profile, wallMs=(time.monotonic()-started)*1000)
            result['score'] = score(case, result)
            results.append(result)
            save(output / f'{index:03d}-{profile}-result.json', result)
            if identity() != frozen:
                issues.append('frozen_identity_changed_after_call')
            if not issues:
                implementations[profile] = result['implementationHash']
                model_identity = result['configuration']['configurationSnapshotHash']
                inputs[case['caseId']] = result['inputHash']
            summary = {'planned': len(cases)*len(args.profiles), 'observed': len(results), 'frozen': frozen,
                'implementationHashes': implementations, 'configurationSnapshotHash': model_identity,
                'comparable': not issues, 'gateIssues': issues,
                'profiles': {p: totals([r for r in results if r['profile']==p]) for p in args.profiles},
                'cases': [{'caseId':r['caseId'],'profile':r['profile'],'score':r['score'], 'wallMs':r['wallMs'],
                           'error':r.get('error'),'requests':r.get('meter',{}).get('requestCount')} for r in results]}
            save(output / 'summary.json', summary)
            if issues:
                raise RuntimeError(','.join(issues))
            print(json.dumps({'caseId':case['caseId'],'profile':profile,'ok':result['ok'],
                'requests':result.get('meter',{}).get('requestCount'),'wallMs':round(result['wallMs'])}), flush=True)

if __name__ == '__main__':
    main()
