//! Private runtime files identified by a fixed NVIDIA release manifest.
use anyhow::{Context, ensure};
use rig_reqwest::reqwest::{self, StatusCode, header};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{fs as async_fs, io::AsyncWriteExt};

const NVIDIA_HOST: &str = "developer.download.nvidia.com";
const RANGE_SIZE: u64 = 8 * 1024 * 1024;

#[derive(Deserialize)]
pub(crate) struct RuntimeAssets {
    pub(crate) version: String,
    packages: Vec<Package>,
}

#[derive(Deserialize)]
struct Package {
    path: String,
    size: u64,
    sha256: String,
    files: Vec<Dll>,
}

#[derive(Deserialize)]
struct Dll {
    name: String,
    size: u64,
    sha256: String,
}

impl RuntimeAssets {
    pub(crate) fn pinned() -> anyhow::Result<Self> {
        Ok(serde_json::from_str(include_str!(
            "cuda_runtime_assets.json"
        ))?)
    }

    pub(crate) fn download_size(&self) -> u64 {
        self.packages.iter().map(|file| file.size).sum()
    }

    pub(crate) fn verified(&self, runtime: &Path) -> anyhow::Result<()> {
        let directory = fs::symlink_metadata(runtime)?;
        ensure!(
            directory.is_dir() && !directory.is_symlink(),
            "invalid CUDA directory"
        );
        let expected = self
            .packages
            .iter()
            .flat_map(|package| &package.files)
            .collect::<Vec<_>>();
        ensure!(
            fs::read_dir(runtime)?.count() == expected.len(),
            "unexpected CUDA files"
        );
        for dll in expected {
            verify(&runtime.join(&dll.name), dll.size, &dll.sha256)?;
        }
        Ok(())
    }

    /// Downloads are resumable across restarts, and authenticated before extraction.
    /// Only the verified DLL directory is published.
    pub(crate) async fn prepare(
        &self,
        root: &Path,
        progress: impl Fn(u64),
    ) -> anyhow::Result<PathBuf> {
        let runtime = root.join(&self.version);
        async_fs::create_dir_all(root).await?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(root.join("prepare.lock"))?;
        fs2::FileExt::try_lock_exclusive(&lock).context("CUDA preparation is already active")?;
        if self.verified(&runtime).is_ok() {
            progress(self.download_size());
            return Ok(runtime);
        }
        let staged = tempfile::tempdir_in(root)?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(30))
            .read_timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.url().scheme() == "https"
                    && attempt.url().host_str() == Some(NVIDIA_HOST)
                    && attempt.previous().len() < 5
                {
                    attempt.follow()
                } else {
                    attempt.error("unexpected CUDA download redirect")
                }
            }))
            .build()?;
        let mut received = 0;
        for package in &self.packages {
            let archive_name = package
                .path
                .rsplit('/')
                .next()
                .context("CUDA archive name")?;
            let download_path = root.join(format!("{archive_name}.partial"));
            download(&client, package, &download_path, |bytes| {
                progress(received + bytes)
            })
            .await?;
            extract(package, &download_path, staged.path())?;
            received += package.size;
            progress(received);
        }
        self.verified(staged.path())?;
        if runtime.exists() {
            let backup = tempfile::tempdir_in(root)?;
            let old = backup.path().join("previous");
            fs::rename(&runtime, &old)?;
            if let Err(error) = fs::rename(staged.path(), &runtime) {
                if fs::rename(old, &runtime).is_err() {
                    let _ = backup.keep();
                }
                return Err(error.into());
            }
        } else {
            fs::rename(staged.path(), &runtime)?;
        }
        for package in &self.packages {
            if let Some(name) = package.path.rsplit('/').next() {
                let _ = async_fs::remove_file(root.join(format!("{name}.partial"))).await;
            }
        }
        Ok(runtime)
    }
}

async fn download(
    client: &reqwest::Client,
    package: &Package,
    staged: &Path,
    progress: impl Fn(u64),
) -> anyhow::Result<()> {
    let metadata = async_fs::symlink_metadata(staged).await;
    let mut received = match metadata {
        Ok(metadata) => {
            ensure!(
                metadata.is_file() && !metadata.is_symlink(),
                "invalid partial path"
            );
            metadata.len()
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => 0,
        Err(error) => return Err(error.into()),
    };
    if received == package.size && verify(staged, package.size, &package.sha256).is_ok() {
        return Ok(());
    }
    if received >= package.size {
        received = 0;
    }
    let url = format!("https://{NVIDIA_HOST}/compute/cuda/redist/{}", package.path);
    let mut file = async_fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(received > 0)
        .truncate(received == 0)
        .open(staged)
        .await?;
    progress(received);
    let mut attempts = 0;
    while received < package.size {
        let end = (received + RANGE_SIZE).min(package.size) - 1;
        let expected = format!("bytes {received}-{end}/{}", package.size);
        let result: anyhow::Result<()> = async {
            let mut response = client
                .get(&url)
                .header(header::ACCEPT_ENCODING, "identity")
                .header(header::RANGE, format!("bytes={received}-{end}"))
                .send()
                .await?
                .error_for_status()?;
            let matches_range = response.status() == StatusCode::PARTIAL_CONTENT
                && response
                    .headers()
                    .get(header::CONTENT_RANGE)
                    .and_then(|value| value.to_str().ok())
                    == Some(expected.as_str());
            let complete =
                response.status() == StatusCode::OK && received == 0 && end + 1 == package.size;
            ensure!(matches_range || complete, "invalid CUDA download range");
            while let Some(chunk) = response.chunk().await? {
                let next = received + chunk.len() as u64;
                ensure!(next <= end + 1, "CUDA archive exceeded pinned range");
                file.write_all(&chunk).await?;
                received = next;
                progress(received);
            }
            ensure!(received == end + 1, "partial CUDA response");
            Ok(())
        }
        .await;
        match result {
            Ok(()) => attempts = 0,
            Err(error) => {
                file.set_len(received).await?;
                attempts += 1;
                if attempts == 3 {
                    return Err(error);
                }
                tokio::time::sleep(Duration::from_secs(attempts)).await;
            }
        }
    }
    file.sync_all().await?;
    drop(file);
    if let Err(error) = verify(staged, package.size, &package.sha256) {
        if received == package.size {
            async_fs::remove_file(staged).await?;
        }
        return Err(error);
    }
    Ok(())
}

fn extract(package: &Package, archive: &Path, destination: &Path) -> anyhow::Result<()> {
    let mut zip = zip::ZipArchive::new(File::open(archive)?)?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index)?;
        let Some(path) = entry.enclosed_name() else {
            continue;
        };
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(dll) = package.files.iter().find(|dll| dll.name == name) else {
            continue;
        };
        ensure!(
            entry.is_file() && entry.size() == dll.size,
            "invalid CUDA DLL entry"
        );
        let path = destination.join(name);
        let mut target = File::create_new(&path)?;
        io::copy(&mut entry, &mut target)?;
        target.sync_all()?;
    }
    Ok(())
}

fn verify(path: &Path, size: u64, digest: &str) -> anyhow::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    ensure!(
        metadata.is_file() && !metadata.is_symlink() && metadata.len() == size,
        "unexpected CUDA file size or type"
    );
    let mut file = File::open(path)?;
    let mut sha = Sha256::new();
    io::copy(&mut file, &mut sha)?;
    ensure!(
        format!("{:x}", sha.finalize()) == digest,
        "CUDA checksum mismatch"
    );
    Ok(())
}
