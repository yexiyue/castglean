#!/usr/bin/env python3
"""No-write evaluation of the production C7 core + native Rig runtime.

Case files contain source.text, characters, optional aliases and optional gold.
Private source, jobs and outputs must stay under an ignored target/ directory.
This does not publish a project or test desktop adoption/persistence.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time

BRIDGE = 'chapter_analysis::experiment::protocol_experiment_bridge'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    path.chmod(0o600)


def score(case, result):
    """Byte-labelled public AI gold only; failed pipeline has zero delivered accuracy."""
    if not case.get('gold'):
        return {'semanticQuality': 'unmeasured'}
    total = len(case['source']['text'].encode())
    if not result.get('ok'):
        return {'bytesCorrect': 0, 'bytesTotal': total, 'delivered': False}
    correct = 0
    for unit in case['gold']:
        for segment in result['analysis']['segments']:
            speakers = segment.get('candidates') or [segment['speaker']]
            if segment['kind'] == unit['kind'] and set(speakers) == set(unit['speakers']):
                correct += max(0, min(segment['end'], unit['end']) - max(segment['start'], unit['start']))
    return {'bytesCorrect': correct, 'bytesTotal': total, 'delivered': True,
            'goldOrigin': 'public-AI-authored-not-human-truth'}


def run_case(binary, job_path):
    process = subprocess.Popen([str(binary), '--exact', BRIDGE, '--ignored', '--nocapture'],
                               env=dict(os.environ, CASTGLEAN_EXPERIMENT_JOB=str(job_path)),
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True)
    try:
        process.communicate()  # Intentionally no evaluation wall deadline.
        output = job_path.with_suffix('.result.json')
        if process.returncode or not output.exists():
            return {'ok': False, 'error': 'bridge_exit', 'requestsUnknown': True}
        return json.loads(output.read_bytes())
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()


def preflight(cases):
    seen = set()
    for case in cases:
        if case['caseId'] in seen:
            raise ValueError('duplicate_case')
        seen.add(case['caseId'])
        source = case['source']
        if hashlib.sha256(source['text'].encode()).hexdigest() != source['sha256']:
            raise ValueError('source_hash')
        if not source['text']:
            raise ValueError('empty_source')
        ids = set()
        for role in case.get('characters', []):
            if not role['id'] or not role['name'] or role['id'] in ids:
                raise ValueError('role_identity')
            ids.add(role['id'])
    return cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True,
                        help='JSON with configPath and selection, no credentials')
    parser.add_argument('--cases', type=Path, required=True, help='JSONL cases')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    output = args.output.resolve()
    if subprocess.run(['git', 'check-ignore', '-q', str(output)], cwd=root).returncode:
        parser.error('output must be ignored by Git (for example src-tauri/target/production-agent-eval)')
    cases = preflight([json.loads(line) for line in args.cases.read_text().splitlines() if line.strip()])
    output.mkdir(parents=True, exist_ok=False)
    configuration = json.loads(args.config.read_bytes())
    native_config = Path(configuration['configPath'])
    identities = {'binary': digest(args.binary), 'driver': digest(__file__),
                  'cases': digest(args.cases), 'configWrapper': digest(args.config),
                  'nativeConfig': digest(native_config)}
    write(output / 'plan.json', {'formatVersion': 1, 'identities': identities,
          'scope': 'production-core-native-runtime-no-project-writes',
          'plannedCases': [c['caseId'] for c in cases]})
    results = []
    for index, case in enumerate(cases):
        current = {'binary': digest(args.binary), 'driver': digest(__file__),
                   'cases': digest(args.cases), 'configWrapper': digest(args.config),
                   'nativeConfig': digest(native_config)}
        if identities != current:
            raise RuntimeError('frozen_identity_changed')
        job = dict(configuration, op='production_agent', text=case['source']['text'],
                   characters=case.get('characters', []), aliases=case.get('aliases', []))
        job_path = output / f'{index:03d}-job.json'
        write(job_path, job)
        started = time.monotonic()
        result = run_case(args.binary.resolve(), job_path)
        result['caseId'] = case['caseId']
        result['wallMs'] = (time.monotonic() - started) * 1000
        result['score'] = score(case, result)
        result['identitiesUnchanged'] = identities == {
            'binary': digest(args.binary), 'driver': digest(__file__), 'cases': digest(args.cases),
            'configWrapper': digest(args.config), 'nativeConfig': digest(native_config)}
        write(output / f'{index:03d}-result.json', result)
        results.append(result)
        write(output / 'summary.json', {'planned': len(cases), 'observed': len(results),
              'completed': sum(r.get('ok') is True for r in results),
              'identityGate': all(r['identitiesUnchanged'] for r in results),
              'cases': [{'caseId': r['caseId'], 'ok': r['ok'], 'wallMs': r['wallMs'],
                         'score': r['score']} for r in results]})
        print(json.dumps({'caseId': case['caseId'], 'ok': result['ok'], 'wallMs': result['wallMs']}), flush=True)
        if not result['identitiesUnchanged']:
            raise RuntimeError('frozen_identity_changed')


if __name__ == '__main__':
    main()
