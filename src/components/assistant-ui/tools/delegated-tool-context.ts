import { createContext } from "react";
import type {
  BindingTarget,
  LocalProjectSnapshot_Serialize,
  ResultReference,
} from "@/lib/bindings";
import type { CandidateOperationRegistry } from "@/lib/candidate-operations";
import type { StructureOperationRegistry } from "@/lib/structure-operation";

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
