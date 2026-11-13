//! Published suggestion lookup and current-identity staleness.
use super::super::types::*;
use crate::database::entity::{casting_suggestion, character};
use sea_orm::sea_query::{Alias, Expr, ExprTrait};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, Order, QueryFilter, QueryOrder};

/// A published suggestion with read-time staleness against current digests.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SuggestionSnapshot {
    pub run_id: String,
    pub created_at: String,
    pub suggestion: StoredCastingSuggestion,
    pub characters_stale: bool,
    pub catalog_stale: bool,
}

/// Read one suggestion (or the project's latest) and mark staleness against the
/// caller-provided current character and catalog digests.
pub(crate) async fn suggestion(
    db: &DatabaseConnection,
    project_id: &str,
    run_id: Option<&str>,
    current_character_digest: &str,
    current_catalog_digest: &str,
) -> Result<Option<SuggestionSnapshot>, BindingError> {
    let row = match run_id {
        Some(run_id) => casting_suggestion::Entity::find_by_id(run_id)
            .one(db)
            .await
            .map_err(|_| BindingError::ReadFailed)?,
        None => casting_suggestion::Entity::find()
            .filter(casting_suggestion::Column::ProjectId.eq(project_id))
            .order_by(
                Expr::col(casting_suggestion::Column::CreatedAt).cast_as(Alias::new("INTEGER")),
                Order::Desc,
            )
            .order_by_desc(casting_suggestion::Column::RunId)
            .one(db)
            .await
            .map_err(|_| BindingError::ReadFailed)?,
    };
    let Some(row) = row else {
        return Ok(None);
    };
    if row.project_id != project_id {
        return Err(BindingError::NotFound);
    }
    let suggestion: StoredCastingSuggestion =
        serde_json::from_value(row.content).map_err(|_| BindingError::InvalidData)?;
    if suggestion.format_version != 1 {
        return Err(BindingError::InvalidData);
    }
    Ok(Some(SuggestionSnapshot {
        characters_stale: suggestion.character_digest != current_character_digest,
        catalog_stale: suggestion.catalog_digest != current_catalog_digest,
        run_id: row.run_id,
        created_at: row.created_at,
        suggestion,
    }))
}

/// Adopting binds exactly one entry the suggestion actually proposed.
pub(crate) fn suggested_entry<'a>(
    snapshot: &'a SuggestionSnapshot,
    target: &BindingTarget,
) -> Option<&'a TargetSuggestion> {
    snapshot
        .suggestion
        .targets
        .iter()
        .find(|entry| &entry.target == target)
}

/// Current character digest for staleness: validated identities and revisions.
pub(crate) async fn current_character_digest(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<String, BindingError> {
    let rows = character::Entity::find()
        .filter(character::Column::ProjectId.eq(project_id))
        .filter(character::Column::Status.is_in(["confirmed", "candidate"]))
        .all(db)
        .await
        .map_err(|_| BindingError::ReadFailed)?;
    Ok(character_digest(
        &rows
            .into_iter()
            .map(|row| (row.id, row.revision as u32))
            .collect::<Vec<_>>(),
    ))
}

#[cfg(test)]
mod read_tests {
    use super::super::freeze;
    use super::*;
    use crate::database::entity::{casting_input, character_alias};
    use sea_orm::{ActiveModelTrait, Set, TransactionTrait};

    async fn fixture() -> (tempfile::TempDir, DatabaseConnection) {
        let (root, db, project) = crate::project::test_support::fixture().await;
        crate::project::store::save(&db, root.path(), &project, None)
            .await
            .unwrap();
        (root, db)
    }

    #[tokio::test]
    async fn freeze_preserves_sorted_aliases_and_retry_keeps_original_names() {
        let (_root, db) = fixture().await;
        character::Entity::insert(character::ActiveModel {
            id: Set("hero".into()),
            project_id: Set("project".into()),
            display_name: Set("主角".into()),
            status: Set("confirmed".into()),
            revision: Set(1),
            content: Set(serde_json::json!({})),
        })
        .exec(&db)
        .await
        .unwrap();
        for (id, name) in [("alias-b", "小明"), ("alias-a", "少年")] {
            character_alias::Entity::insert(character_alias::ActiveModel {
                id: Set(id.into()),
                project_id: Set("project".into()),
                character_id: Set("hero".into()),
                name: Set(name.into()),
                content: Set(serde_json::json!({})),
            })
            .exec(&db)
            .await
            .unwrap();
        }
        let tx = db.begin().await.unwrap();
        freeze(
            &tx,
            "project",
            "original",
            Some(CatalogSnapshot {
                library: vec![],
                presets: vec![],
            }),
            None,
            "只配主角",
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let original = casting_input::Entity::find_by_id("original")
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        let input: StoredCastingInput = serde_json::from_value(original.content.clone()).unwrap();
        assert_eq!(input.characters[0].aliases, vec!["小明", "少年"]);

        character_alias::Entity::update_many()
            .col_expr(
                character_alias::Column::Name,
                sea_orm::sea_query::Expr::value("新别名"),
            )
            .exec(&db)
            .await
            .unwrap();
        let tx = db.begin().await.unwrap();
        freeze(&tx, "project", "retry", None, Some("original"), "新要求")
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let retry = casting_input::Entity::find_by_id("retry")
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(retry.content, original.content);
    }

    async fn publish_suggestion(db: &DatabaseConnection, run_id: &str, created_at: &str) {
        casting_suggestion::ActiveModel {
            run_id: Set(run_id.to_owned()),
            project_id: Set("project".into()),
            content: Set(serde_json::json!({
                "formatVersion": 1,
                "targets": [{
                    "target": {"kind": "narrator"},
                    "profile": "沉稳男声",
                    "voiceCandidates": [{
                        "voice": {"kind": "library", "id": "voice-a"},
                        "label": "低沉男声",
                        "reason": "匹配"
                    }],
                    "design": null
                }],
                "rejected": [],
                "characterDigest": "d1",
                "catalogDigest": "c1"
            })),
            created_at: Set(created_at.to_owned()),
        }
        .insert(db)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn suggestion_reads_latest_and_marks_staleness() {
        let (_root, db) = fixture().await;
        publish_suggestion(&db, "run-old", "9").await;
        publish_suggestion(&db, "run-new", "10").await;
        let latest = suggestion(&db, "project", None, "d1", "c2")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(latest.run_id, "run-new");
        assert!(!latest.characters_stale);
        assert!(latest.catalog_stale);
        // Explicit run id and cross-project rejection.
        let explicit = suggestion(&db, "project", Some("run-old"), "d1", "c1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(explicit.run_id, "run-old");
        let entry = suggested_entry(&explicit, &BindingTarget::Narrator).unwrap();
        assert_eq!(
            entry.voice_candidates[0].voice,
            VoiceRef::Library {
                id: "voice-a".into()
            }
        );
        assert!(
            suggested_entry(
                &explicit,
                &BindingTarget::Character {
                    character_id: "missing".into()
                }
            )
            .is_none()
        );
        assert!(
            suggestion(&db, "project", Some("run-old"), "d1", "c1")
                .await
                .is_ok()
        );
        // A suggestion of another project is not readable through this one.
        crate::database::entity::project::Entity::insert(
            crate::database::entity::project::ActiveModel {
                id: Set("p2".into()),
                title: Set("二".into()),
                description: Set(String::new()),
                revision: Set(1),
                stage: Set("importing".into()),
                created_at: Set("1".into()),
                updated_at: Set("1".into()),
            },
        )
        .exec(&db)
        .await
        .unwrap();
        assert_eq!(
            suggestion(&db, "p2", Some("run-new"), "d1", "c1")
                .await
                .unwrap_err(),
            BindingError::NotFound
        );
        // Empty projects simply have no suggestion.
        assert!(
            suggestion(&db, "p2", None, "d1", "c1")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn current_character_digest_tracks_all_validated_identities() {
        let (_root, db) = fixture().await;
        character::Entity::insert(character::ActiveModel {
            id: Set("hero".into()),
            project_id: Set("project".into()),
            display_name: Set("主角".into()),
            status: Set("confirmed".into()),
            revision: Set(2),
            content: Set(serde_json::json!({})),
        })
        .exec(&db)
        .await
        .unwrap();
        character::Entity::insert(character::ActiveModel {
            id: Set("cand".into()),
            project_id: Set("project".into()),
            display_name: Set("候选".into()),
            status: Set("candidate".into()),
            revision: Set(1),
            content: Set(serde_json::json!({})),
        })
        .exec(&db)
        .await
        .unwrap();
        assert_eq!(
            current_character_digest(&db, "project").await.unwrap(),
            character_digest(&[("hero".to_owned(), 2), ("cand".to_owned(), 1)])
        );
    }
}
