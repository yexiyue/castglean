//! Actual rig-ecs agents, calls, turns and parent stop propagation.
use anyhow::Result;
use rig_core::{
    catalog::Catalog,
    effect::{EffectKind, HandlerDescriptor, family},
    serve::{Dispatch, ErasedHandler, Reply, Serve},
};
use rig_ecs::{effects::Handler, prelude::*};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{runtime::Handle, task::JoinHandle};

#[derive(Default)]
pub(crate) struct Counters {
    pub calls: AtomicUsize,
    pub active: AtomicUsize,
    pub peak: AtomicUsize,
    pub dropped: AtomicUsize,
}
struct Active {
    counters: Arc<Counters>,
    finished: bool,
}
impl Drop for Active {
    fn drop(&mut self) {
        self.counters.active.fetch_sub(1, Ordering::SeqCst);
        if !self.finished {
            self.counters.dropped.fetch_add(1, Ordering::SeqCst);
        }
    }
}
struct AbortOnDrop<T>(JoinHandle<T>);
impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Runs the full response stream on an already-owned Tokio runtime, never a new runtime.
pub(crate) struct RuntimeHandler {
    pub inner: ErasedHandler,
    pub runtime: Handle,
    pub delay: Duration,
    pub counters: Arc<Counters>,
    pub barrier: Option<Arc<tokio::sync::Barrier>>,
}
impl Serve for RuntimeHandler {
    type Family = family::Dynamic;
    fn descriptor(&self) -> HandlerDescriptor {
        self.inner.descriptor()
    }
    async fn serve(&self, kind: EffectKind, dispatch: Dispatch) -> Reply {
        self.counters.calls.fetch_add(1, Ordering::SeqCst);
        let active = self.counters.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.counters.peak.fetch_max(active, Ordering::SeqCst);
        let guard = Active {
            counters: Arc::clone(&self.counters),
            finished: false,
        };
        let inner = self.inner.clone();
        let delay = self.delay;
        let barrier = self.barrier.clone();
        let mut task = AbortOnDrop(self.runtime.spawn(async move {
            let mut guard = guard;
            if let Some(barrier) = barrier {
                barrier.wait().await;
            }
            tokio::time::sleep(delay).await;
            let outcome = inner.handle(kind, dispatch).await.into_outcome().await;
            guard.finished = true;
            outcome
        }));
        match (&mut task.0).await {
            Ok(outcome) => Reply::Outcome(outcome),
            Err(_) => Reply::Outcome(Err(rig_core::serve::cancelled())),
        }
    }
}

#[derive(Resource, Default)]
struct Ended(HashMap<Entity, TurnOutcome>);
#[derive(Resource, Default)]
struct Recorded(Vec<u64>);

pub(crate) struct Kernel {
    app: App,
    pub parent: Entity,
}
impl Kernel {
    pub fn new() -> Self {
        let mut app = App::new();
        app.add_plugins(TaskPoolPlugin::default())
            .add_plugins(AgentPlugin)
            .init_resource::<Ended>()
            .init_resource::<Recorded>()
            .add_systems(AgentPass, no_retries.in_set(ReviewSystems::Edit))
            .add_systems(AgentPass, one_request.in_set(GateSystems::After))
            .add_systems(
                Last,
                |mut events: MessageReader<EffectRecorded>, mut recorded: ResMut<Recorded>| {
                    // Never persist EffectRecord.kind/outcome: both may contain private text.
                    recorded.0.extend(events.read().map(|e| e.0.id.as_u64()));
                },
            )
            .add_observer(
                |event: On<bevy_ecs::lifecycle::Add<Settled>>,
                 turns: Query<(&ForAgent, &TurnOutcome)>,
                 mut ended: ResMut<Ended>| {
                    if let Ok((of, outcome)) = turns.get(event.entity) {
                        ended.0.insert(of.0, outcome.clone());
                    }
                },
            );
        let parent = app
            .world_mut()
            .spawn((Agent, ToolAccess::Only(Vec::new())))
            .id();
        app.finish();
        app.cleanup();
        app.update();
        Self { app, parent }
    }
    pub fn launch(
        &mut self,
        handler: ErasedHandler,
        prompt: &str,
        payload: String,
    ) -> Result<Entity> {
        let spec = Catalog::builtin()
            .resolve("deepseek/deepseek-flash")?
            .shared();
        let agent = self
            .app
            .world_mut()
            .spawn((
                Agent,
                SpawnedBy(self.parent),
                Connection {
                    spec,
                    handler: Handler(handler),
                },
                SystemPrompt(prompt.into()),
                ReasoningSetting(Some(rig_core::completion::Reasoning::Effort(
                    rig_core::completion::Effort::Low,
                ))),
                ToolAccess::Only(Vec::new()),
            ))
            .id();
        self.app
            .world_mut()
            .trigger(Deliver::new(agent, payload, DeliveryMode::Queue));
        Ok(agent)
    }
    pub fn tick(&mut self) {
        self.app.update();
    }
    pub fn take(&mut self, agent: Entity) -> Option<TurnOutcome> {
        self.app
            .world_mut()
            .resource_mut::<Ended>()
            .0
            .remove(&agent)
    }
    pub fn stop(&mut self) {
        self.app.world_mut().trigger(StopTurn::new(self.parent));
        self.app.update();
    }
    pub fn usage(&self, agent: Entity) -> Option<rig_core::completion::Usage> {
        self.app
            .world()
            .get::<LastUsage>(agent)
            .and_then(LastUsage::usage)
            .copied()
    }
    pub fn effect_ids(&self) -> Vec<u64> {
        self.app.world().resource::<Recorded>().0.clone()
    }
}
fn no_retries(mut verdicts: Query<&mut RetryVerdict, Without<Settled>>) {
    for mut verdict in &mut verdicts {
        verdict.0 = Verdict::Final;
    }
}

// A model requesting a tool cannot turn this read-only one-shot role into a tool loop.
fn one_request(
    mut calls: Query<(Entity, &ForAgent, &mut Decision), (ReadyToStart, ModelCalls)>,
    mut first: Local<HashMap<Entity, Entity>>,
) {
    for (call, agent, mut decision) in &mut calls {
        if decision.is_decided() {
            continue;
        }
        match first.get(&agent.0) {
            Some(initial) if *initial != call => {
                decision.decide(
                    Decider::plugin("prototype-one-request"),
                    Outcome(Err(rig_core::serve::cancelled())),
                );
            }
            None => {
                first.insert(agent.0, call);
            }
            _ => {}
        }
    }
}
