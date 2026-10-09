"""Historical executions must bind version and source provenance to their binary."""
import tempfile
import runpy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from evaluation.runner import execution_protocol, safe_configuration
from evaluation.suite import dump, load, sha, ROOT

class ProtocolReferenceTests(unittest.TestCase):
    def test_glm_preview_uses_cli_default_without_loading_keys(self):
        with patch('evaluation.runner.ROOT', Path('nonexistent-offline-config-root')), patch.dict('os.environ', {}, clear=True):
            self.assertEqual(safe_configuration('glm'), {
                'model': 'bigmodel::glm-4.6',
                'endpoint': 'https://open.bigmodel.cn/api/coding/paas/v4/'})

    def test_rescoring_cannot_accept_wrong_prompt_version(self):
        namespace=runpy.run_path(str(ROOT/'scripts/evaluate-attribution.py'))
        main=namespace['main']; scope=main.__globals__
        suite=ROOT/'evaluations/literary-v1'
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp); output=directory/'output';output.mkdir()
            dump(output/'analysis.stats.json',{'prompt_version':5})
            manifest={key:None for key in ['evaluation_version','backend','label','configuration','seed','split','repeats','limits','protocol_files','binary_sha256','environment','actual_order','started_at']}
            manifest.update(prompt_version=7,freeze=load(suite/'freeze.json'), attempts=[{
                'sample':'mad-01','category':'thought','split':'supplemental','state':'artifact_invalid',
                'output':str(output),'wall_ms':0,'usage':None}])
            path=directory/'manifest.json';dump(path,manifest)
            report=directory/'public.json'
            with patch.dict(scope,verify_suite=lambda *a:None,cli_validate=lambda *a:None,score_directory=lambda *a:{}), patch.object(sys,'argv',['score','score','--suite',str(suite),'--binary',str(directory/'binary'),'--manifest',str(path),'--report',str(report)]), patch('builtins.print'):
                main()
            result=load(report)
            self.assertEqual(result['attempts'][0]['state'],'artifact_invalid')
            self.assertEqual(result['summary']['overall']['correct_lower'],0)

    def test_current_protocol_and_historical_binding(self):
        with tempfile.TemporaryDirectory() as tmp:
            binary=Path(tmp)/'binary'; binary.write_bytes(b'old')
            report=Path(tmp)/'report.json'
            fingerprints={'crates/core/src/analysis.rs':sha(b'source')}
            data={'binary_sha256':sha(b'old'),'prompt_version':6,'evidence_mode':'verified-quotes','protocol_files':fingerprints}
            dump(report,data)
            result=execution_protocol(binary,'verified-quotes',report)
            self.assertEqual(result['prompt_version'],6)
            self.assertEqual(result['protocol_files'],fingerprints)
            self.assertEqual(result['protocol_reference']['sha256'],sha(report.read_bytes()))
            with patch('evaluation.runner.protocol_fingerprints',return_value={'current':'fingerprint'}):
                self.assertEqual(execution_protocol(binary,'segment-ids')['prompt_version'],9)
                self.assertEqual(execution_protocol(binary,'verified-quotes')['prompt_version'],10)
            with self.assertRaisesRegex(ValueError,'reference_protocol_mismatch'):
                execution_protocol(binary,'segment-ids',report)
            binary.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'reference_binary_mismatch'):
                execution_protocol(binary,'verified-quotes',report)
            binary.write_bytes(b'old');data['protocol_files']={};dump(report,data)
            with self.assertRaisesRegex(ValueError,'reference_source_fingerprints_missing'):
                execution_protocol(binary,'verified-quotes',report)

if __name__=='__main__':
    unittest.main()
