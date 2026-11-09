import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('unlimited_runner',Path(__file__).with_name('run_unlimited_chapter_comparison.py'))
RUNNER=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(RUNNER)

class UnlimitedTests(unittest.TestCase):
    def test_failed_pipeline_can_preserve_finished_draft_without_claiming_delivery(self):
        raw={'status':'failed','segments':[],'diagnosticDraft':{'finished':True,'characters':[{'id':'a','name':'甲'}],
             'segments':[{'start':0,'end':3,'kind':'speech','speaker':'a'}]}}
        self.assertEqual(RUNNER.normalize_draft(raw)[0]['speaker'],'甲')
        raw['diagnosticDraft']['finished']=False
        self.assertIsNone(RUNNER.normalize_draft(raw))

    def test_unlimited_requires_both_explicit_null_fields(self):
        self.assertIsNone(RUNNER.verify_unlimited({}))
        self.assertFalse(RUNNER.verify_unlimited({'experimentIdentity':{'budgets':{'maxOutputTokens':None}}}))
        self.assertTrue(RUNNER.verify_unlimited({'experimentIdentity':{'budgets':{'maxOutputTokens':None,'knownTokens':None}}}))

    def test_json_requests_no_limit_no_gold_and_keeps_validation_failure(self):
        class Protocol:
            @staticmethod
            def request_for(*args):return 'fixed system',{'targets':[]},{},{}
            @staticmethod
            def expand_compact(*args):return {'characters':[],'segments':[]}
        responses=[{'ok':True,'text':'{}','usage':{'output_tokens':12000},'maxOutputTokens':None},{'valid':False}]
        with tempfile.TemporaryDirectory() as temp,patch.object(RUNNER,'helper',side_effect=responses) as helper:
            r=RUNNER.json_trial(Protocol,{'bridgeBinary':'/helper','configPath':'/config','selection':{}},
                {'plans':[{}],'payloads':[{}],'preamble':'fixed'}, {'text':'公开样本'},Path(temp))
        self.assertFalse(r['analysisFinished']);self.assertEqual(r['status'],'failed')
        job=helper.call_args_list[0].args[2]
        self.assertTrue(job['unlimitedTokens']);self.assertNotIn('max_tokens',job);self.assertNotIn('gold',job)
        self.assertEqual(r['usage']['output_tokens'],12000)

    def test_partial_usage_remains_unknown(self):
        self.assertFalse(RUNNER.usage_complete({'input_tokens':None,'output_tokens':None}))
        self.assertFalse(RUNNER.usage_complete({'input_tokens':10}))
        self.assertTrue(RUNNER.usage_complete({'input_tokens':10,'output_tokens':0}))

    def test_source_preflight_rejects_partial_json_windows_and_wrong_anchors(self):
        text='甲乙';snapshot={'text':text,'chapterHash':RUNNER.hashlib.sha256(text.encode()).hexdigest()}
        prepared={'plans':[{'owned':{'start':0,'end':6},'anchors':[{'start':0,'text':text}]}]}
        gold=[{'start':0,'end':3,'kind':'speech','speakers':['甲']}]
        RUNNER.validate_source(snapshot,prepared,gold)
        prepared['plans'][0]['owned']['end']=3
        with self.assertRaisesRegex(ValueError,'full_source'):RUNNER.validate_source(snapshot,prepared,gold)
        prepared['plans'][0]['owned']['end']=6;prepared['plans'][0]['anchors'][0]['text']='甲丙'
        with self.assertRaisesRegex(ValueError,'anchor_source_mismatch'):RUNNER.validate_source(snapshot,prepared,gold)

if __name__=='__main__':unittest.main()
