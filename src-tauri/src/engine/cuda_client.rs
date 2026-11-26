//! Desktop-owned worker process. Staging is deleted only after child teardown.
use super::cuda_protocol::{Command, MAX_FRAME, MAX_PCM_BYTES, Outcome, Reply, Request, VERSION};
use anyhow::{Context, ensure};
use std::{path::Path, process::Stdio, time::Duration};
use talechime::Pcm;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout},
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

pub(crate) struct CudaClient {
    child: Option<Child>,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    scratch: Option<tempfile::TempDir>,
    last_id: u32,
}

impl CudaClient {
    /// The caller supplies authenticated installation paths. The worker receives no credentials.
    pub(crate) fn start(binary: &Path, runtime: &Path, scratch: &Path) -> anyhow::Result<Self> {
        use std::os::windows::process::CommandExt;

        let binary = binary.canonicalize()?;
        let runtime = runtime.canonicalize()?;
        let windows = std::env::var_os("SystemRoot").context("Windows system root unavailable")?;
        let system = Path::new(&windows).join("System32");
        let dll_search = std::env::join_paths([&runtime, &system])?;
        let scratch = tempfile::tempdir_in(scratch.canonicalize()?)?;
        let mut command = std::process::Command::new(binary);
        command
            .arg(scratch.path())
            .current_dir(scratch.path())
            .env_clear()
            .env("SystemRoot", windows)
            .env("PATH", dll_search)
            .env("TEMP", scratch.path())
            .env("TMP", scratch.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        let mut command = tokio::process::Command::from(command);
        let mut child = command.kill_on_drop(true).spawn()?;
        let input = child.stdin.take().context("CUDA worker stdin missing")?;
        let output = child.stdout.take().context("CUDA worker stdout missing")?;
        Ok(Self {
            child: Some(child),
            input,
            output: BufReader::new(output),
            scratch: Some(scratch),
            last_id: 0,
        })
    }

    pub(crate) async fn request(&mut self, command: Command) -> anyhow::Result<Outcome> {
        ensure!(self.child.is_some(), "CUDA worker is closed");
        let id = self
            .last_id
            .checked_add(1)
            .context("request IDs exhausted")?;
        let mut request = serde_json::to_vec(&Request {
            version: VERSION,
            id,
            command,
        })?;
        request.push(b'\n');
        ensure!(
            request.len() <= MAX_FRAME,
            "CUDA request exceeds frame budget"
        );
        self.last_id = id;
        let result = tokio::time::timeout(REQUEST_TIMEOUT, async {
            self.input.write_all(&request).await?;
            self.input.flush().await?;
            let mut reply = Vec::new();
            (&mut self.output)
                .take((MAX_FRAME + 1) as u64)
                .read_until(b'\n', &mut reply)
                .await?;
            ensure!(
                reply.len() <= MAX_FRAME && reply.ends_with(b"\n"),
                "invalid CUDA reply"
            );
            let reply: Reply = serde_json::from_slice(&reply)?;
            ensure!(
                reply.version == VERSION && reply.id == id,
                "CUDA reply identity mismatch"
            );
            Ok(reply.outcome)
        })
        .await;
        match result {
            Ok(Ok(outcome)) => Ok(outcome),
            failure => {
                let _ = self.terminate().await;
                failure.context("CUDA worker timed out")?
            }
        }
    }

    pub(crate) async fn synthesize(&mut self, text: String, voice: String) -> anyhow::Result<Pcm> {
        let outcome = self.request(Command::Synthesize { text, voice }).await?;
        ensure!(matches!(outcome, Outcome::Audio), "CUDA synthesis failed");
        let scratch = self.scratch.as_ref().context("CUDA worker is closed")?;
        let path = scratch.path().join(format!("{}.wav", self.last_id));
        let scratch_path = scratch.path().canonicalize()?;
        ensure!(
            path.canonicalize()?.parent() == Some(scratch_path.as_path()),
            "CUDA audio is outside the private staging directory"
        );
        let pcm = read_pcm(&path)?;
        std::fs::remove_file(path)?;
        Ok(pcm)
    }

    pub(crate) async fn terminate(&mut self) -> anyhow::Result<()> {
        if let Some(child) = &mut self.child {
            if child.try_wait()?.is_none() {
                child.kill().await?;
            }
            self.child.take();
        }
        self.scratch.take();
        Ok(())
    }
}

impl Drop for CudaClient {
    fn drop(&mut self) {
        let Some(mut child) = self.child.take() else {
            return;
        };
        let _ = child.start_kill();
        let scratch = self.scratch.take();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                if child.wait().await.is_ok() {
                    drop(scratch);
                } else if let Some(scratch) = scratch {
                    let _ = scratch.keep();
                }
            });
        } else if let Some(scratch) = scratch {
            let _ = scratch.keep();
        }
    }
}

fn read_pcm(path: &Path) -> anyhow::Result<Pcm> {
    let mut reader = hound::WavReader::open(path)?;
    let spec = reader.spec();
    ensure!(
        spec.sample_format == hound::SampleFormat::Float
            && spec.bits_per_sample == 32
            && spec.channels == 1
            && spec.sample_rate == 24_000,
        "invalid CUDA PCM format"
    );
    ensure!(
        reader.len() > 0
            && reader.len() as usize <= MAX_PCM_BYTES / size_of::<f32>()
            && reader.duration() <= 180 * spec.sample_rate,
        "CUDA PCM exceeds audio budget"
    );
    let samples = reader.samples::<f32>().collect::<Result<Vec<_>, _>>()?;
    ensure!(
        samples.iter().all(|sample| sample.is_finite()),
        "invalid CUDA samples"
    );
    Ok(Pcm {
        samples,
        channels: spec.channels,
        sample_rate: spec.sample_rate,
    })
}
