"""Independent novel group, provenance fences and explicit run modes."""
import copy
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from runpy import run_path
from unittest.mock import Mock, patch

from evaluation.runner import run_suite
from evaluation.scoring import score_documents
from evaluation.suite import ROOT, dump, load, sha, verify_suite

SUITE = ROOT / "evaluations/literary-v1"
finalize = run_path(str(ROOT / "scripts/finalize-isolated-evaluation.py"))["finalize"]


class LiteraryTests(unittest.TestCase):
    def test_legacy_runner_does_not_ignore_explicit_quote_mode(self):
        main = run_path(str(ROOT / "scripts/compare-attribution.py"))["main"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binary = root / "binary"
            binary.write_bytes(b"offline")
            argv = ["compare-attribution", "--binary", str(binary), "--backend", "local", "--label", "legacy",
                    "--runs", str(root), "--samples", "minimal", "--repeats", "1", "--evidence-mode", "verified-quotes"]
            process = Mock(returncode=1, stderr=b"safe error")
            with patch("sys.argv", argv), patch("subprocess.run", return_value=process) as run, patch("builtins.print"):
                main()
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][-2:], ["--evidence-mode", "verified-quotes"])
            self.assertEqual(load(root / "local-legacy.json")["evidence_mode"], "verified-quotes")

    def test_frozen_six_excerpts_have_three_pinned_sources_and_constructed_errors_score_lower(self):
        suite = verify_suite(SUITE)
        sources = {}
        for item in suite["samples"]:
            path = SUITE / item["id"]
            provenance = load(path / "provenance.json")
            sources[provenance["title"]] = sources.get(provenance["title"], 0) + 1
            self.assertEqual(item["split"], "supplemental")
            source = (path / "chapter.txt").read_bytes()
            r, a, m = (load(path / f) for f in ("characters.json", "chapter.annotations.json", "evaluation.json"))
            # Re-key a correct model output: do not rely on exact gold ID reuse.
            predicted = copy.deepcopy(r)
            annotations = copy.deepcopy(a)
            ids = {c["id"]: f"predicted-{i}" for i, c in enumerate(predicted["characters"])}
            for c in predicted["characters"]:
                c["id"] = ids[c["id"]]
            for segment in annotations["segments"]:
                if segment.get("attribution"):
                    segment["attribution"]["character_id"] = ids[segment["attribution"]["character_id"]]
            correct = score_documents(source, r, a, m, predicted, annotations)
            self.assertEqual(correct["correct_lower"], correct["units"])
            for segment in annotations["segments"]:
                if segment.get("attribution"):
                    segment["attribution"] = {"status": "unknown", "review_status": "unreviewed", "evidence_segment_ids": []}
            wrong = score_documents(source, r, a, m, predicted, annotations)
            self.assertEqual(wrong["correct_lower"], 0)
            self.assertGreater(wrong["units"], 0)
        self.assertEqual(set(sources.values()), {2})
        self.assertEqual(len(sources), 3)

    def test_changed_provenance_fails_before_model_calls(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as temporary:
            destination = Path(temporary)
            suite = load(SUITE / "suite.json")
            for item in suite["samples"]:
                path = destination / item["id"]
                path.mkdir()
                for original in (SUITE / item["id"]).iterdir():
                    (path / original.name).write_bytes(original.read_bytes())
            dump(destination / "suite.json", suite)
            p = destination / suite["samples"][0]["id"] / "provenance.json"
            value = load(p)
            value["excerpt_sha256"] = "0" * 64
            dump(p, value)
            with self.assertRaisesRegex(ValueError, "literary_provenance"):
                verify_suite(destination, frozen=False)

    def test_quote_runner_records_mode_version_and_keeps_failed_denominators(self):
        with tempfile.TemporaryDirectory() as temporary:
            binary = Path(temporary) / "binary"
            binary.write_bytes(b"offline")
            args = Namespace(suite=SUITE, binary=binary, runs=Path(temporary), backend="minimax", label="quote",
                             repeats=1, split="all", seed=42, evidence_mode="verified-quotes")
            process = Mock(returncode=1)
            process.communicate.return_value = (b"", b"analysis: quotation not found")
            with patch("evaluation.runner.verify_suite", return_value=load(SUITE / "suite.json")), patch("evaluation.runner.platform.platform", return_value="offline"), patch("evaluation.runner.subprocess.Popen", return_value=process) as popen, patch("builtins.print"):
                run_suite(args)
            self.assertEqual(popen.call_count, 6)
            for call in popen.call_args_list:
                self.assertEqual(call.args[0][-2:], ["--evidence-mode", "verified-quotes"])
            report = load(Path(temporary) / "minimax-quote.json")
            self.assertEqual(report["prompt_version"], 10)
            self.assertEqual(report["evidence_mode"], "verified-quotes")
            self.assertEqual(report["summary"]["overall"]["states"], {"run_failed": 6})
            self.assertIsNone(report["summary"]["overall"]["input_tokens"])

    def test_isolated_finalizer_never_completes_unexecuted_or_changed_binary(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            binary = path / "binary"
            binary.write_bytes(b"fixed")
            snapshot = path / "source"
            snapshot.mkdir()
            (snapshot / "protocol.rs").write_bytes(b"fixed source")
            protocol = {"protocol.rs": sha(b"fixed source")}
            dump(snapshot / "protocol.json", protocol)
            manifest = path / "manifest.json"
            data = {"binary_sha256": sha(b"fixed"), "protocol_files": protocol, "actual_order": [],
                    "attempts": [{"state": "not_attempted", "wall_ms": None}]}
            dump(manifest, data)
            with self.assertRaisesRegex(ValueError, "run_not_fully_executed"):
                finalize(manifest, binary, snapshot)
            binary.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "execution_binary_changed"):
                finalize(manifest, binary, snapshot)


if __name__ == "__main__":
    unittest.main()
