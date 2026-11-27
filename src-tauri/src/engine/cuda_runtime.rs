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
use tokio::{
    fs as async_fs,
    io::{AsyncSeekExt, AsyncWriteExt},
    task::spawn_blocking,
};

const NVIDIA_HOST: &str = "developer.download.nvidia.com";
const RANGE_SIZE: u64 = 8 * 1024 * 1024;

#[derive(Clone, Deserialize)]
pub(crate) struct RuntimeAssets {
    pub(crate) version: String,
    packages: Vec<Package>,
}

#[derive(Clone, Deserialize)]
struct Package {
    path: String,
    size: u64,
    sha256: String,
    files: Vec<Dll>,
}

#[derive(Clone, Deserialize)]
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

    pub(crate) async fn verify_installed(&self, runtime: PathBuf) -> anyhow::Result<()> {
        let assets = self.clone();
        spawn_blocking(move || assets.verified(&runtime)).await?
    }

    fn verified(&self, runtime: &Path) -> anyhow::Result<()> {
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
        let lock_path = root.join("prepare.lock");
        let lock = spawn_blocking(move || -> anyhow::Result<File> {
            let lock = OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .open(lock_path)?;
            fs2::FileExt::try_lock_exclusive(&lock)
                .context("CUDA preparation is already active")?;
            Ok(lock)
        })
        .await??;
        if self.verify_installed(runtime.clone()).await.is_ok() {
            progress(self.download_size());
            return Ok(runtime);
        }
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
        let mut downloads = Vec::with_capacity(self.packages.len());
        for package in &self.packages {
            let archive_name = package
                .path
                .rsplit('/')
                .next()
                .context("CUDA archive name")?;
            let download_path = root.join(format!("{archive_name}.partial"));
            let url = format!("https://{NVIDIA_HOST}/compute/cuda/redist/{}", package.path);
            download(&client, &url, package, &download_path, |bytes| {
                progress(received + bytes)
            })
            .await?;
            downloads.push((package.clone(), download_path));
            received += package.size;
            progress(received);
        }
        let assets = self.clone();
        let root = root.to_owned();
        spawn_blocking(move || {
            // Keep the lock until extraction and publication finish, even if the caller goes away.
            let _lock = lock;
            let staged = tempfile::tempdir_in(root)?;
            for (package, archive) in &downloads {
                extract(package, archive, staged.path())?;
            }
            assets.verified(staged.path())?;
            publish(&staged, &runtime)?;
            for (_, archive) in downloads {
                let _ = fs::remove_file(archive);
            }
            Ok(runtime)
        })
        .await?
    }
}

fn publish(staged: &tempfile::TempDir, runtime: &Path) -> anyhow::Result<()> {
    if !runtime.exists() {
        fs::rename(staged.path(), runtime)?;
        return Ok(());
    }
    let backup = tempfile::tempdir_in(staged.path().parent().context("CUDA staging parent")?)?;
    let previous = backup.path().join("previous");
    fs::rename(runtime, &previous)?;
    if let Err(error) = fs::rename(staged.path(), runtime) {
        if fs::rename(previous, runtime).is_err() {
            let _ = backup.keep();
        }
        return Err(error.into());
    }
    Ok(())
}

async fn verify_archive(path: &Path, package: &Package) -> anyhow::Result<()> {
    let path = path.to_owned();
    let size = package.size;
    let digest = package.sha256.clone();
    spawn_blocking(move || verify(&path, size, &digest)).await?
}

async fn download(
    client: &reqwest::Client,
    url: &str,
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
    if received == package.size && verify_archive(staged, package).await.is_ok() {
        return Ok(());
    }
    if received >= package.size {
        received = 0;
    }
    let mut file = async_fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(received == 0)
        .open(staged)
        .await?;
    file.seek(io::SeekFrom::Start(received)).await?;
    progress(received);
    let mut attempts = 0;
    while received < package.size {
        let end = (received + RANGE_SIZE).min(package.size) - 1;
        let expected = format!("bytes {received}-{end}/{}", package.size);
        let result: anyhow::Result<()> = async {
            let mut response = client
                .get(url)
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
                file.seek(io::SeekFrom::Start(received)).await?;
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
    if let Err(error) = verify_archive(staged, package).await {
        async_fs::remove_file(staged).await?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
    };

    #[tokio::test]
    async fn retry_resumes_after_a_short_response() -> anyhow::Result<()> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let url = format!("http://{}", listener.local_addr()?);
        let (received_prefix, first_range) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || -> io::Result<()> {
            for (range, body) in [("2-5", "cd"), ("4-5", "ef")] {
                let (mut stream, _) = listener.accept()?;
                stream.set_read_timeout(Some(Duration::from_secs(5)))?;
                let mut reader = BufReader::new(&mut stream);
                let mut request = String::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line)? == 0 || line == "\r\n" {
                        break;
                    }
                    request.push_str(&line);
                }
                assert!(
                    request
                        .to_ascii_lowercase()
                        .contains(&format!("range: bytes={range}"))
                );
                let length = if range == "2-5" { 4 } else { 2 };
                write!(
                    stream,
                    "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {range}/6\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n{body}"
                )?;
                if range == "2-5" {
                    first_range
                        .recv_timeout(Duration::from_secs(5))
                        .map_err(io::Error::other)?;
                }
            }
            Ok(())
        });
        let directory = tempfile::tempdir()?;
        let partial = directory.path().join("archive.partial");
        fs::write(&partial, b"ab")?;
        let package = Package {
            path: String::new(),
            size: 6,
            sha256: format!("{:x}", Sha256::digest(b"abcdef")),
            files: vec![],
        };
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(10))
            .build()?;

        download(&client, &url, &package, &partial, |received| {
            if received == 4 {
                let _ = received_prefix.send(());
            }
        })
        .await?;
        assert_eq!(fs::read(partial)?, b"abcdef");
        server.join().expect("test HTTP server")?;
        Ok(())
    }

    #[tokio::test]
    async fn an_installed_runtime_is_reused_without_downloading() -> anyhow::Result<()> {
        let pinned = RuntimeAssets::pinned()?;
        assert!(pinned.download_size() > 0);
        let root = tempfile::tempdir()?;
        let runtime = root.path().join(&pinned.version);
        let dll = Dll {
            name: "fixture.dll".into(),
            size: 4,
            sha256: format!("{:x}", Sha256::digest(b"test")),
        };
        let assets = RuntimeAssets {
            version: pinned.version,
            packages: vec![Package {
                path: String::new(),
                size: 4,
                sha256: String::new(),
                files: vec![dll],
            }],
        };
        fs::create_dir(&runtime)?;
        fs::write(runtime.join("fixture.dll"), b"test")?;

        assert_eq!(assets.prepare(root.path(), |_| {}).await?, runtime);
        fs::write(runtime.join("fixture.dll"), b"fail")?;
        assert!(assets.verify_installed(runtime).await.is_err());
        Ok(())
    }
}
