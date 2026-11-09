import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC=importlib.util.spec_from_file_location('unlimited_gate',Path(__file__).with_name('verify_unlimited_chapter_comparison.py'))
GATE=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(GATE)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.run=self.root/'run';self.run.mkdir();self.trial=self.run/'r1-classic';self.trial.mkdir()
        self.files={name:self.root/name for name in ['snapshot','gold','prepared','binary','config','protocol','helper','connection','runner','smoke']}
        for path in self.files.values():path.write_text('{}')
        self.text='公开样本';self.files['snapshot'].write_text(json.dumps({'text':self.text}))
        self.source=GATE.hashlib.sha256(self.text.encode()).hexdigest()
        self.config={'unlimitedTokens':True,'unlimitedTime':True,'reasoningEffort':'low'}
        self.plan={'sourceHash':self.source,'frozen':{k:GATE.digest(p) for k,p in self.files.items()},'orders':[['classic']],'reasoningEffort':'low','wallMs':None}
        self.row={'route':'classic','repetition':1,'status':'completed','analysisFinished':True,'unlimitedProfileVerified':True,'timeProfileVerified':True,'modelRequestsObserved':2}
        budget={'knownTokens':None,'maxOutputTokens':None,'wallMs':None,'requestTimeoutMs':None,'reasoning':'low'}
        identity={'inputHash':'a'*64,'promptHash':'b'*64,'toolsHash':'c'*64,'budgets':budget}
        metadata={'model':'public-fixture-model','sourceHash':self.source,'actualSystemHash':identity['promptHash'],'offeredToolCount':5,'offeredToolsHash':'d'*64,'maxOutputTokens':None,'budgets':budget,
            'wireFacts':{'request':{'reasoningEffort':'low','maxTokens':None,'maxCompletionTokens':None,'toolsCount':5},'response':{'reasoningContentChars':12,'reasoningTokens':0}}}
        self.raw={'mode':'live','helpersReaped':True,'experimentIdentity':identity,'trace':[{'isRequest':True,'stage':stage,'metadata':copy.deepcopy(metadata),'usage':{'inputTokens':10,'outputTokens':2}} for stage in ['analysis','review']]}
        self.write()

    def write(self):
        for path,value in [(self.run/'plan.json',self.plan),(self.run/'results.json',[self.row]),(self.trial/'raw-result.json',self.raw),(self.trial/'normalized.json',{'segments':[{'start':0,'end':len(self.text.encode())}]})]:path.write_text(json.dumps(value))

    def verify(self):return GATE.verify(self.run,self.files,self.config)

    def test_complete_observed_contract_passes_without_claiming_no_thinking(self):
        result=self.verify();self.assertTrue(result['passed']);self.assertEqual(result['reasoningReturnedWithZeroTokenReport'],2)

    def test_missing_slot_and_frozen_drift_fail_closed(self):
        self.plan['orders']=[['classic','ecs']];self.write();self.files['binary'].write_text('changed')
        codes={i['code'] for i in self.verify()['issues']}
        self.assertIn('planned_slots_incomplete_or_reordered',codes);self.assertIn('frozen_file_changed',codes)

    def test_actual_wire_policy_overrides_a_matching_declaration(self):
        self.raw['trace'][0]['metadata']['wireFacts']['request'].update(reasoningEffort='max',maxTokens=4096);self.write()
        codes={i['code'] for i in self.verify()['issues']}
        self.assertIn('http_reasoning_policy',codes);self.assertIn('http_output_cap',codes)

    def test_unknown_usage_is_reported_as_unknown_without_fabricating_zero(self):
        self.raw['trace'][0]['usage']['inputTokens']=None;self.write()
        result=self.verify();self.assertTrue(result['passed']);self.assertEqual(result['unknownUsageRequests'],1)

    def test_mock_deadline_and_partial_coverage_cannot_pass(self):
        self.raw['mode']='mock';self.raw['experimentIdentity']['budgets']['wallMs']=300000;self.write()
        (self.trial/'normalized.json').write_text(json.dumps({'segments':[{'start':0,'end':3}]}))
        codes={i['code'] for i in self.verify()['issues']}
        self.assertIn('live_mode_unproven',codes);self.assertIn('agent_profile',codes);self.assertIn('normalized_source_incomplete',codes)


if __name__=='__main__':unittest.main()
