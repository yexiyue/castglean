use super::*;
use crate::chapter_analysis::review;

#[tokio::test]
async fn old_boundary_edit_cannot_modify_a_repartitioned_chapter() {
    use crate::project::{self, edits::ProjectEdit};
    let (root, db, project) = project::test_support::fixture().await;
    project::store::save(&db, root.path(), &project, None)
        .await
        .unwrap();
    project::edits::apply(
        &db,
        root.path(),
        "project",
        1,
        &uuid::Uuid::new_v4().to_string(),
        ProjectEdit::Rules {
            rules: crate::novel_import::heading_rules(),
        },
    )
    .await
    .unwrap();
    project::edits::apply(
        &db,
        root.path(),
        "project",
        2,
        &uuid::Uuid::new_v4().to_string(),
        ProjectEdit::Boundary {
            correction: project::Correction {
                source_id: "source".into(),
                line: 0,
                include: true,
                title: Some("人工标题".into()),
                volume_id: None,
            },
        },
    )
    .await
    .unwrap();
    let project = project::store::read(&db, root.path(), "project")
        .await
        .unwrap();
    let chapter = project
        .document
        .project
        .chapters
        .iter()
        .find(|chapter| chapter.heading == Some(0))
        .unwrap();
    let chapter_id = chapter.id.clone();
    let binding = query::binding(&db, "project", &chapter_id).await.unwrap();
    let text = query::read_text(root.path(), &binding).unwrap();
    let range = ByteRange {
        start: binding.start,
        end: binding.end,
    };
    let original = AnalysisVersion {
        format_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        parent_id: None,
        run_id: None,
        dependencies: Dependencies {
            source: binding,
            analysis_revision: 0,
            human_revision: 0,
            characters: vec![],
            contexts: vec![],
        },
        segments: vec![Segment {
            id: uuid::Uuid::new_v4().to_string(),
            range: range.clone(),
            kind: SegmentKind::Narration,
            attribution: Attribution::Narrator,
            review: ReviewStatus::Unreviewed,
            evidence: vec![Evidence {
                range: range.clone(),
                reason: "公开合成原文".into(),
            }],
            reason: "公开样本".into(),
        }],
        protections: vec![],
    };
    let tx = db.begin().await.unwrap();
    store::insert_version(&tx, &original, &text).await.unwrap();
    store::set_current(&tx, &original, 0, false, None)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let split = range.start + text.char_indices().nth(3).unwrap().0 as u32;
    let edit = Edit::Replace {
        range: range.clone(),
        segments: [(range.start, split), (split, range.end)]
            .into_iter()
            .map(|(start, end)| Segment {
                id: uuid::Uuid::new_v4().to_string(),
                range: ByteRange { start, end },
                ..original.segments[0].clone()
            })
            .collect(),
    };
    let Edit::Replace { segments, .. } = &edit else {
        unreachable!()
    };
    let mut proposed = original.clone();
    proposed.segments = segments.clone();
    super::super::validation::validate(&proposed, &text, &[]).unwrap();
    let command_id = uuid::Uuid::new_v4().to_string();
    project::edits::apply(
        &db,
        root.path(),
        "project",
        3,
        &uuid::Uuid::new_v4().to_string(),
        ProjectEdit::Boundary {
            correction: project::Correction {
                source_id: "source".into(),
                line: 1,
                include: true,
                title: Some("新章节".into()),
                volume_id: None,
            },
        },
    )
    .await
    .unwrap();

    let changed = query::snapshot(&db, root.path(), "project", &chapter_id)
        .await
        .unwrap();
    assert!(changed.stale);
    for _ in 0..2 {
        assert!(matches!(
            apply(
                &db,
                root.path(),
                "project",
                &chapter_id,
                &command_id,
                1,
                edit.clone()
            )
            .await,
            Err(AnalysisError::SourceChanged)
        ));
    }
    let after = query::snapshot(&db, root.path(), "project", &chapter_id)
        .await
        .unwrap();
    assert_eq!(after.version_id, changed.version_id);
    assert_eq!(after.revision, changed.revision);
    assert_eq!(
        query::version(&db, "project", &original.id).await.unwrap(),
        original
    );
}

#[tokio::test]
async fn partial_boundary_replacement_persists_uncovered_protection() {
    let (root, db, project) = crate::project::test_support::fixture().await;
    crate::project::store::save(&db, root.path(), &project, None)
        .await
        .unwrap();
    let binding = query::binding(&db, "project", "chapter").await.unwrap();
    let text = query::read_text(root.path(), &binding).unwrap();
    let range = ByteRange {
        start: binding.start,
        end: binding.end,
    };
    let original = AnalysisVersion {
        format_version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        parent_id: None,
        run_id: None,
        dependencies: Dependencies {
            source: binding,
            analysis_revision: 0,
            human_revision: 0,
            characters: vec![],
            contexts: vec![],
        },
        segments: vec![Segment {
            id: uuid::Uuid::new_v4().to_string(),
            range: range.clone(),
            kind: SegmentKind::Narration,
            attribution: Attribution::Narrator,
            review: ReviewStatus::Unreviewed,
            evidence: vec![Evidence {
                range: range.clone(),
                reason: "公开合成原文".into(),
            }],
            reason: "旁白".into(),
        }],
        protections: vec![],
    };
    let tx = db.begin().await.unwrap();
    store::insert_version(&tx, &original, &text).await.unwrap();
    store::set_current(&tx, &original, 0, false, None)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let boundary = |index| text.char_indices().nth(index).unwrap().0 as u32;
    let (left, middle, right) = (boundary(3), boundary(4), boundary(6));
    let segments = [(range.start, left), (left, right), (right, range.end)]
        .into_iter()
        .map(|(start, end)| Segment {
            range: ByteRange { start, end },
            ..original.segments[0].clone()
        })
        .collect();
    let first = apply(
        &db,
        root.path(),
        "project",
        "chapter",
        &uuid::Uuid::new_v4().to_string(),
        1,
        Edit::Replace {
            range: range.clone(),
            segments,
        },
    )
    .await
    .unwrap();
    let protected = query::version(&db, "project", first.result_id.as_deref().unwrap())
        .await
        .unwrap();
    let fields = vec![
        ProtectedField::Boundary,
        ProtectedField::Kind,
        ProtectedField::Attribution,
        ProtectedField::Review,
    ];
    assert_eq!(
        protected.protections,
        vec![Protection {
            range: range.clone(),
            fields: fields.clone(),
        }]
    );

    let second = apply(
        &db,
        root.path(),
        "project",
        "chapter",
        &uuid::Uuid::new_v4().to_string(),
        first.revision,
        Edit::Replace {
            range: ByteRange {
                start: left,
                end: right,
            },
            segments: [(left, middle), (middle, right)]
                .into_iter()
                .map(|(start, end)| Segment {
                    range: ByteRange { start, end },
                    ..protected.segments[1].clone()
                })
                .collect(),
        },
    )
    .await
    .unwrap();
    let state = store::state(&db, "project", "chapter")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(state.current_version_id, second.result_id.unwrap());
    let saved = query::version(&db, "project", &state.current_version_id)
        .await
        .unwrap();
    assert_eq!(
        saved.protections,
        [(range.start, left), (right, range.end), (left, right)]
            .into_iter()
            .map(|(start, end)| Protection {
                range: ByteRange { start, end },
                fields: fields.clone(),
            })
            .collect::<Vec<_>>()
    );
    assert_eq!(saved.segments.first(), protected.segments.first());
    assert_eq!(saved.segments.last(), protected.segments.last());
    assert_eq!(
        query::version(&db, "project", &protected.id).await.unwrap(),
        protected
    );

    let mut candidate = saved.clone();
    for index in [0, saved.segments.len() - 1] {
        candidate.segments[index].kind = SegmentKind::Thought;
        candidate.segments[index].attribution = Attribution::Unknown;
    }
    let differences = review::differences(&saved, &candidate).unwrap();
    assert_eq!(differences.len(), 2);
    assert!(differences.iter().all(|group| group.conflict));
    let selected: Vec<_> = differences.iter().map(|group| group.id.clone()).collect();
    assert_eq!(
        review::merge(&saved, &differences, &selected, &[]),
        Err(AnalysisError::Conflict)
    );
}
