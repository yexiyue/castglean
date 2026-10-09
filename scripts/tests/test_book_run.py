"""Independent prefix checks and finite invocation/reporting contracts."""
import copy
import json
import subprocess
import tempfile
import unittest
from runpy import run_path
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from evaluation.book_run import safe_failure_report, check_prefix, failure_category, identity_observation, run_verification, sha, write
from evaluation.suite import ROOT


class BookRunTests(unittest.TestCase):
    def test_cli_requires_actual_identity_reuse_when_labels_are_requested(self):
        report = {"complete": True, "application_validation": True, "repeat_resume_success": True, "repeat_receipts_unchanged": True,
                  "identity_observation": {"single_label_identity_throughout": True, "observed_reuse_in_every_later_chapter": False}}
        with patch("evaluation.book_run.run_verification", return_value=report), patch("sys.argv", ["verify-book-run", "--binary", "binary", "--plan", "plan", "--output", "output", "--identity-label", "label"]):
            main = run_path(str(ROOT / "scripts/verify-book-run.py"))["main"]
            with self.assertRaises(SystemExit):
                main()
            # Candidate counts are diagnostics, not a name-based identity merge rule.
            report["identity_observation"]["observed_reuse_in_every_later_chapter"] = True
            report["identity_observation"]["single_label_identity_throughout"] = False
            main()
            report["planned_chapters"] = 1
            report["identity_observation"]["observed_reuse_in_every_later_chapter"] = False
            main()

    def test_structured_failure_filters_private_fields_and_rejects_bad_references(self):
        target = {"segment_id": "seg-v1-" + "a" * 64 + "-0-3", "reference": "s0", "start": 0, "end": 3, "whitespace_only": False}
        diagnostic = {"format_version": 1, "category": "missing_target", "stage": "window", "accepted_windows": 2,
                      "window": {"index": 2, "start": 0, "end": 3, "targets": [target], "missing_targets": [target], "repairs_attempted": 1, "repair_exhausted": True, "private": "secret"},
                      "stats": {"requests": 1, "repair_requests": 1, "repaired_windows": 0, "elapsed_ms": 8, "usage": [{"input": 3, "output": None, "reasoning": None}], "response_bytes": [12]}, "private": "secret"}
        safe = safe_failure_report(diagnostic)
        self.assertNotIn("secret", json.dumps(safe))
        self.assertIsNone(safe["stats"]["usage"][0]["output"])
        diagnostic["window"]["targets"][0]["reference"] = "private-response"
        with self.assertRaises(ValueError):
            safe_failure_report(diagnostic)

    def test_structured_failure_takes_precedence_and_counts_received_responses(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            binary = path / "binary"
            binary.write_bytes(b"offline")
            plan = path / "plan.json"
            plan.write_bytes((ROOT / "examples/run-recovery/glm-plan.json").read_bytes())
            def invoke(argv):
                if "--failure-report" in argv:
                    write(Path(argv[argv.index("--failure-report") + 1]), {"format_version": 1, "category": "service", "stage": "window", "window": None, "accepted_windows": 1,
                      "stats": {"requests": 1, "repair_requests": 0, "repaired_windows": 0, "elapsed_ms": 10, "usage": [{"input": None, "output": None, "reasoning": None}], "response_bytes": [8]}})
                return SimpleNamespace(returncode=1, stderr=b"private-source")
            with patch("builtins.print"):
                report = run_verification(binary, plan, path / "run", invoke=invoke, failure_reports=True)
            self.assertEqual(report["steps"][0]["failure_category"], "service")
            self.assertEqual(report["failed_received_responses"], 1)
            self.assertIsNone(report["uncommitted_usage"])
            self.assertNotIn("private-source", json.dumps(report))

    def test_cli_rejects_failed_repeat_resume(self):
        report = {"complete": True, "application_validation": True,
                  "repeat_resume_success": False, "repeat_receipts_unchanged": True}
        with patch("evaluation.book_run.run_verification", return_value=report), patch("sys.argv", [
                "verify-book-run", "--binary", "binary", "--plan", "plan", "--output", "output"]):
            main = run_path(str(ROOT / "scripts/verify-book-run.py"))["main"]
            with self.assertRaises(SystemExit) as error:
                main()
            self.assertEqual(error.exception.code, 1)
    def test_safe_failure_codes_discard_error_payloads(self):
        self.assertEqual(failure_category(b"missing target annotation at /segments secret-key"), "missing_target")
        self.assertEqual(failure_category(b"truncated response private text"), "truncated_response")
        self.assertEqual(failure_category(b"unknown private text secret"), "process_failed")
    def test_prefix_preserves_human_data_and_detects_changes(self):
        old = {"registry": {"revision": 3, "characters": [{"id": "old", "review_status": "confirmed"}]},
               "chapters": [{"text": "私有正文", "annotations": {"character_revision": 3, "human": True}}],
               "changes": [{"revision": 3}]}
        after = copy.deepcopy(old)
        after["registry"]["revision"] = 4
        after["chapters"][0]["annotations"]["character_revision"] = 4
        after["chapters"].append({"text": "next"})
        after["changes"].append({"revision": 4})
        self.assertTrue(check_prefix(old, after))
        for mode in ["body", "human", "identity", "history"]:
            bad = copy.deepcopy(after)
            if mode == "body":
                bad["chapters"][0]["text"] = "changed"
            elif mode == "human":
                bad["chapters"][0]["annotations"]["human"] = False
            elif mode == "identity":
                bad["registry"]["characters"][0]["review_status"] = "unreviewed"
            else:
                bad["changes"][0]["revision"] = 1
            self.assertFalse(check_prefix(old, bad))

    def test_registry_retention_alone_does_not_count_as_observed_reuse(self):
        book = {"registry": {"characters": [{"id": "p", "display_name": "人名", "aliases": []}]},
                "chapters": [{"annotations": {"segments": [{"attribution": None}]}}]}
        observed = identity_observation([book, copy.deepcopy(book)], ["人名"])
        self.assertTrue(observed["single_label_identity_throughout"])
        self.assertFalse(observed["observed_reuse_in_every_later_chapter"])
        second = copy.deepcopy(book)
        second["chapters"][0]["annotations"]["segments"][0]["attribution"] = {"character_id": "p"}
        self.assertTrue(identity_observation([book, second], ["人名"])["observed_reuse_in_every_later_chapter"])
        second["registry"]["characters"].append({"id": "duplicate", "display_name": "人名", "aliases": []})
        self.assertFalse(identity_observation([book, second], ["人名"])["single_label_identity_throughout"])

    def test_failure_stops_without_retry_and_never_records_private_stderr(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            binary = path / "binary"
            binary.write_bytes(b"offline")
            plan = path / "plan.json"
            plan.write_bytes((ROOT / "examples/run-recovery/glm-plan.json").read_bytes())
            calls = []

            def invoke(argv):
                calls.append(argv)
                self.assertTrue((path / "run/freeze.json").exists())
                return SimpleNamespace(returncode=1, stderr=b"secret-credential private-source")

            with patch("builtins.print"):
                report = run_verification(binary, plan, path / "run", invoke=invoke)
            self.assertFalse(report["complete"])
            self.assertEqual(report["completed_chapters"], 0)
            self.assertEqual(report["not_executed_chapters"], 1)
            # One model process, then offline inspection; no resume/retry.
            self.assertEqual([c[1] for c in calls], ["run", "run-inspect"])
            self.assertIsNone(report["uncommitted_usage"])
            self.assertNotIn("secret-credential", json.dumps(report))
            self.assertNotIn("private-source", json.dumps(report))

    def test_timeout_has_unknown_cost_and_safe_category(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            binary = path / "binary"
            binary.write_bytes(b"offline")
            plan = path / "plan.json"
            plan.write_bytes((ROOT / "examples/run-recovery/glm-plan.json").read_bytes())

            def invoke(argv):
                raise subprocess.TimeoutExpired(argv, 620, stderr=b"secret")

            with patch("builtins.print"):
                report = run_verification(binary, plan, path / "run", invoke=invoke)
            self.assertEqual(report["steps"][0]["failure_category"], "process_timeout")
            self.assertIsNone(report["uncommitted_usage"])

    def test_failed_resume_preserves_checkpoint_and_skips_later_chapters(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            binary = path / "binary"
            binary.write_bytes(b"offline")
            data = json.loads((ROOT / "examples/run-recovery/glm-plan.json").read_text(encoding="utf-8"))
            third = copy.deepcopy(data["chapters"][1])
            third["chapter_id"] = "third"
            data["chapters"].append(third)
            plan = path / "plan.json"
            write(plan, data)
            calls, first_hash = [], []

            def invoke(argv):
                calls.append(argv[1])
                if argv[1] == "run":
                    book = copy.deepcopy(data["base"])
                    book["registry"]["revision"] = 2
                    chapter = data["chapters"][0]
                    book["chapters"] = [{"text": chapter["text"], "annotations": {"source": chapter["source"],
                        "character_revision": 2, "segments": []}}]
                    book["changes"] = [{"revision": 2}]
                    directory = path / "run/journal/commits/00000001"
                    directory.mkdir(parents=True)
                    receipt = directory / "commit.json"
                    write(receipt, {"commit": {"book": book, "stats": {"requests": 1, "usage": []}}})
                    first_hash.append(sha(receipt.read_bytes()))
                if argv[1] == "resume":
                    return SimpleNamespace(returncode=1, stderr=b"missing target annotation secret")
                return SimpleNamespace(returncode=0)

            with patch("builtins.print"):
                report = run_verification(binary, plan, path / "run", invoke=invoke)
            self.assertFalse(report["complete"])
            self.assertEqual(report["completed_chapters"], 1)
            self.assertEqual(report["not_executed_chapters"], 1)
            self.assertEqual(calls, ["run", "resume", "run-inspect", "validate"])
            self.assertTrue(report["application_validation"])
            self.assertEqual(report["steps"][1]["failure_category"], "missing_target")
            self.assertEqual(first_hash[0], sha((path / "run/journal/commits/00000001/commit.json").read_bytes()))
            self.assertTrue(report["committed_receipts_unchanged"])

    def test_success_freeze_repeat_resume_and_public_summary(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            binary = path / "binary"
            binary.write_bytes(b"offline")
            plan = path / "plan.json"
            data = json.loads((ROOT / "examples/run-recovery/glm-plan.json").read_text(encoding="utf-8"))
            write(plan, data)
            book = copy.deepcopy(data["base"])
            model_processes = []

            def invoke(argv):
                if argv[1] in ("run", "resume"):
                    model_processes.append(argv[1])
                    n = len(book["chapters"])
                    if n < len(data["chapters"]):
                        chapter = data["chapters"][n]
                        book["registry"]["revision"] += 1
                        for old in book["chapters"]:
                            old["annotations"]["character_revision"] += 1
                        book["chapters"].append({"text": chapter["text"], "annotations": {"source": chapter["source"], "segments": [],
                            "character_revision": book["registry"]["revision"]}})
                        book["changes"].append({"revision": book["registry"]["revision"]})
                        directory = path / "run/journal/commits" / f"{n + 1:08}"
                        directory.mkdir(parents=True)
                        write(directory / "commit.json", {"commit": {"book": copy.deepcopy(book), "stats": {
                            "requests": 1, "usage": [{"input": 10, "output": None}], "elapsed_ms": 1}}})
                return SimpleNamespace(returncode=0)

            with patch("builtins.print"):
                report = run_verification(binary, plan, path / "run", invoke=invoke)
            self.assertTrue(report["complete"])
            self.assertTrue(report["repeat_receipts_unchanged"])
            self.assertTrue(report["application_validation"])
            self.assertEqual(report["committed_responses"], 2)
            self.assertEqual(model_processes, ["run", "resume", "resume"])
            self.assertEqual(report["freeze"]["plan_sha256"], sha(plan.read_bytes()))
            self.assertNotIn(data["chapters"][0]["text"], json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
