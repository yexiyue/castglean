#!/usr/bin/env python3
"""Kill the adapter after two durable child results; reopen without replaying the third."""
import hashlib
import json
from pathlib import Path
import subprocess
import time
import uuid

PACKAGE = Path(__file__).resolve().parent


def main():
    output = PACKAGE / 'target/process-recovery' / str(uuid.uuid4())
    output.mkdir(parents=True)
    text = '甲说。乙答。风起。'
    case = {'version': 1, 'caseId': 'process-recovery', 'evaluationTask': 'pipeline',
            'source': {'text': text, 'sha256': hashlib.sha256(text.encode()).hexdigest()},
            'characters': [{'id': 'c1', 'name': '甲'}, {'id': 'c2', 'name': '乙'}]}
    checkpoint = output / 'checkpoint.json'
    argv = [str(PACKAGE / 'target/debug/rig-ecs-prototype'), '--smoke-narrator',
            '--smoke-delay-ms', '10,40,5000,10', '--checkpoint', str(checkpoint)]
    payload = (json.dumps(case, ensure_ascii=False) + '\n').encode()
    process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    process.stdin.write(payload)
    process.stdin.close()
    deadline = time.monotonic() + 8
    killed = False
    try:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise AssertionError('process exited before two durable results')
            if checkpoint.exists():
                journal = json.loads(checkpoint.read_bytes())
                states = [slot['state'] for slot in journal['slots']]
                if states[:3] == ['completed', 'completed', 'in_flight']:
                    process.kill()
                    killed = True
                    break
            time.sleep(.002)
        assert killed, 'did not observe two completed and one in-flight child'
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
    resumed = subprocess.run(argv, input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=True)
    result = json.loads(resumed.stdout)
    journal = json.loads(checkpoint.read_bytes())
    assert result['status'] == 'interrupted'
    assert result['requestCount'] == 0
    assert result['reusedSubresults'] == 2
    assert journal['slots'][2]['state'] == 'unknown'
    assert all(span['status'] != 'running' for span in result['trace'])
    assert all(span['usage']['inputTokens'] is None for span in result['trace'])
    summary = {'killedAfterCompletedChildren': 2, 'originalExit': process.returncode,
               'resumeStatus': result['status'], 'newModelRequests': result['requestCount'],
               'reusedSubresults': result['reusedSubresults'], 'thirdChildState': 'unknown'}
    (output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(dict(output=str(output), **summary), indent=2))


if __name__ == '__main__':
    main()
