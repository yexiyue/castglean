"""Corpus integrity and artifact checks; CLI remains the application authority."""
import hashlib
import json
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FILES = ("chapter.txt", "characters.json", "chapter.annotations.json", "evaluation.json")
CATEGORY_IDS = {"explicit", "pronoun", "continuation", "candidates", "unowned", "anonymous", "same_name", "alias", "thought", "quoted"}


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def dump(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    temporary.replace(path)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def validate_documents(source, registry, annotation):
    """Check scorer invariants. Runtime additionally calls existing CLI validate."""
    source.decode("utf-8")
    if registry["format_version"] != 1 or annotation["format_version"] != 1:
        raise ValueError("format_version")
    if registry["book_id"] != annotation["book_id"] or registry["revision"] != annotation["character_revision"]:
        raise ValueError("registry_binding")
    if annotation["source"]["sha256"] != sha(source) or annotation["source"]["offset_unit"] != "utf8_byte":
        raise ValueError("source_binding")
    characters = registry["characters"]
    ids = [c["id"] for c in characters]
    segments = annotation["segments"]
    segment_ids = [s["id"] for s in segments]
    if len(set(ids)) != len(ids) or len(set(segment_ids)) != len(segment_ids):
        raise ValueError("duplicate_id")
    offset = 0
    for segment in segments:
        if segment["start"] != offset or not offset < segment["end"] <= len(source):
            raise ValueError("coverage")
        source[offset:segment["end"]].decode("utf-8")
        offset = segment["end"]
        if segment["kind"] not in ("narration", "speech", "thought", "quoted_text"):
            raise ValueError("kind")
        attr = segment.get("attribution")
        if segment["kind"] in ("speech", "thought") and not attr:
            raise ValueError("missing_attribution")
        if attr:
            status = attr["status"]
            evidence = attr["evidence_segment_ids"]
            if not set(evidence) <= set(segment_ids):
                raise ValueError("evidence_reference")
            if status == "resolved":
                if attr["character_id"] not in ids or not evidence:
                    raise ValueError("identity_reference")
            elif status == "ambiguous":
                candidates = attr["candidate_ids"]
                if len(set(candidates)) < 2 or len(set(candidates)) != len(candidates) or not set(candidates) <= set(ids) or not evidence:
                    raise ValueError("candidate_reference")
            elif status != "unknown":
                raise ValueError("status")
    if offset != len(source):
        raise ValueError("coverage")
    for character in characters:
        if not character["display_name"].strip():
            raise ValueError("empty_label")
        for evidence in character["evidence"]:
            if evidence["chapter_id"] != annotation["chapter_id"] or evidence["segment_id"] not in segment_ids:
                raise ValueError("character_evidence")


def cli_validate(binary, directory):
    process = subprocess.run([str(binary), "validate", "--characters", str(directory / "characters.json"),
                              "--annotations", str(directory / "chapter.annotations.json"),
                              "--source", str(directory / "chapter.txt")], capture_output=True)
    if process.returncode:
        raise ValueError("application_validation")


def fingerprints(directory):
    suite = load(directory / "suite.json")
    paths = [directory / "suite.json", ROOT / suite["policy"]]
    paths += [directory / item["id"] / filename for item in suite["samples"] for filename in FILES]
    return {path.relative_to(ROOT).as_posix(): sha(path.read_bytes()) for path in paths}


def verify_suite(directory, binary=None, frozen=True):
    directory = Path(directory).resolve()
    suite = load(directory / "suite.json")
    samples = suite["samples"]
    counts = Counter((s["category"], s["split"]) for s in samples)
    expected_groups = {(category, split) for category in CATEGORY_IDS for split in ("development", "holdout")}
    if len(samples) != 40 or len({s["id"] for s in samples}) != 40 or set(counts) != expected_groups or set(counts.values()) != {2}:
        raise ValueError("suite_balance")
    if set(s["split"] for s in samples) != {"development", "holdout"}:
        raise ValueError("suite_split")
    for item in samples:
        path = directory / item["id"]
        source = (path / "chapter.txt").read_bytes()
        registry, annotations, metadata = (load(path / f) for f in FILES[1:])
        validate_documents(source, registry, annotations)
        if binary:
            cli_validate(binary, path)
        if len(registry["characters"]) > 4 or metadata["evaluation_version"] != suite["version"]:
            raise ValueError("metadata_version")
        if any(metadata[key] != item[key if key != "sample" else "id"] for key in ("sample", "category", "split")):
            raise ValueError("metadata_split")
        identities = metadata["identities"]
        if len({i["character_id"] for i in identities}) != len(identities) or {i["character_id"] for i in identities} != {c["id"] for c in registry["characters"]}:
            raise ValueError("metadata_identities")
        segment_map = {s["id"]: s for s in annotations["segments"]}
        for identity, character in zip(identities, registry["characters"]):
            if identity["character_id"] != character["id"] or not identity["mentions"] or not identity["reason"].strip():
                raise ValueError("metadata_anchors")
            if set(identity["allowed_labels"]) != {character["display_name"], *character["aliases"]}:
                raise ValueError("metadata_labels")
            for label in identity["allowed_labels"]:
                if label.encode("utf-8") not in source:
                    raise ValueError("ungrounded_label")
            for mention in identity["mentions"]:
                start, end = mention["start"], mention["end"]
                if not 0 <= start < end <= len(source) or source[start:end].decode("utf-8") != mention["text"]:
                    raise ValueError("mention_range")
                evidence = [segment_map[e["segment_id"]] for e in character["evidence"]]
                if not any(s["start"] <= start < end <= s["end"] for s in evidence):
                    raise ValueError("ungrounded_evidence")
    hashes = fingerprints(directory)
    if frozen:
        freeze = load(directory / "freeze.json")
        if (freeze["version"] != suite["version"] or freeze["files"] != hashes
                or freeze["digest"] != sha(json.dumps(hashes, sort_keys=True).encode())):
            raise ValueError("frozen_digest_mismatch")
    return suite


def freeze_suite(directory, binary):
    if (directory / "freeze.json").exists():
        raise ValueError("already_frozen")
    suite = verify_suite(directory, binary, frozen=False)
    hashes = fingerprints(directory)
    dump(directory / "freeze.json", {"version": suite["version"], "frozen_at": datetime.now(timezone.utc).isoformat(),
                                    "files": hashes, "digest": sha(json.dumps(hashes, sort_keys=True).encode())})
