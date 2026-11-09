import copy
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import run_task_efficiency as runner

class TaskEfficiencyTests(unittest.TestCase):
    def case(self):
        text = '第一章 开始\n🙂\n第二章 后续\n正文'
        return {'caseId':'unicode','source':{'text':text,'sha256':hashlib.sha256(text.encode()).hexdigest()},'request':'检查','goldHeadings':[0,2]}

    def test_preflight_rejects_changed_source_and_duplicate_before_calls(self):
        case=self.case()
        self.assertEqual(runner.preflight([case]),[case])
        with self.assertRaisesRegex(ValueError,'duplicate_case'):
            runner.preflight([case,copy.deepcopy(case)])
        case['source']['text']+='x'
        with self.assertRaisesRegex(ValueError,'source_identity'):
            runner.preflight([case])

    def test_correction_hash_matches_rust_field_order_nulls_and_utf8(self):
        case = self.case()
        case['corrections'] = [{'include': True, 'line': 0, 'sourceId': '来源🙂'}]
        runner.preflight([case])
        self.assertEqual(list(case['corrections'][0]),
                         ['sourceId', 'line', 'include', 'title', 'volumeId'])
        # Literal Rust tuple/Correction wire bytes, independent of input_hash.
        wire = ('["第一章 开始\\n🙂\\n第二章 后续\\n正文","检查",'
                '[{"sourceId":"来源🙂","line":0,"include":true,"title":null,"volumeId":null}]]')
        expected = hashlib.sha256(wire.encode('utf-8')).hexdigest()
        self.assertEqual(runner.input_hash(case), expected)
        case['goldHeadings'] = [1]
        case['corrections'][0]['title'] = None
        self.assertEqual(runner.input_hash(case), expected)
        for field, value in [('request', '保留人工标题'), ('corrections', [])]:
            changed = copy.deepcopy(case)
            changed[field] = value
            self.assertNotEqual(runner.input_hash(changed), expected)

    def test_input_hash_matches_rust_case_input_golden(self):
        case = self.case()
        case['corrections'] = [{'sourceId': 'source', 'line': 1, 'include': True,
                                'title': '人工🙂', 'volumeId': None}]
        runner.preflight([case])
        self.assertEqual(runner.input_hash(case),
                         '89ddba995880d3de28b63a2ac545ee275b37fffc51cdb261203b1279c34e7e98')

    def test_corrections_preflight_rejects_invalid_shapes_and_unknown_fields(self):
        valid = {'sourceId': 'source', 'line': 0, 'include': True}
        invalid = [None, {}, [None], [{}], [dict(valid, extra=True)],
                   [dict(valid, sourceId=1)], [dict(valid, line=True)],
                   [dict(valid, line=-1)], [dict(valid, line=2**32)],
                   [dict(valid, line=0.0)], [dict(valid, include=1)],
                   [dict(valid, title=False)], [dict(valid, volumeId=[])]]
        for corrections in invalid:
            with self.subTest(corrections=corrections):
                case = dict(self.case(), corrections=corrections)
                with self.assertRaisesRegex(ValueError, 'corrections_shape'):
                    runner.preflight([case])
        case = dict(self.case(), corrections=[dict(valid, line=2**32-1,
                                                   title='人定标题', volumeId='卷🙂')])
        self.assertEqual(runner.preflight([case])[0]['corrections'][0]['title'], '人定标题')

    def test_failure_keeps_denominator_and_observed_cost(self):
        score=runner.score(self.case(),{'ok':False,'headings':[0,2]})
        self.assertFalse(score['delivered'])
        self.assertFalse(score['boundaryExact'])
        report=runner.totals([{'score':score,'meter':{'requestCount':2,'requests':[
            {'usage':{'input_tokens':20}}, {'usage':{'input_tokens':0}}]},'wallMs':30}])
        self.assertEqual(report['attempted'],1)
        self.assertEqual(report['inputTokens']['total'],20)
        self.assertIsNone(report['outputTokens']['total'])
        self.assertEqual(report['outputTokens']['unknownCases'],1)

    def test_private_reference_agreement_is_not_human_semantic_accuracy(self):
        case=self.case()
        case['referenceHeadings']=case.pop('goldHeadings')
        case['referenceOrigin']='existing-directory'
        score=runner.score(case,{'ok':True,'headings':[0,2]})
        self.assertTrue(score['boundaryExact'])
        self.assertEqual(score['semanticQuality'],'unmeasured')

    def test_continuation_count_never_fabricates_token_savings(self):
        result={'score':{'delivered':True,'boundaryExact':True},'wallMs':1,'meter':{'requestCount':1,'continuations':[{'reason':'accepted_task'}]}}
        report=runner.totals([result])
        self.assertEqual(report['continuations'],1)
        self.assertIsNone(report['inputTokens']['total'])
        self.assertNotIn('tokensSaved',report)

    def test_partial_failure_keeps_known_usage_and_unknown_request_counts(self):
        meter = {'requestCount': 3, 'inputTokens': None, 'outputTokens': None,
                 'requests': [
                     {'usage': {'input_tokens': 100, 'output_tokens': 10, 'cached_input_tokens': 20}},
                     {'usage': None},
                     {'usage': {'input_tokens': 0, 'output_tokens': 5}}]}
        row = {'score': runner.score(self.case(), {'ok': False}), 'meter': meter, 'wallMs': 1}
        report = runner.totals([row])
        self.assertEqual(report['attempted'], 1)
        self.assertEqual(report['delivered'], 0)
        for key, subtotal, unknown in [('inputTokens', 100, 1), ('outputTokens', 15, 1),
                                       ('cachedInputTokens', 20, 2)]:
            self.assertEqual(report[key], {'total': None, 'knownSubtotal': subtotal,
                                          'unknownCases': 1, 'unknownRequests': unknown})
        self.assertEqual(meter['requests'][0]['usage']['input_tokens'], 100)

    def test_request_usage_is_authoritative_even_when_aggregate_claims_zero(self):
        row = {'score': runner.score(self.case(), {'ok': False}), 'wallMs': 1,
               'meter': {'requestCount': 2, 'inputTokens': 0, 'outputTokens': 0,
                         'requests': [{'usage': {'input_tokens': 12, 'output_tokens': 0}},
                                      {'usage': {}}]}}
        report = runner.totals([row])
        self.assertIsNone(report['inputTokens']['total'])
        self.assertEqual(report['inputTokens']['knownSubtotal'], 12)
        self.assertEqual(report['inputTokens']['unknownRequests'], 1)
        self.assertIsNone(report['outputTokens']['total'])
        self.assertEqual(report['outputTokens']['unknownRequests'], 1)

    def test_missing_request_records_do_not_become_zero_cost(self):
        row = {'score': runner.score(self.case(), {'ok': False}), 'wallMs': 1,
               'meter': {'requestCount': 2, 'requests': []}}
        report = runner.totals([row])
        self.assertIsNone(report['inputTokens']['total'])
        self.assertEqual(report['inputTokens']['unknownRequests'], 2)

    def test_aggregate_only_meter_is_not_accepted_as_token_evidence(self):
        row = {'score': runner.score(self.case(), {'ok': False}), 'wallMs': 1,
               'meter': {'requestCount': 2, 'inputTokens': 20, 'outputTokens': None}}
        report = runner.totals([row])
        self.assertIsNone(report['inputTokens']['total'])
        self.assertEqual(report['inputTokens']['knownSubtotal'], 0)
        self.assertEqual(report['inputTokens']['unknownRequests'], 2)
        self.assertEqual(report['outputTokens']['unknownRequests'], 2)
        self.assertIn('request_records_missing_or_invalid', runner.meter_issues(row))

    def test_meter_incomplete_counts_keep_known_tokens_without_claiming_totals(self):
        requests = [{'usage': {'input_tokens': 12}}, {'usage': None}]
        for count, records, unknown in [(None, requests, None), (False, requests, None),
                                         (-1, requests, None), ('2', requests, None),
                                         (1, requests, None), (3, requests, 2),
                                         (None, [], None), (2, None, 2)]:
            with self.subTest(count=count, records=records):
                row = {'score': runner.score(self.case(), {'ok': False}), 'wallMs': 0,
                       'meter': {'requestCount': count, 'requests': records}}
                self.assertTrue(runner.meter_issues(row))
                report = runner.totals([row])['inputTokens']
                self.assertIsNone(report['total'])
                self.assertEqual(report['knownSubtotal'], 12 if records else 0)
                self.assertEqual(report['unknownCases'], 1)
                self.assertEqual(report['unknownRequests'], unknown)

    def test_invalid_usage_values_and_records_never_crash_or_count_as_tokens(self):
        for bad in [True, False, -1, 1.5, '10', [], {}]:
            with self.subTest(bad=bad):
                row = {'score': runner.score(self.case(), {'ok': False}), 'wallMs': 0,
                       'meter': {'requestCount': 2, 'requests': [
                           {'usage': {'input_tokens': 7}}, {'usage': {'input_tokens': bad}}]}}
                self.assertIn('request_usage_invalid', runner.meter_issues(row))
                self.assertEqual(runner.totals([row])['inputTokens'],
                                 {'total': None, 'knownSubtotal': 7,
                                  'unknownCases': 1, 'unknownRequests': 1})
        for request in [None, True, 'bad', [], {'usage': 'bad'}, {'usage': []}]:
            row = {'score': runner.score(self.case(), {'ok': False}), 'wallMs': 0,
                   'meter': {'requestCount': 1, 'requests': [request]}}
            self.assertTrue(runner.meter_issues(row))
            self.assertIsNone(runner.totals([row])['inputTokens']['total'])

    def test_zero_requests_is_known_only_with_explicit_matching_count(self):
        for meter in [{'requests': []}, None, [], {'requestCount': 0},
                      {'requestCount': 0, 'requests': None}]:
            row = {'score': runner.score(self.case(), {'ok': False}), 'wallMs': 0, 'meter': meter}
            self.assertTrue(runner.meter_issues(row))
            self.assertIsNone(runner.totals([row])['inputTokens']['total'])
        row['meter'] = {'requestCount': 0, 'requests': []}
        self.assertEqual(runner.meter_issues(row), [])
        self.assertEqual(runner.totals([row])['inputTokens'],
                         {'total': 0, 'knownSubtotal': 0, 'unknownCases': 0, 'unknownRequests': 0})

    def run_driver(self, change_result=None, change_manifest=None, count=1, crash=False):
        """Run main with real job/trace/report files and a model-free subprocess substitute."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            binaries = {'legacy': root / 'legacy', 'current': root / 'current'}
            for group, path in binaries.items():
                path.write_bytes(group.encode())
            expected = {group: {'binarySha256': runner.digest(path),
                                'implementationHash': ('a' if group == 'legacy' else 'b') * 64}
                        for group, path in binaries.items()}
            manifest = copy.deepcopy(expected)
            if change_manifest:
                change_manifest(manifest)
            (root / 'identities.json').write_text(json.dumps(manifest))
            (root / 'native.json').write_text('{}')
            (root / 'config.json').write_text(json.dumps({'configPath': str(root / 'native.json')}))
            cases = [dict(self.case(), caseId=f'case-{i}') for i in range(count)]
            (root / 'cases.jsonl').write_text('\n'.join(json.dumps(case) for case in cases))
            calls = []

            def subprocess_run(command, **kwargs):
                if command[:2] == ['git', 'check-ignore']:
                    return SimpleNamespace(returncode=0)
                path = Path(kwargs['env']['CASTGLEAN_EFFICIENCY_JOB'])
                job = json.loads(path.read_text())
                self.assertNotIn('goldHeadings', job)
                profile = job['profile']
                group = runner.program_group(profile)
                self.assertEqual(command, [str(binaries[group]), '--exact', runner.BRIDGE,
                                           '--ignored', '--nocapture'])
                calls.append((job['caseId'], profile))
                meter = {'requestCount': 2, 'inputTokens': None, 'outputTokens': None,
                         'requests': [{'usage': {'input_tokens': 100, 'output_tokens': 10}},
                                      {'usage': None}]}
                if crash:
                    path.with_suffix('.trace.json').write_text(json.dumps(meter))
                    return SimpleNamespace(returncode=1)
                result = {'ok': False, 'error': 'fixture_failure', 'profile': profile,
                          'caseId': job['caseId'], 'implementationHash': expected[group]['implementationHash'],
                          'inputHash': hashlib.sha256(json.dumps(
                              [job['text'], job['request'], job['corrections']],
                              ensure_ascii=False, separators=(',', ':')).encode()).hexdigest(),
                          'configuration': {'configurationSnapshotHash': 'c' * 64}, 'meter': meter}
                if change_result:
                    change_result(result)
                path.with_suffix('.result.json').write_text(json.dumps(result))
                return SimpleNamespace(returncode=0)

            argv = ['runner', '--binary', str(binaries['current']), '--baseline-binary', str(binaries['legacy']),
                    '--identity-manifest', str(root / 'identities.json'), '--config', str(root / 'config.json'),
                    '--cases', str(root / 'cases.jsonl'), '--output', str(root / 'out')]
            error = None
            with patch.object(sys, 'argv', argv), patch.object(runner.subprocess, 'run', side_effect=subprocess_run), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                try:
                    runner.main()
                except (RuntimeError, SystemExit) as caught:
                    error = caught
            reports = {path.name: json.loads(path.read_text()) for path in (root / 'out').glob('*.json')}
            return error, reports, calls

    def test_driver_routes_frozen_programs_rotates_cases_and_keeps_failed_denominator(self):
        error, reports, calls = self.run_driver(count=2)
        self.assertIsNone(error)
        self.assertEqual([p for _, p in calls], runner.PROFILES + runner.PROFILES[1:] + runner.PROFILES[:1])
        summary = reports['summary.json']
        self.assertTrue(summary['comparable'])
        self.assertEqual(summary['observed'], 8)
        self.assertEqual(len(reports['plan.json']['expectedPrograms']), 2)
        self.assertIn('identityManifest', summary['frozen'])
        for profile in runner.PROFILES:
            stats = summary['profiles'][profile]
            self.assertEqual(stats['attempted'], 2)
            self.assertEqual(stats['delivered'], 0)
            self.assertEqual(stats['inputTokens']['knownSubtotal'], 200)
            self.assertEqual(stats['inputTokens']['unknownRequests'], 2)

    def test_driver_rejects_missing_empty_and_malformed_result_identities(self):
        for key in ('implementationHash', 'inputHash', 'configuration'):
            for value in (None, '', 'not-a-sha256'):
                with self.subTest(key=key, value=value):
                    error, reports, calls = self.run_driver(
                        change_result=lambda result: result.update({key: value}))
                    self.assertIsInstance(error, RuntimeError)
                    self.assertEqual(len(calls), 1)
                    self.assertFalse(reports['summary.json']['comparable'])
                    self.assertEqual(reports['summary.json']['profiles']['baseline']['attempted'], 1)
                    self.assertIn('000-baseline-result.json', reports)
        error, reports, _ = self.run_driver(change_result=lambda result: result.clear())
        self.assertIsInstance(error, RuntimeError)
        self.assertEqual(len(reports['summary.json']['gateIssues']), 6)

    def test_driver_accepts_measured_delivery_with_zero_cached_tokens(self):
        def delivered(result):
            result.update(ok=True, error=None, headings=[0, 2])
            result['meter'] = {'requestCount': 1, 'requests': [
                {'usage': {'input_tokens': 100, 'output_tokens': 10, 'cached_input_tokens': 0}}]}
        error, reports, _ = self.run_driver(change_result=delivered)
        self.assertIsNone(error)
        self.assertTrue(reports['summary.json']['comparable'])
        for stats in reports['summary.json']['profiles'].values():
            self.assertEqual(stats['delivered'], 1)
            self.assertEqual(stats['boundaryExact'], 1)
            self.assertEqual(stats['inputTokens']['total'], 100)
            self.assertEqual(stats['outputTokens']['total'], 10)
            self.assertEqual(stats['cachedInputTokens'], {
                'total': 0, 'knownSubtotal': 0, 'unknownCases': 0, 'unknownRequests': 0})

    def test_driver_rejects_first_group_wrong_input_even_if_all_groups_would_agree(self):
        error, reports, calls = self.run_driver(
            change_result=lambda result: result.update(inputHash='d' * 64))
        self.assertEqual(str(error), 'frozen_case_input_mismatch')
        self.assertEqual(len(calls), 1)
        self.assertFalse(reports['summary.json']['comparable'])
        self.assertEqual(reports['summary.json']['profiles']['baseline']['inputTokens']['knownSubtotal'], 100)

    def test_driver_meter_gate_saves_failure_cost_before_stopping(self):
        for meter in [{'requests': []}, {'requestCount': True, 'requests': []},
                      {'requestCount': -1, 'requests': []}, {'requestCount': '0', 'requests': []},
                      {'requestCount': 0, 'requests': {}},
                      {'requestCount': 2, 'requests': [{'usage': {'input_tokens': 9}}]},
                      {'requestCount': 0, 'requests': [{'usage': {'input_tokens': 9}}]}]:
            with self.subTest(meter=meter):
                error, reports, calls = self.run_driver(
                    change_result=lambda result: result.update(meter=meter))
                self.assertIsInstance(error, RuntimeError)
                self.assertEqual(len(calls), 1)
                summary = reports['summary.json']
                self.assertFalse(summary['comparable'])
                stats = summary['profiles']['baseline']['inputTokens']
                self.assertIsNone(stats['total'])
                self.assertEqual(stats['unknownCases'], 1)
                self.assertEqual(stats['knownSubtotal'], 9 if isinstance(meter['requests'], list)
                                 and meter['requests'] else 0)

    def test_driver_rejects_wrong_implementation_for_each_program_group(self):
        for profile in runner.PROFILES:
            def change(result):
                if result['profile'] == profile:
                    result['implementationHash'] = ('b' if runner.program_group(profile) == 'legacy' else 'a') * 64
            with self.subTest(profile=profile):
                error, reports, _ = self.run_driver(change_result=change)
                self.assertEqual(str(error), 'implementation_mismatch')
                self.assertFalse(reports['summary.json']['comparable'])

    def test_driver_rejects_cross_group_configuration_input_and_route_mismatch(self):
        for key, value, issue in [('inputHash', 'd' * 64, 'case_input_mismatch'),
                                   ('configuration', {'configurationSnapshotHash': 'd' * 64}, 'model_configuration_mismatch'),
                                   ('profile', 'baseline', 'result_route_identity_mismatch'),
                                   ('caseId', 'other', 'result_route_identity_mismatch')]:
            def change(result):
                if result['profile'] == 'atomic':
                    result[key] = value
            with self.subTest(key=key):
                error, reports, _ = self.run_driver(change_result=change)
                self.assertIn(issue, str(error).split(','))
                self.assertFalse(reports['summary.json']['comparable'])

    def test_driver_checks_expected_binary_and_manifest_before_any_bridge_call(self):
        for change in (lambda m: m['legacy'].update(binarySha256='f' * 64),
                       lambda m: m['current'].pop('implementationHash'),
                       lambda m: m['current'].update(implementationHash=m['legacy']['implementationHash'])):
            error, reports, calls = self.run_driver(change_manifest=change)
            self.assertIsInstance(error, SystemExit)
            self.assertEqual(error.code, 2)
            self.assertEqual(calls, [])
            self.assertEqual(reports, {})

    def test_driver_crash_retains_trace_cost_and_failure_before_identity_gate_stops(self):
        error, reports, calls = self.run_driver(crash=True)
        self.assertIsInstance(error, RuntimeError)
        self.assertEqual(len(calls), 1)
        summary = reports['summary.json']
        self.assertFalse(summary['comparable'])
        self.assertEqual(summary['planned'], 4)
        self.assertEqual(summary['observed'], 1)
        stats = summary['profiles']['baseline']
        self.assertEqual(stats['attempted'], 1)
        self.assertEqual(stats['delivered'], 0)
        self.assertEqual(stats['inputTokens']['knownSubtotal'], 100)
        self.assertEqual(stats['inputTokens']['unknownRequests'], 1)
        self.assertEqual(reports['000-baseline-result.json']['error'], 'bridge_exit')
