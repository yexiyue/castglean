//! Typed Rig tools. Only JSON protocol decoding/encoding belongs to the adapter.
use super::*;
use rig_core::tool::{Tool, ToolContext};
use std::marker::PhantomData;

trait Arguments: for<'de> Deserialize<'de> + Serialize + Send + Sync {
    const NAME: &'static str;
    const INVALID: Code;
    fn command(self) -> Command;
}
impl Arguments for ReadSource {
    const NAME: &'static str = "read_source";
    const INVALID: Code = Code::ReadFrom;
    fn command(self) -> Command {
        Command::Read(self)
    }
}
impl Arguments for Patch {
    const NAME: &'static str = "patch_annotations";
    const INVALID: Code = Code::PatchArguments;
    fn command(self) -> Command {
        Command::Patch(self)
    }
}
impl Arguments for compact::Partition {
    const NAME: &'static str = "finish_analysis";
    const INVALID: Code = Code::PartitionArguments;
    fn command(self) -> Command {
        Command::Partition(self)
    }
}
impl Arguments for Finish {
    const NAME: &'static str = "finish_analysis";
    const INVALID: Code = Code::FinishArguments;
    fn command(self) -> Command {
        Command::Review(self)
    }
}

// Valid JSON with invalid field types must reach the same bounded draft rejection
// path. Keeping the original object also preserves operation fingerprints and
// the distinction between absent, null and explicitly empty fields.
struct Invocation<A> {
    raw: Value,
    arguments: std::result::Result<A, Code>,
}
impl<'de, A: Arguments> Deserialize<'de> for Invocation<A> {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        let raw = Value::deserialize(deserializer)?;
        let arguments = serde_json::from_value(raw.clone()).map_err(|_| A::INVALID);
        Ok(Self { raw, arguments })
    }
}

struct DraftTool<A> {
    draft: SharedDraft,
    description: String,
    parameters: Value,
    args: PhantomData<A>,
}
impl<A: Arguments> DraftTool<A> {
    fn new(draft: SharedDraft) -> Result<Self> {
        let (_, description, parameters) = draft
            .lock()
            .map_err(|_| Code::DraftLock)?
            .definitions()
            .into_iter()
            .find(|(name, _, _)| *name == A::NAME)
            .ok_or(Code::ToolNotOffered)?;
        Ok(Self {
            draft,
            description: description.into(),
            parameters,
            args: PhantomData,
        })
    }
}
impl<A: Arguments + 'static> Tool for DraftTool<A> {
    const NAME: &'static str = A::NAME;
    type Args = Invocation<A>;
    // Feedback fields differ by operation and rejection location. Keep that open
    // envelope at the wire boundary, not in checkpoint/domain state.
    type Output = Value;
    type Error = Code;
    fn description(&self) -> String {
        self.description.clone()
    }
    fn parameters(&self) -> Value {
        self.parameters.clone()
    }
    async fn call(
        &self,
        _: &mut ToolContext,
        args: Invocation<A>,
    ) -> std::result::Result<Value, Code> {
        let mut draft = self.draft.lock().map_err(|_| Code::DraftLock)?;
        Ok(draft.call_command(A::NAME, args.raw, args.arguments.map(Arguments::command)))
    }
}

pub(in crate::chapter_analysis) fn register_tools(
    builder: rig_agent::agent::AgentBuilder,
    draft: SharedDraft,
) -> Result<rig_agent::agent::AgentBuilder> {
    let review = draft
        .lock()
        .map_err(|_| Code::DraftLock)?
        .state
        .evaluation_task
        == "review";
    if review {
        return Ok(builder.tool(DraftTool::<Finish>::new(draft)?));
    }
    Ok(builder
        .tool(DraftTool::<ReadSource>::new(draft.clone())?)
        .tool(DraftTool::<Patch>::new(draft.clone())?)
        .tool(DraftTool::<compact::Partition>::new(draft)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig_core::serve::adapters::ToolAdapter;
    #[tokio::test]
    async fn typed_finish_decodes_arguments_and_preserves_repair_feedback() {
        let draft = super::super::tests::draft();
        let tool = ToolAdapter::new(DraftTool::<compact::Partition>::new(draft.clone()).unwrap());
        let invalid = tool.run(json!({"expectedRevision":0})).await.unwrap();
        assert_eq!(invalid.as_json().unwrap()["error"], "partition_arguments");
        assert!(invalid.as_json().unwrap()["expectedSchema"].is_object());
        assert_eq!(draft.lock().unwrap().calls, 1);
        assert_eq!(draft.lock().unwrap().repair_rounds, 1);
        assert_eq!(draft.lock().unwrap().first_check_valid, Some(false));
        let output = tool.run(super::super::tests::full()).await.unwrap();
        assert_eq!(output.as_json().unwrap()["completed"], true);
        assert!(draft.lock().unwrap().result().is_ok());
    }
    #[tokio::test]
    async fn malformed_typed_calls_share_the_three_repair_limit_and_redacted_audit() {
        let draft = super::super::tests::draft();
        let tool = ToolAdapter::new(DraftTool::<compact::Partition>::new(draft.clone()).unwrap());
        for i in 0..3 {
            let result=tool.run(json!({"operationId":format!("bad{i}"),"expectedRevision":0,"runs":[{"end":"private invalid source","kind":"n","speaker":"narrator"}]})).await.unwrap();
            assert_eq!(result.as_json().unwrap()["error"], "partition_arguments");
        }
        assert_eq!(draft.lock().unwrap().repair_rounds, 3);
        let result = tool.run(super::super::tests::full()).await.unwrap();
        assert_eq!(
            result.as_json().unwrap()["error"],
            "repair_budget_exhausted"
        );
        assert!(
            !serde_json::to_string(draft.lock().unwrap().audit())
                .unwrap()
                .contains("private invalid source")
        );
    }
    #[tokio::test]
    async fn native_rig_repairs_a_decode_rejection_and_stops_after_three_bad_finishes() {
        for repair in [true, false] {
            let fixture = crate::llm::test_support::Fixture::new(move |index, _, _| {
                let args = if repair && index > 0 {
                    super::super::tests::full()
                } else {
                    json!({"operationId":format!("bad{index}"),"expectedRevision":0,"runs":[{"end":"not an integer","kind":"n","speaker":"narrator"}]})
                };
                (
                    200,
                    json!({"id":"fixture","object":"chat.completion","model":"test","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":format!("call{index}"),"type":"function","function":{"name":"finish_analysis","arguments":args.to_string()}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}),
                )
            });
            let (_root, state, selection, _) =
                crate::llm::test_support::configured(&fixture.endpoint);
            let lease = state.acquire_for_run(&selection).unwrap();
            let model = crate::llm::configured_model(&lease, Some(Arc::new(|_| Ok(())))).unwrap();
            let draft = super::super::tests::draft();
            let (result, trace) = crate::chapter_analysis::agent_runtime::run(
                model,
                draft.clone(),
                None,
                &tokio_util::sync::CancellationToken::new(),
                None,
                "analysis",
            )
            .await;
            assert_eq!(result.is_ok(), repair);
            let draft = draft.lock().unwrap();
            assert_eq!(draft.first_check_valid, Some(false));
            assert_eq!(draft.calls, if repair { 2 } else { 3 });
            assert_eq!(trace.requests.len(), if repair { 2 } else { 3 });
            assert_eq!(draft.audit().len(), draft.calls);
            assert_eq!(draft.repair_rounds, if repair { 1 } else { 3 });
        }
    }
}
