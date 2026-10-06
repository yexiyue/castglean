"""Create the documented metadata correction; never overwrite v1 or rescore it."""
import copy
import shutil
from pathlib import Path

from evaluation.suite import ROOT, dump, load, verify_suite


def main():
    original = ROOT / "evaluations/attribution-v1"
    target = ROOT / "evaluations/attribution-v2"
    if target.exists():
        raise SystemExit("v2 already exists; frozen versions cannot be overwritten")
    suite = copy.deepcopy(verify_suite(original))
    target.mkdir()
    suite["version"] = "attribution-v2"
    suite["correction_of"] = "attribution-v1"
    suite["errata"] = "docs/attribution-evaluation-errata.md"
    for sample in suite["samples"]:
        source_path, destination = original / sample["id"], target / sample["id"]
        destination.mkdir()
        for filename in ("chapter.txt", "characters.json", "chapter.annotations.json"):
            shutil.copyfile(source_path / filename, destination / filename)
        source = (destination / "chapter.txt").read_bytes()
        registry = load(destination / "characters.json")
        annotation = load(destination / "chapter.annotations.json")
        metadata = load(source_path / "evaluation.json")
        metadata["evaluation_version"] = suite["version"]
        segments = {s["id"]: s for s in annotation["segments"]}
        for identity, character in zip(metadata["identities"], registry["characters"]):
            mentions = {(m["start"], m["end"]): m for m in identity["mentions"]}
            # Authored scenes were reviewed: repeated selected mention strings
            # within these gold evidence segments refer to the same identity.
            for text in {m["text"] for m in identity["mentions"]}:
                needle = text.encode("utf-8")
                for evidence in character["evidence"]:
                    segment = segments[evidence["segment_id"]]
                    position = source.find(needle, segment["start"], segment["end"])
                    while position >= 0:
                        end = position + len(needle)
                        mentions[position, end] = {"start": position, "end": end, "text": text}
                        position = source.find(needle, end, segment["end"])
            if sample["id"] == "anonymous-04" and character["id"] == "girl":
                label = "递水的女孩"
                character["aliases"].append(label)
                identity["allowed_labels"].append(label)
                start = source.index(label.encode("utf-8"))
                end = start + len(label.encode("utf-8"))
                mentions[start, end] = {"start": start, "end": end, "text": label}
            identity["mentions"] = [mentions[key] for key in sorted(mentions)]
        dump(destination / "characters.json", registry)
        dump(destination / "evaluation.json", metadata)
    dump(target / "suite.json", suite)
    verify_suite(target, frozen=False)


if __name__ == "__main__":
    main()
