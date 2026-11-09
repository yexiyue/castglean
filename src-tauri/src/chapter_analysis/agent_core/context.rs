//! C7 lossless compact context projection for analysis and independent review.
use super::*;

/// Select the same registered identity for context rows and review speaker enums.
pub(super) fn identity(draft: &Draft, id: &str) -> String {
    if matches!(id, "unknown" | "narrator") {
        return id.to_owned();
    }
    let canonical = draft.character_refs.get(id).map_or(id, String::as_str);
    draft
        .character_refs
        .iter()
        .filter(|(_, target)| target.as_str() == canonical)
        .filter_map(|(reference, _)| {
            let rank = if reference.starts_with("new:") {
                0
            } else if reference
                .strip_prefix('c')
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
            {
                1
            } else {
                return None;
            };
            Some((rank, reference.as_str()))
        })
        .min()
        .map_or(canonical, |(_, reference)| reference)
        .to_owned()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CharacterContext<'a> {
    #[serde(flatten)]
    extra: BTreeMap<&'a str, &'a Value>,
    id: String,
    name: &'a str,
    canonical_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
}
#[derive(Serialize)]
struct Annotation<'a> {
    id: String,
    kind: &'a str,
    speaker: String,
    text: &'a str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    candidates: Vec<String>,
}
#[derive(Serialize)]
#[serde(untagged)]
enum Content<'a> {
    Analysis { pieces: Vec<(usize, &'a str)> },
    Review { annotations: Vec<Annotation<'a>> },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Context<'a> {
    evaluation_task: &'a str,
    source_hash: &'a str,
    revision: u64,
    discovery_allowed: bool,
    characters: Vec<CharacterContext<'a>>,
    aliases: &'a Value,
    piece_count: usize,
    last_piece_index: usize,
    #[serde(flatten)]
    content: Content<'a>,
}
/// Serialize once at the model boundary; private role extensions remain lossless.
pub(super) fn input(draft: &Draft) -> Value {
    let characters = draft
        .state
        .characters
        .iter()
        .map(|character| CharacterContext {
            extra: character
                .extra
                .iter()
                .filter(|(key, _)| {
                    !matches!(key.as_str(), "id" | "name" | "canonicalId")
                        && (key.as_str() != "description" || character.description.is_none())
                })
                .map(|(k, v)| (k.as_str(), v))
                .collect(),
            id: identity(draft, &character.id),
            name: &character.name,
            canonical_id: &character.id,
            description: character.description.as_deref(),
        })
        .collect();
    let content = if draft.state.evaluation_task == "review" {
        Content::Review {
            annotations: draft
                .state
                .review_input
                .iter()
                .flat_map(|c| &c.segments)
                .enumerate()
                .map(|(index, segment)| Annotation {
                    id: format!("r{index}"),
                    kind: match segment.kind.as_str() {
                        "narration" => "n",
                        "speech" => "s",
                        "thought" => "t",
                        other => other,
                    },
                    speaker: identity(draft, &segment.speaker),
                    text: draft
                        .state
                        .source
                        .text
                        .get(segment.start..segment.end)
                        .unwrap_or_default(),
                    candidates: segment
                        .candidates
                        .iter()
                        .map(|id| identity(draft, id))
                        .collect(),
                })
                .collect(),
        }
    } else {
        Content::Analysis {
            pieces: draft
                .pieces
                .iter()
                .enumerate()
                .map(|(i, p)| (i, p.text.as_str()))
                .collect(),
        }
    };
    serde_json::to_value(Context {
        evaluation_task: &draft.state.evaluation_task,
        source_hash: &draft.state.source.sha256,
        revision: draft.revision,
        discovery_allowed: draft.allow_discovery,
        characters,
        aliases: &draft.state.aliases,
        piece_count: draft.pieces.len(),
        last_piece_index: draft.pieces.len().saturating_sub(1),
        content,
    })
    .expect("context consists only of serializable protocol data")
}
