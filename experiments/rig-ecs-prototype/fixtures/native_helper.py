#!/usr/bin/env python3
"""Offline native-helper contract fixture. No network, credentials, or dataset/gold access."""
import json
import os
from pathlib import Path
import sys
import time

job_path = Path(os.environ['CASTGLEAN_EXPERIMENT_JOB'])
job = json.loads(job_path.read_bytes())
assert sys.argv[1:] == ['--exact', 'chapter_analysis::experiment::protocol_experiment_bridge', '--ignored', '--nocapture']
assert job['op'] == 'call' and job['low'] is True
payload = json.loads(job['user'])
assert not {'gold', 'reviewGold', 'annotation'} & payload.keys()
config = json.loads(Path(job['configPath']).read_bytes())
control = config.get('controlledFixture', {})
connection = next(c['connection'] for c in config['connections'] if c['connection']['id'] == job['selection']['connectionId'])
model = next(m['modelId'] for m in connection['models'] if m['id'] == job['selection']['modelId'])
marker = job_path.parent.parent / f'child-{os.getpid()}.json'
marker_pending = marker.with_suffix('.pending')
marker_pending.write_text(json.dumps({'pid': os.getpid(), 'low': True, 'readOnly': 'gold' not in payload,
                              'hasSchema': 'properties' in job['schema'], 'task': 'analysis' if 'range' in payload else 'review'}))
marker_pending.replace(marker)
time.sleep(control.get('delayMs', 0) / 1000)
mode = control.get('failure')
if mode == 'exit':
    print('PRIVATE ERROR MUST NOT ESCAPE', file=sys.stderr)
    sys.exit(9)
if mode == 'provider':
    result = {'ok': False, 'error': 'PRIVATE ERROR MUST NOT ESCAPE'}
elif mode == 'malformed':
    job_path.with_suffix('.result.json').write_text('PRIVATE INVALID RESPONSE')
    sys.exit(0)
else:
    if 'range' in payload:
        item = payload['range']
        props = job['schema']['$defs']['Segment']['properties']
        assert min(props['start']['enum']) == item['start']
        assert max(props['end']['enum']) == item['end']
        assert all(item['start'] <= n < item['end'] for n in props['start']['enum'])
        assert all(item['start'] < n <= item['end'] for n in props['end']['enum'])
        text = json.dumps({'segments': [dict(item, kind='narration', speaker='narrator', evidence=[item])]})
    else:
        assert [t['id'] for t in payload['targets']] == [f's{i+1}' for i in range(len(payload['segments']))]
        text = '{"issues":[]}'
    result = {'ok': True, 'text': text, 'elapsedMs': control.get('delayMs', 0),
              'usage': {'input_tokens': 11, 'output_tokens': 7, 'cached_input_tokens': 3, 'reasoning_tokens': 2},
              'model': 'WRONG-MODEL' if mode == 'model' else model}
    if control.get('unknownUsage'):
        result.pop('usage')
    if mode == 'revision':
        connection['revision'] += 1
        Path(job['configPath']).write_text(json.dumps(config))
job_path.with_suffix('.result.json').write_text(json.dumps(result))
