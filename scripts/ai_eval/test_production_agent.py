import copy
import hashlib
import unittest
import run_production_agent as runner


class ProductionEvalTests(unittest.TestCase):
    def case(self):
        text='甲🙂。'
        return {'caseId':'unicode','source':{'text':text,'sha256':hashlib.sha256(text.encode()).hexdigest()},
                'characters':[{'id':'c','name':'甲','description':'上下文','aliases':['她']}],
                'gold':[{'start':0,'end':len(text.encode()),'kind':'speech','speakers':['c']}]}

    def test_preflight_preserves_role_fields_and_rejects_stale_source_before_calls(self):
        case=self.case()
        self.assertIs(runner.preflight([case])[0],case)
        case['source']['text']+='变更'
        with self.assertRaisesRegex(ValueError,'source_hash'):
            runner.preflight([case])

    def test_duplicate_case_or_identity_is_not_silently_deduplicated(self):
        case=self.case()
        with self.assertRaisesRegex(ValueError,'duplicate_case'):
            runner.preflight([case,copy.deepcopy(case)])
        case['characters']*=2
        with self.assertRaisesRegex(ValueError,'role_identity'):
            runner.preflight([case])

    def test_finished_draft_with_failed_review_is_zero_delivered_quality(self):
        case=self.case()
        result={'ok':False,'analysis':{'segments':[{'start':0,'end':len(case['source']['text'].encode()),'kind':'speech','speaker':'c'}]}}
        self.assertEqual(runner.score(case,result)['bytesCorrect'],0)
        result['ok']=True
        self.assertEqual(runner.score(case,result)['bytesCorrect'],len(case['source']['text'].encode()))
        self.assertEqual(runner.score({'source':case['source']},result),{'semanticQuality':'unmeasured'})
