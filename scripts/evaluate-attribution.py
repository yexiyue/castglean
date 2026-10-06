"""Validate/freeze the new suite or independently recompute a run manifest."""
import argparse
import json
from collections import Counter
from pathlib import Path

from evaluation.scoring import failed_metrics, grouped_report, score_directory
from evaluation.suite import ROOT, cli_validate, dump, freeze_suite, load, sha, verify_suite


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["verify", "freeze", "score"])
    parser.add_argument("--suite", type=Path, default=Path("evaluations/attribution-v1"))
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    directory = args.suite.resolve()
    if args.command == "freeze":
        if not args.binary:
            parser.error("freeze requires --binary")
        freeze_suite(directory, args.binary.resolve())
    else:
        verify_suite(directory, args.binary.resolve() if args.binary else None)
    if args.command == "score":
        if not args.manifest or not args.report or not args.binary:
            parser.error("score requires --manifest, --report, --binary")
        manifest = load(args.manifest)
        if manifest["freeze"]["files"] != load(directory / "freeze.json")["files"]:
            raise ValueError("manifest_gold_changed")
        configurations = Counter()
        for attempt in manifest["attempts"]:
            sample = directory / attempt["sample"]
            if attempt["state"] in ("delivered", "artifact_invalid"):
                try:
                    cli_validate(args.binary.resolve(), Path(attempt["output"]))
                    attempt["metrics"] = score_directory(sample, Path(attempt["output"]))
                    stats = load(Path(attempt["output"]) / "analysis.stats.json")
                    observed = {key: stats[key] for key in ("backend", "model", "endpoint", "reasoning_effort", "output_mode", "prompt_version", "segmentation_version", "options")}
                    configurations[json.dumps(observed, sort_keys=True)] += 1
                    attempt["state"] = "delivered"
                except (ValueError, KeyError, OSError):
                    attempt["state"] = "artifact_invalid"
                    attempt["metrics"] = failed_metrics(sample)
            else:
                attempt["metrics"] = failed_metrics(sample)
        # Public report contains no local source bodies, provider payloads or keys.
        public = {key: manifest[key] for key in ("evaluation_version", "backend", "label", "configuration", "seed", "split", "repeats",
                                                  "limits", "prompt_version", "protocol_files", "binary_sha256", "environment", "actual_order", "started_at")}
        public["freeze_sha256"] = load(directory / "freeze.json")["digest"]
        public["finished_at"] = manifest.get("finished_at")
        public["observed_configurations"] = [{"configuration": json.loads(key), "chapters": count}
                                              for key, count in configurations.items()]
        public["scorer_files"] = {p.relative_to(ROOT).as_posix(): sha(p.read_bytes())
                                  for p in sorted((ROOT / "scripts/evaluation").glob("*.py"))}
        public["summary"] = grouped_report(manifest["attempts"])
        public["attempts"] = [{key: value for key, value in a.items() if key not in ("output",)} for a in manifest["attempts"]]
        dump(args.report, public)
    print(f"{args.command}: {directory.name} OK")


if __name__ == "__main__":
    main()
