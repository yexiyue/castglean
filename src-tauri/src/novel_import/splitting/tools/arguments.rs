//! Tool inputs are the single source for deserialization and advertised schemas.
#[cfg(test)]
use crate::project::ProjectError;
use crate::{novel_import::detection::HeadingRule, project::Correction};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

#[cfg(test)]
pub(super) fn decode<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T, ProjectError> {
    serde_json::from_value(value.clone()).map_err(|_| ProjectError::InvalidProject)
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Directory {
    #[serde(default)]
    pub page: u32,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct SearchHeadings {
    pub source_id: String,
    pub pattern: String,
    pub page: u32,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ReadContext {
    pub source_id: String,
    pub line: u32,
    #[schemars(range(min = 1, max = 30))]
    pub count: u32,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct TestRules {
    #[schemars(length(max = 32))]
    pub rules: Vec<HeadingRule>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct PatchBoundaries {
    #[schemars(length(max = 100))]
    pub corrections: Vec<Correction>,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct SubmitProposal {
    pub proposal_id: String,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ReadAnalysis {
    #[serde(default, deserialize_with = "crate::ai::tool_input::present")]
    pub chapter_id: Option<String>,
    #[serde(default)]
    pub page: u32,
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct AnalyzeChapter {
    #[serde(default, deserialize_with = "crate::ai::tool_input::present")]
    pub chapter_id: Option<String>,
}

pub(super) fn boundaries_schema() -> Value {
    let mut schema = rig_core::tool::args_schema::<PatchBoundaries>();
    // These fields explicitly accept null to retain a source heading/default group.
    // Rig's generic args_schema deliberately makes Option optional, not nullable.
    for field in ["title", "volumeId"] {
        schema["properties"]["corrections"]["items"]["properties"][field]["type"] =
            serde_json::json!(["string", "null"]);
    }
    schema
}

pub(super) enum Command {
    Directory(Directory),
    SearchHeadings(SearchHeadings),
    ReadContext(ReadContext),
    TestRules(TestRules),
    PatchBoundaries(PatchBoundaries),
    SubmitProposal(SubmitProposal),
    ReadAnalysis(ReadAnalysis),
    AnalyzeChapter(AnalyzeChapter),
}
impl Command {
    pub(super) fn name(&self) -> &'static str {
        use super::adapter::Arguments;
        match self {
            Self::Directory(_) => Directory::NAME,
            Self::SearchHeadings(_) => SearchHeadings::NAME,
            Self::ReadContext(_) => ReadContext::NAME,
            Self::TestRules(_) => TestRules::NAME,
            Self::PatchBoundaries(_) => PatchBoundaries::NAME,
            Self::SubmitProposal(_) => SubmitProposal::NAME,
            Self::ReadAnalysis(_) => ReadAnalysis::NAME,
            Self::AnalyzeChapter(_) => AnalyzeChapter::NAME,
        }
    }
    #[cfg(test)]
    pub(super) fn decode(name: &str, args: &Value) -> Result<Self, ProjectError> {
        match name {
            "directory" => decode(args).map(Self::Directory),
            "search_headings" => decode(args).map(Self::SearchHeadings),
            "read_context" => decode(args).map(Self::ReadContext),
            "test_rules" => decode(args).map(Self::TestRules),
            "patch_boundaries" => decode(args).map(Self::PatchBoundaries),
            "submit_proposal" => decode(args).map(Self::SubmitProposal),
            "read_analysis" => decode(args).map(Self::ReadAnalysis),
            "analyze_chapter" => decode(args).map(Self::AnalyzeChapter),
            _ => Err(ProjectError::InvalidProject),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn boundary_nulls_retain_meaning_and_unknown_arguments_fail() {
        let args = serde_json::json!({"corrections":[{"sourceId":"s","line":0,"include":true,"title":null,"volumeId":null}]});
        let parsed: PatchBoundaries = decode(&args).unwrap();
        assert!(parsed.corrections[0].title.is_none());
        assert!(parsed.corrections[0].volume_id.is_none());
        assert!(decode::<ReadAnalysis>(&serde_json::json!({"chapter_id":null})).is_err());
        let schema = boundaries_schema();
        assert_eq!(
            schema["properties"]["corrections"]["items"]["properties"]["title"]["type"],
            serde_json::json!(["string", "null"])
        );
        assert!(decode::<Directory>(&serde_json::json!({"page":-1})).is_err());
        assert!(
            decode::<ReadAnalysis>(&serde_json::json!({"chapter_id":"c","unexpected":1})).is_err()
        );
    }
}
