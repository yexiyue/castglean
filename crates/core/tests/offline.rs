//! Portable data, committed schema and public sample checks.

use castglean_core::*;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn round_trip<T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug>(value: &T) {
    let mut bytes = Vec::new();
    write_json(&mut bytes, value).unwrap();
    let restored: T = read_json(bytes.as_slice()).unwrap();
    assert_eq!(value, &restored);
}

#[test]
fn public_samples_pass_schema_and_application_validation() {
    let character_schema = serde_json::to_value(characters_schema()).unwrap();
    let annotation_schema = serde_json::to_value(annotations_schema()).unwrap();
    let character_validator = jsonschema::validator_for(&character_schema).unwrap();
    let annotation_validator = jsonschema::validator_for(&annotation_schema).unwrap();
    for name in ["minimal", "ambiguous", "quoted"] {
        let directory = root().join("examples").join(name);
        let characters = fs::read(directory.join("characters.json")).unwrap();
        let annotations = fs::read(directory.join("chapter.annotations.json")).unwrap();
        character_validator
            .validate(&serde_json::from_slice::<Value>(&characters).unwrap())
            .unwrap();
        annotation_validator
            .validate(&serde_json::from_slice::<Value>(&annotations).unwrap())
            .unwrap();
        let mut registry: CharacterRegistry = read_json(characters.as_slice()).unwrap();
        registry.extensions.insert(
            "app".into(),
            json!({"unicode":"猫🙂", "values":[1,null,true]}),
        );
        let mut annotation: ChapterAnnotations = read_json(annotations.as_slice()).unwrap();
        annotation
            .extensions
            .insert("custom".into(), json!({"nested": {"value": 2}}));
        round_trip(&registry);
        round_trip(&annotation);
        let source = SourceSnapshot::from_saved(
            fs::read_to_string(directory.join("chapter.txt")).unwrap(),
            annotation.source.clone(),
        )
        .unwrap();
        let book = validate_book(
            registry,
            vec![ChapterInput {
                annotations: annotation,
                source,
            }],
        )
        .unwrap();
        assert_eq!(
            book.chapters()[0]
                .segments()
                .map(|(_, text)| text)
                .collect::<String>(),
            book.chapters()[0].source().text()
        );
    }
}

#[test]
fn schemas_match_committed_files() {
    for (name, schema) in [
        ("characters", characters_schema()),
        ("annotations", annotations_schema()),
    ] {
        let committed: Value =
            read_json(fs::File::open(root().join(format!("schemas/{name}.schema.json"))).unwrap())
                .unwrap();
        assert_eq!(committed, serde_json::to_value(schema).unwrap());
    }
}

#[test]
fn structural_and_semantic_invalid_examples_are_distinguished() {
    let structural =
        fs::read(root().join("examples/invalid/unknown-field.annotations.json")).unwrap();
    assert!(read_json::<ChapterAnnotations>(structural.as_slice()).is_err());
    let schema = serde_json::to_value(annotations_schema()).unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    assert!(!validator.is_valid(&serde_json::from_slice::<Value>(&structural).unwrap()));
    let semantic = fs::read(root().join("examples/invalid/gap.annotations.json")).unwrap();
    assert!(validator.is_valid(&serde_json::from_slice::<Value>(&semantic).unwrap()));
    let annotation: ChapterAnnotations = read_json(semantic.as_slice()).unwrap();
    let registry =
        read_json(fs::File::open(root().join("examples/minimal/characters.json")).unwrap())
            .unwrap();
    let text = fs::read_to_string(root().join("examples/minimal/chapter.txt")).unwrap();
    let source = SourceSnapshot::from_saved(text, annotation.source.clone()).unwrap();
    assert!(
        validate_book(
            registry,
            vec![ChapterInput {
                annotations: annotation,
                source
            }]
        )
        .is_err()
    );
}

#[test]
fn schema_rejects_unsupported_versions_and_extra_attribution_fields() {
    let schema = serde_json::to_value(annotations_schema()).unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    let mut value: Value = read_json(
        fs::File::open(root().join("examples/minimal/chapter.annotations.json")).unwrap(),
    )
    .unwrap();
    value["format_version"] = json!(2);
    assert!(!validator.is_valid(&value));
    value["format_version"] = json!(1);
    value["segments"][1]["attribution"]["status"] = json!("unknown");
    assert!(!validator.is_valid(&value));
}
