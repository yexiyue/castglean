#!/usr/bin/env python3
"""Controlled all-narration baseline for transport smoke checks, NOT model quality.

Never reads dataset files or gold. Run only with evaluate.py --mode mock.
"""
import datetime as dt
import json
import sys
import time
import uuid


def main():
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    begin = time.monotonic()
    value = json.loads(sys.stdin.buffer.readline())
    size = len(value['source']['text'].encode('utf-8'))
    task = value['evaluationTask']
    result = {'version': 1, 'mode': 'mock', 'caseId': value['caseId'], 'route': 'controlled-mock', 'status': 'completed',
              'segments': [{'start': 0, 'end': size, 'kind': 'narration', 'speaker': 'narrator',
                            'evidence': [{'start': 0, 'end': size}]}],
              'review': {'status': 'completed', 'issues': []},
              'trace': [{'runId': str(uuid.uuid4()), 'spanId': task, 'parentSpanId': None,
                         'stage': task, 'route': 'controlled-mock', 'attempt': 1, 'status': 'completed',
                         'startedAt': started, 'elapsedMs': (time.monotonic() - begin) * 1000,
                         'isRequest': False}]}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
