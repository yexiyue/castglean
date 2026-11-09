import importlib.util
from pathlib import Path
import unittest

SPEC=importlib.util.spec_from_file_location('comparison_driver',Path(__file__).with_name('run_tool_comparison.py'))
DRIVER=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(DRIVER)

class DriverTests(unittest.TestCase):
    def test_all_inputs_checked_before_execution(self):
        cases=[{'caseId':'supported','characters':[{'id':'a','name':'甲','description':'木匠'}]},
               {'caseId':'unsupported','characters':[{'id':'b','name':'乙','aliases':['守钟人']}]}]
        DRIVER.validate_inputs(cases[:1])
        with self.assertRaisesRegex(ValueError,'unsupported_character_context:unsupported'):
            DRIVER.validate_inputs(cases)

    def test_common_comparator_rejection_does_not_skip_strong_gate(self):
        class Evaluator:
            class Invalid(ValueError):pass
            @staticmethod
            def compare(a,b):raise Evaluator.Invalid('unknown_configuration')
        result=DRIVER.compare_or_reject(Evaluator,{'classic':{},'ecs':{}})
        self.assertFalse(result['comparable'])
        self.assertEqual(result['error'],'shared_evaluator_rejected_comparison')

if __name__=='__main__':unittest.main()
