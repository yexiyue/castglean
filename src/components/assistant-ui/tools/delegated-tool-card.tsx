import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useLingui } from "@lingui/react/macro";
import { createContext, useContext, useEffect, useState } from "react";
import {
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from "@/components/assistant-ui/elements/tool-fallback.aui";
import { AgentResult } from "@/components/assistant-ui/tools/agent-result";
import { SubagentMessages } from "@/components/assistant-ui/tools/subagent-messages";
import { toolPresentation } from "@/components/assistant-ui/tools/tool-presentation";
import { parseToolResult } from "@/components/assistant-ui/tools/tool-result";
import type {
  BindingTarget,
  DesignDraft,
  LocalProjectSnapshot_Serialize,
  ResultReference,
} from "@/lib/bindings";
import type { CandidateOperationRegistry } from "@/lib/candidate-operations";
import type { StructureOperationRegistry } from "@/lib/structure-operation";

/** The three professional tasks the unified assistant delegates to the host. */
export const delegatedToolNames: readonly string[] = [
  "analyze_chapter",
  "check_splitting",
  "cast_voices",
];

export type DelegatedToolContextValue = {
  projectId: string;
  /** Bump to revalidate mutable adoption state after workspace returns. */
  version?: string;
  onReview?: (reference: ResultReference) => void;
  /** 工程修订：绑定/画像/采用命令的期望修订。 */
  projectRevision?: number;
  onReanalyze?: (chapterId: string) => void;
  /** 候选分章方案的宿主操作面（整套采用/放弃共用同一未决写）。 */
  structureOperations?: StructureOperationRegistry;
  /** 归属候选的就地处理注册表（与检查器共用）。 */
  candidateOperations?: CandidateOperationRegistry;
  /** 分章采用完成后回写工程快照，目录视图与卡内保持一致。 */
  onStructureChange?: (snapshot: LocalProjectSnapshot_Serialize) => void;
  onRefreshProject?: () => Promise<void>;
  /** 归属候选采用后刷新分析状态。 */
  onAnalysisSaved?: () => Promise<void>;
  /** 设计草稿跳角色中心并预填。 */
  onDesignInCenter?: (target: BindingTarget, draft: DesignDraft) => void;
  /** 绑定目标的显示名（旁白由结果面自命名）。 */
  targetName?: (target: BindingTarget) => string | undefined;
};

/** Workspace-owned parts of the context, assembled once by the mount layer. */
export type DelegatedDomainContext = Omit<
  DelegatedToolContextValue,
  "projectId" | "version" | "onReview"
>;

export const DelegatedToolContext =
  createContext<DelegatedToolContextValue | null>(null);

export const DelegatedToolProvider = DelegatedToolContext.Provider;

/**
 * Card for the three host-delegated professional tasks, in three segments:
 * the collapsed trigger row, the audition progress anchored beside the call,
 * and the typed result surface rendered outside the collapsible so the
 * outcome and its in-place operations stay visible without expanding.
 * Thread component slots take no props, so project identity arrives through
 * `DelegatedToolProvider` above `<Thread />`.
 */
export const DelegatedToolCard: ToolCallMessagePartComponent = ({
  toolName,
  status,
  isError,
  result,
  messages,
  argsText,
}) => {
  const context = useContext(DelegatedToolContext);
  const { t } = useLingui();
  const parsed = isError ? null : parseToolResult(result);
  const reference = parsed?.reference;
  const { title, icon } = toolPresentation(toolName);
  const isRequiresAction = status?.type === "requires-action";
  const [open, setOpen] = useState(isRequiresAction);
  useEffect(() => {
    if (isRequiresAction) setOpen(true);
  }, [isRequiresAction]);
  return (
    <>
      <ToolFallbackRoot open={open} onOpenChange={setOpen}>
        <ToolFallbackTrigger
          toolName={toolName}
          presentation={{ title: t(title), icon }}
          status={status}
          isError={isError}
        />
        <ToolFallbackContent>
          <ToolFallbackError status={status} />
          {argsText ? (
            <pre className="font-mono text-xs leading-relaxed wrap-anywhere text-muted-foreground">
              {argsText}
            </pre>
          ) : null}
          {messages && messages.length > 0 ? (
            <SubagentMessages
              messages={messages}
              className="ps-1"
              review={context}
              suppressReferenceId={reference?.id}
            />
          ) : null}
        </ToolFallbackContent>
      </ToolFallbackRoot>
      {reference && context ? (
        <AgentResult
          projectId={context.projectId}
          version={context.version}
          reference={reference}
          onReview={context.onReview}
        />
      ) : null}
    </>
  );
};
