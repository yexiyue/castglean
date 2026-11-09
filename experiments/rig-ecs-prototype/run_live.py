#!/usr/bin/env python3
"""Explicit native live suite runner; Python never opens the credential store or LLM config."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import uuid

sys.dont_write_bytecode = True
PACKAGE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shared-root', required=True, type=Path)
    parser.add_argument('--live-config', required=True, type=Path)
    parser.add_argument('--split', required=True, choices=['development', 'holdout'])
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--recommended-report', type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.live_config.read_bytes())
    if manifest.get('controlledHelper', False):
        raise ValueError('controlled helper cannot produce live evidence')
    output = (args.output_dir or PACKAGE/'target/live-evaluation'/f'{args.split}-{uuid.uuid4()}').resolve()
    output.relative_to((PACKAGE/'target').resolve())
    output.mkdir(parents=True)
    binary = PACKAGE/'target/debug/rig-ecs-prototype'
    inspected = subprocess.run([str(binary), '--inspect-live-config', str(args.live_config.resolve())],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    inspection = json.loads(inspected.stdout)
    assert inspection['requestsStarted'] == 0 and inspection['identityScope'] == 'known-only'
    shared = args.shared_root.resolve()
    spec = importlib.util.spec_from_file_location('shared_evaluate', shared/'scripts/ai_eval/evaluate.py')
    evaluator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluator)
    cases, identity = evaluator.load_dataset(shared/'evaluations/chapter-analysis-v1', args.split)
    manifest['bridgeIdentity'] = inspection['helperIdentity']
    frozen_manifest = output/'native-binding.json'
    evaluator.write_json(frozen_manifest, manifest)
    frozen_manifest.chmod(0o600)
    argv = [str(binary), '--live-config', str(frozen_manifest),
            '--checkpoint-dir', str(output/'checkpoints'), '--dataset-hash', identity['datasetHash'],
            '--dataset-version', identity['datasetVersion']]
    evaluator.write_json(output/'plan.json', {'mode': 'live', 'workers': 1, 'maxRequestsInFlight': 3,
                        'binding': inspection['binding'], 'identityScope': 'known-only', 'dataset': identity,
                        'adapterBinaryHash': hashlib.sha256(binary.read_bytes()).hexdigest()})
    # One case process at a time, at most three agent requests; 600s each + a serial review.
    results, execution = evaluator.run_adapter(cases, argv, timeout=1250, workers=1)
    report = evaluator.score(cases, identity, results, mode='live', execution=execution)
    evaluator.write_json(output/'adapter-results.json', results)
    evaluator.write_json(output/'report.json', report)
    evaluator.write_json(output/'binding.json', inspection)
    if args.recommended_report:
        recommended = evaluator.read_json(args.recommended_report)
        # The shared comparator rejects mismatched config, dataset, split and selection.
        comparison = evaluator.compare(recommended, report)
        evaluator.write_json(output/'comparison.json', comparison)
    print(json.dumps({'output': str(output), 'mode': report['mode'], 'summary': report['summary'],
                      'configurationIdentity': report['configurationIdentity'],
                      'requestCount': report['observability']['requestCountKnown'],
                      'peakConcurrency': report['observability']['peakConcurrencyObserved']}, indent=2))


if __name__ == '__main__':
    main()
