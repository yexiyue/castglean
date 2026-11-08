"""Offline checks for positional restoration and scoring; never contacts a model."""
import unittest

from chapter_protocol import expand_compact, partition, score


class ProtocolChecks(unittest.TestCase):
    def test_partition_reconstructs_exact_unicode_and_whitespace(self):
        text = '\ufeff甲：“你😀好！”\r\n\r\n乙心想：e\u0301。\n尾\n'
        pieces = partition(text)
        self.assertEqual("".join(p["text"] for p in pieces), text)
        self.assertEqual(pieces[-1]["end"], len(text.encode()))
        for p in pieces:
            self.assertEqual(text.encode()[p["start"]:p["end"]].decode(), p["text"])

    def test_prepartition_does_not_assign_semantics(self):
        pieces = partition('“铃铃！”\n甲：“你好。”\n')
        self.assertTrue(all(set(p) == {"id", "text", "start", "end"} for p in pieces))

    def test_short_ranges_restore_anchor_identity_without_converting_scalars_to_bytes(self):
        plan = {"anchors": [{"id": "a500", "start": 0, "text": "甲😀"}]}
        r = {"a": "s0", "i": 0, "b": "s0", "j": 2}
        value = {"characters": [], "segments": [{"r": r, "k": "n", "w": ["narrator"], "e": [r]}]}
        expanded = expand_compact(value, {"s0": plan["anchors"][0]}, False, plan)
        self.assertEqual(expanded["segments"][0]["range"]["end"], {"anchorId": "a500", "scalar": 2})

    def test_prepartition_missing_or_duplicate_targets_are_rejected(self):
        plan = {"anchors": [{"id": "a0", "start": 0, "text": "甲乙"}]}
        lookup = {"s0": {"start": 0, "end": 3}, "s1": {"start": 3, "end": 6}}
        s = {"r": "s0", "k": "n", "w": ["narrator"], "e": ["s0"]}
        for segments in [[s], [s, s]]:
            with self.assertRaisesRegex(ValueError, "target coverage"):
                expand_compact({"characters": [], "segments": segments}, lookup, True, plan)

    def test_missing_evidence_is_not_filled_in(self):
        plan = {"anchors": [{"id": "a0", "start": 0, "text": "甲"}]}
        value = {"characters": [], "segments": [{"r": "s0", "k": "n", "w": ["narrator"], "e": []}]}
        with self.assertRaisesRegex(ValueError, "missing evidence"):
            expand_compact(value, {"s0": {"start": 0, "end": 3}}, True, plan)

    def test_score_requires_complete_type_and_speaker_agreement(self):
        gold = [{"id": "u1", "start": 0, "end": 6, "kind": "speech", "speakers": ["甲"]}]
        correct = [{"start": 0, "end": 3, "kind": "speech", "speaker": "甲"},
                   {"start": 3, "end": 6, "kind": "speech", "speaker": "甲"}]
        self.assertEqual(score(correct, gold)["correct"], 1)
        self.assertEqual(score(correct[:1], gold)["correct"], 0)
        correct[1]["speaker"] = "unknown"
        self.assertEqual(score(correct, gold)["correct"], 0)


if __name__ == "__main__":
    unittest.main()
