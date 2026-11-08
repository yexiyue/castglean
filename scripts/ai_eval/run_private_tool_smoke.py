#!/usr/bin/env python3
"""Explicit authorized chapter smoke; no gold scoring and no product persistence."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time


EXTERNAL_TIMEOUT = 330


def file_identity(path):
    """Record identity only; never include file contents or exception messages."""
    path = Path(path).absolute()
    try:
        return {'path': str(path.resolve()), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'status': 'known'}
    except OSError:
        return {'path': str(path), 'status': 'unavailable'}


def identities(binary, config):
    result = {'binary': file_identity(binary), 'config': file_identity(config),
              'helper': {'status': 'unknown'}, 'connection': {'status': 'unknown'}}
    try:
        data = json.loads(Path(config).read_bytes())
        for name, key in [('helper', 'bridgeBinary'), ('connection', 'configPath')]:
            path = Path(data[key])
            if path.is_absolute():
                result[name] = file_identity(path)
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return result


def matches_frozen(current, frozen):
    return all(current[name].get('status') == frozen[name].get('status') == 'known'
               and current[name] == frozen[name] for name in ('binary', 'config', 'helper', 'connection'))


def communicate(argv, payload, timeout=EXTERNAL_TIMEOUT):
    """Own a whole process group, including helpers, until completion or cleanup."""
    process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, _ = process.communicate(payload, timeout=timeout)
        return process.returncode, stdout
    finally:
        # Also clean up on interruption, I/O errors, or an exited parent with live helpers.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        finally:
            process.communicate()


def failed(kind):
    return {'status': 'failed', 'failureKind': kind, 'costUnknown': True, 'modelRequests': None}


def run_route(case, binary, config, route, frozen, timeout=EXTERNAL_TIMEOUT):
    started = time.monotonic()
    before = identities(binary, config)
    result = failed('identity_unavailable_or_changed')
    if matches_frozen(before, frozen):
        argv = [str(Path(binary).resolve()), '--plan-c-route', route,
                '--live-config', str(Path(config).resolve()), '--discover-characters']
        try:
            code, stdout = communicate(argv, json.dumps(case, ensure_ascii=False).encode() + b'\n', timeout)
            if code:
                result = failed('adapter_exit')
            else:
                result = json.loads(stdout)
                if (not isinstance(result, dict) or result.get('status') not in
                        ('completed', 'failed', 'cancelled', 'interrupted') or
                        not isinstance(result.get('trace'), list) or
                        not all(isinstance(span, dict) for span in result['trace'])):
                    result = failed('parse')
                else:
                    unknown = result['status'] != 'completed' or result.get('costUnknown', False)
                    requests = [span for span in result['trace'] if span.get('isRequest')]
                    unknown = unknown or not requests
                    result['costUnknown'] = bool(unknown)
                    result['modelRequests'] = None if unknown else len(requests)
        except subprocess.TimeoutExpired:
            result = failed('timeout')
        except (ValueError, UnicodeError):
            result = failed('parse')
        except KeyboardInterrupt:
            result = failed('interrupted')
        except Exception:
            result = failed('adapter_error')
    after = identities(binary, config)
    unchanged = matches_frozen(before, frozen) and matches_frozen(after, frozen)
    if not unchanged and result.get('failureKind') != 'identity_unavailable_or_changed':
        result.update(failed('identity_changed'))
    result['executionIdentity'] = {'frozen': frozen, 'started': before, 'ended': after,
                                   'matchesFrozen': unchanged}
    result['elapsedMs'] = (time.monotonic() - started) * 1000
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, required=True, help='Previously authorized frozen chapter snapshot')
    p.add_argument('--binary', type=Path, required=True)
    p.add_argument('--config', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    snapshot_bytes = args.input.read_bytes()
    text = json.loads(snapshot_bytes)['text']
    case = {'version': 1, 'caseId': 'authorized-private-chapter-tool-smoke', 'evaluationTask': 'analysis',
            'source': {'text': text, 'sha256': hashlib.sha256(text.encode()).hexdigest()}, 'characters': []}
    (args.output / 'source-identity.json').write_text(json.dumps({
        'sourceHash': case['source']['sha256'], 'snapshotHash': hashlib.sha256(snapshot_bytes).hexdigest(),
        'identityDiscoveryEvaluated': False, 'semanticQualityScored': False}))
    frozen = identities(args.binary, args.config)
    (args.output / 'execution-identity.json').write_text(json.dumps(frozen, indent=2))
    for route in ['classic', 'ecs']:
        result = run_route(case, args.binary, args.config, route, frozen)
        (args.output / f'{route}-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(json.dumps({'route': route, 'status': result['status'], 'error': result.get('error'),
                          'failureKind': result.get('failureKind'), 'modelRequests': result['modelRequests'],
                          'costUnknown': result['costUnknown'], 'elapsedMs': result['elapsedMs']},
                         ensure_ascii=False), flush=True)
        if result.get('failureKind') == 'interrupted':
            break


if __name__ == '__main__':
    main()
