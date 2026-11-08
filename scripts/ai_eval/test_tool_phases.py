import importlib.util
from pathlib import Path
import unittest
S=importlib.util.spec_from_file_location('phases',Path(__file__).with_name('summarize_tool_phases.py'));M=importlib.util.module_from_spec(S);S.loader.exec_module(M)
class PhaseTests(unittest.TestCase):
    def test_partial_run_retains_frozen_plan_denominator(self):
        x=M.summarize([{'caseId':'a','status':'failed'}],['a','b'])
        self.assertEqual(x['plannedCases'],2);self.assertEqual(x['observedCases'],1);self.assertEqual(x['missingCases'],['b'])
        self.assertIsNone(M.summarize([])['plannedCases'])
    def test_analysis_can_finish_while_pipeline_fails_at_review(self):
        row={'caseId':'a','status':'failed','toolAudit':[{'tool':'finish_analysis','status':'completed'},{'tool':'finish_analysis','status':'rejected','error':'identity'}],'trace':[],'reviewTrace':[]}
        x=M.summarize([row]);self.assertEqual(x['pipelineDelivered'],0);self.assertEqual(x['analysis']['finishObservedCases'],1);self.assertEqual(x['generatedReview']['finishObservedCases'],0)
    def test_repaired_reviews_are_not_conflated_with_analysis_repair_counter(self):
        row={'caseId':'a','status':'completed','repairRounds':0,'toolAudit':[{'tool':'finish_analysis','status':'completed'},{'tool':'finish_analysis','status':'rejected','error':'identity'},{'tool':'finish_analysis','status':'completed'}],'trace':[],'reviewTrace':[{'stage':'tool','toolName':'finish_analysis','status':'failed','errorCode':'unknown_review_target'},{'stage':'tool','toolName':'finish_analysis','status':'completed'}]}
        x=M.summarize([row]);self.assertEqual(x['generatedReview']['repairSuccessObservedCases'],1);self.assertEqual(x['seededReview']['repairSuccessObservedCases'],1);self.assertEqual(x['cases'][0]['analysisRepairRoundsReported'],0)
    def test_missing_evidence_is_unknown_not_proof_of_no_work(self):
        x=M.summarize([{'caseId':'a','status':'failed'}]);self.assertEqual(x['phaseEvidenceUnknownCases'],['a']);self.assertEqual(x['analysis']['finishObservedCases'],0);self.assertEqual(x['analysis']['requestAccountingUnknownCases'],['a'])
if __name__=='__main__':unittest.main()
