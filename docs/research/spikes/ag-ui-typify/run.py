#!/usr/bin/env python3
"""Reproduce typify generation and JSON fixture diagnostics outside the app.

Run with Python's jsonschema==4.26.0 installed. All downloads, generated code,
build output and detailed reports stay in the ignored target directory.
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import urllib.request

from jsonschema import Draft202012Validator

HERE = Path(__file__).resolve().parent
TARGET = HERE / "target"
UPSTREAM = TARGET / "upstream"
REVISION = "79530a25f3476d0abb93cb00761906fda757a2d5"
SCHEMA_SHA256 = "4b5c93226838a0e72d88e6c5df20633c686c49fcb75d9be2815c6cbf9e48e71a"


def fetch() -> Path:
    schema = UPSTREAM / "spec/1.0/schema.json"
    marker = UPSTREAM / "revision.txt"
    if not marker.exists() or marker.read_text().strip() != REVISION:
        url = f"https://codeload.github.com/ag-ui-protocol/ag-ui/tar.gz/{REVISION}"
        print(f"Fetching fixed upstream revision {REVISION}", flush=True)
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read()
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
            for member in archive:
                relative = member.name.split("/", 1)[-1]
                if not member.isfile() or not (
                    relative.startswith("spec/1.0/") or relative == "LICENSE"
                ):
                    continue
                destination = UPSTREAM / relative
                if not destination.resolve().is_relative_to(UPSTREAM.resolve()):
                    raise ValueError(f"Unsafe archive path: {relative}")
                destination.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                assert source is not None
                destination.write_bytes(source.read())
        marker.write_text(REVISION + "\n")
    assert hashlib.sha256(schema.read_bytes()).hexdigest() == SCHEMA_SHA256
    return schema


def command(args: list[str], log: Path) -> subprocess.CompletedProcess[str]:
    environment = {**os.environ, "CARGO_TARGET_DIR": str(TARGET / "build")}
    result = subprocess.run(args, cwd=HERE, env=environment, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log.write_text(result.stdout)
    return result


def diagnostic_schema(schema: dict, *, structural: bool) -> dict:
    """Deliberately remove not:null; never claim equivalence to the original.

    The structural variant additionally lowers const to singleton enum and lowers
    this schema's object-only allOf inheritance plus unevaluatedProperties.
    The original Draft 2020-12 validator remains the independent oracle.
    """
    definitions = schema["$defs"]

    def visit(value):
        if isinstance(value, list):
            return [visit(item) for item in value]
        if not isinstance(value, dict):
            return value
        result = {key: visit(item) for key, item in value.items()}
        if result.get("not") == {"type": "null"}:
            del result["not"]
        if structural and "const" in result:
            assert isinstance(result["const"], str), "Review new const value types"
            assert "enum" not in result, "Review combined const and enum"
            result["type"] = "string"
            result["enum"] = [result.pop("const")]
        if structural and "allOf" in result:
            properties, required = {}, set()
            for base in result.pop("allOf"):
                assert set(base) == {"$ref"}, "Review new allOf compositions"
                assert base["$ref"].startswith("#/$defs/")
                parent = visit(definitions[base["$ref"].split("/")[-1]])
                assert parent.get("type") == "object"
                assert set(parent) <= {
                    "$anchor", "type", "description", "properties", "required"
                }, "Review new inheritance constraints"
                properties.update(parent.get("properties", {}))
                required.update(parent.get("required", []))
            properties.update(result.get("properties", {}))
            required.update(result.get("required", []))
            result["properties"] = properties
            result["required"] = sorted(required)
        if structural and result.get("unevaluatedProperties") is False:
            del result["unevaluatedProperties"]
            result["additionalProperties"] = False
        return result

    return visit(copy.deepcopy(schema))


def type_surface(schema: dict, surface: dict) -> dict:
    def fields(shape, definitions):
        result = set(shape.get("properties", {}))
        if "$ref" in shape:
            result |= fields(definitions[shape["$ref"].split("/")[-1]], definitions)
        for base in shape.get("allOf", []):
            result |= fields(base, definitions)
        return result

    official = schema["$defs"]
    checked, differences = {}, []
    for root in ["Event", "Message"]:
        branches = surface[root]["oneOf"]
        count = 0
        for branch in branches:
            name = branch["$ref"].split("/")[-1]
            if name not in official:
                continue  # The crate also supports deprecated THINKING_*.
            count += 1
            expected = fields(official[name], official)
            actual = fields(branch, surface[root]["$defs"])
            if expected != actual:
                differences.append({"type": name, "missing": sorted(expected - actual),
                                    "extra": sorted(actual - expected)})
        checked[root] = count
    expected_events = {item["$ref"].split("/")[-1] for item in official["Event"]["oneOf"]}
    actual_events = {item["$ref"].split("/")[-1] for item in surface["Event"]["oneOf"]}
    for root in ["RunAgentInput", "AgentCapabilities"]:
        definitions = {**surface[root].get("$defs", {}), root: surface[root]}
        names = [root] if root == "RunAgentInput" else list(definitions)
        for name in names:
            if name not in official or not definitions[name].get("properties"):
                continue
            expected = fields(official[name], official)
            actual = fields(definitions[name], definitions)
            if expected != actual:
                differences.append({"type": name, "missing": sorted(expected - actual),
                                    "extra": sorted(actual - expected)})
    return {"checkedUnions": checked, "missingEventTypes": sorted(expected_events - actual_events),
            "extraEventTypes": sorted(actual_events - expected_events),
            "fieldDifferences": differences,
            "scope": "property presence only; not proof of schema constraint equivalence"}


def prepare_probe(generated: Path, anchors: list[str], directory: Path, *, community: bool) -> None:
    (directory / "src").mkdir(parents=True, exist_ok=True)
    if not community:
        (directory / "src/generated.rs").write_bytes(generated.read_bytes())
    (directory / "Cargo.toml").write_text('''[package]
name = "ag-ui-typify-generated-probe"
version = "0.0.0"
edition = "2024"
publish = false
[workspace]
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
regress = "=0.12.0"
''' + ('ag-ui = { version = "=0.5.0-alpha.3", default-features = false, features = ["schemars"] }\nschemars = "=1.2.3"\n' if community else ''))
    aliases = {"FileSource": "InputContentSource", "SubagentInfo": "SubAgentInfo"}
    def rust_type(anchor):
        if community and anchor.endswith("Event"):
            return "Event"
        if community and anchor.endswith("Message"):
            return "Message"
        return aliases.get(anchor, anchor) if community else anchor
    arms = "\n".join(
        f'        "{anchor}" => round_trip::<generated::{rust_type(anchor)}>(value),'
        for anchor in anchors
    )
    (directory / "src/main.rs").write_text('''use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
''' + ('use ag_ui as generated;\n' if community else '#[allow(dead_code)]\nmod generated;\n') + '''
fn round_trip<T: Serialize + DeserializeOwned>(value: Value) -> Value {
    match serde_json::from_value::<T>(value) {
        Ok(decoded) => match serde_json::to_value(decoded) {
            Ok(encoded) => json!({"accepted": true, "value": encoded}),
            Err(error) => json!({"accepted": true, "encodeError": error.to_string()}),
        },
        Err(error) => json!({"accepted": false, "error": error.to_string()}),
    }
}
fn main() {
''' + ('''    if std::env::args().nth(1).as_deref() == Some("--schema") {
        println!("{}", json!({
            "Event": schemars::schema_for!(ag_ui::Event),
            "Message": schemars::schema_for!(ag_ui::Message),
            "RunAgentInput": schemars::schema_for!(ag_ui::RunAgentInput),
            "AgentCapabilities": schemars::schema_for!(ag_ui::AgentCapabilities),
        }));
        return;
    }
''' if community else '') + '''
    let input: Vec<Value> = serde_json::from_reader(std::io::stdin()).unwrap();
    let output: Vec<Value> = input.into_iter().map(|case| {
        let value = case["value"].clone();
        let mut result = match case["anchor"].as_str().unwrap() {
''' + arms + '''
            other => panic!("unhandled fixture anchor: {other}"),
        };
        result["name"] = case["name"].clone();
        result
    }).collect();
    println!("{}", serde_json::to_string(&output).unwrap());
}
''')


def main() -> None:
    TARGET.mkdir(exist_ok=True)
    schema_path = fetch()
    schema = json.loads(schema_path.read_text())
    fixtures_root = schema_path.parent / "fixtures"
    fixtures = []
    for path in sorted(fixtures_root.rglob("*.json")):
        if path.name.endswith(".expect.json"):
            continue
        relative = path.relative_to(fixtures_root)
        fixtures.append({"name": str(relative), "anchor": relative.parts[0],
                         "valid": relative.parts[1] == "valid",
                         "value": json.loads(path.read_text())})
    assert len(fixtures) == 219, "Review fixed corpus completeness"
    validators = {
        anchor: Draft202012Validator({
            "$ref": f"#/$defs/{anchor}", "$defs": schema["$defs"]
        }) for anchor in schema["$defs"]
    }
    Draft202012Validator.check_schema(schema)
    for fixture in fixtures:
        assert validators[fixture["anchor"]].is_valid(fixture["value"]) == fixture["valid"], fixture["name"]
    # Exercise the actual Event union as well as individual fixture types.
    cases = fixtures + [
        {**fixture, "anchor": "Event", "name": "Event/" + fixture["name"]}
        for fixture in fixtures if fixture["anchor"].endswith("Event")
    ]
    report = {"upstreamRevision": REVISION, "schemaSha256": SCHEMA_SHA256,
              "typify": "0.10.1", "officialFixtures": len(fixtures),
              "validFixtures": sum(f["valid"] for f in fixtures),
              "invalidFixtures": sum(not f["valid"] for f in fixtures),
              "eventVariants": len(schema["$defs"]["Event"]["oneOf"]),
              "oracle": "jsonschema 4.26.0 Draft202012Validator",
              "stages": {}}
    generator_manifest = str(HERE / "Cargo.toml")
    for stage in ["raw", "without-not-null", "structural", "ag-ui-0.5.0-alpha.3"]:
        print(f"Running {stage}", flush=True)
        input_path = schema_path
        community = stage == "ag-ui-0.5.0-alpha.3"
        if stage != "raw" and not community:
            input_path = TARGET / f"{stage}.schema.json"
            input_path.write_text(json.dumps(diagnostic_schema(
                schema, structural=stage == "structural"), indent=2))
        generated = TARGET / f"{stage}.rs"
        result = None if community else command(
            ["cargo", "run", "--locked", "--manifest-path", generator_manifest,
             "--bin", "generate", "--", str(input_path), str(generated)],
            TARGET / f"{stage}.generation.log")
        outcome = {"generationExit": None if community else result.returncode}
        report["stages"][stage] = outcome
        if result is not None and result.returncode:
            outcome["errorTail"] = result.stdout[-2000:]
            continue
        probe = TARGET / f"{stage}-probe"
        prepare_probe(generated, sorted({case["anchor"] for case in cases}), probe, community=community)
        lock = HERE / ("ag-ui-probe.Cargo.lock" if community else "typify-probe.Cargo.lock")
        if lock.exists():
            (probe / "Cargo.lock").write_bytes(lock.read_bytes())
        build = command(["cargo", "build", *(["--locked"] if lock.exists() else []),
                         "--manifest-path", str(probe / "Cargo.toml")],
                        TARGET / f"{stage}.build.log")
        outcome["buildExit"] = build.returncode
        if build.returncode:
            outcome["errorTail"] = build.stdout[-2000:]
            continue
        if community:
            surface = subprocess.run(
                [str(TARGET / "build/debug/ag-ui-typify-generated-probe"), "--schema"],
                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            (TARGET / "ag-ui-type-surface.json").write_text(surface.stdout)
            outcome["typeSurface"] = type_surface(schema, json.loads(surface.stdout))
        checked = subprocess.run([str(TARGET / "build/debug/ag-ui-typify-generated-probe")],
                                 input=json.dumps(cases), text=True,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        results = json.loads(checked.stdout)
        failures = []
        metrics = {"cases": len(cases), "validAccepted": 0, "validRejected": 0,
                   "invalidRejected": 0, "invalidAccepted": 0,
                   "validRoundtripChanged": 0, "validRoundtripInvalid": 0}
        original_metrics = {**metrics, "cases": len(fixtures)}
        for case, actual in zip(cases, results, strict=True):
            assert case["name"] == actual["name"]
            accepted = actual["accepted"]
            metrics[("valid" if case["valid"] else "invalid") + ("Accepted" if accepted else "Rejected")] += 1
            changed = case["valid"] and accepted and actual.get("value") != case["value"]
            invalid = case["valid"] and accepted and not validators[case["anchor"]].is_valid(actual.get("value"))
            metrics["validRoundtripChanged"] += int(changed)
            metrics["validRoundtripInvalid"] += int(invalid)
            if not case["name"].startswith("Event/"):
                key = ("valid" if case["valid"] else "invalid") + ("Accepted" if accepted else "Rejected")
                original_metrics[key] += 1
                original_metrics["validRoundtripChanged"] += int(changed)
                original_metrics["validRoundtripInvalid"] += int(invalid)
            if accepted != case["valid"] or changed or invalid:
                failures.append({"case": case["name"], "expectedValid": case["valid"],
                                 "input": case["value"], "actual": actual,
                                 "roundtripChanged": changed, "roundtripInvalid": invalid})
        outcome["metrics"] = metrics
        outcome["officialFixtureMetrics"] = original_metrics
        outcome["failures"] = failures
        print(json.dumps(metrics), flush=True)
    (TARGET / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Report: {TARGET / 'report.json'}", flush=True)
    raw = report["stages"]["raw"]
    assert raw["generationExit"] == 101 and "unhandled not schema" in raw["errorTail"], \
        "The original-schema failure changed; inspect the report"
    for name in ["without-not-null", "structural", "ag-ui-0.5.0-alpha.3"]:
        assert report["stages"][name].get("buildExit") == 0, \
            f"Diagnostic build failed for {name}; inspect the report"
    print("Diagnostic completion does not imply protocol conformance.", flush=True)


if __name__ == "__main__":
    main()
