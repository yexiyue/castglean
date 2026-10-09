"""Serial suite runs with a durable, complete planned-attempt denominator."""
import os
import platform
import random
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from .scoring import failed_metrics, grouped_report, score_directory
from .suite import ROOT, cli_validate, dump, load, sha, verify_suite


def limits(backend):
    return ["--window-chars", "1000", "--window-segments", "8", "--max-output-tokens",
            "2048" if backend == "local" else "8192", "--timeout-secs", "120",
            "--chapter-timeout-secs", "600", "--max-requests", "8", "--max-repairs-per-window", "1"]


def safe_configuration(backend):
    # Read only non-secret configuration; never retain or display credential lines.
    names = {"local": ("LOCAL_MODEL", "LOCAL_API_BASE_URL"), "minimax": ("MINIMAX_MODEL", "MINIMAX_API_BASE_URL"),
             "glm": ("MODEL", "API_BASE_URL")}[backend]
    values = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() in names:
                values[key.strip()] = value.strip().strip("\"'")
    values.update({name: os.environ[name] for name in names if name in os.environ})
    model_default, url_default = {"local": ("default", "http://127.0.0.1:1234/v1"),
                                  "minimax": ("MiniMax-M2.5", "https://api.minimax.cn/v1/"),
                                  "glm": ("bigmodel::glm-4.6", "https://open.bigmodel.cn/api/coding/paas/v4/")}[backend]
    endpoint = urlsplit(values.get(names[1], url_default))
    return {"model": values.get(names[0], model_default), "endpoint": f"{endpoint.scheme}://{endpoint.hostname}" +
            (f":{endpoint.port}" if endpoint.port else "") + endpoint.path}


def protocol_fingerprints():
    paths = [ROOT / "crates/core/src/analysis.rs", *(ROOT / "crates/core/src/analysis").glob("*.rs"),
             *(ROOT / "crates/model/src").glob("*.rs")]
    return {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in sorted(paths)}


def plan(suite, directory, runs, backend, label, repeats, split, seed):
    rng = random.Random(seed)
    selected = [s for s in suite["samples"] if split == "all" or s["split"] == split]
    attempts = []
    for repeat in range(1, repeats + 1):
        order = selected.copy()
        rng.shuffle(order)
        for item in order:
            sample = directory / item["id"]
            attempts.append({"sample": item["id"], "category": item["category"], "split": item["split"], "repeat": repeat,
                             "planned_index": len(attempts), "state": "not_attempted", "wall_ms": None, "usage": None,
                             "source_sha256": sha((sample / "chapter.txt").read_bytes()),
                             "gold_sha256": {f: sha((sample / f).read_bytes()) for f in ("characters.json", "chapter.annotations.json", "evaluation.json")},
                             "output": str((runs / f"{backend}-{label}-r{repeat}-{item['id']}").resolve()),
                             "metrics": failed_metrics(sample)})
    return attempts


def stats_usage(stats):
    usage = {"requests": stats["requests"], "repair_requests": stats["repair_requests"], "repaired_windows": stats["repaired_windows"]}
    for name, field in (("input_tokens", "input"), ("output_tokens", "output"), ("reasoning_tokens", "reasoning")):
        values = [u.get(field) for u in stats["usage"]]
        usage[name] = sum(values) if values and all(v is not None for v in values) else None
    return usage


def execution_protocol(binary, mode, reference=None):
    """Bind a historical protocol to the exact previously reported executable."""
    if reference is None:
        return {"prompt_version": 10 if mode == "verified-quotes" else 9,
                "protocol_files": protocol_fingerprints()}
    historical = load(reference)
    expected = 6 if mode == "verified-quotes" else 5
    if historical.get("binary_sha256") != sha(binary.read_bytes()):
        raise ValueError("reference_binary_mismatch")
    if historical.get("evidence_mode", "segment-ids") != mode or historical.get("prompt_version") != expected:
        raise ValueError("reference_protocol_mismatch")
    fingerprints = historical.get("protocol_files")
    if not isinstance(fingerprints, dict) or not fingerprints or any(
            not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)
            for digest in fingerprints.values()):
        raise ValueError("reference_source_fingerprints_missing")
    return {"prompt_version": expected, "protocol_files": fingerprints,
            "protocol_reference": {"report": reference.name, "sha256": sha(reference.read_bytes()),
                                   "source_binding": "historical_report_matching_binary"}}


def run_suite(args):
    if args.repeats < 1 or not re.fullmatch(r"[a-zA-Z0-9_-]+", args.label):
        raise ValueError("invalid_repeat_or_label")
    directory, binary = args.suite.resolve(), args.binary.resolve()
    mode = getattr(args, "evidence_mode", "segment-ids")
    protocol = execution_protocol(binary, mode, getattr(args, "protocol_report", None))
    working_protocol = protocol_fingerprints()
    suite = verify_suite(directory, binary)
    args.runs.mkdir(parents=True, exist_ok=True)
    manifest = args.runs / f"{args.backend}-{args.label}.json"
    if manifest.exists():
        raise ValueError("manifest_exists_use_new_label")
    attempts = plan(suite, directory, args.runs, args.backend, args.label, args.repeats, args.split, args.seed)
    if any(Path(a["output"]).exists() for a in attempts):
        raise ValueError("output_exists_use_new_label")
    report = {"evaluation_version": suite["version"], "suite": str(directory), "freeze": load(directory / "freeze.json"),
              "backend": args.backend, "label": args.label, "configuration": safe_configuration(args.backend),
              "seed": args.seed, "split": args.split, "repeats": args.repeats, "limits": limits(args.backend),
              "evidence_mode": getattr(args, "evidence_mode", "segment-ids"),
              **protocol, "binary_sha256": sha(binary.read_bytes()),
              "environment": {"platform": platform.platform(), "python": platform.python_version()},
              "started_at": datetime.now(timezone.utc).isoformat(), "actual_order": [], "attempts": attempts}
    def save():
        report["summary"] = grouped_report(attempts)
        dump(manifest, report)
    save()
    for attempt in attempts:
        sample, output = directory / attempt["sample"], Path(attempt["output"])
        report["actual_order"].append(attempt["planned_index"])
        attempt["started_at"] = datetime.now(timezone.utc).isoformat()
        save()
        command = [str(binary), "analyze", "--backend", args.backend, "--source", str(sample / "chapter.txt"),
                   "--book", attempt["sample"], "--chapter", "ch-001", "--output", str(output), *limits(args.backend)]
        if report["evidence_mode"] != "segment-ids":
            command += ["--evidence-mode", report["evidence_mode"]]
        started = time.monotonic()
        process = None
        try:
            process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, stderr = process.communicate(timeout=620)
            attempt["wall_ms"] = round((time.monotonic() - started) * 1000)
            attempt["state"] = "run_failed" if process.returncode else "artifact_invalid"
            if process.returncode:
                # Error text is generated by CLI; provider responses are never echoed.
                attempt["error"] = stderr.decode("utf-8", errors="replace").strip()
                attempt["output_exists"] = output.exists()
            else:
                stats = load(output / "analysis.stats.json")
                attempt["usage"] = stats_usage(stats)
                attempt["prompt_version"] = stats["prompt_version"]
                attempt["model"] = stats["model"]
                if stats["prompt_version"] != report["prompt_version"]:
                    raise ValueError("unexpected_prompt_version")
                cli_validate(binary, output)
                attempt["metrics"] = score_directory(sample, output)
                attempt["state"] = "delivered"
        except (KeyboardInterrupt, subprocess.TimeoutExpired) as error:
            if process:
                process.terminate()
                process.communicate()
            attempt.update(state="run_failed", error="interrupted" if isinstance(error, KeyboardInterrupt) else "harness_timeout",
                           wall_ms=round((time.monotonic() - started) * 1000))
            save()
            if isinstance(error, KeyboardInterrupt):
                raise
        except (ValueError, KeyError, OSError) as error:
            attempt["error"] = "artifact_validation" if attempt["state"] == "artifact_invalid" else "process_failure"
            attempt["wall_ms"] = round((time.monotonic() - started) * 1000)
            if attempt["state"] == "not_attempted":
                attempt["state"] = "run_failed"
        save()
        print(f"{args.backend} {attempt['planned_index'] + 1}/{len(attempts)} {attempt['sample']} {attempt['state']}", flush=True)
    if sha(binary.read_bytes()) != report["binary_sha256"]:
        raise ValueError("execution_binary_changed_during_run")
    if protocol_fingerprints() != working_protocol:
        raise ValueError("production_protocol_changed_during_run")
    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    save()
