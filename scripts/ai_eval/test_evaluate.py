"""Offline adversarial tests. Oracle results here are never live quality evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('chapter_eval', ROOT / 'scripts/ai_eval/evaluate.py')
E = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(E)


def oracle(case, route='recommended', usage=None):
    segments = []
    for unit in case['gold']:
        segments.append({'start': unit['start'], 'end': unit['end'], 'kind': unit['kind'],
                         'speaker': unit['speakers'][0], 'evidence': [{'start': unit['start'], 'end': unit['end']}]})
    issues = [{'start': i['start'], 'end': i['end'], 'suggestion': {'kind': i['kind'], 'speaker': i['speakers'][0]}}
              for i in case.get('reviewGold', {}).get('issues', [])]
    return {'version': 1, 'caseId': case['caseId'], 'route': route, 'status': 'completed',
            'segments': segments, 'review': {'status': 'completed', 'issues': issues},
            'trace': [{'runId': case['caseId'] + '-run', 'spanId': 'r1', 'parentSpanId': None,
                       'stage': 'analysis', 'route': route, 'attempt': 1, 'status': 'completed',
                       'startedAt': '2026-11-08T08:00:00Z', 'elapsedMs': 100,
                       'isRequest': True, 'metadata': {'model': 'offline-oracle', 'configurationHash': 'config1',
                       'promptVersion': 'p1', 'promptHash': 'hash1', 'protocolVersion': 'v1',
                       'sourceHash': case['source']['sha256']}, 'usage': usage}]}


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.cases, self.identity = E.load_dataset()
        self.results = [oracle(c) for c in self.cases]

    def report(self, results=None):
        return E.score(self.cases, self.identity, self.results if results is None else results, mode='mock')

    def comparison_results(self):
        results = copy.deepcopy(self.results)
        for case, result in zip(self.cases, results):
            if 'reviewGold' in case:
                review_trace = copy.deepcopy(result['trace'])
                for span in review_trace:
                    span['runId'] += '-seeded-review'
                    span['stage'] = 'review'
                result['reviewTrace'] = review_trace
        return results

    def test_frozen_complete_gold_and_splits(self):
        report = self.report()
        self.assertEqual(report['summary']['unitAccuracy'], 1)
        self.assertEqual(report['summary']['byteAccuracy'], 1)
        self.assertEqual(report['splits']['development']['cases'], 7)
        self.assertEqual(report['splits']['holdout']['cases'], 3)
        self.assertEqual(report['qualityEvidence'], 'offline-only')
        self.assertEqual(report['summary']['review']['missed'], 0)

    def test_ambiguous_json_and_nan_rejected(self):
        for text in ['{"caseId":"a","caseId":"b"}', '{"elapsedMs":NaN}']:
            with self.assertRaises(E.Invalid):
                E.parse_json(text)

    def test_missing_cases_are_in_denominator(self):
        report = self.report(self.results[:1])
        self.assertEqual(report['summary']['cases'], 10)
        self.assertEqual(report['summary']['validCases'], 1)
        self.assertEqual(report['summary']['failures']['missing'], 9)
        self.assertLess(report['summary']['unitAccuracy'], 1)
        self.assertGreater(report['summary']['review']['missed'], 0)

    def test_duplicate_and_unplanned_cases_rejected(self):
        for results in [self.results + self.results[:1], [dict(self.results[0], caseId='not-planned')]]:
            with self.assertRaises(E.Invalid):
                self.report(results)

    def test_silent_bad_outputs_rejected(self):
        mutations = []
        bad = copy.deepcopy(self.results[0]); bad['segments'][0]['start'] = 1
        mutations.append((bad, 'coordinates'))
        bad = copy.deepcopy(self.results[0]); bad['segments'].pop()
        mutations.append((bad, 'coverage'))
        bad = copy.deepcopy(self.results[0]); bad['segments'][1]['speaker'] = '岚'
        mutations.append((bad, 'identity'))
        bad = copy.deepcopy(self.results[0]); bad['segments'][1]['speaker'] = 'narrator'
        mutations.append((bad, 'attribution'))
        bad = copy.deepcopy(self.results[0]); bad['segments'][0]['evidence'][0]['end'] = 1
        mutations.append((bad, 'evidence'))
        bad = copy.deepcopy(self.results[0]); bad['segments'][0]['evidence'] = []
        mutations.append((bad, 'evidence'))
        bad = copy.deepcopy(self.results[0]); bad['segments'][1]['start'] = 0
        mutations.append((bad, 'coverage'))
        bad = copy.deepcopy(self.results[0]); bad['segments'][1]['candidates'] = ['c-lan', 'c-lan']; bad['segments'][1]['speaker'] = 'unknown'
        mutations.append((bad, 'identity'))
        for bad, failure in mutations:
            with self.subTest(failure=failure):
                row, _ = E.case_score(self.cases[0], bad)
                self.assertFalse(row['valid'])
                self.assertEqual(row['failure'], failure)
                self.assertEqual(row['bytesCorrect'], 0)

    def test_same_name_is_not_same_identity(self):
        case = self.cases[2]
        bad = oracle(case)
        bad['segments'][3]['speaker'] = 'c-qiao-doctor'
        row, _ = E.case_score(case, bad)
        self.assertTrue(row['valid'])
        self.assertEqual(row['unitsCorrect'], row['unitsTotal'] - 1)

    def test_split_segments_still_score_fixed_units(self):
        case = self.cases[0]
        result = oracle(case)
        first = result['segments'][0]
        cut = len(case['source']['text'][0].encode('utf-8'))
        result['segments'][:1] = [dict(first, end=cut), dict(first, start=cut)]
        row, _ = E.case_score(case, result)
        self.assertTrue(row['valid'])
        self.assertEqual(row['unitsCorrect'], row['unitsTotal'])

    def test_parent_metadata_does_not_double_count_request_usage(self):
        request = self.results[0]['trace'][0]
        request['usage'] = {'inputTokens': 100, 'outputTokens': 20}
        parent = copy.deepcopy(request)
        parent.update(spanId='stage-parent', isRequest=False)
        request['parentSpanId'] = 'stage-parent'
        self.results[0]['trace'].append(parent)
        obs = self.report()['observability']
        self.assertEqual(obs['requestCountKnown'], 10)
        self.assertEqual(obs['usage']['inputTokens']['knownTotal'], 100)

    def test_unknown_usage_not_free_and_cache_not_extra_input(self):
        self.results[0]['trace'][0]['usage'] = {'inputTokens': 100, 'outputTokens': 20, 'cachedInputTokens': 80}
        self.results[1]['status'] = 'failed'
        self.results[1]['failureKind'] = 'timeout'
        self.results[1]['trace'][0]['status'] = 'timeout'
        obs = self.report()['observability']
        self.assertEqual(obs['usage']['inputTokens'], {'knownTotal': 100, 'knownRequests': 1, 'unknownRequests': 9})
        self.assertEqual(obs['usage']['cachedInputTokens']['knownTotal'], 80)
        self.assertFalse(obs['usageComplete'])
        self.assertEqual(obs['requestCountKnown'], 10)
        self.assertEqual(self.report()['summary']['failures']['timeout'], 1)
        obs = self.report([])['observability']
        self.assertFalse(obs['requestCountComplete'])
        self.assertEqual(len(obs['requestAccountingUnknownCases']), 10)
        self.assertIsNone(obs['peakConcurrencyObserved'])

    def test_request_concurrency_and_end_to_end(self):
        # All ten fixture request spans overlap; this is trace time, not Python replay time.
        obs = self.report()['observability']
        self.assertEqual(obs['peakConcurrencyObserved'], 10)
        self.assertEqual(obs['endToEndByCase'][0]['elapsedMs'], 100)
        self.assertEqual(obs['stages']['analysis']['spanCount'], 10)
        self.results[1]['trace'][0]['startedAt'] = '2026-11-08T08:00:00.100Z'
        self.assertEqual(self.report()['observability']['peakConcurrencyObserved'], 9)

    def test_trace_invalid_parent_source_and_duplicate_request(self):
        for key, value in [('parentSpanId', 'absent'), ('elapsedMs', -1), ('attempt', 0)]:
            bad = copy.deepcopy(self.results[0]); bad['trace'][0][key] = value
            row, _ = E.case_score(self.cases[0], bad)
            self.assertFalse(row['valid'])
        bad = copy.deepcopy(self.results[0]); bad['trace'][0]['metadata']['sourceHash'] = 'wrong'
        self.assertEqual(E.case_score(self.cases[0], bad)[0]['failure'], 'request_source_hash')
        duplicate = copy.deepcopy(self.results[0]['trace'][0]); duplicate['spanId'] = 'r2'
        duplicate['requestId'] = 'same'; self.results[0]['trace'][0]['requestId'] = 'same'
        self.results[0]['trace'].append(duplicate)
        with self.assertRaisesRegex(E.Invalid, 'duplicate_request'):
            self.report()

    def test_invalid_cache_and_boolean_coordinates(self):
        bad = copy.deepcopy(self.results[0]); bad['trace'][0]['usage'] = {'inputTokens': 1, 'cachedInputTokens': 2}
        self.assertEqual(E.case_score(self.cases[0], bad)[0]['failure'], 'usage_cache')
        bad = copy.deepcopy(self.results[0]); bad['segments'][0]['start'] = False
        self.assertEqual(E.case_score(self.cases[0], bad)[0]['failure'], 'coordinates')

    def test_review_detections_false_positives_and_bad_suggestions(self):
        case = self.cases[0]
        result = oracle(case)
        hit = result['review']['issues'][0]
        hit['suggestion']['speaker'] = 'unknown'
        clean = case['gold'][0]
        result['review']['issues'] += [copy.deepcopy(hit), {'start': clean['start'], 'end': clean['end']}, {'start': 1, 'end': 2}]
        r = E.review_score(case, result)
        self.assertEqual((r['detected'], r['missed'], r['falsePositives'], r['validSuggestions']), (1, 0, 3, 0))
        self.assertEqual(r['invalidIssueRanges'], 1)
        result['review']['issues'] = [{'start': 0, 'end': len(case['source']['text'].encode('utf-8'))}]
        r = E.review_score(case, result)
        self.assertEqual((r['detected'], r['missed'], r['falsePositives']), (0, 1, 1))

    def test_clean_review_case_detects_false_alarm(self):
        case = self.cases[5]
        result = oracle(case)
        result['review']['issues'] = [{'start': 0, 'end': case['gold'][0]['end']}]
        self.assertEqual(E.review_score(case, result)['falsePositives'], 1)
        self.assertEqual(E.review_score(case, {'review': None})['completed'], 0)

    def test_review_gold_cannot_let_judge_define_truth(self):
        bad = copy.deepcopy(self.cases)
        bad[0]['reviewGold']['issues'] = []
        with self.assertRaisesRegex(E.Invalid, 'review_gold_injection_mismatch'):
            E.validate_cases(bad)
        bad = copy.deepcopy(self.cases)
        bad[0]['reviewGold']['issues'][0]['speakers'] = ['unknown']
        with self.assertRaisesRegex(E.Invalid, 'review_gold_not_gold'):
            E.validate_cases(bad)

    def test_frozen_hash_detects_source_gold_and_character_drift(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp)
            for filename in ('manifest.json', 'cases.jsonl'):
                (target / filename).write_bytes((E.DEFAULT_DATASET / filename).read_bytes())
            cases = copy.deepcopy(self.cases)
            cases[0]['characters'][0]['name'] = '改名'
            (target / 'cases.jsonl').write_bytes(b'\n'.join(E.canonical(c) for c in cases))
            with self.assertRaisesRegex(E.Invalid, 'frozen_dataset_mismatch'):
                E.load_dataset(target)
        bad = copy.deepcopy(self.cases); bad[0]['gold'][0]['end'] -= 1
        with self.assertRaises(E.Invalid):
            E.validate_cases(bad)

    def test_compare_rejects_datasets_case_selection_and_config(self):
        report = self.report(self.comparison_results())
        for field, value in [('datasetHash', 'other'), ('goldHash', 'other'), ('caseIds', []), ('datasetVersion', 'v2')]:
            other = copy.deepcopy(report); other['dataset'][field] = value
            with self.assertRaises(E.Invalid):
                E.compare(report, other)
        other = copy.deepcopy(report); other['configurationIdentity'] = ['other']
        with self.assertRaises(E.Invalid):
            E.compare(report, other)
        unknown = self.report([])
        with self.assertRaises(E.Invalid):
            E.compare(unknown, unknown)

    def test_compare_lists_route_prompt_protocol_and_mode(self):
        results = self.comparison_results()
        report = self.report(results)
        other_results = copy.deepcopy(results)
        for result in other_results:
            result['route'] = 'rig-ecs'
            for span in result['trace'] + result['reviewTrace']:
                span['route'] = 'rig-ecs'
        other_results[0]['trace'][0]['metadata']['promptHash'] = 'p2'
        other_results[0]['trace'][0]['metadata']['protocolVersion'] = 'v2'
        other = E.score(self.cases, self.identity, other_results, mode='replay')
        comparison = E.compare(report, other)
        self.assertEqual(set(comparison['differences']), {'routes', 'mode', 'promptHash', 'protocolVersion', 'caseStageMetadata'})
        self.assertFalse(comparison['qualityComparisonIsLive'])

    def test_adapter_receives_no_gold_and_argv_is_not_shell(self):
        with tempfile.TemporaryDirectory() as temp:
            adapter = Path(temp) / 'adapter.py'
            adapter.write_text('''import json, sys
v=json.loads(sys.stdin.readline())
assert set(v) == ({'version','caseId','split','source','characters','evaluationTask'} | ({'reviewInput'} if v['evaluationTask'] == 'review' else set()))
assert 'gold' not in v and 'reviewGold' not in v and 'annotation' not in v
assert sys.argv[1] == '; echo SHOULD_NOT_RUN'
print(json.dumps({'version':1,'caseId':v['caseId'],'route':'test','status':'failed','segments':[], 'review':{'status':'failed','issues':[]},'trace':[]}))
''')
            results, execution = E.run_adapter(self.cases[:2], [sys.executable, str(adapter), '; echo SHOULD_NOT_RUN'], timeout=5, workers=2)
            self.assertTrue(all(c['failureKind'] is None for c in execution['cases']))
            self.assertEqual(len(results), 2)
            self.assertEqual([x['task'] for x in execution['cases']], ['analysis', 'review', 'analysis', 'review'])
            self.assertIn('1', execution['adapterFileHashesByArgIndex'])

    def test_timeout_and_adapter_parse_failure_preserve_cost_unknown(self):
        for program, reason in [('import time; time.sleep(2)', 'timeout'), ('print("not json")', 'parse'), ('raise SystemExit(3)', 'adapter_exit')]:
            results, execution = E.run_adapter(self.cases[:1], [sys.executable, '-c', program], timeout=0.1)
            self.assertEqual(execution['cases'][0]['failureKind'], reason)
            report = E.score(self.cases, self.identity, results, mode='mock')
            self.assertEqual(report['summary']['failures'][reason], 1)
            self.assertFalse(report['observability']['usageComplete'])
            self.assertEqual(len(report['observability']['requestAccountingUnknownCases']), 10)

    def test_analysis_input_isolated_from_seeded_review(self):
        case = self.cases[0]
        self.assertNotIn('reviewInput', E.adapter_input(case))
        self.assertIn('reviewInput', E.adapter_input(case, 'review'))
        self.assertNotIn('gold', E.adapter_input(case, 'review'))
        result = oracle(case)
        review = oracle(case)
        review['trace'][0]['runId'] += '-review'
        result['reviewTrace'] = review['trace']
        before = copy.deepcopy(result)
        row, spans = E.case_score(case, result)
        self.assertTrue(row['valid'])
        self.assertEqual(row['review']['detected'], 1)
        self.assertEqual(len(spans), 2)
        self.assertEqual(result, before)
        result['reviewTrace'] = []
        row, spans = E.case_score(case, result)
        self.assertTrue(row['valid'])
        self.assertEqual(row['review']['detected'], 0)
        self.assertTrue(row['reviewTraceFailure'])

    def test_mock_cannot_claim_live_evidence(self):
        result = dict(self.results[0], mode='mock')
        with self.assertRaisesRegex(E.Invalid, 'cannot_be_live'):
            E.score(self.cases, self.identity, [result], mode='live')

    def test_cli_mock_roundtrip_and_replay_comparison(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'report.json'
            command = [sys.executable, str(ROOT / 'scripts/ai_eval/evaluate.py')]
            run = subprocess.run(command + ['run', '--mode', 'mock', '--split', 'development',
                '--output', str(output), '--adapter', sys.executable, str(ROOT / 'scripts/ai_eval/mock_adapter.py')],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            self.assertEqual(run.returncode, 0, run.stderr)
            report = E.read_json(output)
            self.assertEqual(list(Path(temp).iterdir()), [output])
            self.assertEqual(report['summary']['validCases'], 7)
            self.assertEqual(report['summary']['review']['detected'], 0)
            self.assertEqual(report['qualityEvidence'], 'offline-only')
            self.assertEqual(len(report['execution']['cases']), 14)
            self.assertEqual(report['observability']['requestCountKnown'], 0)
            self.assertFalse(report['observability']['usageComplete'])
            results = Path(temp) / 'results.jsonl'
            results.write_bytes(b'\n'.join(E.canonical(r) for r in self.comparison_results()))
            replay = Path(temp) / 'replay.json'
            run = subprocess.run(command + ['score', '--mode', 'replay', '--results', str(results),
                '--output', str(replay)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(E.read_json(replay)['summary']['unitAccuracy'], 1)
            run = subprocess.run(command + ['compare', str(replay), str(replay)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertFalse(json.loads(run.stdout)['qualityComparisonIsLive'])

    def test_compare_rejects_configurations_swapped_between_cases(self):
        left_results = self.comparison_results()
        for span in left_results[1]['trace'] + left_results[1]['reviewTrace']:
            span['metadata']['configurationHash'] = 'config2'
        right_results = copy.deepcopy(left_results)
        for n, config in [(0, 'config2'), (1, 'config1')]:
            for span in right_results[n]['trace'] + right_results[n]['reviewTrace']:
                span['metadata']['configurationHash'] = config
        for override in (None, 'same-declared-configuration'):
            with self.subTest(override=override):
                left = E.score(self.cases, self.identity, left_results, configuration_identity=override)
                right = E.score(self.cases, self.identity, right_results, configuration_identity=override)
                self.assertEqual(left['configurationIdentity'], right['configurationIdentity'])
                with self.assertRaisesRegex(E.Invalid, 'incomparable_case_task_configuration'):
                    E.compare(left, right)

    def test_compare_rejects_configurations_swapped_between_tasks(self):
        left_results = self.comparison_results()
        left_results[0]['reviewTrace'][0]['metadata']['configurationHash'] = 'config2'
        right_results = copy.deepcopy(left_results)
        right_results[0]['trace'][0]['metadata']['configurationHash'] = 'config2'
        right_results[0]['reviewTrace'][0]['metadata']['configurationHash'] = 'config1'
        with self.assertRaisesRegex(E.Invalid, 'incomparable_case_task_configuration'):
            E.compare(self.report(left_results), self.report(right_results))

    def test_compare_allows_different_fanout_and_request_stages(self):
        left_results = self.comparison_results()
        right_results = copy.deepcopy(left_results)
        extra = copy.deepcopy(right_results[0]['trace'][0])
        extra['spanId'] = 'r2'
        right_results[0]['trace'].append(extra)
        left, right = self.report(left_results), self.report(right_results)
        self.assertEqual(right['observability']['requestCountKnown'], left['observability']['requestCountKnown'] + 1)
        self.assertTrue(E.compare(left, right)['comparable'])
        extra['stage'] = 'identity'
        extra['metadata']['promptHash'] = 'identity-prompt'
        compared = E.compare(left, self.report(right_results))
        self.assertTrue(compared['comparable'])
        changes = compared['differences']['caseStageMetadata']
        self.assertEqual((changes[0]['caseId'], changes[0]['task'], changes[0]['stage']),
                         (self.cases[0]['caseId'], 'analysis', 'identity'))

    def test_compare_reports_prompt_swap_by_case_even_with_same_global_set(self):
        left_results = self.comparison_results()
        left_results[0]['trace'][0]['metadata']['promptHash'] = 'prompt-a'
        left_results[1]['trace'][0]['metadata']['promptHash'] = 'prompt-b'
        right_results = copy.deepcopy(left_results)
        right_results[0]['trace'][0]['metadata']['promptHash'] = 'prompt-b'
        right_results[1]['trace'][0]['metadata']['promptHash'] = 'prompt-a'
        compared = E.compare(self.report(left_results), self.report(right_results))
        self.assertNotIn('promptHash', compared['differences'])
        changes = compared['differences']['caseStageMetadata']
        self.assertEqual({r['caseId'] for r in changes}, {c['caseId'] for c in self.cases[:2]})
        self.assertTrue(all(r['stage'] == 'analysis' and 'promptHash' in r['differences'] for r in changes))

    def test_compare_reports_prompt_swap_between_stages(self):
        left_results = self.comparison_results()
        extra = copy.deepcopy(left_results[0]['trace'][0])
        extra.update(spanId='identity-request', stage='identity')
        extra['metadata']['promptHash'] = 'identity-prompt'
        left_results[0]['trace'].append(extra)
        right_results = copy.deepcopy(left_results)
        right_results[0]['trace'][0]['metadata']['promptHash'] = 'identity-prompt'
        right_results[0]['trace'][1]['metadata']['promptHash'] = 'hash1'
        compared = E.compare(self.report(left_results), self.report(right_results))
        self.assertEqual({r['stage'] for r in compared['differences']['caseStageMetadata']}, {'identity', 'analysis'})

    def test_explicit_configuration_does_not_make_missing_trace_observed(self):
        known = E.score(self.cases, self.identity, self.comparison_results(), configuration_identity='frozen')
        unknown = E.score(self.cases, self.identity, [], configuration_identity='frozen')
        compared = E.compare(known, unknown)
        self.assertTrue(compared['comparable'])
        self.assertFalse(compared['configurationEvidenceComplete'])
        self.assertEqual(len(compared['configurationUnknownBindings']), 20)
        self.assertTrue(all(r['leftObserved'] and not r['rightObserved'] for r in compared['configurationUnknownBindings']))
        self.assertFalse(unknown['observability']['usageComplete'])
        self.assertFalse(unknown['observability']['requestCountComplete'])
        self.assertEqual(len(unknown['observability']['requestAccountingUnknownCases']), 10)
        binding = unknown['configurationBindings'][self.cases[0]['caseId']]['analysis']
        self.assertFalse(binding['observed'])
        self.assertEqual(binding['configurationHashes'], [])
        self.assertFalse(E.compare(unknown, unknown)['configurationEvidenceComplete'])

    def test_missing_case_task_configuration_requires_explicit_declaration(self):
        results = self.comparison_results()
        with self.assertRaisesRegex(E.Invalid, 'configuration_unknown'):
            E.compare(self.report(results), self.report(results[:1]))

    def test_legacy_comparison_uses_uniform_case_traces_without_changing_reports(self):
        report = self.report(self.comparison_results())
        legacy = copy.deepcopy(report)
        for field in ('comparisonBindingVersion', 'configurationBindings', 'configurationIdentitySource'):
            del legacy[field]
        for trace in legacy['observability']['traces']:
            for span in trace['spans']:
                span.pop('evaluationTask', None)
        before = copy.deepcopy(legacy)
        compared = E.compare(legacy, report)
        self.assertTrue(compared['configurationEvidenceComplete'])
        self.assertEqual(compared['configurationBindingEvidence']['left'], 'legacy-uniform-case-trace')
        self.assertEqual(legacy, before)
        legacy['observability']['traces'][0]['spans'][1]['metadata']['configurationHash'] = 'other'
        with self.assertRaisesRegex(E.Invalid, 'legacy_configuration_evidence'):
            E.compare(legacy, report)
        legacy = copy.deepcopy(before)
        legacy['observability']['traces'][0]['spans'] = []
        legacy['configurationIdentitySource'] = 'explicit'
        with self.assertRaisesRegex(E.Invalid, 'legacy_configuration_evidence'):
            E.compare(legacy, report)

    def test_program_hash_is_frozen_before_scoring_and_not_shared_mutably(self):
        before = E.code_identity()
        with mock.patch.object(E.Path, 'read_bytes', side_effect=AssertionError('late disk hash read')):
            report = self.report()
        self.assertEqual(report['program'], before)
        report['program']['scriptHashes']['evaluate.py'] = 'mutated'
        self.assertEqual(E.code_identity(), before)

    def test_cli_results_output_can_be_rescored_without_adapter(self):
        with tempfile.TemporaryDirectory() as temp:
            report_path = Path(temp) / 'live-mock.json'
            raw_path = Path(temp) / 'adapter.jsonl'
            replay_path = Path(temp) / 'replay.json'
            command = [sys.executable, str(ROOT / 'scripts/ai_eval/evaluate.py')]
            run = subprocess.run(command + ['run', '--mode', 'mock', '--split', 'development',
                '--output', str(report_path), '--results-output', str(raw_path), '--adapter', sys.executable,
                str(ROOT / 'scripts/ai_eval/mock_adapter.py')], capture_output=True, check=False)
            self.assertEqual(run.returncode, 0, run.stderr)
            run = subprocess.run(command + ['score', '--mode', 'replay', '--split', 'development',
                '--results', str(raw_path), '--output', str(replay_path)], capture_output=True, check=False)
            self.assertEqual(run.returncode, 0, run.stderr)
            original, replay = E.read_json(report_path), E.read_json(replay_path)
            self.assertEqual(original['summary'], replay['summary'])
            self.assertEqual(original['configurationBindings'], replay['configurationBindings'])
            self.assertEqual(original['execution']['resultsHash'], replay['execution']['resultsHash'])
            self.assertEqual(replay['mode'], 'replay')
            self.assertEqual(len(E.read_jsonl(raw_path)), 7)

    def test_summary_contains_no_source_or_names_or_raw_diagnostics(self):
        report = self.report()
        rendered = json.dumps(report, ensure_ascii=False)
        for case in self.cases:
            self.assertNotIn(case['source']['text'], rendered)
            for char in case['characters']:
                self.assertNotIn('"' + char['name'] + '"', rendered)
        self.assertIn('codeHash', report['program'])


if __name__ == '__main__':
    unittest.main()
