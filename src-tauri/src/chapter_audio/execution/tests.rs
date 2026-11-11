//! 循环测试：顺序与拼接、单元失败、取消与格式漂移，均不加载模型。
use super::*;
use crate::chapter_analysis::ByteRange;
use crate::chapter_audio::plan::split_range as split_range_pub;
use crate::chapter_audio::plan::{Plan, PlannedUnit};
use crate::voice_binding::BindingTarget;
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use std::cell::RefCell;

const TEXT: &str = "第一句。\n\n第二句。第三句。";
/// 单元文本（空白单元不合成）与各自声音。
const UNITS: [(&str, &str); 4] = [
    ("第一句。", "zf_001"),
    ("\n\n", "zf_001"),
    ("第二句。", "zm_009"),
    ("第三句。", "zf_001"),
];

#[derive(Default)]
struct Fake {
    calls: Vec<(String, String)>,
    fail_at: Option<usize>,
    drift_at: Option<usize>,
    cancel_at: Option<(usize, watch::Sender<bool>)>,
}

impl UnitSynth for Fake {
    async fn synthesize(&mut self, text: &str, voice: &str) -> Result<Pcm, String> {
        let call = self.calls.len();
        self.calls.push((text.to_owned(), voice.to_owned()));
        if let Some((at, cancel)) = &self.cancel_at
            && *at == call
        {
            cancel.send_replace(true);
        }
        if self.fail_at == Some(call) {
            return Err("backend exploded with private detail".into());
        }
        Ok(Pcm {
            // 每次调用用不同幅值，拼接顺序可从样本直接核对。
            samples: vec![(call as f32 + 1.0) / 10.0; 240],
            sample_rate: if self.drift_at == Some(call) {
                16000
            } else {
                24000
            },
            channels: 1,
        })
    }
}

struct Fixture {
    _root: tempfile::TempDir,
    db: DatabaseConnection,
    state: ChapterAudioState,
    seen: RefCell<Vec<run::Model>>,
}

async fn fixture() -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let db = crate::database::open(&root.path().join("test.sqlite3"))
        .await
        .unwrap();
    for sql in [
        "INSERT INTO projects VALUES ('p', 'Title', '', 1, 'importing', '1', '1')",
        "INSERT INTO sources VALUES ('s', 'p', 0, 'novel.txt', 'utf-8', 'raw', 'raw', 1, 'sha', 'sha', 1)",
        "INSERT INTO chapters VALUES ('c', 'p', 's', NULL, '第一章', 0, 40, 0, 0, '[]')",
    ] {
        db.execute_raw(Statement::from_string(DbBackend::Sqlite, sql))
            .await
            .unwrap();
    }
    let mut start = 0u32;
    let units = UNITS
        .iter()
        .enumerate()
        .map(|(i, (text, voice))| {
            let range = ByteRange {
                start,
                end: start + text.len() as u32,
            };
            start = range.end;
            PlannedUnit {
                segment_id: format!("s{i}"),
                range,
                line: 0,
                target: BindingTarget::Narrator,
                voice: (*voice).into(),
                empty: text.trim().is_empty(),
            }
        })
        .collect();
    assert_eq!(start as usize, TEXT.len());
    let plan = Plan {
        version_id: "v1".into(),
        source_sha256: "sha".into(),
        backend: "kokoro".into(),
        model: "1.1-zh".into(),
        units,
    };
    store::insert(&db, "r1", "p", "c", &plan).await.unwrap();
    let state = ChapterAudioState::new(root.path().join("chapter-audio"));
    Fixture {
        _root: root,
        db,
        state,
        seen: RefCell::new(vec![]),
    }
}

impl Fixture {
    async fn drive(&self, fake: &mut Fake, cancel: &mut watch::Receiver<bool>) {
        drive(&self.db, &self.state, "r1", TEXT, fake, cancel, &|row| {
            self.seen.borrow_mut().push(row)
        })
        .await
        .unwrap();
    }
    async fn run(&self) -> run::Model {
        store::find(&self.db, "r1").await.unwrap()
    }
    async fn statuses(&self) -> Vec<String> {
        store::units(&self.db, "r1")
            .await
            .unwrap()
            .into_iter()
            .map(|u| u.status)
            .collect()
    }
    fn assert_monotonic(&self) {
        let seen = self.seen.borrow();
        assert!(
            seen.windows(2)
                .all(|w| w[0].completed_units <= w[1].completed_units),
            "progress never moves backwards"
        );
    }
}

fn fixture_plan() -> Plan {
    let mut start = 0u32;
    let units = UNITS
        .iter()
        .enumerate()
        .map(|(i, (text, voice))| {
            let range = ByteRange {
                start,
                end: start + text.len() as u32,
            };
            start = range.end;
            PlannedUnit {
                segment_id: format!("s{i}"),
                range,
                line: 0,
                target: BindingTarget::Narrator,
                voice: (*voice).into(),
                empty: text.trim().is_empty(),
            }
        })
        .collect();
    Plan {
        version_id: "v1".into(),
        source_sha256: "sha".into(),
        backend: "kokoro".into(),
        model: "1.1-zh".into(),
        units,
    }
}

fn idle() -> (watch::Sender<bool>, watch::Receiver<bool>) {
    watch::channel(false)
}

#[tokio::test]
async fn generates_units_in_order_and_concatenates_the_chapter() {
    let fx = fixture().await;
    let mut fake = Fake::default();
    let (_cancel, mut receiver) = idle();
    fx.drive(&mut fake, &mut receiver).await;

    // 只合成非空单元，文本与声音按正文顺序、不遗漏不重复。
    let spoken: Vec<_> = UNITS.iter().filter(|(t, _)| !t.trim().is_empty()).collect();
    assert_eq!(fake.calls.len(), spoken.len());
    for ((text, voice), expected) in fake.calls.iter().zip(&spoken) {
        assert_eq!((text.as_str(), voice.as_str()), **expected);
    }
    let run = fx.run().await;
    assert_eq!(run.status, "succeeded");
    assert_eq!(run.completed_units, 4);
    assert_eq!(run.failed_index, None);
    assert_eq!(fx.statuses().await, ["done", "empty", "done", "done"]);
    assert_eq!(run.final_duration_ms, Some(30.0));
    let media = run.final_media_id.unwrap();
    let path = fx
        .state
        .media_path(&media)
        .expect("final audio is published");

    let mut reader = hound::WavReader::open(path).unwrap();
    assert_eq!(reader.spec().sample_rate, 24000);
    let samples: Vec<i16> = reader.samples::<i16>().map(Result::unwrap).collect();
    assert_eq!(samples.len(), 240 * 3);
    for (call, chunk) in samples.chunks(240).enumerate() {
        let expected = ((call as f32 + 1.0) / 10.0 * i16::MAX as f32) as i16;
        assert!(chunk.iter().all(|s| *s == expected), "unit {call} in order");
    }
    fx.assert_monotonic();
    let stages: Vec<_> = fx.seen.borrow().iter().map(|r| r.stage.clone()).collect();
    assert!(stages.contains(&"generating".to_owned()));
    assert!(stages.contains(&"concatenating".to_owned()));
    assert_eq!(stages.last().unwrap(), "finished");
}

#[tokio::test]
async fn unit_failure_stops_reports_position_and_keeps_completed_audio() {
    let fx = fixture().await;
    let mut fake = Fake {
        fail_at: Some(1),
        ..Default::default()
    };
    let (_cancel, mut receiver) = idle();
    fx.drive(&mut fake, &mut receiver).await;

    assert_eq!(fake.calls.len(), 2, "later units are not attempted");
    let run = fx.run().await;
    assert_eq!(run.status, "failed");
    assert_eq!(run.failed_index, Some(2));
    assert_eq!(
        run.error.as_deref(),
        Some(code::SYNTHESIS),
        "backend detail is not persisted as the user-facing error"
    );
    assert_eq!(run.completed_units, 2);
    assert_eq!(fx.statuses().await, ["done", "empty", "failed", "pending"]);
    assert!(
        run.final_media_id.is_none(),
        "partial runs are not a chapter"
    );
    assert!(!fx.state.final_path("r1").exists());
    assert!(
        fx.state.unit_path("r1", 0).is_file(),
        "completed audio stays"
    );
    fx.assert_monotonic();
}

#[tokio::test]
async fn cancellation_keeps_completed_units_and_never_reports_success() {
    let fx = fixture().await;
    let (cancel, mut receiver) = idle();
    let mut fake = Fake {
        cancel_at: Some((1, cancel)),
        ..Default::default()
    };
    fx.drive(&mut fake, &mut receiver).await;

    let run = fx.run().await;
    assert_eq!(run.status, "cancelled");
    assert_eq!(run.completed_units, 3);
    assert_eq!(run.failed_index, None, "cancellation is not a unit failure");
    assert_eq!(fx.statuses().await, ["done", "empty", "done", "pending"]);
    assert!(fx.state.unit_path("r1", 2).is_file());
    assert!(run.final_media_id.is_none());
    assert!(fx.state.unit_path("r1", 0).is_file());
}

#[tokio::test]
async fn cancellation_before_start_synthesizes_nothing() {
    let fx = fixture().await;
    let (cancel, mut receiver) = idle();
    cancel.send_replace(true);
    let mut fake = Fake::default();
    fx.drive(&mut fake, &mut receiver).await;
    assert!(fake.calls.is_empty());
    assert_eq!(fx.run().await.status, "cancelled");
    assert_eq!(
        fx.run().await.completed_units,
        0,
        "future whitespace is not completed"
    );
}

#[tokio::test]
async fn failure_before_whitespace_does_not_count_future_units() {
    let fx = fixture().await;
    let mut fake = Fake {
        fail_at: Some(0),
        ..Default::default()
    };
    let (_cancel, mut receiver) = idle();
    fx.drive(&mut fake, &mut receiver).await;
    assert_eq!(fx.run().await.completed_units, 0);
    assert_eq!(
        fx.statuses().await,
        ["failed", "empty", "pending", "pending"]
    );
}

#[tokio::test]
async fn format_drift_between_units_fails_instead_of_corrupting_the_chapter() {
    let fx = fixture().await;
    let mut fake = Fake {
        drift_at: Some(1),
        ..Default::default()
    };
    let (_cancel, mut receiver) = idle();
    fx.drive(&mut fake, &mut receiver).await;
    let run = fx.run().await;
    assert_eq!(run.status, "failed");
    assert_eq!(run.error.as_deref(), Some(code::FORMAT));
    assert_eq!(run.failed_index, Some(2));
    assert!(run.final_media_id.is_none());
}

#[tokio::test]
async fn unit_range_off_a_character_boundary_fails_that_unit_without_synthesis() {
    let fx = fixture().await;
    // 把第三个单元的起点挪进一个汉字内部：不得切出损坏文本去合成。
    fx.db
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE chapter_audio_units SET range_start = range_start + 1 WHERE \"index\" = 2",
        ))
        .await
        .unwrap();
    let mut fake = Fake::default();
    let (_cancel, mut receiver) = idle();
    fx.drive(&mut fake, &mut receiver).await;
    assert_eq!(fake.calls.len(), 1, "only the first valid unit was spoken");
    let run = fx.run().await;
    assert_eq!(run.status, "failed");
    assert_eq!(run.error.as_deref(), Some(code::SOURCE));
    assert_eq!(run.failed_index, Some(2));
    assert!(run.final_media_id.is_none());
}

#[tokio::test]
async fn chapter_without_speakable_text_fails_instead_of_publishing_silence() {
    let fx = fixture().await;
    // 把全部单元改为空白：没有任何音频产出时不得报告整章成功。
    fx.db
        .execute_raw(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE chapter_audio_units SET status = 'empty'",
        ))
        .await
        .unwrap();
    let mut fake = Fake::default();
    let (_cancel, mut receiver) = idle();
    fx.drive(&mut fake, &mut receiver).await;
    assert!(fake.calls.is_empty());
    let run = fx.run().await;
    assert_eq!(run.status, "failed");
    assert_eq!(run.error.as_deref(), Some(code::NO_AUDIO));
    assert!(run.final_media_id.is_none());
    assert!(!fx.state.final_path("r1").exists());
}

#[test]
fn staged_audio_is_published_only_after_a_complete_write() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("unit-0000.wav");
    let pcm = Pcm {
        samples: vec![0.5; 2400],
        sample_rate: 24000,
        channels: 1,
    };
    assert_eq!(write_wav(&path, &pcm).unwrap(), 100.0);
    assert!(path.is_file());
    assert!(!temporary(&path).exists(), "no staged file is left behind");
    // 目标目录不存在时写入失败，且不产生目标文件。
    let missing = root.path().join("missing/unit.wav");
    assert!(write_wav(&missing, &pcm).is_err());
    assert!(!missing.exists());
}

/// 2026-11-11 真实失败样本：单元内部换行与单引号都会被引擎前端拒绝。
const FAILING_SLICE: &str = "\u{3000}\u{3000}这二人，一个壮硕的好似一头黑熊。而‘罗峰师兄’和普通人一般。 \r\n\u{3000}\u{3000}论身高…… \r\n\u{3000}\u{3000}这二人相差极大。暗道：‘你好’。";

#[test]
fn execution_text_normalizes_line_breaks_and_unsupported_symbols() {
    let spoken = execution_text(FAILING_SLICE);
    assert!(
        !spoken.contains('\n') && !spoken.contains('\r') && !spoken.contains('\u{3000}'),
        "interior line breaks become plain spaces: {spoken:?}"
    );
    assert!(
        !spoken.contains(['‘', '’', '\'']),
        "single quotes map to supported double quotes: {spoken:?}"
    );
    assert!(spoken.contains("\"你好\""), "mapped to ASCII double quotes");
    assert!(spoken.contains('…'), "ellipsis stays");
    // 原文不动：规范化只作用于送入引擎的文本。
    assert!(FAILING_SLICE.contains('\r') && FAILING_SLICE.contains('‘'));
    assert_eq!(
        execution_text("罗峰·李耀"),
        "罗峰李耀",
        "interpunct is dropped"
    );
    assert_eq!(
        execution_text("50% off"),
        "50% off",
        "digits and percent pass"
    );
    assert_eq!(execution_text("～~–"), "……—", "tilde and en dash map");
    assert_eq!(
        execution_text("『x』〈y〉[z]\u{feff}\u{200b}"),
        "“x”《y》【z】",
        "brackets map and zero-width noise is dropped"
    );
    assert_eq!(
        execution_text("　\n\r "),
        " ",
        "whitespace collapses per character"
    );
}

#[tokio::test]
async fn resume_only_synthesizes_unsettled_units_and_keeps_audio() {
    let fx = fixture().await;
    let mut failing = Fake {
        fail_at: Some(2),
        ..Default::default()
    };
    let (_cancel, mut receiver) = idle();
    fx.drive(&mut failing, &mut receiver).await;
    let run = fx.run().await;
    assert_eq!(run.status, "failed");
    assert_eq!(run.completed_units, 3, "empty + two spoken units settled");

    // 续跑：只允许失败/未做的单元再次进入引擎。
    let row = store::resume(&fx.db, "r1").await.unwrap();
    assert_eq!(row.status, "queued");
    assert_eq!(row.completed_units, 2, "counting restarts from kept audio");
    let first = std::fs::read(fx.state.unit_path("r1", 0)).unwrap();
    let mut fake = Fake::default();
    let (_cancel, mut receiver) = idle();
    fx.drive(&mut fake, &mut receiver).await;

    assert_eq!(fake.calls.len(), 1, "only the failed unit runs again");
    let run = fx.run().await;
    assert_eq!(run.status, "succeeded");
    assert_eq!(run.completed_units, 4, "exact settled count at terminal");
    assert_eq!(run.failed_index, None);
    assert_eq!(
        std::fs::read(fx.state.unit_path("r1", 0)).unwrap(),
        first,
        "kept unit audio is not regenerated"
    );
    let statuses = fx.statuses().await;
    assert_eq!(statuses.iter().filter(|s| *s == "done").count(), 3);
}

#[tokio::test]
async fn resume_refuses_when_frozen_inputs_changed() {
    let fx = fixture().await;
    let mut fake = Fake {
        fail_at: Some(2),
        ..Default::default()
    };
    let (_cancel, mut receiver) = idle();
    fx.drive(&mut fake, &mut receiver).await;
    let run = fx.run().await;
    assert_eq!(run.status, "failed");

    let current = super::store::find(&fx.db, "r1").await.unwrap();
    let units = super::store::units(&fx.db, "r1").await.unwrap();
    // 与执行时的计划一致：从行重建的计划指纹应当匹配。
    let mut rebuilt = fixture_plan();
    assert!(super::store::resumable(&current, &rebuilt, &units));
    // 任何指纹成分变化都拒绝续跑：版本、模型、单元音色、单元范围。
    rebuilt.version_id = "v2".into();
    assert!(!super::store::resumable(&current, &rebuilt, &units));
    let mut rebuilt = fixture_plan();
    rebuilt.model = "1.1-zh-g2pw".into();
    assert!(!super::store::resumable(&current, &rebuilt, &units));
    let mut rebuilt = fixture_plan();
    rebuilt.units[3].voice = "zm_010".into();
    assert!(!super::store::resumable(&current, &rebuilt, &units));
    let mut rebuilt = fixture_plan();
    rebuilt.units[3].range.end -= 1;
    assert!(!super::store::resumable(&current, &rebuilt, &units));
}

/// 真实整章验收（显式、需要就绪权重）：自撰公开样文，多音色按正文顺序合成，
/// 走完整 `drive` 循环与产物发布。与 `cached_nano_synthesis` 同一显式类别。
#[tokio::test(flavor = "current_thread")]
#[ignore = "explicit real synthesis using prepared weights only"]
async fn real_kokoro_generates_a_multi_voice_chapter_in_order() -> anyhow::Result<()> {
    let root = std::env::var_os("CASTGLEAN_MODEL_ROOT").expect("set CASTGLEAN_MODEL_ROOT");
    talechime::run_local(async {
        let root = std::path::PathBuf::from(root);
        let registry = talechime::Registry::new(Some(root.clone()))?;
        anyhow::ensure!(
            registry.resource_status("kokoro", Some("1.1-zh"))?
                == talechime::ResourceStatus::Ready,
            "prepare Kokoro 1.1-zh resources first"
        );

        // 自撰公开样文：旁白 + 两个角色，含触发切分的长段。
        let pieces: &[(&str, &str)] = &[
            ("第一章 渡口\n\n", "zf_001"),
            ("傍晚的渡口起了风，河面上一层一层的浪推着旧木船轻轻摇晃。\n\n", "zf_001"),
            ("沈青把斗笠往下压了压，问道：", "zf_001"),
            ("“周叔，今晚还能过河吗？”\n\n", "zf_003"),
            ("老周蹲在船头收缆绳，头也不抬地说：", "zf_001"),
            ("“过不了，上游下了大雨，水还要涨。”\n\n", "zm_009"),
            (
                "沈青望着对岸渐渐亮起来的灯火，心里有些着急。她这一趟是替师父送一封信，\
                 信封用蜡封得严严实实，压在包袱最底下。临行前师父只交代了一句话，\
                 说这封信必须在三日之内送到对岸的药铺掌柜手里，迟一日便可能误了大事。\
                 她一路不敢耽搁，翻过两座山，走了整整一天半，鞋底都磨薄了一层，\
                 却没想到最后被一条河拦住了去路。河水比她来时宽了不止一倍，\
                 浑黄的浪头卷着断枝和草叶，一下一下拍在石阶上，溅起的水花打湿了她的裤脚。\n\n",
                "zf_001",
            ),
            ("“那明天呢？”", "zf_003"),
            ("沈青又问。\n\n", "zf_001"),
            // 2026-11-11 真实失败形态：单元内部全角缩进 + CRLF + 单引号，
            // 规范化前 Kokoro 前端直接拒绝；混入正文验证修复覆盖真实模式。
            (
                "\u{3000}\u{3000}沈青心道：‘水势若是退了，这信便送得成。’ \r\n\
                 \u{3000}\u{3000}她又望了望河面，暗暗添了一句：‘可别误了三日之期。’\n\n",
                "zf_001",
            ),
            ("老周终于站起身，拍了拍手上的泥，说：", "zf_001"),
            ("“明天一早看水势。你要是不嫌弃，今晚就在我那间棚子里歇一宿。”", "zm_009"),
        ];
        let text: String = pieces.iter().map(|(piece, _)| *piece).collect();
        let mut units = Vec::new();
        let mut cursor = 0u32;
        for (index, (piece, voice)) in pieces.iter().enumerate() {
            let range = ByteRange {
                start: cursor,
                end: cursor + piece.len() as u32,
            };
            cursor = range.end;
            for unit in split_range_pub(&text, range.clone()) {
                let empty = text[unit.start as usize..unit.end as usize].trim().is_empty();
                units.push(PlannedUnit {
                    segment_id: format!("seg-{index}"),
                    range: unit,
                    line: 0,
                    target: if *voice == "zf_003" {
                        BindingTarget::Character {
                            character_id: "c-shenqing".into(),
                        }
                    } else if *voice == "zm_009" {
                        BindingTarget::Character {
                            character_id: "c-laozhou".into(),
                        }
                    } else {
                        BindingTarget::Narrator
                    },
                    voice: (*voice).to_owned(),
                    empty,
                });
            }
        }
        assert_eq!(cursor as usize, text.len());
        let unit_count = units.len();
        assert!(unit_count > pieces.len(), "long pieces must split: {unit_count}");

        let dir = tempfile::tempdir()?;
        let db = crate::database::open(&dir.path().join("real.sqlite3")).await?;
        for sql in [
            "INSERT INTO projects VALUES ('p', 'Title', '', 1, 'importing', '1', '1')",
            "INSERT INTO sources VALUES ('s', 'p', 0, 'novel.txt', 'utf-8', 'raw', 'raw', 1, 'sha', 'sha', 1)",
            "INSERT INTO chapters VALUES ('c', 'p', 's', NULL, '第一章', 0, 40, 0, 0, '[]')",
        ] {
            db.execute_raw(Statement::from_string(DbBackend::Sqlite, sql))
                .await?;
        }
        let plan = Plan {
            version_id: "v-real".into(),
            source_sha256: "unused-by-drive".into(),
            backend: "kokoro".into(),
            model: "1.1-zh".into(),
            units,
        };
        store::insert(&db, "r-real", "p", "c", &plan).await?;
        let state = ChapterAudioState::new(dir.path().join("audio"));

        let mut options = talechime::ModelOptions::new("kokoro", &root);
        options.model = Some("1.1-zh".into());
        options.device = talechime::Device::Cpu;
        let started = std::time::Instant::now();
        let mut engine = talechime::Engine::load(&registry, options, |_| {}).await?;
        let loading = started.elapsed();
        let (cancel, mut receiver) = watch::channel(false);
        let seen = RefCell::new(Vec::new());
        drive(
            &db,
            &state,
            "r-real",
            &text,
            &mut EngineSynth(&engine),
            &mut receiver,
            &|row| seen.borrow_mut().push(row),
        )
        .await?;
        let synthesizing = started.elapsed() - loading;
        engine.close().await?;

        let run = store::find(&db, "r-real").await?;
        assert_eq!(run.status, "succeeded");
        assert_eq!(run.completed_units as usize, unit_count);
        assert_eq!(run.failed_index, None);
        let rows = store::units(&db, "r-real").await?;
        let mut coverage = 0u32;
        let mut total_ms = 0.0;
        for (index, row) in rows.iter().enumerate() {
            assert_eq!(row.index as usize, index);
            coverage += (row.range_end - row.range_start) as u32;
            if row.status == "done" {
                let media = row.media_id.as_ref().expect("done units publish media");
                let path = state.media_path(media).expect("media resolves to a file");
                let mut reader = hound::WavReader::open(&path)?;
                let spec = reader.spec();
                assert_eq!(
                    (spec.sample_rate, spec.channels, spec.bits_per_sample),
                    (24000, 1, 16)
                );
                // 时长不代表有声：每个单元必须含真实信号，而不是静音占位。
                let peak = reader
                    .samples::<i16>()
                    .map(|sample| sample.map(i16::unsigned_abs))
                    .try_fold(0u16, |peak, sample| sample.map(|value| peak.max(value)))?;
                assert!(peak > 1000, "unit {index} is near silent: peak {peak}");
                total_ms += row.duration_ms.unwrap();
            }
        }
        assert_eq!(coverage as usize, text.len(), "units cover the chapter exactly");
        let final_ms = run.final_duration_ms.expect("final duration recorded");
        assert!(
            (final_ms - total_ms).abs() < 2.0,
            "final duration matches unit sum: {final_ms} vs {total_ms}"
        );
        let final_media = run.final_media_id.unwrap();
        let final_path = state.media_path(&final_media).unwrap();
        assert_eq!(hound::WavReader::open(&final_path)?.spec().sample_rate, 24000);
        if let Some(output) = std::env::var_os("CASTGLEAN_AUDIO_OUTPUT") {
            std::fs::copy(&final_path, output)?;
        }
        println!(
            "Kokoro real chapter: units={unit_count} audio={:.1}s load={loading:?} synthesize={synthesizing:?}",
            final_ms / 1000.0
        );
        drop(cancel);
        anyhow::Ok(())
    })
    .await
}
