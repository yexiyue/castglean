import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location('private_smoke', Path(__file__).with_name('run_private_tool_smoke.py'))
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)


class PrivateSmokeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.binary = self.root / 'binary'
        self.helper = self.root / 'helper'
        self.connection = self.root / 'connection.json'
        self.config = self.root / 'native.json'
        self.binary.write_bytes(b'controlled-binary')
        self.helper.write_bytes(b'controlled-helper')
        self.connection.write_text('{"secret":"must-not-appear"}')
        self.config.write_text(json.dumps({'bridgeBinary': str(self.helper), 'configPath': str(self.connection)}))
        self.case = {'source': {'text': 'controlled synthetic input'}}
        self.frozen = SMOKE.identities(self.binary, self.config)

    def run_route(self, result=None, code=0, error=None, mutate=None):
        if result is None:
            result = {'status': 'completed', 'trace': [{'isRequest': True}, {'isRequest': False}]}

        def invoke(argv, payload, timeout):
            self.assertIn('--discover-characters', argv)
            self.assertEqual(json.loads(payload), self.case)
            self.assertEqual(timeout, 330)
            if mutate:
                mutate()
            if error:
                raise error
            return code, result if isinstance(result, bytes) else json.dumps(result).encode()

        with patch.object(SMOKE, 'communicate', side_effect=invoke) as call:
            output = SMOKE.run_route(self.case, self.binary, self.config, 'classic', self.frozen)
        return output, call

    def assert_unknown(self, result, kind):
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['failureKind'], kind)
        self.assertTrue(result['costUnknown'])
        self.assertIsNone(result['modelRequests'])
        self.assertGreaterEqual(result['elapsedMs'], 0)
        self.assertNotIn('must-not-appear', json.dumps(result))

    def test_success_records_external_time_and_all_frozen_identities(self):
        result, _ = self.run_route()
        self.assertEqual(result['modelRequests'], 1)
        self.assertFalse(result['costUnknown'])
        identity = result['executionIdentity']
        self.assertTrue(identity['matchesFrozen'])
        self.assertEqual(identity['started'], self.frozen)
        self.assertEqual(identity['ended'], self.frozen)
        self.assertEqual(set(self.frozen), {'binary', 'config', 'helper', 'connection'})
        self.assertTrue(all(len(item['sha256']) == 64 for item in self.frozen.values()))
        self.assertNotIn('must-not-appear', json.dumps(result))
        self.assertGreaterEqual(result['elapsedMs'], 0)

    def test_live_audit_location_is_passed_only_when_requested(self):
        audit=self.root/'live.jsonl'
        with patch.object(SMOKE,'communicate',return_value=(0,json.dumps({'status':'completed','trace':[{'isRequest':True}]}).encode())) as call:
            SMOKE.run_route(self.case,self.binary,self.config,'classic',self.frozen,audit_path=audit)
        self.assertEqual(call.call_args.kwargs['env']['CASTGLEAN_TOOL_AUDIT'],str(audit.resolve()))

    def test_failures_keep_cost_and_request_count_unknown(self):
        cases = [({'code': 7}, 'adapter_exit'),
                 ({'error': subprocess.TimeoutExpired('controlled', 330)}, 'timeout'),
                 ({'error': OSError('must-not-appear')}, 'adapter_error'),
                 ({'error': KeyboardInterrupt()}, 'interrupted'),
                 ({'result': b'not JSON must-not-appear'}, 'parse'),
                 ({'result': b'\xff'}, 'parse'),
                 ({'result': []}, 'parse'),
                 ({'result': {'status': 'completed', 'trace': [None]}}, 'parse')]
        for arguments, kind in cases:
            with self.subTest(kind=kind, arguments=arguments):
                result, _ = self.run_route(**arguments)
                self.assert_unknown(result, kind)
                self.assertTrue(result['executionIdentity']['matchesFrozen'])

    def test_failed_adapter_result_cannot_turn_observed_requests_into_known_cost(self):
        result, _ = self.run_route(result={'status': 'failed', 'trace': [{'isRequest': True}]})
        self.assertTrue(result['costUnknown'])
        self.assertIsNone(result['modelRequests'])
        result, _ = self.run_route(result={'status': 'completed', 'trace': []})
        self.assertTrue(result['costUnknown'])
        self.assertIsNone(result['modelRequests'])

    def test_elapsed_time_is_external_including_cleanup_and_identity_checks(self):
        with patch.object(SMOKE.time, 'monotonic', side_effect=[10, 10.25]):
            result, _ = self.run_route(result={'status': 'completed', 'elapsedMs': 1,
                                              'trace': [{'isRequest': True}]})
        self.assertEqual(result['elapsedMs'], 250)

    def test_each_identity_is_checked_before_spawn_and_after_exit(self):
        for path in (self.binary, self.config, self.helper, self.connection):
            original = path.read_bytes()
            with self.subTest(path=path.name):
                result, _ = self.run_route(mutate=lambda: path.write_bytes(b'changed'))
                self.assert_unknown(result, 'identity_changed')
                self.assertFalse(result['executionIdentity']['matchesFrozen'])
                result, call = self.run_route()
                self.assert_unknown(result, 'identity_unavailable_or_changed')
                call.assert_not_called()
            path.write_bytes(original)

    def test_missing_identity_fails_closed_without_printing_config_content(self):
        self.connection.unlink()
        result, call = self.run_route()
        self.assert_unknown(result, 'identity_unavailable_or_changed')
        call.assert_not_called()

    def test_communicate_uses_session_and_reaps_after_timeout_even_if_group_has_exited(self):
        for kill_error in (None, ProcessLookupError()):
            child = Mock(pid=123, returncode=-signal.SIGKILL)
            child.communicate.side_effect = [subprocess.TimeoutExpired('controlled', 0.1), (b'', b'')]
            with self.subTest(kill_error=kill_error), \
                    patch.object(SMOKE.subprocess, 'Popen', return_value=child) as popen, \
                    patch.object(SMOKE.os, 'killpg', side_effect=kill_error) as killpg:
                with self.assertRaises(subprocess.TimeoutExpired):
                    SMOKE.communicate(['controlled'], b'input', timeout=0.1)
                self.assertTrue(popen.call_args.kwargs['start_new_session'])
                killpg.assert_called_once_with(123, signal.SIGKILL)
                self.assertEqual(child.communicate.call_count, 2)
                self.assertEqual(child.communicate.call_args.args, ())

    def test_interruption_and_io_error_also_kill_and_reap(self):
        for error in (KeyboardInterrupt(), OSError('controlled')):
            child = Mock(pid=123)
            child.communicate.side_effect = [error, (b'', b'')]
            with self.subTest(error=type(error).__name__), \
                    patch.object(SMOKE.subprocess, 'Popen', return_value=child), \
                    patch.object(SMOKE.os, 'killpg') as killpg:
                with self.assertRaises(type(error)):
                    SMOKE.communicate(['controlled'], b'input')
                killpg.assert_called_once_with(123, signal.SIGKILL)
                self.assertEqual(child.communicate.call_count, 2)

    def test_normal_exit_also_cleans_up_any_remaining_helpers(self):
        child = Mock(pid=123, returncode=0)
        child.communicate.return_value = (b'{"status":"completed"}', b'private stderr')
        with patch.object(SMOKE.subprocess, 'Popen', return_value=child), \
                patch.object(SMOKE.os, 'killpg') as killpg:
            self.assertEqual(SMOKE.communicate(['controlled'], b'input'),
                             (0, b'{"status":"completed"}'))
            killpg.assert_called_once_with(123, signal.SIGKILL)
            self.assertEqual(child.communicate.call_count, 2)

    @unittest.skipUnless(os.name == 'posix', 'POSIX process groups required')
    def test_real_timeout_kills_descendant_holding_output_pipes(self):
        # A missed descendant keeps communicate blocked for three seconds. Neither
        # process loads the Rust adapter, a model, credentials, or a network client.
        script = ("import subprocess,sys,time; "
                  "subprocess.Popen([sys.executable,'-c','import time; time.sleep(3)']); "
                  "print('descendant-started',flush=True); time.sleep(3)")
        began = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired) as caught:
            SMOKE.communicate([sys.executable, '-c', script], b'', timeout=0.5)
        self.assertIn(b'descendant-started', caught.exception.output)
        self.assertLess(time.monotonic() - began, 2.5)

    def test_cli_keeps_timeout_and_writes_redacted_failure_records(self):
        source = self.root / 'source.json'
        source.write_text(json.dumps({'text': 'synthetic'}))
        output = self.root / 'output'
        argv = ['smoke', '--input', str(source), '--binary', str(self.binary),
                '--config', str(self.config), '--output', str(output)]
        console = io.StringIO()
        with patch.object(sys, 'argv', argv), contextlib.redirect_stdout(console), \
                patch.object(SMOKE, 'communicate', side_effect=subprocess.TimeoutExpired('controlled', 330)) as call:
            SMOKE.main()
        self.assertEqual(call.call_count, 2)
        self.assertTrue(all(c.args[2] == 330 for c in call.call_args_list))
        self.assertNotIn('must-not-appear', console.getvalue())
        printed = [json.loads(line) for line in console.getvalue().splitlines()]
        self.assertEqual([row['route'] for row in printed], ['classic', 'ecs'])
        self.assertTrue(all(row['modelRequests'] is None and row['costUnknown'] for row in printed))
        self.assertEqual(json.loads((output / 'execution-identity.json').read_text()), self.frozen)
        for route in ('classic', 'ecs'):
            result = json.loads((output / f'{route}-result.json').read_text())
            self.assert_unknown(result, 'timeout')
            self.assertEqual(result['executionIdentity']['started'], result['executionIdentity']['ended'])


if __name__ == '__main__':
    unittest.main()
