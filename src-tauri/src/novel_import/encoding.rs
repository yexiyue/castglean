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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_codecs_preserve_confirmed_text_and_reject_invalid_input() {
        let text = "\u{feff}第一章\r\n正文😀e\u{301}\n";
        assert_eq!(decode(text.as_bytes(), "utf-8").unwrap(), text);
        for codec in ["gb18030", "gbk"] {
            let (encoded, _, errors) = encoding_rs::GBK.encode("第一章\r\n中文正文");
            assert!(!errors);
            assert_eq!(decode(&encoded, codec).unwrap(), "第一章\r\n中文正文");
            assert!(matches!(
                decode(&[0x81], codec),
                Err(ProjectError::InvalidEncoding)
            ));
        }
        assert!(decode(&[0xff], "utf-8").is_err());
        for invalid in ["", " \r\n\t", "\u{feff} \n", "正文\0隐藏"] {
            assert!(matches!(
                decode(invalid.as_bytes(), "utf-8"),
                Err(ProjectError::InvalidEncoding)
            ));
        }
        assert!(decode(b"plain", "unknown").is_err());
        // Valid under both codecs: preview is a suggestion, confirmation owns the encoding choice.
        assert_eq!(
            decode(b"plain", "utf-8").unwrap(),
            decode(b"plain", "gb18030").unwrap()
        );
    }

    #[test]
    fn decoded_limit_is_checked_before_acceptance() {
        let bytes = vec![b'a'; crate::project::MAX_SOURCE + 1];
        assert!(matches!(
            decode(&bytes, "utf-8"),
            Err(ProjectError::TooLarge)
        ));
    }
}
