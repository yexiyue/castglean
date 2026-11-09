"""Offline audit contract tests using public synthetic text only."""

import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location(
    "chapter_quality_audit", Path(__file__).with_name("chapter_quality_audit.py")
)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def anchors_for(parts):
    anchors = []
    offset = 0
    for index, part in enumerate(parts):
        end = offset + len(part.encode("utf-8"))
        anchors.append({"start": offset, "end": end, "text": part, "id": f"p{index}"})
        offset = end
    return anchors


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.parts = ["前🙂\r\n", "甲说：“你好。”", "\r\n乙没有回答。"]
        self.text = "".join(self.parts)
        self.anchors = anchors_for(self.parts)
        self.samples = AUDIT.make_samples(self.text, self.anchors)
        self.aliases = {"A": "classic", "B": "ecs", "C": "json"}

    def issue(self, **overrides):
        result = {"sampleId": "q1", "route": "A", "category": "speaker",
                  "confidence": "high", "reason": "合成人物甲的归属存在疑点"}
        result.update(overrides)
        return result

    def assert_code(self, code, call, *args):
        with self.assertRaises(ValueError) as caught:
            call(*args)
        self.assertEqual(str(caught.exception), code)

    def test_unicode_crlf_ranges_and_exact_text(self):
        raw = self.text.encode("utf-8")
        for number, (sample, anchor) in enumerate(zip(self.samples, self.anchors), 1):
            self.assertEqual(sample["id"], f"q{number}")
            self.assertEqual(sample["start"], anchor["start"])
            self.assertEqual(sample["end"], anchor["end"])
            self.assertEqual(raw[sample["contextStart"]:sample["contextEnd"]].decode(), sample["text"])
            self.assertIn("\r\n", sample["text"])

    def test_context_is_180_unicode_codepoints_not_bytes(self):
        parts = ["前🙂\r\n" * 60, "焦点🦊", "后e\u0301\r\n" * 60]
        text = "".join(parts)
        sample = AUDIT.make_samples(text, anchors_for(parts), count=1)[0]
        expected = parts[0][-180:] + parts[1] + parts[2][:180]
        self.assertEqual(sample["text"], expected)
        raw = text.encode()
        self.assertEqual(raw[sample["contextStart"]:sample["contextEnd"]].decode(), expected)
        self.assertEqual(sample["start"] - sample["contextStart"], len(parts[0][-180:].encode()))

    def test_equidistant_source_only_deterministic_no_repeats(self):
        parts = [f"公开片段{i}🙂\r\n" for i in range(24)]
        anchors = anchors_for(parts)
        selected = AUDIT.make_samples("".join(parts), anchors)
        self.assertEqual([s["start"] for s in selected], [anchors[i]["start"] for i in (0, 3, 6, 9, 13, 16, 19, 23)])
        self.assertEqual(len({(s["start"], s["end"]) for s in selected}), 8)
        self.assertEqual(selected, AUDIT.make_samples("".join(parts), list(reversed(anchors))))
        self.assertEqual(selected, AUDIT.make_samples("".join(parts), anchors + anchors))
        self.assertEqual(len(self.samples), 3)
        self.assertEqual(AUDIT.make_samples("", []), [])
        self.assertEqual(AUDIT.make_samples(self.text, self.anchors, 0), [])

    def test_invalid_source_ranges_fail_with_private_safe_codes(self):
        for start, end in [(1, 2), (False, 3), (0, 10000), (3, 3), (-1, 3)]:
            bad = [{"start": start, "end": end, "text": "隐私正文", "id": "p"}]
            self.assert_code("audit_invalid_anchor_range", AUDIT.make_samples, self.text, bad)
        bad = copy.deepcopy(self.anchors)
        bad[0]["text"] = "不匹配"
        self.assert_code("audit_anchor_source_mismatch", AUDIT.make_samples, self.text, bad)
        for count in (-1, True, 1.5):
            self.assert_code("audit_invalid_count", AUDIT.make_samples, self.text, self.anchors, count)

    def test_anonymous_mapping_and_all_overlaps_relative_to_focus(self):
        sample = self.samples[1]
        start, end = sample["start"], sample["end"]
        split = start + len("甲说：".encode())
        segments = [
            {"start": 0, "end": start, "kind": "narration", "speaker": None},
            {"start": 0, "end": split, "kind": "narration", "speaker": "旁白"},
            {"start": split, "end": end + 2, "kind": "speech", "speaker": "甲"},
            {"start": end, "end": len(self.text.encode()), "kind": "narration", "speaker": None},
        ]
        outputs = {"classic": segments, "ecs": [], "json": [segments[1]]}
        frozen = copy.deepcopy((self.samples, outputs, self.aliases))
        serialized = AUDIT.make_audit_input([sample], outputs, self.aliases)
        for route in self.aliases.values():
            self.assertNotIn(route, serialized)
        prepared = json.loads(serialized)["samples"][0]
        self.assertEqual(prepared["focus"], {"start": start, "end": end})
        self.assertEqual(prepared["outputs"]["A"], [
            {"start": 0, "end": split - start, "kind": "narration", "speaker": "旁白"},
            {"start": split - start, "end": end - start, "kind": "speech", "speaker": "甲"},
        ])
        self.assertEqual(prepared["outputs"]["B"], [])
        self.assertEqual(len(prepared["outputs"]["C"]), 1)
        self.assertEqual((self.samples, outputs, self.aliases), frozen)
        # A spanning label and multiple overlapping labels must all survive.
        outputs["ecs"] = [dict(segments[1], end=end), segments[1]]
        prepared = json.loads(AUDIT.make_audit_input([sample], outputs, self.aliases))["samples"][0]
        self.assertEqual(len(prepared["outputs"]["B"]), 2)

    def test_focus_offsets_are_relative_to_nonzero_context(self):
        parts = ["🙂" * 220, "甲乙", "\r\n尾"]
        sample = AUDIT.make_samples("".join(parts), anchors_for(parts), 1)[0]
        prepared = json.loads(AUDIT.make_audit_input([sample], {"classic": []}, {"A": "classic"}))["samples"][0]
        self.assertGreater(sample["contextStart"], 0)
        self.assertEqual(prepared["focus"], {"start": 720, "end": 726})

    def test_aliases_and_outputs_are_closed_and_one_to_one(self):
        for aliases in ({}, {"D": "classic"}, {"A": []}, {"A": "classic", "B": "classic"}):
            self.assert_code("audit_invalid_aliases", AUDIT.make_audit_input, self.samples, {}, aliases)
        self.assert_code("audit_invalid_outputs", AUDIT.make_audit_input, self.samples, {"classic": []}, self.aliases)

    def test_empty_and_valid_issues_and_defensive_copy(self):
        self.assertEqual(AUDIT.validate_audit({"issues": []}, self.samples, self.aliases), {"issues": []})
        value = {"issues": [self.issue(), self.issue(category="kind"),
                            self.issue(route="B", category="insufficient_context", confidence="low")]}
        validated = AUDIT.validate_audit(value, self.samples, self.aliases)
        self.assertEqual(validated, value)
        validated["issues"][0]["reason"] = "改动"
        self.assertNotEqual(validated, value)

    def test_unknown_references_and_duplicate_category_rejected(self):
        for issue, code in [
            (self.issue(sampleId="missing"), "audit_unknown_sample"),
            (self.issue(route="classic"), "audit_unknown_route"),
            (self.issue(route="D"), "audit_unknown_route"),
        ]:
            self.assert_code(code, AUDIT.validate_audit, {"issues": [issue]}, self.samples, self.aliases)
        value = {"issues": [self.issue(), self.issue(confidence="low", reason="另一个原因")]}
        self.assert_code("audit_duplicate_issue", AUDIT.validate_audit, value, self.samples, self.aliases)
        self.assert_code("audit_unknown_route", AUDIT.validate_audit,
                         {"issues": [self.issue(route="C")]}, self.samples, {"A": "classic"})

    def test_strict_fields_and_types(self):
        for value in (None, [], "{}", {}, {"issues": {}}, {"issues": [], "passed": True}):
            self.assert_code("audit_invalid_schema", AUDIT.validate_audit, value, self.samples, self.aliases)
        bad_issues = [None, {}, self.issue(extra="private"), self.issue(category="accuracy"),
                      self.issue(confidence="medium"), self.issue(reason=1), self.issue(route=[])]
        missing = self.issue()
        del missing["reason"]
        for issue in bad_issues + [missing]:
            self.assert_code("audit_invalid_issue", AUDIT.validate_audit,
                             {"issues": [issue]}, self.samples, self.aliases)

    def test_summary_contains_only_real_routes_and_zero_filled_counts(self):
        value = {"issues": [self.issue(), self.issue(sampleId="q2"),
                            self.issue(route="C", category="insufficient_context", confidence="low")]}
        validated = AUDIT.validate_audit(value, self.samples, self.aliases)
        summary = AUDIT.summarize_audit(validated, self.aliases)
        self.assertEqual(set(summary), set(self.aliases.values()))
        self.assertEqual(summary["classic"]["speaker"], {"high": 2, "low": 0})
        self.assertEqual(summary["json"]["insufficient_context"], {"high": 0, "low": 1})
        self.assertTrue(all(n == 0 for counts in summary["ecs"].values() for n in counts.values()))
        self.assertNotIn("reason", json.dumps(summary))
        self.assertNotIn("甲", json.dumps(summary, ensure_ascii=False))
        self.assertNotIn("passed", summary)

    def test_schema_is_static_and_closed(self):
        schema = json.loads(json.dumps(AUDIT.AUDIT_SCHEMA))
        item = schema["properties"]["issues"]["items"]
        self.assertFalse(schema["additionalProperties"])
        self.assertFalse(item["additionalProperties"])
        self.assertEqual(set(item["required"]), set(self.issue()))
        self.assertEqual(item["properties"]["route"]["enum"], ["A", "B", "C"])

    def test_functions_are_silent_including_validation_failures(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            samples = AUDIT.make_samples(self.text, self.anchors)
            AUDIT.make_audit_input(samples, {route: [] for route in self.aliases.values()}, self.aliases)
            validated = AUDIT.validate_audit({"issues": []}, samples, self.aliases)
            AUDIT.summarize_audit(validated, self.aliases)
            self.assert_code("audit_unknown_sample", AUDIT.validate_audit,
                             {"issues": [self.issue(sampleId="private")]}, samples, self.aliases)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
