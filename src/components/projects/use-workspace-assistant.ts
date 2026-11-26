import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useAiSession } from "@/hooks/use-ai-session";
import { useLlmConnections } from "@/hooks/use-llm-connections";
import type { ModelSelection, ReasoningSetting } from "@/lib/bindings";
import { reasoningChoices } from "@/lib/reasoning";

function modelConsentKey(
  model: { selection: ModelSelection; revision: number },
  effort: ReasoningSetting | null,
): string {
  return JSON.stringify([model.selection, model.revision, effort]);
}

/** Restores each session’s model and reasoning, and scopes consent to that binding. */
export function useWorkspaceAssistant({
  project,
  chapterId,
  readOnly,
  prepareRevision,
}: {
  project: { id: string; revision: number };
  chapterId: string;
  readOnly: boolean;
  prepareRevision: () => Promise<number>;
}) {
  const { t } = useLingui();
  const configuration = useLlmConnections(!readOnly);
  const [modelKey, setModelKey] = useState("");
  const userModelChoice = useRef(false);
  const [confirmedModel, setConfirmedModel] = useState<string | null>(null);
  const [effortKey, setEffortKey] = useState<ReasoningSetting | null>(null);
  const [reasoningFallback, setReasoningFallback] = useState(false);
  const models = (configuration?.connections ?? []).flatMap((c) =>
    c.models.map((m) => ({
      key: JSON.stringify([c.id, m.id]),
      selection: { connectionId: c.id, modelId: m.id },
      revision: c.revision,
      name: `${c.name} / ${m.name}`,
      short: m.name,
      connection: c.name,
      protocol: c.protocol,
      providerModelId: m.modelId,
      advertisedReasoning: m.advertisedReasoning,
      endpoint: c.endpoint,
    })),
  );
  const selectedModel =
    models.find((m) => m.key === modelKey) ??
    models.find(
      (m) =>
        m.selection.connectionId ===
          configuration?.defaultModel?.connectionId &&
        m.selection.modelId === configuration?.defaultModel?.modelId,
    );
  // 当前模型支持的显式档位；不支持当前选择时回落默认（不静默提交非法档）。
  const effortChoices = selectedModel
    ? reasoningChoices(
        configuration?.reasoningCatalog,
        selectedModel.protocol,
        selectedModel.providerModelId,
        selectedModel.advertisedReasoning,
      )
    : [];
  const effectiveEffort =
    effortKey && effortChoices.includes(effortKey) ? effortKey : null;
  const ai = useAiSession({
    projectId: project.id,
    taskKind: "project_assistant",
    title: t`工程会话`,
    binding: () =>
      selectedModel
        ? {
            configuration: {
              selection: selectedModel.selection,
              revision: selectedModel.revision,
              ...(effectiveEffort ? { reasoning: effectiveEffort } : {}),
            },
            confirmRebind:
              confirmedModel ===
              JSON.stringify([
                selectedModel.selection,
                selectedModel.revision,
                effectiveEffort,
              ]),
            expectedProjectRevision: project.revision,
            workspaceContext: { action: "auto", chapterId },
          }
        : null,
    failureText: t`请求未完成，已有分析与修改保留。`,
    prepareRevision,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new conversation resets explicit model consent (and restores its frozen effort) even if both sessions share configuration.
  useEffect(() => {
    userModelChoice.current = false;
    setModelKey("");
    setConfirmedModel(null);
    setEffortKey(ai.snapshot?.session.configuration?.reasoning ?? null);
    setReasoningFallback(false);
  }, [ai.sessionId, ai.snapshot?.session.id]);
  const restoredConnection =
    ai.snapshot?.session.configuration?.selection.connectionId;
  const restoredModel = ai.snapshot?.session.configuration?.selection.modelId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Restore the stored selection after every conversation change.
  useEffect(() => {
    if (!userModelChoice.current && restoredConnection && restoredModel)
      setModelKey(JSON.stringify([restoredConnection, restoredModel]));
  }, [ai.sessionId, restoredConnection, restoredModel]);
  const modelBindingKey = selectedModel
    ? modelConsentKey(selectedModel, effectiveEffort)
    : null;
  const storedConfiguration = ai.snapshot?.session.configuration;
  const needsModelConfirmation = !!(
    storedConfiguration &&
    selectedModel &&
    (storedConfiguration.selection.connectionId !==
      selectedModel.selection.connectionId ||
      storedConfiguration.selection.modelId !==
        selectedModel.selection.modelId ||
      storedConfiguration.revision !== selectedModel.revision ||
      (storedConfiguration.reasoning ?? null) !== effectiveEffort) &&
    confirmedModel !== modelBindingKey
  );
  function chooseModel(key: string) {
    const next = models.find((model) => model.key === key);
    if (!next) return;
    const allowed = reasoningChoices(
      configuration?.reasoningCatalog,
      next.protocol,
      next.providerModelId,
      next.advertisedReasoning,
    );
    const nextEffort =
      effortKey && allowed.includes(effortKey) ? effortKey : null;
    userModelChoice.current = true;
    setModelKey(key);
    setEffortKey(nextEffort);
    setReasoningFallback(effortKey !== null && nextEffort === null);
    setConfirmedModel(modelConsentKey(next, nextEffort));
  }
  function chooseEffort(setting: ReasoningSetting | null) {
    if (!selectedModel) return;
    userModelChoice.current = true;
    setEffortKey(setting);
    setReasoningFallback(false);
    setConfirmedModel(modelConsentKey(selectedModel, setting));
  }
  return {
    ai,
    configuration,
    models,
    selectedModel,
    effortChoices,
    effectiveEffort,
    needsModelConfirmation,
    reasoningFallback,
    chooseModel,
    chooseEffort,
    confirmModel: () => setConfirmedModel(modelBindingKey),
  };
}
