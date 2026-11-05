//! Audio protocol only resolves opaque, issued media identities.
use super::StudioState;
use std::io::{Read, Seek, SeekFrom};
use tauri::{
    Manager,
    http::{Request, Response},
};

fn range(header: Option<&str>, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let Some(header) = header else {
        return Some((0, total - 1));
    };
    let (start, end) = header.strip_prefix("bytes=")?.split_once('-')?;
    if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        return (suffix > 0).then_some((total.saturating_sub(suffix), total - 1));
    }
    let start: u64 = start.parse().ok()?;
    let end = if end.is_empty() {
        total - 1
    } else {
        end.parse::<u64>().ok()?.min(total - 1)
    };
    (start <= end && start < total).then_some((start, end))
}
fn open(store: &super::store::Store, path: &str) -> Result<std::fs::File, u16> {
    let id = path.strip_prefix('/').ok_or(404u16)?;
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(404);
    }
    store
        .media
        .get(id)
        .ok_or(404u16)?
        .file
        .reopen()
        .map_err(|_| 500)
}
pub(crate) fn respond(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let result = (|| -> Result<_, u16> {
        if !matches!(request.method().as_str(), "GET" | "HEAD") {
            return Err(405);
        }
        let state = app.state::<StudioState>();
        let store = state.store.lock().map_err(|_| 500u16)?;
        let mut file = open(&store, request.uri().path())?;
        drop(store);
        let total = file.metadata().map_err(|_| 500u16)?.len();
        let requested = request
            .headers()
            .get("Range")
            .map(|s| s.to_str().unwrap_or("invalid"));
        let Some((start, end)) = range(requested, total) else {
            return Ok(Response::builder()
                .status(416)
                .header("Content-Range", format!("bytes */{total}"))
                .body(vec![])
                .unwrap());
        };
        let mut body = vec![];
        if request.method() != "HEAD" {
            file.seek(SeekFrom::Start(start)).map_err(|_| 500u16)?;
            file.take(end - start + 1)
                .read_to_end(&mut body)
                .map_err(|_| 500u16)?;
        }
        let mut response = Response::builder()
            .status(if requested.is_some() { 206 } else { 200 })
            .header("Content-Type", "audio/wav")
            .header("Accept-Ranges", "bytes")
            .header("Cache-Control", "no-store")
            .header("Content-Length", (end - start + 1).to_string());
        if requested.is_some() {
            response = response.header("Content-Range", format!("bytes {start}-{end}/{total}"));
        }
        Ok(response.body(body).unwrap())
    })();
    result.unwrap_or_else(|status| Response::builder().status(status).body(vec![]).unwrap())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_reject_overflow_multiple_and_out_of_bounds() {
        assert_eq!(range(None, 100), Some((0, 99)));
        assert_eq!(range(Some("bytes=4-9"), 100), Some((4, 9)));
        assert_eq!(range(Some("bytes=-10"), 100), Some((90, 99)));
        assert_eq!(range(Some("bytes=90-"), 100), Some((90, 99)));
        for value in [
            "bytes=100-",
            "bytes=-0",
            "bytes=9-4",
            "bytes=0-1,3-4",
            "bytes=99999999999999999999999-",
        ] {
            assert!(range(Some(value), 100).is_none());
        }
    }
    #[test]
    fn media_only_opens_issued_identity_and_rejects_released_or_arbitrary_paths() {
        let root = tempfile::tempdir().unwrap();
        let mut store = super::super::store::Store::new(root.path().into()).unwrap();
        let id = store.audio(b"test audio", None).unwrap();
        assert!(open(&store, &format!("/{id}")).is_ok());
        for path in [
            "/etc/passwd",
            "/../reference.wav",
            "/00000000000000000000000000000000",
        ] {
            assert!(open(&store, path).is_err());
        }
        store.media.remove(&id);
        assert!(open(&store, &format!("/{id}")).is_err());
    }
}
