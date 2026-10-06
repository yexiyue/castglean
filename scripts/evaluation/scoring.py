"""Byte-aligned semantic scoring with one chapter-wide identity mapping."""
from collections import Counter, defaultdict

from .suite import load, validate_documents

MAX_SOLUTIONS = 10_000


def overlaps(a, b):
    return max(0, min(a["end"], b["end"]) - max(a["start"], b["start"]))


def identity_matchings(registry, annotations, metadata, limit=MAX_SOLUTIONS):
    segments = {s["id"]: s for s in annotations["segments"]}
    edges, specificity = {}, {}
    label_counts = Counter(label for g in metadata["identities"] for label in set(g["allowed_labels"]))
    for character in registry["characters"]:
        names = {character["display_name"], *character["aliases"]}
        ranges = {e["segment_id"] for e in character["evidence"] if e["chapter_id"] == annotations["chapter_id"]}
        edges[character["id"]] = [g["character_id"] for g in metadata["identities"]
                                  if names.intersection(g["allowed_labels"]) and any(
                                      sum(overlaps(segments[r], m) for r in ranges) == m["end"] - m["start"]
                                      for m in g["mentions"])]
        for g in metadata["identities"]:
            specificity[character["id"], g["character_id"]] = sum(
                label_counts[label] == 1 for label in names.intersection(g["allowed_labels"]))
    # Recurse over gold identities, not unbounded model-created characters.
    # Corpus depth is at most four; extra model characters remain unmatched.
    candidates = {g["character_id"]: [p for p in edges if g["character_id"] in edges[p]]
                  for g in metadata["identities"]}
    ids = sorted(candidates, key=lambda identity: len(candidates[identity]))
    best, solutions, completed = (-1, -1), [], 0

    def visit(index, mapping, used):
        nonlocal best, solutions, completed
        if completed > limit:
            return
        if len(mapping) + len(ids) - index < best[0]:
            return
        if index == len(ids):
            completed += 1
            objective = (len(mapping), sum(specificity[p, g] for p, g in mapping.items()))
            if objective > best:
                best, solutions = objective, []
            if objective == best:
                solutions.append(dict(mapping))
            return
        gold = ids[index]
        for identity in candidates[gold]:
            if identity not in used:
                mapping[identity] = gold
                visit(index + 1, mapping, used | {identity})
                del mapping[identity]
        visit(index + 1, mapping, used)

    visit(0, {}, set())
    if completed > limit:
        return None, None
    return solutions, best[0]


def attribution_key(attr, mapping):
    if not attr:
        return None
    status = attr["status"]
    if status == "unknown":
        return (status, ())
    ids = [attr["character_id"]] if status == "resolved" else attr["candidate_ids"]
    # Unmatched IDs cannot accidentally match a gold ID with the same spelling.
    return status, frozenset(mapping.get(i, ("unmatched", i)) for i in ids)


def unmatched_diagnostics(registry, predicted, metadata, mappings):
    """Explain rejected edges without changing the frozen matching rule."""
    if mappings is None:
        return []
    possibly_matched = {identity for mapping in mappings for identity in mapping}
    segments = {s["id"]: s for s in predicted["segments"]}
    diagnostics = []
    for character in registry["characters"]:
        if character["id"] in possibly_matched:
            continue
        names = {character["display_name"], *character["aliases"]}
        ranges = {e["segment_id"] for e in character["evidence"]}
        names_match = any(names.intersection(g["allowed_labels"]) for g in metadata["identities"])
        anchors_match = any(sum(overlaps(segments[r], m) for r in ranges) == m["end"] - m["start"]
                            for g in metadata["identities"] for m in g["mentions"])
        if names_match:
            reason = "evidence_misses_annotated_mentions"
        elif anchors_match:
            reason = "label_not_allowed"
        else:
            reason = "no_identity_edge"
        diagnostics.append({"character_id": character["id"], "reason": reason})
    return diagnostics


def score_documents(source, gold_registry, gold, metadata, registry, predicted, limit=MAX_SOLUTIONS):
    validate_documents(source, gold_registry, gold)
    validate_documents(source, registry, predicted)
    if any(predicted[key] != gold[key] for key in ("book_id", "chapter_id")):
        raise ValueError("chapter_binding")
    if predicted["source"] != gold["source"]:
        raise ValueError("source_metadata_binding")
    mappings, matched = identity_matchings(registry, predicted, metadata, limit)
    units = [s for s in gold["segments"] if s["kind"] in ("speech", "thought")]
    pairs = [(g, [p for p in predicted["segments"] if overlaps(g, p)]) for g in units]
    confusion, resolved = Counter(), 0
    statuses = []
    for g, parts in pairs:
        values = [p.get("attribution", {}).get("status", "none") for p in parts]
        status = values[0] if values and len(set(values)) == 1 else "mixed_or_missing"
        statuses.append(status)
        confusion[f'{g["attribution"]["status"]}->{status}'] += 1
        resolved += status == "resolved"
    counts, resolved_counts, unit_ranges = [], [], [[] for _ in units]
    gold_mapping = {c["id"]: c["id"] for c in gold_registry["characters"]}
    for mapping in mappings or []:
        correct, correct_resolved = 0, 0
        for index, (g, parts) in enumerate(pairs):
            expected = attribution_key(g["attribution"], gold_mapping)
            ok = bool(parts) and all(p["kind"] == g["kind"] and attribution_key(p.get("attribution"), mapping) == expected for p in parts)
            unit_ranges[index].append(int(ok))
            correct += ok
            correct_resolved += ok and statuses[index] == "resolved"
        counts.append(correct)
        resolved_counts.append(correct_resolved)
    kind_bytes = sum(overlaps(g, p) for g in gold["segments"] for p in predicted["segments"] if g["kind"] == p["kind"])
    reliable = mappings is not None
    diagnostics = unmatched_diagnostics(registry, predicted, metadata, mappings)
    if not reliable:
        alignment = "limit_exceeded"
    elif len(mappings) > 1:
        alignment = "multiple"
    elif any(d["reason"] != "no_identity_edge" for d in diagnostics):
        alignment = "partial"
    else:
        alignment = "unique"
    return {"units": len(units), "correct_lower": min(counts, default=0), "correct_upper": max(counts, default=len(units)),
            "resolved_units": resolved, "correct_resolved_lower": min(resolved_counts, default=0),
            "correct_resolved_upper": max(resolved_counts, default=resolved), "confusion": dict(confusion),
            "kind_correct_bytes": kind_bytes, "source_bytes": len(source),
            "gold_characters": len(gold_registry["characters"]), "predicted_characters": len(registry["characters"]),
            "matched_characters": matched, "extra_characters": len(registry["characters"]) - matched if reliable else None,
            "missing_characters": len(gold_registry["characters"]) - matched if reliable else None,
            "identity_alignment": alignment, "unmatched_identity_diagnostics": diagnostics,
            "matching_solutions": len(mappings) if reliable else None,
            "unit_results": [{"id": g["id"], "gold_status": g["attribution"]["status"], "predicted_status": statuses[i],
                              "correct_lower": min(unit_ranges[i], default=0), "correct_upper": max(unit_ranges[i], default=1)}
                             for i, g in enumerate(units)]}


def score_directory(sample, run):
    source = (sample / "chapter.txt").read_bytes()
    if (run / "chapter.txt").read_bytes() != source:
        raise ValueError("source_changed")
    return score_documents(source, load(sample / "characters.json"), load(sample / "chapter.annotations.json"),
                           load(sample / "evaluation.json"), load(run / "characters.json"), load(run / "chapter.annotations.json"))


def failed_metrics(sample):
    gold, registry = load(sample / "chapter.annotations.json"), load(sample / "characters.json")
    units = [s for s in gold["segments"] if s["kind"] in ("speech", "thought")]
    return {"units": len(units), "correct_lower": 0, "correct_upper": 0, "resolved_units": 0, "correct_resolved_lower": 0,
            "correct_resolved_upper": 0, "confusion": dict(Counter(f'{s["attribution"]["status"]}->not_delivered' for s in units)),
            "kind_correct_bytes": 0, "source_bytes": len((sample / "chapter.txt").read_bytes()),
            "gold_characters": len(registry["characters"]), "predicted_characters": 0, "matched_characters": 0,
            "extra_characters": 0, "missing_characters": len(registry["characters"]), "identity_alignment": "not_delivered"}


def aggregate(attempts):
    """All scheduled attempts count; usage totals are null unless fully known."""
    sums = Counter()
    confusion, states, alignment = Counter(), Counter(), Counter()
    numeric = ("units", "correct_lower", "correct_upper", "resolved_units", "correct_resolved_lower", "correct_resolved_upper",
               "kind_correct_bytes", "source_bytes", "gold_characters", "predicted_characters", "matched_characters", "extra_characters", "missing_characters")
    for attempt in attempts:
        metrics = attempt["metrics"]
        for key in numeric:
            sums[key] += metrics.get(key) or 0
        confusion.update(metrics["confusion"])
        states[attempt["state"]] += 1
        alignment[metrics["identity_alignment"]] += 1
    def ratio(a, b):
        return a / b if b else None
    uncertain = alignment["limit_exceeded"] > 0
    result = {**dict(sums), "planned": len(attempts), "states": dict(states), "identity_alignment": dict(alignment),
              "delivery_rate": ratio(states["delivered"], len(attempts)),
              "joint_accuracy_lower": ratio(sums["correct_lower"], sums["units"]), "joint_accuracy_upper": ratio(sums["correct_upper"], sums["units"]),
              "expression_type_byte_accuracy": ratio(sums["kind_correct_bytes"], sums["source_bytes"]),
              "resolved_accuracy_lower": ratio(sums["correct_resolved_lower"], sums["resolved_units"]),
              "resolved_accuracy_upper": ratio(sums["correct_resolved_upper"], sums["resolved_units"]),
              "resolved_coverage": ratio(sums["resolved_units"], sums["units"]), "status_confusion": dict(confusion),
              "character_precision": None if uncertain else ratio(sums["matched_characters"], sums["predicted_characters"]),
              "character_recall": None if uncertain else ratio(sums["matched_characters"], sums["gold_characters"])}
    if uncertain:
        for key in ("matched_characters", "extra_characters", "missing_characters"):
            result[key] = None
    for key in ("input_tokens", "output_tokens", "reasoning_tokens", "requests"):
        values = [(a.get("usage") or {}).get(key) for a in attempts]
        known = [v for v in values if v is not None]
        result[key] = sum(values) if all(v is not None for v in values) else None
        result[f"observed_{key}"] = sum(known) if known else None
        result[f"{key}_known_attempts"] = len(known)
    times = [a["wall_ms"] for a in attempts if a.get("wall_ms") is not None]
    result["wall_ms"] = sum(times)
    result["mean_attempt_wall_ms"] = ratio(sum(times), len(times))
    return result


def grouped_report(attempts):
    report = {"overall": aggregate(attempts)}
    for key in ("category", "split"):
        groups = defaultdict(list)
        for attempt in attempts:
            groups[attempt[key]].append(attempt)
        report[key] = {name: aggregate(items) for name, items in sorted(groups.items())}
    return report
