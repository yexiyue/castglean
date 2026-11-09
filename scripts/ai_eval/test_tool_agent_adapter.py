import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('tool_adapter',Path(__file__).with_name('tool_agent_adapter.py'))
ADAPTER=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(ADAPTER)

class AdapterTests(unittest.TestCase):
    def invoke(self,case,result,returncode=0,mutate=False):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);connection=root/'connection.json';connection.write_text('{"revision":1}')
            config=root/'native.json';config.write_text(json.dumps({'configPath':str(connection)}))
            result.setdefault('experimentIdentity',{}).setdefault('characterContextHash',hashlib.sha256(ADAPTER.canonical([{k:v for k,v in c.items() if v is not None} for c in case.get('characters',[])])).hexdigest())
            captured={}
            class Child:
                pid=123
                def __init__(self,argv,**kwargs):captured['argv']=argv;captured['kwargs']=kwargs;self.returncode=returncode
                def communicate(self,data=None,timeout=None):
                    captured['input']=data
                    if mutate:connection.write_text('{"revision":2}')
                    return json.dumps(result).encode(),b'private stderr must not escape'
            stdin=io.TextIOWrapper(io.BytesIO(json.dumps(case).encode()+b'\n'));out=io.StringIO()
            argv=['adapter','--binary',str(root/'binary'),'--config',str(config),'--route','ecs']
            with patch('sys.argv',argv),patch('sys.stdin',stdin),patch('sys.stdout',out),patch.object(ADAPTER.subprocess,'Popen',Child):
                ADAPTER.main()
            return json.loads(out.getvalue()),captured
    def test_seeded_review_identity_survives_in_each_request_without_source(self):
        case={'caseId':'c','evaluationTask':'review','source':{'text':'公开样本','sha256':'s'},'reviewInput':{'segments':[]}}
        result={'experimentIdentity':{'inputHash':'processed-hash'},'trace':[{'isRequest':True,'metadata':{'sourceHash':'s'}},{'isRequest':False,'stage':'tool'}]}
        out,captured=self.invoke(case,result)
        metadata=out['trace'][0]['metadata'];self.assertEqual(metadata['inputHash'],'processed-hash');self.assertEqual(metadata['evaluationTask'],'review');self.assertEqual(len(metadata['adapterInputHash']),64);self.assertEqual(len(metadata['configurationSnapshotHash']),64)
        self.assertNotIn('公开样本',json.dumps(metadata,ensure_ascii=False));self.assertEqual(json.loads(captured['input']),case);self.assertTrue(captured['kwargs']['start_new_session']);self.assertNotIn('shell',captured['kwargs'])
    def test_lost_character_description_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'character_context_lost'):
            self.invoke({'evaluationTask':'analysis','characters':[{'id':'a','name':'同名','description':'木匠'}]},{'experimentIdentity':{'characterContextHash':'wrong'},'trace':[]})
    def test_unknown_character_fields_are_not_silently_discarded(self):
        with self.assertRaisesRegex(ValueError,'unsupported_character_context'):
            self.invoke({'characters':[{'id':'a','name':'甲','unmappedTrait':'重要信息'}]},{})
    def test_gold_never_reaches_child(self):
        with patch.object(ADAPTER.subprocess,'Popen') as popen:
            with self.assertRaisesRegex(ValueError,'answers_forbidden'):self.invoke({'gold':[]},{})
            popen.assert_not_called()
    def test_connection_drift_rejects_result(self):
        with self.assertRaisesRegex(RuntimeError,'connection_configuration_changed'):self.invoke({'evaluationTask':'analysis'},{'trace':[]},mutate=True)
    def test_child_failure_is_redacted_and_keeps_cost_unknown(self):
        with self.assertRaisesRegex(RuntimeError,'adapter_exit_cost_unknown'):self.invoke({'evaluationTask':'analysis'},{},returncode=1)

if __name__=='__main__':unittest.main()
