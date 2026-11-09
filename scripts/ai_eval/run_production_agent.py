#!/usr/bin/env python3
"""No-write evaluation of the production chapter attribution core + native Rig runtime.

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

BRIDGE = 'chapter_analysis::evaluation::production_agent_bridge'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    path.chmod(0o600)


def valid_range(text, start, end):
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
        return False
    try:
        text[:start].decode('utf-8')
        text[start:end].decode('utf-8')
    except UnicodeDecodeError:
        return False
    return True


def validate_delivery(case, result):
    """Never score a malformed or partial draft as a delivered chapter."""
    if result.get('ok') is not True:
        return False
    text = case['source']['text'].encode()
    analysis = result.get('analysis', {})
    roles = {r['id'] for r in analysis.get('characters', [])} | {r['id'] for r in case.get('characters', [])}
    position = 0
    segments = analysis.get('segments', [])
    for segment in segments:
        start, end = segment.get('start'), segment.get('end')
        if not valid_range(text, start, end) or start != position:
            return False
        kind, speaker = segment.get('kind'), segment.get('speaker')
        candidates = segment.get('candidates', [])
        if kind == 'narration':
            if speaker != 'narrator' or candidates:
                return False
        elif kind in ('speech', 'thought'):
            if speaker not in roles | {'unknown', 'ambiguous'}:
                return False
            if speaker == 'ambiguous':
                if len(set(candidates)) < 2 or not set(candidates) <= roles:
                    return False
            elif candidates:
                return False
        else:
            return False
        position = end
    return bool(segments) and position == len(text)


def score(case, result):
    """Byte-labelled public AI gold only; failed pipeline has zero delivered accuracy."""
    delivered = validate_delivery(case, result)
    if not case.get('gold'):
        return {'semanticQuality': 'unmeasured', 'delivered': delivered}
    total = len(case['source']['text'].encode())
    correct = 0
    if delivered:
        for unit in case['gold']:
            for segment in result['analysis']['segments']:
                speakers = segment.get('candidates') or [segment['speaker']]
                if segment['kind'] == unit['kind'] and set(speakers) == set(unit['speakers']):
                    correct += max(0, min(segment['end'], unit['end']) - max(segment['start'], unit['start']))
    return {'bytesCorrect': correct, 'bytesTotal': total, 'delivered': delivered,
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
    if not cases:
        raise ValueError('empty_cases')
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
            if not role['id'] or not role['name'] or role['id'] in ids or role['id'] in {'narrator', 'unknown', 'ambiguous'}:
                raise ValueError('role_identity')
            ids.add(role['id'])
        position = 0
        text = source['text'].encode()
        for unit in case.get('gold', []):
            if not valid_range(text, unit['start'], unit['end']) or unit['start'] != position:
                raise ValueError('gold_coverage')
            speakers = unit['speakers']
            if not speakers or len(set(speakers)) != len(speakers):
                raise ValueError('gold_identity')
            if unit['kind'] == 'narration':
                if speakers != ['narrator']:
                    raise ValueError('gold_identity')
            elif unit['kind'] in ('speech', 'thought'):
                if not set(speakers) <= ids | {'unknown'}:
                    raise ValueError('gold_identity')
            else:
                raise ValueError('gold_kind')
            position = unit['end']
        if case.get('gold') and position != len(text):
            raise ValueError('gold_coverage')
    return cases


def execution_identity(binary, cases, config, native_config):
    return {'binary': digest(binary), 'driver': digest(__file__),
            'cases': digest(cases), 'configWrapper': digest(config),
            'nativeConfig': digest(native_config)}


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
    identities = execution_identity(args.binary, args.cases, args.config, native_config)
    write(output / 'plan.json', {'formatVersion': 1, 'identities': identities,
          'scope': 'production-core-native-runtime-no-project-writes',
          'plannedCases': [c['caseId'] for c in cases]})
    results = []
    for index, case in enumerate(cases):
        current = execution_identity(args.binary, args.cases, args.config, native_config)
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
        result['identitiesUnchanged'] = identities == execution_identity(
            args.binary, args.cases, args.config, native_config)
        write(output / f'{index:03d}-result.json', result)
        results.append(result)
        write(output / 'summary.json', {'planned': len(cases), 'observed': len(results),
              'completed': sum(r['score']['delivered'] for r in results),
              'identityGate': all(r['identitiesUnchanged'] for r in results),
              'cases': [{'caseId': r['caseId'], 'ok': r['ok'], 'wallMs': r['wallMs'],
                         'score': r['score']} for r in results]})
        print(json.dumps({'caseId': case['caseId'], 'ok': result['ok'], 'wallMs': result['wallMs']}), flush=True)
        if not result['identitiesUnchanged']:
            raise RuntimeError('frozen_identity_changed')


if __name__ == '__main__':
    main()
