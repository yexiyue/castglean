//! Strict decoding preserves the confirmed source bytes and rejects invalid input.
use crate::project::ProjectError;

pub(super) fn decode(bytes: &[u8], encoding: &str) -> Result<String, ProjectError> {
    let text = match encoding {
        "utf-8" => std::str::from_utf8(bytes)
            .map_err(|_| ProjectError::InvalidEncoding)?
            .to_owned(),
        "gb18030" | "gbk" => {
            let codec = if encoding == "gbk" {
                encoding_rs::GBK
            } else {
                encoding_rs::GB18030
            };
            let (text, errors) = codec.decode_without_bom_handling(bytes);
            if errors {
                return Err(ProjectError::InvalidEncoding);
            }
            text.into_owned()
        }
        _ => return Err(ProjectError::InvalidEncoding),
    };
    if text.len() > crate::project::MAX_SOURCE {
        return Err(ProjectError::TooLarge);
    }
    if text
        .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
        .is_empty()
        || text.contains('\0')
    {
        return Err(ProjectError::InvalidEncoding);
    }
    Ok(text)
}
