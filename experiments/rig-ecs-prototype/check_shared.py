#!/usr/bin/env python3
"""Exercise ECS through the owning shared evaluator; never define new quality scores."""
import argparse
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

sys.dont_write_bytecode = True
PACKAGE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shared-root', required=True, type=Path)
    args = parser.parse_args()
    shared = args.shared_root.resolve()
    output = PACKAGE / 'target' / 'shared-checks' / str(uuid.uuid4())
    output.mkdir(parents=True)
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    # The shared suite owns correctness of the scoring/trace/frozen dataset machinery.
    subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s',
                    str(shared / 'scripts/ai_eval'), '-p', 'test_*.py'],
                   env=environment, check=True)
    spec = importlib.util.spec_from_file_location('shared_evaluate', shared / 'scripts/ai_eval/evaluate.py')
    evaluator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluator)
    cases, identity = evaluator.load_dataset(shared / 'evaluations/chapter-analysis-v1')
    binary = PACKAGE / 'target/debug/rig-ecs-prototype'
    argv = [str(binary), '--smoke-narrator', '--checkpoint-dir', str(output / 'checkpoints'),
            '--dataset-hash', identity['datasetHash'], '--dataset-version', identity['datasetVersion']]
    results, execution = evaluator.run_adapter(cases, argv, timeout=20, workers=1)
    report = evaluator.score(cases, identity, results, mode='mock',
                             configuration_identity='controlled-all-narration-policy-v1', execution=execution)
    baseline_results, baseline_execution = evaluator.run_adapter(
        cases, [sys.executable, str(shared / 'scripts/ai_eval/mock_adapter.py')], workers=1)
    baseline = evaluator.score(cases, identity, baseline_results, mode='mock',
                               configuration_identity='controlled-all-narration-policy-v1', execution=baseline_execution)
    comparison = evaluator.compare(baseline, report)
    assert report['summary']['validCases'] == len(cases), report['summary']
    assert report['summary'] == baseline['summary'], 'identical weak baseline semantics must score identically'
    assert report['summary']['review']['completed'] == len(cases), 'independent review task must complete'
    assert report['observability']['peakConcurrencyObserved'] >= 3
    assert comparison['comparable'] and not comparison['qualityComparisonIsLive']
    assert all(value == 0 for value in comparison['delta'].values())
    assert all(result.get('identityScope') == 'known-only' and not result.get('identityDiscoveryEvaluated') for result in results)
    configuration_hashes = sorted({m['configurationHash'] for m in report['observability']['requestMetadata']})
    assert len(configuration_hashes) == 1, 'model configuration must not vary with case/script/route'
    assert report['observability']['requestCountKnown'] == len(cases) * 5
    # A handled failure must reach the scorer with its own trace, not be lost as adapter_exit.
    failure_checks = []
    for option, expected in [('--timeout-ms', 'timeout'), ('--cancel-after-ms', 'cancelled')]:
        failed_argv = [str(binary), '--smoke-narrator', '--checkpoint-dir', str(output / expected),
                       '--dataset-hash', identity['datasetHash'], '--dataset-version', identity['datasetVersion'], option, '1']
        failed_results, _ = evaluator.run_adapter(cases[:1], failed_argv, timeout=20, workers=1)
        row, spans = evaluator.case_score(cases[0], failed_results[0])
        assert row['failure'] == expected and not row['valid'], row
        assert any(span.get('isRequest') for span in spans), 'failure cannot silently become zero requests'
        failure_checks.append({'scenario': expected, 'failure': row['failure'], 'hasRequestTrace': True})
    evaluator.write_json(output / 'failure-checks.json', failure_checks)
    for name, value in [('ecs-report.json', report), ('baseline-report.json', baseline),
                        ('comparison.json', comparison), ('adapter-results.json', results)]:
        evaluator.write_json(output / name, value)
    summary = {'output': str(output), 'datasetHash': identity['datasetHash'],
               'goldHash': identity['goldHash'], 'summary': report['summary'],
               'peakConcurrency': report['observability']['peakConcurrencyObserved'],
               'offlineOnly': True, 'comparable': comparison['comparable'],
               'identityScope': 'known-only', 'configurationHashes': configuration_hashes,
               'adapterBinaryHash': hashlib.sha256(binary.read_bytes()).hexdigest()}
    evaluator.write_json(output / 'verification.json', summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
