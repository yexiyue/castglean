"""Evaluate public fixtures against explicit run directories; never calls models."""
import argparse
import json
from collections import Counter
from pathlib import Path


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def attribution_key(attribution, characters):
    if attribution is None:
        return None
    status = attribution["status"]
    ids = ([attribution["character_id"]] if status == "resolved" else
           attribution.get("candidate_ids", []))
    # Fixtures have independently allocated IDs. Count duplicate names; this
    # compares fixture designations, not general cross-run identity matching.
    return status, tuple(sorted(characters[identity] for identity in ids))


def evaluate(sample, run):
    gold = load(sample / "chapter.annotations.json")
    predicted = load(run / "chapter.annotations.json")
    original = (sample / "chapter.txt").read_bytes()
    saved = (run / "chapter.txt").read_bytes()
    assert original == saved, "Public snapshot bytes changed"
    assert gold["source"]["sha256"] == predicted["source"]["sha256"]
    gold_names = {c["id"]: c["display_name"] for c in load(sample / "characters.json")["characters"]}
    names = {c["id"]: c["display_name"] for c in load(run / "characters.json")["characters"]}
    correct = resolved = correct_resolved = total = 0
    statuses = Counter()
    for unit in gold["segments"]:
        if unit["kind"] not in ("speech", "thought"):
            continue
        total += 1
        overlap = [s for s in predicted["segments"] if s["start"] < unit["end"] and s["end"] > unit["start"]]
        keys = [attribution_key(s.get("attribution"), names) for s in overlap]
        expected = attribution_key(unit.get("attribution"), gold_names)
        unit_correct = bool(overlap) and all(s["kind"] == unit["kind"] for s in overlap) and all(k == expected for k in keys)
        correct += unit_correct
        status = keys[0][0] if keys and keys[0] and all(k == keys[0] for k in keys) else "mixed_or_missing"
        statuses[status] += 1
        if status == "resolved":
            resolved += 1
            correct_resolved += unit_correct
    # Expression fidelity counts all source bytes, so over-wide thought spans
    # cannot hide behind a correct classification on just their inner content.
    kind_bytes = sum(max(0, min(g["end"], p["end"]) - max(g["start"], p["start"]))
                     for g in gold["segments"] for p in predicted["segments"] if g["kind"] == p["kind"])
    stats = load(run / "analysis.stats.json")
    def tokens(key):
        values = [u[key] for u in stats["usage"]]
        return sum(values) if all(v is not None for v in values) else None
    return {"sample": sample.name, "units": total, "correct": correct,
            "resolved_units": resolved, "correct_resolved": correct_resolved,
            "statuses": dict(statuses), "kind_correct_bytes": kind_bytes, "source_bytes": len(saved),
            "requests": stats["requests"], "input_tokens": tokens("input"),
            "output_tokens": tokens("output"), "elapsed_ms": stats["elapsed_ms"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--prefix", default="stage-b-v1-")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    print(json.dumps([evaluate(root / "examples" / name, args.runs / f"{args.prefix}{name}")
                      for name in ("minimal", "ambiguous", "quoted")], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
