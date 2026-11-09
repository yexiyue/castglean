//! Model boundary selection; workflow and persistence remain the same for every mode.
use crate::{
    contract::hash,
    driver::Script,
    kernel::{Counters, Kernel, RuntimeHandler},
};
use anyhow::Result;
use rig_core::{
    operation::Completion,
    serve::{ErasedHandler, adapters::ModelAdapter},
    test_utils::MockCompletionModel,
};
use rig_ecs::prelude::Entity;
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

pub(crate) struct DispatchRuntime {
    pub runtime: tokio::runtime::Handle,
    pub counters: Arc<Counters>,
    pub barrier: Option<Arc<tokio::sync::Barrier>>,
}
pub(crate) enum Backend {
    Controlled(Script),
    #[cfg(feature = "native-live")]
    Native(Arc<crate::live::NativeBoundary>),
}
impl Backend {
    pub fn configuration_hash(&self) -> Result<String> {
        match self {
            Self::Controlled(_) => Ok(hash(&serde_json::to_vec(
                &json!({"configuration":{"model":"controlled-script","maxOutputTokens":null,"temperature":null},"reasoning":"low","identityScope":"known-only"}),
            )?)),
            #[cfg(feature = "native-live")]
            Self::Native(native) => Ok(native.binding.configuration_hash.clone()),
        }
    }
    pub fn model(&self) -> &str {
        match self {
            Self::Controlled(_) => "controlled-script",
            #[cfg(feature = "native-live")]
            Self::Native(n) => &n.binding.model,
        }
    }
    pub fn mode(&self) -> &str {
        match self {
            Self::Controlled(_) => "mock",
            #[cfg(feature = "native-live")]
            Self::Native(n) => {
                if n.controlled() {
                    "mock"
                } else {
                    "live"
                }
            }
        }
    }
    pub fn execution_mode(&self) -> &str {
        match self {
            Self::Controlled(_) => "controlled_mock",
            #[cfg(feature = "native-live")]
            Self::Native(n) => {
                if n.controlled() {
                    "controlled_native_helper"
                } else {
                    "native_live"
                }
            }
        }
    }
    pub fn is_native(&self) -> bool {
        match self {
            Self::Controlled(_) => false,
            #[cfg(feature = "native-live")]
            Self::Native(_) => true,
        }
    }
    pub fn fingerprint(&self) -> Result<Value> {
        match self {
            Self::Controlled(s) => {
                Ok(json!({"mode":"controlled_mock","scriptHash":hash(&serde_json::to_vec(s)?)}))
            }
            #[cfg(feature = "native-live")]
            Self::Native(n) => Ok(n.identity()),
        }
    }
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Controlled(s) => {
                anyhow::ensure!(
                    s.analysis.len() == 3 && s.delay_ms.len() == 4,
                    "script_requires_three_analysis_and_one_review"
                );
                Ok(())
            }
            #[cfg(feature = "native-live")]
            Self::Native(n) => n.verify(),
        }
    }
    pub fn launch(
        &self,
        kernel: &mut Kernel,
        index: usize,
        prompt: &str,
        payload: String,
        dispatch: DispatchRuntime,
    ) -> Result<(Entity, Option<MockCompletionModel>)> {
        let (handler, delay, model) = match self {
            Self::Controlled(script) => {
                let model = MockCompletionModel::from_stream_turns([if index == 3 {
                    script.review.clone()
                } else {
                    script.analysis[index].clone()
                }]);
                (
                    ErasedHandler::new(ModelAdapter::<Completion>::new(
                        "controlled-script",
                        model.clone(),
                    )),
                    Duration::from_millis(script.delay_ms[index]),
                    Some(model),
                )
            }
            #[cfg(feature = "native-live")]
            Self::Native(n) => (n.handler(index), Duration::ZERO, None),
        };
        let wrapped = ErasedHandler::new(RuntimeHandler {
            inner: handler,
            runtime: dispatch.runtime,
            delay,
            counters: dispatch.counters,
            barrier: if self.is_native() {
                None
            } else {
                dispatch.barrier
            },
        });
        let entity = match self {
            Self::Controlled(_) => kernel.launch(wrapped, prompt, payload)?,
            #[cfg(feature = "native-live")]
            Self::Native(n) => kernel.launch_on(wrapped, prompt, payload, n.spec()?)?,
        };
        Ok((entity, model))
    }
    pub fn request_unknown(&self, _index: usize) -> bool {
        match self {
            Self::Controlled(_) => false,
            #[cfg(feature = "native-live")]
            Self::Native(n) => n.request_unknown(_index),
        }
    }
    pub fn timed_out(&self) -> bool {
        match self {
            Self::Controlled(_) => false,
            #[cfg(feature = "native-live")]
            Self::Native(n) => n.timed_out(),
        }
    }
    pub fn drain(&self) -> Result<()> {
        match self {
            Self::Controlled(_) => Ok(()),
            #[cfg(feature = "native-live")]
            Self::Native(n) => n.drain(),
        }
    }
}
