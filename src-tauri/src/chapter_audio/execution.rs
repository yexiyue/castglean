//! 章节顺序合成。推理对象不离开引擎专用线程；循环对合成接口泛型，
//! 失败、取消与拼接顺序可在不加载模型的情况下验证。
use super::{
    store::{self, ChapterAudioState, Finish},
    types::*,
};
use crate::database::entity::chapter_audio_run as run;
use sea_orm::DatabaseConnection;
use std::{
    path::{Path, PathBuf},
    rc::Rc,
};
use talechime::{Engine, ModelOptions, Pcm, PcmStream, SynthesisState};
use tauri::Manager;
use tauri_specta::Event;
use tokio::sync::{Semaphore, watch};

/// 单元级收集上限：远高于 120 字符单元的正常时长，仅用于拒绝失控输出。
const MAX_UNIT_SECONDS: u64 = 180;
const MAX_UNIT_SAMPLES: usize = 64 * 1024 * 1024 / size_of::<f32>();

/// 宿主生成的稳定失败码；界面按码映射文案，不展示底层异常原文。
pub(super) mod code {
    pub const PREPARING: &str = "preparing_resources";
    pub const SOURCE: &str = "source_unavailable";
    pub const ENGINE: &str = "engine_load_failed";
    pub const SYNTHESIS: &str = "unit_synthesis_failed";
    pub const FORMAT: &str = "audio_format_changed";
    pub const WRITE: &str = "audio_write_failed";
    pub const CONCAT: &str = "concat_failed";
    pub const NO_AUDIO: &str = "no_speakable_text";
}

/// 合成前的执行文本规范化：只改送入引擎的文本，不改原文与单元范围。
/// Kokoro 前端把单元内部的换行当作音素、把单引号等符号当作未知词而直接失败；
/// 真实章节的分析片段常跨段落并使用单引号（2026-11-11 真实失败案例）。
pub(super) fn execution_text(slice: &str) -> String {
    let mut spoken = String::with_capacity(slice.len());
    let mut previous = None;
    let mut chars = slice.chars().peekable();
    while let Some(c) = chars.next() {
        let inside_english = previous.is_some_and(|p: char| p.is_ascii_alphabetic())
            && chars.peek().is_some_and(char::is_ascii_alphabetic);
        previous = Some(c);
        let mapped = match c {
            '\r' => continue,
            // 句中换行与全角/不间断空格压成普通空格（引擎接受句中空格）。
            '\n' | '\u{3000}' | '\u{00a0}' => ' ',
            // 单引号家族：引擎仅支持双引号（ASCII 与全角）。
            '\'' | '’' if inside_english => '\'',
            '\'' | '‘' | '’' | '＇' | '＂' => '"',
            '『' | '﹃' => '“',
            '』' | '﹄' => '”',
            '〈' => '《',
            '〉' => '》',
            '[' => '【',
            ']' => '】',
            '–' => '—',
            '~' | '～' => '…',
            // 名字中的间隔号作为分隔。
            '·' => ' ',
            '\u{feff}' | '\u{200b}' => continue,
            other => other,
        };
        // 段落缩进与残留空白不应变成多拍停顿。
        if mapped != ' ' || !spoken.ends_with(' ') {
            spoken.push(mapped);
        }
    }
    spoken
}

/// 诊断详情截断：足够定位问题，不把整段后端输出写进数据库。
fn brief(detail: &str) -> String {
    detail.chars().take(500).collect()
}

pub(super) trait UnitSynth {
    async fn synthesize(&mut self, text: &str, voice: &str) -> Result<Pcm, String>;
}

async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    if *cancel.borrow() {
        return;
    }
    while cancel.changed().await.is_ok() {
        if *cancel.borrow() {
            break;
        }
    }
}

struct EngineSynth<'a>(&'a Engine);

impl UnitSynth for EngineSynth<'_> {
    async fn synthesize(&mut self, text: &str, voice: &str) -> Result<Pcm, String> {
        let stream = self
            .0
            .synthesize(text.to_owned(), voice, None)
            .await
            .map_err(|e| e.to_string())?;
        collect(stream).await
    }
}

async fn collect(mut stream: PcmStream) -> Result<Pcm, String> {
    let result = async {
        let mut output: Option<Pcm> = None;
        while let Some(block) = stream.recv().await {
            let block = block.map_err(|e| e.to_string())?;
            let pcm = block.pcm();
            pcm.duration_ms().map_err(|e| e.to_string())?;
            let audio = output.get_or_insert_with(|| Pcm {
                samples: vec![],
                sample_rate: pcm.sample_rate,
                channels: pcm.channels,
            });
            if (audio.sample_rate, audio.channels) != (pcm.sample_rate, pcm.channels) {
                return Err("PCM format changed inside a unit".to_owned());
            }
            let samples = audio.samples.len() + pcm.samples.len();
            if samples > MAX_UNIT_SAMPLES
                || samples as u64
                    > u64::from(pcm.sample_rate) * u64::from(pcm.channels) * MAX_UNIT_SECONDS
            {
                return Err("unit audio exceeds the collection budget".to_owned());
            }
            audio.samples.extend_from_slice(&pcm.samples);
        }
        if stream.state() != SynthesisState::Completed {
            return Err("synthesis did not complete".to_owned());
        }
        output.ok_or_else(|| "model produced no audio".to_owned())
    };
    let outcome = result.await;
    if outcome.is_err() {
        stream.cancel().await;
    }
    outcome
}

fn temporary(path: &Path) -> PathBuf {
    path.with_extension("wav.tmp")
}

/// 完整写入并同步后才以目标名发布，半写文件不获得产物名。
fn write_wav(path: &Path, pcm: &Pcm) -> Result<f64, String> {
    let spec = hound::WavSpec {
        channels: pcm.channels,
        sample_rate: pcm.sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let staged = temporary(path);
    let mut writer = hound::WavWriter::create(&staged, spec).map_err(|e| e.to_string())?;
    for sample in &pcm.samples {
        writer
            .write_sample((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
            .map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;
    publish(&staged, path)?;
    Ok(pcm.samples.len() as f64 / f64::from(pcm.channels) / f64::from(pcm.sample_rate) * 1000.0)
}

fn publish(staged: &Path, path: &Path) -> Result<(), String> {
    std::fs::File::open(staged)
        .and_then(|file| file.sync_all())
        .and_then(|()| std::fs::rename(staged, path))
        .map_err(|e| e.to_string())
}

/// 按序流式拼接单元音频；格式必须一致，不把整章载入内存。
fn concat(units: &[PathBuf], path: &Path) -> Result<f64, String> {
    let mut writer = None;
    let mut spec = None;
    let mut samples = 0u64;
    let staged = temporary(path);
    for unit in units {
        let mut reader = hound::WavReader::open(unit).map_err(|e| e.to_string())?;
        let current = reader.spec();
        match spec {
            None => {
                spec = Some(current);
                writer =
                    Some(hound::WavWriter::create(&staged, current).map_err(|e| e.to_string())?);
            }
            Some(first) if first != current => {
                return Err("unit audio formats differ".to_owned());
            }
            Some(_) => {}
        }
        let writer = writer.as_mut().expect("writer follows the first spec");
        for sample in reader.samples::<i16>() {
            writer
                .write_sample(sample.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            samples += 1;
        }
    }
    let (Some(writer), Some(spec)) = (writer, spec) else {
        return Err("no unit audio".to_owned());
    };
    writer.finalize().map_err(|e| e.to_string())?;
    publish(&staged, path)?;
    Ok(samples as f64 / f64::from(spec.channels) / f64::from(spec.sample_rate) * 1000.0)
}

fn media_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// 逐单元合成并持久化，返回前写入终态。已完成单元在失败/取消后保留；
/// 续跑时已完成与空白占位单元直接跳过，只补失败/未做的部分。
pub(super) async fn drive<S: UnitSynth>(
    db: &DatabaseConnection,
    state: &ChapterAudioState,
    run_id: &str,
    text: &str,
    synth: &mut S,
    cancel: &mut watch::Receiver<bool>,
    notify: &impl Fn(run::Model),
) -> Result<(), ChapterAudioError> {
    std::fs::create_dir_all(state.run_dir(run_id)).map_err(|_| ChapterAudioError::WriteFailed)?;
    notify(store::set_stage(db, run_id, ChapterAudioStatus::Running, "generating").await?);
    let mut format = None;
    for unit in store::units(db, run_id).await? {
        if *cancel.borrow() {
            notify(
                store::finish(
                    db,
                    run_id,
                    terminal(ChapterAudioStatus::Cancelled, None, None, None),
                )
                .await?,
            );
            return Ok(());
        }
        let index = u32::try_from(unit.index).map_err(|_| ChapterAudioError::InvalidData)?;
        // 续跑：已定单元（含空白占位经首次通过后的计数）不重做。
        match unit.status.as_str() {
            "done" => continue,
            "empty" => {
                notify(store::complete_unit(db, run_id, &unit.id, None).await?);
                continue;
            }
            _ => {}
        }
        let fail = async |code: &'static str, detail: Option<String>| Finish {
            status: ChapterAudioStatus::Failed,
            error: Some(code),
            detail,
            failed: Some((unit.id.as_str(), index)),
            product: None,
            settled: None,
        };
        let Some(slice) = text.get(unit.range_start as usize..unit.range_end as usize) else {
            notify(store::finish(db, run_id, fail(code::SOURCE, None).await).await?);
            return Ok(());
        };
        let result = synth.synthesize(&execution_text(slice), &unit.voice).await;
        let pcm = match result {
            Ok(pcm) => pcm,
            Err(detail) => {
                tracing::error!(
                    event = "unit_failed",
                    run_id,
                    unit = index,
                    error_code = code::SYNTHESIS,
                );
                notify(
                    store::finish(
                        db,
                        run_id,
                        fail(code::SYNTHESIS, Some(brief(&detail))).await,
                    )
                    .await?,
                );
                return Ok(());
            }
        };
        if *format.get_or_insert((pcm.sample_rate, pcm.channels)) != (pcm.sample_rate, pcm.channels)
        {
            notify(
                store::finish(
                    db,
                    run_id,
                    fail(code::FORMAT, Some("pcm format changed".into())).await,
                )
                .await?,
            );
            return Ok(());
        }
        let path = state.unit_path(run_id, index);
        let Ok(duration_ms) = write_wav(&path, &pcm) else {
            tracing::error!(
                event = "unit_write_failed",
                run_id,
                unit = index,
                error_code = code::WRITE,
            );
            notify(store::finish(db, run_id, fail(code::WRITE, None).await).await?);
            return Ok(());
        };
        let media = media_id();
        state.publish_media(&media, path.clone());
        let bytes = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        tracing::debug!(
            target: "perf",
            event = "unit_completed",
            run_id,
            unit = index,
            duration_ms,
            bytes,
        );
        notify(store::complete_unit(db, run_id, &unit.id, Some((&media, duration_ms))).await?);
    }
    if *cancel.borrow() {
        notify(
            store::finish(
                db,
                run_id,
                terminal(ChapterAudioStatus::Cancelled, None, None, None),
            )
            .await?,
        );
        return Ok(());
    }
    // 产物以终局行状态为准（续跑时包含此前已完成的单元）。
    let produced = store::units(db, run_id)
        .await?
        .into_iter()
        .filter(|unit| unit.status == "done")
        .map(|unit| state.unit_path(run_id, u32::try_from(unit.index).unwrap_or_default()))
        .collect::<Vec<_>>();
    if produced.is_empty() {
        notify(
            store::finish(
                db,
                run_id,
                terminal(ChapterAudioStatus::Failed, Some(code::NO_AUDIO), None, None),
            )
            .await?,
        );
        return Ok(());
    }
    if produced.iter().any(|path| !path.is_file()) {
        tracing::error!(
            event = "kept_audio_missing",
            run_id,
            error_code = code::CONCAT,
        );
        notify(
            store::finish(
                db,
                run_id,
                terminal(
                    ChapterAudioStatus::Failed,
                    Some(code::WRITE),
                    Some("kept unit audio is missing".into()),
                    None,
                ),
            )
            .await?,
        );
        return Ok(());
    }
    notify(store::set_stage(db, run_id, ChapterAudioStatus::Running, "concatenating").await?);
    let path = state.final_path(run_id);
    let settled = None;
    let finish = match concat(&produced, &path) {
        Ok(duration_ms) => {
            let media = media_id();
            state.publish_media(&media, path.clone());
            store::finish(
                db,
                run_id,
                Finish {
                    status: ChapterAudioStatus::Succeeded,
                    error: None,
                    detail: None,
                    failed: None,
                    product: Some((&media, duration_ms)),
                    settled,
                },
            )
            .await?
        }
        Err(detail) => {
            tracing::error!(event = "concat_failed", run_id, error_code = code::CONCAT,);
            store::finish(
                db,
                run_id,
                terminal(
                    ChapterAudioStatus::Failed,
                    Some(code::CONCAT),
                    Some(brief(&detail)),
                    settled,
                ),
            )
            .await?
        }
    };
    notify(finish);
    Ok(())
}

fn terminal(
    status: ChapterAudioStatus,
    error: Option<&'static str>,
    detail: Option<String>,
    settled: Option<u32>,
) -> Finish<'static> {
    Finish {
        status,
        error,
        detail,
        failed: None,
        product: None,
        settled,
    }
}

/// 引擎线程入口：与试听共用推理闸门串行执行，结束后才释放在途登记。
pub(crate) async fn run(app: tauri::AppHandle, run_id: String, gate: Rc<Semaphore>) {
    let state = app.state::<ChapterAudioState>();
    let db = app.state::<DatabaseConnection>().inner().clone();
    let Some(mut cancel) = state.cancellation(&run_id) else {
        return;
    };
    // 事件经单一转发任务按序发出；视图读取失败只丢事件，快照查询仍是权威。
    let (updates, mut pending) = tokio::sync::mpsc::unbounded_channel::<run::Model>();
    let forwarder = tokio::task::spawn_local({
        let (app, db) = (app.clone(), db.clone());
        async move {
            while let Some(row) = pending.recv().await {
                let state = app.state::<ChapterAudioState>();
                if let Ok(view) = store::run_view(&db, &state, &row).await {
                    let _ = ChapterAudioUpdate(view).emit(&app);
                }
            }
        }
    });
    let notify = |row: run::Model| {
        let _ = updates.send(row);
    };
    let permit = tokio::select! {
        permit = gate.acquire() => permit.ok(),
        _ = cancelled(&mut cancel) => None,
    };
    let outcome: Result<(), ChapterAudioError> = async {
        if permit.is_none() || *cancel.borrow() {
            notify(
                store::finish(
                    &db,
                    &run_id,
                    terminal(ChapterAudioStatus::Cancelled, None, None, None),
                )
                .await?,
            );
            return Ok(());
        }
        let row = store::set_stage(&db, &run_id, ChapterAudioStatus::Running, "loading").await?;
        notify(row.clone());
        let failed = |code, detail: Option<String>| {
            terminal(ChapterAudioStatus::Failed, Some(code), detail, None)
        };
        let engine_state = app.state::<crate::engine::EngineState>();
        if engine_state.active_preparations().unwrap_or(1) > 0 {
            notify(store::finish(&db, &run_id, failed(code::PREPARING, None)).await?);
            return Ok(());
        }
        let sources = app
            .path()
            .app_data_dir()
            .map(|root| store::sources_root(&root))
            .map_err(|_| ChapterAudioError::ReadFailed)?;
        let Ok(text) = crate::project::source_asset_text(&sources, &row.source_sha256) else {
            notify(store::finish(&db, &run_id, failed(code::SOURCE, None)).await?);
            return Ok(());
        };
        let Ok(registry) = crate::engine::catalog::registry(&engine_state) else {
            notify(store::finish(&db, &run_id, failed(code::ENGINE, None)).await?);
            return Ok(());
        };
        let mut options = ModelOptions::new(&row.backend, registry.root());
        options.model = Some(row.model.clone());
        options.device = talechime::Device::Cpu;
        let loaded = Engine::load(&registry, options, |_| {}).await;
        let Ok(mut engine) = loaded else {
            let detail = "engine load failed";
            tracing::error!(
                event = "unit_failed",
                run_id,
                error_code = code::ENGINE,
                detail,
            );
            notify(store::finish(&db, &run_id, failed(code::ENGINE, Some(detail.into()))).await?);
            return Ok(());
        };
        let driven = drive(
            &db,
            &state,
            &run_id,
            &text,
            &mut EngineSynth(&engine),
            &mut cancel,
            &notify,
        )
        .await;
        // 取消或失败都先完成后端 teardown，闸门与在途登记保持到此之后。
        let _ = engine.close().await;
        driven
    }
    .await;
    if outcome.is_err() {
        // 持久化自身失败：尽力落一个失败终态，不留下悬空的活动任务。
        if let Ok(row) = store::finish(
            &db,
            &run_id,
            terminal(ChapterAudioStatus::Failed, Some(code::WRITE), None, None),
        )
        .await
        {
            notify(row);
        }
    }
    drop(permit);
    state.finish(&run_id);
    drop(updates);
    let _ = forwarder.await;
}

#[cfg(test)]
mod tests;
