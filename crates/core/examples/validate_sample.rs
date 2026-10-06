//! Generic in-memory library consumption; public data is embedded for convenience.

use castglean_core::{ChapterAnnotations, ChapterInput, SourceSnapshot, read_json, validate_book};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let registry =
        read_json(include_bytes!("../../../examples/minimal/characters.json").as_slice())?;
    let annotations: ChapterAnnotations =
        read_json(include_bytes!("../../../examples/minimal/chapter.annotations.json").as_slice())?;
    let source = SourceSnapshot::from_saved(
        include_str!("../../../examples/minimal/chapter.txt").into(),
        annotations.source.clone(),
    )?;
    let book = validate_book(
        registry,
        vec![ChapterInput {
            annotations,
            source,
        }],
    )?;
    for chapter in book.chapters() {
        for (segment, text) in chapter.segments() {
            println!(
                "{} [{}, {}): {:?} {:?} — {}",
                segment.id, segment.start, segment.end, segment.kind, segment.attribution, text
            );
        }
    }
    Ok(())
}
