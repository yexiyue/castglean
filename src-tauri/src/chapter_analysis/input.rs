//! Typed execution intent is persisted with the shared run, never encoded in magic chat text.
use super::{query, store, types::*};
use crate::{
    ai::{AiError, Configuration},
    database::entity::{analysis_input, character_alias},
};
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Action {
    Analyze,
    Discuss,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AliasContext {
    pub id: String,
    pub character_id: String,
    pub name: String,
    pub source: SourceBinding,
    pub evidence: Evidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Input {
    pub format_version: u32,
    #[serde(default)]
    pub protocol: u32,
    #[serde(default)]
    pub prompt_version: Option<String>,
    pub action: Action,
    pub dependencies: Dependencies,
    pub configuration: Configuration,
    pub characters: Vec<Character>,
    #[serde(default)]
    pub aliases: Vec<AliasContext>,
    pub resume_input_id: Option<String>,
}

impl From<AnalysisError> for AiError {
    fn from(e: AnalysisError) -> Self {
        match e {
            AnalysisError::NotFound => Self::NotFound,
            AnalysisError::Conflict | AnalysisError::SourceChanged => Self::Conflict,
            AnalysisError::CapacityExceeded => Self::BudgetExhausted,
            AnalysisError::InvalidData => Self::InvalidRequest,
            _ => Self::StorageFailed,
        }
    }
}

pub(crate) async fn freeze(
    db: &impl ConnectionTrait,
    project_id: &str,
    chapter_id: &str,
    run_id: &str,
    configuration: Configuration,
    analyze: bool,
    resume_id: Option<&str>,
) -> Result<(), AiError> {
    let binding = query::binding(db, project_id, chapter_id).await?;
    let state = store::state(db, project_id, chapter_id).await?;
    let characters: Vec<_> = query::characters(db, project_id)
        .await?
        .into_iter()
        .filter(|c| c.status == CharacterStatus::Confirmed)
        .collect();
    let mut aliases = Vec::new();
    for row in character_alias::Entity::find()
        .filter(character_alias::Column::ProjectId.eq(project_id))
        .all(db)
        .await?
    {
        if !characters.iter().any(|c| c.id == row.character_id) {
            continue;
        }
        let doc: StoredAlias =
            serde_json::from_value(row.content).map_err(|_| AiError::StorageFailed)?;
        if doc.format_version != 1 || !doc.confirmed || doc.source.project_id != project_id {
            return Err(AiError::StorageFailed);
        }
        aliases.push(AliasContext {
            id: row.id,
            character_id: row.character_id,
            name: row.name,
            source: doc.source,
            evidence: doc.evidence,
        });
    }
    let dependencies = Dependencies {
        source: binding,
        analysis_revision: state.as_ref().map_or(0, |s| s.revision as u32),
        human_revision: state.as_ref().map_or(0, |s| s.human_revision as u32),
        characters: characters
            .iter()
            .map(|c| CharacterRevision {
                id: c.id.clone(),
                revision: c.revision,
            })
            .collect(),
        contexts: vec![],
    };
    let input = if let Some(id) = resume_id {
        let mut old = read(db, id).await?;
        if old.configuration != configuration {
            return Err(AiError::Conflict);
        }
        // Resume the frozen context, not a newly expanded cast. New unrelated confirmed
        // identities are not dependencies of windows that have already been requested.
        store::check_dependencies(db, &old.dependencies, true).await?;
        old.resume_input_id = Some(old.resume_input_id.clone().unwrap_or_else(|| id.into()));
        old
    } else {
        Input {
            format_version: 2,
            protocol: 2,
            prompt_version: Some(super::agent_core::PROTOCOL_VERSION.into()),
            action: if analyze {
                Action::Analyze
            } else {
                Action::Discuss
            },
            dependencies,
            configuration,
            characters,
            aliases,
            resume_input_id: None,
        }
    };
    analysis_input::ActiveModel {
        id: Set(run_id.into()),
        project_id: Set(project_id.into()),
        chapter_id: Set(chapter_id.into()),
        content: Set(serde_json::to_value(input).map_err(|_| AiError::InvalidRequest)?),
    }
    .insert(db)
    .await?;
    Ok(())
}

pub(crate) async fn read(db: &impl ConnectionTrait, id: &str) -> Result<Input, AiError> {
    let row = analysis_input::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or(AiError::NotFound)?;
    let input: Input = serde_json::from_value(row.content).map_err(|_| AiError::StorageFailed)?;
    if !matches!(
        (input.format_version, input.protocol),
        (1, 0) | (2, 1) | (2, 2)
    ) || input.dependencies.source.project_id != row.project_id
        || input.dependencies.source.chapter_id != row.chapter_id
    {
        return Err(AiError::StorageFailed);
    }
    Ok(input)
}
