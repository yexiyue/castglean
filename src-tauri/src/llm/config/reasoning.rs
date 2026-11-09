//! Conservative local capability resolution. Never infer controls from a model-name prefix.
use crate::llm::types::{LlmError, LlmProtocol, ModelReasoning, ReasoningSetting};
use rig_core::{
    catalog::{Catalog, ModelSpec},
    completion::{GenerationOptions, Reasoning},
    providers::registry::ProviderId,
};

// Exact gateway alias previously exercised by the chapter experiment. Do not strip arbitrary
// gateway prefixes. GLM 5.3's vendor definition lists low/high/max, with no off setting:
// https://huggingface.co/zai-org/GLM-5.3/blob/main/README.md
// https://huggingface.co/zai-org/GLM-5.3-Flash/blob/main/README.md
const GLM_ALIASES: &[(&str, &str)] = &[
    ("glm-5.3", "glm-5.3"),
    ("glm-5.3-flash", "glm-5.3-flash"),
    ("GLM-5.3", "glm-5.3"),
    ("GLM-5.3-Flash", "glm-5.3-flash"),
    ("zcode/GLM-5.3-Flash", "glm-5.3-flash"),
];

fn vendor(protocol: LlmProtocol) -> &'static str {
    match protocol {
        LlmProtocol::Openai => "openai",
        LlmProtocol::Anthropic => "anthropic",
        LlmProtocol::Gemini => "gcp.gemini",
    }
}

fn spec(protocol: LlmProtocol, model: &str) -> Option<&'static ModelSpec> {
    let (vendor, model) = if protocol == LlmProtocol::Openai {
        GLM_ALIASES
            .iter()
            .find(|(alias, _)| *alias == model)
            .map(|(_, canonical)| ("zai", *canonical))
            .unwrap_or((vendor(protocol), model))
    } else {
        (vendor(protocol), model)
    };
    // Exact lookup deliberately avoids catalog wildcard/date/prefix matching.
    Catalog::builtin().get_exact(ProviderId::catalog(vendor)?, model)
}

fn named(setting: ReasoningSetting) -> Option<&'static str> {
    use ReasoningSetting::*;
    Some(match setting {
        Lowest => return None,
        ProviderDefault => "default",
        Off => "off",
        Minimal => "minimal",
        Low => "low",
        Medium => "medium",
        High => "high",
        Xhigh => "xhigh",
        Max => "max",
    })
}

// Order is explicit: catalog rows need not sort their levels. Off counts as the lowest cost.
const SETTINGS: &[ReasoningSetting] = &[
    ReasoningSetting::Off,
    ReasoningSetting::Minimal,
    ReasoningSetting::Low,
    ReasoningSetting::Medium,
    ReasoningSetting::High,
    ReasoningSetting::Xhigh,
    ReasoningSetting::Max,
];

fn resolve(
    protocol: LlmProtocol,
    model: &str,
    setting: ReasoningSetting,
) -> Result<Option<Reasoning>, LlmError> {
    if setting == ReasoningSetting::ProviderDefault {
        return Ok(None);
    }
    let support = spec(protocol, model).map(|spec| &spec.reasoning);
    match setting {
        ReasoningSetting::Lowest => Ok(support.and_then(|support| {
            SETTINGS
                .iter()
                .find_map(|setting| support.named(named(*setting)?).ok()?.reasoning)
        })),
        _ => support
            .and_then(|support| support.named(named(setting)?).ok())
            .and_then(|choice| choice.reasoning)
            .map(Some)
            .ok_or(LlmError::InvalidConfiguration),
    }
}

pub(super) fn options(
    protocol: LlmProtocol,
    model: &str,
    setting: ReasoningSetting,
) -> Result<GenerationOptions, LlmError> {
    let mut options = GenerationOptions::default();
    options.reasoning = resolve(protocol, model, setting)?;
    Ok(options)
}

pub(super) fn catalog() -> Vec<ModelReasoning> {
    let mut result = Vec::new();
    for protocol in [
        LlmProtocol::Openai,
        LlmProtocol::Anthropic,
        LlmProtocol::Gemini,
    ] {
        for spec in Catalog::builtin()
            .iter()
            .filter(|spec| spec.provider.vendor() == vendor(protocol))
        {
            let choices = choices(protocol, &spec.id);
            if !choices.is_empty() {
                result.push(ModelReasoning {
                    protocol,
                    model_id: spec.id.clone(),
                    choices,
                });
            }
        }
    }
    for &(alias, _) in GLM_ALIASES {
        result.push(ModelReasoning {
            protocol: LlmProtocol::Openai,
            model_id: alias.into(),
            choices: choices(LlmProtocol::Openai, alias),
        });
    }
    result
        .sort_by(|a, b| (vendor(a.protocol), &a.model_id).cmp(&(vendor(b.protocol), &b.model_id)));
    result
}

fn choices(protocol: LlmProtocol, model: &str) -> Vec<ReasoningSetting> {
    SETTINGS
        .iter()
        .copied()
        .filter(|setting| resolve(protocol, model, *setting).is_ok())
        .collect()
}
