#!/usr/bin/env python3
"""Native Rig+Tokio adapter. Only explicit evaluation invokes the ignored Rust bridge."""
import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys
import tempfile


def canonical_trace(document):
    spans = []
    for raw in document.get('runs', []) + document.get('spans', []):
        span = {k: raw[k] for k in ('runId', 'spanId', 'parentSpanId', 'stage', 'route', 'attempt', 'status', 'elapsedMs')}
        span['status'] = {'waiting_for_input': 'completed', 'succeeded': 'completed', 'running': 'interrupted'}.get(span['status'], span['status'])
        span['startedAt'] = dt.datetime.fromtimestamp(raw['startedAt']/1000, dt.timezone.utc).isoformat()
        span['isRequest'] = raw.get('isRequest', False)
        if span['isRequest']:
            span['requestId'] = span['spanId']
            span['metadata'] = {k: raw[k] for k in ('model', 'configurationHash', 'promptVersion', 'promptHash', 'protocolVersion', 'sourceHash')}
            span['usage'] = raw['usage']
        spans.append(span)
    return spans


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--binding', type=Path, required=True, help='explicit selection or frozen configuration JSON; never a credential')
    args = parser.parse_args()
    case = json.loads(sys.stdin.buffer.readline())
    if 'gold' in case or 'reviewGold' in case:
        raise ValueError('adapter input must not include answers')
    binding = json.loads(args.binding.read_text())
    selection = binding.get('selection') or binding['configuration']['selection']
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location('chapter_experiment_bridge', root/'scripts/experiments/chapter_protocol.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = root/'src-tauri/target/ai-evaluation'
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='native-', dir=output) as temp:
        result = module.bridge(args.binary.resolve(), Path(temp), {
            'op': 'evaluate', 'configPath': str(args.config.resolve()), 'selection': selection, 'case': case,
        })
    result['trace'] = canonical_trace(result['trace'])
    print(json.dumps(result, ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    main()
