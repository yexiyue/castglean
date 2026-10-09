"""Finish only a fully executed run whose immutable binary and source snapshot verify.

Used for v2 baseline runs started by the old harness, whose worktree-source
epilogue rejects concurrent development even though the executed binary is fixed.
This never executes/retries a model call or fills an unexecuted attempt.
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path

from evaluation.suite import dump, fingerprints, load, sha


def finalize(manifest, binary, snapshot):
    report = load(manifest)
    if report.get("finished_at"):
        raise ValueError("already_finished")
    if sha(binary.read_bytes()) != report["binary_sha256"]:
        raise ValueError("execution_binary_changed")
    expected = report["protocol_files"]
    if load(snapshot / "protocol.json") != expected or any(sha((snapshot / p).read_bytes()) != digest for p, digest in expected.items()):
        raise ValueError("isolated_source_changed")
    attempts = report["attempts"]
    if (report["actual_order"] != list(range(len(attempts)))
            or any(a["state"] not in ("delivered", "run_failed", "artifact_invalid")
                   or a["wall_ms"] is None or not a.get("started_at") for a in attempts)):
        raise ValueError("run_not_fully_executed")
    if fingerprints(Path(report["suite"])) != report["freeze"]["files"]:
        raise ValueError("gold_changed")
    report["completion_verification"] = {"kind": "isolated_binary_and_source", "binary_unchanged": True,
                                         "source_snapshot_verified": True,
                                         "old_harness_epilogue": "worktree source changed during independent implementation; execution binary retained"}
    report["evidence_mode"] = "segment-ids"
    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    dump(manifest, report)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    args = parser.parse_args()
    finalize(args.manifest, args.binary, args.snapshot)
    print("isolated execution verified")


if __name__ == "__main__":
    main()
