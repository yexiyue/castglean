//! Host-owned casting over a complete validated chapter; no model or TTS required.
use castglean_core::{
    Attribution, BookState, ChapterAnnotations, ChapterInput, CharacterId, ExpressionKind,
    SourceSnapshot, read_json, validate_book,
};

// Illustrative host policy, independent from CastGlean and any backend voice IDs.
#[derive(Debug)]
enum Casting {
    FirstPerson,
    SpeakerA,
    SpeakerB,
    Unbound,
    Unknown,
    Ambiguous,
    Narration,
    QuotedText,
}

fn cast(kind: ExpressionKind, attribution: Option<&Attribution>) -> Casting {
    match attribution {
        Some(Attribution::Resolved { character_id, .. }) => match character_id.as_str() {
            "narrator" => Casting::FirstPerson,
            "person-a" => Casting::SpeakerA,
            "person-b" => Casting::SpeakerB,
            _ => Casting::Unbound,
        },
        Some(Attribution::Unknown { .. }) => Casting::Unknown,
        Some(Attribution::Ambiguous { .. }) => Casting::Ambiguous,
        None if kind == ExpressionKind::QuotedText => Casting::QuotedText,
        None => Casting::Narration,
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let registry = read_json(
        include_bytes!("../../../examples/chapter-consumption/characters.json").as_slice(),
    )?;
    let annotations: ChapterAnnotations = read_json(
        include_bytes!("../../../examples/chapter-consumption/chapter.annotations.json").as_slice(),
    )?;
    let source = SourceSnapshot::from_saved(
        include_str!("../../../examples/chapter-consumption/chapter.txt").into(),
        annotations.source.clone(),
    )?;
    let state = BookState::from_validated(validate_book(
        registry,
        vec![ChapterInput {
            annotations,
            source,
        }],
    )?)?;
    let book = state.book();
    let chapter = &book.chapters()[0];
    println!(
        "book={} chapter={} source={} revision={}",
        book.registry().book_id,
        chapter.annotations().chapter_id,
        chapter.source().metadata().sha256,
        chapter.annotations().character_revision
    );
    let mut reconstructed = String::new();
    for (segment, text) in chapter.segments() {
        let casting = cast(segment.kind, segment.attribution.as_ref());
        println!(
            "{} [{}..{}] {:?} {:?} -> {:?} {text:?}",
            segment.id, segment.start, segment.end, segment.kind, segment.attribution, casting
        );
        reconstructed.push_str(text);
    }
    assert_eq!(reconstructed, chapter.source().text());
    // Bind within this book by identity, even when display names are identical.
    let a = CharacterId::new("person-a")?;
    let b = CharacterId::new("person-b")?;
    assert_ne!(a, b);
    assert_eq!(
        state
            .candidates("张三", &chapter.annotations().chapter_id)?
            .len(),
        2
    );
    Ok(())
}
