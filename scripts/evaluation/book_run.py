"""Finite chapter-run verification; no prompt tuning, retry or secret logging."""
import copy
import hashlib
import json
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def check_prefix(before, after):
    """Existing chapters may only acquire the common new registry revision."""
    prefix = copy.deepcopy(after["chapters"][:len(before["chapters"])])
    for chapter in prefix:
        chapter["annotations"]["character_revision"] = before["registry"]["revision"]
    return (prefix == before["chapters"]
            and after["registry"]["characters"][:len(before["registry"]["characters"])] == before["registry"]["characters"]
            and after["changes"][:-1] == before["changes"]
            and after["registry"]["revision"] == before["registry"]["revision"] + 1)


def failure_category(stderr):
    """Match fixed program messages; never return arbitrary stderr text."""
    text = stderr.decode("utf-8", errors="replace") if isinstance(stderr, bytes) else str(stderr)
    known = {
        "missing target annotation": "missing_target",
        "duplicate target annotation": "duplicate_target",
        "annotation outside target window": "outside_target",
        "undeclared temporary identity": "undeclared_identity",
        "unknown existing identity": "unknown_identity",
        "missing or invisible evidence": "invalid_evidence",
        "invalid or duplicate new identity": "invalid_identity",
        "invalid JSON syntax": "invalid_json",
        "invalid suggestion structure": "invalid_structure",
        "truncated response": "truncated_response",
        "analysis budget exceeded": "analysis_budget",
        "chapter analysis timed out": "chapter_timeout",
        "model request timed out": "request_timeout",
        "model rate limit exceeded": "rate_limit",
        "model authentication failed": "authentication",
        "model transport or service failed": "service",
        "run configuration mismatch": "configuration",
        "run is busy": "busy",
    }
    return next((category for message, category in known.items() if message in text), "process_failed")


def identity_observation(books, labels):
    """Label diagnostics only, not independently scored semantic attribution."""
    counts, references, first_ids = [], [], None
    for book in books:
        ids = {c["id"] for c in book["registry"]["characters"]
               if set([c["display_name"], *c["aliases"]]) & set(labels)}
        if first_ids is None:
            first_ids = ids
        counts.append(len(ids))
        references.append(sum(s.get("attribution", {}).get("character_id") in (first_ids or set())
                              for s in book["chapters"][-1]["annotations"]["segments"]
                              if isinstance(s.get("attribution"), dict)))
    unique = first_ids is not None and len(first_ids) == 1
    return {"label_digest": sha(json.dumps(labels, ensure_ascii=False).encode()),
            "candidate_counts": counts, "resolved_references_to_first_identity": references,
            "unique_initial_identity": unique,
            "single_label_identity_throughout": unique and all(n == 1 for n in counts),
            "observed_reuse_in_every_later_chapter": unique and len(books) > 1 and all(n > 0 for n in references[1:]),
            "semantic_accuracy": None}


def run_verification(binary, plan_path, output, labels=(), invoke=None, failure_reports=False):
    """Freeze before requests, commit one chapter per process, stop on first failure.

    output must be an absent private directory. The resulting report contains
    only diagnostics; plan/body, complete snapshots and export stay in output.
    invoke is an offline test seam accepting argv and returning a process result.
    """
    binary, plan_path, output = map(Path, (binary, plan_path, output))
    plan_bytes = plan_path.read_bytes()
    plan = json.loads(plan_bytes)
    if not plan["chapters"]:
        raise ValueError("empty_verification_plan")
    output.mkdir(parents=True, exist_ok=False)
    private_plan = output / "plan.json"
    private_plan.write_bytes(plan_bytes)
    freeze = {"plan_sha256": sha(plan_bytes), "binary_sha256": sha(binary.read_bytes()),
              "label_digest": sha(json.dumps(list(labels), ensure_ascii=False).encode()),
              "chapters": [{"chapter_id": c["chapter_id"], "source_sha256": c["source"]["sha256"],
                            "utf8_bytes": len(c["text"].encode())} for c in plan["chapters"]],
              "config": plan["config"]}
    write(output / "freeze.json", freeze)
    report = {"started_at": datetime.now(timezone.utc).isoformat(), "freeze": freeze,
              "planned_chapters": len(plan["chapters"]), "completed_chapters": 0,
              "steps": [], "chapters": [], "uncommitted_usage": None,
              "semantic_accuracy": None}
    journal = output / "journal"
    call = invoke or (lambda argv: subprocess.run(argv, capture_output=True, timeout=620))

    def save():
        write(output / "report.json", report)

    def execute(label, args, failure_path=None):
        # Recheck frozen bytes before each process, including repeated resume.
        if sha(private_plan.read_bytes()) != freeze["plan_sha256"] or sha(binary.read_bytes()) != freeze["binary_sha256"]:
            raise ValueError("verification_input_changed")
        started = time.monotonic()
        try:
            result = call([str(binary.resolve()), *args])
            success = result.returncode == 0
            category = None if success else failure_category(getattr(result, "stderr", b""))
        except subprocess.TimeoutExpired:
            success, category = False, "process_timeout"
        step = {"label": label, "success": success, "wall_ms": round((time.monotonic() - started) * 1000),
                "failure_category": category}
        if not success and failure_path is not None and failure_path.exists():
            try:
                diagnostic = safe_failure_report(load(failure_path))
                step["analysis_failure"] = diagnostic
                step["failure_category"] = diagnostic["category"]
            except (ValueError, TypeError, KeyError, json.JSONDecodeError, OSError):
                step["failure_report_invalid"] = True
        report["steps"].append(step)
        save()
        print(f"{label}: {'ok' if success else step['failure_category']}", flush=True)
        return success

    before, books, receipts = plan["base"], [], []
    try:
        for index, chapter in enumerate(plan["chapters"]):
            args = (["run", "--plan", str(private_plan.resolve())] if index == 0 else ["resume"])
            args += ["--run-dir", str(journal.resolve()), "--backend", plan["config"]["model"]["backend"], "--max-chapters", "1"]
            failure_path = output / f"chapter-{index + 1}.failure.json" if failure_reports else None
            if failure_path is not None:
                args += ["--failure-report", str(failure_path.resolve())]
            if not execute(f"chapter-{index + 1}", args, failure_path):
                report["not_executed_chapters"] = len(plan["chapters"]) - index - 1
                break
            receipt_path = journal / "commits" / f"{index + 1:08}" / "commit.json"
            receipt = load(receipt_path)
            book = receipt["commit"]["book"]
            saved = book["chapters"][-1]
            checks = {"prefix_preserved": check_prefix(before, book),
                      "source_preserved": saved["text"] == chapter["text"] and saved["annotations"]["source"] == chapter["source"],
                      "source_digest_matches": sha(saved["text"].encode()) == chapter["source"]["sha256"]}
            if not all(checks.values()):
                raise ValueError("verification_book_invariant")
            stats = receipt["commit"]["stats"]
            report["chapters"].append({"chapter_id": chapter["chapter_id"], "revision": book["registry"]["revision"],
                                       "characters": len(book["registry"]["characters"]),
                                       "segments": len(saved["annotations"]["segments"]), "stats": stats,
                                       "receipt_bytes": receipt_path.stat().st_size,
                                       "receipt_sha256": sha(receipt_path.read_bytes()), "checks": checks})
            receipts.append((receipt_path, sha(receipt_path.read_bytes())))
            books.append(book)
            before = book
            report["completed_chapters"] += 1
            save()
        complete = report["completed_chapters"] == report["planned_chapters"]
        report["committed_receipts_unchanged"] = all(sha(p.read_bytes()) == digest for p, digest in receipts)
        report["complete"] = complete
        if complete:
            report["repeat_resume_success"] = execute("repeat-resume", ["resume", "--run-dir", str(journal.resolve()),
                "--backend", plan["config"]["model"]["backend"], "--max-chapters", "1"])
            report["repeat_receipts_unchanged"] = all(sha(p.read_bytes()) == digest for p, digest in receipts)
        exported = output / "export"
        if execute("inspect-export", ["run-inspect", "--run-dir", str(journal.resolve()), "--output", str(exported.resolve())]):
            report["application_validation"] = execute("validate", ["validate", "--book-file", str((exported / "book.json").resolve())])
        else:
            report["application_validation"] = False
        report["identity_observation"] = identity_observation(books, labels) if labels else None
        report["receipt_storage_bytes"] = sum(c["receipt_bytes"] for c in report["chapters"])
        report["failed_received_responses"] = sum(step.get("analysis_failure", {}).get("stats", {}).get("requests", 0) for step in report["steps"])
        report["committed_responses"] = sum(c["stats"]["requests"] for c in report["chapters"])
    finally:
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        save()
    return report


FAILURE_CATEGORIES = {"missing_target", "duplicate_target", "outside_target", "undeclared_identity", "unknown_identity", "invalid_evidence", "invalid_identity", "invalid_json", "invalid_structure", "truncated_response", "analysis_budget", "chapter_timeout", "request_timeout", "rate_limit", "authentication", "service", "configuration", "response", "context", "validation", "cancelled", "invalid_options", "invalid_suggestion", "missing_attribution", "invalid_candidates", "missing_quotation", "invalid_quotation", "quotation_not_found", "quotation_not_unique"}


def safe_failure_report(value):
    """Only fixed categories, counts and generated references enter public reports."""
    def integer(n):
        if type(n) is not int or n < 0:
            raise ValueError("invalid_diagnostic_count")
        return n
    if value["format_version"] != 1 or value["category"] not in FAILURE_CATEGORIES or value["stage"] not in {"preparation", "window", "final_validation"}:
        raise ValueError("invalid_diagnostic_version_or_category")
    stats = value["stats"]
    usage = [{key: None if row[key] is None else integer(row[key]) for key in ("input", "output", "reasoning")} for row in stats["usage"]]
    safe_stats = {key: integer(stats[key]) for key in ("requests", "repair_requests", "repaired_windows", "elapsed_ms")}
    safe_stats.update(usage=usage, response_bytes=[integer(n) for n in stats["response_bytes"]])
    if len(usage) != safe_stats["requests"] or len(safe_stats["response_bytes"]) != safe_stats["requests"]:
        raise ValueError("invalid_diagnostic_statistics")
    def target(t):
        if not re.fullmatch(r"seg-v[0-9]+-[0-9a-f]{64}-[0-9]+-[0-9]+", t["segment_id"]) or not re.fullmatch(r"s[0-9]+", t["reference"]) or type(t["whitespace_only"]) is not bool:
            raise ValueError("invalid_diagnostic_target")
        start, end = integer(t["start"]), integer(t["end"])
        if start >= end:
            raise ValueError("invalid_diagnostic_range")
        return {"segment_id": t["segment_id"], "reference": t["reference"], "start": start, "end": end, "whitespace_only": t["whitespace_only"]}
    w = value["window"]
    window = None
    if w is not None:
        if type(w["repair_exhausted"]) is not bool:
            raise ValueError("invalid_diagnostic_repair")
        window = {key: integer(w[key]) for key in ("index", "start", "end", "repairs_attempted")}
        window.update(targets=[target(t) for t in w["targets"]], missing_targets=[target(t) for t in w["missing_targets"]], repair_exhausted=w["repair_exhausted"])
        window["validation_issues"] = []
        target_ids = {t["segment_id"] for t in window["targets"]}
        for issue in w.get("validation_issues", []):
            if issue["code"] not in FAILURE_CATEGORIES:
                raise ValueError("invalid_diagnostic_issue")
            ids = issue.get("missing_segment_ids", [])
            if any(segment_id not in target_ids for segment_id in ids):
                raise ValueError("untrusted_issue_target")
            window["validation_issues"].append({"code": issue["code"], "missing_targets": [t for t in window["targets"] if t["segment_id"] in ids]})
        if any(t not in window["targets"] for t in window["missing_targets"]):
            raise ValueError("untrusted_missing_target")
    return {"format_version": 1, "category": value["category"], "stage": value["stage"], "accepted_windows": integer(value["accepted_windows"]), "window": window, "stats": safe_stats}
