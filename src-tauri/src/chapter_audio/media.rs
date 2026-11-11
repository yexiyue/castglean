//! Chapter audio protocol only resolves opaque, issued media identities.
use super::store::ChapterAudioState;
use tauri::{
    Manager,
    http::{Request, Response},
};

fn open(state: &ChapterAudioState, path: &str) -> Result<std::fs::File, u16> {
    let id = path.strip_prefix('/').ok_or(404u16)?;
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(404);
    }
    // 身份已签发但文件被清理时如实返回 404，不回退到其他产物。
    std::fs::File::open(state.media_path(id).ok_or(404u16)?).map_err(|_| 404)
}

pub(crate) fn respond(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let result = app
        .try_state::<ChapterAudioState>()
        .ok_or(503u16)
        .and_then(|state| open(&state, request.uri().path()))
        .and_then(|file| crate::voices::studio::media::serve(file, &request));
    result.unwrap_or_else(|status| Response::builder().status(status).body(vec![]).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_issued_identities_with_existing_files_resolve() {
        let root = tempfile::tempdir().unwrap();
        let state = ChapterAudioState::new(root.path().join("chapter-audio"));
        std::fs::create_dir_all(state.run_dir("r1")).unwrap();
        let path = state.final_path("r1");
        std::fs::write(&path, b"wav").unwrap();
        let id = "0123456789abcdef0123456789abcdef";
        assert!(state.publish_media(id, path.clone()));
        assert!(open(&state, &format!("/{id}")).is_ok());
        for path in [
            "/etc/passwd",
            "/../chapter.wav",
            "/00000000000000000000000000000000",
            "/r1/chapter.wav",
        ] {
            assert_eq!(open(&state, path).unwrap_err(), 404);
        }
        // 文件被清理后身份不再可读。
        std::fs::remove_file(&path).unwrap();
        assert_eq!(open(&state, &format!("/{id}")).unwrap_err(), 404);
        // 不存在的文件无法获得身份。
        assert!(!state.publish_media("fedcba9876543210fedcba9876543210", path));
    }
}
