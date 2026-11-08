//! Deterministic source positions, never a classification of quoted text as speech.
use super::types::{AnalysisError, ByteRange, SourceBinding};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Piece {
    pub id: String,
    pub range: ByteRange,
    pub text: String,
    pub quote_depth: u32,
    /// The first piece of the outermost quote, shared by every nested quote.
    pub utterance: Option<String>,
}

pub(super) fn partition(text: &str, binding: &SourceBinding) -> Result<Vec<Piece>, AnalysisError> {
    let chapter = text
        .get(binding.start as usize..binding.end as usize)
        .filter(|s| !s.is_empty())
        .ok_or(AnalysisError::InvalidData)?;
    if crate::project::hash(text.as_bytes()) != binding.sha256 {
        return Err(AnalysisError::SourceChanged);
    }
    let mut pieces = Vec::new();
    let mut stack: Vec<char> = Vec::new();
    let mut utterance = None;
    let mut start = 0;
    let mut scalars = 0;
    let mut pending = false;
    let mut chars = chapter.char_indices().peekable();
    while let Some((offset, ch)) = chars.next() {
        // ASCII apostrophes inside words are punctuation, not quote delimiters.
        let apostrophe = matches!(ch, '\'' | '’')
            && chapter[..offset]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_alphanumeric())
            && chars.peek().is_some_and(|(_, c)| c.is_ascii_alphanumeric());
        let closing = !apostrophe && stack.last() == Some(&ch);
        let opening = if closing || apostrophe {
            None
        } else {
            quote_end(ch)
        };
        if opening.is_some() || (pending && !ch.is_whitespace()) {
            // Keep leading whitespace with the first substantive piece.
            if !pieces.is_empty() || !chapter[start..offset].chars().all(char::is_whitespace) {
                emit(
                    &mut pieces,
                    chapter,
                    binding.start,
                    start,
                    offset,
                    stack.len(),
                    &utterance,
                );
                start = offset;
            }
            scalars = 0;
            pending = false;
        }
        if let Some(end) = opening {
            if stack.is_empty() {
                utterance = Some(format!("s{}", pieces.len()));
            }
            stack.push(end);
        }
        scalars += 1;
        if closing {
            let end = offset + ch.len_utf8();
            emit(
                &mut pieces,
                chapter,
                binding.start,
                start,
                end,
                stack.len(),
                &utterance,
            );
            start = end;
            scalars = 0;
            pending = false;
            stack.pop();
            if stack.is_empty() {
                utterance = None;
            }
        } else if scalars >= 160
            || matches!(
                ch,
                '\r' | '\n'
                    | ':'
                    | '：'
                    | '。'
                    | '！'
                    | '？'
                    | '!'
                    | '?'
                    | ';'
                    | '；'
                    | '，'
                    | ','
                    | '.'
            )
        {
            pending = true;
        }
    }
    emit(
        &mut pieces,
        chapter,
        binding.start,
        start,
        chapter.len(),
        stack.len(),
        &utterance,
    );
    Ok(pieces)
}

fn quote_end(ch: char) -> Option<char> {
    match ch {
        '“' => Some('”'),
        '‘' => Some('’'),
        '「' => Some('」'),
        '『' => Some('』'),
        '"' => Some('"'),
        '\'' => Some('\''),
        _ => None,
    }
}

fn emit(
    pieces: &mut Vec<Piece>,
    chapter: &str,
    base: u32,
    start: usize,
    end: usize,
    depth: usize,
    utterance: &Option<String>,
) {
    if start == end {
        return;
    }
    let text = &chapter[start..end];
    if text.chars().all(char::is_whitespace)
        && let Some(last) = pieces.last_mut()
    {
        last.text.push_str(text);
        last.range.end = base + end as u32;
        return;
    }
    pieces.push(Piece {
        id: format!("s{}", pieces.len()),
        range: ByteRange {
            start: base + start as u32,
            end: base + end as u32,
        },
        text: text.to_owned(),
        quote_depth: depth as u32,
        utterance: utterance.clone(),
    });
}

#[cfg(test)]
mod tests;
