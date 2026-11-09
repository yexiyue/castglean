import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import run_chapter_quality_followup as followup


class FollowupTests(unittest.TestCase):
    def fixture(self):
        text='雨落。';size=len(text.encode());samples=followup.audit.make_samples(text,[{'start':0,'end':size,'text':text}],1)
        aliases={'A':'classic','B':'ecs'};outputs={r:[{'start':0,'end':size,'kind':'narration','speaker':'narrator'}] for r in aliases.values()}
        return samples,outputs,aliases

    def test_user_sees_exact_schema_and_only_available_anonymous_routes(self):
        samples,outputs,aliases=self.fixture();payload,schema=followup.prepare(samples,outputs,aliases)
        self.assertEqual(payload['outputSchema'],schema);self.assertEqual(payload['availableRoutes'],['A','B'])
        self.assertEqual(schema['properties']['issues']['items']['properties']['route']['enum'],['A','B'])
        self.assertEqual(schema['properties']['issues']['items']['properties']['category']['enum'],['kind','speaker','insufficient_context'])
        user=json.dumps(payload);self.assertNotIn('classic',user);self.assertNotIn('ecs',user)

    def test_system_rubric_is_unchanged(self):
        self.assertEqual(followup.SYSTEM,followup.audit.AUDIT_SYSTEM)

    def test_preparation_drift_cannot_replace_parent_or_loaded_draft_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);parent=root/'parent';draft=root/'draft';parent.write_text('{}');draft.write_text('{}')
            old={'parent':followup.common.digest(parent)};observed={};followup.read_bound(draft,'draft',observed)
            paths={'parent':parent,'draft':draft};followup.freeze_files(paths,old,observed)
            parent.write_text('changed')
            with self.assertRaisesRegex(ValueError,'frozen_file_changed'):followup.freeze_files(paths,old,observed)
            parent.write_text('{}');draft.write_text('changed')
            with self.assertRaisesRegex(ValueError,'frozen_file_changed'):followup.freeze_files(paths,old,observed)

    def test_invalid_old_category_is_rejected_and_never_mapped_into_a_score(self):
        samples,outputs,aliases=self.fixture();bad={'issues':[{'sampleId':samples[0]['id'],'route':'A','category':'kind_boundary','confidence':'high','reason':'公开合成理由'}]}
        response={'ok':True,'model':'public','wallMs':None,'text':json.dumps(bad),'usage':{'input_tokens':10,'output_tokens':10},'wireFacts':{'request':{'reasoningEffort':'low','maxTokens':None,'maxCompletionTokens':None}}}
        with tempfile.TemporaryDirectory() as temp,patch.object(followup.common,'helper',return_value=response):
            r=followup.call(Path(temp),samples,outputs,aliases,{'bridgeBinary':'/unused','configPath':'/unused','selection':{}},'public')
            self.assertEqual(r['status'],'failed');self.assertEqual(r['modelRequestsObserved'],1);self.assertNotIn('signal',r)

    def test_interruption_keeps_attempted_unknown_cost(self):
        samples,outputs,aliases=self.fixture()
        with tempfile.TemporaryDirectory() as temp,patch.object(followup.common,'helper',side_effect=KeyboardInterrupt):
            r=followup.call(Path(temp),samples,outputs,aliases,{'bridgeBinary':'/unused','configPath':'/unused','selection':{}},'public')
            self.assertEqual(r['error'],'interrupted');self.assertTrue(r['costUnknown']);self.assertTrue(r['requestCountUnknown'])


if __name__=='__main__':unittest.main()
