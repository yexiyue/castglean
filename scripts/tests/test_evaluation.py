"""Constructed correct and incorrect outputs, not just gold self-validation."""
import copy
import importlib.util
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

from evaluation.runner import limits, plan, run_suite
from evaluation.scoring import aggregate, failed_metrics, identity_matchings, score_documents
from evaluation.suite import ROOT, load, verify_suite

SUITE = ROOT / "evaluations/attribution-v1"


def documents(name):
    path = SUITE / name
    return ((path / "chapter.txt").read_bytes(), load(path / "characters.json"), load(path / "chapter.annotations.json"), load(path / "evaluation.json"))


class ScoringTests(unittest.TestCase):
    def score(self, name, change=lambda r, a: None, limit=10000):
        source, registry, annotation, metadata = documents(name)
        predicted_registry, predicted = copy.deepcopy(registry), copy.deepcopy(annotation)
        change(predicted_registry, predicted)
        return score_documents(source, registry, annotation, metadata, predicted_registry, predicted, limit)

    def test_all_forty_correct_and_frozen(self):
        suite = verify_suite(SUITE)
        for item in suite["samples"]:
            with self.subTest(item=item["id"]):
                result = self.score(item["id"])
                self.assertEqual(result["correct_lower"], result["units"])
                self.assertEqual(result["kind_correct_bytes"], result["source_bytes"])
                self.assertEqual(result["extra_characters"], 0)
                self.assertEqual(result["missing_characters"], 0)

    def test_v2_correction_is_frozen_and_does_not_rewrite_v1_answers(self):
        corrected = ROOT / "evaluations/attribution-v2"
        suite = verify_suite(corrected)
        for item in suite["samples"]:
            old, new = SUITE / item["id"], corrected / item["id"]
            self.assertEqual((old / "chapter.txt").read_bytes(), (new / "chapter.txt").read_bytes())
            self.assertEqual((old / "chapter.annotations.json").read_bytes(), (new / "chapter.annotations.json").read_bytes())
            source = (new / "chapter.txt").read_bytes()
            registry, annotation, metadata = (load(new / f) for f in ("characters.json", "chapter.annotations.json", "evaluation.json"))
            result = score_documents(source, registry, annotation, metadata, registry, annotation)
            self.assertEqual(result["correct_lower"], result["units"])
        self.assertNotIn("递水的女孩", load(SUITE / "anonymous-04/evaluation.json")["identities"][1]["allowed_labels"])
        self.assertIn("递水的女孩", load(corrected / "anonymous-04/evaluation.json")["identities"][1]["allowed_labels"])

    def test_all_unknown_does_not_get_resolved_credit(self):
        def change(r, a):
            for segment in a["segments"]:
                if segment.get("attribution"):
                    segment["attribution"] = {"status": "unknown", "evidence_segment_ids": [], "review_status": "unreviewed"}
        result = self.score("explicit-02", change)
        self.assertEqual(result["correct_lower"], 0)
        self.assertEqual(result["resolved_units"], 0)
        self.assertEqual(result["confusion"], {"resolved->unknown": 2})

    def test_false_resolved_unknown_voice(self):
        def change(r, a):
            a["segments"][1]["attribution"] = {"status": "resolved", "character_id": "shen", "evidence_segment_ids": ["seg-001"], "review_status": "unreviewed"}
        result = self.score("unowned-02", change)
        self.assertEqual(result["correct_lower"], 0)
        self.assertEqual(result["confusion"], {"unknown->resolved": 1})

    def test_missing_candidate(self):
        def change(r, a):
            a["segments"][0]["attribution"]["candidate_ids"].remove("tong")
        result = self.score("candidates-03", change)
        self.assertEqual(result["correct_lower"], 0)
        self.assertEqual(result["confusion"], {"ambiguous->ambiguous": 1})

    def test_merged_identities(self):
        def change(r, a):
            r["characters"] = r["characters"][:1]
            for s in a["segments"]:
                if s.get("attribution"):
                    s["attribution"]["character_id"] = "left"
        result = self.score("same_name-01", change)
        self.assertEqual(result["correct_lower"], 1)
        self.assertEqual(result["missing_characters"], 1)

    def test_duplicate_anonymous_identity(self):
        def change(r, a):
            duplicate = copy.deepcopy(r["characters"][0])
            duplicate["id"] = "duplicate"
            r["characters"].append(duplicate)
            a["segments"][3]["attribution"]["character_id"] = "duplicate"
        result = self.score("anonymous-01", change)
        self.assertEqual(result["correct_lower"], 1)
        self.assertEqual(result["extra_characters"], 1)
        self.assertEqual(result["matching_solutions"], 2)

    def test_book_name_fake_character(self):
        def change(r, a):
            r["characters"].append({"id": "book", "display_name": "归港", "aliases": [], "review_status": "unreviewed",
                                    "evidence": [{"chapter_id": "ch-001", "segment_id": "seg-002"}]})
        result = self.score("quoted-01", change)
        self.assertEqual(result["extra_characters"], 1)
        self.assertEqual(result["units"], 0)

    def test_rejected_identity_edges_are_diagnostic_not_score_tuning(self):
        def change(r, a):
            r["characters"][0]["evidence"] = [{"chapter_id": "ch-001", "segment_id": "seg-002"}]
        result = self.score("explicit-01", change)
        self.assertEqual(result["correct_lower"], 0)
        self.assertEqual(result["identity_alignment"], "partial")
        self.assertEqual(result["unmatched_identity_diagnostics"], [{"character_id": "su", "reason": "evidence_misses_annotated_mentions"}])

    def test_grounded_label_variant_still_follows_frozen_allowlist(self):
        def change(r, a):
            r["characters"][1]["display_name"] = "递水的女孩"
        result = self.score("anonymous-04", change)
        self.assertEqual(result["correct_lower"], 1)
        self.assertEqual(result["identity_alignment"], "partial")
        self.assertEqual(result["unmatched_identity_diagnostics"], [{"character_id": "girl", "reason": "label_not_allowed"}])

    def test_anonymous_continuation(self):
        result = self.score("anonymous-03")
        self.assertEqual(result["correct_lower"], 2)
        self.assertEqual(result["predicted_characters"], 1)

    def test_arbitrary_id_swap_is_not_an_error(self):
        def change(r, a):
            mapping = {"left": "right", "right": "left"}
            for c in r["characters"]:
                c["id"] = mapping[c["id"]]
            for s in a["segments"]:
                if s.get("attribution"):
                    attr = s["attribution"]
                    attr["character_id"] = mapping[attr["character_id"]]
        result = self.score("same_name-01", change)
        self.assertEqual(result["correct_lower"], 2)

    def test_same_name_wrong_attribution(self):
        def change(r, a):
            for s in a["segments"]:
                if s.get("attribution"):
                    attr = s["attribution"]
                    attr["character_id"] = {"left": "right", "right": "left"}[attr["character_id"]]
        result = self.score("same_name-01", change)
        self.assertEqual(result["correct_lower"], 0)

    def test_multiple_matchings_global_bounds(self):
        def change(r, a):
            for c in r["characters"]:
                c["aliases"] = []
                c["evidence"] = [{"chapter_id": "ch-001", "segment_id": "seg-001"}, {"chapter_id": "ch-001", "segment_id": "seg-003"}]
        result = self.score("same_name-01", change)
        self.assertEqual((result["correct_lower"], result["correct_upper"]), (0, 2))
        self.assertEqual(result["identity_alignment"], "multiple")
        limited = self.score("same_name-01", change, limit=1)
        self.assertEqual(limited["identity_alignment"], "limit_exceeded")
        self.assertIsNone(limited["matched_characters"])

    def test_more_than_ten_thousand_solutions(self):
        # 8! symmetric matchings, an intentionally adversarial scorer input.
        chars = [{"id": str(i), "display_name": "甲", "aliases": [], "evidence": [{"chapter_id": "c", "segment_id": "s"}]} for i in range(8)]
        registry = {"characters": chars}
        annotation = {"chapter_id": "c", "segments": [{"id": "s", "start": 0, "end": 3}]}
        metadata = {"identities": [{"character_id": str(i), "allowed_labels": ["甲"], "mentions": [{"start": 0, "end": 3}]} for i in range(8)]}
        self.assertEqual(identity_matchings(registry, annotation, metadata), (None, None))

    def test_many_extra_characters_do_not_exhaust_recursion(self):
        source, registry, annotation, metadata = documents("explicit-01")
        characters = []
        for i in range(1500):
            c = copy.deepcopy(registry["characters"][0])
            c["id"] = f"extra-{i}"
            c["display_name"] = "无依据的名字"
            characters.append(c)
        predicted = {"characters": characters}
        self.assertEqual(identity_matchings(predicted, annotation, metadata), ([{}], 0))

    def test_slice_boundaries_utf8(self):
        def change(r, a):
            segment = a["segments"][1]
            left, right = copy.deepcopy(segment), copy.deepcopy(segment)
            left["end"] = left["start"] + 3
            right["start"] = left["end"]
            right["id"] = "extra-slice"
            a["segments"][1:2] = [left, right]
        self.assertEqual(self.score("explicit-01", change)["correct_lower"], 1)

    def test_partial_wrong_kind_loses_whole_expression(self):
        def change(r, a):
            segment = copy.deepcopy(a["segments"][1])
            tail = copy.deepcopy(segment)
            segment["end"] = segment["start"] + 3
            segment["kind"] = "quoted_text"
            del segment["attribution"]
            tail["id"], tail["start"] = "tail", segment["end"]
            a["segments"][1:2] = [segment, tail]
        result = self.score("explicit-01", change)
        self.assertEqual(result["correct_lower"], 0)
        self.assertEqual(result["source_bytes"] - result["kind_correct_bytes"], 3)

    def test_invalid_gaps_references_hashes_and_utf8(self):
        changes = [lambda r, a: a["segments"][1].update(start=13),
                   lambda r, a: a["segments"][1]["attribution"].update(character_id="absent"),
                   lambda r, a: a["source"].update(sha256="0" * 64),
                   lambda r, a: a["source"].update(import_sha256="0" * 64),
                   lambda r, a: a["segments"][0].update(end=1)]
        for change in changes:
            with self.assertRaises((ValueError, UnicodeDecodeError)):
                self.score("explicit-01", change)

    def test_valid_artifact_bound_to_other_book_is_rejected(self):
        def change(r, a):
            r["book_id"] = a["book_id"] = "other-book"
        with self.assertRaisesRegex(ValueError, "chapter_binding"):
            self.score("explicit-01", change)

    def test_failures_and_unknown_usage_count_in_denominator(self):
        good = {"state": "delivered", "metrics": self.score("explicit-01"), "wall_ms": 10,
                "usage": {"input_tokens": 20, "output_tokens": 30}}
        for state in ("not_attempted", "run_failed", "artifact_invalid"):
            bad = {"state": state, "metrics": failed_metrics(SUITE / "explicit-01"), "usage": None}
            result = aggregate([good, bad])
            self.assertEqual(result["joint_accuracy_lower"], 0.5)
            self.assertEqual(result["delivery_rate"], 0.5)
            self.assertIsNone(result["input_tokens"])
            self.assertEqual(result["observed_input_tokens"], 20)
            self.assertEqual(result["missing_characters"], 1)


class RunnerTests(unittest.TestCase):
    def test_plan_seed_and_complete_denominator(self):
        suite = verify_suite(SUITE)
        def make(seed, split="all"):
            return plan(suite, SUITE, Path("runs/test"), "local", "test", 2, split, seed)
        self.assertEqual(make(42), make(42))
        self.assertNotEqual(make(42), make(43))
        self.assertEqual(len(make(42)), 80)
        self.assertEqual(len(make(42, "holdout")), 40)
        self.assertEqual(aggregate(make(42))["states"], {"not_attempted": 80})
        self.assertEqual(aggregate(make(42))["delivery_rate"], 0)

    def test_fixed_budgets(self):
        for backend, tokens in (("local", "2048"), ("minimax", "8192")):
            pairs = dict(zip(limits(backend)[::2], limits(backend)[1::2]))
            self.assertEqual(pairs, {"--window-chars": "1000", "--window-segments": "8", "--max-output-tokens": tokens,
                                     "--timeout-secs": "120", "--chapter-timeout-secs": "600", "--max-requests": "8", "--max-repairs-per-window": "1"})

    def test_failed_run_is_serial_no_retry_and_manifest_is_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "fake-binary"
            binary.write_bytes(b"offline")
            args = Namespace(suite=SUITE, binary=binary, runs=Path(temporary), backend="local", label="test", repeats=1, split="development", seed=42)
            process = unittest.mock.Mock(returncode=1)
            process.communicate.return_value = (b"", b"analysis: timeout")
            with patch("evaluation.runner.verify_suite", return_value=load(SUITE / "suite.json")), patch("evaluation.runner.platform.platform", return_value="offline-test"), patch("evaluation.runner.subprocess.Popen", return_value=process) as popen, patch("builtins.print"):
                run_suite(args)
            manifest = load(Path(temporary) / "local-test.json")
            self.assertEqual(popen.call_count, 20)
            self.assertEqual(len(manifest["actual_order"]), 20)
            self.assertEqual(manifest["summary"]["overall"]["states"], {"run_failed": 20})
            self.assertIsNone(manifest["summary"]["overall"]["input_tokens"])
            self.assertIsNone(manifest["summary"]["overall"]["observed_input_tokens"])
            self.assertTrue(all(not Path(a["output"]).exists() for a in manifest["attempts"]))

    def test_legacy_scoring_behavior_retained(self):
        spec = importlib.util.spec_from_file_location("legacy", ROOT / "scripts/evaluate-baseline.py")
        legacy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(legacy)
        self.assertEqual(legacy.attribution_key({"status": "ambiguous", "candidate_ids": ["a", "b"]}, {"a": "老张", "b": "老张"}), ("ambiguous", ("老张", "老张")))

    def test_invalid_success_artifacts_keep_observed_usage(self):
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "fake-binary"
            binary.write_bytes(b"offline")
            args = Namespace(suite=SUITE, binary=binary, runs=Path(temporary), backend="local", label="invalid", repeats=1, split="holdout", seed=42)
            process = unittest.mock.Mock(returncode=0)
            process.communicate.return_value = (b"", b"")
            stats = {"prompt_version": 5, "model": "offline", "requests": 1, "repair_requests": 0, "repaired_windows": 0,
                     "usage": [{"input": 10, "output": 20, "reasoning": None}]}
            def mock_load(path):
                return stats if path.name == "analysis.stats.json" else load(path)
            with patch("evaluation.runner.verify_suite", return_value=load(SUITE / "suite.json")), patch("evaluation.runner.platform.platform", return_value="offline-test"), patch("evaluation.runner.subprocess.Popen", return_value=process), patch("evaluation.runner.load", side_effect=mock_load), patch("evaluation.runner.cli_validate", side_effect=ValueError("application_validation")), patch("builtins.print"):
                run_suite(args)
            result = load(Path(temporary) / "local-invalid.json")["summary"]["overall"]
            self.assertEqual(result["states"], {"artifact_invalid": 20})
            self.assertEqual(result["delivery_rate"], 0)
            self.assertEqual(result["input_tokens"], 200)
            self.assertIsNone(result["reasoning_tokens"])

    def test_interruption_keeps_remaining_attempts(self):
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "fake-binary"
            binary.write_bytes(b"offline")
            args = Namespace(suite=SUITE, binary=binary, runs=Path(temporary), backend="local", label="cancel", repeats=1, split="development", seed=42)
            process = unittest.mock.Mock()
            process.communicate.side_effect = [KeyboardInterrupt(), (b"", b"")]
            with patch("evaluation.runner.verify_suite", return_value=load(SUITE / "suite.json")), patch("evaluation.runner.platform.platform", return_value="offline-test"), patch("evaluation.runner.subprocess.Popen", return_value=process), self.assertRaises(KeyboardInterrupt):
                run_suite(args)
            manifest = load(Path(temporary) / "local-cancel.json")
            self.assertEqual(manifest["summary"]["overall"]["states"], {"run_failed": 1, "not_attempted": 19})
            process.terminate.assert_called_once()


if __name__ == "__main__":
    unittest.main()
