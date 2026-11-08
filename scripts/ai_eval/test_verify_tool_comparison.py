"""Offline regression tests; all fixtures are synthetic, no gold or model calls."""
import copy
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('verify_tool_comparison', Path(__file__).with_name('verify_tool_comparison.py'))
v = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(v)


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.run = self.root / 'run'
        self.dataset = self.root / 'dataset'
        self.run.mkdir()
        self.dataset.mkdir()
        self.paths = {name: self.root / name for name in ('binary', 'nativeConfig', 'nativeHelper', 'driver', 'evaluator')}
        for path in self.paths.values():
            path.write_text('synthetic fixture')
        self.connection = self.root / 'connection.json'
        write(self.connection, {'connections': [{'connection': {
            'id': 'conn', 'revision': 1, 'protocol': 'openai', 'endpoint': 'local-fixture',
            'models': [{'id': 'selected', 'modelId': 'fixture-model', 'contextWindow': 128000, 'maxOutputTokens': 4096}]
        }}]})
        write(self.paths['nativeConfig'], {'configPath': str(self.connection), 'bridgeBinary': str(self.paths['nativeHelper']),
                                         'selection': {'connectionId': 'conn', 'modelId': 'selected'}})
        self.sources = {'case-a': '风起。', 'case-b': '雨落。'}
        self.hashes = {cid: v.hashlib.sha256(text.encode()).hexdigest() for cid, text in self.sources.items()}
        manifest = {'version': 1, 'datasetVersion': 'synthetic-v1', 'caseIds': list(self.sources),
                    'datasetHash': 'd' * 64, 'goldHash': 'e' * 64}
        write(self.dataset / 'manifest.json', manifest)
        self.dataset.joinpath('cases.jsonl').write_text(''.join(json.dumps({'version': 1, 'characters': [], 'caseId': cid, 'split': 'holdout',
            'source': {'text': text, 'sha256': self.hashes[cid]}}, ensure_ascii=False) + '\n' for cid, text in self.sources.items()))
        self.budgets = {'modelRequests': 16, 'toolCallsPerAgent': 32, 'repairRounds': 3, 'wallMs': 300000,
                        'knownTokens': 64000, 'maxOutputTokens': 4096, 'reasoning': 'low', 'toolConcurrency': 1}
        self.plan = {'dataset': dict(manifest, split='holdout', selectionHash=v.digest(list(self.sources))),
                     'budgets': self.budgets, 'mode': 'live',
                     'frozen': {name: v.file_hash(path) for name, path in self.paths.items() if name != 'evaluator'}}
        write(self.run / 'plan.json', self.plan)
        # Deterministic ordering: files predate plan, supplemental capture follows it.
        old = 1_700_000_000_000_000_000
        for path in (self.connection, self.paths['evaluator']):
            os.utime(path, ns=(old, old))
        os.utime(self.run / 'plan.json', ns=(old + 1_000_000_000, old + 1_000_000_000))
        self.attestation = {'capturedAt': '2023-11-14T22:13:22+00:00', 'files': {
            label: {'sha256': v.file_hash(path), 'mtimeNs': path.stat().st_mtime_ns, 'modifiedBeforePlan': True}
            for label, path in [('connectionConfig', self.connection), ('evaluator', self.paths['evaluator'])]}}
        write(self.run / 'configuration-attestation.json', self.attestation)
        self.rows = {}
        self.reports = {}
        effective = v.effective_configuration(self.paths['nativeConfig'], self.budgets)
        for route in v.ROUTES:
            self.rows[route] = []
            for cid in self.sources:
                declaration = {'inputHash': v.digest(cid), 'promptHash': 'a' * 64, 'toolsHash': 'b' * 64,
                               'configurationHash': effective, 'budgets': self.budgets,
                               'humanConfirmed': False, 'identityDiscoveryEvaluated': False}
                def request(task, stage, number):
                    return {'runId': f'{route}-{cid}-{task}', 'spanId': str(number), 'requestId': str(number),
                            'route': route, 'stage': stage, 'isRequest': True, 'status': 'completed', 'elapsedMs': 10,
                            'metadata': {'model': 'fixture-model', 'promptVersion': 'p1', 'protocolVersion': 'wire1',
                                         'codeRevision': 'revision', 'sourceHash': self.hashes[cid],
                                         'promptHash': declaration['promptHash'], 'toolsHash': declaration['toolsHash'],
                                         'configurationHash': effective, 'offeredToolsHash': 'c' * 64,
                                         'offeredToolCount': 5, 'actualSystemHash': declaration['promptHash']},
                            'usage': {field: 1 for field in v.TOKEN_FIELDS}}
                self.rows[route].append({'caseId': cid, 'route': route, 'mode': 'live', 'status': 'completed',
                    'experimentIdentity': declaration, 'reviewExperimentIdentity': {'inputHash': v.digest('seeded-' + cid)},
                    'trace': [request('analysis', 'analysis', 0), request('analysis', 'review', 1)],
                    'reviewTrace': [request('review', 'review', 0)], 'toolAudit': [], 'repairRounds': 0})
            self.reports[route] = {'dataset': self.plan['dataset'], 'sourceHashes': self.hashes,
                'execution': {'frozenFiles': self.plan['frozen']}, 'cases': [{'caseId': cid} for cid in self.sources],
                'mode': 'live', 'program': {'scriptHashes': {'evaluate.py': v.file_hash(self.paths['evaluator'])}},
                'observability': {'requestCountKnown': 6, 'usage': {
                    field: {'knownTotal': 6, 'knownRequests': 6, 'unknownRequests': 0} for field in v.TOKEN_FIELDS}}}
        self.save()

    def save(self):
        for route in v.ROUTES:
            self.run.joinpath(f'{route}-results.jsonl').write_bytes(b''.join(v.canonical(r) + b'\n' for r in self.rows[route]))
            write(self.run / f'{route}-report.json', self.reports[route])

    def verify(self):
        self.save()
        return v.verify(self.run, self.dataset, self.paths)

    def assert_rejected(self, code):
        result = self.verify()
        self.assertFalse(result['comparable'])
        self.assertIn(code, [issue['code'] for issue in result['issues']])
        return result

    def test_complete_evidence_passes_and_labels_post_start_capture(self):
        result = self.verify()
        self.assertTrue(result['comparable'], result['issues'])
        self.assertEqual(result['configurationAttestation']['captureTiming'], 'after-start')
        self.assertFalse(result['configurationAttestation']['initialContentHashProven'])

    def test_case_swapped_tools_cannot_pass_as_global_set(self):
        for route, hashes in [('classic', ['c' * 64, 'f' * 64]), ('ecs', ['f' * 64, 'c' * 64])]:
            for row, value in zip(self.rows[route], hashes):
                for span in row['trace'] + row['reviewTrace']:
                    span['metadata']['offeredToolsHash'] = value
        self.assert_rejected('paired_stage_identity')

    def test_task_swapped_tools_cannot_pass_as_global_set(self):
        for route in v.ROUTES:
            for row in self.rows[route]:
                row['trace'][0]['metadata']['offeredToolsHash'] = ('c' if route == 'classic' else 'f') * 64
                row['reviewTrace'][0]['metadata']['offeredToolsHash'] = ('f' if route == 'classic' else 'c') * 64
        self.assert_rejected('paired_stage_identity')

    def test_both_routes_changing_tools_for_a_stage_still_breaks_common_contract(self):
        for route in v.ROUTES:
            self.rows[route][0]['reviewTrace'][0]['metadata']['offeredToolsHash'] = 'f' * 64
        self.assert_rejected('common_request_identity')

    def test_missing_stage_stays_unknown_without_inventing_execution(self):
        self.rows['ecs'][0]['trace'].pop()
        result = self.assert_rejected('stage_not_observed')
        self.assertEqual(result['stageEvidence']['case-a']['ecs']['analysis']['review'],
                         {'state': 'not-observed', 'requestCount': 0})
        self.assertTrue(any(i['caseId'] == 'case-a' and i['stage'] == 'review'
                            for i in result['stageExecutionDifferences']))

    def omit_generated_review_after_failure(self, route):
        row = self.rows[route][0]
        row['status'] = 'failed'
        row['trace'] = [span for span in row['trace'] if span['stage'] != 'review']
        report = self.reports[route]['observability']
        report['requestCountKnown'] -= 1
        for usage in report['usage'].values():
            usage['knownTotal'] -= 1
            usage['knownRequests'] -= 1

    def test_failed_analysis_without_generated_review_remains_comparable(self):
        self.omit_generated_review_after_failure('ecs')
        result = self.verify()
        self.assertTrue(result['comparable'], result['issues'])
        self.assertEqual(result['stageEvidence']['case-a']['ecs']['analysis']['review'],
                         {'state': 'not-observed', 'requestCount': 0})
        self.assertEqual(len(result['stageExecutionDifferences']), 1)
        self.assertEqual(result['dataset']['caseIds'], ['case-a', 'case-b'])

    def test_both_failed_analyses_without_generated_review_remain_comparable(self):
        for route in v.ROUTES:
            self.omit_generated_review_after_failure(route)
        result = self.verify()
        self.assertTrue(result['comparable'], result['issues'])
        self.assertEqual(result['stageExecutionDifferences'], [])

    def test_failed_analysis_still_requires_main_request_evidence(self):
        self.omit_generated_review_after_failure('ecs')
        self.rows['ecs'][0]['trace'] = []
        self.assert_rejected('stage_not_observed')

    def test_failed_analysis_still_requires_independent_seeded_review(self):
        self.omit_generated_review_after_failure('ecs')
        self.rows['ecs'][0]['reviewTrace'] = []
        self.assert_rejected('stage_not_observed')

    def test_missing_seeded_input_hash_is_unknown(self):
        self.rows['classic'][0].pop('reviewExperimentIdentity')
        result = self.assert_rejected('seeded_review_input_hash_not_retained')
        self.assertIsNone(result['stageEvidence']['case-a']['classic']['seededReviewInputHash'])

    def test_seeded_metadata_input_hash_can_supply_retained_evidence(self):
        row = self.rows['classic'][0]
        value = row.pop('reviewExperimentIdentity')['inputHash']
        row['reviewTrace'][0]['metadata']['inputHash'] = value
        self.assertTrue(self.verify()['comparable'])

    def test_declared_input_and_budget_mismatch_fail(self):
        self.rows['ecs'][0]['experimentIdentity'] = copy.deepcopy(self.rows['ecs'][0]['experimentIdentity'])
        self.rows['ecs'][0]['experimentIdentity']['inputHash'] = 'f' * 64
        self.rows['ecs'][0]['experimentIdentity']['budgets']['modelRequests'] = 99
        self.assert_rejected('paired_declaration')
        self.assert_rejected('common_budgets')

    def test_missing_actual_hash_or_wrong_count_fail(self):
        self.rows['classic'][0]['reviewTrace'][0]['metadata'].pop('actualSystemHash')
        self.rows['ecs'][0]['trace'][0]['metadata']['offeredToolCount'] = 4
        self.assert_rejected('request_metadata')

    def test_effective_configuration_cannot_be_agreed_but_wrong(self):
        for route in v.ROUTES:
            self.rows[route][0]['experimentIdentity']['configurationHash'] = '0' * 64
        self.assert_rejected('effective_configuration')

    def test_duplicate_or_missing_cases_fail(self):
        self.rows['ecs'][1] = self.rows['ecs'][0]
        self.assert_rejected('result_case_coverage')

    def test_source_mismatch_fails(self):
        self.rows['ecs'][0]['reviewTrace'][0]['metadata']['sourceHash'] = '0' * 64
        self.assert_rejected('request_source_hash')

    def test_terminal_hash_and_mtime_are_checked(self):
        old = self.connection.stat().st_mtime_ns
        self.connection.write_bytes(self.connection.read_bytes() + b' ')
        os.utime(self.connection, ns=(old, old))
        self.assert_rejected('attested_file_hash_changed')

    def test_mtime_change_with_identical_content_fails(self):
        value = self.connection.stat().st_mtime_ns + 1
        os.utime(self.connection, ns=(value, value))
        self.assert_rejected('attested_file_mtime_changed')

    def test_report_evaluator_hash_and_request_costs_fail_closed(self):
        self.reports['ecs']['program']['scriptHashes']['evaluate.py'] = '0' * 64
        self.reports['ecs']['observability']['requestCountKnown'] = 5
        self.assert_rejected('report_evaluator_identity')
        self.assert_rejected('report_request_accounting')

    def test_repair_counter_is_analysis_only_and_other_failures_are_audited(self):
        row = self.rows['classic'][0]
        row['repairRounds'] = 1
        row['toolAudit'] = [{'tool': 'finish_analysis', 'status': 'rejected'}] * 2
        row['reviewTrace'].append({'route': 'classic', 'stage': 'tool', 'toolName': 'finish_analysis', 'status': 'failed'})
        result = self.verify()
        self.assertTrue(result['comparable'], result['issues'])
        cost = result['requestAccounting']['case-a']['classic']
        self.assertEqual(cost['analysisRepairRoundsReported'], 1)
        self.assertEqual(cost['analysisAndGeneratedReviewFailedValidationTools'], 2)
        self.assertEqual(cost['review']['failedValidationToolSpans'], 1)

    def test_cli_exit_codes_preserve_original_artifacts(self):
        cmd = [sys.executable, str(Path(v.__file__)), '--run-dir', str(self.run), '--dataset', str(self.dataset),
               '--config', str(self.paths['nativeConfig']), '--evaluator', str(self.paths['evaluator']),
               '--binary', str(self.paths['binary']), '--driver', str(self.paths['driver'])]
        frozen = {p: p.read_bytes() for p in self.run.iterdir()}
        done = subprocess.run(cmd, capture_output=True, check=False)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        for path, value in frozen.items():
            self.assertEqual(path.read_bytes(), value)
        self.rows['ecs'].pop()
        self.save()
        done = subprocess.run(cmd, capture_output=True, check=False)
        self.assertEqual(done.returncode, 2)
        self.assertFalse(v.read_json(self.run / 'verified-comparison.json')['comparable'])


class C2GateTests(GateTests):
    """Reuse the adversarial case/stage tests with real per-task adapter fields."""

    def setUp(self):
        super().setUp()
        self.run.joinpath('configuration-attestation.json').unlink()
        self.paths['adapter'] = self.root / 'adapter'
        self.paths['adapter'].write_text('offline adapter fixture')
        self.paths['connectionConfig'] = self.connection
        self.paths['manifest'] = self.dataset / 'manifest.json'
        self.paths['cases'] = self.dataset / 'cases.jsonl'
        self.paths['verifier'] = Path(v.__file__)
        self.plan['frozen'] = {name: v.file_hash(path) for name, path in self.paths.items()}
        write(self.run / 'plan.json', self.plan)
        inputs = v.expected_adapter_inputs(self.dataset, self.plan)
        for route in v.ROUTES:
            for row in self.rows[route]:
                for task, key in [('analysis', 'trace'), ('review', 'reviewTrace')]:
                    native_hash = row['experimentIdentity']['inputHash'] if task == 'analysis' else row['reviewExperimentIdentity']['inputHash']
                    for span in row[key]:
                        span['metadata'].update(inputHash=native_hash,
                                                adapterInputHash=inputs[row['caseId']][task],
                                                configurationSnapshotHash=self.plan['frozen']['connectionConfig'],
                                                evaluationTask=task)
                row.pop('reviewExperimentIdentity')
            self.reports[route]['execution']['frozenFiles'] = self.plan['frozen']
        self.save()

    def test_complete_evidence_passes_and_labels_post_start_capture(self):
        result = self.verify()
        self.assertTrue(result['comparable'], result['issues'])
        self.assertEqual(result['configurationAttestation']['captureTiming'], 'pre-run-plan')
        self.assertTrue(result['configurationAttestation']['hashesRecordedInPreRunPlan'])
        self.assertFalse((self.run / 'configuration-attestation.json').exists())

    def test_missing_seeded_input_hash_is_unknown(self):
        self.rows['classic'][0]['reviewTrace'][0]['metadata'].pop('inputHash')
        self.assert_rejected('observed_task_metadata_missing')

    def test_seeded_metadata_input_hash_can_supply_retained_evidence(self):
        result = self.verify()
        self.assertTrue(result['comparable'], result['issues'])

    def test_terminal_hash_and_mtime_are_checked(self):
        self.connection.write_bytes(self.connection.read_bytes() + b' ')
        self.assert_rejected('frozen_file_changed')

    def test_mtime_change_with_identical_content_fails(self):
        value = self.run.joinpath('plan.json').stat().st_mtime_ns + 1
        os.utime(self.connection, ns=(value, value))
        self.assert_rejected('frozen_file_modified_after_plan')

    def test_cli_exit_codes_preserve_original_artifacts(self):
        cmd = [sys.executable, str(Path(v.__file__)), '--run-dir', str(self.run), '--dataset', str(self.dataset),
               '--config', str(self.paths['nativeConfig']), '--evaluator', str(self.paths['evaluator']),
               '--binary', str(self.paths['binary']), '--driver', str(self.paths['driver']),
               '--adapter', str(self.paths['adapter'])]
        original = {p: p.read_bytes() for p in self.run.iterdir()}
        done = subprocess.run(cmd, capture_output=True, check=False)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        for path, value in original.items():
            self.assertEqual(path.read_bytes(), value)
        self.rows['ecs'][0]['reviewTrace'][0]['metadata'].pop('inputHash')
        self.save()
        done = subprocess.run(cmd, capture_output=True, check=False)
        self.assertEqual(done.returncode, 2)

    def test_configuration_snapshot_must_match_plan_not_just_other_route(self):
        for route in v.ROUTES:
            self.rows[route][0]['reviewTrace'][0]['metadata']['configurationSnapshotHash'] = '0' * 64
        self.assert_rejected('observed_configuration_snapshot')

    def test_adapter_input_hash_must_match_whitelist_bytes(self):
        for route in v.ROUTES:
            self.rows[route][0]['reviewTrace'][0]['metadata']['adapterInputHash'] = '0' * 64
        self.assert_rejected('observed_adapter_input')

    def test_task_labels_cannot_be_interchanged(self):
        self.rows['ecs'][0]['reviewTrace'][0]['metadata']['evaluationTask'] = 'analysis'
        self.assert_rejected('observed_task_label')

    def test_seeded_native_hash_must_match_per_case_even_if_global_set_matches(self):
        a, b = self.rows['ecs']
        am, bm = a['reviewTrace'][0]['metadata'], b['reviewTrace'][0]['metadata']
        am['inputHash'], bm['inputHash'] = bm['inputHash'], am['inputHash']
        self.assert_rejected('paired_seeded_review_input')

    def test_missing_one_request_identity_cannot_hide_behind_other_requests(self):
        row = self.rows['classic'][0]
        row['reviewTrace'].append(copy.deepcopy(row['reviewTrace'][0]))
        row['reviewTrace'][-1]['requestId'] = 'second'
        row['reviewTrace'][-1]['spanId'] = 'second'
        row['reviewTrace'][-1]['metadata'].pop('inputHash')
        self.assert_rejected('observed_task_metadata_missing')

    def test_unknown_frozen_key_is_not_silently_ignored(self):
        self.plan['frozen']['unresolved-file'] = '0' * 64
        write(self.run / 'plan.json', self.plan)
        self.assert_rejected('unresolved_frozen_file')


    def require_role_context(self):
        self.plan['characterContextRequired'] = True
        write(self.run / 'plan.json', self.plan)
        cases = {c['caseId']: c for c in v.read_jsonl(self.dataset / 'cases.jsonl')}
        for route in v.ROUTES:
            for row in self.rows[route]:
                role_hash = v.digest(cases[row['caseId']]['characters'])
                row['experimentIdentity']['characterContextHash'] = role_hash
                for span in row['trace'] + row['reviewTrace']:
                    span['metadata']['characterContextHash'] = role_hash

    def test_role_context_fidelity_is_verified(self):
        self.require_role_context()
        self.assertTrue(self.verify()['comparable'])

    def test_missing_role_context_cannot_fall_back_to_other_metadata(self):
        self.require_role_context()
        self.rows['ecs'][0]['reviewTrace'][0]['metadata'].pop('characterContextHash')
        self.assert_rejected('character_context_fidelity')

    def test_same_wrong_role_context_on_both_routes_still_fails(self):
        self.require_role_context()
        for route in v.ROUTES:
            row = self.rows[route][0]
            row['experimentIdentity']['characterContextHash'] = '0' * 64
            for span in row['trace'] + row['reviewTrace']:
                span['metadata']['characterContextHash'] = '0' * 64
        self.assert_rejected('declared_character_context')


if __name__ == '__main__':
    unittest.main()
