"""Run one version/backend of the public attribution comparison, without logging keys."""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path
from runpy import run_path

evaluate = run_path(str(Path(__file__).with_name("evaluate-baseline.py")))["evaluate"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--backend", choices=["local", "glm", "minimax"], required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--runs", type=Path, default=Path("runs/attribution-comparison"))
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--samples", nargs="+", default=["minimal", "ambiguous", "quoted", "direct", "bounded", "offscreen"])
    parser.add_argument("--suite", type=Path, help="Frozen independent evaluation suite; omitted keeps historical behavior")
    parser.add_argument("--split", choices=["development", "holdout", "all"], default="all")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--evidence-mode", choices=["segment-ids", "verified-quotes"], default="segment-ids")
    parser.add_argument("--protocol-report", type=Path, help="Historical v5/v6 report bound to this exact binary; suite runs only")
    args = parser.parse_args()
    if args.protocol_report and not args.suite:
        parser.error("protocol-report requires --suite")
    if args.suite:
        from evaluation.runner import run_suite
        run_suite(args)
        return
    root = Path(__file__).resolve().parent.parent
    binary = args.binary.resolve()
    args.runs.mkdir(parents=True, exist_ok=True)
    manifest = args.runs / f"{args.backend}-{args.label}.json"
    if manifest.exists():
        raise SystemExit("Comparison manifest already exists; use a new label")
    # Each backend keeps its protocol and output budget fixed across prompt versions.
    limits = ["--window-chars", "1000", "--window-segments", "8", "--max-output-tokens",
              "2048" if args.backend == "local" else "8192", "--timeout-secs", "120",
              "--chapter-timeout-secs", "600", "--max-requests", "8", "--max-repairs-per-window", "1"]
    if args.evidence_mode != "segment-ids":
        limits += ["--evidence-mode", args.evidence_mode]
    report = {"backend": args.backend, "label": args.label,
              "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "limits": limits, "attempts": []}
    if args.evidence_mode != "segment-ids":
        report["evidence_mode"] = args.evidence_mode
    for repeat in range(1, args.repeats + 1):
        for name in args.samples:
            sample = root / "examples" / name
            output = args.runs / f"{args.backend}-{args.label}-r{repeat}-{name}"
            command = [str(binary), "analyze", "--backend", args.backend,
                       "--source", str(sample / "chapter.txt"), "--book", name,
                       "--chapter", "ch-001", "--output", str(output), *limits]
            started = time.monotonic()
            process = subprocess.run(command, cwd=root, capture_output=True)
            attempt = {"sample": name, "repeat": repeat, "success": process.returncode == 0,
                       "wall_ms": round((time.monotonic() - started) * 1000), "output": str(output)}
            if process.returncode == 0:
                attempt["metrics"] = evaluate(sample, output)
                stats = json.loads((output / "analysis.stats.json").read_text(encoding="utf-8"))
                attempt.update({key: stats[key] for key in ("prompt_version", "repair_requests", "repaired_windows")})
            else:
                # CLI emits application-generated safe errors, never provider bodies.
                attempt["error"] = process.stderr.decode("utf-8", errors="replace").strip()
                attempt["output_exists"] = output.exists()
            report["attempts"].append(attempt)
            manifest.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(attempt, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
