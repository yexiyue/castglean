//! 离线盘点映射：引擎 `ResourceStatus` → 应用层 `ResourceState`，
//! 以及磁盘可用空间查询（宿主职责，平台相关）。
use std::path::Path;

use talechime::ResourceStatus;

use super::{PrepareFailure, ResourceState};

/// 盘点事实到应用层状态；`ModelEntry.resource` 的唯一权威来源。
pub(crate) fn from_engine(status: ResourceStatus) -> ResourceState {
    match status {
        ResourceStatus::Ready => ResourceState::Ready,
        ResourceStatus::Missing { missing_bytes } => ResourceState::Missing {
            missing_bytes: missing_bytes as f64,
        },
        ResourceStatus::Partial {
            ready,
            total,
            missing_bytes,
        } => ResourceState::Partial {
            ready: u32::try_from(ready).unwrap_or(u32::MAX),
            total: u32::try_from(total).unwrap_or(u32::MAX),
            missing_bytes: missing_bytes as f64,
        },
    }
}

/// 缓存目录所在卷的可用空间；目录本身可能尚未创建，探测其父目录。
pub(crate) fn available_for(cache_dir: &Path) -> std::io::Result<f64> {
    let existing = cache_dir
        .ancestors()
        .find(|path| path.exists())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "cache has no existing ancestor",
            )
        })?;
    fs2::available_space(existing).map(|bytes| bytes as f64)
}

/// 把引擎 anyhow 错误归类为类型化失败；凭据不进入返回值。
pub(crate) fn classify_failure(error: &anyhow::Error) -> PrepareFailure {
    if let Some(error) = error
        .chain()
        .find_map(|source| source.downcast_ref::<talechime::PreparationError>())
    {
        return match error {
            talechime::PreparationError::PlanChanged => PrepareFailure::PlanChanged,
            talechime::PreparationError::Busy => PrepareFailure::Busy,
            talechime::PreparationError::Space => PrepareFailure::Disk,
            talechime::PreparationError::Integrity(_) => PrepareFailure::Integrity,
            talechime::PreparationError::Cancelled => PrepareFailure::Internal,
        };
    }
    match error
        .chain()
        .find_map(|source| source.downcast_ref::<talechime::DownloadFailure>())
    {
        Some(talechime::DownloadFailure::Network(_)) => PrepareFailure::Network,
        Some(talechime::DownloadFailure::Auth(_)) => PrepareFailure::Auth,
        Some(talechime::DownloadFailure::RateLimited) => PrepareFailure::RateLimited,
        Some(talechime::DownloadFailure::NotFound(_)) => PrepareFailure::NotFound,
        Some(talechime::DownloadFailure::Cache(_)) => PrepareFailure::Cache,
        Some(talechime::DownloadFailure::Disk(_)) => PrepareFailure::Disk,
        _ => PrepareFailure::Internal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_nested_facade_error_sources() {
        #[derive(Debug)]
        struct Facade(talechime::DownloadFailure);
        impl std::fmt::Display for Facade {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "resource preparation failed")
            }
        }
        impl std::error::Error for Facade {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                Some(&self.0)
            }
        }
        let error = anyhow::Error::new(Facade(talechime::DownloadFailure::Auth("denied".into())));
        assert_eq!(classify_failure(&error), PrepareFailure::Auth);
    }
    #[test]
    fn maps_engine_status_states() {
        assert_eq!(from_engine(ResourceStatus::Ready), ResourceState::Ready);
        assert_eq!(
            from_engine(ResourceStatus::Missing { missing_bytes: 42 }),
            ResourceState::Missing {
                missing_bytes: 42.0,
            }
        );
        assert_eq!(
            from_engine(ResourceStatus::Partial {
                ready: 1,
                total: 3,
                missing_bytes: 7
            }),
            ResourceState::Partial {
                ready: 1,
                total: 3,
                missing_bytes: 7.0
            }
        );
    }

    #[test]
    fn available_space_uses_nearest_existing_ancestor() {
        let root = tempfile::tempdir().unwrap();
        assert!(available_for(&root.path().join("new/nested/hub")).unwrap() > 0.0);
    }

    #[test]
    fn classifies_typed_download_failures_from_chain() {
        let error = anyhow::Error::new(talechime::DownloadFailure::Auth("401".into()))
            .context("download failed for o/m@rev/f.bin");
        assert_eq!(classify_failure(&error), PrepareFailure::Auth);
        let error = anyhow::anyhow!("unrelated");
        assert_eq!(classify_failure(&error), PrepareFailure::Internal);
    }
}
