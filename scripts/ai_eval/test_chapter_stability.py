import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import run_chapter_stability as stability


class StabilityTests(unittest.TestCase):
    def fixture(self):
        text='𠮷说。\r\n雨落。';raw=text.encode()
        snapshot={'text':text,'chapterHash':hashlib.sha256(raw).hexdigest(),'sourceStart':2,'sourceEnd':2+len(raw)}
        prepared={'plans':[{'owned':{'start':0,'end':len(raw)},'anchors':[{'start':0,'text':text}]}]}
        return snapshot,prepared,b'xx'+raw+b'zz'

    def test_frozen_source_binding_and_complete_anchor_coverage(self):
        snapshot,prepared,book=self.fixture();stability.validate_fixture(snapshot,prepared,book)
        changed=copy.deepcopy(prepared);changed['plans'][0]['anchors'][0]['text']='错'
        with self.assertRaisesRegex(ValueError,'anchor_source_mismatch'):stability.validate_fixture(snapshot,changed,book)
        with self.assertRaisesRegex(ValueError,'book_binding_mismatch'):stability.validate_fixture(snapshot,prepared,b'wrong book')

    def test_no_gold_is_needed_but_hash_and_whole_source_are_required(self):
        snapshot,prepared,book=self.fixture();self.assertNotIn('gold',snapshot)
        changed=copy.deepcopy(snapshot);changed['chapterHash']='0'*64
        with self.assertRaisesRegex(ValueError,'chapter_hash_mismatch'):stability.validate_fixture(changed,prepared,book)
        prepared['plans'][0]['owned']['end']-=1
        with self.assertRaisesRegex(ValueError,'whole_chapter_plan_required'):stability.validate_fixture(snapshot,prepared,book)

    def test_missing_failure_and_unknown_usage_stay_in_planned_denominator(self):
        manifest={'plannedSlots':9,'cases':[{}, {}, {}]}
        row={'route':'classic','status':'failed','elapsedSeconds':12,'analysisFinished':False,'modelRequestsObserved':1,'usage':None,'costUnknown':True,'businessRejections':{'incomplete_draft':1},'runtimePreToolFailures':1}
        result=stability.summarize(manifest,[row]);r=result['routes']['classic']
        self.assertEqual(r['planned'],3);self.assertEqual(r['delivered'],0);self.assertEqual(r['missingSlots'],2)
        self.assertEqual(r['usageUnknownSlots'],1);self.assertEqual(r['runtimePreToolFailures'],1);self.assertIsNone(result['semanticAccuracy'])
        self.assertEqual(result['routes']['ecs']['missingSlots'],3)

    def test_cached_tokens_are_subset_and_failure_time_is_not_hidden(self):
        manifest={'plannedSlots':9,'cases':[{}, {}, {}]}
        rows=[{'route':'json','status':status,'elapsedSeconds':seconds,'analysisFinished':status=='completed','modelRequestsObserved':1,'usage':{'input_tokens':100,'output_tokens':10,'cached_input_tokens':90},'costUnknown':False} for status,seconds in [('completed',10),('failed',100)]]
        r=stability.summarize(manifest,rows)['routes']['json']
        self.assertEqual(r['knownInputTokens'],200);self.assertEqual(r['knownCachedInputTokens'],180);self.assertEqual(r['secondsAllObserved']['median'],55)

    def test_partial_usage_preserves_known_input_without_inventing_output_or_cache(self):
        row={'route':'ecs','status':'failed','elapsedSeconds':1,'analysisFinished':False,'modelRequestsObserved':1,'usage':{'input_tokens':123,'output_tokens':None},'costUnknown':True}
        r=stability.summarize({'plannedSlots':9,'cases':[{}, {}, {}]},[row])['routes']['ecs']
        self.assertEqual(r['knownInputTokens'],123);self.assertEqual(r['inputUsageUnknownSlots'],0);self.assertEqual(r['outputUsageUnknownSlots'],1);self.assertEqual(r['cachedInputUnknownSlots'],1);self.assertEqual(r['usageUnknownSlots'],1)

    def test_all_three_chapters_are_preflighted_before_returning_work(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);texts=['雨落。' * 10, '风起。' * 10, '灯亮。' * 10];book=''.join(texts).encode();(root/'book').write_bytes(book)
            manifest={'plannedSlots':9,'goldAvailable':False,'sourceBook':str(root/'book'),'sourceBookHash':hashlib.sha256(book).hexdigest(),'cases':[]};cursor=0
            for ordinal,text,order in zip([2,10,50],[*texts],[['json','classic','ecs'],['classic','ecs','json'],['ecs','json','classic']]):
                raw=text.encode();snap={'chapterOrdinal':ordinal,'sourceHash':manifest['sourceBookHash'],'text':text,'chapterHash':hashlib.sha256(raw).hexdigest(),'sourceStart':cursor,'sourceEnd':cursor+len(raw)};cursor+=len(raw)
                snapshot=root/f'{ordinal}-input';prepared=root/f'{ordinal}-prepared';snapshot.write_text(json.dumps(snap));prepared.write_text(json.dumps({'payloads':[{}],'preamble':'public','plans':[{'owned':{'start':0,'end':len(raw)},'anchors':[{'start':0,'text':text}]}]}))
                manifest['cases'].append({'caseId':f'chapter-{ordinal}','ordinal':ordinal,'orders':[order],'snapshot':str(snapshot),'prepared':str(prepared)})
            class Protocol:
                @staticmethod
                def partition(text):
                    offsets=[len(text[:i].encode()) for i in range(len(text)+1)]
                    return [{'start':offsets[i],'end':offsets[i+1],'text':ch} for i,ch in enumerate(text)]
                @staticmethod
                def request_for(arm,plan,payload,preamble,local,source):
                    return 'public',{'targets':[{'id':'s0','text':source}],'targetIds':['s0']},{'type':'object'},{'s0':{}}
            config={'controlledHelper':False,'unlimitedTokens':True,'unlimitedTime':True,'compactTools':True,'reasoningEffort':'low'}
            loaded=stability.preflight(manifest,config,Protocol);self.assertEqual(len(loaded),3);self.assertTrue(all(len(row[3])==8 for row in loaded))
            bad=Path(manifest['cases'][-1]['prepared']);original=bad.read_text();prepared_bad=json.loads(original);del prepared_bad['payloads'];bad.write_text(json.dumps(prepared_bad))
            with self.assertRaisesRegex(ValueError,'json_request_inputs_invalid'):stability.preflight(manifest,config,Protocol)
            bad.write_text(original)
            last=Path(manifest['cases'][-1]['snapshot']);value=json.loads(last.read_text());value['chapterHash']='f'*64;last.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'chapter_hash_mismatch'):stability.preflight(manifest,config,Protocol)

    def test_interrupted_independent_audit_persists_unknown_dispatch_cost(self):
        text='𠮷落雨。';raw=text.encode();samples=stability.audit.make_samples(text,[{'start':0,'end':len(raw),'text':text}],1)
        aliases={'A':'json','B':'classic','C':'ecs'};outputs={r:[{'start':0,'end':len(raw),'kind':'narration','speaker':'narrator'}] for r in aliases.values()}
        config={'bridgeBinary':'/unused','configPath':'/unused','selection':{}}
        with tempfile.TemporaryDirectory() as temp,patch.object(stability.common,'helper',side_effect=KeyboardInterrupt):
            result=stability.run_audit(Path(temp),samples,config,outputs,aliases,'public-model')
            saved=json.loads((Path(temp)/'result.json').read_text());self.assertEqual(saved,result)
            self.assertEqual(result['error'],'interrupted');self.assertTrue(result['costUnknown']);self.assertTrue(result['dispatchAttempted']);self.assertTrue(result['requestCountUnknown']);self.assertIsNone(result.get('usage'))

    def test_audit_failure_or_skip_prevents_an_all_complete_success(self):
        for state in ['failed','skipped']:
            flags=stability.completion_flags(True,9,9,[{'status':'completed'},{'status':state},{'status':'completed'}],3)
            self.assertTrue(flags['primaryComparable']);self.assertFalse(flags['auditComplete']);self.assertFalse(flags['comparable'])
        self.assertTrue(stability.completion_flags(True,9,9,[{'status':'completed'}]*3,3)['comparable'])
        self.assertFalse(stability.completion_flags(True,8,9,[{'status':'completed'}]*3,3)['comparable'])

    def test_frozen_file_drift_stops_before_another_paid_call(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'frozen';p.write_text('original');files={'binary':p};hashes={'binary':stability.common.digest(p)}
            stability.check_frozen(files,hashes);p.write_text('changed')
            with self.assertRaisesRegex(ValueError,'frozen_file_changed'):stability.check_frozen(files,hashes)


if __name__ == '__main__':unittest.main()
