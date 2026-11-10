//! Parameter types own both tool schemas and decoding; no retired tool aliases.
use crate::{
    novel_import::{HeadingRule, splitting::RuleVariant},
    project::Correction,
};
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;
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
pub(super) struct FinishSplitting {
    pub plan: SplittingPlan,
}
#[derive(Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum SplittingPlan {
    Rules {
        #[schemars(length(max = 32))]
        rules: Vec<HeadingRule>,
    },
    Boundaries {
        #[schemars(length(max = 100))]
        corrections: Vec<Correction>,
    },
}
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct CompareRules {
    #[schemars(length(min = 1, max = 4))]
    pub variants: Vec<RuleVariant>,
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
pub(super) use crate::ai::tasks::SplittingRequest as CheckSplitting;
#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct CastVoices {
    /// 用户本次选角的具体要求原文；空表示按默认意图为全部目标选角。
    #[serde(default)]
    pub requirements: Option<String>,
}

pub(super) fn finish_schema() -> Value {
    let mut schema = rig_core::tool::args_schema::<FinishSplitting>();
    // Explicit null keeps the source heading/default group; omission has the same
    // domain meaning but must retain its original accepted wire identity.
    if let Some(plans) = schema["properties"]["plan"]["oneOf"].as_array_mut() {
        for plan in plans {
            if plan["properties"].get("corrections").is_some() {
                for field in ["title", "volumeId"] {
                    plan["properties"]["corrections"]["items"]["properties"][field]["type"] =
                        serde_json::json!(["string", "null"]);
                }
            }
        }
    }
    schema
}

pub(super) enum Command {
    Directory(Directory),
    SearchHeadings(SearchHeadings),
    ReadContext(ReadContext),
    FinishSplitting(FinishSplitting),
    CompareRules(CompareRules),
    ReadAnalysis(ReadAnalysis),
    AnalyzeChapter(AnalyzeChapter),
    CheckSplitting(CheckSplitting),
    CastVoices(CastVoices),
}
impl Command {
    pub(super) fn name(&self) -> &'static str {
        use super::adapter::Arguments;
        match self {
            Self::Directory(_) => Directory::NAME,
            Self::SearchHeadings(_) => SearchHeadings::NAME,
            Self::ReadContext(_) => ReadContext::NAME,
            Self::FinishSplitting(_) => FinishSplitting::NAME,
            Self::CompareRules(_) => CompareRules::NAME,
            Self::ReadAnalysis(_) => ReadAnalysis::NAME,
            Self::AnalyzeChapter(_) => AnalyzeChapter::NAME,
            Self::CheckSplitting(_) => CheckSplitting::NAME,
            Self::CastVoices(_) => CastVoices::NAME,
        }
    }
    #[cfg(test)]
    pub(super) fn decode(name: &str, args: &Value) -> Result<Self, crate::project::ProjectError> {
        fn parse<T: serde::de::DeserializeOwned>(
            v: &Value,
        ) -> Result<T, crate::project::ProjectError> {
            serde_json::from_value(v.clone())
                .map_err(|_| crate::project::ProjectError::InvalidProject)
        }
        match name {
            "directory" => parse(args).map(Self::Directory),
            "search_headings" => parse(args).map(Self::SearchHeadings),
            "read_context" => parse(args).map(Self::ReadContext),
            "finish_splitting" => parse(args).map(Self::FinishSplitting),
            "compare_rules" => parse(args).map(Self::CompareRules),
            "read_analysis" => parse(args).map(Self::ReadAnalysis),
            "analyze_chapter" => parse(args).map(Self::AnalyzeChapter),
            "check_splitting" => parse(args).map(Self::CheckSplitting),
            "cast_voices" => parse(args).map(Self::CastVoices),
            _ => Err(crate::project::ProjectError::InvalidProject),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn boundary_plan_retains_nulls_and_rejects_unknown_fields() {
        let parsed:FinishSplitting=serde_json::from_value(serde_json::json!({"plan":{"kind":"boundaries","corrections":[{"sourceId":"s","line":0,"include":true,"title":null,"volumeId":null}]}})).unwrap();
        let SplittingPlan::Boundaries { corrections } = parsed.plan else {
            panic!("wrong plan")
        };
        assert!(corrections[0].title.is_none());
        let schema = finish_schema();
        let plans = schema["properties"]["plan"]["oneOf"].as_array().unwrap();
        let boundary = plans
            .iter()
            .find(|p| p["properties"].get("corrections").is_some())
            .unwrap();
        assert_eq!(
            boundary["properties"]["corrections"]["items"]["properties"]["title"]["type"],
            serde_json::json!(["string", "null"])
        );
        assert!(
            serde_json::from_value::<FinishSplitting>(
                serde_json::json!({"plan":{"kind":"rules","rules":[],"extra":true}})
            )
            .is_err()
        );
    }
}
